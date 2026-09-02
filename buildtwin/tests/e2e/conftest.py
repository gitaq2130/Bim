"""E2E 공용 픽스처 — 담당: qa.

두 가지 실행 경로를 제공한다.
- `api`      : FastAPI TestClient + Celery eager + 임시 sqlite/스토리지. tests/e2e/test_core_flow.py(8단계 핵심 흐름)가 쓴다.
- `api_server` / `web_server` : 실제 uvicorn + `vite preview`(빌드된 apps/web/dist, /api 프록시) — Playwright 스모크가 쓴다.

settings 는 세션 픽스처 안에서 바꾸고 끝나면 되돌린다(임포트 시점 부작용 없음). 통합 테스트와 같은 프로세스에서
DB 를 공유하지 않도록 `make e2e` / CI e2e 잡은 tests/e2e 만 따로 실행한다.
"""
from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests" / "fixtures"
WEB = ROOT / "apps" / "web"
METRICS = json.loads((ROOT / "tests" / "metrics.json").read_text(encoding="utf-8"))
DEV_PASSWORD = "buildtwin"                      # services/api/auth/seed.py 의 개발 시드(문서화된 값)
ROLES = ("contractor", "cm", "client", "admin")
JOB_TIMEOUT_S = 120

# 로컬 개발 환경에 내장된 Chromium(/opt/pw-browsers). CI 는 `playwright install` 기본 경로를 쓴다.
_PW = Path("/opt/pw-browsers")
if _PW.is_dir():
    os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(_PW))


def user(role: str) -> str:
    return f"{role}@buildtwin.local"


def load_fixture_json(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


# ----------------------------------------------------------------------------- in-process API (TestClient)
@pytest.fixture(scope="session")
def api() -> Iterator:
    tmp = Path(tempfile.mkdtemp(prefix="buildtwin-e2e-"))
    from packages.core.db import init_db, reset_engine
    from packages.core.settings import settings
    from services.common.celery_app import celery_app

    prev = (settings.database_url, settings.storage_root, settings.celery_always_eager)
    settings.database_url = f"sqlite:///{(tmp / 'e2e.db').as_posix()}"
    settings.storage_root = str(tmp / "storage")
    settings.celery_always_eager = True
    celery_app.conf.task_always_eager = True
    celery_app.conf.task_eager_propagates = True
    reset_engine()
    init_db(settings.database_url)
    from fastapi.testclient import TestClient

    from services.api.main import create_app

    with TestClient(create_app()) as client:
        yield client
    reset_engine()
    settings.database_url, settings.storage_root, settings.celery_always_eager = prev
    shutil.rmtree(tmp, ignore_errors=True)


class Api:
    """TestClient 와 httpx.Client 를 같은 방식으로 다루는 얇은 래퍼(로그인·업로드·잡 폴링)."""

    def __init__(self, client, prefix: str = "") -> None:
        self.c = client
        self.prefix = prefix
        self.tokens: dict[str, str] = {}

    def url(self, path: str) -> str:
        return f"{self.prefix}/api{path}"

    def login(self, role: str) -> str:
        r = self.c.post(self.url("/auth/login"), json={"username": user(role), "password": DEV_PASSWORD})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["role"] == role and body["access_token"]
        self.tokens[role] = body["access_token"]
        return body["access_token"]

    def h(self, role: str) -> dict[str, str]:
        if role not in self.tokens:
            self.login(role)
        return {"Authorization": f"Bearer {self.tokens[role]}"}

    def get(self, path: str, role: str, **params):
        return self.c.get(self.url(path), headers=self.h(role), params=params or None)

    def post(self, path: str, role: str, **kw):
        return self.c.post(self.url(path), headers=self.h(role), **kw)

    def wait_job(self, job_id: str, role: str = "cm") -> dict:
        deadline = time.time() + JOB_TIMEOUT_S
        while time.time() < deadline:
            r = self.get(f"/jobs/{job_id}", role)
            assert r.status_code == 200, r.text
            job = r.json()
            if job["status"] in ("done", "failed"):
                return job
            time.sleep(0.2)
        raise AssertionError(f"job {job_id} did not finish within {JOB_TIMEOUT_S}s")

    def upload(self, project_id: str, path: Path, role: str = "cm", **form) -> tuple[dict, dict]:
        with open(path, "rb") as fh:
            r = self.post(f"/projects/{project_id}/files", role, files={"file": (path.name, fh)}, data=form or None)
        assert r.status_code == 202, r.text
        up = r.json()
        return up, self.wait_job(up["job_id"], role)


# ----------------------------------------------------------------------------- real servers (Playwright)
def _wait_http(url: str, timeout: float, proc: subprocess.Popen | None = None) -> None:
    deadline = time.time() + timeout
    last: Exception | None = None
    while time.time() < deadline:
        if proc is not None and proc.poll() is not None:
            raise RuntimeError(f"server exited early (rc={proc.returncode}): {url}")
        try:
            if httpx.get(url, timeout=2.0).status_code < 500:
                return
        except Exception as exc:   # noqa: BLE001
            last = exc
        time.sleep(0.25)
    raise RuntimeError(f"server not ready: {url} ({last})")


@pytest.fixture(scope="session")
def api_server() -> Iterator[dict]:
    """uvicorn services.api.main:app (임시 sqlite, Celery eager). {'base': 'http://127.0.0.1:P', 'port': P}."""
    tmp = Path(tempfile.mkdtemp(prefix="buildtwin-e2e-srv-"))
    port = _free_port()
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{(tmp / 'srv.db').as_posix()}", "STORAGE_ROOT": str(tmp / "storage"),
           "CELERY_ALWAYS_EAGER": "1", "PYTHONPATH": str(ROOT)}
    log = (tmp / "uvicorn.log").open("w")
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "services.api.main:app", "--host", "127.0.0.1", "--port", str(port)],
                            cwd=str(ROOT), env=env, stdout=log, stderr=subprocess.STDOUT)
    base = f"http://127.0.0.1:{port}"
    try:
        _wait_http(f"{base}/api/health", 60, proc)
        yield {"base": base, "port": port, "tmp": tmp}
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        log.close()
        shutil.rmtree(tmp, ignore_errors=True)


@pytest.fixture(scope="session")
def seeded_project(api_server) -> dict:
    """admin 이 프로젝트를 만들고 sample.ifc + sample.dxf(1F) 를 올린다(뷰어가 2D·3D 를 모두 그릴 수 있게)."""
    with httpx.Client(timeout=120.0) as c:
        a = Api(c, prefix=api_server["base"])
        r = a.post("/projects", "admin", json={"name": "E2E 스모크 현장"})
        assert r.status_code == 201, r.text
        pid = r.json()["project_id"]
        _, ifc_job = a.upload(pid, FIXTURES / "sample.ifc")
        assert ifc_job["status"] == "done", ifc_job
        _, dxf_job = a.upload(pid, FIXTURES / "sample.dxf", level="1F")
        assert dxf_job["status"] == "done", dxf_job
        return {"project_id": pid, "ifc_job": ifc_job, "dxf_job": dxf_job}


@pytest.fixture(scope="session")
def web_server(api_server) -> Iterator[str]:
    """apps/web 를 빌드(dist 없으면)하고 vite preview 로 서빙. /api 는 api_server 로 프록시. base URL 을 준다."""
    if not (WEB / "dist" / "index.html").exists():
        subprocess.run(["npx", "vite", "build"], cwd=str(WEB), check=True)
    port = _free_port()
    env = {**os.environ, "E2E_API_PORT": str(api_server["port"])}
    proc = subprocess.Popen(["npx", "vite", "preview", "--config", "../../tests/e2e/vite.preview.config.mts",
                             "--port", str(port), "--strictPort", "--host", "127.0.0.1"],
                            cwd=str(WEB), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    base = f"http://127.0.0.1:{port}"
    try:
        _wait_http(f"{base}/", 60, proc)
        _wait_http(f"{base}/api/health", 30, proc)   # 프록시 확인
        yield base
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
