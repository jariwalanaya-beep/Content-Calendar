/**
 * Weekly template — the fixed Monday-to-Sunday production format.
 *
 * Seven rows, always. This is a recurring pattern rather than a dated schedule,
 * so rows cannot be added or removed; every cell edits in place and saves
 * immediately.
 */

import { api } from '../api.js';
import { el, textCell, loading } from '../ui.js';

// Suggestions offered as a datalist — free text is still allowed, these just
// save typing for the formats and ideas already in rotation.
const FORMAT_SUGGESTIONS = [
  'JumperJump', 'JumperJump or Joe Rogan', 'Elon Musk clone', 'Planning',
];
const IDEA_SUGGESTIONS = [
  'Celebrity', 'Story / "the case"',
  'Everyday Products / Strange Science / Consumer Scams', 'Theory',
  'Ancient Mysteries / Strange Science / Space', 'Planning',
];

export async function renderWeekly(root) {
  const spinner = loading();
  root.append(spinner);
  const days = await api.getWeek();
  spinner.remove();

  root.append(el('div', { class: 'view-header' },
    el('h1', { class: 'view-title' }, 'Weekly Template'),
    el('span', { class: 'view-sub' },
      'Your repeating weekly format — not tied to specific dates'),
  ));

  // Datalists power the suggestion dropdowns on the text inputs.
  const mkDatalist = (id, values) =>
    el('datalist', { id }, values.map(v => el('option', { value: v })));
  root.append(mkDatalist('format-options', FORMAT_SUGGESTIONS));
  root.append(mkDatalist('idea-options', IDEA_SUGGESTIONS));

  // Highlight the row for today. JS weeks start Sunday; shift to Monday-first.
  const todayIndex = (new Date().getDay() + 6) % 7;

  const body = el('tbody');
  for (const day of days) {
    const save = patch => api.updateDay(day.day_index, patch);
    const isToday = day.day_index === todayIndex;

    const formatInput = textCell(day.format, v => save({ format: v }),
                                 { placeholder: '—' });
    formatInput.setAttribute('list', 'format-options');

    const ideaInput = textCell(day.content_idea, v => save({ content_idea: v }),
                               { placeholder: '—' });
    ideaInput.setAttribute('list', 'idea-options');

    body.append(el('tr', { class: isToday ? 'is-today' : '' },
      el('td', { class: 'day-cell' },
        day.day_name,
        isToday ? el('span', { class: 'today-dot', title: 'Today' }) : null),
      el('td', {}, formatInput),
      el('td', {}, ideaInput),
      el('td', {}, textCell(day.topic, v => save({ topic: v }),
                            { placeholder: '—' })),
      el('td', {}, textCell(day.assigned_to, v => save({ assigned_to: v }),
                            { placeholder: '—' })),
      el('td', {}, textCell(day.editor_deadline, v => save({ editor_deadline: v }),
                            { type: 'date' })),
    ));
  }

  root.append(el('div', { class: 'table-wrap' },
    el('table', { class: 'week-table' },
      el('thead', {}, el('tr', {},
        ['Day', 'Format', 'Content Idea', 'Topic', 'Assigned to', 'Editor deadline']
          .map(h => el('th', {}, h)))),
      body)));

  root.append(el('p', { class: 'view-sub', style: 'margin-top:12px' },
    'Changes save automatically as you leave each field.'));
}
