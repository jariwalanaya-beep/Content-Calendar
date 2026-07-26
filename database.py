"""
SQLite access layer.

Deliberately uses the stdlib `sqlite3` module rather than an ORM: there are
only three tables, and keeping raw SQL here means there is no hidden magic to
fight when you extend the schema later.

Schema changes: bump SCHEMA_VERSION and add a migration step in `_migrate()`.
"""

from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Iterator
import sqlite3

from config import settings

# Bump this when you change the schema, and add the matching migration below.
SCHEMA_VERSION = 6

# Monday-first, matching the weekly template layout.
DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday",
             "Friday", "Saturday", "Sunday"]


def utc_now_iso() -> str:
    """Timestamp for created_at / updated_at columns."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    """
    Open a connection with the pragmas this app depends on.

    A fresh connection per request is intentional: SQLite connections are cheap,
    and it sidesteps the thread-affinity rules that bite when a single connection
    is shared across FastAPI's threadpool.
    """
    conn = sqlite3.connect(
        settings.DB_PATH,
        # Let SQLite wait rather than immediately raising "database is locked"
        # if another request holds a write lock.
        timeout=15.0,
        # Required because FastAPI runs sync dependencies (like db_dependency)
        # in a worker thread, while an `async def` endpoint body runs on the
        # event loop thread. The connection is therefore opened in one thread
        # and used in another, which SQLite rejects by default.
        #
        # Safe here because each request gets its own private connection and
        # only ever one thread touches it at a time — the threads are
        # sequential, not concurrent. Sharing a single connection across
        # requests would NOT be safe.
        check_same_thread=False,
    )
    # Rows behave like dicts, so `row["topic"]` works and JSON conversion is trivial.
    conn.row_factory = sqlite3.Row
    # Required for ON DELETE CASCADE to actually fire; SQLite defaults it OFF.
    conn.execute("PRAGMA foreign_keys = ON")
    # Rollback journal rather than WAL. WAL needs a shared-memory (-shm) file and
    # real POSIX locking to coordinate connections; exFAT provides neither, and
    # SQLite still reports "wal" when you ask for it, so the breakage would be
    # silent. Its only benefit is concurrent readers during a write, which is
    # meaningless for a single local user.
    conn.execute("PRAGMA journal_mode = DELETE")
    # FULL rather than NORMAL: this drive is USB-attached and can be unplugged,
    # and exFAT has no journal of its own to fall back on.
    conn.execute("PRAGMA synchronous = FULL")
    return conn


@contextmanager
def get_db() -> Iterator[sqlite3.Connection]:
    """
    FastAPI dependency + general-purpose context manager.

    Commits on success, rolls back if the handler raises, always closes.
    """
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def db_dependency() -> Iterator[sqlite3.Connection]:
    """Thin wrapper so routers can use `Depends(db_dependency)`."""
    with get_db() as conn:
        yield conn


# --------------------------------------------------------------------------- #
# Schema
# --------------------------------------------------------------------------- #

# The weekly plan. One set of 7 rows per week, keyed by that week's Monday
# (`week_start`). Weeks are created lazily the first time they are viewed, so
# navigating to any past or future week just works.
WEEKLY_TABLE = """
CREATE TABLE IF NOT EXISTS weekly_template (
    id              INTEGER PRIMARY KEY,
    week_start      TEXT    NOT NULL,          -- ISO Monday 'YYYY-MM-DD' of this week
    day_index       INTEGER NOT NULL,          -- 0=Monday .. 6=Sunday, drives ordering
    day_name        TEXT    NOT NULL,
    format          TEXT    NOT NULL DEFAULT '',
    content_idea    TEXT    NOT NULL DEFAULT '',
    topic           TEXT    NOT NULL DEFAULT '',
    assigned_to     TEXT    NOT NULL DEFAULT '',
    editor_deadline TEXT,                      -- ISO date 'YYYY-MM-DD', nullable
    updated_at      TEXT    NOT NULL,
    UNIQUE (week_start, day_index)
);
"""

SCHEMA = WEEKLY_TABLE + """

-- Every piece of content in the pipeline.
CREATE TABLE IF NOT EXISTS content (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    topic        TEXT    NOT NULL DEFAULT 'Untitled',
    assigned_to  TEXT    NOT NULL DEFAULT '',
    notes        TEXT    NOT NULL DEFAULT '',
    performance  TEXT,                          -- Viral | Average | Failed | NULL
    status       TEXT    NOT NULL DEFAULT 'Idea',  -- Idea|Scripting|Editing|Ready|Posted|Failed
    type         TEXT,                          -- Scripted | Clips | NULL
    upload_date  TEXT,                          -- ISO 'YYYY-MM-DD'; drives the calendar view
    script       TEXT    NOT NULL DEFAULT '',
    deadline     TEXT,                          -- ISO 'YYYY-MM-DD', the editor's due date
    done         INTEGER NOT NULL DEFAULT 0,    -- 1 once the edit is signed off
    done_at      TEXT,                          -- when Done was clicked
    board_order  REAL    NOT NULL DEFAULT 0,    -- sort position within its kanban column
    created_at   TEXT    NOT NULL,
    updated_at   TEXT    NOT NULL
);

-- Select-field values are validated in Pydantic (models.py) rather than with SQL
-- CHECK constraints, so adding a new Status later needs no schema migration.

CREATE INDEX IF NOT EXISTS idx_content_upload_date ON content(upload_date);
CREATE INDEX IF NOT EXISTS idx_content_status      ON content(status);

-- One row per uploaded video file. Only the path RELATIVE to MEDIA_ROOT is
-- stored, so the media folder can be moved or the drive remounted elsewhere
-- without invalidating the database.
CREATE TABLE IF NOT EXISTS media_file (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id       INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
    kind             TEXT    NOT NULL CHECK (kind IN ('raw', 'final')),
    rel_path         TEXT    NOT NULL UNIQUE,   -- e.g. '12/raw/clip.mp4'
    original_name    TEXT    NOT NULL,          -- filename as uploaded, for display
    size_bytes       INTEGER NOT NULL,
    mime_type        TEXT,
    duration_seconds REAL,                      -- via ffprobe when available
    uploaded_at      TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_content ON media_file(content_id, kind);
"""


# Indexes over columns added by migrations. Kept out of SCHEMA so they are only
# created once _migrate() has guaranteed the columns exist.
POST_MIGRATION_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_content_deadline ON content(done, deadline);
"""


def monday_of(d: date) -> str:
    """ISO date of the Monday of the week containing `d` — the week's key."""
    return (d - timedelta(days=d.weekday())).isoformat()


def ensure_week(conn: sqlite3.Connection, week_start: str) -> None:
    """
    Insert the seven weekday rows for one week if they do not exist yet.

    Called lazily from the weekly router whenever a week is viewed, so paging
    to any week — past or future — materialises it on first access.
    """
    existing = conn.execute(
        "SELECT COUNT(*) AS n FROM weekly_template WHERE week_start = ?",
        (week_start,),
    ).fetchone()["n"]
    if existing:
        return
    now = utc_now_iso()
    conn.executemany(
        """INSERT INTO weekly_template (week_start, day_index, day_name, updated_at)
           VALUES (?, ?, ?, ?)""",
        [(week_start, i, name, now) for i, name in enumerate(DAY_NAMES)],
    )


def _migrate(conn: sqlite3.Connection) -> None:
    """
    Apply schema migrations based on SQLite's `user_version` pragma.

    Version 0 means a brand-new database (or one predating versioning); the
    CREATE TABLE IF NOT EXISTS statements above already brought it up to v1.
    For a future v2, add:  if current < 2: conn.execute("ALTER TABLE ...")
    """
    current = conn.execute("PRAGMA user_version").fetchone()[0]
    if current == SCHEMA_VERSION:
        return

    # v1 -> v2: add the published title column to databases created before it
    # existed. CREATE TABLE above already covers brand-new databases, so this
    # only matters for an upgrade in place.
    if current < 2:
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(content)")}
        if "title" not in cols:
            conn.execute("ALTER TABLE content ADD COLUMN title TEXT NOT NULL DEFAULT ''")

    # v2 -> v3: editor deadline plus a done flag, for the Deadlines view.
    if current < 3:
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(content)")}
        if "deadline" not in cols:
            conn.execute("ALTER TABLE content ADD COLUMN deadline TEXT")
        if "done" not in cols:
            conn.execute("ALTER TABLE content ADD COLUMN done INTEGER NOT NULL DEFAULT 0")
        if "done_at" not in cols:
            conn.execute("ALTER TABLE content ADD COLUMN done_at TEXT")

    # v3 -> v4: the weekly template becomes per-week. The old table had a
    # UNIQUE(day_index) constraint that SQLite cannot drop in place, so the
    # table is rebuilt and the old single template becomes the current week.
    if current < 4:
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(weekly_template)")}
        if "week_start" not in cols:
            conn.execute("ALTER TABLE weekly_template RENAME TO weekly_template_v3")
            conn.executescript(WEEKLY_TABLE)
            conn.execute(
                """INSERT INTO weekly_template
                       (week_start, day_index, day_name, format, content_idea,
                        topic, assigned_to, editor_deadline, updated_at)
                   SELECT ?, day_index, day_name, format, content_idea,
                          topic, assigned_to, editor_deadline, updated_at
                   FROM weekly_template_v3""",
                (monday_of(date.today()),),
            )
            conn.execute("DROP TABLE weekly_template_v3")

    # v4 -> v5: the 'Short Edit' content type was retired. Any row still using
    # it becomes untyped rather than failing response validation.
    if current < 5:
        conn.execute("UPDATE content SET type = NULL WHERE type = 'Short Edit'")

    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")


def init_db() -> None:
    """
    Create tables and seed data if they do not exist. Called once on startup,
    and safe to call on every run.
    """
    settings.ensure_directories()
    with get_db() as conn:
        conn.executescript(SCHEMA)
        # Must run before the steps below: on a database created by an older
        # version, the columns they reference do not exist until _migrate adds
        # them, and the INSERT / CREATE INDEX would fail with "no such column".
        _migrate(conn)
        # Seed the current week so a brand-new database opens with rows to edit.
        # Other weeks are created on demand by the weekly router.
        ensure_week(conn, monday_of(date.today()))
        conn.executescript(POST_MIGRATION_INDEXES)
