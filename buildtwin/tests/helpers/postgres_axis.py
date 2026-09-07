"""통합 테스트의 DB 축과 그 축이 실제로 돌았음을 붙드는 강제 셋 — 담당: qa (ADR 0014 §2-2·§2-5).

축 하나(`BUILDTWIN_CI_POSTGRES_URL`)로 `tests/integration` 이 PostgreSQL 또는 임시 SQLite 위에서 돈다.
그 이름은 `.github/workflows/buildtwin-ci.yml` 이 예전부터 export 하던 것이고, ADR 0014 §2-2 가 새 이름을
만드는 대신 그것을 읽기로 정했다(결함은 "이름이 없다"가 아니라 "있는 이름을 아무도 읽지 않는다"였다).

**이 파일이 세는 값은 커버리지가 아니다.** `tests_on_postgres` 는 *그 엔진 위에서 SQL 을 실행한 테스트의
수*일 뿐이고, 그 테스트들이 **PostgreSQL 특유의 결함을 잡는지는 재지 않는다**. 실측이 그 구별을 말한다:
ADR 0014 §5-3 이 통합 191건을 postgres 에서 돌리며 `ORDER BY` 없이 2행 이상을 돌려준 조회를 **677회**
셌고, 그 677회의 순서를 계약으로 붙드는 단언은 **하나도 없는데 191건이 전부 통과했다**. 그러므로 이
바닥값의 이름은 커버리지가 아니라 **"조용히 줄어들지 않음"의 감시**다 — 감시하는 실패 모드는 둘뿐이다:
① 축을 못 읽어 조용히 sqlite 로 떨어지는 것, ② 한 개만 postgres 에 붙여 놓고 초록이라 부르는 것.
정렬 미지정 자리의 순서 계약은 별개의 축이고 계획 0009 §후속 17 이 그것을 연다.

한계 하나 더: 부등호가 `>=` 라 이 감시는 **줄어드는 것**만 잡고 **따라오지 않는 것**(통합 테스트가 늘었는데
바닥값을 안 올리는 것)은 못 잡는다. `tests/metrics.json` 이 갖는 것과 같은 한계다(계획 0009 §리스크 2).
"""
from __future__ import annotations

import json
import os
import secrets
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine, make_url

ENV_NAME = "BUILDTWIN_CI_POSTGRES_URL"
TESTS = Path(__file__).resolve().parents[1]
FLOOR_PATH = TESTS / "postgres.floor.json"
MEASURED_PATH = TESTS / "postgres.measured.json"
FLOOR_KEY = "min_tests_on_postgres"

#: 이 모듈이 import 되는 시점(= 수집 시작)의 measured 파일 내용. sqlite 모드에서 "아무것도 쓰지 않는다"를
#: 단언으로 붙들기 위한 스냅샷이다(ADR 0014 §2-5 3). 파일이 없으면 None.
MEASURED_AT_IMPORT: bytes | None = MEASURED_PATH.read_bytes() if MEASURED_PATH.exists() else None


def resolve_axis(environ: Mapping[str, str]) -> str | None:
    """축 이름이 **설정돼 있고 비어 있지 않으면** 정규화된 postgres URL, 아니면 None(= 임시 sqlite).

    빈 문자열을 None 과 같이 다루는 것이 ADR 0014 §2-2 의 역방향 확인이다 — GitHub Actions 는 정의되지
    않은 값을 빈 문자열로 export 할 수 있고, `is not None` 으로만 보면 `create_engine("")` 이 죽는다.
    """
    raw = (environ.get(ENV_NAME) or "").strip()
    if not raw:
        return None
    return with_psycopg_driver(raw)


def with_psycopg_driver(url: str) -> str:
    """`postgresql://` / `postgres://` 를 `postgresql+psycopg://` 로.

    워크플로가 싣는 값은 드라이버 없는 `postgresql://…` 인데 SQLAlchemy 2.0 의 그 기본 드라이버는
    psycopg2 다(이 저장소가 선언한 것은 psycopg 3 — ADR 0014 §2-1). 이미 드라이버가 붙어 있으면 둔다.
    """
    u = make_url(url)
    if u.drivername in ("postgres", "postgresql"):
        u = u.set(drivername="postgresql+psycopg")
    return u.render_as_string(hide_password=False)


def schema_url(url: str, schema: str) -> str:
    """세션 전용 스키마를 `search_path` 로 붙인 URL(ADR 0014 §2-2 격리).

    엔진은 `packages/core/db.get_engine` 이 URL 하나로만 만든다(connect_args 는 sqlite 갈래뿐) —
    그래서 격리를 **URL 안**에 실어야 한다. libpq `options` 파라미터가 그 자리다.
    """
    return make_url(url).update_query_dict({"options": f"-csearch_path={schema}"}).render_as_string(hide_password=False)


def new_schema_name() -> str:
    """세션마다 새 이름. 서비스 컨테이너 하나를 여러 실행이 공유해도 겹치지 않는다."""
    return f"bt_test_{os.getpid()}_{secrets.token_hex(4)}"


def _admin_execute(url: str, *statements: str) -> None:
    eng = create_engine(url, future=True, isolation_level="AUTOCOMMIT")
    try:
        with eng.connect() as conn:
            for sql in statements:
                conn.exec_driver_sql(sql)
    finally:
        eng.dispose()


def create_schema(url: str, schema: str) -> None:
    _admin_execute(url, f'DROP SCHEMA IF EXISTS "{schema}" CASCADE', f'CREATE SCHEMA "{schema}"')


def drop_schema(url: str, schema: str) -> None:
    """데이터베이스가 아니라 **스키마만** 지운다 — 컨테이너를 공유해도 남의 실행을 날리지 않는다."""
    _admin_execute(url, f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')


@dataclass
class AxisRecorder:
    """이 세션이 어떤 DB 위에서 무엇을 돌렸는지의 관측값. `postgres_url` 은 비밀번호를 담으므로 기록하지 않는다."""

    postgres_url: str | None = None
    dialect: str | None = None
    server_version: str | None = None
    engines: int = 0
    tests_on_postgres: int = 0
    _touched: bool = False

    @property
    def is_postgres(self) -> bool:
        return self.postgres_url is not None

    def observe_engine(self, engine: Engine) -> None:
        self.engines += 1
        self.dialect = engine.dialect.name
        info = getattr(engine.dialect, "server_version_info", None)
        self.server_version = ".".join(str(p) for p in info) if info else None

    def begin_test(self) -> None:
        self._touched = False

    def note_sql(self) -> None:
        self._touched = True

    def end_test(self) -> None:
        if self._touched:
            self.tests_on_postgres += 1


def read_floor() -> int:
    data = json.loads(FLOOR_PATH.read_text(encoding="utf-8"))
    return int(data[FLOOR_KEY])


#: 로그 한 줄의 머리. 이 접두사로 CI 로그를 grep 한다.
LOG_PREFIX = "[db-axis]"


def report_line(report: dict) -> str:
    """측정값을 **로그 한 줄**로. 파일은 다운로드해야 보이지만 이 줄은 잡 로그에 그대로 남는다.

    이것이 없으면 CI 에서 `tests_on_postgres` 의 실제 수를 **아무도 모른다** — 바닥값 이상이라는 것만
    안다. ADR 0014 §2-5 가 만들려던 것은 *"postgres 에서 실제로 돌았음을 값으로 남긴다"* 이고,
    다운로드해야 보이는 값은 CLAUDE.md §6 머리말이 이름 붙인 실패("링크되지 않은 문서는 읽히지
    않는다")로 되돌아간다. 두 CI 스텝의 **로그만으로** 축이 갈렸는지 비교되는 것이 이 줄의 목적이다.
    """
    return (f"{LOG_PREFIX} dialect={report['dialect']} server_version={report['server_version']} "
            f"tests_on_postgres={report['tests_on_postgres']} engines={report['engines']} "
            f"floor={report['floor'][FLOOR_KEY]} measured_file={MEASURED_PATH.name}")


def sqlite_log_line() -> str:
    """sqlite 축의 같은 자리. 두 스텝 로그가 같은 접두사로 갈린다 — 값을 쓰지는 않는다(계약 3)."""
    return (f"{LOG_PREFIX} dialect=sqlite tests_on_postgres=0 engines=0 "
            f"({ENV_NAME} 없음 — {MEASURED_PATH.name} 을 건드리지 않았다)")


def measured_report(recorder: AxisRecorder, floor: int) -> dict:
    return {
        "_comment": "generated by tests/integration/conftest.py (postgres 모드에서만) — 손으로 고치지 않는다. "
                    "바닥값은 tests/postgres.floor.json 에 있다. 이 수는 커버리지가 아니라 "
                    "'조용히 줄어들지 않음'의 감시다(tests/helpers/postgres_axis.py 머리 참고). "
                    "**부분집합을 postgres 축으로 돌리면 이 파일이 그 부분집합의 값으로 덮인 채 남는다** — "
                    "쓰기가 바닥값 단언보다 **먼저**라서다(실패해도 드리프트가 diff 로 보이게 한 설계). "
                    "그 실행은 바닥값 미달로 빨개지므로 초록인 채로 덮이지는 않지만, 되돌리는 것은 사람 몫이다 "
                    "(git checkout 하거나 전량을 다시 돌린다). 같은 값이 잡 로그에도 한 줄로 찍힌다("
                    "접두사 [db-axis]).",
        "dialect": recorder.dialect,
        "server_version": recorder.server_version,
        "tests_on_postgres": recorder.tests_on_postgres,
        "engines": recorder.engines,
        "floor": {FLOOR_KEY: floor},
    }


def write_measured(recorder: AxisRecorder, floor: int) -> dict:
    report = measured_report(recorder, floor)
    MEASURED_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return report


def current_measured_bytes() -> bytes | None:
    return MEASURED_PATH.read_bytes() if MEASURED_PATH.exists() else None


def check_sqlite_noop(*, measured_now: bytes | None, measured_at_import: bytes | None) -> None:
    """ADR 0014 §2-5 **계약 3** — sqlite 모드에서 이 기구는 아무것도 쓰지 않는다.

    **이 함수가 관측하는 것은 "이 실행 전후로 파일이 달라졌다" 하나다**(CLAUDE.md §6-4 2, 계획 0009
    §후속 22). 옛 문구는 *"sqlite 모드가 … 건드렸다"* 로 **관측하지 않은 경위**를 지목했는데, 계획 0009
    마감이 실제로 만난 것은 밖에서 파일을 고쳐 둔 트리였다 — 그때 이 문구는 CM 이 아니라 다음 개발자를
    엉뚱한 곳으로 보낸다.

    이 단언이 세션 **끝**에 있어야 하는 이유는 실측이다: 계약 3 을 테스트 안에서만(세션 중간) 비교하면
    "쓰기를 축과 무관하게 옮기는" 변이가 **살아남는다** — 쓰기가 teardown 에 있어 비교 시점보다 뒤라서다
    (계획 0009 작업 6 실측 M9 — **잰 트리는 통합 203건 시점의 작업 트리**, `ac9417d` 직전:
    sqlite 203 passed 인데 measured 파일의 md5 는 바뀌어 있었다).
    """
    assert measured_now == measured_at_import, (
        f"sqlite 축 실행의 **전후로** {MEASURED_PATH.name} 이 달라졌다 (ADR 0014 §2-5 3). "
        "**쓴 주체는 관측하지 않았다** — 이 실행일 수도, 밖에서 파일을 고친 사람일 수도 있다"
        "(계획 0009 §M-2-4 가 후자를 실제로 만났다). 로컬 개발이 postgres 없이 돌 때 이 파일은 커밋된 값 "
        "그대로여야 한다 — 그렇지 않으면 postgres 측정값이 조용히 덮인다."
    )


def check_contract(*, dialect: str | None, tests_on_postgres: int, floor: int) -> None:
    """ADR 0014 §2-5 의 계약 둘. postgres 모드에서만 부른다(3번째 계약 = sqlite 모드 무동작은 호출부에 있다).

    ① 방언이 postgresql 이 아니면 실패 — **조용히 sqlite 로 떨어지는 것**이 §후속 10 의 결함 자신이다.
    ② 바닥값 미달이면 실패 — 한 개만 붙이고 초록을 부르는 것, 그리고 나중에 대부분을 sqlite 로 되돌리는 것.
    """
    assert dialect == "postgresql", (
        f"{ENV_NAME} 가 설정됐는데 통합 세션이 postgresql 위에서 돌지 않았다(dialect={dialect!r}). "
        "축을 못 읽고 조용히 sqlite 로 떨어진 것이 이 단언이 잡는 실패다 (ADR 0014 §2-5 1)."
    )
    assert tests_on_postgres >= floor, (
        f"postgres 위에서 SQL 을 실행한 테스트가 {tests_on_postgres}건으로 바닥값 {floor} 미만이다 "
        f"({FLOOR_PATH.name}). 통합 스위트가 조용히 sqlite 로 되돌아갔거나 일부만 postgres 에 붙어 있다 "
        "(ADR 0014 §2-5 2). 통합 테스트를 실제로 줄인 것이라면 바닥값을 PR 에서 명시적으로 낮춘다."
    )
