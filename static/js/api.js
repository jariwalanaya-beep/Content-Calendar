/**
 * Thin wrapper around the REST API.
 *
 * Everything network-related lives here so the view modules never touch fetch()
 * directly and error handling stays in one place.
 */

/** Throw a useful Error from a failed response, using FastAPI's `detail`. */
async function raise(res) {
  let detail = `${res.status} ${res.statusText}`;
  try {
    const body = await res.json();
    if (body.detail) {
      // Pydantic validation errors arrive as an array of objects.
      detail = Array.isArray(body.detail)
        ? body.detail.map(e => `${e.loc?.slice(1).join('.') || ''} ${e.msg}`).join('; ')
        : body.detail;
    }
  } catch { /* response body was not JSON; keep the status text */ }
  throw new Error(detail);
}

async function req(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) await raise(res);
  return res.status === 204 ? null : res.json();
}

const qs = params => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  /* --- meta --- */
  config: () => req('/api/config'),

  /* --- weekly plan --- */
  // `week` is any ISO date inside the wanted week; omitted = current week.
  getWeek: week => req(`/api/weekly${qs({ week })}`),
  updateDay: (dayIndex, patch, week) => req(`/api/weekly/${dayIndex}${qs({ week })}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }),

  /* --- content library --- */
  listContent: (filters = {}) => req(`/api/content${qs(filters)}`),
  listMonths: () => req('/api/content/months'),
  getContent: id => req(`/api/content/${id}`),
  createContent: data => req('/api/content', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }),
  updateContent: (id, patch) => req(`/api/content/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }),
  deleteContent: id => req(`/api/content/${id}`, { method: 'DELETE' }),

  /* --- media --- */
  deleteMedia: id => req(`/api/media/${id}`, { method: 'DELETE' }),

  /**
   * Upload one video file, reporting progress as it goes.
   *
   * Uses XMLHttpRequest rather than fetch() for one specific reason: fetch has
   * no upload-progress event, so a 500MB upload would sit at "0%" with no
   * feedback until it finished. XHR exposes upload.onprogress.
   *
   * The file is sent as the RAW request body (not multipart/form-data), which
   * is what lets the server stream it straight to disk in constant memory. The
   * filename travels in a header instead, percent-encoded because HTTP headers
   * cannot carry arbitrary non-ASCII text.
   *
   * @returns {{promise: Promise<object>, abort: () => void}}
   */
  uploadMedia(contentId, kind, file, onProgress) {
    const xhr = new XMLHttpRequest();
    const promise = new Promise((resolve, reject) => {
      xhr.open('PUT', `/api/content/${contentId}/media/${kind}`, true);
      xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');

      xhr.upload.onprogress = e => {
        if (e.lengthComputable && onProgress) {
          onProgress(e.loaded, e.total, e.loaded / e.total);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch { reject(new Error('Server returned an unreadable response')); }
        } else {
          let msg = `Upload failed (${xhr.status})`;
          try {
            const d = JSON.parse(xhr.responseText).detail;
            if (d) msg = typeof d === 'string' ? d : JSON.stringify(d);
          } catch { /* keep the generic message */ }
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.onabort  = () => reject(new Error('Upload cancelled'));

      // Passing the File object directly streams it from disk; the browser
      // never has to hold the whole thing in memory.
      xhr.send(file);
    });
    return { promise, abort: () => xhr.abort() };
  },
};
