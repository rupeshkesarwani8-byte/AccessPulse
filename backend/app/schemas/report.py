from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


BarrierType = Literal[
    "missing_ramp",
    "blocked_path",
    "stairs",
    "broken_sidewalk",
    "inaccessible_crossing",
    "other",
]

ReportStatus = Literal["pending", "verified", "rejected", "resolved"]


def _as_utc(value: datetime) -> datetime:
    # SQLite returns naive datetimes. Our values are always UTC.
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


class ReportCreate(BaseModel):
    name: str = Field(min_length=3, max_length=160)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    type: BarrierType
    description: str = Field(min_length=10, max_length=3000)
    source: str = Field(default="Community report", min_length=2, max_length=80)

    # mode="before" runs BEFORE the length checks, so limits apply to stripped text.
    @field_validator("name", "description", "source", mode="before")
    @classmethod
    def strip_text(cls, value):
        return value.strip() if isinstance(value, str) else value


class ReportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    latitude: float
    longitude: float
    type: str
    description: str
    source: str
    status: ReportStatus
    created_at: datetime
    photo_url: str | None = None

    @field_validator("created_at", mode="after")
    @classmethod
    def ensure_utc(cls, value: datetime) -> datetime:
        return _as_utc(value)


class StatusUpdate(BaseModel):
    # "verified" is allowed again so an admin can reopen a resolved report.
    status: Literal["verified", "rejected", "resolved"]


class StatusHistoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    report_id: int
    from_status: str
    to_status: str
    changed_by: str
    changed_at: datetime

    @field_validator("changed_at", mode="after")
    @classmethod
    def ensure_utc(cls, value: datetime) -> datetime:
        return _as_utc(value)


class PriorityBreakdown(BaseModel):
    severity: float
    nearby: float
    review: float
    waiting: float


class PriorityItem(BaseModel):
    id: int
    name: str
    type: str
    status: str
    latitude: float
    longitude: float
    photo_url: str | None = None
    nearby_count: int
    days_waiting: float
    score: float
    breakdown: PriorityBreakdown
