from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, Request, status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from packages.core.models.orm import DailyReportRow, FileRow

from .. import usecases
from ..deps import CurrentUser, get_current_user, get_session, require_role
from ..errors import Unprocessable
from ..schemas.reports import DailyReportCreate, DailyReportResponse, DailyReportView
from ..storage import save_stream
from .projects import get_project_or_404

router = APIRouter(tags=["daily-reports"])

_BODY_DOC = {
    "requestBody": {
        "required": True,
        "content": {
            "application/json": {"schema": {"$ref": "#/components/schemas/DailyReportCreate"}},
            "multipart/form-data": {"schema": {"type": "object", "properties": {
                "report": {"type": "string", "description": "DailyReportCreate JSON 문자열"},
                "photos": {"type": "array", "items": {"type": "string", "format": "binary"}}}}},
        },
    }
}


async def _parse_body(request: Request, project_id: str, session: Session, user: CurrentUser) -> tuple[DailyReportCreate, list[str]]:
    ctype = request.headers.get("content-type", "")
    photo_uris: list[str] = []
    try:
        if ctype.startswith("multipart/form-data"):
            form = await request.form()
            raw = form.get("report")
            if not isinstance(raw, str):
                raise Unprocessable("multipart body requires a 'report' JSON field")
            payload = DailyReportCreate.model_validate(json.loads(raw))
            for item in form.getlist("photos"):
                if isinstance(item, UploadFile):
                    file_id = f"f-{uuid.uuid4().hex[:12]}"
                    stored = save_stream(project_id, file_id, item.filename or "photo", item.file)
                    session.add(FileRow(file_id=file_id, project_id=project_id, kind="photo", filename=item.filename or "photo",
                                        uri=stored.uri, sha256=stored.sha256, size=stored.size, uploaded_by=user.user_id))
                    photo_uris.append(f"/api/files/{file_id}/content")
            session.flush()
        else:
            payload = DailyReportCreate.model_validate(await request.json())
    except (ValidationError, ValueError) as exc:
        raise Unprocessable(f"invalid daily report: {exc}")
    return payload, photo_uris


@router.post("/projects/{project_id}/daily-reports", response_model=DailyReportResponse, status_code=status.HTTP_201_CREATED,
             openapi_extra=_BODY_DOC)
async def create_daily_report(project_id: str, request: Request, session: Session = Depends(get_session),
                              user: CurrentUser = Depends(require_role("contractor"))) -> DailyReportResponse:
    """작업일보 입력(JSON 또는 multipart report+photos). 상태기계 apply_daily_report → 3중 검증 불일치 시 검토요청·전이 보류."""
    get_project_or_404(session, project_id)
    payload, photo_uris = await _parse_body(request, project_id, session, user)
    return usecases.submit_daily_report(session, project_id, payload, user, photo_uris)


@router.get("/projects/{project_id}/daily-reports", response_model=list[DailyReportView])
def list_daily_reports(project_id: str, session: Session = Depends(get_session), _: CurrentUser = Depends(get_current_user)) -> list[DailyReportView]:
    get_project_or_404(session, project_id)
    rows = session.scalars(select(DailyReportRow).where(DailyReportRow.project_id == project_id).order_by(DailyReportRow.submitted_at.desc()))
    return [DailyReportView(report_id=r.report_id, project_id=r.project_id, report_date=r.report_date, reporter_id=r.reporter_id,
                            crew_count=r.crew_count, equipment=r.equipment or {}, items=list(r.items or []), note=r.note,
                            submitted_at=r.submitted_at) for r in rows]
