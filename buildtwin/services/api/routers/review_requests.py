from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from packages.core.models.orm import ReviewRequestRow
from packages.core.models.review import ReviewKind, ReviewRequest, ReviewStatus
from services.progress import persistence as db

from .. import usecases
from ..deps import CurrentUser, get_session, require_role
from ..errors import NotFound
from ..schemas.reviews import ResolveRequest
from .projects import get_project_or_404

router = APIRouter(tags=["review-requests"])


@router.get("/projects/{project_id}/review-requests", response_model=list[ReviewRequest])
def list_review_requests(project_id: str, kind: ReviewKind | None = None, status: ReviewStatus | None = None,
                         global_id: str | None = None, session: Session = Depends(get_session),
                         _: CurrentUser = Depends(require_role("cm", "admin"))) -> list[ReviewRequest]:
    get_project_or_404(session, project_id)
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
                       _: CurrentUser = Depends(require_role("cm", "admin"))) -> ReviewRequest:
    row = session.get(ReviewRequestRow, review_request_id)
    if row is None:
        raise NotFound(f"review request not found: {review_request_id}")
    return db.review_row_to_model(row)


@router.post("/review-requests/{review_request_id}/resolve", response_model=ReviewRequest)
def resolve_review_request(review_request_id: str, body: ResolveRequest, session: Session = Depends(get_session),
                           user: CurrentUser = Depends(require_role("cm", "admin"))) -> ReviewRequest:
    """승인/반려/보류. ExpertReviewLog(proposal=처리 전, final=처리 후) 기록. inspection 승인 → CM CONFIRMED 전이,
    mapping 승인 → 매핑 확정, verification 승인 → 차단 해제만."""
    row = usecases.resolve_review(session, review_request_id, body.resolved_decision, body.note, user)
    return db.review_row_to_model(row)
