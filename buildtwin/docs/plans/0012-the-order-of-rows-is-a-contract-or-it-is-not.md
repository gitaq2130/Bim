# 계획 0012 — §후속 17: 정렬 미지정 자리의 **순서 계약** (+ CLAUDE.md §6-3 병행 커밋)

- 상태: 착수
- 작성: architect
- 날짜: 2026-09-07
- 관련: `docs/plans/0011-the-measured-file-is-a-shared-resource.md`(직전 사이클),
  `docs/plans/0009-postgres-coverage-gap.md` §후속 17(이 항목을 연 자리),
  `docs/adr/0014-database-as-a-test-parameter.md` §5-3(`[ORD]` 677),
  `docs/adr/0015-heap-placement-is-not-a-test-contract.md` §2-1 · §Deferred 3 · §Deferred 6,
  `docs/adr/0016-ordering-is-a-contract-only-where-a-consumer-picks-one-row.md`(이 사이클이 쓴다),
  CLAUDE.md §3-13 · §6-1 · §6-2 · §6-3 · §6-4 · §6-5

---

## 0. 이 문서의 실측이 나온 자리 (재현 방법)

**작업 트리** `/home/user/Bim/buildtwin`, **저장소 루트 `/home/user/Bim`**, 브랜치
`claude/buildtwin-initial-setup-ubulzb`, **HEAD `08238c9`**, 루트 `git status --porcelain` 빈 출력.

**이 문서의 모든 `파일:줄`·커밋 참조는 HEAD `08238c9` 트리의 것이다**(CLAUDE.md §3-13 첫째 갈래).
**못박음을 좁히지 않는다 — 전체를 못박고 예외를 이름으로 적는다**(계획 0011 §후속 36 이 이름 붙인
결함이 정확히 "범위를 좁혀 남은 자리가 어느 못박음에도 안 걸리게 되는 것"이다). **예외는 셋뿐이다:**

- **㉮ 다른 문서를 인용하는 줄** — 계획 0009·0010·0011 과 ADR 0014·0015 를 인용할 때는 **그 문서가
  못박은 트리**(`5beb954`·`743bcb9`·`711e12f`·`3dddf58`)를 그대로 말한다. 그 자리에서 트리를 적는다.
- **㉯ §1-a 의 0009 트리 재계수** — `5beb954` 를 `git archive` 로 꺼내 잰 값이다. 그 표는 **두 트리의
  값을 나란히** 싣고 어느 칸이 어느 트리인지 칸마다 적는다(계획 0009 §M-0 이 세운 형식).
- **㉰ 이 계획의 마감 절** — 이 사이클 커밋 뒤의 트리. 그 절 머리에서 트리를 다시 못박는다.

**DB.** 이 계획이 쓴 포트는 **55438** 이다. 착수 시 실측: `ss -ltn | grep 5543` → **히트 0**,
`pg_lsclusters` → `16 main 55432 down`.
**[정정 — §M-3-2. 이 줄의 「히트 0」은 관측이 아니다.]** 이 컨테이너에 **`ss` 가 없다**(`which ss`
exit 1). 그 명령은 stderr 를 `/dev/null` 로 버려서 **도구 부재가 「히트 0」과 구별되지 않았다.**
포트가 비어 있었다는 **결론은 살아 있지만 근거가 다르다** — 그 근거는 그 다음에 한
`pg_ctl … -p 55438 start` 가 **성공했다**는 것이다(포트가 물려 있었으면 bind 가 실패한다).
`pg_lsclusters` 쪽은 참이되 **남의 임시 클러스터는 보이지 않는다**. 그래도 55432 를 쓰지 않은 이유는 계획 0010 §M-9 26 이 이름
붙인 것이 *"동시에 두 사람"* 이라서다. 관측된 사용 이력: qa 55432·55435 · 리뷰어 55432·55436 ·
architect 55433(0010) · 55434·55437(0011) · **architect(이 계획) 55438**.
`/usr/lib/postgresql/16/bin/initdb -D /var/lib/postgresql/pg0012 -A trust -U postgres` 로 **내 클러스터를
따로 띄웠다**(`-p 55438 -c listen_addresses=127.0.0.1`). 실행값
`PostgreSQL 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)`,
`autovacuum=on · autovacuum_naptime=60 · autovacuum_vacuum_threshold=50 · autovacuum_vacuum_scale_factor=0.2`
(전부 `pg_settings`). 축 URL 은 `postgresql+psycopg://postgres@127.0.0.1:55438/buildtwin`.

**탐침**은 **저장소 밖 pytest 플러그인**(`/tmp/pgprobe0012/ord_probe.py`, `-p` 로 붙임)이고 `tests/` 에
파일을 만들지 않았다. **운영 코드 변이는 저장소 밖 스크립트**(`.../scratchpad/mut.py`)가
적용 → 측정 → **원복**을 한 건씩 했고, 매 건 뒤 루트 `git status --porcelain` 이 **빈 출력**임을 확인했다
(그 확인은 스크립트의 `finally` 가 출력한다).

**기준선(clean `08238c9`, 위 환경).**

| 축 | 명령 | 실행값 |
|---|---|---|
| sqlite 전량 | `.venv/bin/pytest -q` | **832 passed** (157.44s) |
| postgres 통합 | `BUILDTWIN_CI_POSTGRES_URL=…55438… pytest -q tests/integration` | **216 passed** (50.06s), `[db-axis] dialect=postgresql server_version=16.13 tests_on_postgres=181 engines=1 floor=181 measured_file=postgres.measured.json(썼다)` |
| 전량 실행 뒤 트리 | `git status --porcelain` | **빈 출력** |

지시받은 기준선(832 / 492·104·8·216 + vitest 283 / lint exit 0 / 216·181·1·181)과 **갈린 자리가 없다.**

**커밋 직전 게이트(이 사이클의 `docs/`·`CLAUDE.md` 편집 셋을 담은 트리에서 다시 돌렸다 —
§확인하지 않은 것 20 이 배정한 칸).**

| 명령 | 실행값 |
|---|---|
| `make test` | **492 · 104 · 8 · 216** + vitest **283**(28 files). 통합 갈래의 축 줄: `[db-axis] dialect=sqlite tests_on_postgres=0 engines=0 (BUILDTWIN_CI_POSTGRES_URL 없음 — postgres.measured.json 을 건드리지 않았다)` |
| `make lint` | **exit 0** |
| 뒤의 `git status --porcelain` | 이 사이클의 편집 셋만 — `M buildtwin/CLAUDE.md` · `?? buildtwin/docs/adr/0016-…` · `?? buildtwin/docs/plans/0012-…`(테스트가 트리를 더럽히지 않았다) |

*한정*: `make test` 의 통합 갈래는 축 이름이 없어 **sqlite** 로 돈다 — postgres 축의 216·181 은 위 표의
별도 실행이 잰 값이다. **이 셋은 `docs/`·`CLAUDE.md` 만 바꾼 트리의 값이라 코드 결과가 바뀔 수 없다**
(어떤 테스트도 그 셋을 import 하지 않는다) — 그래도 돌린 것은 CLAUDE.md §3-1 이 요구하는 것이
*"바뀔 수 있었나"* 가 아니라 *"돌렸나"* 이기 때문이다.

---

## 1. 이 사이클이 답하는 것

**리뷰어가 두 사이클에 걸쳐 확정한 순서에서 이 사이클은 §후속 17 이다.** §후속 16(`tests/unit` →
postgres)이 열리면 순서 의존 실패가 한꺼번에 뜨는데 **판정할 계약이 없다.** 판단 축은 이미 섰다 —
ADR 0015 §2-1: **기댈 것은 `created_at` **값**이지 물리 배치가 아니다.** 이 계획이 하는 일은 그 축을
**42(→ 다시 센 값)자리에 개별로 적용**해 ⓐ/ⓑ/ⓒ 로 가르고, **ⓐ 로 갈린 자리만 이번에 닫는 것**이다.

### 1-a. **42 를 다시 셌다 — 35 다. 그리고 차이는 전부 휴리스틱이지 트리 변화가 아니다**

#### ① 이 목록의 생성 기준

**전수 목록은 저장소 루트에서 만든다**(CLAUDE.md §6-1). 루트에는 `buildtwin/` 말고도 무관한 트리가
여럿 있어 **제외를 명시한다**:

```
$ grep -rn "select(" . --include='*.py' \
    --exclude-dir=.git --exclude-dir=.venv --exclude-dir=node_modules --exclude-dir=__pycache__ \
    --exclude-dir=.mypy_cache --exclude-dir=.pytest_cache \
    --exclude-dir=android --exclude-dir=app --exclude-dir=artifact --exclude-dir=components \
    --exclude-dir=lib --exclude-dir=public | grep -v '/design_handoff_'
```

실행값: **파일 28개**. 그중 `buildtwin/services/` + `buildtwin/packages/` = **63 히트**(계획 0009 가
적은 63 과 같다), `buildtwin/tests/` = 33 히트.

**세는 단위를 텍스트에서 AST 로 옮겼다.** 셀 것은 "`select(` 라는 글자"가 아니라 **`select(...)` 호출
하나**이고, `.order_by()` 는 **같은 줄에 있을 필요가 없다**(체인이 여러 줄에 걸리거나, `stmt = select(...)`
뒤 `stmt.order_by(...)` 로 나중에 붙는다). 그래서 `ast` 로 ① `select` 이름 호출을 모으고
② 그 호출에서 시작하는 **속성·호출 체인**을 끝까지 걸어 `order_by` 가 있는지 보고
③ 없으면 **그 호출을 감싸는 함수 범위 안에서만** `<대상>.order_by(` 를 찾았다.

#### ② 그 기준이 놓치는 것 (§6-1 ②를 **이 새 기준에 대해 처음부터 다시** 답한다)

- **ⓐ `select()` 가 아닌 조회.** `session.get()` 은 SELECT 를 쏘지만 이 목록 밖이다.
  `session.query()`(레거시 ORM), `text()` 원시 SQL, `exec_driver_sql`, `relationship()` 의 lazy 로딩도 밖이다.
- **ⓑ 서브쿼리.** `select(...)` 가 `in_()` 안에 들어가는 자리는 **행을 돌려주지 않는다** — 그래도 호출로
  세어진다(목록의 14번이 그것이다). 세어 놓고 판정에서 가른다.
- **ⓒ 문자열 안의 `select(`.** 주석·docstring 은 AST 가 거르지만 grep 은 못 거른다.
- **ⓓ `tests/` 트리.** 세는 대상은 **운영 코드**다. 테스트가 자기 단언을 위해 무정렬 조회를 하는 것은
  이 항목의 축이 아니다(그 축은 §후속 16 이 연다).
- **ⓔ 정렬이 **있는데 틀린** 자리.** 이 기준은 `order_by` 의 **유무**만 본다. `order_by` 가 걸렸으나
  타이가 남는 키(예: `created_at` 하나 — 같은 마이크로초 두 행)는 목록 밖이다.
- **ⓕ 클라이언트 정렬.** 서버가 무정렬로 주고 **화면이 정렬하는** 자리는 서버 목록에 ⓑ 로 남지만,
  화면이 그 정렬을 **잃으면** ⓐ 가 된다. 이 목록은 그 방향을 세지 않는다.

#### ③ 블라인드 스팟을 태웠다 — **셋을 실제로 실행했다**

| 태운 것 | 명령 | 실행값 | 판정 |
|---|---|---|---|
| ⓒ 문자열 안의 `select(` | grep 63 히트 ↔ AST 62 호출의 차집합 | **`services/progress/persistence.py:223`** — `predecessors_of` docstring 의 *"이 `select()` 경로는 조용히 틀린다"* | **grep 은 1건 과대 계상한다.** AST 가 옳다 |
| ⓐ `select()` 아닌 조회 | `grep -rnE "(^\|[^_a-zA-Z0-9])text\(\|\.query\(\|relationship\(\|exec_driver_sql\|engine\.execute\|\"SELECT " services/ packages/ --include='*.py'` | `text(` **0**(히트 40 은 전부 `_child_text`·`write_text`·`_build_context` 다) · `.query(` **5**(전부 `scipy` KDTree) · `relationship(` **0** · `exec_driver_sql` **0** · 원시 `"SELECT` **0** | **이 저장소에 원시 SQL·레거시 Query·ORM 관계 로딩이 없다.** 축은 `select()` 하나다 |
| ⓐ `session.get()` 이 무정렬 SELECT 인가 | `[ORD]` 탐침(아래 §1-c) | `services/api/deps.py:55` **1,418회** · `:109` **1,127회** — **전부 `ORDER BY` 없는 SELECT 이고 전부 ≤1행** | **행이 하나면 순서가 없다.** 복합 PK 조회라 구조적으로 그렇다 → 목록 밖이 옳다 |

*역방향 확인 — ③ 이 놓치는 것.* 태운 것은 **셋**이고 ⓑ·ⓓ·ⓔ·ⓕ 는 태우지 않았다. ⓔ 가 가장 아프다 —
`find_document_mapping_review` 자신의 docstring 이 *"같은 `created_at` 을 갖는 두 행은 이 정렬로 갈리지
않는다"* 라고 적는다(`services/progress/persistence.py:458`). **정렬이 있는 자리의 타이는 이 사이클의
축이 아니고, §후속 41 로 연다.**

#### 그래서 몇 자리인가 — **35**

| 값 | `5beb954`(계획 0009 트리, `git archive` 로 꺼냄) | `08238c9`(오늘) |
|---|---|---|
| 루트 grep `select(` 히트, `services/`+`packages/` | **63** | **63** |
| AST `select(...)` 호출 | **62** | **62** |
| 즉시 체인에 `order_by` | **21** | **21** |
| 함수 범위 안에서 `<대상>.order_by(` | **6** | **6** |
| **정렬 미지정** | **35** | **35** |

**계획 0009 가 적은 42 는 휴리스틱 상한이었고, 실제 값은 그 트리에서도 35 였다.**
0009 자신이 *"상한이라 과대 계상한다"* 고 적었으므로 이 값은 그 문장을 **확인**하는 것이지 뒤집는 것이
아니다. **그리고 두 트리의 값이 같다** — 여덟 사이클 동안 이 축에서 **바뀐 자리가 없다.**

> *왜 이 재계수를 실행으로 태워야 했나(§6-1 이 이 사이클에 준 값).* 첫 시도의 "지연 `order_by`"
> 판정 기준은 **파일 전역 정규식** `\b<대상>\.order_by\(` 였다. 그 기준은 **6 이 아니라 12** 를 냈다 —
> `services/progress/persistence.py` 안에 `stmt` 라는 이름의 서로 다른 변수가 여럿이라
> `stmt.order_by(DocumentRow.doc_id)`(`:321`, `load_documents` 의 것) 하나가 **같은 파일의 다른 함수
> 다섯**을 "정렬됨"으로 물들였다. **범위를 함수로 좁히니 6 이다.** 계획 0011 §M-2-1 이 이름 붙인
> *"탐침 자신의 필터에 §6-1 을 걸지 않았다"*(§후속 39)가 **이 계획에서 한 번 더 났고, 이번에는 목록을
> 쓰기 전에 잡혔다** — 잡은 것은 두 트리의 값을 나란히 놓고 "0009 도 35 인데 왜 29 로 나오나"를 물은
> 것이다. 값을 **두 트리에서** 재는 형식 자체가 검산이 됐다.

### 1-b. 판정 축 — **무엇이 「순서가 계약인 자리」인가**

ADR 0015 §2-1 이 확정한 것은 *"기댈 축은 `created_at` 값이다"* 이고, 이 계획은 그 위에 **판정 기준**을
얹는다. 기준은 **소비자의 모양** 하나다:

> **ⓐ — 소비자가 다중행 결과에서 「한 원소」를 위치로 고른다.**
> `[0]` · `[-1]` · `.first()` · 루프 안의 `return`(첫 매치) · `max()`/`find()` 처럼 **동률에서 첫 원소가
> 이기는** 연산. → **`ORDER BY` 를 명시해야 한다.**
> **ⓑ — 소비자가 결과를 집합·사전·합계·계수로만 쓰거나, 스스로 다시 정렬한다.**
> → **정렬을 붙이지 않는다.**
> **ⓒ — 소비자는 한 원소를 고르는데, 「행이 하나뿐이다」가 스키마가 아니라 산문 불변식에 걸려 있다.**
> → **판정 불가.** 그 사실과 이유를 적는다.

*역방향 확인 — "위치로 고른다"가 미는 것.* **표시 순서**는 이 기준 밖이다. 목록을 화면에 그리는
순서가 실행마다 달라지는 것은 사용자에게 보이지만 **판정을 바꾸지 않는다**(CM 이 고르는 다음 행동이
같다 — CLAUDE.md §6-4 가 지키는 것은 후자다). 그래서 `related_ids` 표시 순서(`SummaryPage.tsx:142-145`)나
`/projects/{id}/files` 목록 순서는 **ⓑ 로 간다.** *이것이 이 기준의 가장 큰 임의성이고, 그 대가를
§열린 질문 2 에 적는다.*

*역방향 확인 — "다중행"이 미는 것.* 인자가 **한 개 키**여서 구조적으로 최대 1행인 조회는
`[0]` 을 읽어도 ⓑ 다. 실례: `services/progress/verification.py:92·119` 가 `obj[0]` 을 읽지만 그 `obj` 는
`load_objects_by_ids(session, project_id, [global_id])` 이고 `(project_id, global_id)` 가 `BimObjectRow`
의 PK 다(`packages/core/models/orm.py`, `grep -n "class BimObjectRow" -A 4`). **모양이 ⓐ 인데 판정이 ⓑ 인
자리를 목록에 남기는 이유**는 다음 사람이 같은 자리에서 다시 세지 않게 하기 위해서다.

*역방향 확인 — 옛 조건이 잡던 것.* 계획 0009 의 조건은 *"`order_by` 미지정"* 하나였다(소비자를 보지
않았다). 그 조건은 **35 를 전부** 잡고 이 기준은 그중 5 만 잡는다. **옛 조건이 잡던 것 중 이 기준이
놓아 주는 30 자리**(ⓑ 24 + ⓒ 6)가 바로 아래 표에 있고, 놓아 주는 근거를 **칸마다 소비자 코드 인용으로**
적는다 —
0009 가 이미 *"42 전부에 `order_by` 를 붙이는 것은 답이 아니다"* 라고 적은 것을 값으로 이행하는 것이다.

#### 전수 목록 — **35행** (이 기준을 적용한 결과: **ⓐ 5 · ⓑ 24 · ⓒ 6**)

**이 표가 이 사이클의 전수 목록이다.** `08238c9` 트리에 못박혀 있고(§0), 다시 세는 명령은 §1-a ① 이다.
`실행` 칸은 §1-c 의 postgres 탐침이 잰 **무정렬 다중행 실행 수(최대 행수)** 이고, `–` 는 그 실행에서
≥2행이 관측되지 않았다는 뜻이다(0행이거나 1행이었거나 한 번도 안 돌았다).

| # | 자리 | 함수 | 소비자(코드 인용) | 실행 | 판정 |
|---|---|---|---|---|---|
| 1 | `services/api/auth/router.py:23` | `login` | `.first()` — 술어는 `func.lower(email)`, 유일 제약은 원문 `email` | – | **ⓒ** |
| 2 | `services/api/auth/router.py:38` | `register` | `.first() is not None` — 존재 확인 | – | ⓑ |
| 3 | `services/api/auth/seed.py:41` | `users_count` | `select(func.count()).select_from(...)` — 스칼라 | – | ⓑ |
| 4 | `services/api/queries.py:50` | `model_objects` | `matcher.py:158` `max(scored, key=…)` — 동률에서 첫 원소 | **7 (42행)** | **ⓐ A4** |
| 5 | `services/api/queries.py:58` | `project_drawings` | `ViewerPage.tsx:41` `… ?? list[0] ?? null` | – (**1회·≤1행**) | **ⓐ A1** |
| 6 | `services/api/queries.py:66` | `project_files` | `files.py:97` `[file_view(r) for r in …]` — 표시 순서만 | 2 (7행) | ⓑ |
| 7 | `services/api/queries.py:100` | `entity_mappings_for_object` | `usecases.py:177` `mappings[0].drawing_id` | **9 (2행)** | **ⓐ A2** |
| 8 | `services/api/queries.py:105` | `entity_mapping` | `.first()` — PK 셋 중 둘만 건다 | – | **ⓒ** |
| 9 | `services/api/queries.py:111` | `material_ids_for_object` | `:113` `sorted(set(rows))` — 호출자가 다시 정렬 | – | ⓑ |
| 10 | `services/api/queries.py:161` | `confirmed_since` | `:164-173` `n += 1` — 계수 | 1 (2행) | ⓑ |
| 11 | `services/api/routers/documents.py:43` | `list_documents` | `select(func.count())` — 스칼라 | – | ⓑ |
| 12 | `services/api/routers/objects.py:33` | `list_objects` | `select(func.count())` — 스칼라 | – | ⓑ |
| 13 | `services/api/usecases.py:137` | `resolve_object` | `:144` `if len(candidates) > 1: raise Conflict(…)` — **둘이면 고르지 않고 409 로 거부한다** | 2 (2행) | ⓑ |
| 14 | `services/api/usecases.py:139` | `resolve_object` | `:140` `BimObjectRow.project_id.in_(member_project_ids)` — **서브쿼리**(행을 안 돌려준다) | – | ⓑ |
| 15 | `services/ingest/persistence.py:198` | `find_drawing` | `.first()` — `(project_id, file_id)` 에 유일 제약 없음 | – | **ⓒ** |
| 16 | `services/ingest/persistence.py:253` | `project_documents` | `:254` `{r.doc_id: r for r in …}` — 사전 | 40 (12행) | ⓑ |
| 17 | `services/progress/persistence.py:95` | `load_objects` | `tasks.py:34` 전량 변환 | – | ⓑ |
| 18 | `services/progress/persistence.py:111` | `object_states` | `:113` `{r.global_id: ObjectState(r.state) for r in rows}` — 사전 | 81 (8행) | ⓑ |
| 19 | `services/progress/persistence.py:136` | `save_schedule` | `:139` `session.delete(old_rel)` — 전량 삭제 | – | ⓑ |
| 20 | `services/progress/persistence.py:140` | `save_schedule` | `:143` `session.delete(old_act)` — 전량 삭제 | – | ⓑ |
| 21 | `services/progress/persistence.py:226` | `predecessors_of` | `readiness.py:80-85` `sum(...)`·`ratio`·`pending` → `related_ids` 표시 순서 | 1 (2행) | ⓑ |
| 22 | `services/progress/persistence.py:263` | `load_mappings` | `verification.py:181` `(… or [None])[0]` · `usecases.py:633` `[0]` | **113 (8행)** | **ⓐ A3** |
| 23 | `services/progress/persistence.py:309` | `documents_by_ids` | `:311` `{r.doc_id: r for r in rows}` — 사전 | – | ⓑ |
| 24 | `services/progress/persistence.py:333` | `document_mappings_for_activities` | `document_mapper.py:1223-1224` 필터·계수 | 35 (3행) | ⓑ |
| 25 | `services/progress/persistence.py:340` | `document_mappings_for_project` | `document_mapper.py:414` 전량 루프 · `:1158` 집합 · `ingest:483` 목록(표시·계수) | **200 (12행)** | ⓑ |
| 26 | `services/progress/persistence.py:389` | `open_reviews` | 대부분 집합·계수. **단 `document_mapper.py:1120` 이 첫 매치를 `return`** | **92 (11행)** | **ⓒ** |
| 27 | `services/progress/persistence.py:409` | `open_document_mapping_review` | `:413-416` 첫 매치 `return` | **68 (3행)** | **ⓒ** |
| 28 | `services/progress/persistence.py:484` | `document_mapping_reviews` | `:489` `sorted(rows, key=lambda r: r.created_at)` — 호출자가 정렬 | 3 (2행) | ⓑ |
| 29 | `services/progress/persistence.py:536` | `latest_transition_to` | `:540` `max(times)` | – | ⓑ |
| 30 | `services/progress/persistence.py:578` | `material_totals` | `:585-587` `sum(...)`·`len(rows)` | – | ⓑ |
| 31 | `services/progress/persistence.py:593` | `load_objects_by_ids` | `verification.py:92·119` `obj[0]` — **인자가 한 개 키이고 `(project_id, global_id)` 가 PK** | – | ⓑ |
| 32 | `services/sync/persistence.py:84` | `load_mappings` | `ViewerPage.tsx:275` `mappings.data?.find((x) => x.global_id === g)` | **8 (21행)** | **ⓐ A5** |
| 33 | `services/sync/persistence.py:125` | `open_mapping_reviews` | `persistence.py:169` · `review_queue.py:74` 전량 루프 | 5 (8행) | ⓑ |
| 34 | `services/sync/persistence.py:153` | `rebuild_mappings` | `:153` `set(session.scalars(...))` — 집합 | – | ⓑ |
| 35 | `services/sync/review_queue.py:98` | `confirm_mapping_row` | `.first()` — 8번과 같은 모양. **계획 0011 §Deferred 4** | – | **ⓒ** |

**16행이 postgres 통합에서 ≥2행으로 관측됐고 19행은 안 됐다.** 그 19 중에는 **A1** 이 있다(§1-c 말미).

### 1-c. 순서가 **실제로 몇 번 흔들릴 수 있었나** — postgres 에서 호출 자리별로 셌다

ADR 0014 §5-3(`743bcb9` 트리)은 `[ORD] noorder_multirow_exec=677` 을 **테이블별**로만 적었다.
이 계획의 탐침은 같은 것을 **호출 자리별**로 센다 — 그래야 위 35행 목록의 각 행에 값이 붙는다.
탐침은 `after_cursor_execute` 에서 ① `SELECT` 이고 ② `ORDER BY` 가 없고 ③ `cursor.rowcount >= 2` 인
실행을 세고, 스택에서 `buildtwin/services|packages` 안의 **가장 안쪽 프레임**으로 귀속한다.

**실행값(`08238c9`, 포트 55438, `tests/integration` 216 passed):**

```
[ORD] select_exec=12131  noorder_exec=11125  noorder_multirow_exec=679
```

> **[라운드 3] 이 값은 `08238c9`(사이클 **전**) 의 것이고 그대로 둔다**(§3-13 첫째 갈래 — 못박은
> 트리의 값은 뒤늦게 갱신하지 않는다). **사이클 뒤 값은 542 이고, 679 → 542 의 자리별 분해는
> §M-7-3 과 ADR 0016 §1-3 의 라운드 3 상자에 있다.** architect 가 옛 트리를 `git archive 08238c9`
> 로 꺼내 같은 정의의 플러그인으로 다시 재니 **이 줄의 세 수가 한 자리도 다르지 않게 재현됐다.**

**677 → 679 다.** ADR 0014 의 677 은 `743bcb9` 트리·통합 205건의 값이고, 오늘은 통합이 216건이다.
**갈린 값을 먼저 적는다**(지시 §보고). 이 차이는 *"테스트가 11건 늘었다"* 로 설명되지만 **그 귀속을
실행으로 태우지 않았다** — §확인하지 않은 것 3.

호출 자리별 상위(전체 24행 중 ≥2행이 관측된 16행):

| 무정렬 다중행 실행 | 최대 행수 | 호출 자리 | 테이블 | 판정 |
|---|---|---|---|---|
| 200 | 12 | `services/progress/persistence.py:340` | `activity_document_mappings` | ⓑ |
| 113 | 8 | `services/progress/persistence.py:268` | `activity_object_mappings` | **ⓐ(A3)** |
| 92 | 11 | `services/progress/persistence.py:396` | `review_requests` | ⓒ |
| 81 | 8 | `services/progress/persistence.py:111` | `bim_objects` | ⓑ |
| 68 | 3 | `services/progress/persistence.py:413` | `review_requests` | ⓒ |
| 40 | 12 | `services/ingest/persistence.py:254` | `documents` | ⓑ |
| 35 | 3 | `services/progress/persistence.py:333` | `activity_document_mappings` | ⓑ |
| 9 | 2 | `services/api/queries.py:100` | `entity_object_mappings` | **ⓐ(A2)** |
| 8 | 21 | `services/sync/persistence.py:89` | `entity_object_mappings` | **ⓐ(A5)** |
| 7 | 42 | `services/api/queries.py:50` | `bim_objects` | **ⓐ(A4)** |
| 5 | 8 | `services/sync/persistence.py:129` | `review_requests` | ⓑ |
| 4 | 54 | (테스트 코드 프레임) | `review_requests` | — |
| 3 | 2 | `services/progress/persistence.py:488` | `review_requests` | ⓑ |
| 2 | 2 | `services/api/usecases.py:141` | `bim_objects` | ⓑ |
| 2 | 7 | `services/api/queries.py:66` | `files` | ⓑ |
| 1 | 2 | `services/api/queries.py:161` | `state_transitions` | ⓑ |
| 1 | 2 | `services/progress/persistence.py:226` | `activity_relations` | ⓑ |

*(줄 번호는 `session.scalars(...)` 를 실행하는 줄이라 `select(` 줄보다 몇 줄 아래다 — 같은 함수 안이다.)*

**여기서 가장 값이 큰 관측은 표에 **없는** 행이다.** `services/api/queries.py:58`
(`project_drawings` — 아래 A1)은 216건 전체에서 **1회 실행됐고 그 1회가 ≤1행**이었다.
**이 사이클이 ⓐ 로 가르는 다섯 자리 중 가장 사용자에게 가까운 것이, 통합 스위트가 다중행으로
한 번도 태우지 못한 자리다.**

### 1-d. ⓐ 다섯 자리 — **"이 정렬을 지우면 무엇이 죽는가"에 값으로 답한다**

계획 0008·0010 이 `persistence.py` 의 두 정렬에 대해 한 것이 본보기다(`return rows` 변이 /
`.desc()`→`.asc()` 변이가 각각 한 함수를 죽인다). **이 다섯 자리는 오늘 정렬이 없으므로 "지우는"
변이가 없다.** 그래서 대칭이 되는 변이를 태웠다 — **붙일 정렬의 역방향을 지금 주입하고 무엇이
죽는지 본다.** 죽는 것이 없으면, 그 자리에 `ORDER BY` 만 붙이는 것은 **677 을 678 로 만드는 일**이다.

| # | 자리 (소유) | 소비자가 한 원소를 고르는 코드 | 붙일 정렬 | **역방향 변이 실행값**(루트 `pytest -q`, 기준선 832) |
|---|---|---|---|---|
| **A1** | `services/api/queries.py:58` `project_drawings` (**api**) | `apps/web/src/pages/ViewerPage.tsx:41` — `list.find(…currentDrawingId) ?? list.find(…level) ?? **list[0]** ?? null` (2D 뷰어가 여는 기본 도면) | `.order_by(DrawingRow.drawing_id)` | **832 passed** — 죽는 것이 **0** |
| **A2** | `services/api/queries.py:100` `entity_mappings_for_object` (**api**) | `services/api/usecases.py:177` — `drawing_id=**mappings[0]**.drawing_id if mappings else None` (`ObjectDetail.linked.drawing_id`) | `.order_by(EntityObjectMappingRow.drawing_id, EntityObjectMappingRow.entity_handle)` | **832 passed** — 죽는 것이 **0** |
| **A3** | `services/progress/persistence.py:263` `load_mappings` (**progress-engine**) | `activity_ids_for_object` → `services/progress/verification.py:181` `activity_id=… or (logic.get("activity_ids") or [None])**[0]**` (검토요청이 싣는 `activity_id`) · `services/api/usecases.py:633` `logic["activity_ids"]**[0]**` | `.order_by(ActivityObjectMappingRow.activity_id, ActivityObjectMappingRow.global_id)` | **832 passed** — 죽는 것이 **0** |
| **A4** | `services/api/queries.py:50` `model_objects` (**api**) | `services/api/jobs.py:123` → `services/sync/matcher.py:158` `max(scored, key=lambda s: (s[0], s[1]))` — **`max` 는 동률에서 첫 원소를 돌려준다** (2D 엔티티가 어느 객체에 매핑되는가) | `.order_by(BimObjectRow.global_id)` | **832 passed** — 죽는 것이 **0** |
| **A5** | `services/sync/persistence.py:84` `load_mappings` (**sync-2d3d**) | `apps/web/src/pages/ViewerPage.tsx:275` — `mappings.data?.**find**((x) => x.global_id === g)` — PK 가 `(drawing_id, entity_handle, global_id)` 라 **한 객체에 핸들이 여럿**일 수 있다(그 객체 칩의 `confidence` 배지). **[보강 — §M-3-3] `sync-2d3d` 가 셋을 더 찾았다**: `broker.ts:66` `panTo(handles[0])` · `broker.ts:76` `flyTo(globalIds[0])` · `ViewerPage.tsx:133`. 계획의 키가 셋에도 맞는다. **[정정 — 리뷰 라운드 2] 그 넷 중 `broker.ts:76` `flyTo(globalIds[0])` 는 순서 소비자가 아니다 → ⓑ.** `pushTo3d` 는 `globalIds.length === 0` 에서 조기 return 하고(`broker.ts:71-74`) `flyTo` 는 `single` 가드 안이며(`:76`), `single`(`:83`)은 *`globalIds.length === 1`, 또는 `globalIds.length === 0` 이고 `entityHandles.length === 1`* 이다 — **`flyTo` 가 도는 순간 `globalIds.length` 는 언제나 1이므로 `[0]` 은 위치 선택이 아니라 유일 원소다.** **그래서 A5 의 순서 소비자는 셋이다**: `ViewerPage.tsx:275`(`find`) · `ViewerPage.tsx:133`(`selection.globalIds[0]` → `ObjectDetailPanel`; `select2d`/`selectArea2d` 에서 `globalIds` 가 ≥2 가능하고 `uniq = Array.from(new Set(...))` 가 첫 등장 순서를 보존한다) · `broker.ts:66`(`panTo(handles[0])`; `select3d`/`selectFromPanel` 은 `globalIds.length===1` 이라 `single=true` 이지만 `handlesFor(gid)` 는 `setMappings` 가 서버 순서대로 쌓은 배열이라 ≥2 가능 — `broker.ts:116-127`). 붙일 키는 셋에도 그대로 맞는다 | `.order_by(EntityObjectMappingRow.entity_handle, EntityObjectMappingRow.global_id)` | **832 passed** — 죽는 것이 **0** |

**다섯 칸이 전부 같은 값이다 — 그리고 그것이 이 사이클의 핵심 관측이다.**
잰 방법: 저장소 밖 스크립트가 그 한 줄에 역방향 `order_by` 를 넣고 → 루트 `.venv/bin/pytest -q` 를
돌리고 → 원복하고 → 루트 `git status --porcelain` 이 빈 출력임을 확인한다. **자리당 N=1 실행**,
기준선은 같은 트리의 **832 passed**(§0).

| 변이 | 실행값 | `FAILED` |
|---|---|---|
| A1 단독 | 832 passed (95.44s) | 없음 |
| A2 단독 | 832 passed (91.85s) | 없음 |
| A3 단독 | 832 passed (88.90s) | 없음 |
| A4 단독 | 832 passed (88.98s) | 없음 |
| A5 단독 | 832 passed (87.17s) | 없음 |
| **다섯 동시** | 832 passed (89.27s) | 없음 |
| **다섯 동시 · postgres 축**(`tests/integration`, 포트 55438) | **216 passed** (45.78s) | 없음 |

*다섯을 동시에 태운 이유*: 단독 다섯이 전부 초록일 때 *"두 변이가 서로를 상쇄했다"* 는 설명이
남는다. **동시도 초록이므로 그 설명이 닫힌다.** *postgres 축을 따로 태운 이유*: sqlite 의 스캔 순서는
삽입 순서라(`services/progress/persistence.py:441` 이 그 성질을 적는다) sqlite 초록이 곧 "순서를 아무도
안 본다"는 아니다. **두 축 모두 초록**이므로 그 갈래도 닫힌다.

**그래서 이 다섯 자리에서 「이 정렬을 지우면 무엇이 죽는가」의 오늘 답은 「아무것도」다.**
CLAUDE.md §6-2 가 이름 붙인 그대로 — 정렬만 붙이면 **679 가 680 이 될 뿐이다.**
그러므로 이 사이클의 산출물은 **`ORDER BY` 다섯 줄이 아니라 「그 다섯 줄을 지우면 죽는 회귀 다섯」**
이고, 작업 3·4·5 는 작업 7 없이는 **완료가 아니다**(작업 3 완료 조건 5).

**A4 의 키를 `global_id` 로 고르는 근거는 트리 안에 있다.** 같은 테이블의 형제 조회 둘이 이미 그 키로
정렬한다 — `services/api/queries.py:46`(`project_objects`)와 `services/ingest/persistence.py:116`
(같은 이름의 함수)이 둘 다 `.order_by(BimObjectRow.global_id)` 다. `model_objects` 만 빠져 있다.

**A1·A2 의 키는 「의미」가 아니라 「결정성」이다 — 그 구별을 ADR 0016 이 결정 2 로 세운다.**
`DrawingRow` 에는 `created_at` 이 **없다**(`packages/core/models/orm.py` 의 그 클래스 컬럼:
`drawing_id`(PK)·`project_id`·`file_id`·`level`·`coordinate_system`·`alignment`·`svg_uri`·`stats`).
ADR 0015 §2-1 이 확정한 축(`created_at` 값)이 **이 테이블에는 없다.** 그러나 A1 이 필요로 하는 것은
*"가장 최근 도면"* 이 아니라 *"매번 같은 도면"* 이다 — 의미 있는 선택(`find(d => d.level === level)`)은
이미 그 앞줄이 한다. **`created_at` 컬럼을 새로 만들지 않는다**(스키마 변경 없이 닫힌다).

### 1-e. ⓑ 24자리 — **그 사실을 어디에 적을 것인가**

**판정: 자리마다 주석을 달지 않는다. 기록은 이 계획 §1-b 의 35행 표 하나이고**(`08238c9` 에 못박혀
있다 — §0), **ADR 0016 은 그 표를 다시 베끼지 않고 판정 축·개수(5/24/6)·다시 세는 명령만 싣는다.**

근거 셋(전부 이 저장소의 실측이다):

1. **`services/` 는 계속 편집되는 자리다.** CLAUDE.md §3-13 둘째 갈래가 그런 자리에 **절대값·열거를
   적지 말라**고 한다. "이 조회는 순서가 무관하다"는 주석은 **소비자가 바뀌는 순간 거짓**이 되고,
   주석이라 **어떤 테스트도 실패시키지 않는다** — §6-1 의 이름 붙은 블라인드 스팟과 같은 모양이다.
2. **열거는 길이가 곧 개수다**(§6-1 9회차). 24행을 코드 주석에 나눠 적으면 25번째 자리가 생기는 날
   그 24개 주석 중 **어느 것도** 거짓이 되지 않으면서 목록만 낡는다.
3. **계획·ADR 은 기록물이라 못박을 트리가 있다**(§3-13 첫째 갈래). `08238c9` 에서 24 였다는 사실은
   영원히 참이고, 오늘의 값이 궁금한 사람은 **§1-a ① 의 명령을 다시 돌린다.**
4. **표를 두 자리에 두지 않는다.** 계획과 ADR 에 같은 24행을 적으면 둘이 갈리는 날이 온다 —
   §6-3 8회차가 *"한 문서 안 두 표의 축 불일치"* 로 이름 붙인 그 모양이고, 이 사이클의 §6-3 교차
   확인 표가 **여섯 값 중 넷이 갈렸다**고 재는 그 축이다.

*역방향 확인 — 이 판정이 미는 것.* 그러면 **아무도 안 읽는다.** ADR 은 "작업 전에 반드시 읽는 문서"가
아니다(CLAUDE.md 만 그렇다 — §6 머리말). 그래서 이 판정은 **"기록은 ADR, 강제는 없음"** 이고,
**강제를 만드는 것은 이 사이클이 하지 않는다.** 대안(기계적 감사: "`[0]` 을 읽는 소비자를 가진
무정렬 조회가 있으면 lint 가 죽는다")은 **정적으로 판정할 수 없다** — 소비자는 다른 파일·다른 언어에
있고(A1 은 `.tsx` 다), 계획 0004 §후속 1 이 같은 종류의 감사를 이미 `qa` 에 넘긴 채 열려 있다.
**"놓칠 수 있다"고 적는 것은 커버리지가 아니므로**(§6-1) 이것을 **§후속 42 로 연다.**

### 1-f. ⓒ 여섯 자리 — **판정 불가와 그 이유**

| 자리 | 한 원소를 고르는 코드 | 왜 판정할 수 없나 |
|---|---|---|
| `services/api/auth/router.py:23` `login` | `.first()` | 조회 술어는 `func.lower(UserRow.email) == …` 인데 **DB 유일 제약은 원문 `email` 에 걸린다**(`email: Mapped[str] = mapped_column(String, unique=True)`). 대소문자만 다른 두 행은 스키마가 막지 않고 둘 다 매치된다. 오늘 그런 행이 없는 이유는 `register`(`:37` `email = str(body.email).lower()`)가 낮추기 때문이고 — **코드 불변식이지 스키마 불변식이 아니다.** 로그인 경로라 잘못 고르면 **다른 계정으로 인증된다** |
| `services/api/queries.py:105` `entity_mapping` | `.first()` | PK 가 `(drawing_id, entity_handle, **global_id**)` 라 **한 핸들이 두 객체를 가리킬 수 있다**. 이 조회는 앞 두 컬럼만 건다 |
| `services/sync/review_queue.py:98` `confirm_mapping_row` | `.first()` | 위와 **같은 모양**. **계획 0011 §Deferred 4 가 이미 이름 붙여 둔 자리다** — 이 계획이 그 항목에 술어를 붙인다(무엇이 문제인지: PK 세 컬럼 중 둘만 건다) |
| `services/ingest/persistence.py:198` `find_drawing` | `.first()` | `(project_id, file_id)` 에 유일 제약이 **없다**(`DrawingRow` PK 는 `drawing_id` 하나). 한 파일에서 도면을 두 번 만드는 경로가 있는지 이 계획은 재지 않았다 |
| `services/progress/persistence.py:389` `open_reviews` | `services/progress/document_mapper.py:1120` — `for row in …: if …: return row.review_request_id` | 첫 매치 반환이다. 걸리는 술어는 `conflicting_sources.current_fingerprint == drift.current_fingerprint` 이고 **한 지문에 열린 요청이 하나뿐**이라는 것이 산문 불변식이다 |
| `services/progress/persistence.py:409` `open_document_mapping_review` | `for row in …: if …: return row` | 같은 모양. 그 함수의 docstring 이 스스로 *"한 쌍에 열린 행은 언제나 하나"* 라고 적는다(`:451-456`) — **그리고 형제 함수 `find_document_mapping_review` 는 그 불변식이 없어서 `ORDER BY created_at DESC` 를 갖는다.** 두 함수가 같은 파일에 있고 하나만 정렬을 가진 이유가 **문서로만** 서 있다 |

**여섯 다 「스키마가 유일성을 강제하지 않는데 코드가 유일하다고 믿는다」는 한 가지 모양이다.**
그러므로 답은 `ORDER BY` 가 아니라 **① 유일 제약을 세우거나 ② 둘 이상일 때 실패시키거나
③ 정렬을 붙여 결정적으로 고르거나** 셋 중 하나이고, **그 선택은 자리마다 다른 도메인 판단이다.**
이 사이클이 답하지 않는다 → **§후속 40.**

### 1-g. 착수 크기 판단 — **ⓐ 다섯만 이번에 닫는다**

**값으로 판단한다.** ⓐ = **5**, ⓑ = **24**, ⓒ = **6**.

- **ⓑ 24 는 코드 변경이 0 이다** — 판정이 "붙이지 않는다"이므로 커밋이 없다. ADR 의 표 한 장이다.
- **ⓒ 6 은 한 사이클이 아니다.** 각 자리가 서로 다른 도메인 질문(유일 제약을 세울 것인가 / 둘이면
  죽일 것인가)이고 그중 하나는 **인증 경로**라 별도 판단이 필요하다. 소유도 셋으로 갈린다.
- **ⓐ 5 는 한 사이클이다** — 조회 한 줄씩 다섯 + 그 다섯을 붙드는 회귀 다섯. 소유는 셋
  (`api` 셋 · `progress-engine` 하나 · `sync-2d3d` 하나) + `qa`.

**그래서 이 사이클은 ⓐ 만 닫고 ⓒ 는 §후속 40 으로, ⓑ 의 강제는 §후속 42 로 넘긴다.**
*지시가 준 판단 재료 그대로다*: 42(→35)자리 전부에 회귀를 붙이는 것은 한 사이클이 아니다.

### 1-h. CLAUDE.md §6-3(32) 병행 커밋 — **한 절만, 별도 커밋**

리뷰어가 정한 대기열의 **첫째**다(계획 0011 §M-4: *"§6-3(32) → §6-5(25 + 27·34·39 …) → §2(19)"*).
과제 0 판정대로 `:418`(*"한 번에 한 절씩"*)은 **압축 전용**이라 이 병행 커밋은 규칙 위반이 아니다.

**넣는 것 셋.**

1. **머리 문장** — *"재발 10건 … 7~10 은"* → *"재발 11건 … 7~11 은"* + `11 = 같은 값이 **한 사이클의
   여러 문서·코드**에 다르게 적힌 것`.
2. **표에 11회차 행** — 조건절·기준은 *"교차 확인의 축이 「같은 문서」다"*, 밀려난 것은 *"같은 사이클의
   다른 문서·다른 소유의 코드·커밋 본문"*, 관측값은 계획 0011 의 셋(뒤집힌 불리언이 계획과 `test_99`
   에 **함께 태어난 것** · §후속 15 표본의 "1 → 2" ↔ "2 → 3" · 마감 산문과 `a6f64a6` 본문의 같은
   양성 귀속)과 **이 계획의 여섯 중 넷**.
3. **규칙 불릿 확장** — 기존 *"인접 절과 교차 확인한다"* 불릿 끝에: **축은 "같은 문서"가 아니라
   "같은 사이클"이다.** 한 사이클은 계획·ADR·코드·테스트·커밋 본문에 같은 값을 여러 번 적고 **소유가
   달라 서로 다른 커밋으로** 들어가므로 한 자리를 고쳐도 나머지가 남는다. 사이클을 닫기 전에 **두 번
   이상 적은 값을 표로 모으고 갈리는 칸을 실행으로 가른다.** **다른 사이클이 그 값을 적은 자리도 넣고,
   갈리지 않은 칸도 적는다.**

**규칙은 한 글자도 지우지 않는다**(§6-5 갱신 규칙). **압축이 아니므로 바닥값(5% 표면)은 걸리지 않는다.**

**§6 크기의 실측(§후속 38 이 여는 축의 값이다 — 이 사이클은 그것을 되돌리지 않고 값만 남긴다).**

| | 편집 전(`08238c9`) | 편집 후 | 차 |
|---|---|---|---|
| CLAUDE.md 전체 자수(`python3 len()`) | 29,298 | 30,164 | +866 |
| §6 자수(`## 6.` 줄부터 EOF) | **18,204** | **19,070** | **+866** |
| §6 비중(자) | 62.1% | **63.2%** | +1.1%p |
| §6 줄 수 | 247 | 255 | +8 |
| §6 비중(줄) | 53.6% | 54.4% | +0.8%p |

*자수는 `python3 len()` 이다 — 이 셸의 `wc -m` 은 바이트를 센다*(계획 0011 §후속 34 네 번째 실례).
**+866자 중 규칙 불릿이 얼마이고 표 행이 얼마인지는 가르지 않았다** — §후속 38 이 요구하는 흡수 한도는
**행 하나가 §6-2 절 크기(871자)를 넘는가**인데, 이번 11회차 행 하나만으로는 그 문턱을 재지 않았다.

---

## 영향 범위

**데이터 모델**: 없다. **스키마 변경 없음** — 새 컬럼도, 새 인덱스도 만들지 않는다(A1 의 키를 `created_at`
이 아니라 PK 로 고른 이유가 §1-d 에 있다). `packages/core/models/` 는 **읽기만** 한다.

**서비스**: `services/api/queries.py`(세 줄) · `services/progress/persistence.py`(한 줄) ·
`services/sync/persistence.py`(한 줄).

**화면**: **없다.** 다섯 자리 전부 서버가 순서를 확정하는 것으로 닫힌다. `ViewerPage.tsx` 의
`list[0]`·`find(...)` 는 **그대로 둔다** — 고칠 것은 그 앞의 순서다.

**테스트**: `tests/` (qa). **`tests/` 를 architect 는 한 글자도 만지지 않는다.**

**문서**: `docs/plans/0012-*.md`(이 문서) · `docs/adr/0016-*.md` · `CLAUDE.md` §6-3 — 전부 architect.

---

## 작업 분배

| 순서 | 에이전트 | 담당 파일 | 입력 | 출력 | 완료 조건 |
|---|---|---|---|---|---|
| 1 | **architect** | `docs/plans/0012-*.md` | 지시 · 계획 0011 §후속 · ADR 0015 §2-1 | 이 계획 | 35행 전수 목록 + ⓐⓑⓒ + §6-1 ①②③ + §6-2 + §6-3 표 |
| 2 | **architect** | `docs/adr/0016-*.md` | 이 계획 §1-b·§1-d·§1-e | ADR 0016 | 결정 1~4 + ⓑ 24행 표(트리 못박음 + 재계수 명령) + §6-3 역방향 표 |
| 3 | **api** | `services/api/queries.py` | §1-d A1·A2·A4 | 세 조회에 `ORDER BY` | 아래 **작업 3 완료 조건** 다섯 칸 |
| 4 | **progress-engine** | `services/progress/persistence.py` | §1-d A3 | `load_mappings` 에 `ORDER BY` | 같은 다섯 칸 |
| 5 | **sync-2d3d** | `services/sync/persistence.py` | §1-d A5 | `load_mappings` 에 `ORDER BY` | 같은 다섯 칸 |
| 6 | **architect** | `CLAUDE.md` §6-3 | 계획 0011 §후속 32 | 규칙 한 줄 + 근거 | **§6-3 한 절만.** 별도 커밋. 규칙은 지우지 않는다 |
| 7 | **qa** | `tests/` | 작업 3·4·5 의 다섯 정렬 | 회귀 다섯 | 아래 **작업 7 완료 조건** 여섯 칸 |

**소유는 §2 대로다.** 작업 3~5 는 `services/` 세 트리라 **소유자가 셋**이고 **커밋도 셋**이다.
architect 는 계획·ADR·CLAUDE.md 만 쓴다(`.claude/agents/architect.md` §금지사항).

### 작업 3·4·5 완료 조건 (다섯 칸 — **전부** 만족해야 한다)

1. §1-d 표의 **키 그대로** `ORDER BY` 를 붙인다. 다른 키를 고르면 **그 근거를 커밋 본문에 값으로 적는다**.
2. **`ORDER BY` 만 붙인다.** 소비자(`[0]`·`find`·`max`)는 건드리지 않는다 — 이 사이클이 세우는 계약은
   *"서버가 순서를 확정한다"* 이지 *"소비자가 순서에 기대지 않는다"* 가 아니다.
3. `make test` 통과. `make lint` exit 0.
4. **커밋 전 `git status --porcelain` 전체를 보고 자기 소유 경로만 명시해 `add` 한다.** `git commit -a` 금지.
5. **작업 7 이 붙기 전에는 이 커밋만으로 초록이다** — 그것이 정상이고, 그 사실을 커밋 본문에 적는다
   (*"이 정렬은 아직 무보호다 — 작업 7 이 붙든다"*). **적지 않으면 다음 이월 목록이 이 자리를 「닫혔다」로 옮긴다.**

### 작업 7 완료 조건 (여섯 칸 — **전부** 만족해야 한다)

1. **다섯 자리마다 회귀가 하나씩** 있고, 그 회귀는 **≥2행**을 만든 상태에서 소비자가 고르는 **그 한
   원소의 값**을 단언한다(목록 전체를 단언하지 않는다 — 목록 순서는 계약이 아니고 **선택된 원소**가
   계약이다).
2. **각 회귀에 대해 §1-d 의 역방향 변이**(`.desc()` 로 뒤집기)와 **삭제 변이**(`.order_by(...)` 줄 제거)
   **둘 다** 태우고, **어느 테스트가 몇 개 빨개지는지**를 커밋 본문에 실행값으로 적는다.
   ~~**삭제 변이가 안 죽으면 그 회귀는 장식이다**(§6-2)~~ — sqlite 의 스캔 순서가 우연히 옳은 순서일 수
   있으므로 **삭제 변이는 postgres 축에서도 태운다.**
   **[정정 — §M-2. 취소선 문장은 거짓이다.]** 회귀의 품질을 재는 것은 **역방향** 변이이고
   (**역방향이 안 죽으면 장식이다**), **삭제** 변이는 테스트가 아니라 **엔진**을 잰다.
   삭제가 안 죽는 칸은 ~~**`EXPLAIN` 으로 왜 안 죽는지 이름 붙여 적는다**~~ — 이름 붙이지 못하면
   **재지 않은 것**이다(ADR 0016 §2-3 정정 상자). *원문을 지우지 않고 취소선으로 남긴다 — 무엇이
   왜 틀렸는지가 이 사이클의 산출물이다.*
   **[정정 — 리뷰 재심사 라운드 4] 취소선 안의 문장에 두 한정이 빠져 있었다.** 게이트의 문안은
   이것이다 — 삭제가 안 죽는 칸은 **① 그 칸이 관측된 통합 세션 안에서 ② 칸마다 하나가 아니라
   계획마다 하나씩** `EXPLAIN`(sqlite 는 `EXPLAIN QUERY PLAN`)으로 왜 안 죽는지 이름 붙여 적는다.
   계측은 **ORM 이 실제로 쏘는 문장 그대로**를 그 **세션의 같은 커넥션**에 넘기고, 각 계획을
   **그 세션의 사망 여부와 짝지어** 적는다. **이름 붙이지 못한 칸은 재지 않은 것이고,
   한 칸을 한 이름으로 부르는 것은 이 조건이 금지하는 「이름으로 면제」다.**
   **정본은 ADR 0016 §3 2 이고 이 칸은 그 문안을 그대로 싣는다**(정본 판정은 §M-8-1).
   *왜 이 정정이 무거운가*: 라운드 3 은 ADR §3 2 만 좁히고 이 상자를 초판 문안 그대로 두었다 —
   **ADR §3 자신이 *"같은 조건을 두 자리에 두면 갈린다"* 라고 경고한 갈림이 실제로 났고**,
   아래 **§M-2-3 ⓒ 기각**이 *"§후속 40(ⓒ 여섯)이 같은 완료 조건을 물려받는다"* 라 적으므로,
   고치지 않으면 **다음 사이클이 좁혀지지 않은 게이트를 물려받는다.**
3. **A1 은 두 겹이다.** 서버 순서(통합)와 화면의 `list[0]`(vitest) 은 **다른 계약**이다.
   서버 회귀는 필수, 화면 회귀는 **없으면 없다고 커밋 본문에 적는다**(`ViewerPage.test.tsx` 가
   저장소에 **없다** — `ls apps/web/src/pages/*.test.tsx` 실행값에 그 파일이 없다).
4. **A4 는 동률을 만들어야 한다.** `matcher.py:158` 의 `max(scored, key=(conf, iou))` 가 두 후보에서
   같은 값을 내야 순서가 드러난다. **동률을 만들 수 없으면 그 사실을 값으로 적고 A4 를 §후속으로
   되돌린다** — 만들지 못한 채 "붙였으니 됐다"로 닫지 않는다(§6-2 1).
5. **`tests/` 밖을 만지지 않는다.**
6. `make test` 통과 + postgres 축 `tests/integration` 통과 + `git status --porcelain` 확인.

---

## 인터페이스 정의

계약은 **함수 시그니처가 아니라 반환 목록의 순서**다. 시그니처는 하나도 바뀌지 않는다.

```python
# services/api/queries.py
def project_drawings(session, project_id) -> list[DrawingRow]:
    """… `drawing_id` 오름차순. 뷰어의 기본 도면 선택(`ViewerPage` 의 `list[0]`)이 이 순서에 선다."""

def model_objects(session, model_id) -> list[BimObjectRow]:
    """… `global_id` 오름차순 — 형제 `project_objects` 와 같은 키."""

def entity_mappings_for_object(session, project_id, global_id) -> list[EntityObjectMappingRow]:
    """… (`drawing_id`, `entity_handle`) 오름차순. `ObjectDetail.linked.drawing_id` 가 [0] 을 읽는다."""

# services/progress/persistence.py
def load_mappings(session, project_id, activity_id=None, global_id=None) -> list[ActivityObjectMappingRow]:
    """… (`activity_id`, `global_id`) 오름차순."""

# services/sync/persistence.py
def load_mappings(session, drawing_id, needs_review=None, project_id=None) -> list[EntityObjectMapping]:
    """… (`entity_handle`, `global_id`) 오름차순."""
```

**docstring 에 실측값·개수를 적지 않는다**(§3-13 둘째 갈래 — 이 파일들은 계속 편집되는 자리다).
적는 것은 **순서의 키와 그것을 읽는 소비자의 이름**뿐이다.

---

## 검증 시나리오 (§6-2 — 각 시나리오에 **"결함 있는 코드가 이 기대값을 그대로 만족하는가"** 를 물었다)

**정의.** *역방향 변이* = 붙일 정렬을 `.desc()` 로 뒤집는다. *삭제 변이* = `.order_by(...)` 를 지운다.

| # | 시나리오 | 결함 코드가 그대로 만족하는가 | 그래서 무엇을 세우나 |
|---|---|---|---|
| S1 | "다섯 자리에 `ORDER BY` 를 붙이고 `make test` 가 초록이다" | **그렇다.** 다섯 변이 전부 **832 passed**, `FAILED` 0 (§1-d 표) | **이것은 검증이 아니다.** 작업 7 완료 조건 2 가 요구하는 것은 초록이 아니라 **변이가 빨개지는 것**이다 |
| S2 | A1: 도면 **한 장**인 프로젝트에서 뷰어가 그 도면을 연다 | **그렇다** — 행이 하나면 순서가 없다. 통합 스위트가 오늘 정확히 이 상태다(`queries.py:58` 실행 1회·≤1행, §1-c) | 도면 **둘 이상**을 만들고 `[0]` 이 고르는 `drawing_id` 를 단언한다 |
| S3 | A3: Activity **하나**에 매핑된 객체의 검토요청이 그 `activity_id` 를 싣는다 | **그렇다** — 후보가 하나면 `[0]` 이 유일하다 | 한 객체를 **두 Activity** 에 매핑하고 검토요청의 `activity_id` 를 단언한다 |
| S4 | A4: 후보 객체가 **하나**일 때 엔티티가 그 객체에 매핑된다 | **그렇다** — `max` 에 원소가 하나면 동률이 없다 | `(confidence, iou)` 가 **같은** 두 후보를 만들고 어느 `global_id` 가 이기는지 단언한다 |
| S5 | A2/A5: 목록의 **길이**를 단언한다 | **그렇다** — 순서를 바꿔도 길이는 같다 | 길이가 아니라 **`linked.drawing_id`**(A2) · **그 칩의 `confidence`**(A5), 곧 **고른 한 원소**를 단언한다 |
| S6 | 다섯 회귀가 **sqlite 에서** 빨개진다 | **아니다 — 그러나 충분하지도 않다.** sqlite 의 스캔 순서는 삽입 순서라 삭제 변이가 우연히 옳은 답을 낼 수 있다(`persistence.py:441` 이 그 성질을 이미 적는다) | 삭제 변이는 **postgres 축에서도** 태운다(완료 조건 2) |

*역방향 확인 — 음성 대조군을 한 축에 몰지 않았나(§6-2 3).* 판정 경로가 둘이다: **① 서버가 순서를
정하는가**(A1~A5 전부) **② 화면이 그 순서를 그대로 쓰는가**(A1·A5 는 `.tsx` 소비자다).
**②의 음성 대조군은 이 계획에 없다** — `ViewerPage.test.tsx` 가 저장소에 없기 때문이고, 그 사실을
작업 7 완료 조건 3 이 **값으로 적게** 한다. **없는 것을 있다고 하지 않는다.**

---

## 한정어 역방향 확인 표 (§6-3 산출물 — **각 칸은 실행값 또는 코드 인용이고 다른 절 참조가 아니다**)

| # | 한정어 | 빼면 무엇이 더 들어오나 | 때문에 무엇이 빠지나 | 태운 값 |
|---|---|---|---|---|
| 1 | "**정렬 미지정**" | `order_by` 가 있으나 **타이가 남는** 자리 | `find_document_mapping_review` 처럼 정렬이 있는데 같은 `created_at` 두 행이 갈리지 않는 자리 | 코드 인용: `services/progress/persistence.py:458` *"같은 `created_at` 을 갖는 두 행은 이 정렬로 갈리지 않는다"* → **§후속 41** |
| 2 | "**서버 트리**" | `tests/` 의 무정렬 조회 | 테스트가 자기 단언을 위해 무정렬로 읽는 자리 | 루트 grep 실행값: `buildtwin/tests/` 에 `select(` **33 히트**. 이 계획은 세지 않는다(§후속 16 의 축) |
| 3 | "**`select(`**" | `session.get()`·`text()`·`.query()`·`relationship()` | 표기가 다른 조회 전부 | 실행값: `text(` 원시 SQL **0** · `.query(` **5**(전부 scipy) · `relationship(` **0**; `session.get()` 은 `deps.py:55` **1,418회 전부 ≤1행** |
| 4 | "**한 원소를 위치로 고른다**"(ⓐ 의 정의) | 표시 순서만 흔들리는 자리 | `related_ids`·`/files` 목록의 화면 순서 | 코드 인용: `apps/web/src/pages/SummaryPage.tsx:145` `b.related_ids.map((id, i) => …)` — 인덱스를 **key 로만** 쓴다 → ⓑ |
| 5 | "**다중행**" | 인자가 한 개 키라 구조적으로 1행인 자리 | `verification.py:92` `obj[0]` | 코드 인용: `BimObjectRow` PK = `(project_id, global_id)`; 호출은 `load_objects_by_ids(session, project_id, [global_id])` → ⓑ |
| 6 | "**소비자**" | 소비자가 **없는**(반환만 하고 아무도 안 읽는) 자리 | — | 실행값: 35 자리 전부에 소비자가 있다. `grep -rn "\b<함수명>\b" services/ apps/web/src packages/` 로 확인했고 **히트 0 인 함수는 없었다** |
| 7 | "**결정성이지 의미가 아니다**"(A1·A2 의 키) | `created_at` 축을 요구하는 자리 | `DrawingRow` 에 `created_at` 이 없다는 사실 | 코드 인용: `packages/core/models/orm.py` 의 `class DrawingRow` 컬럼은 `drawing_id`·`project_id`·`file_id`·`level`·`coordinate_system`·`alignment`·`svg_uri`·`stats` — **시간 컬럼이 없다** |
| 8 | "**두 트리가 같다**"(§1-a) | 트리가 달랐을 가능성 | — | 실행값: `5beb954` 35 ↔ `08238c9` 35, 자리 목록도 **같은 29줄 + 지연 6**(`git archive` 로 꺼내 같은 스크립트로 잼) |

### 같은 사이클의 문서·코드와 교차 확인 (§후속 32 를 **손으로 미리 적용한다**)

계획 0011 §후속 32 가 열어 둔 것을 이 사이클도 손으로 이행한다(자리는 CLAUDE.md §6-3, 편집은 작업 6).

| 값 | 이 계획이 적은 것 | 다른 자리가 적은 것 | 갈리는가 |
|---|---|---|---|
| 정렬 미지정 자리 수 | **35** | 계획 0009 §후속 17 · 계획 0010·0011 이월 목록 · ADR 0015 §Deferred 3: **42** | **갈린다.** 42 는 휴리스틱 상한이고 0009 자신이 그렇게 적었다(§1-a) |
| 서버 `select(` 총수 | **63 히트 / 62 호출** | 계획 0009 §후속 17: **63** | 갈리지 않는다(같은 63). **62 는 이 계획이 새로 가른 값**이다 |
| 무정렬 다중행 실행 | **679** | ADR 0014 §5-3(`743bcb9`): **677** | **갈린다** — 트리와 통합 건수(205 → 216)가 다르다. 귀속은 재지 않았다(§확인하지 않은 것 3) |
| 순서의 축 | `created_at` **또는** PK(결정성만 필요한 자리) | ADR 0015 §2-1: *"`created_at` 값"* | **넓힌다.** 0015 는 *물리 배치가 아니다*를 말했고 이 계획이 *그러면 무엇인가*를 자리별로 가른다. ADR 0016 결정 2 가 그 관계를 적는다 |
| `confirm_mapping_row` 의 `.first()` | ⓒ(PK 세 컬럼 중 둘만 건다) | 계획 0011 §Deferred 4: 이름만 | 갈리지 않는다. **이 계획이 술어를 붙인다** |
| 이 사이클이 만지는 트리 | `services/api` · `services/progress` · **`services/sync`** | 지시: *"`services/progress`·`services/api`·`packages/core` 를 만질 가능성이 크다"* | **갈린다.** `packages/core` 는 만지지 않고(스키마 변경 없음), **`services/sync` 를 만진다**(A5, 소유 `sync-2d3d`) |
| **[라운드 3 이 더한다] 20칸 사망률** — *이 표가 쓰인 뒤 이 사이클이 만들어 낸 값이고, 그래서 위 여섯 행의 생성 기준에 칸이 없었다*(§M-7-4) | 이 계획: §M-1 표 7행(*"회귀 다섯 + 20칸"*) · §M-2-2 통제된 비교 표 · §M-3-4 · §M-4 · §M-5 47 · §M-5 48 · §M-6 2 · §M-6 34 ~~— **여덟 자리**~~ **· [라운드 4 가 더한다] §M-6 35**(*"여섯 칸은 여전히 N=1"* — 정본은 4/4 다) — **아홉 자리** | `tests/integration/test_22_row_order_contract.py` docstring(**정본**, 재측정) · ADR 0016 §2-3 정정 상자 · §4 닫힘의 한정 · §5 6행 · 커밋 본문 ~~**넷**~~ **[라운드 4] 여섯**: `cac4559`(**제목에까지**) · `94751c5` · `f5044b5` · `3a816c4` **· `3c6ac58`(자기 측정값) · `e3037df`(인용)** — 뒤의 둘이 **이 목록을 만든 커밋 자신**이고, 「인용만 하는 자리를 세는가」에 답이 없어 **다섯 ↔ 여섯**으로 갈린다(§후속 53) | **갈린다.** 초판 *"20칸 중 18칸이 죽고 두 칸은 구조다"* ↔ 재측정 *"역방향 열 칸 전부 죽음 / 삭제 열 칸 = 결정적 일곱 + 세션 의존 둘 + 안 죽는 하나"*. 갈린 원인 둘: **N=1 칸을 표에 둔 것**과 **이분법이 세션 의존 칸을 담지 못한 것**. **문서 자리는 이 라운드가 정정했고, 커밋 본문은 고칠 수 없다** — 그 사실 자체를 값으로 적는다. **[라운드 4] 그 「이 라운드가 정정했다」가 §M-6 35 한 자리를 빠뜨렸다** — 그 자리는 라운드 4 가 고쳤고, 빠진 이유가 **이 목록의 단위**였다(§후속 53) |
| **[라운드 3 이 더한다] 무정렬 계획의 이름(`EXPLAIN`)** | 이 계획: §M-2-2(탐침 12/12 둘) · §M-2-3 ②(*"인덱스 순서가 공짜"*) | ADR 0016 §2-3 정정 상자 · §6 대안 7 ② · `test_22` docstring(세션 안 계획 ↔ 사망 여부) | **갈린다.** 저장소 밖 2~3행 탐침은 칸마다 **한 계획**(12/12)을 냈는데 통합 세션 안에서는 **칸마다 계획이 둘씩** 섞이고(A3·pg 4/10 ↔ 6/10 · A5·pg 18/20 ↔ 2/20) **그 계획이 사망 여부를 38/38 예측한다.** 탐침의 이름이 두 칸 다 세션을 **틀리게 예측**했다 |
| **[라운드 3 이 더한다] `[ORD]` 사이클 뒤 값** | 이 계획 §1-c: **679**(`08238c9`) — 사이클 **전** 값 | ADR 0016 §4 의 예측 *"나머지 542"* · 커밋 `3a816c4` 본문 **542**(13 자리) · architect 재계수 **542**(N=2, 포트 55445) | **갈리지 않는다 — 세 자리가 같다.** 갈린 것은 **그 차이의 설명**이다: `3a816c4` 본문은 *"테스트 코드 프레임 4 → 12(+8) 로 늘어 두 몫이 상쇄됐다"* 라 적었는데, **옛 트리를 다시 재니 그 값은 이미 12 였다**(§M-7-3) |

---

## 열린 질문 / 리스크

1. **A4 의 동률을 만들 수 있는가.** `matcher.py:158` 의 `max` 는 `(conf, iou)` 로 가른다. 부동소수
   둘이 정확히 같아야 순서가 드러나는데, 그 상태를 픽스처로 만들 수 있는지 이 계획은 재지 않았다.
   → 작업 7 완료 조건 4 가 "못 만들면 값으로 적고 되돌린다"로 처분한다.
2. **ⓐ 의 정의가 「표시 순서」를 밖에 둔다**(§1-b 역방향 확인). 사용자에게 보이는 목록의 순서가
   매 요청 달라지는 것은 CLAUDE.md §6-4 의 관심사(*"CM 이 다음 행동을 고르는 유일한 입력"*)와
   경계가 붙어 있다. **이 계획은 "판정을 바꾸지 않는다"로 갈랐고 그 임의성을 여기 적는다.**
3. **다섯을 붙이면 계획이 바뀐다.** `ORDER BY` 는 인덱스 선택을 바꾼다 — ADR 0015 §2-1 이 배역에서
   **두 btree 가 비용 동률**이고 선택이 세션마다 갈리는 것을 쟀다. 정렬을 붙인 다섯 자리에서
   플래너가 무엇을 고르는지 **이 계획은 재지 않았다**(§확인하지 않은 것 5).
4. **§후속 16 이 이 다섯을 먼저 태운다.** 계획 0013 이 `tests/unit` 을 postgres 로 옮기면 수백 건이
   새 축으로 간다. 이 사이클이 다섯을 닫아 두는 것이 그 사이클의 비용을 줄이지만, **나머지 30 자리는
   그대로 열려 있다** — 16 이 열릴 때 ⓑ 로 판정한 24 자리에서 실패가 나면 **이 계획의 판정이 틀린 것**
   이고, 그때 이 표가 반증 가능한 형태로 남아 있는 것이 이 계획의 산출물이다.

---

## ADR 필요 여부

**필요하다 — `docs/adr/0016-ordering-is-a-contract-only-where-a-consumer-picks-one-row.md`.**

ADR 0015 §Deferred 3 이 *"계획 0009 §후속 17 의 42자리. 이 ADR 은 그 축을 열지 않는다"* 로 남겨 둔
자리를 여는 것이고, ADR 0015 §2-1 의 축(`created_at` 값)을 **결정 2 로 좁혀 나눈다**(의미의 축 ↔
결정성의 축). 실을 것: 결정 1~4 · 개수(**ⓐ 5 · ⓑ 24 · ⓒ 6**, `08238c9`)와 **재계수 명령** · **ⓐ 다섯과 ⓒ 여섯은
이름으로**(판정을 싣는 행이다) · §6-3 역방향 표 · §Deferred. **ⓑ 24행 표는 다시 싣지 않는다** —
계획 §1-b 가 정본이고 두 자리에 두면 갈린다(§1-e 4).

---

## 후속 — 다음 사이클로 넘기는 것

> **다음 사이클 순서(리뷰어 확정 — 이 계획은 바꾸지 않는다).**
> **0013 = §후속 16 + 30 + 31 + 37**(qa + architect) · **0014 = §후속 18**, 그 뒤 **2 · 3 · 6 · 11 · 23 · 24**.
> **CLAUDE.md 대기열은 병행 커밋**(계획 0011 과제 0 판정: `:418` 은 압축 전용) —
> **§6-3(32) → §6-5(25 + 27·34·39 규칙 + §6-1 의 27·34 근거 행 + 38 흡수 한도) → §2(19).**
> **이 사이클이 §6-3(32) 를 붙인다**(작업 6). 남은 순서는 그대로다.

**이월 규칙.** 계획 0011 §후속 **1~39** 를 **번호를 유지한 채** 옮긴다. 닫힌 항목은 지우지 않고
취소선 + 닫은 근거 + **닫힘의 한정**을 남긴다. 신규는 **40번부터** 잇는다.
*계획 0008 §M-2-2 의 규칙을 이 목록에도 건다*: **본문 목록을 번호로 옮긴다, 새로 쓰지 않는다.**

1. ~~**§6-2·§6-4 압축**(architect).~~ → **닫혔다**(계획 0007 §과제 1).
2. **`"rejected"` 값 리터럴의 전수 감사**(qa). **이 계획은 재측정하지 않았다.**
3. **`apps/web/src/api/client.ts:12` 의 TODO**(qa). **재측정하지 않았다.**
4. **검토요청 *승인*의 사유 요건**(ADR 0011 §Deferred 1 / ADR 0012 §Deferred 1). **저장소로는 답할 수 없다.**
5. ~~**취소의 내구 감사를 붙드는 회귀 + V8 docstring**(qa).~~ → **닫혔다(`716d67d`).**
6. **`docs/api.md` 오류 절의 예외 열거와 `internal_error`**(api). **재측정하지 않았다.**
7. ~~**`cancelled_review_request_id` 의 갱신 갈래**(progress-engine).~~ → **닫혔다**(`662e91a` + `3ba9226`).
8. ~~**`find_document_mapping_review` 의 `ORDER BY created_at DESC` 가 무보호**(qa).~~ → **닫혔다**(`3ba9226`).
   **한정: 잰 것은 줄 삭제 변이 하나뿐이다.** *이 계획이 더하는 한정*: 그 정렬은 **타이(같은 `created_at`)를
   가르지 못한다** — §후속 41.
9. ~~**`document_mapping_reviews` 의 `sorted(...)`**(qa).~~ → **닫혔다**(`7d44cca`).
   계획 0010 이 더한 한정(심기의 착지는 postgres 에서 계약이 아니다)은 그 계획이 §후속 21 로 닫았다.
   *이 계획의 전수 목록에서 그 자리는 **ⓑ** 다*(호출자가 `sorted` 한다 — `persistence.py:489`).
10. ~~**PostgreSQL 경로가 비어 있다**(qa + architect).~~ → **닫혔다**(계획 0009 §M-3-c) — 그 한 축에 한해서.
11. **확정 축의 `expert_review_logs` 도 무보호**(qa). **재측정하지 않았다. 변이도 여전히 재지 않았다.**
12. ~~**단위 파일 머리의 "다음 여섯 항목"**(qa).~~ → **닫혔다**(`e6fa92f`, 계획 0010 §M-3).
13. ~~**`test_20:29` 의 표 행이 트리를 인라인으로 적지 않는다**(qa).~~ → **닫혔다**(`f6ad00e`, 계획 0010 §M-3).
14. ~~**`test_20:770` 의 *"이 사이클(기준선 807)"***(qa).~~ → **닫혔다**(`68b5795`, 계획 0011 §M-4).
15. ~~**§6-1 12회차 행의 *"밀려난 것"* 칸을 넓힐지**(architect).~~ → **닫혔다**(`f101001`).
    **한정: 리뷰어가 규칙(`:402` 갱신 규칙) 안이라 판정한 것이지, 그 행이 더 안 커진다는 뜻이 아니다**(§후속 38).
16. **`tests/unit` 을 postgres 로 돌린다**(qa). **계획 0013.** *이 계획이 그 사이클에 주는 것*:
    ⓐ 다섯이 닫히면 순서 의존 실패의 다섯 경로가 미리 사라진다. **나머지 30 은 그대로 열려 있다.**
17. **정렬을 지정하지 않은 42자리의 순서 계약**(architect + progress-engine + api + **sync-2d3d** + qa).
    **이 사이클의 대상이다 — 그러나 이 계획은 그것을 닫지 않는다.** 닫는 것은 **ⓐ 다섯뿐**이고
    (작업 3·4·5 가 정렬을, 작업 7 이 회귀를 붙였을 때), 자리 수는 **42 가 아니라 35** 다(§1-a).
    남는 것은 **40**(ⓒ 여섯) · **41**(정렬이 있는데 타이가 남는 자리) · **42**(ⓑ 를 강제하는 기계).
    **다음 이월 목록이 이 항목을 「닫혔다」로 옮기면 §6-1 12회차의 재발이다** — 닫히는 것은
    *"ⓐ 로 갈린 다섯 자리"* 이지 *"정렬 미지정 자리"* 가 아니다.
    **소유가 하나 더 있었다**: `services/sync`(A5, `sync-2d3d`) — 0009 가 적은 배정에 없던 트리다.
18. **데모 시드를 앱 기동에서 떼어낸다**(api + qa, ADR 0014 §Deferred 1). **계획 0014.**
19. **소유가 §2 에 없는 파일들**(architect). **§2 트랙 — CLAUDE.md 대기열의 넷째.** **재측정하지 않았다.**
20. ~~**`services/progress/persistence.py:433` 의 *"실측(SQLite, …)"***(progress-engine).~~
    → **닫혔다**(`ac6b30b`). **한정: 리뷰어가 `.desc()`→`.asc()` 변이를 다시 태워 확인한 것이 근거다.**
21. ~~**postgres 축의 흔들림**(qa).~~ → **닫혔다**(계획 0010 §M-8, 작업 3 의 세 칸에 한해서).
    닫지 않은 것: *"CI 에서 관측된 그 1회가 이 기전이었다"*.
22. ~~**`postgres_axis` 계약의 실패 문구가 경위를 하나로 단정한다**(qa).~~ → **닫혔다**(계획 0010 §M-2-2).
23. **`postgres.measured.json` 의 `server_version` 을 어떻게 할지**(qa + architect). **이월.**
    재개 조건 그대로(*단언·비교가 하나라도 생기는 순간*). **이 계획은 그 파일을 만지지 않는다.**
24. **PostGIS 가 로드된 DB 에서 무엇이 달라지는가**(qa). **이월.** 이 계획의 클러스터에도 부재.
25. **CLAUDE.md §6-5 의 *"잡은 것은 언제나 바깥에서 읽은 리뷰어였다"* 를 좁힌다**(architect).
    **대기열의 둘째** — 이 사이클이 아니다(자리는 §6-5, 이 사이클은 §6-3 만 만진다).
    **반례는 2건**(ADR 0014 §2-5 를 `qa` 가 잡은 것 + 계획 0010 §M-2-1).
26. ~~**§확인하지 않은 것에 소유를 배정한다**(architect).~~ → **닫혔다**(계획 0010). 이 계획도 그 형식을 지킨다.
27. **postgres 축의 부정 단정에는 N 을 함께 적는다**(architect + qa). 자리는 **§6-5 「적용 지점」 표의 행**.
    편집은 §6-5 사이클. **그때까지 계획마다 손으로 적는다** — 이 계획: §1-a 두 트리 각 N=1(정적 계수) ·
    §1-c N=1 세션(216 테스트) · §1-d 변이 N=1 실행/자리.
28. ~~**강제 셋의 배선 둘은 지워도 전량이 초록이다**(qa).~~ → **닫혔다**(계획 0010 §M-8).
    한정: 그 기구 자신은 무보호이고 감수 판정됐다(계획 0010 §M-7 1).
29. ~~**부분집합을 postgres 축으로 돌리면 트리가 더러워진다**(qa).~~ → **닫혔다**(`98ce2d6`).
    **남는 것(구조적)**: 게이트 **제거 변이** 실행은 여전히 파일을 더럽힌다.
    *이 계획의 실측이 그 닫힘을 한 번 더 확인한다*: 전량 통합 실행 뒤 루트 `git status --porcelain` **빈 출력**.
30. **테스트 DB 의 `autovacuum` 을 끌 것인가**(qa + architect). **계획 0013**(16 과 함께).
31. **재배치의 상대 순서가 FSM 앞 페이지 경로에서도 지켜지는지**(qa). **계획 0013**.
32. **CLAUDE.md §6-3 의 *인접 절 교차 확인*을 "같은 사이클의 문서들"로 넓힌다**(architect).
    **이 사이클의 작업 6 이 닫는다.** 이 계획도 그 규칙을 손으로 미리 적용했다(§6-3 표 아래 교차 확인 표
    — 여섯 값 중 **넷이 갈렸다**).
33. ~~**CLAUDE.md §6-1 *역방향 확인*의 표기 집합에 "보간"을 더한다**(architect).~~ → **닫혔다**(`f101001`).
34. **수치 조건에는 값을 만든 방법과 N 을 함께 적는다**(architect + qa). 자리는 §6-5.
    **이 계획이 실례를 하나 더한다(여섯 번째)**: *"42자리"* 는 **N 도 방법도 없이** 세 문서를 건너
    다섯 사이클을 살았다 — 만든 방법(줄 단위 grep 휴리스틱)을 0009 가 적어 두었는데도 이월본은
    **숫자만** 옮겼다. 실제 값은 그 트리에서도 **35** 다.
35. ~~**ADR 0015 §2-1 표 1행과 `test_20` docstring 이 한 인덱스 이름을 계약처럼 적는다**(architect + qa).~~
    → **닫혔다**(`3dddf58` + `a6f64a6`). **한정: 1차 판정이 반증된 뒤에 닫혔고**(계획 0011 §M-2-1),
    남는 것은 *"그 EXPLAIN 이 어느 세션이었나"* — **세션은 재현할 수 없다.**
36. ~~**ADR 0015 §0 의 못박음을 좁힌 것이 §2~§5 의 다섯 자리를 시점 없이 남겼다**(architect).~~
    → **닫혔다**(`2fb0c1a` + `a6f64a6`). **한정: 센 것은 ADR 0015 하나뿐이다** — 다른 문서가 같은
    모양인지는 열려 있다(계획 0011 §확인하지 않은 것 6). **이 계획의 §0 은 그 교훈대로 썼다.**
37. **`test_99` 를 postgres 축에서 *단독*으로 돌리면 `test_axis_mode_matches_the_environment` 가
    빨갛다**(qa). **선재 결함.** **계획 0013**.
38. **§6-1 의 「근거 추가」가 압축보다 훨씬 빠르게 커진다 — 갱신 규칙에 흡수 한도를 둔다**(architect).
    자리는 **§6-5** — 대기열의 둘째. **이 사이클은 §6-3 만 만지므로 여기서 되돌리지 않는다.**
    *이 사이클이 값을 하나 더한다*: §6-3 에 11회차 행 + 규칙 불릿을 더하니 §6 이 **18,204 → 19,070자
    (+866, 62.1% → 63.2%)** 다(§1-h 표). **방향은 계획 0011 과 같고 크기는 그 사이클(+1,256)보다 작다.**
    `f101001` 에서 못박힌 압축 문턱의 분모(15,148자)와의 차는 **+3,922자**다.
39. **탐침의 필터에도 §6-1 을 건다**(architect + qa). 규약의 자리는 CLAUDE.md §6-1, 순서는 §6-5 커밋.
    **이 계획이 근거를 하나 더 얻었다**: 이 계획의 1차 필터(파일 전역 `<대상>.order_by(` 정규식)가
    **6 을 12 로** 부풀려 정렬 미지정을 **35 → 29** 로 과소 계상했다(§1-a 상자). **이번에는 목록을
    쓰기 전에 잡혔고**, 잡은 것은 **같은 값을 두 트리에서 잰 형식**이었다 — 39 를 여는 사이클에
    그 처방(*"탐침 값은 서로 다른 두 입력에서 재고 갈리면 멈춘다"*)을 문안 후보로 넘긴다.
    **그때까지는 계획마다 손으로 적는다.**

**신규(이 계획이 연다):**

40. **ⓒ 여섯 자리 — 스키마가 유일성을 강제하지 않는데 코드가 유일하다고 믿는다**
    (api + sync-2d3d + bim-ingest + progress-engine + architect). §1-f 의 표가 자리와 이유를 적는다.
    답은 `ORDER BY` 가 아니라 **① 유일 제약 ② 둘 이상이면 실패 ③ 결정적 선택** 셋 중 하나이고
    자리마다 다르다. **`services/api/auth/router.py:23`(로그인)이 가장 급하다** — 잘못 고르면 다른
    계정으로 인증된다. **계획 0011 §Deferred 4(`confirm_mapping_row`)가 이 항목에 흡수된다.**
41. **정렬이 있는데 **타이가 남는** 자리**(architect + qa). §1-a ②ⓔ 가 이름 붙인 블라인드 스팟이고,
    이 계획의 목록은 `order_by` 의 **유무**만 봤다. 알려진 자리 하나:
    `services/progress/persistence.py:458` 이 스스로 *"같은 `created_at` 을 갖는 두 행은 이 정렬로
    갈리지 않는다 — 그 경우 순서는 다시 스캔 순서다"* 라고 적는다. **전수는 세지 않았다.**
42. **ⓑ 판정을 기계가 붙들 수 있는가**(architect + qa). §1-e 의 판정(*"ADR 표에 기록, 코드에 주석 없음"*)
    은 **강제를 만들지 않는다.** 소비자가 다른 파일·다른 언어(`.tsx`)에 있어 정적 판정이 안 된다는
    것이 기각 근거인데, **그 기각을 실행으로 태우지 않았다.** 계획 0004 §후속 1 의 `make lint` 감사와
    같은 자리로 묶을 수 있는지도 이 항목이다.
43. **`ORDER BY` 를 붙인 다섯 자리에서 플래너가 무엇을 고르는가**(qa). ADR 0015 §2-1 이 배역에서
    **두 btree 의 비용 동률**을 쟀고 선택이 세션마다 갈렸다. 정렬을 붙이면 그 동률이 어떻게 되는지
    이 계획은 재지 않았다(§확인하지 않은 것 5). **§후속 16 이 힙을 키울 때 함께 잰다.**

---

## Deferred — 이 사이클이 보고 고치지 않는 것 (계획 0011 §Deferred 이월, 재측정하지 않았다)

1. **객체가 검측 루프를 떠난 뒤에도 닫히지 않는 inspection 요청.**
2. **반려된 2D↔3D 매핑이 뷰어 계약에 계속 실린다**(sync-2d3d 소유, 별도 ADR 필요).
3. **확정↔취소 반복의 누적.**
4. ~~**`confirm_mapping_row` 의 `.first()`**(`services/sync/review_queue.py`).~~
   → **§후속 40 으로 옮겼다.** 이 계획이 술어를 붙였다(§1-f): PK 세 컬럼 중 둘만 건다.
   **번호를 지우지 않고 여기 남긴다** — 자리를 옮긴 것이지 닫힌 것이 아니다.
5. **`on_hold` 에 공백만 note 를 보내면 `"   "` 가 그대로 저장된다.**
6. **ADR 0013 §Deferred 1~8** 은 그 ADR 이 소유한다.

**ADR 0014 §Deferred 1~6 · ADR 0015 §Deferred 1~6 · ADR 0016 §Deferred** 는 **그 ADR 들이 소유한다.**
여기 옮겨 적지 않는다.

---

## 이 계획이 확인하지 않은 것

**계획 0011 §M-5(본문 1~28 + 신규 29·30·31)를 번호를 유지한 채 옮기고**, 이 계획이 처분한 것만 적는다.
형식은 **[재지 않았다]** / **[재야 한다 → 소유 · 언제]**(계획 0010 §후속 26 이 세운 것).

1. **[재야 한다 → qa · §후속 24 를 열 때]** CI 의 `postgis/postgis:16-3.4` 에서 아무것도 재지 않았다.
   **이 계획도 CI 를 돌리지 않았다**(푸시하지 않는다).
2. **[재지 않았다]** 정렬 축을 바꾸는 변이 — *이 계획이 다섯 자리에서 정확히 그것을 쟀다*(§1-d).
   **남는 칸 [재야 한다 → qa · 작업 7 에서]**: 회귀가 붙은 뒤의 **삭제 변이**(오늘은 붙일 정렬이 없어
   지울 것이 없었다).
3. **[재야 한다 → architect 또는 qa · §후속 16 을 열 때]** **679 ↔ 677 의 차이를 무엇이 만들었나.**
   통합이 205 → 216 이 된 것으로 설명되지만 **그 귀속을 실행으로 태우지 않았다**(옛 트리에서 탐침을
   돌리지 않았다).
4. **[재지 않았다]** **전량 둘을 동시에 돌렸을 때의 파일 경합**(계획 0011 §확인하지 않은 것 4 그대로).
5. **[재야 한다 → qa · 작업 3·4·5 뒤]** **정렬을 붙인 다섯 자리의 `EXPLAIN`.** ADR 0015 §2-1 의
   비용 동률이 어떻게 되는지 재지 않았다 → §후속 43.
6. **[재지 않았다]** **이 목록이 쓰인 뒤 같은 사이클의 커밋이 닫는 항목** — §6-1 12회차가 이름 붙인
   칸이고 계획 0010·0011 이 재측정을 하고도 걸렸다. **이 계획도 막는 기계를 갖지 않는다.**
7. **[재야 한다 → architect · §후속 36 의 뒷면]** **다른 ADR·계획의 못박음이 같은 모양인지.**
8. **[재야 한다 → architect · §후속 25 를 열 때]** §6-5·§6-1·§6-3 의 **근거 표면**을 재지 않았다.
   **작업 6 이 §6-3 을 늘리므로 그 값은 커밋 뒤에 다시 재야 한다.**
9. **[재지 않았다]** `qa` 가 보고한 서버 변이 14건.
10. **[재지 않았다]** §6-1 12회차 외 다른 행의 관측값 재현.
11. **[재지 않았다]** **ⓑ 24 자리의 소비자를 「전부」 훑었는가.** 각 함수의 호출부를 루트 grep 으로
    찾아 읽었지만, **호출부의 호출부**까지 끝까지 따라간 것은 ⓐ 다섯과 ⓒ 여섯뿐이다.
    **[재야 한다 → qa · §후속 16 이 빨개질 때]** — 그때 빨개지는 자리가 이 판정의 반증이다.
12. **[재지 않았다]** `[PG-after-update-*]` 가 순서를 바꾸지 않은 기전(HOT update 가설).
13. **[재지 않았다]** `tests/e2e` 를 postgres 로. **`make e2e` 도 이 사이클에 실행하지 않는다.**
14. **[재지 않았다]** `[ORD]` 679 는 `tests/integration` 한 트리의 값이다. `tests/unit` 은 세지 않았다.
15. **[재야 한다 → qa · 통합 테스트 수가 바뀔 때]** 바닥값의 CI 표본은 여전히 2회다.
16. **[재지 않았다]** **A4 의 동률을 픽스처로 만들 수 있는가**(§열린 질문 1).
17. **[재야 한다 → qa+architect · §후속 23 의 재개 조건에서]** 커밋된 `postgres.measured.json` 이
    CI 가 재현하지 않는 환경을 영구히 기술한다. **이 계획은 그 파일을 바꾸지 않는다.**
18. **[재야 한다 → qa · §후속 24]** PostGIS 가 있을 때 무엇이 달라지는가.
19. **[재야 한다 → qa · 다음 발생 시]** CI 의 그 1회.
20. **[재야 한다 → architect · 커밋 직전]** `make test` 네 갈래 + vitest + `make lint`.
21. **[재지 않았다]** CI 초록의 표본은 늘지 않았다.
22. **[재지 않았다]** HOT 가지치기 단독 경로.
23. **[재지 않았다]** **화면이 서버 순서를 잃는 방향**(§1-a ②ⓕ). `apps/web` 이 목록을 받아 다시
    정렬하거나 `Map` 에 담아 순서를 바꾸는 자리를 세지 않았다.
24. **[재지 않았다]** 작업 7 의 새 회귀가 CI 러너에서 도는 비용.
25. **[재지 않았다]** (계획 0010 §M-9 25) `qa` 의 미커밋 편집 내용. **이 사이클에는 해당 없음** —
    착수 시 루트 `git status --porcelain` 이 **빈 출력**이었다.
26. ~~축이 포트를 공유 자원으로 쓴다~~ → **계획 0011 §1-c 가 쟀다.** 이 계획은 관례대로 **55438** 을 썼다.
27. **[재지 않았다]** `test_99` 자식 기구와 게이트의 상호작용 — 계획 0011 작업 3 에서 `qa` 가 확인했다.
28. ~~인덱스 선택~~ → **질문이 틀렸다**(계획 0011 §M-2-1). 남는 세 칸은 ADR 0015 §Deferred 6.
29. **[재지 않았다]** OID 타이브레이크 가설의 기전.
30. **[재지 않았다]** 세 측정의 비율 차이(5/10 · 6/10 · 6/10)가 유의한가.
31. **[재지 않았다]** 게이트 제거 변이가 남긴 측정 파일 더러움의 뒷이야기. **주체를 실을 칸이 없다.**

**신규(이 계획이 더한다):**

32. **[재지 않았다]** **ⓐ 의 정의(「위치로 한 원소를 고른다」)가 놓치는 소비자 모양.**
    `itertools.groupby`(정렬 전제) · `zip`(두 목록의 짝) · `enumerate` 로 만든 키 · **파이썬 `dict` 의
    삽입 순서**를 세지 않았다. 마지막 것이 특히 아프다 — `{r.doc_id: r for r in rows}` 는 같은 키가
    둘이면 **뒤에 온 것이 이긴다**(`documents_by_ids`·`project_documents` 가 정확히 그 모양이고
    이 계획은 둘 다 ⓑ 로 놓았다). **[재야 한다 → architect · §후속 40 을 열 때]** — 40 과 같은
    "유일하다고 믿는다" 축이다.

---

# 사이클 마감 (architect, 2026-09-07)

## M-0. 이 마감의 실측이 나온 자리 (재현 방법)

**작업 트리** `/home/user/Bim/buildtwin`, 저장소 루트 `/home/user/Bim`, 브랜치
`claude/buildtwin-initial-setup-ubulzb`, **마감 착수 시 HEAD `cac4559`**(qa 의 작업 7),
루트 `git status --porcelain` **빈 출력**. 다른 에이전트의 in-flight 편집은 **없었다** —
계획 0010·0011 이 세 사이클 연속 겪은 모양이 이번에는 나지 않았다.

**이 절 아래의 `파일:줄`·커밋 참조는 `cac4559` 트리의 것이고, 본문(§0~§확인하지 않은 것)의
`08238c9` 참조는 갱신하지 않는다**(CLAUDE.md §3-13 첫째 갈래). ~~**본문을 고친 자리는 셋뿐이고**
(§0 의 DB 문단 · §1-d A5 칸 · 작업 7 완료 조건 2)~~ **전부 그 자리에서 「정정/보강」임을 적고 원문을
지우지 않았다**(취소선 또는 대괄호 표시).
**[정정 — 리뷰 라운드 2] 「셋뿐」은 개수이고, 다음 라운드가 그것을 거짓으로 만들었다** — 이 라운드가
§1-d A5 칸에 한 줄을 더 고쳤다(`broker.ts:76` → ⓑ). CLAUDE.md §6-1 9회차(*"열거는 길이가 곧
개수다 … 개수도 세지 않는다"*)가 `packages/core/models/` 주석에 건 요구를 **이 마감 절 자신이
어겼다.** 그래서 개수를 지우고 **부재 단정**만 남긴다: **이 문서에서 원문을 지운 자리는 없다**
(취소선 또는 대괄호 정정으로만 고쳤다 — 이 문장은 `git diff` 로 반증 가능하다).

**DB.** **포트 55442** 에 내 클러스터를 따로 띄웠다(`/var/lib/postgresql/pg0012b`,
`initdb -A trust`, `PostgreSQL 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)`).
축 URL 은 `postgresql+psycopg://postgres@127.0.0.1:55442/buildtwin`.

> **포트를 어떻게 쟀는가 — `ss` 가 이 컨테이너에 없다(`which ss` exit 1).**
> `api`·`sync-2d3d`·`qa` 셋이 독립으로 같은 것을 확인했고 이 마감이 넷째다. 그래서 쟀다:
> `/proc/net/tcp` 에서 **상태 `0A`(LISTEN)** 인 행의 로컬 포트를 뽑고, 이어서
> `socket.bind(("127.0.0.1", p))` 로 실제로 물어 봤다. 실행값: **55430~55450 구간에 LISTEN 0건**,
> `bind` 는 **55442 에서 성공**.
>
> **[정정 — 대체 기구도 같은 결함을 갖고 있었다. §M-3-2 가 이름 붙인 바로 그 모양이다.]**
> 초판은 *"`/proc/net/tcp` 와 `/proc/net/tcp6` 에서"* 라 적었는데 **이 컨테이너에 `/proc/net/tcp6`
> 가 없다**(`os.path.exists` → `False`). 내 스크립트는 그 자리를 `except FileNotFoundError: pass`
> 로 삼켜서 **파일 부재와 「LISTEN 0건」이 다시 구별되지 않았다** — `ss` 를 대체하려고 만든 기구가
> **같은 결함을 갖고 태어났다**(CLAUDE.md §6-3 ②: *"규칙과 그 위반은 같은 커밋에서 함께 태어날 수
> 있다"*). 고친 뒤 실행값은 같다(**IPv4 LISTEN 0건**). **결론이 무너지지 않는 이유는 기구가
> 하나 더 있었기 때문**이고 그것이 처방의 핵심이다: **`bind` 는 성공/실패로 답하는 양성 검사**라
> 도구 부재와 섞이지 않는다. **부재를 단정할 때 그 부재를 낼 수 있는 다른 경로를 함께 두라**는
> §후속 46 의 처방이 이 자리에서 값으로 검증됐다 — **한정: IPv6 로만 물린 리스너는 이 기구로
> 보이지 않는다**(그 파일이 없으므로). 재지 않았다 → §M-6 36. 관측된 사용 이력: qa 55432·55435·**55441** ·
> 리뷰어 55432·55436 · architect 55433(0010) · 55434·55437(0011) · **55438**(이 계획 본문) ·
> progress-engine **55439** · api **55440** · **architect(이 마감) 55442**. 충돌 0건.
> **`pg_lsclusters` 만으로는 남의 임시 클러스터가 보이지 않는다** — 그 명령은 시스템 클러스터만
> 열거한다(오늘 실행값에도 `16 main 55432 down` 한 줄뿐인데 그때 다른 사람들의 임시 클러스터가
> 데이터 디렉터리로 남아 있었다: `/var/lib/postgresql/pg0011`·`pg0011b`·`pg0011qa`·`pg0011rev`·`pg0012`).

**탐침·변이**는 **저장소 밖 스크립트**(`.../scratchpad/mut2.py`)이고 `tests/` 에 파일을 만들지 않았다.
변이는 **한 건씩** 적용 → `git diff --stat` 으로 적용 확인 → 세션 N회 측정 → 원복 → 루트
`git status --porcelain` 확인. postgres 축 실행이 `tests/postgres.measured.json` 을 쓰면 스크립트가
그 자리에서 `git checkout --` 로 원복하고 그 사실을 출력한다(이번 실행에서 그 원복은 **0건** —
값이 커밋된 값과 같아 트리가 더러워지지 않았다).

## M-1. 이 트리의 절대값 · 각 작업의 실제 결과

| 축 | 명령 | 값 | 잰 트리 |
|---|---|---|---|
| sqlite 전량 | `.venv/bin/pytest -q` | **838 passed** (88.20s) | `cac4559` (clean) |
| postgres 통합 | `BUILDTWIN_CI_POSTGRES_URL=…55442… pytest -q tests/integration` | **222 passed** (46.36s), `dialect=postgresql server_version=16.13 tests_on_postgres=187 engines=1 floor=187 measured_file=postgres.measured.json(썼다)` | 같은 트리 |
| 전량 실행 뒤 트리 | `git status --porcelain` | **빈 출력** | 같은 트리 |

**중계받은 값과 내 값이 전부 일치한다**(838 / 222 / 187·1·187). **갈린 자리가 없다.**
`make test`·`make lint` 는 §M-6 게이트 표에 있다.

| # | 소유 | 계획한 것 | 실제 | 커밋 |
|---|---|---|---|---|
| 1 | architect | 계획 0012 | 그대로 | `4ad43a1` |
| 2 | architect | ADR 0016 | 그대로. **결정 3 이 이 사이클 안에서 반증돼 정정됐다** — M-2 | `330ee81` + 이 커밋 |
| 6 | architect | CLAUDE.md §6-3(32) | 그대로 | `ceb18e9` |
| 3 | **api** | A1·A2·A4 정렬 | 그대로(키를 바꾸지 않았다). 커밋 본문이 *"아직 무보호다"* 를 값으로 적었다 | `57fc8ff` |
| 4 | **progress-engine** | A3 정렬 | 그대로 | `7e4b160` |
| 5 | **sync-2d3d** | A5 정렬 | 그대로. **계획에 없던 소비자 둘을 찾아 보고했다** — M-3-3 | `2be9918` |
| 7 | **qa** | 회귀 다섯 + 20칸 | 회귀 **여섯**(A3 이 소비자 둘이라 둘). 바닥값 181 → **187**. **두 칸이 안 죽는 것을 닫지 않고 architect 에게 넘겼다** | `cac4559` |

## M-2. 판정 — **결정 2 ↔ 결정 3 의 충돌: ⓐ(결정 3 에 한정어를 단다). 결정 2 는 바꾸지 않는다**

`qa` 가 넘긴 물음: *"결정 2 를 따라 키를 고르면(PK 나머지) 결정 3 의 삭제 변이가 그 자리에서
원리적으로 관측 불가다"*. 셋 중 하나를 고르라 했고 — ⓐ 결정 3 에 한정어 / ⓑ 결정 2 의 키 규칙 변경 /
ⓒ 둘 다 두고 §후속 — **ⓐ 를 고른다.**

### M-2-1. 왜 ⓐ 인가 — **초판이 두 가지를 하나로 묶었다**

초판 문장(지우지 않고 인용한다): *"**삭제 변이가 안 죽으면 그 회귀는 장식이다**"*.
그 문장은 서로 다른 둘을 한 이름으로 불렀다.

| | 무엇의 성질인가 | 무엇이 재는가 |
|---|---|---|
| ① **회귀가 그 원소를 보지 않는다** | **테스트**의 결함 | **역방향** 변이 — 엔진이 어떤 계획을 고르든 **다른 답을 강제**한다 |
| ② **엔진의 기본 계획이 그 정렬과 같은 순서를 낸다** | **엔진**의 성질 | **삭제** 변이 |

**①만 회귀를 장식으로 만든다.** 그러므로 계약은 *"**역방향** 변이가 안 죽으면 그 회귀는 장식이다"* 로
좁히고, 삭제 변이는 **엔진 관측**으로 격을 낮춘다 — 없애지는 않는다.
그리고 **②는 정렬을 지울 근거가 아니라 정렬이 있어야 하는 근거다**: 그 "같다"는
**세션마다**(ADR 0015 §2-1) 그리고 **행 수마다**(ADR 0014 §4-1 `[PG-bulk-plan]`, 200행에서
Index Scan → Seq Scan) 깨진다. 우연히 맞고 있는 것을 계약으로 못박는 일이 이 ADR 이 하는 일이다.

### M-2-2. 근거는 **통제된 비교**다 — architect 가 직접 재현했다

`qa` 의 20칸을 그대로 믿지 않았다. 판정 전체가 하나의 비교에 걸려 있으므로 **그 비교를 내가 다시
쟀다**(같은 트리 `cac4559`, **내 포트 55442**·다른 클러스터, 명령 `pytest -q tests/integration`,
**N 의 단위 = pytest 세션**):

| 칸 | qa (`cac4559`, 포트 55441) | **architect 재현 (포트 55442)** |
|---|---|---|
| A5 삭제 · **sqlite** | 죽은 세션 **0/10** | **0/5** — 일치 |
| A5 삭제 · **postgres** | **1 failed** (N=1) | **2/5** — **갈린다**(아래 M-3-4) |
| A3 삭제 · **postgres** | 죽은 세션 **5/10** | **4/10** — 같은 성질(세션 의존) |
| A3 삭제 · **sqlite** | 2 failed (N=1) | **2/2** 죽음 — 일치 |

**결정적인 것은 A5 의 두 칸이다.** *같은 테스트·같은 픽스처·같은 변이*인데
**sqlite 에서는 한 번도 안 죽고 postgres 에서는 죽는다.** 갈리는 변수는 **엔진**이고,
같은 엔진 안에서는 **세션**이다. **둘 다 회귀의 성질이 아니다.** 그러므로 그 칸은 회귀의 품질에
대해 아무것도 말하지 못한다 — 초판이 그것을 품질 게이트로 쓴 것이 오류다.

`qa` 가 기전에 이름을 붙였다(저장소 밖 탐침, 세션 12회): A3 무정렬은
`Index Scan using activity_object_mappings_pkey` **12/12** 로 첫 행이 정답과 같고, A5 무정렬은
postgres 에서 `Bitmap Heap Scan` **12/12**(삽입 순서 → 죽는다)인데 SQLite 는
`SEARCH … USING INDEX sqlite_autoindex_entity_object_mappings_1 (drawing_id=?)` 라 첫 행이 정답과
같다. **붙인 키가 「필터를 뺀 PK 나머지」라서** 그 계획에서는 무정렬이 그 순서를 공짜로 낸다.

**[정정 — 리뷰 라운드 3] 위 네 칸도, 그 아래 `12/12` 도 다시 재졌다**(`qa`, 잰 트리 `3a816c4`,
정본은 `test_22` docstring). ① 네 칸의 재측정값은 **A5 삭제·sqlite 0/10 · A5 삭제·pg 2/20 ·
A3 삭제·pg 6/10 · A3 삭제·sqlite 10/10** 이다 — 위 표에서 `2 failed`(N=1)로 적힌 **A3·sqlite 는
세션 의존이 아니라 결정적 사망**이고, 내가 `2/2` 로 본 것이 그 방향이었다. ② **`12/12` 두 값은
저장소 밖 2~3행 탐침의 것이고 통합 세션을 틀리게 예측한다** — 세션 안에서 A3·pg 는 pkey **4/10** ·
`ix_…_project_id` **6/10**, A5·pg 는 pkey **18/20** · `Bitmap Heap Scan` **2/20** 이다.
**그러므로 이 절이 「기전에 이름을 붙였다」고 적은 그 이름은, 새 게이트로는 이름이 아니었다**
(§M-7-1). 원문은 지우지 않는다.

### M-2-3. ⓑ 와 ⓒ 를 기각한 근거

- **ⓑ(결정 2 의 키 규칙을 바꾼다) 기각.** **테스트가 개를 흔든다.** ① 키의 근거가 *"소비자가 무엇을
  묻는가"* 에서 *"변이가 죽게 하려고"* 로 바뀐다 — 결정 2 가 금지하는 바로 그 종류의 근거다.
  ② PK 접두사는 인덱스 순서가 **공짜**인데(위 `Index Scan … pkey` 12/12) 다른 키는 플래너에게
  **실제 정렬을 시킨다** — 검증 편의로 운영 비용을 낸다.
  **[정정 — 리뷰 라운드 2] ②는 한 자리에서 일반화됐다 — 「공짜」는 A3 에서만 관측된 값이다.**
  같은 「필터를 뺀 PK 나머지」 키인데도 **A5 의 무정렬 계획은 postgres 에서 `Bitmap Heap Scan` 12/12**
  이고(위 §M-2-2 에 이미 실린 `qa` 의 12세션 값 — 리뷰어의 재측정도 같다), Bitmap Heap Scan 은 인덱스
  순서를 잃으므로 그 자리에 `ORDER BY` 를 붙이면 **플래너가 실제로 Sort 를 한다.** architect 가 직접
  확인한 것은 **구조**다: 두 자리는 키 모양이 같다 — A3 은 PK `(project_id, activity_id, global_id)` ·
  필터 `project_id` · 키 `(activity_id, global_id)`, A5 는 PK `(drawing_id, entity_handle, global_id)` ·
  필터 `drawing_id` · 키 `(entity_handle, global_id)`(`packages/core/models/orm.py` 의 두 클래스와
  `services/progress/persistence.py` `load_mappings` · `services/sync/persistence.py` `load_mappings`).
  **모양이 같은데 계획이 다르다** → 「PK 접두사」라는 **이름은 비용을 예측하지 못한다**(§M-2-4 ③ 이
  *"면제는 이름이 주지 않는다 — 주는 것은 실행값이다"* 라고 적은 것과 같은 말이고, 그 문장을 이
  근거 자신에 걸지 않았다). **②는 A3 에 한정해서만 근거로 쓸 수 있다.**
  ~~③ 그것은 **무정렬 결과와 정렬 결과가 더 자주 달라지도록** 키를 고르는 것이고, 그 divergence
  야말로 이 ADR 이 줄이려는 위험이다.~~
  **[정정 — 리뷰 라운드 2] ③은 순환이므로 근거로 쓰지 않는다.** `ORDER BY` 가 붙은 뒤 그 divergence 는
  **위험이 아니라 정렬이 실제로 하는 일의 크기**다 — 무정렬 답과 정렬 답이 갈리는 만큼이 곧 그 정렬이
  고치는 양이다. 그런 키를 피해서 줄어드는 것은 위험이 아니라 **관측 가능성**이고, 그것을 위험이라
  부르면 *"덜 관측되는 쪽이 더 안전하다"* 가 된다. **기각의 결론은 유지된다 — ①만으로 충분하다**
  (키의 근거가 *"소비자가 무엇을 묻는가"* 에서 *"변이가 죽게 하려고"* 로 옮겨 가는 것). 원문은 지우지
  않고 취소선으로 남긴다.
  *(넷째 대안 — 행을 늘려 플래너를 바꾼다 — 도 기각했다: 회귀가 플래너의 계획에 고정되면
  ADR 0015 결정 1 이 금지한 「저장 엔진의 배치를 전제로 쓰는 것」의 다른 얼굴이다.)*
- **ⓒ(둘 다 두고 §후속) 기각.** 이 자리는 *"다음에 고친다"* 가 아니라 **이 사이클이 만든 문장의
  정정**이고, CLAUDE.md §6-4 1 이 *"사실과 다른 문구는 그것을 만든 사이클이 고친다"* 를 요구한다.
  그리고 그 문장은 **다음 사이클이 곧 읽는다** — §후속 40(ⓒ 여섯)이 같은 완료 조건을 물려받는다.

### M-2-4. 그래서 바뀐 것 — 그리고 **면제가 되지 않게 하는 자물쇠**

ADR 0016 §2-3 에 정정 상자를 넣고 §3 2 를 고쳤다. 새 요구는 셋이다.
① **역방향 변이가 안 죽으면 그 회귀는 장식이다**(품질 게이트).
② 삭제 변이는 **함께 태우되**, 안 죽는 칸은 ~~**`EXPLAIN` 으로 왜 안 죽는지 이름 붙여 적는다**~~ —
이름 붙이지 못하면 **재지 않은 것**이고 닫히지 않는다.
**[정정 — 리뷰 재심사 라운드 4]** 취소선 안이 초판 문안이다. 맞는 문안은 **그 칸이 관측된 통합
세션 안에서, 계획마다 하나씩** `EXPLAIN`(sqlite 는 `EXPLAIN QUERY PLAN`)으로 이름을 붙여 적는
것이고, **한 칸을 한 이름으로 부르는 것은 바로 아래 ③ 이 금지하는 「이름으로 면제」다**
(정본 ADR 0016 §3 2 — §M-8-1). *이 자리가 무거운 이유*: 이 절의 제목이 **「면제가 되지 않게 하는
자물쇠」** 이고 ②가 그 자물쇠의 한 짝인데, 라운드 3 이 ADR 만 고쳐 **자물쇠를 정의하는 자리에 옛
문안이 남았다** — 그 자리가 남아 있는 한 그 절 자신이 ③ 이 막으려는 면제를 ②로 되돌려 준다.
③ **면제는 「PK 접두사 키」라는 *이름*이 주지 않는다. 주는 것은 실행값이다.**

*역방향 확인 — 이 한정어가 여는 구멍.* *"안 죽는 이유를 `EXPLAIN` 으로 적으면 된다"* 는 **면죄부로
쓰일 수 있다**: 행을 **하나만** 넣은 픽스처도 무정렬과 정렬이 같은 답을 내고 `EXPLAIN` 은 그것을
설명한다. 그래서 **순서가 있다 — 역방향이 죽는 것이 먼저다**(그것이 ≥2행과 소비자 관측을 동시에
증명한다). 역방향이 죽지 않는 자리에서는 `EXPLAIN` 이 **아무것도 면제하지 않는다.**

*역방향 확인 — ③ 을 왜 이름이 아니라 값으로 적는가.* "PK 접두사면 면제"라고 이름으로 적으면
**픽스처가 망가진 자리까지 같은 이름으로 빠져나간다**(PK 접두사이면서 행이 하나뿐인 픽스처).
CLAUDE.md §6-3 이 열한 번 이름 붙인 모양이 그것이다.

### M-2-5. 이 실패의 모양 — **반박이 그 결정 자신의 역방향 확인에 있었다**

ADR 0016 §2-3 의 *역방향 확인 — 왜 「지움」과 「역방향」 둘 다인가* 는
***"삭제 변이가 우연히 옳은 답을 낼 수 있다"*** 를 이미 적고 있었다. 그런데 **같은 ADR 의 §3 2** 와
**계획의 작업 7 완료 조건 2** 는 *"지우거나 뒤집으면 빨개져야 한다"* 를 **한정어 없이** 요구했다.
CLAUDE.md §6-3 이 이름 붙인 *"근거는 문서 안에 다 있었고 결론이 근거를 따라가지 못했다"* 가
**한 결정과 그 결정의 역방향 확인 사이에서** 난 것이다.

**그리고 이 사이클이 §6-3 에 더한 11회차 규칙이 정확히 이것을 잡는 규칙이다** —
*"그 사이클이 두 번 이상 적은 값을 표로 모으고 갈리는 칸을 실행으로 가른다"*. 이 요구는
**계획(완료 조건 2) · ADR(§3 2) · ADR(§2-3 역방향 확인)** 세 자리에 적혔고 셋째가 앞의 둘과 달랐다.
**내가 만든 규칙을 내 사이클의 이 값에 걸지 않았다.** 잡은 것은 `qa` 다 —
CLAUDE.md §6-5 의 *"잡은 것은 언제나 바깥에서 읽은 리뷰어였다"* 에 **세 번째 반례**이고
**§후속 25 의 표본이 2 → 3 이 된다.**

*그 처방의 방향도 반쪽이었다.* §2-3 은 *"그래서 삭제 변이는 postgres 축에서도 태운다"* 로 처방했는데,
그것은 **postgres 가 엄격한 쪽이라는 전제**였다. A3 이 그 전제를 반증한다 — **A3 은 sqlite 에서
결정적으로 죽고 postgres 에서 세션마다 갈린다.** 관대한 엔진은 자리마다 다르다.

## M-3. 계획·ADR 이 틀린 자리 (M-2 밖)

### M-3-1. (M-2 가 다룬다) ADR 0016 결정 3

### M-3-2. **§0 의 포트 실측이 「도구의 부재」를 「관측」으로 읽었다**

본문 §0 은 *"착수 시 실측: `ss -ltn | grep 5543` → **히트 0**"* 이라 적었다. **그 「히트 0」은 관측이
아니다.** 이 컨테이너에 **`ss` 가 없고**(`which ss` → exit 1), 내가 친 명령은 `2>/dev/null` 로
**stderr 를 버려서** *"도구가 없다"* 와 *"열린 포트가 없다"* 가 **구별되지 않았다.**

**결론은 살아남고 근거가 바뀐다**: 55438 이 비어 있었다는 것은 그 다음에 한
`pg_ctl … -p 55438 start` 가 **성공했다**는 사실이 뒷받침한다(물려 있었으면 bind 가 실패한다).
**그러나 「착수 시점에 아무도 안 띄워져 있었다」는 더 넓은 단정은 근거가 없다** — ~~그 문장은 지운다.~~
**[정정 — 리뷰 라운드 2] 그 조치는 일어나지 않았다.**
`git diff 330ee81..f5044b5 -- buildtwin/docs/plans/0012-*.md` 의 §0 헝크(`@@ -28,7 +28,12 @@`)는
**삽입만 있고 삭제가 없다** — 제거된 한 줄은 리플로우된 같은 문장이고 `:36` 에 그대로 살아 있다
(파일 전체 `--numstat` 도 **342 insertions · 3 deletions** 이고 그 셋은 전부 같은 헝크에서 다시
출력된 줄이다: §0 리플로우 · §1-d A5 행 · 작업 7 완료 조건 2). **실제로 한 것은 그 단정을 §0 에
정정 상자로 한정한 것이다** — 그리고 바로 다음 문장(*"원문은 지우지 않았다"*)이 이미 그렇게
적고 있었으므로, **같은 단락 안에서 두 문장이 어긋난 채 커밋됐다.** 문구 정확도를 다루는 절
자신의 문구다(CLAUDE.md §6-4).
본문 §0 에 그 자리에서 정정을 적었다(원문은 지우지 않았다).

**이 결함의 모양은 이 저장소의 지배적 실패 모드 그 자체다**(§6 머리말: *"조용히 죽는 것 — 예외 없음,
테스트 전부 통과, 이력만 사라짐"*). 다만 자리가 새롭다: 지금까지 §6-1 이 이름 붙인 것은
**「기준이 무엇을 놓치는가」** 였는데, 이번 것은 **「기구가 아예 없는데 그 부재가 음성 판독과 같은
모양으로 나온다」** 이다. **`grep` 을 파이프 뒤에 두는 모든 환경 탐침이 같은 모양이다.**
→ **§후속 46.**

*한정 — 두 사이클 연속이지만 그 사실을 확인할 수는 없다.* **계획 0011 §0 도 같은 명령을 적었다**
(`docs/plans/0011-*.md:31`, *"`ss -ltn | grep 5543` → 히트 0(아무도 안 띄워져 있었다)"*).
그 트리에서 `ss` 가 있었는지는 **재지 못한다**(과거를 관측할 수 없다). 그러므로 *"두 사이클 연속으로
틀렸다"* 가 아니라 ***"같은 명령이 두 사이클에 적혔고, 오늘 그 명령은 도구 부재로 침묵한다"*** 로
적는다. **그 문서는 `711e12f` 에 못박힌 기록물이라 고치지 않는다**(§3-13 첫째 갈래).

### M-3-3. **§1-d A5 칸의 소비자 목록이 셋 중 둘을 놓쳤다**

`sync-2d3d` 가 찾아 보고했다: `apps/web/src/sync/broker.ts:66` `panTo(handles[0])` ·
`:76` `flyTo(globalIds[0])` · `apps/web/src/pages/ViewerPage.tsx:133`. 계획은 `ViewerPage.tsx:275`
하나만 적었다. **계획이 지정한 키가 셋에도 맞아 고칠 것이 없었고**, 그래서 소유자가 고치지 않고
보고했다(옳은 처분이다).

**[정정 — 리뷰 라운드 2] 그 넷 중 하나(`broker.ts:76`)는 오판이다 — 소비자는 셋이다.**
리뷰어가 그 자리를 ⓑ 로 돌렸고 architect 가 `apps/web/src/sync/broker.ts` 를 직접 읽어 확인했다
(가드 논증은 §1-d A5 칸의 정정에 값으로 적었다). **그러면 이 절의 제목(「셋 중 둘」)이 옳고 초판
본문이 틀렸던 것이다** — 본문은 계획이 적은 하나 + 소유자가 찾은 셋 = **넷**을 말하면서 제목은
셋이라 적었다. **같은 절의 제목과 본문이 갈렸는데 아무도 태우지 않았다** — CLAUDE.md §6-3 11회차가
「같은 사이클의 여러 문서」에 이름 붙인 모양이 **한 절 안에서** 난 것이다.
**그리고 이 오판의 기전은 ADR 0016 §2-1 의 「다중행」 한정어가 서버 자리에만 걸린 것이다** —
`verification.py:92` 를 ⓑ 로 보낸 바로 그 근거(*인자가 한 개 키여서 구조적으로 최대 1행*)를
클라이언트 자리에는 아무도 걸지 않았고, 그래서 구조적으로 1행인 `flyTo` 자리가 ⓐ 로 들어왔다.
→ **§후속 49** (그리고 이 라운드가 ADR 0016 §2-1 역방향 확인과 §5 2행에 클라이언트 실례를 적었다).

**목록의 한계를 소유자가 이름 붙였다**: *"파이썬 함수명 grep 이 **HTTP 경계에서 끊긴다**"*.
계획 §6-3 역방향 확인 표 6행은 *"35 자리 전부에 소비자가 있다 — `grep -rn "\b<함수명>\b"` 로
확인했고 히트 0 인 함수는 없었다"* 라고 적었는데, **그 기준은 「소비자가 있는가」에는 답하지만
「소비자가 몇인가」에는 답하지 못한다.** 이름이 `load_mappings` → `GET /drawings/{id}/mappings` →
`useDrawingMappings` → `mappings.data` 로 **세 번 바뀌고**, grep 은 첫 경계에서 멈춘다.
→ §6-1 ①②③ 을 이 목록에 걸었을 때 **②에 적지 않은 칸**이고, `sync-2d3d` 가 ③(태우기)으로 찾았다.
**§1-d A5 칸에 보강을 적었다**(원문은 지우지 않았다). → **§후속 44** 가 그 축의 화면 회귀를 연다.

### M-3-4. **`qa` 의 20칸 중 한 칸이 N=1 이라 내 재현과 갈렸다**

`qa` 는 **부정 단정 두 칸에만 N=10** 을 붙이고 나머지 열여덟 칸은 **N=1** 로 적었다.
**그중 A5 삭제·postgres 가 세션 의존이다** — qa 는 `1 failed`(N=1), 내 재현은 **2/5**.
즉 그 칸은 *"죽는다"* 가 아니라 *"세션마다 갈린다"* 이고, **A3·A5 의 삭제·postgres 두 칸이 모두
같은 성질**이라는 것이 이 마감의 값이다(qa 는 A3 만 그렇게 봤다).

**[정정 — 리뷰 라운드 3] 그 뒤 `qa` 가 열여덟 칸을 다시 쟀고, N=1 이었던 칸은 이 하나가
아니었다.** A5 삭제·pg 는 **2/20**(세션 의존 — 내 재현 2/5 와 같은 성질), **A3 삭제·sqlite 는
10/10 결정적 사망**이다. 그러므로 이 절의 제목(*"한 칸이 N=1 이라"*)이 셈하는 칸은 **하나가
아니라 둘**이고, 둘의 성질이 서로 반대다(하나는 세션 의존, 하나는 결정적). **그리고 그 재측정이
요약의 모양 자체를 바꿨다**: 「죽는다 / 안 죽는다」 이분법으로는 열 칸이 채워지지 않는다
(일곱 + 둘 + 하나). 원문은 지우지 않는다.

**이것은 qa 의 결론을 뒤집지 않고 강화한다** — 판정은 *"삭제 변이는 엔진을 잰다"* 이고,
세션 의존은 그 주장의 직접 증거다. **그러나 규약이 하나 부족했다: 「죽었다」는 긍정 단정에도 N 이
필요하다.** 부정 단정에만 N 을 요구하면 *"한 번 죽는 것을 봤다"* 가 *"언제나 죽는다"* 로 읽힌다.
→ **§후속 34 에 일곱 번째 실례로 더한다**(자리는 §6-5, 대기열의 둘째라 이 사이클은 편집하지 않는다).

*역방향 확인 — 내 재현도 N 이 작다.* A5·postgres 는 **N=5**, A3·sqlite 는 **N=2** 다. 그러므로 내가
단정할 수 있는 것은 *"그 칸이 언제나 죽지는 않는다"* (반례를 봤다)이지 *"사망률이 0.4 다"* 가 아니다.
**부정 단정(안 죽는다)은 반례 하나로 무너지고, 긍정 단정(죽는다)은 반례 하나로 무너진다** — 내가
A5·postgres 에서 본 것은 후자의 반례이고 그것으로 충분하다. **비율 자체는 검정하지 않았다**
(§M-6 34). 세 값의 나란함은 참고로만 적는다: A3·postgres **qa 5/10 ↔ 나 4/10**.

## M-4. 하류가 **보고만 한 것**(소유 밖) — 이 마감이 번호를 준다

- **`ViewerPage.test.tsx` 가 저장소에 없다**(`ls apps/web/src/pages/*.test.tsx` = 여섯 파일).
  A1·A5 의 **화면 축**(계획 §검증 시나리오의 판정 경로 ②)이 그래서 비어 있다. A5 의 브로커 축만
  `apps/web/src/sync/broker.test.ts` 에 이미 있다. CLAUDE.md §2 는 그 자리를 소유 에이전트와 `qa` 의
  **공동 편집**으로 두므로 **배정만 있으면 열린다.** → **§후속 44.**
- **도면 목록의 이름과 순서가 다른 축이다**(api 보고). 화면이 보여 주는 것은 `FileRow.filename`
  인데 서버 순서는 `drawing_id` 다 — **목록이 이름순으로 보이지 않는다.** ADR 0016 §Deferred 2
  (표시 순서)가 이름 붙인 축의 첫 실례다. → **§후속 45.**
- **A3 삭제·postgres 10세션 중 1회 `test_20::test_cancel_names_the_decision_by_created_at_…` 이 함께
  빨개졌다**(qa 보고, 귀속을 태우지 않음). clean postgres 10/10 에서는 재발이 없다. → **§후속 47.**

## M-5. 후속 (본문 §후속 에 이어서 — **번호를 잇는다**)

**본문 §후속 1~43 을 번호로 옮긴다, 새로 쓰지 않는다.** 이 마감이 처분한 것만 여기 적는다.

### 닫는다 (다음 이월 목록이 취소선으로 옮긴다)

| # | 닫은 커밋 | 닫음의 **한정** |
|---|---|---|
| **17 의 일부** | `57fc8ff` + `7e4b160` + `2be9918` + `cac4559` | **닫히는 것은 「ⓐ 로 갈린 다섯 자리」이지 「정렬 미지정 자리」가 아니다.** 35 중 **5** 가 닫혔고 **30 이 열려 있다**(ⓑ 24 = 판정상 조치 없음 · ⓒ 6 = §후속 40). **17 자체는 열린 채 남는다** — 다음 이월 목록이 17 을 통째로 취소선으로 옮기면 §6-1 12회차의 재발이다 |

### 열린 채 이월한다

**2 · 3 · 4 · 6 · 11 · 16 · 17(위 한정) · 18 · 19 · 23 · 24 · 25 · 27 · 30 · 31 · 34 · 37 · 38 · 39 ·
40 · 41 · 42 · 43.** 신규는 **44번부터.**
**[보강 — 리뷰 라운드 2] 이 라운드가 44~47 에 더해 48 · 49 · 50 을 연다**(아래). 다음 이월 목록은
**44~50 을 함께** 옮긴다 — 그중 **닫힌 것은 없다.**

- **25** → **반례가 3건이 됐다.** 기존 둘(ADR 0014 §2-5 를 `qa` 가 잡은 것 · 계획 0010 §M-2-1)에
  **이 사이클의 M-2-5**(ADR 0016 결정 3 을 `qa` 가 잡았다)가 더해진다. **표본 2 → 3.**
- **34** → **일곱 번째 실례**: *"「죽었다」는 긍정 단정에도 N 이 필요하다"*(M-3-4). 문안에 한 줄을
  더한다 — *"부정 단정에만 N 을 요구하면 「한 번 죽는 것을 봤다」가 「언제나 죽는다」로 읽힌다."*
- **39** → **근거가 하나 더 났다**(M-3-3): 계획의 소비자 전수가 *"히트 0 인 함수는 없었다"* 로 **존재**만
  확인하고 **개수**를 확인하지 못했다 — 파이썬 함수명 grep 이 **HTTP 경계**에서 끊긴다.
- **43** → **여전히 열려 있다.** 정렬을 붙인 뒤 플래너가 무엇을 고르는지는 **부분적으로만** 재졌다
  (`qa` 가 **무정렬** 쪽 `EXPLAIN` 을 12세션 재고 **정렬 쪽은 재지 않았다**).

**신규(이 마감이 더한다):**

44. **`apps/web/src/pages/ViewerPage.test.tsx` 를 연다 — A1·A5 의 화면 축**(frontend + qa 공동 편집,
    CLAUDE.md §2). 계획 §검증 시나리오가 *"②의 음성 대조군이 이 계획에 없다"* 라고 적은 자리이고,
    `qa` 가 파일 부재를 실행값으로 확인했다. 붙일 계약 둘: **①** 도면 목록이 주어졌을 때
    `list[0]` 이 여는 도면(A1) **②** `mappings.data?.find(...)` 가 고르는 칩의 confidence(A5).
    **[정정 — 리뷰 라운드 2] A5 쪽 계약은 하나가 아니라 셋이다**(§1-d A5 칸의 정정): `ViewerPage.tsx:275`
    `find` · `ViewerPage.tsx:133` `selection.globalIds[0]` → `ObjectDetailPanel` · `broker.ts:66`
    `panTo(handles[0])`. 그러므로 44 가 붙일 계약은 **A1 하나 + A5 셋**이다. **셋째는 브로커 단위로는
    이미 있다** — `apps/web/src/sync/broker.test.ts:50` 이 `setMappings` 를 `H1, H1b` 순서로 준 뒤
    `panTo("H1")` 을 단언한다. **없는 것은 그 위의 배선**이다: `ViewerPage.tsx:82` 가 `mappings.data` 를
    그대로 `setMappings` 에 넣는가(= 화면이 서버 순서를 잃지 않는가). **`broker.ts:76` `flyTo` 는 계약을
    붙일 자리가 아니다**(ⓑ — 그 자리는 언제나 1행이다).
    **서버 축은 이미 `test_22` 가 붙들고 있으므로 이것은 「화면이 서버 순서를 잃지 않는가」의 축이다**
    (계획 §1-a ②ⓕ 가 이름 붙인 방향).
45. **도면 목록의 표시 이름(`FileRow.filename`)과 정렬 키(`drawing_id`)가 다른 축이다**(api + frontend).
    사용자에게는 **이름순이 아닌 목록**으로 보인다. ADR 0016 §Deferred 2 가 연 축의 첫 실례다.
    **결정 2 를 다시 읽어야 하는 자리**이기도 하다 — 여기서 소비자가 묻는 것이 *"매번 같은 것"* 에서
    *"이름순"* 으로 바뀌면 키가 틀린 것이 된다(그 위험은 ADR 0016 §2-2 역방향 확인이 이미 이름 붙였다).
46. **환경 탐침의 「도구 부재」를 「음성 관측」으로 읽지 않는다**(architect + qa). M-3-2 가 이름 붙인
    자리. **실례가 이 사이클에 둘이다** — ① `ss` 가 없는데 `2>/dev/null | grep` 이 「히트 0」으로
    보였다 ② **그것을 대체하려고 만든 기구도** `/proc/net/tcp6` 부재를 `except FileNotFoundError:
    pass` 로 삼켰다(§M-0 상자의 정정). **두 번째가 더 무겁다**: 규칙을 아는 사람이 대체 기구를
    만들면서 같은 결함을 넣었다 — §6-3 ②(*"규칙과 그 위반은 같은 커밋에서 함께 태어날 수 있다"*)의
    실례이고, 구해 준 것은 규칙이 아니라 **양성 검사 하나를 더 둔 것**(`bind`)이었다. `cmd 2>/dev/null | grep X` 형태는 **도구가 없을 때와 히트가 없을 때가 같은 출력**이다.
    처방 후보: ① 환경 탐침은 `command -v` 를 먼저 확인하고 ② `2>/dev/null` 을 쓰지 않으며
    ③ **부재를 단정할 때는 그 부재를 낼 수 있는 다른 경로**(여기서는 `bind` 성공)를 함께 적는다.
    **자리는 CLAUDE.md** 이고 §6-1(생성 기준의 한계)과 §6-5(적용 지점) 중 어디인지는 그 사이클이
    정한다. **이 사이클은 CLAUDE.md 를 §6-3 하나로 끝냈으므로 대기열에 붙인다** — 순서는
    §6-5(25 + 27·34·39 + 38) 와 **같은 커밋**이 자연스럽다(전부 §6-5 계열이다).
    **[보강 — 리뷰 라운드 2] 자리 후보에 §6-2 를 넣는다.** 「도구 부재가 음성 관측과 같은 출력을
    낸다」는 §6-1(*목록의 **생성 기준**이 곧 그 목록의 한계다*)의 모양이 아니라 **§6-2 1**
    (*"이 단언의 기대값을, 결함 있는 상태가 그대로 만족하는가"*)의 모양이다 — 환경 탐침도 검증
    시나리오이고, `ss` 가 없는 상태는 *"결함이 있는데 기대값을 그대로 만족하는"* 바로 그 상태다.
    **§6-5 표의 §6-2 행이 `qa` 에게만 걸려 있어서**(*"`qa` | 검증 시나리오를 붙일 때 | §6-2 네 항목"*)
    architect 가 자기 탐침을 그 절에 비춰 볼 축이 없었고, 그래서 이 후보가 처음 목록에서 빠졌다.
    **그러면 처방은 문안을 어디에 넣느냐가 아니라 그 행의 소유를 넓히는 것이다** — §6-2 는 `qa` 의
    절이 아니라 **관측을 세우는 모든 에이전트**의 절이다. 이것은 §6-1 이 이름 붙인 모양의 반복이다:
    적용 지점 표의 **행 축(누가)** 이 그 표가 놓치는 것을 정했다.
47. **A3 삭제 변이 postgres 10세션 중 1회 `test_20::test_cancel_names_the_decision_by_created_at_…`
    이 함께 빨개진 것의 귀속**(qa). clean 10/10 에서는 재발 없음. 후보: 수집 순서상 앞 파일이라
    같은 스키마를 공유하는 것 / `test_22` 픽스처가 `review_requests` 에 행을 만들지 않으므로 간접
    경로. **재지 않았다.**

**리뷰 라운드 2 가 더한다 (48~50). 잰 트리 `f4758f0`.**

리뷰어가 다섯을 제안했고 **셋만 번호를 받는다**. 받지 않은 둘의 처분을 먼저 적는다 —
번호와 제안이 어긋난 채로 남으면 다음 이월 목록이 그것을 옮기지 못한다(§6-1 12회차):

| 리뷰어 제안 | 처분 |
|---|---|
| 삭제 변이가 어느 축에서도 안 잡힌다 | **§후속 48** — 문구를 좁혀서 등록한다(A3·sqlite 가 반례다, 아래) |
| `EXPLAIN` 은 「그 칸이 관측된 세션 안에서」 재야 한다 | **번호를 주지 않는다** — 그것이 **반려 2** 이고 **architect 의 다음 라운드가 `qa` 의 측정을 받아 닫는다.** 닫지 못하면 그 라운드가 번호를 준다. 지금 열면 **닫히는 항목을 이월 목록에 넣는 것**이고, 그것이 §6-1 12회차가 세 사이클 연속 이름 붙인 바로 그 실패다 |
| 「다중행」 한정어를 클라이언트 소비자에도 | **§후속 49** |
| §6-1·§6-3 의 근거 표면을 잰 적이 없다 | **§후속 50** |
| §후속 46 의 자리 후보에 §6-2 | **새 번호 없음 — 46 의 [보강]으로 넣었다**(위). 두 번호가 같은 조치를 가리키면 하나가 닫혀도 다른 하나가 열린 채 남는다 |

48. **`ORDER BY` 「줄 삭제」를 붙드는 축이 A3·sqlite 하나뿐이다**(architect + qa). 회귀는 **순서**를
    붙들지만(역방향 열 칸 전부 죽는다) **그 줄의 존재**는 대부분의 칸에서 못 붙든다. 저장소에 기록된
    값(§M-2-2 표): A5 삭제·sqlite `qa` **0/10** + architect **0/5**(한 번도 안 죽는다) · A5 삭제·postgres
    `qa` `1 failed`(N=1) + architect **2/5** · A3 삭제·postgres `qa` **5/10** + architect **4/10**.
    **리뷰어의 제안 문구(*"어느 축에서도 결정적으로 잡히지 않는다"*)는 그대로 받지 않는다 — 반례가
    같은 표에 있다**: **A3 삭제·sqlite 는 관측된 세 세션 전부에서 죽었다**(`qa` `2 failed`(N=1) +
    architect **2/2**). `make test` 의 기본 축이 sqlite 이므로 **A3 의 줄 삭제는 오늘 기본 축이 잡는다.**
    남는 것은 **A5 두 축 + A3·postgres** 다. (N=3 이라 *"결정적"* 이라고 단정할 수도 없다 —
    §후속 34 가 요구하는 그 N 이다.) 닫는 후보는 ADR 0016 §6 대안 3 의 기계 감사(무정렬 조회 +
    `[0]` 소비자)이고 **§후속 42 에 들어 있다.** 이 항목이 더하는 것은 **ADR §4 「닫힘의 한정」이 그
    결과를 이름 붙이지 않았다**는 것이고, 이 라운드가 §4 에 한정 ④ 로 적었다.
    **[정정 — 리뷰 라운드 3] 위 값들은 전부 재측정으로 갈렸다**(`3a816c4`, 정본 `test_22`
    docstring): A5 삭제·sqlite **0/10**, A5 삭제·pg **2/20**(세션 의존 — `1 failed` 는 N=1 이었다),
    A3 삭제·pg **6/10**, **A3 삭제·sqlite 10/10**. **이 항목의 결론은 그대로다** — 정렬 줄의
    *존재* 를 결정적으로 붙드는 축은 **A3·sqlite 하나**이고, 이제 그 축의 N 은 3 이 아니라
    **재측정 10/10 + 리뷰어 4/4 + architect 2/2 + qa 초판 N=1** 이다. **남는 것도 그대로다**:
    A5 두 축 + A3·pg.
    *한정:* 리뷰어가 보고한 사망률(A3·pg **5/9** · A5·pg **2/9** · A5·sqlite **0/4**)은 위 값들과
    **분모가 다르고 재현하지 않았다** — **[재지 않았다]**. 같은 값이 한 사이클에 세 번 다르게 적힌
    것이므로 §6-3 11회차의 교차 확인 표가 받을 칸이다. **[라운드 3] 그 칸을 실제로 채웠다** —
    본문 §교차 확인 표에 세 행을 더했고, 네 관측자 대조는 `test_22` docstring 이 정본이다. **후보 설명이 하나 있고 그것도 재지 않았다**:
    변이 스크립트는 **공유 작업 트리**를 고치므로, 두 사람이 겹쳐서 재면 한쪽의 세션이 다른 쪽의
    변이가 적용된 트리를 본다(§M-6 39 의 관측).
49. **「다중행」 한정어를 클라이언트 소비자에도 건다**(architect + sync-2d3d + frontend). 서버 자리에는
    걸렸고(`verification.py:92` → ⓑ) `.tsx`/`.ts` 자리에는 안 걸려 `broker.ts:76` 이 ⓐ 로 들어왔다
    (§M-3-3 정정). **이 라운드가 한 것은 그 한 칸의 정정과 ADR 0016 §2-1·§5 2행에 클라이언트 실례를
    적은 것까지다.** 남는 것은 **나머지 34칸을 이 축에서 다시 보는 일**이고, 특히 **ⓑ 24 는 판정이
    「정렬 없음」이라 놓친 소비자가 곧 오판**이 된다. §M-6 11 과 방향이 반대다 — 11 은 *"소비자를 못
    찾는다"*(HTTP 경계에서 grep 이 끊긴다)이고 이것은 *"찾은 소비자가 소비자가 아니다"*(가드 때문에
    구조적으로 1행이다)이다. **§후속 44 의 회귀 계약을 쓰기 전에 필요하다.**
50. **§6-1·§6-3 의 근거 표면을 잰 적이 없다**(architect). 압축 바닥값이 잰 것은 §6-2 333 + §6-4 345 =
    678 뿐인데, **그 두 절은 `bfffcd5` 이후 한 글자도 변하지 않았다.** architect 재계수(`python3 len()`,
    절 = `### 6-N.` 줄부터 다음 `### 6-` 직전까지; §6 = `## 6.` 줄부터 EOF):

    | 절 | `bfffcd5` | `f4758f0` | 차 |
    |---|---|---|---|
    | §6-1 | 5,321 | 7,041 | **+1,720** |
    | §6-2 | 870 | 870 | **0** |
    | §6-3 | 4,789 | 6,112 | **+1,323** |
    | §6-4 | 957 | 957 | **0** |
    | §6-5 | 2,538 | 3,417 | **+879** |
    | §6 전체 | 15,148 | 19,070 | +3,922 |

    **자란 것은 §6-1·§6-3·§6-5 이고, 압축이 남은 이득을 낼 자리도 거기다.** 그 셋의 **근거 표면**
    (= 절 크기가 아니라 **규칙을 뺀 자수** — §6-5 바닥값 ③)은 **[재지 않았다].**
    **§후속 38(흡수 한도)과 같은 커밋에서 잰다.**

    **[보강 — 리뷰 재심사 라운드 4] 절 크기를 트리 `e3037df` 에서 다시 쟀다. 근거 표면은
    여전히 재지 않았다.** 같은 정의·같은 명령:

    | 절 | `bfffcd5`(못박은 분모) | `ceb18e9` | **`e3037df`** | 표 / 밖(`e3037df`) |
    |---|---|---|---|---|
    | §6-1 | 5,321 | 7,041 | **7,773** | 4,226 / 3,547 |
    | §6-2 | 870 | 870 | **870** | 0 / 870 |
    | §6-3 | 4,789 | 6,112 | **6,261** | 3,018 / 3,243 |
    | §6-4 | 957 | 957 | **957** | 0 / 957 |
    | §6-5 | 2,538 | 3,417 | **3,417** | 561 / 2,856 |
    | §6 전체 | 15,148 | 19,070 | **19,951**(264줄) | — |
    | 파일 전체 | 26,242 | 30,164 | **31,045**(478줄) | §6 비중 **64.26%** |

    **압축 착수는 여전히 아니다**(그러나 결론이 뒤집히지 않는 이유를 값으로 적는다): 못박은 표면
    678 은 **분모 15,148 에 대해 4.48%**, **지금 §6 19,951 에 대해 3.40%** — 어느 분모로도 §6-5
    바닥값의 **5% 문턱 아래**라 결론이 뒤집힐 여지가 없다. 그리고 **못박은 분모가 §6 보다
    +4,803 낡았다** — §6-5 바닥값 ④ 가 *"위로 올라가면 표면 비율을 과대평가해 과소 차단한다
    (불안전한 방향)"* 라 적고 그 예로 든 `382c746` 의 **+1,237** 이 **네 배**가 됐다.
    **분모 갱신은 이 항목과 같은 커밋에서 「값과 커밋을 함께」 한다**(§6-5 바닥값 ④ 의 요구) —
    이 라운드는 갱신하지 않는다(CLAUDE.md §6-5 사이클이 그 자리다: §M-5 *다음 사이클 순서* 의
    CLAUDE.md 대기열).
    *여전히 재지 않은 것*: 위 표가 낸 것은 **절 크기와 표/밖 분해**이고, 이 항목이 묻는
    **근거 표면(= 규칙을 뺀 자수)** 은 아니다. **표 = 근거, 밖 = 규칙이 아니다** — §6-1 의 밖
    3,547 에는 *"규칙."* 문단과 역방향 확인이 함께 있고 §6-5 의 밖 2,856 은 대부분 규칙이다.
    **[재지 않았다]** 는 그대로다.

**리뷰 라운드 3 이 더한다 (51~52). 잰 트리 `3a816c4`.**

51. **세션 안 `EXPLAIN` 계측을 저장소에 둔다**(qa 소유 · architect 가 ADR 문안을 진다).
    **판정은 「둔다」이고 근거는 두 사이클의 실측이다** — 이 게이트를 만족시키려고 **저장소 밖에서
    두 번 계측을 새로 만들었고 두 번 다 계측 자체가 틀렸다**: ① 계획 0011 사이클은 **문장을 고르는
    축**을 틀려 술어가 넷인 문장과 정렬을 얹은 문장을 같은 칸에 넣었다 — 그 자리가 스스로
    *"문장을 고르는 축이 이 측정의 전부다"* 라고 적는다(찾는 명령:
    `grep -rn "문장을 고르는 축이" tests/ --include='*.py'` — **소스 히트 하나**, `test_20`
    docstring. 줄 번호를 적지 않는 이유는 §3-13 둘째 갈래다. **문장 전체로 grep 하면 히트 0 이다**
    — 그 docstring 이 *"…축이 이 / 측정의 전부다"* 로 줄을 바꾼다: §6-1 ②가 이름 붙인 표기 변종의
    네 번째 부류 **줄바꿈**이고, 이 라운드가 그 자리에서 실제로 걸렸다). ② 이 사이클의
    2~3행 탐침은 **행 수·투영**을 틀려 두 칸 다 통합 세션을 **반대로** 예측했다(§M-7-1).
    **틀린 자리는 「돌리는 것」이 아니라 「매번 새로 만드는 것」이고, 저장소는 그것을 한 번만
    만들 수 있다.** ADR 0016 §3 2 가 이제 **세션 안·계획마다**를 요구하므로, 계측이 저장소 밖이면
    그 게이트는 **다음 사이클에서 재현 불가**다.
    *완료 조건 셋(그 사이클이 지운다):* ⓐ **옵트인**이어야 한다(환경 변수 없이는 아무것도 하지
    않는다 — 통합 스위트의 기준선·시간을 바꾸지 않는다). ⓑ **양성 검사를 함께 둔다** — 켰는데
    계획을 하나도 못 잡으면 **「계획이 없다」와 「계측이 안 붙었다」가 같은 출력**이 된다. 그것이
    §후속 46 이 이름 붙인 바로 그 모양(`ss` 부재 ↔ 히트 0)이고, 이 저장소에서 **두 번** 났다.
    ⓒ **계약이 아니라 계측이라는 것을 그 자리에 적는다** — 계획 이름을 단언으로 굳히면 ADR 0015
    결정 1 이 금지한 *"저장 엔진의 선택을 테스트의 전제로 쓰는 것"* 이 된다.
    *역방향 확인 — 두는 것이 미는 것.* 저장소에 놓인 계측은 **아무 테스트도 실패시키지 않으므로
    조용히 낡는다**(CLAUDE.md §2 가 커밋 트레일러를 기각한 근거 — *"아무도 검증하지 않는 기계를
    하나 더 만드는 일"*). ⓑ 가 그 반례로 두는 최소 장치이고, **그것 없이는 두지 않는다.**
52. **무엇이 세션마다 무정렬 계획을 뒤집는가**(qa · §후속 16 을 열 때). 행 수는 세션마다 같은데
    A3·pg 는 6/10, A5·pg 는 2/20 에서 다른 계획이 뽑힌다. **통계 수집 타이밍·autovacuum 을 의심할
    뿐 태우지 않았다.** 관측 하나만 있다: 두 병렬 스트림에서 **같은 회차 번호**의 세션이 함께
    죽었다(A3 은 2·3·4회차, A5 는 5회차) — 시간에 걸린 클러스터 단위 요인을 시사한다.
    **[보강 — 리뷰 재심사 라운드 4] 그 관측이 다른 클러스터에서 재현됐다** — 리뷰어가 자기 클러스터
    (55447)에서 24 세션을 돌려 **A3 은 2·3회차, A5 는 2회차**가 죽었다고 보고한다. **두 관측자·두
    클러스터에서 「같은 회차 번호가 함께 죽는다」가 났다.** *한정 둘*: ① 이것은 **리뷰어의 보고값**
    이고 architect 는 재현하지 않았다(이 라운드는 어떤 클러스터도 띄우지 않았다 — §M-8-0).
    ② **회차 번호는 시간의 대리 변수일 뿐** 원인이 아니다 — 세션 시작 시각·autovacuum 주기·통계
    갱신 중 무엇인지는 **여전히 태우지 않았다.** 이 항목은 열린 채 남는다.
    ~~**ADR 0016 §Deferred 8 과 같은 자리가 아니다**~~ — 8 은 *"행 수를 키우면 언제 죽기
    시작하는가"* 이고 이것은 *"행 수가 고정인데 왜 갈리는가"* 다. 두 번호가 같은 조치를 가리키지
    않도록 여기 적어 둔다(§후속 46 이 겪은 것).
    **[정정 — 리뷰 재심사 라운드 4] 이 문장과 ADR §Deferred 8 의 라운드 3 정정이 포함관계를
    서로 반대로 말했다.** 여기는 *"같은 자리가 아니다"*(= 분리), ADR 은 *"8 의 남은 축에
    더해진다"*(= 52 가 8 의 부분) — **둘 다 정확하지 않고, 맞춘 문안은 하나다:
    물음은 다르고 축은 겹친다.** ① **물음이 다르다** — 8 은 **임계**(행 수를 키우면 언제부터
    죽는가), 52 는 **원인**(행 수가 고정된 채로도 왜 세션마다 갈리는가). 산출물이 다르므로
    **번호를 합치지 않는다.** ② **축이 겹친다** — ADR §Deferred 8 이 적은 남는 축 셋
    (**행 수 · 통계 · `ANALYZE`**) 중 **「통계」와 그것을 움직이는 `ANALYZE`·autovacuum 은 이
    항목이 의심한다고 적은 바로 그 축이다**(위 두 줄). ③ 그러므로 **그 축을 태우는 커밋은 두
    번호를 함께 적는다** — 한 번 태우면 두 항목에 함께 값이 온다. ADR 쪽도 같은 문안으로 맞췄다.

**리뷰 재심사 라운드 4 가 더한다 (53~54). 잰 트리 `e3037df`.** 리뷰어가 둘을 제안했고 **둘 다
등록한다** — 기각한 것은 없다. 각 항목 머리에 **내가 스스로 판정한 근거를 값으로** 적는다.

53. **전수 목록의 「자리」 단위와 「자기 커밋을 세는가」를 규약으로 못박는다**(architect).
    **판정: 등록한다 — 반증이 값으로 있다.** 라운드 3 은 `qa` 의 목록에
    *"자기 커밋(`3a816c4`)이 목록에 없다"* 를 걸었는데(§M-7-5 2), **같은 기준을 자기 목록에는
    걸지 않았다.**
    *architect 재계수*(리뷰어의 값을 옮기지 않고 루트에서 직접 — §6-1). 표기 집합은 §M-7-4 의
    것에 `사망률`·`스무 칸`·`20 칸`·`6/10`·`2/20`·`10/10` 등을 더해 넓히고, 명령은
    `git log --all --format='%H %h %s'` 로 전 커밋을 돌며 각 커밋의 **제목+본문**에
    `grep -qE "<집합>"` 를 건 뒤 **각 히트를 읽어** 남의 값(`doc_id` 폭발 반경 · 인덱스 선택
    5/10·6/10 · 계획 0009 의 40/40 등)을 걸렀다. **결과: 20칸 사망률을 싣는 커밋은 넷이 아니라
    여섯이다** — `cac4559`(**제목에까지**) · `94751c5` · `f5044b5` · `3a816c4` 에
    **`3c6ac58`**(*"A3·pg 6/10 · A5·pg 2/20"* · *"A3·sqlite 10/10 · A5·pg 2/20"* 를 **자기
    보고값으로** 싣는다)과 **`e3037df`**(*"18칸이 죽고 두 칸이 안 죽는다 — 열여덟 칸이 N=1"* 을
    **인용으로** 싣는다)가 더해진다. **그 둘이 바로 그 목록을 만든 커밋 자신이다.**
    *가르는 칸도 값으로 적는다*: `3c6ac58` 은 **자기 측정값**을, `e3037df` 는 **인용**만 싣는다 —
    「거짓이라 표시하며 인용하는 자리도 세는가」에 답이 없어서 **세지 않으면 다섯, 세면 여섯**이다.
    §M-7-4 표가 `cac4559` 의 **제목**(= 초판 요약 그 자체)을 센 것과 같은 기준이면 **여섯**이다.
    **그리고 「자리」의 단위가 섞였다 — 산술로 닫힌다.** §M-7-4 표의 총계 **열둘**은 **절 단위**다
    (`test_22` **1** + ADR §2-3·§4·§5 **셋** + 계획 **여덟** = 12). 그런데 **같은 표의 칸**은
    `test_22` 를 **세 자리**(20칸 표 · 네 관측자 대조 · 세션 안 계획 표), ADR §2-3 을 **두 자리**
    (정정 상자의 표 · 그 아래 재현 문단), ADR §4 를 **두 자리**(한정 ①·④)로 열거한다 — 그 단위로
    세면 **열여섯**이다. **한 표가 총계는 절로, 칸은 문단으로 셌다.**
    *조치*: 전수 목록을 쓰는 자리마다 목록 **옆에** 셋을 적는다 — **① 「자리」가 절인가 문단인가
    문장인가 ② 이 목록을 싣는 커밋을 세는가 ③ 인용만 하는 자리를 세는가.** §6-1 ①(*"어떤 기준으로
    만들었는지를 목록 옆에 적는다"*)을 이 세 물음으로 구체화하는 것이고, **범위(무엇을 grep 했나)만
    적고 단위를 적지 않으면 총계가 칸과 갈린다**는 것이 이번 관측이다.
    **CLAUDE.md `:245` 13회차 관측값 칸이 그 「넷」과 「열두 자리」를 그대로 싣고 있어 이 라운드가
    별도 커밋으로 고쳤다**(§M-8-2).
    *역방향 확인 — 이 규약이 닫지 못하는 것.* 세 물음은 전부 **목록을 쓰는 시점**의 것이고,
    §6-1 **12회차**가 이름 붙인 **그 뒤에 생기는 자리**는 그대로 남는다 — `e3037df` 는 `3c6ac58` 이
    목록을 쓸 때 **존재하지도 않았다.** **규약은 단위를 고정할 뿐 시점을 고정하지 않는다.**
    그리고 이 항목 자신이 그 한계 안에 있다: 이 문단을 싣는 커밋도 그 값을 싣는 자리가 된다.

54. **바닥값이 산문으로 복창되는 자리를 기계가 잡는가**(qa). **판정: 등록한다 — 이 라운드가
    실례를 값으로 확인했다.** `tests/postgres.floor.json` 의 `min_tests_on_postgres` 는 **187** 인데,
    루트 `grep -rnE "\b(181|187)\b" .github/workflows/buildtwin-ci.yml
    buildtwin/tests/helpers/postgres_axis.py`(HEAD `e3037df`)는 **세 자리에서 181** 을 낸다:
    `.github/workflows/buildtwin-ci.yml:169`(*"이 스텝은 전량이라 그 조건을 만족한다(181 >= 181)"*) ·
    `tests/helpers/postgres_axis.py:28`(*"(`181 >= 181`) 한 글자도 달라지지 않는다"*) ·
    `:34`(*"값이 오르는 쪽(`200 >= 181`)"*). **어느 테스트도 그 일치를 보지 않는다** — 세 자리 모두
    **산문**이고 `>=` 게이트는 JSON 값만 읽으므로, 바닥값이 181 → 187 로 오를 때 셋은 조용히 낡았다.
    `docs/plans/0004-*.md` §후속 1 의 `make lint` 계열과 같은 자리이고, CLAUDE.md §6-1 **7회차**
    (*"값·개수가 낡은 주장 — 현재형으로 적힌 거짓"*)의 모양 그대로다.
    **소유는 `qa`** — 세 자리 전부 `tests/`·`.github/workflows/` 다.
    *전수의 한정 — 내 목록이 놓친 것*: 위 셋은 **두 파일**의 것이다. 같은 grep 을
    `tests/integration/test_99_db_axis_contract.py` 로 넓히면 히트가 더 있고, 그중
    `:202`(*"`(200, 181) → True` 칸이 …"*)·`:463`(*"수가 바닥값 아래(3 < 181)"*)이 **산문 복창**,
    나머지는 **픽스처 인자**(`floor=181` 을 명시로 넘기는 자리)라 정본과 갈릴 수 없다 —
    **히트 수가 아니라 각 히트를 읽어야 갈린다**(§6-1). **내가 처음 친 grep 은 파일을 둘로 먼저
    좁혔고, 그것이 곧 그 목록의 한계였다**(§6-1 의 *"경로를 먼저 좁히지 않는다"* — 이 항목을 쓰면서
    그 규칙을 어겼다).
    *상태 — 이 번호는 이 라운드에 **닫히는 중**이다*: `qa` 가 병렬로
    `tests/invariants/test_postgres_floor_recitation.py` 를 만들고 있고(착수 뒤 트리에 나타난
    **미추적 파일**), 그 docstring 이 *"계획 0012 §후속 54"* 를 자기 근거로 인용하며 **네 복창 ·
    세 파일**로 센다. **그 파일은 읽기만 했고 한 글자도 만지지 않았다**(소유 `qa`) — 여기 적는 것은
    **그 커밋이 아직 없다는 사실**과 **내 HEAD 측정값**뿐이고, 닫힘의 보고는 `qa` 의 커밋이 한다.
    **값이 고쳐져도 이 항목은 값으로 닫히지 않는다** — 묻는 것은 **기계의 부재**이고, 값만 고치면
    다음 인상에서 같은 자리가 다시 낡는다.
    *역방향 확인 — 이 항목이 밀어내는 것.* 같은 모양이 `docs/` 에도 있다: **ADR 0016 §3 2 의 조항
    문안과 계획 0012 작업 7 완료 조건 2** 가 같은 문장을 두 자리에 싣고(정본 판정은 §M-8-1) 어떤
    기계도 그 일치를 보지 않는다 — 이번 반려 A-1 이 그 실례다. **그런데 이 번호에 넣지 않는다**:
    소유가 `architect` 이고 대상이 산문이라, 넣으면 **`qa` 가 고칠 수 없는 것이 `qa` 의 항목에
    들어간다**(§6-3 9회차가 이름 붙인 무주공산의 반대 방향 실수다). **닫지 않고 한계로 적는다** —
    산문 정본의 일치를 보는 기계를 두는 것은 CLAUDE.md §2 가 커밋 트레일러를 기각한 저울
    (*"아무도 검증하지 않는 기계를 하나 더 만드는 일"*)에 걸리고, **이 사이클은 그 저울을 달지
    않았다.**

### 다음 사이클 순서 (리뷰어 확정 — 이 마감이 바꾸지 않는다)

- **0013 = §후속 16 + 30 + 31 + 37**(qa + architect). **이 사이클이 그 사이클에 주는 것**: ⓐ 다섯이
  닫혀 순서 의존 실패의 다섯 경로가 미리 사라졌고, **삭제 변이의 사망률이 새 관측량이 됐다**
  (행 수가 커지면 그 값이 올라가야 한다 — 안 올라가면 ADR 0016 §2-3 의 기전 설명이 틀린 것이다).
- **0014 = §후속 18**, 그 뒤 **2 · 3 · 6 · 11 · 23 · 24**.
- **CLAUDE.md 대기열**: ~~§6-3(32)~~ **닫혔다**(`ceb18e9`) → **§6-5(25 + 27·34·39 규칙 + §6-1 의
  27·34 근거 행 + 38 흡수 한도 + **46**)** → **§2(19).**
  §6-5 사이클은 압축 문턱의 분모를 갱신하면서 **값과 커밋을 함께** 적는다 — 이 사이클 뒤 §6 은
  **19,070자**(`ceb18e9`), 못박힌 분모 15,148 대비 **+3,922자**.

## M-6. 확인하지 않은 것 (본문 1~32 를 번호로 옮기고, 이 마감이 처분한 것만 적는다)

**커밋 직전 게이트(이 마감의 `docs/` 편집 둘을 담은 트리에서 다시 돌렸다 — 본문 20 이 배정한 칸).**

| 명령 | 실행값 |
|---|---|
| `make test` | **492 · 104 · 8 · 222** + vitest **283**(28 files). 통합 갈래의 축 줄: `[db-axis] dialect=sqlite tests_on_postgres=0 engines=0 (BUILDTWIN_CI_POSTGRES_URL 없음 — postgres.measured.json 을 건드리지 않았다)` |
| `make lint` | **exit 0** |
| 뒤의 `git status --porcelain` | 이 마감의 편집 둘만 — `M buildtwin/docs/adr/0016-…` · `M buildtwin/docs/plans/0012-…`(테스트가 트리를 더럽히지 않았다) |

*한정*: `make test` 의 통합 갈래는 축 이름이 없어 **sqlite** 로 돈다 — **postgres 축의 222·187 은
§M-1 표의 별도 실행이 잰 값**이다. **이 셋은 `docs/` 만 바꾼 트리의 값이라 코드 결과가 바뀔 수 없다**
(어떤 테스트도 이 문서를 import 하지 않는다) — 그래도 돌린 것은 CLAUDE.md §3-1 이 요구하는 것이
*"바뀔 수 있었나"* 가 아니라 *"돌렸나"* 이기 때문이다.

- **2**(정렬 축을 바꾸는 변이) → **이행됐다.** 세 소유가 붙이면서 재고 `qa` 가 20칸으로 재고
  이 마감이 그중 넷을 재현했다. **남는 칸**: 삭제 변이의 사망률이 행 수·통계에 따라 어떻게 변하는지
  (ADR 0016 §Deferred 8).
- **3**(679 ↔ 677 의 귀속) → **[재지 않았다].** 이 마감도 `[ORD]` 를 다시 세지 않았다.
  **통합이 216 → 222 가 됐으므로 그 값은 또 움직였을 것이다** — 재는 자리는 §후속 16 이다.
  **[보강 — 리뷰 라운드 2] 리뷰어도 세지 않았고 `qa` 가 이 라운드에서 센다.** 그 값이 오면 679 와
  나란히 적는다(679 자신이 677 과 갈린 값이다 — 한 값이 세 트리에서 세 번 적힌다).
  **[보강 — 리뷰 라운드 3] `qa` 가 셌고(542) architect 가 재현했다(N=2). 그리고 이 라운드가
  **옛 트리 `08238c9` 를 `git archive` 로 꺼내 같은 플러그인으로 다시 재** 679 를 자리별로
  재현했다** — 그래서 **679 → 542 의 귀속은 닫혔다**(§M-7-3: 서비스 열둘 530 불변 · ⓐ 넷 137 소멸 ·
  테스트 프레임 12 불변). **그러나 이 항목이 묻는 것은 677 ↔ 679 이고 그 트리(`743bcb9`)는 재지
  않았다 — 여전히 열려 있다.** 바뀐 것은 값이 아니라 **비용**이다: 옛 트리 재계수가 실제로
  재현된다는 것이 이제 실행값으로 있다.
- **5**(정렬을 붙인 다섯 자리의 `EXPLAIN`) → **절반만 이행됐다.** `qa` 가 **무정렬** 쪽 계획을
  12세션 쟀다(A3 `Index Scan … pkey` · A5 `Bitmap Heap Scan`/sqlite 인덱스). **정렬 쪽은 재지
  않았다** → §후속 43.
  **[보강 — 리뷰 재심사 라운드 4] 위 두 이름은 「세션 안 계획」이 아니다.** 그 12세션은 **저장소 밖
  2~3행 탐침**의 것이고, 라운드 3 이 그 탐침이 **두 칸 다 통합 세션을 반대로 예측한다**는 것을 값으로
  냈다(§M-7-1: A3·pg 탐침 `Index Scan … _pkey` 12/12 → *"안 죽는다"* ↔ 세션 안 6/10 죽음 /
  A5·pg 탐침 `Bitmap Heap Scan` 12/12 → *"언제나 죽는다"* ↔ 세션 안 2/20 죽음). 그러므로 이 항목의
  *"절반만 이행됐다"* 는 **무정렬 쪽조차 새 기준(ADR 0016 §3 2 = 세션 안에서, 계획마다)에서는
  미측정이었다**는 뜻이고, 그 절반을 채운 것은 `3a816c4` 의 **세션 안 계측**(38 세션 38/38)이다.
  **남는 것은 정렬 쪽 하나이고 §후속 43 이 그대로 진다.** *이 보강을 다는 이유*: 라운드 3 은 같은
  §M-6 의 **3**(`[ORD]`)과 **34**(관측자 넷)에는 보강을 달면서 이 항목은 지나쳤다 — 탐침 이름이
  반증된 라운드에 그 이름을 실은 항목이 손대지 않은 채 남으면, 다음 사이클이 그 이름을
  **세션 안 계획으로** 읽는다.
- **16**(A4 의 동률을 픽스처로 만들 수 있는가) → **만들어졌다.** `qa` 가 bbox·ifc_type 이 완전히
  같은 후보 둘로 `conf=1.0`·`iou=1.0` 동률을 만들고, **동률의 존재 자체를 값으로 확인**했다
  (객체 목록만 뒤집으면 승자가 뒤집힌다). 계획 §열린 질문 1 과 작업 7 완료 조건 4 가 닫혔다.
- **20**(커밋 직전 게이트) → **위 표.**
- **23**(화면이 서버 순서를 잃는 방향) → **[재지 않았다]**. §후속 44 가 그 축을 연다.
- **11**(ⓑ 24 자리의 소비자를 끝까지 훑었는가) → **[재지 않았다]**, 그리고 **M-3-3 이 그 위험을
  키웠다** — A5 에서 파이썬 grep 이 HTTP 경계에서 끊겨 소비자 둘을 놓쳤으므로, **같은 누락이 ⓑ 24 에도
  있을 수 있다.** 그 24 는 판정이 "정렬 없음"이라 **놓친 소비자가 곧 오판이 된다.**
  **[재야 한다 → qa · §후속 16 이 빨개질 때]**
- **1 · 4 · 6 · 7 · 8 · 9 · 10 · 12 · 13 · 14 · 15 · 17 · 18 · 19 · 21 · 22 · 24 · 25 · 26 · 27 ·
  28 · 29 · 30 · 31 · 32** → 본문 그대로 이월한다(이 마감이 처분하지 않았다).

**신규(이 마감이 더한다):**

33. **[재지 않았다]** **`ss` 가 언제부터 없었는가.** M-3-2 는 *"오늘 없다"* 만 관측했다.
    계획 0011 이 그 명령을 적었을 때 있었는지는 **과거라서 잴 수 없다.**
34. **[재지 않았다]** **A5 삭제·postgres 의 사망률 2/5 와 qa 의 1/1 이 같은 분포에서 나온 것인지.**
    두 클러스터·두 포트라 조건이 완전히 같지 않고, **검정하지 않았다.** 이 마감의 결론은 비율에
    기대지 않는다(기대는 것은 *"0/5 ↔ 2/5"* 라는 **엔진 간 대비**다).
    **[보강 — 리뷰 라운드 3] 관측자가 넷이 됐고(qa 초판 · architect · reviewer · qa 재측정),
    네 값의 비율 차이도 **검정하지 않았다** — `test_22` docstring 이 *"이 표가 기대는 것은 비율이
    아니라 「그 칸이 한 값으로 고정되지 않는다」 하나"* 라고 같은 판단을 적는다. **[재지 않았다].**
35. **[재지 않았다]** **역방향 변이 열 칸을 architect 가 재현하지 않았다.** 재현한 것은 삭제 변이
    네 칸이고, 판정이 걸린 비교가 거기였기 때문이다. **역방향 열 칸은 `qa` 의 값을 그대로 싣는다.**
    **[보강 — 리뷰 라운드 2] 리뷰어가 열 칸을 재현했고 전부 죽었다고 보고했다**(A3 는 `2 failed`,
    나머지 `1 failed`; A3·pg 와 A5·pg 는 N=4). **architect 는 그 재현도 재현하지 않았다** — 여기
    적는 것은 리뷰어의 **보고값**이지 architect 의 관측이 아니다. 그리고 ~~**여섯 칸(A1·A2·A4 × 두
    축)은 여전히 N=1** 이다~~(§후속 34 가 요구하는 N 이 긍정 단정 쪽에 아직 없다).
    **[정정 — 리뷰 재심사 라운드 4] 취소선 문장은 거짓이다. 그 여섯 칸은 N=4 다.** 정본
    `tests/integration/test_22_row_order_contract.py` docstring 의 20칸 표에서 **역방향 두 열이 전부
    `4/4`**, 즉 **칸마다 N=4** 다(재측정 `3a816c4`). N=1 이었던 것은 **바로 위 라운드 2 보강이 싣는
    리뷰어 재현**이고, 그 뒤에 온 `qa` 재측정이 그 값을 갈아치웠다.
    *왜 이 자리가 무거운가*: **라운드 3 이 이 항목을 손에 들고 있었다** — §M-7-5 ⑤ 가 *"20칸은
    `test_22` docstring 에서 읽었다(**§M-6 35 와 같은 한정**)"* 라며 이 번호를 명시적으로 가리키면서,
    같은 항목 안의 이 절은 고치지 않았다. **그리고 이 자리는 §M-7-4 의 전수(자리 열둘)에도 본문
    교차 확인 표(여덟 자리)에도 없었다** — 20칸 사망률을 싣는 자리인데 두 목록 어디에도 없는 것이
    §6-1 12·13회차의 모양 그대로다. **이 라운드가 두 목록에 넣는다**(§M-8-2).
    *architect 가 재확인한 것*: 위 두 열을 `test_22` docstring 에서 **직접 읽었다**(리뷰어의 값을
    옮기지 않았다 — §6-1 의 *"가리킴으로 확인을 갈음하지 않는다"*). 그리고 루트
    `grep -rn "여전히 N=1" . --exclude-dir=.git --exclude-dir=__pycache__` 는 **이 줄 하나만** 냈다
    (정정 전) — 이 거짓은 저장소에 이 한 자리로만 있었다.
    *여전히 재지 않았다*: **역방향 열 칸도, A5·sqlite 0/10 도 이 라운드가 재현하지 않았다.**
    여기 적히는 값은 `qa` 의 관측이지 내 관측이 아니고, 그 한정은 이 항목의 제목 그대로 남는다.
36. **[재지 않았다]** **IPv6 로만 물린 리스너.** 이 컨테이너에 `/proc/net/tcp6` 가 없어 내 포트
    기구는 **IPv4 만** 본다(§M-0 상자의 정정). `bind("127.0.0.1", p)` 도 IPv4 다. 이 사이클의
    클러스터는 전부 `listen_addresses=127.0.0.1` 이라 실해가 없었지만, **기준의 한계는 결과가
    아니라 기준에서 판단한다**(CLAUDE.md §6-1 역방향 확인).
    **[보강 — 리뷰 라운드 2] 리뷰어의 포트 기구도 같은 한계를 갖는다**(`/proc/net/tcp6` 부재 확인 +
    `bind("127.0.0.1")`). **같은 한계가 두 사람에게 독립으로 났다** — 그러므로 이것은 한 사람의 부주의가
    아니라 **이 컨테이너에서 IPv6 리스너를 보는 방법이 아무에게도 없다**는 사실이다. §후속 46 의
    처방 ③(*"부재를 낼 수 있는 다른 경로를 함께 적는다"*)이 닿지 못하는 자리로 이름 붙인다.
    **[보강 — 리뷰 재심사 라운드 4] 같은 한계가 세 번째 관측자에게서 다시 났다** — 리뷰어 재심사가
    `/proc/net/tcp6` 부재를 **출력으로** 확인하고 자기 포트 기구의 같은 한계를 보고했다(보고값).
    이 라운드도 직접 확인했다: `os.path.exists('/proc/net/tcp')` → `True`,
    `os.path.exists('/proc/net/tcp6')` → **`False`**, `shutil.which('ss')` → **`None`**
    (§M-8-0). **관측자 셋이 독립으로 같은 한계에 닿았고 아무도 그것을 넘지 못했다** — 이 항목은
    *"아직 안 쟀다"* 가 아니라 **이 컨테이너에서 잴 방법이 없다**로 굳는다. 그 판정을 뒤집는
    유일한 경로는 **환경을 바꾸는 것**이고, 이 사이클은 그것을 하지 않는다.

37. **[재지 않았다]** **§1-b 35행 표의 ⓐ/ⓑ/ⓒ 판정을 자리마다 재검증한 사람이 아무도 없다.**
    리뷰어는 **수와 목록**만 독립 재계수했고(AST 로 35 → 30, 한 칸도 안 갈렸다) 소비자는 **표본
    둘**만 봤다. **그리고 미검증 칸에서 오판이 실제로 하나 났다** — A5 보강의 `broker.ts:76`(리뷰
    라운드 2 가 잡았다, §M-3-3 정정). 반증 장치는 **§후속 16** 이고, 그때까지 그 표는 **35칸 중
    대부분이 architect 한 사람의 판정**이다.
38. **[재지 않았다]** **어떤 변이 아래에서도 `make test` 를 돌리지 않았다** — 변이 측정은 architect·qa
    모두 `pytest` 직행이다. *판단(재지 않았다):* 변이는 전부 `services/` 의 파이썬이라 vitest 축이
    구조적으로 반응할 수 없고, `make test` 의 pytest 갈래는 같은 것을 돈다 — 그래서 실해는 낮다고
    **본다.** 그러나 **그 판단 자체가 실행이 아니다**, 그리고 §후속 44 가 화면 축을 열면 그때부터는
    **vitest 가 반응해야 하는 변이가 생긴다.**
39. **[관측했다 — 그리고 이 라운드의 게이트를 막았다]** **변이 측정은 공유 작업 트리를 고친다.**
    리뷰 라운드 2 의 `docs/` 편집을 끝내고 `git status --porcelain` 을 치니 빈 출력이 아니었다:
    `M buildtwin/services/progress/persistence.py`, `git diff` 는 **A3 의 `order_by` 한 줄이 제거된
    상태**(= `qa` 의 in-flight 삭제 변이). **몇 분 뒤 같은 확인은 그 파일이 깨끗해지고
    `M buildtwin/services/sync/persistence.py`(A5 의 같은 변이)를 냈다** — 변이가 자리를 옮겨 가는
    것을 트리에서 직접 봤다. **그래서 이 라운드는 커밋 직전 게이트(`make test`·`make lint`)를
    돌리지 않았다** — 그 트리에서 잰 값은 내 편집의 값이 아니고, 겹쳐 돌리면 `qa` 의 **세션 의존**
    측정을 오염시킨다. 내 커밋은 `docs/` 두 파일이고 경로를 명시해 스테이징했다.
    *이것이 §후속 48 의 사망률이 사람마다 갈리는 한 후보다*(재지 않았다). **처방 후보**: 변이
    스크립트를 공유 트리가 아니라 **분리된 체크아웃**에서 돌린다 — 그러나 그 비용(`.venv` 재구성)은
    재지 않았다. → 다음 사이클이 처분한다.
---

# 리뷰 라운드 3 (architect, 2026-09-07) — 반려 2 를 닫는다

## M-7-0. 이 라운드의 실측이 나온 자리 (재현 방법)

**작업 트리** `/home/user/Bim/buildtwin`, **저장소 루트 `/home/user/Bim`**, 브랜치
`claude/buildtwin-initial-setup-ubulzb`, **HEAD `3a816c4`**, 착수 시 루트 `git status --porcelain`
빈 출력. **이 절의 모든 값은 이 트리의 것이다.**

**DB**: 내가 띄운 임시 클러스터 — `initdb -A trust`, `PostgreSQL 16.13
(Ubuntu 16.13-0ubuntu0.24.04.1)`, **포트 55445**, `autovacuum=on`(`show autovacuum` → `on`),
측정이 끝나고 반납했다. 포트 판정은 **`/proc/net/tcp` 의 `st=0A` 열거 + `socket.bind` 양성 검사**
둘 다다(`ss` 부재 · `/proc/net/tcp6` 부재 — §M-3-2 와 §후속 46 이 이름 붙인 자리이고, 이 라운드는
**부재를 출력으로 확인하고**(`os.path.exists('/proc/net/tcp6')` → `False`) 적는다).
*그 기구가 여전히 못 보는 것*: IPv6 로만 물린 리스너(§M-6 36) — 이 라운드도 재지 않았다.

**계측은 저장소 밖이다.** `[ORD]` 탐침은 스크래치 디렉터리의 pytest 플러그인이고(`-p` 로 붙인다),
`tests/` 에 파일을 만들지 않았다. 실행 뒤 루트 `git status --porcelain` **빈 출력**.
**`tests/` 는 이 라운드가 한 글자도 만지지 않는다**(소유 `qa`).

## M-7-1. 반려 2 — **게이트는 「세션 안에서, 계획마다」로 좁혀야 작동한다**

`qa` 의 측정을 받아 **ADR 0016 §3 2 의 문안을 좁혔다**(그리고 §2-3 정정 상자에 라운드 3 블록을
넣었다). 바뀐 것은 두 한정이다 — **① 그 칸이 관측된 통합 세션 안에서 ② 칸마다 하나가 아니라
계획마다 하나.** 근거는 값이다:

| | 저장소 밖 2~3행 탐침 | 그 이름의 예측 | 통합 세션 안 |
|---|---|---|---|
| A3·pg | `Index Scan … _pkey` 12/12 | *"안 죽는다"* | pkey **4/10** · `ix_…_project_id` **6/10** |
| A5·pg | `Bitmap Heap Scan` 12/12 | *"언제나 죽는다"* | pkey **18/20** · `Bitmap Heap Scan` **2/20** |

**두 칸 다 반대로 예측했다.** 그리고 세션 안에서는 **38 세션 38/38 에서 계획이 결과를 완전히
예측한다**(같은 계획인데 갈린 세션 0). 그러므로 「이름」은 **세션 안에서만 이름**이고, **한 칸을 한
이름으로 부르는 것은 정정 상자 자신이 금지한 「이름으로 면제」와 구별되지 않는다** — 초판이 정확히
그렇게 했다. *architect 가 재확인한 것*: 위 여덟 수와 20칸 재측정 표를 **`test_22` docstring 에서
직접 읽었다**(`qa` 의 요약을 옮기지 않았다 — §6-1 의 *"가리킴으로 확인을 갈음하지 않는다"*).

**그리고 §4 「닫힘의 한정」 넷을 새 기준으로 다시 판정했다**(ADR 0016 §4 에 값으로 적었다):

| 한정 | 새 기준에서 | 근거 |
|---|---|---|
| ① *"기전이 `EXPLAIN` 으로 이름 붙었다"* | **통과하지 못한다** — 그 이름은 저장소 밖 탐침의 것이고 두 칸 다 틀렸다. **미측정이었다** | 위 표 |
| ① *(다시 세운 형태)* | **통과한다 — 그러나 모양이 바뀐다**: 그 칸의 이름은 **둘**(사는 계획·죽는 계획)이고, *"안 죽는 칸"* 이 아니라 *"대부분의 세션에서 그 순서를 공짜로 내는 계획이 뽑히는 칸"* 이다 | 38/38 예측 · A3·pg 6/10 · A5·pg 2/20 |
| ② *"깨지는 조건은 재지 않았다"* | **반만 통과한다** — **세션 축은 재졌다**. **행 수·통계 축은 여전히 미측정** | ADR §Deferred 8 · §후속 16 · 새 **§후속 52**(무엇이 세션마다 계획을 뒤집는가) |
| ③ 화면 축 | **그대로** | §후속 44 |
| ④ 정렬 줄의 존재를 붙드는 축 | **결론 그대로, 값이 바뀐다** — A3·sqlite 는 *"세 세션"* 이 아니라 재측정 **10/10**(+리뷰어 4/4 +architect 2/2), A5·pg 는 *"결정적으로 안 죽는다"* 가 아니라 **세션 의존 2/20** | §후속 48 의 라운드 3 정정 |

**번호를 주는 것은 ② 의 남은 축뿐이다 — §후속 52.** ① 은 번호가 아니라 **계측의 자리** 문제이고,
그것이 §후속 51 이다.

## M-7-2. `qa` 의 제안 1 — **세션 안 `EXPLAIN` 계측을 저장소에 둔다 (§후속 51 로 열고 배정한다)**

**둔다.** 근거는 이 저장소가 **두 사이클 연속으로 계측을 새로 만들다가 계측 자체를 틀린 것**이다 —
계획 0011 사이클은 **문장을 고르는 축**을(그 자리가 스스로 *"문장을 고르는 축이 이 측정의 전부다"*
라고 적는다), 이 사이클의 2~3행 탐침은 **행 수·투영**을 틀렸고, 후자는 두 칸 다 **반대로**
예측했다. **틀리는 자리가 「돌리는 것」이 아니라 「매번 새로 만드는 것」이면, 고칠 자리는 저장소다.**
그리고 ADR 0016 §3 2 가 이제 **세션 안·계획마다**를 요구하므로 **계측이 저장소 밖이면 그 게이트는
다음 사이클에서 재현 불가**다 — 게이트를 좁히는 이 라운드가 그 대가를 함께 진다.

**배정과 완료 조건은 §후속 51 에 있다**(소유 `qa`, ADR 문안은 architect). 조건 셋은 **옵트인 ·
양성 검사 · "계약이 아니라 계측"** 이고, 그중 **양성 검사가 이 판정의 값이다**: 켰는데 계획을 하나도
못 잡으면 *"계획이 없다"* 와 *"계측이 안 붙었다"* 가 **같은 출력**이 되고, 그것이 §후속 46 이 이름
붙인 모양(`ss` 부재 ↔ 히트 0)이며 이 저장소에서 **두 번** 났다.
*역방향 확인 — 두지 않는 쪽의 근거도 적는다*: 저장소에 놓인 계측은 **아무 테스트도 실패시키지
않으므로 조용히 낡는다**(CLAUDE.md §2 가 커밋 트레일러를 기각한 그 근거). **그래서 양성 검사
없이는 두지 않는다** — 조건이 아니라 **전제**다.

## M-7-3. `[ORD]` 재계수 — **679 → 542, 그리고 그 차이는 분해된다**

`qa` 의 값을 옮기지 않고 **같은 정의의 플러그인을 새로 써서 내 클러스터에서 다시 쟀다**
(① SELECT ② `ORDER BY` 없음 ③ `cursor.rowcount >= 2` · 귀속은 `services|packages` 안 가장 안쪽
프레임). **N=2, 두 실행이 한 자리도 다르지 않다:**

```
[ORD] select_exec=12217  noorder_exec=10695  noorder_multirow_exec=542   (3a816c4, 222 passed)
```

**그리고 옛 트리를 `git archive 08238c9 | tar -x` 로 꺼내 같은 플러그인으로 다시 쟀다**(같은
클러스터·같은 `.venv`, 그 트리의 `scripts/fetch_fixtures.py` 로 픽스처를 만든 뒤):

```
[ORD] select_exec=12131  noorder_exec=11125  noorder_multirow_exec=679   (08238c9, 216 passed)
```

**§1-c 의 세 수와 한 자리도 다르지 않다** — 그래서 두 값을 자리별로 뺄 수 있다:

| 몫 | `08238c9` | `3a816c4` |
|---|---|---|
| 서비스 자리 **열둘**(200·92·81·68·40·35·5·3·2·2·1·1) | 530 | **530** |
| ⓐ 넷(A3 113 · A2 9 · A5 8 · A4 7) | 137 | **0** |
| 테스트 코드 프레임(운영 프레임이 스택에 없는 실행, 자리 아홉) | 12 | **12** |
| **합** | **679** | **542** |

**세는 것은 자리가 아니라 실행 수다**(자리는 13 — 서비스 열둘 + 테스트 프레임 한 묶음).
**그러므로 137 은 우연의 일치가 아니라 ⓐ 넷 그 자체다.**

**반증한 것 — `qa` 의 분해 설명이다.** `3a816c4` 본문은 *"계획 §1-c 표는 상위만 실어 17행 합이
671 이므로 679 에는 표 밖 8회가 있었고, 이 트리에서는 테스트 코드 프레임이 4 → 12(+8) 로 늘어 두
몫이 상쇄됐다"* 라고 적는다. **옛 트리를 재니 테스트 코드 프레임은 이미 12 였다** — 늘어난 것이
아니라 §1-c 표가 **4 만 실었다**(그 표의 축이 **자리 × 테이블**이라 나머지 8회가 다른 칸으로
흩어졌다). 산술이 그것을 닫는다: 그 표의 **서비스 16행 합이 정확히 667 = 530 + 137** 이고,
`679 − 671 = 8` 은 남은 테스트 프레임이다. **그래서 「그 일치는 분해되지 않는다」는 것도 틀렸다** —
분해되지 않은 것이 아니라 **옛 트리를 아무도 재지 않았을 뿐이다.**
*이 반증의 값*: §확인하지 않은 것 3(**677 ↔ 679**)은 **여전히 열려 있지만 비용이 바뀌었다** —
`git archive <트리>` + 같은 플러그인이 옛 트리의 값을 **그대로** 낸다는 것이 이제 실행값으로 있다.
*재지 않은 것*: `743bcb9`(677 의 트리)는 이 라운드도 재지 않았다.

## M-7-4. **이 사이클이 CLAUDE.md 에 더한 §6-3 11회차가, 이 사이클 안에서 두 번째로 깨졌다**

**판정: 적는다. 그리고 새 회차는 §6-3 이 아니라 §6-1 이 받는다**(13회차) — CLAUDE.md 편집은
**별도 커밋**이다(§6-5 갱신 규칙에는 절 개수 제한이 없다. *"한 번에 한 절씩"* 은 **압축 규칙**
전용이고, 이것은 압축이 아니라 근거 추가다).

**사실.** 이 사이클은 §6-3 11회차를 CLAUDE.md 에 더했고(`ceb18e9`) *"사이클을 닫기 전에, 그 사이클이
두 번 이상 적은 값을 표로 모으고 갈리는 칸을 실행으로 가른다"* 를 요구한다. 그 표를 **두 개**
만들었다(이 계획 여섯 행 · ADR 0016 다섯 행). **20칸 사망률은 두 표 어디에도 없다.** §M-2-5 가
이미 같은 실패를 한 번 적었는데(*"내가 만든 규칙을 내 사이클의 이 값에 걸지 않았다"* — 결정 3 의
값), **이것이 그 사이클의 두 번째이고 값이 다르다.**

**전수를 다시 만들었다**(`qa` 의 목록을 옮기지 않고 루트에서 직접 — §6-1). 표기 집합은 `qa` 의
여덟(`20칸`·`스물 칸`·`18칸`·`죽은 세션`·`0/10`·`5/10`·`2/5`·`1 failed, 221 passed`)에
**재측정이 만든 표기**를 더해 넓혔다: `스무 칸`·`20 칸`·`열여덟`·`6/10`·`2/20`·`10/10`·`4/10`·
`5/9`·`2/9`·`0/5`·`0/4`·`2/2`·`4/4`·`1 failed`. 명령은 루트
`grep -rn -E "<집합>" . --exclude-dir=.git --exclude-dir=.venv --exclude-dir=node_modules
--exclude-dir=__pycache__` 와 `git log --all --grep`.

**넓힌 목록은 히트 수가 아니라 각 히트를 읽어 걸렀다**(§6-1 의 *"넓히면 남의 것을 잡는다"*).
걸러낸 부류: `doc_id` 폭발 반경(ADR 0009·계획 0003·`test_document_identity_freeze.py` 의 0/10·6/10·
10/10), **인덱스 선택**(ADR 0015 §2-1·계획 0011·`test_20` 의 5/10·6/10 — 값이 닮아 가장 위험한
오탐이다), 계획 0009 의 40/40·25/25, CLAUDE.md `| 12 |`(§6-1 **회차 번호**), 저장소 루트의 다른
프로젝트(`app/(tabs)/mypage/page.tsx` 의 `bg-surface-2/90`), `package-lock.json`, 바이너리
(`components/…/floor3.jpeg`).

**결과 — `qa` 가 넘긴 「여섯 자리」와 갈린다. 파일은 셋으로 같고, 자리는 ~~열둘 + 커밋 넷~~
**[라운드 4] 열셋 + 커밋 여섯**이다**(아래 표의 마지막 두 행이 라운드 4 가 더한 것이고, 그
둘이 빠진 이유는 **이 목록 자신의 단위와 「자기 커밋을 세는가」** 다 — §후속 53):**

| 어디 | 자리 | `qa` 의 목록에 |
|---|---|---|
| `tests/integration/test_22_row_order_contract.py` | 20칸 표 · 네 관측자 대조 · 세션 안 계획 표 (**정본**, 이 라운드에 고쳐졌다) | 있다 |
| ADR 0016 | §2-3 정정 상자의 20칸 표 · 그 아래 재현 문단 | 있다 |
| ADR 0016 | **§4 닫힘의 한정 ①·④** | **없다** |
| ADR 0016 | **§5 역방향 확인 표 6행** | **없다** |
| 계획 0012 | §M-2-2 · §M-3-4 · §M-6 34 | 있다 |
| 계획 0012 | §M-5 47 · §M-5 48 | **갈리지 않는다** — `qa` 의 목록은 *"§M-5 후속"* 이라고만 적어 **두 항목이 한 칸에 뭉쳐 있다**(고칠 자리는 둘이다) |
| 계획 0012 | **§M-1 표 7행 · §M-4 · §M-6 2** | **없다** |
| 계획 0012 | **[라운드 4 가 더한다] §M-6 35**(*"여섯 칸(A1·A2·A4 × 두 축)은 여전히 N=1"* — 정본 docstring 은 그 여섯을 **4/4** 로 싣는다) | **없다** — 그리고 **이 표에도 없었다** |
| 커밋 본문 | **[라운드 4 가 더한다] `3c6ac58`**(자기 측정값 6/10·2/20·10/10) **· `e3037df`**(초판 요약을 인용) | **없다** — **이 표를 만든 커밋 자신 둘**(§후속 53) |
| 커밋 본문 | `cac4559`(**제목에까지**) · `94751c5` · `f5044b5` | 있다 |
| 커밋 본문 | **`3a816c4`**(재측정을 실은 커밋 자신) | **없다** |

*그중 재측정이 거짓으로 만드는 자리와 그렇지 않은 자리를 가른다*: §M-1 표 7행의 *"20칸"* 은
**칸 수**라 재측정이 바꾸지 않는다(여전히 20칸). 거짓이 된 것은 **사망률과 그 요약**이고, 그것이
있는 자리를 이 라운드가 고쳤다(ADR §2-3·§4·§5 6행, 계획 §M-2-2·§M-3-4·§M-5 48·§M-6 34).
**커밋 본문은 고칠 수 없다** — 그 값들은 그 트리의 기록으로 남고, **그 사실 자체가 이 표의
칸이다.** `cac4559` 는 **제목**에 *"20칸 중 18칸이 죽고 두 칸은 구조다"* 를 싣는다.
**[라운드 4] 그 「넷」이 여섯이다.** 이 표를 만든 라운드 3 의 두 커밋(`3c6ac58`·`e3037df`)이
같은 값을 싣는데 목록에 없었다 — **`qa` 에게 건 기준(*"자기 커밋이 목록에 없다"*)을 내 목록에는
걸지 않았다.** 그리고 이 표의 **총계 열둘은 절 단위**인데(1 + 3 + 8) **칸은 문단 단위로**
열거한다(`test_22` 셋 · ADR §2-3 둘 · §4 둘 → 그 단위면 열여섯) — **단위가 섞였다.**
둘 다 §후속 **53** 이 규약으로 못박는다.

**왜 §6-3 이 아니라 §6-1 인가.** §6-3 11회차의 **규칙 문안은 작동한다** — 깨진 것은 그 규칙이
요구한 **표의 생성 기준**이다. 두 표는 **계획 §1 이 이름 붙인 값**(35 · 63/62 · 679 · 순서의 축 ·
`confirm_mapping_row` · 만지는 트리)으로 만들어졌고, **사이클이 실행으로 만들어 낸 값**(측정 결과
자체)은 그 기준에 **칸이 없다.** 그것은 §6-1 의 모양 그대로다 — *"목록의 생성 기준이 곧 그 목록의
한계다"*, 그리고 밀려난 것이 **자기가 지금 보고 있지 않은 자기 값**(4·5회차와 같은 방향)이다.
**§6-3 에 회차를 더하면 규칙 문안을 다시 쓰는 것으로 읽히고, 고칠 것은 문안이 아니라 그 표를
만드는 기준이다.** 그래서 **§6-1 에 13회차 행**을 더하고, §6-3 11회차에는 **그 표의 값 목록도
§6-1 ①②③ 을 받는다**는 한 줄만 건다(별도 커밋).

## M-7-5. 이 라운드가 반증한 것 · 재지 않은 것

**반증했다**(전부 실행값):
1. **`qa` 의 분해 설명** — *"테스트 코드 프레임이 4 → 12 로 늘어 상쇄됐다"* (M-7-3: 두 트리 모두 12).
2. **`qa` 가 넘긴 「여섯 자리」** — 파일 안의 자리를 세면 ~~**열둘**~~ **[라운드 4] 열셋**이고,
   커밋은 ~~**넷**~~ **여섯**이다(M-7-4). 자기 커밋(`3a816c4`)이 목록에 없다.
   **[정정 — 리뷰 재심사 라운드 4] 그 마지막 문장이 나에게도 걸린다** — 이 목록을 실은 두 커밋
   (`3c6ac58`·`e3037df`)도 같은 값을 싣는데 목록에 없었고, 빠진 자리 하나(§M-6 35)도 더 있다.
   **반증한 쪽이 같은 칸에서 반증됐다**(§후속 53).
3. **ADR §4 한정 ①** — *"기전이 `EXPLAIN` 으로 이름 붙었다"* 는 새 기준에서 **미측정이었다**(M-7-1).
4. **ADR §6 대안 7 ②의 A3 한정** — *"A3 에서는 인덱스 순서가 공짜"* 도 **그 자리의 성질이 아니다**:
   세션 안 A3·pg 는 pkey 4/10 ↔ `ix_…_project_id` 6/10 이다. 라운드 2 가 *"②는 A3 에 한정해서만
   쓴다"* 로 좁힌 것을, 라운드 3 은 **한 번 더** 좁힌다(*"A3 의 어떤 계획에서는"*).
5. **내 지시 문안** — 상위 에이전트가 준 *"결정적으로 죽는 것은 여섯"* 은 열 칸을 채우지 못한다
   (6+2+1=9, A3·sqlite 가 어디에도 없다). `qa` 의 실측대로 **일곱 + 둘 + 하나**다. 이 라운드는
   그 값을 `test_22` docstring 에서 직접 읽어 확인했다.

**재지 않았다**: ① `743bcb9` 의 `[ORD]`(§M-6 3) ② 무엇이 세션마다 계획을 뒤집는가(§후속 52)
③ 정렬이 있을 때의 계획(§후속 43) ④ 네 관측자 값의 비율 차이 검정(§M-6 34) ⑤ **역방향 열 칸과
20칸 재측정을 architect 가 재현하지 않았다** — 이 라운드가 재현한 것은 `[ORD]` 두 트리뿐이고,
20칸은 **`test_22` docstring 에서 읽었다**(§M-6 35 와 같은 한정: 여기 적히는 것은 `qa` 의
관측값이지 내 관측이 아니다) ⑥ IPv6 리스너(§M-6 36).

---

# 리뷰 재심사 라운드 4 (architect, 2026-09-07) — **문안의 전파**와 **전수의 단위**

재심사의 판정은 **CHANGES REQUESTED** 이고, **코드 결함은 이번에도 0 · 리뷰어 5체크 전부 PASS ·
§후속 17 열린 채 이월 PASS** 다. 반려는 전부 **문구·전수**다. 라운드 3 의 반려 1·3·4·5 는 닫혔고,
반려 2 의 **측정은 성립하되 문안이 전파되지 않았다** — 이 라운드가 하는 일이 그 전파다.

## M-8-0. 이 라운드의 실측이 나온 자리 (재현 방법)

**작업 트리** `/home/user/Bim/buildtwin`, **저장소 루트 `/home/user/Bim`**, 브랜치
`claude/buildtwin-initial-setup-ubulzb`, **HEAD `e3037df`**.

**착수 시 루트 `git status --porcelain` 은 빈 출력이 아니다** —
`M buildtwin/tests/integration/test_22_row_order_contract.py`. 이것은 **`qa` 가 병렬로 돌고 있는
반려 A-3·C 의 in-flight 변경**이고, **그 파일은 한 글자도 만지지 않았다.** 스테이징은 경로를
명시했고 `git commit -a` 를 쓰지 않았다.
**그리고 그 집합은 이 라운드가 도는 동안 자랐다** — 편집이 끝날 무렵의 같은 명령은
`.github/workflows/buildtwin-ci.yml` · `buildtwin/tests/helpers/postgres_axis.py` ·
`buildtwin/tests/integration/test_99_db_axis_contract.py` 를 더하고 미추적
`buildtwin/tests/invariants/test_postgres_floor_recitation.py` 를 냈다(= 반려 C + §후속 54).
**§M-6 39 가 이름 붙인 자리가 이 라운드에서 다시 났고**, 이번에는 변이가 아니라 **남의 작업 자체**다:
그래서 `git add` 는 **내 두 파일을 경로로 명시**했고 게이트는 돌리지 않았다.

**커밋 직전 게이트(`make test`·`make lint`)를 돌리지 않았다.** §M-6 **39** 가 이름 붙인 자리이고
**라운드 2 가 같은 판단을 했다**: 남의 in-flight 변경이 있는 트리에서 잰 값은 내 편집의 값이 아니고,
겹쳐 돌리면 `qa` 의 **세션 의존** 측정을 오염시킨다. 이 라운드가 만지는 것은 `docs/` 둘과
`CLAUDE.md` 하나이고 **어떤 테스트도 그 셋을 import 하지 않는다.** 게이트의 마지막 실행값은
§M-6 표의 것(`make test` **492 · 104 · 8 · 222** + vitest **283** / `make lint` **exit 0**)이고
**이 라운드는 그것을 갱신하지 않는다** — 갱신하면 내가 돌리지 않은 값을 내 트리의 값으로 싣게 된다.

**DB 는 띄우지 않았다.** 이 라운드의 모든 값은 **읽기와 재계수**다(`git log`·`git show`·`grep`·
`python3 len()`). 클러스터를 띄우지 않았으므로 **20칸도 `[ORD]` 도 이 라운드가 재현하지 않았다.**

**환경 탐침**(직접 실행): `os.path.exists('/proc/net/tcp')` → `True`,
`os.path.exists('/proc/net/tcp6')` → **`False`**, `shutil.which('ss')` → **`None`**,
`hasattr(socket,'AF_INET6')` → `True`. 포트 기구의 한계는 §M-6 **36** 그대로다(그 항목에 보강).

**§6 재측정**(정의는 §후속 50 과 같다): 트리 `e3037df` 에서 **전체 31,045자 / 478줄**,
**§6 19,951자 / 264줄 = 64.26%**. 절별은 §후속 50 의 라운드 4 표에 있다.
*리뷰어 보고값과의 대조*: 리뷰어는 **477줄 · §6 263줄**, 절별로 **+1자**(§6-1 7,774 · §6-2 871 ·
§6-3 6,262 · §6-4 958)를 보고했고 **§6-5 3,417 만 일치**한다. **줄 끝 개행을 세는 규약이 하나
다를 뿐이고 §6-5 는 EOF 로 끝나 그 차가 없다** — **갈리지 않는다.** 전체 자수 31,045 와 §6 자수
19,951, 비중 64.26% 는 한 자리도 다르지 않다.

## M-8-1. 판정 — **「정본이 둘」은 구조가 아니라 축이 갈린 것이다**

반려 A-1 이 묻는다: ADR 0016 §3 이 *"완료 조건 표는 계획 0012 §작업 분배 아래 두 상자에 있다 …
**여기에 다시 적지 않는다** — 같은 조건을 두 자리에 두면 갈린다"* 라고 **자기 아래 §3 2 를 미리
반박**하는데, 그 §3 2 가 같은 요구를 다시 적었고 라운드 3 이 **한쪽만** 고쳐 **그 경고가 실측이
됐다.** 구조를 어떻게 할 것인가.

**판정: 정본이 둘인 게 아니라, 한 자리에 두 종류의 문장이 섞여 있었다. 축을 갈라 각각 한 자리에
못박는다.** 이 저장소가 이미 두 번 택한 형태다 — CLAUDE.md **§2**(*"소유 판정의 정본은 이 §2
하나이고, 에이전트 정의와 계획은 이 줄을 가리킬 뿐 자기 축을 따로 세우지 않는다"*)와
**§3-13**(*"이 원칙의 정본은 이 줄 하나이고 …"*).

| 문장의 종류 | 무엇인가 | **정본** | 다른 자리는 |
|---|---|---|---|
| **완료 조건 표** — 누가 무엇을 **몇 칸** 만족해야 하는가(작업 3·4·5 다섯 칸 / 작업 7 여섯 칸), 소유·개수·커밋 본문에 적을 것 | **이 사이클의 배정**. 사이클과 함께 닫힌다 | **계획 0012 §작업 분배 아래 두 상자** | ADR 은 **여기에 다시 적지 않는다**(§3 문단 그대로 유지) |
| **계약 조항** — 한 자리가 **무엇으로 닫히는가**(`ORDER BY` 의 존재 / 역방향이 죽는 회귀 / 안 죽는 칸의 `EXPLAIN` 한정) | **사이클보다 오래 산다**. §Deferred 1(ⓒ 여섯 = §후속 40)이 **같은 조항을 물려받는다** | **ADR 0016 §3 의 셋(1·2·3)** | 계획은 그 문안을 **그대로 싣고**, 고칠 때 **ADR 을 먼저 고친다.** 갈리면 **ADR 이 이긴다** |

**근거는 §후속 40 이다.** 계획 §M-2-3 ⓒ 기각이 *"그 문장은 다음 사이클이 곧 읽는다 — §후속 40(ⓒ
여섯)이 같은 완료 조건을 물려받는다"* 라 적는다. 물려받는 쪽에서 보면 **계획 0012 는 그때 닫힌
문서**이고, 살아 있는 것은 ADR 이다. 그러므로 **오래 사는 문장을 오래 사는 문서에** 둔다.

*역방향 확인 — 「그대로 싣는다」가 미는 것.* 복사는 갈림의 원인이고 이번에 난 것이 정확히 그것이다.
그런데 **가리킴만 두면 실행하는 소유자가 게이트를 열지 않고 지나간다** — 완료 조건은 **작업하는
사람이 그 자리에서 읽는 목록**이라 링크로 대체되지 않는다. 그리고 CLAUDE.md §6-1 이 금지하는 것은
*"다른 절을 가리켜 **확인**을 갈음하는 것"* 이지 *"규칙의 **정본**을 한 자리에 두는 것"* 이 아니다 —
§2·§3-13 이 이미 후자를 택했다. **그래서 싣되 정본을 이름으로 못박는다.**
*그 대가도 적는다*: 두 문안의 일치를 **어떤 기계도 보지 않는다.** 이번 반려 A-1 이 그 실례이고,
**닫지 않고 한계로 적는다**(§후속 54 의 역방향 확인 — 소유가 `architect` 이고 대상이 산문이라
`qa` 항목에 넣지 않았다).

**고친 자리 셋**(같은 문안):
- **ADR 0016 §3** — 위 축 분리를 `[한정 — 리뷰 재심사 라운드 4]` 로 적고, **2 가 정본임을 못박았다.**
- **계획 §작업 7 완료 조건 2** — 두 한정(**세션 안 · 계획마다**)과 계측 형태를 실었다.
- **계획 §M-2-4 ②** — 같은 두 한정. *이 자리가 가장 무거웠다*: 그 절의 제목이 **「면제가 되지 않게
  하는 자물쇠」** 이고 ②가 그 자물쇠의 한 짝인데 옛 문안이 남아, **자물쇠를 정의하는 자리가 ③ 이
  막으려는 「이름으로 면제」를 ②로 되돌려 주고 있었다.**

## M-8-2. **전수의 단위** — 반증한 쪽이 같은 칸에서 반증됐다

라운드 3 은 `qa` 의 「여섯 자리」를 **열둘 + 커밋 넷**으로 반증하며 *"자기 커밋이 목록에 없다"* 를
걸었다. **그 기준을 내 목록에 걸면 내 목록도 걸린다.** 재계수는 §후속 **53** 에 값으로 있고,
결론만 옮기면 —

| 무엇 | 라운드 3 | **라운드 4 재계수** | 무엇이 밀려났나 |
|---|---|---|---|
| 문서 자리 | **열둘** | **열셋** | **§M-6 35**(*"여섯 칸은 여전히 N=1"*) — 20칸 사망률의 N 을 싣는 자리인데 두 목록 어디에도 없었다 |
| 커밋 본문 | **넷** | **여섯**(세지 않으면 다섯) | **`3c6ac58`**(자기 측정값) · **`e3037df`**(인용) — **그 목록을 만든 커밋 자신 둘** |
| 총계의 단위 | **절**(1 + 3 + 8 = 12) | 같은 표의 **칸은 문단**(`test_22` 셋 · ADR §2-3 둘 · §4 둘 → **열여섯**) | **한 표가 총계는 절로, 칸은 문단으로 셌다** |

**이것은 §6-1 12·13회차와 같은 칸이고, 이번에는 목록을 만든 쪽에서 났다.** 13회차가 이름 붙인
*"그 사이클이 실행으로 만들어 낸 값에는 칸이 없다"* 의 한 겹 아래에, **「자리」가 무엇인지와 「나
자신을 세는지」가 적혀 있지 않다**는 두 번째 구멍이 있었다.

**CLAUDE.md `:245` 판정: 고친다(별도 커밋).** 그 관측값 칸이 *"문서 열두 자리 + 커밋 본문 넷"* 을
그대로 싣는데, **같은 사이클이 `qa` 에게 건 기준으로 다시 세면 열셋 + 여섯**이다.
근거 셋: ① **§6-4 1** — *"사실과 다른 문구는 그것을 만든 사이클이 고친다."* ② **§3-13** 은
`docs/adr/`·`docs/plans/` 만 「HEAD 를 못박은 기록물」로 두고 **CLAUDE.md 는 그 갈래에 없다** —
살아 있는 SSOT 다. ③ **§6-5 갱신 규칙**은 *"항목을 지우지 않는다 / 근거를 추가한다"* 이고 이것은
지움이 아니라 **관측값의 정정 + 한계 명시**다.
*고치는 형태*: 숫자만 갈아 넣으면 **다음 커밋이 다시 거짓으로 만든다**(위 표의 셋째 행이 그 이유다).
그래서 **수와 함께 그 수의 단위·한계**를 칸에 싣고 §후속 53 을 가리킨다.

## M-8-3. 이 라운드가 반증한 것 · 재지 않은 것

**반증했다**(전부 이 라운드의 실행값):
1. **내 자신의 「커밋 넷」** — 여섯이다(§후속 53 의 `git log --all` 재계수). 라운드 3 이 `qa` 에게
   건 기준이 라운드 3 에게 되돌아온다.
2. **내 자신의 「열둘」** — §M-6 35 가 빠져 열셋이고, 총계와 칸의 **단위가 섞였다**(산술로 닫힌다:
   1 + 3 + 8 = 12 ↔ 3 + 2 + 2 + 1 + 8 = 16).
3. **§M-6 35 의 *"여섯 칸은 여전히 N=1"*** — 정본 docstring 은 그 여섯을 **4/4** 로 싣는다.
   루트 grep 에서 그 거짓은 저장소에 **한 자리**뿐이었다.
4. **상위 지시 문안 하나** — 상위 에이전트가 준 *"라운드 3 은 같은 §M-6 의 **2**·34 에 보강을
   달았다"* 는 틀렸다. `git show 3c6ac58 -- docs/plans/0012-*.md | grep "^+.*보강 — 리뷰 라운드 3"`
   은 **두 자리**를 내고 그것은 **§M-6 3(`[ORD]`)과 §M-6 34** 다. §M-6 **2** 에는 라운드 3 보강이
   없다. 결론(§M-6 5 만 지나쳐졌다)은 바뀌지 않는다.
5. **「§Deferred 8 ↔ §후속 52」의 두 문장** — 한쪽은 포함, 한쪽은 분리라 **둘 다 정확하지 않다.**
   맞춘 문안은 *"물음은 다르고 축은 「통계」에서 겹친다"* 이고 양쪽에 같은 문장을 실었다.
6. **이 라운드 자신의 전수 하나** — §후속 54 를 쓰면서 grep 을 **파일 둘로 먼저 좁혔고**, 넓히니
   `test_99_db_axis_contract.py` 에 복창 둘이 더 있었다. **§6-1 의 *"경로를 먼저 좁히지 않는다"* 를
   그 규칙을 인용하는 항목 안에서 어겼다** — §6-3 1~6회차가 이름 붙인
   *"방금 이 규칙을 썼다"의 방어력은 0* 이 이 라운드에서도 났다. 고친 것은 그 항목 안에 값으로 있다.

**재지 않았다**(전부 열린 채 이월한다 — 이 라운드는 DB 를 띄우지 않았다):
① **역방향 열 칸**과 **A5·sqlite 0/10** 을 architect 가 재현하지 않았다(§M-6 **35** — 이 라운드도
못 했다). ② `743bcb9` 의 `[ORD]` 677(§M-6 **3** · §확인하지 않은 것 3, **열린 채**).
③ 정렬이 있을 때의 계획(§후속 **43**). ④ §1-b 35행 표의 자리별 ⓐ/ⓑ/ⓒ 재검증(§M-6 **37**).
⑤ **§6-1·§6-3·§6-5 의 근거 표면**(= 규칙을 뺀 자수 — §후속 **50**, 절 크기만 다시 쟀다.
**리뷰어도 절·표 크기만 쟀다**). ⑥ **IPv6 로만 물린 리스너**(§M-6 **36** — 부재를 출력으로
재확인했을 뿐, 그 한계가 **세 번째 관측자**에게서 다시 났다). ⑦ **무엇이 세션마다 계획을
뒤집는가**(§후속 **52** — 리뷰어 클러스터에서 *"같은 회차 번호가 함께 죽는다"* 가 재현됐다는 것은
**보고값**이고, 원인은 여전히 미측정). ⑧ **네 관측자 값의 비율 차이 검정**(§M-6 **34**).
⑨ **어떤 변이 아래에서도 `make test` 를 돌리지 않았다**(§M-6 **38**) — 이 라운드는 게이트 자체를
돌리지 않았다(§M-8-0).

**이 라운드가 만든 새 미측정은 없다.** 위 아홉은 전부 **이미 번호가 있는 항목**이고, 이 라운드는
그중 어느 것도 닫지 않았다 — **닫힌 것은 문안 다섯 자리와 목록 둘뿐이다.**
