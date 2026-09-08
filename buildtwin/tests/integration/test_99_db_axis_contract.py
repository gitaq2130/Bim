"""DB 축(ADR 0014 §2-2)과 강제 셋(§2-5) 자신의 계약 — 담당: qa.

**강제 장치가 무보호면 그것이 §후속 10 이 겨냥한 결함의 재생산이다.** 그래서 이 파일은 통합 스위트가
무엇을 하는지가 아니라 **축과 강제 셋이 무엇을 하는지**를 붙든다. 아래 함수 하나하나가 대응하는 변이:

| 지우는 것 | 죽이는 함수 |
|---|---|
| `check_contract` 의 `dialect == "postgresql"` 단언 | `test_contract_fails_when_the_dialect_is_not_postgresql` |
| `check_contract` 의 바닥값 단언 | `test_contract_fails_when_tests_on_postgres_is_below_the_floor` |
| `check_sqlite_noop` 의 단언 | `test_sqlite_noop_check_fails_when_the_measured_file_changed` |
| conftest 의 measured 쓰기를 축과 무관하게 만드는 것 | conftest 파이널라이저의 `check_sqlite_noop` 호출(세션 끝) |
| `should_write_measured` 를 항상 **`True`** 로(= 바닥값을 무시하고 **늘 쓴다**) | `test_the_finalizer_does_not_write_below_the_floor_but_still_dies_with_the_count` · `test_the_below_floor_child_left_the_measured_file_alone` |
| `should_write_measured` 를 항상 **`False`** 로(= **아무 때도 안 쓴다**) | `test_the_finalizer_writes_when_the_run_met_the_floor` |
| 게이트를 `check_contract` 호출까지 함께 덮는 것(= 부분집합이 **초록**이 된다) | `test_a_below_floor_postgres_session_stays_red_and_says_the_real_count` |
| `should_write_measured` 가 호출 형태(`-k`·`--deselect`·`argv`)를 읽게 만드는 것 | `test_the_write_gate_is_decided_by_values_not_by_the_call_shape` |
| `report_line` 에서 필드를 빼는 것 | `test_report_line_carries_every_field_the_ci_log_needs` |
| `sqlite_log_line` 에서 축 표시를 빼는 것 | `test_sqlite_log_line_says_the_axis_is_off_and_names_nothing_written` |
| `resolve_axis` 의 빈 문자열 처리(`is not None` 으로 짜기) | `test_axis_is_off_when_the_name_is_empty` |
| `with_psycopg_driver` 의 드라이버 정규화 | `test_axis_normalizes_the_bare_postgresql_driver` |
| `schema_url` 의 `search_path` | `test_schema_url_carries_the_session_schema` |
| `db_axis_contract` 픽스처의 `autouse=True` | `test_the_contract_fixture_runs_for_every_integration_test` |
| `client` 픽스처의 명시 시드가 **축 엔진 밖**에 앉는 것(ADR 0018 §2-1) | `test_axis_mode_matches_the_environment` 의 `users_count` |
| `check_contract` 의 엔진 수 단언(ADR 0017 결정 1 이 여기로 옮긴 것) | `test_the_contract_also_names_the_engine_count` · `test_the_finalizer_dies_when_a_postgres_session_observed_more_than_one_engine` |
| `check_sqlite_axis_is_inert` 의 단언 / 파이널라이저의 그 **호출** | `test_the_sqlite_inert_check_dies_on_any_observation` / `test_the_finalizer_dies_when_a_sqlite_session_observed_anything` |

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
   **닫힌 것은 그 값이 아니라 그 값의 「복창」이다**: 이 파일과 `tests/helpers/postgres_axis.py` ·
   `.github/workflows/buildtwin-ci.yml` 이 바닥값을 산문에 숫자로 적는데, 그 셋이 정본 파일과
   갈리는 것은 이제 `tests/invariants/test_postgres_floor_recitation.py` 가 죽인다(계획 0012 §후속 54).
   **바닥값 자신이 옳은지는 여전히 아무 테스트도 보지 않는다.**
3. **자식이 CI 러너에서 얼마를 더하는가.** 로컬에서만 쟀다(계획 0010 §확인하지 않은 것 24).
   로컬 실측(잰 트리 `f6ad00e`, 각 N=2): 이 파일 단독 **2.56 / 2.59s** ↔ 아래 셋을 `--deselect` 하면
   **0.89 / 0.90s** = **+≈1.7s**. 리뷰어가 같은 트리에서 기구를 **삭제**해 잰 값은 4.46/4.17s ↔
   2.90/2.92s = **+≈1.3s** 였다 — 절대값이 다른 것은 부하 차이이고, 두 방법 다 **+1~2초** 대다.
   **CI 러너(`postgis/postgis:16-3.4`)에서는 재지 않았다.**
   이 커밋이 자식을 **하나 더** 만든다(`below_floor_child`). 같은 방법으로 다시 쟀다(sqlite 축,
   `--deselect` 로 빼고 비교, 각 **N=3**, 잰 트리 = `ac6b30b` + 이 커밋의 변경): 자식 둘 다 포함
   **3.85 / 3.89 / 3.38s** ↔ 새 자식만 빼면 **2.06 / 2.21 / 2.13s** ↔ 자식을 읽는 다섯을 다 빼면
   **0.84 / 0.84 / 0.74s**. 즉 **새 자식 +≈1.6s**, 자식 둘 합쳐 **+≈2.9s**. CI 는 통합을 두 번
   돌므로(sqlite·postgres) 잡이 지는 값은 그 두 배 어림이다 — **CI 러너에서는 여전히 재지 않았다.**
"""
from __future__ import annotations

import ast
import contextlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import select

import tests.integration.conftest as parent_conftest
from packages.core.db import new_session
from packages.core.models.orm import UserRow
from packages.core.settings import settings
from services.api.auth.seed import DEV_SEED_DOMAIN, DEV_SEED_ROLES
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
    axis.check_contract(dialect="postgresql", engines=1, tests_on_postgres=191, floor=191)


def test_contract_fails_when_the_dialect_is_not_postgresql():
    """축을 못 읽고 **조용히 sqlite 로 떨어지는 것**이 §후속 10 의 결함 자신이다(ADR 0014 §2-5 1)."""
    with pytest.raises(AssertionError, match="postgresql"):
        axis.check_contract(dialect="sqlite", engines=1, tests_on_postgres=10_000, floor=191)
    with pytest.raises(AssertionError, match="postgresql"):
        axis.check_contract(dialect=None, engines=1, tests_on_postgres=10_000, floor=191)


def test_contract_fails_when_tests_on_postgres_is_below_the_floor():
    """**한 개만 붙이고 초록**을 부르는 것을 막는다(ADR 0014 §2-5 2). 초록은 증거가 아니다."""
    with pytest.raises(AssertionError, match="바닥값"):
        axis.check_contract(dialect="postgresql", engines=1, tests_on_postgres=1, floor=191)
    with pytest.raises(AssertionError, match="바닥값"):
        axis.check_contract(dialect="postgresql", engines=1, tests_on_postgres=190, floor=191)


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
    floor = axis.read_floor(axis.INTEGRATION_TREE)
    assert isinstance(floor, int) and floor > 0


def test_the_contract_fixture_runs_for_every_integration_test(request):
    """autouse 가 빠지면 부분집합 실행으로 강제를 우회할 수 있다."""
    assert "db_axis_contract" in request.fixturenames


# ------------------------------------------------------- 측정 파일 쓰기 게이트 (계획 0011 §후속 29 ⓑ)
# 예전에는 파이널라이저가 **무조건** 썼고, 그래서 부분집합을 postgres 축으로 돌릴 때마다 저장소의
# `tests/postgres.measured.json` 이 그 부분집합의 값으로 덮인 채 남았다(잰 트리 `f101001`, 포트 55435,
# N=3 — `-k` 만 → `dialect: null · 0 · 0`, 경로+`-k` → `1`, **플래그 0개로 경로만** → `14`).
# 아래 넷이 그 게이트를 붙든다. **센티널이 이 칸들의 핵심이다**: 파일이 이미 실측값이면 "썼다"와
# "안 썼다"가 **같은 바이트**라 구별되지 않는다(CLAUDE.md §6-2 1 이 금지한 고정된 기대값).

#: 자식·파이널라이저에게 주는 측정 파일의 **센티널**. 실측과 다른 값이라야 쓰기가 값으로 갈린다.
SENTINEL = '{"_sentinel": "이 바이트가 그대로면 아무도 이 파일을 쓰지 않았다"}\n'.encode()
AXIS_SRC = Path(axis.__file__)


def test_should_write_measured_is_the_floor_comparison_and_nothing_else():
    """S6 — 순수 함수(계획 0011 §검증 시나리오). DB 없이 D1(항상 쓴다)·D2(안 쓴다)를 죽인다.

    `(200, 181) → True` 칸이 맞바꿈의 한쪽이다: 값이 **오르는** 실행은 그대로 써서 커밋된 값과의
    diff 를 남긴다 — 게이트가 지우는 것은 **내려가는 쪽의 diff** 뿐이다(그 자리는 `[db-axis]` 줄이 잇는다).
    """
    assert axis.should_write_measured(tests_on_postgres=181, floor=181) is True
    assert axis.should_write_measured(tests_on_postgres=200, floor=181) is True
    for below in (0, 1, 14, 180):
        assert axis.should_write_measured(tests_on_postgres=below, floor=181) is False, below


def test_the_write_gate_is_decided_by_values_not_by_the_call_shape():
    """S4 — 호출 형태로는 판정하지 않는다. **경로로만 좁힌 실행에는 `-k` 도 `--deselect` 도 없다.**

    §후속 29 가 처음 적은 `-k`/`--deselect` 축의 구현이 여기서 죽는다. 문자열 grep 대신 **AST** 로
    본다 — 이 파일과 `postgres_axis.py` 의 산문은 그 두 플래그를 *기각된 축*으로 인용하므로 텍스트
    grep 은 자기 문서에 걸린다(그 축의 저장소 루트 전수는 계획 0011 §전수 목록 A ③ 에 있다).
    단언하는 것은 셋이다: 인자가 **키워드 전용 값 둘**뿐이고, `*args`·`**kwargs` 가 없고, 몸통이
    그 둘 밖의 어떤 이름도 읽지 않는다(전역·`config`·`session`·`sys.argv` 가 들어올 자리가 없다).

    *그 전수를 다시 세는 사람에게*: 저장소 루트에서 `config.option` 을 **텍스트로** 세면 `.py` 히트가
    **0 이 아니다** — 오늘 나오는 `.py` 히트는 **전부 이 파일의 산문**(이 문단과 아래 주석)이고 판정에
    쓰는 코드는 하나도 없다. `sys.argv` 도 같아서, 그 `.py` 히트 중 하나는 위 이 함수의 docstring 이다.
    커밋 `98ce2d6` 본문이 그 자리를 *"`config.option` `.py` 히트 0"* 이라 적은 것은 **거짓이었다**
    (리뷰어가 잡았다 — 그 커밋 시점에도 아래 주석이 이미 있었다). 자기 문서에 걸리는 이 모양이 바로
    이 함수가 텍스트 grep 이 아니라 **AST** 로 보는 이유다: 넓힌 목록은 히트 **수**가 아니라 각 히트를
    **읽어서** 거른다(CLAUDE.md §6-1 의 역방향 확인).
    """
    tree = ast.parse(AXIS_SRC.read_text(encoding="utf-8"))
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "should_write_measured")
    assert [a.arg for a in fn.args.kwonlyargs] == ["tests_on_postgres", "floor"]
    assert not fn.args.args and not fn.args.posonlyargs
    assert fn.args.vararg is None and fn.args.kwarg is None
    body = [node for statement in fn.body for node in ast.walk(statement)]   # 시그니처의 타입 이름은 뺀다
    assert {n.id for n in body if isinstance(n, ast.Name)} <= {"tests_on_postgres", "floor"}
    assert not [n for n in body if isinstance(n, ast.Attribute)]             # `config.option` 류가 들어올 자리


def _drive_the_repo_finalizer(monkeypatch, measured: Path, *, dialect: str | None, tests_on_postgres: int,
                              engines: int = 1, postgres_url: str | None = "postgresql+psycopg://x@127.0.0.1:1/nodb") -> None:
    """저장소의 **그 파이널라이저**(`conftest.db_axis_contract`)를 tmp 측정 파일 위에서 한 번 돌린다.

    복사본이 아니라 `__wrapped__` = 그 함수 자신이다 — 게이트를 지우거나 뒤집으면 여기서 값이 갈린다.
    바꾸는 것은 둘뿐이고 `monkeypatch` 가 되돌린다: 측정 파일의 자리(저장소를 더럽히지 않으려고)와
    conftest 의 모듈 전역 `RECORDER`(이 세션의 진짜 계수를 건드리지 않으려고). 파이널라이저는 그
    전역을 **호출 시점에** 읽으므로 이 교체가 곧 그 실행의 관측값이 된다.
    """
    monkeypatch.setattr(axis, "MEASURED_PATH", measured)
    # sqlite 갈래를 돌릴 때는 "이 실행 전"의 스냅샷도 tmp 파일의 것이라야 한다 — 안 그러면 계약 3
    # (`check_sqlite_noop`)이 저장소 파일과 tmp 파일을 비교해 **언제나** 죽고, 그러면 음성 대조군이
    # 성립하지 않는다(§6-2 1).
    if postgres_url is None:
        monkeypatch.setattr(axis, "MEASURED_AT_IMPORT", measured.read_bytes())
    monkeypatch.setattr(parent_conftest, "RECORDER", axis.AxisRecorder(
        postgres_url=postgres_url, dialect=dialect,
        server_version="16.13", engines=engines, tests_on_postgres=tests_on_postgres))
    generator = parent_conftest.db_axis_contract.__wrapped__()
    next(generator)                                   # yield 까지 = 세션 시작
    with contextlib.suppress(StopIteration):
        next(generator)                               # teardown = 게이트와 단언이 도는 자리


def test_the_finalizer_writes_when_the_run_met_the_floor(monkeypatch, tmp_path):
    """S2 — 바닥값을 만족한 실행은 **그대로 쓴다**. D2(아무 때도 안 쓴다)가 여기서 죽는다.

    센티널을 덮어 두고 돌린 뒤 **바이트가 달라졌는가 + 실측값이 들어갔는가**를 본다. 센티널이 없으면
    두 구현이 같은 바이트를 남겨 이 칸이 장식이 된다(§6-2 1).
    """
    floor = axis.read_floor(axis.INTEGRATION_TREE)
    measured = tmp_path / "measured.json"
    measured.write_bytes(SENTINEL)
    _drive_the_repo_finalizer(monkeypatch, measured, dialect="postgresql", tests_on_postgres=floor)
    assert measured.read_bytes() != SENTINEL
    written = json.loads(measured.read_text(encoding="utf-8"))
    assert written["tests_on_postgres"] == floor and written["dialect"] == "postgresql"


def test_the_finalizer_does_not_write_below_the_floor_but_still_dies_with_the_count(monkeypatch, tmp_path):
    """S1 + S3 ⓐⓑ — 바닥값 미달에서 **쓰지 않고**, 그래도 **죽고**, 메시지가 **실제 수**를 싣는다.

    셋을 함께 단언하는 것이 §6-2 2·4 다: "파일이 안 바뀐다"만 보면 쓰기와 단언을 **함께** 덮은 구현
    (D3)이 그대로 통과하고, 그러면 부분집합이 조용히 초록이 된다 — 이 계약이 겨냥한 결함 자신이다.
    문구를 통째로 베끼지 않고 **수 둘**만 본다(§6-4 3).
    """
    floor = axis.read_floor(axis.INTEGRATION_TREE)
    measured = tmp_path / "measured.json"
    measured.write_bytes(SENTINEL)
    with pytest.raises(AssertionError) as caught:
        _drive_the_repo_finalizer(monkeypatch, measured, dialect="postgresql", tests_on_postgres=3)
    assert measured.read_bytes() == SENTINEL
    message = str(caught.value)
    assert "3" in message and str(floor) in message, message


# ------------------------------------------------- 옮겨온 누적 관측 (ADR 0017 결정 1 — 지운 것이 아니다)
# `test_axis_mode_matches_the_environment` 가 테스트 함수 안에서 읽던 `engines`·`tests_on_postgres` 는
# 세션 파이널라이저로 갔다. **「단언을 지웠다」와 「단언을 옮겼다」는 그 자리를 안 보면 같은 출력을 낸다**
# (CLAUDE.md §6-2 1) — 아래 넷이 그 둘을 가른다: 앞 둘은 순수 함수, 뒤 둘은 **저장소의 그 파이널라이저**를
# 직접 돌린다(호출을 지우면 뒤 둘이 죽는다).
def test_the_contract_also_names_the_engine_count():
    """postgres 축의 옮겨온 칸 — 엔진이 하나가 아니면 계약이 죽고, 메시지가 **실제 수**를 싣는다."""
    floor = axis.read_floor(axis.INTEGRATION_TREE)
    axis.check_contract(dialect="postgresql", engines=1, tests_on_postgres=floor, floor=floor)   # 양성
    for engines in (0, 2):
        with pytest.raises(AssertionError) as caught:
            axis.check_contract(dialect="postgresql", engines=engines, tests_on_postgres=floor, floor=floor)
        assert str(engines) in str(caught.value), (engines, str(caught.value))


def test_the_sqlite_inert_check_dies_on_any_observation():
    """sqlite 축의 옮겨온 칸 — 셋 중 **하나만** 움직여도 죽는다(축이 조용히 넓어지는 모양)."""
    axis.check_sqlite_axis_is_inert(dialect=None, engines=0, tests_on_postgres=0)                # 양성
    for kwargs in ({"dialect": "sqlite"}, {"engines": 1}, {"tests_on_postgres": 1}):
        base = {"dialect": None, "engines": 0, "tests_on_postgres": 0} | kwargs
        with pytest.raises(AssertionError):
            axis.check_sqlite_axis_is_inert(**base)


def test_the_finalizer_dies_when_a_postgres_session_observed_more_than_one_engine(monkeypatch, tmp_path):
    """배선 — 저장소의 파이널라이저가 그 엔진 수를 **실제로 읽는다**. 인자를 빼면 여기서 죽는다.

    바닥값은 만족시켜 놓는다 — 그래야 죽는 이유가 엔진 수 하나로 갈린다(§6-2 1: 결함이 있으면 값이
    달라지는 배역). 파일은 센티널 그대로여야 한다(쓰기는 게이트 뒤가 아니라 단언 앞이므로 이 칸은
    "썼는데 죽었다"가 아니라 "썼고 죽었다"를 구별하지 않는다 — 그 구별은 형제 둘이 한다).
    """
    floor = axis.read_floor(axis.INTEGRATION_TREE)
    measured = tmp_path / "measured.json"
    measured.write_bytes(SENTINEL)
    with pytest.raises(AssertionError) as caught:
        _drive_the_repo_finalizer(monkeypatch, measured, dialect="postgresql", tests_on_postgres=floor, engines=3)
    assert "3" in str(caught.value), str(caught.value)


def test_the_finalizer_dies_when_a_sqlite_session_observed_anything(monkeypatch, tmp_path):
    """배선 — sqlite 갈래의 무동작 단언도 파이널라이저가 **실제로 부른다**.

    음성 대조군이 같은 함수에 있다: 아무것도 관측하지 않은 sqlite 세션은 조용히 지나가고 파일도 그대로다.
    그 칸이 없으면 이 테스트는 "언제나 죽는 배선"과 구별되지 않는다.
    """
    measured = tmp_path / "measured.json"
    measured.write_bytes(SENTINEL)
    _drive_the_repo_finalizer(monkeypatch, measured, dialect=None, tests_on_postgres=0,
                              engines=0, postgres_url=None)                      # 음성 대조군
    assert measured.read_bytes() == SENTINEL
    with pytest.raises(AssertionError) as caught:
        _drive_the_repo_finalizer(monkeypatch, measured, dialect=None, tests_on_postgres=2,
                                  engines=1, postgres_url=None)
    assert "engines=1" in str(caught.value) and "tests_on_postgres=2" in str(caught.value), str(caught.value)
    assert measured.read_bytes() == SENTINEL


# ------------------------------------------------------------------ 두 축의 실제 모드
def test_axis_mode_matches_the_environment(client):
    """양성(postgres 축)과 음성(sqlite 축)을 같은 테스트 id 로 세운다 — skip 을 만들지 않기 위해서다.

    **여기서 읽는 값은 「그 시점에 이미 확정된 것」뿐이다**(ADR 0017 결정 1). `engines` 와
    `tests_on_postgres` 는 세션 동안 **증가하는** 값이라 이 함수 안에서 읽으면 축의 옳음이 아니라
    **자기 앞에 무엇이 돌았는지**를 재게 된다 — 그것이 §후속 37 이다(이 파일을 단독으로 postgres 축에서
    돌리면 축은 옳게 섰는데 `tests_on_postgres` 가 0 이라 빨갰다). 그 둘의 자리는 세션 파이널라이저
    하나이고(`conftest.db_axis_contract` → `check_contract` · `check_sqlite_axis_is_inert`), **관측을
    지운 것이 아니라 옮긴 것**임을 아래 두 함수가 그 배선을 직접 돌려 붙든다:
    `test_the_finalizer_dies_when_a_postgres_session_observed_more_than_one_engine` ·
    `test_the_finalizer_dies_when_a_sqlite_session_observed_anything`.
    """
    if RECORDER.is_postgres:
        assert RECORDER.dialect == "postgresql", RECORDER
        assert settings.database_url.startswith("postgresql+psycopg://")
    else:
        assert RECORDER.dialect is None, RECORDER
        assert settings.database_url.startswith("sqlite:")
        now = axis.MEASURED_PATH.read_bytes() if axis.MEASURED_PATH.exists() else None
        # 문구는 **관측한 것만** 말한다 — 이 실행 전후로 파일이 달라졌다. 쓴 주체(이 실행인가, 밖에서
        # 고친 사람인가)는 관측하지 않았으므로 지목하지 않는다(CLAUDE.md §6-4 2, 계획 0009 §후속 22).
        assert now == axis.MEASURED_AT_IMPORT, \
            "sqlite 축 실행의 전후로 postgres.measured.json 이 달라졌다 — 쓴 주체는 관측하지 않았다 (ADR 0014 §2-5 3)"
    # 위 두 갈래는 **축**만 본다. 시드를 켜는 것은 축이 아니라 `client` 픽스처의 명시 호출이므로
    # (ADR 0018 §2-1·결정 3) 축마다 값이 갈리던 설정 플래그 단언 둘은 이 자리의 물음이 아니게 됐다.
    # 남는 축의 물음은 하나다: 그 시드가 **이 축의 엔진 위에** 앉았는가(postgres 축에서는 세션 스키마).
    # 지우면 무엇이 죽는가 — 아래 `users_count` 를 지우면 이 함수는 픽스처의 시드 배선이 통째로
    # 사라져도 초록이 된다. 그것이 이 두 줄이 있는 이유다.
    # 수를 세지 않는다 — 이 세션의 다른 테스트가 계정을 더 만든다(`test_01` 의 register, `test_12`·
    # `test_16` 의 `u-<uuid>@` 계정). 세는 대신 **시드가 만든 넷의 존재**를 본다: 이 단언은 이 함수가
    # 세션의 어느 자리에서 돌든 같은 값을 갖는다.
    want = {f"{role}@{DEV_SEED_DOMAIN}" for role in DEV_SEED_ROLES}
    with new_session() as s:
        got = set(s.scalars(select(UserRow.email).where(UserRow.email.in_(want))))
    assert got == want, f"축 엔진에서 시드 계정이 보이지 않는다 (ADR 0018 §2-4 ①): {sorted(want - got)}"


# ------------------------------------------------------------------ 강제 셋의 **배선** (하위 프로세스 pytest)
# 위 함수들은 `postgres_axis` 의 **순수 함수**를 태운다. 그 함수들이 아무 데서도 **불리지 않아도**
# 전부 초록이다 — 그것이 계획 0009 §M-5 28 이 번호를 준 공백이고(이 파일 머리말이 "못 잡는 것 둘"로
# 적어 두던 자리), 아래 넷이 그 공백을 닫는다. 붙드는 방법은 **자식 pytest 한 번**이다:
# 저장소의 배선 둘(`db_axis_contract` 파이널라이저 · `pytest_terminal_summary` 훅)을 **그대로 import 한**
# 세션을 자식 프로세스로 돌리고, 부모가 자식의 종료코드와 출력을 단언한다. DB 에는 붙지 않는다.
REPO_ROOT = Path(__file__).resolve().parents[2]
CHILD_MEASURED_ENV = "BUILDTWIN_CHILD_MEASURED"
#: 자식의 `RECORDER` 필드를 부모가 정해 주는 자리(JSON). 자식은 DB 에 붙지 않으므로 "엔진을 관측한
#: 부분집합"(dialect 는 postgresql 인데 수가 바닥값 아래)은 이렇게만 세울 수 있다 — 그 배역이 없으면
#: 계약 ②(바닥값)가 **실제 세션에서** 발화하는 것을 아무도 붙들지 못한다.
CHILD_RECORDER_ENV = "BUILDTWIN_CHILD_RECORDER"
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

# 부모가 배역을 정해 주면 그대로 신는다. 자식은 DB 에 붙지 않아 `dialect` 를 스스로 관측할 수 없다 —
# 이것이 없으면 계약 ①(방언)에서만 죽어 계약 ②(바닥값)의 발화를 실제 세션에서 볼 수 없다.
_forced = os.environ.get("BUILDTWIN_CHILD_RECORDER")
if _forced:
    import json as _json

    for _key, _value in _json.loads(_forced).items():
        setattr(RECORDER, _key, _value)

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


def _child_workdir(tmp_path_factory, name: str) -> Path:
    """자식이 돌 자리. 측정 파일에는 **센티널**을 미리 넣어 둔다 — 그래야 "안 썼다"가 값으로 보인다."""
    work = tmp_path_factory.mktemp(name)
    (work / "conftest.py").write_text(CHILD_CONFTEST, encoding="utf-8")
    (work / "test_child_session.py").write_text(CHILD_TEST, encoding="utf-8")
    (work / "measured.json").write_bytes(SENTINEL)
    return work


def _run_axis_child(work: Path, forced: dict | None = None) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["PYTHONPATH"] = str(REPO_ROOT)
    env[axis.ENV_NAME] = CHILD_PG_URL
    env[CHILD_MEASURED_ENV] = str(work / "measured.json")
    if forced is not None:
        env[CHILD_RECORDER_ENV] = json.dumps(forced)
    return subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "--tb=short", str(work)],
        cwd=str(REPO_ROOT), env=env, capture_output=True, text=True, timeout=300, check=False)


@pytest.fixture(scope="module")
def wiring_child_workdir(tmp_path_factory) -> Path:
    return _child_workdir(tmp_path_factory, "axis-wiring")


@pytest.fixture(scope="module")
def wiring_child(wiring_child_workdir) -> subprocess.CompletedProcess:
    """배선 둘을 import 한 자식 pytest 를 **한 번** 돌리고 결과를 아래 넷이 나눠 읽는다.

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
    return _run_axis_child(wiring_child_workdir)


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


def test_the_below_floor_child_left_the_measured_file_alone(wiring_child, wiring_child_workdir):
    """S1(실제 세션) — 이 자식은 엔진을 하나도 관측하지 않아 `tests_on_postgres=0` 이다(= 바닥값 미달).

    예전 배선은 그 상태로 **먼저 쓰고** 계약 ①에서 죽었다 — 저장소에서 그것이 남긴 것이
    `dialect: null · engines: 0` 이고, 커밋되면 *"이 축은 postgres 에서 돈 적이 없다"* 가 된다.
    센티널이 그대로라는 것이 "아무도 쓰지 않았다"의 값이다(파일이 실측값이면 두 구현이 같은 바이트다).
    """
    assert wiring_child.returncode != 0, wiring_child.stdout + wiring_child.stderr
    assert (wiring_child_workdir / "measured.json").read_bytes() == SENTINEL


@pytest.fixture(scope="module")
def below_floor_child(tmp_path_factory) -> tuple[subprocess.CompletedProcess, Path]:
    """엔진을 **관측한** 부분집합의 배역 — `dialect=postgresql` 인데 수가 바닥값 아래(3 < 187).

    위 `wiring_child` 는 `dialect is None` 이라 계약 ①에서 죽어 계약 ②(바닥값)가 **실제 세션에서**
    발화하는 것을 보여 주지 못한다. 이 자식이 그 자리다: 저장소의 파이널라이저·훅을 그대로 import 한
    세션이 게이트를 지나 계약 ②에서 죽는다.
    """
    work = _child_workdir(tmp_path_factory, "axis-below-floor")
    forced = {"dialect": "postgresql", "server_version": "16.13", "engines": 1, "tests_on_postgres": 3}
    return _run_axis_child(work, forced), work


def test_a_below_floor_postgres_session_stays_red_and_says_the_real_count(below_floor_child):
    """S3 — 바닥값 미달 실행에서 **셋이 함께** 성립한다(§6-2 2·4).

    ⓐ teardown 이 빨갛다 ⓑ 실패 메시지가 **실제 수**를 싣는다 ⓒ `[db-axis]` 줄이 찍히고 그 줄이
    **안 썼다**고 말한다. 그리고 파일은 센티널 그대로다.

    **셋을 한 함수에 둔 것이 이 칸의 요점이다.** "파일이 안 바뀐다"만 보면 쓰기와 단언을 함께 덮은
    구현(D3)이 초록으로 통과하고, 그러면 부분집합이 조용히 초록이 되어 이 계약이 겨냥한 결함 자신이
    된다. 잃은 것(축소가 `git diff` 로 보이던 것)을 잇는 자리가 정확히 ⓑ·ⓒ 라서, 그 둘이 빠지면
    맞바꿈이 성립하지 않는다.
    """
    proc, work = below_floor_child
    out = proc.stdout + proc.stderr
    floor = axis.read_floor(axis.INTEGRATION_TREE)
    # ⓐ
    assert proc.returncode != 0, out
    assert "error" in out.strip().splitlines()[-1], out
    # ⓑ — 문장을 통째로 베끼지 않고 **수 둘**만 본다(§6-4 3)
    assert "3건" in out and str(floor) in out, out
    # ⓒ
    printed = [ln for ln in out.splitlines() if ln.startswith(axis.LOG_PREFIX)]
    assert len(printed) == 1, out
    assert "tests_on_postgres=3" in printed[0] and "안 썼다" in printed[0], printed[0]
    # 그리고 아무것도 쓰지 않았다
    assert (work / "measured.json").read_bytes() == SENTINEL
