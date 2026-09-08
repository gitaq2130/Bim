"""API 통합 테스트 공용 픽스처. 세션 시작 시(픽스처 시점에) 전용 DB/저장소를 만들고 엔진을 재설정한다.

**DB 는 축이다**(ADR 0014 §2-2): `BUILDTWIN_CI_POSTGRES_URL` 이 설정돼 있고 비어 있지 않으면 그
PostgreSQL + 세션 전용 스키마(`search_path`, 끝나면 `DROP SCHEMA … CASCADE`), 아니면 전용 임시 SQLite 다.
CI 는 두 갈래를 둘 다 돈다(`.github/workflows/buildtwin-ci.yml` 의 `integration` 잡, 스텝 둘).
postgres 갈래에서는 이 파일이 `JWT_SECRET`(세션 난수)을 준다 — `settings.resolve_jwt_secret` 의
non-sqlite 갈래가 §3-4 대로 기동을 거부하기 때문이다(ADR 0014 §2-3 3).

**데모 계정은 이 픽스처가 자기 손으로 만든다**(ADR 0018 §2-1). `client` 가 `init_db` 뒤 `create_app()`
앞에서 `services.api.seed.seed_all` 을 부르고, **그 호출이 네 계정을 실제로 만들었음**을 그 자리에서
단언한다 — 그러므로 기동이 무엇을 하든 이 세션의 계정은 그 호출이 만든 것이다. 두 축이 같은 한 줄을
지난다(예전에는 sqlite 축이 기동의 `url.startswith("sqlite")` 갈래로, postgres 축이 플래그로 갈렸다).

**이 호출을 지웠을 때 값이 갈리는가는 축이 아니라 기전이 정한다**(CLAUDE.md §6-2 1). 같은 DB 를 기동이
먼저 채우면 지워도 초록이고(**가려진다**), 채우지 않으면 `tokens` 가 세션 전량 error 로 죽는다.
그래서 양성 대조군을 **곱**으로 세웠다(§6-1: 관계를 세는 목록은 곱으로). 방법: `pytest tests/integration -q`,
잰 트리 = `6ab9f6a` + 이 커밋의 두 파일, **각 칸 N=1**, 변이는 한 자리씩 + 심기 직전의 작업 트리 사본과
`diff`(§6-2 규칙 5 — 이 커밋이 처음 넣는 줄을 지우는 변이라 `git diff` 는 침묵한다). 「기동 시드
무동작」은 이 파일 안에서 `services.api.main.seed_dev_users` 를 한 줄로 치환한 것이다(작업 3 뒤의
트리를 흉내낸다 — 남의 트리를 편집하지 않는다):

| # | 기동 시드 | 이 픽스처의 `seed_all` | sqlite 축 | postgres 축 |
|---|---|---|---|---|
| 1 | 돈다 | 부른다 | **226 passed** | **226 passed** (188/1/187) |
| 2 | 돈다 | **지움** | **226 passed** ← **가려진다** | 해당 없음(아래 참고) |
| 3 | 무동작 | 부른다 | **226 passed** | 해당 없음 |
| 4 | 무동작 | **지움** | **2 failed, 32 passed, 192 errors** | **2 failed, 32 passed, 193 errors** |

**postgres 축에는 2·3행이 없다.** 이 파일이 그 플래그 환경변수를 더 이상 주지 않으므로 그 축의 기동 조건은
이미 `False` 라, 그 축에서 `seed_all` 을 지운 실행이 곧 4행이다(실측한 것이 그 칸이다 —
193 errors 는 sqlite 4행보다 하나 많다 — 두 실행의 ERROR·FAILED 목록을 `comm` 으로 갈라 보니
차이는 정확히 한 줄, postgres 축에서만 도는
`test_99_db_axis_contract.py::test_a_below_floor_postgres_session_stays_red_and_says_the_real_count`
다).
**그러므로 가려지지 않는 대조군은 흉내가 아니라 postgres 축의 이 트리 자신이다.** sqlite 축의 2행이
이 사이클에서 「시드 호출만 지우는 변이가 안 죽는다」로 관측되는 자리이고, 3행은 **작업 3 이 들어온
뒤에도 이 배선이 혼자 선다**는 것을 미리 값으로 보인 것이다.
4행의 빨간 둘: `test_01_auth.py::test_login_accepts_email_field` ·
`test_99_db_axis_contract.py::test_axis_mode_matches_the_environment`.

다른 테스트 트리(tests/e2e 등)도 같은 프로세스에서 DATABASE_URL 을 바꾸므로, import 시점이 아니라 `client` 픽스처 안에서
경로를 정해야 서로의 DB 를 공유하지 않는다(bim_objects PK 는 전역이라 같은 IFC 를 두 프로젝트에 올리면 충돌).
세션 범위 픽스처가 한 프로젝트를 만들고 IFC → DXF → 공정표를 순서대로 올린다(파일명 숫자 접두사로 실행 순서 고정).
"""
from __future__ import annotations

import json
import os
import secrets
import shutil
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from packages.core.db import get_engine, init_db, reset_engine, session_scope
from packages.core.settings import settings
from services.api.auth.seed import DEV_SEED_PROJECT_ID
from services.api.seed import seed_all
from services.common.celery_app import celery_app
from tests.helpers import postgres_axis as axis

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
ROLES = ("contractor", "cm", "client", "admin")
DEV_PASSWORD = "buildtwin"

#: 축은 수집 시점에 정해진다 — `client` 를 쓰지 않는 세션에서도 강제 셋이 자기 모드를 안다.
RECORDER = axis.AxisRecorder(postgres_url=axis.resolve_axis(os.environ))
_ENV_KEYS = ("DATABASE_URL", "STORAGE_ROOT", "CELERY_ALWAYS_EAGER", "JWT_SECRET")


def load_fixture_json(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


@pytest.fixture(scope="session", autouse=True)
def db_axis_contract():
    """ADR 0014 §2-5 강제 셋. **postgres 모드에서만** 값을 쓰고 단언한다(계약 3 = sqlite 모드 무동작).

    **이 파이널라이저가 `check_contract` 를 실제로 부르는지**는 `test_99_db_axis_contract.py::
    test_the_finalizer_actually_calls_the_axis_contract` 가 하위 프로세스 pytest 로 붙든다 — 호출만
    지우면 통합 전량이 두 축 다 초록이다(리뷰어 실측, 계획 0009 §M-5 28).

    autouse 세션 픽스처라 `tests/integration` 의 어떤 부분집합을 돌려도 teardown 에서 반드시 실행된다 —
    별도 테스트 파일에 두면 "그 파일을 빼고 돌린다"로 우회되고, 그 우회가 바로 이 계약이 겨냥한 모양이다.
    실패는 teardown ERROR 로 보고된다(계획 0009 §2-b 가 소유자 판단으로 남긴 선택지 중 이쪽을 골랐다).
    """
    yield RECORDER
    if not RECORDER.is_postgres:
        # 계약 3 은 "아무 일도 안 일어났다"라 **세션 끝에서** 확인해야 한다 — 테스트 안에서만 비교하면
        # teardown 에 있는 쓰기가 비교보다 뒤라 그 변이가 살아남는다(작업 6 실측 M9).
        # 누적 관측(engines·tests_on_postgres)의 무동작도 같은 이유로 여기다(ADR 0017 결정 1) — 예전에는
        # `test_99` 가 그 둘을 테스트 함수 안에서 읽었고, 그래서 그 파일 단독 실행이 빨갰다(§후속 37).
        axis.check_sqlite_axis_is_inert(dialect=RECORDER.dialect, engines=RECORDER.engines,
                                        tests_on_postgres=RECORDER.tests_on_postgres)
        axis.check_sqlite_noop(measured_now=axis.current_measured_bytes(), measured_at_import=axis.MEASURED_AT_IMPORT)
        return
    floor = axis.read_floor(axis.INTEGRATION_TREE)
    # **바닥값을 만족한 실행만 쓴다**(계획 0011 §후속 29 ⓑ). 예전에는 무조건 썼고, 그래서 부분집합을
    # postgres 축으로 돌릴 때마다 저장소 파일이 그 부분집합의 값으로 덮인 채 남았다. 판정 축이 호출
    # 형태(`-k`·`--deselect`)가 아닌 이유는 실측이다 — 플래그 0개로 경로만 좁힌 실행이 파일을 14 로
    # 덮었다(잰 트리 `f101001`, 포트 55435). **단언 둘은 게이트 밖이다**: 게이트하는 것은 쓰기뿐이고,
    # 바닥값 미달 실행은 그대로 teardown 에서 빨개진다.
    if axis.should_write_measured(tests_on_postgres=RECORDER.tests_on_postgres, floor=floor):
        axis.write_measured(RECORDER, floor)
    axis.check_contract(dialect=RECORDER.dialect, engines=RECORDER.engines,
                        tests_on_postgres=RECORDER.tests_on_postgres, floor=floor)


def pytest_terminal_summary(terminalreporter) -> None:
    """축 측정값을 **잡 로그 한 줄**로 남긴다(리뷰 M1). 파일은 다운로드해야 보인다.

    자리가 `db_axis_contract` 파이널라이저가 **아닌** 이유는 실측이다: 세션 픽스처 teardown 의 `print` 는
    pytest 가 캡처해 **초록 실행에서 통째로 버린다**(이 트리에서 확인 — postgres 전량 `pytest -q` 로그에
    그 줄이 나오지 않았다). `pytest_terminal_summary` 는 성공·실패·teardown ERROR 어느 쪽이든 찍힌다.

    *이 훅이 **찍히는지**를 붙드는 자리*: `tests/integration/test_99_db_axis_contract.py::
    test_the_terminal_summary_hook_actually_prints_the_axis_line`. 줄의 **내용**은 같은 파일의
    `test_report_line_carries_every_field_the_ci_log_needs` 가 붙든다. 훅이 없으면 두 축 모두
    **초록인 채 `[db-axis]` 줄만 사라지므로**(리뷰어 실측, 계획 0009 §M-5 28), 붙드는 유일한 길은
    이 배선을 import 한 세션을 **하위 프로세스**로 돌려 출력을 읽는 것이다 — test_99 가 그 기구를 갖는다.
    파이널라이저의 `check_contract` 호출도 같은 기구가 붙든다(`test_the_finalizer_actually_calls_...`).
    """
    line = axis.report_line(axis.measured_report(RECORDER, axis.read_floor(axis.INTEGRATION_TREE))) if RECORDER.is_postgres \
        else axis.sqlite_log_line()
    terminalreporter.write_line(line)


@pytest.fixture(autouse=True)
def _record_test_on_axis():
    """이 테스트가 축 엔진 위에서 SQL 을 실행했는가. sqlite 모드에서는 리스너가 없어 항상 0 이다."""
    RECORDER.begin_test()
    yield
    RECORDER.end_test()


@pytest.fixture(scope="session")
def client():
    tmp = Path(tempfile.mkdtemp(prefix="buildtwin-api-"))
    previous = {k: os.environ.get(k) for k in _ENV_KEYS}
    prior_settings = (settings.database_url, settings.storage_root, settings.celery_always_eager,
                      settings.jwt_secret)
    schema: str | None = None
    if RECORDER.is_postgres:
        assert RECORDER.postgres_url is not None
        schema = axis.new_schema_name()
        axis.create_schema(RECORDER.postgres_url, schema)
        os.environ["DATABASE_URL"] = axis.schema_url(RECORDER.postgres_url, schema)
        os.environ["JWT_SECRET"] = secrets.token_urlsafe(32)   # 세션 난수. 코드 상수 금지(§3-4)
        settings.jwt_secret = os.environ["JWT_SECRET"]
    else:
        os.environ["DATABASE_URL"] = f"sqlite:///{(tmp / 'api-test.db').as_posix()}"
    os.environ["STORAGE_ROOT"] = str(tmp / "storage")
    os.environ["CELERY_ALWAYS_EAGER"] = "1"
    settings.database_url, settings.storage_root, settings.celery_always_eager = os.environ["DATABASE_URL"], os.environ["STORAGE_ROOT"], True
    celery_app.conf.task_always_eager = True
    celery_app.conf.task_eager_propagates = True
    reset_engine()
    init_db(settings.database_url)
    if RECORDER.is_postgres:
        engine = get_engine()
        RECORDER.observe_engine(engine)
        event.listen(engine, "before_cursor_execute", lambda *a, **kw: RECORDER.note_sql())
    # **명시 시드**(ADR 0018 §2-1·§2-2). 명령(`python -m services.api.seed`)이 아니라 in-process 함수인
    # 이유는 이 픽스처가 **이미 이 세션의 엔진을 쥐고 있기** 때문이다 — 하위 프로세스로 부르면 postgres
    # 축의 세션 스키마(`search_path`)와 위 RECORDER 리스너를 그 프로세스에 다시 세워야 하고, 그 배선이
    # 어긋나도 sqlite 축에서는 초록이라 숨는다. 명령이 필요한 자리는 부모가 `settings` 를 만져도 닿지
    # 않는 하위 프로세스뿐이다(`tests/e2e` 의 `api_server`).
    with session_scope() as s:
        created, demo_project = seed_all(s)
    # 픽스처가 **자기 전제를 말한다**(ADR 0018 §4 4): 이 세션의 계정은 위 한 줄이 만든 것이다.
    # 이 단언은 `create_app()` 앞이라, 누군가 순서를 뒤집어 기동이 먼저 채우면 `created` 가 비어 빨개진다.
    assert sorted(u.role for u in created) == sorted(ROLES), created
    assert demo_project is not None and demo_project.project_id == DEV_SEED_PROJECT_ID

    from services.api.main import create_app

    app = create_app()
    with TestClient(app) as c:
        yield c
    reset_engine()
    if schema is not None and RECORDER.postgres_url is not None:
        axis.drop_schema(RECORDER.postgres_url, schema)
    for k, v in previous.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    (settings.database_url, settings.storage_root, settings.celery_always_eager,
     settings.jwt_secret) = prior_settings
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


def add_member(client, admin_headers: dict[str, str], project_id: str, user_id: str, role: str) -> None:
    r = client.post(f"/api/projects/{project_id}/members", headers=admin_headers, json={"user_id": user_id, "role": role})
    assert r.status_code == 201, r.text


@pytest.fixture(scope="session")
def user_ids(client, auth) -> dict[str, str]:
    """role → user_id(시드 계정). ADR 0006 멤버십 부여에 필요하다."""
    out: dict[str, str] = {}
    for role in ROLES:
        r = client.get("/api/auth/me", headers=auth(role))
        assert r.status_code == 200, r.text
        out[role] = r.json()["user_id"]
    return out


@pytest.fixture(scope="session")
def project(client, auth, user_ids) -> str:
    """ADR 0006: 멤버십 행이 접근권을 정의한다 — contractor/cm/client 를 이름과 같은 프로젝트 역할로 멤버십을
    준다(admin 은 멤버십 없이 조회만 가능하므로 추가하지 않는다). 이후 테스트 전체가 이 세 계정을
    '이 프로젝트의 그 역할'로 다룬다는 가정을 그대로 쓸 수 있다."""
    r = client.post("/api/projects", headers=auth("admin"), json={"name": "통합 테스트 현장"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "통합 테스트 현장" and body["project_id"]
    project_id = body["project_id"]
    for role in ("contractor", "cm", "client"):
        add_member(client, auth("admin"), project_id, user_ids[role], role)
    return project_id


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
