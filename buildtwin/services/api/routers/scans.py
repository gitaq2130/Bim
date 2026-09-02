from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from packages.core.models.orm import FileRow, JobRow, ScanRow
from packages.core.models.scan import AlignmentInput, Registration

from .. import queries
from ..deps import CurrentUser, get_current_user, get_session, require_role
from ..errors import NotFound, Unprocessable
from ..schemas.scans import AlignmentJobResponse, ScanSummary, ScanVerdictsResponse
from ..tasks import dispatch_job
from .projects import get_project_or_404

router = APIRouter(tags=["scans"])


def _scan_or_404(session: Session, scan_id: str) -> ScanRow:
    row = session.get(ScanRow, scan_id)
    if row is None:
        raise NotFound(f"scan not found: {scan_id}")
    return row


def _registration(row: ScanRow) -> Registration | None:
    return Registration.model_validate(row.registration) if row.registration else None


def _summary(session: Session, s: ScanRow) -> ScanSummary:
    f = session.get(FileRow, s.file_id)
    reg = _registration(s)
    return ScanSummary(scan_id=s.scan_id, project_id=s.project_id, name=f.filename if f else s.scan_id, file_id=s.file_id,
                       model_id=s.model_id, pointcloud_uri=f"/api/files/{s.file_id}/content",
                       status=reg.status if reg else "needs_alignment_input", point_count=s.point_count, registration=reg,
                       alignment_input=s.alignment_input, created_at=s.created_at)


@router.get("/projects/{project_id}/scans", response_model=list[ScanSummary])
def list_scans(project_id: str, session: Session = Depends(get_session), _: CurrentUser = Depends(get_current_user)) -> list[ScanSummary]:
    get_project_or_404(session, project_id)
    return [_summary(session, s) for s in queries.project_scans(session, project_id)]


@router.get("/scans/{scan_id}", response_model=ScanSummary)
def get_scan(scan_id: str, session: Session = Depends(get_session), _: CurrentUser = Depends(get_current_user)) -> ScanSummary:
    return _summary(session, _scan_or_404(session, scan_id))


@router.post("/scans/{scan_id}/alignment", response_model=AlignmentJobResponse, status_code=status.HTTP_202_ACCEPTED)
def submit_alignment(scan_id: str, body: AlignmentInput, session: Session = Depends(get_session),
                     user: CurrentUser = Depends(require_role("cm", "admin"))) -> AlignmentJobResponse:
    """기준점(≥3) 또는 마커(≥3) → verdict 작업 발행(정합 → 객체 판정 → 상태기계 → 3중 검증). 스캔은 CONFIRMED 를 만들지 않는다."""
    scan = _scan_or_404(session, scan_id)
    if not body.is_sufficient():
        raise Unprocessable("alignment input insufficient: need ≥3 control points or ≥3 observed markers with definitions")
    scan.alignment_input = body.model_dump(mode="json")
    job = JobRow(job_id=f"j-{uuid.uuid4().hex[:12]}", project_id=scan.project_id, kind="verdict", status="queued", progress=0.0,
                 file_id=scan.file_id, result_ref=scan_id, warnings=[])
    session.add(job)
    session.commit()
    dispatch_job(job.job_id, {"scan_id": scan_id, "requested_by": user.user_id})
    return AlignmentJobResponse(job_id=job.job_id, scan_id=scan_id, file_id=scan.file_id)


@router.get("/scans/{scan_id}/verdicts", response_model=ScanVerdictsResponse)
def scan_verdicts(scan_id: str, session: Session = Depends(get_session), _: CurrentUser = Depends(get_current_user)) -> ScanVerdictsResponse:
    scan = _scan_or_404(session, scan_id)
    items = [queries.verdict_row_to_model(r) for r in queries.scan_verdicts(session, scan_id)]
    return ScanVerdictsResponse(scan_id=scan_id, registration=_registration(scan), items=items, total=len(items))


@router.get("/scans/{scan_id}/registration", response_model=Registration)
def scan_registration(scan_id: str, session: Session = Depends(get_session), _: CurrentUser = Depends(get_current_user)) -> Registration:
    scan = _scan_or_404(session, scan_id)
    reg = _registration(scan)
    return reg or Registration(scan_id=scan_id, status="needs_alignment_input")
