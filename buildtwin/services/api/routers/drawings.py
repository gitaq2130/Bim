from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from packages.core.models.coordinate import CoordinateSystem
from packages.core.models.mapping import EntityObjectMapping
from packages.core.models.orm import DrawingRow, FileRow, ModelRow
from services.sync.persistence import load_mappings

from .. import jobs, queries, usecases
from ..deps import CurrentUser, get_current_user, get_session, require_role
from ..errors import NotFound
from ..schemas.drawings import (
    AlignmentRequest,
    ConfirmMappingRequest,
    DrawingEntitiesResponse,
    DrawingEntityView,
    DrawingSummary,
    ModelSummary,
    PlanSectionView,
)
from ..storage import mesh_bundle_path, obj_path_for
from .projects import get_project_or_404, model_summary

router = APIRouter(tags=["drawings"])


def _drawing_or_404(session: Session, drawing_id: str) -> DrawingRow:
    row = session.get(DrawingRow, drawing_id)
    if row is None:
        raise NotFound(f"drawing not found: {drawing_id}")
    return row


def _model_or_404(session: Session, model_id: str) -> ModelRow:
    row = session.get(ModelRow, model_id)
    if row is None:
        raise NotFound(f"model not found: {model_id}")
    return row


def _summary(session: Session, d: DrawingRow) -> DrawingSummary:
    f = session.get(FileRow, d.file_id)
    return DrawingSummary(drawing_id=d.drawing_id, project_id=d.project_id, name=f.filename if f else d.drawing_id, level=d.level,
                          coordinate_system=CoordinateSystem.model_validate(d.coordinate_system), alignment=d.alignment,
                          svg_uri=d.svg_uri, file_id=d.file_id, stats=dict(d.stats or {}))


@router.get("/projects/{project_id}/drawings", response_model=list[DrawingSummary])
def list_drawings(project_id: str, session: Session = Depends(get_session), _: CurrentUser = Depends(get_current_user)) -> list[DrawingSummary]:
    get_project_or_404(session, project_id)
    return [_summary(session, d) for d in queries.project_drawings(session, project_id)]


@router.get("/drawings/{drawing_id}", response_model=DrawingSummary)
def get_drawing(drawing_id: str, session: Session = Depends(get_session), _: CurrentUser = Depends(get_current_user)) -> DrawingSummary:
    return _summary(session, _drawing_or_404(session, drawing_id))


@router.get("/drawings/{drawing_id}/entities", response_model=DrawingEntitiesResponse)
def drawing_entities(drawing_id: str, session: Session = Depends(get_session), _: CurrentUser = Depends(get_current_user)) -> DrawingEntitiesResponse:
    d = _drawing_or_404(session, drawing_id)
    entities = [DrawingEntityView(**e.model_dump()) for e in jobs.drawing_entities(session, drawing_id)]
    return DrawingEntitiesResponse(drawing_id=drawing_id, project_id=d.project_id, level=d.level, entities=entities,
                                   coordinate_system=CoordinateSystem.model_validate(d.coordinate_system), alignment=d.alignment,
                                   svg_uri=d.svg_uri)


@router.get("/drawings/{drawing_id}/mappings", response_model=list[EntityObjectMapping])
def drawing_mappings(drawing_id: str, needs_review: bool | None = None, session: Session = Depends(get_session),
                     _: CurrentUser = Depends(get_current_user)) -> list[EntityObjectMapping]:
    _drawing_or_404(session, drawing_id)
    return load_mappings(session, drawing_id, needs_review=needs_review)


@router.post("/drawings/{drawing_id}/alignment")
def set_alignment(drawing_id: str, body: AlignmentRequest, session: Session = Depends(get_session),
                  user: CurrentUser = Depends(require_role("contractor", "cm", "admin"))) -> dict[str, Any]:
    """사용자 정합값(origin/rotation/scale) 저장 → 매핑 재구성(사용자 확정 매핑은 유지). 동기 실행, job 기록 남김."""
    d = _drawing_or_404(session, drawing_id)
    return usecases.realign_drawing(session, d, body, user)


@router.post("/drawings/{drawing_id}/mappings/{handle}/confirm", response_model=EntityObjectMapping)
def confirm_mapping(drawing_id: str, handle: str, body: ConfirmMappingRequest, session: Session = Depends(get_session),
                    user: CurrentUser = Depends(require_role("cm"))) -> EntityObjectMapping:
    """매핑 확정(cm 만). sync.confirm_mapping_row + ExpertReviewLog."""
    return usecases.confirm_entity_mapping(session, drawing_id, handle, body.global_id, user, body.note)


@router.get("/models/{model_id}", response_model=ModelSummary)
def get_model(model_id: str, session: Session = Depends(get_session), _: CurrentUser = Depends(get_current_user)) -> ModelSummary:
    return model_summary(session, _model_or_404(session, model_id))


@router.get("/models/{model_id}/plan-section", response_model=PlanSectionView)
def plan_section(model_id: str, level: str | None = Query(None), offset: float | None = Query(None),
                 session: Session = Depends(get_session), _: CurrentUser = Depends(get_current_user)) -> PlanSectionView:
    """층 레벨 표고 + offset(기본 config/sync.yaml plan_section_default_offset) 높이에서 객체 bbox 단면."""
    return usecases.plan_section(session, _model_or_404(session, model_id), level, offset)


@router.get("/models/{model_id}/mesh", response_class=FileResponse)
def model_mesh(model_id: str, session: Session = Depends(get_session), _: CurrentUser = Depends(get_current_user)) -> FileResponse:
    m = _model_or_404(session, model_id)
    p = mesh_bundle_path(m.mesh_uri)
    if p is None:
        raise NotFound(f"mesh bundle not available for model {model_id}")
    return FileResponse(p, media_type="application/json", filename=p.name)


@router.get("/models/{model_id}/mesh.obj", response_class=FileResponse)
def model_mesh_obj(model_id: str, session: Session = Depends(get_session), _: CurrentUser = Depends(get_current_user)) -> FileResponse:
    m = _model_or_404(session, model_id)
    p = obj_path_for(m.mesh_uri)
    if p is None:
        raise NotFound(f"OBJ not available for model {model_id}")
    return FileResponse(p, media_type="text/plain", filename=p.name)
