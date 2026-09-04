"""API 계층 예외 → HTTP 상태 매핑. 라우터/유스케이스는 이 예외만 던진다."""
from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from packages.core.models.state import InvalidTransitionError, RevocationReasonRequiredError
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

    @app.exception_handler(RevocationReasonRequiredError)
    async def _revocation_reason_required(_: Request, exc: RevocationReasonRequiredError) -> JSONResponse:
        """ADR 0011 불변식 3 — CONFIRMED 이탈에 `evidence.note` 가 없다.

        **왜 `invalid_transition` 과 갈라야 하는가.** 이 예외는 `InvalidTransitionError` 하위 타입이라
        위 핸들러(MRO)로도 409 는 나간다. 그러나 그 code 의 화면 문구는 "현재 상태에서는 이 작업을 수행할 수
        없습니다. 화면을 새로고침해 최신 상태를 확인하세요."(`apps/web/src/components/ErrorBox.tsx`)이고,
        이 경우엔 **거짓**이다 — 전이는 허용 표에 있고(`state.py` `(CONFIRMED, MISMATCH)`·
        `(CONFIRMED, IN_PROGRESS)`), 새로고침해도 달라지지 않으며, CM 이 할 일은 **사유를 적는 것**이다.
        같은 409 를 여러 원인이 나눠 쓰면서 화면이 전부 같은 (틀린) 안내를 하던 것이 이 저장소가
        `code` 어휘를 만든 이유다(glossary "오류 응답 code" 서문 = reviewer 4차 지적 1). 같은 모양이
        다시 생기지 않게 여기서 고유 code 를 붙인다(CLAUDE.md §6-4 2: 경위는 기계 판독 값으로 싣는다).

        **상태코드는 409 를 유지한다.** 원인이 다르다고 상태코드를 바꾸면 `code` 를 모르는 기존
        클라이언트의 분기가 깨진다(glossary 서문: "신규 code 추가는 표에 행만 더하면 되고 기존 프론트
        분기를 깨지 않는다"). 그리고 이것은 요청 스키마 위반이 아니라 **대상의 현재 상태에 대한 요건**이다.

        **부가 필드도 유지한다.** glossary 부칙 "응답 모양 일관성"은 전이 거부 응답이 어느 경로로
        발생하든 `from_state`/`to_state`/`actor` 를 싣도록 요구한다. 이 응답은 그 요구를 계속 만족한다 —
        달라지는 것은 `code` 하나뿐이다.
        """
        return JSONResponse(status_code=409, content={"detail": str(exc), "code": "revocation_reason_required",
                                                      "from_state": exc.from_state.value,
                                                      "to_state": exc.to_state.value, "actor": exc.actor.value})

    @app.exception_handler(TransitionBlockedByReviewError)
    async def _blocked(_: Request, exc: TransitionBlockedByReviewError) -> JSONResponse:
        return JSONResponse(status_code=409, content={"detail": str(exc), "code": "transition_blocked_by_review",
                                                      "review_request_ids": exc.review_ids})

    @app.exception_handler(ObjectNotFoundError)
    async def _obj_not_found(_: Request, exc: ObjectNotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": f"object not found: {exc}", "code": "object_not_found"})
