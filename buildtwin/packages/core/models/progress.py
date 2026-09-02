"""공정·Readiness·작업일보 모델."""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

from .evidence import Evidence

RelationType = Literal["FS", "SS", "FF", "SF"]


class ActivityRelation(BaseModel):
    predecessor_id: str
    successor_id: str
    type: RelationType = "FS"
    lag_days: float = 0.0


class Activity(BaseModel):
    activity_id: str
    name: str
    wbs_code: str | None = None
    discipline: str | None = None        # 공종 (structure, architecture, mechanical, electrical ...)
    level: str | None = None
    zone: str | None = None
    planned_start: date | None = None
    planned_finish: date | None = None
    duration_days: float | None = None
    resources: dict[str, float] = Field(default_factory=dict)   # {"crew": 4, "crane": 1}
    percent_complete: float = 0.0
    source_ref: str | None = None


class Schedule(BaseModel):
    schedule_id: str
    project_id: str
    activities: list[Activity]
    relations: list[ActivityRelation]
    source_format: Literal["csv", "msproject_xml", "p6_xer"]
    warnings: list[str] = Field(default_factory=list)


class Blocker(BaseModel):
    component: str
    reason: str
    related_ids: list[str] = Field(default_factory=list)
    severity: Literal["low", "medium", "high"] = "medium"


class ReadinessScore(BaseModel):
    activity_id: str
    score: float = Field(ge=0.0, le=1.0)
    components: dict[str, float]
    weights: dict[str, float]
    blockers: list[Blocker]
    confidence: float = Field(ge=0.0, le=1.0)
    evidence: Evidence
    estimated_completion: float | None = None   # ESTIMATED_DONE 포함 선행 완료율(참고용)
    computed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StartableSet(BaseModel):
    project_id: str
    startable: list[str]
    blocked: dict[str, list[Blocker]]
    threshold: float
    solver_status: str
    evidence: Evidence


class DailyReportItem(BaseModel):
    global_id: str | None = None
    activity_id: str | None = None
    zone: str | None = None
    level: str | None = None
    work_type: str | None = None
    quantity: float | None = None
    quantity_unit: str | None = None
    claimed_state: Literal["started", "in_progress", "completed"]
    photo_uris: list[str] = Field(default_factory=list)


class DailyReport(BaseModel):
    report_id: str
    project_id: str
    report_date: date
    reporter_id: str
    crew_count: int = 0
    equipment: dict[str, int] = Field(default_factory=dict)
    items: list[DailyReportItem]
    note: str | None = None
    submitted_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class MaterialMovement(BaseModel):
    material_id: str
    global_id: str | None = None
    activity_id: str | None = None
    kind: Literal["in", "out"]
    quantity: float
    unit: str
    occurred_at: datetime
