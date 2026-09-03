"""API 계층 예외 → HTTP 상태 매핑. 라우터/유스케이스는 이 예외만 던진다."""
from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException, Request
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
    # 중립 기본값. 구체적 원인(object/drawing/job/...)은 호출부가 반드시 code= 로 지정한다 — 이 기본값이
    # 응답에 나온다면 어떤 raise NotFound(...) 가 code 지정을 빠뜨렸다는 뜻(reviewer 5차 지적 1).
    code = "not_found"


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


class ServerError(ApiError):
    """서버(우리 쪽) 상태가 예상과 다를 때 — 클라이언트 요청은 문제 없지만 저장된 데이터가 손상/불일치함을
    보고한다(reviewer 5차 지적 4). 4xx 로 위장하지 않는다."""

    status_code = 500
    code = "internal_error"


def install_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail, "code": exc.code})

    @app.exception_handler(HTTPException)
    async def _http_exception(_: Request, exc: HTTPException) -> JSONResponse:
        """FastAPI/스타레트 기본 HTTPException(현재는 auth 의 401 뿐)에도 code 를 싣는다(reviewer 5차 지적 3).
        detail 문구·상태코드는 그대로 두고 code 만 얹는다 — 매핑 밖 상태코드는 기존처럼 code 없이 detail 만."""
        content: dict[str, Any] = {"detail": exc.detail}
        if exc.status_code == 401:
            content["code"] = "unauthorized"
        return JSONResponse(status_code=exc.status_code, content=content, headers=exc.headers)

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
