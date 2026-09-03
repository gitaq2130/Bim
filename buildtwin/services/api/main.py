"""FastAPI 앱 팩토리. `uvicorn services.api.main:app`. 모든 라우터는 `/api` 아래(프론트가 /api 를 프록시)."""
from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from packages.core import db as core_db
from packages.core.settings import settings

from .auth import router as auth_router
from .auth.seed import seed_dev_project, seed_dev_users
from .errors import install_handlers
from .routers import ALL_ROUTERS

log = logging.getLogger(__name__)
API_PREFIX = "/api"
APP_VERSION = "0.1.0"


def init_database() -> None:
    """settings.database_url 로 엔진 초기화(테이블 생성). sqlite 개발 DB 면 데모 사용자 시드."""
    url = settings.database_url
    core_db.init_db(None if core_db.database_url() == url and core_db._engine is not None else url)
    if url.startswith("sqlite"):
        with core_db.session_scope() as s:
            created = seed_dev_users(s)
            if created:
                log.info("seeded %d dev users (%s)", len(created), ", ".join(u.email for u in created))
                project = seed_dev_project(s, created)   # ADR 0006: 데모 프로젝트 멤버십(admin 제외)
                if project is not None:
                    log.info("seeded dev project %s with member roles for contractor/cm/client", project.project_id)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    init_database()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="BuildTwin API", version=APP_VERSION, lifespan=lifespan,
                  description="건설 PM/CM 용 계획·신고·물리증거·전문가판단·승인 상태 비교 API. 모든 판정 응답은 confidence·evidence 를 포함한다.")
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_allow_origins), allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"])
    install_handlers(app)
    api = APIRouter(prefix=API_PREFIX)

    @api.get("/health", tags=["meta"])
    def health() -> dict[str, str]:
        return {"status": "ok", "version": APP_VERSION}

    api.include_router(auth_router)
    for r in ALL_ROUTERS:
        api.include_router(r)
    app.include_router(api)
    return app


app = create_app()
