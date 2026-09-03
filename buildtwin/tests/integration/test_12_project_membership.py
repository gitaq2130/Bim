"""ADR 0006: 프로젝트 멤버십과 인가. 이 파일은 자기 소유의 프로젝트·사용자만 만들어 쓴다 — 세션 스코프
`project` 픽스처(다른 테스트 파일이 42개 객체·특정 상태를 전제)를 건드리지 않는다."""
from __future__ import annotations

import uuid

from .conftest import FIXTURES, add_member, upload


def _register(client, auth, role: str) -> tuple[str, dict[str, str]]:
    """새 사용자를 만들고 (user_id, auth 헤더) 를 돌려준다. 여기 준 `role` 은 전역 `users.role` 일 뿐이고
    ADR 0006 §2 에 따라 인가 판단에는 쓰이지 않는다 — 프로젝트별 역할은 멤버십 행으로 따로 준다."""
    email = f"u-{uuid.uuid4().hex[:10]}@buildtwin.local"
    r = client.post("/api/auth/register", headers=auth("admin"), json={"email": email, "password": "secret123", "role": role})
    assert r.status_code == 201, r.text
    user_id = r.json()["user_id"]
    lr = client.post("/api/auth/login", json={"username": email, "password": "secret123"})
    assert lr.status_code == 200, lr.text
    return user_id, {"Authorization": f"Bearer {lr.json()['access_token']}"}


def _new_project(client, auth, name: str) -> str:
    r = client.post("/api/projects", headers=auth("admin"), json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()["project_id"]


def test_non_member_gets_404_on_project_route(client, auth):
    """멤버가 아니면 404(project_not_found) — 프로젝트가 실제로 존재해도, 아예 없어도 같은 code(규칙 2:
    403 은 존재를 흘린다)."""
    project_id = _new_project(client, auth, "membership-404-real")
    _, headers = _register(client, auth, "cm")
    r = client.get(f"/api/projects/{project_id}/objects", headers=headers)
    assert r.status_code == 404 and r.json()["code"] == "project_not_found"
    r2 = client.get(f"/api/projects/{project_id}", headers=headers)
    assert r2.status_code == 404 and r2.json()["code"] == "project_not_found"
    r3 = client.get("/api/projects/does-not-exist-at-all/objects", headers=headers)
    assert r3.status_code == 404 and r3.json()["code"] == "project_not_found"


def test_member_with_wrong_project_role_gets_403(client, auth):
    """멤버인데 요구 역할 집합에 없으면 403(forbidden_role) — client 멤버는 업로드 불가."""
    project_id = _new_project(client, auth, "membership-403-real")
    user_id, headers = _register(client, auth, "client")
    add_member(client, auth("admin"), project_id, user_id, "client")
    # 읽기는 통과(멤버이므로)
    assert client.get(f"/api/projects/{project_id}/objects", headers=headers).status_code == 200
    # 업로드(contractor/cm 만)는 403 — 404 가 아니다(존재를 흘리는 게 아니라 이미 멤버임이 확인됐으므로)
    r = client.post(f"/api/projects/{project_id}/files", headers=headers, files={"file": ("x.ifc", b"ISO-10303-21;")})
    assert r.status_code == 403 and r.json()["code"] == "forbidden_role"


def test_different_roles_in_different_projects(client, auth):
    """ADR 0006 핵심 주장: 프로젝트 역할은 프로젝트마다 다르다. 두 사용자를 각자 다른 프로젝트에 다른
    역할로만 넣고, 각자 자기 프로젝트에서는 그 역할대로 행동하되 남의 프로젝트에서는(비멤버) 막힌다."""
    p1 = _new_project(client, auth, "membership-cross-1")
    p2 = _new_project(client, auth, "membership-cross-2")
    cm_id, cm_headers = _register(client, auth, "cm")
    contractor_id, contractor_headers = _register(client, auth, "contractor")
    add_member(client, auth("admin"), p1, cm_id, "cm")
    add_member(client, auth("admin"), p2, contractor_id, "contractor")

    # 자기 프로젝트에서는 역할대로 행동한다: cm 은 p1 에 업로드 가능(contractor/cm 모두 업로드 가능),
    # contractor 는 p2 에 업로드 가능.
    up1, job1 = upload(client, cm_headers, p1, FIXTURES / "sample.ifc")
    assert job1["status"] == "done", job1
    up2, job2 = upload(client, contractor_headers, p2, FIXTURES / "sample.ifc")
    assert job2["status"] == "done", job2

    # 남의 프로젝트에서는 비멤버라 404 — 403 이 아니다(존재를 흘리지 않는다).
    r = client.post(f"/api/projects/{p2}/files", headers=cm_headers, files={"file": ("x.ifc", b"ISO-10303-21;")})
    assert r.status_code == 404 and r.json()["code"] == "project_not_found"
    r = client.post(f"/api/projects/{p1}/daily-reports", headers=contractor_headers, json={"report_date": "2026-09-01", "items": []})
    assert r.status_code == 404 and r.json()["code"] == "project_not_found"

    # p2 에서는 contractor 가 업로드할 수 있다(자기 프로젝트, 자기 역할).
    up2, job2 = upload(client, contractor_headers, p2, FIXTURES / "sample.dxf", level="1F")
    assert job2["status"] == "done", job2

    # p1 에서 contractor 역할이 아예 없으므로(cm 만 멤버) contractor 계정으로 p1 업로드도 404(비멤버).
    r = client.post(f"/api/projects/{p1}/files", headers=contractor_headers, files={"file": ("x.ifc", b"ISO-10303-21;")})
    assert r.status_code == 404 and r.json()["code"] == "project_not_found"


def test_admin_can_read_but_cannot_confirm(client, auth, project, ifc_job):
    """admin 은 멤버십 없이 조회는 되지만(역할=None) 행위는 전부 403(ADR 0006 §2, ADR 0001 §4-1)."""
    r = client.get(f"/api/projects/{project}", headers=auth("admin"))
    assert r.status_code == 200 and r.json()["my_role"] is None
    r = client.get(f"/api/projects/{project}/objects", headers=auth("admin"), params={"page_size": 1})
    assert r.status_code == 200

    gid = client.get(f"/api/projects/{project}/objects", headers=auth("client"),
                     params={"state": "PLANNED", "page_size": 1}).json()["items"][0]["global_id"]
    # 이 테스트 세션에서 sample.ifc 가 여러 프로젝트에 올라가 있어 global_id 가 겹칠 수 있으므로(ADR 0005)
    # ?project_id= 로 명시한다 — 여기서 확인할 것은 모호성(409)이 아니라 admin 의 행위 권한(403)이다.
    r = client.post(f"/api/objects/{gid}/transitions", headers=auth("admin"), params={"project_id": project},
                    json={"to_state": "CONFIRMED"})
    assert r.status_code == 403 and r.json()["code"] == "forbidden_role"
    r = client.post(f"/api/projects/{project}/files", headers=auth("admin"), files={"file": ("x.ifc", b"ISO-10303-21;")})
    assert r.status_code == 403 and r.json()["code"] == "forbidden_role"


def test_projects_list_is_filtered_by_membership(client, auth, project):
    """GET /projects 는 멤버인 프로젝트만(admin 은 전부)."""
    r = client.get("/api/projects", headers=auth("client"))
    assert r.status_code == 200
    ids = {p["project_id"] for p in r.json()}
    assert project in ids
    mine = next(p for p in r.json() if p["project_id"] == project)
    assert mine["my_role"] == "client"

    _, fresh_headers = _register(client, auth, "cm")   # 아무 프로젝트에도 멤버가 아니다
    r2 = client.get("/api/projects", headers=fresh_headers)
    assert r2.status_code == 200 and project not in {p["project_id"] for p in r2.json()}

    r3 = client.get("/api/projects", headers=auth("admin"))
    assert r3.status_code == 200 and project in {p["project_id"] for p in r3.json()}
    admin_row = next(p for p in r3.json() if p["project_id"] == project)
    assert admin_row["my_role"] is None


def test_resolve_object_scoped_to_membership(client, auth, user_ids):
    """usecases.resolve_object 의 후보 조회는 호출자가 멤버인 프로젝트로 한정된다(ADR 0006 규칙 5) — 같은
    global_id 를 가진 두 프로젝트가 있어도, 한쪽에만 멤버인 호출자에게는 그 한쪽만 보인다(모호함도 없다)."""
    p1 = _new_project(client, auth, "membership-resolve-1")
    p2 = _new_project(client, auth, "membership-resolve-2")
    outsider_id, outsider_headers = _register(client, auth, "client")
    add_member(client, auth("admin"), p1, outsider_id, "client")   # p1 에만 멤버 — p2 는 비멤버
    # 업로드하려면 각 프로젝트에 contractor/cm 멤버가 있어야 한다(세션 시드 cm/contractor 는 이 두 새 프로젝트의
    # 멤버가 아니므로 따로 넣는다).
    add_member(client, auth("admin"), p1, user_ids["cm"], "cm")
    add_member(client, auth("admin"), p2, user_ids["contractor"], "contractor")

    up1, job1 = upload(client, auth("cm"), p1, FIXTURES / "sample.ifc")
    assert job1["status"] == "done", job1
    up2, job2 = upload(client, auth("contractor"), p2, FIXTURES / "sample.ifc")
    assert job2["status"] == "done", job2

    gid = client.get(f"/api/projects/{p1}/objects", headers=auth("cm"), params={"page_size": 1}).json()["items"][0]["global_id"]

    # p1 멤버인 outsider 는 project_id 없이도 정상 해소(후보가 자기 멤버 프로젝트로 좁혀지므로 모호하지 않다).
    d = client.get(f"/api/objects/{gid}", headers=outsider_headers)
    assert d.status_code == 200 and d.json()["basic"]["project_id"] == p1

    # p2 에는 비멤버이므로 project_id= 로 명시 지정해도 404(멤버십을 통과하지 못한다, ADR 0006 규칙 5) —
    # 대상 존재 여부보다 멤버십 검사가 먼저이므로 code 는 project_not_found.
    d2 = client.get(f"/api/objects/{gid}", headers=outsider_headers, params={"project_id": p2})
    assert d2.status_code == 404 and d2.json()["code"] == "project_not_found"
