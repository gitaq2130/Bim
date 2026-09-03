"""문서관리대장 응답 스키마(ADR 0007). 코어 모델(`Document`/`ActivityDocumentMapping`)을 그대로 재사용하고,
여기서는 화면이 한 번에 그릴 수 있게 조립한 뷰(목록 페이지네이션, 상세 + 걸린 매핑)만 추가한다."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from packages.core.models.document import ActivityDocumentMapping, Document


class DocumentView(Document):
    """`Document` + `imported_at`(대장 마지막 적재 시각 — ADR 0007 Consequences: "언제 기준 데이터인가"를
    화면에 노출한다). ORM 전용 필드라 코어 `Document` 모델에는 없다."""
    imported_at: datetime | None = None


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
