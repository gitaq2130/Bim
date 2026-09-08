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

    그래서 **빈 DB 로 이 앱을 띄우면 계정이 하나도 없다** — 그 상태에서 첫 계정을 만드는 것은
    `POST /api/auth/register` 의 부트스트랩(`auth/router.py` 의 `users_count(session) == 0` 갈래)이고,
    그 자리의 처분을 여는 항목이 계획 0014 §후속 67 이다(이 커밋은 그것을 닫지 않는다).
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
