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
from ..errors import Forbidden, NotFound, Unprocessable, UnsupportedMedia
from ..jobs import JobError, job_kind_for
from ..schemas.jobs import FileView, UploadResponse
from ..storage import resolve_local_path, save_stream
from ..tasks import dispatch_job

router = APIRouter(tags=["files"])
_VALID_KINDS: set[str] = {"ifc", "dxf", "dwg", "rvt", "e57", "las", "ply", "csv", "xml", "xer", "xlsx"}
# ADR 0007 §7 규칙 1: 대장(xlsx) 업로드는 그 프로젝트의 cm 만. 다른 종류는 기존대로 contractor/cm(아래
# require_project_role("contractor", "cm") 의존성)을 그대로 쓴다 — 이 상수는 xlsx 에만 좁히는 예외 목록이다.
_DOCUMENT_REGISTER_ROLE = "cm"


def file_view(row: FileRow) -> FileView:
    return FileView(file_id=row.file_id, project_id=row.project_id, kind=row.kind, filename=row.filename, size=row.size,
                    sha256=row.sha256, content_uri=f"/api/files/{row.file_id}/content", uploaded_by=row.uploaded_by,
                    created_at=row.created_at)


@router.post("/projects/{project_id}/files", response_model=UploadResponse, status_code=status.HTTP_202_ACCEPTED)
def upload_file(project_id: str, file: UploadFile = File(...), kind: str | None = Form(None),
                level_form: str | None = Form(None, alias="level"), level_query: str | None = Query(None, alias="level"),
                session: Session = Depends(get_session),
                ctx: ProjectContext = Depends(require_project_role("contractor", "cm"))) -> UploadResponse:
    """업로드. 기본은 그 프로젝트의 contractor/cm 만(ADR 0006, admin 은 행위 역할이 없어 제외) — 위 의존성이
    이를 건다. **다만 대장(xlsx)은 cm 만**(ADR 0007 §7 규칙 1): 처리결과가 발주처·CM 판단의 기록이고 이제
    readiness 를 움직이므로, 시공사가 스스로 승인 상태를 입력하면 "확정은 cm 만"을 데이터 입력 경로로
    우회하게 된다. 파일 종류는 저장한 바이트를 봐야 판별되므로(확장자+매직넘버, detect_file_kind) 그 판별
    자체는 위 의존성보다 늦게 일어난다 — 그래서 xlsx 로 판별된 뒤 여기서 역할을 한 번 더 좁혀 검사하고,
    거부(403/422)는 FileRow/JobRow 를 만들기(session.add_all) **전에** 끝낸다: 저장된 임시 파일만 지우고
    돌아간다 — files/jobs 테이블에는 아무 흔적도 남지 않는다."""
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
    if resolved == "xlsx":
        if ctx.role != _DOCUMENT_REGISTER_ROLE:
            stored.path.unlink(missing_ok=True)
            raise Forbidden(
                f"project role '{ctx.role}' not allowed to upload a document register; requires 'cm' "
                "(ADR 0007 §7 — approval status recorded by the register now feeds readiness, so only cm may enter it)",
                code="forbidden_role",
            )
        # ADR 0007 §2-5 규칙 3 / §8 규칙 5: 헤더 행을 못 찾거나 필수 컬럼(제목)이 없어 어떤 시트도 읽지
        # 못하면 422. 파서는 순수 함수(DB 를 건드리지 않는다) — 여기서 한 번 돌려 유효성만 확인하고,
        # 실제 적재는 기존 흐름대로 Celery 잡(run_document_register) 안에서 다시 수행한다(잡은 파일 경로만
        # 받아 독립적으로 재현 가능해야 하므로 파싱 결과를 프로세스 경계 너머로 넘기지 않는다).
        from services.progress.importers.document_register import import_document_register

        preview = import_document_register(stored.path, project_id, file_id, file_uri=stored.uri)
        if not preview.sheet_counts:
            stored.path.unlink(missing_ok=True)
            raise Unprocessable(
                "document register invalid: no sheet had both a header row and the required 'title' column; "
                f"warnings={[str(w) for w in preview.warnings]}",
                code="document_register_invalid",
            )
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
