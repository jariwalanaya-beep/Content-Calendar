/**
 * Table view — the default. Every field is inline-editable; clicking the Topic
 * opens the detail page.
 */

import { api } from '../api.js';
import {
  el, textCell, selectCell, emptyState, loading, toast, confirmDialog,
  STATUSES, PERFORMANCES, TYPES,
} from '../ui.js';

const COLUMNS = [
  { key: 'topic',       label: 'Topic',       sortable: true,  cls: 'col-topic' },
  { key: 'title',       label: 'Title',       sortable: true,  cls: 'col-title' },
  { key: 'status',      label: 'Status',      sortable: true  },
  { key: 'type',        label: 'Type',        sortable: true  },
  { key: 'performance', label: 'Performance', sortable: true  },
  { key: 'assigned_to', label: 'Assigned to', sortable: true  },
  { key: 'upload_date', label: 'Upload date', sortable: true  },
  { key: 'media',       label: 'Media',       sortable: false },
  { key: 'actions',     label: '',            sortable: false },
];

export async function renderTable(root, state) {
  const spinner = loading();
  root.append(spinner);

  const items = await api.listContent({
    search: state.search, sort: state.sort, direction: state.direction,
  });
  spinner.remove();

  root.append(el('div', { class: 'view-header' },
    el('h1', { class: 'view-title' }, 'Content Library'),
    el('span', { class: 'view-sub' },
      `${items.length} ${items.length === 1 ? 'entry' : 'entries'}` +
      (state.search ? ` matching “${state.search}”` : '')),
  ));

  if (!items.length) {
    root.append(emptyState('📋',
      state.search ? 'No entries match that search' : 'No entries yet',
      state.search ? 'Try a different topic.' : 'Hit + New to create your first one.'));
    return;
  }

  // --- header ---
  const headRow = el('tr');
  for (const col of COLUMNS) {
    const isSorted = state.sort === col.key;
    headRow.append(el('th', {
      class: `${col.cls || ''}${isSorted ? ' sorted' : ''}`,
      style: col.sortable ? '' : 'cursor:default',
      onclick: col.sortable ? () => {
        // Clicking the active column flips direction; a new column starts asc.
        if (state.sort === col.key) {
          state.direction = state.direction === 'asc' ? 'desc' : 'asc';
        } else {
          state.sort = col.key; state.direction = 'asc';
        }
        root.replaceChildren();
        import('../app.js').then(m => m.refresh());
      } : null,
    },
      col.label,
      col.sortable
        ? el('span', { class: 'sort-arrow' },
            isSorted ? (state.direction === 'asc' ? '▲' : '▼') : '↕')
        : null,
    ));
  }

  // --- body ---
  const body = el('tbody');
  for (const item of items) {
    const save = patch => api.updateContent(item.id, patch);

    const mediaLabel = [
      item.raw_count   ? `${item.raw_count} raw`     : null,
      item.final_count ? `${item.final_count} final` : null,
    ].filter(Boolean).join(' · ');

    body.append(el('tr', {},
      el('td', { class: 'col-topic' },
        el('div', {
          class: 'topic-link',
          onclick: () => { location.hash = `#/content/${item.id}`; },
        },
          el('span', {}, item.topic),
          (item.raw_count + item.final_count)
            ? el('span', { class: 'attach-badge' },
                `🎬${item.raw_count + item.final_count}`)
            : null,
        )),
      el('td', { class: 'col-title' },
        textCell(item.title, v => save({ title: v }), { placeholder: '—' })),
      el('td', {}, selectCell(item.status, STATUSES,
                              v => save({ status: v }), { allowEmpty: false })),
      el('td', {}, selectCell(item.type, TYPES, v => save({ type: v }))),
      el('td', {}, selectCell(item.performance, PERFORMANCES,
                              v => save({ performance: v }))),
      el('td', {}, textCell(item.assigned_to, v => save({ assigned_to: v }),
                            { placeholder: '—' })),
      el('td', {}, textCell(item.upload_date, v => save({ upload_date: v }),
                            { type: 'date' })),
      el('td', {}, el('span', { class: 'media-meta' }, mediaLabel || '—')),
      el('td', { class: 'row-actions' },
        el('button', {
          class: 'btn btn-ghost btn-sm',
          title: 'Delete entry',
          onclick: async e => {
            e.stopPropagation();
            const n = item.raw_count + item.final_count;
            const ok = await confirmDialog(
              'Delete this entry?',
              `“${item.topic}” will be deleted permanently` +
              (n ? `, along with ${n} video file${n === 1 ? '' : 's'} on disk.` : '.'),
            );
            if (!ok) return;
            try {
              await api.deleteContent(item.id);
              toast('Entry deleted');
              import('../app.js').then(m => m.refresh());
            } catch (err) { toast(err.message, true); }
          },
        }, '🗑')),
    ));
  }

  root.append(el('div', { class: 'table-wrap' },
    el('table', { class: 'grid' }, el('thead', {}, headRow), body)));
}
