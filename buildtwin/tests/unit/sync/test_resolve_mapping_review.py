"""resolve_mapping_review: conflicting_sources 파싱은 sync 가 하고, ReviewRequestRow 하나를 처리한다.
api 는 이 함수만 호출한다(dict 키 이름을 몰라도 됨). packages.core.db 의 in-memory sqlite 사용."""
from __future__ import annotations

import pytest
from sqlalchemy import select

from packages.core.db import init_db, new_session, reset_engine
from packages.core.models import EntityObjectMapping, Evidence
from packages.core.models.orm import (
    BimObjectRow,
    DrawingRow,
    EntityObjectMappingRow,
    FileRow,
    ProjectRow,
    ReviewRequestRow,
)
from services.sync.persistence import open_mapping_reviews, rebuild_mappings
from services.sync.review_queue import MappingReviewResolution, resolve_mapping_review

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


def _m(handle: str, gid: str, conf: float) -> EntityObjectMapping:
    ev = Evidence(source_type="mapping", source_id=D, method="grid_align|bbox_iou", extra={"iou": conf, "rule_score": 0})
    return EntityObjectMapping(drawing_id=D, entity_handle=handle, global_id=gid, confidence=conf, evidence=ev)


def _mapping_review(s, handle: str) -> ReviewRequestRow:
    """rebuild_mappings 로 kind=mapping, needs_review 인 검토요청 하나를 자연스럽게 만든다.
    candidate_global_id(G-{handle})가 실존하는 BimObjectRow 를 가리키도록 함께 만든다 — approved 경로는
    confirm_mapping_row 를 거치며, 그 함수는 이제 (project_id, global_id) 존재를 확인한다(observation 7)."""
    s.add(BimObjectRow(project_id=P, global_id=f"G-{handle}", model_id="m1", ifc_type="IfcColumn"))
    s.commit()
    r = rebuild_mappings(s, D, P, [_m(handle, f"G-{handle}", 0.3)])
    s.commit()
    return s.get(ReviewRequestRow, r.review_request_ids[0])


def test_approved_confirms_mapping_and_closes_review(session):
    s = session
    row = _mapping_review(s, "A")
    res = resolve_mapping_review(s, row, "approved", user_id="cm-01", note="확인함")
    s.commit()

    assert isinstance(res, MappingReviewResolution)
    assert res.review_request_ids == [row.review_request_id]
    assert res.drawing_id == D and res.entity_handle == "A"
    assert res.mapping is not None
    assert res.mapping.global_id == "G-A" and res.mapping.reviewed_by == "cm-01" and res.mapping.needs_review is False
    assert res.mapping.evidence.note == "확인함"

    s.refresh(row)
    assert row.status == "approved" and row.resolved_by == "cm-01" and row.resolution_note == "확인함"
    map_row = s.scalars(select(EntityObjectMappingRow).where(EntityObjectMappingRow.entity_handle == "A")).one()
    assert map_row.reviewed_by == "cm-01" and map_row.needs_review is False
    assert open_mapping_reviews(s, D) == []


def test_rejected_closes_review_without_writing_mapping(session):
    s = session
    row = _mapping_review(s, "B")
    res = resolve_mapping_review(s, row, "rejected", user_id="cm-02", note="아니다")
    s.commit()

    assert res.review_request_ids == [row.review_request_id]
    assert res.mapping is None

    s.refresh(row)
    assert row.status == "rejected" and row.resolved_by == "cm-02" and row.resolution_note == "아니다"
    map_row = s.scalars(select(EntityObjectMappingRow).where(EntityObjectMappingRow.entity_handle == "B")).one()
    assert map_row.reviewed_by is None and map_row.needs_review is True   # 매핑 자체는 건드리지 않는다
    assert open_mapping_reviews(s, D) == []


def test_approved_rejects_nonexistent_candidate_object(session):
    """observation 7: resolve_mapping_review 는 confirm_mapping_row 를 거치므로 같은 존재 확인을 물려받는다."""
    s = session
    row = ReviewRequestRow(review_request_id="rr-ghost", project_id=P, kind="mapping", global_id=None,
                           title="t", conflicting_sources={"drawing_id": D, "entity_handle": "C",
                                                            "candidate_global_id": "G-GHOST"},
                           confidence=0.3, evidence={"source_type": "mapping", "source_id": D}, status="open")
    s.add(row)
    s.commit()
    with pytest.raises(ValueError, match="object not found"):
        resolve_mapping_review(s, row, "approved", user_id="cm-01")
    assert s.scalars(select(EntityObjectMappingRow).where(EntityObjectMappingRow.entity_handle == "C")).first() is None


def test_rejects_non_mapping_row(session):
    s = session
    row = ReviewRequestRow(review_request_id="rr-verif", project_id=P, kind="verification", global_id=None,
                           title="t", conflicting_sources={}, confidence=0.5,
                           evidence={"source_type": "rule", "source_id": "r1"}, status="open")
    s.add(row)
    s.commit()
    with pytest.raises(ValueError, match="kind='mapping'"):
        resolve_mapping_review(s, row, "approved", user_id="cm-01")


def test_rejects_malformed_conflicting_sources(session):
    s = session
    row = ReviewRequestRow(review_request_id="rr-bad", project_id=P, kind="mapping", global_id=None,
                           title="t", conflicting_sources={"confidence": 0.3},   # drawing_id/entity_handle 없음
                           confidence=0.3, evidence={"source_type": "mapping", "source_id": D}, status="open")
    s.add(row)
    s.commit()
    with pytest.raises(ValueError, match="malformed"):
        resolve_mapping_review(s, row, "approved", user_id="cm-01")
