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

/** A titled card holding one horizontal bar chart (label | bar | count). */
function barCard(title, counts, { hideZero = false } = {}) {
  let entries = Object.entries(counts);
  if (hideZero) entries = entries.filter(([, n]) => n > 0);
  const max = Math.max(1, ...entries.map(([, n]) => n));

  const card = el('div', { class: 'chart-card' },
    el('div', { class: 'chart-title' }, title));
  if (!entries.length) {
    card.append(el('div', { class: 'chart-empty' }, 'No data yet'));
    return card;
  }
  for (const [label, n] of entries) {
    card.append(el('div', { class: 'bar-row', title: `${label}: ${n}` },
      el('div', { class: 'bar-label' }, label),
      el('div', { class: 'bar-track' },
        el('div', { class: 'bar-fill', style: `width:${(n / max) * 100}%` })),
      el('div', { class: 'bar-count' }, String(n))));
  }
  return card;
}

/**
 * A titled card holding a column (vertical bar) chart with a y-axis,
 * recessive gridlines, rounded column tops and a native tooltip per column.
 */
function columnCard(title, counts, { wide = false } = {}) {
  const entries = Object.entries(counts);
  const card = el('div', { class: `chart-card${wide ? ' chart-wide' : ''}` },
    el('div', { class: 'chart-title' }, title));
  if (!entries.length || entries.every(([, n]) => n === 0)) {
    card.append(el('div', { class: 'chart-empty' }, 'No data yet'));
    return card;
  }

  // The wide variant fills the page, so its viewBox is proportionally wider —
  // scaling then stays near 1:1 and the axis text keeps its intended size.
  const W = wide ? 1240 : 560, H = 190, padL = 30, padR = 8, padT = 18, padB = 24;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const base = padT + plotH;
  const max = Math.max(...entries.map(([, n]) => n));
  const band = plotW / entries.length;
  const bw = Math.min(44, band * 0.62);

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
    const x = padL + i * band + (band - bw) / 2;
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
      x: padL + i * band + band / 2, y: H - 8,
      'text-anchor': 'middle', class: 'axis-label',
    }, label));
  });

  card.append(chart);
  return card;
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

/** 'Jul 26' from 'YYYY-MM', compact enough for a column axis. */
function monthLabel(ym) {
  const d = new Date(ym + '-01T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short' }) +
         ' ' + String(d.getFullYear()).slice(2);
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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
  const byMonth = countBy(items, i =>
    i.upload_date ? i.upload_date.slice(0, 7) : null);
  const monthCounts = {};
  for (const ym of Object.keys(byMonth).sort()) {
    monthCounts[monthLabel(ym)] = byMonth[ym];
  }

  root.append(el('div', { class: 'dash-grid' },
    donutCard(done, items.length),
    barCard('Pipeline', byStatus),
    barCard('Content type', byType),
    barCard('Performance of posted videos', byPerf),
    barCard('Open work per person', byPerson, { hideZero: true }),
    columnCard('Uploads by weekday', byWeekday)));

  root.append(columnCard('Videos per month', monthCounts, { wide: true }));
}
