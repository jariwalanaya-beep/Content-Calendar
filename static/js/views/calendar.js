/**
 * Calendar view — month grid placing entries on their Upload date.
 *
 * Opens on the current month (state.month is seeded from today's date in
 * app.js) with next/previous navigation and a "Today" reset.
 */

import { api } from '../api.js';
import { openPreview } from './preview.js';
import {
  el, chip, loading, formatMonth, shiftMonth, toISODate, currentMonth, STATUSES,
} from '../ui.js';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_PER_DAY = 3;   // beyond this, show a "+N more" line

export async function renderCalendar(root, state) {
  const spinner = loading();
  root.append(spinner);
  const items = await api.listContent({ month: state.month });
  spinner.remove();

  // --- toolbar ---
  const nav = delta => () => {
    state.month = shiftMonth(state.month, delta);
    import('../app.js').then(m => m.refresh());
  };

  root.append(el('div', { class: 'cal-toolbar' },
    el('span', { class: 'cal-month-label' }, formatMonth(state.month)),
    el('button', { class: 'btn btn-sm', onclick: nav(-1), title: 'Previous month' }, '‹'),
    el('button', {
      class: 'btn btn-sm',
      onclick: () => {
        state.month = currentMonth();
        import('../app.js').then(m => m.refresh());
      },
    }, 'Today'),
    el('button', { class: 'btn btn-sm', onclick: nav(1), title: 'Next month' }, '›'),
    el('span', { class: 'view-sub spacer' },
      `${items.length} scheduled this month`),
  ));

  // --- grid geometry ---
  const [year, month] = state.month.split('-').map(Number);
  const firstOfMonth = new Date(year, month - 1, 1);
  // JS weeks start Sunday; shift so Monday is column 0.
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayISO = toISODate(new Date());

  // Bucket entries by date so each cell is a cheap lookup.
  const byDate = new Map();
  for (const item of items) {
    if (!item.upload_date) continue;
    if (!byDate.has(item.upload_date)) byDate.set(item.upload_date, []);
    byDate.get(item.upload_date).push(item);
  }

  const grid = el('div', { class: 'cal-grid' });
  for (const d of DOW) grid.append(el('div', { class: 'cal-dow' }, d));

  // Trailing days of the previous month, greyed out.
  const prevMonthDays = new Date(year, month - 1, 0).getDate();
  for (let i = leadingBlanks; i > 0; i--) {
    grid.append(el('div', { class: 'cal-day other-month' },
      el('div', { class: 'cal-daynum' }, prevMonthDays - i + 1)));
  }

  // The month itself.
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${state.month}-${String(day).padStart(2, '0')}`;
    const dayItems = byDate.get(iso) || [];

    const cell = el('div', {
      class: `cal-day${iso === todayISO ? ' today' : ''}`,
    }, el('div', { class: 'cal-daynum' }, day));

    for (const item of dayItems.slice(0, MAX_PER_DAY)) {
      const color = STATUSES.find(s => s.value === item.status)?.color ?? 'n';
      // Opens a popup rather than navigating, so you keep your place in the
      // month while inspecting the entry's videos and fields.
      cell.append(el('div', {
        class: `cal-event chip-${color}`,
        title: `${item.topic} — ${item.status}`,
        onclick: () => openPreview(item.id),
      }, item.topic));
    }
    if (dayItems.length > MAX_PER_DAY) {
      cell.append(el('div', { class: 'cal-more' },
        `+${dayItems.length - MAX_PER_DAY} more`));
    }
    grid.append(cell);
  }

  // Leading days of the next month, to square off the final row.
  const used = leadingBlanks + daysInMonth;
  const trailing = (7 - (used % 7)) % 7;
  for (let i = 1; i <= trailing; i++) {
    grid.append(el('div', { class: 'cal-day other-month' },
      el('div', { class: 'cal-daynum' }, i)));
  }

  root.append(grid);
}
