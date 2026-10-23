import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const PLACEHOLDER = 'https://site-url.invalid/';
export const LINE_LIMIT = 140;

export function readJSON(rel, fallback) {
  const file = path.resolve(ROOT, rel);
  if (!fs.existsSync(file)) {
    if (fallback !== undefined) return structuredClone(fallback);
    throw new Error(`missing ${rel}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeJSON(rel, value) {
  const file = path.resolve(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

// Excluded services are stored as shifted code points so their names never appear in the repository.
const BLOCKED_CODES = {
  ko: [
    [48127, 53811, 46363, 49835, 53363], [54035, 51075, 52887, 49835, 53951], [54035, 51075, 51067, 51599],
    [50535, 54547, 54035, 51075], [49835, 47567, 53951, 54035, 51075], [54595, 46363, 54052],
  ],
  latin: [
    [116, 108, 57, 107, 112, 122, 114], [109, 112, 115, 108, 106, 104, 122, 123], [109, 112, 115, 108, 112, 122],
    [104, 119, 119, 115, 108, 109, 112, 115, 108], [122, 116, 104, 121, 123, 109, 112, 115, 108], [119, 107, 119, 118, 119],
  ],
};
const decode = (codes) => String.fromCodePoint(...codes.map((c) => c - 7));
const BLOCKED_KO = BLOCKED_CODES.ko.map(decode);
const BLOCKED_LATIN = BLOCKED_CODES.latin.map(decode);

export function blockedTermsForTests() {
  return [...BLOCKED_KO, ...BLOCKED_LATIN];
}

export function findBlocked(text) {
  const hits = [];
  const squeezed = text.replace(/[\s·_-]+/g, '');
  BLOCKED_KO.forEach((term, i) => {
    if (squeezed.includes(term)) hits.push(`excluded service #${i + 1} (ko)`);
  });
  const lower = text.toLowerCase();
  BLOCKED_LATIN.forEach((term, i) => {
    if (lower.includes(term)) hits.push(`excluded service #${i + 1} (latin)`);
  });
  return hits;
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.cache']);

export function listFiles(dir, skip = SKIP_DIRS) {
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(dir);
  return out;
}

const TEXT_EXT = /\.(html?|css|m?js|json|md|txt|xml|svg|ya?ml|py|sh)$/i;

export function scanForBlocked(dir, skip) {
  const problems = [];
  for (const file of listFiles(dir, skip)) {
    const rel = path.relative(dir, file);
    for (const hit of findBlocked(rel)) problems.push(`${rel}: file name contains ${hit}`);
    if (!TEXT_EXT.test(file)) continue;
    for (const hit of findBlocked(fs.readFileSync(file, 'utf8'))) problems.push(`${rel}: ${hit}`);
  }
  return problems;
}

export function isWide(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2190 && cp <= 0x27bf) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    cp >= 0x20000
  );
}

export function colWidth(str) {
  let w = 0;
  for (const ch of str) w += isWide(ch.codePointAt(0)) ? 2 : 1;
  return w;
}

export function longLines(text, limit = LINE_LIMIT) {
  const bad = [];
  text.split('\n').forEach((line, i) => {
    const w = colWidth(line);
    if (w > limit) bad.push({ line: i + 1, width: w });
  });
  return bad;
}

export const BENEFIT_MAX = 16;

export function benefitProblems(text) {
  const p = [];
  if (typeof text !== 'string' || !text.trim()) return ['empty text'];
  if (text !== text.trim()) p.push('leading or trailing space');
  if ([...text].length > BENEFIT_MAX) p.push(`longer than ${BENEFIT_MAX} characters`);
  if (/(^|\s)시$/.test(text) || /\S시$/.test(text) || /\s시\s/.test(text)) p.push('ends with a 시 condition tail');
  if (/지급|진행\s?중/.test(text)) p.push('contains a filler tail word');
  if (/[.!~…]$/.test(text)) p.push('ends with punctuation');
  if (/\d{4}[.\-/]\d{1,2}|\d{1,2}월\s?\d{1,2}일/.test(text)) p.push('contains a date');
  return p;
}

export function validateVendors(vendors) {
  const problems = [];
  const ids = new Set();
  const names = new Set();
  for (const v of vendors) {
    if (!/^[a-z0-9-]+$/.test(v.id)) problems.push(`${v.id}: bad id`);
    if (ids.has(v.id)) problems.push(`${v.id}: duplicate id`);
    if (names.has(v.name)) problems.push(`${v.name}: duplicate name`);
    ids.add(v.id);
    names.add(v.name);
    if (!['active', 'pending'].includes(v.status)) problems.push(`${v.id}: unknown status`);
    if (v.status === 'active' && !/^https:\/\//.test(v.url ?? '')) problems.push(`${v.id}: active vendor needs an https url`);
    if (!/^#[0-9a-f]{6}$/i.test(v.color ?? '')) problems.push(`${v.id}: color must be #rrggbb`);
    for (const b of v.benefits ?? []) {
      if (!['join', 'event'].includes(b.kind)) problems.push(`${v.id}: benefit kind ${b.kind}`);
      for (const msg of benefitProblems(b.text)) problems.push(`${v.id}: "${b.text}" ${msg}`);
    }
  }
  const colors = vendors.map((v) => v.color.toLowerCase());
  if (new Set(colors).size !== colors.length) problems.push('vendor colors must be unique');
  return problems;
}

export function shownBenefits(vendor) {
  return (vendor.benefits ?? []).filter((b) => !b.unconfirmed);
}

function finalConsonant(word) {
  const last = [...word].at(-1) ?? '';
  const cp = last.codePointAt(0);
  if (cp >= 0xac00 && cp <= 0xd7a3) {
    const jong = (cp - 0xac00) % 28;
    return { has: jong > 0, rieul: jong === 8 };
  }
  if (/[0-9]/.test(last)) return { has: '013678'.includes(last), rieul: '178'.includes(last) };
  if (/[a-z]/i.test(last)) return { has: /[lmnr]/i.test(last), rieul: /l/i.test(last) };
  return { has: false, rieul: false };
}

export function josa(word, pair) {
  const [withFinal, without] = pair.split('/');
  const { has, rieul } = finalConsonant(word);
  if (pair === '으로/로') return word + (has && !rieul ? withFinal : without);
  return word + (has ? withFinal : without);
}

export function kstDate(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function utcFromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(iso, n) {
  const t = utcFromISO(iso);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function weekInfo(iso) {
  const t = utcFromISO(iso);
  const dow = (t.getUTCDay() + 6) % 7;
  const monday = addDays(iso, -dow);
  const thursday = utcFromISO(addDays(monday, 3));
  const year = thursday.getUTCFullYear();
  const month = thursday.getUTCMonth() + 1;
  const nth = Math.ceil(thursday.getUTCDate() / 7);
  return {
    monday,
    year,
    month,
    nth,
    key: `${year}-${String(month).padStart(2, '0')}-W${nth}`,
    label: `${month}월 ${nth}주차`,
  };
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function koreanDate(iso, withYear = false) {
  const t = utcFromISO(iso);
  const base = `${t.getUTCMonth() + 1}월 ${t.getUTCDate()}일(${WEEKDAYS[t.getUTCDay()]})`;
  return withYear ? `${t.getUTCFullYear()}년 ${base}` : base;
}

export function seededShuffle(list, seedText) {
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  const rand = () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const METRIC_LABELS = {
  search: '검색 관심도',
  usage: '앱 이용 지표',
  reaction: '이용자 반응',
};
