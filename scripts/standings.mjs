#!/usr/bin/env node
// Rebuilds data/ranking.json from data/metrics.json and records the week in data/history.json.
//   node scripts/standings.mjs                     compute this week's ranking
//   node scripts/standings.mjs --restore-baseline  put the first collected metrics back, then compute
// Calculation settings come from the RANK_RECIPE environment variable and must match data/site.json#recipeHash;
// otherwise last week's ranking is kept.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJSON, writeJSON, kstDate, validateVendors } from './lib/rules.mjs';
import { computeRanking, appendHistory, recipeHash } from './lib/score.mjs';

const args = new Set(process.argv.slice(2));
const site = readJSON('data/site.json');
const vendors = readJSON('data/vendors.json');
const problems = validateVendors(vendors);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

let recipe;
try {
  recipe = JSON.parse(process.env.RANK_RECIPE ?? '');
} catch {
  console.log('::warning::Ranking recipe is not available; last week\'s ranking is kept.');
  process.exit(0);
}
if (recipeHash(recipe) !== site.recipeHash) {
  console.log('::warning::Ranking recipe does not match data/site.json recipeHash; last week\'s ranking is kept.');
  process.exit(0);
}

const baselineFile = path.join(ROOT, 'data/first-week.json');
let metrics = readJSON('data/metrics.json', { vendors: {} });

if (args.has('--restore-baseline')) {
  if (!fs.existsSync(baselineFile)) {
    console.error('data/first-week.json does not exist yet');
    process.exit(1);
  }
  metrics = readJSON('data/first-week.json').metrics;
  writeJSON('data/metrics.json', metrics);
  console.log('metrics restored from baseline');
}

const date = process.env.RANK_DATE ?? kstDate();
const history = readJSON('data/history.json', []);
const ranking = computeRanking({ vendors, metrics, recipe, site, history, date });

if (ranking.items.length < site.publicCount) {
  console.error(`only ${ranking.items.length} vendors have metrics; ${site.publicCount} are needed`);
  process.exit(1);
}

writeJSON('data/ranking.json', ranking);
writeJSON('data/history.json', appendHistory(history, ranking, site.historyWeeks ?? 26));

if (!fs.existsSync(baselineFile)) {
  writeJSON('data/first-week.json', { createdAt: date, metrics, ranking });
  console.log('baseline saved');
}

const top = ranking.items.slice(0, site.publicCount).map((it) => `${it.rank}.${it.id}(${it.total})`);
console.log(`week ${ranking.week}: ${top.join(' ')}`);
if (ranking.pending.length) console.log(`waiting for metrics: ${ranking.pending.join(', ')}`);
