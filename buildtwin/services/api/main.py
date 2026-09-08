"""FastAPI 앱 팩토리. `uvicorn services.api.main:app`. 모든 라우터는 `/api` 아래(프론트가 /api 를 프록시)."""
from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from packages.core import db as core_db
from packages.core.settings import settings

from .auth import router as auth_router
from .errors import install_handlers
from .routers import ALL_ROUTERS

API_PREFIX = "/api"
APP_VERSION = "0.1.0"


def init_database() -> None:
    """settings.database_url 로 엔진 초기화(테이블 생성)**만** 한다.

    데모 계정·데모 프로젝트는 기동의 부수 효과가 아니라 **명시적 명령**이 만든다
    (ADR 0018 §2-1·§2-2 — `python -m services.api.seed`, `make seed`). 같은 프로세스 안에서 부르는
    소비자는 `services.api.seed.seed_all(session)` 을 쓴다(`tests/integration`·`tests/e2e` 의 픽스처).

    그래서 **빈 DB 로 이 앱을 띄우면 계정이 하나도 없고, 아무도 로그인할 수 없다** — 그 상태를 벗어나는
    경로는 위 명령 하나다. `POST /api/auth/register` 는 인증 없이 부를 수 없다(403 `forbidden_role`,
    ADR 0019 §2-1) — 기동이 계정을 만들지 않아도 그 DB 가 네트워크에 열리지 않는 이유가 그것이다.
    """
    url = settings.database_url
    core_db.init_db(None if core_db.database_url() == url and core_db._engine is not None else url)


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
