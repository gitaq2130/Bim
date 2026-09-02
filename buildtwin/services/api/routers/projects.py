from __future__ import annotations

import uuid
from collections import Counter

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from packages.core.models.coordinate import CoordinateSystem
from packages.core.models.orm import FileRow, ProjectRow

from .. import queries
from ..deps import CurrentUser, get_current_user, get_session, require_role
from ..errors import NotFound
from ..schemas.drawings import ModelSummary
from ..schemas.objects import LevelView
from ..schemas.projects import ProjectCreate, ProjectView

router = APIRouter(tags=["projects"])


def get_project_or_404(session: Session, project_id: str) -> ProjectRow:
    row = session.get(ProjectRow, project_id)
    if row is None:
        raise NotFound(f"project not found: {project_id}")
    return row


def _view(row: ProjectRow) -> ProjectView:
    return ProjectView(project_id=row.project_id, name=row.name, created_at=row.created_at)


@router.post("/projects", response_model=ProjectView, status_code=status.HTTP_201_CREATED)
def create_project(body: ProjectCreate, session: Session = Depends(get_session),
                   _: CurrentUser = Depends(require_role("admin"))) -> ProjectView:
    pid = body.project_id or f"p-{uuid.uuid4().hex[:12]}"
    if session.get(ProjectRow, pid) is not None:
        from ..errors import Conflict

        raise Conflict(f"project already exists: {pid}")
    row = ProjectRow(project_id=pid, name=body.name)
    session.add(row)
    session.commit()
    return _view(row)


@router.get("/projects", response_model=list[ProjectView])
def list_projects(session: Session = Depends(get_session), _: CurrentUser = Depends(get_current_user)) -> list[ProjectView]:
    return [_view(r) for r in session.scalars(select(ProjectRow).order_by(ProjectRow.created_at))]


@router.get("/projects/{project_id}", response_model=ProjectView)
def get_project(project_id: str, session: Session = Depends(get_session), _: CurrentUser = Depends(get_current_user)) -> ProjectView:
    return _view(get_project_or_404(session, project_id))


@router.get("/projects/{project_id}/levels", response_model=list[LevelView])
def list_levels(project_id: str, session: Session = Depends(get_session), _: CurrentUser = Depends(get_current_user)) -> list[LevelView]:
    get_project_or_404(session, project_id)
    counts = Counter(r.level for r in queries.project_objects(session, project_id) if r.level)
    model = queries.latest_model(session, project_id)
    levels: dict[str, LevelView] = {}
    for lv in (model.levels if model else []) or []:
        name = str(lv.get("name"))
        levels[name] = LevelView(name=name, elevation=lv.get("elevation"), object_count=counts.get(name, 0))
    for name, n in counts.items():
        levels.setdefault(name, LevelView(name=name, elevation=None, object_count=n))
    return sorted(levels.values(), key=lambda v: (v.elevation if v.elevation is not None else float("inf"), v.name))


def model_summary(session: Session, m) -> ModelSummary:
    from services.sync.config import load_sync_config

    f = session.get(FileRow, m.file_id)
    return ModelSummary(model_id=m.model_id, project_id=m.project_id, name=f.filename if f else m.model_id,
                        model_uri=f"/api/models/{m.model_id}/mesh", obj_uri=f"/api/models/{m.model_id}/mesh.obj",
                        levels=list(m.levels or []), coordinate_system=CoordinateSystem.model_validate(m.coordinate_system),
                        plan_section_default_offset=load_sync_config().plan_section_default_offset,
                        version=m.version, file_id=m.file_id, stats=dict(m.stats or {}))


@router.get("/projects/{project_id}/models", response_model=list[ModelSummary])
def list_models(project_id: str, session: Session = Depends(get_session), _: CurrentUser = Depends(get_current_user)) -> list[ModelSummary]:
    get_project_or_404(session, project_id)
    return [model_summary(session, m) for m in queries.project_models(session, project_id)]
