"""ADR 0005 회귀 테스트: bim_objects PK 는 (project_id, global_id). 같은 IFC 를 두 프로젝트에 올려도
둘 다 성공하고, 프로젝트별 객체 수를 각자 보고하며, /api/objects/{global_id} 는 global_id 가 여러
프로젝트에 걸치면 409, ?project_id= 로 각 프로젝트의 객체를 정확히 해소해야 한다."""
from __future__ import annotations

from .conftest import FIXTURES, upload


def test_same_ifc_in_two_projects(client, auth, project, ifc_job, ifc_expected):
    """project 픽스처는 이미 sample.ifc 를 올렸다(42개 객체). 같은 파일을 새 프로젝트에도 올린다."""
    r = client.post("/api/projects", headers=auth("admin"), json={"name": "두 번째 현장(ADR 0005 회귀)"})
    assert r.status_code == 201, r.text
    project2 = r.json()["project_id"]
    assert project2 != project

    up, job = upload(client, auth("contractor"), project2, FIXTURES / "sample.ifc")
    assert up["kind"] == "ifc"
    assert job["status"] == "done", job   # ADR 0005 이전에는 GlobalIdConflictError 로 여기서 거부됐다
    total_expected = sum(ifc_expected["counts"].values())
    assert job["result"]["object_count"] == total_expected == 42

    # 두 프로젝트 모두 각자 42개를 독립적으로 보고한다(교차 오염 없음).
    r1 = client.get(f"/api/projects/{project}/objects", headers=auth("client"), params={"page_size": 500})
    r2 = client.get(f"/api/projects/{project2}/objects", headers=auth("client"), params={"page_size": 500})
    assert r1.status_code == r2.status_code == 200
    assert r1.json()["total"] == r2.json()["total"] == 42
    gids1 = {i["global_id"] for i in r1.json()["items"]}
    gids2 = {i["global_id"] for i in r2.json()["items"]}
    assert gids1 == gids2   # 같은 IFC 이므로 GlobalId 집합은 같다(프로젝트마다 독립된 행으로 존재)

    shared_gid = sorted(gids1)[0]

    # global_id 단독으로는 두 프로젝트 모두에 걸쳐 모호 → 409, project_id 후보를 안내한다.
    amb = client.get(f"/api/objects/{shared_gid}", headers=auth("cm"))
    assert amb.status_code == 409, amb.text
    detail = amb.json()["detail"]
    assert project in detail and project2 in detail and "project_id" in detail

    amb_t = client.post(f"/api/objects/{shared_gid}/transitions", headers=auth("contractor"),
                        json={"to_state": "REPORTED", "evidence": {"source_type": "user_input", "source_id": "x"}})
    assert amb_t.status_code == 409, amb_t.text

    # ?project_id= 를 주면 각각 정확한 프로젝트의 객체로 해소된다.
    d1 = client.get(f"/api/objects/{shared_gid}", headers=auth("cm"), params={"project_id": project})
    d2 = client.get(f"/api/objects/{shared_gid}", headers=auth("cm"), params={"project_id": project2})
    assert d1.status_code == d2.status_code == 200
    assert d1.json()["basic"]["project_id"] == project
    assert d2.json()["basic"]["project_id"] == project2
    assert d1.json()["basic"]["global_id"] == d2.json()["basic"]["global_id"] == shared_gid
    # 두 프로젝트의 상태 이력은 독립적이다(하나에서 전이해도 다른 쪽은 영향 없음).
    r = client.post(f"/api/objects/{shared_gid}/transitions", headers=auth("contractor"), params={"project_id": project2},
                    json={"to_state": "REPORTED", "evidence": {"source_type": "user_input", "source_id": "x"}})
    assert r.status_code == 201, r.text
    d1_after = client.get(f"/api/objects/{shared_gid}", headers=auth("cm"), params={"project_id": project}).json()
    d2_after = client.get(f"/api/objects/{shared_gid}", headers=auth("cm"), params={"project_id": project2}).json()
    assert d2_after["current_state"]["state"] == "REPORTED"
    assert d1_after["current_state"]["state"] == d1.json()["current_state"]["state"] == "PLANNED"
