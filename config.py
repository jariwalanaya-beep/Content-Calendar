"""
Central configuration for Content Hub.

Everything tunable lives here and is driven by the .env file sitting next to
this module. Import `settings` anywhere else in the app rather than reading
environment variables directly, so there is exactly one place to change.
"""

from pathlib import Path
import os

from dotenv import load_dotenv

# Absolute path to the project folder (the directory containing this file).
# Every relative path in .env is resolved against this, which means the whole
# project stays portable: move or rename the folder and it still works.
PROJECT_DIR = Path(__file__).resolve().parent

# Load .env if present. Real environment variables win over .env values, so you
# can override any setting for a one-off run, e.g.  PORT=9000 uvicorn main:app
load_dotenv(PROJECT_DIR / ".env", override=False)


def _resolve(value: str | None, default: Path) -> Path:
    """
    Turn a configured path string into an absolute Path.

    Relative values are interpreted relative to PROJECT_DIR (not the shell's
    current working directory), so `uvicorn main:app` behaves identically no
    matter which folder you launch it from.
    """
    if not value or not value.strip():
        return default
    p = Path(value.strip()).expanduser()
    return p if p.is_absolute() else (PROJECT_DIR / p)


class Settings:
    """Application settings, resolved once at import time."""

    # --- Storage -------------------------------------------------------------
    # Where uploaded video files are stored. Defaults to <project>/media.
    # Because the project folder lives on the storage drive, this automatically
    # points at that drive with no absolute path to keep in sync. Override in
    # .env to put media somewhere else entirely.
    MEDIA_ROOT: Path = _resolve(os.getenv("MEDIA_ROOT"), PROJECT_DIR / "media")

    # SQLite database file. Kept inside the project folder by default so the
    # database travels with the media it describes.
    DB_PATH: Path = _resolve(os.getenv("DB_PATH"), PROJECT_DIR / "content_hub.db")

    # --- Server --------------------------------------------------------------
    # Bound to loopback by default: this is a single-user app with no auth, so
    # it must not be reachable from the network. Only change if you know why.
    HOST: str = os.getenv("HOST", "127.0.0.1")
    PORT: int = int(os.getenv("PORT", "8000"))

    # --- Uploads -------------------------------------------------------------
    # Size of each chunk streamed from the request body to disk. 1 MiB keeps
    # memory flat regardless of file size; a 1 GB upload still uses ~1 MiB.
    UPLOAD_CHUNK_SIZE: int = int(os.getenv("UPLOAD_CHUNK_SIZE", str(1024 * 1024)))

    # Reject uploads larger than this. 0 disables the check entirely.
    # Default 5 GB — comfortably above the ~1 GB ceiling mentioned for footage.
    MAX_UPLOAD_BYTES: int = int(os.getenv("MAX_UPLOAD_BYTES", str(5 * 1024**3)))

    # Video file extensions accepted by the upload endpoint.
    ALLOWED_VIDEO_EXTENSIONS: set[str] = {
        ".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".mpg", ".mpeg", ".wmv", ".flv",
    }

    def ensure_directories(self) -> None:
        """Create the media root on startup. Safe to call repeatedly."""
        self.MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
        self.DB_PATH.parent.mkdir(parents=True, exist_ok=True)


settings = Settings()
