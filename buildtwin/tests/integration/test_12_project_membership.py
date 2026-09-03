"""ADR 0006: 프로젝트 멤버십과 인가. 이 파일은 자기 소유의 프로젝트·사용자만 만들어 쓴다 — 세션 스코프
`project` 픽스처(다른 테스트 파일이 42개 객체·특정 상태를 전제)를 건드리지 않는다."""
from __future__ import annotations

import uuid

import pytest

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


# ---------------------------------------------------------------------------------------------------------------
# 리뷰어 6차 관찰 3: 대리키(surrogate id) 라우트 매트릭스 — "행을 먼저 읽고 그 project_id 로 멤버십을 검사한다"는
# 방어가 라우트마다 실제로 강제되는지. 존재하지 않는 id 로 404 가 나오는 건 아무것도 증명하지 못하므로(그건 그냥
# not-found), 프로젝트 A 에 실재하는 행을 만들고 B 의 멤버(=A 의 비멤버)로 그 id 들에 접근해 404
# project_not_found 를 확인한다.
# ---------------------------------------------------------------------------------------------------------------

@pytest.fixture(scope="module")
def surrogate_matrix(client, auth, user_ids):
    """A 에 실재 데이터(파일·잡·도면·모델·스캔·검토요청·액티비티)를 만들고, B 의 멤버(A 의 비멤버)인 outsider
    헤더를 함께 돌려준다. 세션 스코프 `project` 픽스처는 건드리지 않는다(파일 상단 docstring)."""
    project_a = _new_project(client, auth, "membership-surrogate-a")
    add_member(client, auth("admin"), project_a, user_ids["contractor"], "contractor")
    add_member(client, auth("admin"), project_a, user_ids["cm"], "cm")

    up_ifc, ifc_job = upload(client, auth("contractor"), project_a, FIXTURES / "sample.ifc")
    assert ifc_job["status"] == "done", ifc_job

    up_dxf, dxf_job = upload(client, auth("cm"), project_a, FIXTURES / "sample.dxf", level="1F")
    assert dxf_job["status"] == "done", dxf_job
    drawing_id = dxf_job["result"]["drawing_id"]
    mappings = client.get(f"/api/drawings/{drawing_id}/mappings", headers=auth("cm")).json()
    assert mappings
    handle = mappings[0]["entity_handle"]

    up_ply, ply_job = upload(client, auth("cm"), project_a, FIXTURES / "sample.ply")
    assert ply_job["status"] == "done", ply_job
    scan_id = ply_job["result"]["scan_id"]

    up_csv, csv_job = upload(client, auth("cm"), project_a, FIXTURES / "schedule.csv")
    assert csv_job["status"] == "done", csv_job

    model_id = client.get(f"/api/projects/{project_a}/models", headers=auth("cm")).json()[0]["model_id"]

    # contractor 는 세션 스코프 `project` 픽스처에도 멤버라 같은 sample.ifc 의 global_id 가 두 프로젝트에
    # 걸쳐 있을 수 있다(ADR 0005) — 여기서는 검토요청을 만드는 게 목적이므로 project_id= 로 disambiguate.
    objs = client.get(f"/api/projects/{project_a}/objects", headers=auth("cm"),
                      params={"state": "PLANNED", "page_size": 1}).json()["items"]
    assert objs
    global_id = objs[0]["global_id"]
    assert client.post(f"/api/objects/{global_id}/transitions", headers=auth("contractor"),
                       params={"project_id": project_a}, json={"to_state": "REPORTED"}).status_code == 201
    assert client.post(f"/api/objects/{global_id}/transitions", headers=auth("contractor"),
                       params={"project_id": project_a}, json={"to_state": "INSPECTION_REQUESTED"}).status_code == 201
    reviews = client.get(f"/api/projects/{project_a}/review-requests", headers=auth("cm"),
                         params={"kind": "inspection", "status": "open", "global_id": global_id}).json()
    assert reviews, "inspection review request expected"
    review_request_id = reviews[0]["review_request_id"]

    project_b = _new_project(client, auth, "membership-surrogate-b")
    outsider_id, outsider_headers = _register(client, auth, "client")
    add_member(client, auth("admin"), project_b, outsider_id, "client")

    return {
        "ids": {
            "file_id": up_ifc["file_id"],
            "job_id": up_ifc["job_id"],
            "drawing_id": drawing_id,
            "handle": handle,
            "model_id": model_id,
            "scan_id": scan_id,
            "review_request_id": review_request_id,
            "activity_id": "A100",   # tests/fixtures/schedule.csv 가 만드는 고정 activity_id (test_05 참고)
            # ADR 0008 §5: readiness 는 `project_id` 를 쿼리 **필수**로 받는다(409 방식이 아니다).
            # 이 매트릭스는 "비멤버가 A 의 실재 행에 접근하면 404 project_not_found" 를 보는 것이므로
            # 프로젝트 A 를 명시해 넘긴다 — 빠뜨리면 422 가 나와 이 방어를 검증하지 못한다.
            "project_a": project_a,
        },
        "global_id": global_id,
        "project_a": project_a,
        "outsider_headers": outsider_headers,
    }


# (method, path 템플릿, POST 바디) — 라우트가 추가되면 이 목록에 한 줄만 늘리면 된다. path 템플릿의 자리표시자는
# `surrogate_matrix()["ids"]` 의 키와 맞아야 한다. GET 라우트는 바디가 없으므로 None.
#
# 뺀 라우트: 스캔 정합 결과(`/scans/{id}/verdicts`, `/registration`)는 넣었지만, 실제 point cloud 로 rmse 를
# 만드는 `POST /scans/{id}/alignment` 의 "성공" 경로까지는 준비하지 않았다 — 이 매트릭스가 필요로 하는 건
# alignment 요청 자체가 인가를 통과하는지(그래서 프로젝트 A 데이터에 손을 댈 수 있는지)뿐이고, AlignmentInput
# 의 모든 필드가 기본값을 가져 빈 바디({})로도 스키마 검증은 통과한다 — project_role() 이 그보다 먼저 실행되므로
# 충분하다. 정합 자체의 성공 여부는 tests/integration/test_07_scans.py 가 이미 검증한다.
_SURROGATE_ROUTES: list[tuple[str, str, dict | None]] = [
    ("GET", "/api/files/{file_id}", None),
    ("GET", "/api/files/{file_id}/content", None),
    ("GET", "/api/jobs/{job_id}", None),
    ("GET", "/api/drawings/{drawing_id}", None),
    ("GET", "/api/drawings/{drawing_id}/entities", None),
    ("GET", "/api/drawings/{drawing_id}/mappings", None),
    ("POST", "/api/drawings/{drawing_id}/alignment", {"origin": [0.0, 0.0], "rotation_deg": 0.0, "scale": 1.0}),
    ("POST", "/api/drawings/{drawing_id}/mappings/{handle}/confirm", {"global_id": "does-not-matter"}),
    ("GET", "/api/models/{model_id}", None),
    ("GET", "/api/models/{model_id}/plan-section", None),
    ("GET", "/api/models/{model_id}/mesh", None),
    ("GET", "/api/models/{model_id}/mesh.obj", None),
    ("GET", "/api/scans/{scan_id}", None),
    ("GET", "/api/scans/{scan_id}/verdicts", None),
    ("GET", "/api/scans/{scan_id}/registration", None),
    ("POST", "/api/scans/{scan_id}/alignment", {}),
    ("GET", "/api/review-requests/{review_request_id}", None),
    ("POST", "/api/review-requests/{review_request_id}/resolve", {"decision": "approved"}),
    ("GET", "/api/activities/{activity_id}/readiness?project_id={project_a}", None),
]


@pytest.mark.parametrize("method,path_template,body", _SURROGATE_ROUTES, ids=[f"{m} {p}" for m, p, _ in _SURROGATE_ROUTES])
def test_surrogate_route_matrix_blocks_non_member(client, surrogate_matrix, method, path_template, body):
    """리뷰어 6차 관찰 3: 대리키 라우트는 대상 행을 먼저 읽고 그 project_id 로 멤버십을 검사해야 한다(ADR 0006
    규칙 6). 이 목록의 id 는 전부 프로젝트 A 에 실재하는 행이다 — 존재하지 않는 id 로 404 가 나오는 건 이 방어와
    무관하므로 증명력이 없다. 프로젝트 A 의 비멤버(B 의 멤버)가 접근하면 반드시 404 + code=project_not_found."""
    path = path_template.format(**surrogate_matrix["ids"])
    headers = surrogate_matrix["outsider_headers"]
    r = client.get(path, headers=headers) if method == "GET" else client.post(path, headers=headers, json=body)
    assert r.status_code == 404, (method, path, r.status_code, r.text)
    assert r.json()["code"] == "project_not_found", (method, path, r.text)


def test_surrogate_object_routes_do_not_leak(client, surrogate_matrix):
    """`GET /objects/{global_id}` 와 `POST /objects/{global_id}/transitions` 는 경로에 project_id 가 없다 —
    `resolve_object` 가 후보를 호출자의 멤버 프로젝트로 한정하므로(ADR 0006 규칙 5), project_id 를 안 주면
    B 의 멤버에게 A 의 global_id 는 애초에 후보에 없다(code=object_not_found). project_id=A 를 명시하면
    멤버십 검사를 먼저 통과해야 하므로 code=project_not_found 로 바뀐다. 응답 code 는 두 경우가 다르지만,
    이 테스트가 단언하려는 핵심은 어느 경우에도 A 의 데이터가 새지 않는다(200 이 나오지 않는다)는 것이다."""
    gid = surrogate_matrix["global_id"]
    project_a = surrogate_matrix["project_a"]
    headers = surrogate_matrix["outsider_headers"]

    r = client.get(f"/api/objects/{gid}", headers=headers)
    assert r.status_code == 404 and r.json()["code"] == "object_not_found", r.text

    r = client.get(f"/api/objects/{gid}", headers=headers, params={"project_id": project_a})
    assert r.status_code == 404 and r.json()["code"] == "project_not_found", r.text

    r = client.post(f"/api/objects/{gid}/transitions", headers=headers, json={"to_state": "CONFIRMED"})
    assert r.status_code == 404 and r.json()["code"] == "object_not_found", r.text

    r = client.post(f"/api/objects/{gid}/transitions", headers=headers, params={"project_id": project_a},
                    json={"to_state": "CONFIRMED"})
    assert r.status_code == 404 and r.json()["code"] == "project_not_found", r.text


def test_admin_cannot_be_added_as_project_member(client, auth, user_ids):
    """리뷰어 6차 관찰 2 / ADR 0006 §2·§4: 전역 admin 계정은 어떤 프로젝트의 멤버도 될 수 없다 — 멤버십을
    주면 `project_role()` 이 멤버 분기(admin 분기보다 먼저)를 타 그 역할을 그대로 돌려주고, actor_for_role()
    이 이를 거부하지 못해 CONFIRMED 전이·검측 승인·검토요청 해소가 admin 계정으로 통과해버린다.
    (api 에이전트가 병렬로 구현 중인 항목 — 구현 전이면 이 테스트는 실패하고, 구현이 들어오면 통과한다.)"""
    project_id = _new_project(client, auth, "membership-admin-guard")
    r = client.post(f"/api/projects/{project_id}/members", headers=auth("admin"),
                    json={"user_id": user_ids["admin"], "role": "cm"})
    assert r.status_code == 422, r.text
    assert r.json()["code"] == "admin_cannot_be_member", r.text
