"""객체 상태기계 — ADR 0001 §3~5. 허용 전이 표 밖의 전이는 InvalidTransitionError."""
from __future__ import annotations

from datetime import UTC, datetime
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


class RevocationReasonRequiredError(InvalidTransitionError):
    """불변식 3(ADR 0011): CONFIRMED 이탈인데 `evidence.note` 가 비었다.

    **왜 별도 타입인가 — 이 예외를 누가 읽는지 끝까지 따라간 결과다(CLAUDE.md §6-3).**

    ① 평범한 `ValueError` 로 두면 pydantic 이 `ValidationError` 로 감싸는데, `services/api/errors.py`
       에는 그 핸들러가 없다(핸들러는 ApiError·HTTPException·InvalidTransitionError·
       TransitionBlockedByReviewError·ObjectNotFoundError 다섯뿐). 실측: 500 + **기계 판독 `code` 없음**
       — "모든 오류 응답에 code" 규칙 위반이고, 화면은 원인별 안내를 고를 수 없다. 바로 위
       `system transitions require confidence` 가 이미 이 상태인데(선존재 결함), 그쪽은 서비스가 항상
       confidence 를 채워 실제로는 도달하지 않는다. 불변식 3 은 **CM 이 버튼을 눌러 도달한다** —
       같은 형태를 늘리면 안 된다.
    ② `InvalidTransitionError` 를 상속하므로 Starlette 이 MRO 로 기존 핸들러를 찾아
       **409 + `code="invalid_transition"` + from_state/to_state/actor** 로 나간다. 500 은 나지 않는다.
    ③ 그런데 `invalid_transition` 의 화면 문구는 "현재 상태에서는 이 작업을 수행할 수 없습니다.
       화면을 새로고침해 최신 상태를 확인하세요."(`apps/web/src/components/ErrorBox.tsx:23`)다. 이 경우엔
       **거짓**이다 — 전이는 허용 표에 있고, 새로고침해도 달라지지 않으며, CM 이 할 일은 사유를 적는
       것이다. §6-4 대로 이 문구는 이 사이클이 고쳐야 한다. 그래서 타입을 나눠 두어
       `services/api/errors.py` 가 **`packages/core/models/` 를 건드리지 않고** 전용 핸들러로 고유
       `code`(예: `revocation_reason_required`)를 붙일 수 있게 했다. 그 후속이 오기 전까지는 ②의
       일반 코드로 나간다.
    """

    def __init__(self, from_state: ObjectState, to_state: ObjectState, actor: Actor):
        super().__init__(from_state, to_state, actor,
                         "leaving CONFIRMED requires evidence.note (revocation reason)")


def validate_transition(from_state: ObjectState, to_state: ObjectState, actor: Actor) -> None:
    """불변식 1·2: CONFIRMED 진입/이탈은 cm만. 그 외는 표 기준.

    **여기가 전이 규칙의 전부가 아니다.** 근거(`evidence`)에 걸리는 불변식 3(CONFIRMED 이탈에는 사유 —
    ADR 0011)은 이 함수가 `evidence` 를 받지 않으므로 `StateTransition._check` 에 있다. CONFIRMED 이탈
    경로를 새로 만들 때는 그쪽도 함께 본다.
    """
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
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @model_validator(mode="after")
    def _check(self) -> StateTransition:
        validate_transition(self.from_state, self.to_state, self.actor)
        if self.actor == A.SYSTEM and self.confidence is None:
            raise ValueError("system transitions require confidence")
        # 불변식 3 (ADR 0011): CONFIRMED **이탈**에는 사유가 있어야 한다.
        #
        # CONFIRMED 는 이 제품에서 AI 가 도달할 수 없고 사람(CM)만 도달하는 유일한 상태이고(CLAUDE.md §0),
        # 그 승인을 무효화하는 행위(`revoke_confirmation` = CONFIRMED→MISMATCH, `order_rework` =
        # CONFIRMED→IN_PROGRESS — `services/progress/state_machine.py::_action_kind`)는 승인 자체와 같은
        # 무게의 감사 대상이다. 그런데 실측(2026-09-04)에서 둘 다 note 없이 201 로 통과했고 감사 이력에
        # `note: None` 이 남았다 — 전이는 기록됐는데 **이유만 사라졌다**. 화면은 그 반대를 약속하고 있었다
        # ("되돌리려면 사유가 필요합니다", ADR 0011 §1).
        #
        # 왜 여기인가. `StateTransition` 은 `evidence` 를 필수 필드로 들고 있고, 이 검증자는 저장소의
        # 모든 전이 생성 경로가 반드시 지나는 유일한 병목이다(운영 구성 지점은
        # `services/progress/state_machine.py::transition_with_effects` 하나). 서비스 층에 두면 앞으로
        # 생길 다른 경로가 이 방어를 받지 못한다. 바로 위 `system transitions require confidence` 가
        # 같은 자리·같은 형태의 선례다.
        #
        # 왜 `validate_transition` 이 아닌가. 그 함수는 `evidence` 를 받지 않고, `allowed_targets` 를 통해
        # `next_actions` 생성에도 쓰이며(`state_machine.py:296`) `tests/invariants` 가 3인자로 부른다.
        # 근거를 들고 있지 않은 함수에 근거 요건을 넣는 것은 자리가 틀렸다 — 시그니처를 바꾸지 않는다.
        #
        # 한정어 셋의 근거(ADR 0011 §Decision 역방향 확인 표):
        #   - `from_state == CONFIRMED` — **진입에는 걸지 않는다.** 검측 승인은 검토요청 큐
        #     (`resolve_review`, kind="inspection")로도 일어나는 CM 상시 업무라, 진입까지 필수로 만들면
        #     정상 업무를 막는다(ADR 0011 §Deferred 1). 또 모든 전이에 걸면 스캔·작업일보가 만드는
        #     `system` 전이가 통째로 막힌다.
        #   - `.strip()` — 빈 문자열이 실제로 오는 경로가 있다. 실측: `note=""` 로도 201 이었고,
        #     화면 `ConfirmDialog` 는 `onConfirm(note.trim())` 으로 빈 문자열을 그대로 보낸다.
        #   - `evidence.note`(요청 최상위 `note` 가 아니라) — 서버 `TransitionRequest` 에는 최상위 `note`
        #     필드도 있지만 `services/api/usecases.py::_evidence_from_request` 가 그것을 `evidence.note` 로
        #     합류시킨다. 따라서 두 채널 중 어느 쪽으로 와도 이 한 곳에서 걸린다.
        #
        # 예외 타입은 `RevocationReasonRequiredError`(위 정의) — `ValueError` 로 두면 pydantic 이
        # `ValidationError` 로 감싸고 `services/api/errors.py` 에 그 핸들러가 없어 **500 + code 없음**이
        # 된다(실측). 자세한 근거는 그 클래스 docstring.
        if self.from_state == S.CONFIRMED and not (self.evidence.note or "").strip():
            raise RevocationReasonRequiredError(self.from_state, self.to_state, self.actor)
        return self


UserRole = Literal["contractor", "cm", "client", "admin"]
