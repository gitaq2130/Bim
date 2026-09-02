from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1)
    project_id: str | None = None      # 생략 시 서버가 발급
    description: str | None = None     # 저장 컬럼 없음(MVP) — 응답에 그대로 되돌리지 않는다


class ProjectView(BaseModel):
    project_id: str
    name: str
    created_at: datetime | None = None
    description: str | None = None
