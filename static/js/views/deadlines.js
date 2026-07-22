/**
 * Deadlines view — who is editing what, and when it is due.
 *
 * Replaces the old kanban board. Sorted soonest-first, with overdue and
 * due-today rows called out, so the top of the list is always what needs
 * chasing.
 *
 * Clicking Done marks the entry complete and drops it out of the list. It does
 * NOT delete the entry — the script, notes and videos all survive. Toggle
 * "Show completed" to see finished rows and undo one.
 */

import { api } from '../api.js';
import {
  el, textCell, selectCell, emptyState, loading, toast,
  formatDate, toISODate, STATUSES,
} from '../ui.js';

/** Days between today and an ISO date. Negative = overdue. */
function daysUntil(iso) {
  if (!iso) return null;
  const today = new Date(toISODate(new Date()) + 'T00:00:00');
  const due = new Date(iso + 'T00:00:00');
  return Math.round((due - today) / 86400000);
}

/** Human label plus a severity class for the deadline cell. */
function dueLabel(iso) {
  const d = daysUntil(iso);
  if (d === null) return { text: 'No deadline', cls: 'due-none' };
  if (d < 0)      return { text: `${-d}d overdue`, cls: 'due-over' };
  if (d === 0)    return { text: 'Due today',      cls: 'due-today' };
  if (d === 1)    return { text: 'Due tomorrow',   cls: 'due-soon' };
  if (d <= 3)     return { text: `In ${d} days`,   cls: 'due-soon' };
  return { text: `In ${d} days`, cls: 'due-ok' };
}

// Kept across re-renders so the toggle survives a refresh.
let showCompleted = false;

export async function renderDeadlines(root, state) {
  const spinner = loading();
  root.append(spinner);

  const items = await api.listContent({
    search: state.search,
    done: showCompleted ? true : false,
    sort: 'deadline', direction: 'asc',
  });
  spinner.remove();

  // Outstanding work first: entries with a deadline, soonest first, then the
  // ones with no deadline set yet.
  items.sort((a, b) => {
    if (!a.deadline && !b.deadline) return 0;
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return a.deadline.localeCompare(b.deadline);
  });

  const overdue = items.filter(i => !i.done && daysUntil(i.deadline) < 0).length;

  root.append(el('div', { class: 'view-header' },
    el('h1', { class: 'view-title' }, showCompleted ? 'Completed' : 'Deadlines'),
    el('span', { class: 'view-sub' },
      `${items.length} ${items.length === 1 ? 'entry' : 'entries'}`),
    overdue ? el('span', { class: 'chip chip-red' }, `${overdue} overdue`) : null,
    el('span', { class: 'spacer' }),
    el('button', {
      class: `btn btn-sm${showCompleted ? ' btn-primary' : ''}`,
      onclick: () => {
        showCompleted = !showCompleted;
        import('../app.js').then(m => m.refresh());
      },
    }, showCompleted ? '← Back to open' : 'Show completed'),
  ));

  if (!items.length) {
    root.append(emptyState(
      showCompleted ? '✅' : '🎯',
      showCompleted ? 'Nothing completed yet'
                    : 'No open work',
      showCompleted ? 'Rows you mark Done will collect here.'
                    : 'Set an Assigned to and Deadline on an entry and it appears here.'));
    return;
  }

  const body = el('tbody');
  for (const item of items) {
    const save = patch => api.updateContent(item.id, patch);
    const due = dueLabel(item.deadline);

    const doneBtn = el('button', {
      class: `btn btn-sm${item.done ? '' : ' btn-primary'}`,
      title: item.done ? 'Reopen this entry' : 'Mark the edit complete',
      onclick: async e => {
        e.stopPropagation();
        try {
          await api.updateContent(item.id, { done: !item.done });
          toast(item.done ? 'Reopened' : `Done — “${item.topic}” cleared`);
          import('../app.js').then(m => m.refresh());
        } catch (err) { toast(err.message, true); }
      },
    }, item.done ? '↩ Undo' : '✓ Done');

    body.append(el('tr', { class: item.done ? 'row-done' : '' },
      el('td', { class: 'col-topic' },
        el('div', {
          class: 'topic-link',
          onclick: () => { location.hash = `#/content/${item.id}`; },
        }, item.topic)),
      el('td', {}, textCell(item.assigned_to, v => save({ assigned_to: v }),
                            { placeholder: 'Unassigned' })),
      el('td', {}, textCell(item.deadline, v => save({ deadline: v }),
                            { type: 'date' })),
      el('td', {},
        el('span', { class: `due-badge ${due.cls}` },
           item.done ? 'Completed' : due.text)),
      el('td', {}, selectCell(item.status, STATUSES,
                              v => save({ status: v }), { allowEmpty: false })),
      el('td', { class: 'deadline-actions' }, doneBtn),
    ));
  }

  root.append(el('div', { class: 'table-wrap' },
    el('table', { class: 'grid' },
      el('thead', {}, el('tr', {},
        ['Topic', 'Assigned to', 'Deadline', 'Due', 'Status', '']
          .map(h => el('th', { style: 'cursor:default' }, h)))),
      body)));
}
