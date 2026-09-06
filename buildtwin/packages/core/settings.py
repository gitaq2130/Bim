"""환경 설정. 시크릿은 .env에서만 읽는다."""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "sqlite:///./buildtwin.db"
    redis_url: str = "redis://localhost:6379/0"
    celery_always_eager: bool = True          # 개발·테스트 기본. 운영은 .env에서 False
    storage_root: str = str(ROOT / "storage")  # MinIO 미사용 시 로컬 파일 저장소 폴백
    minio_endpoint: str | None = None
    minio_access_key: str | None = None
    minio_secret_key: str | None = None
    minio_bucket: str = "buildtwin"
    jwt_secret: str | None = None            # 운영은 .env JWT_SECRET 필수. 미설정 시 SQLite 개발 환경에서만 임시 값 사용
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480
    aps_client_id: str | None = None
    aps_client_secret: str | None = None
    oda_file_converter_path: str | None = None
    config_dir: str = str(ROOT / "config")
    rules_dir: str = str(ROOT / "rules")


    cors_allow_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    def resolve_jwt_secret(self) -> str:
        """운영(DB가 SQLite가 아님)에서 JWT_SECRET 미설정이면 기동을 거부한다. §3-4 시크릿은 .env에만."""
        if self.jwt_secret:
            return self.jwt_secret
        if self.database_url.startswith("sqlite"):
            import logging
            import secrets

            logging.getLogger("buildtwin.settings").warning("JWT_SECRET 미설정: SQLite 개발 환경용 프로세스 수명 난수 시크릿을 생성합니다")
            self.jwt_secret = secrets.token_urlsafe(32)   # 코드 상수 금지(§3-4). 재기동 시 토큰 무효화됨
            return self.jwt_secret
        raise RuntimeError("JWT_SECRET 환경변수가 필요합니다 (.env)")


settings = Settings()
