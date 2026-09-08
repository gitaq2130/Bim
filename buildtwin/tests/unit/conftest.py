"""`tests/unit` 의 DB 축 — 담당: qa (ADR 0017, 계획 0013 작업 4).

**DB 는 축이다**(ADR 0014 §2-2). 오늘까지 그 축은 `tests/integration` 하나의 것이었고, 이 트리는
PostgreSQL 을 한 번도 보지 않았다. 여기서 그 가정이 깨진다: `BUILDTWIN_CI_POSTGRES_URL` 이 설정돼
있고 비어 있지 않으면 이 트리의 DB 픽스처가 그 PostgreSQL 위에서 돌고, 없으면 오늘의 임시 sqlite
그대로다. **축 이름을 새로 만들지 않는다** — ADR 0014 가 새 이름을 기각하며 적은 판정이 정본이고
(`grep -n "있는 이름을" docs/adr/0014-*.md` → 그 파일 안 히트 하나 · `grep -n "있는 이름을"
tests/helpers/postgres_axis.py` → 그 파일 안 히트 하나), **두 자리의 끝말이 다르다**(§후속 55 ⓑ).

## 격리 단위 — **테스트마다 새 스키마**(ADR 0017 결정 3 이 소유자에게 맡긴 선택)

`axis_db_url` 이 테스트마다 스키마를 만들고 끝에 `DROP SCHEMA … CASCADE` 한다. 세션 하나의 스키마를
고르지 않은 이유는 이 트리의 **배역**이다: 단위 픽스처는 함수 scope 이고 매번 **처음부터**를 전제로
같은 고정 id(`P-TEST`·`p1`·`p-doc-*`)를 다시 쓴다 — 세션 스키마로 두면 그 전제가 깨져 테스트마다
청소 경로를 새로 만들어야 하고, 그 청소가 곧 새 무보호 자리가 된다.

**그 선택은 중립이 아니다.** 새 스키마는 매번 빈 테이블이라 되돌아온 line pointer 가 **구조적으로
없다** — §후속 31(재배치의 상대 순서가 FSM 앞 페이지 경로에서도 지켜지는가)이 이 격리에서는 그
경로가 **날 수 없는 조건**으로 측정된다. 그 한정과 값은 재는 자리에 적혀 있다
(`grep -n "FSM 앞 페이지" tests/unit/progress/test_document_mapping_review_lifecycle.py`).
반대쪽 값(세션 스키마의 카탈로그·`n_dead_tup`)은 **재지 않았다** — 계획 0013 §후속 59.

## 무엇이 계약인가

- **누적 관측(`engines`·`tests_on_postgres`)은 세션 파이널라이저에서만 단언한다**(ADR 0017 결정 1).
  테스트 함수 안에서 읽으면 그 단언이 축의 옳음이 아니라 *자기 앞에 무엇이 돌았는지*를 잰다.
- **바닥값은 트리별 키다**(결정 2). 이 트리의 계약은 `min_tests_on_postgres["tests/unit"]` 만 보고,
  통합의 키는 보지 않는다 — 그래서 `pytest tests/unit` 단독 전량과 `pytest tests/integration` 단독
  전량이 **둘 다** 초록이다.
- **엔진 수의 기대가 통합과 다르다.** 통합은 세션 내내 하나이고, 여기는 DB 를 만지는 테스트마다
  하나가 선다 — 그래서 `engines_expected=None`(= 적어도 하나)이고, 수를 붙드는 것은 바닥값이다.
- sqlite 축에서 이 기구는 **아무 일도 하지 않는다**: 엔진을 관측하지 않고, 리스너를 달지 않고,
  `postgres.measured.json` 을 건드리지 않는다. 그 무동작을 세션 끝에서 단언한다.

이 트리는 측정 파일(`postgres.measured.json`)을 **쓰지 않는다** — 그 파일은 통합 축의 감시이고,
여기의 값은 잡 로그의 `[db-axis] tree=tests/unit …` 줄이 싣는다.
"""
from __future__ import annotations

import os

import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine

from tests.helpers import postgres_axis as axis

TREE = axis.UNIT_TREE

#: 축은 수집 시점에 정해진다 — DB 픽스처를 쓰지 않는 세션에서도 계약이 자기 모드를 안다.
RECORDER = axis.AxisRecorder(postgres_url=axis.resolve_axis(os.environ))


def observe(engine: Engine) -> Engine:
    """이 엔진이 축 위에 섰음을 기록기에 알린다(sqlite 축에서는 아무 일도 하지 않는다).

    DB 를 만드는 자리마다 이 함수를 통과시키는 것이 이 트리의 규약이다 — 통과하지 않은 엔진은
    **바닥값에 세어지지 않으므로** 조용히 sqlite 로 남아도 계약이 그것을 빨갛게 만든다.
    """
    if RECORDER.is_postgres:
        RECORDER.observe_engine(engine)
        event.listen(engine, "before_cursor_execute", lambda *a, **kw: RECORDER.note_sql())
    return engine


@pytest.fixture
def axis_db_url():
    """이 테스트가 쓸 DB URL. 축이 있으면 postgres + **이 테스트 전용 스키마**, 없으면 임시 sqlite.

    sqlite 갈래가 돌려주는 `sqlite://` 는 오늘 이 트리가 쓰던 값과 같은 것이다(`sqlite://` 와
    `sqlite:///:memory:` 는 같은 in-memory DB 를 만든다).
    """
    url = RECORDER.postgres_url
    if url is None:
        yield "sqlite://"
        return
    schema = axis.new_schema_name()
    axis.create_schema(url, schema)
    try:
        yield axis.schema_url(url, schema)
    finally:
        axis.drop_schema(url, schema)


@pytest.fixture(autouse=True)
def _record_test_on_axis():
    """이 테스트가 축 엔진 위에서 SQL 을 실행했는가. sqlite 모드에서는 리스너가 없어 항상 0 이다."""
    RECORDER.begin_test()
    yield
    RECORDER.end_test()


@pytest.fixture(scope="session", autouse=True)
def unit_db_axis_contract():
    """ADR 0014 §2-5 의 강제 셋을 이 트리에 세운다(ADR 0017 결정 1·2).

    autouse 세션 픽스처라 `tests/unit` 의 어떤 부분집합을 돌려도 teardown 에서 반드시 실행된다 —
    부분집합 실행이 바닥값 미달로 **teardown ERROR** 가 되는 것은 통합 트리와 같은 **계약**이지
    결함이 아니다(ADR 0014 §2-5 2).
    """
    yield RECORDER
    if not RECORDER.is_postgres:
        axis.check_sqlite_axis_is_inert(dialect=RECORDER.dialect, engines=RECORDER.engines,
                                        tests_on_postgres=RECORDER.tests_on_postgres)
        axis.check_sqlite_noop(measured_now=axis.current_measured_bytes(),
                               measured_at_import=axis.MEASURED_AT_IMPORT)
        return
    axis.check_contract(dialect=RECORDER.dialect, engines=RECORDER.engines,
                        tests_on_postgres=RECORDER.tests_on_postgres, floor=axis.read_floor(TREE),
                        engines_expected=None)


def pytest_terminal_summary(terminalreporter) -> None:
    """축 측정값을 **잡 로그 한 줄**로. 자리가 파이널라이저가 아닌 이유는 통합 짝과 같다 —
    세션 픽스처 teardown 의 `print` 는 초록 실행에서 통째로 버려진다.

    한 세션이 두 트리를 다 수집하면 이 줄이 **둘** 찍힌다(트리 이름이 그 둘을 가른다).
    """
    if RECORDER.is_postgres:
        line = axis.axis_log_line(
            tree=TREE, dialect=RECORDER.dialect, server_version=RECORDER.server_version,
            tests_on_postgres=RECORDER.tests_on_postgres, engines=RECORDER.engines,
            floor=axis.read_floor(TREE), measured=None)
    else:
        line = axis.sqlite_log_line(TREE)
    terminalreporter.write_line(line)
