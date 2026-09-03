from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from packages.core.models.progress import ReadinessScore, StartableSet
from services.progress import persistence as db
from services.progress.readiness import compute_readiness
from services.progress.scheduler import compute_startable

from .. import queries, usecases
from ..deps import CurrentUser, ProjectContext, get_current_user, get_session, project_role, require_project_role
from ..errors import NotFound
from ..schemas.activities import ActivityView, WeeklySummary

router = APIRouter(tags=["activities"])


@router.get("/projects/{project_id}/activities", response_model=list[ActivityView])
def list_activities(project_id: str, session: Session = Depends(get_session), _: ProjectContext = Depends(require_project_role())) -> list[ActivityView]:
    preds = queries.predecessor_map(session, project_id)
    out: list[ActivityView] = []
    for a in queries.project_activities(session, project_id):
        out.append(ActivityView(activity_id=a.activity_id, schedule_id=a.schedule_id, project_id=a.project_id, name=a.name,
                                wbs_code=a.wbs_code, discipline=a.discipline, level=a.level, zone=a.zone,
                                planned_start=a.planned_start, planned_finish=a.planned_finish, duration_days=a.duration_days,
                                resources=dict(a.resources or {}), percent_complete=a.percent_complete or 0.0,
                                source_ref=a.source_ref, mapped_global_ids=db.mapped_global_ids(session, project_id, a.activity_id),
                                predecessor_ids=preds.get(a.activity_id, [])))
    return out


@router.get("/activities/{activity_id}/readiness", response_model=ReadinessScore)
def activity_readiness(activity_id: str, session: Session = Depends(get_session), user: CurrentUser = Depends(get_current_user)) -> ReadinessScore:
    """surrogate id 라우트(ADR 0006 규칙 6, 리뷰어 관찰 항목): Activity 를 먼저 읽고 그 project_id 로 멤버십을 검사한다."""
    row = db.load_activity(session, activity_id)
    if row is None:
        raise NotFound(f"activity not found: {activity_id}", code="activity_not_found")
    project_role(session, row.project_id, user)
    return compute_readiness(session, activity_id)


@router.get("/projects/{project_id}/startable", response_model=StartableSet)
def project_startable(project_id: str, threshold: float | None = None, session: Session = Depends(get_session),
                      _: ProjectContext = Depends(require_project_role())) -> StartableSet:
    return compute_startable(session, project_id, threshold=threshold)


@router.get("/projects/{project_id}/weekly-summary", response_model=WeeklySummary)
def weekly_summary(project_id: str, session: Session = Depends(get_session), _: ProjectContext = Depends(require_project_role())) -> WeeklySummary:
    return usecases.weekly_summary(session, project_id)
