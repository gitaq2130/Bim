from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel

from packages.core.models.scan import Registration, ScanVerdict


class ScanSummary(BaseModel):
    scan_id: str
    project_id: str
    name: str | None = None
    file_id: str
    model_id: str | None = None
    pointcloud_uri: str | None = None   # /api/files/{file_id}/content
    status: str                         # ok | needs_alignment_input | registration_failed
    point_count: int | None = None
    registration: Registration | None = None
    alignment_input: dict[str, Any] | None = None
    created_at: datetime | None = None


class AlignmentJobResponse(BaseModel):
    job_id: str
    scan_id: str
    file_id: str | None = None


class ScanVerdictsResponse(BaseModel):
    scan_id: str
    registration: Registration | None = None
    items: list[ScanVerdict]
    total: int
