"""
The weekly plan — a Monday-to-Sunday table for every week.

Each week is identified by the ISO date of its Monday (`week_start`) and holds
exactly seven rows. Weeks are created lazily the first time they are viewed,
so the client can page to any past or future week. Rows within a week can only
be read and updated, never created or deleted.
"""

import sqlite3
from datetime import date

from fastapi import APIRouter, Depends, HTTPException

from database import db_dependency, ensure_week, monday_of, utc_now_iso
from models import WeeklyDay, WeeklyDayUpdate

router = APIRouter(prefix="/weekly", tags=["weekly"])


def _resolve_week(week: str | None) -> str:
    """
    Normalise the `week` query parameter to the Monday of that week.

    Accepts any ISO date inside the week (not just the Monday); no parameter
    means the current week.
    """
    if week is None:
        return monday_of(date.today())
    try:
        return monday_of(date.fromisoformat(week))
    except ValueError:
        raise HTTPException(400, f"week must be an ISO date, got {week!r}")


@router.get("", response_model=list[WeeklyDay])
def list_week(
    week: str | None = None,
    conn: sqlite3.Connection = Depends(db_dependency),
) -> list[WeeklyDay]:
    """The seven days of one week in Monday-first order. Defaults to this week."""
    week_start = _resolve_week(week)
    ensure_week(conn, week_start)
    rows = conn.execute(
        "SELECT * FROM weekly_template WHERE week_start = ? ORDER BY day_index",
        (week_start,),
    ).fetchall()
    return [WeeklyDay(**dict(r)) for r in rows]


@router.patch("/{day_index}", response_model=WeeklyDay)
def update_day(
    day_index: int,
    payload: WeeklyDayUpdate,
    week: str | None = None,
    conn: sqlite3.Connection = Depends(db_dependency),
) -> WeeklyDay:
    """
    Update one weekday of one week. Called per-cell as you edit the table
    inline, so only the field that changed is sent.
    """
    if not 0 <= day_index <= 6:
        raise HTTPException(400, "day_index must be 0 (Monday) to 6 (Sunday)")

    week_start = _resolve_week(week)
    ensure_week(conn, week_start)
    where = "week_start = ? AND day_index = ?"
    row = conn.execute(
        f"SELECT * FROM weekly_template WHERE {where}", (week_start, day_index)
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Weekday {day_index} of {week_start} not found")

    # exclude_unset keeps untouched fields untouched; see update_content for the
    # same pattern and the reasoning behind it.
    fields = payload.model_dump(exclude_unset=True)
    if fields:
        assignments, params = [], []
        for key, value in fields.items():
            if hasattr(value, "isoformat"):
                value = value.isoformat()
            assignments.append(f"{key} = ?")
            params.append(value)
        assignments.append("updated_at = ?")
        params.extend([utc_now_iso(), week_start, day_index])
        conn.execute(
            f"UPDATE weekly_template SET {', '.join(assignments)} WHERE {where}",
            params,
        )
        row = conn.execute(
            f"SELECT * FROM weekly_template WHERE {where}", (week_start, day_index)
        ).fetchone()

    return WeeklyDay(**dict(row))
