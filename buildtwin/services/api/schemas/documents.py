"""문서관리대장 응답 스키마(ADR 0007). 코어 모델(`Document`/`ActivityDocumentMapping`)을 그대로 재사용하고,
여기서는 화면이 한 번에 그릴 수 있게 조립한 뷰(목록 페이지네이션, 상세 + 걸린 매핑)만 추가한다."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from packages.core.models.document import ActivityDocumentMapping, Document


class DocumentView(Document):
    """`Document` + `imported_at`(대장 마지막 적재 시각 — ADR 0007 Consequences: "언제 기준 데이터인가"를
    화면에 노출한다) + `identity_fingerprint`. 둘 다 **적재 단위** 값이라 행 단위 코어 모델(`Document`)에는
    없고 `DocumentRow` 에만 있다 — 같은 방식으로 여기서만 얹는다.

    `identity_fingerprint`(ADR 0009 §5-2)는 이 행을 쓴 적재가 사용한 식별 표면 지문이다. 한 프로젝트의
    문서에 서로 다른 지문이 섞여 있으면 그 사이에 `doc_id` 재료 config(`sender_aliases`·`sheet_doc_types`·
    `column_aliases`)가 바뀐 것이므로, 드리프트 검토요청의 `previous_fingerprint`/`current_fingerprint` 를
    화면에서 실제 문서와 맞춰 볼 수 있다. ADR 0009 이전에 쓰인 행에는 없다(`None`).

    `title_identity` 는 코어 `Document` 에 있어 상속으로 이미 실린다(여기서 다시 선언하지 않는다)."""
    imported_at: datetime | None = None
    identity_fingerprint: str | None = None


class DocumentList(BaseModel):
    items: list[DocumentView]
    total: int
    page: int
    page_size: int


class DocumentDetail(BaseModel):
    """문서 상세 = 문서 한 건 + 그 문서에 걸린 Activity 매핑 전부(ADR 0007 §4). 객체 상세가 linked.activity_ids
    를 함께 주는 것과 같은 이유 — 화면이 한 번의 호출로 그린다."""
    document: DocumentView
    mappings: list[ActivityDocumentMapping] = Field(default_factory=list)


class ConfirmDocumentMappingRequest(BaseModel):
    note: str | None = None


class CancelDocumentMappingReviewRequest(BaseModel):
    """매핑 결정 취소의 사유(ADR 0013 규칙 4 — 비어 있지 않아야 한다).

    **타입을 `str | None` 으로 두고 본문 자체도 선택으로 받는다.** 필수 `str` 로 좁히면 사유 누락이 422
    (요청 스키마 위반)로 나가는데, 이것은 스키마가 아니라 **대상의 현재 상태에 대한 요건**이라 409
    `cancel_reason_required` 여야 한다(ADR 0013 규칙 6, `revocation_reason_required`·
    `rejection_reason_required` 와 같은 판단). 판정은 `packages/core/models/review.py::
    rejection_reason_missing` 하나가 하고 여기서 복제하지 않는다 — 공백만인 사유(`"   "`)도 같은 409 다."""

    note: str | None = None
