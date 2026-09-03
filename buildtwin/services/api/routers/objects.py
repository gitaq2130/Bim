from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from packages.core.models.orm import BimObjectRow
from packages.core.models.state import ObjectState
from services.progress import persistence as db

from .. import usecases
from ..deps import CurrentUser, ProjectContext, get_current_user, get_session, require_project_role
from ..schemas.objects import ObjectDetail, ObjectList, TransitionRequest, TransitionResponse

router = APIRouter(tags=["objects"])


@router.get("/projects/{project_id}/objects", response_model=ObjectList)
def list_objects(project_id: str, level: str | None = None, ifc_type: str | None = None, state: ObjectState | None = None,
                 page: int = Query(1, ge=1), page_size: int = Query(200, ge=1, le=2000, alias="page_size"),
                 size: int | None = Query(None, ge=1, le=2000), include_orphaned: bool = False,
                 session: Session = Depends(get_session), _: ProjectContext = Depends(require_project_role())) -> ObjectList:
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
    ADR 0005 §3: global_id 가 여러 프로젝트에 걸쳐 있으면 409 — `?project_id=` 로 직접 지정해 해소한다.
    ADR 0006 규칙 5: 후보는 호출자가 멤버인 프로젝트로 한정한다(usecases.resolve_object)."""
    return usecases.object_detail(session, global_id, user, project_id=project_id)


@router.post("/objects/{global_id}/transitions", response_model=TransitionResponse, status_code=201)
def request_transition(global_id: str, body: TransitionRequest, project_id: str | None = Query(None),
                       session: Session = Depends(get_session), user: CurrentUser = Depends(get_current_user)) -> TransitionResponse:
    """상태 전이 요청. actor·CONFIRMED 자격은 **프로젝트 역할**에서 나온다(ADR 0006 규칙 7) — 이 라우트는
    `project_id`가 경로에 없어(대상은 `global_id`로만 정해짐) 어느 프로젝트인지 먼저 알아야 역할을 알 수
    있으므로, 역할 검사는 `usecases.transition_object`가 대상을 resolve 한 뒤 수행한다(contractor/cm 만,
    admin·client 403, ADR 0001 §4-1). 응답에 생성/종료된 검측 ReviewRequest id 포함.
    ADR 0005 §3: global_id 가 여러 프로젝트에 걸쳐 있으면 409 — `?project_id=` 로 직접 지정해 해소한다."""
    return usecases.transition_object(session, global_id, body, user, project_id=project_id)
