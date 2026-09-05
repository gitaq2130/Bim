"""Celery 태스크 — ingest만 호출하고 결과 dict를 돌려준다. DB 저장은 api 계층이 담당한다."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from packages.core.models import FileKind
from services.common.celery_app import celery_app

from . import ingest_file


@celery_app.task(name="ingest.ingest_file", bind=True)
def ingest_file_task(self, job_id: str, file_path: str, kind: FileKind | None = None, out_dir: str | None = None) -> dict[str, Any]:
    """job_id는 api가 진행률 폴링에 쓰는 키. 반환값은 IngestResult.model_dump(mode="json")."""
    try:
        self.update_state(state="STARTED", meta={"job_id": job_id, "file_path": file_path, "kind": kind})
    except Exception:  # noqa: BLE001 — eager/backend 없는 환경에서는 상태 갱신이 실패해도 무시
        pass
    result = ingest_file(Path(file_path), kind=kind, out_dir=Path(out_dir) if out_dir else None)
    return result.model_dump(mode="json")
