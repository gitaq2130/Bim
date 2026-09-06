"""Celery 태스크 래퍼. 공용 앱(services/common/celery_app.py)에 등록. 개발·테스트는 eager."""
from __future__ import annotations

from typing import Any

from services.common.celery_app import celery_app

from .jobs import run_job

TASK_RUN_JOB = "api.run_job"


@celery_app.task(name=TASK_RUN_JOB)
def run_job_task(job_id: str, options: dict[str, Any] | None = None) -> dict[str, Any]:
    return run_job(job_id, options)


def dispatch_job(job_id: str, options: dict[str, Any] | None = None) -> str:
    """태스크 발행. eager 모드면 즉시 실행되고, 아니면 워커가 처리한다. 반환: celery task id."""
    async_result = run_job_task.delay(job_id, options or {})
    return str(async_result.id)


__all__ = ["TASK_RUN_JOB", "dispatch_job", "run_job_task"]
