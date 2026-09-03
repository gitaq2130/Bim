"""개발용 데모 사용자·프로젝트 시드. 운영 DB 에는 절대 적용되지 않는다.

`seed_dev_users(session)` 는 main.py 의 startup 에서 **settings.database_url 이 sqlite 이고 users 테이블이 비어 있을 때만**
호출된다. 계정(모두 비밀번호 `buildtwin`):

| email | role |
|---|---|
| contractor@buildtwin.local | contractor |
| cm@buildtwin.local | cm |
| client@buildtwin.local | client |
| admin@buildtwin.local | admin |

ADR 0006(프로젝트 멤버십)부터는 `project_id`가 인가의 단위다 — 멤버십이 없으면 `contractor`/`cm`/`client`
데모 계정도 어떤 프로젝트도 볼 수 없다. `seed_dev_project(session, users)`가 데모 프로젝트
(`DEV_SEED_PROJECT_ID`)를 만들고 세 계정에 이름과 같은 프로젝트 역할(contractor→contractor, cm→cm,
client→client)로 멤버십을 준다 — 기존 개발 플로우(로그인만 하면 바로 현장이 보이는 것)가 그대로 동작하게
하기 위함이다. `admin` 은 멤버십을 받지 않는다(ADR 0006 §4: admin 은 이미 조회 가능하고 행위 역할이 없다).
"""
from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from packages.core.models.orm import ProjectMemberRow, ProjectRow, UserRow

from .security import hash_password

DEV_SEED_DOMAIN = "buildtwin.local"
DEV_SEED_PASSWORD = "buildtwin"   # 개발 시드 전용(문서화된 값). 운영 계정은 /auth/register 로 만든다.
DEV_SEED_ROLES: tuple[str, ...] = ("contractor", "cm", "client", "admin")
DEV_SEED_PROJECT_ID = "p-dev-demo"
DEV_SEED_PROJECT_NAME = "개발용 데모 현장"
DEV_SEED_MEMBER_ROLES: tuple[str, ...] = ("contractor", "cm", "client")   # admin 제외(ADR 0006 §4)


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


def seed_dev_project(session: Session, users: list[UserRow]) -> ProjectRow | None:
    """ADR 0006: `seed_dev_users`가 방금 만든 계정(빈 목록이면 이미 시드된 것이므로 아무것도 하지 않는다)에
    데모 프로젝트 멤버십을 준다. contractor/cm/client 는 각자 이름과 같은 프로젝트 역할을 받는다."""
    if not users:
        return None
    project = session.get(ProjectRow, DEV_SEED_PROJECT_ID)
    if project is None:
        project = ProjectRow(project_id=DEV_SEED_PROJECT_ID, name=DEV_SEED_PROJECT_NAME)
        session.add(project)
        session.flush()
    by_role = {u.role: u for u in users}
    added_by = by_role["admin"].user_id if "admin" in by_role else None
    for role in DEV_SEED_MEMBER_ROLES:
        user = by_role.get(role)
        if user is None or session.get(ProjectMemberRow, (project.project_id, user.user_id)) is not None:
            continue
        session.add(ProjectMemberRow(project_id=project.project_id, user_id=user.user_id, role=role, added_by=added_by))
    session.flush()
    return project
