"""인증·역할 403 매트릭스."""
from __future__ import annotations

import pytest


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


def test_projects_list_and_get(client, auth, project):
    r = client.get("/api/projects", headers=auth("client"))
    assert r.status_code == 200 and any(p["project_id"] == project for p in r.json())
    r = client.get(f"/api/projects/{project}", headers=auth("client"))
    assert r.status_code == 200 and r.json()["project_id"] == project
    assert client.get("/api/projects/nope", headers=auth("client")).status_code == 404


def test_role_matrix_on_protected_endpoints(client, auth, project):
    # client 는 업로드·작업일보·검토요청 불가
    r = client.post(f"/api/projects/{project}/files", headers=auth("client"), files={"file": ("x.ifc", b"ISO-10303-21;")})
    assert r.status_code == 403
    r = client.post(f"/api/projects/{project}/daily-reports", headers=auth("cm"), json={"report_date": "2026-09-01", "items": []})
    assert r.status_code == 403
    assert client.get(f"/api/projects/{project}/review-requests", headers=auth("contractor")).status_code == 403
    assert client.get(f"/api/projects/{project}/review-requests", headers=auth("cm")).status_code == 200
    assert client.post("/api/review-requests/x/resolve", headers=auth("contractor"), json={"decision": "approved"}).status_code == 403
    assert client.post("/api/scans/x/alignment", headers=auth("contractor"), json={"control_points": []}).status_code == 403
