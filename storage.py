"""
Filesystem helpers for the media folder.

Kept separate from the HTTP layer so the rules about *where files may live* are
enforced in one place. Nothing outside this module should build a path into
MEDIA_ROOT by hand.

Layout:  MEDIA_ROOT/{content_id}/{raw|final}/{filename}
"""

from pathlib import Path
import asyncio
import json
import mimetypes
import re
import shutil
import unicodedata

from config import settings

# Characters that are illegal or dangerous in a filename on common filesystems.
_UNSAFE_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
# Windows reserved device names — harmless on ext4, but rejected anyway so the
# media folder stays safe to copy to another machine or into a zip.
_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}


def sanitize_filename(name: str, fallback: str = "video.mp4") -> str:
    """
    Reduce a client-supplied filename to something safe to write to disk.

    Strips any directory component, control characters and separators, so
    '../../etc/passwd' becomes 'passwd' and cannot escape the media folder.
    Path containment is *also* asserted in `resolve_media_path()` — this is the
    first of two independent defences, not the only one.
    """
    # Normalise unicode so visually identical names collide predictably.
    name = unicodedata.normalize("NFC", name or "")
    # Discard any path structure; keep only the final component.
    name = name.replace("\\", "/").split("/")[-1]
    name = _UNSAFE_CHARS.sub("_", name).strip(" .")

    if not name:
        return fallback
    if Path(name).stem.upper() in _RESERVED_NAMES:
        name = f"_{name}"
    # Leave headroom under the 255-byte ext4 limit for the ".part" suffix and
    # any " (2)" collision marker appended later.
    if len(name.encode("utf-8")) > 200:
        stem, suffix = Path(name).stem, Path(name).suffix[:20]
        stem = stem.encode("utf-8")[: 200 - len(suffix.encode("utf-8"))].decode(
            "utf-8", "ignore"
        )
        name = f"{stem}{suffix}"
    return name or fallback


def content_dir(content_id: int, kind: str) -> Path:
    """Absolute path of the folder holding one entry's raw or final videos."""
    if kind not in ("raw", "final"):
        raise ValueError(f"invalid media kind: {kind!r}")
    return settings.MEDIA_ROOT / str(int(content_id)) / kind


def resolve_media_path(rel_path: str) -> Path:
    """
    Turn a stored relative path into an absolute one, refusing anything that
    escapes MEDIA_ROOT.

    This is the second defence against traversal: even if a malformed or
    hand-edited `rel_path` reached the database, it cannot be used to read a
    file outside the media folder.
    """
    root = settings.MEDIA_ROOT.resolve()
    candidate = (root / rel_path).resolve()
    if candidate != root and not candidate.is_relative_to(root):
        raise ValueError(f"path escapes media root: {rel_path!r}")
    return candidate


def unique_destination(directory: Path, filename: str) -> Path:
    """
    Pick a non-colliding path inside `directory`.

    Uploading two files called 'clip.mp4' yields 'clip.mp4' and 'clip (2).mp4'
    rather than silently overwriting the first.
    """
    directory.mkdir(parents=True, exist_ok=True)
    dest = directory / filename
    if not dest.exists():
        return dest

    stem, suffix = Path(filename).stem, Path(filename).suffix
    for n in range(2, 10_000):
        candidate = directory / f"{stem} ({n}){suffix}"
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"could not find a free filename for {filename!r}")


def relative_to_media_root(path: Path) -> str:
    """Path as stored in the database — always POSIX-style and relative."""
    return path.resolve().relative_to(settings.MEDIA_ROOT.resolve()).as_posix()


def guess_mime_type(filename: str) -> str | None:
    """Best-effort content type, used for the <video> element's type hint."""
    mime, _ = mimetypes.guess_type(filename)
    if mime:
        return mime
    # mimetypes misses a few container formats that browsers do play.
    return {
        ".mkv": "video/x-matroska",
        ".m4v": "video/x-m4v",
        ".flv": "video/x-flv",
    }.get(Path(filename).suffix.lower())


async def probe_duration(path: Path) -> float | None:
    """
    Read a video's duration in seconds using ffprobe.

    Entirely optional: if ffprobe is missing, times out, or the file is not a
    recognised video, this returns None and the app carries on without the
    metadata rather than failing the upload.
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_format", str(path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=30)
        except asyncio.TimeoutError:
            proc.kill()
            return None
        if proc.returncode != 0:
            return None
        duration = json.loads(stdout).get("format", {}).get("duration")
        return float(duration) if duration is not None else None
    except (FileNotFoundError, ValueError, json.JSONDecodeError, OSError):
        return None


def delete_file(rel_path: str) -> bool:
    """
    Remove one media file and tidy up any folders it leaves empty.

    Returns True if a file was actually deleted. A missing file is not an
    error — the database row should still be removed so the two stay in sync.
    """
    try:
        path = resolve_media_path(rel_path)
    except ValueError:
        return False

    deleted = False
    if path.is_file():
        path.unlink()
        deleted = True

    # Prune now-empty {kind}/ and {content_id}/ folders, stopping at MEDIA_ROOT.
    root = settings.MEDIA_ROOT.resolve()
    parent = path.parent
    while parent != root and parent.is_relative_to(root):
        try:
            next(parent.iterdir())
            break            # not empty, leave it alone
        except StopIteration:
            parent.rmdir()   # empty, remove and check the level above
            parent = parent.parent
        except OSError:
            break
    return deleted


def delete_content_tree(content_id: int) -> None:
    """
    Remove an entry's entire media folder, used when the entry itself is deleted.

    Missing folders are ignored so deleting an entry that never had uploads is
    not an error.
    """
    target = (settings.MEDIA_ROOT / str(int(content_id))).resolve()
    root = settings.MEDIA_ROOT.resolve()
    # Guard against a bad content_id producing a path outside the media folder.
    if target == root or not target.is_relative_to(root):
        raise ValueError(f"refusing to delete {target}")
    shutil.rmtree(target, ignore_errors=True)
