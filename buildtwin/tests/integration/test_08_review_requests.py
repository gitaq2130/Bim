"""검토요청 처리: ExpertReviewLog 기록, inspection 승인 → CONFIRMED, verification 승인 → 차단 해제."""
from __future__ import annotations

import uuid

import pytest
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

from .conftest import FIXTURES, upload

# (project_id, global_id) 를 FK 로 참조하는 모든 테이블(ADR 0005) — orphan 시나리오를 만들려면
# bim_objects 행을 지우기 전에 이들도 함께 지워야 FK 위반이 나지 않는다.
_FK_DEPENDENT_MODELS = (StateTransitionRow, EntityObjectMappingRow, ActivityObjectMappingRow, ScanVerdictRow)


def _logs(entity_type: str, entity_id: str) -> list[ExpertReviewLogRow]:
    s = new_session()
    try:
        return list(s.scalars(select(ExpertReviewLogRow).where(ExpertReviewLogRow.entity_type == entity_type,
                                                              ExpertReviewLogRow.entity_id == entity_id)))
    finally:
        s.close()


def _delete_object_and_dependents(project: str, gid: str) -> None:
    """(project, gid) 를 참조하는 FK 의존 행을 모두 지운 뒤 bim_objects 행 자체를 지운다(orphan 재현용)."""
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


@pytest.fixture
def isolated_project(client, auth) -> str:
    """이 테스트 함수만을 위한 새 프로젝트. 세션 스코프 `project` 픽스처(다른 파일도 공유, 예: test_02 의
    object_total == 42)는 절대 건드리지 않는다 — orphan 을 만들려고 뭔가를 지워야 하는 테스트는 이 픽스처로
    자기 소유의 프로젝트를 받아 그 안에서만 지운다. 함수 스코프라 테스트 실행 순서·재실행 여부에 영향받지 않는다."""
    r = client.post("/api/projects", headers=auth("admin"), json={"name": f"검토요청 격리 테스트 {uuid.uuid4().hex[:8]}"})
    assert r.status_code == 201, r.text
    return r.json()["project_id"]


@pytest.fixture
def isolated_ifc_project(client, auth, isolated_project) -> str:
    """`isolated_project` 에 sample.ifc 를 새로 올린다. project_id 가 다르므로 세션 픽스처 `ifc_job` 이 이미
    올린 것과 global_id 가 겹쳐도(ADR 0005: PK 는 (project_id, global_id)) 서로 격리된다."""
    up, job = upload(client, auth("contractor"), isolated_project, FIXTURES / "sample.ifc")
    assert up["kind"] == "ifc" and job["status"] == "done", job
    return isolated_project


@pytest.fixture
def isolated_dxf_project(client, auth, isolated_ifc_project) -> dict:
    """`isolated_ifc_project` 에 sample.dxf 까지 올려 project_id 와 drawing_id 를 함께 돌려준다."""
    up, job = upload(client, auth("cm"), isolated_ifc_project, FIXTURES / "sample.dxf", level="1F")
    assert up["kind"] == "dxf" and job["status"] == "done", job
    return {"project_id": isolated_ifc_project, "drawing_id": job["result"]["drawing_id"]}


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


def test_resolve_review_with_orphaned_object_returns_404(client, auth, isolated_ifc_project):
    """ReviewRequestRow 의 (project_id, global_id) 가 이후 삭제로 더 이상 객체를 가리키지 못하면 500 이 아니라 404.

    orphan 을 만들려면 객체를 실제로 지워야 하므로, 세션 스코프 `project` 픽스처(다른 테스트 파일도 42개
    객체·PLANNED 상태를 전제, 예: test_02 의 object_total == 42)는 절대 쓰지 않는다 — `isolated_ifc_project`
    로 이 테스트만의 프로젝트를 새로 만들어 그 안에서만 지우고 끝낸다(복구 불필요, 다른 테스트에 영향 없음).
    """
    proj = isolated_ifc_project
    items = client.get(f"/api/projects/{proj}/objects", headers=auth("client"),
                       params={"state": "PLANNED"}).json()["items"]
    assert items, "no PLANNED object to orphan"
    gid = items[0]["global_id"]

    # global_id 는 sample.ifc 를 공유하는 다른 프로젝트(세션 픽스처 `project` 등)와 겹칠 수 있으므로
    # (project_id, global_id) 가 PK 인 ADR 0005 에 따라 project_id 로 명시 disambiguate 한다.
    assert client.post(f"/api/objects/{gid}/transitions", headers=auth("contractor"), params={"project_id": proj},
                       json={"to_state": "REPORTED"}).status_code == 201
    assert client.post(f"/api/objects/{gid}/transitions", headers=auth("contractor"), params={"project_id": proj},
                       json={"to_state": "INSPECTION_REQUESTED"}).status_code == 201
    rv = client.get(f"/api/projects/{proj}/review-requests", headers=auth("cm"),
                    params={"kind": "inspection", "status": "open", "global_id": gid}).json()[0]

    _delete_object_and_dependents(proj, gid)   # 객체가 삭제/재업로드로 사라진 상황을 재현

    r = client.post(f"/api/review-requests/{rv['review_request_id']}/resolve", headers=auth("cm"),
                    json={"decision": "approved", "note": "객체가 삭제된 뒤 처리 시도"})
    assert r.status_code == 404, r.text
    detail = r.json()["detail"]
    assert rv["review_request_id"] in detail
    assert gid in detail
    # 검토요청 자체는 여전히 open 으로 남는다(상태기계가 처리하지 못했으므로)
    assert client.get(f"/api/review-requests/{rv['review_request_id']}", headers=auth("cm")).json()["status"] == "open"


def test_resolve_mapping_review_with_deleted_candidate_returns_4xx(client, auth, isolated_dxf_project):
    """kind=mapping 검토요청의 candidate_global_id 가 처리 시점에 이미 삭제돼 있으면(sync.confirm_mapping_row 가
    ValueError) 500 이 아니라 4xx 여야 한다. 실제 저신뢰 매핑을 기다리지 않고, 곧 지울 후보 객체로 요청을 직접 구성한다.

    `isolated_dxf_project` 는 이 테스트 전용 프로젝트라, 후보 객체를 지워도 세션 스코프 `project` 픽스처가
    다른 테스트 파일에 남겨야 하는 상태(예: test_02 의 object_total == 42)를 건드리지 않는다."""
    proj = isolated_dxf_project["project_id"]
    did = isolated_dxf_project["drawing_id"]
    mappings = client.get(f"/api/drawings/{did}/mappings", headers=auth("client")).json()
    m = mappings[0]
    entity_handle = m["entity_handle"]

    items = client.get(f"/api/projects/{proj}/objects", headers=auth("client"), params={"state": "PLANNED"}).json()["items"]
    candidate = next(o["global_id"] for o in items if o["global_id"] != m["global_id"])

    review_request_id = str(uuid.uuid4())
    s = new_session()
    try:
        s.add(ReviewRequestRow(
            review_request_id=review_request_id, project_id=proj, kind="mapping", global_id=m["global_id"],
            title="테스트: 삭제된 후보 객체로의 매핑 확인", confidence=0.5,
            evidence={"source_type": "mapping", "source_id": entity_handle, "method": "test_setup", "extra": {}},
            conflicting_sources={"drawing_id": did, "entity_handle": entity_handle, "candidate_global_id": candidate,
                                 "confidence": 0.5},
            assignee_role="cm", status="open"))
        s.commit()
    finally:
        s.close()

    _delete_object_and_dependents(proj, candidate)   # 후보 객체가 삭제/재업로드로 사라진 상황을 재현

    r = client.post(f"/api/review-requests/{review_request_id}/resolve", headers=auth("cm"),
                    json={"decision": "approved", "note": "후보 객체가 삭제된 뒤 처리 시도"})
    assert r.status_code in (404, 409), r.text
    assert review_request_id in r.json()["detail"]
    # 실제 엔티티 매핑은 건드리지 않았어야 한다(확정이 실패했으므로)
    after = {x["entity_handle"]: x for x in client.get(f"/api/drawings/{did}/mappings", headers=auth("client")).json()}
    assert after[entity_handle]["global_id"] == m["global_id"]
