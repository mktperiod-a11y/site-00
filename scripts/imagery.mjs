#!/usr/bin/env node
// Image pipeline. Every file written here is re-encoded by sharp, which drops EXIF/XMP/IPTC and text chunks.
//   node scripts/imagery.mjs fetch     download app icons and logos into .cache/raw (needs open network)
//   node scripts/imagery.mjs process   turn .cache/raw into src/static/icon/*.webp and src/static/logo/*.webp
//   node scripts/imagery.mjs brand     draw the share image and touch icon
//   node scripts/imagery.mjs all       fetch, then process
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT, readJSON, writeJSON } from './lib/rules.mjs';
import { playIcon } from './lib/play.mjs';

const RAW = path.join(ROOT, '.cache/raw');
const STATIC = path.join(ROOT, 'src/static');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const warn = (msg) => console.log(`::warning::${msg}`);

async function get(url, as = 'buffer') {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, 'accept-language': 'ko-KR,ko;q=0.9' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = as === 'text' ? await res.text() : Buffer.from(await res.arrayBuffer());
    return { body, url: res.url, type: res.headers.get('content-type') ?? '' };
  } finally {
    clearTimeout(timer);
  }
}

function headerLogoCandidates(html, pageUrl) {
  const out = [];
  const head = html.search(/<header\b/i);
  const scope = head >= 0 ? html.slice(head) : html;
  for (const m of scope.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = tag.match(/\s(?:data-src|src)=["']([^"']+)["']/i)?.[1];
    if (!src || src.startsWith('data:')) continue;
    const hint = /logo/i.test(tag);
    if (!hint) continue;
    try {
      out.push(new URL(src, pageUrl).href);
    } catch {
      // ignore malformed sources
    }
  }
  return [...new Set(out)];
}

async function fetchAll() {
  fs.mkdirSync(RAW, { recursive: true });
  const vendors = readJSON('data/vendors.json').filter((v) => v.status === 'active');
  const sources = readJSON('data/assets.json');
  const manifest = {};
  for (const v of vendors) {
    const rec = (manifest[v.id] = {});
    const opts = sources[v.id] ?? {};
    let iconUrl = null;
    if (v.appStoreId) {
      try {
        const { body } = await get(`https://itunes.apple.com/lookup?id=${v.appStoreId}&country=kr`, 'text');
        iconUrl = JSON.parse(body).results?.[0]?.artworkUrl512 ?? null;
        rec.iconFrom = 'appstore';
      } catch (e) {
        warn(`app store lookup for ${v.id}: ${e.message}`);
      }
    }
    if (!iconUrl && v.playId) {
      try {
        const { body } = await get(`https://play.google.com/store/apps/details?id=${v.playId}&hl=ko&gl=KR`, 'text');
        const og = playIcon(body);
        iconUrl = og ? og.replace(/=[^=/]*$/, '=s512') : null;
        rec.iconFrom = 'play';
      } catch (e) {
        warn(`store page for ${v.id}: ${e.message}`);
      }
    }
    if (iconUrl) {
      try {
        const { body } = await get(iconUrl);
        fs.writeFileSync(path.join(RAW, `icon-${v.id}`), body);
        rec.icon = iconUrl;
      } catch (e) {
        warn(`icon for ${v.id}: ${e.message}`);
      }
    }
    let urls = opts.candidates ?? (opts.logo && opts.logo !== 'header' ? [opts.logo] : null);
    if (!urls) {
      try {
        const page = await get(opts.page ?? v.url, 'text');
        fs.writeFileSync(path.join(RAW, `home-${v.id}.html`), page.body);
        urls = headerLogoCandidates(page.body, page.url);
      } catch (e) {
        warn(`home page for ${v.id}: ${e.message}`);
        urls = [];
      }
    }
    rec.logos = [];
    for (const [i, url] of urls.entries()) {
      try {
        const { body } = await get(url);
        fs.writeFileSync(path.join(RAW, `logo-${v.id}-${i}`), body);
        rec.logos.push(url);
      } catch (e) {
        warn(`logo ${i} for ${v.id}: ${e.message}`);
        rec.logos.push(null);
      }
    }
  }
  writeJSON('.cache/raw/manifest.json', manifest);
  console.log(`fetched: ${Object.values(manifest).filter((m) => m.icon).length} icons, ` +
    `${Object.values(manifest).filter((m) => m.logos.some(Boolean)).length} vendors with logos`);
}

async function recolorIfLight(img) {
  const { data, info } = await img.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  let count = 0;
  let clear = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) clear++;
  if (clear < (data.length / 4) * 0.05) return img;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    count++;
  }
  if (!count || sum / count < 0.82) return img;
  const alpha = await img.clone().ensureAlpha().extractChannel(3).toBuffer();
  return sharp({ create: { width: info.width, height: info.height, channels: 3, background: '#1b1a22' } })
    .joinChannel(alpha)
    .png();
}

async function processAll() {
  const vendors = readJSON('data/vendors.json');
  const sources = readJSON('data/assets.json');
  fs.mkdirSync(path.join(STATIC, 'icon'), { recursive: true });
  fs.mkdirSync(path.join(STATIC, 'logo'), { recursive: true });
  for (const v of vendors) {
    const opts = sources[v.id] ?? {};
    const iconRaw = path.join(RAW, `icon-${v.id}`);
    if (fs.existsSync(iconRaw) && !opts.skipIcon) {
      await sharp(iconRaw, { animated: false })
        .resize(128, 128, { fit: 'cover' })
        .webp({ quality: 88 })
        .toFile(path.join(STATIC, 'icon', `${v.id}.webp`));
    }
    const logoRaw = path.join(RAW, `logo-${v.id}-${opts.pick ?? 0}`);
    if (fs.existsSync(logoRaw) && !opts.skipLogo) {
      let img = sharp(logoRaw, { animated: false }).ensureAlpha();
      if (opts.erase) {
        const meta = await img.metadata();
        const mask = Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}">` +
            opts.erase.map((r) => `<rect x="${r.left}" y="${r.top}" width="${r.width}" height="${r.height}"/>`).join('') +
            '</svg>',
        );
        img = sharp(await img.composite([{ input: mask, blend: 'dest-out' }]).png().toBuffer());
      }
      if (opts.crop) img = img.extract(opts.crop);
      if (opts.flatten) img = img.flatten({ background: opts.flatten });
      img = sharp(await img.png().toBuffer()).trim({ threshold: opts.trim ?? 12 });
      img = sharp(await img.png().toBuffer());
      if (opts.darken !== false) img = sharp(await (await recolorIfLight(img)).toBuffer());
      const meta = await img.metadata();
      const area = 280 * 64;
      let scale = Math.sqrt(area / (meta.width * meta.height));
      scale = Math.min(scale, 280 / meta.width, 80 / meta.height);
      await img
        .resize(Math.max(1, Math.round(meta.width * scale)), Math.max(1, Math.round(meta.height * scale)))
        .webp({ quality: 90, alphaQuality: 100 })
        .toFile(path.join(STATIC, 'logo', `${v.id}.webp`));
    }
  }
  console.log('processed icons and logos');
}

async function brand() {
  const site = readJSON('data/site.json');
  const mark = fs.readFileSync(path.join(ROOT, 'src/img/brand.svg'), 'utf8');
  const markInner = mark.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const colors = readJSON('data/vendors.json').slice(0, 10).map((v) => v.color);
  const bars = colors
    .map((c, i) => {
      const h = 120 + ((i * 37) % 5) * 34 + (9 - i) * 8;
      return `<rect x="${760 + i * 40}" y="${520 - h}" width="28" height="${h}" rx="6" fill="${c}"/>`;
    })
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#f7f3ec"/>
  <rect y="0" width="1200" height="14" fill="#1b1a22"/>
  <g transform="translate(80 92) scale(2.2)">${markInner}</g>
  <text x="80" y="330" font-family="WenQuanYi Zen Hei, Inter, sans-serif" font-size="88" font-weight="700"
    fill="#1b1a22">${site.brand}</text>
  <text x="84" y="400" font-family="WenQuanYi Zen Hei, Inter, sans-serif" font-size="40" fill="#55515f">주간 웹하드 순위 TOP 10</text>
  <text x="84" y="520" font-family="Inter, sans-serif" font-size="26" font-weight="700" letter-spacing="6"
    fill="#b3361b">${site.brandEn} · WEEKLY CHART</text>
  ${bars}
  <rect x="740" y="520" width="420" height="4" fill="#1b1a22"/>
</svg>`;
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(path.join(STATIC, 'og.png'));
  const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
  <rect width="180" height="180" fill="#f7f3ec"/>
  <g transform="translate(26 26) scale(2)">${markInner}</g>
</svg>`;
  await sharp(Buffer.from(icon)).png({ compressionLevel: 9 }).toFile(path.join(STATIC, 'touch-icon.png'));
  console.log('drew og.png and touch-icon.png');
}

const mode = process.argv[2] ?? 'all';
if (mode === 'fetch' || mode === 'all') await fetchAll();
if (mode === 'process' || mode === 'all') await processAll();
if (mode === 'brand') await brand();
