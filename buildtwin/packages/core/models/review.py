"""검토요청 — 자동 확정을 막고 CM 확인을 요구한다."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from .evidence import Evidence

# document_mapping: 미확정 문서 매핑(ADR 0007 §4 규칙 5). 기존 mapping 을 재사용하지 않는 이유는
# services/sync 의 해소 로직이 drawing_id/entity_handle 을 기대하기 때문이다 — 해소는 services/progress 가 소유.
ReviewKind = Literal["mapping", "verification", "inspection", "document_mapping"]
ReviewStatus = Literal["open", "approved", "rejected", "on_hold"]


class ReviewRequest(BaseModel):
    review_request_id: UUID = Field(default_factory=uuid4)
    project_id: str
    kind: ReviewKind
    global_id: str | None = None
    activity_id: str | None = None
    rule_id: str | None = None
    title: str
    conflicting_sources: dict[str, Any] = Field(default_factory=dict)   # {"daily_report": ..., "scan": ..., "system_logic": ...}
    confidence: float = Field(ge=0.0, le=1.0)
    evidence: Evidence
    assignee_role: Literal["cm"] = "cm"   # ADR 0001 §4-1: 검토요청 처리는 cm만
    status: ReviewStatus = "open"
    resolution_note: str | None = None
    resolved_by: str | None = None
    resolved_at: datetime | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
