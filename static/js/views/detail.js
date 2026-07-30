/**
 * Detail page — all fields, the script, and the video players.
 *
 * Uploads go through api.uploadMedia (raw-body XHR) so progress can be shown
 * and the server can stream to disk. Videos play from /api/media/{id}/stream,
 * which serves HTTP range requests, so scrubbing a 500MB file seeks instantly
 * instead of downloading the whole thing first.
 */

import { api } from '../api.js';
import {
  el, clear, textCell, selectCell, toast, confirmDialog, loading,
  formatBytes, formatDuration, formatDate,
  STATUSES, PERFORMANCES, TYPES,
} from '../ui.js';

/**
 * Delete the entry if it is still exactly as "+ New" created it — no topic,
 * text, dates, categorisation or media. Called by the router when the user
 * navigates away from a detail page, so backing out of a page they never
 * filled in does not leave an empty "Untitled" row in the library.
 */
export async function discardIfEmpty(id) {
  let item;
  try { item = await api.getContent(id); } catch { return; }

  const blank = s => !s || !s.trim();
  const pristine =
    (blank(item.topic) || item.topic === 'Untitled') &&
    blank(item.assigned_to) && blank(item.notes) && blank(item.script) &&
    !item.upload_date && !item.deadline &&
    !item.performance && !item.type &&
    item.status === 'Idea' && !item.done &&
    item.raw.length === 0 && item.final.length === 0;
  if (!pristine) return;

  try {
    await api.deleteContent(id);
    toast('Empty entry discarded');
  } catch { /* already gone — nothing to clean up */ }
}

/**
 * The entries either side of `id`, in the order the library is currently
 * showing them — same search, sort and filters. Stepping through detail pages
 * therefore walks exactly the list the user was just looking at: filter to
 * "Has raw" and ‹ › visits only entries with raw footage.
 *
 * If the open entry is not in that filtered list (it was opened from the
 * calendar, or edited until it no longer matches), fall back to the unfiltered
 * library so the arrows still work instead of going dead.
 */
async function siblings(id) {
  const { state } = await import('../app.js');
  const f = state.filters;
  const query = {
    search: state.search, sort: state.sort, direction: state.direction,
    status: f.status, type: f.type, performance: f.performance,
    month: f.month, media: f.media || undefined,
  };
  let list = await api.listContent(query);
  let idx = list.findIndex(i => i.id === id);
  if (idx === -1) {
    list = await api.listContent({ sort: state.sort, direction: state.direction });
    idx = list.findIndex(i => i.id === id);
  }
  return {
    idx,
    total: list.length,
    prev: idx > 0 ? list[idx - 1] : null,
    next: idx !== -1 && idx < list.length - 1 ? list[idx + 1] : null,
  };
}

/** ‹ / › stepper plus an "n of m" position readout. */
function stepper({ idx, total, prev, next }) {
  const go = entry => () => { location.hash = `#/content/${entry.id}`; };
  const arrow = (entry, label, title) => el('button', {
    class: 'btn btn-sm',
    disabled: !entry,
    title: entry ? `${title}: ${entry.topic}` : `No ${title.toLowerCase()}`,
    onclick: entry ? go(entry) : null,
  }, label);

  return el('div', { class: 'detail-nav' },
    arrow(prev, '‹', 'Previous'),
    el('span', { class: 'detail-pos' },
       idx === -1 ? '—' : `${idx + 1} of ${total}`),
    arrow(next, '›', 'Next'));
}

export async function renderDetail(root, id) {
  const spinner = loading();
  root.append(spinner);
  // One round trip for both: the entry and its position in the library.
  const [itemLoaded, sibs] = await Promise.all([api.getContent(id), siblings(id)]);
  let item = itemLoaded;
  spinner.remove();

  const save = patch => api.updateContent(id, patch);
  const page = el('div', { class: 'detail' });
  root.append(page);

  // ← / → step too, but only when the caret is not in a field — otherwise
  // arrowing through the script text would fling you onto another entry.
  // Bound on document (a <div> takes no key events) and torn down as soon as
  // the route leaves this entry, so listeners never pile up.
  const onKey = e => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    const to = e.key === 'ArrowLeft' ? sibs.prev
             : e.key === 'ArrowRight' ? sibs.next : null;
    if (to) { e.preventDefault(); location.hash = `#/content/${to.id}`; }
  };
  const unbind = () => {
    if (location.hash === `#/content/${id}`) return;   // still here — keep it
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', unbind);
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', unbind);

  /* --- header --------------------------------------------------------- */
  page.append(el('div', { class: 'detail-top' },
    el('a', { class: 'btn btn-ghost btn-sm', href: '#/library' }, '← Library'),
    stepper(sibs),
    el('span', { class: 'spacer' }),
    el('span', { class: 'media-meta' }, `Updated ${item.updated_at.slice(0, 16).replace('T', ' ')}`),
    el('button', {
      class: 'btn btn-sm',
      onclick: async () => {
        const n = item.raw.length + item.final.length;
        const ok = await confirmDialog(
          'Delete this entry?',
          `“${item.topic}” will be deleted permanently` +
          (n ? `, along with ${n} video file${n === 1 ? '' : 's'} on disk.` : '.'),
        );
        if (!ok) return;
        try {
          await api.deleteContent(id);
          toast('Entry deleted');
          location.hash = '#/library';
        } catch (err) { toast(err.message, true); }
      },
    }, '🗑 Delete'),
  ));

  // Title doubles as the Topic field.
  const title = el('input', {
    class: 'detail-title', value: item.topic, placeholder: 'Untitled',
  });
  let lastTitle = item.topic;
  const commitTitle = async () => {
    if (title.value === lastTitle) return;
    try {
      await save({ topic: title.value });
      lastTitle = title.value;
      toast('Saved');
    } catch (err) { toast(err.message, true); title.value = lastTitle; }
  };
  title.addEventListener('blur', commitTitle);
  title.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); title.blur(); }
  });
  page.append(title);

  /* --- two-column body ------------------------------------------------ */
  // Writing on the left, metadata pinned in a sidebar on the right. A single
  // narrow column wasted most of the screen width.
  const main = el('div', { class: 'detail-main' });
  const side = el('div', { class: 'detail-side' });
  page.append(el('div', { class: 'detail-body' }, main, side));

  /* --- sidebar: the properties ---------------------------------------- */
  const field = (label, control) =>
    el('div', { class: 'field-row' },
      el('div', { class: 'field-label' }, label),
      el('div', {}, control));

  side.append(el('div', { class: 'side-panel' },
    el('div', { class: 'field-grid' },
      field('Status',      selectCell(item.status, STATUSES,
                                      v => save({ status: v }), { allowEmpty: false })),
      field('Type',        selectCell(item.type, TYPES, v => save({ type: v }))),
      field('Performance', selectCell(item.performance, PERFORMANCES,
                                      v => save({ performance: v }))),
      field('Assigned to', textCell(item.assigned_to, v => save({ assigned_to: v }),
                                    { placeholder: 'Editor name' })),
      field('Upload date', textCell(item.upload_date, v => save({ upload_date: v }),
                                    { type: 'date' })),
      field('Deadline',    textCell(item.deadline, v => save({ deadline: v }),
                                    { type: 'date' })),
      field('Notes',       autoSaveArea(item.notes, 'notes-area',
                                        'Anything worth remembering…',
                                        v => save({ notes: v }))),
    )));

  /* --- main: script then media ---------------------------------------- */
  main.append(el('div', { class: 'section-title' }, 'Script'));
  main.append(autoSaveArea(item.script, 'script-area',
                           'Write the full script here…', v => save({ script: v })));

  const finalSection = mediaSection('Final produced', 'final');
  const rawSection   = mediaSection('Raw footage', 'raw');
  main.append(finalSection.node, rawSection.node);

  /**
   * A textarea that saves on blur, plus Ctrl/Cmd+S while typing.
   * Deliberately not saving on every keystroke — a long script would otherwise
   * fire a request per character.
   */
  function autoSaveArea(value, cls, placeholder, onSave) {
    const area = el('textarea', { class: cls, placeholder });
    area.value = value || '';
    let last = area.value;
    const commit = async () => {
      if (area.value === last) return;
      const next = area.value;
      try { await onSave(next); last = next; toast('Saved'); }
      catch (err) { toast(err.message, true); }
    };
    area.addEventListener('blur', commit);
    area.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); commit(); }
    });
    return area;
  }

  /** One media bucket: player list, upload button, drop zone. */
  function mediaSection(label, kind) {
    const list = el('div', { class: 'media-list' });
    const uploads = el('div', {});

    const fileInput = el('input', {
      type: 'file', accept: 'video/*', multiple: 'true', style: 'display:none',
    });
    fileInput.addEventListener('change', () => {
      startUploads([...fileInput.files]);
      fileInput.value = '';        // allow re-picking the same file
    });

    const dropzone = el('div', { class: 'dropzone' },
      `Drop video files here, or click to choose`);
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', e => {
      e.preventDefault(); dropzone.classList.add('over');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('over');
      startUploads([...e.dataTransfer.files]);
    });

    const node = el('div', { class: 'media-section' },
      el('div', { class: 'media-head' },
        el('div', { class: 'section-title', style: 'margin:0' }, label),
        el('span', { class: 'spacer' }),
        // Jump to the library pre-filtered to this bucket — the way to go from
        // "this one video" to "everything I have footage for" in one click.
        el('button', {
          class: 'btn btn-sm',
          title: `Show every library entry that has ${kind} video`,
          onclick: async () => {
            const app = await import('../app.js');
            app.state.filters.media = kind;
            location.hash = '#/library';
          },
        }, kind === 'raw' ? '🎬 All raw' : '🎬 All final'),
        el('button', { class: 'btn btn-sm', onclick: () => fileInput.click() },
           '⬆ Upload'),
      ),
      fileInput, list, uploads, dropzone,
    );

    renderList();

    function renderList() {
      clear(list);
      const files = item[kind];
      if (!files.length) return;
      for (const f of files) list.append(mediaItem(f));
    }

    function mediaItem(f) {
      const video = el('video', {
        controls: 'true', preload: 'metadata', src: f.stream_url,
      });
      return el('div', { class: 'media-item' },
        video,
        el('div', { class: 'media-bar' },
          el('span', { class: 'media-name' }, f.original_name),
          el('span', { class: 'media-meta' },
            [formatBytes(f.size_bytes), formatDuration(f.duration_seconds)]
              .filter(Boolean).join(' · ')),
          el('span', { class: 'spacer' }),
          el('a', { class: 'btn btn-ghost btn-sm', href: `/api/media/${f.id}/download` },
             '⬇'),
          el('button', {
            class: 'btn btn-ghost btn-sm', title: 'Delete video',
            onclick: async () => {
              const ok = await confirmDialog(
                'Delete this video?',
                `“${f.original_name}” (${formatBytes(f.size_bytes)}) will be removed ` +
                `from the media folder permanently.`,
              );
              if (!ok) return;
              try {
                // Stop playback first so the browser releases the file handle.
                video.pause(); video.removeAttribute('src'); video.load();
                await api.deleteMedia(f.id);
                item = await api.getContent(id);
                renderList();
                toast('Video deleted');
              } catch (err) { toast(err.message, true); }
            },
          }, '🗑'),
        ),
      );
    }

    /** Upload files one at a time, each with its own progress bar. */
    function startUploads(files) {
      for (const file of files) {
        const bar = el('div', { class: 'progress-bar' });
        const pct = el('span', { class: 'upload-pct' }, '0%');
        const cancelBtn = el('button', { class: 'btn btn-ghost btn-sm' }, 'Cancel');
        const row = el('div', { class: 'upload-row' },
          el('div', { class: 'upload-name' },
            el('span', {}, file.name),
            el('span', { class: 'media-meta' }, formatBytes(file.size)),
            pct, cancelBtn),
          el('div', { class: 'progress' }, bar),
        );
        uploads.append(row);

        const { promise, abort } = api.uploadMedia(id, kind, file,
          (loaded, total, ratio) => {
            bar.style.width = `${(ratio * 100).toFixed(1)}%`;
            pct.textContent = `${Math.round(ratio * 100)}% · ` +
                              `${formatBytes(loaded)} / ${formatBytes(total)}`;
          });

        cancelBtn.addEventListener('click', abort);

        promise.then(async () => {
          bar.style.width = '100%';
          bar.classList.add('done');
          pct.textContent = 'Done';
          cancelBtn.remove();
          setTimeout(() => row.remove(), 1600);
          // Refetch so the new file appears with its server-side metadata.
          item = await api.getContent(id);
          renderList();
          toast(`Uploaded ${file.name}`);
        }).catch(err => {
          bar.style.width = '100%';
          bar.classList.add('error');
          pct.textContent = 'Failed';
          cancelBtn.remove();
          toast(`${file.name}: ${err.message}`, true, 6000);
          setTimeout(() => row.remove(), 5000);
        });
      }
    }

    return { node, renderList };
  }
}
