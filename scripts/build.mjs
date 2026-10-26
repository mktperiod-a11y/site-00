#!/usr/bin/env node
// Static site build. Reads data/ and src/, writes _site/.
//   node scripts/build.mjs                       build with the address placeholder left in place
//   node scripts/build.mjs --base-url <url>      also swap the placeholder for the deployed address
//   node scripts/build.mjs --out <dir>           write somewhere other than _site/
//   node scripts/build.mjs --data <dir>          read data from another folder (used for edge-case renders)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ROOT, PLACEHOLDER, LINE_LIMIT, readJSON, colWidth, longLines, scanForBlocked, validateVendors,
  shownBenefits, josa, koreanDate, seededShuffle, METRIC_LABELS,
} from './lib/rules.mjs';

const argv = process.argv.slice(2);
const option = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const OUT = path.resolve(ROOT, option('--out') ?? '_site');
const BASE_URL = option('--base-url') ?? process.env.SITE_URL ?? '';
const DATA_DIR = path.relative(ROOT, path.resolve(ROOT, option('--data') ?? 'data'));
const readData = (name, fallback) => readJSON(path.join(DATA_DIR, name), fallback);
const METRIC_KEYS = ['search', 'usage', 'reaction'];

function fail(messages) {
  console.error(['build stopped:', ...[].concat(messages).map((m) => `  - ${m}`)].join('\n'));
  process.exit(1);
}

/* ---------- inputs ---------- */

const blocked = scanForBlocked(ROOT, new Set(['.git', 'node_modules', '.cache', '_site', path.basename(OUT)]));
if (blocked.length) fail(blocked);

const site = readData('site.json');
const vendors = readData('vendors.json');
const ranking = readData('ranking.json', null);
const history = readData('history.json', []);
const metrics = readData('metrics.json', { vendors: {} });
const faq = readData('faq.json');

const vendorProblems = validateVendors(vendors);
if (vendorProblems.length) fail(vendorProblems);
if (!ranking || ranking.items.length < site.publicCount) fail('data/ranking.json has fewer entries than the public count');
if (BASE_URL && metrics.sample) fail('sample metrics cannot be deployed');

const byId = new Map(vendors.map((v) => [v.id, v]));
const pub = ranking.items.slice(0, site.publicCount).map((it) => {
  const v = byId.get(it.id);
  if (!v || v.status !== 'active') fail(`ranked vendor ${it.id} is not an active vendor`);
  return { ...it, v };
});

const BRAND = site.brand;
const DATE = ranking.date;
const YM = `${ranking.year}.${String(ranking.month).padStart(2, '0')}`;
const YM_KO = `${ranking.year}년 ${ranking.month}월`;
const WEEK_KO = `${YM_KO} ${ranking.weekLabel.split(' ')[1]}`;
const USED = METRIC_KEYS.filter((k) => ranking.metricsUsed.includes(k));
const HAS_AFFILIATE = pub.some((it) => it.v.affiliateUrl);

/* ---------- small helpers ---------- */

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const indent = (text, n) =>
  text
    .split('\n')
    .map((l) => (l.trim() ? ' '.repeat(n) + l : ''))
    .join('\n');

const block = (lines) => lines.filter((l) => l !== null && l !== undefined && l !== false).join('\n');

function relPath(from, to) {
  const depth = from.split('/').filter(Boolean).length;
  const r = '../'.repeat(depth) + to;
  return r === '' ? './' : r;
}

const linker = (from) => (from === null ? (to) => PLACEHOLDER + to : (to) => relPath(from, to));
const abs = (to) => PLACEHOLDER + to;
const chars = (s) => [...s].length;

function listKo(words) {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')}, ${words.at(-1)}`;
}

function fitDescription(sentences) {
  let out = '';
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s;
    if (chars(next) > 150) continue;
    out = next;
  }
  return out;
}

function hexLum(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function onColor(hex) {
  const l = hexLum(hex);
  const vsWhite = 1.05 / (l + 0.05);
  const vsInk = (l + 0.05) / (hexLum('#1b1a22') + 0.05);
  return vsWhite >= vsInk ? '#ffffff' : '#1b1a22';
}

function webpSize(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const kind = buf.toString('ascii', 12, 16);
  if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
  if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function stripJsComments(js) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < js.length) {
    const c = js[i];
    const n = js[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += n;
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i++;
    } else if (c === '/' && n === '*') {
      i = js.indexOf('*/', i + 2) + 2;
    } else if (c === '/' && n === '/') {
      while (i < js.length && js[i] !== '\n') i++;
    } else {
      out += c;
      i++;
    }
  }
  return out.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

const hash = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 10);

/* ---------- long line folding (HTML only, never inside script/style) ---------- */

const BREAKABLE_ATTRS = new Set(['content', 'alt', 'class', 'aria-label', 'title', 'points', 'd']);

function breakPoints(line) {
  const points = [];
  let state = 'text';
  let quote = '';
  let attr = '';
  let name = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (state === 'text') {
      if (c === '<') state = 'tag';
      else if (c === ' ') points.push(i);
    } else if (state === 'tag') {
      if (c === '>') state = 'text';
      else if (c === '"' || c === "'") {
        quote = c;
        attr = name;
        state = 'value';
      } else if (c === ' ') {
        points.push(i);
        name = '';
      } else if (c === '=') {
        // attribute name complete
      } else name += c;
    } else if (state === 'value') {
      if (c === quote) {
        state = 'tag';
        name = '';
      } else if (c === ' ' && BREAKABLE_ATTRS.has(attr)) points.push(i);
    }
  }
  return points;
}

function foldLine(line) {
  const out = [];
  let rest = line;
  const lead = line.match(/^ */)[0];
  const cont = lead + '  ';
  while (colWidth(rest) > LINE_LIMIT) {
    const pts = breakPoints(rest).filter((p) => p > rest.match(/^ */)[0].length);
    let cut = -1;
    for (const p of pts) if (colWidth(rest.slice(0, p)) <= LINE_LIMIT) cut = p;
    if (cut < 0) break;
    out.push(rest.slice(0, cut).trimEnd());
    rest = cont + rest.slice(cut + 1).trimStart();
  }
  out.push(rest);
  return out;
}

function foldHtml(html) {
  const lines = html.split('\n');
  const out = [];
  let raw = false;
  for (const line of lines) {
    const opens = /<(script|style|pre|textarea)\b/i.test(line);
    const closes = /<\/(script|style|pre|textarea)>/i.test(line);
    if (raw) {
      out.push(line);
      if (closes) raw = false;
      continue;
    }
    if (opens) {
      out.push(line);
      if (!closes) raw = true;
      continue;
    }
    out.push(...foldLine(line));
  }
  return out.join('\n');
}

/* ---------- shared page chrome ---------- */

function cspContent(extraScript = []) {
  const scriptSrc = ["'self'", ...extraScript].join(' ');
  return [
    "default-src 'none'",
    `script-src ${scriptSrc}`,
    "style-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');
}

function head(p) {
  const u = p.u;
  const robots = p.robots ?? 'index,follow,max-image-preview:large';
  const lines = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${cspContent(p.scriptHashes)}">`,
    `<meta name="referrer" content="${p.referrer ?? 'strict-origin-when-cross-origin'}">`,
    `<title>${esc(p.title)}</title>`,
    p.description ? `<meta name="description" content="${esc(p.description)}">` : null,
    `<meta name="robots" content="${robots}">`,
    p.canonical !== undefined ? `<link rel="canonical" href="${abs(p.canonical)}">` : null,
    p.naver ? `<meta name="naver-site-verification" content="${esc(p.naver)}">` : null,
    p.canonical !== undefined ? '<meta property="og:type" content="website">' : null,
    p.canonical !== undefined ? `<meta property="og:site_name" content="${esc(BRAND)}">` : null,
    p.canonical !== undefined ? '<meta property="og:locale" content="ko_KR">' : null,
    p.canonical !== undefined ? `<meta property="og:title" content="${esc(p.title)}">` : null,
    p.canonical !== undefined ? `<meta property="og:description" content="${esc(p.description)}">` : null,
    p.canonical !== undefined ? `<meta property="og:url" content="${abs(p.canonical)}">` : null,
    p.canonical !== undefined ? `<meta property="og:image" content="${abs('assets/og.png')}">` : null,
    p.canonical !== undefined ? '<meta property="og:image:width" content="1200">' : null,
    p.canonical !== undefined ? '<meta property="og:image:height" content="630">' : null,
    p.canonical !== undefined ? '<meta name="twitter:card" content="summary_large_image">' : null,
    `<link rel="icon" href="${u('favicon.svg')}" type="image/svg+xml">`,
    `<link rel="apple-touch-icon" href="${u('assets/touch-icon.png')}">`,
    `<link rel="stylesheet" href="${u(`assets/site.css?v=${ASSET_V.css}`)}">`,
    `<noscript><link rel="stylesheet" href="${u(`assets/nojs.css?v=${ASSET_V.nojs}`)}"></noscript>`,
    p.textOnly ? null : `<script src="${u(`assets/site.js?v=${ASSET_V.js}`)}" defer></script>`,
    p.jsonld ? '<script type="application/ld+json">' : null,
    p.jsonld ? JSON.stringify(p.jsonld, null, 2) : null,
    p.jsonld ? '</script>' : null,
  ];
  return indent(block(lines), 4);
}

function header(u, current, textOnly) {
  const cur = (key) => (current === key ? ' aria-current="page"' : '');
  return block([
    '<a class="skip" href="#main">본문으로 건너뛰기</a>',
    '<header class="masthead">',
    '  <div class="wrap masthead-in">',
    `    <a class="brand" href="${u('')}">`,
    textOnly ? null : `      <img src="${u('assets/brand.svg')}" width="32" height="32" alt="">`,
    `      <span>${esc(BRAND)}</span>`,
    '    </a>',
    textOnly
      ? null
      : block([
          '    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="site-nav">',
          '      <svg class="menu-bars" viewBox="0 0 16 12" aria-hidden="true" focusable="false">',
          '        <path d="M0 1h16M0 6h16M0 11h16" stroke="currentColor" stroke-width="2"/>',
          '      </svg>',
          '      <span class="menu-label">메뉴</span>',
          '    </button>',
        ]),
    '    <nav class="nav" id="site-nav" aria-label="주요 메뉴">',
    '      <ul>',
    `        <li><a href="${u('')}"${cur('home')}>순위</a></li>`,
    `        <li><a href="${u('criteria/')}"${cur('criteria')}>기준</a></li>`,
    `        <li><a href="${u('')}#faq">FAQ</a></li>`,
    '      </ul>',
    '    </nav>',
    '  </div>',
    '</header>',
  ]);
}

function footer(u) {
  return block([
    '<footer class="foot">',
    '  <div class="wrap">',
    `    <p class="foot-brand">${esc(BRAND)}</p>`,
    '    <p>순위·혜택은 참고용이에요. 이용 문의는 각 서비스 고객센터로 해 주세요.</p>',
    '    <nav aria-label="바닥글 메뉴">',
    '      <ul>',
    `        <li><a href="${u('')}">순위</a></li>`,
    `        <li><a href="${u('criteria/')}">기준</a></li>`,
    `        <li><a href="${u('')}#faq">FAQ</a></li>`,
    '      </ul>',
    '    </nav>',
    '  </div>',
    '</footer>',
  ]);
}

function documentHtml(p) {
  return block([
    '<!doctype html>',
    '<html lang="ko">',
    '  <head>',
    head(p),
    '  </head>',
    `  <body${p.bodyClass ? ` class="${p.bodyClass}"` : ''}>`,
    indent(header(p.u, p.current, p.textOnly), 4),
    indent(p.main, 4),
    indent(footer(p.u), 4),
    p.tail ?? null,
    '  </body>',
    '</html>',
  ]) + '\n';
}

/* ---------- ranking widgets ---------- */

function moveBadge(change) {
  if (change === null || change === undefined) {
    return '<span class="move move-same"><span aria-hidden="true">–</span><span class="sr">첫 집계</span></span>';
  }
  if (change === 'new') return '<span class="move move-new">NEW<span class="sr"> 새로 진입</span></span>';
  if (change > 0) {
    return `<span class="move move-up"><span aria-hidden="true">▲${change}</span><span class="sr">${change}계단 오름</span></span>`;
  }
  if (change < 0) {
    const n = -change;
    return `<span class="move move-down"><span aria-hidden="true">▼${n}</span><span class="sr">${n}계단 내림</span></span>`;
  }
  return '<span class="move move-same"><span aria-hidden="true">–</span><span class="sr">변동 없음</span></span>';
}

function starsTag(stars, showNumber = true) {
  const n = Math.round(stars * 10);
  return block([
    `<span class="stars st-${n}" aria-hidden="true"><span class="stars-fill"></span></span>`,
    showNumber
      ? `<span class="stars-num"><span class="sr">별점 5점 만점에 </span>${stars.toFixed(1)}</span>`
      : `<span class="sr">별점 5점 만점에 ${stars.toFixed(1)}</span>`,
  ]);
}

function iconTag(v, u, eager, cls) {
  const file = path.join(ROOT, 'src/static/icon', `${v.id}.webp`);
  if (fs.existsSync(file)) {
    const loading = eager ? '' : ' loading="lazy"';
    return `<img class="${cls}" src="${u(`assets/icon/${v.id}.webp`)}" width="48" height="48" alt=""${loading} decoding="async">`;
  }
  return `<span class="${cls} mono" aria-hidden="true">${esc([...v.name][0])}</span>`;
}

function logoTag(v, u) {
  const file = path.join(ROOT, 'src/static/logo', `${v.id}.webp`);
  if (!fs.existsSync(file)) return null;
  const size = webpSize(file) ?? { w: 280, h: 80 };
  const scale = Math.min(140 / size.w, 40 / size.h);
  const w = Math.round(size.w * scale);
  const h = Math.round(size.h * scale);
  return `<img src="${u(`assets/logo/${v.id}.webp`)}" width="${w}" height="${h}" alt="${esc(v.name)} 로고">`;
}

function scorebar(parts, { solo = false, height = 6 } = {}) {
  let x = 0;
  const rects = [];
  METRIC_KEYS.forEach((k, i) => {
    const p = parts[k];
    if (p === null || p === undefined || p <= 0) return;
    const cls = solo ? 'seg-1' : `seg-${i + 1}`;
    rects.push(`<rect class="${cls}" x="${x.toFixed(1)}" width="${p.toFixed(1)}" height="${height}"/>`);
    x += p;
  });
  return block([
    `<svg class="scorebar" viewBox="0 0 100 ${height}" preserveAspectRatio="none" aria-hidden="true" focusable="false">`,
    ...rects.map((r) => `  ${r}`),
    '</svg>',
  ]);
}

const peekText = (parts) =>
  METRIC_KEYS.filter((k) => parts[k] !== null)
    .map((k) => `${METRIC_LABELS[k]} ${parts[k].toFixed(1)}`)
    .join(' · ');

function perksList(v, full = false) {
  const list = shownBenefits(v);
  const items = [];
  const join = list.filter((b) => b.kind === 'join');
  const event = list.filter((b) => b.kind === 'event');
  for (const b of join) items.push(`<li class="perk perk-join"><span class="sr">가입 혜택 </span>${esc(b.text)}</li>`);
  if (full && !join.length) {
    items.push('<li class="perk perk-join"><span class="perk-tag">가입 혜택</span>공식 사이트에서 확인하세요.</li>');
  }
  for (const b of event) items.push(`<li class="perk perk-event"><span class="perk-tag">이벤트</span>${esc(b.text)}</li>`);
  if (full && !event.length) {
    items.push('<li class="perk perk-event"><span class="perk-tag">이벤트</span>공식 사이트에서 확인하세요.</li>');
  }
  if (!items.length) return '<p class="perks perk-none">공식 사이트에서 확인하세요.</p>';
  return block([`<ul class="perks" aria-label="${esc(v.name)} 혜택">`, ...items.map((i) => `  ${i}`), '</ul>']);
}

function goButton(v, u) {
  const rel = v.affiliateUrl ? 'sponsored nofollow' : 'nofollow';
  return block([
    `<a class="go-btn" href="${u(`go/${v.id}/`)}" rel="${rel}">`,
    `  <span class="sr">${esc(v.name)} 사이트 </span>바로가기`,
    '  <svg class="go-arrow" viewBox="0 0 12 12" aria-hidden="true" focusable="false">',
    '    <path d="M3 9l6-6M4 3h5v5" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    '  </svg>',
    '</a>',
  ]);
}

function entry(it, u, { eager = false, level = 'h3' } = {}) {
  const v = it.v;
  return block([
    `<li class="entry vc-${v.id}${it.rank <= 3 ? ' is-podium' : ''}${chars(v.name) > 6 ? ' has-long-name' : ''}" id="rank-${v.id}">`,
    '  <div class="entry-rank">',
    `    <span class="entry-no">${it.rank}<span class="sr">위</span></span>`,
    `    ${moveBadge(it.change)}`,
    '  </div>',
    `  ${iconTag(v, u, eager, 'entry-icon')}`,
    '  <div class="entry-main">',
    `    <${level} class="entry-name${chars(v.name) > 8 ? ' is-longer' : chars(v.name) > 6 ? ' is-long' : ''}"><a href="${u(`webhard/${v.id}/`)}">${esc(v.name)}</a></${level}>`,
    '    <p class="entry-score">',
    indent(starsTag(it.stars, it.rank <= 3), 6),
    `      <span class="total"><span class="sr">총점 </span>${it.total.toFixed(1)}</span>`,
    '    </p>',
    '  </div>',
    indent(perksList(v), 2),
    '  <div class="entry-bar">',
    indent(scorebar(it.parts), 4),
    `    <p class="peek">${peekText(it.parts)}</p>`,
    '  </div>',
    indent(goButton(v, u), 2),
    '</li>',
  ]);
}

/* ---------- text generated from the week's data ---------- */

function digest() {
  const [a, b, c] = pub;
  const hasPrev = pub.some((it) => it.change !== null);
  const risers = pub.filter((it) => typeof it.change === 'number' && it.change > 0).sort((x, y) => y.change - x.change);
  const fresh = pub.filter((it) => it.change === 'new');
  const top = risers[0];
  const summary = [`이번 주 1위는 <strong>${esc(josa(a.v.name, '이에요/예요'))}</strong>.`];
  summary.push(`2위 ${esc(b.v.name)}, 3위 ${esc(josa(c.v.name, '이/가'))} 뒤를 이었어요.`);
  return {
    summary,
    stats: [
      ['최대 상승', top ? `${top.v.name} ▲${top.change}` : '–'],
      ['새로 진입', hasPrev ? `${fresh.length}곳` : '–'],
    ],
  };
}

const SOURCES = { search: '네이버 데이터랩', usage: '구글 플레이', reaction: '구글 플레이' };

function sourceLine() {
  const names = [...new Set(USED.map((k) => SOURCES[k]))];
  return `출처 ${names.join(' · ')} · 기준일 ${koreanDate(DATE)}`;
}

function metricLine(k) {
  return {
    search: '네이버 데이터랩',
    usage: '구글 플레이 다운로드',
    reaction: '구글 플레이 평점',
  }[k];
}

function usedLabels() {
  return listKo(USED.map((k) => METRIC_LABELS[k]));
}

function fillFaq(text) {
  return text
    .replace(/\{metrics:([^}]+)\}/g, (_, pair) => josa(usedLabels(), pair))
    .replace(/\{candidates\}/g, String(ranking.candidates))
    .replace(/\{public\}/g, String(site.publicCount));
}

function faqBlock(items, id, title, cls = 'block') {
  return block([
    `<section class="${cls}" id="${id}" aria-labelledby="${id}-title">`,
    '  <div class="section-head">',
    `    <h2 id="${id}-title">${title}</h2>`,
    '  </div>',
    '  <div class="faq">',
    ...items.map((f) =>
      block([
        '    <details>',
        `      <summary>${esc(f.q)}</summary>`,
        `      <p>${esc(f.a)}</p>`,
        '    </details>',
      ]),
    ),
    '  </div>',
    '</section>',
  ]);
}

const faqJson = (items, id) => ({
  '@type': 'FAQPage',
  '@id': abs(id),
  mainEntity: items.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
});

function methodSteps() {
  return block([
    '<ol class="steps">',
    ...METRIC_KEYS.map((k, i) => {
      const on = USED.includes(k);
      return block([
        '  <li>',
        `    <span class="step-no" aria-hidden="true">0${i + 1}</span>`,
        `    <span class="step-name">${METRIC_LABELS[k]}</span>`,
        `    <span class="step-src">${metricLine(k)}</span>`,
        `    <span class="flag${on ? ' flag-on' : ''}">${on ? '반영' : '이번 주 값 없음'}</span>`,
        '  </li>',
      ]);
    }),
    '</ol>',
  ]);
}

const CAVEAT = '공개 지표에 운영 기준을 더한 참고 순위예요. 선택은 직접 비교해 판단하세요.';
const AFFILIATE_NOTE = '일부 바로가기는 제휴 링크예요. 링크를 거쳐도 이용 금액은 같아요.';

/* ---------- pages ---------- */

const pages = [];

function pageIndex() {
  const u = linker('');
  const homeFaq = faq.home.map((f) => ({ q: f.q, a: fillFaq(f.a) }));
  const d = digest();
  const title = `웹하드 순위 ${WEEK_KO} · 웹하드 추천 TOP ${site.publicCount} | ${BRAND}`;
  const description = fitDescription([
    `${WEEK_KO} 웹하드 순위예요.`,
    `1위 ${pub[0].v.name}, 2위 ${pub[1].v.name}, 3위 ${pub[2].v.name}까지 상위 ${site.publicCount}곳의 가입 혜택과 이벤트를 한 번에 비교해 보세요.`,
    '매주 월요일 공개 지표로 다시 정리해요.',
  ]);
  const jsonld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': abs('#website'), name: BRAND, url: abs(''), inLanguage: 'ko-KR' },
      {
        '@type': 'CollectionPage',
        '@id': abs('#page'),
        url: abs(''),
        name: title,
        inLanguage: 'ko-KR',
        isPartOf: { '@id': abs('#website') },
        dateModified: DATE,
        mainEntity: { '@id': abs('#ranking') },
      },
      {
        '@type': 'ItemList',
        '@id': abs('#ranking'),
        name: `${WEEK_KO} 웹하드 순위`,
        numberOfItems: pub.length,
        itemListOrder: 'https://schema.org/ItemListOrderAscending',
        itemListElement: pub.map((it) => ({
          '@type': 'ListItem',
          position: it.rank,
          name: it.v.name,
          url: abs(`webhard/${it.v.id}/`),
        })),
      },
      faqJson(homeFaq, '#faq'),
    ],
  };
  const main = block([
    '<main id="main" class="wrap home">',
    '  <section class="hero" aria-labelledby="page-title">',
    `    <h1 id="page-title"><span class="h1-when">${YM_KO}</span> 웹하드 순위</h1>`,
    `    <p class="stamp"><time datetime="${DATE}">${koreanDate(DATE)}</time> 갱신 · 후보 ${ranking.candidates}곳</p>`,
    `    <p class="caveat">${CAVEAT}</p>`,
    '  </section>',
    '  <section class="ranking" aria-labelledby="chart-title">',
    '    <div class="board-head">',
    `      <h2 id="chart-title">이번 주 TOP ${site.publicCount}</h2>`,
    '      <dl class="ticker">',
    ...d.stats.map(([k, v]) => `        <div><dt>${k}</dt><dd>${esc(v)}</dd></div>`),
    '      </dl>',
    '    </div>',
    '    <ol class="chart podium">',
    ...pub.slice(0, 3).map((it) => indent(entry(it, u, { eager: true }), 6)),
    '    </ol>',
    '    <ol class="chart rest" start="4">',
    ...pub.slice(3).map((it) => indent(entry(it, u), 6)),
    '    </ol>',
    `    <p class="source">${sourceLine()}</p>`,
    `    <p class="summary">${d.summary.join(' ')}</p>`,
    HAS_AFFILIATE ? `    <p class="notice">${AFFILIATE_NOTE}</p>` : null,
    '  </section>',
    '  <section class="block how" aria-labelledby="how-title">',
    '    <div class="section-head">',
    '      <h2 id="how-title">순위는 이렇게 정해요</h2>',
    `      <a class="more" href="${u('criteria/')}">순위 기준</a>`,
    '    </div>',
    indent(methodSteps(), 4),
    '  </section>',
    indent(faqBlock(homeFaq, 'faq', '자주 묻는 질문', 'block qa'), 2),
    '</main>',
  ]);
  pages.push({
    file: 'index.html',
    html: documentHtml({
      u, current: 'home', title, description, canonical: '', jsonld, main,
      naver: site.naverSiteVerification || null,
    }),
    indexable: true,
  });
}

function weekRows(v) {
  return history.slice(-8).map((h) => {
    const pos = h.order.indexOf(v.id) + 1;
    const shown = pos > 0 && pos <= site.publicCount;
    return {
      date: h.date,
      rank: shown ? pos : null,
      total: shown ? h.totals[v.id] : null,
    };
  });
}

function trendSvg(rows) {
  const W = 320;
  const H = 120;
  const padX = 22;
  const top = 14;
  const bottom = 96;
  const n = rows.length;
  const x = (i) => (n === 1 ? W / 2 : padX + ((W - padX * 2) * i) / (n - 1));
  const y = (r) => top + ((bottom - top) * (r - 1)) / (site.publicCount - 1);
  const segs = [];
  let cur = [];
  rows.forEach((r, i) => {
    if (r.rank) cur.push(`${x(i).toFixed(1)},${y(r.rank).toFixed(1)}`);
    else if (cur.length) {
      segs.push(cur);
      cur = [];
    }
  });
  if (cur.length) segs.push(cur);
  const lines = [
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="trend-title">`,
    '  <title id="trend-title">최근 주차별 순위 변화</title>',
    `  <line class="grid-line" x1="0" y1="${y(1)}" x2="${W}" y2="${y(1)}"/>`,
    `  <line class="grid-line" x1="0" y1="${y(site.publicCount)}" x2="${W}" y2="${y(site.publicCount)}"/>`,
    `  <text class="axis" x="0" y="${y(1) - 4}">1위</text>`,
    `  <text class="axis" x="0" y="${y(site.publicCount) - 4}">${site.publicCount}위</text>`,
    ...segs.filter((s) => s.length > 1).map((s) => `  <polyline class="line" points="${s.join(' ')}"/>`),
    ...rows.flatMap((r, i) =>
      r.rank ? [`  <circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(r.rank).toFixed(1)}" r="4"/>`] : [],
    ),
    ...rows.flatMap((r, i) => {
      if (n > 5 && (n - 1 - i) % 2 === 1) return [];
      const [, m, dd] = r.date.split('-').map(Number);
      return [`  <text class="axis" x="${x(i).toFixed(1)}" y="${H - 4}" text-anchor="middle">${m}/${dd}</text>`];
    }),
    '</svg>',
  ];
  return block(lines);
}

function playFacts(v) {
  const p = metrics.vendors?.[v.id]?.play;
  if (!p) return {};
  const fmt = (n) => {
    if (n >= 1e8) return `${Math.floor(n / 1e7) / 10}억`;
    if (n >= 1e4) return `${Math.floor(n / 1e3) / 10}만`;
    return n.toLocaleString('ko-KR');
  };
  return {
    usage: p.minInstalls || p.installs ? `다운로드 ${fmt(p.minInstalls || p.installs)}+ · 구글 플레이` : null,
    reaction: p.rating && p.ratings ? `평점 ${p.rating.toFixed(1)} · 평가 ${fmt(p.ratings)} · 구글 플레이` : null,
  };
}

function partText(k, it, facts) {
  if (it.parts[k] === null) return k !== 'search' && !it.v.playId ? '앱 없음 · 계산에서 뺌' : '이번 주 값 없음 · 계산에서 뺌';
  if (k === 'search') return '최근 4주 검색량 · 네이버 데이터랩';
  return facts[k] ?? metricLine(k);
}

function pageVendor(it) {
  const v = it.v;
  const from = `webhard/${v.id}/`;
  const u = linker(from);
  const facts = playFacts(v);
  const benefits = shownBenefits(v);
  const benefitText = benefits.length ? benefits.map((b) => b.text).join(', ') : null;
  const title = `${v.name} 순위·가입 혜택·이벤트 (${YM}) | ${BRAND}`;
  const description = fitDescription([
    `${josa(v.name, '은/는')} ${WEEK_KO} 웹하드 순위 ${it.rank}위예요.`,
    benefitText
      ? `${benefitText} 같은 가입 혜택과 이벤트를 정리했어요.`
      : '가입 혜택과 이벤트는 공식 사이트 안내를 확인하세요.',
    `${usedLabels()} 기준 점수 구성과 최근 순위 변동도 함께 볼 수 있어요.`,
    `총점은 ${it.total.toFixed(1)}점이에요.`,
  ]);
  const others = seededShuffle(
    pub.filter((o) => o.id !== v.id),
    `${ranking.week}:${v.id}`,
  )
    .slice(0, 5)
    .sort((a, b) => a.rank - b.rank);
  const rows = weekRows(v);
  const logo = logoTag(v, u);
  const iconFile = fs.existsSync(path.join(ROOT, 'src/static/icon', `${v.id}.webp`));
  const markLines = [
    logo ? `<span class="logo-box">${logo}</span>` : null,
    iconFile
      ? `<img class="profile-icon" src="${u(`assets/icon/${v.id}.webp`)}" width="52" height="52" alt="${esc(v.name)} 앱 아이콘">`
      : null,
    !logo && !iconFile ? `<span class="profile-icon mono" aria-hidden="true">${esc([...v.name][0])}</span>` : null,
  ];
  const jsonld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': abs(`${from}#page`),
        url: abs(from),
        name: title,
        inLanguage: 'ko-KR',
        dateModified: DATE,
        isPartOf: { '@id': abs('#website') },
        breadcrumb: { '@id': abs(`${from}#crumbs`) },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': abs(`${from}#crumbs`),
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '웹하드 순위', item: abs('') },
          { '@type': 'ListItem', position: 2, name: v.name, item: abs(from) },
        ],
      },
    ],
  };
  const main = block([
    '<main id="main" class="wrap">',
    '  <nav class="crumbs" aria-label="현재 위치">',
    '    <ol>',
    `      <li><a href="${u('')}">웹하드 순위</a></li>`,
    `      <li aria-current="page">${esc(v.name)}</li>`,
    '    </ol>',
    '  </nav>',
    `  <section class="profile vc-${v.id}" aria-labelledby="page-title">`,
    '    <div class="profile-mark">',
    ...markLines.filter(Boolean).map((l) => `      ${l}`),
    '    </div>',
    '    <div class="profile-head">',
    `      <h1 id="page-title">${esc(v.name)} <span class="nowrap">순위·가입</span> <span class="nowrap">혜택·이벤트</span></h1>`,
    '      <p class="profile-rank">',
    `        <span>${WEEK_KO} ${it.rank}위</span>`,
    `        ${moveBadge(it.change)}`,
    '        <span class="score-group">',
    indent(starsTag(it.stars), 10),
    `          <span class="total"><span class="sr">총점 </span>${it.total.toFixed(1)}점</span>`,
    '        </span>',
    '      </p>',
    '    </div>',
    indent(goButton(v, u), 4),
    indent(perksList(v, true), 4),
    '  </section>',
    `  <div class="split vc-${v.id}">`,
    '    <section class="block" aria-labelledby="parts-title">',
    '      <div class="section-head">',
    '        <h2 id="parts-title">이번 주 지표 구성</h2>',
    `        <p>${sourceLine().replace('출처 ', '')}</p>`,
    '      </div>',
    '      <ul class="parts">',
    ...METRIC_KEYS.map((k) =>
      block([
        '        <li class="part">',
        `          <h3>${METRIC_LABELS[k]}</h3>`,
        `          <span class="part-value">${it.parts[k] === null ? '–' : `${it.parts[k].toFixed(1)}점`}</span>`,
        it.parts[k] === null ? null : indent(scorebar({ [k]: it.parts[k] }, { solo: true }), 10),
        `          <p>${esc(partText(k, it, facts))}</p>`,
        '        </li>',
      ]),
    ),
    '      </ul>',
    `      <p class="part-sum"><span>총점</span><span>${it.total.toFixed(1)}점</span></p>`,
    '    </section>',
    '    <section class="block" aria-labelledby="trend-head">',
    '      <div class="section-head">',
    '        <h2 id="trend-head">순위 변동</h2>',
    `        <p>최근 ${rows.length}주</p>`,
    '      </div>',
    '      <figure class="trend">',
    indent(trendSvg(rows), 8),
    '      </figure>',
    rows.length < 2 ? '      <p class="caveat">다음 주부터 변동이 이어져요.</p>' : null,
    '      <table class="table">',
    '        <caption class="sr">주차별 순위와 총점</caption>',
    '        <thead>',
    '          <tr><th scope="col">갱신일</th><th scope="col">순위</th><th scope="col">총점</th></tr>',
    '        </thead>',
    '        <tbody>',
    ...rows
      .slice(-4)
      .reverse()
      .map(
        (r) =>
          `          <tr><td>${koreanDate(r.date)}</td><td>${r.rank ? `${r.rank}위` : `${site.publicCount}위 밖`}</td>` +
          `<td>${r.total !== null && r.total !== undefined ? r.total.toFixed(1) : '–'}</td></tr>`,
      ),
    '        </tbody>',
    '      </table>',
    '    </section>',
    '  </div>',
    '  <section class="block" aria-labelledby="others-title">',
    '    <div class="section-head">',
    '      <h2 id="others-title">다른 웹하드 5곳</h2>',
    '    </div>',
    '    <ol class="chart rest">',
    ...others.map((o) => indent(entry(o, u), 6)),
    '    </ol>',
    '  </section>',
    `  <p class="notice">${CAVEAT} <a href="${u('criteria/')}">순위 기준</a>` +
      `${v.affiliateUrl ? ` ${AFFILIATE_NOTE}` : ''}</p>`,
    '</main>',
  ]);
  pages.push({
    file: `${from}index.html`,
    html: documentHtml({ u, title, description, canonical: from, jsonld, main }),
    indexable: true,
  });
}

function pageCriteria() {
  const from = 'criteria/';
  const u = linker(from);
  const items = faq.criteria.map((f) => ({ q: f.q, a: fillFaq(f.a) }));
  const title = `웹하드 순위 기준과 자주 묻는 질문 (${YM}) | ${BRAND}`;
  const description = fitDescription([
    `${josa(BRAND, '이/가')} 웹하드 순위를 정하는 기준을 정리했어요.`,
    '어떤 공개 지표를 보는지, 순위가 언제 바뀌는지, 별점이 무엇을 뜻하는지 자주 묻는 질문과 함께 알려 드려요.',
  ]);
  const jsonld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': abs(`${from}#page`),
        url: abs(from),
        name: title,
        inLanguage: 'ko-KR',
        dateModified: DATE,
        isPartOf: { '@id': abs('#website') },
        breadcrumb: { '@id': abs(`${from}#crumbs`) },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': abs(`${from}#crumbs`),
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '웹하드 순위', item: abs('') },
          { '@type': 'ListItem', position: 2, name: '순위 기준', item: abs(from) },
        ],
      },
      faqJson(items, `${from}#faq`),
    ],
  };
  const main = block([
    '<main id="main" class="wrap">',
    '  <nav class="crumbs" aria-label="현재 위치">',
    '    <ol>',
    `      <li><a href="${u('')}">웹하드 순위</a></li>`,
    '      <li aria-current="page">순위 기준</li>',
    '    </ol>',
    '  </nav>',
    '  <section class="hero" aria-labelledby="page-title">',
    `    <p class="kicker"><span class="issue">${ranking.weekLabel} 기준</span></p>`,
    '    <h1 id="page-title">웹하드 순위 기준과 자주 묻는 질문</h1>',
    `    <p class="stamp"><time datetime="${DATE}">${koreanDate(DATE)}</time> 갱신</p>`,
    `    <p class="caveat">${CAVEAT}</p>`,
    '  </section>',
    '  <section class="block" aria-labelledby="what-title">',
    '    <div class="section-head">',
    '      <h2 id="what-title">무엇을 보나요</h2>',
    `      <p>${sourceLine()}</p>`,
    '    </div>',
    indent(methodSteps(), 4),
    '  </section>',
    '  <section class="block" aria-labelledby="calc-title">',
    '    <div class="section-head">',
    '      <h2 id="calc-title">어떻게 줄 세우나요</h2>',
    '    </div>',
    '    <ul class="dots">',
    '      <li>항목 값을 같은 범위로 맞춰 더한 100점 만점 총점</li>',
    `      <li>후보 ${ranking.candidates}곳 전체를 매주 다시 줄 세워 상위 ${site.publicCount}곳 공개</li>`,
    '      <li>일부 서비스는 운영 기준에 따라 순위가 조정될 수 있어요</li>',
    '      <li>별점은 총점을 5점 만점으로 바꾼 값(이용자 평점 아님)</li>',
    HAS_AFFILIATE ? `      <li>${AFFILIATE_NOTE}</li>` : null,
    '    </ul>',
    '  </section>',
    '  <section class="block" aria-labelledby="when-title">',
    '    <div class="section-head">',
    '      <h2 id="when-title">언제 바뀌나요</h2>',
    '    </div>',
    '    <ul class="dots">',
    '      <li>매주 월요일 아침 갱신</li>',
    '      <li>값을 못 받은 항목은 직전 값 사용</li>',
    '      <li>혜택·이벤트는 공식 사이트 안내가 우선</li>',
    '    </ul>',
    '  </section>',
    indent(faqBlock(items, 'faq', '기준에 관한 질문'), 2),
    '</main>',
  ]);
  pages.push({
    file: `${from}index.html`,
    html: documentHtml({ u, current: 'criteria', title, description, canonical: from, jsonld, main }),
    indexable: true,
  });
}

function pageGo(it) {
  const v = it.v;
  const from = `go/${v.id}/`;
  const u = linker(from);
  const target = v.affiliateUrl || v.url;
  const encoded = Buffer.from(target, 'utf8').toString('base64').split('').reverse().join('');
  const pieces = encoded.match(/.{1,96}/g).map((c) => `"${c}"`).join(' +\n        ');
  const script = [
    '',
    '      (function () {',
    `        var s = ${pieces};`,
    '        location.replace(atob(s.split("").reverse().join("")));',
    '      })();',
    '    ',
  ].join('\n');
  const digestB64 = crypto.createHash('sha256').update(script).digest('base64');
  const main = block([
    '<main id="main" class="wrap plain">',
    `  <h1>${esc(v.name)} 공식 사이트로 이동하고 있어요</h1>`,
    '  <p>화면이 그대로라면 브라우저에서 자바스크립트를 켠 뒤 다시 눌러 주세요.</p>',
    '  <ul>',
    `    <li><a href="${u('')}">이번 주 웹하드 순위로 돌아가기</a></li>`,
    '  </ul>',
    '</main>',
  ]);
  pages.push({
    file: `${from}index.html`,
    html: documentHtml({
      u,
      title: `${josa(v.name, '으로/로')} 이동하는 중 | ${BRAND}`,
      robots: 'noindex,nofollow',
      referrer: 'no-referrer',
      scriptHashes: [`'sha256-${digestB64}'`],
      main,
      tail: `    <script>${script}</script>`,
    }),
    indexable: false,
  });
}

function page404() {
  const u = linker(null);
  const main = block([
    '<main id="main" class="wrap plain">',
    '  <h1>찾는 페이지가 없어요</h1>',
    '  <p>주소가 바뀌었거나 이번 주 순위표에서 빠진 페이지일 수 있어요.</p>',
    '  <ul>',
    `    <li><a href="${u('')}">이번 주 웹하드 순위 보기</a></li>`,
    `    <li><a href="${u('criteria/')}">순위 기준 보기</a></li>`,
    '  </ul>',
    '</main>',
  ]);
  pages.push({
    file: '404.html',
    html: documentHtml({ u, title: `페이지를 찾을 수 없어요 | ${BRAND}`, robots: 'noindex', textOnly: true, main }),
    indexable: false,
  });
}

/* ---------- assets and text files ---------- */

const ASSET_V = {};
const assetFiles = new Map();

function prepareAssets() {
  const vendorCss = vendors
    .map((v) => `.vc-${v.id} {\n  --vc: ${v.color};\n  --vc-on: ${onColor(v.color)};\n}`)
    .join('\n\n');
  const starCss = [];
  for (let n = Math.floor(site.starFloor * 10); n <= 50; n++) {
    starCss.push(`.st-${n} .stars-fill {\n  width: ${n * 2}%;\n}`);
  }
  const homeCss = [
    '@media (min-width: 1024px) {',
    '  .home {',
    '    grid-template-columns: minmax(0, 1fr) 380px;',
    '    grid-template-areas:',
    '      "hero digest"',
    '      "ranking ranking"',
    '      "how how"',
    '      "qa qa";',
    '    column-gap: var(--sp-6);',
    '  }',
    '',
    '  .home .hero {',
    '    grid-area: hero;',
    '    padding-top: var(--sp-5);',
    '  }',
    '',
    '  .home .digest {',
    '    grid-area: digest;',
    '    align-self: end;',
    '  }',
    '',
    '  .home .ranking {',
    '    grid-area: ranking;',
    '  }',
    '',
    '  .home .how {',
    '    grid-area: how;',
    '  }',
    '',
    '  .home .qa {',
    '    grid-area: qa;',
    '  }',
    '}',
  ].join('\n');
  const css = [
    stripCssComments(fs.readFileSync(path.join(ROOT, 'src/css/site.css'), 'utf8')).trimEnd(),
    homeCss,
    vendorCss,
    starCss.join('\n\n'),
  ].join('\n\n') + '\n';
  const nojs = stripCssComments(fs.readFileSync(path.join(ROOT, 'src/css/nojs.css'), 'utf8'));
  const js = stripJsComments(fs.readFileSync(path.join(ROOT, 'src/js/site.js'), 'utf8'));
  assetFiles.set('assets/site.css', css);
  assetFiles.set('assets/nojs.css', nojs);
  assetFiles.set('assets/site.js', js);
  ASSET_V.css = hash(css);
  ASSET_V.nojs = hash(nojs);
  ASSET_V.js = hash(js);
}

function sitemap() {
  const urls = ['', ...pub.map((it) => `webhard/${it.v.id}/`), 'criteria/'];
  return block([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((p) => block(['  <url>', `    <loc>${abs(p)}</loc>`, `    <lastmod>${DATE}</lastmod>`, '  </url>'])),
    '</urlset>',
  ]) + '\n';
}

function robots() {
  return block(['User-agent: *', 'Allow: /', '', `Sitemap: ${abs('sitemap.xml')}`]) + '\n';
}

function llms() {
  return block([
    `# ${BRAND}`,
    '',
    '> 국내 웹하드(P2P) 서비스를 매주 공개 지표로 비교해 순위를 정리하는 사이트예요.',
    '',
    `## ${WEEK_KO} 웹하드 순위 (${koreanDate(DATE, true)} 갱신)`,
    '',
    ...pub.map((it) => {
      const perks = shownBenefits(it.v).map((b) => b.text);
      return `${it.rank}. [${it.v.name}](${abs(`webhard/${it.v.id}/`)}): 총점 ${it.total.toFixed(1)}점, ${
        perks.length ? perks.join(' / ') : '혜택은 공식 사이트에서 확인'
      }`;
    }),
    '',
    '## 안내',
    '',
    `- [순위 기준과 자주 묻는 질문](${abs('criteria/')})`,
    `  ${josa(usedLabels(), '을/를')} 바탕으로 매주 월요일 다시 계산해요.`,
    '- 순위는 참고 자료이며, 서비스 선택과 이용은 이용자가 직접 판단해야 해요.',
  ]) + '\n';
}

/* ---------- finishing: placeholder swap and checks ---------- */

function urlDirOf(file) {
  if (file.endsWith('index.html')) return file.slice(0, -'index.html'.length);
  return '';
}

function finalize(files) {
  if (!BASE_URL) return;
  let base;
  try {
    base = new URL(BASE_URL.endsWith('/') ? BASE_URL : `${BASE_URL}/`);
  } catch {
    fail(`invalid --base-url ${BASE_URL}`);
  }
  const defaultHost = base.hostname.endsWith('.github.io');
  const re = /https:\/\/site-url\.invalid\/([^"'\s<>)\]]*)/g;
  for (const [file, content] of files) {
    if (typeof content !== 'string') continue;
    let next = content;
    if (!defaultHost) next = next.split(PLACEHOLDER).join(base.href);
    else {
      if (file === 'robots.txt') next = next.replace(/\nSitemap:[^\n]*\n?/, '\n');
      next = next.replace(re, (_, p) => (file === '404.html' ? base.pathname + p : relPath(urlDirOf(file), p)));
    }
    files.set(file, next);
  }
  const left = [...files].filter(([, c]) => typeof c === 'string' && c.includes('site-url.invalid')).map(([f]) => f);
  if (left.length) fail(left.map((f) => `${f}: address placeholder left after swap`));
}

function checkOutput(files) {
  const problems = [];
  for (const [file, content] of files) {
    if (typeof content !== 'string') continue;
    for (const b of longLines(content)) problems.push(`${file}:${b.line} is ${b.width} columns`);
    if (/\.html$/.test(file) && content.includes('<!--')) problems.push(`${file}: HTML comment`);
    if (/\.css$/.test(file) && content.includes('/*')) problems.push(`${file}: CSS comment`);
    if (/\.js$/.test(file) && /(^|\s)\/\/|\/\*/.test(content)) problems.push(`${file}: JS comment`);
  }
  for (const p of pages.filter((x) => x.indexable)) {
    const t = p.html.match(/<title>([^<]*)<\/title>/)[1].replace(/&amp;/g, '&');
    const d = p.html.match(/<meta name="description" content="([^"]*)"/s)[1].replace(/\s+/g, ' ');
    if (chars(t) < 30 || chars(t) > 60) problems.push(`${p.file}: title is ${chars(t)} characters`);
    if (chars(d) < 80 || chars(d) > 150) problems.push(`${p.file}: description is ${chars(d)} characters`);
  }
  for (const v of vendors.filter((x) => x.url)) {
    const host = new URL(v.url).hostname.replace(/^(www|new)\./, '');
    for (const [file, content] of files) {
      if (typeof content === 'string' && content.includes(host)) problems.push(`${file}: official address of ${v.id}`);
    }
  }
  if (problems.length) fail(problems);
}

/* ---------- run ---------- */

prepareAssets();
pageIndex();
pub.forEach(pageVendor);
pageCriteria();
pub.forEach(pageGo);
page404();

const files = new Map();
for (const p of pages) files.set(p.file, foldHtml(p.html));
for (const [k, v] of assetFiles) files.set(k, v);
files.set('sitemap.xml', sitemap());
files.set('robots.txt', robots());
files.set('llms.txt', llms());

const brandSvg = fs.readFileSync(path.join(ROOT, 'src/img/brand.svg'), 'utf8');
files.set('assets/brand.svg', brandSvg);
files.set('favicon.svg', brandSvg);

const staticDir = path.join(ROOT, 'src/static');
for (const file of fs.existsSync(staticDir) ? fs.readdirSync(staticDir, { recursive: true }) : []) {
  const full = path.join(staticDir, file);
  if (fs.statSync(full).isFile()) files.set(`assets/${file.split(path.sep).join('/')}`, fs.readFileSync(full));
}
for (const need of ['assets/og.png', 'assets/touch-icon.png']) {
  if (!files.has(need)) fail(`${need} is missing; run node scripts/assets.mjs brand`);
}

finalize(files);
checkOutput(files);

fs.rmSync(OUT, { recursive: true, force: true });
for (const [file, content] of files) {
  const target = path.join(OUT, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

console.log(`built ${pages.length} pages into ${path.relative(ROOT, OUT) || OUT}${BASE_URL ? ` for ${BASE_URL}` : ''}`);
