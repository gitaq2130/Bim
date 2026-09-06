"""인증·역할 403 매트릭스."""
from __future__ import annotations

import pytest

from packages.core.db import new_session
from packages.core.models.orm import ProjectRow


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_login_bad_password(client):
    r = client.post("/api/auth/login", json={"username": "cm@buildtwin.local", "password": "wrong"})
    assert r.status_code == 401


def test_login_accepts_email_field(client):
    r = client.post("/api/auth/login", json={"email": "CM@buildtwin.local", "password": "buildtwin"})
    assert r.status_code == 200 and r.json()["role"] == "cm"


def test_me_and_missing_token(client, auth):
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-token"}).status_code == 401
    r = client.get("/api/auth/me", headers=auth("client"))
    assert r.status_code == 200 and r.json()["role"] == "client"


def test_register_requires_admin_after_bootstrap(client, auth):
    body = {"email": "newcm@buildtwin.local", "password": "secret123", "role": "cm"}
    assert client.post("/api/auth/register", json=body).status_code == 403
    assert client.post("/api/auth/register", json=body, headers=auth("contractor")).status_code == 403
    r = client.post("/api/auth/register", json=body, headers=auth("admin"))
    assert r.status_code == 201 and r.json()["role"] == "cm"
    assert client.post("/api/auth/register", json=body, headers=auth("admin")).status_code == 409
    r = client.post("/api/auth/login", json={"username": "newcm@buildtwin.local", "password": "secret123"})
    assert r.status_code == 200


@pytest.mark.parametrize("role,expected", [("contractor", 403), ("cm", 403), ("client", 403), ("admin", 201)])
def test_create_project_role_matrix(client, auth, role, expected):
    r = client.post("/api/projects", headers=auth(role), json={"name": f"matrix-{role}"})
    assert r.status_code == expected, r.text


def test_create_project_duplicate_id_returns_409_with_code(client, auth):
    """같은 project_id 로 두 번 생성하면 409 — code 는 "duplicate_project"(다른 409 원인과 구분,
    reviewer round-4 obs. 1: 클라이언트가 409 를 원인별로 구분할 수 있어야 한다).

    `client` 픽스처는 세션 스코프(테스트 파일 전체가 같은 DB 를 공유)라 이 테스트가 만든
    project_id 를 남겨두면 뒤에 도는, 프로젝트 목록 전체를 단정하는 테스트가 깨질 수 있다
    (reviewer round-5 obs. 3). API 에 프로젝트 삭제 엔드포인트가 없으므로 테스트가 직접
    DB 에서 정리한다 — 이 테스트는 dup 여부만 확인하므로 파일/모델 등 자식 행은 생기지 않는다.
    """
    r1 = client.post("/api/projects", headers=auth("admin"), json={"name": "dup-project", "project_id": "p-dup-test"})
    assert r1.status_code == 201, r1.text
    try:
        r2 = client.post("/api/projects", headers=auth("admin"), json={"name": "dup-project-again", "project_id": "p-dup-test"})
        assert r2.status_code == 409, r2.text
        body = r2.json()
        assert body["code"] == "duplicate_project"
        assert "p-dup-test" in body["detail"]
    finally:
        s = new_session()
        try:
            row = s.get(ProjectRow, "p-dup-test")
            if row is not None:
                s.delete(row)
                s.commit()
        finally:
            s.close()


def test_projects_list_and_get(client, auth, project):
    r = client.get("/api/projects", headers=auth("client"))
    assert r.status_code == 200 and any(p["project_id"] == project for p in r.json())
    r = client.get(f"/api/projects/{project}", headers=auth("client"))
    assert r.status_code == 200 and r.json()["project_id"] == project
    assert client.get("/api/projects/nope", headers=auth("client")).status_code == 404


def test_role_matrix_on_protected_endpoints(client, auth, project):
    # client 는 업로드·작업일보·검토요청 불가(그 프로젝트의 client 멤버 — ADR 0006)
    r = client.post(f"/api/projects/{project}/files", headers=auth("client"), files={"file": ("x.ifc", b"ISO-10303-21;")})
    assert r.status_code == 403
    r = client.post(f"/api/projects/{project}/daily-reports", headers=auth("cm"), json={"report_date": "2026-09-01", "items": []})
    assert r.status_code == 403
    assert client.get(f"/api/projects/{project}/review-requests", headers=auth("contractor")).status_code == 403
    assert client.get(f"/api/projects/{project}/review-requests", headers=auth("cm")).status_code == 200
    # ADR 0006 규칙 6: surrogate id 라우트는 대상 행을 먼저 읽는다 — id 가 실제로 없으면(여기서는 "x")
    # 호출자의 역할과 무관하게 그 자원의 404 를 먼저 본다(존재하지 않는 프로젝트의 역할을 판단할 수 없다).
    r = client.post("/api/review-requests/x/resolve", headers=auth("contractor"), json={"decision": "approved"})
    assert r.status_code == 404 and r.json()["code"] == "review_request_not_found"
    r = client.post("/api/scans/x/alignment", headers=auth("contractor"), json={"control_points": []})
    assert r.status_code == 404 and r.json()["code"] == "scan_not_found"
    # ADR 0001 §4-1 + ADR 0006: admin 은 확정·검측 승인·검토요청 처리·매핑 확정·작업일보 불가.
    # 아래 id 들도 실제로 없으므로 위와 같은 이유로 404 가 먼저 나온다(대상이 있는 경우의 admin 403 은
    # test_03_objects.py::test_contractor_cannot_confirm 이 실제 객체로 확인한다).
    r = client.post("/api/review-requests/x/resolve", headers=auth("admin"), json={"decision": "approved"})
    assert r.status_code == 404 and r.json()["code"] == "review_request_not_found"
    r = client.post("/api/objects/x/transitions", headers=auth("admin"), json={"to_state": "CONFIRMED"})
    assert r.status_code == 404 and r.json()["code"] == "object_not_found"
    r = client.post("/api/drawings/x/mappings/1/confirm", headers=auth("admin"), json={"global_id": "y"})
    assert r.status_code == 404 and r.json()["code"] == "drawing_not_found"
    assert client.post(f"/api/projects/{project}/daily-reports", headers=auth("admin"), json={"report_date": "2026-09-01", "items": []}).status_code == 403
