"""
Money ledger CRUD plus the savings goal.

One table of income/expense entries; the client derives every total from the
list, so the API stays a plain ledger. The goal lives in app_setting so it
survives restarts and can be edited from the UI.
"""

from datetime import date
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from database import db_dependency, utc_now_iso
from models import Direction, MoneyCreate, MoneyEntry, MoneyGoal, MoneyUpdate

router = APIRouter(prefix="/money", tags=["money"])

DEFAULT_GOAL = 350_000.0


def _row_to_entry(row: sqlite3.Row) -> MoneyEntry:
    signed = row["amount"] if row["direction"] == Direction.INCOME.value \
        else -row["amount"]
    return MoneyEntry(
        id=row["id"],
        entry=row["entry"],
        amount=row["amount"],
        date=row["date"],
        direction=row["direction"],
        party=row["party"],
        signed=signed,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# The /goal routes are declared before /{money_id} so they can never be
# shadowed by the integer path parameter.

@router.get("/goal")
def get_goal(conn: sqlite3.Connection = Depends(db_dependency)) -> dict:
    """The savings goal; falls back to the default until one is saved."""
    row = conn.execute(
        "SELECT value FROM app_setting WHERE key = 'money_goal'"
    ).fetchone()
    return {"goal": float(row["value"]) if row else DEFAULT_GOAL}


@router.put("/goal")
def set_goal(
    payload: MoneyGoal,
    conn: sqlite3.Connection = Depends(db_dependency),
) -> dict:
    conn.execute(
        """INSERT INTO app_setting (key, value) VALUES ('money_goal', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value""",
        (str(payload.goal),),
    )
    return {"goal": payload.goal}


@router.get("", response_model=list[MoneyEntry])
def list_money(
    month: str | None = Query(None, pattern=r"^\d{4}-\d{2}$",
                              description="Filter by date month, 'YYYY-MM'"),
    direction: str | None = Query(None, description="Income or Expense"),
    conn: sqlite3.Connection = Depends(db_dependency),
) -> list[MoneyEntry]:
    """All ledger entries, newest first; undated entries sink to the bottom."""
    where: list[str] = []
    params: list[object] = []
    if month:
        where.append("date IS NOT NULL AND substr(date, 1, 7) = ?")
        params.append(month)
    if direction:
        where.append("direction = ?")
        params.append(direction)

    sql = "SELECT * FROM money"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY (date IS NULL), date DESC, id DESC"
    return [_row_to_entry(r) for r in conn.execute(sql, params).fetchall()]


@router.post("", response_model=MoneyEntry, status_code=201)
def create_money(
    payload: MoneyCreate,
    conn: sqlite3.Connection = Depends(db_dependency),
) -> MoneyEntry:
    now = utc_now_iso()
    cur = conn.execute(
        """INSERT INTO money (entry, amount, date, direction, party,
                              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            payload.entry,
            payload.amount,
            payload.date.isoformat() if payload.date else None,
            payload.direction.value,
            payload.party,
            now, now,
        ),
    )
    row = conn.execute("SELECT * FROM money WHERE id = ?",
                       (cur.lastrowid,)).fetchone()
    return _row_to_entry(row)


@router.patch("/{money_id}", response_model=MoneyEntry)
def update_money(
    money_id: int,
    payload: MoneyUpdate,
    conn: sqlite3.Connection = Depends(db_dependency),
) -> MoneyEntry:
    """Partial update per inline edit; see update_content for the pattern."""
    if conn.execute("SELECT 1 FROM money WHERE id = ?",
                    (money_id,)).fetchone() is None:
        raise HTTPException(404, f"Money entry {money_id} not found")

    fields = payload.model_dump(exclude_unset=True)
    if fields:
        assignments: list[str] = []
        params: list[object] = []
        for key, value in fields.items():
            if hasattr(value, "value"):
                value = value.value
            elif isinstance(value, date):
                value = value.isoformat()
            assignments.append(f"{key} = ?")
            params.append(value)
        assignments.append("updated_at = ?")
        params.extend([utc_now_iso(), money_id])
        conn.execute(
            f"UPDATE money SET {', '.join(assignments)} WHERE id = ?", params)

    row = conn.execute("SELECT * FROM money WHERE id = ?",
                       (money_id,)).fetchone()
    return _row_to_entry(row)


@router.delete("/{money_id}", status_code=204)
def delete_money(
    money_id: int,
    conn: sqlite3.Connection = Depends(db_dependency),
) -> Response:
    if conn.execute("SELECT 1 FROM money WHERE id = ?",
                    (money_id,)).fetchone() is None:
        raise HTTPException(404, f"Money entry {money_id} not found")
    conn.execute("DELETE FROM money WHERE id = ?", (money_id,))
    return Response(status_code=204)
