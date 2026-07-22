"""
The weekly recurring template — the Monday-to-Sunday production format.

Deliberately fixed at seven rows: this is a repeating weekly pattern, not a
dated schedule, so rows can only be read and updated, never created or deleted.
"""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from database import db_dependency, utc_now_iso
from models import WeeklyDay, WeeklyDayUpdate

router = APIRouter(prefix="/weekly", tags=["weekly"])


@router.get("", response_model=list[WeeklyDay])
def list_week(conn: sqlite3.Connection = Depends(db_dependency)) -> list[WeeklyDay]:
    """All seven days in Monday-first order."""
    rows = conn.execute(
        "SELECT * FROM weekly_template ORDER BY day_index"
    ).fetchall()
    return [WeeklyDay(**dict(r)) for r in rows]


@router.patch("/{day_index}", response_model=WeeklyDay)
def update_day(
    day_index: int,
    payload: WeeklyDayUpdate,
    conn: sqlite3.Connection = Depends(db_dependency),
) -> WeeklyDay:
    """
    Update one weekday. Called per-cell as you edit the table inline, so only
    the field that changed is sent.
    """
    if not 0 <= day_index <= 6:
        raise HTTPException(400, "day_index must be 0 (Monday) to 6 (Sunday)")

    row = conn.execute(
        "SELECT * FROM weekly_template WHERE day_index = ?", (day_index,)
    ).fetchone()
    if row is None:
        raise HTTPException(404, f"Weekday {day_index} not found")

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
        params.extend([utc_now_iso(), day_index])
        conn.execute(
            f"UPDATE weekly_template SET {', '.join(assignments)} WHERE day_index = ?",
            params,
        )
        row = conn.execute(
            "SELECT * FROM weekly_template WHERE day_index = ?", (day_index,)
        ).fetchone()

    return WeeklyDay(**dict(row))
