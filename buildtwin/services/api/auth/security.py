"""비밀번호 해시·JWT. 시크릿은 settings(.env)에서만 읽는다.

- 해시: passlib bcrypt 우선. bcrypt 5.x 와 passlib 1.7 의 조합은 백엔드 자가진단에서 깨지므로(72바이트 프로브 오류)
  import 시점에 프로브해 실패하면 pbkdf2_sha256 으로 폴백한다.
- JWT: python-jose, settings.jwt_secret / jwt_algorithm / jwt_expire_minutes.
"""
from __future__ import annotations

import logging
import warnings
from datetime import UTC, datetime, timedelta
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext

from packages.core.settings import settings

log = logging.getLogger(__name__)
__all__ = ["JWTError", "create_access_token", "decode_token", "hash_password", "verify_password", "hash_scheme"]


def _build_context() -> CryptContext:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            ctx = CryptContext(schemes=["bcrypt", "pbkdf2_sha256"], deprecated="auto")
            probe = ctx.hash("probe")
            if not ctx.verify("probe", probe):
                raise RuntimeError("bcrypt self-check failed")
            return ctx
        except Exception as exc:  # noqa: BLE001 — bcrypt 백엔드 불량 → pbkdf2 폴백
            log.warning("bcrypt backend unavailable (%s); falling back to pbkdf2_sha256", exc)
            return CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


_ctx = _build_context()


def hash_scheme() -> str:
    return str(_ctx.default_scheme())


def hash_password(password: str) -> str:
    return str(_ctx.hash(password))


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bool(_ctx.verify(password, password_hash))
    except (ValueError, TypeError):
        return False


def create_access_token(user_id: str, role: str, email: str, expires_minutes: int | None = None) -> str:
    now = datetime.now(UTC)
    exp = now + timedelta(minutes=expires_minutes if expires_minutes is not None else settings.jwt_expire_minutes)
    payload: dict[str, Any] = {"sub": user_id, "role": role, "email": email, "iat": int(now.timestamp()), "exp": exp}
    return str(jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm))


def decode_token(token: str) -> dict[str, Any]:
    """유효하지 않으면 jose.JWTError."""
    return dict(jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]))
