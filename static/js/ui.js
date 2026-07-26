/**
 * Shared UI helpers: DOM building, formatting, chips, toasts, dialogs.
 *
 * The select-field vocabularies and their colours are defined here and must
 * stay in step with the enums in models.py. Adding a Status means adding it to
 * STATUSES below plus a .chip-<colour> rule in style.css.
 */

export const STATUSES = [
  { value: 'Idea',      color: 'grey'   },
  { value: 'Scripting', color: 'yellow' },
  { value: 'Editing',   color: 'orange' },
  { value: 'Ready',     color: 'blue'   },
  { value: 'Posted',    color: 'green'  },
  { value: 'Failed',    color: 'red'    },
];

export const PERFORMANCES = [
  { value: 'Viral',   color: 'green'  },
  { value: 'Average', color: 'orange' },
  { value: 'Failed',  color: 'red'    },
];

export const TYPES = [
  { value: 'Scripted',   color: 'blue'   },
  { value: 'Clips',      color: 'orange' },
];

const colorOf = (list, value) =>
  list.find(o => o.value === value)?.color ?? 'grey';

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

/**
 * A <select> that saves on change and flashes green to confirm.
 * `onSave` receives the new value and should return a promise.
 */
export function selectCell(value, options, onSave, { allowEmpty = true } = {}) {
  const sel = el('select', { class: 'cell-select' });
  if (allowEmpty) sel.append(el('option', { value: '' }, '—'));
  for (const o of options) {
    sel.append(el('option', { value: o.value, selected: o.value === value }, o.value));
  }
  sel.value = value ?? '';

  // Recolour the control to match its value, so a table of selects reads as
  // coloured status chips rather than a column of identical grey dropdowns.
  const paint = () => {
    sel.classList.remove(...[...sel.classList].filter(c => c.startsWith('chip-')));
    sel.classList.add(sel.value ? `chip-${colorOf(options, sel.value)}` : 'chip-empty');
  };
  paint();

  let last = value ?? '';
  sel.addEventListener('change', async () => {
    try {
      await onSave(sel.value);
      last = sel.value;
      paint();
      flash(sel);
    } catch (err) {
      toast(err.message, true);
      sel.value = last;
      paint();
    }
  });
  return sel;
}

/**
 * A text input that saves on blur (and on Enter), but only if the value
 * actually changed — avoids a pointless PATCH every time focus moves.
 */
export function textCell(value, onSave, { placeholder = '', type = 'text' } = {}) {
  const input = el('input', {
    class: type === 'date' ? 'cell-date' : 'cell-input',
    type, value: value ?? '', placeholder,
  });
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
