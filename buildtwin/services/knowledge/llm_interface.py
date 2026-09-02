"""LLM 추론 인터페이스 — 인터페이스만 정의한다. MVP에서는 호출 구현 금지(NullReasoningProvider만)."""
from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel, Field

from packages.core.models.knowledge import CaseRecord, Rule, RuleVerdict

__all__ = ["ReasoningContext", "ReasoningProvider", "NullReasoningProvider"]


class ReasoningContext(BaseModel):
    """추론 요청 컨텍스트. 규칙 엔진 컨텍스트 + 이미 낸 규칙 판정 + 관련 사례."""

    project_id: str | None = None
    global_id: str | None = None
    activity_id: str | None = None
    context: dict[str, Any] = Field(default_factory=dict)      # RuleEngine.evaluate와 같은 키(scan/object/…)
    rule_verdicts: list[RuleVerdict] = Field(default_factory=list)
    related_cases: list[CaseRecord] = Field(default_factory=list)
    candidate_rules: list[Rule] = Field(default_factory=list)
    question: str | None = None


@runtime_checkable
class ReasoningProvider(Protocol):
    def suggest(self, context: ReasoningContext) -> list[RuleVerdict]: ...


class NullReasoningProvider:
    """항상 빈 목록. LLM을 붙이기 전 기본 구현."""

    def suggest(self, context: ReasoningContext) -> list[RuleVerdict]:
        return []
