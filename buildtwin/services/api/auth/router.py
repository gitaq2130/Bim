"""POST /auth/login, POST /auth/register, GET /auth/me."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from packages.core.models.orm import UserRow

from ..deps import CurrentUser, get_current_user, get_optional_user, get_session
from ..errors import Conflict, Forbidden
from ..schemas.auth import LoginRequest, LoginResponse, RegisterRequest, UserView
from .security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, session: Session = Depends(get_session)) -> LoginResponse:
    row = session.scalars(select(UserRow).where(func.lower(UserRow.email) == body.login_email)).first()
    if row is None or not verify_password(body.password, row.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="invalid credentials")
    token = create_access_token(row.user_id, row.role, row.email)
    return LoginResponse(access_token=token, role=row.role, user_id=row.user_id, email=row.email)  # type: ignore[arg-type]


@router.post("/register", response_model=UserView, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, session: Session = Depends(get_session),
             user: CurrentUser | None = Depends(get_optional_user)) -> UserView:
    """**admin 전용 — `users` 가 비어 있어도 같다**(ADR 0019 §2-1). 인증 없는 호출은 403 `forbidden_role` 이고,
    그 뒤에도 `users` 는 그대로다.

    빈 DB 에 첫 계정을 만드는 경로는 **명령 하나**다 — `python -m services.api.seed`(호스트는 `make seed`,
    compose 스택은 `make seed-compose`, ADR 0019 §2-2). 그 명령은 프로세스·파일시스템 접근을 요구하므로
    **네트워크에서 부를 수 없다**; 그것이 열린 엔드포인트와 다른 점이다. 그래서 시드하지 않은 빈 DB 로
    앱을 띄우면 아무도 로그인할 수 없고, **그것이 의도된 상태다**(ADR 0019 §2-1).

    `role` 은 요청이 보낸 값이 그대로 선다 — 서버가 덮어쓰는 자리는 없다.
    """
    if user is None or user.role != "admin":
        raise Forbidden("admin role required to register users", code="forbidden_role")
    email = str(body.email).lower()
    if session.scalars(select(UserRow).where(func.lower(UserRow.email) == email)).first() is not None:
        raise Conflict("email already registered", code="duplicate_user_email")
    role = body.role
    row = UserRow(user_id=f"u-{uuid.uuid4().hex[:12]}", email=email, password_hash=hash_password(body.password), role=role,
                  name=body.name)
    session.add(row)
    session.commit()
    return UserView(user_id=row.user_id, email=row.email, role=row.role, name=row.name)  # type: ignore[arg-type]


@router.get("/me", response_model=UserView)
def me(user: CurrentUser = Depends(get_current_user), session: Session = Depends(get_session)) -> UserView:
    row = session.get(UserRow, user.user_id)
    return UserView(user_id=user.user_id, email=user.email, role=user.role, name=row.name if row else None)  # type: ignore[arg-type]
