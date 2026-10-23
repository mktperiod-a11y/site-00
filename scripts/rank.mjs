#!/usr/bin/env node
// Rebuilds data/ranking.json from data/metrics.json and records the week in data/history.json.
//   node scripts/rank.mjs                     compute this week's ranking
//   node scripts/rank.mjs --restore-baseline  put the first collected metrics back, then compute
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJSON, writeJSON, kstDate, validateVendors } from './lib/rules.mjs';
import { computeRanking, appendHistory } from './lib/score.mjs';

const args = new Set(process.argv.slice(2));
const site = readJSON('data/site.json');
const vendors = readJSON('data/vendors.json');
const problems = validateVendors(vendors);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

const baselineFile = path.join(ROOT, 'data/baseline.json');
let metrics = readJSON('data/metrics.json', { vendors: {} });

if (args.has('--restore-baseline')) {
  if (!fs.existsSync(baselineFile)) {
    console.error('data/baseline.json does not exist yet');
    process.exit(1);
  }
  metrics = readJSON('data/baseline.json').metrics;
  writeJSON('data/metrics.json', metrics);
  console.log('metrics restored from baseline');
}

const date = process.env.RANK_DATE ?? kstDate();
const history = readJSON('data/history.json', []);
const ranking = computeRanking({ vendors, metrics, site, history, date });

if (ranking.items.length < site.publicCount) {
  console.error(`only ${ranking.items.length} vendors have metrics; ${site.publicCount} are needed`);
  process.exit(1);
}

writeJSON('data/ranking.json', ranking);
writeJSON('data/history.json', appendHistory(history, ranking, site.historyWeeks ?? 26));

if (!fs.existsSync(baselineFile)) {
  writeJSON('data/baseline.json', { createdAt: date, metrics, ranking });
  console.log('baseline saved');
}

const top = ranking.items.slice(0, site.publicCount).map((it) => `${it.rank}.${it.id}(${it.total})`);
console.log(`week ${ranking.week}: ${top.join(' ')}`);
if (ranking.pending.length) console.log(`waiting for metrics: ${ranking.pending.join(', ')}`);
