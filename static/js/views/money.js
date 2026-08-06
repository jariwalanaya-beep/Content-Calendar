/**
 * Money — the ledger, read as a business rather than as a list.
 *
 * Every row is still one income or expense entry, but three columns classify
 * it, and every figure on the page falls out of that classification:
 *
 *   bucket    Business | Personal | Savings. ONLY Business rows reach
 *             revenue, cost, net and margin. Personal spending is not a cost
 *             of making videos, and money moved aside is not money spent —
 *             folding either into Net is the mistake this view exists to
 *             stop.
 *   category  what the money was. Editor fee and Clipper fee are the
 *             PRODUCTION pair: they scale with how much you post, so they
 *             alone divide into cost-per-video. Every other expense is
 *             overhead, owed whether you post or not.
 *   recurring a cost that repeats every month. Revenue has to clear the sum
 *             of these before anything else is profit.
 *
 * ⚠ Saving stays outside the arithmetic, as it always has: `signed` ignores
 * it, no ledger total picks it up, and the Saved tile is its own readout.
 *
 * All of it is derived here from the one /api/money list — the server stores
 * the columns and filters on them, but owns none of these definitions.
 */

import { api } from '../api.js';
import {
  el, textCell, selectCell, dropdown, loading, toast, emptyState, confirmDialog,
  formatMonth,
} from '../ui.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** el() twin for SVG — same signature, namespaced elements. */
function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    node.setAttribute(k, v);
  }
  // flat(Infinity), not flat(): a chart maps each data point to a GROUP of
  // marks (dot + value + axis label), so children arrive nested two deep. A
  // single flatten leaves the inner arrays intact, and an array is not a
  // Node — it would be stringified into a text node, which SVG then refuses
  // to draw. The marks would vanish in total silence.
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const DIRECTIONS = [
  { value: 'Income',  color: 't3'  },
  { value: 'Expense', color: 'n'   },
];

// Which pot the row belongs to. Business is the default because almost every
// row is one; the other two exist to be held OUT of the business totals.
const BUCKETS = [
  { value: 'Business', color: 'n'  },
  { value: 'Personal', color: 't1' },
  { value: 'Savings',  color: 't2' },
];

// Mirrors MoneyCategory in models.py — the enum there validates what these
// send, so the two lists have to stay in step.
const CATEGORIES = {
  Income:  ['Content payout', 'Brand deal', 'Affiliate', 'Other income'],
  Expense: ['Editor fee', 'Clipper fee', 'Tools & subs', 'Verification',
            'Ads / boost', 'Personal', 'Set aside', 'Other expense'],
};
const ALL_CATEGORIES = [...CATEGORIES.Income, ...CATEGORIES.Expense];

// The two categories that scale with output. Cost-per-video divides by these
// and nothing else, so a month of tool renewals cannot inflate it.
const PRODUCTION = new Set(['Editor fee', 'Clipper fee']);

// Picking one of these re-files the row automatically: a "Set aside" row that
// stayed in the Business bucket would drag Net down, which is the exact bug
// the buckets were added to prevent.
const CATEGORY_BUCKET = { 'Set aside': 'Savings', Personal: 'Personal' };

// Editor fees are booked Unpaid when a video is marked Done; flip them to
// Paid once the payout actually happens. '—' means not applicable.
const PAID_STATES = [
  { value: 'Paid',   color: 't3'   },
  { value: 'Unpaid', color: 'warn' },
];

/** '₹63,000' / '−₹1,999' with Indian digit grouping. */
const rupees = n =>
  (n < 0 ? '−₹' : '₹') + Math.abs(Math.round(n)).toLocaleString('en-IN');

const monthOf = row => (row.date || '').slice(0, 7);

// Filters survive re-renders (an inline save re-renders the view). `goalMode`
// too: which figure the goal bar tracks is a preference, not a filter.
const filters = { month: '', bucket: '', category: '', direction: '', paid: '' };
let goalMode = 'net';

const refresh = () => import('../app.js').then(m => m.refresh());

/* ------------------------------------------------------------------------ *
 * The one place the money model is defined. Everything on the page reads
 * from this, so a rule only ever has to change here.
 * ------------------------------------------------------------------------ */
function metrics(rows) {
  const sum = fn => rows.filter(fn).reduce((t, r) => t + (r.amount || 0), 0);
  const biz = r => r.bucket === 'Business';

  const revenue    = sum(r => biz(r) && r.direction === 'Income');
  const production = sum(r => biz(r) && r.direction === 'Expense'
                                     && PRODUCTION.has(r.category));
  const overhead   = sum(r => biz(r) && r.direction === 'Expense'
                                     && !PRODUCTION.has(r.category));
  const personal   = sum(r => r.bucket === 'Personal');
  // Money set aside, however it was recorded: a standalone Savings row, or
  // the per-entry saving figure. Neither is a cost, so neither touches net.
  const saved      = sum(r => r.bucket === 'Savings')
                   + rows.reduce((t, r) => t + (r.saving || 0), 0);
  // Videos paid for, not videos posted — this is what production bought.
  const videos     = rows.filter(r => PRODUCTION.has(r.category)).length;
  const net        = revenue - production - overhead;

  return {
    revenue, production, overhead, personal, saved, videos, net,
    cost: production + overhead,
    margin: revenue ? (net / revenue) * 100 : 0,
    perVideo: videos ? production / videos : 0,
    // Both sides of what is still outstanding. Always answered from the rows
    // in view, so a month filter answers it for that month.
    iOwe:   sum(r => r.direction === 'Expense' && r.paid === 'Unpaid'),
    owedMe: sum(r => r.direction === 'Income'  && r.paid === 'Unpaid'),
  };
}

/** One tile: big number, label, and a line saying what it means. */
const tile = (value, label, sub, cls = '') =>
  el('div', { class: 'stat-tile' },
    el('div', { class: `stat-value ${cls}` }, value),
    el('div', { class: 'stat-label' }, label),
    el('div', { class: 'stat-note' }, sub));

/* ------------------------------------------------------------------------ *
 * Charts. All of them are inline SVG with the fills carried by CSS classes,
 * because a `fill="var(--x)"` presentation attribute does not resolve.
 * ------------------------------------------------------------------------ */

const chartCard = (title, ...body) =>
  el('div', { class: 'chart-card' },
    el('div', { class: 'chart-title' }, title), ...body);

const chartEmpty = msg => el('div', { class: 'chart-empty' }, msg);

const monthsIn = rows =>
  [...new Set(rows.map(monthOf).filter(Boolean))].sort();

/**
 * Which way a label hangs off its point. Centring every label spills the
 * first and last ones past the chart box, where the card's rounded corner
 * clips them; the ends anchor inwards instead.
 */
const anchorFor = (i, n) => (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle');

const legend = pairs =>
  el('div', { class: 'chart-legend' },
    pairs.map(([cls, label]) => el('span', { class: 'legend-item' },
      el('i', { class: `legend-dot ${cls}` }), label)));

/**
 * Revenue against what it costs to produce, month by month. Revenue is its
 * own bar rather than a stack segment: the question is whether the green bar
 * clears the red one, and two stacks cannot be compared at a glance.
 */
function revenueVsSpend(rows) {
  const months = monthsIn(rows);
  if (!months.length) return chartCard('Revenue vs spend',
    chartEmpty('Dated entries will chart here.'));

  const series = months.map(m => {
    const k = metrics(rows.filter(r => monthOf(r) === m));
    return { m, revenue: k.revenue, production: k.production, overhead: k.overhead };
  });
  const max = Math.max(1, ...series.flatMap(s =>
    [s.revenue, s.production + s.overhead]));

  const W = 560, H = 240, padL = 40, padB = 30, top = 12;
  const y = v => H - padB - (v / max) * (H - padB - top);
  const step = (W - padL) / series.length;
  const bw = Math.min(34, step / 2.8);
  const marks = [];

  // Gridlines first so every bar paints over them.
  for (const t of [0, 0.5, 1]) {
    const yy = y(max * t);
    marks.push(svg('line', { class: 'grid-line', x1: padL, x2: W - 6,
                             y1: yy, y2: yy }));
    marks.push(svg('text', { class: 'axis-text', x: padL - 8, y: yy + 4,
                             'text-anchor': 'end' },
      max * t >= 1000 ? `${Math.round(max * t / 1000)}k` : Math.round(max * t)));
  }

  series.forEach((s, i) => {
    const cx = padL + step * i + step / 2;
    const hRev = (H - padB) - y(s.revenue);
    const hProd = (H - padB) - y(s.production);
    const hOvh = (H - padB) - y(s.production + s.overhead) - hProd;
    marks.push(
      svg('rect', { class: 'seg-revenue', x: cx - bw - 2, y: y(s.revenue),
                    width: bw, height: Math.max(0, hRev), rx: 3 }),
      svg('rect', { class: 'seg-production', x: cx + 2, y: y(s.production),
                    width: bw, height: Math.max(0, hProd), rx: 3 }),
      svg('rect', { class: 'seg-overhead', x: cx + 2,
                    y: y(s.production + s.overhead),
                    width: bw, height: Math.max(0, hOvh), rx: 3 }),
      svg('text', { class: 'axis-text', x: cx, y: H - padB + 16,
                    'text-anchor': 'middle' }, formatMonth(s.m)));
  });

  return chartCard('Revenue vs spend',
    svg('svg', { class: 'moneychart', viewBox: `0 0 ${W} ${H}` }, marks),
    legend([['seg-revenue', 'Revenue'],
            ['seg-production', 'Editors and clippers'],
            ['seg-overhead', 'Tools and overhead']]));
}

/** Net profit per month. One series, so it takes the accent, not a hue. */
function netTrend(rows) {
  const months = monthsIn(rows);
  if (months.length < 2) return chartCard('Net profit trend',
    chartEmpty('Two dated months are needed before a trend means anything.'));

  const pts = months.map(m => metrics(rows.filter(r => monthOf(r) === m)).net);
  const max = Math.max(...pts, 0), min = Math.min(...pts, 0);
  const W = 400, H = 240, padL = 34, padR = 10, padB = 30, top = 26;
  const y = v => H - padB - ((v - min) / ((max - min) || 1)) * (H - padB - top);
  const x = i => padL + (i * (W - padL - padR)) / Math.max(1, pts.length - 1);
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');

  return chartCard('Net profit trend',
    svg('svg', { class: 'moneychart', viewBox: `0 0 ${W} ${H}` },
      // The zero line is the only thing that says whether a month lost money.
      svg('line', { class: 'zero-line', x1: padL, x2: W, y1: y(0), y2: y(0) }),
      svg('path', { class: 'line-area',
                    d: `${line} L${x(pts.length - 1)},${H - padB} L${x(0)},${H - padB} Z` }),
      svg('path', { class: 'line-stroke', d: line }),
      pts.map((v, i) => [
        svg('circle', { class: 'line-dot', cx: x(i), cy: y(v), r: 4 }),
        svg('text', { class: 'axis-text value-text', x: x(i), y: y(v) - 12,
                      'text-anchor': anchorFor(i, pts.length) }, rupees(v)),
        svg('text', { class: 'axis-text', x: x(i), y: H - padB + 16,
                      'text-anchor': anchorFor(i, pts.length) },
            formatMonth(months[i])),
      ])));
}

/**
 * Where the outflow went. Ranked, and shaded down the grey ramp rather than
 * given eight hues: the ordering IS the information, and this page keeps its
 * three colours for status.
 */
function spendBreakdown(rows) {
  const agg = {};
  for (const r of rows.filter(r => r.direction === 'Expense')) {
    const key = r.category || 'Uncategorised';
    agg[key] = (agg[key] || 0) + (r.amount || 0);
  }
  const items = Object.entries(agg).filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = items.reduce((t, [, v]) => t + v, 0);
  if (!total) return chartCard('Spend breakdown',
    chartEmpty('No outflow in this slice.'));

  const C = 2 * Math.PI * 54;
  let offset = 0;
  const ring = items.map(([, v], i) => {
    const len = (v / total) * C;
    const arc = svg('circle', {
      class: `donut-seg donut-${Math.min(i, 5)}`,
      cx: 70, cy: 70, r: 54, 'stroke-dasharray': `${Math.max(0, len - 1.5)} ${C - len + 1.5}`,
      'stroke-dashoffset': -offset, transform: 'rotate(-90 70 70)',
    });
    offset += len;
    return arc;
  });

  return chartCard('Spend breakdown',
    el('div', { class: 'donut-wrap' },
      svg('svg', { class: 'donut', viewBox: '0 0 140 140' }, ring,
        svg('text', { class: 'donut-total', x: 70, y: 67, 'text-anchor': 'middle' },
          rupees(total)),
        svg('text', { class: 'donut-cap', x: 70, y: 83, 'text-anchor': 'middle' },
          'TOTAL OUT')),
      el('div', { class: 'donut-legend' },
        items.map(([k, v], i) => el('div', { class: 'legend-row' },
          el('i', { class: `legend-dot donut-${Math.min(i, 5)}` }),
          el('span', { class: 'legend-name' }, k),
          el('span', { class: 'legend-val' },
            `${rupees(v)} · ${Math.round((v / total) * 100)}%`))))));
}

/** What each editor has actually been paid, and across how many clips. */
function perEditor(rows) {
  const agg = {};
  for (const r of rows.filter(r => PRODUCTION.has(r.category))) {
    const key = r.party || '—';
    agg[key] = agg[key] || { paid: 0, clips: 0 };
    agg[key].paid += r.amount || 0;
    agg[key].clips += 1;
  }
  const items = Object.entries(agg).sort((a, b) => b[1].paid - a[1].paid);
  if (!items.length) return chartCard('Paid per editor',
    chartEmpty('No editor or clipper fees in this slice.'));

  const max = Math.max(...items.map(([, v]) => v.paid));
  return chartCard('Paid per editor',
    items.map(([name, v]) => el('div', { class: 'bar-row bar-row-wide' },
      el('div', { class: 'bar-wide-head' },
        el('span', {}, name),
        el('span', { class: 'bar-wide-val' },
          `${rupees(v.paid)} · ${v.clips} clip${v.clips === 1 ? '' : 's'}`)),
      el('div', { class: 'bar-track' },
        el('div', { class: 'bar-fill', style: `width:${(v.paid / max) * 100}%` })))));
}

/** Savings as a running total against the goal line. */
function savingsBuilt(rows, goal) {
  const months = monthsIn(rows);
  const setAside = r => (r.bucket === 'Savings' ? (r.amount || 0) : 0)
                      + (r.saving || 0);
  if (!rows.some(r => setAside(r) > 0)) return chartCard('Savings built up',
    chartEmpty('File a row under the Savings bucket to track this.'));

  let run = 0;
  const pts = months.map(m => {
    run += rows.filter(r => monthOf(r) === m).reduce((t, r) => t + setAside(r), 0);
    return run;
  });
  const max = Math.max(goal, ...pts, 1);
  const W = 400, H = 210, padL = 30, padR = 10, padB = 28, top = 20;
  const y = v => H - padB - (v / max) * (H - padB - top);
  const x = i => padL + (i * (W - padL - padR)) / Math.max(1, pts.length - 1);
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');

  return chartCard('Savings built up',
    svg('svg', { class: 'moneychart', viewBox: `0 0 ${W} ${H}` },
      svg('line', { class: 'goal-line', x1: padL, x2: W - padR,
                    y1: y(goal), y2: y(goal) }),
      svg('text', { class: 'axis-text', x: W - padR, y: y(goal) - 6,
                    'text-anchor': 'end' }, `GOAL ${rupees(goal)}`),
      pts.length > 1 ? svg('path', { class: 'line-area',
        d: `${line} L${x(pts.length - 1)},${H - padB} L${x(0)},${H - padB} Z` }) : null,
      pts.length > 1 ? svg('path', { class: 'line-stroke', d: line }) : null,
      pts.map((v, i) => [
        svg('circle', { class: 'line-dot', cx: x(i), cy: y(v), r: 3.5 }),
        // The running total is the point of this chart, so every dot carries
        // its figure rather than making you read it off the goal line.
        svg('text', { class: 'axis-text value-text', x: x(i), y: y(v) - 10,
                      'text-anchor': anchorFor(i, pts.length) }, rupees(v)),
        svg('text', { class: 'axis-text', x: x(i), y: H - padB + 15,
                      'text-anchor': anchorFor(i, pts.length) },
            formatMonth(months[i])),
      ])));
}

/** A ranked two-column readout — the same rows, just grouped. */
function rollupCard(title, entries, { tone = '', note = '', empty }) {
  if (!entries.length) return chartCard(title, chartEmpty(empty));
  return chartCard(title,
    el('table', { class: 'mini-table' },
      el('tbody', {}, entries.map(([label, value, rowTone]) =>
        el('tr', {},
          el('td', {}, label),
          el('td', { class: `mini-num ${rowTone ?? tone}` }, value))))),
    note ? el('div', { class: 'chart-note' }, note) : null);
}

/* ------------------------------------------------------------------------ *
 * CSV. Export writes what is on screen; import ADDS rows and never clears
 * the ledger — a bad file should cost you an undo, not your history.
 * ------------------------------------------------------------------------ */
const CSV_HEAD = ['entry', 'amount', 'saving', 'bucket', 'category',
                  'direction', 'date', 'party', 'paid', 'recurring'];

function exportCsv(rows) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const body = rows.map(r => [r.entry, r.amount, r.saving, r.bucket, r.category,
                              r.direction, r.date, r.party, r.paid, r.recurring]
    .map(q).join(','));
  const blob = new Blob([[CSV_HEAD.join(','), ...body].join('\n')],
                        { type: 'text/csv' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'money.csv' });
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Split one CSV line, honouring "" escaping inside quoted fields. */
function splitCsvLine(line) {
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

async function importCsv(file) {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) { toast('That file has no rows', true); return; }
  const cols = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  const rows = lines.slice(1).map(l => {
    const v = splitCsvLine(l);
    const get = name => v[cols.indexOf(name)] ?? '';
    return {
      entry: get('entry'),
      amount: Number(get('amount')) || 0,
      saving: Number(get('saving')) || 0,
      bucket: BUCKETS.some(b => b.value === get('bucket')) ? get('bucket') : 'Business',
      category: ALL_CATEGORIES.includes(get('category')) ? get('category') : null,
      direction: get('direction') === 'Income' ? 'Income' : 'Expense',
      date: /^\d{4}-\d{2}-\d{2}$/.test(get('date')) ? get('date') : null,
      party: get('party'),
      paid: ['Paid', 'Unpaid'].includes(get('paid')) ? get('paid') : null,
      recurring: get('recurring').toLowerCase() === 'true',
    };
  });

  const ok = await confirmDialog('Import this file?',
    `${rows.length} row${rows.length === 1 ? '' : 's'} will be ADDED to the ` +
    'ledger. Nothing already in it is changed or removed.', 'Import');
  if (!ok) return;

  let added = 0;
  for (const row of rows) {
    try { await api.createMoney(row); added++; } catch { /* skip bad rows */ }
  }
  toast(`Imported ${added} of ${rows.length} rows`);
  refresh();
}

/* ------------------------------------------------------------------------ */

export async function renderMoney(root) {
  const spinner = loading();
  root.append(spinner);
  const [all, goalRes] = await Promise.all([api.listMoney(), api.getMoneyGoal()]);
  spinner.remove();

  // The ledger is small, so filtering client-side keeps it to one fetch.
  const rows = all.filter(m =>
    (!filters.month     || monthOf(m) === filters.month) &&
    (!filters.bucket    || m.bucket === filters.bucket) &&
    (!filters.category  || m.category === filters.category) &&
    (!filters.direction || m.direction === filters.direction) &&
    (!filters.paid      || m.paid === filters.paid));

  const m = metrics(rows);
  const allTime = metrics(all);   // the goal is tracked over everything

  /* --- header ---------------------------------------------------------- */
  root.append(el('div', { class: 'view-header' },
    el('h1', { class: 'view-title' }, 'Money'),
    el('span', { class: 'view-sub' },
      `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`),
    el('span', { class: 'spacer' }),
    el('button', {
      class: 'btn btn-ghost btn-sm',
      onclick: () => exportCsv(rows),
    }, 'Export CSV'),
    el('button', {
      class: 'btn btn-ghost btn-sm',
      onclick: () => picker.click(),
    }, 'Import CSV'),
    el('button', {
      class: 'btn btn-primary btn-sm',
      onclick: async () => {
        try {
          await api.createMoney({ direction: 'Expense', bucket: 'Business' });
          toast('Entry added — fill it in');
          refresh();
        } catch (err) { toast(err.message, true); }
      },
    }, '+ Add entry')));

  const picker = el('input', {
    type: 'file', accept: '.csv', hidden: true,
    onchange: e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) importCsv(file);
    },
  });
  root.append(picker);

  /* --- goal card ------------------------------------------------------- */
  // The goal can track either figure: profit is what the channel earns,
  // savings is what actually left for the bank. They answer different
  // questions, so the bar says which one it is showing.
  const tracked = goalMode === 'net' ? allTime.net : allTime.saved;
  const pct = Math.max(0, Math.min(100, (tracked / goalRes.goal) * 100));
  const goalInput = el('input', { class: 'goal-input', value: goalRes.goal });
  const saveGoal = async () => {
    const v = Number(goalInput.value);
    if (!v || v <= 0 || v === goalRes.goal) { goalInput.value = goalRes.goal; return; }
    try { await api.setMoneyGoal(v); toast('Goal updated'); refresh(); }
    catch (err) { toast(err.message, true); goalInput.value = goalRes.goal; }
  };
  goalInput.addEventListener('blur', saveGoal);
  goalInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); goalInput.blur(); }
  });

  const modeBtn = (key, label) => el('button', {
    class: `goal-mode${goalMode === key ? ' is-on' : ''}`,
    'aria-pressed': String(goalMode === key),
    onclick: () => { goalMode = key; refresh(); },
  }, label);

  root.append(el('div', { class: 'chart-card goal-card' },
    el('div', { class: 'goal-head' },
      el('span', { class: 'chart-title', style: 'margin:0' }, '💰 Goal'),
      el('span', { class: `goal-net ${tracked < 0 ? 'signed-neg' : 'signed-pos'}` },
        rupees(tracked)),
      el('span', { class: 'goal-of' }, 'of ₹'),
      goalInput,
      el('span', { class: 'goal-modes' },
        modeBtn('net', 'Net profit'), modeBtn('saved', 'Saved')),
      el('span', { class: 'goal-pct' }, `${pct.toFixed(1)}%`)),
    el('div', { class: 'goal-track' },
      el('div', { class: 'goal-fill', style: `width:${pct}%` }))));

  /* --- tiles ------------------------------------------------------------ *
   * Two rows, and the split is the point: the first is the business — what
   * came in, what it cost, what is left. The second is everything the first
   * deliberately excludes, plus what is still outstanding.                  */
  const scope = filters.month || filters.bucket || filters.category
             || filters.direction || filters.paid ? ' (filtered)' : '';

  root.append(el('div', { class: 'stat-row money-stats' },
    tile(rupees(m.revenue), `Revenue${scope}`, 'business money in',
         'signed-pos'),
    tile(rupees(m.production), 'Production',
         `${m.videos} video${m.videos === 1 ? '' : 's'} paid for`, 'signed-neg'),
    tile(rupees(m.overhead), 'Overhead', 'tools, verification, ads'),
    tile(rupees(m.net), 'Net profit', 'revenue minus business cost',
         m.net < 0 ? 'signed-neg' : 'signed-pos'),
    tile(`${m.margin.toFixed(1)}%`, 'Margin',
         `you keep ₹${Math.round(m.margin)} of every ₹100`,
         m.margin < 0 ? 'signed-neg' : m.margin < 50 ? 'stat-ready' : 'signed-pos')));

  root.append(el('div', { class: 'stat-row money-stats' },
    tile(m.videos ? rupees(m.perVideo) : '—', 'Cost per video',
         'production ÷ videos paid for'),
    tile(rupees(m.saved), 'Saved', 'set aside, never counted as spend',
         'stat-aside-v'),
    tile(rupees(m.personal), 'Personal', 'held out of the business view',
         'stat-aside-v'),
    tile(rupees(m.iOwe), 'I owe', 'delivered but not yet paid out',
         m.iOwe ? 'stat-ready' : ''),
    tile(rupees(m.owedMe), 'Owed to me', 'earned but not yet received',
         m.owedMe ? 'stat-ready' : '')));

  /* --- filter bar ------------------------------------------------------ */
  const months = [...new Set(all.filter(x => x.date)
    .map(x => x.date.slice(0, 7)))].sort().reverse();
  // Same dropdown() the library filter bar uses — a native <select> popup
  // cannot be styled and would open as a white sheet on this dark theme.
  const select = (label, key, allLabel, options) =>
    el('div', { class: 'filter-field' },
      el('span', { class: 'filter-label' }, label),
      dropdown([{ value: '', label: allLabel }, ...options], filters[key] || '',
               v => { filters[key] = v; refresh(); }, { ariaLabel: label }));
  const opts = list => list.map(v => ({ value: v, label: v }));

  root.append(el('div', { class: 'filter-bar' },
    select('Month', 'month', 'All months',
           months.map(x => ({ value: x, label: formatMonth(x) }))),
    select('Bucket', 'bucket', 'All buckets', opts(BUCKETS.map(b => b.value))),
    select('Category', 'category', 'All categories', opts(ALL_CATEGORIES)),
    select('Direction', 'direction', 'Both', opts(['Income', 'Expense'])),
    select('Status', 'paid', 'All', opts(['Paid', 'Unpaid'])),
    Object.values(filters).some(Boolean) ? el('button', {
      class: 'btn btn-ghost btn-sm filter-clear',
      onclick: () => {
        for (const k of Object.keys(filters)) filters[k] = '';
        refresh();
      },
    }, '✕ Clear') : null));

  if (!rows.length) {
    root.append(emptyState('💸',
      all.length ? 'No entries match these filters' : 'No entries yet',
      all.length ? 'Try loosening or clearing the filters above.'
                 : 'Hit + Add entry to record your first one.'));
    return;
  }

  /* --- ledger table ---------------------------------------------------- */
  const body = el('tbody');
  for (const row of rows) {
    const save = patch => api.updateMoney(row.id, patch).then(refresh);
    // Categories follow the direction, and two of them re-file the row: a
    // "Set aside" left in the Business bucket would drag Net down.
    const catOptions = (CATEGORIES[row.direction] || ALL_CATEGORIES)
      .map(v => ({ value: v, color: PRODUCTION.has(v) ? 't2' : 'n' }));

    body.append(el('tr', {},
      el('td', { class: 'col-topic' },
        textCell(row.entry, v => save({ entry: v }), { placeholder: 'What for?' })),
      el('td', { class: 'money-amount' },
        textCell(row.amount || '', v => save({ amount: Number(v) || 0 }),
                 { type: 'number', placeholder: '0' })),
      // Saving is a note-to-self, not a movement: it is never summed into a
      // ledger total, never signed, and never touches the goal bar.
      el('td', { class: 'money-amount money-saving' },
        textCell(row.saving || '', v => save({ saving: Number(v) || 0 }),
                 { type: 'number', placeholder: '0' })),
      el('td', {}, selectCell(row.bucket, BUCKETS,
                              v => save({ bucket: v }), { allowEmpty: false })),
      el('td', {}, selectCell(row.category, catOptions,
                              v => save({ category: v, ...(CATEGORY_BUCKET[v]
                                ? { bucket: CATEGORY_BUCKET[v] } : {}) }))),
      el('td', {}, selectCell(row.direction, DIRECTIONS,
                              v => save({ direction: v }), { allowEmpty: false })),
      el('td', {}, textCell(row.date, v => save({ date: v }), { type: 'date' })),
      el('td', {}, textCell(row.party, v => save({ party: v }),
                            { placeholder: 'Platform / person' })),
      el('td', {}, selectCell(row.paid, PAID_STATES, v => save({ paid: v }))),
      // A fixed cost is a yes/no, so it is a toggle rather than a select.
      el('td', {},
        el('button', {
          class: `chip ${row.recurring ? 'chip-warn' : 'chip-empty'} chip-toggle`,
          title: row.recurring ? 'Repeats every month' : 'One-off',
          onclick: () => save({ recurring: !row.recurring }),
        }, row.recurring ? 'Monthly' : 'One-off')),
      el('td', { class: `money-signed ${row.signed < 0 ? 'signed-neg'
                         : row.signed > 0 ? 'signed-pos' : ''}` },
        row.amount ? rupees(row.signed) : '—'),
      el('td', { class: 'row-actions' },
        el('button', {
          class: 'btn btn-ghost btn-sm', title: 'Delete entry',
          onclick: async () => {
            const ok = await confirmDialog('Delete this entry?',
              `“${row.entry || 'Untitled'}” (${rupees(row.signed)}) will be removed.`);
            if (!ok) return;
            try { await api.deleteMoney(row.id); toast('Entry deleted'); refresh(); }
            catch (err) { toast(err.message, true); }
          },
        }, '🗑'))));
  }

  // Sum row for whatever slice is showing. Only Signed is totalled — the
  // Saving cell stays deliberately blank, since a saving total in the ledger
  // would read as part of its arithmetic.
  const total = rows.reduce((s, r) => s + r.signed, 0);
  body.append(el('tr', { class: 'money-sum-row' },
    el('td', {}, 'Sum'),
    el('td', {}), el('td', {}), el('td', {}), el('td', {}), el('td', {}),
    el('td', {}), el('td', {}), el('td', {}), el('td', {}),
    el('td', { class: `money-signed ${total < 0 ? 'signed-neg' : 'signed-pos'}` },
      rupees(total)),
    el('td', {})));

  root.append(el('div', { class: 'table-wrap' },
    el('table', { class: 'grid money-grid' },
      el('thead', {}, el('tr', {},
        ['Entry', 'Amount (₹)', 'Saving (₹)', 'Bucket', 'Category', 'Direction',
         'Date', 'Platform / Person', 'Paid', 'Recurs', 'Signed (₹)', '']
          .map(h => el('th', {}, h)))),
      body)));

  /* --- charts ----------------------------------------------------------- */
  root.append(el('div', { class: 'section-head' },
    el('h2', {}, 'Month by month'),
    el('span', {}, 'revenue against what it costs to produce')));
  root.append(el('div', { class: 'dash-grid dash-2' },
    revenueVsSpend(rows), netTrend(rows)));

  root.append(el('div', { class: 'section-head' },
    el('h2', {}, 'Where the money goes'),
    el('span', {}, 'all outflow, split by category and by person')));
  root.append(el('div', { class: 'dash-grid' },
    spendBreakdown(rows), perEditor(rows), savingsBuilt(rows, goalRes.goal)));

  /* --- rollups ---------------------------------------------------------- */
  const byCategory = {};
  for (const r of rows) {
    const key = r.category || 'Uncategorised';
    byCategory[key] = (byCategory[key] || 0) + r.signed;
  }
  const byPerson = {};
  for (const r of rows.filter(r => r.direction === 'Expense' && r.party)) {
    byPerson[r.party] = (byPerson[r.party] || 0) + (r.amount || 0);
  }
  // Fixed costs are answered from the WHOLE ledger, not the filtered slice:
  // what repeats every month does not stop repeating because you are looking
  // at July.
  const fixed = all.filter(r => r.recurring && r.direction === 'Expense');
  const fixedTotal = fixed.reduce((t, r) => t + (r.amount || 0), 0);

  root.append(el('div', { class: 'section-head' },
    el('h2', {}, 'Rollups'),
    el('span', {}, 'the same rows, grouped')));
  root.append(el('div', { class: 'dash-grid' },
    rollupCard('By category',
      Object.entries(byCategory).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .map(([k, v]) => [k, rupees(v), v < 0 ? 'signed-neg' : 'signed-pos']),
      { empty: 'Nothing in this slice.' }),
    rollupCard('By person',
      Object.entries(byPerson).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => [k, rupees(v), 'signed-neg']),
      { empty: 'No one has been paid in this slice.' }),
    rollupCard('Fixed monthly costs',
      [...fixed.map(r => [r.entry || 'Untitled', rupees(r.amount), 'stat-ready']),
       ...(fixed.length ? [['Every month', rupees(fixedTotal), 'stat-ready']] : [])],
      { empty: 'Flag a row as Monthly to list it here.',
        note: 'These repeat whether you post or not. Revenue has to clear this '
            + 'line before anything else is profit.' })));
}
