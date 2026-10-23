import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRanking, appendHistory } from '../scripts/lib/score.mjs';
import { benefitProblems, findBlocked, blockedTermsForTests, josa, weekInfo } from '../scripts/lib/rules.mjs';

const site = {
  publicCount: 10,
  starFloor: 3.6,
  floors: [
    { id: 'ondisk', maxRank: 3 },
    { id: 'kdisk', maxRank: 5 },
  ],
  weights: { search: 40, usage: 35, reaction: 25 },
  ratingPrior: 300,
};

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

const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'noapp', 'kdisk', 'ondisk'];

test('minimum positions are enforced with a 0.1 point lead over the next entry', () => {
  const { vendors, metrics } = fixture(ids);
  const r = computeRanking({ vendors, metrics, site, history: [], date: '2026-10-26' });
  const pos = (id) => r.items.findIndex((x) => x.id === id) + 1;
  assert.ok(pos('ondisk') <= 3, `ondisk at ${pos('ondisk')}`);
  assert.ok(pos('kdisk') <= 5, `kdisk at ${pos('kdisk')}`);
  for (const id of ['ondisk', 'kdisk']) {
    const i = pos(id) - 1;
    const below = r.items[i + 1];
    assert.equal(Math.round((r.items[i].total - below.total) * 10) / 10, 0.1);
  }
  for (const it of r.items.filter((x) => !['ondisk', 'kdisk'].includes(x.id))) assert.equal(it.adjusted, 0);
});

test('shown item points always add up to the total', () => {
  const { vendors, metrics } = fixture(ids);
  const r = computeRanking({ vendors, metrics, site, history: [], date: '2026-10-26' });
  for (const it of r.items) {
    const sum = Object.values(it.parts).filter((x) => x !== null).reduce((a, b) => a + b, 0);
    assert.equal(Math.round(sum * 10), Math.round(it.total * 10), it.id);
    assert.ok(it.stars >= 3.6 && it.stars <= 5);
  }
});

test('vendors without metrics wait outside the ranking; partial metrics still count', () => {
  const { vendors, metrics } = fixture(ids);
  delete metrics.vendors.k;
  const r = computeRanking({ vendors, metrics, site, history: [], date: '2026-10-26' });
  assert.deepEqual(r.pending, ['k']);
  const noapp = r.items.find((x) => x.id === 'noapp');
  assert.equal(noapp.parts.usage, null);
  assert.ok(noapp.parts.search > 0);
});

test('weekly movement compares with the previous week', () => {
  const { vendors, metrics } = fixture(ids);
  const first = computeRanking({ vendors, metrics, site, history: [], date: '2026-10-19' });
  assert.ok(first.items.every((x) => x.change === null));
  const history = appendHistory([], first, 26);
  metrics.vendors.k.search.value = 50;
  metrics.vendors.k.play.installs = 1e9;
  metrics.vendors.k.play.rating = 5;
  metrics.vendors.k.play.ratings = 1e6;
  const second = computeRanking({ vendors, metrics, site, history, date: '2026-10-26' });
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
