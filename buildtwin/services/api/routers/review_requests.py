from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from packages.core.models.orm import ReviewRequestRow
from packages.core.models.review import ReviewKind, ReviewRequest, ReviewStatus
from services.progress import persistence as db

from .. import usecases
from ..deps import CurrentUser, ProjectContext, get_current_user, get_session, project_role, require_project_role
from ..errors import NotFound
from ..schemas.reviews import ResolveRequest

router = APIRouter(tags=["review-requests"])


@router.get("/projects/{project_id}/review-requests", response_model=list[ReviewRequest])
def list_review_requests(project_id: str, kind: ReviewKind | None = None, status: ReviewStatus | None = None,
                         global_id: str | None = None, session: Session = Depends(get_session),
                         _: ProjectContext = Depends(require_project_role("cm", read=True))) -> list[ReviewRequest]:
    """검토요청 열람은 그 프로젝트의 cm(+ admin, 조회 목적)만 — contractor/client 는 403(ADR 0001 §4-1 유지)."""
    stmt = select(ReviewRequestRow).where(ReviewRequestRow.project_id == project_id)
    if kind:
        stmt = stmt.where(ReviewRequestRow.kind == kind)
    if status:
        stmt = stmt.where(ReviewRequestRow.status == status)
    if global_id:
        stmt = stmt.where(ReviewRequestRow.global_id == global_id)
    return [db.review_row_to_model(r) for r in session.scalars(stmt.order_by(ReviewRequestRow.created_at.desc()))]


@router.get("/review-requests/{review_request_id}", response_model=ReviewRequest)
def get_review_request(review_request_id: str, session: Session = Depends(get_session),
                       user: CurrentUser = Depends(get_current_user)) -> ReviewRequest:
    """surrogate id 라우트(ADR 0006 규칙 6): 대상 행을 먼저 읽고 그 project_id 로 cm(+admin) 만 통과시킨다."""
    row = session.get(ReviewRequestRow, review_request_id)
    if row is None:
        raise NotFound(f"review request not found: {review_request_id}", code="review_request_not_found")
    project_role(session, row.project_id, user, "cm", read=True)
    return db.review_row_to_model(row)


@router.post("/review-requests/{review_request_id}/resolve", response_model=ReviewRequest)
def resolve_review_request(review_request_id: str, body: ResolveRequest, session: Session = Depends(get_session),
                           user: CurrentUser = Depends(get_current_user)) -> ReviewRequest:
    """승인/반려/보류(그 검토요청 프로젝트의 cm 만 — ADR 0001 §4-1, ADR 0006 규칙 6·7: 대상 행의 project_id 로
    검사하므로 `usecases.resolve_review` 안에서 역할을 확인한다). ExpertReviewLog(proposal=처리 전, final=처리 후) 기록.
    inspection 승인 → 상태기계 CONFIRMED 전이(요청 종료 포함), mapping → sync.resolve_mapping_reviews(+승인 시 매핑 확정),
    verification 승인 → 차단 해제만."""
    row = usecases.resolve_review(session, review_request_id, body.resolved_decision, body.note, user)
    return db.review_row_to_model(row)
