/**
 * Weekly — a week-by-week database of the channel's videos.
 *
 * Not a planning template: every row IS a video from the content library,
 * placed on the day of its upload date. Page with ◀ / ▶ to see what went out
 * (or is scheduled) in any past or future week; edits here save on the video
 * itself, so the table, calendar and detail views always agree.
 *
 * A day can hold any number of videos. Typing a topic on an empty day —
 * or clicking a day's + — creates a new video scheduled for that date.
 */

import { api } from '../api.js';
import {
  el, textCell, selectCell, loading, toast, toISODate,
  STATUSES, PERFORMANCES,
} from '../ui.js';

// Which week is showing, in whole weeks relative to the current one
// (-1 = last week, +1 = next week). Kept across re-renders so an inline save
// does not snap the view back to today.
let weekOffset = 0;

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday',
                   'Friday', 'Saturday', 'Sunday'];

/** ISO date of the day `dayIndex` days after the shown week's Monday. */
function dayISO(dayIndex) {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + weekOffset * 7 + dayIndex);
  return toISODate(d);
}

/** 'Jul 20 – Jul 26, 2026' for the shown week's header. */
function weekRangeLabel() {
  const opts = { month: 'short', day: 'numeric' };
  const mon = new Date(dayISO(0) + 'T00:00:00');
  const sun = new Date(dayISO(6) + 'T00:00:00');
  return `${mon.toLocaleDateString(undefined, opts)} – ` +
         `${sun.toLocaleDateString(undefined, { ...opts, year: 'numeric' })}`;
}

export async function renderWeekly(root) {
  const spinner = loading();
  root.append(spinner);
  const monday = dayISO(0), sunday = dayISO(6);
  const items = await api.listContent({});
  spinner.remove();

  // Videos of this week, grouped by upload date.
  const byDate = {};
  for (const item of items) {
    const d = item.upload_date;
    if (d && d >= monday && d <= sunday) (byDate[d] ??= []).push(item);
  }
  const total = Object.values(byDate).reduce((n, v) => n + v.length, 0);

  const refresh = () => import('../app.js').then(m => m.refresh());
  const go = offset => { weekOffset = offset; refresh(); };

  const createVideo = async (iso, topic = 'Untitled') => {
    try {
      await api.createContent({ topic, status: 'Idea', upload_date: iso });
      toast('Video added');
      refresh();
    } catch (err) { toast(err.message, true); }
  };

  root.append(el('div', { class: 'view-header' },
    el('h1', { class: 'view-title' }, 'Weekly'),
    el('span', { class: 'view-sub' }, weekRangeLabel()),
    weekOffset === 0
      ? el('span', { class: 'chip chip-t3' }, 'This week')
      : el('span', { class: 'chip' },
          weekOffset < 0 ? `${-weekOffset}w ago` : `in ${weekOffset}w`),
    el('span', { class: 'view-sub' },
      `${total} video${total === 1 ? '' : 's'} this week`),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn btn-sm', title: 'Previous week',
                   onclick: () => go(weekOffset - 1) }, '◀ Prev'),
    el('button', { class: 'btn btn-sm', title: 'Jump to the current week',
                   disabled: weekOffset === 0 ? '' : null,
                   onclick: () => go(0) }, 'This week'),
    el('button', { class: 'btn btn-sm', title: 'Next week',
                   onclick: () => go(weekOffset + 1) }, 'Next ▶'),
  ));

  const todayISO = toISODate(new Date());
  const body = el('tbody');

  for (let i = 0; i < 7; i++) {
    const iso = dayISO(i);
    const isToday = iso === todayISO;
    const videos = byDate[iso] || [];

    // Day cell spans all of the day's rows; the + schedules another video.
    const dayCell = el('td', {
      class: 'day-cell',
      rowspan: Math.max(videos.length, 1),

    },
      DAY_NAMES[i],
      el('span', { class: 'day-date' },
         new Date(iso + 'T00:00:00')
           .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
      isToday ? el('span', { class: 'today-dot', title: 'Today' }) : null,
      el('button', {
        class: 'btn btn-sm day-add', title: 'Add a video on this day',
        onclick: () => createVideo(iso),
      }, '+'));

    if (!videos.length) {
      // Empty day: one row whose topic input creates a video when filled in.
      body.append(el('tr', { class: isToday ? 'is-today' : '' },
        dayCell,
        el('td', {}, textCell('', v => {
          if (v.trim()) return createVideo(iso, v.trim());
        }, { placeholder: 'Type a topic to add a video…' })),
        ...['', '', '', '', ''].map(() =>
          el('td', {}, el('span', { class: 'cell-blank' }, '—')))));
      continue;
    }

    videos.forEach((video, n) => {
      const save = patch => api.updateContent(video.id, patch);
      const media = video.raw_count + video.final_count;

      body.append(el('tr', { class: isToday ? 'is-today' : '' },
        n === 0 ? dayCell : null,
        el('td', { class: 'cell-linked' },
          textCell(video.topic, v => save({ topic: v }), { placeholder: '—' }),
          el('a', {
            href: `#/content/${video.id}`, title: 'Open this video',
            class: 'open-link',
          }, '↗')),
        el('td', {}, selectCell(video.status, STATUSES,
                                v => save({ status: v }), { allowEmpty: false })),
        el('td', {}, textCell(video.assigned_to, v => save({ assigned_to: v }),
                              { placeholder: '—' })),
        el('td', {}, selectCell(video.performance, PERFORMANCES,
                                v => save({ performance: v }))),
        el('td', { class: 'media-count' },
          media ? `${video.raw_count} raw · ${video.final_count} final` : '—'),
        el('td', {}, textCell(video.deadline, v => save({ deadline: v }),
                              { type: 'date' })),
      ));
    });
  }

  root.append(el('div', { class: 'table-wrap' },
    el('table', { class: 'week-table' },
      el('thead', {}, el('tr', {},
        ['Day', 'Video', 'Status', 'Assigned to', 'Performance',
         'Files', 'Deadline']
          .map(h => el('th', {}, h)))),
      body)));

  root.append(el('p', { class: 'view-sub', style: 'margin-top:12px' },
    'Every row is a video from the library, shown on its upload date. '
    + 'Edits save automatically and sync with the table, calendar and detail '
    + 'views. Use ◀ ▶ to browse any week.'));
}
