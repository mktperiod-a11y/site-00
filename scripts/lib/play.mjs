// Parses the public Google Play detail page (Korean locale) into download and rating figures.

function callbackData(html, key) {
  const re = /AF_initDataCallback\(\{key:\s*'([^']+)'[\s\S]*?data:([\s\S]*?), sideChannel: \{\}\}\);/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1] !== key) continue;
    try {
      return JSON.parse(m[2]);
    } catch {
      return null;
    }
  }
  return null;
}

const dig = (obj, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), obj);

export function koreanCount(text) {
  if (!text) return null;
  const m = String(text).replace(/,/g, '').match(/([\d.]+)\s*(천|만|억)?/);
  if (!m) return null;
  const unit = { 천: 1e3, 만: 1e4, 억: 1e8 }[m[2]] ?? 1;
  const n = Number(m[1]) * unit;
  return Number.isFinite(n) ? Math.round(n) : null;
}

function fromVisibleText(html) {
  const out = {};
  const dl = html.match(/>([\d.,]+\s*(?:천|만|억)?\+?)<\/div><div[^>]*>다운로드</);
  if (dl) out.installs = koreanCount(dl[1]);
  const star = html.match(/별표 5개 만점에 ([\d.]+)개를 받았습니다/);
  if (star) out.rating = Number(star[1]);
  const reviews = html.match(/리뷰\s*([\d.,]+\s*(?:천|만|억)?)\s*개/);
  if (reviews) out.ratings = koreanCount(reviews[1]);
  return out;
}

export function parsePlay(html) {
  const ds = callbackData(html, 'ds:5');
  const d = dig(ds, [1, 2]);
  const out = {
    installs: dig(d, [13, 2]) ?? dig(d, [13, 1]) ?? null,
    minInstalls: dig(d, [13, 1]) ?? null,
    rating: dig(d, [51, 0, 1]) ?? null,
    ratings: dig(d, [51, 2, 1]) ?? null,
  };
  const visible = fromVisibleText(html);
  for (const k of ['installs', 'rating', 'ratings']) {
    if (typeof out[k] !== 'number' || !Number.isFinite(out[k])) out[k] = visible[k] ?? null;
  }
  if (out.rating !== null) out.rating = Math.round(out.rating * 1000) / 1000;
  if (out.installs === null && out.rating === null) throw new Error('store page could not be parsed');
  return out;
}

export function playIcon(html) {
  const m = html.match(/<meta property="og:image" content="([^"]+)"/);
  return m ? m[1] : null;
}
