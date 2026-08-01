"""
Video upload, playback and deletion.

Two things here are deliberately not the "obvious" FastAPI approach, both for
the same reason — 200MB to 1GB video files:

1. Upload takes the RAW request body, not a multipart `UploadFile`.
   `UploadFile` is backed by a SpooledTemporaryFile that rolls over into the
   system temp directory. On this machine /tmp is tmpfs (RAM-backed), so a 1GB
   upload would consume 1GB of RAM and then be copied a second time onto the
   storage drive. Consuming `request.stream()` writes straight to the final
   location in 1MiB chunks, so memory stays flat no matter how big the file is.

2. Playback returns Starlette's `FileResponse`, which implements HTTP range
   requests natively (206 + Content-Range + Accept-Ranges, 416 on a bad range).
   That is what lets the browser seek in a 500MB video without downloading it
   first, and it uses sendfile() under the hood rather than pumping bytes
   through Python.
"""

from pathlib import Path
from urllib.parse import unquote
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse

import storage
from config import settings
from database import db_dependency, utc_now_iso
from models import MediaFile

router = APIRouter(tags=["media"])


def _safe_filename_stem(topic: str) -> str:
    """
    Turn a topic into something every filesystem will accept.

    Strips the characters Windows forbids (\\ / : * ? " < > |) plus control
    characters, collapses whitespace, and trims trailing dots/spaces which
    Windows silently drops. Returns "" when nothing usable is left, and the
    caller then falls back to the uploaded filename.
    """
    cleaned = "".join(
        " " if ch in '\\/:*?"<>|' or ord(ch) < 32 else ch
        for ch in (topic or "")
    )
    cleaned = " ".join(cleaned.split()).strip(" .")
    # Keep well clear of the 255-byte limit once a suffix is appended.
    return cleaned[:120].strip()


def _saved_filename(conn: sqlite3.Connection, row: sqlite3.Row, path: Path) -> str:
    """
    What this video should be called once it lands in someone's Downloads.

    Named after the entry's **topic**, not the filename the camera or editor
    produced: "Tomino's Hell.mp4" is what belongs in an uploads folder, not
    "IMG_4471.mp4" or "stream.mp4". The final cut takes the bare topic — it is
    the video that goes to the channel — while raw is always tagged, otherwise
    an entry's raw and final would save under one name and clobber each other.
    Falls back to the uploaded name if the topic has no usable characters.
    """
    content = conn.execute(
        "SELECT topic FROM content WHERE id = ?", (row["content_id"],)
    ).fetchone()
    stem = _safe_filename_stem(content["topic"] if content else "")
    if not stem:
        return row["original_name"]

    # Where this file sits among its siblings of the same kind, so a second
    # raw clip becomes "Topic (raw 2).mp4" rather than colliding.
    position = conn.execute(
        "SELECT COUNT(*) FROM media_file "
        "WHERE content_id = ? AND kind = ? AND (uploaded_at, id) <= (?, ?)",
        (row["content_id"], row["kind"], row["uploaded_at"], row["id"]),
    ).fetchone()[0]
    siblings = conn.execute(
        "SELECT COUNT(*) FROM media_file WHERE content_id = ? AND kind = ?",
        (row["content_id"], row["kind"]),
    ).fetchone()[0]

    if row["kind"] == "raw":
        stem = f"{stem} (raw {position})" if siblings > 1 else f"{stem} (raw)"
    elif siblings > 1:
        stem = f"{stem} ({position})"

    suffix = Path(row["original_name"]).suffix or path.suffix
    return f"{stem}{suffix}"


def media_row_to_model(row: sqlite3.Row) -> MediaFile:
    """Convert a media_file DB row into the API shape, adding the stream URL."""
    return MediaFile(
        id=row["id"],
        content_id=row["content_id"],
        kind=row["kind"],
        original_name=row["original_name"],
        size_bytes=row["size_bytes"],
        mime_type=row["mime_type"],
        duration_seconds=row["duration_seconds"],
        uploaded_at=row["uploaded_at"],
        stream_url=f"/api/media/{row['id']}/stream",
    )


def _require_content(conn: sqlite3.Connection, content_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT id FROM content WHERE id = ?", (content_id,)).fetchone()
    if row is None:
        raise HTTPException(404, f"Content entry {content_id} not found")
    return row


# --------------------------------------------------------------------------- #
# Upload
# --------------------------------------------------------------------------- #

@router.put("/content/{content_id}/media/{kind}", response_model=MediaFile, status_code=201)
async def upload_media(
    content_id: int,
    kind: str,
    request: Request,
    conn: sqlite3.Connection = Depends(db_dependency),
) -> MediaFile:
    """
    Stream one video file into MEDIA_ROOT/{content_id}/{kind}/.

    The client sends the file as the raw request body and passes its name in the
    `X-Filename` header (percent-encoded, so non-ASCII names survive the trip
    through HTTP headers, which are latin-1 only).

    Bytes land in a temporary `.part` file first and are renamed into place only
    after the transfer completes. An interrupted upload therefore leaves no
    half-written video that looks playable — worth the extra rename, because a
    truncated 500MB file is otherwise indistinguishable from a good one.
    """
    if kind not in ("raw", "final"):
        raise HTTPException(400, "kind must be 'raw' or 'final'")
    _require_content(conn, content_id)

    # --- Work out the destination filename -----------------------------------
    raw_header = request.headers.get("x-filename", "")
    filename = storage.sanitize_filename(unquote(raw_header))

    suffix = Path(filename).suffix.lower()
    if suffix not in settings.ALLOWED_VIDEO_EXTENSIONS:
        allowed = ", ".join(sorted(settings.ALLOWED_VIDEO_EXTENSIONS))
        raise HTTPException(400, f"Unsupported file type '{suffix}'. Allowed: {allowed}")

    # --- Reject oversized uploads before reading the body --------------------
    # Content-Length is a hint the client controls, so the real byte count is
    # enforced again during streaming below.
    declared = request.headers.get("content-length")
    if settings.MAX_UPLOAD_BYTES and declared and declared.isdigit():
        if int(declared) > settings.MAX_UPLOAD_BYTES:
            raise HTTPException(
                413,
                f"File exceeds the {settings.MAX_UPLOAD_BYTES / 1024**3:.1f} GB limit",
            )

    dest = storage.unique_destination(storage.content_dir(content_id, kind), filename)
    part = dest.with_name(dest.name + ".part")

    # --- Stream the body to disk ---------------------------------------------
    written = 0
    try:
        # Plain buffered file I/O in a thread would be marginally safer for the
        # event loop, but writes to a local disk are fast enough that the extra
        # machinery is not worth it for a single-user app.
        with part.open("wb", buffering=0) as fh:
            async for chunk in request.stream():
                if not chunk:
                    continue
                written += len(chunk)
                # Enforce the real limit, not the client's claim.
                if settings.MAX_UPLOAD_BYTES and written > settings.MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        413,
                        f"File exceeds the {settings.MAX_UPLOAD_BYTES / 1024**3:.1f} GB limit",
                    )
                fh.write(chunk)
    except HTTPException:
        part.unlink(missing_ok=True)
        raise
    except Exception:
        # Covers client disconnects mid-upload: bin the partial file.
        part.unlink(missing_ok=True)
        raise

    if written == 0:
        part.unlink(missing_ok=True)
        raise HTTPException(400, "Empty upload — no data received")

    # --- Commit: atomic rename, then record it -------------------------------
    part.rename(dest)

    duration = await storage.probe_duration(dest)
    rel_path = storage.relative_to_media_root(dest)

    cur = conn.execute(
        """INSERT INTO media_file
             (content_id, kind, rel_path, original_name, size_bytes,
              mime_type, duration_seconds, uploaded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            content_id, kind, rel_path, dest.name, written,
            storage.guess_mime_type(dest.name), duration, utc_now_iso(),
        ),
    )
    # Touch the parent entry so "last modified" reflects the upload.
    conn.execute("UPDATE content SET updated_at = ? WHERE id = ?",
                 (utc_now_iso(), content_id))

    row = conn.execute("SELECT * FROM media_file WHERE id = ?",
                       (cur.lastrowid,)).fetchone()
    return media_row_to_model(row)


# --------------------------------------------------------------------------- #
# Playback
# --------------------------------------------------------------------------- #

@router.get("/media/{media_id}/stream")
def stream_media(
    media_id: int,
    conn: sqlite3.Connection = Depends(db_dependency),
) -> Response:
    """
    Serve a video with range-request support so the browser can seek.

    `FileResponse` inspects the incoming `Range` header itself and replies with
    206 Partial Content and the right `Content-Range`, or 416 if the range is
    unsatisfiable. Seeking to the middle of a 500MB file therefore reads only
    the requested slice instead of streaming from byte zero.
    """
    row = conn.execute("SELECT * FROM media_file WHERE id = ?", (media_id,)).fetchone()
    if row is None:
        raise HTTPException(404, f"Media file {media_id} not found")

    try:
        path = storage.resolve_media_path(row["rel_path"])
    except ValueError:
        raise HTTPException(500, "Stored media path is invalid")

    if not path.is_file():
        raise HTTPException(
            404,
            f"File missing from disk: {row['rel_path']}. "
            "It may have been moved or deleted outside the app.",
        )

    return FileResponse(
        path,
        media_type=row["mime_type"] or "application/octet-stream",
        # `inline` so the browser plays it rather than offering a download —
        # but still named, because "Save video as…" from the player's own menu
        # hits this URL, and without a filename the browser falls back to the
        # last path segment and writes "stream.mp4".
        content_disposition_type="inline",
        filename=_saved_filename(conn, row, path),
        # Explicit even though FileResponse sets it on ranged replies — some
        # players check for it before attempting to seek at all.
        headers={"Accept-Ranges": "bytes"},
    )


@router.get("/media/{media_id}/download")
def download_media(
    media_id: int,
    conn: sqlite3.Connection = Depends(db_dependency),
) -> Response:
    """Same file, but as an attachment — for pulling the original off the drive."""
    row = conn.execute("SELECT * FROM media_file WHERE id = ?", (media_id,)).fetchone()
    if row is None:
        raise HTTPException(404, f"Media file {media_id} not found")
    try:
        path = storage.resolve_media_path(row["rel_path"])
    except ValueError:
        raise HTTPException(500, "Stored media path is invalid")
    if not path.is_file():
        raise HTTPException(404, "File missing from disk")
    return FileResponse(path, filename=_saved_filename(conn, row, path))


# --------------------------------------------------------------------------- #
# Delete
# --------------------------------------------------------------------------- #

@router.delete("/media/{media_id}", status_code=204)
def delete_media(
    media_id: int,
    conn: sqlite3.Connection = Depends(db_dependency),
) -> Response:
    """
    Delete one video: the file on disk and its database row.

    The row is removed even if the file was already gone, so the database never
    keeps pointing at something that does not exist.
    """
    row = conn.execute("SELECT * FROM media_file WHERE id = ?", (media_id,)).fetchone()
    if row is None:
        raise HTTPException(404, f"Media file {media_id} not found")

    storage.delete_file(row["rel_path"])
    conn.execute("DELETE FROM media_file WHERE id = ?", (media_id,))
    conn.execute("UPDATE content SET updated_at = ? WHERE id = ?",
                 (utc_now_iso(), row["content_id"]))
    return Response(status_code=204)
