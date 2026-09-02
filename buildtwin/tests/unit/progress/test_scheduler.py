from __future__ import annotations

import pytest

from packages.core.models.orm import ActivityRelationRow, BimObjectRow
from packages.core.models.progress import Activity, ActivityRelation, Schedule
from packages.core.models.state import ObjectState
from services.progress import persistence as db
from services.progress.readiness import activity_progress
from services.progress.scheduler import compute_startable


def _assert_no_fs_violation(session, result) -> None:
    rels = db.load_relations(session, result.project_id)
    for act in result.startable:
        for rel in rels:
            if rel.successor_id == act and rel.type == "FS":
                assert activity_progress(session, rel.predecessor_id).complete, f"{act} started before {rel.predecessor_id}"


@pytest.mark.parametrize("use_solver", [True, False])
def test_startable_set_respects_fs_predecessors(session, seeded, use_solver):
    result = compute_startable(session, seeded["project_id"], use_solver=use_solver)
    assert result.startable == ["A100"]
    assert result.solver_status in {"OPTIMAL", "greedy_fallback"}
    assert set(result.blocked) == {"A110", "A120", "A200", "A300", "A400"}
    assert any(b.component == "predecessor" and b.related_ids == ["A100"] for b in result.blocked["A110"])
    assert result.evidence.source_type == "system_logic" and result.evidence.extra["readiness"]["A100"] >= result.threshold
    _assert_no_fs_violation(session, result)

    for gid in seeded["expected"]["A100"]:
        session.get(BimObjectRow, gid).state = ObjectState.CONFIRMED.value
    session.flush()
    result = compute_startable(session, seeded["project_id"], use_solver=use_solver)
    assert result.startable == ["A110"]
    assert "A100" not in result.blocked   # 완료된 작업은 후보가 아니다
    _assert_no_fs_violation(session, result)


def test_started_activities_are_not_candidates_and_ss_allows(session, seeded):
    for gid in seeded["expected"]["A100"]:
        session.get(BimObjectRow, gid).state = ObjectState.IN_PROGRESS.value
    rel = session.query(ActivityRelationRow).filter_by(successor_id="A110").one()
    rel.type = "SS"
    session.flush()
    result = compute_startable(session, seeded["project_id"])
    assert "A100" not in result.blocked and "A100" not in result.startable   # 착수한 작업은 후보가 아니다
    # SS 선행은 만족(A100 착수) → 선후행 blocker 없음. 단 Readiness 는 CONFIRMED 기준이라 기본 임계값에서는 아직 차단된다.
    assert not [b for b in result.blocked["A110"] if b.component == "predecessor"]
    assert [b for b in result.blocked["A110"] if b.component == "readiness"]
    relaxed = compute_startable(session, seeded["project_id"], threshold=0.5)
    assert relaxed.startable == ["A110"]
    assert all(any(b.component == "predecessor" for b in bl) for act, bl in relaxed.blocked.items())


def test_resource_caps_limit_concurrent_starts(session, tmp_path, monkeypatch):
    import yaml

    from packages.core.settings import settings

    (tmp_path / "resources.yaml").write_text(yaml.safe_dump({"caps": {"crew": 8}}), encoding="utf-8")
    monkeypatch.setattr(settings, "config_dir", str(tmp_path))
    schedule = Schedule(schedule_id="S", project_id="P-CAP", source_format="csv", relations=[
        ActivityRelation(predecessor_id="B1", successor_id="B4", type="FF")], activities=[
        Activity(activity_id="B1", name="1F 기둥", planned_start="2026-09-03", resources={"crew": 4, "drawing_approved": 1}),
        Activity(activity_id="B2", name="1F 보", planned_start="2026-09-01", resources={"crew": 4, "drawing_approved": 1}),
        Activity(activity_id="B3", name="1F 벽", planned_start="2026-09-02", resources={"crew": 4, "drawing_approved": 1}),
        Activity(activity_id="B4", name="1F 덕트", planned_start="2026-09-04", resources={"crew": 4, "drawing_approved": 1}),
    ])
    db.save_schedule(session, schedule)
    result = compute_startable(session, "P-CAP")
    assert result.startable == ["B2", "B3"]        # 인원 8명 한도 → 착수일 빠른 두 개
    assert result.solver_status == "OPTIMAL"
    assert {a for a in result.blocked} == {"B1", "B4"}
    assert all(b.component == "resource" for b in result.blocked["B1"])
    greedy = compute_startable(session, "P-CAP", use_solver=False)
    assert greedy.startable == result.startable and greedy.solver_status == "greedy_fallback"


def test_threshold_override_blocks_low_readiness(session, seeded):
    result = compute_startable(session, seeded["project_id"], threshold=1.0)
    assert result.startable == [] and result.threshold == 1.0
    assert any(b.component == "readiness" for b in result.blocked["A100"])
