"""
Content library CRUD, search, filtering and sorting.

This backs all four library views (table, board, calendar, this-month); they
differ only in the query parameters they send to `list_content`.
"""

from datetime import date
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query, Response

import storage
from database import db_dependency, utc_now_iso
from models import Content, ContentCreate, ContentUpdate, Status
from routers.media import media_row_to_model

router = APIRouter(prefix="/content", tags=["content"])

# What one finished edit costs. Booked into the money ledger as an Unpaid
# expense the first time a video is marked Done with an editor assigned.
EDITOR_FEE = 500.0

# Columns the client is allowed to sort by. Whitelisted rather than interpolated
# from user input, because column names cannot be passed as SQL parameters.
SORTABLE = {
    "topic", "assigned_to", "performance", "status", "type",
    "upload_date", "deadline", "created_at", "updated_at",
}


def _row_to_content(row: sqlite3.Row) -> Content:
    """Map a joined content row (with raw_count/final_count) to the API shape."""
    return Content(
        id=row["id"],
        topic=row["topic"],
        assigned_to=row["assigned_to"],
        notes=row["notes"],
        performance=row["performance"],
        status=row["status"],
        type=row["type"],
        upload_date=row["upload_date"],
        deadline=row["deadline"] if "deadline" in row.keys() else None,
        done=bool(row["done"]) if "done" in row.keys() else False,
        done_at=row["done_at"] if "done_at" in row.keys() else None,
        script=row["script"],
        board_order=row["board_order"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        raw_count=row["raw_count"] if "raw_count" in row.keys() else 0,
        final_count=row["final_count"] if "final_count" in row.keys() else 0,
    )


def _auto_post(conn: sqlite3.Connection) -> None:
    """
    A Ready video whose upload date has passed went out, so it advances to
    Posted by itself. Runs on every read, which keeps all views agreeing
    without a scheduler. Only Ready moves — earlier stages missing their
    date are late, not posted.
    """
    conn.execute(
        """UPDATE content SET status = ?, updated_at = ?
           WHERE status = ? AND upload_date IS NOT NULL
             AND upload_date <> '' AND upload_date < ?""",
        (Status.POSTED.value, utc_now_iso(),
         Status.READY.value, date.today().isoformat()),
    )


# Attaches per-entry attachment counts without a second round trip, so list
# views can show a badge cheaply.
_BASE_SELECT = """
SELECT c.*,
       COALESCE(SUM(CASE WHEN m.kind = 'raw'   THEN 1 ELSE 0 END), 0) AS raw_count,
       COALESCE(SUM(CASE WHEN m.kind = 'final' THEN 1 ELSE 0 END), 0) AS final_count
FROM content c
LEFT JOIN media_file m ON m.content_id = c.id
"""


@router.get("", response_model=list[Content])
def list_content(
    search: str | None = Query(None, description="Case-insensitive match on Topic"),
    month: str | None = Query(None, pattern=r"^\d{4}-\d{2}$",
                              description="Filter by upload_date month, 'YYYY-MM'"),
    status: str | None = Query(None, description="Exact Status match"),
    type_: str | None = Query(None, alias="type", description="Exact Type match"),
    performance: str | None = Query(None, description="Exact Performance match"),
    done: bool | None = Query(None, description="Filter by the done flag"),
    has_deadline: bool = Query(False, description="Only entries that have a deadline"),
    has_media: bool = Query(False, description="Only entries with at least one video"),
    media: str | None = Query(
        None, pattern="^(raw|final|none)$",
        description="Filter by which media bucket is populated: "
                    "'raw' / 'final' = has at least one of that kind, "
                    "'none' = has no video at all"),
    assigned: bool = Query(False, description="Only entries with someone in Assigned to"),
    sort: str = Query("updated_at", description=f"One of: {', '.join(sorted(SORTABLE))}"),
    direction: str = Query("desc", pattern="^(?i)(asc|desc)$"),
    conn: sqlite3.Connection = Depends(db_dependency),
) -> list[Content]:
    """
    List library entries, optionally filtered.

    `month` powers both the calendar grid and the "This Month" view. Entries
    with no upload_date are excluded when filtering by month, since they cannot
    be placed on a calendar.
    """
    _auto_post(conn)

    where: list[str] = []
    params: list[object] = []

    if search:
        # LIKE with ESCAPE so a literal % or _ in the search box matches itself
        # instead of acting as a wildcard.
        escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        where.append("c.topic LIKE ? ESCAPE '\\'")
        params.append(f"%{escaped}%")

    if month:
        # Dates are stored as ISO 'YYYY-MM-DD' text, so a prefix match on the
        # first 7 characters selects the month and uses the index on upload_date.
        where.append("c.upload_date IS NOT NULL AND substr(c.upload_date, 1, 7) = ?")
        params.append(month)

    if status:
        where.append("c.status = ?")
        params.append(status)

    if type_:
        where.append("c.type = ?")
        params.append(type_)

    if performance:
        where.append("c.performance = ?")
        params.append(performance)

    if done is not None:
        where.append("c.done = ?")
        params.append(1 if done else 0)

    if has_deadline:
        where.append("c.deadline IS NOT NULL AND c.deadline <> ''")

    # The Deadlines view is an assignment tracker, so unassigned entries are
    # noise there. TRIM guards against a name that is only whitespace.
    if assigned:
        where.append("TRIM(COALESCE(c.assigned_to, '')) <> ''")

    sql = _BASE_SELECT
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " GROUP BY c.id"

    # Media presence is a property of the aggregated counts, so it filters with
    # HAVING rather than WHERE, which cannot see the SUM() columns.
    # `media` is the finer-grained form of `has_media`; when both arrive the
    # specific one wins, since a caller asking for 'raw' already implied media.
    having = {
        "raw":   "raw_count > 0",
        "final": "final_count > 0",
        "none":  "(raw_count + final_count) = 0",
    }.get(media or "")
    if not having and has_media:
        having = "(raw_count + final_count) > 0"
    if having:
        sql += f" HAVING {having}"

    sort_col = sort if sort in SORTABLE else "updated_at"
    sort_dir = "ASC" if direction.lower() == "asc" else "DESC"
    # NULLs last regardless of direction, so entries missing a value sink to the
    # bottom instead of crowding the top of the table.
    sql += f" ORDER BY (c.{sort_col} IS NULL), c.{sort_col} {sort_dir}, c.id DESC"

    rows = conn.execute(sql, params).fetchall()
    return [_row_to_content(r) for r in rows]


@router.get("/months", response_model=list[str])
def list_months(conn: sqlite3.Connection = Depends(db_dependency)) -> list[str]:
    """
    Distinct 'YYYY-MM' values present in the library.

    Lets the month picker offer only months that actually contain something.
    """
    rows = conn.execute(
        """SELECT DISTINCT substr(upload_date, 1, 7) AS m
           FROM content WHERE upload_date IS NOT NULL AND upload_date <> ''
           ORDER BY m DESC"""
    ).fetchall()
    return [r["m"] for r in rows]


@router.get("/{content_id}", response_model=Content)
def get_content(
    content_id: int,
    conn: sqlite3.Connection = Depends(db_dependency),
) -> Content:
    """One entry with its full raw and final media lists, for the detail page."""
    _auto_post(conn)
    row = conn.execute(
        _BASE_SELECT + " WHERE c.id = ? GROUP BY c.id", (content_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Content entry {content_id} not found")

    item = _row_to_content(row)
    media = conn.execute(
        "SELECT * FROM media_file WHERE content_id = ? ORDER BY uploaded_at, id",
        (content_id,),
    ).fetchall()
    item.raw = [media_row_to_model(m) for m in media if m["kind"] == "raw"]
    item.final = [media_row_to_model(m) for m in media if m["kind"] == "final"]
    return item


@router.post("", response_model=Content, status_code=201)
def create_content(
    payload: ContentCreate,
    conn: sqlite3.Connection = Depends(db_dependency),
) -> Content:
    """Create an entry. New cards go to the top of their kanban column."""
    now = utc_now_iso()

    # Lower board_order sorts first; going one below the current minimum puts
    # the new card at the top without renumbering the existing ones.
    min_order = conn.execute(
        "SELECT COALESCE(MIN(board_order), 0) AS lo FROM content WHERE status = ?",
        (payload.status.value,),
    ).fetchone()["lo"]

    cur = conn.execute(
        """INSERT INTO content
             (topic, assigned_to, notes, performance, status, type,
              upload_date, deadline, script, board_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            payload.topic,
            payload.assigned_to,
            payload.notes,
            payload.performance.value if payload.performance else None,
            payload.status.value,
            payload.type.value if payload.type else None,
            payload.upload_date.isoformat() if payload.upload_date else None,
            payload.deadline.isoformat() if payload.deadline else None,
            payload.script,
            min_order - 1,
            now, now,
        ),
    )
    return get_content(cur.lastrowid, conn)


@router.patch("/{content_id}", response_model=Content)
def update_content(
    content_id: int,
    payload: ContentUpdate,
    conn: sqlite3.Connection = Depends(db_dependency),
) -> Content:
    """
    Partial update, used by every inline edit and by kanban drag-and-drop.

    Only fields actually present in the request body are written. `exclude_unset`
    is what makes that work: it distinguishes "field omitted, leave it alone"
    from "field explicitly set to null, clear it".
    """
    if conn.execute("SELECT 1 FROM content WHERE id = ?", (content_id,)).fetchone() is None:
        raise HTTPException(404, f"Content entry {content_id} not found")

    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        return get_content(content_id, conn)

    assignments: list[str] = []
    params: list[object] = []
    for key, value in fields.items():
        # Enums and dates need unwrapping to the primitives SQLite stores.
        if hasattr(value, "value"):
            value = value.value
        elif isinstance(value, date):
            value = value.isoformat()
        assignments.append(f"{key} = ?")
        params.append(value)

    # Stamp when Done was toggled, and clear it when reopened.
    if "done" in fields:
        assignments.append("done_at = ?")
        params.append(utc_now_iso() if fields["done"] else None)

    if fields.get("done"):
        current = conn.execute(
            "SELECT status, done, assigned_to, topic FROM content WHERE id = ?",
            (content_id,),
        ).fetchone()

        # Signing the edit off moves an Editing video forward to Ready —
        # unless this same request already sets the status explicitly.
        if "status" not in fields and current["status"] == Status.EDITING.value:
            assignments.append("status = ?")
            params.append(Status.READY.value)

        # The FIRST sign-off with an editor assigned books their fee in the
        # money ledger as Unpaid, so batching several videos into one payout
        # just means flipping the entries to Paid later. The content_id link
        # (belt to the transition check's braces) makes double-booking
        # impossible even across reopen/redo cycles.
        if (not current["done"] and current["assigned_to"].strip()
                and conn.execute("SELECT 1 FROM money WHERE content_id = ?",
                                 (content_id,)).fetchone() is None):
            now = utc_now_iso()
            conn.execute(
                """INSERT INTO money (entry, amount, date, direction, party,
                                      paid, content_id, created_at, updated_at)
                   VALUES (?, ?, ?, 'Expense', ?, 'Unpaid', ?, ?, ?)""",
                (f"Editor fee — {current['topic']}", EDITOR_FEE,
                 date.today().isoformat(), current["assigned_to"].strip(),
                 content_id, now, now),
            )

    assignments.append("updated_at = ?")
    params.extend([utc_now_iso(), content_id])

    conn.execute(f"UPDATE content SET {', '.join(assignments)} WHERE id = ?", params)
    return get_content(content_id, conn)


@router.delete("/{content_id}", status_code=204)
def delete_content(
    content_id: int,
    conn: sqlite3.Connection = Depends(db_dependency),
) -> Response:
    """
    Delete an entry along with every video file it owns.

    The whole media/{content_id}/ tree goes, so the drive is not left with
    orphaned 500MB files. The UI confirms this first, naming the file count.
    The media_file rows disappear via ON DELETE CASCADE.
    """
    if conn.execute("SELECT 1 FROM content WHERE id = ?", (content_id,)).fetchone() is None:
        raise HTTPException(404, f"Content entry {content_id} not found")

    # Remove files before the DB rows: if this fails, the entry is still listed
    # and the problem is visible, rather than leaving untracked files behind.
    storage.delete_content_tree(content_id)
    conn.execute("DELETE FROM content WHERE id = ?", (content_id,))
    return Response(status_code=204)
