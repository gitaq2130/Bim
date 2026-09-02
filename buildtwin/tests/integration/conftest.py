"""API 통합 테스트 공용 픽스처. 세션 시작 시(픽스처 시점에) 전용 임시 SQLite/저장소를 만들고 엔진을 재설정한다.

다른 테스트 트리(tests/e2e 등)도 같은 프로세스에서 DATABASE_URL 을 바꾸므로, import 시점이 아니라 `client` 픽스처 안에서
경로를 정해야 서로의 DB 를 공유하지 않는다(bim_objects PK 는 전역이라 같은 IFC 를 두 프로젝트에 올리면 충돌).
세션 범위 픽스처가 한 프로젝트를 만들고 IFC → DXF → 공정표를 순서대로 올린다(파일명 숫자 접두사로 실행 순서 고정).
"""
from __future__ import annotations

import json
import os
import shutil
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from packages.core.db import init_db, reset_engine
from packages.core.settings import settings
from services.common.celery_app import celery_app

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
ROLES = ("contractor", "cm", "client", "admin")
DEV_PASSWORD = "buildtwin"


def load_fixture_json(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def client():
    tmp = Path(tempfile.mkdtemp(prefix="buildtwin-api-"))
    previous = {k: os.environ.get(k) for k in ("DATABASE_URL", "STORAGE_ROOT", "CELERY_ALWAYS_EAGER")}
    os.environ["DATABASE_URL"] = f"sqlite:///{(tmp / 'api-test.db').as_posix()}"
    os.environ["STORAGE_ROOT"] = str(tmp / "storage")
    os.environ["CELERY_ALWAYS_EAGER"] = "1"
    settings.database_url, settings.storage_root, settings.celery_always_eager = os.environ["DATABASE_URL"], os.environ["STORAGE_ROOT"], True
    celery_app.conf.task_always_eager = True
    celery_app.conf.task_eager_propagates = True
    reset_engine()
    init_db(settings.database_url)
    from services.api.main import create_app

    app = create_app()
    with TestClient(app) as c:
        yield c
    reset_engine()
    for k, v in previous.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    shutil.rmtree(tmp, ignore_errors=True)


@pytest.fixture(scope="session")
def tokens(client) -> dict[str, str]:
    out: dict[str, str] = {}
    for role in ROLES:
        r = client.post("/api/auth/login", json={"username": f"{role}@buildtwin.local", "password": DEV_PASSWORD})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["role"] == role and body["access_token"] and body["user_id"]
        out[role] = body["access_token"]
    return out


@pytest.fixture(scope="session")
def auth(tokens):
    def _h(role: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {tokens[role]}"}
    return _h


def wait_job(client, headers: dict[str, str], job_id: str) -> dict:
    """eager 모드라 업로드 응답 시점에 이미 끝나 있지만, 폴링 계약대로 상태를 읽는다."""
    for _ in range(50):
        r = client.get(f"/api/jobs/{job_id}", headers=headers)
        assert r.status_code == 200, r.text
        job = r.json()
        if job["status"] in ("done", "failed"):
            return job
    raise AssertionError(f"job {job_id} did not finish: {job}")


def upload(client, headers: dict[str, str], project_id: str, path: Path, **form) -> tuple[dict, dict]:
    with open(path, "rb") as fh:
        r = client.post(f"/api/projects/{project_id}/files", headers=headers, files={"file": (path.name, fh)}, data=form)
    assert r.status_code == 202, r.text
    up = r.json()
    assert set(up) >= {"job_id", "file_id", "kind"}
    return up, wait_job(client, headers, up["job_id"])


@pytest.fixture(scope="session")
def project(client, auth) -> str:
    r = client.post("/api/projects", headers=auth("admin"), json={"name": "통합 테스트 현장"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "통합 테스트 현장" and body["project_id"]
    return body["project_id"]


@pytest.fixture(scope="session")
def ifc_job(client, auth, project) -> dict:
    up, job = upload(client, auth("contractor"), project, FIXTURES / "sample.ifc")
    assert up["kind"] == "ifc"
    assert job["status"] == "done", job
    return job


@pytest.fixture(scope="session")
def dxf_job(client, auth, project, ifc_job) -> dict:
    up, job = upload(client, auth("cm"), project, FIXTURES / "sample.dxf", level="1F")
    assert up["kind"] == "dxf"
    assert job["status"] == "done", job
    return job


@pytest.fixture(scope="session")
def schedule_job(client, auth, project, ifc_job) -> dict:
    up, job = upload(client, auth("cm"), project, FIXTURES / "schedule.csv")
    assert up["kind"] == "csv"
    assert job["status"] == "done", job
    return job


@pytest.fixture(scope="session")
def ifc_expected() -> dict:
    return load_fixture_json("sample.ifc.expected.json")


@pytest.fixture(scope="session")
def expected_objects(ifc_expected) -> dict[str, dict]:
    """global_id → {category, name, level}."""
    out: dict[str, dict] = {}
    for category, items in ifc_expected["objects"].items():
        for o in items:
            out[o["global_id"]] = {**o, "category": category}
    return out
