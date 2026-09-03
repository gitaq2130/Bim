"""문서관리대장 모델 (ADR 0007). 대장은 현장의 정본이고 BuildTwin은 읽기만 한다.

핵심 두 가지:
- 승인 상태(`DocumentApprovalStatus`)는 `ObjectState`와 **무관**하며 어떤 상태 전이도 일으키지 않는다(§3-1).
  공란·해석 불가는 `UNKNOWN`이고 절대 승인으로 추측하지 않는다.
- 문서 ↔ Activity 매핑은 confidence 값과 무관하게 **항상** 사람 확인을 요구한다(§4 규칙 5).
"""
from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field, model_validator

from .evidence import Evidence
from .state import ObjectState


class DocumentType(str, Enum):
    """시트명 → 종류 표는 config/document_register.yaml. 알 수 없는 시트는 OTHER."""

    TFA = "TFA"          # 승인/검토/참조 요청서 — 시공상세도 승인. readiness 의 필수 문서 기본값
    TFR = "TFR"          # 자료제출서
    FI = "FI"            # 현장지시
    SCAR = "SCAR"        # 시정조치요구
    NCR = "NCR"          # 부적합보고
    DN = "DN"            # 통보
    VE = "VE"            # 설계변경/가치공학
    RFI = "RFI"          # 질의회신
    OTHER = "other"


class DocumentApprovalStatus(str, Enum):
    """대장 `처리결과` 원문(`result_raw`)을 정규화한 값. 원문은 지우지 않고 따로 보관한다."""

    APPROVED = "APPROVED"
    APPROVED_WITH_COMMENTS = "APPROVED_WITH_COMMENTS"   # 기본적으로 승인으로 보지 않는다(§3-3)
    REJECTED = "REJECTED"
    RESUBMIT_REQUIRED = "RESUBMIT_REQUIRED"
    IN_REVIEW = "IN_REVIEW"
    UNKNOWN = "UNKNOWN"                                  # 공란·해석 불가. 승인으로 추측하지 않는다


# ADR 0007 §3-1: 승인 상태는 객체 상태와 다른 축이다. 값이 겹치면 둘을 혼동한 코드가
# 조용히 통과하므로(예: approval_status 를 상태 전이에 넘기는 실수) 교집합을 금지한다.
assert not ({s.value for s in DocumentApprovalStatus} & {s.value for s in ObjectState})


class Document(BaseModel):
    """대장 한 행. `(project_id, doc_id)`로 식별하며 doc_id 단독 조회는 금지(§2-3)."""

    project_id: str
    doc_id: str
    doc_type: DocumentType
    sender: str
    sender_normalized: str
    discipline_raw: str | None = None        # 신뢰 불가 필드(§4 규칙 2). 단독 매핑 근거가 될 수 없다
    discipline_normalized: str | None = None
    seq_raw: str | None = None
    seq_normalized: str | None = None
    doc_number: str | None = None            # 표시·검색 전용. 되파싱하지 않는다(§2-4)
    title: str
    title_normalized: str
    issued_on: str | None = None
    result_raw: str | None = None            # 처리결과 원문 그대로. 해석해 덮어쓰지 않는다
    approval_status: DocumentApprovalStatus = DocumentApprovalStatus.UNKNOWN
    approval_confidence: float = Field(ge=0.0, le=1.0)
    approval_evidence: Evidence
    completed_on: str | None = None
    file_id: str
    sheet_name: str
    source_row: int = Field(ge=1)            # 대장 원본 기준 1-based 행 번호
    needs_review: bool = False               # 처리결과를 해석하지 못했을 때 True(§3 규칙 3)
    is_orphaned: bool = False                # 최근 업로드에 없던 문서. 삭제하지 않고 표시만(§2-2)


class ActivityDocumentMapping(BaseModel):
    """문서 ↔ Activity 매핑. 문서 ↔ 객체 직접 매핑은 만들지 않는다(§4-1 규칙 1)."""

    activity_id: str
    doc_id: str
    confidence: float = Field(ge=0.0, le=1.0)
    evidence: Evidence
    needs_review: bool = True
    reviewed_by: str | None = None

    @model_validator(mode="after")
    def _always_needs_review(self) -> ActivityDocumentMapping:
        """confidence 와 무관하게 항상 사람 확인을 요구한다(§4 규칙 5).

        `MAPPING_REVIEW_THRESHOLD`(0.7)를 쓰지 않는다 — 유사도 0.99여도 ZONE·차수 토큰 하나만 다른
        별개 문서일 수 있고(§4 규칙 3), 틀린 매핑은 착수 가능 판단을 오염시킨다. ADR 0001의
        "스캔 AI는 ESTIMATED_DONE 까지, CONFIRMED 는 cm 만"과 같은 구조다.
        """
        self.needs_review = self.reviewed_by is None
        return self
