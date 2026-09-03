"""FastAPI 의존성: DB 세션, 현재 사용자(JWT), 역할 검사."""
from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from packages.core.db import new_session
from packages.core.models.orm import UserRow
from packages.core.models.state import UserRole

from .auth.security import JWTError, decode_token
from .errors import Forbidden

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
