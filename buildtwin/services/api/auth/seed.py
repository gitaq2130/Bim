"""개발용 데모 사용자 시드. 운영 DB 에는 절대 적용되지 않는다.

`seed_dev_users(session)` 는 main.py 의 startup 에서 **settings.database_url 이 sqlite 이고 users 테이블이 비어 있을 때만**
호출된다. 계정(모두 비밀번호 `buildtwin`):

| email | role |
|---|---|
| contractor@buildtwin.local | contractor |
| cm@buildtwin.local | cm |
| client@buildtwin.local | client |
| admin@buildtwin.local | admin |
"""
from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from packages.core.models.orm import UserRow

from .security import hash_password

DEV_SEED_DOMAIN = "buildtwin.local"
DEV_SEED_PASSWORD = "buildtwin"   # 개발 시드 전용(문서화된 값). 운영 계정은 /auth/register 로 만든다.
DEV_SEED_ROLES: tuple[str, ...] = ("contractor", "cm", "client", "admin")


def users_count(session: Session) -> int:
    return int(session.scalar(select(func.count()).select_from(UserRow)) or 0)


def seed_dev_users(session: Session) -> list[UserRow]:
    """users 가 비어 있을 때만 4개 역할의 데모 사용자를 만든다. 이미 있으면 빈 목록."""
    if users_count(session) > 0:
        return []
    rows = [UserRow(user_id=f"u-{role}-{uuid.uuid4().hex[:8]}", email=f"{role}@{DEV_SEED_DOMAIN}",
                    password_hash=hash_password(DEV_SEED_PASSWORD), role=role, name=f"{role} (dev)")
            for role in DEV_SEED_ROLES]
    session.add_all(rows)
    session.flush()
    return rows
