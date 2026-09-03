from __future__ import annotations

import itertools
from datetime import date

import pytest

from packages.core.models.evidence import Evidence
from packages.core.models.identity import BimObjectDraft
from packages.core.models.mapping import ActivityObjectMapping
from packages.core.models.orm import BimObjectRow, ReviewRequestRow, StateTransitionRow
from packages.core.models.progress import Activity, DailyReport, DailyReportItem, Schedule
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

from .conftest import ensure_model_chain

GID = "OBJ0000000000000000001"
PID = "P"
EV = Evidence(source_type="cm_action", source_id="user-cm-1", note="test")
SCAN_EV = Evidence(source_type="scan", source_id="scan-1")
ALL_COMBOS = [(f, t, a) for f, t, a in itertools.product(ObjectState, ObjectState, Actor) if f != t]


@pytest.fixture
def obj(session) -> BimObjectRow:
    db.ensure_project(session, "P")
    model = ensure_model_chain(session, "P", "M")
    rows = db.save_objects(session, "P", "M", [BimObjectDraft(global_id=GID, ifc_type="IfcColumn", level="1F")],
                           model.file_id)
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
        t = sm.transition(session, PID, GID, to_state, actor, EV, actor_id="u", confidence=_confidence(actor))
        assert (t.from_state, t.to_state, t.actor) == (from_state, to_state, actor)
        assert session.get(BimObjectRow, (PID, GID)).state == to_state.value
        assert session.get(StateTransitionRow, str(t.transition_id)).evidence["source_id"] == "user-cm-1"
    else:
        with pytest.raises(InvalidTransitionError):
            sm.transition(session, PID, GID, to_state, actor, EV, confidence=_confidence(actor))
        assert session.get(BimObjectRow, (PID, GID)).state == from_state.value
        assert session.query(StateTransitionRow).count() == 0


@pytest.mark.parametrize("actor", [Actor.SYSTEM, Actor.CONTRACTOR])
def test_confirmed_requires_cm(session, obj, actor):
    obj.state = ObjectState.INSPECTION_REQUESTED.value
    with pytest.raises(InvalidTransitionError):
        ObjectStateMachine().transition(session, PID, GID, ObjectState.CONFIRMED, actor, EV, confidence=1.0)
    assert obj.state == ObjectState.INSPECTION_REQUESTED.value


def test_system_transition_requires_confidence(session, obj):
    with pytest.raises(ValueError):
        ObjectStateMachine().transition(session, PID, GID, ObjectState.IN_PROGRESS, Actor.SYSTEM, SCAN_EV)


def test_unknown_object_raises(session):
    with pytest.raises(ObjectNotFoundError):
        ObjectStateMachine().transition(session, PID, "nope", ObjectState.REPORTED, Actor.CONTRACTOR, EV)


def test_open_verification_review_blocks_system_but_not_people(session, obj):
    review = ReviewRequest(project_id="P", kind="verification", global_id=GID, rule_id="VER-001", title="t", confidence=0.9,
                           evidence=Evidence(source_type="rule", source_id="VER-001"))
    db.save_review_request(session, review)
    sm = ObjectStateMachine()
    with pytest.raises(TransitionBlockedByReviewError) as exc:
        sm.transition(session, PID, GID, ObjectState.IN_PROGRESS, Actor.SYSTEM, SCAN_EV, confidence=0.8)
    assert str(review.review_request_id) in exc.value.review_ids
    assert obj.state == ObjectState.PLANNED.value
    sm.transition(session, PID, GID, ObjectState.REPORTED, Actor.CONTRACTOR, EV)
    assert obj.state == ObjectState.REPORTED.value
    # CM 이 해소하면 system 전이 재개
    session.get(ReviewRequestRow, str(review.review_request_id)).status = "approved"
    session.flush()
    sm.transition(session, PID, GID, ObjectState.IN_PROGRESS, Actor.SYSTEM, SCAN_EV, confidence=0.8)
    assert obj.state == ObjectState.IN_PROGRESS.value


def _verdict(state: ScanState) -> ScanVerdict:
    return ScanVerdict(scan_id="scan-1", global_id=GID, state=state, confidence=0.77, evidence=SCAN_EV)


def test_apply_scan_verdict_mapping(session, obj):
    sm = ObjectStateMachine()
    assert sm.apply_scan_verdict(session, PID, _verdict(ScanState.NOT_BUILT)) is None
    assert obj.state == ObjectState.PLANNED.value
    t = sm.apply_scan_verdict(session, PID, _verdict(ScanState.ESTIMATED_DONE))
    assert t is not None and t.actor == Actor.SYSTEM and t.confidence == 0.77 and t.actor_id == "scan-1"
    assert obj.state == ObjectState.ESTIMATED_DONE.value
    assert sm.apply_scan_verdict(session, PID, _verdict(ScanState.ESTIMATED_DONE)) is None   # 같은 상태 → 전이 없음
    obj.state = ObjectState.CONFIRMED.value
    session.flush()
    for s in (ScanState.IN_PROGRESS, ScanState.MISMATCH, ScanState.UNVERIFIABLE, ScanState.ESTIMATED_DONE):
        assert sm.apply_scan_verdict(session, PID, _verdict(s)) is None
    assert obj.state == ObjectState.CONFIRMED.value


def test_history_and_next_actions(session, obj):
    sm = ObjectStateMachine()
    sm.transition(session, PID, GID, ObjectState.REPORTED, Actor.CONTRACTOR, EV, actor_id="c1")
    sm.transition(session, PID, GID, ObjectState.INSPECTION_REQUESTED, Actor.CONTRACTOR, EV, actor_id="c1")
    hist = sm.history(session, PID, GID)
    assert [(h.from_state, h.to_state) for h in hist] == [(ObjectState.PLANNED, ObjectState.REPORTED),
                                                          (ObjectState.REPORTED, ObjectState.INSPECTION_REQUESTED)]
    cm_actions = sm.next_actions(session, PID, GID, "cm")
    cm_kinds = {a["kind"] for a in cm_actions}
    assert {"confirm", "reject_inspection", "flag_mismatch", "resolve_review"} <= cm_kinds
    assert cm_kinds <= NEXT_ACTION_KINDS
    for a in cm_actions:
        assert a["allowed_roles"] == ["cm"]          # admin 은 확정·검측·검토요청 처리 불가
    resolve = [a for a in cm_actions if a["kind"] == "resolve_review"]
    assert resolve and resolve[0]["review_kind"] == "inspection"   # INSPECTION_REQUESTED 진입 시 자동 생성된 검측 요청
    contractor_kinds = {a["kind"] for a in sm.next_actions(session, PID, GID, "contractor")}
    assert "confirm" not in contractor_kinds and contractor_kinds <= NEXT_ACTION_KINDS
    assert sm.next_actions(session, PID, GID, "client") == []
    assert sm.next_actions(session, PID, GID, "admin") == []


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
    sm.transition(session, PID, GID, ObjectState.REPORTED, Actor.CONTRACTOR, EV, actor_id="c1")
    first = sm.transition_with_effects(session, PID, GID, ObjectState.INSPECTION_REQUESTED, Actor.CONTRACTOR, EV, actor_id="c1")
    assert len(first.created_review_ids) == 1 and first.closed_review_ids == []
    review = session.get(ReviewRequestRow, first.created_review_ids[0])
    assert (review.kind, review.status, review.assignee_role, review.global_id, review.project_id) == ("inspection", "open", "cm", GID, "P")
    assert review.confidence == 1.0 and review.evidence["source_id"] == "user-cm-1"
    # 이미 미결 검측 요청이 있으면 중복 생성하지 않는다
    obj.state = ObjectState.ESTIMATED_DONE.value
    session.flush()
    again = sm.transition_with_effects(session, PID, GID, ObjectState.INSPECTION_REQUESTED, Actor.SYSTEM, SCAN_EV, confidence=0.8)
    assert again.created_review_ids == []
    # cm 반려 → rejected 로 종료, 재검측 요청 시 새로 생성
    rejected = sm.transition_with_effects(session, PID, GID, ObjectState.IN_PROGRESS, Actor.CM, EV, actor_id="cm-1")
    assert rejected.closed_review_ids == [review.review_request_id]
    session.refresh(review)
    assert review.status == "rejected" and review.resolved_by == "cm-1" and review.resolved_at is not None
    assert "IN_PROGRESS" in review.resolution_note
    second = sm.transition_with_effects(session, PID, GID, ObjectState.INSPECTION_REQUESTED, Actor.CONTRACTOR, EV, actor_id="c1")
    assert len(second.created_review_ids) == 1 and second.created_review_ids != first.created_review_ids
    # cm 승인 → approved 로 종료
    confirmed = sm.transition_with_effects(session, PID, GID, ObjectState.CONFIRMED, Actor.CM, EV, actor_id="cm-1")
    assert confirmed.closed_review_ids == second.created_review_ids
    assert session.get(ReviewRequestRow, second.created_review_ids[0]).status == "approved"
    assert not [r for r in session.query(ReviewRequestRow).all() if r.status == "open"]
    assert session.query(ReviewRequestRow).count() == 2


def test_system_mismatch_from_inspection_keeps_review_open(session, obj):
    sm = ObjectStateMachine()
    obj.state = ObjectState.ESTIMATED_DONE.value
    session.flush()
    created = sm.transition_with_effects(session, PID, GID, ObjectState.INSPECTION_REQUESTED, Actor.SYSTEM, SCAN_EV, confidence=0.8)
    assert session.get(ReviewRequestRow, created.created_review_ids[0]).confidence == 0.8
    result = sm.transition_with_effects(session, PID, GID, ObjectState.MISMATCH, Actor.SYSTEM, SCAN_EV, confidence=0.9)
    assert result.closed_review_ids == []       # 종료는 cm 결정에서만
    assert session.get(ReviewRequestRow, created.created_review_ids[0]).status == "open"
    assert "align_scan" in {a["kind"] for a in sm.next_actions(session, PID, GID, "cm")}


def test_transition_is_scoped_to_project(session):
    """ADR 0005: 같은 global_id 라도 프로젝트가 다르면 완전히 별개 객체다.

    한 프로젝트에서의 전이가 다른 프로젝트의 같은 global_id 객체 상태·이력을 건드리지 않아야 한다.
    """
    project_a, project_b = "P-A", "P-B"
    db.ensure_project(session, project_a)
    db.ensure_project(session, project_b)
    model_a = ensure_model_chain(session, project_a, "M-A")
    model_b = ensure_model_chain(session, project_b, "M-B")
    db.save_objects(session, project_a, "M-A", [BimObjectDraft(global_id=GID, ifc_type="IfcColumn", level="1F")],
                    model_a.file_id)
    db.save_objects(session, project_b, "M-B", [BimObjectDraft(global_id=GID, ifc_type="IfcColumn", level="1F")],
                    model_b.file_id)
    session.commit()

    sm = ObjectStateMachine()
    sm.transition(session, project_a, GID, ObjectState.REPORTED, Actor.CONTRACTOR, EV, actor_id="c1")
    sm.transition(session, project_a, GID, ObjectState.INSPECTION_REQUESTED, Actor.CONTRACTOR, EV, actor_id="c1")

    # 프로젝트 A 는 전이가 쌓였지만
    assert session.get(BimObjectRow, (project_a, GID)).state == ObjectState.INSPECTION_REQUESTED.value
    assert [t.to_state for t in sm.history(session, project_a, GID)] == \
        [ObjectState.REPORTED, ObjectState.INSPECTION_REQUESTED]

    # 프로젝트 B 의 같은 global_id 객체는 영향받지 않는다
    assert session.get(BimObjectRow, (project_b, GID)).state == ObjectState.PLANNED.value
    assert sm.history(session, project_b, GID) == []
    assert session.query(StateTransitionRow).filter_by(global_id=GID, project_id=project_b).count() == 0
    assert session.query(StateTransitionRow).filter_by(global_id=GID, project_id=project_a).count() == 2

    # INSPECTION_REQUESTED 진입으로 생성된 검토요청도 프로젝트별로 분리된다
    assert len(db.open_reviews(session, project_a, [GID], kind="inspection")) == 1
    assert len(db.open_reviews(session, project_b, [GID], kind="inspection")) == 0

    # 프로젝트 B 에서 독립적으로 전이해도 A 에는 영향 없다
    sm.transition(session, project_b, GID, ObjectState.REPORTED, Actor.CONTRACTOR, EV, actor_id="c2")
    assert session.get(BimObjectRow, (project_a, GID)).state == ObjectState.INSPECTION_REQUESTED.value
    assert [t.to_state for t in sm.history(session, project_b, GID)] == [ObjectState.REPORTED]


def test_daily_report_activity_from_other_project_is_skipped_not_transitioned(session):
    """라운드3 리뷰 FAIL 회귀(ADR 0005 규칙 2): `daily_reports` 라우터는 항목의 `activity_id` 가 신고 대상 프로젝트
    소속인지 검증하지 않는다. 예전 `mapped_global_ids(session, activity_id)` 는 project_id 없이 매핑을 조회했으므로,
    다른 프로젝트 Activity 의 activity_id 를 신고서에 실으면 그 매핑이 가리키는 global_id 를 그대로 돌려주었고,
    신고 프로젝트에 우연히 같은 global_id 를 쓰는 객체가 있으면 그 객체가 전이되어 버렸다(검측 요청까지 생성).
    이 테스트는 그 경로가 이제 차단되고 skipped 로 남는지 검증한다.
    """
    project_a, project_b = "P-A", "P-B"
    db.ensure_project(session, project_a)
    db.ensure_project(session, project_b)
    model_a = ensure_model_chain(session, project_a, "M-A")
    model_b = ensure_model_chain(session, project_b, "M-B")
    # 두 프로젝트 모두 우연히 같은 global_id 를 쓰는 객체를 갖는다(ADR 0005: 서로 다른 IFC 라도 GlobalId 재사용 가능).
    db.save_objects(session, project_a, "M-A", [BimObjectDraft(global_id=GID, ifc_type="IfcColumn", level="1F")],
                    model_a.file_id)
    db.save_objects(session, project_b, "M-B", [BimObjectDraft(global_id=GID, ifc_type="IfcColumn", level="1F")],
                    model_b.file_id)

    # 프로젝트 B 에만 Activity 를 만들고 B 의 객체에 매핑한다.
    schedule_b = Schedule(schedule_id="S-B", project_id=project_b, source_format="csv",
                          activities=[Activity(activity_id="ACT-B", name="B 공정")], relations=[])
    db.save_schedule(session, schedule_b)
    db.save_mappings(session, [ActivityObjectMapping(
        activity_id="ACT-B", global_id=GID, confidence=0.95,
        evidence=Evidence(source_type="mapping", source_id="S-B"),
    )])
    session.commit()

    # 공격 경로 재현: daily_reports 라우터가 activity_id 소속을 검증하지 않으므로, 프로젝트 A 앞으로 제출된
    # 신고서에 프로젝트 B 의 activity_id 를 실을 수 있다.
    report = DailyReport(report_id="DR-EXPLOIT", project_id=project_a, report_date=date(2026, 9, 2),
                         reporter_id="contractor-1",
                         items=[DailyReportItem(activity_id="ACT-B", claimed_state="completed")])

    outcome = ObjectStateMachine().apply_daily_report(session, report)

    # 프로젝트 A 의 객체는 전이되지 않는다 — 상태·전이 이력·검측 검토요청 모두 없다.
    assert session.get(BimObjectRow, (project_a, GID)).state == ObjectState.PLANNED.value
    assert outcome.transitions == []
    assert session.query(StateTransitionRow).filter_by(project_id=project_a, global_id=GID).count() == 0
    assert session.query(ReviewRequestRow).filter_by(project_id=project_a, global_id=GID, kind="inspection").count() == 0

    # 왜 건너뛰었는지 skipped 사유에 남는다.
    assert len(outcome.skipped) == 1
    reason = outcome.skipped[0]["reason"]
    assert "ACT-B" in reason and project_b in reason and project_a in reason

    # 프로젝트 B 의 객체도(신고서 자체가 프로젝트 A 앞이므로) 전이되지 않는다.
    assert session.get(BimObjectRow, (project_b, GID)).state == ObjectState.PLANNED.value
    assert session.query(StateTransitionRow).filter_by(project_id=project_b, global_id=GID).count() == 0
