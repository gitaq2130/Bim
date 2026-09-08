# 계획 0009 — §후속 10: PostgreSQL 커버리지 공백 · **착수 크기를 먼저 잰다**

- 작성: architect
- 날짜: 2026-09-07
- 관련: `docs/adr/0014-database-as-a-test-parameter.md`(이 사이클이 쓰는 ADR — 결정의 정본),
  `docs/plans/0007-*.md` §과제 2 전체(§2-a·2-b·2-c — §후속 10 의 원 조사) · §후속 10,
  `docs/plans/0008-*.md` §후속 1~15 · §Deferred · §리스크 2 · §M-2-2(이월 상실 두 모드) · §M-4,
  CLAUDE.md §1 · §2 소유 · §3-4 · §3-13 · §6-1 ①②③ · §6-2 · §6-3 · §6-4 · §6-5

---

## 0. 이 문서의 실측이 나온 자리 (재현 방법)

**작업 트리** `/home/user/Bim/buildtwin`, **저장소 루트는 `/home/user/Bim`**(프로젝트는 그 하위
`buildtwin/`), 브랜치 `claude/buildtwin-initial-setup-ubulzb`, **HEAD `5beb954`**.
루트에서 `git status --porcelain` **전문이 빈 출력**이다(모든 변이 전후로 확인했다).

**§6-1 이 말하는 "저장소 루트"는 `/home/user/Bim` 이다.** 이 사이클에서 그 구별이 다시 결론을 바꿨다 —
`.github/workflows/buildtwin-ci.yml` 은 **`buildtwin/` 밑이 아니라 루트에 있고**, 이 사이클의 대상
파일이다. 계획 0007 §0 의 선례 그대로다.

기준선(전부 이 사이클에서 직접 쟀다):

```
$ cd /home/user/Bim/buildtwin && .venv/bin/pytest -q
807 passed, 1 warning in 85.85s (0:01:25)

$ .venv/bin/pytest -q tests/integration
191 passed, 1 warning in 32.64s
```

**이 사이클은 이 저장소에서 처음으로 PostgreSQL 을 실제로 켜고 쟀다.** 앞선 여덟 사이클의 모든 수치는
SQLite 값이었다(계획 0008 §M-4 1: *"postgres 를 켜 보지 않았다"*). 측정 환경과 탐침 출력의 정본은
**ADR 0014 §0·§1-3·§4-1·§5-3** 이다 — 옮겨 적어 두 자리에 같은 답을 두지 않는다(CLAUDE.md §2).
이 계획이 그 값을 인용할 때는 `[PG-*]`·`[B-*]`·`[SWAP]`·`[ORD]` 이름으로 부른다.

**이 문서의 모든 `파일:줄`·커밋 참조는 HEAD `5beb954` 트리의 것이다** — HEAD 가 움직여도 갱신하지
않는다(CLAUDE.md §3-13 첫째 갈래).

---

## 목표

1. **§후속 10 의 착수 크기를 값으로 정한다.** 계획 0007·0008 이 둘 다 "크기를 모른다"는 이유로
   미룬 항목이므로, **이 사이클의 첫 산출물은 그 크기다**(§과제 1).
2. **그 크기 위에서 ADR 0014 를 쓰고, ADR 이 정한 것만 작업으로 내린다.**
3. **§후속 10 을 한정어와 함께 닫는다** — "postgres 에서 아무 테스트도 돌지 않는다"에 한해서.
   그 항목이 드러낸 **다른 축**(정렬 미지정 42자리의 순서 계약)은 §후속 17 로 새로 연다.
   두 문장을 하나로 합치는 것이 이 항목이 겨냥한 결함 자신이다(§과제 3).

---

# 과제 1 — 착수 크기를 쟀다. **한 사이클에 들어간다**

## 1-a. 어떻게 쟀는가 — 층을 갈라 각 층에 실행값을 붙였다

계획 0007 §2-b 는 *"§후속 10 의 일은 「드라이버를 선언하는 것」이 아니라 「DB 를 테스트 파라미터로
만드는 것」"* 이라고 적었지만, **그 일이 얼마나 큰지는 아무도 재지 않았다.** 재려면 postgres 를 켜야
하는데 여덟 사이클 동안 아무도 켜지 않았다 — 그것이 크기를 모르는 이유였다.

**켰다.** 측정 도구는 스크래치패드 pytest 플러그인 하나이고(커밋하지 않는다),
`packages.core.db.get_engine` **하나만** 가로채 sqlite URL 을 postgres 스키마로 바꾼다.
**운영 코드의 sqlite 분기 넷은 그대로 sqlite 갈래로 간다** — 그 구별이 층을 가르는 칼이다.

| 층 | 질문 | 실행값 | 크기 |
|---|---|---|---|
| **A. SQL·ORM·정렬 호환성** | 스키마가 postgres 에 서고 지금 스위트가 도는가 | `create_all` → **24 테이블**. `pytest tests/unit tests/invariants tests/regression tests/integration` → **795 passed**. `[SWAP] engines->postgres=238 · passthrough=0 · 테스트 파일이 직접 만든 sqlite 엔진=15` | **0** — 고칠 것이 없다 |
| **B. sqlite 분기 넷** | `DATABASE_URL` 이 진짜 postgres 면 무엇이 죽나 | `[B-3]` 시드 **0** → `[B-4]` 로그인 **401**. 시드를 우회하면 `[B2-2] RuntimeError: JWT_SECRET 환경변수가 필요합니다 (.env)` | **1자리 수정 + 1자리는 테스트가 값 주입**(ADR 0014 §2-3) |
| **C. 픽스처 파라미터화** | sqlite 를 못박는 11자리 중 몇이 축 하나로 움직이나 | `core_db` 경유는 전부 움직였다(238 엔진). 테스트 파일이 `create_engine("sqlite://")` 을 **직접** 부르는 자리 **15회**는 축 밖 | **`tests/integration/conftest.py` 한 파일** |
| **D. 드라이버** | 무엇이면 A 가 도나 | `psycopg[binary] 3.3.5` 하나(5.3 MB 휠). `asyncpg` 불필요 | **`pyproject.toml` 한 줄** |

## 1-b. 판정 — 한 사이클이다. 그 판정을 **무엇이 바꿀 수 있었는지**도 적는다

**A 층이 0 실패라는 것이 판정의 전부다.** 계획 0007 §2-c 가 두려워한 것(*"아무도 지정하지 않은 정렬
전부가 postgres 에서 한꺼번에 드러난다"*)이 **이 스위트에서는 일어나지 않았다.** 만약 A 층이 수십 건
실패했다면 이 사이클은 "정렬을 지정하는 사이클"과 "DB 를 파라미터로 만드는 사이클"로 쪼개야 했다 —
그 분기점이 실측 하나(795 passed)에 달려 있었고, 그래서 **이 사이클의 첫 작업이 그 측정이었다.**

남은 것은 B·C·D 이고 각각 한 파일·한 줄 규모다. 작업 여덟 개(그중 architect 넷, api 하나, qa 셋)이고
계획 0006~0008 과 같은 크기다.

*역방향 확인 — "한 사이클"이 무엇을 밖에 두나.* 세 가지를 **의도적으로** 밖에 둔다. 쪼갠 것은
사이클이 아니라 **§후속 10 이 실제로 갖고 있던 여러 축**이고, 그 축들은 아래 §후속 16·17·18 로
번호를 받는다.

| 밖에 두는 것 | 왜 | 넘기는 자리 |
|---|---|---|
| `tests/unit` 을 postgres 로 | **가능함은 쟀다**(스왑으로 604 passed). 테스트 파일 네 자리가 직접 엔진을 만들어 conftest 축 하나로 안 움직인다 — `qa` 의 별도 커밋 | §후속 16 |
| 정렬 미지정 42자리의 **순서 계약** | 이것이 §후속 10 이 실제로 연 두 번째 축이다. 초록은 그 축을 검증하지 않는다(§과제 3) | §후속 17 |
| 데모 시드를 앱 기동에서 떼기 | `make dev`·`make api`·통합 픽스처 셋을 함께 바꾼다 | ADR 0014 §Deferred 1 / §후속 18 |

---

# 과제 2 — ADR 0014 가 정한 것 (요약 — **정본은 ADR 이다**)

| # | 질문 | 결정 | ADR 자리 |
|---|---|---|---|
| 1 | 드라이버와 그 자리 | `psycopg[binary]` 를 `pyproject.toml` 의 **본 의존성**에 | §2-1 |
| 2 | 테스트의 DB 축 | **이미 있는 이름** `BUILDTWIN_CI_POSTGRES_URL`. 새 이름을 만들지 않는다 | §2-2 |
| 3 | 격리 | 세션마다 새 스키마 + `search_path`, 끝나면 `DROP SCHEMA … CASCADE` | §2-2 |
| 4 | **sqlite 분기 넷** | `db.py:23`·`db.py:41`·`settings.py:38` **변경 없음**, `main.py:28` **조건을 넓힌다** | §2-3 |
| 5 | 어떤 집합을 postgres 로 | `tests/integration`(191) | §2-4 |
| 6 | **postgres 에서 돌았음을 값으로** | `tests/postgres.floor.json`(바닥값) + `tests/postgres.measured.json`(측정값), 강제 셋 | §2-5 |
| 7 | CI | 통합을 **두 번** 돈다(sqlite 한 번, postgres 한 번) | §2-6 |

## 2-a. `main.py:28` 데모 시드를 어떻게 하기로 했는가 (이 사이클의 유일한 운영 코드 수정)

```python
# services/api/main.py  (api 소유)
- if url.startswith("sqlite"):
+ if url.startswith("sqlite") or settings.seed_dev_data:
```

새 설정 `Settings.seed_dev_data: bool = False`(`packages/core/settings.py`, architect 소유) +
`.env.example` 에 `SEED_DEV_DATA=` 키 이름 등록(§3-4: 키 이름만).

**왜 이 모양인가.** 실측 `[B-3]`·`[B-4]`: postgres 로 돌리면 사용자 **0명**이 시드되고 로그인이
**401 `{"detail":"invalid credentials","code":"unauthorized"}`** 로 떨어진다. **예외가 없다.** 통합
테스트 191건 전부가 `tokens` 픽스처의 네 역할 로그인 위에 서 있으므로(`conftest.py:57-66`), 이 분기를
그대로 두면 postgres 잡은 "전부 401" 로 죽고 그것을 고치는 유일한 방법이 시드 조건이다.

*역방향 확인 — 왜 `or` 로 **넓히기만** 하고 `if settings.seed_dev_data:` 로 갈아치우지 않나.*
갈아치우면 sqlite 갈래가 죽는다: `make dev`·`make api` 의 로컬 개발 플로우 전부와 통합 191건.
CLAUDE.md §6-3 의 *"조건을 바꾸면 그 결과를 소비하는 게이트까지 따라간다"* 자리다.

*역방향 확인 — `or` 가 무엇을 더 들여보내나.* 운영 postgres 에 플래그를 켜면 데모 계정이 생긴다.
그 위험은 새로 만들어지지 않는다(운영이 sqlite 면 지금도 시드된다). 기본값 `False` + `.env.example`
등록으로 **관측 가능하게** 둔다.

*역방향 확인 — `settings.py:38`(JWT) 은 왜 안 고치나.* 그 분기는 §3-4(시크릿은 `.env` 에만)를 지키는
**안전 장치**다. 실측 `[B2-2]` 는 그것이 **옳게 죽는다**는 것을 보였다 — 답은 코드를 넓히는 것이 아니라
**테스트 환경이 `JWT_SECRET` 을 주는 것**이다(ADR 0014 §2-3 3, Alternatives 6).

## 2-b. **"postgres 에서 실제로 돌았음"을 값으로 남기는 방법**

> 컨테이너를 띄우고 테스트 **한 개**만 붙여도 잡은 초록이 되고 §후속 10 은 "닫혔다"고 적을 수 있다.
> 그것이 이 항목이 겨냥한 결함(조용히 죽는 것)의 재생산이다. **그래서 초록은 증거가 아니다.**

선례를 그대로 쓴다 — `tests/metrics.json` ↔ `tests/metrics.measured.json`(강제 자리는
`tests/regression/test_metrics.py`). 그 형식이 이미 이 저장소에서 "매핑이 조용히 0건이 되는" 실패를
잡고 있다.

| 파일 | 성격 | 내용 |
|---|---|---|
| `tests/postgres.floor.json` | **커밋된 바닥값** | `{"min_tests_on_postgres": 191}` — 초기값은 이 사이클의 실측 |
| `tests/postgres.measured.json` | **커밋된 측정값**(드리프트가 diff 로 보이게) | `{"dialect": "...", "server_version": "...", "tests_on_postgres": N, "engines": M}` |

postgres 모드에서 통합 세션이 끝날 때 **셋을 강제한다**:

1. `dialect == "postgresql"` — 아니면 실패. *이것이 잡는 것*: conftest 가 환경변수를 못 읽어
   **조용히 sqlite 로 떨어지는 것** = §후속 10 의 결함 자신.
2. `tests_on_postgres >= min_tests_on_postgres` — 미달이면 실패. *이것이 잡는 것*: 한 개만 붙이고
   초록을 부르는 것, 그리고 나중에 누군가 대부분을 sqlite 로 되돌리는 것.
3. sqlite 모드에서는 **아무것도 쓰지 않고 아무것도 단언하지 않는다** — 로컬이 postgres 없이 돈다.

*역방향 확인 — 왜 `tests_on_postgres` 이고 `engines` 가 아닌가.* 통합 conftest 의 `client` 는 세션
스코프라 엔진이 **하나뿐**이다(실측: `tests/integration` 단독 실행에서 `[SWAP] engines->postgres=1`).
엔진 수를 세면 바닥값이 1 이 되어 "한 개만 붙여도 초록"을 **정확히 통과시킨다.**

*역방향 확인 — 이 값이 "커버리지"인가.* **아니다.** 세는 것은 그 엔진 위에서 실행된 테스트 수이고,
그 테스트들이 postgres 특유의 결함을 잡는지는 재지 않는다 — §과제 3 의 677 이 그 구별의 실측이다.
그러므로 이름은 커버리지가 아니라 **"조용히 줄어들지 않음"의 감시**다. `qa` 는 그 한정을 파일
주석에 함께 적는다.

*강제 자리의 열린 선택(소유자 판단).* 세션 픽스처의 finalizer 에서 `assert` 하면 **새 테스트 id 가
생기지 않아 sqlite 기준선 807 이 그대로**이지만 실패가 teardown ERROR 로 보고된다. 별도 테스트
파일로 빼면 실패가 깔끔한 대신 sqlite 모드에서 **skip 한 개**가 늘고 — 그 skip 은 이 저장소가 싫어하는
"조용히 죽은 자리"의 모양이다. **계획은 계약만 못박고 기구는 `qa` 가 고른다.**

---

# 과제 3 — §6-2 를 **이 사이클 자신에게** 걸었다: 초록은 증거가 아니다

CLAUDE.md §6-2 의 물음: **"이 단언의 기대값을, 결함 있는 코드가 그대로 만족하는가?"**
이 사이클의 단언은 *"postgres 잡이 초록이다"* 이고, 답은 **그렇다**이다.

`tests/integration` 을 postgres 위에서 돌리며 실행된 SQL 을 셌다(실행값 `[ORD]`):

```
[ORD] engines_pg=1  select_exec=12126  noorder_exec=11120  noorder_multirow_exec=677
   236  FROM activity_document_mappings      18  FROM entity_object_mappings
   170  FROM review_requests                  2  FROM state_transitions
   114  FROM activity_object_mappings         2  FROM files
    92  FROM bim_objects                      1  FROM activity_relations
    41  FROM documents                        1  FROM activities
```

**`ORDER BY` 없이 2행 이상을 돌려준 조회가 677회 실행되고, 191 테스트가 전부 통과했다.**
그 677회의 순서는 **이 postgres·이 데이터량·이 플래너**에서 우연히 단언이 견디는 순서였을 뿐이고,
어느 단언도 그 순서를 계약으로 붙들지 않는다. 통계가 바뀌어 플래너가 접근 경로를 바꾸면
(`[PG-bulk-plan]` 이 200행 + `ANALYZE` 에서 Index Scan → Seq Scan 으로 갈리는 것을 보였다)
그중 무엇이 갈릴지 **아무도 모른다.**

**그러므로 §후속 10 은 한정어와 함께 닫는다** — 닫히는 것은 *"postgres 에서 아무 테스트도 돌지
않는다"* 하나이고, *"정렬 미지정 42자리의 순서 계약"* 은 **§후속 17 로 새로 연다.**

## 3-a. 곁가지 실측 — 계획 0008 §리스크 2 가 답을 받았다

계획 0008 §1-b-2 는 *"postgres 는 순서를 보장하지 않는다 — **다만 이것은 추론이고 실측이 아니다**"*,
§리스크 2 는 *"바꾸지 않으면 그 단언이 postgres 잡에서 죽는다"* 를 열어 뒀다. **쟀다**(ADR 0014 §4-1):

| 실행 | 결과 |
|---|---|
| `[PG-after-delete-reinsert]` 스캔 | `['R2','R1']` — **심기가 postgres 에서도 먹는다** |
| `test_document_mapping_reviews_orders_by_created_at_not_by_db_scan_order`(postgres) | **1 passed** |
| `tests/integration/test_20_mapping_decision_cancel.py`(postgres) | **14 passed** |
| 위 둘 + `persistence.py:480` → `return rows` 변이, **postgres** | **2 failed, 20 passed** |
| 같은 변이, **sqlite** | **2 failed, 20 passed**(같은 두 이름) |

**계획 0008 이 붙인 정렬 계약 둘은 postgres 에서도 장식이 아니다.** 계획 0008 §M-4 1 은 **기록물이라
고치지 않는다**(§3-13) — 정정의 자리는 이 계획과 ADR 0014 §4-1 이다.

---

## 영향 범위

**데이터 모델(`packages/core/models/`).** 변경 **없음**. 새 필드도 새 제약도 없다.
`orm.py:1` 의 *"SQLite·PostgreSQL 공용 … PostGIS 공간 인덱스는 Deferred"* 는 이 사이클이 처음으로
**실행으로 확인했고 참이다**(ADR 0014 §1-4) — 참인 단정이라 고치지 않는다.

**설정(`packages/core/settings.py`, architect).** `seed_dev_data: bool = False` 한 필드.

**서비스.** `services/api/main.py` 조건 한 줄 + 같은 트리의 문구 셋(`api` 소유).
`services/progress`·`services/sync`·`services/ingest` 는 **한 글자도 건드리지 않는다**.

**화면.** 변경 없음. `apps/web/` 을 건드리지 않는다.

**테스트(`tests/`, `qa`).** `tests/integration/conftest.py` 파라미터화 + 바닥값·측정값 파일 둘.

**CI(`.github/workflows/`, `qa`).** `integration` 잡에 postgres 스텝.

**의존성(`pyproject.toml`).** `psycopg[binary]` 한 줄. **소유가 §2 에 없다** — §후속 19.

**문서(`docs/`·`.claude/agents/`, architect).** 이 계획 + ADR 0014 + `qa.md` 한 줄 정정.

**ADR.** **필요하다 — 이 사이클이 쓴다**(`docs/adr/0014-database-as-a-test-parameter.md`).

---

## 작업 분배

**축.** 계획 0006·0007·0008 과 같다("한 소유가 한 커밋으로 끝낼 수 있는 단위" + **낡게 만드는 자리
두 방향**). 축을 바꾸지 않는 이유는 §6-3 9회차다 — 축을 바꾸면 무주공산은 없어지지 않고 자리를 옮긴다.

*역방향 확인 — 이 축이 놓치는 것.* 이 표는 **파일**을 낡게 만드는 것을 본다. 이 사이클이 낡게 만드는
것 중 파일이 아닌 것: **계획 0008 §M-4 1·§리스크 2 의 "postgres 를 켜 보지 않았다"** 이다. 그것은
`architect` 자신의 문서이지만 **기록물이라 고치지 않는다** — 그래서 그 칸은 "없음"이 아니라
**"고치지 않기로 한 것"** 으로 아래 마지막 행에 적는다. 지워 두면 다음 사이클이 그 문장을 다시 믿는다.

| # | 에이전트 | 담당 파일 | 입력 | 출력 | 완료 조건 | 이 작업이 낡게 만드는 남의 자리 → 배정 | 이 작업을 낡게 만들 수 있는 작업 |
|---|---|---|---|---|---|---|---|
| 1 | **architect**(이 커밋) | `docs/plans/0009-*.md` | 계획 0007 §과제 2 · 계획 0008 §후속 1~15·§Deferred·§M-4 · 이 사이클의 실측 | 이 계획 문서 | §과제 1 층 표의 네 칸이 전부 실행값이고, §전수 목록 A 의 ③ 이 실제로 태워졌으며, **계획 0008 §후속 1~15 · §Deferred 1~6 · §M-4 1~10 이 번호를 유지한 채 전부 옮겨졌다** | 없음(문서만) | 작업 2 가 ADR 문안을 바꾸면 §과제 2 요약표가 어긋난다 → 작업 8 이 대조 |
| 2 | **architect**(별도 커밋) | `docs/adr/0014-*.md` | §과제 1 실측 전부 | ADR 0014 | 결정 일곱이 각각 근거 + 역방향 확인을 갖는다. §5 한정어 표의 각 칸이 **실행값 또는 코드 인용**이다 | 없음 | 없음 |
| 3 | **architect**(별도 커밋) | `packages/core/settings.py` · `buildtwin/.env.example` | ADR 0014 §2-3 4 | `seed_dev_data: bool = False` + `SEED_DEV_DATA=` 키 이름 | `.venv/bin/pytest -q` → **807 passed**(이 필드만으로는 아무 동작도 바뀌지 않는다 — 소비자는 작업 4 다). `make lint` exit 0 | `services/api/main.py`·`services/api/README.md`·`services/api/auth/seed.py` 가 "sqlite 일 때만 시드"라고 적는다 → **작업 4(api)** | 없음 |
| 4 | **api** | `services/api/main.py` · `services/api/auth/seed.py` · `services/api/README.md` | ADR 0014 §2-3 4, 작업 3 | 시드 조건 `or settings.seed_dev_data` + 같은 트리 문구 셋 정정 | ① `main.py:25` docstring(*"sqlite 개발 DB 면 데모 사용자 시드"*) · `auth/seed.py:1,3`(*"settings.database_url 이 sqlite 이고 … 호출된다"*, *"운영 DB 에는 절대 적용되지 않는다"*) · `README.md:11,23,25-26`(*"sqlite 전용"*, *"PostgreSQL 등 운영 DB 에서는 시드하지 않으며"*)가 **전부 새 조건을 말한다** ② `pytest -q` → **807 passed**(sqlite 기본값 `False` 에서 동작 불변) ③ `make test` 통과 | `services/api/jobs.py:80,309`(*"SQLite 쓰기 잠금"*)은 **좁아질 뿐 거짓이 아니다** — 같은 트리·같은 소유라 판단만 커밋 본문에 적는다 | 작업 5 가 postgres 로 이 갈래를 처음 실행한다 |
| 5 | **qa** | `pyproject.toml` · `tests/integration/conftest.py` | ADR 0014 §2-1·2-2·2-4, 작업 3·4 | `psycopg[binary]` 선언 + `BUILDTWIN_CI_POSTGRES_URL` 축 + 스키마 격리 + `JWT_SECRET` 주입 | ① 그 이름 **없이**: `pytest tests/integration -q` → **191 passed**(sqlite, 기준선 불변) ② 그 이름 **있이**: **191 passed** 이고 `[?] dialect == postgresql` ③ **빈 문자열**로 주면 sqlite 로 간다(ADR 0014 §2-2 역방향) ④ 같은 파일 머리 docstring(*"전용 임시 SQLite/저장소를 만들고"*) 갱신 ⑤ `make test` 통과 | `.github/workflows/…:130` 주석(*"테스트가 이 값을 읽어 쓸 수 있다"*)이 **과소진술**이 된다 → **작업 7(같은 소유)** | 작업 6 이 이 파일에 강제를 더할 수 있다 |
| 6 | **qa** | `tests/postgres.floor.json` · `tests/postgres.measured.json` · 강제 자리(소유자 판단) | ADR 0014 §2-5 | 바닥값 + 측정값 + 강제 셋 | ① 통합 테스트를 **한 개만** postgres 로 돌리면 **빨개진다**(실행값을 커밋 본문에 적는다 — 이것이 §6-2 양성 케이스다) ② 축을 못 읽어 sqlite 로 떨어지면 **빨개진다** ③ sqlite 모드에서는 두 파일을 **건드리지 않고** 기준선이 그대로다 ④ 파일 주석에 **"이 값은 커버리지가 아니다"** 한정을 적는다(§2-b 역방향) | 없음(새 파일) | 없음 |
| 7 | **qa** | `.github/workflows/buildtwin-ci.yml` | ADR 0014 §2-6 | `BUILDTWIN_CI_POSTGRES_URL` 을 잡 `env` → postgres 스텝 `env` 로 옮기고 통합 스텝 둘 | ① sqlite 스텝이 그 이름을 **보지 못한다** ② postgres 스텝이 초록이고 `postgres.measured.json` 이 `postgresql` 을 싣는다 ③ `:130` 주석을 새 사실로 고친다 ④ 잡 timeout 30분 안에 든다(실측 sqlite **32.64s** + postgres **39.40~73.34s**) | `.claude/agents/qa.md:16`(*"testcontainers 또는 sqlite+spatialite 폴백"* — **오늘도 거짓이다**, 저장소 전체 히트 1건이 그 줄뿐) → **작업 2 와 별개로 architect 가 고친다(작업 3 커밋에 붙이지 않는다)** → 아래 작업 7-b | 없음 |
| 7-b | **architect**(별도 커밋) | `buildtwin/.claude/agents/qa.md` **한 줄** | 실측 | `:16` 의 `testcontainers 또는 sqlite+spatialite 폴백` → 실제 구조 | 루트 실행값 `grep -rni "testcontainers\|spatialite" .` 히트가 **그 줄 하나뿐**이었다는 것을 커밋 본문에 적는다. **다른 줄은 건드리지 않는다** | 없음 | 없음 |
| 8 | **architect** | `docs/plans/0009-*.md` §사이클 마감 | 전부 | 마감(작업의 실제 결과 / 계획이 틀린 자리 / 이월) | 작업 트리에서 전량을 다시 재고 계획과 다른 자리를 전부 적는다. **§확인하지 않은 것·§후속 은 본문 목록을 번호로 옮긴다 — 새로 쓰지 않는다**(계획 0008 §M-2-2 가 세운 규칙) | — | — |
| — | **고치지 않기로 한 것** | `docs/plans/0008-*.md` §리스크 2 · §M-4 1(*"postgres 를 켜 보지 않았다"*) · §1-b-2(*"추론이고 실측이 아니다"*) | — | — | §3-13 첫째 갈래 — 기록물은 소급 갱신하지 않는다. 정정은 §과제 3-a 와 ADR 0014 §4-1 에 있다 | — | — |

**순서 제약.** 3 → 4 → 5 → 6 → 7(7-b 는 아무 때나) → 8. 작업 4 는 작업 3 의 필드 없이 import 가
깨지고, 작업 5 는 3·4 없이 postgres 에서 401 로 죽는다(실측 `[B-4]`).

**커밋 규칙(CLAUDE.md §2).** `packages/core/models/` 를 **건드리지 않는다**(이 사이클은 읽기만 했다 —
§전수 목록 C). 작업 1·2·3·7-b·8 은 같은 소유지만 **커밋을 나눈다**: ADR·계획·설정·에이전트 정의는
각각 독립적으로 읽혀야 리뷰어가 하나만 보고 통과·반려를 정할 수 있다. 커밋 전
`git status --porcelain` **전문**을 루트 `/home/user/Bim` 에서 확인하고 **경로를 명시해서** add 한다.
`git commit -a` 금지. **`make test` 통과 뒤 커밋.**

**남의 트리를 만지지 않는다.** 직전 사이클들에서 `architect` 가 남의 트리를 만진 위반이 두 번 났다
(§6-3 8·9회차). 이 사이클의 `architect` 는 `docs/` · `packages/core/settings.py` · `.env.example` ·
`.claude/agents/qa.md` 밖으로 나가지 않는다. **탐침을 위한 임시 변이는 적용 → 측정 → 원복 → 루트
clean 확인을 한 건씩 했고 커밋하지 않는다**(작업 1 이 `services/progress/persistence.py` 와
`services/api/usecases.py` 에 그렇게 했다 — 두 번 다 원복 뒤 `git status --porcelain` 빈 출력 확인).

---

## 인터페이스 정의

```python
# packages/core/settings.py  (architect 소유 — 작업 3)
class Settings(BaseSettings):
    ...
    seed_dev_data: bool = False   # 데모 사용자·프로젝트 시드를 sqlite 가 아닌 DB 에서도 켠다(ADR 0014 §2-3 4).
                                  # 기본 False. 운영에서 켜면 데모 계정이 생긴다 — .env 로만 켠다(§3-4).
```

```python
# services/api/main.py  (api 소유 — 작업 4)
def init_database() -> None:
    url = settings.database_url
    core_db.init_db(...)
    if url.startswith("sqlite") or settings.seed_dev_data:   # ← 이 한 줄
        ...seed...
```

```python
# tests/integration/conftest.py  (qa 소유 — 작업 5). 계약이지 구현이 아니다.
#   BUILDTWIN_CI_POSTGRES_URL 이 설정돼 있고 **비어 있지 않으면** 그 DB + 세션 전용 스키마,
#   아니면 지금처럼 임시 sqlite. postgres 갈래에서는 JWT_SECRET 과 SEED_DEV_DATA 를 함께 준다.
```

```jsonc
// tests/postgres.floor.json      (qa 소유 — 작업 6, 커밋되는 바닥값)
{ "min_tests_on_postgres": 191 }
// tests/postgres.measured.json   (qa 소유 — 작업 6, 커밋되는 측정값)
{ "dialect": "postgresql", "server_version": "...", "tests_on_postgres": 191, "engines": 1 }
```

**계약 세 줄**(강제가 붙드는 명제):

1. postgres 모드에서 `dialect` 는 `postgresql` 이다 — 조용히 sqlite 로 떨어지면 **빨개진다**.
2. postgres 위에서 실행된 테스트 수가 바닥값 미만이면 **빨개진다**.
3. sqlite 모드에서는 이 계약이 **아무것도 하지 않는다**.

---

## 전수 목록 (§6-1 ①②③ — 전부 저장소 루트 `/home/user/Bim` 에서 만들었다)

### 목록 A — **DB 방언에 기대는 자리**

① **기준**: 표기 **9종**을 대소문자 무시로.
```
$ cd /home/user/Bim && grep -rniE 'sqlite|postgres|postgis|psycopg|asyncpg|pg8000|5432|dialect|DATABASE_URL' . \
    --exclude-dir=.git --exclude-dir=.venv --exclude-dir=node_modules --exclude-dir=__pycache__ \
    --exclude-dir=.mypy_cache --exclude-dir=docs -l
→ 파일 **34개**. 잡음 2: tests/fixtures/sample.ply(좌표 숫자 5432) · tsconfig.tsbuildinfo(다른 프로젝트)
```
계획 0007 §2-b 의 6종 기준을 물려받되 `dialect`·`DATABASE_URL` 을 더했다.

② **이 기준이 놓치는 것**(§6-1 ②를 **이 새 기준에 대해 처음부터 다시 답한다** — CLAUDE.md §6-1
*역방향 확인* 이 요구하는 것이다):
- ⓐ **표기가 아니라 동작으로만** 방언에 기대는 자리 — 곧 **`ORDER BY` 를 지정하지 않은 SELECT** 다.
  그 42자리는 위 아홉 표기 어디에도 걸리지 않는다. **이 사이클의 심장이 이 칸에 있다.**
- ⓑ 방언을 `engine.dialect.name` 이나 예외 타입(`sqlite3.IntegrityError`)으로 가르는 자리
  — `dialect` 는 표기에 넣었지만 예외 타입은 넣지 않았다.
- ⓒ 값이 저장소에 없고 **런타임 환경**에만 있는 경로(운영 서버의 `.env`). 저장소로는 볼 수 없다.
- ⓓ `--exclude-dir=docs` 라 계획·ADR 이 이 축에 대해 하는 단정. **의도적이다**(세는 대상은
  코드·설정이지 문서가 아니다 — 계획 0007 §2-a 가 문서 포함 시 9/10 이 자기 문서임을 실측했다).
- ⓔ `URL.create(...)` 처럼 dialect 를 **객체로 조립**하는 자리(계획 0007 §2-b 의 ③ 그대로).

③ **태웠다 — ⓐ 와 ⓑ 를 실제로 실행했다.**

**ⓑ**: `grep -rnE 'dialect\.name|sqlite3\.(Integrity|Operational|Programming)Error' buildtwin/packages
buildtwin/services --include='*.py'` → **`exit=1`, 히트 0**. 이 트리에서 분기 넷은 전수다.

**ⓐ**: postgres 를 켜고 전 스위트를 돌려 **795 passed** 를 얻은 뒤, 그 실행 중 **`ORDER BY` 없이
2행 이상을 돌려준 조회를 셌다 → 677회**(§과제 3). **초록인데 그 677이 검증되지 않는다**는 것이
이 블라인드 스팟을 태워서 나온 값이고, §후속 17 이 그 값 위에 선다.

**그리고 이 기준이 첫 기준(코드 분기 grep)보다 실제로 더 잡은 것 — 여섯 자리, 전부 분기가 아니다:**

| # | 자리 | 무엇 | 이 사이클과의 관계 |
|---|---|---|---|
| 1 | `.claude/agents/qa.md:16` | *"`tests/integration/` — DB(**testcontainers 또는 sqlite+spatialite 폴백**)"* | **오늘도 거짓이다.** 루트 전체에서 `testcontainers`·`spatialite` 히트가 **이 줄 하나**뿐이고 둘 다 존재하지 않는다 → **작업 7-b(architect)** |
| 2 | `services/api/README.md:11,23,25-26` | *"(sqlite) 데모 사용자 시드"*, *"**sqlite 전용**"*, *"PostgreSQL 등 운영 DB 에서는 **시드하지 않으며**"* | 작업 4 가 거짓으로 만든다 → **작업 4(api, 같은 트리)** |
| 3 | `services/api/auth/seed.py:1,3` | *"**settings.database_url 이 sqlite 이고** … 호출된다"*, *"운영 DB 에는 **절대** 적용되지 않는다"* | 같음 → **작업 4** |
| 4 | `services/progress/persistence.py:433` | *"실측(**SQLite, 이 저장소 통합 테스트 환경**)"* | 그 환경이 더는 sqlite 전용이 아니게 된다. **한정어가 붙어 있어 거짓이 되지는 않는다**(그 값이 SQLite 값이라는 진술은 계속 참) → **관측만, §후속 20** |
| 5 | `services/api/jobs.py:80,309` | *"SQLite 쓰기 잠금 충돌 방지"* | **좁아질 뿐 거짓이 아니다** → 작업 4 가 커밋 본문에 판단만 적는다 |
| 6 | `buildtwin/README.md:28` | *"개발용 시드 계정(**SQLite일 때** 자동 생성)"* | 과소진술이 된다. **`README.md` 는 §2 에 소유가 없다** → §후속 19 |

**§6-1 이 이 목록에 대해 요구한 것은 이 표다.** 첫 기준(`startswith("sqlite")` 두 표기 → 4자리)은
**코드 분기만** 보는 기준이라 위 여섯이 통째로 밖이었고, 그중 하나(`qa.md:16`)는 **프로젝트 시작부터
거짓인 채로 서 있었으며 `qa` 가 자기 정의로 읽는 문장**이다.

### 목록 B — 이월 목록의 **열린 항목 전수 재측정** (§6-1 12회차가 요구하는 것)

①기준 = 계획 0008 §후속 1~15 중 취소선이 없는 것 전부. ②놓치는 것·③태운 결과는 §후속 머리말과
아래 표에 있다. **각 칸은 `5beb954` 실행값이다.**

| 항목 | 재측정 명령 | 값 | 판정 |
|---|---|---|---|
| 2. `"rejected"` 리터럴 전수 감사(qa) | `ls buildtwin/tests/invariants/` · `grep -rln "rejected" buildtwin/tests/invariants/` | 파일 둘(`test_identity_drift_cause_contract.py`·`test_invariants.py`), grep **`exit=1` 히트 0** | **열려 있다** |
| 3. `client.ts` 수작업 code 동기화 TODO(qa) | `sed -n '1,20p' … \| grep -n TODO` | `12: * TODO(round-6+): 이 목록은 서버의 에러 코드 테이블과 수작업으로 동기화된다.` | **열려 있다** |
| 4. 검토요청 *승인*의 사유 요건 | — | 필요한 것은 **운영 실측**(승인 1건당 note 비율)이고 저장소에 없다 | **열려 있다** |
| 6. `docs/api.md` 오류 절 열거(api) | `grep -n "ERROR_ENVELOPE_SECTION" -A 14 …/gen_api_doc.py` | `:24-26` 열거가 여전히 다섯(`InvalidTransitionError`·`RevocationReasonRequiredError`·`TransitionBlockedByReviewError`·`ObjectNotFoundError`·`ReviewRejectionReasonRequiredError`) — 계획 0006 의 예외 둘이 없다 | **열려 있다** |
| 10. PostgreSQL 경로(qa + architect) | `grep -nE 'psycopg\|asyncpg\|postgres\|pg8000' buildtwin/pyproject.toml` | `exit=1`(0건) | **열려 있다 — 이 사이클의 대상** |
| 11. 확정 축 `expert_review_logs` 무보호(qa) | `usecases.py::_confirm_document_mapping_row` 의 `record_expert_review(...)` **두 줄 삭제** → `.venv/bin/pytest -q` | **807 passed**(기준선과 동일, 하나도 죽지 않는다) | **열려 있다** |
| 12. 단위 파일 머리 *"다음 여섯 항목"*(qa) | `sed -n '1,10p' …/test_document_mapping_review_lifecycle.py` · `grep -c "^def test_"` | 머리는 여전히 *"다음 **여섯** 항목을 못 박는다"*, 실측 **`def test_` 8개** | **열려 있다** |
| 13. `test_20_*.py:29` 표 행에 트리 없음(qa) | `sed -n '25,33p' …` | 그 행은 *"그 전에는 **805 passed**"* 로 **트리를 인라인으로 적지 않는다**(형제 두 행은 `df37433`·`716d67d` 를 적는다) | **열려 있다** |
| 14. 같은 파일 *"이 사이클(기준선 807)"*(qa) | `sed -n '700,712p' …` | *"이 사이클(기준선 807)에서 **807 passed**"* — **기준선 숫자는 트리 식별자가 아니다** | **열려 있다** |
| 15. §6-1 12회차 행을 ②(항목 상실)까지 넓힐지(architect) | 판단 항목 | 관측이 **여전히 1건**(계획 0008 §M-2-2). 이 사이클은 §6-1 을 편집하지 않으므로 관측이 늘지 않았다 | **열려 있다 — 문턱 미달** |

*이 재측정의 한계.* ① **§Deferred 1~6 은 재측정하지 않았다**(계획 0008 §2-b ③ 한계 ① 그대로 —
그 목록은 닫힘 판정이 아니라 관측이 필요하고 대부분 운영 데이터를 요구한다). ② 각 항목을 **한 가지
방법으로만** 쟀다. ③ 재측정은 *"항목이 여전히 열려 있는가"* 만 답하고 *"그 사이에 항목의 내용이
바뀌었는가"* 는 답하지 않는다. ④ **닫힌 항목(1·5·7·8·9)은 다시 열렸는지 재지 않았다** — 이월 축이
"열린 것만 재측정"이라 그 방향은 목록 밖이다(**새 한계, 이번에 처음 적는다**).

### 목록 C — 이름 붙은 블라인드 스팟(`packages/core/models/` 의 주석)

① **기준**: 이 사이클의 축으로 만든 표기 — `sqlite|postgres|dialect|드라이버|DB 엔진|스캔 순서`.
```
$ grep -rniE 'sqlite|postgres|dialect|드라이버|DB 엔진|스캔 순서' buildtwin/packages/core/models/*.py
packages/core/models/orm.py:1: """SQLAlchemy ORM. JSON 컬럼으로 … (SQLite·PostgreSQL 공용). PostGIS 공간 인덱스는 Deferred(ADR)."""
```
**히트 1건.** 그리고 그것은 **자기 파일 밖에 대한 단정**이다(§6-1 이 이 디렉터리에 명시적으로 요구하는
확인 대상). **여덟 사이클 동안 아무도 실행하지 않았고, 이 사이클이 처음 태웠다 — 둘 다 참이다**:
`create_all` 이 postgres 16.13 에 **24 테이블**을 세우고, 그 클러스터에는 PostGIS 가 설치돼 있지 않을
뿐 아니라 `pg_available_extensions` 에도 **없다**. 참인 단정이므로 **고치지 않는다.**

② 이 기준이 놓치는 것: 방언을 말하지 않으면서 **JSON 컬럼 타입**에 기대는 단정
(`JSON` ↔ `JSONB`). 그 축은 ADR 0014 §Deferred 6 으로 등록했다.
③ 태웠다: 위 실행값이 그것이다(주석이 하는 두 단정을 각각 실행으로 확인했다).

---

## 검증 시나리오 (§6-2 — 각 시나리오에 **"결함 있는 코드가 이 기대값을 그대로 만족하는가"** 를 물었다)

| # | 층 | 배역 | 단언 | **결함 코드가 만족하는가** |
|---|---|---|---|---|
| **S1** | 통합(postgres) | `BUILDTWIN_CI_POSTGRES_URL` 을 주고 통합을 돈다 | ⓐ 191 통과 ⓑ `dialect == "postgresql"` | **ⓐ만이면 그렇다 — 그래서 ⓑ 가 필요하다.** conftest 가 이름을 못 읽어 sqlite 로 떨어져도 **191 통과**다(그 값이 지금의 기준선이다). ⓑ 없이는 결함 코드와 옳은 코드가 **구별 불가능**하다 |
| **S2** | 통합(postgres) | 통합 테스트를 **한 개만** postgres 로 붙인다 | 바닥값 미달로 **실패** | **아니다.** 바닥값이 없으면 초록이고, 그 초록으로 §후속 10 을 닫을 수 있다 — 이 항목이 겨냥한 결함의 재생산 |
| **S3** | 통합(postgres) | 작업 4 를 **하지 않은** 트리에서 postgres 로 돈다 | 로그인이 **401** 로 죽는다 | **아니다 — 갈린다.** 실측 `[B-3]` 시드 0 · `[B-4]` 401. 시드 조건을 넓힌 트리에서는 통과한다 |
| **S4** | 통합(postgres) | 작업 5 가 `JWT_SECRET` 을 **주지 않은** 트리에서 postgres 로 돈다 | `RuntimeError: JWT_SECRET 환경변수가 필요합니다` | **아니다 — 갈린다.** 실측 `[B2-2]`. *다만 이 시나리오는 S3 가 고쳐진 뒤에만 관측된다* — 시드가 없으면 401 이 먼저 나서 JWT 분기에 닿지 못한다(그 **순서**가 실측이다) |
| **N1** | 통합(sqlite) | 이름을 **주지 않고** 돈다 | 191 통과, 바닥값·측정값 파일을 **건드리지 않는다** | — **음성 대조군(DB 축).** 이 칸이 없으면 이 사이클이 로컬 개발을 깨뜨리고도 CI 만 보고 초록이라 부른다 |
| **N2** | 통합(sqlite) | 이름을 **빈 문자열**로 준다 | sqlite 로 간다 | — **음성 대조군(축 판정).** `is not None` 으로 짠 구현은 여기서 `create_engine("")` 로 죽는다 |
| **N3** | 전체(sqlite) | 작업 3 만 올린 트리 | **807 passed** | — **음성 대조군(설정 축).** 새 필드가 기본값에서 아무것도 바꾸지 않음 |

*§6-2 3(음성 대조군을 한 축에만 몰지 않는다) 확인.* 판정 경로가 셋이므로 각 축에 양성·음성을 뒀다 —
**DB 축**(S1 ↔ N1·N2), **증거 축**(S2 ↔ N1), **분기 축**(S3·S4 ↔ N3).

*§6-2 4(두 사실이 함께여야 의미가 있으면 함께 단언한다) 확인.* S1 의 ⓐ+ⓑ 가 그것이다 —
"초록이다"와 "postgres 에서 초록이다"는 다른 문장이고, 하나만 고정하면 다른 하나가 사라져도 초록이다.

*§6-2 2(발화의 **결과**까지 값이 갈리게) 확인.* S2 는 "바닥값이 있다"가 아니라 **"미달이면 빨개진다"**
를 단언한다. 작업 6 의 완료 조건 ①이 그 실행값을 커밋 본문에 요구하는 이유다.

---

## 한정어 역방향 확인 표 (§6-3 산출물 — 각 칸은 **실행값 또는 코드 인용**이고 다른 절 참조가 아니다)

| 한정어 | 이 단어를 빼면 무엇이 더 들어오나 | 이 단어 때문에 무엇이 빠지나 | 실행값 / 인용 |
|---|---|---|---|
| **"한 사이클에 들어간다"**(§1-b) | 무조건 들어간다고 읽힌다 | **A 층이 0 실패였기 때문**이다. 수십 건이었으면 쪼개야 했다 | postgres 795 passed / `create_all` 24 테이블 |
| **"§후속 10 을 닫는다"**(§목표 3) | postgres 가 검증됐다고 읽힌다 | 닫히는 것은 *"아무 테스트도 돌지 않는다"* 하나 | `[ORD] noorder_multirow_exec=677` — 무정렬 다중행 조회 677회가 아무 단언에도 걸리지 않는다 |
| **"조건을 넓힌다"**(§2-a, `or`) | 갈아치우기도 넓히기로 읽힌다 | 갈아치우면 sqlite 갈래가 죽는다 = 통합 191 + `make dev` | `tests/integration/conftest.py:57-66` 의 `tokens` 픽스처가 `ROLES` 넷으로 로그인하고 `assert r.status_code == 200` |
| **"변경 없음"**(분기 셋) | 셋이 postgres 에서 옳게 돈다고 읽힌다 | `settings.py:38` 은 **옳게 죽는다** — 답이 코드가 아니라 테스트 환경일 뿐 | `[B2-2] login raised RuntimeError: JWT_SECRET 환경변수가 필요합니다 (.env)` |
| **"분기 넷"**(§과제 2) | 방언에 기대는 모든 자리 | 문서·docstring·에이전트 정의 **여섯 자리**(전부 분기가 아니다) | 목록 A ③ 표 — `qa.md:16` 은 **오늘도 거짓**이고 저장소 전체 히트가 그 줄뿐이다 |
| **"통합만"**(§2 결정 5) | 스위트 전체가 간다고 읽힌다 | `tests/unit`(가능함을 쟀다) · `tests/e2e` | 스왑으로 `tests/unit tests/invariants tests/regression` → **604 passed**. 그래도 이번이 아닌 이유는 직접 엔진 **15회** |
| **"191"**(바닥값) | 커버리지로 읽힌다 | 그 191이 postgres 특유의 결함을 잡는가는 재지 않았다 | `[ORD]` 677 |
| **"두 번 돈다"**(CI) | 어느 순서든 상관없다고 읽힌다 | 두 스텝이 **같은 잡**이라 앞 실패가 뒤를 가린다 | `.github/workflows/buildtwin-ci.yml:106-148` 의 `integration` 잡은 스텝을 순서대로 돈다(`:147-148` 이 지금의 유일한 pytest 스텝) → ADR 0014 §Deferred 3 |
| **"심기가 postgres 에서도 먹는다"**(§3-a) | 모든 재배치가 순서를 바꾼다고 읽힌다 | **UPDATE 만으로는 안 바뀌었다** — 그 기전(HOT)은 확인하지 않았다 | `[PG-after-update-R2] scan = ['R2','R1']`(변화 없음) ↔ `[PG-after-delete-reinsert] scan = ['R2','R1']`(뒤집힘) |
| **"이월 목록 재측정"**(목록 B) | 계획 0008 의 모든 목록이 대상이 된다 | **§Deferred 1~6 과 닫힌 항목**은 재측정하지 않았다 | 목록 B 한계 ①·④ |
| **"저장소 루트"**(§0) | `buildtwin/` 을 루트로 읽으면 `.github/workflows/` 가 통째로 밖이다 | — (좁히면 실제로 놓쳤다 — 계획 0007 §0 의 선례) | 이 문서의 목록 A·B·C 는 전부 `cd /home/user/Bim` 에서 돌렸다 |

*같은 문서의 인접 절과 교차 확인(§6-3).* §과제 1 은 A 층을 *"0 실패"* 로, §과제 3 은 같은 실행을
*"아무것도 검증하지 않았다"* 로 적는다. 정면 충돌처럼 보여서 **실행으로 갈랐다**: 두 문장은 서로 다른
것을 센다 — 앞은 **실패 수**(0), 뒤는 **순서를 단언하는 조회 수**(0 / 677). 둘 다 참이고, 그 동시성이
§2-b 의 바닥값 계약이 존재하는 이유다. — 그리고 §영향 범위 는 `orm.py:1` 을 *"참이라 고치지 않는다"*
로, 목록 A 는 여섯 자리를 *"거짓이라 고친다"* 로 적는다. 이것도 갈랐다: `orm.py:1` 은 스키마에 대한
단정(실행으로 참), 여섯은 **시드 조건과 테스트 구조**에 대한 단정(실행으로 거짓)이다.

---

## 열린 질문 / 리스크

1. **CI 의 postgres 는 내가 잰 postgres 가 아니다.** 나는 로컬 PostgreSQL **16.13**(PostGIS 없음)에서
   쟀고 CI 는 `postgis/postgis:16-3.4` 다. 마이너 버전·확장·기본 설정이 다르면 플래너가 다른 경로를
   고를 수 있고, 그러면 §과제 3 의 677 중 무엇이 갈릴지 모른다. **작업 7 의 첫 CI 실행이 이 리스크의
   유일한 관측점이다.**
2. **바닥값 191 이 언제 낡는가.** 통합 테스트가 늘면 바닥값도 올려야 하는데, **올리지 않아도
   빨개지지 않는다**(부등호가 `>=` 다). 즉 이 감시는 **줄어드는 것**만 잡고 **따라오지 않는 것**은
   못 잡는다. `tests/metrics.json` 이 갖는 것과 같은 한계다.
3. **세션 스코프 픽스처가 하나라서 격리 단위가 거칠다.** 통합 191건이 한 스키마를 공유한다
   (지금 sqlite 파일 하나를 공유하는 것과 같은 구조). 병렬 실행(`pytest -n`)을 도입하면 이 설계가
   깨진다 — 지금 이 저장소는 병렬로 돌지 않는다.
4. **`seed_dev_data` 는 "두 갈래 중 한 갈래만 실행된다"를 만드는 장치다** — §후속 10 이 겪은 것과
   같은 종류의 위험이다. 그래서 ADR 0014 §3 7 이 **두 갈래를 둘 다 CI 에서 돌리는 것**을 완화책으로
   못박았다(sqlite 스텝 = 꺼진 갈래, postgres 스텝 = 켜진 갈래).
5. **강제 자리를 정하지 않았다**(§2-b 마지막 문단). finalizer 냐 별도 테스트냐에 따라 sqlite 기준선이
   807 그대로냐 808(skip 1)이냐가 갈린다. **`qa` 가 고르고 마감이 실제 값을 적는다.**
6. **`[ORD]` 677 은 통합 한 트리의 값이다.** `tests/unit` 을 포함하면 더 크다 — 재지 않았다.

---

## ADR 필요 여부

**필요하다. 이 사이클이 쓴다** — `docs/adr/0014-database-as-a-test-parameter.md`.
계획 0007 §과제 2 와 계획 0008 §후속 10 이 둘 다 "ADR 이 필요한 결정"이라고 적었고, 실제로 그렇다:
① 드라이버의 **자리**(본 의존성 ↔ dev extra)는 운영 이미지와 pyproject 의 관계를 정하는 결정,
② **`main.py:28` 조건을 넓히는 것**은 "운영 DB 에 데모 계정이 생길 수 있는 플래그"를 만드는 결정,
③ **바닥값 파일 둘**은 새 감시 기구를 저장소에 들이는 결정이다. 셋 다 다음 사이클이 근거 없이
뒤집으면 안 되는 것들이다. **계획의 작업은 ADR 이 정한 것만 내려간다**(§과제 2 표가 그 대응이다).

---

## 후속 — 다음 사이클로 넘기는 것

**이월 규칙.** 계획 0008 §후속 **1~15**(본문 1~11 + §M-5 12~15)를 **번호를 유지한 채** 옮긴다.
닫힌 항목은 지우지 않고 취소선 + 닫은 근거를 남긴다. **열린 항목은 `5beb954` 에서 전부 재측정했다**
(목록 B 가 그 표다 — CLAUDE.md §6-1 12회차가 근거). 신규는 **16번부터** 잇는다.

*계획 0008 §M-2-2 가 세운 규칙을 이 목록에 건다*: **본문 목록을 번호로 옮긴다, 새로 쓰지 않는다.**
빠진 항목은 닫힌 것과 달리 `git log -S` 로 되찾을 수 없다.

1. ~~**§6-2·§6-4 압축**(architect).~~ → **닫혔다**(계획 0007 §과제 1, 실측으로). 다시 여는 조건은
   그 항목에 적혀 있다(근거 표면이 §6 문자의 5% 이상인 절에서 초안을 태워 **줄과 문자가 둘 다** 줄 때).
2. **`"rejected"` 값 리터럴의 전수 감사**(qa). `5beb954` 재측정: `tests/invariants/` 에 그 감사
   **0건**(`grep -rln "rejected" buildtwin/tests/invariants/` → `exit=1`).
3. **`apps/web/src/api/client.ts:12` 의 TODO**(수작업 code 동기화, qa 소유). `5beb954` 재측정:
   `TODO(round-6+)` 그대로 있다.
4. **검토요청 *승인*의 사유 요건**(ADR 0011 §Deferred 1 / ADR 0012 §Deferred 1 그대로). 필요한 실측:
   검측 승인 1건당 CM 이 실제로 note 를 남기는 비율. **저장소로는 답할 수 없다**(운영 데이터).
5. ~~**취소의 내구 감사를 붙드는 회귀 + V8 docstring**(qa).~~ → **닫혔다(`716d67d`, 계획 0006 사이클).**
   실측과 상세는 계획 0008 §과제 2 에 있다.
6. **`docs/api.md` 오류 절의 예외 열거와 `internal_error`**(api). `5beb954` 재측정: 생성 스크립트 상수
   `ERROR_ENVELOPE_SECTION`(`services/api/scripts/gen_api_doc.py:21-33`)의 열거가 여전히 다섯이고
   계획 0006 의 예외 둘(`MappingDecisionNotCancellableError`·`MappingDecisionCancelReasonRequiredError`)이
   없다. 열거를 유지할지(§6-1: 열거는 길이가 곧 개수다) 부재 단정·grep 으로 바꿀지는 소유자의 판단이다.
7. ~~**`cancelled_review_request_id` 의 갱신 갈래**(progress-engine).~~ → **닫혔다**(`662e91a` + `3ba9226`).
8. ~~**`find_document_mapping_review` 의 `ORDER BY created_at DESC` 가 무보호**(qa).~~ → **닫혔다**
   (`3ba9226`, 계획 0007 §과제 3 이 실측으로 기록). **한정: 잰 것은 줄 삭제 변이 하나뿐이다.**
9. ~~**`document_mapping_reviews` 의 `sorted(...)`**(qa).~~ → **닫혔다**(`7d44cca`, 계획 0008 §과제 1).
   **이 사이클이 더하는 실측**: 그 두 테스트는 **postgres 에서도 장식이 아니다**(§과제 3-a).
10. **PostgreSQL 경로가 비어 있다**(qa + architect) — **이 사이클의 대상.** 마감에서 판정한다.
    닫는 범위는 *"postgres 에서 아무 테스트도 돌지 않는다"* 하나이고, 그 항목이 실제로 열고 있던
    다른 축은 아래 16·17·18 로 나눈다.
11. **확정 축의 `expert_review_logs` 도 무보호**(qa). `5beb954` 재측정:
    `services/api/usecases.py::_confirm_document_mapping_row` 의 `record_expert_review(...)` **두 줄**을
    지우고 `.venv/bin/pytest -q` → **807 passed**(기준선과 동일). 취소 축은 `716d67d` 가 닫았고 확정
    축은 열려 있다. 어느 파일에 둘지가 이 항목의 첫 질문이다.
    *한정 — 잰 것은 두 줄 삭제 변이 하나뿐이다*(계획 0008 §M-5 가 단 한정 그대로). 인자를 바꾸는
    변이나 호출 위치를 옮기는 변이는 재지 않았다.
12. **`tests/unit/progress/test_document_mapping_review_lifecycle.py:5-6` 의 "다음 여섯 항목"**(qa).
    `5beb954` 재측정: 머리는 여전히 *"여섯"*, 실측 `def test_` **8개**. §6-1 회차 9 가 답을 갖고 있다 —
    **개수를 세지 말고 부재 단정 + 그 자리에서 도는 grep 으로.**
13. **`tests/integration/test_20_*.py:29` 의 표 행이 트리를 인라인으로 적지 않는다**(qa).
    `5beb954` 재측정: *"그 전에는 805 passed"* 그대로이고 형제 두 행은 `df37433`·`716d67d` 를 적는다.
    같은 파일 `:796` 이 `` `136e66f` 실측 805 passed `` 로 제대로 돼 있으니 표 행에도 `136e66f` 를 넣으면 된다.
14. **같은 파일 `:705` 의 "이 사이클(기준선 807)"**(qa). `5beb954` 재측정: 그대로다.
    **기준선 숫자는 트리 식별자가 아니다** — 다음 사이클이 `7d44cca` 를 넣어 줄 수 있는 자리다.
    그리고 **자기 커밋 해시를 자기 커밋에 못박을 수 없다는 것이 이 규약의 구조적 한계**이므로,
    그 한계를 규약 옆에 한 줄로 적는 것까지가 이 항목이다.
15. **§6-1 12회차 행의 "밀려난 것" 칸을 ②(항목 상실)까지 넓힐지**(architect). `5beb954` 재측정:
    관측이 **여전히 1건**이다 — 이 사이클은 CLAUDE.md §6-1 을 편집하지 않았으므로 관측이 늘지 않았다.
    §6-5 문턱("두 사이클 이상")에 미달이라 이번에도 넓히지 않는다.

**신규(이 사이클이 연다):**

16. **`tests/unit` 을 postgres 로 돌린다**(qa). **가능함은 쟀다** — 엔진 스왑으로
    `tests/unit tests/invariants tests/regression` → **604 passed**. 막는 것은 테스트 파일 네 자리가
    직접 `create_engine("sqlite://")` 을 부르는 것이다(`unit/ingest/test_persistence.py:28` ·
    `unit/ingest/test_document_identity_persistence.py:43` ·
    `unit/ingest/test_document_register_reupload.py:28` · `unit/knowledge/conftest.py:17`).
    CI 는 `unit` 잡에 서비스 컨테이너를 붙여야 한다.
17. **정렬을 지정하지 않은 42자리의 순서 계약**(architect + progress-engine + api). §후속 10 이
    실제로 연 **두 번째 축**이고 이 사이클이 닫지 않는다. 이 사이클의 실측: 서버 트리 `select(` **63**
    중 `order_by` 미지정 **42**(상한 — 휴리스틱이 다른 줄의 `.order_by(...)` 를 과대 계상한다), 그리고
    postgres 통합 실행에서 **`ORDER BY` 없이 2행 이상을 돌려준 조회 677회**(§과제 3). **첫 질문은
    "42 중 몇이 순서를 계약으로 갖는가"** 이고, 42 전부에 `order_by` 를 붙이는 것은 답이 아니다
    (계약이 없는 자리에 정렬을 붙이면 그 정렬이 다시 무보호가 된다 — §후속 9 가 겪은 모양).
18. **데모 시드를 앱 기동에서 떼어낸다**(api + qa, ADR 0014 §Deferred 1). `seed_dev_data` 플래그는
    완화책이지 답이 아니다. `make dev`·`make api`·통합 픽스처 셋을 함께 바꾼다.
19. **소유가 §2 에 없는 파일들**(architect). 이 사이클이 실제로 부딪힌 것: `pyproject.toml`(작업 5 가
    건드린다) · `buildtwin/README.md`(목록 A 6) · `Dockerfile` · `docker-compose.yml`(ADR 0014
    §Deferred 5) · `buildtwin/.env.example`(작업 3 이 건드린다). **CLAUDE.md §2 트리에 이 다섯이
    없다** — 이번에는 계획의 배정으로 처리했고(그 배정은 소유가 아니다 — §2), 소유를 세우려면
    CLAUDE.md 를 편집해야 하므로 **한 번에 한 절씩** 규칙에 따라 별도 사이클로 넘긴다.
20. **`services/progress/persistence.py:433` 의 *"실측(SQLite, 이 저장소 통합 테스트 환경)"***
    (progress-engine). 한정어가 붙어 있어 **거짓이 되지는 않지만**, 이 사이클 뒤로 "이 저장소 통합
    테스트 환경"이 두 DB 를 뜻하게 된다. 그 값을 postgres 에서도 재서 나란히 적을지가 이 항목이다.

---

## Deferred — 이 사이클이 보고 고치지 않는 것 (계획 0008 §Deferred 1~6 이월, 재측정하지 않았다)

1. **객체가 검측 루프를 떠난 뒤에도 닫히지 않는 inspection 요청.** 고치려면 ADR 0001 §6 의 시스템
   `on_hold` 사유 집합을 셋째로 넓혀야 한다.
2. **반려된 2D↔3D 매핑이 뷰어 계약에 계속 실린다**(sync-2d3d 소유, 별도 ADR 필요).
3. **확정↔취소 반복의 누적.** 반복할 때마다 닫힌 `document_mapping` 요청 행이 하나씩 쌓인다.
   운영에서 문제가 되는지 실측이 없다.
4. **`confirm_mapping_row` 의 `.first()`**(`services/sync/review_queue.py`). 오늘 파이프라인은 한 핸들에
   여러 행을 만들지 않는다 — 관측으로만 남긴다.
5. **`on_hold` 에 공백만 note 를 보내면 `"   "` 가 그대로 저장된다**(ADR 0012 §Deferred 2 그대로).
6. **ADR 0013 §Deferred 1~8** 은 그 ADR 이 소유한다 — 이 계획이 옮겨 적어 두 자리에 같은 답을 두지
   않는다(CLAUDE.md §2).

**신규 — ADR 0014 §Deferred 1~6** 은 **그 ADR 이 소유한다.** 여기 옮겨 적지 않는다(같은 이유).
그중 행동이 필요한 둘은 위 §후속 18·19 로 번호를 받았다.

---

## 이 계획이 확인하지 않은 것

**계획 0008 §M-4 1~10 을 번호를 유지한 채 옮기고**(§M-2-2 규칙 — 새로 쓰지 않는다), 이 사이클이
처분한 것은 처분을 적는다. 이 사이클이 새로 더한 것은 **11번부터** 잇는다.

1. ~~postgres 를 켜 보지 않았다.~~ → **켰다.** PostgreSQL 16.13 로컬 클러스터에서 `create_all` 24 테이블,
   전 스위트 795 passed, 통합 191 passed, 정렬 계약 둘의 postgres 실행과 변이까지 쟀다(§과제 1·3-a).
   *다만* **CI 의 `postgis/postgis:16-3.4` 에서는 아무것도 재지 않았다**(§리스크 1).
2. **정렬 축을 바꾸는 변이는 계획 0008 §M-2-1 이 잰 하나(`review_request_id`)뿐이고**, 역순 정렬·다른
   키는 이 사이클도 재지 않았다.
3. **`persistence.py:455`(§후속 8)의 `.desc()`→`.asc()` 변이는 이번에도 재지 않았다**(계획 0007 §후속 8
   한정 그대로).
4. **§Deferred 1~6 을 재측정하지 않았다**(목록 B 한계 ①).
5. **웹을 태우지 않았다.** `vitest` 를 이 문서 시점에 돌리지 않았다 — 이 사이클이 `apps/web/` 을 한
   글자도 건드리지 않기 때문이다. **작업 4·5 가 `make test` 로 웹까지 함께 태운다**(§3 규칙 1).
6. **`make lint` 를 이 문서 시점에 돌리지 않았다.** 작업 1·2 의 산출물은 `docs/` 뿐이라 lint 대상이
   아니다. 작업 3 부터가 `make lint` 를 태운다.
7. **§6-5 · §6-1 · §6-3 의 근거 표면을 재지 않았다**(계획 0007 §M-4 → 계획 0008 §M-4 7 그대로 이월).
   이 사이클은 CLAUDE.md 를 **한 글자도 편집하지 않으므로**, 다음 사이클이 `211242c` 를 기준으로 잰다.
8. **qa 가 보고한 서버 변이 14건을 재현하지 않았다**(출처 계획 0006 §M-6). 이 사이클이 직접 태운
   서버 변이는 **둘**이다(`persistence.py:480` 정렬 삭제 · `usecases.py` 확정 축 로그 삭제).
9. **`df37433`·`716d67d` 직전 트리를 체크아웃해 803·804 를 재현하지 않았다.** 커밋 귀속은 `git log -S`
   로만 확인했다(이 사이클은 그것도 하지 않았다 — 계획 0008 의 기록을 그대로 인용했다).
10. **§6-1 12회차 외 다른 행의 관측값을 재현하지 않았다.** 회차 1~11 의 관측값이 오늘 트리에서
    재현되는지는 여전히 아무도 재지 않았다.

**신규(이 사이클이 더한다):**

11. **`postgis/postgis:16-3.4` 이미지에서 재지 않았다** — 내가 켠 것은 PostGIS 없는 소박한
    PostgreSQL 16.13 이다. 확장·설정 차이가 플래너를 바꾸는지 모른다(§리스크 1).
12. **`[PG-after-update-*]` 가 순서를 바꾸지 않은 **기전**을 확인하지 않았다.** HOT update 가
    그럴듯한 설명이지만 `pg_stat_*` 의 HOT 카운터를 읽지 않았다(ADR 0014 §4-2).
13. **`tests/e2e` 를 postgres 로 돌려 보지 않았다.** 서브프로세스 uvicorn 이라 환경 전달 경로가 다르다
    (`tests/e2e/conftest.py:165`). `make e2e` Playwright 스모크도 실행하지 않았다.
14. **`[ORD]` 677 은 `tests/integration` 한 트리의 값이다.** `tests/unit` 을 포함한 값은 재지 않았다.
15. **바닥값 191 이 CI 에서 실제로 그 수가 되는지 재지 않았다.** 내가 잰 191 은 로컬 실행값이고,
    CI 의 수집 결과가 같다는 보장은 워크플로가 처음 도는 순간에만 관측된다.
16. **`psycopg` 를 `pyproject.toml` 에 실제로 넣고 `pip install -e ".[dev]"` 를 돌려 보지 않았다.**
    드라이버는 `--target` 으로 별도 디렉터리에 깔고 `PYTHONPATH` 로만 붙였다(그래서 계획 0007 §2-a 의
    *"`.venv` 에도 0건"* 이 지금도 참이다). 해석 충돌은 작업 5 가 처음 관측한다.

---

# 사이클 마감 (architect, 2026-09-07)

## M-0. 이 마감의 실측이 나온 자리 (재현 방법)

**작업 트리** `/home/user/Bim/buildtwin`, 저장소 루트 `/home/user/Bim`, 브랜치
`claude/buildtwin-initial-setup-ubulzb`, **마감 착수 시 HEAD `62b8bb4`**(qa 의 작업 7).

**이 마감은 clean 트리에서 전량을 다시 재지 못했다 — 그 사실을 먼저 적는다.** 리뷰 처분이 병렬로
진행돼 `qa` 가 `tests/` 와 워크플로를 **이 마감이 도는 동안 편집하고 있었다**. 내가 실제로 잰 두 값이
그것을 그대로 보여 준다:

| 잰 시각 | 그때의 작업 트리 | `.venv/bin/pytest -q` |
|---|---|---|
| 08:52~08:55 | `62b8bb4` + qa 미커밋(`postgres_axis.py`·`conftest.py`·`measured.json`) | **1 failed, 820 passed, 1 error** — 수집 **821** |
| 09:0x | 위 + qa 미커밋 추가(`test_99_db_axis_contract.py`·`test_20_*.py`·`postgres.floor.json`) | **823 passed** |
| — (리뷰어, clean) | **`62b8bb4`** | **821 passed** |

**절대값이 마감이 도는 동안 움직였다**(821 → 823). 그래서 §M-1 의 절대값은 **리뷰어가 `62b8bb4` 에서
잰 값**이고, 내가 확인한 것은 커밋된 트리의 **수집 수 821** 이 첫 실행에서 재현된다는 것까지다.
첫 실행의 `1 failed` 는 **트리 결함이 아니라 병렬 편집과의 경합**이고 정체는 M-2-4 에 있다.
*이 자리 자체가 §후속 13·14 가 이름 붙인 결함의 실물이다* — **절대값은 트리를 못박지 않으면
같은 사이클 안에서도 다른 값을 낸다.**

**2차 심사 처분에서 그 한계가 걷혔다(2026-09-07, HEAD `bf049be`).** `qa` 의 처분 둘
(`19c0b3b`·`bf049be`)이 들어오고 트리가 clean 이 된 뒤 **이 마감이 전량을 직접 다시 쟀다** —
§M-1 (나)와 §M-1-c 가 그 값이고, **리뷰어가 중계한 값과 전부 일치한다.**
**이 절 아래의 `파일:줄` 참조는 `bf049be` 트리의 것이고**(첫 판이 `62b8bb4` 에서 잰 값은
그 트리로 못박아 둔다), 두 트리의 값이 다른 자리는 **다르다고 적었지 하나로 합치지 않았다.**

**이 절의 `파일:줄`·커밋 참조는 마감 시점 트리의 것이고, §0 의 `5beb954` 참조는 갱신하지 않는다**
(CLAUDE.md §3-13 첫째 갈래). **본문과 ADR 0014 는 한 글자도 고치지 않았다** — 기록물이다.
정정의 자리는 이 마감이다.

## M-1. 각 작업의 실제 결과 · 이 트리의 절대값

**절대값 — 트리를 못박는다(§후속 13·14 형식). 트리가 둘이라 나눠 적는다.**

*(가) `62b8bb4` — 리뷰어 실측(이 마감의 첫 판 기준선)*

| 축 | 명령 | 값 |
|---|---|---|
| sqlite 전량 | `.venv/bin/pytest -q` | **821 passed** |
| `make test` | unit/invariants/regression/integration | **492 / 104 / 8 / 205** + vitest **283** |
| postgres 통합 | `BUILDTWIN_CI_POSTGRES_URL=… pytest -q tests/integration` | **205 passed**(`tests_on_postgres=181`, `engines=1`) |
| postgres 전량 | 같은 축 | **821 passed** |
| lint | `make lint` | **exit 0** |
| CI run `34098577780` job `101668172383`(이 마감이 잡 로그에서 읽었다) | sqlite 스텝 / postgres 스텝 | **205 passed** (33.92s) / **205 passed** (38.27s) |

*(나) `bf049be` — 2차 심사 처분(`19c0b3b`·`bf049be`)이 들어온 뒤. **이 표는 이 마감이 clean 트리에서
직접 쟀다** — 첫 판이 못 했던 것이고(§M-4 20), qa 의 병렬 편집이 끝나 트리가 clean 이라 가능했다.*

| 축 | 명령 | 값 |
|---|---|---|
| sqlite 전량 | `.venv/bin/pytest -q` | **823 passed** (82.39s) |
| `make test` | unit/invariants/regression/integration | **492 / 104 / 8 / 207** + vitest **283**(28 files) |
| lint | `make lint` | **exit 0** |
| postgres 통합 | `BUILDTWIN_CI_POSTGRES_URL=… pytest -q tests/integration` | 아래 §M-1-c |
| CI run `34105054598` job `101688740406`(잡 로그) | sqlite 스텝 / postgres 스텝 | **207 passed** (33.65s) / **207 passed** (37.14s) |

**리뷰어가 중계한 값과 내 값이 전부 일치한다**(823 · 492/104/8/207 · 283 · exit 0 · CI 207/207).

### M-1-c. postgres 통합을 이 마감이 직접 쟀다 — `tests_on_postgres=181` 의 세 번째 관측

```
$ BUILDTWIN_CI_POSTGRES_URL=postgresql://buildtwin@127.0.0.1:55432/buildtwin_test \
      .venv/bin/pytest -q tests/integration
[db-axis] dialect=postgresql server_version=16.13 tests_on_postgres=181 engines=1 floor=181 measured_file=postgres.measured.json
207 passed, 1 warning in 40.68s
```

**181 이 세 자리에서 같다** — CI run `34098577780`(아티팩트) · CI run `34105054598`(잡 로그) ·
이 마감의 로컬 실행. 그리고 이 실행 뒤 `git status --porcelain` 에 `postgres.measured.json` 이
**나타나지 않았다** — 로컬(16.13)이 쓴 내용이 커밋값과 **바이트 동일**이기 때문이고, 그것은
`server_version` 이 마침 로컬 값으로 커밋돼 있어서다. **CI 에서 돌면 그 파일은 `16.4` 로 달라진다** —
§M-4 17 · §후속 23 이 그 자리다.

*이 값이 §M-4 15 의 표본을 바꾸지 않는다.* 위 셋 중 **CI 는 여전히 2회**이고, 바닥값 여유 0 을
감수하는 판정이 기대는 전제는 **CI 의 수**다(로컬은 서비스 컨테이너·확장·플래너가 다르다).

| # | 소유 | 계획한 것 | 실제 | 커밋 |
|---|---|---|---|---|
| 1 | architect | 계획 0009 | 그대로 | `c23a63b` |
| 2 | architect | ADR 0014 | 그대로. **두 값이 하류에서 반박됐다** — 아래 M-2 | `118359d` |
| 3 | architect | `seed_dev_data` + `.env.example` | 그대로(807 passed, 동작 불변) | `7b969b0` |
| 4 | **api** | 시드 조건 + 문구 셋 | 그대로 | `631fa19` |
| 5 | **qa** | 드라이버 + DB 축 | 그대로. **계획·ADR 의 값 둘을 반박했다**: ⓐ 바닥값 **191 → 181** ⓑ postgres 축은 초록이 아니라 **10회 중 2회 실패**(고치기 전) | `ac9417d` |
| 6 | **qa** | 바닥값·측정값·강제 셋 | 그대로. 강제 자리는 **autouse 세션 finalizer**(계획이 소유자 판단으로 남긴 선택지) | `ac9417d` |
| 7 | **qa** | CI 통합 두 번 | 그대로. **잡 로그가 `env:` 블록으로 축 분리를 증명한다** — sqlite 스텝의 env 에 `BUILDTWIN_CI_POSTGRES_URL` 이 **없고** postgres 스텝에만 있다 | `62b8bb4` |
| 리뷰 M1 | **qa** | 측정값의 유일한 출구가 아티팩트라 아무도 수를 모른다 | **닫혔다 — 잡 로그 두 줄로**(아래) | `19c0b3b` |
| 리뷰 M3① | **qa** | 통합 두 스텝의 실패를 식별 가능하게 | `-rfE`·`--tb=short`·junit 아티팩트 | `bf049be` |
| 7-b | architect | `qa.md:16` 거짓 한 줄 | 그대로 | `a642378` |
| 8 | architect | 사이클 마감 | 이 절 + CLAUDE.md §6-3 **10회차 한 행**(별도 커밋, 그 절만 — M-2-2 판정) | `737bbc3` · 이 커밋 |

### M-1-b. 리뷰 M1 이 **CI 관측으로** 닫혔다 (ⓐ)

`19c0b3b` 이 축의 측정값을 **잡 로그 한 줄**로 내보낸다. **그것이 CI 에서 실제로 찍히는 것을
이 마감이 확인했다** — run **`34105054598`** job **`101688740406`** 의 로그에서 직접 읽은 값:

```
[db-axis] dialect=sqlite tests_on_postgres=0 engines=0 (BUILDTWIN_CI_POSTGRES_URL 없음 — postgres.measured.json 을 건드리지 않았다)
207 passed, 1 warning in 33.65s
[db-axis] dialect=postgresql server_version=16.4 tests_on_postgres=181 engines=1 floor=181 measured_file=postgres.measured.json
207 passed, 1 warning in 37.14s
```

**두 스텝 모두에 줄이 있다** — 즉 **아티팩트를 내려받지 않고 잡 로그만으로 실제 수가 읽힌다.**
*이 근거를 CI 에서 잡은 이유*: "로컬에서 찍히는 것을 봤다"만으로 닫으면 그것이 **§M-4 18 이 이름
붙인 모양**(로컬에서 태우고 CI 에 대해 말하기)의 즉시 재발이다.

**부수 소득 둘.** ① **CI 의 181 이 두 실행 연속 같은 값**이다(앞 실행은 아티팩트, 이 실행은 로그)
→ §M-4 15 를 "두 번"으로 갱신했다. ② **CI 의 `server_version=16.4` 가 로그에서 직접 확인된다**
→ m7 의 근거가 아티팩트 하나에서 **둘**로 는다.

*그리고 리뷰 M1 의 전제 자체가 실행으로 반박됐다(리뷰어 기록).* 파이널라이저에 탐침 `print` 를 넣고
태우니 postgres **전량 초록**에서는 히트 **0**, `-q` 를 빼도 **0**, teardown ERROR 가 나는 부분집합에서만
**2** 였다 — **세션 픽스처 teardown 의 stdout 은 초록 실행에서 통째로 버려진다.** `qa` 가 그 전제를
반박한 것이 옳았고, 그래서 출구가 파이널라이저 `print` 가 아니라 `pytest_terminal_summary` 훅이다.

## M-2. 계획·ADR 이 틀린 자리 — **두 건 다 하류(qa)가 잡았다**

| # | 무엇 | 처분 |
|---|---|---|
| 1 | **ADR §1-3 A 의 `795 passed` 는 N=1 이다.** 같은 축의 10회 실측이 **2회 실패**다 | M-2-1. **결론(한 사이클)은 유지, 근거를 바꾼다** |
| 2 | **ADR §2-5 의 바닥값 `191` 이 같은 절의 자기 정의와 어긋났다.** 실제 **181** | M-2-2 + CLAUDE.md §6-3 10회차 |
| 3 | **qa `ac9417d` 커밋 본문의 변이 표에 203-트리 값과 205-트리 값이 섞였다** | M-2-3(qa 는 자기 커밋 본문을 못 고친다 — 마감이 기록한다) |
| 4 | **미식별 흔들림 1회를 아무 목록도 담고 있지 않았다** | §후속 21 |

### M-2-1. "A 층 0 실패"는 성립하지 않는다 — 성립하는 것은 **"대량으로 있지는 않다"** 까지다

> **정정.** ADR 0014 §1-3 A 의 `795 passed` 는 **1회 실행값**이고, `qa` 가 같은 축을 **10회** 돌려
> **2회 실패**를 봤다(작업 5 보고). 그러므로 계획 §1-b 가 착수 크기 판정의 근거로 삼은
> **"A 층 0 실패"는 재현되지 않는 값이다.** 성립하는 것은 **"A 층에 postgres 고유 실패가 *대량으로*
> 있지는 않다"** 까지이고, **판정(한 사이클)은 그 약한 문장으로도 유지된다** — 실제로 한 사이클에
> 들어갔고 CI 가 초록이다.

**아픈 것은 값이 아니라 경로다: 같은 문서가 이미 그것을 반박하고 있었다.**
ADR 0014 는 §4-1 에서 *"delete+re-insert 가 postgres 에서 스캔 순서를 바꾼다"* 를 실측했고,
§5-3 에서 *"677회의 순서는 이 postgres·이 데이터량·이 플래너에서 우연히 견디는 순서였을 뿐"* 이라고
적었다. **그 두 문장이 곧 "이 축의 결과는 실행마다 갈릴 수 있다"인데**, §1-3 A 의 실패 수 0 만은
단일 표본으로 확정했다. CLAUDE.md §6-3 의 *"근거는 문서 안에 다 있었고 결론이 근거를 따라가지
못했다"* 그대로다.

**그리고 내가 쓴 교차 확인 문단이 바로 그 자리를 비켜 갔다.** ADR §5 말미와 계획 §한정어 표 말미의
*"같은 문서의 인접 절과 교차 확인"* 은 두 문장을 **"앞은 실패 수(0), 뒤는 조회 수(677)"** 로 갈라
"둘 다 참"이라고 닫았다. 그 갈라짐이 놓친 것은 **"실패 수 0 자체가 단일 표본"** 이다 — 교차 확인이
두 값의 *의미*는 갈랐는데 *표본 수*는 묻지 않았다.

*역방향 확인 — 이 정정이 무엇을 바꾸지 않나.* 층 A·B·C·D 의 **분해 자체**는 바뀌지 않는다.
B 층 실측(`[B-3]`·`[B-4]`·`[B2-2]`)은 결정론적 코드 경로라 표본 수와 무관하고, C·D 층은 세는 값이다.
흔들린 것은 A 층 **하나**이고, 그 흔들림의 크기(이번 라운드 44회 중 1회 ≈ 2.3%, 그리고 지금까지
관측된 실패가 전부 **한 테스트**)가 "대량이 아니다"를 지지한다.

*그 한정을 2차 심사가 다시 좁혔다(2026-09-07).* 이 문장은 처음에 *"원인이 **한 테스트의 한 단언**"*
이라고 적었는데 **"한 단언"은 참이 아니다** — `qa` 가 흔들리던 칸(심기 **전** 스캔의 순서 단언)을
**집합** 단언으로 좁힌 뒤에도 **같은 테스트가 다시 죽었다**(아래 §M-5 21 의 리뷰어 실측).
남는 것은 *"한 테스트"* 까지이고, **그 테스트의 어느 칸까지가 흔들리는지는 아직 모른다.**

### M-2-2. 바닥값 191 ↔ 181 — **같은 절 26줄 안에서 자기 정의와 어긋났다**

ADR 0014 §2-5 의 표는 `{"min_tests_on_postgres": 191}` 인데, **같은 절의 26줄 아래 역방향 확인**이
*"세야 하는 것은 그 엔진을 **쓴 테스트의 수**다"* 라고 적는다. 191 은 **통합 테스트의 수**이고
그 정의가 가리키는 값이 아니다. **아무도 태우지 않았다.** 실측(qa 작업 5): 통합 205건 중
**181건**이 postgres 엔진 위에서 SQL 을 실행하고 24건은 하지 않는다.

**실해**: 191 을 그대로 썼으면 **옳은 트리가 빨개진다**(205 중 181 < 191). 즉 이 오류는 장식이
아니라 게이트를 거꾸로 작동시키는 값이었다.

**§6-5 문턱 판정 — 닿는다. §6-3 표에 10회차 한 행을 더한다(별도 커밋, 그 절만).**

판정의 근거 셋:

1. **축이 §6-3 이다.** §6-3 표의 7~9회차는 이미 *"같은 실패를 조건절 밖에서"* 반복한 것들이고
   (7 = 근거를 말하는 문서 넷 ↔ 그 근거를 반박하는 응답 문자열), 이번 것은 그 계열이다 —
   조건절이 아니라 **값의 정의**에서 났을 뿐이다. §6-1(전수 목록의 생성 기준)이 아니다.
2. **문턱은 계획 0008 이 12회차에 쓴 것과 같은 것을 쓴다**: *"두 사이클 이상에서 관측되면"*.
   같은 모양의 앞선 관측이 **있다** — §6-1 회차 3(*"0009 계획 §7: 반증 목록을 실측 없이 생각으로 →
   `mapping_count == 6` 이라 적었는데 정상 코드에서 **4**"*). 두 건 다 **계획·ADR 이 실측 없이 쓴
   수가 하류 실행에서 갈렸고**, 두 건 다 **틀린 값이 게이트/단언에 그대로 들어갈 뻔했다.**
3. **새로운 것은 규칙이 아니라 관측 하나다: 잡은 것이 리뷰어가 아니라 하류(`qa`)다.**
   §6-3 이 세 번 되풀이해 적은 문장은 *"잡은 것은 언제나 바깥에서 읽은 리뷰어였다"* 인데,
   **이번엔 그 값을 실행해야 하는 소유자가 실행하는 순간에 갈렸다.** 그 차이가 이 행의 무게다 —
   계획·ADR 이 적는 **수**는 리뷰가 아니라 **실행**이 검증한다.

**규칙 문장은 한 글자도 늘리지 않는다.** §6-3 이 이미 *"같은 문서 안에 이미 반박이 적혀 있어도
결론은 그것을 따라가지 못한다 — 인접 절과 교차 확인한다"* 를 갖고 있고, 없던 것은 규칙이 아니라
**그 규칙이 값에도 걸린다는 근거**다.

*이번에 하지 않은 것 — §6-5 의 문장 하나가 이 관측으로 좁아진다.* §6-5 압축 절의
*"잡은 것은 언제나 바깥에서 읽은 리뷰어였다"* 는 이제 **반례를 갖는다.** 그러나 **CLAUDE.md 는 한
사이클에 한 절만** 만지므로(§6-5 압축 규칙) 이번에는 §6-3 만 고치고 §6-5 는 §후속 25 로 넘긴다.

### M-2-3. §후속 13·14 의 결함이 **이 사이클에 재발했다** (qa `ac9417d` 커밋 본문)

`ac9417d` 의 "강제 셋 자신에 건 변이" 표가 통합 **203건** 트리의 값(`1 failed, 202 passed` ·
`203 passed`)인데 **커밋된 트리는 205건**이고, 같은 표에 205-트리 값(`1 error(teardown), 205 passed`)이
섞여 있다. 즉 한 표 안에 **두 트리의 값**이 있고 어느 칸이 어느 트리인지 표가 말하지 않는다.
**이것이 §후속 13·14 가 이름 붙인 결함**(*"현재형 절대값이 트리를 못박지 않는다"*)의 재발이고,
하필 그 두 항목을 **이 사이클이 이월한 채로** 났다.

리뷰어 재측정(HEAD `62b8bb4`, 205-트리): dialect 단언 삭제 → 두 축 **1 failed, 204 passed** /
`check_contract` 호출 삭제 → postgres 전량 **205 passed**, 부분집합 **12 passed**, sqlite 전량
**205 passed** / 시드 조건 변이 postgres → **1 failed, 18 passed, 187 errors**.
**방향·결론은 전부 같다** — 표가 말하는 것("이 변이는 죽는다")은 두 트리에서 같고, 틀린 것은
절대값이 어느 트리의 것인지다. `qa` 는 자기 커밋 본문을 고칠 수 없으므로 **정정은 여기다.**

### M-2-4. 이 마감이 우연히 잰 것 — **계약의 실패 문구가 경위를 잘못 지목한다**

이 마감의 `pytest -q`(sqlite 축)가 `test_99_db_axis_contract.py::test_axis_mode_matches_the_environment`
에서 죽었다. 실패 문구는 **`"sqlite 모드가 postgres.measured.json 을 건드렸다"`** 인데,
**건드린 것은 이 실행이 아니라 병렬로 그 파일을 편집하던 `qa` 다**(mtime `08:54:09`,
`git status` 가 그 파일을 `M` 으로 보였다). 계약은 *"실행 전후로 파일이 같다"* 를 재는데
문구는 *"sqlite 모드가 썼다"* 로 **원인을 하나로 단정한다.**

**이것은 CLAUDE.md §6-4 2 가 이름 붙인 모양이다** — 문구가 "무엇이 일어났는가"를 말할 때 관측하지
않은 경위를 지목하면, 다음 사람이 그 문구를 믿고 엉뚱한 곳을 판다. 소유가 `qa` 라 이 마감이 고치지
않고 **§후속 22** 로 넘긴다. *다만 이 관측의 한계*: 이 배역(에이전트 둘이 같은 트리를 동시에
만지는 것)은 **CI 에서는 나지 않는다** — 그래서 우선순위는 낮다.

## M-3. 아티팩트 개봉 · CI 환경 (m7)

**열었다.** run `34098577780` / job `101668172383` 의 `postgres-measured`(artifact id
**10009704058**, 491 B). 내용 전문:

```json
{ "_comment": "generated by tests/integration/conftest.py (postgres 모드에서만) — 손으로 고치지 않는다. …",
  "dialect": "postgresql", "server_version": "16.4",
  "tests_on_postgres": 181, "engines": 1,
  "floor": { "min_tests_on_postgres": 181 } }
```

**CI 의 `tests_on_postgres` = 181 이고, 커밋된 바닥값과 정확히 같다.**

| 물음 | 답 |
|---|---|
| 181 과 같은가 | **같다** |
| 바닥값을 올릴 것인가 | **올리지 않는다.** 올릴 여유가 **0** 이다 — 측정값이 곧 바닥값이라 한 칸도 위가 없다 |
| 그러면 이 값이 말하는 것은 | 바닥값이 **딱 붙어 있다**. 감시로는 가장 예민한 상태(한 건만 축을 벗어나도 빨개진다)이고, 동시에 **여유가 0 이라 정상 변동에도 빨개질 수 있는 상태**다. 통합 테스트가 늘면 `qa` 가 바닥값을 따라 올려야 한다(부등호가 `>=` 라 자동으로 따라오지 않는다 — §리스크 2) |

**m7 — CI 환경이 이 사이클의 모든 실측과 다르다(잡 로그에서 직접 읽었다):**

| | 이 사이클의 실측 | CI |
|---|---|---|
| PostgreSQL | **16.13** (Ubuntu 16.13-0ubuntu0.24.04.1) | **16.4** (Debian 16.4-1.pgdg110+2) |
| PostGIS | **부재**(`pg_available_extensions` 에도 0건) | **실제 로드**(`Loading PostGIS extensions into buildtwin_test` + `CREATE EXTENSION` **넷**) |
| locale | `C.UTF-8` | `en_US.utf8` |

**무해함의 근거**: `server_version` 은 **기록 전용**이다. 이 마감의 실행값
(`git grep -n "server_version" 62b8bb4 -- ':!buildtwin/docs'` — **커밋된 트리**에 대고 쟀다):
히트 **5건**이고 전부 `postgres_axis.py` 의 필드 선언(`:104`)·채움(`:116-117`)·직렬화(`:141`)와
`postgres.measured.json:4` 의 값이다 — **단언·비교 0건.** 그래서 커밋값 `16.13` ↔ CI `16.4` 는
CI 를 빨갛게 만들지 않는다(실제로 초록이었다).

*이 실행값을 커밋된 트리에 대고 잰 이유*: 마감 시점의 작업 트리에는 `qa` 의 **미커밋 편집**이 있었고
(M-0), 그 편집이 `test_99_db_axis_contract.py` 에 **합성 값** `server_version="16.13"` 을 하나 들인다
(로그 한 줄 포맷터를 붙드는 테스트의 입력이지 **실제 서버에 대한 단언이 아니다**). 그것이 그대로
커밋되면 저장소에 `"16.13"` 이라는 문자열이 하나 더 생기므로, §후속 23 이 그 자리도 함께 본다.
**미커밋 상태를 사실로 인용하지 않으려고 위 수치는 `62b8bb4` 에서 쟀다.**

*그 미커밋 편집이 그 뒤 커밋됐다(`19c0b3b`).* 이 마감이 `bf049be` 에서 다시 쟀다: 히트 **8건**으로
늘었고 새 셋은 `postgres_axis.py:147`(로그 한 줄 포맷)과 `test_99_db_axis_contract.py:122,126`
(**그 포맷터를 붙드는 테스트의 합성 입력**)이다 — **여전히 실제 서버 값에 대한 단언·비교는 0건**이고
`"16.13"` 문자열이 저장소에 둘 더 생겼다(§후속 23 이 그 자리도 본다). 위 5건은 `62b8bb4` 의 값이고
이 문장이 `bf049be` 의 값이다 — **두 수는 다른 트리의 값이지 불일치가 아니다**(§후속 13·14 의 형식).

**바닥값 여유 0 은 감수할 값이라고 판정됐다(2차 심사, 지적 없음)** — 근거는 *"조용히 통과하는 것보다
시끄럽게 죽는 것이 낫다"* 이고, 관측은 CI 두 실행 연속 181 · 로컬 다수 실행도 181 · 변동 관측 0 이다.
**다만 그 판정이 기대는 전제는 "CI 의 181 이 실행마다 같다"이고 표본은 CI 2회뿐이다** — §M-4 15 가
그 한정을 싣는다.

**m7 의 근거가 하나에서 둘로 늘었다.** CI 의 `16.4` 는 ① 서비스 컨테이너 기동 로그
(`starting PostgreSQL 16.4 (Debian 16.4-1.pgdg110+2)`, run `34098577780`)와 ② 축이 스스로 찍는
`[db-axis] … server_version=16.4`(run `34105054598`) **둘에서** 읽힌다.

**그러나 두 가지가 열린 채로 남는다 — §M-4 17·18 에 적는다.**

## M-3-b. CLAUDE.md 을 얼마나 늘렸는가 · §6-5 문턱 판정의 산출물

이 사이클이 CLAUDE.md 를 만진 것은 **이 마감 한 번**뿐이고 **§6-3 한 절**이다(M-2-2 판정).

| | `62b8bb4` | `737bbc3`(이 마감의 CLAUDE.md 커밋) | Δ |
|---|---|---|---|
| CLAUDE.md 전체 | 448줄 27,585자 | 450줄 28,042자 | **+2줄 +457자** |
| §6 | — 16,491자 | 16,948자 | +457자 |
| §6 비중(자) | 59.8% | **60.4%** | +0.6%p |
| §6-1 / §6-2 / §6-3 / §6-4 / §6-5 | 5,786 / 871 / **4,790** / 958 / 3,417자 | 5,786 / 871 / **5,247** / 958 / 3,417자 | **§6-3 만 +457, 나머지 넷 Δ자 0** |

**늘어난 것은 표 한 행(개행 포함 **391자**)과 머리말의 회차·열거 갱신(**+66자**)뿐이다 — 합 457.** 머리말을 함께 고친 이유는 그 문장이
*"재발 **9건**. … **7~9 는** …"* 라는 **개수와 열거**를 싣기 때문이다 — 행만 더하고 두면 그 문장이
같은 커밋에서 거짓이 된다(§6-1 회차 9: *"열거는 길이가 곧 개수다"*). **규칙 문단은 한 글자도 바꾸지
않았다.**

*측정 관례*: 절을 `text[text.index("### 6-1."):text.index("### 6-2.")]` 로 잘라 다음 절 제목 앞의
개행 한 자를 포함시킨다(계획 0008 §M-3 이 적은 관례 그대로 — 그래서 `62b8bb4` 의 §6-1 5,786 =
계획 0008 이 `211242c` 에서 잰 5,747 + `382c746` 의 +39 로 이어진다).

## M-3-c. §후속 10 판정 — **닫는다. 한정어와 함께, 그리고 근거는 CI 실행값이다**

본문 §후속 10 이 *"이 사이클의 대상. **마감에서 판정한다**"* 로 넘긴 자리다(본문은 기록물이라
고치지 않는다 — §3-13).

> **§후속 10 을 닫는다 — *"postgres 에서 아무 테스트도 돌지 않는다"* 하나에 한해서.**

**닫힘의 근거를 로컬 실측이 아니라 CI 실행값으로 적는다.** 이것이 이 판정의 핵심이다 —
이 사이클의 §M-4 18 이 이름 붙인 모양(*"로컬에서 태우고 CI 에 대해 말한다"*)을 닫는 문장 자신이
반복하면 안 된다. run **`34105054598`** job **`101688740406`** 의 잡 로그 실행값(이 마감이 직접
읽었다):

```
[db-axis] dialect=sqlite tests_on_postgres=0 engines=0 (BUILDTWIN_CI_POSTGRES_URL 없음 — postgres.measured.json 을 건드리지 않았다)
207 passed, 1 warning in 33.65s
[db-axis] dialect=postgresql server_version=16.4 tests_on_postgres=181 engines=1 floor=181 measured_file=postgres.measured.json
207 passed, 1 warning in 37.14s
```

| §후속 10 이 적었던 것 | 지금 | 근거 |
|---|---|---|
| `BUILDTWIN_CI_POSTGRES_URL` 을 읽는 코드 **0건** | 읽는다 | 위 둘째 `[db-axis]` 줄이 그 이름으로 붙은 결과다 |
| 드라이버 선언 **0건** | `psycopg[binary]` 본 의존성 | CI 설치 로그 `psycopg-3.3.5 psycopg-binary-3.3.5` |
| sqlite 가 아닌 DB 로 도는 테스트 **0건** | **181건**이 postgres 엔진 위에서 SQL 을 실행한다 | `tests_on_postgres=181`(CI 두 실행 연속) |
| `main.py:28` 때문에 postgres 로 돌리면 인증부터 죽는다 | 죽지 않는다 | postgres 스텝 **207 passed** |

**닫지 않는 것 — 같은 항목이 열고 있던 다른 축들.** ADR 0014 §5-3 의 677(무정렬 다중행 조회)이
그 구별의 실측이고, 축들은 §후속 **16**(`tests/unit`) · **17**(정렬 미지정 42자리) · **18**(시드
분리) · **21**(흔들림) · **24**(PostGIS) 로 번호를 받았다. **"postgres 잡이 초록이다"와 "postgres 에서
검증된다"를 한 문장으로 합치는 것이 이 항목이 겨냥한 결함 자신**이므로, 닫는 문장에 한정어를 남긴다.

## M-4. 확인하지 않은 것

**본문 §이 계획이 확인하지 않은 것 1~16 을 번호를 붙여 그대로 옮기고**(계획 0008 §M-2-2 규칙 —
새로 쓰지 않는다), 마감이 처분한 것은 처분을 적고, 새로 더한 것은 표시해 뒤에 붙인다.

1. ~~postgres 를 켜 보지 않았다.~~ → **켰다**(본문 §과제 1·3-a). *다만* **CI 의
   `postgis/postgis:16-3.4` 에서는 여전히 아무것도 재지 않았다** — 잡 로그를 **읽기만** 했다.
2. **정렬 축을 바꾸는 변이는 계획 0008 §M-2-1 이 잰 하나(`review_request_id`)뿐이고**, 역순 정렬·
   다른 키는 이 사이클도 재지 않았다.
3. **`persistence.py:455`(§후속 8)의 `.desc()`→`.asc()` 변이는 이번에도 재지 않았다.**
4. **§Deferred 1~6 을 재측정하지 않았다.**
5. ~~웹을 태우지 않았다.~~ → **태웠다**(작업 3 의 `make test`: vitest 28 files / 283 tests).
   *다만* **`make e2e` Playwright 스모크는 실행하지 않았다.**
6. ~~`make lint` 를 돌리지 않았다.~~ → **돌렸다**(작업 3: exit 0. 리뷰어도 `62b8bb4` 에서 exit 0).
7. **§6-5 · §6-1 · §6-3 의 근거 표면을 재지 않았다.** 이 사이클이 **§6-3 을 편집하므로**, 다음
   사이클은 이 마감의 CLAUDE.md 커밋을 기준으로 잰다.
8. **qa 가 보고한 서버 변이 14건을 재현하지 않았다**(출처 계획 0006 §M-6).
9. **`df37433`·`716d67d` 직전 트리를 체크아웃해 803·804 를 재현하지 않았다.**
10. **§6-1 12회차 외 다른 행의 관측값을 재현하지 않았다.**
11. **`postgis/postgis:16-3.4` 이미지에서 재지 않았다** → 위 1 과 같은 자리. **잡 로그로 환경을
    확인했을 뿐 그 위에서 변이를 태우지 않았다.**
12. **`[PG-after-update-*]` 가 순서를 바꾸지 않은 기전을 확인하지 않았다**(HOT update 가설,
    `pg_stat_*` 카운터를 읽지 않았다).
13. **`tests/e2e` 를 postgres 로 돌려 보지 않았다.**
14. **`[ORD]` 677 은 `tests/integration` 한 트리의 값이다.**
15. ~~바닥값이 CI 에서 실제로 그 수가 되는지 재지 않았다.~~ → **읽었다. CI 두 실행 연속 181 이다** —
    run `34098577780` 의 아티팩트(M-3)와 run `34105054598` job `101688740406` 의 **잡 로그 한 줄**
    (`[db-axis] … tests_on_postgres=181 … floor=181`). *다만 표본은 **CI 2회**이고*, 그 수가
    실행마다 같다는 것은 **바닥값 여유 0 을 감수하는 판정이 기대는 전제**다(M-3) — 전제가 2표본
    위에 서 있다는 뜻이지 반증됐다는 뜻이 아니다.
16. ~~`psycopg` 를 `pyproject.toml` 에 넣고 설치를 돌려 보지 않았다.~~ → **돌렸다**(qa: `pip
    install --dry-run -e ".[dev]"` 충돌 없음, CI: `psycopg-3.3.5 psycopg-binary-3.3.5` 설치 성공).

**신규(이 마감이 더한다):**

17. **커밋된 `postgres.measured.json` 은 CI 가 재현하지 않는 환경을 영구히 기술한다.**
    그 파일은 `server_version: 16.13`(로컬)인데 CI 는 `16.4` 를 쓰고, 파일 자신이 *"손으로 고치지
    않는다"* 라고 적는다. 즉 **커밋값을 CI 값으로 맞출 경로가 없다**(CI 는 아티팩트로만 남긴다).
    지금은 무해하지만(단언 0건), 그 무해함이 **설계가 아니라 우연**인지는 재지 않았다.
18. **ADR §1-4 · 계획 §목록 C 의 "PostGIS 없이 선다"는 태워서 참이지만 CI 환경에 대한 진술이
    아니다.** 반대 방향 — **PostGIS 가 있을 때 무엇이 달라지는가** — 은 아무도 재지 않았다.
    CI 는 확장 넷이 로드된 DB 를 쓰는데, 그 위에서 잰 것은 "205 passed" 하나다.
19. **postgres 축의 흔들림을 이 마감이 직접 재지 않았다.** 표본은 qa 10회(2회 실패, 고치기 전) +
    qa 33회(1회 미식별) + 리뷰어 1차 25회(0회) + **리뷰어 2차 44회(1회, 테스트가 특정됨)** =
    **누적 102회 중 2회, 그중 1회는 어느 테스트인지 특정됐다**(§M-5 21). **이 마감의 표본은 여전히
    0 회**다 — `qa` 가 같은 트리를 병렬 편집 중이라 재실행이 그 편집과 경합했다(M-0·M-2-4).
    *기전은 두 표본 모두에서 잡히지 않았다.*
20. ~~`make test` 를 clean 트리에서 다시 돌리지 못했다.~~ → **2차 심사 처분에서 돌렸다**
    (`bf049be`, clean): `pytest -q` **823** · `make test` **492/104/8/207 + 283** ·
    `make lint` **exit 0** · postgres 통합 **207**(§M-1 (나)·M-1-c). *다만* **`62b8bb4` 의 값은
    끝내 내가 재지 못했다** — 첫 판에서 잰 두 값(821 수집 / 823 passed)은 `qa` 의 미커밋 편집을
    포함한 트리의 값이었고(M-0 표), 그 트리는 이제 존재하지 않는다. §M-1 (가)는 **리뷰어 실측**이다.
    **`make e2e` 는 여전히 돌리지 않았다.**
21. **CI 초록의 표본은 2회다.** run `34098577780`(205/205) 과 run `34105054598`(207/207).
    두 실행 모두 이 워크플로 형태이고, 그 사이에 통합 테스트가 둘 늘었다.

## M-5. 후속 (본문 §후속 에 이어서 — 번호를 잇는다)

21. **postgres 축의 흔들림 — 테스트는 특정됐고 기전은 아직이다**(qa).
    **"flake 를 없앤다"가 아니다.** 이 항목의 전제가 2차 심사에서 **바뀌었으므로 먼저 사실을 적는다.**

    **리뷰어 2차 실측(2026-09-07).** 훅 삭제 변이를 태우던 중 postgres 전량이
    **`1 failed, 206 passed`** 로 죽었다(같은 변이에서 sqlite 는 **207**). 죽은 것은
    `tests/integration/test_20_mapping_decision_cancel.py::test_cancel_names_the_decision_by_created_at_even_when_the_db_scan_order_is_reversed`
    이고 **같은 실행의 나머지 206건은 통과했다.**
    *귀속 근거*: 트레이스백이 실은 docstring 문자열이 저장소에서 그 자리 하나뿐이다 — 이 마감의
    실행값 `grep -rn "\`136e66f\` 실측 805 passed, 계획 0007 §후속 9" .` 의 소스 히트가
    `test_20_mapping_decision_cancel.py:796` **한 곳**이다.
    *변이가 DB 동작에 닿지 않으므로*(세션 끝 터미널 한 줄) 이 관측은 HEAD 로 그대로 옮겨진다.
    이어 clean HEAD 에서 **40회** 돌려 **40/40 초록** — 이번 라운드 **44회 중 1회 ≈ 2.3%** 이고
    `qa` 의 1/33 ≈ 3% 와 같은 크기다.

    **그러므로 "환경 요인과 구별하지 못했다"는 더는 이 항목의 전부가 아니다 — 적어도 한 번은
    환경 요인이 *아니다*.** 컨테이너가 죽었다면 `tokens` 픽스처부터 무너져 **190+ errors** 가 되는데
    (실측 선례: `ac9417d` 본문의 `2 failed, 11 passed, 191 errors`), 그 실행은 **206 passed +
    정확히 1 failed** 였다. **다음 사이클이 옛 문장을 읽으면 컨테이너부터 파서 헛다리를 짚는다** —
    그래서 이 문장을 고치는 것이 이 항목의 첫 산출물이다.

    **남은 후보 칸은 하나다**: 심기 **뒤**의 순서 단언
    `assert [x[0] for x in after] == [second_decision_row, first_decision_row]`
    (`test_20_mapping_decision_cancel.py:865`). `qa` 가 좁힌 것은 심기 **전** 칸이고 이 칸은
    그대로 남아 있다. **그러나 그 칸이라는 것도, 기전도 아직 잡지 못했다** — 리뷰어의 합성 탐침 둘
    (깨끗한 힙 / `VACUUM` 으로 앞 페이지에 빈 자리를 만든 힙)은 재현에 실패했다.
    *리뷰어의 추정(추측이라고 명시했다)*: PostgreSQL 은 delete+re-insert 된 튜플이 힙 **맨 뒤**에
    앉는 것을 보장하지 않는다(FSM 이 앞 페이지의 빈 자리를 줄 수 있다) — 그렇다면 **심기 자체가 이
    축에서 결정론적이지 않다.** 그것이 참이면 ADR 0014 §4-1 의 `[PG-after-delete-reinsert]` 는
    *"이 힙 상태에서는 뒤집힌다"* 까지만 말하는 값이 된다.

    **이 항목이 요구하는 것은 여전히 "다음 발생이 판별 가능한 상태"** 이고, 이제 판별해야 하는 축이
    셋이다: ⓐ 컨테이너 사망 ⓑ 심기 비결정성(FSM) ⓒ 그 밖. **재현 실패는 식별이 아니다** —
    40/40·25/25 초록은 "없다"가 아니라 "이 표본에서 다시 안 났다"이다.
    (M3① = CI 실패 출력 보존은 같은 사이클의 `qa` 가 `bf049be` 로 처리했다: `-rfE`·`--tb=short`·
    junit 아티팩트.)

    *이 마감이 더 재서 적는 한 가지 — 귀속 수단의 한계.* 위 귀속은 **docstring** 문자열로 했고 그것은
    유일하다. 그런데 그 테스트의 **단언 메시지**(`"심기가 먹지 않았다 — 스캔 순서가 그대로면 이
    테스트는 정렬 유무를 구별하지 못한다"`)는 **유일하지 않다** — 이 마감의 루트 실행값에서 소스 히트
    **2건**이고, 둘째가 단위 짝
    `tests/unit/progress/test_document_mapping_review_lifecycle.py` 다. 전량 실행에서 그 문구로
    귀속하면 **두 후보가 나온다.** 다음 사람이 쓸 귀속 수단은 **노드 id**(지금 `bf049be` 의 `-rfE` 가
    찍는다)이지 단언 메시지가 아니다.
22. **`postgres_axis` 계약의 실패 문구가 경위를 하나로 단정한다**(qa, M-2-4).
    `"sqlite 모드가 postgres.measured.json 을 건드렸다"` 는 **관측하지 않은 경위를 지목한다** —
    실제로 관측되는 것은 *"이 실행 전후로 파일이 달라졌다"* 이고, 쓴 주체는 이 실행일 수도, 밖에서
    파일을 고친 사람일 수도 있다(이 마감이 후자를 실제로 만났다). CLAUDE.md §6-4 2 의 자리다.
23. **`postgres.measured.json` 의 `server_version` 을 어떻게 할지**(qa + architect, §M-4 17).
    커밋값(로컬 16.13)과 CI 값(16.4)이 영구히 어긋나고 맞출 경로가 없다. 선택지는 셋 —
    ⓐ 그대로 두고 "이 필드는 마지막으로 *커밋한 사람의* 환경이다"를 파일에 적는다
    ⓑ 필드를 커밋 대상에서 뺀다(아티팩트에만 남긴다) ⓒ CI 가 값을 되쓴다. **지금 무해한 이유는
    단언이 0건이기 때문이고, 그 무해함은 설계가 아니라 우연이다.**
24. **PostGIS 가 로드된 DB 에서 무엇이 달라지는가**(qa, §M-4 18). 이 사이클의 모든 실측은
    **PostGIS 부재** 환경이고 CI 는 **확장 넷이 로드된** 환경이다. 두 환경의 차가 오늘 스키마에
    없다는 것은 *추론*이지 실측이 아니다. ADR 0003(기하 JSON 우선)·CLAUDE.md §1(PostGIS 스택)이
    만나는 자리라 답이 나오면 ADR 0014 §Deferred 4(이미지 경량화)도 함께 판정된다.
25. **CLAUDE.md §6-5 의 *"잡은 것은 언제나 바깥에서 읽은 리뷰어였다"* 를 좁힌다**(architect, M-2-2).
    이 사이클이 **반례**를 만들었다 — 191↔181 을 잡은 것은 리뷰어가 아니라 **그 값을 실행해야 하는
    소유자(`qa`)** 다. 이번에 고치지 않은 이유는 **CLAUDE.md 를 한 사이클에 한 절만** 만지기
    때문이고, 이 사이클은 §6-3 을 골랐다.
26. **§확인하지 않은 것 중 *다음 행동이 필요한 항목*에 소유를 배정한다**(architect, 리뷰어 지적).
    본문 §M-4 15 는 *"CI 에서 실제로 그 수가 되는지 재지 않았다"* 까지만 적고 **누가 언제 읽는지를
    아무에게도 배정하지 않았다** — 이 마감이 아티팩트를 열어 채웠지만, 그것은 리뷰어가 지목했기
    때문이지 목록이 시켰기 때문이 아니다. 목록의 항목은 **"재지 않았다"** 와 **"재야 한다"** 를
    구별해야 하고, 후자에는 소유가 붙어야 한다.
27. **postgres 축에서 "0 실패"·"전부 통과" 같은 부정 단정을 쓸 때는 N 을 함께 적고 N≥10 으로
    잰다**(architect + qa, M-2-1). 근거는 이 사이클의 실측이다 — **N=1 이 20% 확률로 거짓인 값을
    냈고**(같은 축 10회 중 2회 실패), 그 값이 착수 크기 판정의 근거로 쓰였다. *한정*: 이 문턱은
    **postgres 축**(실행마다 갈릴 수 있는 축)에 거는 것이지 결정론적 코드 경로 단정에 거는 것이
    아니다 — B 층 실측(`[B-3]`·`[B-4]`·`[B2-2]`)은 N=1 로 충분하고, 그 구별을 지우면 모든 실측이
    10배 비싸진다.

28. **강제 셋의 배선 둘은 지워도 전량이 초록이다**(qa, 리뷰어 실측 — **이번 사이클에서 닫지 않는다**).
    무보호인 배선은 둘이다: ① 파이널라이저의 `check_contract(...)` **호출** ②
    `pytest_terminal_summary` **훅**. 리뷰어 실행값 — 훅을 통째로 지우면 sqlite 통합 **207 passed**
    (`[db-axis]` 줄만 조용히 사라진다), 형제(①의 호출 삭제)도 같다. **지금 이 둘은 코드 주석에만
    적혀 있고**, 그것이 §M-2 4 가 이 사이클의 결함으로 적은 상태 그대로다 — 그래서 번호를 준다.
    **붙들려면 하위 프로세스 pytest 실행이 필요하다**(그 배선이 없는 트리를 자식 프로세스로 돌려
    출력·종료코드를 부모가 단언하는 형태).
    *이번에 닫지 않는 것이 옳다는 판정의 근거*: 사이클 끝에 **새 기구**(하위 프로세스 실행)를 들이는
    것은 CLAUDE.md §6-3 9회차가 경고하는 자리다 — *"축을 바꾸면 무주공산은 없어지지 않고 자리를
    옮긴다."* 새 기구는 자기 몫의 무보호 배선을 갖고 오고, 그것을 다시 볼 사이클이 이번에는 없다.
