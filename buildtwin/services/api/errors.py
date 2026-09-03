"""API 계층 예외 → HTTP 상태 매핑. 라우터/유스케이스는 이 예외만 던진다."""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from packages.core.models.state import InvalidTransitionError
from services.progress.state_machine import ObjectNotFoundError, TransitionBlockedByReviewError


class ApiError(Exception):
    """모든 API 예외의 기반. `code` 는 클라이언트가 원인을 구분할 수 있는 안정적인 식별자(snake_case)로,
    `detail` (사람이 읽는 문자열) 과 함께 응답 본문에 실린다. 각 서브클래스는 해당 상태코드의 기본 code 를
    갖고, 호출부는 `code=` 인자로 더 구체적인 값을 지정할 수 있다(docs/glossary.md 의 코드 표 참고)."""

    status_code = 400
    code = "bad_request"

    def __init__(self, detail: str, code: str | None = None):
        self.detail = detail
        if code is not None:
            self.code = code
        super().__init__(detail)


class NotFound(ApiError):
    status_code = 404
    code = "object_not_found"


class Forbidden(ApiError):
    status_code = 403
    code = "forbidden_role"


class Conflict(ApiError):
    status_code = 409
    code = "conflict"


class Unprocessable(ApiError):
    status_code = 422
    code = "unprocessable_entity"


class UnsupportedMedia(ApiError):
    status_code = 415
    code = "unsupported_media_type"


def install_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail, "code": exc.code})

    @app.exception_handler(InvalidTransitionError)
    async def _invalid_transition(_: Request, exc: InvalidTransitionError) -> JSONResponse:
        return JSONResponse(status_code=409, content={"detail": str(exc), "code": "invalid_transition",
                                                      "from_state": exc.from_state.value,
                                                      "to_state": exc.to_state.value, "actor": exc.actor.value})

    @app.exception_handler(TransitionBlockedByReviewError)
    async def _blocked(_: Request, exc: TransitionBlockedByReviewError) -> JSONResponse:
        return JSONResponse(status_code=409, content={"detail": str(exc), "code": "transition_blocked_by_review",
                                                      "review_request_ids": exc.review_ids})

    @app.exception_handler(ObjectNotFoundError)
    async def _obj_not_found(_: Request, exc: ObjectNotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": f"object not found: {exc}", "code": "object_not_found"})
