"""API 계층 예외 → HTTP 상태 매핑. 라우터/유스케이스는 이 예외만 던진다."""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from packages.core.models.state import InvalidTransitionError
from services.progress.state_machine import ObjectNotFoundError, TransitionBlockedByReviewError


class ApiError(Exception):
    status_code = 400

    def __init__(self, detail: str):
        self.detail = detail
        super().__init__(detail)


class NotFound(ApiError):
    status_code = 404


class Forbidden(ApiError):
    status_code = 403


class Conflict(ApiError):
    status_code = 409


class Unprocessable(ApiError):
    status_code = 422


class UnsupportedMedia(ApiError):
    status_code = 415


def install_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    @app.exception_handler(InvalidTransitionError)
    async def _invalid_transition(_: Request, exc: InvalidTransitionError) -> JSONResponse:
        return JSONResponse(status_code=409, content={"detail": str(exc), "from_state": exc.from_state.value,
                                                      "to_state": exc.to_state.value, "actor": exc.actor.value})

    @app.exception_handler(TransitionBlockedByReviewError)
    async def _blocked(_: Request, exc: TransitionBlockedByReviewError) -> JSONResponse:
        return JSONResponse(status_code=409, content={"detail": str(exc), "review_request_ids": exc.review_ids})

    @app.exception_handler(ObjectNotFoundError)
    async def _obj_not_found(_: Request, exc: ObjectNotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": f"object not found: {exc}"})
