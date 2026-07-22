/**
 * Quick-look popup for a content entry.
 *
 * Opened from the calendar so you can inspect an entry — every field, the
 * script, and playable raw/final videos — without navigating away and losing
 * your place in the month.
 *
 * The videos stream from the same range-request endpoint the detail page uses,
 * so seeking works here too.
 */

import { api } from '../api.js';
import {
  el, clear, chip, toast, formatBytes, formatDuration, formatDate,
  STATUSES, PERFORMANCES, TYPES,
} from '../ui.js';

/**
 * Show the popup for one entry.
 * @param {number} id  content entry id
 */
export async function openPreview(id) {
  // Build the dialog fresh each time; it is removed again on close, so no stale
  // <video> elements are left holding file handles open.
  const dlg = el('dialog', { class: 'preview' });
  const body = el('div', { class: 'preview-body' },
    el('div', { class: 'loading' }, 'Loading…'));

  const close = () => {
    // Stop playback before tearing down, so the browser releases the files.
    dlg.querySelectorAll('video').forEach(v => { v.pause(); v.removeAttribute('src'); v.load(); });
    dlg.close();
    dlg.remove();
  };

  dlg.append(body);
  document.body.append(dlg);
  dlg.showModal();
  // Clicking the backdrop (outside the panel) closes it.
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
  dlg.addEventListener('close', () => dlg.remove());

  let item;
  try {
    item = await api.getContent(id);
  } catch (err) {
    clear(body);
    body.append(el('div', { class: 'empty' }, err.message));
    return;
  }

  clear(body);

  /* --- header --- */
  body.append(el('div', { class: 'preview-head' },
    el('div', { class: 'preview-title' }, item.topic),
    el('button', { class: 'btn btn-ghost btn-sm', onclick: close, title: 'Close' }, '✕'),
  ));

  if (item.title?.trim()) {
    body.append(el('div', { class: 'preview-published' }, item.title));
  }

  /* --- property chips --- */
  const meta = el('div', { class: 'preview-meta' },
    chip(item.status, STATUSES),
    item.type ? chip(item.type, TYPES) : null,
    item.performance ? chip(item.performance, PERFORMANCES) : null,
    item.upload_date
      ? el('span', { class: 'preview-metaitem' }, `📅 ${formatDate(item.upload_date)}`)
      : null,
    item.assigned_to
      ? el('span', { class: 'preview-metaitem' }, `👤 ${item.assigned_to}`)
      : null,
  );
  body.append(meta);

  /* --- videos, final first since that is usually what you want to see --- */
  const mediaBlock = (label, files) => {
    if (!files.length) return null;
    const list = el('div', { class: 'preview-media' });
    for (const f of files) {
      list.append(el('div', { class: 'media-item' },
        el('video', { controls: 'true', preload: 'metadata', src: f.stream_url }),
        el('div', { class: 'media-bar' },
          el('span', { class: 'media-name' }, f.original_name),
          el('span', { class: 'media-meta' },
            [formatBytes(f.size_bytes), formatDuration(f.duration_seconds)]
              .filter(Boolean).join(' · ')),
          el('span', { class: 'spacer' }),
          el('a', { class: 'btn btn-ghost btn-sm', href: `/api/media/${f.id}/download` }, '⬇'),
        )));
    }
    return el('div', { class: 'preview-section' },
      el('div', { class: 'section-title' }, `${label} (${files.length})`), list);
  };

  // Guarded because mediaBlock returns null for an empty bucket, and
  // Node.append(null) would insert the literal string "null".
  const finalBlock = mediaBlock('Final produced', item.final);
  const rawBlock   = mediaBlock('Raw footage', item.raw);
  if (finalBlock) body.append(finalBlock);
  if (rawBlock)   body.append(rawBlock);

  if (!item.final.length && !item.raw.length) {
    body.append(el('div', { class: 'preview-novideo' }, 'No videos uploaded yet'));
  }

  /* --- notes and script, read-only here; edit on the full page --- */
  if (item.notes?.trim()) {
    body.append(el('div', { class: 'preview-section' },
      el('div', { class: 'section-title' }, 'Notes'),
      el('div', { class: 'preview-text' }, item.notes)));
  }

  if (item.script?.trim()) {
    body.append(el('div', { class: 'preview-section' },
      el('div', { class: 'section-title' }, 'Script'),
      el('div', { class: 'preview-text preview-script' }, item.script)));
  }

  /* --- footer --- */
  body.append(el('div', { class: 'preview-foot' },
    el('button', { class: 'btn btn-sm', onclick: close }, 'Close'),
    el('button', {
      class: 'btn btn-primary btn-sm',
      onclick: () => { close(); location.hash = `#/content/${id}`; },
    }, 'Open full page →'),
  ));
}
