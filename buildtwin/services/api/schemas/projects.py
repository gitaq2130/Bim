from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ProjectRole = Literal["contractor", "cm", "client"]   # admin 은 멤버십 없이 조회만(ADR 0006 §2) — 여기 포함 안 함


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1)
    project_id: str | None = None      # 생략 시 서버가 발급
    description: str | None = None     # 저장 컬럼 없음(MVP) — 응답에 그대로 되돌리지 않는다


class ProjectView(BaseModel):
    project_id: str
    name: str
    created_at: datetime | None = None
    description: str | None = None
    my_role: ProjectRole | None = None   # ADR 0006 규칙 4: 화면은 이 값으로 버튼을 가린다(전역 역할 아님). admin=None


class MemberCreate(BaseModel):
    user_id: str
    role: ProjectRole


class MemberView(BaseModel):
    project_id: str
    user_id: str
    email: str | None = None
    role: ProjectRole
    added_by: str | None = None
    added_at: datetime | None = None
