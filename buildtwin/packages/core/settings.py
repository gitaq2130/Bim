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
    jwt_secret: str = "dev-only-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480
    aps_client_id: str | None = None
    aps_client_secret: str | None = None
    oda_file_converter_path: str | None = None
    config_dir: str = str(ROOT / "config")
    rules_dir: str = str(ROOT / "rules")


settings = Settings()
