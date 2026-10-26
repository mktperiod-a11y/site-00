// Builds a data folder full of awkward but valid cases so layout problems show up before real data hits them:
// very long and one-letter names, zero/one/two benefits at the length limit, missing icons and logos,
// every movement badge, extreme totals, missing metric items and a ranking history with gaps.
import fs from 'node:fs';
import path from 'node:path';
import { readJSON } from '../../scripts/lib/rules.mjs';

const DATE = '2026-12-28';
const WEEKS = ['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21', DATE];

const CASES = [
  { id: 'ondisk', name: '온디스크', change: 9, parts: [40, 35, 25], playId: 'x', benefits: ['join', 'event'] },
  { id: 'edge-long', name: '웹하드플러스프리미엄', change: 'new', parts: [38.1, 33.3, 24.4], playId: 'x', long: true },
  { id: 'edge-one', name: '가', change: -9, parts: [36.2, null, 22.1], playId: null, benefits: ['join'] },
  { id: 'edge-none', name: '파일없음테스트', change: 0, parts: [30, 30, 20], playId: 'x', benefits: [] },
  { id: 'edge-event', name: '이벤트만', change: 1, parts: [null, 34.4, 24.9], playId: 'x', benefits: ['event'] },
  { id: 'tple', name: '티플', change: -1, parts: [20.5, 30.2, 19.9], playId: 'x', long: true },
  { id: 'edge-mid', name: '중간길이웹하드', change: 'new', parts: [18, 20.4, 15], playId: 'x', benefits: ['join', 'event'] },
  { id: 'wedisk', name: '위디스크', change: 3, parts: [44.8, null, null], playId: null, benefits: ['join', 'event'] },
  { id: 'edge-low', name: '최하위', change: -2, parts: [0, 0.5, 0], playId: 'x', benefits: ['join'] },
  { id: 'edge-zero', name: '영점', change: 'new', parts: [0, 0, 0], playId: 'x', long: true },
  { id: 'edge-out', name: '밖에있음', change: null, parts: [0, 0, 0], playId: 'x', benefits: [] },
];

const LONG = [
  { kind: 'join', text: '본인인증 첫 달 자유이용권' },
  { kind: 'event', text: '앱 리뷰 스토어당 3,000P' },
];
const SHORT = { join: { kind: 'join', text: '가입 1,000P' }, event: { kind: 'event', text: 'VIP 이벤트' } };
const COLORS = ['#2563eb', '#e11d48', '#0eaa6b', '#ff6714', '#8100b8', '#0000f5', '#c69010', '#14a1ff', '#0d9488',
  '#ff14d0', '#f50087'];

export function makeEdgeData(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const site = readJSON('data/site.json');
  fs.writeFileSync(path.join(dir, 'site.json'), JSON.stringify(site));
  fs.writeFileSync(path.join(dir, 'faq.json'), JSON.stringify(readJSON('data/faq.json')));

  const vendors = CASES.map((c, i) => ({
    id: c.id,
    name: c.name,
    status: 'active',
    url: `https://example.test/${c.id}/`,
    affiliateUrl: i === 1 ? `https://example.test/${c.id}/partner` : null,
    playId: c.playId,
    appStoreId: null,
    color: COLORS[i],
    benefits: c.long ? LONG : (c.benefits ?? []).map((k) => SHORT[k]),
  }));
  fs.writeFileSync(path.join(dir, 'vendors.json'), JSON.stringify(vendors));

  const items = CASES.map((c, i) => {
    const parts = { search: c.parts[0], usage: c.parts[1], reaction: c.parts[2] };
    const total = Math.round(Object.values(parts).reduce((a, b) => a + (b ?? 0), 0) * 10) / 10;
    return {
      id: c.id,
      rank: i + 1,
      total,
      stars: Math.max(3.6, Math.round((3.6 + (1.4 * total) / 100) * 10) / 10),
      parts,
      change: c.change,
      prevRank: null,
      adjusted: 0,
    };
  });
  const ranking = {
    date: DATE,
    week: '2026-12-W5',
    weekLabel: '12월 5주차',
    year: 2026,
    month: 12,
    candidates: CASES.length + 8,
    scored: CASES.length,
    pending: [],
    metricsUsed: ['search', 'usage', 'reaction'],
    items,
  };
  fs.writeFileSync(path.join(dir, 'ranking.json'), JSON.stringify(ranking));

  const history = WEEKS.map((date, w) => {
    const order = CASES.map((c) => c.id);
    if (w % 3 === 1) order.reverse();
    if (w === 2) order.splice(0, 0, order.splice(order.indexOf('ondisk'), 1)[0]);
    return { week: `w${w}`, date, order, totals: Object.fromEntries(order.map((id, i) => [id, 99.9 - i * 7.3])) };
  });
  fs.writeFileSync(path.join(dir, 'history.json'), JSON.stringify(history));

  const metrics = {
    vendors: Object.fromEntries(
      CASES.map((c, i) => [
        c.id,
        c.playId ? { play: { installs: 10 ** (8 - (i % 5)), minInstalls: 10 ** (8 - (i % 5)), rating: 4.8, ratings: 1234567 } } : {},
      ]),
    ),
  };
  fs.writeFileSync(path.join(dir, 'metrics.json'), JSON.stringify(metrics));
  return { ranking, vendors };
}
