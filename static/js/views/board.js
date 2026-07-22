/**
 * Board view — kanban grouped by Status.
 *
 * Drag a card into another column to change its Status. Uses the native HTML5
 * drag-and-drop API, so there is no library to load.
 */

import { api } from '../api.js';
import { el, chip, emptyState, loading, toast, formatDate, STATUSES } from '../ui.js';

export async function renderBoard(root, state) {
  const spinner = loading();
  root.append(spinner);
  const items = await api.listContent({ search: state.search, sort: 'board_order',
                                        direction: 'asc' });
  spinner.remove();

  root.append(el('div', { class: 'view-header' },
    el('h1', { class: 'view-title' }, 'Board'),
    el('span', { class: 'view-sub' }, 'Drag cards between columns to change status'),
  ));

  const board = el('div', { class: 'board' });

  // Tracks the card being dragged. A module-level variable is enough because
  // only one drag can be in flight at a time.
  let dragged = null;

  for (const status of STATUSES) {
    const inColumn = items.filter(i => i.status === status.value);

    const cards = el('div', { class: 'board-cards' });
    for (const item of inColumn) cards.append(makeCard(item));

    const column = el('div', { class: 'board-col', dataset: { status: status.value } },
      el('div', { class: 'board-col-head' },
        chip(status.value, STATUSES),
        el('span', { class: 'board-count' }, inColumn.length || '')),
      cards,
    );

    // --- drop handling ---
    column.addEventListener('dragover', e => {
      e.preventDefault();                       // required to allow a drop
      e.dataTransfer.dropEffect = 'move';
      column.classList.add('drop-target');
    });
    column.addEventListener('dragleave', e => {
      // Ignore events fired while moving between the column's own children.
      if (!column.contains(e.relatedTarget)) column.classList.remove('drop-target');
    });
    column.addEventListener('drop', async e => {
      e.preventDefault();
      column.classList.remove('drop-target');
      if (!dragged) return;

      const { id, status: from } = dragged;
      const to = status.value;
      if (from === to) return;

      // Move the card immediately, then persist. Feels instant, and the view
      // is rebuilt from the server on failure so nothing can drift out of sync.
      cards.append(document.querySelector(`[data-card-id="${id}"]`));
      try {
        await api.updateContent(id, { status: to });
        toast(`Moved to ${to}`);
        import('../app.js').then(m => m.refresh());
      } catch (err) {
        toast(err.message, true);
        import('../app.js').then(m => m.refresh());
      }
    });

    board.append(column);
  }

  root.append(board);

  if (!items.length) {
    root.append(emptyState('🗂',
      state.search ? 'No entries match that search' : 'No entries yet',
      state.search ? null : 'Hit + New to create one.'));
  }

  /** One draggable card. */
  function makeCard(item) {
    const card = el('div', {
      class: 'card',
      draggable: 'true',
      dataset: { cardId: item.id },
      onclick: () => { location.hash = `#/content/${item.id}`; },
    },
      el('div', { class: 'card-title' }, item.topic),
      el('div', { class: 'card-meta' },
        item.type ? chip(item.type, [{ value: item.type, color: 'grey' }]) : null,
        item.upload_date
          ? el('span', { class: 'card-date' }, formatDate(item.upload_date))
          : null,
        item.assigned_to ? el('span', {}, `· ${item.assigned_to}`) : null,
        (item.raw_count + item.final_count)
          ? el('span', {}, `· 🎬${item.raw_count + item.final_count}`)
          : null,
      ),
    );

    card.addEventListener('dragstart', e => {
      dragged = { id: item.id, status: item.status };
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      // Firefox refuses to start a drag unless some data is set.
      e.dataTransfer.setData('text/plain', String(item.id));
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      dragged = null;
      document.querySelectorAll('.drop-target')
              .forEach(c => c.classList.remove('drop-target'));
    });

    return card;
  }
}
