from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from packages.core.models.ingest import FileKind

JobStatus = Literal["queued", "running", "done", "failed"]
JobKind = Literal["ingest", "scan_upload", "schedule", "mapping", "verdict"]   # glossary "작업 종류"


class UploadResponse(BaseModel):
    job_id: str
    file_id: str
    kind: FileKind
    job_kind: JobKind


class WarningView(BaseModel):
    code: str
    message: str
    context: dict[str, Any] = Field(default_factory=dict)


class JobView(BaseModel):
    job_id: str
    project_id: str
    kind: JobKind
    status: JobStatus
    progress: float = Field(ge=0.0, le=1.0)
    file_id: str | None = None
    result_ref: str | None = None
    result: dict[str, Any] | None = None
    warnings: list[WarningView] = Field(default_factory=list)
    error: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class FileView(BaseModel):
    file_id: str
    project_id: str
    kind: str
    filename: str
    size: int
    sha256: str
    content_uri: str
    uploaded_by: str | None = None
    created_at: datetime | None = None
