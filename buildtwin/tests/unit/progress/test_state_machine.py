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
from services.progress.state_machine import ObjectNotFoundError, ObjectStateMachine, TransitionBlockedByReviewError

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
    cm_kinds = {a["kind"] for a in sm.next_actions(session, GID, "cm")}
    assert {"confirm", "reject_inspection", "flag_mismatch"} <= cm_kinds
    contractor_kinds = {a["kind"] for a in sm.next_actions(session, GID, "contractor")}
    assert "confirm" not in contractor_kinds
    assert sm.next_actions(session, GID, "client") == []
    db.save_review_request(session, ReviewRequest(project_id="P", kind="inspection", global_id=GID, title="i", confidence=1.0,
                                                  evidence=Evidence(source_type="cm_action", source_id="cm")))
    resolve = [a for a in sm.next_actions(session, GID, "admin") if a["kind"] == "resolve_review"]
    assert resolve and resolve[0]["review_kind"] == "inspection" and "admin" in resolve[0]["allowed_roles"]
