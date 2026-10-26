// Layout audit run inside the page. Each check turns an "it looks off" judgement into a measurement.
// The function must stay self-contained because Playwright serializes it into the page.
export function audit({ firstScreen }) {
  const issues = [];
  const label = (el) => {
    const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
    const owner = el.closest('[id]');
    return `${el.tagName.toLowerCase()}${cls}${owner ? ` in #${owner.id}` : ''}`;
  };
  const visible = (el) => {
    const s = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0 && b.width > 0 && b.height > 0;
  };
  const all = (sel) => [...document.querySelectorAll(sel)].filter(visible);

  const doc = document.documentElement;
  if (doc.scrollWidth > window.innerWidth) issues.push(`horizontal scroll ${doc.scrollWidth}>${window.innerWidth}`);

  for (const el of all('.perk, .entry-name, .go-btn, .total, .move, h1, h2, .nav a, .brand, .stamp, .kicker, .part, td')) {
    if (el.scrollWidth > el.clientWidth + 1) issues.push(`clipped text: ${label(el)}`);
  }

  for (const el of all('.go-btn, .menu-btn, .nav a, .crumbs a, .more, .foot nav a, .faq summary, .plain a')) {
    const b = el.getBoundingClientRect();
    if (b.width < 44 || b.height < 44) issues.push(`tap target ${Math.round(b.width)}x${Math.round(b.height)}: ${label(el)}`);
  }

  for (const img of document.images) {
    if (!img.complete || img.naturalWidth === 0) issues.push(`broken image ${img.getAttribute('src')}`);
    if (!img.hasAttribute('alt')) issues.push(`image without alt ${img.getAttribute('src')}`);
  }

  for (const entry of all('.entry')) {
    const e = entry.getBoundingClientRect();
    const go = entry.querySelector('.go-btn').getBoundingClientRect();
    const main = entry.querySelector('.entry-main').getBoundingClientRect();
    if (go.right > e.right + 0.5 || go.left < e.left) issues.push(`button outside card #${entry.id}`);
    if (main.right > go.left + 0.5 && main.bottom > go.top && main.top < go.bottom) issues.push(`name overlaps button #${entry.id}`);
    for (const part of ['.entry-rank', '.entry-name', '.entry-score', '.perks', '.go-btn']) {
      const p = entry.querySelector(part);
      if (!p || !visible(p)) issues.push(`${part} missing in #${entry.id}`);
    }
  }

  // Content poking out of its card.
  for (const box of all('.entry, .profile, .method, .part, .digest, .notice, .trend')) {
    const b = box.getBoundingClientRect();
    for (const child of box.querySelectorAll('*')) {
      if (!visible(child) || child.closest('.peek')) continue;
      const c = child.getBoundingClientRect();
      if (c.right > b.right + 1 || c.left < b.left - 1) {
        issues.push(`sticks out of its card: ${label(child)}`);
        break;
      }
    }
  }

  // Items sharing a line inside a flex row should share a vertical centre.
  for (const row of all('.crumbs ol, .entry-score, .profile-rank, .score-group, .nav ul, .foot nav ul, .kicker, .perks, .profile-mark')) {
    const kids = [...row.children].filter(visible).map((k) => ({ k, b: k.getBoundingClientRect() }));
    const lines = [];
    for (const item of kids) {
      const line = lines.find((l) => item.b.top < l.bottom && item.b.bottom > l.top);
      if (line) {
        line.items.push(item);
        line.top = Math.min(line.top, item.b.top);
        line.bottom = Math.max(line.bottom, item.b.bottom);
      } else lines.push({ top: item.b.top, bottom: item.b.bottom, items: [item] });
    }
    for (const line of lines) {
      const centres = line.items.map((i) => i.b.top + i.b.height / 2);
      if (Math.max(...centres) - Math.min(...centres) > 4) issues.push(`misaligned items in ${label(row)}`);
    }
    const last = lines[lines.length - 1];
    if (lines.length > 1 && last.items.length === 1 && row.matches('.entry-score, .profile-rank, .kicker, .crumbs ol')) {
      const copy = last.items[0].k.cloneNode(true);
      copy.querySelectorAll('.sr').forEach((n) => n.remove());
      const text = copy.textContent.trim();
      if ([...text].length <= 6) issues.push(`"${text}" left alone on its own line in ${label(row)}`);
    }
  }

  const lineTops = (el) => {
    const tops = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.data.trim() || node.parentElement.closest('.sr')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.width < 1) continue;
        if (!tops.some((t) => Math.abs(t - r.top) < r.height / 2)) tops.push(r.top);
      }
    }
    return tops.length;
  };

  // Labels that read badly when they break onto a second line.
  const oneLine = '.go-btn, .total, .move, .perk-tag, .nav a, .flag, .section-head h2, .brand, .issue, .crumbs li, ' +
    '.digest dt, .part h3, .part-value, .table th, .entry-no, .stamp';
  for (const el of all(oneLine)) if (lineTops(el) > 1) issues.push(`wraps onto two lines: ${label(el)}`);

  // A last line holding one or two characters (a widow) looks like a mistake.
  const prose = 'h1, h2, .entry-name, .caveat, .digest p, .method p, .faq p, .notice, .part p, .foot p, .plain p, .perk';
  for (const el of all(prose)) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const chars = [];
    let spaced = true;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement.closest('.sr')) continue;
      for (let i = 0; i < node.data.length; i++) {
        if (/\s/.test(node.data[i])) {
          spaced = true;
          continue;
        }
        const r = document.createRange();
        r.setStart(node, i);
        r.setEnd(node, i + 1);
        const rect = r.getBoundingClientRect();
        if (rect.width > 0) chars.push({ ch: node.data[i], top: Math.round(rect.top), spaced });
        spaced = false;
      }
    }
    if (!chars.length) continue;
    for (let i = 1; i < chars.length; i++) {
      const a = chars[i - 1];
      const b = chars[i];
      if (Math.abs(b.top - a.top) < 4) continue;
      if (!b.spaced && /[\p{L}\p{N}]/u.test(a.ch) && /[\p{L}\p{N}]/u.test(b.ch)) {
        issues.push(`word broken across lines "${a.ch}|${b.ch}": ${label(el)}`);
      }
      if (/[·,.:;)\]」』%]/.test(b.ch)) issues.push(`line starts with "${b.ch}": ${label(el)}`);
    }
    const lastTop = chars[chars.length - 1].top;
    const firstTop = chars[0].top;
    if (lastTop - firstTop < 4) continue;
    const tail = chars.filter((c) => Math.abs(c.top - lastTop) < 4 && /[\p{L}\p{N}]/u.test(c.ch));
    if (tail.length <= 2) issues.push(`widow "${tail.map((c) => c.ch).join('')}": ${label(el)}`);
  }

  // Labels drawn inside charts must not run into each other.
  for (const svg of all('svg')) {
    const texts = [...svg.querySelectorAll('text')].map((t) => t.getBoundingClientRect()).filter((b) => b.width > 0);
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i];
        const b = texts[j];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
          issues.push(`chart labels overlap: ${label(svg)}`);
        }
      }
    }
  }

  // Repeated items in one list should be spaced evenly.
  for (const list of all('.chart, .methods, .parts, .dots, .digest dl, .faq')) {
    const kids = [...list.children].filter(visible).map((k) => k.getBoundingClientRect());
    const gaps = new Set();
    for (let i = 1; i < kids.length; i++) {
      const a = kids[i - 1];
      const b = kids[i];
      if (Math.abs(a.left - b.left) < 1) gaps.add(Math.round(b.top - a.bottom));
      else if (Math.abs(a.top - b.top) < 1) gaps.add(Math.round(b.left - a.right));
    }
    if (gaps.size > 1) issues.push(`uneven gaps ${[...gaps].join('/')}px in ${label(list)}`);
  }

  // Text contrast against the first opaque background behind it (WCAG AA).
  const parse = (c) => {
    const m = c.match(/[\d.]+/g);
    return m ? m.map(Number) : [0, 0, 0, 0];
  };
  const lum = ([r, g, b]) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const bgOf = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if ((c[3] ?? 1) > 0.9) return c;
    }
    return [255, 255, 255];
  };
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const el = walker.currentNode.parentElement;
    if (!walker.currentNode.data.trim() || seen.has(el) || !visible(el) || el.closest('.sr, svg, .peek')) continue;
    seen.add(el);
    const s = getComputedStyle(el);
    const fg = parse(s.color);
    const bg = bgOf(el);
    const alpha = fg[3] ?? 1;
    const mixed = fg.slice(0, 3).map((v, i) => v * alpha + bg[i] * (1 - alpha));
    const [hi, lo] = [lum(mixed), lum(bg)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);
    const size = parseFloat(s.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) issues.push(`contrast ${ratio.toFixed(2)}: ${label(el)}`);
  }

  // Images that came out as a flat box or with a dark frame.
  for (const img of all('img')) {
    if (!img.naturalWidth) continue;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const counts = new Map();
    let opaque = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue;
      opaque++;
      const key = `${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const top = Math.max(0, ...counts.values());
    if (opaque > (data.length / 4) * 0.5 && top / opaque > 0.97) issues.push(`flat box image ${img.getAttribute('src')}`);
    let darkEdge = 0;
    let edge = 0;
    for (let x = 0; x < width; x++) {
      for (const y of [0, height - 1]) {
        const i = (y * width + x) * 4;
        edge++;
        if (data[i + 3] > 200 && data[i] + data[i + 1] + data[i + 2] < 90) darkEdge++;
      }
    }
    if (edge && darkEdge / edge > 0.9 && !img.closest('.entry-icon, .profile-icon')) {
      issues.push(`dark frame around image ${img.getAttribute('src')}`);
    }
  }

  // Too many distinct text sizes reads as an unplanned type scale.
  const sizes = new Set(all('body *').filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.data.trim()))
    .map((e) => getComputedStyle(e).fontSize));
  if (sizes.size > 8) issues.push(`${sizes.size} different text sizes on one page`);

  if (firstScreen) {
    const rows = all('.home .entry').slice(0, 3);
    rows.forEach((row, i) => {
      if (row.getBoundingClientRect().bottom > window.innerHeight) issues.push(`rank ${i + 1} below the fold`);
    });
    const t = document.querySelector('.stamp time');
    if (!t || t.getBoundingClientRect().bottom > window.innerHeight) issues.push('update date below the fold');
  }

  // Blocks must breathe: away from the header, from each other and from the screen edge.
  const header = document.querySelector('.masthead');
  const main = document.querySelector('main');
  if (header && main) {
    const hb = header.getBoundingClientRect().bottom + window.scrollY;
    const isBox = (el) => {
      const s = getComputedStyle(el);
      const bg = s.backgroundColor;
      const hasBg = bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg);
      const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].every((side) => parseFloat(s[`border${side}Width`]) > 0 &&
        s[`border${side}Style`] !== 'none');
      return hasBg || hasBorder || s.backgroundImage !== 'none';
    };
    const boxes = [...main.querySelectorAll('*')].filter((el) => visible(el) && isBox(el) && !el.closest('.sr, table') &&
      el.getBoundingClientRect().width > 120);
    const top = boxes.filter((el) => !boxes.some((o) => o !== el && o.contains(el)));
    const tops = [];
    const tw0 = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    while (tw0.nextNode()) {
      const node = tw0.currentNode;
      if (!node.data.trim() || !visible(node.parentElement) || node.parentElement.closest('.sr')) continue;
      const r = document.createRange();
      r.selectNodeContents(node);
      const rect = r.getBoundingClientRect();
      if (rect.width) tops.push(rect.top + window.scrollY);
    }
    if (tops.length && Math.min(...tops) - hb < 16) issues.push('content touches the header');
    for (const el of top) {
      const b = el.getBoundingClientRect();
      if (b.top + window.scrollY - hb < 24) issues.push(`box too close to the header: ${label(el)}`);
      if (b.left < 8 || b.right > window.innerWidth - 8) issues.push(`box touches the screen edge: ${label(el)}`);
    }
    for (let i = 0; i < top.length; i++) {
      for (let j = i + 1; j < top.length; j++) {
        const a = top[i];
        const c = top[j];
        if (a.parentElement === c.parentElement && a.tagName === c.tagName) continue;
        const ra = a.getBoundingClientRect();
        const rc = c.getBoundingClientRect();
        const overlapX = Math.min(ra.right, rc.right) - Math.max(ra.left, rc.left);
        const overlapY = Math.min(ra.bottom, rc.bottom) - Math.max(ra.top, rc.top);
        if (overlapX > 0) {
          const gap = Math.max(ra.top, rc.top) - Math.min(ra.bottom, rc.bottom);
          if (gap >= 0 && gap < 16) issues.push(`boxes ${gap}px apart: ${label(a)} / ${label(c)}`);
        } else if (overlapY > 0) {
          const gap = Math.max(ra.left, rc.left) - Math.min(ra.right, rc.right);
          if (gap >= 0 && gap < 16) issues.push(`boxes ${gap}px apart: ${label(a)} / ${label(c)}`);
        }
      }
    }
  }

  // Nothing on the first screen may stand out more than the ranking cards.
  const firstEntry = document.querySelector('.entry');
  if (firstEntry && main) {
    const rgb = (c) => (c.match(/[\d.]+/g) || [255, 255, 255]).slice(0, 3).map(Number);
    const lumOf = ([r, g, b]) => {
      const f = (v) => {
        v /= 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (x, y) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    const pageLum = lumOf(rgb(getComputedStyle(document.body).backgroundColor));
    const entryWeight = ratio(lumOf(rgb(getComputedStyle(firstEntry).backgroundColor)), pageLum);
    for (const el of main.querySelectorAll('*')) {
      if (!visible(el) || el.closest('.chart')) continue;
      const b = el.getBoundingClientRect();
      if (b.top > window.innerHeight || b.width * b.height < 20000) continue;
      const bg = getComputedStyle(el).backgroundColor;
      if (/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) continue;
      const weight = ratio(lumOf(rgb(bg)), pageLum);
      if (weight > Math.max(1.5, entryWeight * 1.5)) issues.push(`outshines the ranking on the first screen: ${label(el)}`);
    }
  }

  return {
    issues: [...new Set(issues)],
    links: [...document.querySelectorAll('a[href]')].map((a) => a.href),
    csp: window.__csp ?? [],
  };
}
