from __future__ import annotations

from datetime import date

from packages.core.models.evidence import Evidence
from packages.core.models.orm import BimObjectRow, ReviewRequestRow, ScanVerdictRow, StateTransitionRow
from packages.core.models.progress import DailyReport, DailyReportItem
from packages.core.models.scan import ScanState, ScanVerdict
from packages.core.models.state import ObjectState
from services.progress import persistence as db
from services.progress.state_machine import ObjectStateMachine
from services.progress.verification import build_logic_context, load_patterns, run_verification

from .conftest import ensure_scan_chain

SCAN_EV = Evidence(source_type="scan", source_id="scan-1")


def _report(project_id: str, items: list[DailyReportItem], report_id: str = "DR-1") -> DailyReport:
    return DailyReport(report_id=report_id, project_id=project_id, report_date=date(2026, 9, 2), reporter_id="contractor-1", items=items)


def _store_scan(session, project_id: str, gid: str, state: ScanState) -> None:
    ensure_scan_chain(session, project_id, "scan-1")
    session.add(ScanVerdictRow(scan_id="scan-1", global_id=gid, project_id=project_id, state=state.value, confidence=0.9,
                               evidence=SCAN_EV.model_dump(mode="json")))
    session.flush()


def test_patterns_load_from_rules_dir():
    ids = [p["id"] for p in load_patterns()]
    assert "VER-001" in ids and all(callable(p["_eval"]) for p in load_patterns())


def test_completed_report_vs_not_built_scan_creates_ver_001_and_keeps_state(session, seeded):
    gid = seeded["expected"]["A100"][0]
    item = DailyReportItem(global_id=gid, activity_id="A100", claimed_state="completed")
    scan = ScanVerdict(scan_id="scan-1", global_id=gid, state=ScanState.NOT_BUILT, confidence=0.9, evidence=SCAN_EV)
    logic = build_logic_context(session, seeded["project_id"], gid)
    assert logic["predecessor_confirmed_ratio"] == 1.0 and logic["bim_quantity"] == 1.0
    reviews = run_verification(session, seeded["project_id"], gid, item, scan, logic)
    assert [r.rule_id for r in reviews] == ["VER-001"]
    review = reviews[0]
    assert review.kind == "verification" and review.assignee_role == "cm" and review.status == "open"
    assert set(review.conflicting_sources) == {"daily_report", "scan", "system_logic"}
    assert review.confidence == 0.9 and review.evidence.rule_id == "VER-001"
    assert session.get(BimObjectRow, (seeded["project_id"], gid)).state == ObjectState.PLANNED.value
    # 같은 규칙의 미결 요청이 있으면 중복 생성하지 않는다
    assert run_verification(session, seeded["project_id"], gid, item, scan, logic) == []
    assert session.query(ReviewRequestRow).count() == 1


def test_apply_daily_report_blocks_completion_on_mismatch(session, seeded):
    gid = seeded["expected"]["A100"][0]
    _store_scan(session, seeded["project_id"], gid, ScanState.NOT_BUILT)
    sm = ObjectStateMachine()
    sm.apply_daily_report(session, _report(seeded["project_id"], [DailyReportItem(global_id=gid, claimed_state="started")], "DR-0"))
    assert session.get(BimObjectRow, (seeded["project_id"], gid)).state == ObjectState.REPORTED.value
    outcome = sm.apply_daily_report(session, _report(seeded["project_id"], [DailyReportItem(global_id=gid, claimed_state="completed")]))
    assert [r.rule_id for r in outcome.review_requests] == ["VER-001"]
    assert outcome.transitions == []
    assert outcome.skipped and outcome.skipped[0]["reason"] == "verification mismatch"
    assert session.get(BimObjectRow, (seeded["project_id"], gid)).state == ObjectState.REPORTED.value
    assert session.query(StateTransitionRow).filter_by(global_id=gid, project_id=seeded["project_id"]).count() == 1


def test_completed_report_with_unconfirmed_predecessor_hits_ver_003(session, seeded):
    gid = seeded["expected"]["A110"][0]
    outcome = ObjectStateMachine().apply_daily_report(
        session, _report(seeded["project_id"], [DailyReportItem(activity_id="A110", claimed_state="completed")]))
    assert {r.rule_id for r in outcome.review_requests} == {"VER-003"}
    assert len(outcome.review_requests) == len(seeded["expected"]["A110"])
    assert session.get(BimObjectRow, (seeded["project_id"], gid)).state == ObjectState.PLANNED.value


def test_consistent_completion_reaches_inspection_requested(session, seeded):
    gid = seeded["expected"]["A100"][1]
    _store_scan(session, seeded["project_id"], gid, ScanState.ESTIMATED_DONE)
    sm = ObjectStateMachine()
    started = sm.apply_daily_report(session, _report(seeded["project_id"], [DailyReportItem(global_id=gid, claimed_state="started")], "DR-0"))
    assert [t.to_state for t in started.transitions] == [ObjectState.REPORTED]
    done = sm.apply_daily_report(session, _report(seeded["project_id"], [DailyReportItem(global_id=gid, claimed_state="completed", quantity=1.0, quantity_unit="m3")]))
    assert done.review_requests == []
    assert [t.to_state for t in done.transitions] == [ObjectState.INSPECTION_REQUESTED]
    assert done.transitions[0].actor.value == "contractor" and done.transitions[0].evidence.source_type == "daily_report"
    assert session.get(BimObjectRow, (seeded["project_id"], gid)).state == ObjectState.INSPECTION_REQUESTED.value
    assert len(done.inspection_review_ids) == 1
    assert session.get(ReviewRequestRow, done.inspection_review_ids[0]).kind == "inspection"


def test_quantity_over_bim_creates_ver_004(session, seeded):
    gid = seeded["expected"]["A100"][2]
    item = DailyReportItem(global_id=gid, claimed_state="in_progress", quantity=5.0, quantity_unit="m3")
    reviews = run_verification(session, seeded["project_id"], gid, item, None,
                               build_logic_context(session, seeded["project_id"], gid, "m3"))
    assert [r.rule_id for r in reviews] == ["VER-004"]
    assert db.has_open_verification_review(session, seeded["project_id"], gid)


def test_logic_context_supplies_risk_rule_keys(session, seeded):
    from datetime import date as _date

    gid = seeded["expected"]["A110"][0]
    _store_scan(session, seeded["project_id"], gid, ScanState.UNVERIFIABLE)
    logic = build_logic_context(session, seeded["project_id"], gid, today=_date(2026, 9, 1))
    assert logic["consecutive_unverifiable"] == 1
    assert logic["clash_count"] == 0 and logic["inspection_passed"] is None and logic["matched_case_ids"] == []
    assert logic["days_until_planned_start"] == 10 and logic["predecessor_confirmed_ratio"] == 0.0
    assert logic["material_delivered_ratio"] is None
