"""FastAPI 의존성: DB 세션, 현재 사용자(JWT), 역할 검사.

ADR 0006: 프로젝트 범위 라우트의 인가는 `UserRow.role`(전역) 이 아니라 `project_members.role`(프로젝트별) 로
한다. `require_role`은 프로젝트를 묻지 않는 라우트(auth, 멤버십 관리 자체)에만 남긴다.
"""
from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from packages.core.db import new_session
from packages.core.models.orm import ProjectMemberRow, ProjectRow, UserRow
from packages.core.models.state import UserRole

from .auth.security import JWTError, decode_token
from .errors import Forbidden, NotFound

ALL_ROLES: tuple[str, ...] = ("contractor", "cm", "client", "admin")
_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class CurrentUser:
    user_id: str
    email: str
    role: str   # UserRole


def get_session() -> Iterator[Session]:
    session = new_session()
    try:
        yield session
    finally:
        session.close()


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail=detail, headers={"WWW-Authenticate": "Bearer"})


def get_optional_user(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
                      session: Session = Depends(get_session)) -> CurrentUser | None:
    """토큰이 없으면 None, 있는데 잘못되면 401."""
    if credentials is None or not credentials.credentials:
        return None
    try:
        payload = decode_token(credentials.credentials)
    except JWTError:
        raise _unauthorized("invalid or expired token")
    user_id = payload.get("sub")
    row = session.get(UserRow, user_id) if user_id else None
    if row is None:
        raise _unauthorized("unknown user")
    return CurrentUser(user_id=row.user_id, email=row.email, role=row.role)


def get_current_user(user: CurrentUser | None = Depends(get_optional_user)) -> CurrentUser:
    if user is None:
        raise _unauthorized("authentication required")
    return user


def require_role(*roles: UserRole | str):
    allowed = set(roles)

    def _dep(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in allowed:
            raise Forbidden(f"role '{user.role}' not allowed; requires one of {sorted(allowed)}", code="forbidden_role")
        return user

    return _dep


@dataclass(frozen=True)
class ProjectContext:
    """ADR 0006: 프로젝트 범위 인가 결과. `role` 은 `project_members.role`(프로젝트 역할) —
    전역 `UserRow.role` 이 아니다. admin 은 멤버십 없이 읽기만 통과하며 이때 `role=None`
    (행위 역할 없음 — `services.progress.state_machine.actor_for_role` 이 계속 거부한다)."""

    user_id: str
    project_id: str
    role: str | None


def project_role(session: Session, project_id: str, user: CurrentUser, *roles: str, read: bool = False) -> ProjectContext:
    """ADR 0006 §3 의 인가 규칙 본체. 경로에 `project_id` 가 없는 라우트(대상 행을 먼저 읽어야 프로젝트를
    아는 경우 — review-requests/{id}, activities/{id}/readiness 등, ADR 규칙 6)는 대상 행을 로드한 뒤
    이 함수를 직접 호출한다.

    - 멤버십 행이 없으면 **404**(`project_not_found`) — 존재하는 프로젝트인지 여부와 무관하게 같은 응답을
      돌려준다(403 은 프로젝트 존재를 흘린다, 규칙 2).
    - 멤버의 역할이 `roles` 에 없으면 **403**(`forbidden_role`, 규칙 1). `roles` 를 비우면(기본값) 아무
      역할의 멤버나 통과 — 조회 라우트용.
    - `admin` 은 멤버십 없이 통과한다(규칙 2, 조회 목적). `roles` 가 주어진 호출에서는 `read=True` 를 준
      경우에만 통과(그 라우트 자체가 admin 에게도 열린 조회이되 일반 멤버는 특정 역할만 보는 경우 —
      예: 검토요청 열람은 cm/admin). `read=False`(기본, 행위 라우트)면 admin 은 403 — 행위 역할이 없다
      (별도 cm 계정을 쓰라는 안내, ADR §2).
    """
    allowed = set(roles)
    member = session.get(ProjectMemberRow, (project_id, user.user_id))
    if member is not None:
        if allowed and member.role not in allowed:
            raise Forbidden(f"project role '{member.role}' not allowed on project {project_id}; "
                            f"requires one of {sorted(allowed)}", code="forbidden_role")
        return ProjectContext(user_id=user.user_id, project_id=project_id, role=member.role)
    if user.role == "admin":
        if session.get(ProjectRow, project_id) is None:
            raise NotFound(f"project not found: {project_id}", code="project_not_found")
        if allowed and not read:
            raise Forbidden("admin has no project role; acting endpoints require a project member account "
                            "(a dedicated cm/contractor account)", code="forbidden_role")
        return ProjectContext(user_id=user.user_id, project_id=project_id, role=None)
    raise NotFound(f"project not found: {project_id}", code="project_not_found")


def require_project_role(*roles: str, read: bool = False):
    """`project_id` 를 경로 파라미터로 갖는 라우트용 의존성 팩토리. `project_role()` 을 그대로 감싼다 —
    의미는 그 함수의 docstring 참고. 조회 라우트는 인자 없이 써서 프로젝트 멤버 누구나(+admin) 통과시키고,
    행위 라우트는 허용 역할을 명시한다(예: `require_project_role("contractor", "cm")`)."""

    def _dep(project_id: str, session: Session = Depends(get_session),
             user: CurrentUser = Depends(get_current_user)) -> ProjectContext:
        return project_role(session, project_id, user, *roles, read=read)

    return _dep
