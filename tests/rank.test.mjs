import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRanking, appendHistory, recipeProblems, recipeHash } from '../scripts/lib/score.mjs';
import { benefitProblems, findBlocked, blockedTermsForTests, josa, weekInfo } from '../scripts/lib/rules.mjs';

// Test settings only.
const site = { publicCount: 10 };
const recipe = {
  v: 1,
  metrics: { search: { w: 40, t: 'log' }, installs: { w: 35, t: 'log' }, rating: { w: 25, t: 'linear', prior: 300 } },
  smooth: 1,
  tie: 'prev',
  scale: 100,
  starFloor: 3.6,
  priority: [
    { id: 'p1', maxRank: 3 },
    { id: 'p2', maxRank: 5 },
  ],
  margin: 0.1,
};

function seeded(seed) {
  let h = seed >>> 0;
  return (n) => {
    h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return h % n;
  };
}

function randomRecipe(rand) {
  const pick = (a) => a[rand(a.length)];
  for (;;) {
    const usage = pick([['installs'], ['ratings'], ['installs', 'ratings']]);
    const names = ['search', ...usage, 'rating'];
    const w = names.map(() => 15 + 5 * rand(8));
    if (w.reduce((a, b) => a + b, 0) !== 100) continue;
    const metrics = {};
    names.forEach((k, i) => (metrics[k] = { w: w[i], t: pick(k === 'rating' ? ['linear', 'rank', 'z'] : ['log', 'rank', 'z']) }));
    metrics.rating.prior = 100 + 50 * rand(9);
    const on = pick([2, 3, 4]);
    const r = {
      v: 1,
      metrics,
      smooth: pick([1, 0.8, 0.7, 0.6, 0.5]),
      tie: pick(['prev', 'name', ...names]),
      scale: pick([10, 100, 1000]),
      starFloor: pick([3.4, 3.5, 3.6, 3.7, 3.8]),
      priority: [
        { id: 'p1', maxRank: on },
        { id: 'p2', maxRank: pick([4, 5, 6].filter((x) => x > on)) },
      ],
      margin: pick([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]),
    };
    if (!recipeProblems(r).length) return r;
  }
}

function fixture(order) {
  const vendors = order.map((id, i) => ({ id, name: `업체${i}`, status: 'active', playId: id === 'noapp' ? null : `app.${id}` }));
  const metrics = { vendors: {} };
  order.forEach((id, i) => {
    const strength = order.length - i;
    metrics.vendors[id] = {
      search: { value: strength / 10 },
      play: id === 'noapp' ? undefined : { installs: 1000 * strength ** 3, rating: 3 + strength / 10, ratings: 50 * strength },
    };
  });
  return { vendors, metrics };
}

const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'noapp', 'p2', 'p1'];

function checkRanking(r, rc) {
  const pos = (id) => r.items.findIndex((x) => x.id === id) + 1;
  for (const f of rc.priority) {
    assert.ok(pos(f.id) <= f.maxRank, `${f.id} at ${pos(f.id)}, allowed ${f.maxRank}`);
  }
  for (const it of r.items) {
    const sum = Object.values(it.parts).filter((x) => x !== null).reduce((a, b) => a + b, 0);
    assert.equal(Math.round(sum * 10), Math.round(it.total * 10), it.id);
    assert.ok(it.total >= 0 && it.total <= 100, `${it.id} total ${it.total}`);
    assert.ok(it.stars >= rc.starFloor && it.stars <= 5);
  }
  assert.equal(r.scale, rc.scale);
}

test('listed vendors land in their range with the set margin over the next entry', () => {
  const { vendors, metrics } = fixture(ids);
  const r = computeRanking({ vendors, metrics, recipe, site, history: [], date: '2026-10-26' });
  checkRanking(r, recipe);
  for (const id of ['p1', 'p2']) {
    const i = r.items.findIndex((x) => x.id === id);
    assert.equal(Math.round((r.items[i].total - r.items[i + 1].total) * 10) / 10, 0.1);
  }
  assert.ok(r.items.every((it) => !('adjusted' in it)), 'adjustment amounts are not written out');
});

test('a hundred random settings all keep the rules, and the same input always gives the same order', () => {
  const rand = seeded(20261027);
  for (let n = 0; n < 100; n++) {
    const rc = randomRecipe(rand);
    const { vendors, metrics } = fixture(ids);
    if (n % 3 === 0) delete metrics.vendors.c.search;
    const first = computeRanking({ vendors, metrics, recipe: rc, site, history: [], date: '2026-10-19' });
    checkRanking(first, rc);
    const history = appendHistory([], first, 26);
    const second = computeRanking({ vendors, metrics, recipe: rc, site, history, date: '2026-10-26' });
    checkRanking(second, rc);
    const again = computeRanking({ vendors, metrics, recipe: rc, site, history, date: '2026-10-26' });
    assert.deepEqual(again.items.map((x) => x.id), second.items.map((x) => x.id));
  }
});

test('broken settings are refused and the hash ignores key order', () => {
  assert.ok(recipeProblems({ ...recipe, metrics: { search: { w: 60, t: 'log' }, rating: { w: 40, t: 'z', prior: 300 } } }).length);
  assert.ok(recipeProblems({ ...recipe, scale: 50 }).length);
  assert.ok(recipeProblems({ ...recipe, metrics: { installs: { w: 50, t: 'log' }, rating: { w: 50, t: 'z', prior: 300 } } }).length);
  assert.throws(() => computeRanking({ ...fixture(ids), recipe: { ...recipe, margin: 2 }, site, history: [], date: '2026-10-26' }));
  const reordered = JSON.parse(JSON.stringify({ margin: recipe.margin, ...recipe }));
  assert.equal(recipeHash(reordered), recipeHash(recipe));
});

test('vendors without metrics wait outside the ranking; partial metrics still count', () => {
  const { vendors, metrics } = fixture(ids);
  delete metrics.vendors.k;
  const r = computeRanking({ vendors, metrics, recipe, site, history: [], date: '2026-10-26' });
  assert.deepEqual(r.pending, ['k']);
  const noapp = r.items.find((x) => x.id === 'noapp');
  assert.equal(noapp.parts.usage, null);
  assert.ok(noapp.parts.search > 0);
});

test('weekly movement compares with the previous week', () => {
  const { vendors, metrics } = fixture(ids);
  const first = computeRanking({ vendors, metrics, recipe, site, history: [], date: '2026-10-19' });
  assert.ok(first.items.every((x) => x.change === null));
  const history = appendHistory([], first, 26);
  metrics.vendors.k.search.value = 50;
  metrics.vendors.k.play.installs = 1e9;
  metrics.vendors.k.play.rating = 5;
  metrics.vendors.k.play.ratings = 1e6;
  const second = computeRanking({ vendors, metrics, recipe, site, history, date: '2026-10-26' });
  const k = second.items.find((x) => x.id === 'k');
  assert.equal(k.change, 'new');
  assert.ok(second.items.slice(0, 10).some((x) => typeof x.change === 'number'));
});

test('benefit wording rules', () => {
  assert.deepEqual(benefitProblems('가입 1,000P'), []);
  assert.deepEqual(benefitProblems('출근 시간 콘텐츠 무료'), []);
  assert.ok(benefitProblems('가입 시').length);
  assert.ok(benefitProblems('1,000P 지급').length);
  assert.ok(benefitProblems('이벤트 진행 중').length);
  assert.ok(benefitProblems('아주 길고 길어서 한 줄에 다 들어가지 않는 혜택').length);
  assert.ok(benefitProblems('10월 3일 까지').length);
});

test('excluded service names are detected in either script', () => {
  for (const term of blockedTermsForTests()) {
    assert.ok(findBlocked(`안내 ${term} 안내`).length, 'plain');
    assert.ok(findBlocked(term.toUpperCase()).length, 'case');
  }
  assert.deepEqual(findBlocked('온디스크 케이디스크 파일노리'), []);
});

test('korean particles and week labels', () => {
  assert.equal(josa('온디스크', '이에요/예요'), '온디스크예요');
  assert.equal(josa('파일썬', '이에요/예요'), '파일썬이에요');
  assert.equal(josa('티플', '으로/로'), '티플로');
  assert.equal(josa('파일썬', '으로/로'), '파일썬으로');
  assert.equal(weekInfo('2026-10-23').label, '10월 4주차');
  assert.equal(weekInfo('2026-10-26').label, '10월 5주차');
  assert.equal(weekInfo('2026-11-02').label, '11월 1주차');
});
