"""DB 축(ADR 0014 §2-2)과 강제 셋(§2-5) 자신의 계약 — 담당: qa.

**강제 장치가 무보호면 그것이 §후속 10 이 겨냥한 결함의 재생산이다.** 그래서 이 파일은 통합 스위트가
무엇을 하는지가 아니라 **축과 강제 셋이 무엇을 하는지**를 붙든다. 아래 함수 하나하나가 대응하는 변이:

| 지우는 것 | 죽이는 함수 |
|---|---|
| `check_contract` 의 `dialect == "postgresql"` 단언 | `test_contract_fails_when_the_dialect_is_not_postgresql` |
| `check_contract` 의 바닥값 단언 | `test_contract_fails_when_tests_on_postgres_is_below_the_floor` |
| `check_sqlite_noop` 의 단언 | `test_sqlite_noop_check_fails_when_the_measured_file_changed` |
| conftest 의 measured 쓰기를 축과 무관하게 만드는 것 | conftest 파이널라이저의 `check_sqlite_noop` 호출(세션 끝) |
| `report_line` 에서 필드를 빼는 것 | `test_report_line_carries_every_field_the_ci_log_needs` |
| `sqlite_log_line` 에서 축 표시를 빼는 것 | `test_sqlite_log_line_says_the_axis_is_off_and_names_nothing_written` |
| `resolve_axis` 의 빈 문자열 처리(`is not None` 으로 짜기) | `test_axis_is_off_when_the_name_is_empty` |
| `with_psycopg_driver` 의 드라이버 정규화 | `test_axis_normalizes_the_bare_postgresql_driver` |
| `schema_url` 의 `search_path` | `test_schema_url_carries_the_session_schema` |
| `db_axis_contract` 픽스처의 `autouse=True` | `test_the_contract_fixture_runs_for_every_integration_test` |

**두 축 모두에서 돈다.** `test_axis_mode_matches_the_environment` 하나가 sqlite 축과 postgres 축에
서로 다른 단언을 세운다 — sqlite 축의 단언이 이 사이클의 음성 대조군이다(강제 셋이 로컬에서
**아무것도 하지 않는다**는 것을 붙들지 않으면 그 무동작이 조용히 깨진다, ADR 0014 §2-5 3).
`skip` 을 쓰지 않는 것은 의도다 — skip 은 이 저장소가 싫어하는 "조용히 죽은 자리"의 모양이다.

*강제 셋 자신에 대해 이 파일이 **못** 잡는 것 둘* — 여기 적는다, 다른 문서를 가리키지 않는다:

1. `conftest.db_axis_contract` 파이널라이저에서 `check_contract(...)` **호출 자체**를 지우는 변이.
   정적으로는 초록과 구별되지 않는다(그 변이에 sqlite 전량·postgres 전량 둘 다 통과). 갈리는 자리는
   바닥값을 넘지 못하는 postgres 실행뿐이다 — 실측(잰 트리 = 통합 203건 시점의 작업 트리, `ac9417d`
   직전): `pytest tests/integration/test_01_auth.py` 를 postgres 축으로 돌리면 호출이 있을 때
   **12 passed, 1 error**, 호출을 지우면 **12 passed**(초록).
2. **바닥값 파일의 값 자체**. `test_floor_file_declares_a_positive_integer` 는 `> 0` 만 보고, 위 두
   실패 테스트는 `read_floor()` 가 아니라 **지어낸 값**을 쓴다(축과 무관하게 순수 함수만 태우려고
   일부러 그렇게 했다). 그래서 바닥값을 낮추는 변경은 아무 테스트도 죽이지 않는다 —
   그 한계와 실측은 `tests/postgres.floor.json` 의 `_comment` (3) 에 있다.
"""
from __future__ import annotations

import pytest

from packages.core.settings import settings
from tests.helpers import postgres_axis as axis
from tests.integration.conftest import RECORDER

PG_URL = "postgresql://buildtwin:buildtwin@localhost:5432/buildtwin_test"


# ------------------------------------------------------------------ 축 판정 (양성·음성 둘 다)
def test_axis_is_off_when_the_name_is_absent():
    assert axis.resolve_axis({}) is None


def test_axis_is_off_when_the_name_is_empty():
    """GitHub Actions 는 정의되지 않은 값을 빈 문자열로 export 한다(ADR 0014 §2-2 역방향)."""
    assert axis.resolve_axis({axis.ENV_NAME: ""}) is None
    assert axis.resolve_axis({axis.ENV_NAME: "   "}) is None


def test_axis_is_on_when_the_name_carries_a_url():
    assert axis.resolve_axis({axis.ENV_NAME: PG_URL}) is not None


def test_axis_normalizes_the_bare_postgresql_driver():
    """워크플로가 싣는 값에는 드라이버가 없고, SQLAlchemy 의 기본 드라이버는 이 저장소가 선언하지 않은 psycopg2 다."""
    assert axis.resolve_axis({axis.ENV_NAME: PG_URL}).startswith("postgresql+psycopg://")
    already = "postgresql+psycopg://u:p@h:5432/d"
    assert axis.with_psycopg_driver(already) == already


def test_schema_url_carries_the_session_schema():
    url = axis.schema_url(axis.with_psycopg_driver(PG_URL), "bt_test_1_dead")
    assert "options=-csearch_path%3Dbt_test_1_dead" in url
    assert url.startswith("postgresql+psycopg://")


def test_schema_names_do_not_collide_between_sessions():
    assert axis.new_schema_name() != axis.new_schema_name()


# ------------------------------------------------------------------ 강제 셋 자신 (양성·음성 둘 다)
def test_contract_passes_on_postgres_at_the_floor():
    """음성 대조군 — 옳은 값에서는 아무 일도 없어야 한다(그렇지 않으면 위 두 양성이 무의미하다)."""
    axis.check_contract(dialect="postgresql", tests_on_postgres=191, floor=191)


def test_contract_fails_when_the_dialect_is_not_postgresql():
    """축을 못 읽고 **조용히 sqlite 로 떨어지는 것**이 §후속 10 의 결함 자신이다(ADR 0014 §2-5 1)."""
    with pytest.raises(AssertionError, match="postgresql"):
        axis.check_contract(dialect="sqlite", tests_on_postgres=10_000, floor=191)
    with pytest.raises(AssertionError, match="postgresql"):
        axis.check_contract(dialect=None, tests_on_postgres=10_000, floor=191)


def test_contract_fails_when_tests_on_postgres_is_below_the_floor():
    """**한 개만 붙이고 초록**을 부르는 것을 막는다(ADR 0014 §2-5 2). 초록은 증거가 아니다."""
    with pytest.raises(AssertionError, match="바닥값"):
        axis.check_contract(dialect="postgresql", tests_on_postgres=1, floor=191)
    with pytest.raises(AssertionError, match="바닥값"):
        axis.check_contract(dialect="postgresql", tests_on_postgres=190, floor=191)


def test_sqlite_noop_check_passes_when_the_measured_file_is_untouched():
    """음성 대조군 — 파일이 그대로면 아무 일도 없어야 한다."""
    axis.check_sqlite_noop(measured_now=b"same", measured_at_import=b"same")
    axis.check_sqlite_noop(measured_now=None, measured_at_import=None)


def test_sqlite_noop_check_fails_when_the_measured_file_changed():
    """ADR 0014 §2-5 3. 이 단언이 없으면 "축을 가리지 않고 쓰는" 변이가 sqlite 축에서 **살아남는다**
    (작업 6 실측 M9 — 잰 트리는 통합 203건 시점의 작업 트리(`ac9417d` 직전): 203 passed 인데 파일은 덮여 있었다)."""
    with pytest.raises(AssertionError, match="sqlite 모드가"):
        axis.check_sqlite_noop(measured_now=b"rewritten", measured_at_import=b"committed")
    with pytest.raises(AssertionError, match="sqlite 모드가"):
        axis.check_sqlite_noop(measured_now=b"created", measured_at_import=None)


def test_report_line_carries_every_field_the_ci_log_needs():
    """CI 에서 값의 유일한 출구가 **다운로드해야 보이는 파일**이면 아무도 그 수를 모른다(리뷰 M1).

    네 필드가 다 있어야 두 스텝의 **로그만으로** 축이 갈렸는지 비교된다.
    """
    report = axis.measured_report(axis.AxisRecorder(postgres_url="x", dialect="postgresql",
                                                    server_version="16.13", engines=1,
                                                    tests_on_postgres=181), floor=181)
    line = axis.report_line(report)
    assert line.startswith(axis.LOG_PREFIX)
    for field in ("dialect=postgresql", "server_version=16.13", "tests_on_postgres=181", "engines=1", "floor=181"):
        assert field in line, (field, line)


def test_sqlite_log_line_says_the_axis_is_off_and_names_nothing_written():
    line = axis.sqlite_log_line()
    assert line.startswith(axis.LOG_PREFIX)
    assert "dialect=sqlite" in line and "tests_on_postgres=0" in line and axis.ENV_NAME in line


def test_floor_file_declares_a_positive_integer():
    """파일이 읽히고 수라는 것까지만 본다 — **값이 옳은지는 보지 않는다**(위 머리말 2 의 한계)."""
    floor = axis.read_floor()
    assert isinstance(floor, int) and floor > 0


def test_the_contract_fixture_runs_for_every_integration_test(request):
    """autouse 가 빠지면 부분집합 실행으로 강제를 우회할 수 있다."""
    assert "db_axis_contract" in request.fixturenames


# ------------------------------------------------------------------ 두 축의 실제 모드
def test_axis_mode_matches_the_environment(client):
    """양성(postgres 축)과 음성(sqlite 축)을 같은 테스트 id 로 세운다 — skip 을 만들지 않기 위해서다."""
    if RECORDER.is_postgres:
        assert RECORDER.dialect == "postgresql", RECORDER
        assert RECORDER.engines == 1, RECORDER
        assert settings.database_url.startswith("postgresql+psycopg://")
        assert settings.seed_dev_data is True      # 시드가 `or` 의 **우변**으로 켜졌다(ADR 0014 §2-3 4)
        assert RECORDER.tests_on_postgres > 0, RECORDER
    else:
        assert RECORDER.dialect is None and RECORDER.engines == 0, RECORDER
        assert RECORDER.tests_on_postgres == 0, RECORDER
        assert settings.database_url.startswith("sqlite:")
        assert settings.seed_dev_data is False     # 시드는 `or` 의 **좌변**으로 켜진다 — 축이 넓혀지지 않았다
        now = axis.MEASURED_PATH.read_bytes() if axis.MEASURED_PATH.exists() else None
        assert now == axis.MEASURED_AT_IMPORT, "sqlite 모드가 postgres.measured.json 을 건드렸다 (ADR 0014 §2-5 3)"
