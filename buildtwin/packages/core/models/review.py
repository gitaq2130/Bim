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
# column_aliases 등 ADR 0009 §5-1 의 식별 표면, 그리고 워크북 시트명처럼 config 밖 입력)이 바뀌어
# 문서의 정체성이 흔들렸고, 그 결과 CM 이 이미 확정·반려한 판단이 오염된 사건을 알리는
# **확인(acknowledgement) 전용** 요청이다.
#
# 오염 경위는 셋이고(`conflicting_sources.lost_decisions[].cause`, ADR 0009 §5-2 (마)) 사람이 해야 할
# 일이 서로 다르다:
#   `row_moved`      — 대장 행은 그대로인데 우리 식별 규칙이 그 행을 **다른 doc_id 로 옮겼다**.
#                      `new_doc_id` 위에서 같은 판단을 다시 내린다. **고아라고 적지 않는다**: 옛 행이
#                      고아가 되는지는 이 경위가 답하지 않는다(시트명 변경 경로는 안 된다 — 실측
#                      `moved=8` 인데 `is_orphaned=False`).
#   `row_replaced`   — **행도 reviewed_by 도 살아 있고 고아 표시조차 없는데** 그 doc_id 가 담고 있던
#                      **대장 행**이 바뀌었다. 승인 상태가 뒤집힐 수 있고 다시 판단할 새 doc_id 가
#                      **없다**(`new_doc_id=null` — "모른다"가 아니라 그 사실이다). 가장 위험한 경위.
#   `row_absorbed`   — 판단이 가리키던 대장 행이 **다른 doc_id 아래로 갔다**. `new_doc_id` 위에서 다시 판단.
# 한 doc_id 는 한 경위에만 속하지만 **한 적재는 여러 경위를 만든다**(ADR 0009 §5-2 (마)).
#
# **"고아가 된 매핑"으로만 서술하면 나머지 두 경위가 서술 밖으로 나간다** — 초판이 그렇게 적었고,
# 그 좁은 서술이 그대로 구현돼 그 경로가 CM 큐에 닿지 못했다(ADR 0009 §5-4).
# 경위 **이름**도 마찬가지다: 개정 2 이전 이름 셋(`orphaned`/`merge_overwritten`/`merge_absorbed`)은
# 관측과 어긋나 있었고(고아가 아닌 경로를 고아라 하고, `merged=0` 인 주 경로를 병합이라 했다),
# 이름이 거짓이면 그 이름으로 갈린 문구·라벨도 함께 거짓이 된다(ADR 0009 §5-2 (마) 개명 표·§5-5).
# 이 주석은 그 `cause` 문자열 정본이 적힌 **네 자리 중 하나**다(ADR 0009 §Deferred 5) — 값을 늘리거나
# 바꾸는 변경은 여기까지 함께 고쳐야 한다. 실제로 개정 2 의 개명이 코드 세 자리만 고치고 이 주석을
# 한 개정 동안 옛 이름에 남겨 두었다(주석은 어떤 테스트도 실패시키지 않는다).
#
# 해소에 부수 효과가 없다 — `services/api/usecases.resolve_review` 의 공통 폴백이 status/note 만 기록한다
# (document_mapping 처럼 매핑 행을 건드리는 분기를 추가하지 않는다). 사람이 "봤다"고 닫는 것이 목적이고,
# 무엇을 할지(식별 표면 config 되돌리기 / 대장 파일 쪽 입력 확인 / 스킴 마이그레이션)는 요청 본문이
# 안내한다 — 어느 쪽인지는 지문이 답한다(ADR 0009 §5-2 서두: 지문은 판정 조건이 아니라 그 하나를
# 답하는 보고 값이다).
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
