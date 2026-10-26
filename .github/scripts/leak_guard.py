#!/usr/bin/env python3
"""Repository privacy check. Fails when tracked files or commit metadata could identify the operator.

Checks
  * forbidden strings from the LEAK_GUARD_TERMS secret (one per line or comma separated)
  * the GitHub account and repository name, read at run time (GITHUB_REPOSITORY or the origin remote)
  * e-mail addresses, phone numbers, business registration numbers, verification and analytics tokens
  * image metadata (EXIF, XMP, IPTC, PNG text/time chunks, GIF comments, SVG metadata and editor traces),
    including base64 images embedded in HTML, CSS and SVG
  * a CNAME file
  * commit author and committer e-mails (must be GitHub no-reply addresses)
Optional argument: extra directories to scan in addition to tracked files (for example a build output).
"""
import base64
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEXT_EXT = {".html", ".htm", ".css", ".js", ".mjs", ".json", ".md", ".txt", ".xml", ".svg", ".yml", ".yaml", ".py", ".sh"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif", ".ico"}

problems = []


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=False).stdout


def tracked_files():
    names = [n for n in git("ls-files", "-z").split("\0") if n]
    return [ROOT / n for n in names if (ROOT / n).is_file()]


def identity_terms():
    terms = []
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if not repo:
        url = git("remote", "get-url", "origin").strip()
        m = re.search(r"[:/]([^/:]+)/([^/]+?)(?:\.git)?$", url)
        if m:
            repo = f"{m.group(1)}/{m.group(2)}"
    if "/" in repo:
        owner, name = repo.split("/", 1)
        terms += [owner, name]
    secret = os.environ.get("LEAK_GUARD_TERMS", "")
    terms += [t.strip() for t in re.split(r"[\n,]", secret) if t.strip()]
    return [t for t in terms if len(t) >= 4]


PATTERNS = [
    ("e-mail address", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")),
    ("mobile phone number", re.compile(r"(?<!\d)01[016789][-. ]?\d{3,4}[-. ]?\d{4}(?!\d)")),
    ("phone number", re.compile(r"(?<!\d)0(?:2|[3-6][1-5])[-. )]\d{3,4}[-. ]\d{4}(?!\d)")),
    ("representative phone number", re.compile(r"(?<!\d)1[5-9]\d{2}-\d{4}(?!\d)")),
    ("business registration number", re.compile(r"(?<!\d)\d{3}-\d{2}-\d{5}(?!\d)")),
    ("google verification", re.compile(r"google-site-verification|google[0-9a-f]{16}\.html", re.I)),
    ("bing verification", re.compile(r"msvalidate\.01|BingSiteAuth", re.I)),
    ("analytics or ad id", re.compile(r"\b(?:G-[A-Z0-9]{8,12}|UA-\d{4,10}-\d+|GTM-[A-Z0-9]{5,8}|ca-pub-\d{10,})\b")),
    ("analytics script", re.compile(r"googletagmanager\.com|google-analytics\.com|pagead2\.googlesyndication", re.I)),
    ("author meta", re.compile(r"<meta\s+name=[\"']author[\"']", re.I)),
]

ALLOWED_EMAIL = re.compile(r"@users\.noreply\.github\.com$|^noreply@github\.com$")


def check_text(rel, text):
    lower = text.lower()
    for term in identity_terms():
        if term.lower() in lower:
            problems.append(f"{rel}: contains an identifying name")
    for label, pat in PATTERNS:
        for m in pat.finditer(text):
            if label == "e-mail address" and ALLOWED_EMAIL.search(m.group(0)):
                continue
            line = text.count("\n", 0, m.start()) + 1
            problems.append(f"{rel}:{line}: {label}")
    for m in re.finditer(r"data:image/[a-z+]+;base64,([A-Za-z0-9+/=]+)", text):
        try:
            check_image_bytes(f"{rel} (embedded image)", base64.b64decode(m.group(1)), None)
        except ValueError:
            problems.append(f"{rel}: undecodable embedded image")


def png_chunks(data):
    pos = 8
    while pos + 8 <= len(data):
        length = int.from_bytes(data[pos:pos + 4], "big")
        kind = data[pos + 4:pos + 8].decode("latin-1")
        yield kind
        pos += 12 + length


def jpeg_segments(data):
    pos = 2
    while pos + 4 <= len(data) and data[pos] == 0xFF:
        marker = data[pos + 1]
        if marker in (0xD9, 0xDA):
            break
        length = int.from_bytes(data[pos + 2:pos + 4], "big")
        yield marker, data[pos + 4:pos + 2 + length]
        pos += 2 + length


def riff_chunks(data):
    pos = 12
    while pos + 8 <= len(data):
        kind = data[pos:pos + 4].decode("latin-1")
        length = int.from_bytes(data[pos + 4:pos + 8], "little")
        yield kind
        pos += 8 + length + (length & 1)


def check_image_bytes(rel, data, ext):
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        bad = {"tEXt", "zTXt", "iTXt", "eXIf", "tIME"} & set(png_chunks(data))
        if bad:
            problems.append(f"{rel}: PNG metadata chunks {sorted(bad)}")
    elif data[:2] == b"\xff\xd8":
        for marker, body in jpeg_segments(data):
            if marker == 0xE1 or marker == 0xED or marker == 0xFE:
                problems.append(f"{rel}: JPEG metadata segment {hex(marker)}")
            if marker == 0xE0 and not body.startswith(b"JFIF"):
                problems.append(f"{rel}: unexpected JPEG APP0 segment")
    elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        bad = {"EXIF", "XMP "} & set(riff_chunks(data))
        if bad:
            problems.append(f"{rel}: WebP metadata chunks {sorted(bad)}")
    elif data[:6] in (b"GIF87a", b"GIF89a"):
        if b"\x21\xfe" in data or b"XMP DataXMP" in data:
            problems.append(f"{rel}: GIF comment or XMP block")
    elif ext == ".svg" or data.lstrip()[:4] in (b"<svg", b"<?xm"):
        text = data.decode("utf-8", "replace")
        if re.search(r"<metadata|<!--|inkscape|sodipodi|adobe|illustrator|sketch|figma|rdf:|dc:", text, re.I):
            problems.append(f"{rel}: SVG metadata or editor traces")
    elif ext in {".avif", ".ico", ".jpg", ".jpeg"}:
        problems.append(f"{rel}: image type should be re-saved as webp or png")


def check_file(path, rel):
    ext = path.suffix.lower()
    if path.name == "CNAME":
        problems.append(f"{rel}: CNAME files are not allowed")
    for term in identity_terms():
        if term.lower() in rel.lower():
            problems.append(f"{rel}: file name contains an identifying name")
    data = path.read_bytes()
    if ext in IMAGE_EXT:
        check_image_bytes(rel, data, ext)
    if ext in TEXT_EXT or path.name in {"CNAME", ".gitignore", ".nojekyll"}:
        check_text(rel, data.decode("utf-8", "replace"))


def check_commits():
    out = git("log", "--all", "--format=%H %ae %ce")
    if not out.strip():
        return
    for line in out.strip().splitlines():
        sha, author, committer = line.split(" ", 2)
        for email in (author, committer):
            if not ALLOWED_EMAIL.search(email):
                problems.append(f"commit {sha[:8]}: e-mail is not a GitHub no-reply address")


def main():
    for path in tracked_files():
        rel = path.relative_to(ROOT).as_posix()
        if rel == ".github/scripts/leak_guard.py":
            continue
        check_file(path, rel)
    for extra in sys.argv[1:]:
        base = Path(extra).resolve()
        for path in sorted(p for p in base.rglob("*") if p.is_file()):
            check_file(path, f"{base.name}/{path.relative_to(base).as_posix()}")
    check_commits()
    if not os.environ.get("LEAK_GUARD_TERMS"):
        print("::warning::LEAK_GUARD_TERMS is not set; only built-in checks ran.")
    if problems:
        print("privacy check failed:")
        for p in sorted(set(problems)):
            print(f"  - {p}")
        sys.exit(1)
    print("privacy check passed")


if __name__ == "__main__":
    main()
