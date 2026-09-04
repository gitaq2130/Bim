"""검토요청 — 자동 확정을 막고 CM 확인을 요구한다."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from .evidence import Evidence

# document_mapping: 미확정 문서 매핑(ADR 0007 §4 규칙 5). 기존 mapping 을 재사용하지 않는 이유는
# services/sync 의 해소 로직이 drawing_id/entity_handle 을 기대하기 때문이다 — 해소는 services/progress 가 소유.
#
# document_identity_drift: 대장 원문은 그대로인데 우리 쪽 식별 규칙(sender_aliases·sheet_doc_types·
# column_aliases 등 ADR 0009 §5-1 의 식별 표면)이 바뀌어 `doc_id` 가 이동했고, 그 결과 CM 이 이미
# 확정·반려한 매핑이 고아 문서를 가리키게 된 사건을 알리는 **확인(acknowledgement) 전용** 요청이다.
# 해소에 부수 효과가 없다 — `services/api/usecases.resolve_review` 의 공통 폴백이 status/note 만 기록한다
# (document_mapping 처럼 매핑 행을 건드리는 분기를 추가하지 않는다). 사람이 "봤다"고 닫는 것이 목적이고,
# 무엇을 할지(config 되돌리기 / 스킴 마이그레이션)는 요청 본문이 안내한다.
ReviewKind = Literal["mapping", "verification", "inspection", "document_mapping", "document_identity_drift"]
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
