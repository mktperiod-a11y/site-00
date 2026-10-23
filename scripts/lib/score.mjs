import { weekInfo } from './rules.mjs';

const KEYS = ['search', 'usage', 'reaction'];

const round1 = (x) => Math.round(x * 10) / 10;
const finite = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

function minMax(values) {
  const known = values.filter((x) => x !== null);
  if (!known.length) return values.map(() => null);
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  return values.map((x) => (x === null ? null : hi > lo ? (x - lo) / (hi - lo) : 0.5));
}

export function normalizedSignals(vendors, metrics, ratingPrior) {
  const raw = vendors.map((v) => {
    const m = metrics?.vendors?.[v.id] ?? {};
    const play = v.playId ? m.play ?? {} : {};
    return {
      id: v.id,
      search: finite(m.search?.value),
      installs: finite(play.installs),
      rating: finite(play.rating),
      ratings: finite(play.ratings),
    };
  });
  const rated = raw.filter((r) => r.rating !== null && r.ratings !== null && r.ratings > 0);
  const mean = rated.length ? rated.reduce((s, r) => s + r.rating, 0) / rated.length : null;
  const search = minMax(raw.map((r) => (r.search === null ? null : Math.log1p(Math.max(0, r.search) * 100))));
  const usage = minMax(raw.map((r) => (r.installs === null ? null : Math.log10(Math.max(0, r.installs) + 1))));
  const reaction = minMax(
    raw.map((r) => {
      if (r.rating === null || r.ratings === null || r.ratings <= 0 || mean === null) return null;
      const n = r.ratings;
      return (n / (n + ratingPrior)) * r.rating + (ratingPrior / (n + ratingPrior)) * mean;
    }),
  );
  return raw.map((r, i) => ({ id: r.id, search: search[i], usage: usage[i], reaction: reaction[i] }));
}

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

export function computeRanking({ vendors, metrics, site, history, date }) {
  const active = vendors.filter((v) => v.status === 'active');
  const week = weekInfo(date);
  const signals = normalizedSignals(active, metrics, site.ratingPrior ?? 300);
  const prev = previousEntry(history, week.key);
  const prevRank = new Map((prev?.order ?? []).map((id, i) => [id, i + 1]));

  const scored = [];
  const pending = [];
  for (const s of signals) {
    const have = KEYS.filter((k) => s[k] !== null);
    if (!have.length) {
      pending.push(s.id);
      continue;
    }
    const wsum = have.reduce((a, k) => a + site.weights[k], 0);
    const caps = {};
    const parts = {};
    for (const k of have) {
      caps[k] = (site.weights[k] * 100) / wsum;
      parts[k] = caps[k] * s[k];
    }
    const rawTotal = have.reduce((a, k) => a + parts[k], 0);
    scored.push({ id: s.id, parts, caps, rawTotal, total: round1(rawTotal), adjust: 0 });
  }

  const name = new Map(active.map((v) => [v.id, v.name]));
  const sort = () =>
    scored.sort(
      (a, b) =>
        b.total - a.total ||
        b.rawTotal + b.adjust - (a.rawTotal + a.adjust) ||
        (prevRank.get(a.id) ?? 999) - (prevRank.get(b.id) ?? 999) ||
        name.get(a.id).localeCompare(name.get(b.id), 'ko'),
    );
  sort();

  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    for (const f of site.floors ?? []) {
      const idx = scored.findIndex((r) => r.id === f.id);
      if (idx < 0 || idx + 1 <= f.maxRank) continue;
      const row = scored[idx];
      const others = scored.filter((r) => r.id !== f.id);
      const below = others[f.maxRank - 1];
      const target = round1(below.total + 0.1);
      row.adjust += target - row.total;
      row.total = target;
      sort();
      changed = true;
    }
    if (!changed) break;
  }

  const publicCount = site.publicCount;
  const floor = site.starFloor;
  const items = scored.map((r, i) => {
    const rank = i + 1;
    const parts = r.adjust > 0 ? distribute(r.parts, r.caps, r.total - r.rawTotal) : r.parts;
    const shown = roundParts(parts, r.total);
    const full = Object.fromEntries(KEYS.map((k) => [k, k in shown ? shown[k] : null]));
    let change = null;
    if (prev) {
      const pr = prevRank.get(r.id);
      change = pr && pr <= publicCount ? pr - rank : 'new';
    }
    const stars = Math.min(5, Math.max(floor, round1(floor + ((5 - floor) * r.total) / 100)));
    return {
      id: r.id,
      rank,
      total: r.total,
      stars,
      parts: full,
      change,
      prevRank: prevRank.get(r.id) ?? null,
      adjusted: r.adjust > 0 ? round1(r.adjust) : 0,
    };
  });

  const used = KEYS.filter((k) => items.some((it) => it.parts[k] !== null));
  return {
    date,
    week: week.key,
    weekLabel: week.label,
    year: week.year,
    month: week.month,
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
