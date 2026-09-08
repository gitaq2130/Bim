# ADR 0017 — DB 축은 **세션**의 성질이지 테스트의 성질이 아니다 (두 번째 트리를 붙이는 규칙)

- 상태: Accepted
- 작성: architect
- 날짜: 2026-09-07(측정) · 2026-09-08(커밋) — **값은 커밋으로 못박는다**(§0 의 HEAD)
- 관련: `docs/adr/0014-database-as-a-test-parameter.md` §2-2 · §2-5 · §5-3(축·바닥값·`[ORD]` 를 만든 자리),
  `docs/adr/0015-heap-placement-is-not-a-test-contract.md` §2-3 · §Alternatives 2(autovacuum 을 이 사이클로 미룬 자리),
  `docs/adr/0016-ordering-is-a-contract-only-where-a-consumer-picks-one-row.md` §Deferred 8(행 수 축),
  `docs/plans/0013-the-axis-gets-a-second-tree.md`(이 사이클의 계획),
  `docs/plans/0012-the-order-of-rows-is-a-contract-or-it-is-not.md` §후속 16 · 30 · 31 · 37,
  CLAUDE.md §3-13 · §6-1 · §6-2 · §6-3 · §6-4 · §6-5

---

## 0. 이 문서의 실측이 나온 자리 (재현 방법)

**작업 트리** `/home/user/Bim/buildtwin`, **저장소 루트 `/home/user/Bim`**, 브랜치
`claude/buildtwin-initial-setup-ubulzb`, **HEAD `24d4aaa`**, 루트 `git status --porcelain` 빈 출력.

**이 문서의 모든 `파일:줄`·커밋 참조는 HEAD `24d4aaa` 트리의 것이다**(CLAUDE.md §3-13 첫째 갈래).
**못박음을 좁히지 않는다 — 전체를 못박고 예외를 이름으로 적는다**(계획 0011 §후속 36).
**예외는 둘뿐이다:**

- **㉮ 다른 문서를 인용하는 줄** — ADR 0014·0015 는 `743bcb9`, ADR 0016 과 계획 0012 는 그 문서들이
  자기 §0 에 못박은 트리(`08238c9` 본문 · 라운드별 `f4758f0`·`3a816c4`·`e3037df`·`3feb772`)를 그대로
  말한다. 그 자리에서 트리를 적는다.
- **㉯ 이 사이클의 마감·정정** — 커밋 뒤의 트리에서 잰 값은 그 자리에서 트리를 다시 못박는다.

**DB.** 이 문서가 쓴 포트는 **55441** 이다. 착수 실측(도구 부재를 관측으로 읽지 않는다 —
계획 0012 §후속 46): `shutil.which('ss')` → **`None`**(그래서 `ss` 는 쓰지 않았다),
`/proc/net/tcp` 의 `st=0A` 행에서 55430~55459 대역 **0건**, 그리고 **양성 검사**로
`socket.bind(("127.0.0.1", 55439..55445))` **일곱 개 전부 성공**. 클러스터는
`su postgres -c "initdb -D /var/lib/postgresql/pg0013 -A trust -U postgres"` 로 따로 띄웠다
(`-p 55441 -c listen_addresses=127.0.0.1`; **이 컨테이너에서 `initdb`·`pg_ctl` 은 root 로 못 돈다** —
실행값 `initdb: error: cannot be run as root`). 실행값 `PostgreSQL 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)`,
`autovacuum=on · autovacuum_naptime=60 · autovacuum_vacuum_threshold=50 ·
autovacuum_vacuum_scale_factor=0.2 · autovacuum_vacuum_insert_threshold=1000`(전부 `pg_settings`).
**측정이 끝난 뒤 클러스터를 정지·삭제하고 포트를 반납했다**(`pg_ctl stop -m fast` → `rm -rf` →
`bind(55441)` 재성공).

**탐침은 저장소 밖이다.** `/tmp/pgprobe0013/unit_pg.py` — `-p` 로 붙는 pytest 플러그인이
`sqlalchemy.create_engine` 과 `packages.core.db.create_engine` 을 감싸, **sqlite URL 로 오는 엔진만**
postgres 의 새 스키마로 돌린다(엔진마다 `DROP SCHEMA IF EXISTS … CASCADE` + `CREATE SCHEMA` +
`search_path`). `tests/` 에는 한 글자도 넣지 않았고, 모든 실행 뒤 루트 `git status --porcelain` 이
**빈 출력**이었다.

**기준선(clean `24d4aaa`, 위 환경).** 각 값 옆에 **방법과 N** 을 적는다(계획 0012 §후속 27·34 —
그 문안이 CLAUDE.md §6-5 에 들어가기 전까지는 계획·ADR 마다 손으로 적는다).

| 축 | 명령 | 실행값 |
|---|---|---|
| sqlite `tests/unit` | `.venv/bin/pytest tests/unit -q` | **492 passed** (31.70s · 33.87s, **N=2**) |
| **postgres `tests/unit`**(탐침) | 위 명령 + `-p unit_pg` | **492 passed** (71.23s, **N=1**), 탐침 줄 `[probe0013] engines_redirected=252 tests_touching_db=252` |
| postgres `tests/integration` | `BUILDTWIN_CI_POSTGRES_URL=…55441… pytest -q tests/integration` | **222 passed** (46.55s, **N=1**), `[db-axis] dialect=postgresql server_version=16.13 tests_on_postgres=187 engines=1 floor=187 measured_file=postgres.measured.json(썼다)` |
| 실행 뒤 트리 | `git status --porcelain` | **빈 출력**(전량 실행이 `postgres.measured.json` 을 같은 내용으로 다시 썼다) |

---

## 1. Context

### 1-1. 무엇이 물어졌나

계획 0012 §후속 **16 · 30 · 31 · 37** 이 이 사이클로 배정됐다(리뷰어 확정 순서). 넷은 서로 다른
물음처럼 보이지만 **같은 가정 하나** 위에 서 있다 — *"축은 `tests/integration` 이라는 트리 하나의
것이다."* 16 이 그 가정을 깬다.

| # | 물음 | 이 가정과의 관계 |
|---|---|---|
| 16 | `tests/unit` 을 postgres 로 돌린다 | **가정을 깬다** — 축이 두 번째 트리를 갖는다 |
| 30 | 테스트 DB 의 `autovacuum` 을 끌 것인가 | ADR 0015 가 *"`tests/unit` 을 postgres 로 옮길 때 다시 물어야 한다"*(**인용 · 발췌**) 로 **이 사이클에 못박았다**. 참조 둘 — 그 문장: `grep -n "다시 물어야 한다" docs/adr/0015-*.md` → **그 파일 안 히트 하나**(§Alternatives 의 그 대안), 그것이 미룬 결정: `grep -n "끄지 않는다" docs/adr/0015-*.md` → **그 파일 안 히트 하나**(§2-3 의 결정 제목) |
| 31 | 재배치가 FSM 앞 페이지 경로에서도 상대 순서를 지키는가(N≥10) | 그 재배치의 **단위 짝**이 sqlite 라서 오늘 잴 수 없다. 16 이 그것을 잴 수 있게 만든다 |
| 37 | `test_99` 를 postgres 축에서 **단독**으로 돌리면 한 테스트가 빨갛다 | 축의 **누적값을 테스트 안에서** 읽는 자리다 — 두 번째 트리는 이 모양을 **복제한다** |

### 1-2. 오늘의 축은 트리 하나를 전제로 쓰였다 (코드 인용)

세 자리가 그 전제를 싣는다. **인용이 아니라 그 자리에서 도는 참조로 적는다**(계획 0012 §후속 55 ⓐ):

1. **기록기가 통합 conftest 의 모듈 전역이다** — `grep -n "AxisRecorder(postgres_url" tests/integration/conftest.py`
   → **그 파일 안 히트 하나**. 같은 파일의 `_record_test_on_axis`(autouse)가 세는 것도
   **그 디렉터리의 테스트뿐**이다(`grep -n "_record_test_on_axis" tests/integration/conftest.py`).
2. **바닥값의 정의가 트리 이름을 싣는다** — `tests/postgres.floor.json` 의 `_comment` 첫 문장
   (**인용 · 발췌**): *"`min_tests_on_postgres` = tests/integration 을 postgres 축으로 돌렸을 때 그 엔진
   위에서 SQL 을 실행한 테스트의 최소 수"*. 찾는 명령:
   `grep -o "min_tests_on_postgres = [^.]*" tests/postgres.floor.json` → **히트 하나**.
3. **CI 의 `unit` 잡에는 서비스 컨테이너가 없다** — `grep -n "pytest tests/unit" .github/workflows/buildtwin-ci.yml`
   → **히트 하나**이고 그 줄은 `pytest tests/unit tests/invariants tests/regression -q` 다(**인용 · 전체**).
   **세 트리가 한 세션이다** — 이것이 §2-2 결정의 근거다.

### 1-3. 실측 — `tests/unit` 을 postgres 로 돌리면 무엇이 일어나는가

**탐침 실행값**(위 §0 의 플러그인, HEAD `24d4aaa`, 포트 55441):

| 하위 트리 | 테스트 | **DB 를 만진 테스트** | 엔진 | postgres 실행값 |
|---|---|---|---|---|
| `tests/unit/ingest` | 47 | 13 | 13 | 47 passed (5.38s) |
| `tests/unit/knowledge` | 62 | 3 | 3 | 62 passed (1.33s) |
| `tests/unit/progress` | 316 | **222** | 222 | 316 passed (60.30 · 67.76 · 73.43s, **N=3**) |
| `tests/unit/scan` | 30 | **0** | 0 | 30 passed (16.23s) |
| `tests/unit/sync` | 37 | 14 | 14 | 37 passed (5.20s) |
| **합** | **492** | **252** | **252** | **492 passed**(전량 한 세션, N=1) |

세 가지가 여기서 나온다.

- **① 오늘 아무것도 안 죽는다(N=1).** 그러나 **초록은 증거가 아니다** — ADR 0014 §5-3 이 그 문장을
  자기 자신에게 이미 걸었다(`743bcb9`). 이 초록이 말하는 것은 *"이 탐침의 격리·이 환경에서 이번에
  안 죽었다"* 하나이고, **qa 가 만들 실제 배선의 격리가 다르면 이 값은 그 배선의 값이 아니다.**
- **② 비용.** 같은 트리가 sqlite 31.70/33.87s(N=2) ↔ postgres 71.23s(N=1) — **약 2.1배**.
  지배하는 것은 `progress` 하나다(sqlite 13.17/12.87s ↔ postgres 60.30/67.76/73.43s = **약 5배**),
  그리고 그 트리가 엔진 **222/252** 를 만든다. **CI 러너에서는 재지 않았다.**
- **③ DB 를 만지는 테스트는 절반이다**(252/492). 나머지 240 은 축이 무엇이든 같은 값을 낸다 —
  §2-2 가 바닥값을 **트리가 아니라 세션의 구성**에 매다는 이유가 이것이다.

### 1-4. §후속 37 은 「축이 틀렸다」가 아니라 「축을 테스트 안에서 읽는다」이다 (배역을 갈랐다)

**실행값 둘, 같은 클러스터·같은 URL**:

| 배역 | 명령 | 실행값 |
|---|---|---|
| A | `pytest -q tests/integration/test_01_auth.py tests/integration/test_99_db_axis_contract.py` | **37 passed, 1 error**, `[db-axis] … tests_on_postgres=11` — 문제의 단언은 **초록** |
| B | `pytest -q tests/integration/test_99_db_axis_contract.py` | **1 failed, 24 passed, 1 error**, `[db-axis] … tests_on_postgres=0` |

B 의 실패 메시지(**인용 · 발췌**): `AssertionError: AxisRecorder(postgres_url='…', dialect='postgresql',
server_version='16.13', engines=1, tests_on_postgres=0, _touched=False)` — **축은 옳게 섰다**
(`dialect='postgresql'`, `engines=1`). 빨간 이유는 그 단언이 축의 옳음이 아니라 **자기 앞에 무엇이
돌았는지**를 재기 때문이다. 자리: `grep -n "tests_on_postgres > 0" tests/integration/test_99_db_axis_contract.py`
→ **그 파일 안 히트 하나**.

**두 빨강을 갈라 적는다** — 위 두 배역 모두에 있는 `1 error` 는 **설계된 것**이다(세션
파이널라이저의 바닥값 계약: 부분집합 실행은 teardown 에서 빨개진다). 결함은 그것이 아니라
**`1 failed`** 다. 계획 0012 §후속 37 은 그 하나만 이름 붙였고, 이 문서는 두 개를 갈라 적는다 —
안 갈라 적으면 다음 사람이 **설계된 빨강까지 고치려 든다.**

---

## 2. Decision

### 2-1. 결정 1 — **축의 누적 관측값은 세션 파이널라이저에서만 단언한다**

`AxisRecorder` 가 싣는 값 중 **세션 동안 증가하는 것**(`tests_on_postgres` · `engines`)은
**테스트 함수 안에서 단언하지 않는다.** 그 자리는 세션 파이널라이저 하나다.

*무엇이 여전히 테스트 안에서 단언되는가*: **그 시점에 이미 확정된 값** — `dialect` · `server_version` ·
`settings.database_url` 의 접두사 · sqlite 축의 무동작(측정 파일 바이트 비교). 이 넷은 첫 엔진이 서는
순간 정해지고 뒤에 오는 테스트가 바꾸지 못한다.

*역방향 확인 — 이 결정이 잃는 것.* `tests_on_postgres > 0` 이 잡던 것은 *"postgres 축인데 아무도
그 엔진 위에서 SQL 을 실행하지 않았다"* 이고, 그것은 **실재하는 실패 모드**다(ADR 0014 §2-5 2 가
겨냥한 것과 같은 축). **그 관측을 버리지 않는다** — 자리를 옮길 뿐이다: 같은 값을 세션
파이널라이저의 바닥값 계약이 이미 **더 강한 부등호로** 본다(`tests_on_postgres >= floor`,
`floor` 는 오늘 187). 즉 이 결정은 **관측을 지우지 않고 중복을 지운다.**

*역방향 확인 — "누적"이라는 한정어.* 이 한정어를 빼면 `dialect` 까지 파이널라이저로 밀려나고, 그러면
**축이 틀렸다는 것을 세션 끝에서야 안다.** 넣으면 반대로 *"세션 중간에 값이 변하는 관측"* 이 전부
남는다 — 오늘 그런 값은 위 둘뿐이고(`git grep -n "RECORDER\." tests/` 의 각 히트를 읽어 확인),
**앞으로 늘면 이 결정은 그 새 값에도 걸린다.**

### 2-2. 결정 2 — **바닥값은 「트리」가 아니라 「그 세션이 무엇을 돌았는가」에 매인다**

두 번째 트리가 붙으면 바닥값 하나로는 갈리지 않는다. **키를 세션의 구성으로 나눈다** —
`tests/postgres.floor.json` 은 트리마다 키를 갖고, 각 계약은 **자기 세션이 실제로 수집한 트리의
키만** 본다. CI 의 `unit` 잡이 `tests/unit tests/invariants tests/regression` 을 **한 세션**에
돌리므로(§1-2 3), 트리 이름으로 키를 나눠도 **세션은 여전히 여럿을 담는다**: 그래서 계약이 읽는
것은 *"이 세션이 수집한 트리들의 키의 합"* 이고, **수집하지 않은 트리의 키는 그 세션의 바닥값에
들어가지 않는다.**

*이 결정이 금지하는 것*: 두 번째 트리를 **같은 키에 더해** 187 을 키우는 것. 그렇게 하면
`tests/integration` 만 돌린 전량 실행이 **바닥값 미달로 빨개진다** — 게이트가 거꾸로 서는 모양이고,
그 모양은 이 저장소에서 이미 한 번 났다(ADR 0014 §2-5 의 `191` — CLAUDE.md §6-3 10회차,
`743bcb9`).

*역방향 확인 — 「합」이 미는 것.* 합으로 읽으면 **한 트리가 통째로 빠진 세션**은 그 트리의 키가
빠져 조용히 통과한다(예: `-k` 로 unit 만 남긴 실행). 그것은 **오늘도 같다** — 축의 판정은 호출
형태가 아니라 값 하나라고 `tests/helpers/postgres_axis.py` 가 적는다(찾는 명령:
`grep -n "호출 형태" tests/helpers/postgres_axis.py` → **그 파일 안 히트 둘** — 모듈 머리와
`should_write_measured` docstring 이고 **둘이 같은 판정을 적는다**). 즉 이 결정은 그 한계를
**옮기지도 키우지도 않는다.**

### 2-3. 결정 3 — **격리 단위는 소유자가 고르되, 그 선택은 §후속 31 의 답을 정하므로 값과 함께 적는다**

`tests/unit` 의 격리를 **테스트마다 새 스키마**로 할 것인지 **세션 하나의 스키마**로 할 것인지는
구현이고 `qa` 의 판단이다. **그러나 그 선택은 중립이 아니다** — ADR 0015 가 세운 축(힙 배치는
계약이 아니다)에서, 재배치 헬퍼가 만드는 *"두 행의 상대 순서"* 는 **그 테이블에 되돌아온 line
pointer 가 있는지**에 달렸고, 그것은 격리 단위가 정한다.

**이 사이클의 실측(탐침, 엔진마다 새 스키마)**: 단위 짝
(`tests/unit/progress/test_document_mapping_review_lifecycle.py::test_document_mapping_reviews_orders_by_created_at_not_by_db_scan_order`)을
postgres 로 **N=10** 돌려 **10/10 passed** — 그 테스트가 스스로 단언하는 ⓑ(*"스캔 순서를 어긋나게
했다"*)가 열 번 다 참이었다. **그러나 그 배역은 매번 빈 테이블이다**(스키마가 새것이라 죽은 튜플이
없다) — 즉 **FSM 앞 페이지 경로가 구조적으로 나올 수 없는 조건**에서 잰 값이다.

그래서 요구하는 것은 하나다: **§후속 31 의 N≥10 은 실제로 착지한 배선에서 다시 잰다.** 탐침의
10/10 은 그 값이 아니고, 이 ADR 은 그것을 **선행 관측**으로만 싣는다.

*역방향 확인 — 「소유자가 고른다」가 미는 것.* 고르게 두면 **두 트리의 격리가 서로 달라질 수 있다**
(통합은 세션 스키마 하나, 단위는 테스트마다). 그것을 금지하지 않는 이유는 두 트리의 배역이 실제로
다르기 때문이다 — 통합은 **한 프로젝트를 세션 내내 쌓아 가는** 배역이고(`client` 픽스처가
session-scope 다), 단위는 **매번 처음부터**다. **다르면 다르다고 적는다**: 어느 쪽이든 그 선택과
그 아래서 잰 31 의 값을 `qa` 가 그 자리(테스트 docstring)에 남긴다.

### 2-4. 결정 4 — **`autovacuum` 을 여전히 끄지 않는다 (§후속 30)**

ADR 0015 §2-3 이 내린 결정을 **바꾸지 않는다.** 그 ADR 이 *"`tests/unit` 을 postgres 로 옮길 때 다시
물어야 한다"* 라고 미룬 물음에, 이 사이클이 **새 근거 둘**로 답한다.

- **㉠ 압력이 사용자 테이블에 걸리지 않는다(실측).** 탐침이 만든 **504 스키마 · 6,048 테이블**
  (= 252 × 2 — 이 클러스터가 전량 탐침을 **두 번** 받았고 첫 실행은 탐침 자신의 결함으로 `251 errors`
  였다; 스키마는 지우지 않은 채 쌌다)을 `pg_stat_all_tables` 로 훑은 값: `sum(autovacuum_count)=4` · `sum(vacuum_count)=0` ·
  `max(n_dead_tup)=42` · `max(n_live_tup)=42` · `sum(n_tup_upd)=454` · `sum(n_tup_hot_upd)=27` ·
  `sum(n_tup_del)=68`. 기본 문턱은 `threshold=50 + 0.2×live` 이므로 **어느 사용자 테이블도 문턱에
  닿지 않았다**(최대 42 < 50). 즉 §후속 30 이 걱정한 *"같은 기전이 수백 건에 걸린다"* 는 이
  격리에서는 **일어나지 않았다.**
- **㉡ 그런데 autovacuum 은 실제로 돌았다 — 카탈로그에서.** 위 `autovacuum_count>0` 인 행을 읽으면
  **여덟 중 넷이 `pg_catalog`**(`pg_class` 2 · `pg_attribute` 2 · `pg_depend` 2 · `pg_trigger` 2 ·
  `pg_constraint`·`pg_type`·`pg_index`·`pg_statistic` 각 1)이고 사용자 테이블 쪽 넷은
  `n_live_tup=0` 인 빈 테이블이다. `pg_class` 는 **live 33,173행**, `pg_attribute` 는 **188,832행**
  까지 갔다. **스키마를 많이 만드는 격리의 비용은 사용자 테이블이 아니라 카탈로그에 있다.**
  autovacuum 을 끄면 **그 카탈로그 유지가 함께 꺼진다** — 끄는 쪽이 더 위험하다.

*역방향 확인 — 이 결정이 놓치는 것.* 위 값은 **탐침의 격리(엔진마다 새 스키마)**에서 잰 것이다.
`qa` 가 **세션 하나의 스키마**를 고르면 테이블이 세션 내내 살아 있어 `n_dead_tup` 이 문턱을 넘을 수
있고, 그때는 ㉠ 이 **거짓이 된다.** 그러므로 이 결정의 유효 범위는 *"착지한 배선에서 같은 값을 다시
잴 때까지"* 이고, 그 재측정은 §3 완료 조건 4 가 요구한다. **재측정이 ㉠ 을 뒤집으면 이 결정을 다시
연다** — 그것이 §후속 30 이 두 번째로 열리는 조건이다.

---

## 3. 구현은 소유자(`qa`)의 판단이다 — 요구되는 것은 **완료 조건 다섯 칸**

이 ADR 은 배선의 모양(픽스처 이름·스키마 명명·conftest 배치)을 지정하지 않는다. 요구하는 것은
다음 다섯을 **전부** 만족하는 것이다.

1. **`tests/unit` 이 축을 읽는다.** `BUILDTWIN_CI_POSTGRES_URL` 이 있으면 postgres, 없으면 오늘의
   sqlite — **축 이름은 새로 만들지 않는다**. ADR 0014 는 새 이름(`BUILDTWIN_TEST_DATABASE_URL`)을
   **§Alternatives 의 표 행에서** 기각하며 *"결함은 「이름이 없다」가 아니라 「있는 이름을 아무도
   읽지 않는다」다"* 라고 적었고(**재서술 · 발췌** — 끝말이 그 표와 한 글자 다르다),
   `tests/helpers/postgres_axis.py` 머리는 같은 판정을 *"…였다"* 로 싣는다.
   그 자리에서 도는 참조 둘: `grep -n "있는 이름을" docs/adr/0014-*.md` ·
   `grep -n "있는 이름을" tests/helpers/postgres_axis.py` — **각각 그 파일 안 히트 하나**.
2. **`RECORDER.tests_on_postgres`·`engines` 를 읽는 단언이 테스트 함수 안에 하나도 없다**(결정 1).
   찾는 명령을 커밋 본문에 실행값과 함께 적는다: `git grep -n "tests_on_postgres" -- tests/` 의
   각 히트를 읽어, 테스트 함수 안에 남은 것이 **0** 임을 보인다.
3. **바닥값 키가 트리별이고, 어떤 세션도 자기가 수집하지 않은 트리의 키를 보지 않는다**(결정 2).
   반증: `pytest tests/integration` 단독 전량이 **초록**이고 `pytest tests/unit` 단독 전량도
   **초록**이며, 두 값이 로그의 `[db-axis]` 줄에 **각각** 찍힌다.
4. **§후속 30 의 값을 착지한 배선에서 다시 잰다**(결정 4 역방향 확인). 전량 실행 뒤
   `pg_stat_all_tables` 에서 `max(n_dead_tup)` · `sum(autovacuum_count)` 을 사용자 테이블과
   `pg_catalog` 로 **갈라** 적는다. **값이 문턱(50)을 넘으면 `autovacuum` 결정을 다시 연다.**
5. **§후속 31 을 그 배선에서 N≥10 으로 잰다**(결정 3). 재는 것은 단위 짝의 ⓑ 단언이 참인 비율이고,
   값과 **N 과 방법**을 그 테스트의 docstring 에 남긴다(계획 0012 §후속 34).

**이 다섯은 「초록」을 요구하지 않는다.** 2·3 은 배선의 성질이고 4·5 는 **값**이다 — 값이 어느
쪽으로 나오든 적는 것이 완료이고, 4 가 문턱을 넘거나 5 가 10/10 이 아니면 **그 사실이 산출물**이다.

---

## 4. Consequences

**얻는 것.**

- `tests/unit` 의 252건이 운영 엔진 위에서 돈다 — 오늘 그 트리는 PostgreSQL 을 **한 번도** 보지 않는다.
- `test_99` 를 단독으로 돌릴 수 있게 된다(오늘은 §1-4 B 배역이 빨갛다). 부분집합 실행은 **여전히**
  세션 파이널라이저에서 빨개진다 — 그것은 계약이다.
- ADR 0015 가 만든 힙 진단(`ctid`·`autovacuum_count`)이 단위 짝에서 **처음으로 값을 갖는다**.
  오늘 그 함수는 언제나 빈 문자열을 돌려준다(`grep -n "힙 진단 없음" tests/unit/progress/test_document_mapping_review_lifecycle.py`
  → **그 파일 안 히트 하나**).

**잃는 것 · 지는 비용.**

- **시간.** 로컬 `tests/unit` 이 31.7/33.9s → 71.2s(§1-3 ②). CI 는 `unit` 잡에 서비스 컨테이너가
  없으므로 **컨테이너를 새로 붙이거나 잡을 나눠야 한다** — 어느 쪽이든 잡 시간이 는다.
  **CI 러너에서 재지 않았다.**
- **문서·주석이 낡는다.** `tests/unit` 안에서 *"이 트리는 오늘 sqlite 다"* 계열의 산문이 **15줄**
  이다(계획 0013 §1-b 의 전수 — 표기 집합 셋으로 센 23줄 중 코드 8 · 산문 15). 그 15줄은 16 이
  착지하는 순간 **현재형 거짓**이 되고, CLAUDE.md §6-4 1 은 그것을 **그 사이클이 고치라**고 한다.
- **격리가 카탈로그를 부풀린다**(§2-4 ㉡). 이 값은 탐침의 격리에서 잰 것이고, 세션 스키마를 고르면
  달라진다 — **재지 않았다.**

**닫힘의 한정.**

1. **§1-3 의 「492 passed」는 탐침의 값이다.** 배선이 아니다. 배선에서 빨개지는 자리는 이 값이
   예측하지 못한다.
2. **N=1 이다**(전량 postgres 실행). 세션 의존 칸이 이 저장소에 실재한다(계획 0012 §M-2-2 의
   A5·pg 2/20).
3. **`tests/e2e` 는 그대로 sqlite 다.** 이 ADR 은 그 트리를 만지지 않는다.
4. **CI 에서 아무것도 재지 않았다** — 이 사이클은 푸시하지 않는다.

---

## 5. 한정어 역방향 확인 표 (CLAUDE.md §6-3 — 각 칸은 **실행값 또는 코드 인용**이고 다른 절 참조가 아니다)

| 한정어 | 빼면 무엇이 들어오나 | 때문에 무엇이 빠지나 | 실행값·코드 인용 |
|---|---|---|---|
| 결정 1 의 **「누적」** | `dialect`·`server_version` 단언도 파이널라이저로 밀린다 → 축이 틀린 것을 세션 끝에야 안다 | 세션 중간에 확정되는 관측은 그대로 테스트에 남는다 | `test_99` 의 sqlite 갈래가 `settings.database_url.startswith("sqlite:")` 를 테스트 안에서 본다 — 그 값은 첫 엔진에서 확정된다(`grep -n "startswith(\"sqlite:\")" tests/integration/test_99_db_axis_contract.py`) |
| 결정 1 의 **「테스트 함수 안에서」** | 픽스처·헬퍼의 단언까지 금지된다 | 세션 파이널라이저와 같은 시점에 도는 자리(teardown 픽스처)는 허용된다 | 오늘 그 자리에 있는 것은 `db_axis_contract` 파이널라이저 하나다(`grep -n "def db_axis_contract" tests/integration/conftest.py` → 히트 하나) |
| 결정 2 의 **「그 세션이 수집한」** | 모든 트리의 키를 언제나 더한다 → `tests/integration` 단독 전량이 빨개진다 | 한 트리가 통째로 빠진 세션은 그 키가 빠져 조용히 통과한다(오늘의 한계와 같다) | ADR 0014 §2-5 의 `191`(= 통합 테스트의 수)로 게이트가 거꾸로 섰던 실측: 옳은 값은 **181** 이었다(`743bcb9`, CLAUDE.md §6-3 10회차) |
| 결정 3 의 **「소유자가 고르되」** | architect 가 격리를 지정한다 | 두 트리의 격리가 달라질 수 있다 — 배역이 실제로 다르므로 허용한다 | 통합은 `client` 가 session-scope 다(`grep -n "scope=\"session\"" tests/integration/conftest.py` 의 히트들), 단위 `session` 픽스처는 함수 scope 다(`grep -n "def session" tests/unit/progress/conftest.py`) |
| 결정 4 의 **「여전히」** | 새 결정으로 읽힌다 — ADR 0015 §2-3 이 이미 내렸다 | 이 문서는 **근거만** 더한다. 뒤집는 조건을 §2-4 역방향 확인이 값으로 적는다 | `sum(autovacuum_count)=4` · `max(n_dead_tup)=42`(사용자 테이블) ↔ `pg_class` live 33,173 |
| §3 4 의 **「착지한 배선에서」** | 탐침 값으로 30 을 닫는다 | 탐침의 격리가 사용자 테이블을 매번 비우므로 그 값은 배선의 값이 아니다 | 탐침 전량 뒤 `max(n_live_tup)=42`(6,048 테이블) — 테이블이 자라지 않는다 |

### 같은 사이클의 문서·코드와 교차 확인 (CLAUDE.md §6-3 11회차 — **갈리지 않은 칸도 적는다**)

| 값 | 이 ADR | 계획 0013 | 다른 자리 | 갈렸나 |
|---|---|---|---|---|
| `tests/unit` 총계 | 492 | 492 | `make test` 의 첫 갈래 492(계획 0012 §M-6 표, `e3037df`) | **아니오** |
| DB 를 만지는 단위 테스트 | 252 | 252 | — (이 사이클이 처음 잰 값) | **아니오** |
| postgres 통합 전량 | 222 · `tests_on_postgres=187` | 같은 값 | `tests/postgres.measured.json` 의 `tests_on_postgres` = 187 | **아니오** |
| 바닥값 | 187 | 187 | `tests/postgres.floor.json` · 복창 넷(`5392179` 이 187 로 맞췄다) | **아니오** |
| `tests/unit` 의 sqlite 자리 | 23줄(코드 8 · 산문 15) | 같은 값 | — | **아니오** |
| §후속 31 의 탐침 값 | 10/10 (N=10) | 같은 값 | — | **아니오** |
| autovacuum 실행 수 | 4 (전부 카탈로그 + 빈 테이블) | 같은 값 | ADR 0015 §1-3 의 강제 실행 `autovacuum_count=2`(다른 조건·다른 트리) | **아니오 — 조건이 달라 비교 대상이 아니다** |

---

## 6. Alternatives (기각한 것들)

1. **`tests/unit` 을 통째로 `tests/integration` 으로 옮긴다.** → 기각. 축을 붙이는 일과 트리를
   합치는 일은 다르고, 합치면 **단위 테스트의 배역(매번 처음부터)이 세션 픽스처에 끌려간다.**
   ADR 0014 가 산 것은 *"DB 는 파라미터다"* 이지 *"트리를 하나로 만든다"* 가 아니다.
2. **두 번째 기록기를 하나 더 만든다(단위용 `AxisRecorder`).** → 기각하지 않는다 — **구현이다.**
   이 ADR 이 금지하는 것은 기록기의 **수**가 아니라 그 값을 **테스트 안에서 단언하는 것**이다(결정 1).
3. **바닥값을 하나로 두고 187 을 키운다.** → 기각. `tests/integration` 단독 전량이 빨개진다 —
   §5 표의 `191` 과 같은 모양이고, 그 실패는 **옳은 트리를 빨갛게 만든다.**
4. **`autovacuum` 을 끈다.** → 기각(결정 4). 새 근거는 §2-4 ㉡ 이다 — 이 격리에서 autovacuum 이
   실제로 도는 자리는 **카탈로그**이고, 끄면 그 유지가 함께 꺼진다.
5. **`tests/unit` 을 postgres 로 돌리되 CI 에서는 sqlite 만 돌린다.** → 기각. ADR 0014 §2-5 1 이
   겨냥한 실패가 정확히 *"조용히 sqlite 로 떨어지는 것"* 이고, CI 가 그 축을 안 돌면 그 축은
   **아무도 돌리지 않는 축**이 된다(CLAUDE.md §6 머리말: 읽히지 않는 안전 장치).

---

## 7. Deferred — 이 ADR 이 보고 결정하지 않는 것

1. **`tests/e2e` 의 축.** 16 이 착지하면 sqlite 전용 트리는 e2e 하나만 남는다 — 그 트리가 왜 남는지는
   이 ADR 이 답하지 않는다(계획 0013 §후속 57).
2. **`[ORD]`(정렬 없는 다중행 실행)를 `tests/unit` 에서 세는 것.** 오늘의 679/542 는 `tests/integration`
   한 트리의 값이다(계획 0012 §확인하지 않은 것 14). 그 계수는 계측을 저장소에 두는 항목과 같은
   커밋이 낫다(계획 0012 §후속 51 · 계획 0013 §후속 56).
3. **격리 단위를 세션으로 골랐을 때의 카탈로그·`n_dead_tup` 값.** §2-4 의 값은 엔진마다 새 스키마의
   것이다 — **재지 않았다**(계획 0013 §후속 58).
4. **CI 잡의 모양**(서비스 컨테이너를 `unit` 잡에 붙일 것인가, 잡을 나눌 것인가)과 그 비용.
   `qa` 의 판단이고, **CI 러너에서 아무것도 재지 않았다.**
5. **`packages/core/db.py` 의 기본 URL**(`sqlite:///./buildtwin.db`)을 축이 있을 때 어떻게 볼
   것인가. 오늘 단위 트리는 그 기본값을 monkeypatch 로 덮는 자리가 하나 있다
   (`grep -n "database_url" tests/unit/progress/test_tasks.py` → 히트 하나). 이 ADR 은 그 자리를
   결정하지 않는다 — 배선이 정한다.
