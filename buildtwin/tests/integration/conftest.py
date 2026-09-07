"""API 통합 테스트 공용 픽스처. 세션 시작 시(픽스처 시점에) 전용 DB/저장소를 만들고 엔진을 재설정한다.

**DB 는 축이다**(ADR 0014 §2-2): `BUILDTWIN_CI_POSTGRES_URL` 이 설정돼 있고 비어 있지 않으면 그
PostgreSQL + 세션 전용 스키마(`search_path`, 끝나면 `DROP SCHEMA … CASCADE`), 아니면 전용 임시 SQLite 다.
CI 는 두 갈래를 둘 다 돈다(`.github/workflows/buildtwin-ci.yml` 의 `integration` 잡, 스텝 둘).
postgres 갈래에서는 이 파일이 `JWT_SECRET`(세션 난수)과 `SEED_DEV_DATA` 를 함께 준다 — 앞은
`settings.resolve_jwt_secret` 의 non-sqlite 갈래가 §3-4 대로 기동을 거부하기 때문이고(ADR 0014 §2-3 3),
뒤는 `services/api/main.py` 의 시드 조건이 sqlite 가 아니면 사용자를 0명 만들어 로그인이 **조용히 401** 이
되기 때문이다(ADR 0014 §2-3 4).

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

from packages.core.db import get_engine, init_db, reset_engine
from packages.core.settings import settings
from services.common.celery_app import celery_app
from tests.helpers import postgres_axis as axis

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
ROLES = ("contractor", "cm", "client", "admin")
DEV_PASSWORD = "buildtwin"

#: 축은 수집 시점에 정해진다 — `client` 를 쓰지 않는 세션에서도 강제 셋이 자기 모드를 안다.
RECORDER = axis.AxisRecorder(postgres_url=axis.resolve_axis(os.environ))
_ENV_KEYS = ("DATABASE_URL", "STORAGE_ROOT", "CELERY_ALWAYS_EAGER", "JWT_SECRET", "SEED_DEV_DATA")


def load_fixture_json(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


@pytest.fixture(scope="session", autouse=True)
def db_axis_contract():
    """ADR 0014 §2-5 강제 셋. **postgres 모드에서만** 값을 쓰고 단언한다(계약 3 = sqlite 모드 무동작).

    autouse 세션 픽스처라 `tests/integration` 의 어떤 부분집합을 돌려도 teardown 에서 반드시 실행된다 —
    별도 테스트 파일에 두면 "그 파일을 빼고 돌린다"로 우회되고, 그 우회가 바로 이 계약이 겨냥한 모양이다.
    실패는 teardown ERROR 로 보고된다(계획 0009 §2-b 가 소유자 판단으로 남긴 선택지 중 이쪽을 골랐다).
    """
    yield RECORDER
    if not RECORDER.is_postgres:
        # 계약 3 은 "아무 일도 안 일어났다"라 **세션 끝에서** 확인해야 한다 — 테스트 안에서만 비교하면
        # teardown 에 있는 쓰기가 비교보다 뒤라 그 변이가 살아남는다(작업 6 실측 M9).
        axis.check_sqlite_noop(measured_now=axis.current_measured_bytes(), measured_at_import=axis.MEASURED_AT_IMPORT)
        return
    floor = axis.read_floor()
    axis.write_measured(RECORDER, floor)   # 단언 전에 쓴다 — 실패해도 드리프트가 diff 로 보이도록
    axis.check_contract(dialect=RECORDER.dialect, tests_on_postgres=RECORDER.tests_on_postgres, floor=floor)


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
                      settings.jwt_secret, settings.seed_dev_data)
    schema: str | None = None
    if RECORDER.is_postgres:
        assert RECORDER.postgres_url is not None
        schema = axis.new_schema_name()
        axis.create_schema(RECORDER.postgres_url, schema)
        os.environ["DATABASE_URL"] = axis.schema_url(RECORDER.postgres_url, schema)
        os.environ["JWT_SECRET"] = secrets.token_urlsafe(32)   # 세션 난수. 코드 상수 금지(§3-4)
        os.environ["SEED_DEV_DATA"] = "1"
        settings.jwt_secret, settings.seed_dev_data = os.environ["JWT_SECRET"], True
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
     settings.jwt_secret, settings.seed_dev_data) = prior_settings
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
