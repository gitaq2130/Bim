"""Celery 태스크. 담당: reality-capture. 앱은 services/common/celery_app.py 공용 인스턴스를 쓴다.

register_scan_task(job_id, scan_path, alignment_json, objects_json, scan_id) → ScanVerdictBatch.model_dump(mode="json") + job_id
"""
from __future__ import annotations

import json
from typing import Any

from packages.core.models.scan import AlignmentInput
from services.common.celery_app import celery_app

from .pipeline import run_scan_pipeline

TASK_REGISTER_SCAN = "scan.register_scan"


def _loads(value: Any) -> Any:
    return json.loads(value) if isinstance(value, (str, bytes, bytearray)) else value


@celery_app.task(name=TASK_REGISTER_SCAN)
def register_scan_task(job_id: str, scan_path: str, alignment_json: Any, objects_json: Any, scan_id: str) -> dict[str, Any]:
    """정합+판정 전체 파이프라인. alignment_json: AlignmentInput(JSON 문자열 또는 dict), objects_json: [{global_id,bbox,ifc_type}]."""
    alignment = AlignmentInput.model_validate(_loads(alignment_json))
    objects = _loads(objects_json)
    batch = run_scan_pipeline(scan_path, alignment, objects, scan_id)
    out = batch.model_dump(mode="json")
    out["job_id"] = job_id
    return out


__all__ = ["TASK_REGISTER_SCAN", "register_scan_task"]
