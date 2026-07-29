/**
 * "This Month" view — the library filtered to a single month by Upload date.
 *
 * Defaults to the current month and offers a picker to jump elsewhere. Shares
 * state.month with the calendar view, so paging in one carries to the other.
 */

import { api } from '../api.js';
import {
  el, chip, textCell, selectCell, emptyState, loading, formatMonth, shiftMonth,
  currentMonth, formatDate, STATUSES, PERFORMANCES, TYPES,
} from '../ui.js';

export async function renderMonth(root, state) {
  const spinner = loading();
  root.append(spinner);

  const [items, months] = await Promise.all([
    api.listContent({ month: state.month, search: state.search,
                      sort: 'upload_date', direction: 'asc' }),
    api.listMonths(),
  ]);
  spinner.remove();

  const isCurrent = state.month === currentMonth();

  // Offer every month that has entries, plus the current one and whatever is
  // selected, so the picker never hides where you already are.
  const options = [...new Set([...months, currentMonth(), state.month])].sort().reverse();

  const picker = el('select', { class: 'cell-select', style: 'width:auto;min-width:150px' },
    options.map(m => el('option', { value: m, selected: m === state.month },
                        formatMonth(m))));
  picker.value = state.month;
  picker.addEventListener('change', () => {
    state.month = picker.value;
    import('../app.js').then(m => m.refresh());
  });

  const nav = delta => () => {
    state.month = shiftMonth(state.month, delta);
    import('../app.js').then(m => m.refresh());
  };

  root.append(el('div', { class: 'view-header' },
    el('h1', { class: 'view-title' }, formatMonth(state.month)),
    isCurrent ? el('span', { class: 'chip chip-t1' }, 'Current month') : null,
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn btn-sm', onclick: nav(-1) }, '‹'),
    picker,
    el('button', { class: 'btn btn-sm', onclick: nav(1) }, '›'),
    isCurrent ? null : el('button', {
      class: 'btn btn-sm',
      onclick: () => {
        state.month = currentMonth();
        import('../app.js').then(m => m.refresh());
      },
    }, 'Jump to today'),
  ));

  if (!items.length) {
    root.append(emptyState('📅', `Nothing scheduled in ${formatMonth(state.month)}`,
      'Entries appear here once they have an Upload date in this month.'));
    return;
  }

  const body = el('tbody');
  for (const item of items) {
    const save = patch => api.updateContent(item.id, patch);
    body.append(el('tr', {},
      el('td', { style: 'white-space:nowrap' },
        el('span', { class: 'card-date' }, formatDate(item.upload_date))),
      el('td', { class: 'col-topic' },
        el('div', {
          class: 'topic-link',
          onclick: () => { location.hash = `#/content/${item.id}`; },
        }, item.topic)),
      el('td', {}, selectCell(item.status, STATUSES,
                              v => save({ status: v }), { allowEmpty: false })),
      el('td', {}, selectCell(item.type, TYPES, v => save({ type: v }))),
      el('td', {}, selectCell(item.performance, PERFORMANCES,
                              v => save({ performance: v }))),
      el('td', {}, textCell(item.assigned_to, v => save({ assigned_to: v }),
                            { placeholder: '—' })),
      el('td', {}, el('span', { class: 'media-meta' },
        [item.raw_count ? `${item.raw_count} raw` : null,
         item.final_count ? `${item.final_count} final` : null]
          .filter(Boolean).join(' · ') || '—')),
    ));
  }

  root.append(el('div', { class: 'table-wrap' },
    el('table', { class: 'grid' },
      el('thead', {}, el('tr', {},
        ['Date', 'Topic', 'Status', 'Type', 'Performance', 'Assigned to', 'Media']
          .map(h => el('th', { style: 'cursor:default' }, h)))),
      body)));
}
