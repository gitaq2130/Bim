from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from packages.core.models.orm import JobRow

from ..deps import CurrentUser, get_current_user, get_session, project_role
from ..errors import NotFound
from ..schemas.jobs import JobView, WarningView

router = APIRouter(tags=["jobs"])


def _warning(w: Any) -> WarningView:
    if isinstance(w, dict):
        return WarningView(code=str(w.get("code") or "WARNING"), message=str(w.get("message") or ""), context=dict(w.get("context") or {}))
    return WarningView(code="WARNING", message=str(w))


def job_view(row: JobRow) -> JobView:
    return JobView(job_id=row.job_id, project_id=row.project_id, kind=row.kind, status=row.status,  # type: ignore[arg-type]
                   progress=max(0.0, min(1.0, float(row.progress or 0.0))), file_id=row.file_id, result_ref=row.result_ref,
                   result=row.result, warnings=[_warning(w) for w in (row.warnings or [])], error=row.error,
                   created_at=row.created_at, updated_at=row.updated_at)


@router.get("/jobs/{job_id}", response_model=JobView)
def get_job(job_id: str, session: Session = Depends(get_session), user: CurrentUser = Depends(get_current_user)) -> JobView:
    """surrogate id 라우트(ADR 0006 규칙 6): job 행을 먼저 읽고 그 project_id 로 멤버십을 검사한다."""
    row = session.get(JobRow, job_id)
    if row is None:
        raise NotFound(f"job not found: {job_id}", code="job_not_found")
    project_role(session, row.project_id, user)
    return job_view(row)
