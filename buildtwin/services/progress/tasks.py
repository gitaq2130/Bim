"""Celery 태스크: 공정표 import(+객체 매핑 저장), 프로젝트 Readiness·착수 가능 집합 계산."""
from __future__ import annotations

from typing import Any

from packages.core.db import session_scope
from packages.core.models.orm import JobRow
from services.common.celery_app import celery_app

from . import persistence as db
from .activity_mapper import map_activities_to_objects
from .importers import import_schedule
from .readiness import compute_readiness
from .scheduler import compute_startable


def _update_job(session, job_id: str | None, **fields: Any) -> None:
    if not job_id:
        return
    job = session.get(JobRow, job_id)
    if job is not None:
        for k, v in fields.items():
            setattr(job, k, v)


@celery_app.task(name="progress.import_schedule")
def import_schedule_task(job_id: str | None, path: str, project_id: str, fmt: str | None = None) -> dict[str, Any]:
    with session_scope() as session:
        _update_job(session, job_id, status="running", progress=0.1)
    try:
        schedule = import_schedule(path, project_id, fmt=fmt)
        with session_scope() as session:
            db.save_schedule(session, schedule)
            objects = [db.object_row_to_model(r) for r in db.load_objects(session, project_id)]
            mappings = map_activities_to_objects(schedule, objects)
            db.save_mappings(session, project_id, mappings)
            result = {"schedule_id": schedule.schedule_id, "activity_count": len(schedule.activities),
                      "relation_count": len(schedule.relations), "mapping_count": len(mappings),
                      "needs_review_count": sum(1 for m in mappings if m.needs_review), "warnings": schedule.warnings}
            _update_job(session, job_id, status="done", progress=1.0, result=result, warnings=schedule.warnings,
                        result_ref=schedule.schedule_id)
        return result
    except Exception as exc:
        with session_scope() as session:
            _update_job(session, job_id, status="failed", error=str(exc))
        raise


@celery_app.task(name="progress.compute_readiness")
def compute_readiness_task(project_id: str, threshold: float | None = None) -> dict[str, Any]:
    with session_scope() as session:
        scores = {a.activity_id: compute_readiness(session, project_id, a.activity_id).model_dump(mode="json")
                  for a in db.load_activities(session, project_id)}
        startable = compute_startable(session, project_id, threshold=threshold).model_dump(mode="json")
    return {"project_id": project_id, "readiness": scores, "startable": startable}
