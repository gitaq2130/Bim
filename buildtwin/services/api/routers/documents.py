"""문서관리대장 라우터(ADR 0007). 도메인 로직 없음 — usecases/services 호출과 직렬화만(CLAUDE.md §3 규칙 11).

대장 자체의 업로드는 routers/files.py(cm 만, ADR 0007 §7 규칙 1) — 이 라우터는 업로드된 결과(문서 조회)와
문서↔Activity 매핑(제안 생성·확정)만 다룬다.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from packages.core.models.document import ActivityDocumentMapping, DocumentApprovalStatus, DocumentType
from packages.core.models.orm import DocumentRow

from .. import usecases
from ..deps import CurrentUser, ProjectContext, get_current_user, get_session, project_role, require_project_role
from ..schemas.documents import ConfirmDocumentMappingRequest, DocumentDetail, DocumentList

router = APIRouter(tags=["documents"])


@router.get("/projects/{project_id}/documents", response_model=DocumentList)
def list_documents(project_id: str, doc_type: DocumentType | None = None,
                   approval_status: DocumentApprovalStatus | None = None, include_orphaned: bool = False,
                   page: int = Query(1, ge=1), page_size: int = Query(200, ge=1, le=2000, alias="page_size"),
                   size: int | None = Query(None, ge=1, le=2000), session: Session = Depends(get_session),
                   _: ProjectContext = Depends(require_project_role())) -> DocumentList:
    """목록(그 프로젝트 멤버 누구나 + admin 조회). 필터: 종류·승인 상태·고아 여부(objects 목록과 같은 관례 —
    기본은 고아 문서를 숨기고, `include_orphaned=true` 로 함께 본다)."""
    limit = size or page_size
    stmt = select(DocumentRow).where(DocumentRow.project_id == project_id)
    if not include_orphaned:
        stmt = stmt.where(DocumentRow.is_orphaned.is_(False))
    if doc_type:
        stmt = stmt.where(DocumentRow.doc_type == doc_type.value)
    if approval_status:
        stmt = stmt.where(DocumentRow.approval_status == approval_status.value)
    total = int(session.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = list(session.scalars(stmt.order_by(DocumentRow.doc_type, DocumentRow.doc_number, DocumentRow.doc_id)
                                .offset((page - 1) * limit).limit(limit)))
    return DocumentList(items=[usecases.document_view(r) for r in rows], total=total, page=page, page_size=limit)


@router.get("/documents/{doc_id}", response_model=DocumentDetail)
def get_document(doc_id: str, project_id: str = Query(...), session: Session = Depends(get_session),
                 user: CurrentUser = Depends(get_current_user)) -> DocumentDetail:
    """상세 = 문서 + 그 문서에 걸린 Activity 매핑(화면이 한 번의 호출로 그린다 — 객체 상세와 같은 관례).

    surrogate id 라우트지만(ADR 0006 규칙 6) `doc_id` 단독으로는 행을 찾을 수 없다 — PK 가
    `(project_id, doc_id)` 복합키이고 doc_id 산출식에 project_id 가 들어가지 않아(ADR 0007 §2-1) 서로 다른
    프로젝트가 같은 doc_id 를 가질 수 있다("doc_id 단독 조회 금지", §2-3). 그래서 `project_id` 를 쿼리로
    **필수**로 받고, 그 프로젝트 멤버십부터 검사한다(비멤버는 404 `project_not_found` — 문서 존재 여부와
    무관하게 같은 응답, ADR 0006 규칙 2) — 그 다음에만 `(project_id, doc_id)` 로 문서를 읽는다
    (없으면 404 `document_not_found`)."""
    project_role(session, project_id, user)
    return usecases.document_detail(session, project_id, doc_id)


@router.post("/projects/{project_id}/documents/mappings", response_model=list[ActivityDocumentMapping])
def generate_document_mappings(project_id: str, session: Session = Depends(get_session),
                               _: ProjectContext = Depends(require_project_role("cm"))) -> list[ActivityDocumentMapping]:
    """문서↔Activity 매핑 후보를 (재)생성한다(cm 만 — ADR 0007 §7 규칙 2: 확정도 cm 만이므로 제안 권한을
    넓혀도 얻는 것이 없고 검토 큐만 오염된다). 결과는 항상 needs_review=True(ADR §4 규칙 5) — 확정은
    `POST /documents/mappings/{activity_id}/{doc_id}/confirm`."""
    return usecases.generate_document_mappings(session, project_id)


@router.post("/documents/mappings/{activity_id}/{doc_id}/confirm", response_model=ActivityDocumentMapping)
def confirm_document_mapping(activity_id: str, doc_id: str, body: ConfirmDocumentMappingRequest | None = None,
                             session: Session = Depends(get_session),
                             user: CurrentUser = Depends(get_current_user)) -> ActivityDocumentMapping:
    """매핑 확정(needs_review=False, reviewed_by 기록 — cm 만, ADR 0007 §4 규칙 5·§7). surrogate id 라우트
    (ADR 0006 규칙 6): 매핑 행을 먼저 읽어 그 project_id 로 인가한다(usecases.confirm_document_mapping)."""
    return usecases.confirm_document_mapping(session, activity_id, doc_id, user, body.note if body else None)
