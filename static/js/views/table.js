/**
 * Table view — the default. Every field is inline-editable; clicking the Topic
 * opens the detail page.
 */

import { api } from '../api.js';
import {
  el, textCell, selectCell, emptyState, loading, toast, confirmDialog,
  formatMonth, STATUSES, PERFORMANCES, TYPES,
} from '../ui.js';

/** Refresh the current route after a filter changes. */
const rerender = () => import('../app.js').then(m => m.refresh());

const COLUMNS = [
  { key: 'topic',       label: 'Topic',       sortable: true,  cls: 'col-topic' },
  { key: 'status',      label: 'Status',      sortable: true  },
  { key: 'type',        label: 'Type',        sortable: true  },
  { key: 'performance', label: 'Performance', sortable: true  },
  { key: 'assigned_to', label: 'Assigned to', sortable: true  },
  { key: 'upload_date', label: 'Upload date', sortable: true  },
  { key: 'media',       label: 'Media',       sortable: false },
  { key: 'actions',     label: '',            sortable: false },
];

export async function renderTable(root, state) {
  const f = state.filters;
  const spinner = loading();
  root.append(spinner);

  const [items, months] = await Promise.all([
    api.listContent({
      search: state.search, sort: state.sort, direction: state.direction,
      status: f.status, type: f.type, performance: f.performance,
      month: f.month, media: f.media || undefined,
    }),
    api.listMonths(),
  ]);
  spinner.remove();

  const activeCount =
    (f.status ? 1 : 0) + (f.type ? 1 : 0) + (f.performance ? 1 : 0) +
    (f.month ? 1 : 0) + (f.media ? 1 : 0);
  const narrowed = activeCount > 0 || !!state.search;

  // Footage tally for whatever is on screen: the answer to "how much raw have
  // I got sitting there?" without opening a single entry.
  const rawTotal   = items.reduce((n, i) => n + i.raw_count, 0);
  const finalTotal = items.reduce((n, i) => n + i.final_count, 0);

  root.append(el('div', { class: 'view-header' },
    el('h1', { class: 'view-title' }, 'Content Library'),
    el('span', { class: 'view-sub' },
      `${items.length} ${items.length === 1 ? 'entry' : 'entries'}` +
      (rawTotal || finalTotal ? ` · ${rawTotal} raw · ${finalTotal} final` : '') +
      (state.search ? ` matching “${state.search}”` : '') +
      (activeCount ? ` · ${activeCount} filter${activeCount === 1 ? '' : 's'}` : '')),
  ));

  root.append(filterBar(state, months));

  if (!items.length) {
    root.append(emptyState('📋',
      narrowed ? 'No entries match these filters' : 'No entries yet',
      narrowed ? 'Try loosening or clearing the filters above.'
               : 'Hit + New to create your first one.'));
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
          // A standing status edge: colour tells you where the entry is in
          // the pipeline before you read a word of the row.
          el('span', { class: `topic-edge edge-${STATUSES
            .find(s => s.value === item.status)?.color ?? 'n'}` }),
          el('span', {}, item.topic),
          (item.raw_count + item.final_count)
            ? el('span', { class: 'attach-badge' },
                `🎬${item.raw_count + item.final_count}`)
            : null,
        )),
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


/* ------------------------------------------------------------------------- *
 * Filter bar — column filters that map straight onto list_content's query
 * params. Each dropdown writes into state.filters and re-renders the view.
 * ------------------------------------------------------------------------- */

function filterBar(state, months) {
  const f = state.filters;

  // One labelled dropdown. `options` is an array of {value, label}; the empty
  // value is the "all" entry pinned at the top.
  const select = (label, key, allLabel, options) => {
    const sel = el('select', { class: 'filter-select' },
      el('option', { value: '' }, allLabel),
      options.map(o => el('option', { value: o.value }, o.label)));
    sel.value = f[key] || '';
    sel.addEventListener('change', () => { f[key] = sel.value; rerender(); });
    return el('label', { class: 'filter-field' },
      el('span', { class: 'filter-label' }, label), sel);
  };

  // Enum vocabularies use the same string for value and label.
  const opt = arr => arr.map(x => ({ value: x.value, label: x.value }));

  // Which bucket an entry must have. 'raw' vs 'final' is the useful split:
  // raw = footage waiting to be cut, final = a delivered edit.
  const media = el('select', { class: 'filter-select' },
    el('option', { value: '' },      'Any'),
    el('option', { value: 'raw' },   'Has raw'),
    el('option', { value: 'final' }, 'Has final'),
    el('option', { value: 'none' },  'No video'));
  media.value = f.media || '';
  media.addEventListener('change', () => { f.media = media.value; rerender(); });

  const active = f.status || f.type || f.performance || f.month || f.media;

  return el('div', { class: 'filter-bar' },
    select('Status', 'status', 'All statuses', opt(STATUSES)),
    select('Type', 'type', 'All types', opt(TYPES)),
    select('Performance', 'performance', 'All performance', opt(PERFORMANCES)),
    select('Month', 'month', 'All months',
           months.map(m => ({ value: m, label: formatMonth(m) }))),
    el('label', { class: 'filter-field' },
      el('span', { class: 'filter-label' }, 'Media'), media),
    active ? el('button', {
      class: 'btn btn-ghost btn-sm filter-clear',
      onclick: () => {
        f.status = ''; f.type = ''; f.performance = '';
        f.month = ''; f.media = '';
        rerender();
      },
    }, '✕ Clear') : null,
  );
}
