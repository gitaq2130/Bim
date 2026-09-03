from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from packages.core.models.orm import BimObjectRow
from packages.core.models.state import ObjectState
from services.progress import persistence as db

from .. import usecases
from ..deps import CurrentUser, get_current_user, get_session, require_role
from ..errors import Forbidden
from ..schemas.objects import ObjectDetail, ObjectList, TransitionRequest, TransitionResponse
from .projects import get_project_or_404

router = APIRouter(tags=["objects"])


@router.get("/projects/{project_id}/objects", response_model=ObjectList)
def list_objects(project_id: str, level: str | None = None, ifc_type: str | None = None, state: ObjectState | None = None,
                 page: int = Query(1, ge=1), page_size: int = Query(200, ge=1, le=2000, alias="page_size"),
                 size: int | None = Query(None, ge=1, le=2000), include_orphaned: bool = False,
                 session: Session = Depends(get_session), _: CurrentUser = Depends(get_current_user)) -> ObjectList:
    get_project_or_404(session, project_id)
    limit = size or page_size
    stmt = select(BimObjectRow).where(BimObjectRow.project_id == project_id)
    if not include_orphaned:
        stmt = stmt.where(BimObjectRow.is_orphaned.is_(False))
    if level:
        stmt = stmt.where(BimObjectRow.level == level)
    if ifc_type:
        stmt = stmt.where(BimObjectRow.ifc_type == ifc_type)
    if state:
        stmt = stmt.where(BimObjectRow.state == state.value)
    total = int(session.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = list(session.scalars(stmt.order_by(BimObjectRow.level, BimObjectRow.ifc_type, BimObjectRow.global_id)
                                .offset((page - 1) * limit).limit(limit)))
    open_ids = {r.global_id for r in db.open_reviews(session, project_id, [r.global_id for r in rows])} if rows else set()
    return ObjectList(items=[usecases.object_view(r, r.global_id in open_ids) for r in rows], total=total, page=page, page_size=limit)


@router.get("/objects/{global_id}", response_model=ObjectDetail)
def get_object(global_id: str, project_id: str | None = Query(None), session: Session = Depends(get_session),
               user: CurrentUser = Depends(get_current_user)) -> ObjectDetail:
    """한 번의 호출로 basic / current_state / history / next_actions / linked 를 모두 돌려준다.
    ADR 0005 §3: global_id 가 여러 프로젝트에 걸쳐 있으면 409 — `?project_id=` 로 직접 지정해 해소한다."""
    return usecases.object_detail(session, global_id, user.role, project_id=project_id)


@router.post("/objects/{global_id}/transitions", response_model=TransitionResponse, status_code=201)
def request_transition(global_id: str, body: TransitionRequest, project_id: str | None = Query(None),
                       session: Session = Depends(get_session),
                       user: CurrentUser = Depends(require_role("contractor", "cm"))) -> TransitionResponse:
    """상태 전이 요청(ADR 0001 §4-1: contractor/cm 만, admin·client 403). CONFIRMED 는 라우터(역할 cm)와
    상태기계(actor=cm) 이중 검사. 응답에 생성/종료된 검측 ReviewRequest id 포함.
    ADR 0005 §3: global_id 가 여러 프로젝트에 걸쳐 있으면 409 — `?project_id=` 로 직접 지정해 해소한다."""
    if body.to_state == ObjectState.CONFIRMED and user.role != usecases.CONFIRM_ROLE:
        raise Forbidden("CONFIRMED transition requires role cm", code="forbidden_role")
    return usecases.transition_object(session, global_id, body, user, project_id=project_id)
