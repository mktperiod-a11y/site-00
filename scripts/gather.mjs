#!/usr/bin/env node
// Weekly metric collection. Failures keep the previous values and only emit Actions warnings.
import { readJSON, writeJSON, kstDate, addDays } from './lib/rules.mjs';
import { parsePlay } from './lib/play.mjs';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TREND_ENDPOINTS = [
  'https://naverapihub.apigw.ntruss.com/search-trend/v1/search',
  'https://naveropenapi.apigw.ntruss.com/datalab/v1/search',
];

const warn = (msg) => console.log(`::warning::${msg}`);

async function fetchText(url, init = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const body = await res.text();
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function trendRequest(groups, start, end, creds) {
  const payload = JSON.stringify({
    startDate: start,
    endDate: end,
    timeUnit: 'week',
    keywordGroups: groups.map((g) => ({ groupName: g.id, keywords: g.keywords })),
  });
  const headers = {
    'content-type': 'application/json',
    'X-NCP-APIGW-API-KEY-ID': creds.id,
    'X-NCP-APIGW-API-KEY': creds.secret,
  };
  let lastStatus = 0;
  for (const url of process.env.NAVER_TREND_URL ? [process.env.NAVER_TREND_URL] : TREND_ENDPOINTS) {
    const { status, body } = await fetchText(url, { method: 'POST', headers, body: payload });
    lastStatus = status;
    if (status === 200) {
      const data = JSON.parse(body);
      const out = {};
      for (const r of data.results ?? []) {
        const vals = (r.data ?? []).map((d) => Number(d.ratio)).filter(Number.isFinite);
        out[r.title] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      }
      return out;
    }
  }
  throw new Error(`search trend request failed with HTTP ${lastStatus}`);
}

async function collectSearch(vendors, prev, today) {
  const creds = { id: process.env.NAVER_CLIENT_ID, secret: process.env.NAVER_CLIENT_SECRET };
  if (!creds.id || !creds.secret) {
    warn('Search trend keys are not configured; previous search values are kept.');
    return {};
  }
  const end = addDays(today, -1);
  const start = addDays(end, -27);
  const groups = vendors.map((v) => ({ id: v.id, keywords: v.searchKeywords ?? [v.name] }));
  const prevVals = groups.map((g) => prev.vendors?.[g.id]?.search?.value ?? 0);
  const anchor = groups[prevVals.indexOf(Math.max(...prevVals))] ?? groups[0];
  const rest = groups.filter((g) => g.id !== anchor.id);
  const result = {};
  for (let i = 0; i < rest.length; i += 4) {
    const batch = [anchor, ...rest.slice(i, i + 4)];
    try {
      const means = await trendRequest(batch, start, end, creds);
      const base = means[anchor.id];
      if (!base) throw new Error('reference keyword returned no volume');
      result[anchor.id] = 1;
      for (const g of batch) if (g.id !== anchor.id) result[g.id] = (means[g.id] ?? 0) / base;
    } catch (e) {
      warn(`Search trend batch ${i / 4 + 1} skipped: ${e.message}`);
    }
  }
  return { values: result, anchor: anchor.id, start, end };
}

async function collectPlay(vendor) {
  const url = `https://play.google.com/store/apps/details?id=${encodeURIComponent(vendor.playId)}&hl=ko&gl=KR`;
  const { status, body } = await fetchText(url, { headers: { 'user-agent': UA, 'accept-language': 'ko-KR,ko;q=0.9' } });
  if (status !== 200) throw new Error(`HTTP ${status}`);
  return parsePlay(body);
}

async function main() {
  const vendors = readJSON('data/vendors.json').filter((v) => v.status === 'active');
  const prev = readJSON('data/metrics.json', { vendors: {} });
  const today = process.env.RANK_DATE ?? kstDate();
  const next = structuredClone(prev);
  next.vendors ??= {};
  for (const v of vendors) next.vendors[v.id] ??= {};

  const search = await collectSearch(vendors, prev, today);
  if (search.values) {
    for (const [id, value] of Object.entries(search.values)) {
      next.vendors[id].search = { value: Math.round(value * 1e6) / 1e6, at: today };
    }
    next.searchWindow = { start: search.start, end: search.end, reference: search.anchor };
  }
  let searched = Object.keys(search.values ?? {}).length;

  let played = 0;
  for (const v of vendors.filter((x) => x.playId)) {
    try {
      const m = await collectPlay(v);
      next.vendors[v.id].play = { ...m, at: today };
      played++;
    } catch (e) {
      warn(`Store metrics for ${v.id} kept from the last run: ${e.message}`);
    }
  }
  next.collectedAt = today;
  writeJSON('data/metrics.json', next);
  console.log(`collected search=${searched} store=${played} of ${vendors.length} vendors`);
}

main().catch((e) => {
  warn(`Collection stopped early: ${e.message}`);
  process.exitCode = 0;
});
