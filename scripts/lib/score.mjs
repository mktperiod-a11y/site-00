import crypto from 'node:crypto';
import { weekInfo } from './rules.mjs';

// The three public items. Each recipe metric feeds exactly one of them.
const KEYS = ['search', 'usage', 'reaction'];
const METRIC_GROUP = { search: 'search', installs: 'usage', ratings: 'usage', rating: 'reaction' };
const TRANSFORMS = {
  search: ['log', 'rank', 'z'],
  installs: ['log', 'rank', 'z'],
  ratings: ['log', 'rank', 'z'],
  rating: ['linear', 'rank', 'z'],
};

const round1 = (x) => Math.round(x * 10) / 10;
const finite = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/* ---------- calculation settings ---------- */

export function recipeProblems(r) {
  const out = [];
  if (!r || typeof r !== 'object') return ['recipe is not an object'];
  const m = r.metrics ?? {};
  const names = Object.keys(m);
  for (const k of names) {
    if (!(k in METRIC_GROUP)) out.push(`unknown metric ${k}`);
    else if (!TRANSFORMS[k].includes(m[k].t)) out.push(`${k}: bad transform`);
    if (!Number.isInteger(m[k]?.w) || m[k].w < 15 || m[k].w > 50 || m[k].w % 5) out.push(`${k}: weight must be 15-50 in steps of 5`);
  }
  for (const g of KEYS) if (!names.some((k) => METRIC_GROUP[k] === g)) out.push(`no metric for ${g}`);
  if (names.reduce((a, k) => a + (m[k]?.w ?? 0), 0) !== 100) out.push('weights must add up to 100');
  if (m.rating && !(m.rating.prior >= 100 && m.rating.prior <= 500)) out.push('rating prior must be 100-500');
  if (!(r.smooth === 1 || (r.smooth >= 0.5 && r.smooth <= 0.8))) out.push('smooth must be 1 or 0.5-0.8');
  if (!['prev', 'name', ...names].includes(r.tie)) out.push('bad tie rule');
  if (![10, 100, 1000].includes(r.scale)) out.push('scale must be 10, 100 or 1000');
  if (!(r.starFloor >= 3.4 && r.starFloor <= 3.8)) out.push('star floor must be 3.4-3.8');
  if (!(r.margin >= 0.1 && r.margin <= 0.6)) out.push('margin must be 0.1-0.6');
  if (!Array.isArray(r.priority)) out.push('priority must be a list');
  return out;
}

const canonical = (x) =>
  Array.isArray(x)
    ? `[${x.map(canonical).join(',')}]`
    : x && typeof x === 'object'
      ? `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`
      : JSON.stringify(x);

export const recipeHash = (r) => crypto.createHash('sha256').update(canonical(r)).digest('hex');

/* ---------- metrics ---------- */

function rawValues(vendors, metrics, prior) {
  const raw = vendors.map((v) => {
    const m = metrics?.vendors?.[v.id] ?? {};
    const play = v.playId ? m.play ?? {} : {};
    return {
      id: v.id,
      search: finite(m.search?.value),
      installs: finite(play.installs),
      ratings: finite(play.ratings),
      stars: finite(play.rating),
    };
  });
  const rated = raw.filter((r) => r.stars !== null && r.ratings > 0);
  const mean = rated.length ? rated.reduce((s, r) => s + r.stars, 0) / rated.length : null;
  for (const r of raw) {
    // Few reviews pull the rating toward the overall mean.
    r.rating = r.stars === null || !(r.ratings > 0) || mean === null ? null : (r.ratings * r.stars + prior * mean) / (r.ratings + prior);
  }
  return raw;
}

function transform(values, kind, metric) {
  const known = values.filter((x) => x !== null);
  if (!known.length) return values.map(() => null);
  const pre = (x) => (kind === 'linear' || metric === 'rating' ? x : Math.log1p(Math.max(0, x) * (metric === 'search' ? 100 : 1)));
  if (kind === 'rank') {
    return values.map((x) => {
      if (x === null) return null;
      if (known.length === 1) return 0.5;
      const below = known.filter((y) => y < x).length;
      const same = known.filter((y) => y === x).length;
      return (below + (same - 1) / 2) / (known.length - 1);
    });
  }
  const pv = values.map((x) => (x === null ? null : pre(x)));
  const kv = pv.filter((x) => x !== null);
  if (kind === 'z') {
    const mean = kv.reduce((a, b) => a + b, 0) / kv.length;
    const sd = Math.sqrt(kv.reduce((a, b) => a + (b - mean) ** 2, 0) / kv.length);
    return pv.map((x) => (x === null ? null : sd > 0 ? (Math.max(-2, Math.min(2, (x - mean) / sd)) + 2) / 4 : 0.5));
  }
  const lo = Math.min(...kv);
  const hi = Math.max(...kv);
  return pv.map((x) => (x === null ? null : hi > lo ? (x - lo) / (hi - lo) : 0.5));
}

/* ---------- points ---------- */

function distribute(parts, caps, extra) {
  const keys = Object.keys(parts);
  const room = keys.map((k) => Math.max(0, caps[k] - parts[k]));
  const roomSum = room.reduce((a, b) => a + b, 0);
  const out = { ...parts };
  if (roomSum >= extra && roomSum > 0) {
    keys.forEach((k, i) => (out[k] += (extra * room[i]) / roomSum));
    return out;
  }
  const base = keys.reduce((s, k) => s + parts[k], 0);
  keys.forEach((k) => (out[k] += base > 0 ? (extra * parts[k]) / base : extra / keys.length));
  return out;
}

function roundParts(parts, total) {
  const keys = Object.keys(parts);
  const target = Math.round(total * 10);
  const scaled = keys.map((k) => parts[k] * 10);
  const floors = scaled.map(Math.floor);
  let left = target - floors.reduce((a, b) => a + b, 0);
  const order = scaled.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]);
  for (let j = 0; left > 0 && j < order.length; j++, left--) floors[order[j][1]] += 1;
  for (let j = order.length - 1; left < 0 && j >= 0; j--) {
    const i = order[j][1];
    if (floors[i] > 0) {
      floors[i] -= 1;
      left++;
    }
  }
  return Object.fromEntries(keys.map((k, i) => [k, floors[i] / 10]));
}

function previousEntry(history, weekKey) {
  const older = (history ?? []).filter((h) => h.week !== weekKey);
  return older.length ? older[older.length - 1] : null;
}

// Totals are kept on a 0-100 scale; `scale` only changes how they are shown.
export function computeRanking({ vendors, metrics, recipe, site, history, date }) {
  const problems = recipeProblems(recipe);
  if (problems.length) throw new Error(`invalid ranking recipe: ${problems.join('; ')}`);
  const active = vendors.filter((v) => v.status === 'active');
  const week = weekInfo(date);
  const names = Object.keys(recipe.metrics);
  const raw = rawValues(active, metrics, recipe.metrics.rating?.prior ?? 300);
  const norm = Object.fromEntries(names.map((k) => [k, transform(raw.map((r) => r[k]), recipe.metrics[k].t, k)]));
  const prev = previousEntry(history, week.key);
  const prevRank = new Map((prev?.order ?? []).map((id, i) => [id, i + 1]));
  const prevTotal = prev?.totals ?? {};

  const scored = [];
  const pending = [];
  raw.forEach((r, i) => {
    const have = names.filter((k) => norm[k][i] !== null);
    if (!have.length) {
      pending.push(r.id);
      return;
    }
    const wsum = have.reduce((a, k) => a + recipe.metrics[k].w, 0);
    const caps = {};
    const parts = {};
    for (const k of have) {
      const g = METRIC_GROUP[k];
      const cap = (recipe.metrics[k].w * 100) / wsum;
      caps[g] = (caps[g] ?? 0) + cap;
      parts[g] = (parts[g] ?? 0) + cap * norm[k][i];
    }
    let rawTotal = Object.values(parts).reduce((a, b) => a + b, 0);
    // Optional weekly smoothing with last week's total.
    if (recipe.smooth < 1 && typeof prevTotal[r.id] === 'number') {
      const next = recipe.smooth * rawTotal + (1 - recipe.smooth) * prevTotal[r.id];
      const capSum = Object.values(caps).reduce((a, b) => a + b, 0);
      for (const g of Object.keys(parts)) parts[g] = rawTotal > 0 ? (parts[g] * next) / rawTotal : (caps[g] * next) / capSum;
      rawTotal = next;
    }
    const tieValue = recipe.tie in norm ? norm[recipe.tie][i] ?? -1 : 0;
    scored.push({ id: r.id, parts, caps, rawTotal, total: round1(rawTotal), adjust: 0, tieValue });
  });

  const name = new Map(active.map((v) => [v.id, v.name]));
  const byTie = (a, b) => {
    if (recipe.tie === 'prev') return (prevRank.get(a.id) ?? 999) - (prevRank.get(b.id) ?? 999);
    if (recipe.tie === 'name') return 0;
    return b.tieValue - a.tieValue;
  };
  const sort = () =>
    scored.sort(
      (a, b) =>
        b.total - a.total ||
        b.rawTotal + b.adjust - (a.rawTotal + a.adjust) ||
        byTie(a, b) ||
        name.get(a.id).localeCompare(name.get(b.id), 'ko'),
    );
  sort();

  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    for (const f of recipe.priority ?? []) {
      const idx = scored.findIndex((r) => r.id === f.id);
      if (idx < 0 || idx + 1 <= f.maxRank) continue;
      const row = scored[idx];
      const below = scored.filter((r) => r.id !== f.id)[f.maxRank - 1];
      const target = Math.min(100, round1(below.total + recipe.margin));
      row.adjust += target - row.total;
      row.total = target;
      sort();
      changed = true;
    }
    if (!changed) break;
  }

  const floor = recipe.starFloor;
  const items = scored.map((r, i) => {
    const rank = i + 1;
    const parts = r.adjust > 0 ? distribute(r.parts, r.caps, r.total - r.rawTotal) : r.parts;
    const shown = roundParts(parts, r.total);
    const full = Object.fromEntries(KEYS.map((k) => [k, k in shown ? shown[k] : null]));
    let change = null;
    if (prev) {
      const pr = prevRank.get(r.id);
      change = pr && pr <= site.publicCount ? pr - rank : 'new';
    }
    const stars = Math.min(5, Math.max(floor, round1(floor + ((5 - floor) * r.total) / 100)));
    return { id: r.id, rank, total: r.total, stars, parts: full, change, prevRank: prevRank.get(r.id) ?? null };
  });

  const used = KEYS.filter((k) => items.some((it) => it.parts[k] !== null));
  return {
    date,
    week: week.key,
    weekLabel: week.label,
    year: week.year,
    month: week.month,
    scale: recipe.scale,
    candidates: active.length,
    scored: items.length,
    pending,
    metricsUsed: used,
    items,
  };
}

export function appendHistory(history, ranking, keep) {
  const rest = (history ?? []).filter((h) => h.week !== ranking.week);
  rest.push({
    week: ranking.week,
    date: ranking.date,
    order: ranking.items.map((it) => it.id),
    totals: Object.fromEntries(ranking.items.map((it) => [it.id, it.total])),
  });
  rest.sort((a, b) => a.date.localeCompare(b.date));
  return rest.slice(-keep);
}
