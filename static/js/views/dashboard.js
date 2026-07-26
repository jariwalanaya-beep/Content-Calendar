/**
 * Dashboard — the channel at a glance.
 *
 * A row of headline stat tiles, a completion donut, one bar chart per
 * question (pipeline, type, performance, workload), a columns-by-weekday
 * graph, and a full-width videos-per-month graph. Everything derives from the
 * same content list the other views use, so it is always current.
 *
 * All marks share the single accent hue (validated against the dark surface);
 * identity comes from labels, so no legend is needed anywhere.
 */

import { api } from '../api.js';
import { el, loading, emptyState, STATUSES, TYPES, PERFORMANCES } from '../ui.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** el() twin for SVG — same signature, namespaced elements. */
function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Count items by a key function, keeping `keys` order when given. */
function countBy(items, keyFn, keys) {
  const counts = {};
  if (keys) for (const k of keys) counts[k] = 0;
  for (const item of items) {
    const k = keyFn(item);
    if (!k) continue;
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

/** One headline number. `tone` colours the value (e.g. 'danger' for overdue). */
function statTile(label, value, tone) {
  return el('div', { class: 'stat-tile' },
    el('div', { class: `stat-value${tone ? ` stat-${tone}` : ''}` }, String(value)),
    el('div', { class: 'stat-label' }, label));
}

/**
 * A titled card holding one horizontal bar chart (label | bar | count).
 * A chart where every value is zero says nothing, so it collapses to the
 * `empty` message instead of rendering a wall of empty tracks.
 */
function barCard(title, counts, { hideZero = false, empty = 'No data yet' } = {}) {
  let entries = Object.entries(counts);
  if (hideZero) entries = entries.filter(([, n]) => n > 0);
  const max = Math.max(1, ...entries.map(([, n]) => n));

  const card = el('div', { class: 'chart-card' },
    el('div', { class: 'chart-title' }, title));
  if (!entries.length || entries.every(([, n]) => n === 0)) {
    card.append(el('div', { class: 'chart-empty' }, empty));
    return card;
  }
  for (const [label, n] of entries) {
    // Zero rows stay (an empty pipeline stage is information) but draw no
    // fill — a 2px sliver would read as "almost one".
    card.append(el('div', { class: `bar-row${n ? '' : ' bar-zero'}`,
                            title: `${label}: ${n}` },
      el('div', { class: 'bar-label' }, label),
      el('div', { class: 'bar-track' },
        n ? el('div', { class: 'bar-fill', style: `width:${(n / max) * 100}%` })
          : null),
      el('div', { class: 'bar-count' }, String(n))));
  }
  return card;
}

/**
 * A titled card holding a column (vertical bar) chart with a y-axis,
 * recessive gridlines, rounded column tops and a native tooltip per column.
 * `contiguous` is the histogram variant: adjacent bins touch, separated only
 * by a 2px surface gap, because the x-axis is one continuous scale.
 */
function columnCard(title, counts, { wide = false, contiguous = false,
                                     empty = 'No data yet' } = {}) {
  const entries = Object.entries(counts);
  const card = el('div', { class: `chart-card${wide ? ' chart-wide' : ''}` },
    el('div', { class: 'chart-title' }, title));
  if (!entries.length || entries.every(([, n]) => n === 0)) {
    card.append(el('div', { class: 'chart-empty' }, empty));
    return card;
  }

  // The viewBox tracks the rendered size (a ~400px card, or the full page for
  // the wide variant) so SVG units stay near 1:1 CSS pixels and the axis text
  // renders at its intended size instead of scaling down.
  const W = wide ? 1240 : 400, H = 190, padL = 30, padR = 8, padT = 18, padB = 24;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const base = padT + plotH;
  const max = Math.max(...entries.map(([, n]) => n));
  // Cap the band so a handful of columns cluster at a readable width in the
  // middle instead of drifting hundreds of pixels apart across a wide plot.
  const band = Math.min(plotW / entries.length, contiguous ? 130 : 110);
  const startX = padL + (plotW - band * entries.length) / 2;
  const bw = contiguous ? band - 2 : Math.min(44, band * 0.62);

  const chart = svg('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'colchart', role: 'img',
    'aria-label': title,
  });

  // Gridlines + y labels at 0, mid (when useful) and max — recessive.
  const ticks = max >= 4 ? [0, Math.round(max / 2), max] : [0, max];
  for (const t of [...new Set(ticks)]) {
    const y = base - (t / max) * plotH;
    chart.append(
      svg('line', { x1: padL, x2: W - padR, y1: y, y2: y, class: 'gridline' }),
      svg('text', { x: padL - 6, y: y + 3, 'text-anchor': 'end',
                    class: 'axis-label' }, t));
  }

  entries.forEach(([label, n], i) => {
    const x = startX + i * band + (band - bw) / 2;
    const h = (n / max) * plotH;
    const y = base - h;
    const r = Math.min(4, h);          // rounded top, flat baseline

    const col = svg('path', {
      class: 'col-bar',
      d: `M${x},${base} L${x},${y + r} Q${x},${y} ${x + r},${y}` +
         ` L${x + bw - r},${y} Q${x + bw},${y} ${x + bw},${y + r}` +
         ` L${x + bw},${base} Z`,
    }, svg('title', {}, `${label}: ${n}`));
    chart.append(col);

    // Direct value label above the column; skip zeros to reduce noise.
    if (n > 0) {
      chart.append(svg('text', {
        x: x + bw / 2, y: y - 5, 'text-anchor': 'middle', class: 'col-value',
      }, n));
    }
    chart.append(svg('text', {
      x: startX + i * band + band / 2, y: H - 8,
      'text-anchor': 'middle', class: 'axis-label',
    }, label));
  });

  card.append(chart);
  return card;
}

/** Catmull-Rom spline through the points, as an SVG cubic-bezier path. */
function splinePath(pts, yMin, yMax) {
  if (pts.length < 3) {
    return 'M' + pts.map(p => `${p.x},${p.y}`).join(' L');
  }
  const clamp = y => Math.max(yMin, Math.min(yMax, y));
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i];
    const p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += ` C${p1.x + (p2.x - p0.x) / 6},${clamp(p1.y + (p2.y - p0.y) / 6)}` +
         ` ${p2.x - (p3.x - p1.x) / 6},${clamp(p2.y - (p3.y - p1.y) / 6)}` +
         ` ${p2.x},${p2.y}`;
  }
  return d;
}

/**
 * Line chart card. `smooth` draws a spline instead of straight segments;
 * `area` fills down to the baseline (for cumulative/total series).
 */
function lineCard(title, counts, { wide = false, smooth = false, area = false,
                                   empty = 'No data yet' } = {}) {
  const entries = Object.entries(counts);
  const card = el('div', { class: `chart-card${wide ? ' chart-wide' : ''}` },
    el('div', { class: 'chart-title' }, title));
  if (!entries.length || entries.every(([, n]) => n === 0)) {
    card.append(el('div', { class: 'chart-empty' }, empty));
    return card;
  }

  const W = wide ? 1240 : 610, H = 190, padL = 30, padR = 30, padT = 18, padB = 24;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const base = padT + plotH;
  const max = Math.max(...entries.map(([, n]) => n));
  const step = entries.length > 1 ? plotW / (entries.length - 1) : 0;
  const pts = entries.map(([label, n], i) => ({
    x: entries.length > 1 ? padL + i * step : padL + plotW / 2,
    y: base - (n / max) * plotH, label, n,
  }));

  const chart = svg('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'colchart linechart',
    role: 'img', 'aria-label': title,
  });

  const ticks = max >= 4 ? [0, Math.round(max / 2), max] : [0, max];
  for (const t of [...new Set(ticks)]) {
    const y = base - (t / max) * plotH;
    chart.append(
      svg('line', { x1: padL, x2: W - padR, y1: y, y2: y, class: 'gridline' }),
      svg('text', { x: padL - 6, y: y + 3, 'text-anchor': 'end',
                    class: 'axis-label' }, t));
  }

  const path = smooth ? splinePath(pts, padT, base)
                      : 'M' + pts.map(p => `${p.x},${p.y}`).join(' L');
  if (area && pts.length > 1) {
    chart.append(svg('path', {
      class: 'area-fill',
      d: `${path} L${pts[pts.length - 1].x},${base} L${pts[0].x},${base} Z`,
    }));
  }
  if (pts.length > 1) chart.append(svg('path', { class: 'line-stroke', d: path }));

  // Markers with tooltips on every point; direct value labels only while the
  // series is short — past that, peaks and the endpoint carry the story.
  const labelAll = pts.length <= 12;
  const labelEvery = Math.ceil(pts.length / (wide ? 16 : 8));
  const dotR = pts.length > 60 ? 2.5 : 4;    // a year of days would crowd
  pts.forEach((p, i) => {
    chart.append(svg('circle', { cx: p.x, cy: p.y, r: dotR, class: 'line-dot' },
      svg('title', {}, `${p.label}: ${p.n}`)));
    if (labelAll || p.n === max || i === pts.length - 1) {
      // The first point sits on the y-axis; anchor its label rightward so it
      // cannot collide with the tick numbers.
      chart.append(svg('text', {
        x: i === 0 ? p.x + 7 : p.x, y: p.y - 9,
        'text-anchor': i === 0 ? 'start' : 'middle', class: 'col-value',
      }, p.n));
    }
    if (i % labelEvery === 0 || i === pts.length - 1) {
      chart.append(svg('text', { x: p.x, y: H - 8, 'text-anchor': 'middle',
                                 class: 'axis-label' }, p.label));
    }
  });

  card.append(chart);
  return card;
}

/**
 * Radar card — one spoke per category. Fits cyclical categories (weekdays),
 * where the shape reads as the week's rhythm at a glance.
 */
function radarCard(title, counts, { empty = 'No data yet' } = {}) {
  const entries = Object.entries(counts);
  const card = el('div', { class: 'chart-card radar-card' },
    el('div', { class: 'chart-title' }, title));
  const max = Math.max(...entries.map(([, n]) => n));
  if (!entries.length || max === 0) {
    card.append(el('div', { class: 'chart-empty' }, empty));
    return card;
  }

  const W = 300, H = 228, cx = W / 2, cy = H / 2 + 4, R = 76;
  const k = entries.length;
  const pt = (i, r) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / k;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const ring = r => entries.map((_, i) => pt(i, r).join(',')).join(' ');

  const chart = svg('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'radar', role: 'img', 'aria-label': title,
  });

  // Grid: two rings (max, half) plus a spoke per category — all recessive.
  chart.append(
    svg('polygon', { points: ring(R), class: 'radar-ring' }),
    svg('polygon', { points: ring(R / 2), class: 'radar-ring' }));
  entries.forEach((_, i) => {
    const [x, y] = pt(i, R);
    chart.append(svg('line', { x1: cx, y1: cy, x2: x, y2: y, class: 'radar-ring' }));
  });
  if (max >= 2) {
    chart.append(
      svg('text', { x: cx + 5, y: cy - R + 11, class: 'axis-label' }, max),
      svg('text', { x: cx + 5, y: cy - R / 2 + 11, class: 'axis-label' },
          Math.round(max / 2)));
  }

  // The data polygon, then a marker + tooltip per vertex.
  chart.append(svg('polygon', {
    class: 'radar-fill',
    points: entries.map(([, n], i) => pt(i, (n / max) * R).join(',')).join(' '),
  }));
  entries.forEach(([label, n], i) => {
    const [x, y] = pt(i, (n / max) * R);
    chart.append(svg('circle', { cx: x, cy: y, r: 3.5, class: 'line-dot' },
      svg('title', {}, `${label}: ${n}`)));
    const [lx, ly] = pt(i, R + 13);
    const cos = Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / k);
    chart.append(svg('text', {
      x: lx, y: ly + 3.5, class: 'axis-label',
      'text-anchor': cos > 0.35 ? 'start' : cos < -0.35 ? 'end' : 'middle',
    }, label));
  });

  card.append(chart);
  return card;
}

/** Bucket numeric values into equal bins with round edges, for a histogram. */
function histogramBins(values) {
  const max = Math.max(...values);
  // Bin width snapped to 1/2/5 × 10ⁿ so edges land on round numbers.
  const raw = Math.max(1, (max + 1) / 6);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const width = [1, 2, 5, 10].map(m => m * mag).find(w => w >= raw);
  const bins = {};
  for (let lo = 0; lo <= max; lo += width) bins[`${lo}–${lo + width - 1}`] = 0;
  for (const v of values) {
    const lo = Math.floor(v / width) * width;
    bins[`${lo}–${lo + width - 1}`]++;
  }
  return bins;
}

/** Donut showing how much of the assigned work is signed off. */
function donutCard(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const r = 52, c = 2 * Math.PI * r;

  const card = el('div', { class: 'chart-card donut-card' },
    el('div', { class: 'chart-title' }, 'Edits completed'));
  card.append(
    svg('svg', { viewBox: '0 0 140 140', class: 'donut',
                 role: 'img', 'aria-label': `${pct}% of edits completed` },
      svg('circle', { cx: 70, cy: 70, r, class: 'donut-track' }),
      // At 0% the rounded line-cap would still paint a dot, so skip the arc.
      pct === 0 ? null : svg('circle', {
        cx: 70, cy: 70, r, class: 'donut-arc',
        'stroke-dasharray': `${(c * pct) / 100} ${c}`,
        transform: 'rotate(-90 70 70)',
      }, svg('title', {}, `${done} of ${total} done`)),
      svg('text', { x: 70, y: 68, 'text-anchor': 'middle',
                    class: 'donut-pct' }, `${pct}%`),
      svg('text', { x: 70, y: 88, 'text-anchor': 'middle',
                    class: 'donut-sub' }, `${done} of ${total}`)),
    el('div', { class: 'chart-empty' },
       total ? 'of all videos marked Done' : 'No videos yet'));
  return card;
}

/** 'Jul ’26' from 'YYYY-MM' — the apostrophe keeps it reading as a year. */
function monthLabel(ym) {
  const d = new Date(ym + '-01T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short' }) +
         ' ’' + String(d.getFullYear()).slice(2);
}

/**
 * Fill the gaps so the month axis is a continuous timeline: a quiet month
 * shows as zero rather than silently vanishing, which would make its
 * neighbours look adjacent in time when they are not.
 */
function fillMonthRange(byMonth) {
  const yms = Object.keys(byMonth).sort();
  if (!yms.length) return {};
  const out = {};
  let [y, m] = yms[0].split('-').map(Number);
  const last = yms[yms.length - 1];
  for (let ym = yms[0]; ym <= last;
       m = m === 12 ? 1 : m + 1, y = m === 1 ? y + 1 : y,
       ym = `${y}-${String(m).padStart(2, '0')}`) {
    out[monthLabel(ym)] = byMonth[ym] || 0;
  }
  return out;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Cumulative library size at the end of each day, from creation dates —
 * the total-so-far curve the growth area chart plots. Runs up to today, so
 * a quiet stretch shows as a plateau instead of the curve just stopping.
 */
function growthByDay(items) {
  const days = items.map(i => i.created_at.slice(0, 10)).sort();
  if (!days.length) return {};
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` +
                   `-${String(d.getDate()).padStart(2, '0')}`;
  const out = {};
  const today = iso(new Date());
  let total = 0, next = 0;
  for (const d = new Date(days[0] + 'T00:00:00'); ; d.setDate(d.getDate() + 1)) {
    const day = iso(d);
    while (next < days.length && days[next] <= day) { total++; next++; }
    out[d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })] = total;
    if (day >= today) break;
  }
  return out;
}

export async function renderDashboard(root, state) {
  const spinner = loading();
  root.append(spinner);
  const items = await api.listContent({ search: state.search });
  spinner.remove();

  root.append(el('div', { class: 'view-header' },
    el('h1', { class: 'view-title' }, 'Dashboard'),
    el('span', { class: 'view-sub' },
      state.search ? `matching “${state.search}”` : 'the whole library')));

  if (!items.length) {
    root.append(emptyState('📊', 'Nothing to chart yet',
      'Add a few videos and the dashboard fills itself in.'));
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const posted = items.filter(i => i.status === 'Posted').length;
  const done = items.filter(i => i.done).length;
  const overdue = items.filter(i =>
    !i.done && i.deadline && i.deadline < today).length;
  const withMedia = items.filter(i => i.raw_count + i.final_count > 0).length;

  root.append(el('div', { class: 'stat-row' },
    statTile('Videos', items.length),
    statTile('Posted', posted),
    statTile('Edits done', done),
    statTile(overdue ? '⚠ Overdue' : 'Overdue', overdue,
             overdue ? 'danger' : null),
    statTile('With files', withMedia)));

  const byStatus = countBy(items, i => i.status, STATUSES.map(s => s.value));
  const byType = countBy(items, i => i.type, TYPES.map(t => t.value));
  const byPerf = countBy(items, i => i.performance,
                         PERFORMANCES.map(p => p.value));
  const byPerson = countBy(items.filter(i => !i.done && i.assigned_to.trim()),
                           i => i.assigned_to.trim());
  const byWeekday = countBy(items, i => {
    if (!i.upload_date) return null;
    const dow = new Date(i.upload_date + 'T00:00:00').getDay();
    return WEEKDAYS[(dow + 6) % 7];          // shift to Monday-first
  }, WEEKDAYS);
  const monthCounts = fillMonthRange(countBy(items, i =>
    i.upload_date ? i.upload_date.slice(0, 7) : null));
  const scriptWords = items
    .filter(i => i.script.trim())
    .map(i => i.script.trim().split(/\s+/).length);

  // Two balanced rows of three, a pair of half-width charts, then the
  // full-width growth curve.
  root.append(el('div', { class: 'dash-grid' },
    barCard('Pipeline', byStatus),
    barCard('Content type', byType,
      { empty: 'No videos have a type yet' }),
    donutCard(done, items.length),
    barCard('Open work per person', byPerson,
      { hideZero: true, empty: 'Nothing is assigned right now' }),
    barCard('Performance of posted videos', byPerf,
      { empty: 'No posted videos have been rated yet' }),
    radarCard('Uploads by weekday', byWeekday,
      { empty: 'No uploads dated yet' })));

  root.append(el('div', { class: 'dash-grid dash-2' },
    columnCard('Script length (words per script)',
      scriptWords.length ? histogramBins(scriptWords) : {},
      { contiguous: true, empty: 'No scripts written yet' }),
    lineCard('Videos per month', monthCounts,
      { empty: 'No uploads dated yet' })));

  root.append(lineCard('Library growth (total videos)', growthByDay(items),
    { wide: true, smooth: true, area: true }));
}
