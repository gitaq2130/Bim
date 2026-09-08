"""E2E 공용 픽스처 — 담당: qa.

두 가지 실행 경로를 제공한다.
- `api`      : FastAPI TestClient + Celery eager + 임시 sqlite/스토리지. tests/e2e/test_core_flow.py(8단계 핵심 흐름)가 쓴다.
- `api_server` / `web_server` : 실제 uvicorn + `vite preview`(빌드된 apps/web/dist, /api 프록시; 설정은 apps/web 에 잠시 생성) — Playwright 스모크가 쓴다.

settings 는 세션 픽스처 안에서 바꾸고 끝나면 되돌린다(임포트 시점 부작용 없음). 통합 테스트와 같은 프로세스에서
DB 를 공유하지 않도록 `make e2e` / CI e2e 잡은 tests/e2e 만 따로 실행한다.

**데모 계정은 두 갈래 각각이 명시적으로 만든다**(ADR 0018 §2-1) — 그러나 **모양이 다르다**:
`api` 는 in-process 라 `seed_all(session)` 함수, `api_server` 는 하위 프로세스라
`python -m services.api.seed` **명령**이고 그 **종료 코드를 단언한다**.

**이 두 자리를 지웠을 때 값이 갈리는가는 축이 아니라 기전이 정한다**(CLAUDE.md §6-2 1): 기동이 같은
DB 를 먼저 채우면 지워도 초록이다. 그래서 대조군을 곱으로 세우고, 「기동이 시드하지 않는 트리」를
**흉내가 아니라 실제 조건**으로 만들었다 — 두 픽스처의 DB 를 postgres 로 돌리면 `services/api/main.py`
의 시드 조건이 그 자리에서 `False` 라, 명시 시드를 지우면 아무도 계정을 만들지 않는다. 방법
`pytest tests/e2e -q`, **각 칸 N=1**, 변이는 한 자리씩 + 심기 직전의 작업 트리 사본과 `diff`
(§6-2 규칙 5 — 이 커밋이 처음 넣는 줄을 지우는 변이라 `git diff` 는 침묵한다), 원복은 그 사본으로,
postgres 칸마다 두 데이터베이스를 **버리고 다시 만들었다**(안 그러면 앞 칸의 시드가 다음 칸을 가린다).
잰 트리 = `b09ae65` + 이 커밋:

| # | 픽스처의 DB | `api` 의 함수 | `api_server` 의 명령 | 실행값 |
|---|---|---|---|---|
| 1 | sqlite(커밋된 값) | 부른다 | 부른다 | **12 passed** |
| 2 | sqlite | **지움** | **지움** | **12 passed** ← **가려진다**(기동이 시드한다) |
| 3 | postgres | 부른다 | 부른다 | **12 passed** |
| 4 | postgres | **지움** | **지움** | **9 failed, 1 passed, 2 errors** |
| 5 | postgres | 부른다 | **지움** | **10 passed, 2 errors** — 죽는 것은 `test_web_smoke` 둘뿐 |
| 6 | postgres | **지움** | 부른다 | **9 failed, 3 passed** — 죽는 것은 `test_core_flow` 뿐 |

**5·6행이 이 표의 값이다**(§6-2 3: 음성·양성을 한 축에 몰지 않는다). 두 갈래는 서로를 가려 주지
않는다 — 한쪽을 지우면 그쪽 테스트만 죽는다. 3행은 기동이 시드하지 않는 트리(작업 3 뒤)에서도 이
배선이 혼자 선다는 것을 미리 값으로 보이고, 2행이 이 사이클에서 「시드 호출만 지우는 변이가 안
죽는다」로 관측되는 자리다.
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
E2E_JWT_SECRET = "e2e-only-not-a-real-secret"   # settings.jwt_secret 은 운영 필수(.env JWT_SECRET) — E2E 는 명시적으로 준다
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
    from packages.core.db import init_db, reset_engine, session_scope
    from packages.core.settings import settings
    from services.api.seed import seed_all
    from services.common.celery_app import celery_app

    prev = (settings.database_url, settings.storage_root, settings.celery_always_eager, settings.jwt_secret)
    settings.database_url = f"sqlite:///{(tmp / 'e2e.db').as_posix()}"
    settings.storage_root = str(tmp / "storage")
    settings.celery_always_eager = True
    settings.jwt_secret = E2E_JWT_SECRET
    celery_app.conf.task_always_eager = True
    celery_app.conf.task_eager_propagates = True
    reset_engine()
    init_db(settings.database_url)
    # **명시 시드**(ADR 0018 §2-1). 이 갈래는 in-process 라 픽스처가 이미 엔진을 쥐고 있으므로 함수로
    # 부른다 — 아래 `api_server` 갈래가 **명령**을 쓰는 이유(부모의 settings 가 닿지 않는 하위 프로세스)와
    # 대비된다. 호출이 실제로 만들었음을 그 자리에서 단언한다: 순서를 뒤집어 기동이 먼저 채우면
    # `created` 가 비어 여기서 죽는다.
    with session_scope() as s:
        created, demo_project = seed_all(s)
    assert sorted(u.role for u in created) == sorted(ROLES), created
    assert demo_project is not None, "데모 프로젝트 멤버십이 만들어지지 않았다 (ADR 0018 §2-4 ②)"
    from fastapi.testclient import TestClient

    from services.api.main import create_app

    with TestClient(create_app()) as client:
        yield client
    reset_engine()
    settings.database_url, settings.storage_root, settings.celery_always_eager, settings.jwt_secret = prev
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

    def user_id(self, role: str) -> str:
        r = self.get("/auth/me", role)
        assert r.status_code == 200, r.text
        return r.json()["user_id"]


def add_member(a: Api, project_id: str, user_id: str, role: str) -> None:
    """ADR 0006: 프로젝트 접근권은 project_members 행의 존재로 정의된다(멤버십 관리는 admin 전용).
    tests/integration/conftest.py 의 add_member 와 같은 패턴."""
    r = a.post(f"/projects/{project_id}/members", "admin", json={"user_id": user_id, "role": role})
    assert r.status_code == 201, r.text


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
           "CELERY_ALWAYS_EAGER": "1", "JWT_SECRET": E2E_JWT_SECRET, "PYTHONPATH": str(ROOT)}
    # **명시 시드는 명령이다**(ADR 0018 §2-2): 아래 uvicorn 은 **다른 프로세스**라 이 픽스처가 부모의
    # `settings` 를 만져도 닿지 않는다. 그리고 **종료 코드를 단언한다**(계획 0014 §리스크 3) — 서버의
    # stdout 은 로그 파일로 가고 `_wait_http` 는 `/api/health` 만 보므로, 시드가 실패해도 그 자리에서는
    # 아무 값도 갈리지 않는다. 실패 문구는 여기서만 사람에게 닿으므로 stdout·stderr 를 함께 싣는다.
    #
    # **uvicorn 을 띄우기 「전」에 부른다.** 뒤에 부르면 `_wait_http` 가 돌아온 순간부터 시드가 끝날
    # 때까지 **부트스트랩이 열린 리스너**가 실제 포트에 살아 있다(계획 0014 §확인하지 않은 것 54 가
    # 이름 붙인 창 — `users` 가 비어 있으면 `auth/router.py` 가 인증 없는 register 를 admin 으로
    # 받는다). 순서를 이렇게 두면 그 창은 **길이가 아니라 존재가** 없다: 시드가 rc=0 으로 끝나기
    # 전에는 이 포트에 리스너 자체가 없다.
    #
    # 창을 실제로 쟀다(방법: 이 배선을 그대로 흉내낸 스크래치 탐침, 기동이 시드하지 않는 조건을
    # 만들려고 DB 만 postgres 로, **N=3**). `_wait_http` 반환 → 시드 완료까지 **1.276·1.294·1.307s**,
    # 그 창에서 `POST /api/auth/register`(`Authorization` 없음)는 **201** 이고 응답 `role` 이
    # **`admin`**(요청은 `client` 를 보냈다). 그리고 더 나쁜 것이 뒤에 있다: 그렇게 생긴 계정 하나가
    # `users_count > 0` 을 만들어 **뒤따르는 시드 명령이 `nothing to seed: users=1` 을 찍고 rc=0 을
    # 낸다** — 데모 계정은 **0개**인 채다(같은 탐침에서 DB 를 직접 조회한 값).
    # **그러므로 rc=0 이 「네 계정이 생겼다」와 같은 뜻이 되는 것은 이 DB 가 방금 만든 빈 임시
    # DB 이기 때문이다.** 비어 있지 않은 DB 에서는 같지 않다.
    seed = subprocess.run([sys.executable, "-m", "services.api.seed"], cwd=str(ROOT), env=env,
                          capture_output=True, text=True)
    assert seed.returncode == 0, f"시드 명령이 실패했다 (rc={seed.returncode}): {seed.stdout}{seed.stderr}"
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
    """admin 이 프로젝트를 만들고 sample.ifc + sample.dxf(1F) 를 올린다(뷰어가 2D·3D 를 모두 그릴 수 있게).
    ADR 0006: admin 은 멤버십 없이도 조회는 되지만 행위 역할이 없다(업로드 불가) — 스모크가 실제로 로그인해
    쓰는 cm 에게 멤버십을 준다(그 프로젝트의 cm 로서 업로드도, 뷰어에서 조회도 가능해야 한다)."""
    with httpx.Client(timeout=120.0) as c:
        a = Api(c, prefix=api_server["base"])
        r = a.post("/projects", "admin", json={"name": "E2E 스모크 현장"})
        assert r.status_code == 201, r.text
        pid = r.json()["project_id"]
        add_member(a, pid, a.user_id("cm"), "cm")
        _, ifc_job = a.upload(pid, FIXTURES / "sample.ifc")
        assert ifc_job["status"] == "done", ifc_job
        _, dxf_job = a.upload(pid, FIXTURES / "sample.dxf", level="1F")
        assert dxf_job["status"] == "done", dxf_job
        return {"project_id": pid, "ifc_job": ifc_job, "dxf_job": dxf_job}


PREVIEW_CONFIG_TEMPLATE = """// 자동 생성(tests/e2e/conftest.py) — E2E 스모크용 vite preview 설정. 커밋하지 않는다(.gitignore).
// apps/web/vite.config.ts 를 그대로 쓰되 /api 프록시 대상을 테스트가 띄운 uvicorn 포트로 바꾼다.
// apps/web 안에 두는 이유: vite 가 설정 파일 위치 기준으로 'vite' 패키지를 해석한다(tests/ 아래에서는 못 찾는다).
import { mergeConfig } from "vite";
import base from "./vite.config";

export default mergeConfig(base, {
  preview: { proxy: { "/api": { target: "http://127.0.0.1:%(api_port)d", changeOrigin: true } } },
});
"""


@pytest.fixture(scope="session")
def web_server(api_server) -> Iterator[str]:
    """apps/web 를 빌드(dist 없으면)하고 vite preview 로 서빙. /api 는 api_server 로 프록시. base URL 을 준다."""
    if not (WEB / "dist" / "index.html").exists():
        subprocess.run(["npx", "vite", "build"], cwd=str(WEB), check=True)
    port = _free_port()
    config = WEB / f".e2e-preview.{port}.config.mts"
    config.write_text(PREVIEW_CONFIG_TEMPLATE % {"api_port": api_server["port"]}, encoding="utf-8")
    log = (api_server["tmp"] / "vite-preview.log").open("w")
    proc = subprocess.Popen(["npx", "vite", "preview", "--config", config.name, "--port", str(port), "--strictPort", "--host", "127.0.0.1"],
                            cwd=str(WEB), env=os.environ.copy(), stdout=log, stderr=subprocess.STDOUT)
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
        log.close()
        config.unlink(missing_ok=True)
