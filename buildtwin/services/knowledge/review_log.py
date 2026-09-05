"""전문가 검토 로그 — AI/규칙 제안(proposal) vs 사람 최종값(final)의 JSON diff를 저장한다.

`api`가 ReviewRequest 처리·매핑 확정·상태 확정 엔드포인트에서 `record_expert_review` 또는
`expert_review_recorder(entity_type)`를 호출한다. `ExpertReviewLogMiddleware`는 선택 사항이다.
"""
from __future__ import annotations

import json
import uuid
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from packages.core.models.knowledge import ExpertReviewLog
from packages.core.models.orm import ExpertReviewLogRow

__all__ = [
    "json_diff",
    "record_expert_review",
    "expert_review_recorder",
    "ExpertReviewLogMiddleware",
    "ProposalLookup",
]


def _jsonable(value: Any) -> Any:
    """pydantic/날짜 등을 JSON 호환 값으로."""
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")
    return json.loads(json.dumps(value, default=str, ensure_ascii=False))


def _join(path: str, key: Any) -> str:
    if isinstance(key, int):
        return f"{path}[{key}]"
    return f"{path}.{key}" if path else str(key)


def json_diff(before: Any, after: Any, path: str = "") -> list[dict[str, Any]]:
    """재귀 diff: [{path, op: add|remove|change, before, after}]. dict는 키별, list는 인덱스별로 비교."""
    out: list[dict[str, Any]] = []
    if isinstance(before, Mapping) and isinstance(after, Mapping):
        for k in before.keys() | after.keys():
            p = _join(path, k)
            if k not in after:
                out.append({"path": p, "op": "remove", "before": before[k], "after": None})
            elif k not in before:
                out.append({"path": p, "op": "add", "before": None, "after": after[k]})
            else:
                out.extend(json_diff(before[k], after[k], p))
        return sorted(out, key=lambda d: d["path"])
    if isinstance(before, list) and isinstance(after, list):
        for i in range(max(len(before), len(after))):
            p = _join(path, i)
            if i >= len(after):
                out.append({"path": p, "op": "remove", "before": before[i], "after": None})
            elif i >= len(before):
                out.append({"path": p, "op": "add", "before": None, "after": after[i]})
            else:
                out.extend(json_diff(before[i], after[i], p))
        return out
    if before != after:
        out.append({"path": path, "op": "change", "before": before, "after": after})
    return out


def record_expert_review(
    session: Session | None,
    entity_type: str,
    entity_id: str,
    proposal: Mapping[str, Any] | Any,
    final: Mapping[str, Any] | Any,
    reviewer: str,
) -> ExpertReviewLog:
    """diff를 계산해 ExpertReviewLog를 만들고, session이 있으면 expert_review_logs에 flush한다."""
    if not reviewer or not str(reviewer).strip():
        raise ValueError("reviewer is required")
    p, f = _jsonable(proposal), _jsonable(final)
    if not isinstance(p, dict) or not isinstance(f, dict):
        raise ValueError("proposal and final must be JSON objects")
    log = ExpertReviewLog(
        log_id=f"erl-{uuid.uuid4().hex}",
        entity_type=entity_type,
        entity_id=str(entity_id),
        proposal=p,
        final=f,
        diff=json_diff(p, f),
        reviewer=str(reviewer),
        reviewed_at=datetime.now(UTC),
    )
    if session is not None:
        session.add(
            ExpertReviewLogRow(
                log_id=log.log_id,
                entity_type=log.entity_type,
                entity_id=log.entity_id,
                proposal=log.proposal,
                final=log.final,
                diff=log.diff,
                reviewer=log.reviewer,
                reviewed_at=log.reviewed_at,
            )
        )
        session.flush()
    return log


Recorder = Callable[[Session | None, str, Any, Any, str], ExpertReviewLog]


def expert_review_recorder(entity_type: str) -> Recorder:
    """엔티티 종류를 고정한 기록 함수. 사용: rec = expert_review_recorder("review_request"); rec(session, id, proposal, final, reviewer)."""

    def _record(session: Session | None, entity_id: str, proposal: Any, final: Any, reviewer: str) -> ExpertReviewLog:
        return record_expert_review(session, entity_type, entity_id, proposal, final, reviewer)

    _record.__name__ = f"record_{entity_type}_review"
    return _record


# proposal_id → {"entity_type": str, "entity_id": str, "proposal": dict} | None
ProposalLookup = Callable[[str], Mapping[str, Any] | None]


class ExpertReviewLogMiddleware(BaseHTTPMiddleware):
    """선택적 미들웨어. 헤더 `X-Proposal-Id`가 있는 JSON 쓰기 요청이 2xx로 끝나면 본문을 `final`로 저장한다.

    - proposal_lookup(proposal_id) → {entity_type, entity_id, proposal} (없으면 None → 무시)
    - session_factory() → sqlalchemy Session (commit/close는 미들웨어가 수행)
    - reviewer는 `X-Reviewer` 헤더 → request.state.user_id → "unknown" 순.
    """

    def __init__(
        self,
        app: Any,
        proposal_lookup: ProposalLookup,
        session_factory: Callable[[], Session] | None = None,
        header: str = "X-Proposal-Id",
        reviewer_header: str = "X-Reviewer",
        on_record: Callable[[ExpertReviewLog], None] | None = None,
    ) -> None:
        super().__init__(app)
        self.proposal_lookup = proposal_lookup
        self.session_factory = session_factory
        self.header = header
        self.reviewer_header = reviewer_header
        self.on_record = on_record

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        proposal_id = request.headers.get(self.header)
        if not proposal_id or request.method not in ("POST", "PUT", "PATCH"):
            return await call_next(request)
        try:
            body = json.loads(await request.body() or b"null")
        except ValueError:
            body = None
        response = await call_next(request)
        if not isinstance(body, dict) or not (200 <= response.status_code < 300):
            return response
        found = self.proposal_lookup(proposal_id)
        if not found:
            return response
        reviewer = request.headers.get(self.reviewer_header) or getattr(request.state, "user_id", None) or "unknown"
        session = self.session_factory() if self.session_factory else None
        try:
            log = record_expert_review(
                session, str(found["entity_type"]), str(found["entity_id"]), found.get("proposal") or {}, body, reviewer
            )
            if session is not None:
                session.commit()
        except Exception:
            if session is not None:
                session.rollback()
            raise
        finally:
            if session is not None:
                session.close()
        if self.on_record:
            self.on_record(log)
        return response
