from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from packages.core.models.evidence import Evidence
from packages.core.models.progress import Blocker, StartableSet
from packages.core.models.state import ObjectState


class ActivityView(BaseModel):
    activity_id: str
    schedule_id: str
    project_id: str
    name: str
    wbs_code: str | None = None
    discipline: str | None = None
    level: str | None = None
    zone: str | None = None
    planned_start: str | None = None
    planned_finish: str | None = None
    duration_days: float | None = None
    resources: dict[str, float] = Field(default_factory=dict)
    percent_complete: float = 0.0
    source_ref: str | None = None
    mapped_global_ids: list[str] = Field(default_factory=list)
    predecessor_ids: list[str] = Field(default_factory=list)


class StateDistributionRow(BaseModel):
    level: str
    discipline: str
    counts: dict[ObjectState, int]
    total: int


class StartableActivityView(BaseModel):
    activity_id: str
    name: str | None = None
    readiness: float | None = None
    confidence: float | None = None
    evidence: Evidence | None = None
    blockers: list[Blocker] = Field(default_factory=list)


class WeeklySummary(BaseModel):
    project_id: str
    week_start: str
    week_end: str
    state_distribution: list[StateDistributionRow]
    confirmed_this_week: int
    open_reviews: int
    open_reviews_by_kind: dict[str, int]
    startable: list[StartableActivityView]
    # ---- 추가 집계(작업 명세) ----
    state_counts_by_level: dict[str, dict[str, int]]
    state_counts_by_group: dict[str, dict[str, int]]
    open_review_requests: int
    estimated_done_count: int
    object_total: int
    startable_set: StartableSet
    extra: dict[str, Any] = Field(default_factory=dict)
