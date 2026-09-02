"""ADR 0001 객체 상태기계. 전이 규칙은 packages.core.models.state 를 그대로 쓴다(재정의 금지).

- transition(): validate_transition + 불변식 4(미결 verification 검토요청 시 system 전이 차단) + 행 기록.
- apply_scan_verdict(): ScanState → ObjectState 를 system actor 로. NOT_BUILT 은 전이 없음. 표에 없으면 None.
- apply_daily_report(): contractor actor 로 REPORTED / IN_PROGRESS, 완료 신고는 3중 검증 통과 시에만 INSPECTION_REQUESTED.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy.orm import Session

from packages.core.models.evidence import Evidence
from packages.core.models.orm import BimObjectRow, StateTransitionRow
from packages.core.models.progress import DailyReport, DailyReportItem
from packages.core.models.review import ReviewRequest
from packages.core.models.scan import ScanState, ScanVerdict
from packages.core.models.state import ALLOWED_TRANSITIONS, Actor, ObjectState, StateTransition, allowed_targets, validate_transition

from . import persistence as db
from .verification import build_logic_context, run_verification

log = logging.getLogger(__name__)


class ObjectNotFoundError(LookupError):
    pass


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
ROLE_TO_ACTOR: dict[str, Actor] = {"contractor": Actor.CONTRACTOR, "cm": Actor.CM, "admin": Actor.CM}
ACTOR_TO_ROLES: dict[Actor, list[str]] = {Actor.CONTRACTOR: ["contractor"], Actor.CM: ["cm", "admin"], Actor.SYSTEM: []}


@dataclass
class DailyReportOutcome:
    report_id: str
    transitions: list[StateTransition] = field(default_factory=list)
    review_requests: list[ReviewRequest] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)


class ObjectStateMachine:
    def _load(self, session: Session, global_id: str) -> BimObjectRow:
        row = session.get(BimObjectRow, global_id)
        if row is None:
            raise ObjectNotFoundError(global_id)
        return row

    def transition(self, session: Session, global_id: str, to_state: ObjectState | str, actor: Actor | str, evidence: Evidence,
                   actor_id: str | None = None, confidence: float | None = None,
                   review_request_id: UUID | str | None = None) -> StateTransition:
        row = self._load(session, global_id)
        from_state, to_state, actor = ObjectState(row.state), ObjectState(to_state), Actor(actor)
        validate_transition(from_state, to_state, actor)
        if actor == Actor.SYSTEM:
            open_reviews = db.open_reviews(session, [global_id], kind="verification")
            if open_reviews:
                raise TransitionBlockedByReviewError(global_id, [r.review_request_id for r in open_reviews])
        rid = UUID(str(review_request_id)) if review_request_id else None
        transition = StateTransition(global_id=global_id, from_state=from_state, to_state=to_state, actor=actor,
                                     actor_id=actor_id, confidence=confidence, evidence=evidence, review_request_id=rid)
        session.add(StateTransitionRow(
            transition_id=str(transition.transition_id), global_id=global_id, from_state=from_state.value,
            to_state=to_state.value, actor=actor.value, actor_id=actor_id, confidence=confidence,
            evidence=evidence.model_dump(mode="json"), review_request_id=str(rid) if rid else None,
            occurred_at=transition.occurred_at,
        ))
        row.state = to_state.value
        session.flush()
        return transition

    # ---------------------------------------------------------------- scan
    def apply_scan_verdict(self, session: Session, verdict: ScanVerdict) -> StateTransition | None:
        target = SCAN_TO_OBJECT_STATE[verdict.state]
        if target is None:
            return None
        row = self._load(session, verdict.global_id)
        from_state = ObjectState(row.state)
        if from_state == target or Actor.SYSTEM not in ALLOWED_TRANSITIONS.get((from_state, target), frozenset()):
            return None
        try:
            return self.transition(session, verdict.global_id, target, Actor.SYSTEM, verdict.evidence,
                                   actor_id=verdict.scan_id, confidence=verdict.confidence)
        except TransitionBlockedByReviewError as exc:
            log.info("scan verdict not applied: %s", exc)
            return None

    # ---------------------------------------------------------------- daily report
    def _resolve_global_ids(self, session: Session, item: DailyReportItem) -> list[str]:
        if item.global_id:
            return [item.global_id]
        if item.activity_id:
            return db.mapped_global_ids(session, item.activity_id)
        return []

    def apply_daily_report(self, session: Session, report: DailyReport) -> DailyReportOutcome:
        db.save_daily_report(session, report)
        outcome = DailyReportOutcome(report_id=report.report_id)
        for index, item in enumerate(report.items):
            gids = self._resolve_global_ids(session, item)
            if not gids:
                outcome.skipped.append({"item": index, "reason": "no global_id or mapped objects"})
                continue
            for gid in gids:
                row = session.get(BimObjectRow, gid)
                if row is None:
                    outcome.skipped.append({"item": index, "global_id": gid, "reason": "object not found"})
                    continue
                scan_row = db.latest_scan_verdict(session, gid)
                scan = ScanVerdict(scan_id=scan_row.scan_id, global_id=gid, state=ScanState(scan_row.state),
                                   confidence=scan_row.confidence, evidence=Evidence(**scan_row.evidence)) if scan_row else None
                logic = build_logic_context(session, gid, quantity_unit=item.quantity_unit)
                reviews = run_verification(session, report.project_id, gid, item, scan, logic)
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
                outcome.transitions.append(self.transition(session, gid, target, Actor.CONTRACTOR, evidence,
                                                           actor_id=report.reporter_id))
        return outcome

    # ---------------------------------------------------------------- queries
    def history(self, session: Session, global_id: str) -> list[StateTransition]:
        return [db.transition_row_to_model(r) for r in db.load_transitions(session, global_id)]

    def next_actions(self, session: Session, global_id: str, role: str) -> list[dict]:
        row = self._load(session, global_id)
        from_state = ObjectState(row.state)
        actor = ROLE_TO_ACTOR.get(role)
        actions: list[dict] = []
        if actor is not None:
            for target in allowed_targets(from_state, actor):
                actions.append({"kind": _action_kind(from_state, target, actor), "to_state": target.value,
                                "actor": actor.value, "allowed_roles": ACTOR_TO_ROLES[actor]})
        if actor == Actor.CM:
            for review in db.open_reviews(session, [global_id]):
                actions.append({"kind": "resolve_review", "to_state": None, "actor": actor.value,
                                "allowed_roles": ACTOR_TO_ROLES[Actor.CM], "review_request_id": review.review_request_id,
                                "review_kind": review.kind, "rule_id": review.rule_id})
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
