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
import { currentMonth, clear, el, toast, formatBytes, formatMonth } from './ui.js';
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

/* --- Breadcrumb ---------------------------------------------------------- */

const SECTIONS = {
  table: 'Library', deadlines: 'Deadlines', calendar: 'Calendar',
  month: 'This Month', dashboard: 'Dashboard', weekly: 'Weekly', money: 'Money',
};

/**
 * Write the top-bar breadcrumb. `segments` is [{label, href?}] — a segment
 * with an href is somewhere you can go back to, and the last one is where you
 * are. Exported because the detail page fills its own entry title in once the
 * fetch lands, and the table view re-states the filters after a rerender.
 */
export function setCrumb(segments) {
  const nav = document.getElementById('crumb-path');
  if (!nav) return;
  clear(nav);
  segments.forEach((seg, i) => {
    if (i) nav.append(el('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '/'));
    nav.append(seg.href
      ? el('a', { class: 'crumb-link', href: seg.href }, seg.label)
      : el('span', {
          class: `crumb-seg${i === segments.length - 1 ? ' is-current' : ''}`,
          'aria-current': i === segments.length - 1 ? 'page' : null,
        }, seg.label));
  });
}

/**
 * The filters currently narrowing the library, as trailing crumb segments —
 * the one thing up here the lit sidebar tile cannot tell you. Only the table
 * and month views read `state.filters`, so nothing else grows a tail.
 */
function appliedCrumbs(active) {
  if (active !== 'table' && active !== 'month') return [];
  const f = state.filters;
  const MEDIA_LABELS = {
    raw: 'Has raw', final: 'Has final', rawonly: 'Raw, not cut yet',
    unposted: 'Not posted yet', none: 'No video',
  };
  const parts = [f.status, f.type, f.performance,
                 f.month ? formatMonth(f.month) : '', MEDIA_LABELS[f.media] || '']
    .filter(Boolean);
  if (state.search) parts.push(`“${state.search}”`);
  return parts.map(label => ({ label }));
}

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

/**
 * Render the route in the address bar.
 *
 * `inPlace` is what an inline save passes. A save is not navigation: the user
 * is looking at a row halfway down the page and expects to still be looking
 * at it afterwards. Two things otherwise move the page under them —
 *
 *   · clear(root) empties the view while the refetch is still in flight, so
 *     the document collapses to nothing and the browser clamps scroll to 0;
 *   · the #view entry animation replays, sliding every card up 6px again.
 *
 * so this captures the scroll offset up front, suppresses the animation for
 * that render, and puts the offset back once the DOM is rebuilt.
 */
async function route({ inPlace = false } = {}) {
  const { parts, name } = parseHash();
  const root = viewRoot();
  const keepY = inPlace ? window.scrollY : 0;
  root.classList.toggle('no-anim', inPlace);

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

  // Highlight the current view in the sidebar. The detail page belongs to
  // whichever list it was opened from, so that item stays lit while editing.
  const cameFrom = (state.returnTo || '').split('/')[2];
  const active = name === 'weekly' ? 'weekly'
    : name === 'money' ? 'money'
    : name === 'content'
      ? (LIBRARY_RENDERERS[cameFrom] ? cameFrom : 'table')
    : (LIBRARY_RENDERERS[parts[1]] ? parts[1] : 'table');
  document.querySelectorAll('.side-link').forEach(a =>
    a.classList.toggle('active', a.dataset.route === active));

  // The breadcrumb mirrors the sidebar selection and then says what is applied
  // on top of it, which is the only thing up here the sidebar does not already
  // tell you. A detail page shows the list it was opened from, then the entry.
  const here = name === 'content' ? 'Entry' : (SECTIONS[active] || 'Library');
  setCrumb(name === 'content'
    ? [{ label: SECTIONS[active] || 'Library', href: state.returnTo }, { label: 'Entry' }]
    : [{ label: here }, ...appliedCrumbs(active)]);
  document.title = `${here} · Content Hub`;
  // A tap on a nav item closes the drawer on narrow screens.
  document.getElementById('sidebar').classList.remove('is-open');

  clear(root);

  try {
    if (name === 'weekly') {
      await renderWeekly(root);
    } else if (name === 'money') {
      await renderMoney(root);
    } else if (name === 'content' && parts[1]) {
      await renderDetail(root, Number(parts[1]));
    } else {
      const render = LIBRARY_RENDERERS[parts[1] || 'table'] || renderTable;
      await render(root, state);
    }
  } catch (err) {
    console.error(err);
    clear(root);
    root.append(el('div', { class: 'empty' },
      el('span', { class: 'empty-icon' }, '⚠️'),
      el('div', {}, 'Something went wrong'),
      el('div', { style: 'font-size:12px;margin-top:6px' }, err.message)));
  }

  if (inPlace && keepY) {
    // Twice on purpose: once now, and once after the browser has laid the
    // rebuilt page out, because the first call cannot scroll further than
    // the height the document has at that instant.
    window.scrollTo(0, keepY);
    requestAnimationFrame(() => window.scrollTo(0, keepY));
  }
}

/**
 * Re-render after a mutation. Keeps the scroll position and skips the entry
 * animation — an inline edit is not navigation, so the page must not move.
 */
export function refresh() { return route({ inPlace: true }); }

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

  // Narrow screens collapse the sidebar to a drawer; this is its handle.
  document.getElementById('side-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('is-open');
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
