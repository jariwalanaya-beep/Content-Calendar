"""
Pydantic schemas for request validation and response shaping.

The select-field vocabularies (Status, Performance, ContentType) are defined
here as the single source of truth. To add a new Status you change the enum
below and the matching colour in static/css/style.css — no DB migration needed,
because the database stores these as plain TEXT.
"""

from datetime import date
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, field_validator


# --------------------------------------------------------------------------- #
# Select-field vocabularies
# --------------------------------------------------------------------------- #

class Status(str, Enum):
    """Pipeline stage. Order here is the order of the kanban board columns."""
    IDEA = "Idea"
    EDITING = "Editing"
    READY = "Ready"
    POSTED = "Posted"
    FAILED = "Failed"


class Performance(str, Enum):
    """How the piece performed after posting."""
    VIRAL = "Viral"
    AVERAGE = "Average"
    FAILED = "Failed"


class ContentType(str, Enum):
    """Production style."""
    SCRIPTED = "Scripted"
    CLIPS = "Clips"


class Direction(str, Enum):
    """Which way money moved in the ledger."""
    INCOME = "Income"
    EXPENSE = "Expense"


# `kind` distinguishes the two upload buckets and maps directly to the
# media/{content_id}/{kind}/ folder name.
MediaKind = Literal["raw", "final"]


# --------------------------------------------------------------------------- #
# Weekly template
# --------------------------------------------------------------------------- #

class WeeklyDayUpdate(BaseModel):
    """
    Editable fields of one weekday row.

    All optional: the UI saves a single cell at a time, so only the changed
    field is sent. `day_index` and `day_name` are intentionally absent — the
    seven rows are fixed and must not be renamed or reordered.
    """
    format: str | None = None
    content_idea: str | None = None
    topic: str | None = None
    assigned_to: str | None = None
    editor_deadline: date | None = None

    # Lets the client clear a date by sending "" instead of null.
    @field_validator("editor_deadline", mode="before")
    @classmethod
    def _empty_string_is_null(cls, v):
        return None if v == "" else v


class WeeklyDay(BaseModel):
    """One weekday row as returned to the client."""
    id: int
    week_start: str
    day_index: int
    day_name: str
    format: str
    content_idea: str
    topic: str
    assigned_to: str
    editor_deadline: str | None
    updated_at: str


# --------------------------------------------------------------------------- #
# Content library
# --------------------------------------------------------------------------- #

class ContentCreate(BaseModel):
    """Payload for creating a library entry. Everything except topic is optional."""
    topic: str = Field(default="Untitled", max_length=500)
    assigned_to: str = ""
    notes: str = ""
    performance: Performance | None = None
    status: Status = Status.IDEA
    type: ContentType | None = None
    upload_date: date | None = None
    deadline: date | None = None
    script: str = ""

    @field_validator("upload_date", "deadline", mode="before")
    @classmethod
    def _empty_string_is_null(cls, v):
        return None if v == "" else v

    @field_validator("performance", "type", mode="before")
    @classmethod
    def _blank_select_is_null(cls, v):
        """Treat "" from an unselected <select> as "no value"."""
        return None if v == "" else v

    @field_validator("topic")
    @classmethod
    def _topic_not_blank(cls, v: str) -> str:
        return v.strip() or "Untitled"


class ContentUpdate(BaseModel):
    """
    Partial update. Every field is optional so the UI can PATCH a single cell
    after an inline edit without resending the whole record.

    Note the distinction the router relies on: a field absent from the request
    is left untouched, whereas a field explicitly set to null is cleared.
    """
    topic: str | None = Field(default=None, max_length=500)
    assigned_to: str | None = None
    notes: str | None = None
    performance: Performance | None = None
    status: Status | None = None
    type: ContentType | None = None
    upload_date: date | None = None
    deadline: date | None = None
    script: str | None = None
    board_order: float | None = None
    done: bool | None = None

    @field_validator("upload_date", "deadline", mode="before")
    @classmethod
    def _empty_string_is_null(cls, v):
        return None if v == "" else v

    @field_validator("performance", "type", mode="before")
    @classmethod
    def _blank_select_is_null(cls, v):
        return None if v == "" else v

    @field_validator("topic")
    @classmethod
    def _topic_not_blank(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return v.strip() or "Untitled"


# --------------------------------------------------------------------------- #
# Money ledger
# --------------------------------------------------------------------------- #

class MoneyCreate(BaseModel):
    """Payload for one ledger entry. Amount is always positive — the
    direction decides the sign."""
    entry: str = Field(default="", max_length=500)
    amount: float = Field(default=0, ge=0)
    date: date | None = None
    direction: Direction = Direction.EXPENSE
    party: str = Field(default="", max_length=200)

    @field_validator("date", mode="before")
    @classmethod
    def _empty_string_is_null(cls, v):
        return None if v == "" else v


class MoneyUpdate(BaseModel):
    """Partial update; same absent-vs-null semantics as ContentUpdate."""
    entry: str | None = Field(default=None, max_length=500)
    amount: float | None = Field(default=None, ge=0)
    date: date | None = None
    direction: Direction | None = None
    party: str | None = Field(default=None, max_length=200)

    @field_validator("date", mode="before")
    @classmethod
    def _empty_string_is_null(cls, v):
        return None if v == "" else v


class MoneyEntry(BaseModel):
    """A ledger row as returned to the client. `signed` is the amount with
    its direction applied, so the client can sum without re-deriving it."""
    id: int
    entry: str
    amount: float
    date: str | None
    direction: Direction
    party: str
    signed: float
    created_at: str
    updated_at: str


class MoneyGoal(BaseModel):
    """The savings goal the ledger's net total is tracked against."""
    goal: float = Field(gt=0)


class MediaFile(BaseModel):
    """An uploaded video file attached to a content entry."""
    id: int
    content_id: int
    kind: MediaKind
    original_name: str
    size_bytes: int
    mime_type: str | None
    duration_seconds: float | None
    uploaded_at: str
    # Convenience URL the frontend drops straight into a <video src>.
    stream_url: str


class Content(BaseModel):
    """A library entry. `raw` and `final` are populated on the detail endpoint."""
    id: int
    topic: str
    assigned_to: str
    notes: str
    performance: Performance | None
    status: Status
    type: ContentType | None
    upload_date: str | None
    deadline: str | None = None
    done: bool = False
    done_at: str | None = None
    script: str
    board_order: float
    created_at: str
    updated_at: str
    # Counts are always present so list views can show a paperclip badge
    # without fetching every media row.
    raw_count: int = 0
    final_count: int = 0
    # Full media lists, only populated by GET /api/content/{id}.
    raw: list[MediaFile] = []
    final: list[MediaFile] = []
