"""빈 DB 가 열어 두는 문과 시드가 닫는 문 — 담당: qa (계획 0014 작업 7 · §B-4).

**이 파일이 붙드는 것은 문장이 아니라 값이다**(CLAUDE.md §6-4 3): 상태 코드와 응답 `role`.

기동이 시드하지 않으므로(ADR 0018 §2-1) 빈 DB 로 앱을 띄우면 **관측 가능한 사실이 둘**이다 —
`POST /api/auth/login` 이 **401** 이고, `POST /api/auth/register` 가 **인증 없이 201** 이며 그 계정의
`role` 이 **`admin`** 이다(`auth/router.py` 의 `users_count(session) == 0` 갈래). **둘을 한 자리에서
함께 단언한다**(§6-2 4): 하나만 고정하면 다른 하나가 조용히 뒤집혀도 초록이다. 실제로 그 모양이
이 사이클 직전까지의 트리였다 — `test_01_auth.py` 의 `test_register_requires_admin_after_bootstrap`
은 **닫힌 쪽(403)만** 붙들고, 그 파일의 `client` 픽스처는 명시적으로 시드하므로 sqlite 갈래가
**403 → 201 로 뒤집혀도 통합 전량이 초록**이었다(계획 0014 §B-4, §C-5 ④).

**부트스트랩을 닫지 않는다.** 이 파일은 오늘의 값을 붙들 뿐이고, 그 자리의 처분(대체 경로와 ADR)은
계획 0014 §후속 67 이 연다. 그러므로 아래 201 은 **결함의 기록이 아니라 계약의 기록**이다 — 그 값을
바꾸는 변경은 이 파일을 빨갛게 만들고, 그때 함께 이 docstring 과 §후속 67 을 읽게 된다.

**DB 는 축이다**(ADR 0014 §2-2): 아래 픽스처는 `BUILDTWIN_CI_POSTGRES_URL` 이 있으면 **테스트마다
새 스키마**, 없으면 임시 sqlite 다. *한계 — 이 엔진은 축 기록기에 등록되지 않는다*: `tests/integration`
의 계약은 세션 엔진이 **하나**임을 단언하므로(`postgres_axis.check_contract(..., engines_expected=1)`)
여기서 등록하면 그 계약이 깨진다. 그래서 이 파일의 실행은 `tests/postgres.floor.json` 의
`tests/integration` 바닥값에 **세어지지 않는다** — 이 파일이 postgres 위에서도 도는지는 바닥값이
아니라 사람이 재야 한다(계획 0014 §확인하지 않은 것, 작업 7 이 더한 항목).

**변이 — 이 회귀가 결함에서 실제로 죽는가**(§6-2 1·5). 방법: 아래 두 명령, 잰 트리 = `055c5ac` +
이 파일, **각 칸 N=1**, 변이는 **한 자리씩** + `git diff` 로 적용 확인 뒤 그 자리에서 원복하고 루트
`git status --porcelain` 으로 확인. **§6-2 규칙 5 를 여기서 왜 그렇게 읽는가**: 그 규칙이 요구하는
「작업 트리 사본과 diff」는 `git diff`(대-HEAD)가 **침묵하는** 변이 — 자기 커밋이 처음 넣는 줄을 지우는
변이 — 의 것이다. 아래 여섯은 전부 **HEAD 에 이미 있는 남의 파일**을 고치므로 그 침묵이 나지 않는다.
실측으로 확인했다: 1·2·3·5·6 은 `git diff` 가 `-` 줄과 `+` 줄을 함께 냈고, **4 는 `-` 줄이 0 이고
`+` 세 줄뿐**인데(되돌림이 추가이므로) 그것도 침묵이 아니다 — 적용/미적용이 `3 insertions(+)` 로
갈린다. 둘째 열 = `pytest tests/integration/test_00_seed_boundary.py -q`,
셋째 열 = `pytest tests/integration -q --ignore=tests/integration/test_00_seed_boundary.py`.

| # | 변이(한 자리) | 흉내내는 결함 | 이 파일 | **이 파일을 뺀 통합 전량** |
|---|---|---|---|---|
| 0 | 없음 | — | **6 passed** | **226 passed** |
| 1 | `auth/router.py` `bootstrap = users_count(session) == 0` → `False` | 부트스트랩이 **닫힌다** | **2 failed, 4 passed** | **226 passed** ← 안 죽는다 |
| 2 | 같은 줄 → `True` | 부트스트랩이 **영영 열린다**(시드가 닫지 못한다) | **2 failed, 4 passed** | 8 failed, 198 passed, 20 errors |
| 3 | `auth/router.py` `role = "admin" if bootstrap else body.role` → `role = body.role` | 첫 계정이 **요청한 role 을 그대로** 갖는다 | **1 failed, 5 passed** | **226 passed** ← 안 죽는다 |
| 4 | `services/api/main.py` `init_database()` 에 기동 시드를 되돌린다(세 줄) | **이 사이클의 되돌림** | **4 failed, 2 passed** | **226 passed** ← 안 죽는다 |
| 5 | `services/api/seed.py` `seed_all` 의 `seed_dev_project(session, created)` → `None` | 계정은 생기고 **멤버십이 사라진다** | **2 failed, 4 passed** | 30 passed, 196 errors |
| 6 | 같은 파일 `main()` 의 `if unmet:` 갈래 `return 1` → `return 0` | 계약 미성립을 **rc 가 말하지 않는다** | **1 failed, 5 passed** | **226 passed** ← 안 죽는다 |

**셋째 열이 이 파일의 존재 이유다: 여섯 중 넷이 이 파일 없이는 통합 전량에서 초록이다.** 특히 4행 —
이 사이클 전체를 되돌리는 변이가 **226 passed** 다(픽스처가 명시적으로 시드하므로 가려진다).
1·3행은 **오늘 `make dev` 가 이미 그 상태**인 자리를 뒤집는 변이인데도 아무 데서도 안 죽었다.
5행이 계획 0014 §1-e 의 두 번째 갈래이고, 로그인은 **200 인 채로** 프로젝트 쪽만 갈린다 — 그래서
그 둘을 한 자리에서 함께 단언한다.

**두 축에서 다 돌렸다**(N=1 씩). sqlite: 이 파일 **6 passed** · 통합 전량 **232 passed**.
postgres(PostgreSQL 16.13, 포트 55443, 스키마 격리): 통합 전량 **232 passed** 이고 잡 로그가
`tests_on_postgres=188 engines=1 floor=187` — **엔진 수도 바닥값도 이 파일 때문에 달라지지 않는다**
(위 한계가 값으로 확인된 자리다). `tests/postgres.measured.json` 의 md5 도 그 실행 전후로 같다.
"""
from __future__ import annotations

import os
import secrets
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from packages.core import db as core_db
from packages.core.models.orm import ProjectMemberRow, ProjectRow, UserRow
from packages.core.settings import settings
from services.api.auth.seed import (
    DEV_SEED_MEMBER_ROLES,
    DEV_SEED_PASSWORD,
    DEV_SEED_PROJECT_ID,
    DEV_SEED_ROLES,
    seed_dev_users,
    users_count,
)
from services.api.seed import seed_all
from tests.helpers import postgres_axis as axis

ROOT = Path(__file__).resolve().parents[2]

#: 인증 없이 치는 요청. **`role` 은 일부러 `admin` 이 아니다** — 응답의 `admin` 이 요청의 메아리가
#: 아니라 `auth/router.py` 가 덮어쓴 값임을 그 자리에서 보이려는 것이다(계획 0014 §B-2 표 1).
NO_AUTH_BODY = {"email": "attacker@example.com", "password": "secret123", "role": "client", "name": "no auth"}


@pytest.fixture
def empty_database() -> Iterator[str]:
    """아무도 시드하지 않은 **빈 DB** 하나의 URL. 축을 따른다(모듈 docstring 의 한계도 함께 읽는다)."""
    postgres = axis.resolve_axis(os.environ)
    tmp = Path(tempfile.mkdtemp(prefix="buildtwin-seed-boundary-"))
    if postgres is None:
        yield f"sqlite:///{(tmp / 'empty.db').as_posix()}"
        shutil.rmtree(tmp, ignore_errors=True)
        return
    schema = axis.new_schema_name()
    axis.create_schema(postgres, schema)
    try:
        yield axis.schema_url(postgres, schema)
    finally:
        axis.drop_schema(postgres, schema)
        shutil.rmtree(tmp, ignore_errors=True)


@pytest.fixture
def boot(empty_database: str) -> Iterator[TestClient]:
    """그 빈 DB 로 앱을 **기동만** 한다(`create_app()` + lifespan). 시드는 부르지 않는다.

    전역 엔진을 `reset_engine()` 으로 비우지 않고 **객체를 그대로 보관했다가 되돌린다**: 같은 세션의
    `client` 픽스처가 살아 있으면 그 엔진에는 축 기록기의 리스너가 달려 있고, 되만들면 그 리스너가
    사라져 바닥값이 조용히 미달한다. 이 파일이 먼저 도는 오늘도(파일명 `test_00_`) 그 보관은
    **순서에 기대지 않기 위한** 것이다.
    """
    prior = (core_db._engine, core_db._Session, settings.database_url, settings.jwt_secret)
    prior_env = {k: os.environ.get(k) for k in ("DATABASE_URL", "JWT_SECRET")}
    os.environ["DATABASE_URL"] = settings.database_url = empty_database
    if not empty_database.startswith("sqlite"):
        # 비-sqlite 는 JWT_SECRET 없이 기동을 거부한다(§3-4 · settings.resolve_jwt_secret). 코드 상수 금지.
        os.environ["JWT_SECRET"] = settings.jwt_secret = secrets.token_urlsafe(32)
    core_db._engine, core_db._Session = None, None
    try:
        from services.api.main import create_app

        with TestClient(create_app()) as client:
            yield client
    finally:
        if core_db._engine is not None:
            core_db._engine.dispose()
        core_db._engine, core_db._Session, settings.database_url, settings.jwt_secret = prior
        for k, v in prior_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def run_seed_command(url: str, *args: str) -> subprocess.CompletedProcess[str]:
    """명시 시드를 **명령으로** 부른다(ADR 0018 §2-2). 하위 프로세스라 부모의 `settings` 가 닿지 않는다."""
    env = {**os.environ, "DATABASE_URL": url, "PYTHONPATH": str(ROOT)}
    return subprocess.run([sys.executable, "-m", "services.api.seed", *args],
                          cwd=str(ROOT), env=env, capture_output=True, text=True)


def login(client: TestClient, email: str, password: str = DEV_SEED_PASSWORD):
    return client.post("/api/auth/login", json={"username": email, "password": password})


def demo_memberships() -> list[str]:
    with core_db.session_scope() as s:
        rows = s.scalars(select(ProjectMemberRow).where(ProjectMemberRow.project_id == DEV_SEED_PROJECT_ID))
        return sorted(r.role for r in rows)


def test_an_empty_database_closes_login_and_opens_register_as_admin(boot):
    """§6-2 4 — **빈 DB 의 두 사실을 한 자리에서 함께** 단언한다. 하나만 고정하면 다른 하나가 뒤집힌다."""
    with core_db.session_scope() as s:
        assert users_count(s) == 0          # 기동은 시드하지 않는다(ADR 0018 §2-1)
    assert login(boot, "cm@buildtwin.local").status_code == 401

    r = boot.post("/api/auth/register", json=NO_AUTH_BODY)      # Authorization 헤더 없음
    assert r.status_code == 201, r.text
    assert r.json()["role"] == "admin", r.text                  # 요청은 "client" 를 보냈다

    # 응답 필드가 아니라 **로그인이** 그 계정의 role 을 말한다.
    r = login(boot, NO_AUTH_BODY["email"], NO_AUTH_BODY["password"])
    assert r.status_code == 200 and r.json()["role"] == "admin", r.text

    # 그리고 그 계정 하나가 생긴 순간 문이 닫힌다 — 부트스트랩은 **첫 계정 하나**의 것이다.
    r = boot.post("/api/auth/register", json={"email": "second@example.com", "password": "secret123", "role": "admin"})
    assert r.status_code == 403 and r.json()["code"] == "forbidden_role", r.text


def test_seeding_closes_the_register_door_the_empty_database_left_open(boot):
    """양성 — 「시드가 계정을 만든다」와 「시드가 부트스트랩을 닫는다」는 **다른 두 단정**이다."""
    with core_db.session_scope() as s:
        created, project = seed_all(s)
    assert sorted(u.role for u in created) == sorted(DEV_SEED_ROLES)
    assert project is not None and project.project_id == DEV_SEED_PROJECT_ID

    assert boot.post("/api/auth/register", json=NO_AUTH_BODY).status_code == 403
    assert boot.post("/api/auth/register", json=NO_AUTH_BODY).json()["code"] == "forbidden_role"

    # 닫혔지만 부서지지 않았다: admin 토큰으로는 열리고, **요청한 role 이 그대로 선다**(덮어쓰기는
    # 부트스트랩 갈래의 것이다).
    token = login(boot, "admin@buildtwin.local").json()["access_token"]
    r = boot.post("/api/auth/register", json={"email": "newcm@example.com", "password": "secret123", "role": "cm"},
                  headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 201 and r.json()["role"] == "cm", r.text


def test_the_seed_command_returns_rc0_and_its_four_accounts_can_log_in(boot, empty_database):
    """§6-2 4 — 「계정이 생겼다」와 「그 계정으로 로그인이 200 이다」를 함께. 그리고 멤버십 셋."""
    proc = run_seed_command(empty_database)
    assert proc.returncode == 0, f"stdout={proc.stdout} stderr={proc.stderr}"

    for role in DEV_SEED_ROLES:
        r = login(boot, f"{role}@buildtwin.local")
        assert r.status_code == 200, f"{role}: {r.text}"
        assert r.json()["role"] == role and r.json()["access_token"], r.text

    with core_db.session_scope() as s:
        assert s.get(ProjectRow, DEV_SEED_PROJECT_ID) is not None
        assert int(s.scalar(select(func.count()).select_from(UserRow)) or 0) == len(DEV_SEED_ROLES)
    assert demo_memberships() == sorted(DEV_SEED_MEMBER_ROLES)   # admin 은 받지 않는다(ADR 0006 §4)


def test_seeding_users_without_the_project_keeps_login_green_and_leaves_the_project_empty(boot):
    """계획 0014 §1-e 의 **두 번째 갈래**: `seed_dev_project` 만 사라지면 로그인은 200 이고 프로젝트가 빈다.

    로그인만 보는 단언은 이 칸을 **못 가른다** — 그래서 두 값을 한 자리에 적는다(§6-2 4).
    """
    with core_db.session_scope() as s:
        created = seed_dev_users(s)                              # seed_dev_project 를 부르지 않는다
    assert sorted(u.role for u in created) == sorted(DEV_SEED_ROLES)

    assert login(boot, "cm@buildtwin.local").status_code == 200
    with core_db.session_scope() as s:
        assert s.get(ProjectRow, DEV_SEED_PROJECT_ID) is None
    assert demo_memberships() == []


def test_the_command_reports_rc1_when_a_stranger_already_filled_the_database(boot, empty_database):
    """**rc 로 확인해야 하는 이유**(ADR 0018 §9-2): 빈 DB 가 열어 둔 그 문으로 들어온 계정 하나가
    `users_count(session) > 0` 을 만들고, 그러면 시드 명령은 **아무것도 만들지 못한다.**

    두 결함이 여기서 만난다 — 그리고 이 갈래에서 stdout 은 **비어 있다**: 「시드했다」를 stdout 으로
    확인하는 소비자는 이 실패를 보지 못한다.
    """
    assert boot.post("/api/auth/register", json=NO_AUTH_BODY).status_code == 201

    proc = run_seed_command(empty_database)
    assert proc.returncode == 1, f"stdout={proc.stdout} stderr={proc.stderr}"
    assert proc.stdout == ""
    assert "seed contract not met" in proc.stderr and DEV_SEED_PROJECT_ID in proc.stderr

    with core_db.session_scope() as s:                            # 데모 계정은 하나도 생기지 않았다
        assert users_count(s) == 1
        assert s.get(ProjectRow, DEV_SEED_PROJECT_ID) is None


def test_the_command_refuses_arguments_with_rc2(empty_database):
    """ADR 0018 §9-2 의 `rc=2`(호출이 틀렸다). 앱을 띄우지 않는다 — 명령만의 계약이다."""
    proc = run_seed_command(empty_database, "extra")
    assert proc.returncode == 2, f"stdout={proc.stdout} stderr={proc.stderr}"
    assert proc.stdout == "" and "인자를 받지 않는다" in proc.stderr
