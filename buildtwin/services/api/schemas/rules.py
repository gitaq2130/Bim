from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from packages.core.models.knowledge import RuleVerdict


class RuleEvaluateRequest(BaseModel):
    global_id: str = Field(min_length=1)
    persist: bool = True


class RuleEvaluateResponse(BaseModel):
    project_id: str
    global_id: str
    verdicts: list[RuleVerdict]
    context: dict[str, Any] = Field(default_factory=dict)   # 평가에 쓴 컨텍스트 요약(scan/object/logic)
    rules_evaluated: int
