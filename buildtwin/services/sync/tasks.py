"""Celery 태스크: build_mapping_task. 담당: sync-2d3d. API 는 job_id 를 돌려주고 폴링한다(CLAUDE.md §3-9)."""
from __future__ import annotations

import json
import logging
from typing import Any

from packages.core.models import BimObjectDraft, DrawingEntityDraft
from services.common.celery_app import celery_app

from .matcher import build_mappings
from .review_queue import mappings_needing_review
from .rules import load_layer_rules
from .transform import DrawingAlignment, auto_align_by_grid_detailed, grid_from_ifc_objects

log = logging.getLogger(__name__)
TASK_NAME = "sync.build_mapping"


def _as_list(payload: Any) -> list:
    if payload is None:
        return []
    if isinstance(payload, str):
        payload = json.loads(payload)
    return list(payload)


def _as_dict(payload: Any) -> dict | None:
    if payload is None:
        return None
    if isinstance(payload, str):
        payload = json.loads(payload)
    return dict(payload)


def _persist(job_id: str, drawing_id: str, alignment: DrawingAlignment, mappings: list, result: dict,
             project_id: str | None) -> None:
    """DB 저장(선택): 정합 + 매핑 생명주기(rebuild_mappings). DrawingRow/JobRow 가 없으면 건너뛰고 경고만 남긴다."""
    from packages.core.db import session_scope
    from packages.core.models.orm import DrawingRow, JobRow

    from .persistence import rebuild_mappings, save_alignment

    with session_scope() as s:
        drawing = s.get(DrawingRow, drawing_id)
        if drawing is None:
            result["warnings"].append(f"drawing not found: {drawing_id}; nothing persisted")
            return
        save_alignment(s, drawing_id, alignment)
        rb = rebuild_mappings(s, drawing_id, project_id or drawing.project_id, mappings, keep_confirmed=True)
        result["persisted"] = rb.model_dump()
        job = s.get(JobRow, job_id)
        if job is not None:
            job.status, job.progress = "done", 1.0
            job.result = {k: v for k, v in result.items() if k != "mappings"}


def run_build_mapping(job_id: str, drawing_id: str, entities_json: Any, objects_json: Any,
                      alignment_json: Any = None, level: str | None = None, grid: Any = None,
                      unit_scale: float | None = None, persist: bool = False) -> dict:
    """태스크 본체(동기). alignment 가 없으면 그리드 자동 정합(IfcGrid 축 → 없으면 기둥 중심)을 먼저 시도한다."""
    result: dict[str, Any] = {"job_id": job_id, "drawing_id": drawing_id, "status": "running", "warnings": []}
    entities = [DrawingEntityDraft.model_validate(e) for e in _as_list(entities_json)]
    objects = [BimObjectDraft.model_validate(o) for o in _as_list(objects_json)]
    alignment_data = _as_dict(alignment_json)
    grid_data = _as_dict(grid) or {}

    if alignment_data:
        alignment = DrawingAlignment.model_validate(alignment_data)
    else:
        gx, gy = grid_data.get("grid_x"), grid_data.get("grid_y")
        grid_source = "ifc_grid"
        if not gx or not gy:
            gx, gy = grid_from_ifc_objects(objects)
            grid_source = "column_centers"
        res = auto_align_by_grid_detailed(entities, list(gx), list(gy), load_layer_rules().grid_layers, unit_scale)
        if res.alignment is None:
            result.update(status="failed", error=f"grid auto-align failed: {res.reason}",
                          alignment=None, grid_source=grid_source, n_intersections=res.n_intersections)
            return result
        alignment = res.alignment
        result["grid_source"] = grid_source
        if res.ambiguous:
            result["warnings"].append("symmetric grid: orientation ambiguous, smallest rotation chosen — user confirmation advised")

    mappings = build_mappings(drawing_id, entities, objects, alignment, level)
    reviews = mappings_needing_review(mappings, project_id=grid_data.get("project_id") or "unknown")
    result.update(
        status="done", alignment=alignment.model_dump(mode="json"), level=level,
        mapping_count=len(mappings), review_count=len(reviews),
        entity_count=len(entities), object_count=len(objects),
        mappings=[m.model_dump(mode="json") for m in mappings],
    )
    if persist:
        _persist(job_id, drawing_id, alignment, mappings, result, grid_data.get("project_id"))
    return result


@celery_app.task(name=TASK_NAME, bind=True)
def build_mapping_task(self, job_id: str, drawing_id: str, entities_json: Any, objects_json: Any,
                       alignment_json: Any = None, level: str | None = None, grid: Any = None,
                       unit_scale: float | None = None, persist: bool = False) -> dict:
    try:
        return run_build_mapping(job_id, drawing_id, entities_json, objects_json, alignment_json, level, grid,
                                 unit_scale, persist)
    except Exception as exc:  # noqa: BLE001 — 실패도 job 결과로 남긴다
        log.exception("build_mapping_task failed: job=%s drawing=%s", job_id, drawing_id)
        return {"job_id": job_id, "drawing_id": drawing_id, "status": "failed", "error": str(exc), "warnings": []}
