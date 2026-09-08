"""테스트의 DB 축과 그 축이 실제로 돌았음을 붙드는 강제 셋 — 담당: qa (ADR 0014 §2-2·§2-5, ADR 0017).

축 하나(`BUILDTWIN_CI_POSTGRES_URL`)로 **두 트리**(`tests/integration` · `tests/unit`)가 PostgreSQL 또는
임시 SQLite 위에서 돈다. 축은 **세션의 성질**이지 트리의 성질이 아니다(ADR 0017): 각 트리의 conftest 가
자기 기록기와 자기 바닥값 키만 보고, 어떤 세션도 **자기가 수집하지 않은 트리의 키**를 보지 않는다.
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

**언제 `postgres.measured.json` 에 쓰는가 — 바닥값을 만족한 실행에서만**(`should_write_measured`,
계획 0011 §후속 29 ⓑ). 그 전에는 무조건 썼고, 그래서 **부분집합을 postgres 축으로 돌리면 그 부분집합의
값이 저장소 파일에 남았다.** 실측(잰 트리 `f101001`, 포트 55435, N=3 — 세 가지 좁힘 형태를 각각 1회):
`-k` 로만 좁히면 `dialect: null · tests_on_postgres: 0 · engines: 0`, 경로+`-k` 는 `1`, **플래그 0개로
경로만** 좁혀도 `14`. 첫째 갈래가 커밋되면 저장소가 *"이 축은 postgres 에서 돈 적이 없다"* 고 영구히
말한다 — 계약 ①이 잡는 실패를 파일로 기술한 것이다.

판정 축이 `-k`/`--deselect` 같은 **호출 형태**가 아닌 이유도 실측이다: 위 셋째 갈래에는 그 플래그가
**하나도 없다.** 그래서 축은 값 하나 — `tests_on_postgres >= floor` — 이고, 경로 좁힘 · `-k` ·
`--deselect` · `-x` · `--lf` · 크래시로 끊긴 실행을 **전부 같은 칸**에 넣는다. CI 는 전량이라
(`187 >= 187`) 한 글자도 달라지지 않는다.

*맞바꿈 — 이 게이트가 잃는 것*: 예전 배치가 산 것은 *"실패해도 드리프트가 **diff** 로 보인다"* 인데,
통합 스위트가 **진짜로** 줄어든 전량 실행에서는 이제 파일이 안 바뀌어 `git diff` 가 침묵한다. **잃지
않는 것은 값 자신이다** — `check_contract` 의 실패 메시지가 실제 `tests_on_postgres` 를 싣고,
`[db-axis]` 줄이 초록·빨강·teardown ERROR 어느 쪽에서든 찍힌다. 즉 **보이는 자리가 diff 에서 잡
로그로 옮겨간 것**이지 없어진 것이 아니다. 값이 **오르는** 쪽(`200 >= 187`)은 그대로 쓰므로 diff 로 보인다.

**포트·URL 은 공유 자원인가 — DB 는 아니고, 부딪히던 것은 이 파일이었다**(계획 0011 §M-9 26).
같은 URL 에 서로 다른 두 통합 파일을 **동시에** 붙여 재 보았다. 재는 법: 두 pytest 를 백그라운드로
동시에 띄우고 둘 다 끝나기를 기다린 뒤 각 실행의 passed/failed 와 `pg_namespace` 의 `bt_test_%` 잔여
스키마 수를 읽는다. 실행값(잰 트리 = `f101001` 에 이 커밋의 게이트를 얹은 작업 트리, 포트 55435,
**N=10 회**, 매 회 2프로세스):
**20/20 실행이 각각 14 passed · 8 passed, 교차 실패 0건, 매 회 끝의 누수 스키마 0개, 그리고
10 회 내내 측정 파일의 md5 가 한 번도 안 바뀌었다**(게이트 이전에는 두 프로세스가 각각 덮었다).
이름이 `bt_test_{os.getpid()}_{secrets.token_hex(4)}` 라 pid + 32비트 난수로 갈리고 `drop_schema` 가
데이터베이스가 아니라 스키마만 지우기 때문이다. **그러므로 두 에이전트가 같은 포트를 나눠 써도 DB 는
안전하고, 실제로 부딪히던 공유 자원은 이 측정 파일 하나였다** — 두 프로세스가 각각 덮고 마지막 쓰기가
이겼다. 위 게이트가 그 경합도 지운다(탐침은 둘 다 바닥값 미달이라 아무도 쓰지 않는다).
*재지 않은 것*: **전량 둘을 동시에** 돌렸을 때는 여전히 둘 다 쓴다(계획 0011 §확인하지 않은 것 4),
그리고 CI 서비스 컨테이너에서는 아무것도 재지 않았다(CI 는 잡당 1실행이라 동시성이 없다).
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

#: 축이 도는 트리의 이름. **바닥값의 키가 이것이다**(ADR 0017 결정 2) — 트리 하나가 아니라 "그 세션이
#: 무엇을 수집했는가"에 매인다. 각 트리의 conftest 가 자기 기록기와 자기 바닥값만 본다: 한 세션이 둘 다
#: 수집하면 두 계약이 각각 서고, 하나만 수집하면 **수집하지 않은 트리의 키는 그 세션에 들어오지 않는다.**
INTEGRATION_TREE = "tests/integration"
UNIT_TREE = "tests/unit"

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


def read_floor_map() -> dict[str, int]:
    """트리 → 바닥값. 정본은 `tests/postgres.floor.json` 의 `min_tests_on_postgres` **매핑** 하나다."""
    data = json.loads(FLOOR_PATH.read_text(encoding="utf-8"))
    return {str(tree): int(value) for tree, value in data[FLOOR_KEY].items()}


def read_floor(tree: str) -> int:
    """그 트리의 바닥값. **없는 트리를 조용히 0 으로 떨어뜨리지 않는다** — 키가 없으면 KeyError 다.

    폴백을 두지 않는 것이 이 함수의 계약이다: 새 트리에 축을 붙이고 키를 안 만들면 그 트리의 감시는
    "언제나 만족"이 되고, 그것이 이 저장소가 감시하려는 실패("조용히 줄어드는 것") 자신이다.
    """
    return read_floor_map()[tree]


def should_write_measured(*, tests_on_postgres: int, floor: int) -> bool:
    """이 실행의 측정값을 `postgres.measured.json` 에 **쓸 것인가**(계획 0011 §후속 29 ⓑ).

    참인 조건은 하나다: **바닥값을 만족한 실행**. 감시가 성립하지 않는 실행의 값을 감시 파일에 쓰지
    않는다 — 이 파일 머리가 적듯 바닥값의 이름은 커버리지가 아니라 *"조용히 줄어들지 않음"의 감시*다.

    판정 축이 `-k`/`--deselect` 같은 **호출 형태**가 아닌 이유는 실측이다: 경로로만 좁힌 실행
    (`pytest tests/integration/test_20_mapping_decision_cancel.py`)에는 그 플래그가 **하나도 없는데**
    파일을 `tests_on_postgres=14` 로 덮었다(잰 트리 `f101001`, 포트 55435, N=1).
    """
    return tests_on_postgres >= floor


#: 로그 한 줄의 머리. 이 접두사로 CI 로그를 grep 한다.
LOG_PREFIX = "[db-axis]"


def axis_log_line(*, tree: str, dialect: str | None, server_version: str | None, tests_on_postgres: int,
                  engines: int, floor: int, measured: str | None) -> str:
    """`[db-axis]` 줄의 **한 가지 모양**. 트리 이름이 첫 필드인 이유는 이제 한 잡·한 세션이 이 줄을
    **여럿** 찍기 때문이다(unit 잡과 integration 잡, 그리고 루트 한 세션) — 트리 이름이 없으면 두 줄이
    어느 트리의 것인지 로그에서 갈리지 않는다.
    """
    line = (f"{LOG_PREFIX} tree={tree} dialect={dialect} server_version={server_version} "
            f"tests_on_postgres={tests_on_postgres} engines={engines} floor={floor}")
    return line if measured is None else f"{line} measured_file={measured}"


def report_line(report: dict) -> str:
    """측정값을 **로그 한 줄**로. 파일은 다운로드해야 보이지만 이 줄은 잡 로그에 그대로 남는다.

    이것이 없으면 CI 에서 `tests_on_postgres` 의 실제 수를 **아무도 모른다** — 바닥값 이상이라는 것만
    안다. ADR 0014 §2-5 가 만들려던 것은 *"postgres 에서 실제로 돌았음을 값으로 남긴다"* 이고,
    다운로드해야 보이는 값은 CLAUDE.md §6 머리말이 이름 붙인 실패("링크되지 않은 문서는 읽히지
    않는다")로 되돌아간다. 두 CI 스텝의 **로그만으로** 축이 갈렸는지 비교되는 것이 이 줄의 목적이다.
    """
    floor = report["floor"][FLOOR_KEY]
    # 게이트가 들어간 뒤로 이 줄은 **썼는지까지** 말해야 한다. 안 그러면 바닥값 미달 실행의 로그가
    # "파일에 이 값이 있다"로 읽힌다(계획 0011 §후속 29 ⓑ — 잃은 diff 를 잇는 자리가 이 줄이다).
    wrote = should_write_measured(tests_on_postgres=report["tests_on_postgres"], floor=floor)
    return axis_log_line(
        tree=INTEGRATION_TREE, dialect=report["dialect"], server_version=report["server_version"],
        tests_on_postgres=report["tests_on_postgres"], engines=report["engines"], floor=floor,
        measured=(MEASURED_PATH.name
                  + ("(썼다)" if wrote else "(안 썼다 — 바닥값 미달이라 이 실행의 값은 감시가 아니다)")))


def sqlite_log_line(tree: str = INTEGRATION_TREE) -> str:
    """sqlite 축의 같은 자리. 두 스텝 로그가 같은 접두사로 갈린다 — 값을 쓰지는 않는다(계약 3)."""
    return (f"{LOG_PREFIX} tree={tree} dialect=sqlite tests_on_postgres=0 engines=0 "
            f"({ENV_NAME} 없음 — {MEASURED_PATH.name} 을 건드리지 않았다)")


def measured_report(recorder: AxisRecorder, floor: int) -> dict:
    return {
        "_comment": "generated by tests/integration/conftest.py (postgres 모드에서만) — 손으로 고치지 않는다. "
                    "바닥값은 tests/postgres.floor.json 에 있다. 이 수는 커버리지가 아니라 "
                    "'조용히 줄어들지 않음'의 감시다(tests/helpers/postgres_axis.py 머리 참고). "
                    "**이 파일은 바닥값을 만족한 실행만 쓴다**(should_write_measured) — 바닥값 미달 실행"
                    "(부분집합·조기 종료·크래시)은 자기 값을 여기 남기지 않는다. 그런 실행이 무엇을 쟀는지는 "
                    "잡 로그의 [db-axis] 줄이 실제 수와 함께 말하고, 그 실행은 teardown 에서 빨개진다. "
                    "맞바꿈: 통합 스위트가 진짜로 줄어든 전량 실행에서는 이 파일이 안 바뀌므로 그 축소가 "
                    "diff 로는 안 보인다 — 보이는 자리가 [db-axis] 줄과 실패 메시지다.",
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


def check_sqlite_axis_is_inert(*, dialect: str | None, engines: int, tests_on_postgres: int) -> None:
    """sqlite 축에서 이 기구의 **누적 관측이 하나도 늘지 않았다**(ADR 0014 §2-5 3 의 다른 반쪽).

    `check_sqlite_noop` 이 보는 것은 **측정 파일의 바이트**이고, 이 함수가 보는 것은 **기록기의 수**다.
    둘은 다른 것을 잡는다: 리스너를 sqlite 갈래에도 달아 버리면 파일은 그대로인 채 수만 늘고, 그러면
    "축이 넓어졌다"가 아무 데서도 안 보인다.

    자리가 **세션 끝**인 이유는 결정 1 자신이다 — 이 값들은 세션 동안 증가하므로 테스트 함수 안에서
    읽으면 그 단언이 **자기 앞에 무엇이 돌았는지**를 재게 된다(§후속 37 이 이름 붙인 모양).
    """
    assert dialect is None and engines == 0 and tests_on_postgres == 0, (
        f"{ENV_NAME} 가 없는 세션인데 축 기록기가 무엇인가를 관측했다"
        f"(dialect={dialect!r} engines={engines} tests_on_postgres={tests_on_postgres}). "
        "sqlite 축에서 이 기구는 아무 일도 하지 않아야 한다 (ADR 0014 §2-5 3 · ADR 0017 결정 1)."
    )


def check_contract(*, dialect: str | None, engines: int, tests_on_postgres: int, floor: int,
                   engines_expected: int | None = 1) -> None:
    """ADR 0014 §2-5 의 계약 둘 + 세션의 엔진 수. postgres 모드에서만 부른다(3번째 계약 = sqlite 모드 무동작은 호출부에 있다).

    ① 방언이 postgresql 이 아니면 실패 — **조용히 sqlite 로 떨어지는 것**이 §후속 10 의 결함 자신이다.
    ② 엔진 수가 기대와 다르면 실패 — 축이 정한 엔진 말고 **다른 엔진이 하나 더 섰다**는 뜻이다.
       기대값이 트리마다 다른 것은 **격리 단위가 트리마다 다르기 때문**이다(ADR 0017 결정 3 이 그것을
       소유자에게 맡겼다): 통합은 `client` 가 session-scope 라 세션 내내 엔진 하나이고, 단위는 테스트마다
       처음부터라 DB 를 만지는 테스트 수만큼 선다. 그래서 `engines_expected=None` 은 *"적어도 하나"* 다 —
       **그 갈래에서도 0 은 여전히 실패**이고(축이 섰는데 아무 엔진도 안 선 것), 그 트리에서 수를
       붙드는 것은 바닥값이다.
    ③ 바닥값 미달이면 실패 — 한 개만 붙이고 초록을 부르는 것, 그리고 나중에 대부분을 sqlite 로 되돌리는 것.

    **②는 새 계약이 아니라 옮겨온 자리다**(ADR 0017 결정 1). 예전에는 `test_99` 의
    `test_axis_mode_matches_the_environment` 가 `RECORDER.engines` 를 **테스트 함수 안에서** 읽었는데,
    그 값은 세션 동안 증가하므로 그 단언은 축의 옳음이 아니라 **자기 앞에 무엇이 돌았는지**를 쟀다
    (§후속 37 — `test_99` 단독 실행이 빨갛던 이유). 관측을 지우지 않고 **자리를 세션 끝으로 옮긴다.**
    """
    assert dialect == "postgresql", (
        f"{ENV_NAME} 가 설정됐는데 통합 세션이 postgresql 위에서 돌지 않았다(dialect={dialect!r}). "
        "축을 못 읽고 조용히 sqlite 로 떨어진 것이 이 단언이 잡는 실패다 (ADR 0014 §2-5 1)."
    )
    assert engines >= 1 and (engines_expected is None or engines == engines_expected), (
        f"postgres 축 세션이 관측한 엔진이 {engines}개다"
        f"({'하나여야 한다' if engines_expected == 1 else f'기대={engines_expected}'}). 축이 정한 URL 말고 "
        "다른 엔진이 함께 섰거나(격리 밖 쓰기) 아무 엔진도 서지 않았다 — 어느 쪽이든 이 세션의 측정값은 "
        "축의 값이 아니다 (ADR 0017 결정 1: 이 관측의 자리는 세션 파이널라이저다)."
    )
    assert tests_on_postgres >= floor, (
        f"postgres 위에서 SQL 을 실행한 테스트가 {tests_on_postgres}건으로 바닥값 {floor} 미만이다 "
        f"({FLOOR_PATH.name}). 통합 스위트가 조용히 sqlite 로 되돌아갔거나 일부만 postgres 에 붙어 있다 "
        "(ADR 0014 §2-5 2). 통합 테스트를 실제로 줄인 것이라면 바닥값을 PR 에서 명시적으로 낮춘다."
    )
