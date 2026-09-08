"""빈 DB 의 정문과 그것을 여는 명령 하나 — 담당: qa (계획 0015 작업 7 · §후속 72).

**이 파일이 붙드는 것은 문장이 아니라 값이다**(CLAUDE.md §6-4 3): 상태 코드 · 응답 `role` ·
그 요청이 지나간 뒤의 `users` **행 수**.

## 무엇이 뒤집혔나 (작업 6 `deb92ab`, ADR 0019 결정 1)

이 파일은 그 커밋 전까지 **반대 값을 계약으로** 붙들었다 — 빈 DB 의 인증 없는
`POST /api/auth/register` 가 **201** 이고 그 계정의 `role` 이 **`admin`** 이라는 것
(`auth/router.py` 의 `users_count(session) == 0` 갈래). 그것은 결함의 기록이었고 처분을
계획 0014 §후속 67 이 열어 두었으며, 이 파일의 옛 docstring 은 *"그 값을 바꾸는 변경은 이 파일을
빨갛게 만든다"* 고 적어 두었다. **그 트립와이어가 실제로 울렸다**: `deb92ab` 는 이 파일의 두
테스트를 빨갛게 두고 커밋됐고(소유가 `tests/` 라 그 커밋이 만질 수 없었다 — CLAUDE.md §2),
이 커밋이 그 쌍의 나머지 반쪽이다.

이제 빈 DB 의 관측 가능한 사실은 **둘 다 닫힘**이다: `login` **401** · 인증 없는 `register`
**403 `forbidden_role`** · 그리고 그 요청 뒤에도 `users` 는 **0행**이다. 계정을 만드는 경로는
**명령 하나**(`python -m services.api.seed`)뿐이다(ADR 0019 §2-2).

## 왜 「닫힘」만 단언하면 검증이 아닌가 (§6-2 1)

**「문이 닫혔다」와 「스택이 죽었다」는 403 에서 구별되지 않는다.** 라우터가 통째로 사라져도,
의존성이 언제나 던져도, 앱이 아무 요청에나 403 을 내도 닫힘 단언은 초록이다. 그래서 ① 은 같은
자리에서 **양성**을 함께 단언한다(§6-2 4): 같은 빈 DB 에 시드 **명령**을 부르면 rc **0** 이고,
네 계정이 **200** 으로 로그인하며 `role` 이 각각 contractor/cm/client/admin 이고, 그 admin 토큰으로
친 register 는 **201** 에 응답 `role` 이 **요청한 값 그대로**다. 즉 그 403 은 **역할 판정**이지
죽은 경로가 아니다. 변이 표의 **M6**(라우터가 언제나 403)이 그 칸을 값으로 태운 자리다.

**그리고 403 이 요청한 `role` 에 따라 갈리지 않는 것도 함께 본다** — 옛 코드에서 그 자리는 요청의
`role` 을 **무시하고 admin 으로 덮어썼고**, 새 코드에서는 요청의 `role` 이 그대로 선다. 그래서
"인증 없이 `admin` 을 달라"는 요청도 같은 403 이어야 한다(§6-3 한정어: 「어떤 role 을 요청했는가」로
이 문이 갈리지 않는다).

## ③ 전제가 사라진 시나리오를 어떻게 다시 세웠나

`test_the_command_reports_rc1_when_a_stranger_already_filled_the_database` 는 ADR 0018 §9-2 의
**rc=1** 계약(「남의 계정이 있는 DB 에는 데모 계정을 만들지 않는다」)을 붙드는데, 그 전제였던
**「register 로 남이 들어온다」가 이 커밋에서 없어졌다.** 그러므로 그 계정은 register 가 아닌
경로 — **직접 insert** — 로 세운다. 그 경로는 흉내가 아니라 실물이다: 운영 DB · 마이그레이션 ·
다른 도구 · 사람 손이 넣은 행은 전부 이 모양이고, `seed_dev_users` 의 `users_count(session) > 0`
갈래는 **행이 어디서 왔는지 가리지 않는다**. 그 테스트는 **없어진 전제도 같은 자리에서 단언한다**
(인증 없는 register 가 403 이고 그 뒤 `users` 가 0행이라는 것) — 전제가 사라졌다는 사실 자체를
값으로 남기지 않으면, 다음 사람은 이 테스트가 왜 insert 로 세워졌는지 읽을 자리가 없다.

## 이 파일이 **보지 못하는** 것 (§6-1 ②)

- **네트워크 축.** 여기는 전부 in-process(`TestClient`)다. 비-루프백 주소로 실제 소켓에 친 값은
  작업 6 이 쟀고(`deb92ab` 본문: `uvicorn --host 0.0.0.0`, 포트 55437, `192.0.2.2` → 403), 이
  커밋도 다시 쟀다(아래 「두 축」). 그 축을 **`make test` 는 돌지 않는다**.
- **compose 갈래의 DB.** 아래 픽스처는 sqlite 또는 축의 postgres 스키마이고, `docker compose` 로
  뜬 스택의 postgres 가 아니다(데몬 부재 — 계획 0015 §확인하지 않은 것 60·62).
- **`services/api/seed.py` 밖의 시드 경로.** 이 파일은 「명령이 유일한 경로다」를 **명령 쪽에서만**
  본다. 저장소에 다른 쓰기 경로가 생기면 여기서 안 죽는다.

## DB 는 축이다 (ADR 0014 §2-2)

아래 픽스처는 `BUILDTWIN_CI_POSTGRES_URL` 이 있으면 **테스트마다 새 스키마**, 없으면 임시 sqlite 다.
*한계 — 이 엔진은 축 기록기에 등록되지 않는다*: `tests/integration` 의 계약은 세션 엔진이 **하나**임을
단언하므로(`postgres_axis.check_contract(..., engines_expected=1)`) 여기서 등록하면 그 계약이 깨진다.
그래서 이 파일의 실행은 `tests/postgres.floor.json` 의 `tests/integration` 바닥값에 **세어지지
않는다** — 이 파일이 postgres 위에서도 도는지는 바닥값이 아니라 사람이 재야 한다.

## 결함 있는 상태에서 실제로 죽는가 (§6-2 1·5 — 변이 실측, 각 N=1)

변이는 **한 자리씩** 심고, **심기 직전의 작업 트리 사본과 `diff`** 로 적용을 확인한 뒤 재고, 그
사본으로 원복하고 루트 `git status --porcelain` 으로 확인했다(§6-2 규칙 5). 잰 트리 = `deb92ab` +
이 커밋. 둘째 열 = `pytest tests/integration/test_00_seed_boundary.py -q`,
셋째 열 = `pytest tests/integration -q --ignore=tests/integration/test_00_seed_boundary.py`.

| # | 변이(한 자리) | 흉내내는 결함 | 이 파일 | **이 파일을 뺀 통합 전량** |
|---|---|---|---|---|
| 0 | 없음 | — | **6 passed** | **226 passed** |
| 1 | `auth/router.py` 의 `if user is None or user.role != "admin":` → `if user is not None and user.role != "admin":` | **인증 없는 호출에 문이 열린다** | **3 failed, 3 passed** | 1 failed, 225 passed(`test_01_auth.py` 의 admin 전용 행렬) |
| 2 | 같은 파일에 **부트스트랩 갈래를 그대로 되살린다**(빈 DB 면 인증 없이 통과 + `role` 을 `admin` 으로 덮어쓴다) | **작업 6 을 통째로 되돌린다** | **2 failed, 4 passed** | **226 passed** ← 안 죽는다 |
| 3 | `role = body.role` → `role = "admin"` | 서버가 요청한 `role` 을 덮어쓴다 | **2 failed, 4 passed** | 8 failed, 198 passed, 20 errors |
| 4 | `services/api/seed.py` `seed_all` 의 `seed_dev_project(session, created)` → `None` | 계정은 생기고 **멤버십이 사라진다** | **3 failed, 3 passed** | 30 passed, 196 errors |
| 5 | 같은 파일 `main()` 의 `if unmet:` 갈래 `return 1` → `return 0` | 계약 미성립을 **rc 가 말하지 않는다** | **1 failed, 5 passed** | **226 passed** ← 안 죽는다 |
| 6 | `auth/router.py` register 의 첫 줄을 **무조건** `raise Forbidden(...)` 으로 | **스택이 죽었다**(그 경로가 아무에게도 안 열린다) | **2 failed, 4 passed** | 6 failed, 198 passed, 22 errors |
| 7 | `services/api/main.py` `init_database()` 에 기동 시드를 되돌린다(세 줄) | 기동이 다시 시드한다 | **4 failed, 2 passed** | **226 passed** ← 안 죽는다 |

**2행이 §후속 72 가 이름 붙인 자리다.** 작업 6 은 그 변이에서 **통합(이 파일 제외) 226 passed ·
단위+불변식 603 passed** 를 쟀다 — 즉 `deb92ab` 뒤 「빈 DB 에서 문이 닫혀 있다」를 보는 테스트가
저장소에 **하나도 없었다**. 이 커밋 뒤 그 자리는 2 failed, 4 passed 다.

**6행이 「닫힘만 단언하면 안 되는」 이유의 값이다**(§6-2 1): 그 변이는 문을 **더 세게** 닫는데,
닫힘만 보는 단언이었으면 **초록**이다. ① 이 양성을 같은 자리에 실어서 죽는다.

**셋째 열이 이 파일의 존재 이유다**: 일곱 중 **셋**(M2·M5·M7)이 이 파일 없이는 통합 전량에서 **초록**이다. M2 는 작업 6 을 통째로 되돌리는 변이이고, M7 은 기동이 다시 시드하는 변이이며, M5 는 rc 계약이 무너지는 변이다 — 셋 다 「데모 경로가 부러졌다」인데 이 파일 밖에서는 한 칸도 갈리지 않는다.

## 두 축에서 다 돌렸다 (각 N=1)

- **sqlite**(기본): 이 파일 **6 passed** · 통합 전량 **232 passed**.
- **postgres**(PostgreSQL 16.13, 포트 55443, 스키마 격리): 통합 전량 **232 passed** 이고
  잡 로그가 `[db-axis] tree=tests/integration dialect=postgresql server_version=16.13 tests_on_postgres=188 engines=1 floor=187` — **엔진 수도 바닥값도 이 파일 때문에 달라지지 않는다**(위 한계가 값으로
  확인된 자리다). `tests/postgres.measured.json` 의 md5 는 그 실행 전후로 같다(`e4adf3b465db0b3d751a9f7cf01b697a`).
- **비-루프백 네트워크**(`make test` 밖 — `uvicorn --host 0.0.0.0`, 포트 55445, 빈 sqlite,
  주소 `192.0.2.2`): health **200** · 인증 없는 register **403 `forbidden_role`**(요청 role 이 `client` 든 `admin` 이든 **같다**) · 그 뒤 `users` **0행** · login **401** · `python -m services.api.seed` rc **0** · login(cm) **200**. 포트 반납했다. 작업 6 이 같은 축(포트 55437)에서 잰 값과 일치하고, 리뷰어가 사이클 0014 에서 같은 축에서 잰 값은 **201 · admin** 이었다.
"""
from __future__ import annotations

import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from packages.core import db as core_db
from packages.core.models.orm import ProjectMemberRow, ProjectRow, UserRow
from packages.core.settings import settings
from services.api.auth.security import hash_password
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

#: 인증 없이 치는 요청. **`role` 은 일부러 `admin` 이 아니다** — 옛 트리에서 이 자리는 요청의 `role` 을
#: 무시하고 `admin` 으로 덮어썼으므로, 그 덮어쓰기가 없어졌다는 것을 요청과 응답이 다른 값을 갖는
#: 자리에서 봐야 했다. 오늘 그 문은 아예 열리지 않으므로 이 값은 **아래 `NO_AUTH_ADMIN_BODY` 와 짝**이
#: 되어 「요청한 role 이 이 문을 가르지 않는다」를 보인다.
NO_AUTH_BODY = {"email": "attacker@example.com", "password": "secret123", "role": "client", "name": "no auth"}

#: 같은 요청인데 **`admin` 을 달라고 한다**. 옛 부트스트랩 갈래가 주던 바로 그 role 이다.
NO_AUTH_ADMIN_BODY = {"email": "attacker2@example.com", "password": "secret123", "role": "admin", "name": "no auth"}


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


def insert_stranger_directly(email: str = "stranger@example.com", role: str = "cm") -> str:
    """**register 를 지나지 않고** 계정 하나를 넣는다 — 이 파일의 `boot` 가 쥔 그 DB 에 직접.

    이것이 흉내가 아닌 이유는 모듈 docstring 에 있다: `seed_dev_users` 의
    `users_count(session) > 0` 갈래는 그 행이 **어디서 왔는지 가리지 않는다.**
    """
    with core_db.session_scope() as s:
        s.add(UserRow(user_id=f"u-{uuid.uuid4().hex[:12]}", email=email,
                      password_hash=hash_password("secret123"), role=role, name="stranger"))
    return email


def test_an_empty_database_closes_login_and_register_and_the_command_is_the_only_way_in(boot, empty_database):
    """① 닫힘 + ② 양성을 **한 자리에서 함께**(§6-2 1·4). 닫힘만 보면 「스택이 죽었다」와 구별되지 않는다."""
    # --- 닫힘 -------------------------------------------------------------------------------------
    with core_db.session_scope() as s:
        assert users_count(s) == 0          # 기동은 시드하지 않는다(ADR 0018 §2-1)
    assert login(boot, "cm@buildtwin.local").status_code == 401

    r = boot.post("/api/auth/register", json=NO_AUTH_BODY)      # Authorization 헤더 없음
    assert r.status_code == 403, r.text
    assert r.json()["code"] == "forbidden_role", r.text

    # 요청한 role 이 이 문을 가르지 않는다 — 옛 갈래가 주던 그 `admin` 을 달라고 해도 같다.
    r = boot.post("/api/auth/register", json=NO_AUTH_ADMIN_BODY)
    assert r.status_code == 403 and r.json()["code"] == "forbidden_role", r.text

    # **거절이 행을 남기지 않았다.** 상태 코드만 보면 「403 을 내고 만들기는 했다」와 갈리지 않는다.
    with core_db.session_scope() as s:
        assert users_count(s) == 0

    # --- 양성: 같은 빈 DB 를 명령 하나가 연다 -----------------------------------------------------
    proc = run_seed_command(empty_database)
    assert proc.returncode == 0, f"stdout={proc.stdout} stderr={proc.stderr}"

    for role in DEV_SEED_ROLES:
        r = login(boot, f"{role}@buildtwin.local")
        assert r.status_code == 200, f"{role}: {r.text}"
        assert r.json()["role"] == role and r.json()["access_token"], r.text

    # 그 403 은 **역할 판정**이었다: admin 토큰으로는 열리고, 요청한 role 이 그대로 선다.
    token = login(boot, "admin@buildtwin.local").json()["access_token"]
    r = boot.post("/api/auth/register", json={"email": "newcm@example.com", "password": "secret123", "role": "cm"},
                  headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 201 and r.json()["role"] == "cm", r.text


def test_seeding_leaves_the_door_closed_to_strangers_and_open_to_admin(boot):
    """양성 — 「시드가 계정을 만든다」와 「시드가 정문을 열지 않는다」는 **다른 두 단정**이다.

    ① 은 명령(하위 프로세스)으로, 이 테스트는 **같은 프로세스의 함수**(`seed_all`)로 같은 자리를 본다 —
    `tests/e2e` 의 두 픽스처가 그 둘로 갈리므로(ADR 0018 §2-2) 양쪽이 다 서야 한다.
    """
    with core_db.session_scope() as s:
        created, project = seed_all(s)
    assert sorted(u.role for u in created) == sorted(DEV_SEED_ROLES)
    assert project is not None and project.project_id == DEV_SEED_PROJECT_ID

    assert boot.post("/api/auth/register", json=NO_AUTH_BODY).status_code == 403
    assert boot.post("/api/auth/register", json=NO_AUTH_BODY).json()["code"] == "forbidden_role"

    # 닫혔지만 부서지지 않았다: admin 토큰으로는 열리고, **요청한 role 이 그대로 선다**.
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
    """**rc 로 확인해야 하는 이유**(ADR 0018 §9-2): 데모와 무관한 계정 하나가 `users_count(session) > 0`
    을 만들고, 그러면 시드 명령은 **아무것도 만들지 못한다.** 이 갈래에서 stdout 은 **비어 있다** —
    「시드했다」를 stdout 으로 확인하는 소비자는 이 실패를 보지 못한다.

    **이 계정은 register 로 들어오지 않는다.** 그 전제(빈 DB 가 열어 두던 정문)는 작업 6 이 없앴고,
    아래 첫 두 줄이 그 사실 자체를 값으로 단언한다 — 없어진 전제를 적지 않으면 다음 사람은 이
    시나리오가 왜 직접 insert 로 세워졌는지 읽을 자리가 없다(§6-4 1). 계약은 그대로 성립한다:
    `seed_dev_users` 는 행이 **어디서 왔는지 가리지 않는다.**
    """
    assert boot.post("/api/auth/register", json=NO_AUTH_BODY).status_code == 403
    with core_db.session_scope() as s:
        assert users_count(s) == 0                                # 그 403 은 행을 남기지 않았다

    email = insert_stranger_directly()                            # register 가 아닌 경로

    proc = run_seed_command(empty_database)
    assert proc.returncode == 1, f"stdout={proc.stdout} stderr={proc.stderr}"
    assert proc.stdout == ""
    assert "seed contract not met" in proc.stderr and DEV_SEED_PROJECT_ID in proc.stderr

    with core_db.session_scope() as s:                            # 데모 계정은 하나도 생기지 않았다
        assert users_count(s) == 1
        assert s.scalars(select(UserRow).where(UserRow.email == email)).first() is not None
        assert s.get(ProjectRow, DEV_SEED_PROJECT_ID) is None


def test_the_command_refuses_arguments_with_rc2(empty_database):
    """ADR 0018 §9-2 의 `rc=2`(호출이 틀렸다). 앱을 띄우지 않는다 — 명령만의 계약이다."""
    proc = run_seed_command(empty_database, "extra")
    assert proc.returncode == 2, f"stdout={proc.stdout} stderr={proc.stderr}"
    assert proc.stdout == "" and "인자를 받지 않는다" in proc.stderr
