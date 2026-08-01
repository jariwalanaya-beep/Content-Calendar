/**
 * Application shell: hash router, shared state, top-bar wiring.
 *
 * Routes
 *   #/library            -> table view (default)
 *   #/library/deadlines  -> assignments and editor deadlines
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
import { renderDeadlines } from './views/deadlines.js';
import { renderCalendar } from './views/calendar.js';
import { renderMonth }    from './views/month.js';
import { renderDetail, discardIfEmpty } from './views/detail.js';
import { renderWeekly }   from './views/weekly.js';
import { renderDashboard } from './views/dashboard.js';
import { renderMoney }    from './views/money.js';

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
  // Table view column filters. Empty string means "no filter" for each; they
  // are independent of `month` above, which the calendar/month views own.
  filters: {
    // `media` is '' | 'raw' | 'final' | 'none' — which video bucket an entry
    // must have. The detail view writes to it to jump into a filtered library.
    status: '', type: '', performance: '', month: '', media: '',
  },
  // Hash of the last list view visited. The detail page reads it to label its
  // back link and to pick which list its ‹ › stepper walks.
  returnTo: '#/library',
};

const viewRoot = () => document.getElementById('view');

/* --- Routing ------------------------------------------------------------- */

function parseHash() {
  const raw = (location.hash || '#/library').replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);
  return { parts, name: parts[0] || 'library' };
}

const LIBRARY_RENDERERS = {
  table: renderTable, deadlines: renderDeadlines,
  calendar: renderCalendar, month: renderMonth,
  dashboard: renderDashboard,
};

// The detail page whose entry gets discarded if it is still empty when the
// user navigates away — so backing out of a fresh "+ New" leaves no
// "Untitled" husk in the library.
let openDetailId = null;

async function route() {
  const { parts, name } = parseHash();
  const root = viewRoot();

  // Leaving a detail page? Clean up first, so the view rendered below
  // (which may list entries) never shows the row being discarded.
  const detailId = name === 'content' && parts[1] ? parts[1] : null;
  if (openDetailId && openDetailId !== detailId) {
    await discardIfEmpty(Number(openDetailId));
  }
  openDetailId = detailId;

  // Remember the last list the user was on, so a detail page opened from
  // Deadlines goes *back* to Deadlines and steps through that list rather
  // than silently dumping the user in the library.
  if (name !== 'content') state.returnTo = location.hash || '#/library';

  // Highlight the current view in the top bar. The detail page belongs to
  // whichever list it was opened from, so that tab stays lit while editing.
  const cameFrom = (state.returnTo || '').split('/')[2];
  const active = name === 'weekly' ? 'weekly'
    : name === 'money' ? 'money'
    : name === 'content'
      ? (LIBRARY_RENDERERS[cameFrom] ? cameFrom : 'table')
    : (LIBRARY_RENDERERS[parts[1]] ? parts[1] : 'table');
  document.querySelectorAll('.section-link').forEach(a =>
    a.classList.toggle('active', a.dataset.route === active));

  clear(root);

  try {
    if (name === 'weekly') {
      await renderWeekly(root);
      return;
    }

    if (name === 'money') {
      await renderMoney(root);
      return;
    }

    if (name === 'content' && parts[1]) {
      await renderDetail(root, Number(parts[1]));
      return;
    }

    const render = LIBRARY_RENDERERS[parts[1] || 'table'] || renderTable;
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

  // "/" focuses search, Escape clears it, 1-6 switch views — as long as you
  // are not already typing in a field.
  const VIEW_KEYS = {
    1: '#/library', 2: '#/library/deadlines', 3: '#/library/calendar',
    4: '#/library/month', 5: '#/library/dashboard', 6: '#/weekly',
    7: '#/money',
  };
  document.addEventListener('keydown', e => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
    if (e.key === '/' && !typing) { e.preventDefault(); search.focus(); }
    if (VIEW_KEYS[e.key] && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      location.hash = VIEW_KEYS[e.key];
    }
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
