#!/usr/bin/env node
// Browser check at four widths: horizontal scroll, console errors, CSP violations, broken images and links,
// clipped text, tap target size, first-screen content, menu behaviour and the no-JS view.
//   node tests/render.mjs [screenshot-dir]
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { ROOT, readJSON } from '../scripts/lib/rules.mjs';
import { audit } from './ui-audit.mjs';
import { makeEdgeData } from './fixtures/edge-data.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const SHOTS = process.argv[2] ? path.resolve(process.argv[2]) : null;
const WIDTHS = [
  [360, 740],
  [768, 1024],
  [1024, 768],
  [1440, 900],
];
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8' };

function serve(dir, prefix) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let rel = decodeURIComponent(url.pathname);
    if (!rel.startsWith(prefix)) {
      res.writeHead(404).end();
      return;
    }
    rel = rel.slice(prefix.length);
    let file = path.join(dir, rel);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!file.startsWith(dir) || !fs.existsSync(file)) {
      res.writeHead(404, { 'content-type': TYPES['.html'] }).end(fs.readFileSync(path.join(dir, '404.html')));
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const problems = [];
const note = (msg) => problems.push(msg);

async function checkPage(context, url, label, { width, height, firstScreen = false }) {
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const res = await page.goto(url, { waitUntil: 'load' });
  const missing = label.endsWith('-404');
  if (!missing && res.status() !== 200) note(`${label}@${width}: HTTP ${res.status()}`);
  await page.waitForTimeout(150);
  const r = await page.evaluate(audit, { firstScreen });
  for (const i of r.issues) note(`${label}@${width}: ${i}`);
  for (const e of errors) if (!(missing && /status of 404/.test(e))) note(`${label}@${width}: console ${e}`);
  for (const c of r.csp) note(`${label}@${width}: CSP ${c}`);
  if (SHOTS && (width === 360 || width === 1440 || label === 'index')) {
    await page.screenshot({ path: path.join(SHOTS, `${label}-${width}.png`), fullPage: true });
  }
  await page.close();
  return r.links;
}

async function run(mode) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'render-'));
  const prefix = mode === 'default' ? '/site-path/' : '/';
  const server = await serve(tmp, prefix);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = mode === 'default' ? 'https://owner.github.io/site-path/' : `${origin}/`;
  const args = [path.join(ROOT, 'scripts/compose.mjs'), '--out', tmp, '--base-url', base];
  let ranking = readJSON('data/ranking.json');
  let vendorList = readJSON('data/vendors.json');
  if (mode === 'edge') {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-data-'));
    ({ ranking, vendors: vendorList } = makeEdgeData(dataDir));
    args.push('--data', dataDir);
  }
  execFileSync('node', args, { stdio: 'pipe' });
  const root = origin + prefix;

  const vendors = new Map(vendorList.map((v) => [v.id, v]));
  const ids = ranking.items.slice(0, 10).map((i) => i.id);
  const details = mode === 'edge' ? ids.slice(0, 5).concat(ids.slice(7, 10)) : [ids[0], ids[9]];
  const targets = [
    ['index', root],
    ['criteria', `${root}criteria/`],
    ...details.map((id) => [`detail-${id}`, `${root}webhard/${id}/`]),
    ['404', `${root}missing/deep/path/`],
  ];

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const links = new Set();
  for (const [width, height] of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    for (const [label, url] of targets) {
      const found = await checkPage(context, url, `${mode}-${label}`, { width, height, firstScreen: label === 'index' });
      found.forEach((l) => links.add(l));
    }
    await context.close();
  }

  for (const link of links) {
    if (!link.startsWith(origin)) {
      note(`${mode}: external link on page ${link}`);
      continue;
    }
    if (link.includes('/missing/deep/path/')) continue;
    const res = await fetch(link.split('#')[0]);
    if (res.status !== 200) note(`${mode}: broken link ${link} (${res.status})`);
  }

  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const page = await ctx.newPage();
  await page.goto(root);
  const nav = page.locator('#site-nav');
  if (await nav.isVisible()) note(`${mode}: mobile menu open before click`);
  await page.click('.menu-btn');
  if (!(await nav.isVisible())) note(`${mode}: mobile menu does not open`);
  await page.mouse.click(180, 600);
  if (await nav.isVisible()) note(`${mode}: mobile menu stays open after outside click`);
  await page.click('.menu-btn');
  await page.keyboard.press('Escape');
  if (await nav.isVisible()) note(`${mode}: mobile menu ignores Escape`);
  await page.keyboard.press('Tab');
  const focusVisible = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none' ||
    document.activeElement.classList.contains('skip'));
  if (!focusVisible) note(`${mode}: keyboard focus not visible`);

  let jumped = null;
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(origin)) return route.continue();
    jumped = u;
    return route.abort();
  });
  await page.goto(`${root}go/${ids[0]}/`).catch(() => {});
  await page.waitForTimeout(300);
  const expected = vendors.get(ids[0]).affiliateUrl || vendors.get(ids[0]).url;
  if (jumped !== expected) note(`${mode}: go page sent to ${jumped}, expected the official address`);
  await ctx.close();

  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const dp = await desk.newPage();
  await dp.goto(root);
  const first = dp.locator('.entry').first();
  await first.hover();
  await dp.waitForTimeout(250);
  const hover = await first.evaluate((el) => ({
    total: getComputedStyle(el.querySelector('.total')).backgroundColor,
    vc: getComputedStyle(el).getPropertyValue('--vc').trim(),
    peek: getComputedStyle(el.querySelector('.peek')).opacity,
  }));
  const hex = (rgb) => '#' + rgb.match(/\d+/g).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  if (hex(hover.total) !== hover.vc.toLowerCase()) note(`${mode}: hover does not use the vendor color`);
  if (hover.peek !== '1') note(`${mode}: hover detail not shown`);

  // Hover states put text on saturated vendor colors; AA (4.5) still read poorly there, so these need AAA (7).
  for (const row of await dp.locator('.entry').all()) {
    for (const target of ['.total', '.peek', '.go-btn']) {
      await (target === '.go-btn' ? row.locator(target) : row).hover();
      await dp.waitForTimeout(200);
      const found = await row.evaluate((el, sel) => {
        const t = el.querySelector(sel);
        if (!t || !t.getClientRects().length) return null;
        const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
        const lum = ([r, g, b]) => [r, g, b].map((v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
        const cs = getComputedStyle(t);
        const [a, b] = [lum(rgb(cs.color)), lum(rgb(cs.backgroundColor))].sort((x, y) => y - x);
        return { id: el.id, ratio: (a + 0.05) / (b + 0.05) };
      }, target);
      if (found && found.ratio < 7) note(`${mode}: hover contrast ${found.ratio.toFixed(2)} on ${target} in #${found.id}`);
    }
  }
  await desk.close();

  const nojs = await browser.newContext({ viewport: { width: 360, height: 740 }, javaScriptEnabled: false });
  const np = await nojs.newPage();
  await np.goto(root);
  const state = await np.evaluate(() => ({
    entries: document.querySelectorAll('.entry').length,
    buttons: [...document.querySelectorAll('.entry .go-btn')].filter((b) => b.offsetWidth > 0).length,
    perks: document.querySelectorAll('.entry .perks').length,
    nav: document.getElementById('site-nav').offsetHeight > 0,
    scroll: document.documentElement.scrollWidth > window.innerWidth,
  }));
  if (state.entries !== 10 || state.buttons !== 10 || state.perks !== 10) note(`${mode}: no-JS view is missing entries`);
  if (!state.nav) note(`${mode}: no-JS view hides the menu links`);
  if (state.scroll) note(`${mode}: no-JS view scrolls sideways`);
  await nojs.close();

  await browser.close();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${mode}: checked ${targets.length} pages at ${WIDTHS.length} widths and ${links.size} links`);
}

if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
await run('custom');
await run('default');
await run('edge');
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('render checks passed');
