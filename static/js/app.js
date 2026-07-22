/**
 * Application shell: hash router, shared state, top-bar wiring.
 *
 * Routes
 *   #/library            -> table view (default)
 *   #/library/board      -> kanban by Status
 *   #/library/calendar   -> month grid on Upload date
 *   #/library/month      -> list filtered to one month
 *   #/content/:id        -> detail page
 *   #/weekly             -> weekly recurring template
 *
 * Using the hash rather than the History API keeps the whole thing static —
 * no server-side route handling and no build step.
 */

import { api } from './api.js';
import { currentMonth, clear, el, toast, formatBytes } from './ui.js';
import { renderTable }    from './views/table.js';
import { renderBoard }    from './views/board.js';
import { renderCalendar } from './views/calendar.js';
import { renderMonth }    from './views/month.js';
import { renderDetail }   from './views/detail.js';
import { renderWeekly }   from './views/weekly.js';

/**
 * Shared, mutable app state.
 *
 * `month` seeds from today's date, so the calendar and month views open on the
 * current month automatically and follow the real calendar as time passes. The
 * user can still page to any other month.
 */
export const state = {
  month: currentMonth(),
  search: '',
  sort: 'updated_at',
  direction: 'desc',
};

const viewRoot = () => document.getElementById('view');

/* --- Routing ------------------------------------------------------------- */

function parseHash() {
  const raw = (location.hash || '#/library').replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);
  return { parts, name: parts[0] || 'library' };
}

const LIBRARY_TABS = [
  { id: 'table',    label: 'Table',      hash: '#/library' },
  { id: 'board',    label: 'Board',      hash: '#/library/board' },
  { id: 'calendar', label: 'Calendar',   hash: '#/library/calendar' },
  { id: 'month',    label: 'This Month', hash: '#/library/month' },
];

/** Tab bar shared by the four library views. */
function tabBar(active) {
  return el('div', { class: 'tabs' },
    LIBRARY_TABS.map(t =>
      el('a', {
        class: `tab${t.id === active ? ' active' : ''}`,
        href: t.hash,
      }, t.label)),
  );
}

async function route() {
  const { parts, name } = parseHash();
  const root = viewRoot();

  // Highlight the active top-level section.
  const section = name === 'weekly' ? 'weekly' : 'library';
  document.querySelectorAll('.section-link').forEach(a =>
    a.classList.toggle('active', a.dataset.section === section));

  clear(root);

  try {
    if (name === 'weekly') {
      await renderWeekly(root);
      return;
    }

    if (name === 'content' && parts[1]) {
      await renderDetail(root, Number(parts[1]));
      return;
    }

    // Library views, all sharing the tab bar.
    const tab = parts[1] || 'table';
    const renderers = {
      table: renderTable, board: renderBoard,
      calendar: renderCalendar, month: renderMonth,
    };
    const render = renderers[tab] || renderTable;
    root.append(tabBar(renderers[tab] ? tab : 'table'));
    await render(root, state);
  } catch (err) {
    console.error(err);
    clear(root);
    root.append(el('div', { class: 'empty' },
      el('span', { class: 'empty-icon' }, '⚠️'),
      el('div', {}, 'Something went wrong'),
      el('div', { style: 'font-size:12px;margin-top:6px' }, err.message)));
  }
}

/** Re-render the current route; used after a mutation changes the data. */
export function refresh() { route(); }

/* --- Top bar ------------------------------------------------------------- */

function wireTopBar() {
  // Debounced search so typing does not fire a request per keystroke.
  const search = document.getElementById('search');
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.search = search.value.trim();
      // Searching from a non-list view jumps to the table, where results show.
      const { name, parts } = parseHash();
      if (name !== 'library' || parts[1] === 'calendar') location.hash = '#/library';
      else route();
    }, 220);
  });

  // "/" focuses search, Escape clears it — as long as you are not already typing.
  document.addEventListener('keydown', e => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
    if (e.key === '/' && !typing) { e.preventDefault(); search.focus(); }
    if (e.key === 'Escape' && e.target === search) {
      search.value = ''; state.search = ''; search.blur(); route();
    }
  });

  document.getElementById('new-entry').addEventListener('click', async () => {
    try {
      // New entries land on today's date so they appear in the current month.
      const created = await api.createContent({
        topic: 'Untitled', status: 'Idea',
      });
      location.hash = `#/content/${created.id}`;
      toast('Entry created');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

/** Footer shows the resolved media path and free space on that drive. */
async function showConfig() {
  try {
    const cfg = await api.config();
    document.getElementById('footer-media').textContent = `media: ${cfg.media_root}`;
    if (cfg.disk) {
      document.getElementById('footer-disk').textContent =
        `${formatBytes(cfg.disk.free_bytes)} free of ${formatBytes(cfg.disk.total_bytes)}`;
    }
  } catch {
    document.getElementById('footer-media').textContent = 'media: unavailable';
  }
}

/* --- Boot ---------------------------------------------------------------- */

window.addEventListener('hashchange', route);
wireTopBar();
showConfig();
route();
