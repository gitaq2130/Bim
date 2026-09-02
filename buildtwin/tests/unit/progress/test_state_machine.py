from __future__ import annotations

import itertools

import pytest

from packages.core.models.evidence import Evidence
from packages.core.models.identity import BimObjectDraft
from packages.core.models.orm import BimObjectRow, ReviewRequestRow, StateTransitionRow
from packages.core.models.review import ReviewRequest
from packages.core.models.scan import ScanState, ScanVerdict
from packages.core.models.state import ALLOWED_TRANSITIONS, Actor, InvalidTransitionError, ObjectState
from services.progress import persistence as db
from services.progress.state_machine import (
    NEXT_ACTION_KINDS,
    ObjectNotFoundError,
    ObjectStateMachine,
    RoleNotAllowedError,
    TransitionBlockedByReviewError,
    actor_for_role,
)

GID = "OBJ0000000000000000001"
EV = Evidence(source_type="cm_action", source_id="user-cm-1", note="test")
SCAN_EV = Evidence(source_type="scan", source_id="scan-1")
ALL_COMBOS = [(f, t, a) for f, t, a in itertools.product(ObjectState, ObjectState, Actor) if f != t]


@pytest.fixture
def obj(session) -> BimObjectRow:
    db.ensure_project(session, "P")
    rows = db.save_objects(session, "P", "M", [BimObjectDraft(global_id=GID, ifc_type="IfcColumn", level="1F")])
    session.commit()
    return rows[0]


def _confidence(actor: Actor) -> float | None:
    return 0.9 if actor == Actor.SYSTEM else None


@pytest.mark.parametrize("from_state,to_state,actor", ALL_COMBOS)
def test_every_combination_matches_adr_table(session, obj, from_state, to_state, actor):
    obj.state = from_state.value
    session.flush()
    sm = ObjectStateMachine()
    allowed = actor in ALLOWED_TRANSITIONS.get((from_state, to_state), frozenset())
    if allowed:
        t = sm.transition(session, GID, to_state, actor, EV, actor_id="u", confidence=_confidence(actor))
        assert (t.from_state, t.to_state, t.actor) == (from_state, to_state, actor)
        assert session.get(BimObjectRow, GID).state == to_state.value
        assert session.get(StateTransitionRow, str(t.transition_id)).evidence["source_id"] == "user-cm-1"
    else:
        with pytest.raises(InvalidTransitionError):
            sm.transition(session, GID, to_state, actor, EV, confidence=_confidence(actor))
        assert session.get(BimObjectRow, GID).state == from_state.value
        assert session.query(StateTransitionRow).count() == 0


@pytest.mark.parametrize("actor", [Actor.SYSTEM, Actor.CONTRACTOR])
def test_confirmed_requires_cm(session, obj, actor):
    obj.state = ObjectState.INSPECTION_REQUESTED.value
    with pytest.raises(InvalidTransitionError):
        ObjectStateMachine().transition(session, GID, ObjectState.CONFIRMED, actor, EV, confidence=1.0)
    assert obj.state == ObjectState.INSPECTION_REQUESTED.value


def test_system_transition_requires_confidence(session, obj):
    with pytest.raises(ValueError):
        ObjectStateMachine().transition(session, GID, ObjectState.IN_PROGRESS, Actor.SYSTEM, SCAN_EV)


def test_unknown_object_raises(session):
    with pytest.raises(ObjectNotFoundError):
        ObjectStateMachine().transition(session, "nope", ObjectState.REPORTED, Actor.CONTRACTOR, EV)


def test_open_verification_review_blocks_system_but_not_people(session, obj):
    review = ReviewRequest(project_id="P", kind="verification", global_id=GID, rule_id="VER-001", title="t", confidence=0.9,
                           evidence=Evidence(source_type="rule", source_id="VER-001"))
    db.save_review_request(session, review)
    sm = ObjectStateMachine()
    with pytest.raises(TransitionBlockedByReviewError) as exc:
        sm.transition(session, GID, ObjectState.IN_PROGRESS, Actor.SYSTEM, SCAN_EV, confidence=0.8)
    assert str(review.review_request_id) in exc.value.review_ids
    assert obj.state == ObjectState.PLANNED.value
    sm.transition(session, GID, ObjectState.REPORTED, Actor.CONTRACTOR, EV)
    assert obj.state == ObjectState.REPORTED.value
    # CM 이 해소하면 system 전이 재개
    session.get(ReviewRequestRow, str(review.review_request_id)).status = "approved"
    session.flush()
    sm.transition(session, GID, ObjectState.IN_PROGRESS, Actor.SYSTEM, SCAN_EV, confidence=0.8)
    assert obj.state == ObjectState.IN_PROGRESS.value


def _verdict(state: ScanState) -> ScanVerdict:
    return ScanVerdict(scan_id="scan-1", global_id=GID, state=state, confidence=0.77, evidence=SCAN_EV)


def test_apply_scan_verdict_mapping(session, obj):
    sm = ObjectStateMachine()
    assert sm.apply_scan_verdict(session, _verdict(ScanState.NOT_BUILT)) is None
    assert obj.state == ObjectState.PLANNED.value
    t = sm.apply_scan_verdict(session, _verdict(ScanState.ESTIMATED_DONE))
    assert t is not None and t.actor == Actor.SYSTEM and t.confidence == 0.77 and t.actor_id == "scan-1"
    assert obj.state == ObjectState.ESTIMATED_DONE.value
    assert sm.apply_scan_verdict(session, _verdict(ScanState.ESTIMATED_DONE)) is None   # 같은 상태 → 전이 없음
    obj.state = ObjectState.CONFIRMED.value
    session.flush()
    for s in (ScanState.IN_PROGRESS, ScanState.MISMATCH, ScanState.UNVERIFIABLE, ScanState.ESTIMATED_DONE):
        assert sm.apply_scan_verdict(session, _verdict(s)) is None
    assert obj.state == ObjectState.CONFIRMED.value


def test_history_and_next_actions(session, obj):
    sm = ObjectStateMachine()
    sm.transition(session, GID, ObjectState.REPORTED, Actor.CONTRACTOR, EV, actor_id="c1")
    sm.transition(session, GID, ObjectState.INSPECTION_REQUESTED, Actor.CONTRACTOR, EV, actor_id="c1")
    hist = sm.history(session, GID)
    assert [(h.from_state, h.to_state) for h in hist] == [(ObjectState.PLANNED, ObjectState.REPORTED),
                                                          (ObjectState.REPORTED, ObjectState.INSPECTION_REQUESTED)]
    cm_actions = sm.next_actions(session, GID, "cm")
    cm_kinds = {a["kind"] for a in cm_actions}
    assert {"confirm", "reject_inspection", "flag_mismatch", "resolve_review"} <= cm_kinds
    assert cm_kinds <= NEXT_ACTION_KINDS
    for a in cm_actions:
        assert a["allowed_roles"] == ["cm"]          # admin 은 확정·검측·검토요청 처리 불가
    resolve = [a for a in cm_actions if a["kind"] == "resolve_review"]
    assert resolve and resolve[0]["review_kind"] == "inspection"   # INSPECTION_REQUESTED 진입 시 자동 생성된 검측 요청
    contractor_kinds = {a["kind"] for a in sm.next_actions(session, GID, "contractor")}
    assert "confirm" not in contractor_kinds and contractor_kinds <= NEXT_ACTION_KINDS
    assert sm.next_actions(session, GID, "client") == []
    assert sm.next_actions(session, GID, "admin") == []


@pytest.mark.parametrize("role", ["client", "admin", "unknown"])
def test_actor_for_role_rejects_non_acting_roles(role):
    with pytest.raises(RoleNotAllowedError) as exc:
        actor_for_role(role)
    assert isinstance(exc.value, PermissionError) and exc.value.role == role


def test_actor_for_role_maps_contractor_and_cm():
    assert actor_for_role("contractor") == Actor.CONTRACTOR
    assert actor_for_role("CM") == Actor.CM


def test_inspection_review_lifecycle(session, obj):
    sm = ObjectStateMachine()
    sm.transition(session, GID, ObjectState.REPORTED, Actor.CONTRACTOR, EV, actor_id="c1")
    first = sm.transition_with_effects(session, GID, ObjectState.INSPECTION_REQUESTED, Actor.CONTRACTOR, EV, actor_id="c1")
    assert len(first.created_review_ids) == 1 and first.closed_review_ids == []
    review = session.get(ReviewRequestRow, first.created_review_ids[0])
    assert (review.kind, review.status, review.assignee_role, review.global_id, review.project_id) == ("inspection", "open", "cm", GID, "P")
    assert review.confidence == 1.0 and review.evidence["source_id"] == "user-cm-1"
    # 이미 미결 검측 요청이 있으면 중복 생성하지 않는다
    obj.state = ObjectState.ESTIMATED_DONE.value
    session.flush()
    again = sm.transition_with_effects(session, GID, ObjectState.INSPECTION_REQUESTED, Actor.SYSTEM, SCAN_EV, confidence=0.8)
    assert again.created_review_ids == []
    # cm 반려 → rejected 로 종료, 재검측 요청 시 새로 생성
    rejected = sm.transition_with_effects(session, GID, ObjectState.IN_PROGRESS, Actor.CM, EV, actor_id="cm-1")
    assert rejected.closed_review_ids == [review.review_request_id]
    session.refresh(review)
    assert review.status == "rejected" and review.resolved_by == "cm-1" and review.resolved_at is not None
    assert "IN_PROGRESS" in review.resolution_note
    second = sm.transition_with_effects(session, GID, ObjectState.INSPECTION_REQUESTED, Actor.CONTRACTOR, EV, actor_id="c1")
    assert len(second.created_review_ids) == 1 and second.created_review_ids != first.created_review_ids
    # cm 승인 → approved 로 종료
    confirmed = sm.transition_with_effects(session, GID, ObjectState.CONFIRMED, Actor.CM, EV, actor_id="cm-1")
    assert confirmed.closed_review_ids == second.created_review_ids
    assert session.get(ReviewRequestRow, second.created_review_ids[0]).status == "approved"
    assert not [r for r in session.query(ReviewRequestRow).all() if r.status == "open"]
    assert session.query(ReviewRequestRow).count() == 2


def test_system_mismatch_from_inspection_keeps_review_open(session, obj):
    sm = ObjectStateMachine()
    obj.state = ObjectState.ESTIMATED_DONE.value
    session.flush()
    created = sm.transition_with_effects(session, GID, ObjectState.INSPECTION_REQUESTED, Actor.SYSTEM, SCAN_EV, confidence=0.8)
    assert session.get(ReviewRequestRow, created.created_review_ids[0]).confidence == 0.8
    result = sm.transition_with_effects(session, GID, ObjectState.MISMATCH, Actor.SYSTEM, SCAN_EV, confidence=0.9)
    assert result.closed_review_ids == []       # 종료는 cm 결정에서만
    assert session.get(ReviewRequestRow, created.created_review_ids[0]).status == "open"
    assert "align_scan" in {a["kind"] for a in sm.next_actions(session, GID, "cm")}
