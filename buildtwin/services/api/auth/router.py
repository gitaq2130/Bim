"""POST /auth/login, POST /auth/register, GET /auth/me."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from packages.core.models.orm import UserRow

from ..deps import CurrentUser, get_current_user, get_optional_user, get_session
from ..schemas.auth import LoginRequest, LoginResponse, RegisterRequest, UserView
from .security import create_access_token, hash_password, verify_password
from .seed import users_count

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
    """admin 전용. 단, users 테이블이 비어 있으면 누구나 호출 가능하고 첫 사용자는 admin 이 된다(부트스트랩)."""
    bootstrap = users_count(session) == 0
    if not bootstrap and (user is None or user.role != "admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="admin role required to register users")
    email = str(body.email).lower()
    if session.scalars(select(UserRow).where(func.lower(UserRow.email) == email)).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="email already registered")
    role = "admin" if bootstrap else body.role
    row = UserRow(user_id=f"u-{uuid.uuid4().hex[:12]}", email=email, password_hash=hash_password(body.password), role=role,
                  name=body.name)
    session.add(row)
    session.commit()
    return UserView(user_id=row.user_id, email=row.email, role=row.role, name=row.name)  # type: ignore[arg-type]


@router.get("/me", response_model=UserView)
def me(user: CurrentUser = Depends(get_current_user), session: Session = Depends(get_session)) -> UserView:
    row = session.get(UserRow, user.user_id)
    return UserView(user_id=user.user_id, email=user.email, role=user.role, name=row.name if row else None)  # type: ignore[arg-type]
