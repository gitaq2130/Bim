"""매핑 생명주기(rebuild_mappings)·검토요청 해소(사람만)·행 단위 확정 테스트. packages.core.db 의 in-memory sqlite 사용."""
from __future__ import annotations

import pytest
from sqlalchemy import select

from packages.core.db import init_db, new_session, reset_engine
from packages.core.models import MAPPING_REVIEW_THRESHOLD, EntityObjectMapping, Evidence
from packages.core.models.orm import (
    BimObjectRow,
    DrawingRow,
    EntityObjectMappingRow,
    FileRow,
    ProjectRow,
    ReviewRequestRow,
)
from services.sync.config import load_sync_config
from services.sync.persistence import RebuildResult, load_mappings, open_mapping_reviews, rebuild_mappings
from services.sync.review_queue import confirm_mapping_row, resolve_mapping_reviews
from services.sync.rules import layer_rule_score, load_layer_rules

D, P = "d1", "p1"


@pytest.fixture
def session():
    reset_engine()
    init_db("sqlite://")
    s = new_session()
    s.add(ProjectRow(project_id=P, name="P"))
    s.add(FileRow(file_id="f1", project_id=P, kind="dxf", filename="a.dxf", uri="x", sha256="0", size=1))
    s.add(DrawingRow(drawing_id=D, project_id=P, file_id="f1", level="1F", coordinate_system={"source": "dxf_local"}))
    s.commit()
    try:
        yield s
    finally:
        s.close()
        reset_engine()


def _m(handle: str, gid: str, conf: float, drawing_id: str = D) -> EntityObjectMapping:
    ev = Evidence(source_type="mapping", source_id=drawing_id, method="grid_align|bbox_iou", extra={"iou": conf, "rule_score": 0})
    return EntityObjectMapping(drawing_id=drawing_id, entity_handle=handle, global_id=gid, confidence=conf, evidence=ev)


def _reviews(s) -> dict[str, ReviewRequestRow]:
    rows = s.scalars(select(ReviewRequestRow).where(ReviewRequestRow.kind == "mapping")).all()
    return {r.review_request_id: r for r in rows}


def _assert_system_never_resolves(s):
    for r in _reviews(s).values():
        assert r.resolved_by != "system"
        if r.resolved_by is None:
            assert r.status in ("open", "on_hold")


def test_rebuild_creates_reviews_and_supersedes_previous(session):
    s = session
    r1 = rebuild_mappings(s, D, P, [_m("A", "G1", 0.9), _m("B", "G2", 0.5), _m("C", "G3", 0.4)])
    s.commit()
    assert isinstance(r1, RebuildResult)
    assert (r1.saved, r1.kept_confirmed, r1.review_requests_created, r1.review_requests_superseded) == (3, 0, 2, 0)
    open_ids = {r.review_request_id for r in open_mapping_reviews(s, D)}
    assert open_ids == set(r1.review_request_ids) and len(open_ids) == 2
    first_c = next(r for r in _reviews(s).values() if r.conflicting_sources["entity_handle"] == "C")

    # 재정합: 검토 없이 다시 만들면 이전 open 요청은 on_hold + superseded_by=<새 id>
    r2 = rebuild_mappings(s, D, P, [_m("A", "G1", 0.95), _m("B", "G2", 0.8), _m("C", "G9", 0.3)])
    s.commit()
    assert (r2.saved, r2.kept_confirmed, r2.review_requests_created, r2.review_requests_superseded) == (3, 0, 1, 2)
    s.refresh(first_c)
    assert first_c.status == "on_hold" and first_c.resolved_by is None and first_c.resolved_at is None
    assert first_c.resolution_note == f"superseded_by={r2.review_request_ids[0]}"
    old_b = next(r for r in _reviews(s).values() if r.conflicting_sources["entity_handle"] == "B" and r.status != "open")
    assert old_b.status == "on_hold" and old_b.resolution_note == "superseded_by=realignment"   # B 는 새 검토요청 없음
    assert {m.entity_handle: m.global_id for m in load_mappings(s, D)} == {"A": "G1", "B": "G2", "C": "G9"}
    assert len(open_mapping_reviews(s, D)) == 1
    assert all(m.needs_review == (m.confidence < MAPPING_REVIEW_THRESHOLD) for m in load_mappings(s, D))
    _assert_system_never_resolves(s)


def test_rebuild_keeps_confirmed_rows_and_manual_mappings(session):
    s = session
    rebuild_mappings(s, D, P, [_m("A", "G1", 0.9), _m("B", "G2", 0.5)])
    s.commit()
    confirmed = confirm_mapping_row(s, D, "B", "G2", user_id="cm-01", note="ok")
    manual = confirm_mapping_row(s, D, "Z", "G7", user_id="cm-01")
    s.commit()
    assert confirmed.reviewed_by == "cm-01" and confirmed.needs_review is False and confirmed.confidence == 0.5
    assert confirmed.evidence.note == "ok"
    assert manual.confidence == 1.0 and manual.evidence.source_type == "user_input" and manual.evidence.source_id == "cm-01"
    assert manual.reviewed_by == "cm-01" and manual.evidence.method == "manual_mapping"
    b_review = next(r for r in _reviews(s).values() if r.conflicting_sources["entity_handle"] == "B")
    assert b_review.status == "approved" and b_review.resolved_by == "cm-01" and b_review.resolved_at is not None
    assert b_review.resolution_note == "ok"

    r = rebuild_mappings(s, D, P, [_m("A", "G1", 0.2), _m("B", "G5", 0.3), _m("Z", "G8", 0.1)])
    s.commit()
    assert (r.saved, r.kept_confirmed, r.review_requests_created, r.review_requests_superseded) == (1, 2, 1, 0)
    got = {m.entity_handle: m for m in load_mappings(s, D)}
    assert got["B"].global_id == "G2" and got["B"].reviewed_by == "cm-01"        # 확정 유지
    assert got["Z"].global_id == "G7" and got["Z"].confidence == 1.0             # 수동 매핑 유지
    assert got["A"].global_id == "G1" and got["A"].needs_review is True
    s.refresh(b_review)
    assert b_review.status == "approved"                                          # 이미 해소된 요청은 건드리지 않는다

    # keep_confirmed=False: 전부 교체, open 요청은 on_hold
    a_open = open_mapping_reviews(s, D, "A")[0]
    r = rebuild_mappings(s, D, P, [_m("B", "G5", 0.9)], keep_confirmed=False)
    s.commit()
    assert (r.saved, r.kept_confirmed, r.review_requests_created, r.review_requests_superseded) == (1, 0, 0, 1)
    assert {m.entity_handle: m.global_id for m in load_mappings(s, D)} == {"B": "G5"}
    s.refresh(a_open)
    assert a_open.status == "on_hold" and a_open.resolution_note == "superseded_by=realignment"
    _assert_system_never_resolves(s)
    with pytest.raises(ValueError):
        rebuild_mappings(s, D, P, [EntityObjectMapping(drawing_id="other", entity_handle="Q", global_id="G", confidence=0.9,
                                                       evidence=_m("Q", "G", 0.9).evidence)])


def test_resolve_mapping_reviews_is_human_only(session):
    s = session
    rebuild_mappings(s, D, P, [_m("A", "G1", 0.4), _m("B", "G2", 0.4)])
    s.commit()
    closed = resolve_mapping_reviews(s, D, "A", "rejected", user_id="cm-02", note="wrong object")
    s.commit()
    assert len(closed) == 1
    row = s.get(ReviewRequestRow, closed[0])
    assert row.status == "rejected" and row.resolved_by == "cm-02" and row.resolution_note == "wrong object"
    assert [r.conflicting_sources["entity_handle"] for r in open_mapping_reviews(s, D)] == ["B"]
    assert resolve_mapping_reviews(s, D, "A", "approved", user_id="cm-02") == []       # 이미 닫힘
    with pytest.raises(ValueError):
        resolve_mapping_reviews(s, D, "B", "approved", user_id="")
    with pytest.raises(ValueError):
        resolve_mapping_reviews(s, D, "B", "superseded", user_id="cm-02")  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        confirm_mapping_row(s, D, "B", "G2", user_id=" ")
    # 매핑 행은 그대로(rejected 는 매핑을 지우지 않는다 — 재지정은 confirm_mapping_row 로)
    assert {r.entity_handle for r in s.scalars(select(EntityObjectMappingRow))} == {"A", "B"}
    _assert_system_never_resolves(s)


def test_review_threshold_single_sourced_and_penalty_from_config(tmp_path):
    cfg = load_sync_config()
    assert cfg.review_threshold == MAPPING_REVIEW_THRESHOLD
    assert "review_threshold" not in cfg.model_fields
    base = (tmp_path / "ok.yaml")
    src = open(load_sync_config.__globals__["config_path"](), encoding="utf-8").read()
    base.write_text(src + f"\nreview_threshold: {MAPPING_REVIEW_THRESHOLD}\n")
    assert load_sync_config(base).review_threshold == MAPPING_REVIEW_THRESHOLD      # 같은 값이면 허용
    bad = tmp_path / "bad.yaml"
    bad.write_text(src + "\nreview_threshold: 0.8\n")
    with pytest.raises(ValueError, match="MAPPING_REVIEW_THRESHOLD"):
        load_sync_config(bad)
    rules = load_layer_rules()
    assert layer_rule_score("A-COL", None, "IfcBeam", rules) == cfg.rule_mismatch_penalty
    assert layer_rule_score("A-COL", None, "IfcBeam", rules, mismatch_penalty=-0.1) == -0.1


def test_mappings_are_project_scoped(session):
    """ADR 0005 회귀: 두 프로젝트가 같은 global_id 를 갖는 객체를 각자 소유해도 매핑이 섞이지 않는다.
    A 의 rebuild_mappings 는 B 의 행을 절대 건드리지 않는다."""
    s = session
    P2, D2, SHARED = "p2", "d2", "SHARED-1"
    s.add(ProjectRow(project_id=P2, name="P2"))
    s.add(FileRow(file_id="f2", project_id=P2, kind="dxf", filename="b.dxf", uri="y", sha256="1", size=1))
    s.add(DrawingRow(drawing_id=D2, project_id=P2, file_id="f2", level="1F", coordinate_system={"source": "dxf_local"}))
    # 두 프로젝트가 같은 global_id 를 갖는 서로 다른 객체를 소유(ADR 0005 이전이면 PK 충돌)
    s.add(BimObjectRow(project_id=P, global_id=SHARED, model_id="m1", ifc_type="IfcColumn"))
    s.add(BimObjectRow(project_id=P2, global_id=SHARED, model_id="m2", ifc_type="IfcColumn"))
    s.commit()

    rebuild_mappings(s, D, P, [_m("A", SHARED, 0.9)])
    rebuild_mappings(s, D2, P2, [_m("A", SHARED, 0.9, drawing_id=D2)])
    s.commit()

    a_rows = s.scalars(select(EntityObjectMappingRow).where(EntityObjectMappingRow.drawing_id == D)).all()
    b_rows = s.scalars(select(EntityObjectMappingRow).where(EntityObjectMappingRow.drawing_id == D2)).all()
    assert {r.project_id for r in a_rows} == {P}
    assert {r.project_id for r in b_rows} == {P2}

    # project_id 가 다르면 (같은 global_id 라도) 상대 프로젝트 도면의 매핑이 보이지 않는다
    assert [m.global_id for m in load_mappings(s, D, project_id=P)] == [SHARED]
    assert load_mappings(s, D, project_id=P2) == []       # 방어적 필터: 잘못된 project_id 면 빈 결과
    assert [m.global_id for m in load_mappings(s, D2, project_id=P2)] == [SHARED]

    b_before = {(m.entity_handle, m.global_id) for m in load_mappings(s, D2)}

    # A 의 재구성은 B 의 매핑에 전혀 영향을 주지 않는다
    r = rebuild_mappings(s, D, P, [_m("A", SHARED, 0.99)])
    s.commit()
    assert r.saved == 1
    b_after = {(m.entity_handle, m.global_id) for m in load_mappings(s, D2)}
    assert b_after == b_before

    # confirm_mapping_row(도면에서 project_id 유도)도 상대 프로젝트 행을 건드리지 않는다
    confirm_mapping_row(s, D2, "A", SHARED, user_id="cm-09")
    s.commit()
    confirmed_row = s.scalars(select(EntityObjectMappingRow).where(
        EntityObjectMappingRow.drawing_id == D2, EntityObjectMappingRow.entity_handle == "A")).one()
    assert confirmed_row.project_id == P2
    a_untouched = s.scalars(select(EntityObjectMappingRow).where(EntityObjectMappingRow.drawing_id == D)).all()
    assert {r.project_id for r in a_untouched} == {P}
