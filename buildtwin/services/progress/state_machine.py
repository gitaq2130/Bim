"""ADR 0001 객체 상태기계. 전이 규칙은 packages.core.models.state 를 그대로 쓴다(재정의 금지).

- transition(): validate_transition + 불변식 4(미결 verification 검토요청 시 system 전이 차단) + 행 기록.
- apply_scan_verdict(): ScanState → ObjectState 를 system actor 로. NOT_BUILT 은 전이 없음. 표에 없으면 None.
- apply_daily_report(): contractor actor 로 REPORTED / IN_PROGRESS, 완료 신고는 3중 검증 통과 시에만 INSPECTION_REQUESTED.
- 검측 ReviewRequest(kind=inspection) 생명주기(ADR 0001 §6, CLAUDE.md §3-11): INSPECTION_REQUESTED 진입 시 생성,
  cm 의 CONFIRMED/IN_PROGRESS/MISMATCH 전이 시 종료(approved/rejected). API 는 호출만 한다.
- 프로젝트 역할→actor 매핑(ADR 0001 §4-1, ADR 0006 §2·규칙 7): contractor→contractor, cm→cm 뿐. 아래
  `actor_for_role`/`next_actions`가 받는 `role`은 `project_members.role`(그 프로젝트에서의 역할)이며 전역
  `users.role`(시스템 역할)이 아니다 — 호출자(`services/api/usecases.py`)가 `caller_project_role()`로 구한 값을
  넘긴다. client 는 물론 admin 도 이 함수로는 행위 역할을 얻지 못한다: admin 은 애초에 어떤 프로젝트의 멤버도
  될 수 없으므로(ADR 0006 §2-1) 여기 들어오는 role 값 자체가 admin 일 수 없고, 설령 들어와도 ROLE_TO_ACTOR 에
  키가 없어 RoleNotAllowedError(→ API 403)이다.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.orm import Session

from packages.core.models.evidence import Evidence
from packages.core.models.orm import BimObjectRow, StateTransitionRow
from packages.core.models.progress import DailyReport, DailyReportItem
from packages.core.models.review import ReviewRequest
from packages.core.models.scan import ScanState, ScanVerdict
from packages.core.models.state import (
    ALLOWED_TRANSITIONS,
    Actor,
    ObjectState,
    StateTransition,
    allowed_targets,
    validate_transition,
)

from . import persistence as db
from .verification import build_logic_context, run_verification

log = logging.getLogger(__name__)


class ObjectNotFoundError(LookupError):
    pass


class RoleNotAllowedError(PermissionError):
    """ADR 0001 §4-1: 프로젝트 역할(project role) client 는 상태 전이·검측 승인·검토요청 처리 권한이 없다.
    admin 은 프로젝트 역할 자체를 가질 수 없으므로(ADR 0006 §2-1) 여기 오는 값은 client 뿐이거나, 멤버가
    아니라 프로젝트 역할이 없는 호출(빈 문자열 등)이다 — 어느 쪽이든 ROLE_TO_ACTOR 에 없어 이 예외가 난다
    (API 는 403 으로 매핑)."""

    def __init__(self, role: str):
        self.role = role
        super().__init__(f"role {role!r} cannot act on object state (allowed: contractor, cm)")


class TransitionBlockedByReviewError(Exception):
    """ADR 0001 불변식 4: 미결 verification ReviewRequest 가 있는 객체는 system 전이 불가."""

    def __init__(self, global_id: str, review_ids: list[str]):
        self.global_id, self.review_ids = global_id, review_ids
        super().__init__(f"{global_id}: system transition blocked by open verification review(s) {review_ids}")


SCAN_TO_OBJECT_STATE: dict[ScanState, ObjectState | None] = {
    ScanState.NOT_BUILT: None,
    ScanState.IN_PROGRESS: ObjectState.IN_PROGRESS,
    ScanState.ESTIMATED_DONE: ObjectState.ESTIMATED_DONE,
    ScanState.MISMATCH: ObjectState.MISMATCH,
    ScanState.UNVERIFIABLE: ObjectState.UNVERIFIABLE,
}
CLAIMED_TO_OBJECT_STATE: dict[str, ObjectState] = {
    "started": ObjectState.REPORTED,
    "in_progress": ObjectState.IN_PROGRESS,
    "completed": ObjectState.INSPECTION_REQUESTED,
}
# 키는 프로젝트 역할(project role, project_members.role) — 전역 users.role 이 아니다(ADR 0006 §2·규칙 7).
# ADR 0001 §4-1: contractor/cm 만 행위 actor 를 가진다. client 는 프로젝트 역할이지만 없고, admin 은 애초에
# 프로젝트 역할이 될 수 없어(ADR 0006 §2-1) 여기 등장할 수조차 없다.
ROLE_TO_ACTOR: dict[str, Actor] = {"contractor": Actor.CONTRACTOR, "cm": Actor.CM}
ACTOR_TO_ROLES: dict[Actor, list[str]] = {Actor.CONTRACTOR: ["contractor"], Actor.CM: ["cm"], Actor.SYSTEM: []}
NEXT_ACTION_KINDS: frozenset[str] = frozenset({
    "confirm", "request_inspection", "reject_inspection", "report_progress", "accept_rework", "order_rework",
    "revoke_confirmation", "flag_mismatch", "resolve_review", "align_scan", "inspect",
})   # docs/glossary.md "다음 행동 종류" 와 1:1
INSPECTION_DECISIONS: dict[ObjectState, str] = {ObjectState.CONFIRMED: "approved", ObjectState.IN_PROGRESS: "rejected",
                                                ObjectState.MISMATCH: "rejected"}


def actor_for_role(role: str) -> Actor:
    """프로젝트 역할(project role, `project_members.role`) → Actor. 전역 `users.role`(시스템 역할)을 받는
    함수가 아니다 — 호출자는 `caller_project_role()`로 구한 값을 넘겨야 한다(ADR 0006 §2·규칙 7). client 와,
    프로젝트 역할이 없는 호출(빈 문자열 등)은 RoleNotAllowedError. admin 은 애초에 프로젝트 역할을 가질 수
    없으므로(ADR 0006 §2-1) 이 함수에 도달할 role 값이 될 수 없다 — 그럼에도 들어온다면 ROLE_TO_ACTOR 에
    키가 없어 마찬가지로 RoleNotAllowedError 다."""
    actor = ROLE_TO_ACTOR.get(str(role).lower())
    if actor is None:
        raise RoleNotAllowedError(role)
    return actor


@dataclass
class TransitionResult:
    transition: StateTransition
    created_review_ids: list[str] = field(default_factory=list)   # 생성된 inspection ReviewRequest id
    closed_review_ids: list[str] = field(default_factory=list)    # 종료된 inspection ReviewRequest id


def ensure_inspection_review(session: Session, project_id: str, global_id: str, transition: StateTransition) -> list[str]:
    """INSPECTION_REQUESTED 진입 시 미결 inspection 검토요청이 없으면 하나 만든다. 생성된 id 목록을 돌려준다."""
    if transition.to_state != ObjectState.INSPECTION_REQUESTED:
        return []
    if db.open_reviews(session, project_id, [global_id], kind="inspection"):
        return []
    row = session.get(BimObjectRow, (project_id, global_id))
    if row is None:
        raise ObjectNotFoundError(global_id)
    review = ReviewRequest(
        project_id=row.project_id, kind="inspection", global_id=global_id,
        title=f"검측 요청: {row.name or global_id} ({row.ifc_type}, {row.level or '-'})",
        confidence=transition.confidence if transition.confidence is not None else 1.0,
        evidence=transition.evidence, assignee_role="cm",
        conflicting_sources={"transition_id": str(transition.transition_id), "actor": transition.actor.value,
                             "from_state": transition.from_state.value},
    )
    db.save_review_request(session, review)
    return [str(review.review_request_id)]


def close_inspection_reviews(session: Session, project_id: str, global_id: str, transition: StateTransition) -> list[str]:
    """cm 이 INSPECTION_REQUESTED 에서 CONFIRMED(approved) / IN_PROGRESS·MISMATCH(rejected) 로 전이하면 미결 inspection 요청을 닫는다."""
    if transition.actor != Actor.CM or transition.from_state != ObjectState.INSPECTION_REQUESTED:
        return []
    status = INSPECTION_DECISIONS.get(transition.to_state)
    if status is None:
        return []
    closed: list[str] = []
    for review in db.open_reviews(session, project_id, [global_id], kind="inspection"):
        review.status = status
        review.resolved_by = transition.actor_id
        review.resolved_at = datetime.now(UTC)
        review.resolution_note = (f"{transition.from_state.value} -> {transition.to_state.value} by cm"
                                  f"{f' ({transition.actor_id})' if transition.actor_id else ''}; transition_id={transition.transition_id}")
        closed.append(review.review_request_id)
    session.flush()
    return closed


@dataclass
class DailyReportOutcome:
    report_id: str
    transitions: list[StateTransition] = field(default_factory=list)
    review_requests: list[ReviewRequest] = field(default_factory=list)      # 3중 검증(verification) 검토요청
    inspection_review_ids: list[str] = field(default_factory=list)         # 자동 생성된 inspection 검토요청 id
    skipped: list[dict] = field(default_factory=list)


class ObjectStateMachine:
    def _load(self, session: Session, project_id: str, global_id: str) -> BimObjectRow:
        row = session.get(BimObjectRow, (project_id, global_id))
        if row is None:
            raise ObjectNotFoundError(global_id)
        return row

    def transition_with_effects(self, session: Session, project_id: str, global_id: str, to_state: ObjectState | str,
                                actor: Actor | str, evidence: Evidence, actor_id: str | None = None,
                                confidence: float | None = None,
                                review_request_id: UUID | str | None = None) -> TransitionResult:
        """전이 + 부수효과(검측 ReviewRequest 생성/종료). 생성·종료된 검토요청 id 를 함께 돌려준다."""
        row = self._load(session, project_id, global_id)
        from_state, to_state, actor = ObjectState(row.state), ObjectState(to_state), Actor(actor)
        validate_transition(from_state, to_state, actor)
        if actor == Actor.SYSTEM:
            open_reviews = db.open_reviews(session, project_id, [global_id], kind="verification")
            if open_reviews:
                raise TransitionBlockedByReviewError(global_id, [r.review_request_id for r in open_reviews])
        rid = UUID(str(review_request_id)) if review_request_id else None
        transition = StateTransition(global_id=global_id, from_state=from_state, to_state=to_state, actor=actor,
                                     actor_id=actor_id, confidence=confidence, evidence=evidence, review_request_id=rid)
        session.add(StateTransitionRow(
            transition_id=str(transition.transition_id), global_id=global_id, project_id=project_id,
            from_state=from_state.value, to_state=to_state.value, actor=actor.value, actor_id=actor_id,
            confidence=confidence, evidence=evidence.model_dump(mode="json"), review_request_id=str(rid) if rid else None,
            occurred_at=transition.occurred_at,
        ))
        row.state = to_state.value
        session.flush()
        closed = close_inspection_reviews(session, project_id, global_id, transition)
        created = ensure_inspection_review(session, project_id, global_id, transition)
        return TransitionResult(transition=transition, created_review_ids=created, closed_review_ids=closed)

    def transition(self, session: Session, project_id: str, global_id: str, to_state: ObjectState | str,
                   actor: Actor | str, evidence: Evidence, actor_id: str | None = None, confidence: float | None = None,
                   review_request_id: UUID | str | None = None) -> StateTransition:
        """transition_with_effects 와 같되 StateTransition 만 돌려준다(부수효과는 동일하게 적용)."""
        return self.transition_with_effects(session, project_id, global_id, to_state, actor, evidence, actor_id=actor_id,
                                            confidence=confidence, review_request_id=review_request_id).transition

    # ---------------------------------------------------------------- scan
    def apply_scan_verdict(self, session: Session, project_id: str, verdict: ScanVerdict) -> StateTransition | None:
        target = SCAN_TO_OBJECT_STATE[verdict.state]
        if target is None:
            return None
        row = self._load(session, project_id, verdict.global_id)
        from_state = ObjectState(row.state)
        if from_state == target or Actor.SYSTEM not in ALLOWED_TRANSITIONS.get((from_state, target), frozenset()):
            return None
        try:
            return self.transition(session, project_id, verdict.global_id, target, Actor.SYSTEM, verdict.evidence,
                                   actor_id=verdict.scan_id, confidence=verdict.confidence)
        except TransitionBlockedByReviewError as exc:
            log.info("scan verdict not applied: %s", exc)
            return None

    # ---------------------------------------------------------------- daily report
    def _resolve_global_ids(self, session: Session, project_id: str, item: DailyReportItem) -> tuple[list[str], str | None]:
        """(global_ids, skip_reason). item.activity_id 가 report 의 project 소속이 아니면 매핑을 끌어오지 않고
        skip_reason 을 채운다 — ADR 0005 규칙 2 위반(라운드3 리뷰 FAIL: activity_id 미검증으로 타 프로젝트 객체 전이)."""
        if item.global_id:
            return [item.global_id], None
        if item.activity_id:
            # ADR 0008 규칙 2: (project_id, activity_id) 로 읽는다. 남의 프로젝트 Activity 는 애초에
            # 조회되지 않으므로 None 이 곧 "이 신고서의 프로젝트에 그 Activity 가 없다"는 뜻이고,
            # 그 사실을 skip_reason 으로 남긴다(예전에는 행을 읽은 뒤 project_id 를 비교해 남겼다).
            # 어느 프로젝트 소속인지는 **의도적으로 말하지 않는다** — 존재를 흘리지 않는다(ADR 0006 규칙 2 와 같은 결).
            activity = db.load_activity(session, project_id, item.activity_id)
            if activity is None:
                return [], (f"activity {item.activity_id!r} not found in report project {project_id!r}")
            if activity.project_id != project_id:   # 복합 키상 도달 불가 — 규칙 위반을 조용히 넘기지 않는 이중 방어
                return [], (f"activity {item.activity_id!r} belongs to project {activity.project_id!r}, "
                           f"not report project {project_id!r}")
            return db.mapped_global_ids(session, project_id, item.activity_id), None
        return [], None

    def apply_daily_report(self, session: Session, report: DailyReport) -> DailyReportOutcome:
        """ADR 0005 규칙 1: project_id 는 report.project_id 에서 유도한다(시그니처는 그대로)."""
        project_id = report.project_id
        db.save_daily_report(session, report)
        outcome = DailyReportOutcome(report_id=report.report_id)
        for index, item in enumerate(report.items):
            gids, skip_reason = self._resolve_global_ids(session, project_id, item)
            if skip_reason is not None:
                outcome.skipped.append({"item": index, "reason": skip_reason})
                continue
            if not gids:
                outcome.skipped.append({"item": index, "reason": "no global_id or mapped objects"})
                continue
            for gid in gids:
                row = session.get(BimObjectRow, (project_id, gid))
                if row is None:
                    outcome.skipped.append({"item": index, "global_id": gid, "reason": "object not found"})
                    continue
                scan_row = db.latest_scan_verdict(session, project_id, gid)
                scan = ScanVerdict(scan_id=scan_row.scan_id, global_id=gid, state=ScanState(scan_row.state),
                                   confidence=scan_row.confidence, evidence=Evidence(**scan_row.evidence)) if scan_row else None
                logic = build_logic_context(session, project_id, gid, quantity_unit=item.quantity_unit)
                reviews = run_verification(session, project_id, gid, item, scan, logic)
                outcome.review_requests.extend(reviews)
                target = CLAIMED_TO_OBJECT_STATE[item.claimed_state]
                if item.claimed_state == "completed" and reviews:
                    outcome.skipped.append({"item": index, "global_id": gid, "reason": "verification mismatch",
                                            "review_request_ids": [str(r.review_request_id) for r in reviews]})
                    continue
                from_state = ObjectState(row.state)
                if Actor.CONTRACTOR not in ALLOWED_TRANSITIONS.get((from_state, target), frozenset()):
                    outcome.skipped.append({"item": index, "global_id": gid,
                                            "reason": f"{from_state.value} -> {target.value} not allowed for contractor"})
                    continue
                evidence = Evidence(source_type="daily_report", source_id=report.report_id, method="daily_report_item",
                                    note=f"claimed_state={item.claimed_state}",
                                    extra={"item_index": index, "item": item.model_dump(mode="json"),
                                           "photo_uris": list(item.photo_uris)})
                result = self.transition_with_effects(session, project_id, gid, target, Actor.CONTRACTOR, evidence,
                                                      actor_id=report.reporter_id)
                outcome.transitions.append(result.transition)
                outcome.inspection_review_ids.extend(result.created_review_ids)
        return outcome

    # ---------------------------------------------------------------- queries
    def history(self, session: Session, project_id: str, global_id: str) -> list[StateTransition]:
        return [db.transition_row_to_model(r) for r in db.load_transitions(session, project_id, global_id)]

    def next_actions(self, session: Session, project_id: str, global_id: str, role: str) -> list[dict]:
        """role 이 가리키는 프로젝트 역할(project role)별 다음 행동. kind 는 NEXT_ACTION_KINDS(glossary)
        안에서만. client, 그리고 프로젝트 역할이 없는 호출(admin 등)은 빈 목록(조회 전용) — `actor_for_role`
        참조."""
        row = self._load(session, project_id, global_id)
        from_state = ObjectState(row.state)
        try:
            actor = actor_for_role(role)
        except RoleNotAllowedError:
            return []
        actions: list[dict] = []
        for target in allowed_targets(from_state, actor):
            kind = _action_kind(from_state, target, actor)
            assert kind in NEXT_ACTION_KINDS
            actions.append({"kind": kind, "to_state": target.value, "actor": actor.value, "allowed_roles": ACTOR_TO_ROLES[actor]})
        if actor == Actor.CM:
            for review in db.open_reviews(session, project_id, [global_id]):
                actions.append({"kind": "resolve_review", "to_state": None, "actor": actor.value,
                                "allowed_roles": ACTOR_TO_ROLES[Actor.CM], "review_request_id": review.review_request_id,
                                "review_kind": review.kind, "rule_id": review.rule_id})
            if from_state in (ObjectState.MISMATCH, ObjectState.UNVERIFIABLE):
                actions.append({"kind": "align_scan", "to_state": None, "actor": actor.value, "allowed_roles": ACTOR_TO_ROLES[Actor.CM]})
        return actions


def _action_kind(from_state: ObjectState, to_state: ObjectState, actor: Actor) -> str:
    if to_state == ObjectState.CONFIRMED:
        return "confirm"
    if actor == Actor.CONTRACTOR:
        return "request_inspection" if to_state == ObjectState.INSPECTION_REQUESTED else "report_progress"
    if to_state == ObjectState.IN_PROGRESS:
        return {ObjectState.INSPECTION_REQUESTED: "reject_inspection", ObjectState.MISMATCH: "accept_rework",
                ObjectState.CONFIRMED: "order_rework"}.get(from_state, "inspect")
    if to_state == ObjectState.MISMATCH:
        return "revoke_confirmation" if from_state == ObjectState.CONFIRMED else "flag_mismatch"
    return "inspect"
