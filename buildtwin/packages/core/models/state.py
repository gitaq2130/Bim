"""객체 상태기계 — ADR 0001 §3~5. 허용 전이 표 밖의 전이는 InvalidTransitionError."""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, model_validator

from .evidence import Evidence


class ObjectState(str, Enum):
    PLANNED = "PLANNED"
    REPORTED = "REPORTED"
    IN_PROGRESS = "IN_PROGRESS"
    ESTIMATED_DONE = "ESTIMATED_DONE"
    INSPECTION_REQUESTED = "INSPECTION_REQUESTED"
    CONFIRMED = "CONFIRMED"
    MISMATCH = "MISMATCH"
    UNVERIFIABLE = "UNVERIFIABLE"


class Actor(str, Enum):
    SYSTEM = "system"
    CONTRACTOR = "contractor"
    CM = "cm"


S = ObjectState
A = Actor

# (from, to) -> 허용 actor 집합. ADR 0001 §4 표와 1:1.
ALLOWED_TRANSITIONS: dict[tuple[ObjectState, ObjectState], frozenset[Actor]] = {
    (S.PLANNED, S.REPORTED): frozenset({A.CONTRACTOR}),
    (S.PLANNED, S.IN_PROGRESS): frozenset({A.SYSTEM}),
    (S.PLANNED, S.ESTIMATED_DONE): frozenset({A.SYSTEM}),
    (S.PLANNED, S.MISMATCH): frozenset({A.SYSTEM}),
    (S.PLANNED, S.UNVERIFIABLE): frozenset({A.SYSTEM}),
    (S.REPORTED, S.IN_PROGRESS): frozenset({A.SYSTEM, A.CONTRACTOR}),
    (S.REPORTED, S.ESTIMATED_DONE): frozenset({A.SYSTEM}),
    (S.REPORTED, S.INSPECTION_REQUESTED): frozenset({A.CONTRACTOR}),
    (S.REPORTED, S.MISMATCH): frozenset({A.SYSTEM}),
    (S.REPORTED, S.UNVERIFIABLE): frozenset({A.SYSTEM}),
    (S.IN_PROGRESS, S.ESTIMATED_DONE): frozenset({A.SYSTEM}),
    (S.IN_PROGRESS, S.INSPECTION_REQUESTED): frozenset({A.CONTRACTOR}),
    (S.IN_PROGRESS, S.MISMATCH): frozenset({A.SYSTEM}),
    (S.IN_PROGRESS, S.UNVERIFIABLE): frozenset({A.SYSTEM}),
    (S.ESTIMATED_DONE, S.INSPECTION_REQUESTED): frozenset({A.CONTRACTOR, A.SYSTEM}),
    (S.ESTIMATED_DONE, S.IN_PROGRESS): frozenset({A.SYSTEM}),
    (S.ESTIMATED_DONE, S.MISMATCH): frozenset({A.SYSTEM}),
    (S.ESTIMATED_DONE, S.UNVERIFIABLE): frozenset({A.SYSTEM}),
    (S.INSPECTION_REQUESTED, S.CONFIRMED): frozenset({A.CM}),
    (S.INSPECTION_REQUESTED, S.IN_PROGRESS): frozenset({A.CM}),
    (S.INSPECTION_REQUESTED, S.MISMATCH): frozenset({A.CM, A.SYSTEM}),
    (S.MISMATCH, S.IN_PROGRESS): frozenset({A.CM}),
    (S.MISMATCH, S.INSPECTION_REQUESTED): frozenset({A.CONTRACTOR}),
    (S.MISMATCH, S.ESTIMATED_DONE): frozenset({A.SYSTEM}),
    (S.UNVERIFIABLE, S.IN_PROGRESS): frozenset({A.SYSTEM}),
    (S.UNVERIFIABLE, S.ESTIMATED_DONE): frozenset({A.SYSTEM}),
    (S.UNVERIFIABLE, S.MISMATCH): frozenset({A.SYSTEM}),
    (S.UNVERIFIABLE, S.INSPECTION_REQUESTED): frozenset({A.CONTRACTOR}),
    (S.CONFIRMED, S.MISMATCH): frozenset({A.CM}),
    (S.CONFIRMED, S.IN_PROGRESS): frozenset({A.CM}),
}


class InvalidTransitionError(Exception):
    def __init__(self, from_state: ObjectState, to_state: ObjectState, actor: Actor, reason: str = ""):
        self.from_state, self.to_state, self.actor = from_state, to_state, actor
        super().__init__(f"{from_state.value} -> {to_state.value} by {actor.value} not allowed. {reason}".strip())


def validate_transition(from_state: ObjectState, to_state: ObjectState, actor: Actor) -> None:
    """불변식 1·2: CONFIRMED 진입/이탈은 cm만. 그 외는 표 기준."""
    if to_state == S.CONFIRMED and actor != A.CM:
        raise InvalidTransitionError(from_state, to_state, actor, "CONFIRMED requires actor=cm")
    if from_state == S.CONFIRMED and actor != A.CM:
        raise InvalidTransitionError(from_state, to_state, actor, "leaving CONFIRMED requires actor=cm")
    allowed = ALLOWED_TRANSITIONS.get((from_state, to_state))
    if not allowed or actor not in allowed:
        raise InvalidTransitionError(from_state, to_state, actor)


def allowed_targets(from_state: ObjectState, actor: Actor) -> list[ObjectState]:
    return [t for (f, t), actors in ALLOWED_TRANSITIONS.items() if f == from_state and actor in actors]


class StateTransition(BaseModel):
    transition_id: UUID = Field(default_factory=uuid4)
    global_id: str
    from_state: ObjectState
    to_state: ObjectState
    actor: Actor
    actor_id: str | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    evidence: Evidence
    review_request_id: UUID | None = None
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @model_validator(mode="after")
    def _check(self) -> "StateTransition":
        validate_transition(self.from_state, self.to_state, self.actor)
        if self.actor == A.SYSTEM and self.confidence is None:
            raise ValueError("system transitions require confidence")
        return self


UserRole = Literal["contractor", "cm", "client", "admin"]
