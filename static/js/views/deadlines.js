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
 *
 * Each row also carries an "⬆ Final" button so the editor's finished cut can
 * be uploaded right here — the delivery workflow is upload, then Done, without
 * a detour through the library to find the entry.
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

/**
 * The "⬆ Final" cell: a hidden file input plus a button that shows upload
 * progress in place. The count of already-uploaded final videos rides on the
 * button label, so a row with a delivered cut is visible at a glance.
 */
function finalUploadCell(item) {
  const input = el('input', {
    type: 'file', accept: 'video/*', multiple: 'true', style: 'display:none',
  });
  const btn = el('button', {
    class: 'btn btn-sm',
    title: item.final_count
      ? `${item.final_count} final video${item.final_count === 1 ? '' : 's'} uploaded — add another`
      : 'Upload the editor’s final cut straight to this entry',
    onclick: e => { e.stopPropagation(); input.click(); },
  }, item.final_count ? `⬆ Final · ${item.final_count}` : '⬆ Final');

  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;
    btn.disabled = true;
    let done = 0;
    try {
      // One at a time so the button can show honest per-file progress.
      for (const file of files) {
        const { promise } = api.uploadMedia(item.id, 'final', file,
          (loaded, total, ratio) => {
            btn.textContent = (files.length > 1 ? `${done + 1}/${files.length} · ` : '')
                            + `${Math.round(ratio * 100)}%`;
          });
        await promise;
        done++;
      }
      toast(`Uploaded ${done === 1 ? files[0].name : `${done} videos`} to “${item.topic}”`);
    } catch (err) {
      toast(err.message, true, 6000);
    }
    import('../app.js').then(m => m.refresh());
  });

  return el('span', {}, input, btn);
}

// Kept across re-renders so the toggle survives a refresh.
let showCompleted = false;

export async function renderDeadlines(root, state) {
  const spinner = loading();
  root.append(spinner);

  // Only entries actually assigned to someone. This view is about tracking
  // other people's work, so unassigned ideas would just be noise.
  const items = await api.listContent({
    search: state.search,
    done: showCompleted ? true : false,
    assigned: true,
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
      (() => {
        const people = new Set(items.map(i => i.assigned_to.trim()).filter(Boolean));
        return `${items.length} assigned` +
               (people.size ? ` across ${people.size} ${people.size === 1 ? 'person' : 'people'}` : '');
      })()),
    overdue ? el('span', { class: 'chip chip-bad' }, `${overdue} overdue`) : null,
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
                    : 'Nothing assigned',
      showCompleted ? 'Rows you mark Done will collect here.'
                    : 'Only entries with someone in “Assigned to” appear here. '
                      + 'Set an assignee on an entry and it shows up.'));
    return;
  }

  const list = el('div', { class: 'deadline-list' });
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

    // One card per assignment rather than a table row: the edge bar carries
    // the urgency, so the list can be scanned by colour alone before any
    // text is read.
    list.append(el('div', { class: `deadline-card${item.done ? ' row-done' : ''}` },
      el('span', { class: `deadline-edge ${item.done ? 'due-done' : due.cls}` }),
      el('div', { class: 'deadline-main' },
        el('div', {
          class: 'topic-link',
          onclick: () => { location.hash = `#/content/${item.id}`; },
        }, item.topic),
        textCell(item.deadline, v => save({ deadline: v }), { type: 'date' })),
      el('div', { class: 'deadline-who' },
        textCell(item.assigned_to, v => save({ assigned_to: v }),
                 { placeholder: 'Unassigned' })),
      el('div', {},
        el('span', { class: `due-badge ${due.cls}` },
           item.done ? 'Completed' : due.text)),
      el('div', {}, selectCell(item.status, STATUSES,
                               v => save({ status: v }), { allowEmpty: false })),
      el('div', { class: 'deadline-actions' }, finalUploadCell(item)),
      el('div', { class: 'deadline-actions' }, doneBtn),
    ));
  }

  root.append(list);
}
