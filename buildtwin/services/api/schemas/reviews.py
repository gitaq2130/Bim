from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, model_validator

from packages.core.models.review import ReviewRequest

ReviewDecision = Literal["approved", "rejected", "on_hold"]


class ResolveRequest(BaseModel):
    """프론트엔드는 `decision` 을 보낸다. `action` 도 동의어로 허용."""
    decision: ReviewDecision | None = None
    action: ReviewDecision | None = None
    note: str | None = None

    @model_validator(mode="after")
    def _one(self) -> ResolveRequest:
        if self.decision is None and self.action is None:
            raise ValueError("decision is required (approved | rejected | on_hold)")
        return self

    @property
    def resolved_decision(self) -> ReviewDecision:
        return self.decision or self.action  # type: ignore[return-value]


ReviewRequestView = ReviewRequest
