"""검토요청 처리: ExpertReviewLog 기록, inspection 승인 → CONFIRMED, verification 승인 → 차단 해제."""
from __future__ import annotations

from sqlalchemy import select

from packages.core.db import new_session
from packages.core.models.orm import BimObjectRow, ExpertReviewLogRow


def _logs(entity_type: str, entity_id: str) -> list[ExpertReviewLogRow]:
    s = new_session()
    try:
        return list(s.scalars(select(ExpertReviewLogRow).where(ExpertReviewLogRow.entity_type == entity_type,
                                                              ExpertReviewLogRow.entity_id == entity_id)))
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

    `project` 는 세션 스코프 픽스처(다른 테스트 파일도 42개 객체를 전제)라, 객체를 지웠다가
    검증이 끝나면 원래 행으로 복구하고 이 테스트가 만든 전이·검토요청 기록도 함께 지운다.
    """
    items = client.get(f"/api/projects/{project}/objects", headers=auth("client"),
                       params={"state": "PLANNED"}).json()["items"]
    assert items, "no PLANNED object left to orphan"
    gid = items[0]["global_id"]

    s = new_session()
    try:
        original = s.get(BimObjectRow, (project, gid))
        assert original is not None
        snapshot = {c.name: getattr(original, c.name) for c in BimObjectRow.__table__.columns}
    finally:
        s.close()

    assert client.post(f"/api/objects/{gid}/transitions", headers=auth("contractor"), json={"to_state": "REPORTED"}).status_code == 201
    assert client.post(f"/api/objects/{gid}/transitions", headers=auth("contractor"), json={"to_state": "INSPECTION_REQUESTED"}).status_code == 201
    rv = client.get(f"/api/projects/{project}/review-requests", headers=auth("cm"),
                    params={"kind": "inspection", "status": "open", "global_id": gid}).json()[0]

    s = new_session()
    try:
        row = s.get(BimObjectRow, (project, gid))
        assert row is not None
        s.delete(row)
        s.commit()
    finally:
        s.close()

    try:
        r = client.post(f"/api/review-requests/{rv['review_request_id']}/resolve", headers=auth("cm"),
                        json={"decision": "approved", "note": "객체가 삭제된 뒤 처리 시도"})
        assert r.status_code == 404, r.text
        detail = r.json()["detail"]
        assert rv["review_request_id"] in detail
        assert gid in detail
        # 검토요청 자체는 여전히 open 으로 남는다(상태기계가 처리하지 못했으므로)
        assert client.get(f"/api/review-requests/{rv['review_request_id']}", headers=auth("cm")).json()["status"] == "open"
    finally:
        s = new_session()
        try:
            s.query(StateTransitionRow).filter_by(project_id=project, global_id=gid).delete()
            s.query(ReviewRequestRow).filter_by(review_request_id=rv["review_request_id"]).delete()
            s.merge(BimObjectRow(**snapshot))
            s.commit()
        finally:
            s.close()
