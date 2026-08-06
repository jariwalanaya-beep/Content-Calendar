/**
 * Shared UI helpers: DOM building, formatting, chips, toasts, dialogs.
 *
 * The select-field vocabularies and their colours are defined here and must
 * stay in step with the enums in models.py. Adding a Status means adding it to
 * STATUSES below plus a .chip-<colour> rule in style.css.
 */

/*
 * Chip tones, not hues. The palette is one accent ramp (t1 → t3, quiet to
 * loud) plus neutral, warn and bad — so a screen full of chips reads as one
 * system instead of a bag of colours. Changing --accent in style.css restyles
 * every chip at once, because the tones are mixed from it.
 */
export const STATUSES = [
  { value: 'Idea',      color: 'n'    },
  { value: 'Thinking',  color: 't1'   },
  { value: 'Editing',   color: 'warn' },
  { value: 'Ready',     color: 't2'   },
  { value: 'Posted',    color: 't3'   },
  { value: 'Failed',    color: 'bad'  },
];

export const PERFORMANCES = [
  { value: 'Viral',   color: 't3'   },
  { value: 'Average', color: 'warn' },
  { value: 'Failed',  color: 'bad'  },
];

export const TYPES = [
  { value: 'Story',        color: 't2'   },
  { value: 'Celebrity',    color: 'warn' },
  { value: 'Theory',       color: 't1'   },
  { value: 'Decode',       color: 't1'   },
  { value: 'Fact',         color: 't3'   },
  { value: 'Lesson',       color: 'n'    },
  { value: 'Hypothetical', color: 't2'   },
  { value: 'Debate',       color: 'bad'  },
  { value: 'Pitch',        color: 'n'    },
];

const colorOf = (list, value) =>
  list.find(o => o.value === value)?.color ?? 'n';

/* --- DOM ----------------------------------------------------------------- */

/**
 * Terse element factory.
 *   el('div', {class: 'card', onclick: fn}, 'text', childEl)
 * Text children are always set via textContent, never innerHTML, so user data
 * such as a topic containing "<" can never inject markup.
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'value') node.value = v;
    else node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const clear = node => { while (node.firstChild) node.removeChild(node.firstChild); };

/* --- Icons --------------------------------------------------------------- *
 * Inline stroke SVG rather than emoji. Emoji are drawn by the OS font: they
 * arrive pre-coloured, sit off the text baseline, and render differently on
 * every machine — three reasons they cannot belong to a designed dark surface.
 * These inherit currentColor, so a menu row's icon dims and lights with its
 * label. (dashboard.js keeps its own `svg()` twin for chart geometry.)
 * ------------------------------------------------------------------------- */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    node.setAttribute(k, v);
  }
  for (const child of children.flat()) if (child) node.append(child);
  return node;
}

/** Build a 24-grid stroke icon from one or more path `d` strings. */
const strokeIcon = (...d) => () => svgEl('svg', {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  'aria-hidden': 'true', focusable: 'false',
}, d.map(p => svgEl('path', { d: p })));

export const ICON = {
  layers:   strokeIcon('M12 3l9 5-9 5-9-5 9-5', 'M3 13l9 5 9-5'),
  // Raw and final are the same rectangle deliberately — both are "there is a
  // file here", and only the state differs: bare strip vs. a playable cut.
  film:     strokeIcon('M4 5.5h16v13H4z', 'M8.5 5.5v13', 'M15.5 5.5v13'),
  filmDone: strokeIcon('M4 5.5h16v13H4z', 'M10 8.8l5.5 3.2-5.5 3.2z'),
  scissors: strokeIcon('M7 4l10 13', 'M17 4L7 17',
                       'M8 19.5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z',
                       'M21 19.5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z'),
  upload:   strokeIcon('M12 20V6', 'M5.5 12.5L12 6l6.5 6.5'),
  empty:    strokeIcon('M12 21a9 9 0 100-18 9 9 0 000 18z', 'M5.6 5.6l12.8 12.8'),
  check:    strokeIcon('M20 6.5L9.5 17 4 11.5'),
  calendar: strokeIcon('M4 6h16v14.5H4z', 'M4 10.5h16', 'M8.5 3.5v4', 'M15.5 3.5v4'),
  chevronL: strokeIcon('M14.5 5.5L8 12l6.5 6.5'),
  chevronR: strokeIcon('M9.5 5.5L16 12l-6.5 6.5'),
};

/* --- Formatting ---------------------------------------------------------- */

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return '';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** 'YYYY-MM-DD' -> '15 Jul 2026'. Parsed manually to dodge UTC-shift bugs. */
export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun',
                  'Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}

/** Local 'YYYY-MM-DD'. Avoids toISOString(), which converts to UTC first and
 *  can roll the date back a day for anyone east of Greenwich. */
export function toISODate(date) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export const currentMonth = () => toISODate(new Date()).slice(0, 7);

export function formatMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const names = ['January','February','March','April','May','June','July',
                 'August','September','October','November','December'];
  return `${names[m - 1]} ${y}`;
}

export function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/* --- Chips and inputs ---------------------------------------------------- */

export function chip(value, list) {
  if (!value) return el('span', { class: 'chip chip-empty' }, '—');
  return el('span', { class: `chip chip-${colorOf(list, value)}` }, value);
}

/* --- Dropdown ------------------------------------------------------------ */

// Only one panel is ever open; opening a second closes the first.
let closeOpenDropdown = null;

/**
 * A dropdown built out of a button and our own panel.
 *
 * A native <select> renders its option list through the operating system, and
 * that popup takes no CSS at all — on this dark theme it opens as a white
 * sheet with the OS highlight colour. Anywhere the open state is visible to
 * the user, we draw the list ourselves instead.
 *
 * `options` is [{value, label}]; the caller pins its own "all" entry at the
 * top. Selecting a value calls `onChange(value)`. Supports click-outside,
 * Escape, and ↑/↓/Enter, and reports state through aria-* so it still reads
 * as a listbox to assistive tech.
 */
/* Shared menu parts. dropdown() (anchored in flow) and openOptionMenu()
   (floating over a table cell) build the same rows from these, so a value is
   presented identically wherever it is chosen. */

/**
 * The leading slot for one option: a drawn icon, a tone swatch, or a spacer.
 * Rendered for every row as soon as *any* row asks for one, so the labels
 * stay on a single column instead of stepping in and out. The swatch is the
 * chip's own fill — that is what ties the menu to the rows behind it.
 */
function menuLead(options, o) {
  if (!options.some(x => x.icon || x.tone)) return null;
  return o.icon ? el('span', { class: 'dd-ico' }, o.icon())
       : o.tone ? el('span', { class: `dd-swatch chip-${o.tone}` })
       : el('span', { class: 'dd-ico dd-ico-none' });
}

/** Build the option rows into `panel`. Returns them in order. */
function menuRows(panel, options, value, pick) {
  return options.map(o => {
    // `sep: true` rules a hairline above the option — used to cut the "any"
    // entry away from the real choices, which are a different kind of answer.
    if (o.sep) panel.append(el('div', { class: 'dd-sep' }));
    const row = el('div', {
      class: `dd-item${o.value === value ? ' is-selected' : ''}`,
      role: 'option', tabindex: '-1',
      'aria-selected': o.value === value ? 'true' : 'false',
      onclick: () => pick(o.value),
    },
      menuLead(options, o),
      el('span', { class: 'dd-item-label' }, o.label),
      el('span', { class: 'dd-check' }, ICON.check()));
    panel.append(row);
    return row;
  });
}

/** ↑/↓ to walk the rows, Enter to take one. */
function menuKeys(rows) {
  return e => {
    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return;
    const here = rows.indexOf(document.activeElement);
    if (e.key === 'Enter') {
      if (here !== -1) { e.preventDefault(); rows[here].click(); }
      return;
    }
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    rows[here === -1 ? (step === 1 ? 0 : rows.length - 1)
                     : (here + step + rows.length) % rows.length].focus();
  };
}

/** Put focus on the current value, so ↑/↓ walks from where the user already is. */
const focusChosen = (rows, options, value) =>
  (rows[options.findIndex(o => o.value === value)] || rows[0])?.focus();

export function dropdown(options, value, onChange, { ariaLabel = '' } = {}) {
  const wrap = el('div', { class: 'dd' });
  const chosen = options.find(o => o.value === value) || options[0];

  const btn = el('button', {
    type: 'button', class: `dd-btn${value ? ' is-set' : ''}`,
    'aria-haspopup': 'listbox', 'aria-expanded': 'false',
    'aria-label': ariaLabel || null,
  },
    chosen ? menuLead(options, chosen) : null,
    el('span', { class: 'dd-value' }, chosen ? chosen.label : ''),
    el('span', { class: 'dd-caret' }));

  const panel = el('div', { class: 'dd-panel', role: 'listbox' });
  const items = menuRows(panel, options, value, v => {
    close();
    if (v !== value) onChange(v);
  });
  const arrowKeys = menuKeys(items);

  function close() {
    wrap.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    if (closeOpenDropdown === close) closeOpenDropdown = null;
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKey, true);
  }

  function onDocDown(e) { if (!wrap.contains(e.target)) close(); }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); btn.focus(); return; }
    if (e.key === 'Tab') { close(); return; }
    arrowKeys(e);
  }

  function open() {
    if (closeOpenDropdown) closeOpenDropdown();
    if (closeFloating) closeFloating();
    wrap.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
    closeOpenDropdown = close;
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
    focusChosen(items, options, value);
  }

  btn.addEventListener('click', () => {
    wrap.classList.contains('is-open') ? close() : open();
  });

  wrap.append(btn, panel);
  return wrap;
}

/* --- Floating panels ----------------------------------------------------- *
 * Menus opened from inside a table cannot be absolutely positioned against
 * their anchor: the table wrapper scrolls, and its overflow would clip them.
 * So they are fixed-position and parented to <body>, which is what this
 * shared shell handles — placement, click-outside, Escape and teardown.
 * ------------------------------------------------------------------------- */

let closeFloating = null;

function openFloating(anchor, panel, { onKey = null } = {}) {
  if (closeFloating) closeFloating();
  if (closeOpenDropdown) closeOpenDropdown();

  /** Below the anchor, flipped above when the viewport bottom is closer. */
  function place() {
    const r = anchor.getBoundingClientRect();
    const { offsetWidth: w, offsetHeight: h } = panel;
    const left = Math.min(Math.max(8, r.left), Math.max(8, innerWidth - w - 8));
    const below = r.bottom + 6;
    const flip = below + h > innerHeight - 8 && r.top - h - 6 > 8;
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(flip ? r.top - h - 6 : below)}px`;
  }

  function onDocDown(e) {
    if (!panel.contains(e.target) && !anchor.contains(e.target)) close();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); anchor.focus(); return; }
    if (e.key === 'Tab') { close(); return; }
    onKey?.(e);
  }

  function close() {
    if (closeFloating !== close) return;
    closeFloating = null;
    panel.remove();
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    removeEventListener('resize', close, true);
    removeEventListener('scroll', close, true);
    removeEventListener('hashchange', close);
  }

  document.body.append(panel);
  place();
  requestAnimationFrame(() => panel.classList.add('is-open'));

  closeFloating = close;
  document.addEventListener('mousedown', onDocDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  // Re-anchoring on scroll would fight the table's own scrolling, so the panel
  // closes instead — the same call every native picker makes.
  addEventListener('resize', close, true);
  addEventListener('scroll', close, true);
  addEventListener('hashchange', close);
  return close;
}

/** The floating twin of dropdown()'s panel, for chips inside a table. */
function openOptionMenu(anchor, options, value, onPick, { allowEmpty = true } = {}) {
  const opts = [
    ...(allowEmpty ? [{ value: '', label: 'None' }] : []),
    ...options.map((o, i) => ({
      value: o.value, label: o.value, tone: o.color,
      sep: allowEmpty && i === 0,
    })),
  ];

  const panel = el('div', { class: 'dd-panel dd-float', role: 'listbox' });
  panel.style.minWidth = `${Math.max(150, anchor.offsetWidth + 28)}px`;

  let close = () => {};
  const rows = menuRows(panel, opts, value ?? '', v => { close(); onPick(v); });
  close = openFloating(anchor, panel, { onKey: menuKeys(rows) });
  focusChosen(rows, opts, value ?? '');
  return close;
}

/**
 * An inline chip that opens its vocabulary and saves the pick immediately,
 * flashing green to confirm. `onSave` receives the new value and should
 * return a promise; a rejection rolls the chip back and toasts.
 *
 * This was a real <select> for a while, on the argument that its popup is a
 * brief native interaction rather than a designed surface. It is not: the OS
 * draws that list as a white sheet with a blue highlight, so every chip in
 * the table opened into something from another application. It now uses the
 * same menu as the filter bar (openOptionMenu), one panel for the whole app.
 */
export function selectCell(value, options, onSave, { allowEmpty = true } = {}) {
  let current = value ?? '';
  const label = el('span', { class: 'cell-select-label' });
  const btn = el('button', {
    type: 'button', class: 'cell-select',
    'aria-haspopup': 'listbox', 'aria-expanded': 'false',
  }, label, el('span', { class: 'dd-caret' }));

  // Recolour the control to match its value, so a table of these reads as
  // coloured status chips rather than a column of identical grey dropdowns.
  const paint = () => {
    btn.classList.remove(...[...btn.classList].filter(c => c.startsWith('chip-')));
    btn.classList.add(current ? `chip-${colorOf(options, current)}` : 'chip-empty');
    clear(label);
    label.append(current || '—');
  };
  paint();

  const commit = async next => {
    if (next === current) return;
    const previous = current;
    current = next;
    paint();
    try {
      await onSave(next);
      flash(btn);
    } catch (err) {
      toast(err.message, true);
      current = previous;
      paint();
    }
  };

  btn.addEventListener('click', () => {
    btn.setAttribute('aria-expanded', 'true');
    const close = openOptionMenu(btn, options, current, commit, { allowEmpty });
    // The menu owns its own teardown; this just keeps aria honest.
    btn.addEventListener('focus', () => btn.setAttribute('aria-expanded', 'false'),
                         { once: true });
    return close;
  });
  return btn;
}

/**
 * A text input that saves on blur (and on Enter), but only if the value
 * actually changed — avoids a pointless PATCH every time focus moves.
 */
export function textCell(value, onSave, { placeholder = '', type = 'text' } = {}) {
  // Dates get the calendar we drew ourselves, not the browser's chrome widget.
  if (type === 'date') return dateCell(value, onSave, { placeholder: placeholder || 'Set date' });

  const input = el('input', { class: 'cell-input', type, value: value ?? '', placeholder });
  let last = value ?? '';
  const commit = async () => {
    if (input.value === last) return;
    const next = input.value;
    try {
      await onSave(next);
      last = next;
      flash(input);
    } catch (err) {
      toast(err.message, true);
      input.value = last;
    }
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && type !== 'textarea') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = last; input.blur(); }
  });
  return input;
}

function flash(node) {
  node.classList.remove('saved');
  void node.offsetWidth;      // force reflow so the animation can restart
  node.classList.add('saved');
}

/**
 * The facts under a page title. Each part is `{n, label}` or a plain string,
 * and gets its own unit.
 *
 * This replaced a single grey mono run-on — "22 entries · 21 raw · 11 final" —
 * where the numbers are the content and the dots are the only thing telling
 * you where one fact stops. Separating them lets the count be the loud part
 * and the noun the quiet one, which is the order you actually read them in.
 */
export function metaPills(parts) {
  return el('div', { class: 'view-meta' },
    parts.filter(Boolean).map(p => typeof p === 'string'
      ? el('span', { class: 'meta-note' }, p)
      : el('span', { class: `meta-pill${p.tone ? ` chip-${p.tone}` : ''}` },
          el('b', {}, String(p.n)),
          el('span', {}, p.label))));
}

/* --- Date picker --------------------------------------------------------- *
 * Same reasoning as dropdown() vs <select>: the calendar an <input type=date>
 * opens is drawn by the browser chrome, not the page, so it takes no CSS and
 * lands as a foreign widget on this theme. This is a calendar we own.
 *
 * The panel is fixed-position and parented to <body> rather than to the cell,
 * because date cells live inside tables that scroll — an absolutely-placed
 * panel would be clipped by the wrapper's overflow.
 * ------------------------------------------------------------------------- */

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November',
                     'December'];
// Two letters, not one: a column headed S T S reads as a puzzle.
// Sunday-first to match the Calendar view (see DOW in calendar.js).
const DOW_MINI = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** 'YYYY-MM-DD' -> Date at local midnight, or null. */
function parseISO(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  return (y && m && d) ? new Date(y, m - 1, d) : null;
}

const addDays = (date, n) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);

/**
 * Open the calendar under `anchor`. `onPick` receives an ISO date, `onClear`
 * nothing. openFloating() keeps it to one open panel app-wide.
 */
export function openDatePicker(anchor, iso, { onPick, onClear = null } = {}) {

  const selected = parseISO(iso);
  const today = new Date();
  const todayISO = toISODate(today);
  let cursor = selected || today;                 // the keyboard's caret
  let view = new Date(cursor.getFullYear(), cursor.getMonth(), 1);

  const panel = el('div', {
    class: 'dp', role: 'dialog', 'aria-label': 'Choose a date',
  });
  const grid = el('div', { class: 'dp-grid', role: 'grid' });
  const title = el('div', { class: 'dp-title', 'aria-live': 'polite' });

  const step = delta => {
    view = new Date(view.getFullYear(), view.getMonth() + delta, 1);
    renderGrid();
  };

  const navBtn = (label, icon, delta) => el('button', {
    type: 'button', class: 'dp-nav', 'aria-label': label, title: label,
    onclick: () => step(delta),
  }, icon());

  function renderGrid() {
    title.textContent = `${MONTH_NAMES[view.getMonth()]} ${view.getFullYear()}`;
    clear(grid);
    for (const d of DOW_MINI) grid.append(el('div', { class: 'dp-dow' }, d));

    // Always 42 cells (6 weeks). A grid that grows to 5 rows in some months
    // makes the panel jump height as you page through it.
    const start = addDays(view, -view.getDay());
    for (let i = 0; i < 42; i++) {
      const day = addDays(start, i);
      const dayISO = toISODate(day);
      const outside = day.getMonth() !== view.getMonth();
      const isSel = !!selected && dayISO === iso;
      const cell = el('button', {
        type: 'button', role: 'gridcell',
        class: `dp-day${outside ? ' is-outside' : ''}`
             + `${isSel ? ' is-selected' : ''}`
             + `${dayISO === todayISO ? ' is-today' : ''}`,
        tabindex: dayISO === toISODate(cursor) ? '0' : '-1',
        'aria-selected': isSel ? 'true' : 'false',
        'aria-label': formatDate(dayISO),
        onclick: () => { close(); onPick?.(dayISO); },
      }, String(day.getDate()));
      grid.append(cell);
    }
  }

  function focusCursor() {
    const cell = grid.querySelector('[tabindex="0"]');
    cell?.focus({ preventScroll: true });
  }

  function moveCursor(days) {
    cursor = addDays(cursor, days);
    if (cursor.getMonth() !== view.getMonth() ||
        cursor.getFullYear() !== view.getFullYear()) {
      view = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    }
    renderGrid();
    focusCursor();
  }

  // Escape and Tab are handled by openFloating; this is only the grid's own
  // caret movement.
  function onKey(e) {
    const moves = {
      ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7,
      Home: -cursor.getDay(), End: 6 - cursor.getDay(),
    };
    if (e.key in moves) { e.preventDefault(); moveCursor(moves[e.key]); return; }
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      const delta = e.key === 'PageUp' ? -1 : 1;
      const target = new Date(cursor.getFullYear(), cursor.getMonth() + delta,
                              cursor.getDate());
      moveCursor(Math.round((target - cursor) / 86400000));
    }
  }

  let close = () => {};

  panel.append(
    el('div', { class: 'dp-head' },
      navBtn('Previous month', ICON.chevronL, -1),
      title,
      navBtn('Next month', ICON.chevronR, 1)),
    grid,
    el('div', { class: 'dp-foot' },
      onClear ? el('button', {
        type: 'button', class: 'dp-action',
        onclick: () => { close(); onClear(); },
      }, 'Clear') : el('span'),
      el('button', {
        type: 'button', class: 'dp-action dp-today',
        onclick: () => { close(); onPick?.(todayISO); },
      }, 'Today')));

  renderGrid();
  close = openFloating(anchor, panel, { onKey });
  focusCursor();
  return close;
}

/**
 * An inline date field: a button showing the date in the app's own format,
 * backed by the calendar above. Saves immediately on pick, and rolls back
 * with a toast if the PATCH fails, exactly like textCell.
 */
export function dateCell(value, onSave, { placeholder = 'Set date', ariaLabel = '' } = {}) {
  let current = value ?? '';
  const label = el('span', { class: 'cell-date-text' });
  const btn = el('button', {
    type: 'button', class: 'cell-date', 'aria-label': ariaLabel || null,
  }, el('span', { class: 'cell-date-ico' }, ICON.calendar()), label);

  const paint = () => {
    btn.classList.toggle('is-empty', !current);
    clear(label);
    label.append(current ? formatDate(current) : placeholder);
  };
  paint();

  const commit = async next => {
    if (next === current) return;
    const previous = current;
    current = next;
    paint();
    try {
      await onSave(next);
      flash(btn);
    } catch (err) {
      toast(err.message, true);
      current = previous;
      paint();
    }
  };

  btn.addEventListener('click', () => openDatePicker(btn, current, {
    onPick: commit,
    onClear: current ? () => commit('') : null,
  }));
  return btn;
}

/* --- Toasts and dialogs -------------------------------------------------- */

export function toast(message, isError = false, ms = 3600) {
  const box = document.getElementById('toasts');
  const node = el('div', { class: `toast${isError ? ' toast-error' : ''}` }, message);
  box.append(node);
  setTimeout(() => node.remove(), ms);
}

/** Promise-based confirm dialog. Resolves true if the user confirms. */
export function confirmDialog(title, body, okLabel = 'Delete') {
  const dlg = document.getElementById('confirm-dialog');
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-body').textContent = body;
  const ok = document.getElementById('confirm-ok');
  const cancel = document.getElementById('confirm-cancel');
  ok.textContent = okLabel;

  return new Promise(resolve => {
    const done = value => {
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      dlg.removeEventListener('close', onClose);
      dlg.close();
      resolve(value);
    };
    const onOk = () => done(true);
    const onCancel = () => done(false);
    const onClose = () => resolve(false);   // Esc key
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    dlg.addEventListener('close', onClose);
    dlg.showModal();
  });
}

export const loading = (msg = 'Loading…') => el('div', { class: 'loading' }, msg);

export function emptyState(icon, title, sub) {
  return el('div', { class: 'empty' },
    el('span', { class: 'empty-icon' }, icon),
    el('div', {}, title),
    sub ? el('div', { style: 'font-size:12px;margin-top:5px' }, sub) : null,
  );
}
