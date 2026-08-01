/**
 * Dashboard — the channel at a glance.
 *
 * A row of headline stat tiles, one bar chart per question (pipeline, type,
 * footage bank, weekday), a performance-by-type stacked bar, and the
 * full-width momentum curve. Everything derives from the same content list
 * the other views use, so it is always current.
 *
 * Cards earn their place by changing a decision. A completion ring that only
 * ever crawls toward 100% was cut for that reason.
 *
 * Single-series marks share the accent hue (validated against the dark
 * surface) and identity comes from labels. The one multi-series chart, the
 * performance stack, uses the three status colours and carries its own legend.
 */

import { api } from '../api.js';
import { el, loading, emptyState, STATUSES, TYPES } from '../ui.js';

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

/**
 * One headline number. `tone` colours the value (e.g. 'danger' for overdue).
 * `mediaFilter` makes the tile a shortcut: clicking it opens the library
 * narrowed to that media filter, so a number you care about is one click from
 * the list behind it.
 */
function statTile(label, value, tone, mediaFilter) {
  return el('div', {
    class: `stat-tile${mediaFilter ? ' stat-link' : ''}`,
    title: mediaFilter ? 'Show these in the library' : null,
    onclick: mediaFilter
      ? async () => {
          const app = await import('../app.js');
          app.state.filters.media = mediaFilter;
          location.hash = '#/library';
        }
      : null,
  },
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
 * `area` fills down to the baseline (for cumulative/total series). Values may
 * go negative (momentum); the zero line is then drawn a shade stronger.
 * `zeroOk` keeps an all-zero series as a flat line instead of the empty state.
 */
function lineCard(title, counts, { wide = false, smooth = false, area = false,
                                   zeroOk = false, empty = 'No data yet' } = {}) {
  const entries = Object.entries(counts);
  const card = el('div', { class: `chart-card${wide ? ' chart-wide' : ''}` },
    el('div', { class: 'chart-title' }, title));
  if (!entries.length || (!zeroOk && entries.every(([, n]) => n === 0))) {
    card.append(el('div', { class: 'chart-empty' }, empty));
    return card;
  }
  // One point is not a trend — a lone floating dot on an empty grid reads as
  // a broken chart, so wait for a second point before drawing anything.
  if (entries.length < 2) {
    card.append(el('div', { class: 'chart-empty' },
      'Only one data point so far — the line appears once there are two'));
    return card;
  }

  const W = wide ? 1240 : 610, H = 190, padL = 30, padR = 30, padT = 18, padB = 24;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const base = padT + plotH;
  const nums = entries.map(([, n]) => n);
  const dataMax = Math.max(...nums, 1);
  const dataMin = Math.min(0, ...nums);
  // Pad the domain top and bottom. Without it a series resting at its minimum
  // (a flat run at zero) is drawn exactly on the baseline, where it collides
  // with the x-axis labels and reads as a broken chart.
  const padY = (dataMax - dataMin) * 0.14;
  const scaleMax = dataMax + padY, scaleMin = dataMin - padY;
  const yFor = v => base - ((v - scaleMin) / (scaleMax - scaleMin)) * plotH;
  const step = entries.length > 1 ? plotW / (entries.length - 1) : 0;
  const pts = entries.map(([label, n], i) => ({
    x: entries.length > 1 ? padL + i * step : padL + plotW / 2,
    y: yFor(n), label, n,
  }));

  const chart = svg('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'colchart linechart',
    role: 'img', 'aria-label': title,
  });

  // Ticks stay on the real data range — the padding above is scale-only and
  // must not invent axis values like "1.4".
  const ticks = dataMin < 0 ? [dataMin, 0, dataMax]
    : dataMax >= 4 ? [0, Math.round(dataMax / 2), dataMax] : [0, dataMax];
  for (const t of [...new Set(ticks)]) {
    const y = yFor(t);
    chart.append(
      svg('line', { x1: padL, x2: W - padR, y1: y, y2: y,
                    class: t === 0 && dataMin < 0 ? 'gridline zeroline' : 'gridline' }),
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
    if (labelAll || p.n === dataMax || i === pts.length - 1) {
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
 * Footage bank — the production funnel by *material*, not by status label:
 * shot -> cut -> published. The top row is the one that plans next week,
 * since it is work you can do without filming anything new.
 *
 * Counts media rather than the Status field, so an entry left on the wrong
 * status still lands in the right bucket here.
 */
function footageCard(items) {
  const rawOnly   = items.filter(i => i.raw_count > 0 && i.final_count === 0).length;
  const cutOnly   = items.filter(i => i.final_count > 0 && i.status !== 'Posted').length;
  const published = items.filter(i => i.status === 'Posted').length;
  const rawFiles  = items.reduce((n, i) => n + i.raw_count, 0);

  const card = barCard('Footage bank', {
    'Shot, not cut': rawOnly,
    'Cut, not posted': cutOnly,
    'Published': published,
  }, { empty: 'No footage uploaded yet' });

  // The line the card exists for: what is makeable with no new filming.
  card.append(el('div', { class: 'chart-empty' },
    rawOnly
      ? `${rawOnly} ${rawOnly === 1 ? 'entry' : 'entries'} editable now · ` +
        `${rawFiles} raw ${rawFiles === 1 ? 'file' : 'files'} banked`
      : 'Every clip you have shot is already cut'));
  return card;
}

/**
 * Performance-by-type card — a horizontal stacked bar per content type
 * (Viral | Average | Failed segments in the status colours), sorted by how
 * many rated videos the type has. The same label | bar | count anatomy as
 * barCard, so it reads instantly next to the other cards; only types with
 * at least one rated video get a row.
 */
function perfStackCard(title, items, { empty = 'No data yet' } = {}) {
  const PERF = ['Viral', 'Average', 'Failed'];
  const rated = items.filter(i => i.performance && i.type);
  const groups = TYPES
    .map(t => {
      const of = rated.filter(i => i.type === t.value);
      return { type: t.value,
               counts: PERF.map(p => of.filter(i => i.performance === p).length),
               total: of.length };
    })
    .filter(g => g.total > 0)
    .sort((a, b) => b.total - a.total);

  const card = el('div', { class: 'chart-card' },
    el('div', { class: 'chart-title' }, title));
  if (!groups.length) {
    card.append(el('div', { class: 'chart-empty' }, empty));
    return card;
  }

  const max = Math.max(...groups.map(g => g.total));
  for (const g of groups) {
    // The stack fills total/max of the track; inside it each segment's flex
    // share is its count, and the flex gap is the 2px surface spacer.
    card.append(el('div', { class: 'bar-row' },
      el('div', { class: 'bar-label' }, g.type),
      el('div', { class: 'bar-track' },
        el('div', { class: 'stack-fill', style: `width:${(g.total / max) * 100}%` },
          g.counts.map((n, i) => n
            ? el('div', { class: `stack-seg perf-${PERF[i].toLowerCase()}`,
                          style: `flex-grow:${n}`,
                          title: `${g.type} — ${PERF[i]}: ${n}` })
            : null))),
      el('div', { class: 'bar-count' }, String(g.total))));
  }
  card.append(el('div', { class: 'chart-legend' },
    PERF.map(p => el('span', { class: 'legend-item' },
      el('span', { class: `legend-dot perf-${p.toLowerCase()}` }), p))));
  return card;
}

/**
 * Content type as a two-part stack: how much of each type is still BANKED
 * (shot, no final cut) versus already CUT. Emphasis colouring — the banked
 * part wears the accent because it is the actionable half, the cut part
 * recedes to grey — so the card answers "what can I make next?" rather than
 * just "what have I made?".
 *
 * Sorted by total, biggest first: these are magnitudes to compare, and a
 * magnitude chart reads fastest in rank order rather than vocabulary order.
 * Types you have never used stay at the bottom on zero, which is itself
 * information.
 */
function typeStackCard(title, items, { empty = 'No data yet' } = {}) {
  const groups = TYPES
    .map(t => {
      const of = items.filter(i => i.type === t.value);
      const cut = of.filter(i => i.final_count > 0).length;
      return { type: t.value, cut, banked: of.length - cut, total: of.length };
    })
    .sort((a, b) => b.total - a.total);

  const card = el('div', { class: 'chart-card' },
    el('div', { class: 'chart-title' }, title));
  if (!groups.some(g => g.total)) {
    card.append(el('div', { class: 'chart-empty' }, empty));
    return card;
  }

  const max = Math.max(...groups.map(g => g.total));
  for (const g of groups) {
    card.append(el('div', { class: `bar-row${g.total ? '' : ' bar-zero'}` },
      el('div', { class: 'bar-label' }, g.type),
      el('div', { class: 'bar-track' },
        g.total
          ? el('div', { class: 'stack-fill', style: `width:${(g.total / max) * 100}%` },
              g.banked ? el('div', { class: 'stack-seg seg-banked',
                                     style: `flex-grow:${g.banked}`,
                                     title: `${g.type} — banked: ${g.banked}` }) : null,
              g.cut ? el('div', { class: 'stack-seg seg-cut',
                                  style: `flex-grow:${g.cut}`,
                                  title: `${g.type} — cut: ${g.cut}` }) : null)
          : null),
      el('div', { class: 'bar-count' }, String(g.total))));
  }
  card.append(el('div', { class: 'chart-legend' },
    el('span', { class: 'legend-item' },
      el('span', { class: 'legend-dot seg-banked' }), 'Banked'),
    el('span', { class: 'legend-item' },
      el('span', { class: 'legend-dot seg-cut' }), 'Cut')));
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

/**
 * Channel momentum: each rated video moves a running score — Viral +1,
 * Average holds, Failed −1 — so a viral streak climbs and flops pull it down.
 * One point per rated video, in upload order.
 */
function momentum(items) {
  const rated = items
    .filter(i => i.performance)
    .sort((a, b) => {
      const da = a.upload_date || a.created_at.slice(0, 10);
      const db = b.upload_date || b.created_at.slice(0, 10);
      return da < db ? -1 : da > db ? 1 : a.id - b.id;
    });
  if (!rated.length) return {};
  // Anchor the series at zero. Without this the line STARTS at the first
  // video's score, so a viral opener renders as a high flat point and its
  // climb is invisible — the chart then reads as a decline no matter what
  // actually happened.
  const out = { Start: 0 };
  let score = 0;
  rated.forEach((v, i) => {
    score += v.performance === 'Viral' ? 1 : v.performance === 'Failed' ? -1 : 0;
    const d = new Date((v.upload_date || v.created_at.slice(0, 10)) + 'T00:00:00');
    // The index prefix keeps same-day keys unique and reads as video order.
    out[`${i + 1} · ${d.toLocaleDateString(undefined,
        { month: 'short', day: 'numeric' })}`] = score;
  });
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
  // Cut, but never put on the channel — the finished work that is sitting
  // still. Not the same as "not done": the edit exists, the upload doesn't.
  const toUpload = items.filter(i =>
    i.final_count > 0 && i.status !== 'Posted').length;

  root.append(el('div', { class: 'stat-row' },
    statTile('Videos', items.length),
    statTile('Posted', posted),
    statTile('Edits done', done),
    statTile(overdue ? '⚠ Overdue' : 'Overdue', overdue,
             overdue ? 'danger' : null),
    statTile(toUpload ? '⬆ To upload' : 'To upload', toUpload,
             toUpload ? 'ready' : null, 'unposted'),
    statTile('With files', withMedia)));

  const byStatus = countBy(items, i => i.status, STATUSES.map(s => s.value));
  const monthCounts = fillMonthRange(countBy(items, i =>
    i.upload_date ? i.upload_date.slice(0, 7) : null));

  // A row of three, one half-width pair, then the full-width momentum curve.
  // Every card here has to survive one question: does it change what I do
  // next? Weekday-of-upload and uploads-per-week did not — the first showed
  // seven near-identical bars, the second re-plotted the same handful of
  // dates the month line already carries.
  root.append(el('div', { class: 'dash-grid' },
    barCard('Pipeline', byStatus),
    typeStackCard('Content type — banked vs cut', items,
      { empty: 'No videos have a type yet' }),
    footageCard(items)));

  root.append(el('div', { class: 'dash-grid dash-2' },
    perfStackCard('Performance by type', items,
      { empty: 'Rate posted videos (Viral / Average / Failed) and give them a type — the chart draws itself' }),
    lineCard('Videos per month', monthCounts,
      { empty: 'No uploads dated yet' })));

  root.append(lineCard('Channel momentum — Viral climbs, Failed drops', momentum(items),
    { wide: true, smooth: true, zeroOk: true,
      empty: 'Rate posted videos (Viral / Average / Failed) and momentum charts itself' }));
}
