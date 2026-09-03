from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from packages.core.models.ingest import FileKind
from packages.core.models.orm import FileRow, JobRow

from .. import queries
from ..deps import CurrentUser, ProjectContext, get_current_user, get_session, project_role, require_project_role
from ..errors import NotFound, UnsupportedMedia
from ..jobs import JobError, job_kind_for
from ..schemas.jobs import FileView, UploadResponse
from ..storage import resolve_local_path, save_stream
from ..tasks import dispatch_job

router = APIRouter(tags=["files"])
_VALID_KINDS: set[str] = {"ifc", "dxf", "dwg", "rvt", "e57", "las", "ply", "csv", "xml", "xer"}


def file_view(row: FileRow) -> FileView:
    return FileView(file_id=row.file_id, project_id=row.project_id, kind=row.kind, filename=row.filename, size=row.size,
                    sha256=row.sha256, content_uri=f"/api/files/{row.file_id}/content", uploaded_by=row.uploaded_by,
                    created_at=row.created_at)


@router.post("/projects/{project_id}/files", response_model=UploadResponse, status_code=status.HTTP_202_ACCEPTED)
def upload_file(project_id: str, file: UploadFile = File(...), kind: str | None = Form(None),
                level_form: str | None = Form(None, alias="level"), level_query: str | None = Query(None, alias="level"),
                session: Session = Depends(get_session),
                ctx: ProjectContext = Depends(require_project_role("contractor", "cm"))) -> UploadResponse:
    """업로드(그 프로젝트의 contractor/cm 만 — ADR 0006, admin 은 행위 역할이 없어 제외).
    저장(sha256) → FileRow/JobRow → Celery 발행 → {job_id}. 종류는 확장자+매직넘버(detect_file_kind)."""
    from services.ingest import detect_file_kind

    user_id = ctx.user_id
    file_id = f"f-{uuid.uuid4().hex[:12]}"
    filename = file.filename or "upload"
    stored = save_stream(project_id, file_id, filename, file.file)
    detected: FileKind = detect_file_kind(stored.path)
    resolved: str = kind if kind in _VALID_KINDS else detected
    if resolved not in _VALID_KINDS:
        stored.path.unlink(missing_ok=True)
        raise UnsupportedMedia(f"unsupported file kind for {filename!r} (detected: {detected})", code="unsupported_file_kind")
    try:
        job_kind = job_kind_for(resolved)
    except JobError as exc:
        stored.path.unlink(missing_ok=True)
        raise UnsupportedMedia(str(exc), code="unsupported_file_kind")
    row = FileRow(file_id=file_id, project_id=project_id, kind=resolved, filename=filename, uri=stored.uri, sha256=stored.sha256,
                  size=stored.size, uploaded_by=user_id)
    job = JobRow(job_id=f"j-{uuid.uuid4().hex[:12]}", project_id=project_id, kind=job_kind, status="queued", progress=0.0,
                 file_id=file_id, warnings=[])
    session.add_all([row, job])
    session.commit()
    options: dict[str, Any] = {"level": level_form or level_query, "filename": filename}
    dispatch_job(job.job_id, options)
    return UploadResponse(job_id=job.job_id, file_id=file_id, kind=resolved, job_kind=job_kind)  # type: ignore[arg-type]


@router.get("/projects/{project_id}/files", response_model=list[FileView])
def list_files(project_id: str, session: Session = Depends(get_session), _: ProjectContext = Depends(require_project_role())) -> list[FileView]:
    return [file_view(r) for r in queries.project_files(session, project_id)]


@router.get("/files/{file_id}", response_model=FileView)
def get_file(file_id: str, session: Session = Depends(get_session), user: CurrentUser = Depends(get_current_user)) -> FileView:
    """surrogate id 라우트(ADR 0006 규칙 6): 파일 행을 먼저 읽고 그 project_id 로 멤버십을 검사한다."""
    row = session.get(FileRow, file_id)
    if row is None:
        raise NotFound(f"file not found: {file_id}", code="file_not_found")
    project_role(session, row.project_id, user)
    return file_view(row)


@router.get("/files/{file_id}/content", response_class=FileResponse)
def file_content(file_id: str, session: Session = Depends(get_session), user: CurrentUser = Depends(get_current_user)) -> FileResponse:
    row = session.get(FileRow, file_id)
    if row is None:
        raise NotFound(f"file not found: {file_id}", code="file_not_found")
    project_role(session, row.project_id, user)
    path = resolve_local_path(row.uri)
    if path is None:
        raise NotFound(f"stored content missing for file {file_id}", code="file_content_not_found")
    return FileResponse(path, filename=row.filename, media_type="application/octet-stream")
