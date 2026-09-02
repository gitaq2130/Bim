"""검토요청 처리: ExpertReviewLog 기록, inspection 승인 → CONFIRMED, verification 승인 → 차단 해제."""
from __future__ import annotations

import uuid

from sqlalchemy import select

from packages.core.db import new_session
from packages.core.models.orm import (
    ActivityObjectMappingRow,
    BimObjectRow,
    EntityObjectMappingRow,
    ExpertReviewLogRow,
    ReviewRequestRow,
    ScanVerdictRow,
    StateTransitionRow,
)

# (project_id, global_id) 를 FK 로 참조하는 모든 테이블(ADR 0005) — orphan 시나리오를 만들려면
# bim_objects 행을 지우기 전에 이들도 함께 지웠다가 되돌려야 FK 위반 없이 복구된다.
_FK_DEPENDENT_MODELS = (StateTransitionRow, EntityObjectMappingRow, ActivityObjectMappingRow, ScanVerdictRow)


def _logs(entity_type: str, entity_id: str) -> list[ExpertReviewLogRow]:
    s = new_session()
    try:
        return list(s.scalars(select(ExpertReviewLogRow).where(ExpertReviewLogRow.entity_type == entity_type,
                                                              ExpertReviewLogRow.entity_id == entity_id)))
    finally:
        s.close()


def _row_snapshot(model: type, row: object) -> dict:
    return {c.name: getattr(row, c.name) for c in model.__table__.columns}


def _snapshot_object(project: str, gid: str) -> tuple[dict, list[tuple[type, dict]]]:
    """(project, gid) 의 bim_objects 행과, 그것을 FK 로 참조하는 다른 테이블의 행들을 있는 그대로 캡처한다."""
    s = new_session()
    try:
        obj = s.get(BimObjectRow, (project, gid))
        assert obj is not None, f"object not found: {gid}"
        obj_snapshot = _row_snapshot(BimObjectRow, obj)
        deps = [(model, _row_snapshot(model, row)) for model in _FK_DEPENDENT_MODELS
               for row in s.scalars(select(model).where(model.project_id == project, model.global_id == gid))]
        return obj_snapshot, deps
    finally:
        s.close()


def _delete_object_and_dependents(project: str, gid: str) -> None:
    """(project, gid) 를 참조하는 FK 의존 행을 모두 지운 뒤 bim_objects 행 자체를 지운다."""
    s = new_session()
    try:
        for model in _FK_DEPENDENT_MODELS:
            for row in s.scalars(select(model).where(model.project_id == project, model.global_id == gid)):
                s.delete(row)
        s.flush()
        obj = s.get(BimObjectRow, (project, gid))
        if obj is not None:
            s.delete(obj)
        s.commit()
    finally:
        s.close()


def _restore_object(project: str, gid: str, obj_snapshot: dict, dep_snapshots: list[tuple[type, dict]]) -> None:
    """`_snapshot_object` 로 찍어둔 원래 상태로 정확히 되돌린다(테스트 도중 새로 생긴 행까지 지우고 복구)."""
    _delete_object_and_dependents(project, gid)
    s = new_session()
    try:
        s.merge(BimObjectRow(**obj_snapshot))
        s.flush()
        for model, snap in dep_snapshots:
            s.merge(model(**snap))
        s.commit()
    finally:
        s.close()


def _delete_review_request(review_request_id: str) -> None:
    s = new_session()
    try:
        s.query(ReviewRequestRow).filter_by(review_request_id=review_request_id).delete()
        s.commit()
    finally:
        s.close()


def test_resolve_verification_review_records_log(client, auth, project, ifc_job):
    open_reviews = client.get(f"/api/projects/{project}/review-requests", headers=auth("cm"),
                              params={"kind": "verification", "status": "open"}).json()
    assert open_reviews, "test_06 should have created a verification review"
    rv = next((x for x in open_reviews if x["rule_id"] == "VER-001"), open_reviews[0])   # test_06 의 완료신고 vs NOT_BUILT
    state_before = client.get(f"/api/objects/{rv['global_id']}", headers=auth("cm")).json()["current_state"]["state"]
    assert client.post(f"/api/review-requests/{rv['review_request_id']}/resolve", headers=auth("cm"), json={"note": "x"}).status_code == 422
    r = client.post(f"/api/review-requests/{rv['review_request_id']}/resolve", headers=auth("cm"),
                    json={"decision": "approved", "note": "현장 확인 결과 신고 인정"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "approved" and out["resolved_by"] and out["resolved_at"] and out["resolution_note"]
    logs = _logs("review_request", rv["review_request_id"])
    assert len(logs) == 1 and logs[0].proposal["status"] == "open" and logs[0].final["status"] == "approved"
    assert any(d["path"] == "status" for d in logs[0].diff)
    # 상태는 그대로(verification 은 차단 해제만)
    d = client.get(f"/api/objects/{rv['global_id']}", headers=auth("cm")).json()
    assert d["current_state"]["state"] == state_before
    assert rv["review_request_id"] not in d["current_state"]["open_review_ids"]
    # 두 번 처리 불가
    assert client.post(f"/api/review-requests/{rv['review_request_id']}/resolve", headers=auth("cm"), json={"decision": "rejected"}).status_code == 409
    assert client.get(f"/api/review-requests/{rv['review_request_id']}", headers=auth("cm")).json()["status"] == "approved"


def test_inspection_review_approval_confirms_object(client, auth, project, ifc_job):
    items = client.get(f"/api/projects/{project}/objects", headers=auth("client"),
                       params={"state": "PLANNED", "ifc_type": "IfcSlab"}).json()["items"]
    if not items:
        items = client.get(f"/api/projects/{project}/objects", headers=auth("client"),
                           params={"state": "PLANNED", "level": "2F"}).json()["items"]
    gid = items[0]["global_id"]
    assert client.post(f"/api/objects/{gid}/transitions", headers=auth("contractor"), json={"to_state": "REPORTED"}).status_code == 201
    assert client.post(f"/api/objects/{gid}/transitions", headers=auth("contractor"), json={"to_state": "INSPECTION_REQUESTED"}).status_code == 201
    reviews = client.get(f"/api/projects/{project}/review-requests", headers=auth("cm"),
                         params={"kind": "inspection", "status": "open", "global_id": gid}).json()
    assert len(reviews) == 1
    rv = reviews[0]
    d = client.get(f"/api/objects/{gid}", headers=auth("cm")).json()
    assert any(a["kind"] == "resolve_review" and a["review_request_id"] == rv["review_request_id"] for a in d["next_actions"])
    assert client.post(f"/api/review-requests/{rv['review_request_id']}/resolve", headers=auth("admin"), json={"decision": "approved"}).status_code == 403
    r = client.post(f"/api/review-requests/{rv['review_request_id']}/resolve", headers=auth("cm"), json={"decision": "approved", "note": "검측 합격"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved" and r.json()["resolved_by"]
    d = client.get(f"/api/objects/{gid}", headers=auth("cm")).json()
    assert d["current_state"]["state"] == "CONFIRMED" and d["current_state"]["actor"] == "cm"
    assert d["history"][0]["review_request_id"] == rv["review_request_id"]
    assert _logs("review_request", rv["review_request_id"])


def test_inspection_rejection_returns_to_in_progress(client, auth, project, ifc_job):
    items = client.get(f"/api/projects/{project}/objects", headers=auth("client"),
                       params={"state": "PLANNED", "ifc_type": "IfcDuctSegment"}).json()["items"]
    gid = items[0]["global_id"]
    assert client.post(f"/api/objects/{gid}/transitions", headers=auth("contractor"), json={"to_state": "REPORTED"}).status_code == 201
    assert client.post(f"/api/objects/{gid}/transitions", headers=auth("contractor"), json={"to_state": "INSPECTION_REQUESTED"}).status_code == 201
    rv = client.get(f"/api/projects/{project}/review-requests", headers=auth("cm"),
                    params={"kind": "inspection", "status": "open", "global_id": gid}).json()[0]
    r = client.post(f"/api/review-requests/{rv['review_request_id']}/resolve", headers=auth("cm"), json={"action": "rejected", "note": "재작업"})
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    assert client.get(f"/api/objects/{gid}", headers=auth("cm")).json()["current_state"]["state"] == "IN_PROGRESS"


def test_resolve_review_with_orphaned_object_returns_404(client, auth, project, ifc_job):
    """ReviewRequestRow 의 (project_id, global_id) 가 이후 삭제로 더 이상 객체를 가리키지 못하면 500 이 아니라 404.

    `project` 는 세션 스코프 픽스처(다른 테스트 파일도 42개 객체를 전제)라, 객체와 그 FK 의존 행을
    스냅샷 후 지웠다가 테스트가 끝나면 정확히 원상복구한다.
    """
    items = client.get(f"/api/projects/{project}/objects", headers=auth("client"),
                       params={"state": "PLANNED"}).json()["items"]
    assert items, "no PLANNED object left to orphan"
    gid = items[0]["global_id"]
    obj_snapshot, dep_snapshots = _snapshot_object(project, gid)   # 아직 전이 전(PLANNED)의 원본 상태

    rv = None
    try:
        assert client.post(f"/api/objects/{gid}/transitions", headers=auth("contractor"), json={"to_state": "REPORTED"}).status_code == 201
        assert client.post(f"/api/objects/{gid}/transitions", headers=auth("contractor"),
                           json={"to_state": "INSPECTION_REQUESTED"}).status_code == 201
        rv = client.get(f"/api/projects/{project}/review-requests", headers=auth("cm"),
                        params={"kind": "inspection", "status": "open", "global_id": gid}).json()[0]

        _delete_object_and_dependents(project, gid)   # 객체가 삭제/재업로드로 사라진 상황을 재현

        r = client.post(f"/api/review-requests/{rv['review_request_id']}/resolve", headers=auth("cm"),
                        json={"decision": "approved", "note": "객체가 삭제된 뒤 처리 시도"})
        assert r.status_code == 404, r.text
        detail = r.json()["detail"]
        assert rv["review_request_id"] in detail
        assert gid in detail
        # 검토요청 자체는 여전히 open 으로 남는다(상태기계가 처리하지 못했으므로)
        assert client.get(f"/api/review-requests/{rv['review_request_id']}", headers=auth("cm")).json()["status"] == "open"
    finally:
        _restore_object(project, gid, obj_snapshot, dep_snapshots)
        if rv is not None:
            _delete_review_request(rv["review_request_id"])


def test_resolve_mapping_review_with_deleted_candidate_returns_4xx(client, auth, project, dxf_job):
    """kind=mapping 검토요청의 candidate_global_id 가 처리 시점에 이미 삭제돼 있으면(sync.confirm_mapping_row 가
    ValueError) 500 이 아니라 4xx 여야 한다. 실제 저신뢰 매핑을 기다리지 않고, 곧 지울 후보 객체로 요청을 직접 구성한다."""
    did = dxf_job["result"]["drawing_id"]
    mappings = client.get(f"/api/drawings/{did}/mappings", headers=auth("client")).json()
    m = mappings[0]
    entity_handle = m["entity_handle"]

    items = client.get(f"/api/projects/{project}/objects", headers=auth("client"), params={"state": "PLANNED"}).json()["items"]
    candidate = next(o["global_id"] for o in items if o["global_id"] != m["global_id"])
    obj_snapshot, dep_snapshots = _snapshot_object(project, candidate)

    review_request_id = str(uuid.uuid4())
    s = new_session()
    try:
        s.add(ReviewRequestRow(
            review_request_id=review_request_id, project_id=project, kind="mapping", global_id=m["global_id"],
            title="테스트: 삭제된 후보 객체로의 매핑 확인", confidence=0.5,
            evidence={"source_type": "mapping", "source_id": entity_handle, "method": "test_setup", "extra": {}},
            conflicting_sources={"drawing_id": did, "entity_handle": entity_handle, "candidate_global_id": candidate,
                                 "confidence": 0.5},
            assignee_role="cm", status="open"))
        s.commit()
    finally:
        s.close()

    try:
        _delete_object_and_dependents(project, candidate)   # 후보 객체가 삭제/재업로드로 사라진 상황을 재현

        r = client.post(f"/api/review-requests/{review_request_id}/resolve", headers=auth("cm"),
                        json={"decision": "approved", "note": "후보 객체가 삭제된 뒤 처리 시도"})
        assert r.status_code in (404, 409), r.text
        assert review_request_id in r.json()["detail"]
        # 실제 엔티티 매핑은 건드리지 않았어야 한다(확정이 실패했으므로)
        after = {x["entity_handle"]: x for x in client.get(f"/api/drawings/{did}/mappings", headers=auth("client")).json()}
        assert after[entity_handle]["global_id"] == m["global_id"]
    finally:
        _restore_object(project, candidate, obj_snapshot, dep_snapshots)
        _delete_review_request(review_request_id)
