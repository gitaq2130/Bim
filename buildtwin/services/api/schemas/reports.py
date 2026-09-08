from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field

from packages.core.models.progress import DailyReportItem
from packages.core.models.review import ReviewRequest
from packages.core.models.state import StateTransition


class DailyReportCreate(BaseModel):
    report_date: date
    crew_count: int = 0
    equipment: dict[str, int] = Field(default_factory=dict)
    items: list[DailyReportItem] = Field(min_length=1)
    note: str | None = None


class DailyReportView(BaseModel):
    report_id: str
    project_id: str
    report_date: str
    reporter_id: str
    crew_count: int = 0
    equipment: dict[str, int] = Field(default_factory=dict)
    items: list[dict[str, Any]] = Field(default_factory=list)
    note: str | None = None
    submitted_at: datetime | None = None


class DailyReportResponse(DailyReportView):
    """저장된 작업일보 + 상태기계 적용 결과(3중 검증 포함)."""
    transitions: list[StateTransition] = Field(default_factory=list)
    review_requests: list[ReviewRequest] = Field(default_factory=list)
    inspection_review_ids: list[str] = Field(default_factory=list)   # 자동 생성된 검측 검토요청 id
    skipped: list[dict[str, Any]] = Field(default_factory=list)
