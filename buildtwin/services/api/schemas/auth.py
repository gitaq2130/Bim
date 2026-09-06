from __future__ import annotations

from pydantic import BaseModel, Field, field_validator, model_validator

from packages.core.models.state import UserRole


class LoginRequest(BaseModel):
    """프론트엔드는 `username`(=email) 을 보낸다. `email` 도 허용."""
    username: str | None = None
    email: str | None = None
    password: str = Field(min_length=1)

    @model_validator(mode="after")
    def _one_identifier(self) -> LoginRequest:
        if not (self.username or self.email):
            raise ValueError("username (email) is required")
        return self

    @property
    def login_email(self) -> str:
        return str(self.username or self.email).strip().lower()


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: UserRole
    user_id: str
    email: str


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3)

    @field_validator("email")
    @classmethod
    def _looks_like_email(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v or v.startswith("@") or v.endswith("@"):
            raise ValueError("invalid email address")
        return v

    password: str = Field(min_length=6)
    role: UserRole = "contractor"
    name: str | None = None


class UserView(BaseModel):
    user_id: str
    email: str
    role: UserRole
    name: str | None = None
