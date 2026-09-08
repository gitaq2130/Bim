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
죽는다」로 관측되는 자리다. **그 표는 `b09ae65` 트리의 기록이고 아래 둘은 계획 0015 작업 7 의 값이다.**

## 문 4 는 이제 이 파일을 지난다 (작업 7, §6-2 1)

**`make e2e` 는 문 4 를 구조적으로 못 보고 있었다.** 아래 `PREVIEW_CONFIG` 가 `/api` 프록시 대상을
**상수로** 적고 있었고(`"http://127.0.0.1:%(api_port)d"` 를 보간으로 조립 — 루트 grep 에도 안 걸린다),
vite 는 `preview.proxy` 가 있으면 `server.proxy` 를 **보지 않는다**(frontend 실측). 그래서
`apps/web/vite.proxy-target.ts` 의 `resolveApiProxyTarget` 은 E2E 전체에서 **한 번도 불리지 않았다**.
지금은 그 함수가 대상을 정하고, 값은 `web_server` 가 환경으로 준다.

변이(한 자리씩 · 심기 직전 사본과 `diff` · 그 사본으로 원복 · 루트 `git status --porcelain`, 각 N=1).
명령은 매번 `make e2e`.

| # | 변이 | 이 커밋의 트리 | **작업 7 이전 conftest**(대조군) |
|---|---|---|---|
| 0 | 없음 | **12 passed** | 12 passed |
| E1 | `vite.proxy-target.ts` 의 `API_PROXY_TARGET_ENV` → `"API_PROXY_TARGET"` | **9 passed, 3 errors** — `web_server` 가 두 자리의 철자가 갈렸다고 이름으로 죽는다 | **12 passed ← 아무것도 안 죽는다** |
| E2 | 이 파일이 preview 프로세스에 주는 그 환경 값을 **뺀다** | **9 passed, 3 errors** — `_wait_http` 가 `RuntimeError: server not ready`(프록시가 기본값 `http://localhost:8000` 을 가리킨다) | — |

**E1 의 두 칸이 이 변경의 값이다**: 같은 변이가 옛 배선에서는 **12 passed**, 새 배선에서는 3 errors 다.
E2 는 그 값이 **실제로 프록시를 정하는지**를 따로 태운다(E1 만으로는 「단언이 죽었다」이지
「프록시가 갈렸다」가 아니다 — §6-2 2).

*이 표가 보지 못하는 것*: 이 픽스처는 주변 환경의 `BUILDTWIN_API_PROXY_TARGET` 을 **일부러 덮으므로**,
`BUILDTWIN_API_PROXY_TARGET=<없는 호스트> make e2e` 는 여기서도 **12 passed** 다(frontend 가 HEAD 에서
잰 그 값과 같다). 그것은 사각이 아니라 **설계**다 — 이 프록시는 이 실행이 띄운 포트를 가리켜야 한다.
그리고 compose 의 `web.environment` **키** 철자는 이 파일이 보지 않는다(그쪽은
`tests/invariants/test_demo_stack_can_stand.py` ⑥).

## preview 갈래도 `/api` 의 에러 핸들러를 지난다 (ⓧ — 계획 0016 작업 2 조건 5, ADR 0020 §8 4행)

`6ac7a19` 이 `apps/web/vite.config.ts` 의 `server.proxy["/api"]` 에 `configure` 를 두어 **대상이 답하지
않을 때 본문 있는 502** 를 만들었는데, 아래 `PREVIEW_CONFIG` 가 `preview.proxy["/api"]` 에
`target`·`changeOrigin` 두 키를 **다시 선언**해 그 핸들러가 이 갈래에 오지 않았다. 그래서 그 머리
주석의 *"vite.config.ts 를 그대로 쓰되"* 가 거짓이었고, **고친 것은 주석이 아니라 코드다** — 옵션
객체를 펼쳐 물려받는다(주석은 그 참을 정확히 적도록 다시 썼다).

방법(각 **N=1**, 한 세션 안 · 서로 몇 분 간격): 대상은 **닫힌 포트**(bind 뒤 닫아 얻은 번호),
`BUILDTWIN_API_PROXY_TARGET=<그 대상> npx vite [preview --config <그 설정>] --port <빈 포트>
--strictPort --host 127.0.0.1` 로 띄우고 `/api/health` 의 status 와 본문 바이트를 읽는다.

| 트리 | 갈래 | status | 본문 바이트 |
|---|---|---|---|
| `6ac7a19` | dev | **502** | **404** |
| `6ac7a19` | preview(옛 `PREVIEW_CONFIG`) | **500** | **0** |
| 이 커밋 | preview(아래 `PREVIEW_CONFIG`) | **502** | **404** |

**dev 와 preview 가 같은 값을 낸다**는 것이 이 변경의 값이다. 그 본문의 문자열은 `frontend` 소유이고
(`apps/web/vite.config.ts` 의 `apiProxyFailureBody`) 이 파일은 그것을 **베끼지 않는다** — 베끼면 같은
문자열이 두 자리에 살고 한쪽이 바뀌면 다른 쪽이 조용히 낡는다. 그 본문이 preview 갈래에서도
*"vite dev 서버가 만들었다"* 라고 적는 것은 그대로 관측된다 — ADR 0020 §2-4 가 preview 갈래를 계약
밖에 두므로 이 파일은 그것을 고치지 않고 값으로만 적어 둔다.

## `vite preview` 고아 — 1회당 1개였다 (작업 7)

세는 법: `ps -eo args --no-headers | grep -c "^node .*vite preview"`(자기 셸을 세지 않도록 `node` 로
시작하는 줄만 — `pgrep -f "vite preview"` 나 `ps -eo args | grep -c "[v]ite preview"` 는 **재는 명령
자신**을 세는 수가 있다). `make e2e` 전후로 각각 읽었다.

| 배선 | 실행 전 → 후 | 1회당 |
|---|---|---|
| 이 커밋(`start_new_session=True` + 그룹째 종료) | 0 → 0 · 0 → 0 (**N=2**) | **0** |
| 옛 배선(`proc.terminate()`) | 0 → 1 · 0 → 1 (**N=2**) | **1** |

**기전**: `npx` 는 실제 서버를 자식으로 띄우므로 `terminate()` 는 npx 만 죽이고 그 node 는 부모가 1 번이
되어 남는다 — 신호의 세기가 아니라 **받는 대상**이 문제다. 이 세션이 인계받은 트리에는 그렇게 쌓인
고아가 **14개** 있었고(그중 가장 오래된 것 2시간 15분), 각자 포트 하나와 `.e2e-preview.<port>.config.mts`
하나를 잡고 있었다. 전부 죽였다.

**반증**: 인계 메모의 *"실행 전 12 → 실행 후 15, 즉 1회당 3개(N=1)"* 는 위 값과 갈린다. 갈리는 이유가
**세는 법**일 수 있다 — `ps -eo args | grep -c "[v]ite preview"` 는 이 환경에서 재는 셸 자신을 함께
세어 같은 순간에 14 와 15 를 둘 다 냈다(실측). 「1회당 3개」는 재현되지 않았다.
"""
from __future__ import annotations

import contextlib
import json
import os
import re
import shutil
import signal
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
def _declared_proxy_env_name() -> str:
    """`apps/web/vite.proxy-target.ts` 가 선언한 `API_PROXY_TARGET_ENV` 값. 없으면 빈 문자열."""
    hits = re.findall(r'^export const API_PROXY_TARGET_ENV = "([^"]*)";',
                      (WEB / "vite.proxy-target.ts").read_text(encoding="utf-8"), flags=re.M)
    return hits[0] if len(hits) == 1 else ""


def _stop(proc: subprocess.Popen, group: bool = False) -> None:
    """서버를 세운다. `group=True` 면 **프로세스 그룹째** 보낸다.

    `npx` 는 실제 서버를 **자식 프로세스**로 띄우므로 `proc.terminate()` 는 npx 만 죽이고 그 node 는
    부모가 1 번이 되어 살아남는다 — 그것이 이 환경에 쌓여 있던 고아 `vite preview` 들이다.
    누수율은 **1회당 1개**(실측: `make e2e` 전후 `ps -eo args | grep -c "[v]ite preview"` 가
    15 → 16, N=1; 그 15 는 이 세션 이전 실행들의 **누적**이지 한 번의 값이 아니다). 그래서
    `start_new_session=True` 로 그룹을 떼고 여기서 그룹째 보낸다 — 옛 배선에서는 SIGKILL 로 올려도
    npx 만 죽으므로 신호의 세기가 아니라 **받는 대상**이 문제다.
    """
    if group:
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    else:
        proc.terminate()
    try:
        proc.wait(10)
    except subprocess.TimeoutExpired:
        if group:
            with contextlib.suppress(ProcessLookupError, PermissionError):
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        else:
            proc.kill()
        with contextlib.suppress(subprocess.TimeoutExpired):
            proc.wait(5)


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
    # **uvicorn 을 띄우기 「전」에 부른다 — 순서는 그대로이고 근거가 이 사이클에서 바뀌었다.**
    # 이 주석은 여기 있던 창을 실측으로 적고 있었다(계획 0014 §확인하지 않은 것 54 가 이름 붙인
    # 것: `_wait_http` 반환 → 시드 완료까지 **1.276·1.294·1.307s**, N=3, 그 창에서 인증 없는
    # `POST /api/auth/register` 가 **201** 이고 응답 `role` 이 **`admin`**). **그 창은 이제
    # 무해하다** — 작업 6(`deb92ab`, ADR 0019 결정 1)이 그 부트스트랩 갈래를 없앴고, 빈 DB 의 인증
    # 없는 register 는 **403 `forbidden_role`** 이며 그 뒤에도 `users` 는 **0행**이다
    # (`tests/integration/test_00_seed_boundary.py` 의 ①이 그 값을 붙든다).
    #
    # 그리고 같은 주석의 뒤 문장 — *"그렇게 생긴 계정 하나가 뒤따르는 시드 명령을 `nothing to seed:
    # users=1` 을 찍고 rc=0 으로 만든다"* — 은 **오늘 트리에서 이미 거짓이었다**(작업 6 이 만든
    # 거짓이 아니다): `services/api/seed.py` 의 `unmet_contract` 갈래가 그 경우 stdout 을 비우고
    # **rc=1** 을 낸다(`test_00_seed_boundary.py` 의 rc=1 테스트가 그 값이다). 지운다.
    #
    # 순서를 그대로 두는 근거는 남은 둘이다: ⓐ 시드가 실패한 트리에서는 리스너를 띄우지 않아
    # `_wait_http` 의 타임아웃이 아니라 **아래 단언**이 rc 와 stderr 를 이름으로 낸다, ⓑ rc=0 이
    # 「네 계정이 생겼다」와 같은 뜻이 되는 것은 이 DB 가 **방금 만든 빈 임시 DB** 이기 때문이고,
    # 비어 있지 않은 DB 에서는 같지 않다(그 갈래가 rc=1 이다).
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
        _stop(proc)
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


#: `/api` 프록시 대상을 담는 환경 이름. **정본은 `apps/web/vite.proxy-target.ts` 의
#: `API_PROXY_TARGET_ENV`** 이고, `docker-compose.yml` 의 `web.environment` 가 같은 이름을 쓴다
#: (그 둘의 철자 일치는 `tests/invariants/test_demo_stack_can_stand.py` 의 ⑥ 이 붙든다).
#: 여기가 **셋째 자리**라 아래 `web_server` 가 그 파일을 읽어 **맞대 본다** — 갈리면 프록시가 조용히
#: 기본값(`http://localhost:8000`)으로 떨어지는 대신 이 픽스처가 이름으로 죽는다.
API_PROXY_TARGET_ENV = "BUILDTWIN_API_PROXY_TARGET"

PREVIEW_CONFIG = """// 자동 생성(tests/e2e/conftest.py) — E2E 스모크용 vite preview 설정. 커밋하지 않는다(.gitignore).
// apps/web/vite.config.ts 의 `/api` 프록시 **옵션 객체를 통째로 물려받고**(그 안의 `configure` =
// 대상이 답하지 않을 때의 에러 핸들러 포함) **대상만** 문 4 의 그 자리에서 다시 읽는다.
// apps/web 안에 두는 이유: vite 가 설정 파일 위치 기준으로 'vite' 패키지를 해석한다(tests/ 아래에서는 못 찾는다).
//
// **vite 는 preview.proxy 가 있으면 server.proxy 를 보지 않는다**(frontend 실측). 그래서 여기에 키를
// 다시 적으면 base 에만 있는 키는 이 갈래에 **오지 않고**, 그 손해는 두 번 다 「조용히 다른 것을 잰다」
// 였다:
//   ① 대상을 상수로 적던 트리 — `resolveApiProxyTarget` 이 E2E 전체에서 한 번도 불리지 않아 그 함수가
//      부러져도 12 passed 였다(계획 0015 작업 7).
//   ② `target`·`changeOrigin` **두 키만** 다시 적던 트리(`6ac7a19`) — vite.config.ts 의 에러 핸들러가
//      이 갈래에 오지 않아, 대상을 닫힌 포트로 두고 `/api/health` 를 치면 dev 갈래는 **502 · 본문
//      404바이트**인데 preview 갈래는 **500 · 본문 0바이트**였다(방법·N 은 이 파일 머리 표).
// 그래서 키를 **다시 세지 않고 객체를 펼친다** — base 에 키가 하나 더 생겨도 이 갈래가 그것을 지난다.
import { mergeConfig, type ProxyOptions } from "vite";
import base from "./vite.config";
import { resolveApiProxyTarget } from "./vite.proxy-target";

// 물려받을 것이 없으면 **기본 동작으로 조용히 떨어지지 않고** 여기서 죽는다 — 그 조용함이 위 ② 다.
const inherited = base.server?.proxy?.["/api"];
if (!inherited || typeof inherited === "string") {
  throw new Error(
    "vite.config.ts 의 server.proxy['/api'] 가 객체가 아니다 — preview 갈래가 그 설정을 물려받지 못한다. " +
      "tests/e2e/conftest.py 의 PREVIEW_CONFIG 를 그 모양과 함께 고쳐라.",
  );
}
const apiProxy: ProxyOptions = inherited;

export default mergeConfig(base, {
  preview: { proxy: { "/api": { ...apiProxy, target: resolveApiProxyTarget() } } },
});
"""


@pytest.fixture(scope="session")
def web_server(api_server) -> Iterator[str]:
    """apps/web 를 빌드(dist 없으면)하고 vite preview 로 서빙. /api 는 api_server 로 프록시. base URL 을 준다."""
    if not (WEB / "dist" / "index.html").exists():
        subprocess.run(["npx", "vite", "build"], cwd=str(WEB), check=True)
    declared = _declared_proxy_env_name()
    assert declared == API_PROXY_TARGET_ENV, (
        f"apps/web/vite.proxy-target.ts 의 API_PROXY_TARGET_ENV 는 `{declared}` 인데 이 픽스처는 "
        f"`{API_PROXY_TARGET_ENV}` 로 준다 — 갈리면 preview 의 /api 는 기본값으로 떨어져 이 E2E 가 띄운 "
        "uvicorn 이 아니라 http://localhost:8000 을 가리킨다(문 4). 두 자리를 함께 고쳐라."
    )
    port = _free_port()
    config = WEB / f".e2e-preview.{port}.config.mts"
    config.write_text(PREVIEW_CONFIG, encoding="utf-8")
    log = (api_server["tmp"] / "vite-preview.log").open("w")
    # 주변 환경의 값은 **일부러 덮는다** — 이 프록시는 이 실행이 띄운 포트를 가리켜야 한다. 그래서
    # `BUILDTWIN_API_PROXY_TARGET=<아무 값> make e2e` 는 이 결과를 바꾸지 못한다(설계이지 사각이 아니다).
    env = {**os.environ, API_PROXY_TARGET_ENV: api_server["base"]}
    proc = subprocess.Popen(["npx", "vite", "preview", "--config", config.name, "--port", str(port), "--strictPort", "--host", "127.0.0.1"],
                            cwd=str(WEB), env=env, stdout=log, stderr=subprocess.STDOUT,
                            start_new_session=True)
    base = f"http://127.0.0.1:{port}"
    try:
        _wait_http(f"{base}/", 60, proc)
        _wait_http(f"{base}/api/health", 30, proc)   # 프록시 확인
        yield base
    finally:
        _stop(proc, group=True)      # npx 의 자식까지 — 그러지 않으면 vite preview 가 고아로 남는다
        log.close()
        config.unlink(missing_ok=True)
