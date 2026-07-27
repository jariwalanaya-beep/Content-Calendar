/**
 * Money — the income/expense ledger, tracked against a savings goal.
 *
 * Everything is inline-editable like the other tables. The amount is always
 * entered positive; the Direction column signs it, and the Signed column,
 * the tiles and the goal bar all derive from that.
 */

import { api } from '../api.js';
import {
  el, textCell, selectCell, loading, toast, emptyState, confirmDialog,
  formatMonth,
} from '../ui.js';

const DIRECTIONS = [
  { value: 'Income',  color: 'green' },
  { value: 'Expense', color: 'red'   },
];

/** '₹63,000' / '−₹1,999' with Indian digit grouping. */
const rupees = n =>
  (n < 0 ? '−₹' : '₹') + Math.abs(Math.round(n)).toLocaleString('en-IN');

// Filters survive re-renders (an inline save re-renders the view).
const filters = { month: '', direction: '' };

const refresh = () => import('../app.js').then(m => m.refresh());

export async function renderMoney(root) {
  const spinner = loading();
  root.append(spinner);
  const [all, goalRes] = await Promise.all([api.listMoney(), api.getMoneyGoal()]);
  spinner.remove();

  // The ledger is small, so filtering client-side keeps it to one fetch.
  const rows = all.filter(m =>
    (!filters.month || (m.date || '').startsWith(filters.month)) &&
    (!filters.direction || m.direction === filters.direction));

  const sum = list => list.reduce((s, m) => s + m.amount, 0);
  const income  = sum(rows.filter(m => m.direction === 'Income'));
  const expense = sum(rows.filter(m => m.direction === 'Expense'));
  const netAll  = all.reduce((s, m) => s + m.signed, 0);  // all-time, for the goal

  /* --- header ---------------------------------------------------------- */
  root.append(el('div', { class: 'view-header' },
    el('h1', { class: 'view-title' }, 'Money'),
    el('span', { class: 'view-sub' },
      `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`),
    el('span', { class: 'spacer' }),
    el('button', {
      class: 'btn btn-primary btn-sm',
      onclick: async () => {
        try {
          await api.createMoney({ direction: 'Expense' });
          toast('Entry added — fill it in');
          refresh();
        } catch (err) { toast(err.message, true); }
      },
    }, '+ Add entry')));

  /* --- goal card ------------------------------------------------------- */
  // Net (all-time) against the goal. The goal amount itself is editable.
  const pct = Math.max(0, Math.min(100, (netAll / goalRes.goal) * 100));
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

  root.append(el('div', { class: 'chart-card goal-card' },
    el('div', { class: 'goal-head' },
      el('span', { class: 'chart-title', style: 'margin:0' }, '💰 Goal'),
      el('span', { class: `goal-net ${netAll < 0 ? 'signed-neg' : 'signed-pos'}` },
        rupees(netAll)),
      el('span', { class: 'goal-of' }, 'of ₹'),
      goalInput,
      el('span', { class: 'goal-pct' }, `${pct.toFixed(1)}%`)),
    el('div', { class: 'goal-track' },
      el('div', { class: 'goal-fill', style: `width:${pct}%` }))));

  /* --- tiles for the current filter ------------------------------------ */
  root.append(el('div', { class: 'stat-row money-stats' },
    el('div', { class: 'stat-tile' },
      el('div', { class: 'stat-value signed-pos' }, rupees(income)),
      el('div', { class: 'stat-label' }, 'Income')),
    el('div', { class: 'stat-tile' },
      el('div', { class: 'stat-value signed-neg' }, rupees(expense)),
      el('div', { class: 'stat-label' }, 'Expense')),
    el('div', { class: 'stat-tile' },
      el('div', { class: 'stat-value' }, rupees(income - expense)),
      el('div', { class: 'stat-label' },
        filters.month || filters.direction ? 'Net (filtered)' : 'Net'))));

  /* --- filter bar ------------------------------------------------------ */
  const months = [...new Set(all.filter(m => m.date)
    .map(m => m.date.slice(0, 7)))].sort().reverse();
  const select = (label, key, allLabel, options) => {
    const sel = el('select', { class: 'filter-select' },
      el('option', { value: '' }, allLabel),
      options.map(o => el('option', { value: o.value }, o.label)));
    sel.value = filters[key] || '';
    sel.addEventListener('change', () => { filters[key] = sel.value; refresh(); });
    return el('label', { class: 'filter-field' },
      el('span', { class: 'filter-label' }, label), sel);
  };
  root.append(el('div', { class: 'filter-bar' },
    select('Month', 'month', 'All months',
           months.map(m => ({ value: m, label: formatMonth(m) }))),
    select('Direction', 'direction', 'Both',
           DIRECTIONS.map(d => ({ value: d.value, label: d.value }))),
    (filters.month || filters.direction) ? el('button', {
      class: 'btn btn-ghost btn-sm filter-clear',
      onclick: () => { filters.month = ''; filters.direction = ''; refresh(); },
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
  for (const m of rows) {
    const save = patch => api.updateMoney(m.id, patch).then(refresh);
    body.append(el('tr', {},
      el('td', { class: 'col-topic' },
        textCell(m.entry, v => save({ entry: v }), { placeholder: 'What for?' })),
      el('td', { class: 'money-amount' },
        textCell(m.amount || '', v => save({ amount: Number(v) || 0 }),
                 { type: 'number', placeholder: '0' })),
      el('td', {}, textCell(m.date, v => save({ date: v }), { type: 'date' })),
      el('td', {}, selectCell(m.direction, DIRECTIONS,
                              v => save({ direction: v }), { allowEmpty: false })),
      el('td', {}, textCell(m.party, v => save({ party: v }),
                            { placeholder: 'Platform / person' })),
      el('td', { class: `money-signed ${m.signed < 0 ? 'signed-neg'
                         : m.signed > 0 ? 'signed-pos' : ''}` },
        m.amount ? rupees(m.signed) : '—'),
      el('td', { class: 'row-actions' },
        el('button', {
          class: 'btn btn-ghost btn-sm', title: 'Delete entry',
          onclick: async () => {
            const ok = await confirmDialog('Delete this entry?',
              `“${m.entry || 'Untitled'}” (${rupees(m.signed)}) will be removed.`);
            if (!ok) return;
            try { await api.deleteMoney(m.id); toast('Entry deleted'); refresh(); }
            catch (err) { toast(err.message, true); }
          },
        }, '🗑'))));
  }

  // Sum row for whatever slice is showing, like the reference tracker.
  const total = rows.reduce((s, m) => s + m.signed, 0);
  body.append(el('tr', { class: 'money-sum-row' },
    el('td', {}, 'Sum'),
    el('td', {}), el('td', {}), el('td', {}), el('td', {}),
    el('td', { class: `money-signed ${total < 0 ? 'signed-neg' : 'signed-pos'}` },
      rupees(total)),
    el('td', {})));

  root.append(el('div', { class: 'table-wrap' },
    el('table', { class: 'grid' },
      el('thead', {}, el('tr', {},
        ['Entry', 'Amount (₹)', 'Date', 'Direction', 'Platform / Person',
         'Signed (₹)', ''].map(h => el('th', {}, h)))),
      body)));
}
