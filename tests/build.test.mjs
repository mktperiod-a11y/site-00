import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  ROOT, PLACEHOLDER, readJSON, listFiles, longLines, scanForBlocked, validateVendors, blockedTermsForTests,
} from '../scripts/lib/rules.mjs';

const site = readJSON('data/site.json');
const vendors = readJSON('data/vendors.json');
const ranking = readJSON('data/ranking.json');

function build(base) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
  execFileSync('node', [path.join(ROOT, 'scripts/compose.mjs'), '--out', out, '--base-url', base], { stdio: 'pipe' });
  const files = new Map();
  for (const f of listFiles(out, new Set())) files.set(path.relative(out, f).split(path.sep).join('/'), f);
  return { out, files, read: (rel) => fs.readFileSync(path.join(out, rel), 'utf8') };
}

const custom = build('https://example.test/');
const github = build('https://owner.github.io/repo-path/');
const textFiles = (b) => [...b.files.keys()].filter((f) => /\.(html|css|js|xml|txt|svg)$/.test(f));

test('the chart shows exactly the public count', () => {
  const html = custom.read('index.html');
  assert.equal((html.match(/<li class="entry /g) ?? []).length, site.publicCount);
  const go = [...custom.files.keys()].filter((f) => f.startsWith('go/'));
  const detail = [...custom.files.keys()].filter((f) => f.startsWith('webhard/'));
  assert.equal(go.length, site.publicCount);
  assert.equal(detail.length, site.publicCount);
  const shown = ranking.items.slice(0, site.publicCount).map((i) => i.id).sort();
  assert.deepEqual(go.map((f) => f.split('/')[1]).sort(), shown);
});

test('minimum positions hold in the published ranking', () => {
  for (const f of site.floors) {
    const pos = ranking.items.findIndex((i) => i.id === f.id) + 1;
    if (pos === 0) continue;
    assert.ok(pos <= f.maxRank, `${f.id} is ${pos}`);
  }
  for (const it of ranking.items) {
    const sum = Object.values(it.parts).filter((x) => x !== null).reduce((a, b) => a + b, 0);
    assert.equal(Math.round(sum * 10), Math.round(it.total * 10), it.id);
  }
});

test('excluded services are absent and their presence stops the build', () => {
  assert.deepEqual(scanForBlocked(ROOT), []);
  assert.deepEqual(scanForBlocked(custom.out, new Set()), []);
  const probe = path.join(ROOT, 'tests', 'probe-excluded.txt');
  fs.writeFileSync(probe, blockedTermsForTests()[0]);
  try {
    const r = spawnSync('node', [path.join(ROOT, 'scripts/compose.mjs'), '--out', fs.mkdtempSync(path.join(os.tmpdir(), 'x-'))]);
    assert.notEqual(r.status, 0);
  } finally {
    fs.rmSync(probe);
  }
});

test('vendor data and benefit wording follow the rules', () => {
  assert.deepEqual(validateVendors(vendors), []);
});

test('no placeholder, comments, internal words or long lines in the output', () => {
  for (const b of [custom, github]) {
    for (const f of textFiles(b)) {
      const text = b.read(f);
      assert.ok(!text.includes(PLACEHOLDER), `${f} placeholder`);
      assert.deepEqual(longLines(text), [], `${f} long lines`);
      if (f.endsWith('.html')) assert.ok(!text.includes('<!--'), `${f} comment`);
      if (f.endsWith('.css')) assert.ok(!text.includes('/*'), `${f} comment`);
      if (f.endsWith('.js')) assert.ok(!/(^|\s)\/\/|\/\*/.test(text), `${f} comment`);
      if (f.endsWith('.css')) continue;
      for (const word of ['baseline', 'weights', 'maxRank', 'adjust', '보정', '가중치', 'metrics.json', 'ranking.json',
        'vendors.json', 'TODO', 'FIXME', 'CLAUDE']) {
        assert.ok(!text.includes(word), `${f} contains ${word}`);
      }
    }
  }
});

test('internal files are not published', () => {
  for (const f of custom.files.keys()) {
    assert.ok(!/^(data|scripts|tests|src|\.github|node_modules)\//.test(f), f);
    assert.ok(!/(CLAUDE\.md|package(-lock)?\.json|README)/i.test(f), f);
  }
});

test('every page carries CSP and referrer policy; indexable pages have fitting titles', () => {
  for (const f of [...custom.files.keys()].filter((x) => x.endsWith('.html'))) {
    const html = custom.read(f).replace(/\s+/g, ' ');
    assert.match(html, /http-equiv="Content-Security-Policy"/, f);
    assert.match(html, /form-action 'none'/, f);
    assert.match(html, /object-src 'none'/, f);
    assert.match(html, /<meta name="referrer"/, f);
    if (f.startsWith('go/') || f === '404.html') {
      assert.match(html, /noindex/, f);
      continue;
    }
    const title = html.match(/<title>([^<]*)<\/title>/)[1];
    const desc = html.match(/<meta name="description" content="([^"]*)"/)[1].replace(/\s+/g, ' ');
    assert.ok([...title].length >= 30 && [...title].length <= 60, `${f} title ${[...title].length}`);
    assert.ok([...desc].length >= 80 && [...desc].length <= 150, `${f} description ${[...desc].length}`);
  }
});

test('official addresses only exist in encoded form on redirect pages', () => {
  for (const v of vendors) {
    const host = new URL(v.url).hostname.replace(/^(www|new)\./, '');
    for (const f of textFiles(custom)) assert.ok(!custom.read(f).includes(host), `${f} has ${host}`);
  }
  const id = ranking.items[0].id;
  const html = custom.read(`go/${id}/index.html`);
  const enc = html.match(/var s = ([^;]+);/)[1].replace(/["+\s]/g, '');
  const url = Buffer.from(enc.split('').reverse().join(''), 'base64').toString('utf8');
  const v = vendors.find((x) => x.id === id);
  assert.equal(url, v.affiliateUrl || v.url);
  assert.match(html, /noindex,nofollow/);
});

test('on a default github address no absolute self links are written', () => {
  for (const f of textFiles(github)) {
    const text = github.read(f);
    assert.ok(!text.includes('owner.github.io'), `${f} absolute address`);
  }
  assert.ok(!github.read('robots.txt').includes('Sitemap:'));
  assert.match(github.read('404.html'), /href="\/repo-path\/assets\/site\.css/);
  assert.match(custom.read('sitemap.xml'), /<loc>https:\/\/example\.test\/<\/loc>/);
  assert.match(custom.read('index.html'), /<link rel="canonical" href="https:\/\/example\.test\/">/);
});

test('structured data parses on every indexable page', () => {
  for (const f of [...custom.files.keys()].filter((x) => x.endsWith('.html') && !x.startsWith('go/') && x !== '404.html')) {
    const m = custom.read(f).match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    const data = JSON.parse(m[1]);
    const types = data['@graph'].map((n) => n['@type']);
    if (f === 'index.html') assert.deepEqual(types, ['WebSite', 'CollectionPage', 'ItemList', 'FAQPage']);
    else assert.ok(types.includes('BreadcrumbList'), f);
  }
});

test.after(() => {
  for (const b of [custom, github]) fs.rmSync(b.out, { recursive: true, force: true });
});
