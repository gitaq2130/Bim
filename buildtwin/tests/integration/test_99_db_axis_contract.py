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

**배선 둘은 이제 이 파일이 잡는다**(계획 0010 작업 5, 계획 0009 §M-5 28). 그 둘은 순수 함수 단언으로는
잡히지 않는다 — 함수가 **아무 데서도 불리지 않아도** 위 표의 모든 함수가 초록이기 때문이다. 그래서
저장소의 배선을 그대로 import 한 세션을 **자식 pytest** 로 돌리고 종료코드·출력을 읽는다:

| 지우는 것 | 죽이는 함수 | 지운 트리의 실행값 |
|---|---|---|
| `conftest.db_axis_contract` 파이널라이저의 `check_contract(...)` **호출** | `test_the_finalizer_actually_calls_the_axis_contract` | 이 파일 **1 failed, 18 passed**(그 한 함수만) |
| `conftest.pytest_terminal_summary` **훅 통째** | `test_the_terminal_summary_hook_actually_prints_the_axis_line` | 이 파일 **1 failed, 18 passed**(그 한 함수만) |

*그래도 이 파일이 **못** 잡는 것* — 여기 적는다, 다른 문서를 가리키지 않는다:

1. **자식을 돌리는 것 자체를 지우는 변이.** 이 파일에서 `wiring_child` 와 그것을 읽는 셋을 통째로
   지우면 아무 테스트도 죽지 않는다. **축을 바꾸면 무주공산은 없어지지 않고 자리를 옮긴다**
   (CLAUDE.md §6-3 9회차) — 계획 0009 §M-5 28 이 이 재귀를 이미 이름 붙였고, 이 사이클은 그것을
   **알고** 연다.
2. **바닥값 파일의 값 자체**. `test_floor_file_declares_a_positive_integer` 는 `> 0` 만 보고, 위 두
   실패 테스트는 `read_floor()` 가 아니라 **지어낸 값**을 쓴다(축과 무관하게 순수 함수만 태우려고
   일부러 그렇게 했다). 그래서 바닥값을 낮추는 변경은 아무 테스트도 죽이지 않는다 —
   그 한계와 실측은 `tests/postgres.floor.json` 의 `_comment` (3) 에 있다.
3. **자식이 CI 러너에서 얼마를 더하는가.** 로컬에서만 쟀다(계획 0010 §확인하지 않은 것 24).
   로컬 실측(잰 트리 `f6ad00e`, 각 N=2): 이 파일 단독 **2.56 / 2.59s** ↔ 아래 셋을 `--deselect` 하면
   **0.89 / 0.90s** = **+≈1.7s**. 리뷰어가 같은 트리에서 기구를 **삭제**해 잰 값은 4.46/4.17s ↔
   2.90/2.92s = **+≈1.3s** 였다 — 절대값이 다른 것은 부하 차이이고, 두 방법 다 **+1~2초** 대다.
   **CI 러너(`postgis/postgis:16-3.4`)에서는 재지 않았다.**
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

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
    with pytest.raises(AssertionError, match="달라졌다"):
        axis.check_sqlite_noop(measured_now=b"rewritten", measured_at_import=b"committed")
    with pytest.raises(AssertionError, match="달라졌다"):
        axis.check_sqlite_noop(measured_now=b"created", measured_at_import=None)

    # 문구는 **관측한 것만** 말한다(CLAUDE.md §6-4 2, 계획 0009 §후속 22). 문장을 통째로 베끼지 않고
    # (베끼면 다음 정정이 이 계약을 깨는 대신 거짓 문구를 고정한다 — §6-4 3), 그 상황에서 **참일 수
    # 없는 말이 없다**를 단언한다: 이 함수는 두 스냅샷의 차이만 보고 누가 썼는지는 보지 않는다.
    with pytest.raises(AssertionError) as caught:
        axis.check_sqlite_noop(measured_now=b"rewritten", measured_at_import=b"committed")
    message = str(caught.value)
    assert axis.MEASURED_PATH.name in message
    assert "관측하지 않았다" in message, message


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
        # 문구는 **관측한 것만** 말한다 — 이 실행 전후로 파일이 달라졌다. 쓴 주체(이 실행인가, 밖에서
        # 고친 사람인가)는 관측하지 않았으므로 지목하지 않는다(CLAUDE.md §6-4 2, 계획 0009 §후속 22).
        assert now == axis.MEASURED_AT_IMPORT, \
            "sqlite 축 실행의 전후로 postgres.measured.json 이 달라졌다 — 쓴 주체는 관측하지 않았다 (ADR 0014 §2-5 3)"


# ------------------------------------------------------------------ 강제 셋의 **배선** (하위 프로세스 pytest)
# 위 함수들은 `postgres_axis` 의 **순수 함수**를 태운다. 그 함수들이 아무 데서도 **불리지 않아도**
# 전부 초록이다 — 그것이 계획 0009 §M-5 28 이 번호를 준 공백이고(이 파일 머리말이 "못 잡는 것 둘"로
# 적어 두던 자리), 아래 넷이 그 공백을 닫는다. 붙드는 방법은 **자식 pytest 한 번**이다:
# 저장소의 배선 둘(`db_axis_contract` 파이널라이저 · `pytest_terminal_summary` 훅)을 **그대로 import 한**
# 세션을 자식 프로세스로 돌리고, 부모가 자식의 종료코드와 출력을 단언한다. DB 에는 붙지 않는다.
REPO_ROOT = Path(__file__).resolve().parents[2]
CHILD_MEASURED_ENV = "BUILDTWIN_CHILD_MEASURED"
#: 자식이 축을 **켜진 것으로** 읽게 하는 값. 연결은 일어나지 않는다(자식에 `client` 를 쓰는 테스트가 없다).
CHILD_PG_URL = "postgresql://buildtwin@127.0.0.1:1/no_such_database"

CHILD_CONFTEST = '''"""자식 pytest 의 conftest — **저장소의 배선을 그대로 import 해서** 태운다.

여기서 새로 정의하는 것은 하나도 없다: `db_axis_contract`(파이널라이저 안의 `check_contract` 호출)와
`pytest_terminal_summary`(축 한 줄) 둘 다 `tests/integration/conftest.py` 의 것이고, 그 둘 중 하나가
지워지면 이 자식 세션의 종료코드 또는 출력이 달라진다.

측정 파일은 부모가 준 tmp 로 돌린다 — 자식이 저장소의 `tests/postgres.measured.json` 을 덮으면
그 자체가 트리를 더럽힌다(계획 0010 §후속 29).
"""
import os
import pathlib

from tests.helpers import postgres_axis as axis

axis.MEASURED_PATH = pathlib.Path(os.environ["BUILDTWIN_CHILD_MEASURED"])

import tests.integration.conftest as parent  # noqa: E402
from tests.integration.conftest import RECORDER, db_axis_contract  # noqa: E402,F401

# 훅은 **있으면** 다시 내건다. `from … import pytest_terminal_summary` 로 적으면 훅을 지운 트리에서
# 자식이 **수집 오류**로 죽어, 부모의 세 단언이 전부 같은 이유로 빨개진다 — 그러면 배선 ②의 실제
# 모양(*"두 축 다 초록인 채 `[db-axis]` 줄만 사라진다"*, 계획 0009 §M-5 28)이 재현되지 않는다.
if hasattr(parent, "pytest_terminal_summary"):
    pytest_terminal_summary = parent.pytest_terminal_summary

assert RECORDER.is_postgres, "부모가 축 이름을 실어 보내지 않았다"
'''

CHILD_TEST = '''def test_child_session_does_nothing_but_end():
    """자식은 아무것도 하지 않는다 — 재는 것은 **세션의 끝**에서 배선이 무엇을 하는가다."""
'''


@pytest.fixture(scope="module")
def wiring_child(tmp_path_factory) -> subprocess.CompletedProcess:
    """배선 둘을 import 한 자식 pytest 를 **한 번** 돌리고 결과를 아래 셋이 나눠 읽는다.

    자식의 축은 켜져 있고(`CHILD_PG_URL`) 엔진은 하나도 관측되지 않으므로 `RECORDER.dialect is None`
    이다 — 그래서 배선 ①(`check_contract` 호출)이 살아 있으면 파이널라이저가 계약 ①에서 죽고 세션이
    **teardown ERROR** 로 끝난다. 호출을 지우면 그 자리가 조용히 초록이 된다(리뷰어 실측, 계획 0009
    §M-5 28). 두 상태가 **자식의 종료코드**로 갈린다.

    *이 기구 자신의 무보호 자리*(CLAUDE.md §6-3 9회차 — 축을 바꾸면 무주공산은 자리를 옮긴다):
    ① 이 픽스처가 자식을 **부르지 않게** 되면(예: 상수 `CHILD_*` 를 지우면) 아래 셋이 수집 오류로
    죽으므로 그것까지는 붙들린다. ② 그러나 **부모가 자식을 돌리는 것 자체**를 지우는 변이(이 파일에서
    아래 넷을 통째로 삭제)는 어느 테스트도 죽이지 않는다 — 그 자리를 붙드는 기구는 이 저장소에 없고,
    같은 종류의 재귀는 계획 0009 §M-5 28 이 이미 이름 붙였다. ③ 자식의 `pytest` 는 부모와 같은
    인터프리터·같은 트리를 쓰므로 **CI 러너에서 얼마를 더하는지는 재지 않았다**(계획 0010
    §확인하지 않은 것 24).
    """
    work = tmp_path_factory.mktemp("axis-wiring")
    (work / "conftest.py").write_text(CHILD_CONFTEST, encoding="utf-8")
    (work / "test_child_session.py").write_text(CHILD_TEST, encoding="utf-8")
    env = dict(os.environ)
    env["PYTHONPATH"] = str(REPO_ROOT)
    env[axis.ENV_NAME] = CHILD_PG_URL
    env[CHILD_MEASURED_ENV] = str(work / "measured.json")
    return subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "--tb=short", str(work)],
        cwd=str(REPO_ROOT), env=env, capture_output=True, text=True, timeout=300, check=False)


def test_the_child_session_ran_at_all(wiring_child):
    """음성 대조군 — 자식이 수집조차 못 했다면 아래 둘은 아무것도 말하지 않는다.

    이 칸이 없으면 *"import 가 깨져서 빨갛다"* 와 *"배선이 살아 있어서 빨갛다"* 가 구별되지 않는다
    (CLAUDE.md §6-2 1: 결함 있는 코드가 그대로 만족하는 기대값을 세우지 않는다).
    """
    out = wiring_child.stdout + wiring_child.stderr
    assert "1 passed" in out, out


def test_the_finalizer_actually_calls_the_axis_contract(wiring_child):
    """배선 ① — 파이널라이저의 `check_contract(...)` **호출**. 지우면 자식이 초록으로 끝난다.

    종료코드만 보지 않고 **어느 자리에서 죽었는지**도 본다(§6-2 4): 종료코드 하나만 고정하면 자식이
    다른 이유로 죽어도 초록이라 배선을 붙들지 못한다. 문구를 통째로 베끼지 않고 **심볼 이름**으로
    본다 — 메시지가 바뀌어도 배선이 살아 있으면 초록이어야 한다(§6-4 3).
    """
    out = wiring_child.stdout + wiring_child.stderr
    assert wiring_child.returncode != 0, out
    assert "check_contract" in out, out
    assert "error" in out.strip().splitlines()[-1], out


def test_the_terminal_summary_hook_actually_prints_the_axis_line(wiring_child):
    """배선 ② — `pytest_terminal_summary` 훅. 통째로 지우면 두 축 다 초록인 채 `[db-axis]` 줄만
    조용히 사라진다(리뷰어 실측, 계획 0009 §M-5 28). 형제 함수
    `test_report_line_carries_every_field_the_ci_log_needs` 는 그 줄의 **내용**을 붙들지만
    **찍히는지**는 붙들지 못한다 — 이 함수가 그 자리다.
    """
    out = wiring_child.stdout + wiring_child.stderr
    printed = [ln for ln in out.splitlines() if ln.startswith(axis.LOG_PREFIX)]
    assert len(printed) == 1, out
    # 자식의 측정 파일은 부모가 준 tmp 라 **이름이 다르다** — 그래서 파일 이름이 아니라 `report_line`
    # 이 싣는 **필드가 다 있는가**를 본다(형제 함수가 그 목록의 정본이다).
    for field in ("dialect=", "server_version=", "tests_on_postgres=", "engines=", "floor=", "measured_file="):
        assert field in printed[0], (field, printed[0])
