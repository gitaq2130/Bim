# ADR 0014 — DB 를 테스트 파라미터로 만든다 (PostgreSQL 커버리지)

- 상태: Accepted
- 날짜: 2026-09-07
- 작성: architect
- 관련: CLAUDE.md §1(기술 스택 = PostgreSQL + PostGIS) · §3-1 · §3-4 · §6-1 · §6-2 · §6-3,
  `docs/plans/0007-*.md` §과제 2(§2-a·2-b·2-c — 이 결함의 원 조사),
  `docs/plans/0008-*.md` §리스크 2 · §M-4 1(“postgres 를 켜 보지 않았다”),
  `docs/plans/0009-*.md`(이 ADR 을 실행으로 옮기는 계획)

---

## 0. 이 문서의 실측이 나온 자리 (재현 방법)

**작업 트리** `/home/user/Bim/buildtwin`, **저장소 루트 `/home/user/Bim`**, 브랜치
`claude/buildtwin-initial-setup-ubulzb`, **HEAD `5beb954`**. 루트에서 `git status --porcelain`
**전문이 빈 출력**이다(모든 변이는 적용 → 측정 → 원복 → clean 확인을 한 건씩 했다).

**이 ADR 은 이 저장소에서 처음으로 PostgreSQL 을 실제로 켜고 잰 문서다.** 앞선 여덟 사이클의 모든
수치는 SQLite 값이었고(계획 0008 §M-4 1: *“postgres 를 켜 보지 않았다”*), 그래서 §후속 10 이
**추론 위에** 서 있었다. 아래 `[PG-*]`·`[B-*]`·`[SWAP]`·`[ORD]` 는 전부 실행값이다.

측정에 쓴 postgres(저장소에 커밋하지 않는다 — 스크래치패드):

```
$ /usr/lib/postgresql/16/bin/initdb -D <scratch>/pgdata -U buildtwin --auth=trust
$ pg_ctl -D <scratch>/pgdata -o '-p 55432 -k <scratch>/pgrun -c listen_addresses=127.0.0.1' start
$ psql -h 127.0.0.1 -p 55432 -U buildtwin -d buildtwin_test -tc "select version();"
 PostgreSQL 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1) on x86_64-pc-linux-gnu …
$ psql … -tc "select extname from pg_extension;"          → plpgsql
$ psql … -tc "select count(*) from pg_available_extensions where name='postgis';"  → 0
```

드라이버는 프로젝트 `.venv` 를 오염시키지 않도록 별도 디렉터리에 깔고 `PYTHONPATH` 로만 붙였다
(`pip install --target <scratch>/pglibs "psycopg[binary]"` → **psycopg 3.3.5**). 그래서 계획 0007 §2-a 가
잰 *“`.venv` 에도 0건”* 은 이 측정 뒤에도 그대로 참이다.

기준선(전부 이 ADR 이 직접 쟀다):

```
$ cd /home/user/Bim/buildtwin && .venv/bin/pytest -q
807 passed, 1 warning in 85.85s (0:01:25)

$ .venv/bin/pytest -q tests/integration
191 passed, 1 warning in 32.64s
```

**이 문서의 `파일:줄`·커밋 참조는 HEAD `5beb954` 트리의 것이다** — HEAD 가 움직여도 갱신하지 않는다
(CLAUDE.md §3-13 첫째 갈래).

---

## 1. Context

### 1-1. 무엇이 비어 있는가 (계획 0007 §2-a·2-b 의 실측을 `5beb954` 에서 재확인했다)

| # | 사실 | 이 ADR 의 재측정값 |
|---|---|---|
| a | CI `integration` 잡이 매 실행마다 `postgis/postgis:16-3.4` 서비스를 띄우고 `BUILDTWIN_CI_POSTGRES_URL` 을 export 한다 | `.github/workflows/buildtwin-ci.yml:106-148`(job) · `:112-128`(services) · `:129-133`(env). **워크플로는 저장소 루트에 있다** — `buildtwin/` 밑이 아니다 |
| b | **그 이름을 읽는 코드 0건** | 루트 grep(`--exclude-dir=docs`) 히트 **1건이고 그것이 정의 자신**이다. 문서를 넣으면 10건이고 아홉이 계획 문서다 |
| c | `pyproject.toml` 에 드라이버 선언 0건, `.venv` 에도 0건 | `grep -nE 'psycopg\|asyncpg\|postgres\|pg8000' buildtwin/pyproject.toml` → `exit=1` |
| d | 드라이버는 **컨테이너 이미지에만** 있다 | `buildtwin/Dockerfile:5` 의 `pip install … psycopg[binary]` |
| e | 운영 경로는 postgres 다 | `buildtwin/docker-compose.yml:27,39` — `DATABASE_URL: postgresql+psycopg://buildtwin:buildtwin@db:5432/buildtwin` |
| f | `tests/integration/conftest.py:35` 가 **조건 없이** sqlite 로 덮는다 | 같은 줄 그대로 |
| g | 테스트가 sqlite 를 못박는 자리 **11**(docstring 1 제외) | `grep -rn "sqlite:" buildtwin/tests --include='*.py'` → 히트 12, 그중 `test_persistence.py:174` 가 docstring |
| h | 운영 코드의 sqlite 분기 **4** | `settings.py:38` · `db.py:23` · `db.py:41` · `services/api/main.py:28` |
| i | 서버 트리 `select(` 문장 **63** 중 `order_by` 미지정 **42** | 계획 0008 §후속 10 의 휴리스틱을 다시 돌려 **같은 63/42** 를 얻었다(상한으로만 읽는다 — 아래 §5-3) |

### 1-2. 그래서 §후속 10 이 무엇을 물었나

계획 0007 §2-b 의 결론: *“§후속 10 의 일은 「드라이버를 선언하는 것」이 아니라 **「DB 를 테스트
파라미터로 만드는 것」**이다.”* 그리고 계획 0007·0008 이 둘 다 **착수 크기를 모른다**는 이유로 미뤘다.

**이 ADR 이 그 크기를 재고, 잰 값 위에서 결정한다.**

### 1-3. 크기를 재려고 층을 갈랐다 — 그리고 층마다 실행값이 있다

측정 도구(스크래치패드 pytest 플러그인, 커밋하지 않는다): `packages.core.db.get_engine` **하나만**
가로채 sqlite URL 을 postgres 스키마로 바꾼다. **운영 코드의 sqlite 분기 넷은 그대로 sqlite 갈래로
간다** — 그 구별이 이 측정의 전부다.

| 층 | 무엇을 재나 | 실행값 |
|---|---|---|
| **A. SQL·ORM·정렬 호환성** | 스키마가 postgres 에 서고, 지금 스위트가 postgres 에서 도는가 | `Base.metadata.create_all` → **24 테이블**. `pytest tests/unit tests/invariants tests/regression tests/integration` → **795 passed**. 엔진 계수 `[SWAP] engines->postgres=238 · passthrough=0 · 테스트 파일이 직접 만든 sqlite 엔진=15` |
| **B. sqlite 분기 넷** | `DATABASE_URL` 이 **진짜** postgres 면 무엇이 죽나 | `[B-3] users seeded = 0` → `[B-4] login cm@ → 401 {"detail":"invalid credentials","code":"unauthorized"}`. 시드를 손으로 넣어 그 분기를 우회하면 다음이 죽는다: `[B2-2] login raised RuntimeError: JWT_SECRET 환경변수가 필요합니다 (.env)` |
| **C. 픽스처 파라미터화** | 11자리 중 몇이 축 하나로 움직이나 | `core_db` 를 경유하는 자리는 스왑으로 전부 움직였고(238 엔진), **테스트 파일이 `sqlalchemy.create_engine("sqlite://")` 를 직접 부르는 자리 15회**는 축 밖이다 |
| **D. 드라이버** | 무엇이면 A 가 도나 | `psycopg[binary] 3.3.5` 하나. `asyncpg` 는 필요 없다(동기 SQLAlchemy) |

**A 층이 0 실패라는 것이 이 ADR 의 가장 중요한 값이다.** 모두가 두려워한 것(*“정렬 미지정 42자리가
postgres 에서 한꺼번에 터진다”* — 계획 0007 §2-c)은 **이 스위트에서는 일어나지 않았다.** 그래서
남은 일은 A 가 아니라 B·C·D 이고, 그 셋은 크기가 작다.

*그러나 “A 가 0 실패”와 “42자리가 옳다”는 다른 문장이다.* §5-3 이 그 구별을 값으로 적는다.

### 1-4. `packages/core/models/` 주석이 이 축에 대해 하는 단정 (이름 붙은 블라인드 스팟, CLAUDE.md §6-1)

실행값: `grep -rniE 'sqlite|postgres|dialect|드라이버|DB 엔진|스캔 순서' buildtwin/packages/core/models/*.py`
→ **히트 1건**.

```
packages/core/models/orm.py:1: """SQLAlchemy ORM. JSON 컬럼으로 bbox/psets/evidence 저장(SQLite·PostgreSQL 공용). PostGIS 공간 인덱스는 Deferred(ADR)."""
```

이 줄은 **자기 파일 밖에 대한 단정**(“PostgreSQL 공용”·“PostGIS 없이 선다”)이고, **여덟 사이클 동안
아무도 실행하지 않았다.** 이 ADR 이 처음으로 태웠고 **둘 다 참이다** — postgres 16.13 에서
`create_all` 이 24 테이블을 세우고(§1-3 A), 그 클러스터에는 PostGIS 가 **설치돼 있지 않을 뿐 아니라
`pg_available_extensions` 에도 없다**(§0). 그러므로 이 주석은 **고치지 않는다**. 참인 단정을
고치는 것이 아니라, **참임을 처음으로 확인했다는 사실**을 여기 남기는 것이 이 항목이다.

---

## 2. Decision

### 2-1. 드라이버는 `psycopg[binary]`, 자리는 `[project] dependencies`

`pyproject.toml` 의 **본 의존성**에 넣는다. dev extra 가 아니다.

*근거.* ① 운영 경로가 postgres 다(§1-1 e) — dev extra 에 두면 *“운영 URL 은 postgres 인데 운영
설치에는 드라이버가 없다”* 는 지금의 모순이 그대로 남는다. ② `Dockerfile:5` 가 이미 그 비용을 내고
있다(§1-1 d) — 본 의존성에 넣으면 그 인자가 중복이 될 뿐 해가 없다. ③ `db.py:41` 이 이미 postgres 를
상정해 `connect_args` 를 가른다.

*역방향 확인 — 본 의존성이 무엇을 밀어내나.* sqlite 만 쓰는 로컬 개발자도 `psycopg-binary` 휠을
받는다(실측 **5.3 MB**). 그것이 이 선택의 유일한 비용이고, dev extra 로 옮기면 그 5.3 MB 를 아끼는
대신 **운영 이미지와 pyproject 가 서로 다른 의존성 집합을 말하는 상태**가 유지된다 — 후자가 더 비싸다.

*역방향 확인 — `asyncpg` 를 빼면 무엇이 빠지나.* 비동기 드라이버 경로 전부. 이 저장소의 세션은
동기 `sqlalchemy.orm.Session` 뿐이고(`packages/core/db.py`), 비동기 엔진을 만드는 자리는 0건이다
(`grep -rn "create_async_engine" buildtwin --include='*.py' --exclude-dir=.venv --exclude-dir=__pycache__` → `exit=1`, **히트 0**). 필요해지는 날 다시 정한다.

### 2-2. 테스트의 DB 축은 **이미 있는 이름** `BUILDTWIN_CI_POSTGRES_URL` 이다

`tests/integration/conftest.py` 는 그 환경변수가 **설정돼 있고 비어 있지 않으면** 그 DB 로 가고,
아니면 지금처럼 임시 sqlite 로 간다.

*근거.* §후속 10 의 결함은 *“CI 가 이름을 export 하는데 아무도 읽지 않는다”* 이다. **새 이름을
만들면 그 결함을 닫는 대신 옮긴다** — 읽히지 않는 이름이 하나 더 생긴다. 그리고 워크플로 주석
(`:130`, `env:` 블록 머리)이 *“서비스 컨테이너는 옵트인 — 테스트가 이 값을 읽어 쓸 수 있다”* 라고 이미 적고 있어,
이 결정은 그 문장을 **처음으로 참으로 만든다**(CLAUDE.md §6-4).

*역방향 확인 — 왜 `DATABASE_URL` 을 그대로 쓰지 않나.* `DATABASE_URL` 은 **운영·개발의 실제 DB** 를
가리키는 이름이고 개발자 `.env` 에 값이 들어 있을 수 있다(`.env.example:2` 는 값이 비어 있지만 그것은
예시 파일이다). 통합 테스트는 스키마를 만들고 지우므로, 그 이름을 축으로 쓰면 **개발자가 자기 DB 를
날리는 경로**가 생긴다. 축은 반드시 **테스트 전용 이름**이어야 한다.

*역방향 확인 — “설정돼 있고 **비어 있지 않으면**” 의 두 번째 조건이 무엇을 잡나.* GitHub Actions 는
정의되지 않은 값을 빈 문자열로 export 할 수 있고, `os.environ.get(...) is not None` 만 보면 빈
문자열이 postgres 모드로 읽힌다 → `create_engine("")` 이 죽는다. 값 truthiness 로 본다.

**격리는 세션마다 새 스키마다.** 세션 시작에 `swap_<n>` 스키마를 만들고 `search_path` 로 붙인 뒤,
세션 끝에 `DROP SCHEMA … CASCADE` 한다. *근거*: 이 방식으로 **191 통합 테스트가 전부 통과했다**
(§1-3 A). 데이터베이스를 지우지 않으므로 CI 서비스 컨테이너 한 개를 여러 실행이 공유해도 안전하다.

### 2-3. sqlite 분기 넷의 처분 — **넷 중 셋은 바꾸지 않는다**

| # | 자리 | 처분 | 근거(실행값 또는 코드 인용) |
|---|---|---|---|
| 1 | `packages/core/db.py:23` `isinstance(dbapi_connection, sqlite3.Connection)` → `PRAGMA foreign_keys=ON` | **변경 없음** | 방언 검사가 **타입 검사**라 postgres 연결에서 자연히 건너뛴다. postgres 는 FK 를 기본으로 강제하므로 이 PRAGMA 가 지키려던 불변식(ADR 0005 복합 FK)이 그쪽에서는 이미 참이다. 실측: postgres 795 통과 |
| 2 | `packages/core/db.py:41` `connect_args={"check_same_thread": False} if u.startswith("sqlite") else {}` | **변경 없음** | 같은 이유. `else {}` 갈래가 이 ADR 의 측정에서 **처음으로 실행됐다** |
| 3 | `packages/core/settings.py:38` `if self.database_url.startswith("sqlite"): <임시 JWT 시크릿>` else `raise` | **변경 없음. 테스트가 `JWT_SECRET` 을 준다** | 이 분기는 §3-4(시크릿은 `.env` 에만)를 지키는 **안전 장치**다. 넓히면 “운영에서 시크릿 없이 뜨는” 경로가 생긴다. 실측 `[B2-2]`: 시드를 우회하면 이 분기가 `RuntimeError: JWT_SECRET 환경변수가 필요합니다 (.env)` 로 죽는다 — **테스트가 값을 주는 것이 옳은 답이지 코드를 넓히는 것이 아니다** |
| 4 | `services/api/main.py:28` `if url.startswith("sqlite"):` → 데모 사용자·프로젝트 시드 | **조건을 넓힌다**: `if url.startswith("sqlite") or settings.seed_dev_data:` | 실측 `[B-3]` 시드 0 · `[B-4]` 로그인 **401**. 인증이 **예외 없이 조용히** 죽는다 — 이 저장소의 지배적 실패 모드 그대로다 |

**새 설정** `Settings.seed_dev_data: bool = False`(`packages/core/settings.py`, architect 소유) +
`.env.example` 에 `SEED_DEV_DATA=` 키 이름 등록.

*역방향 확인 — 왜 `or` 로 **넓히기만** 하고 `if settings.seed_dev_data:` 로 갈아치우지 않나.*
갈아치우면 지금 sqlite 로 도는 모든 것이 죽는다: `make dev`·`make api` 의 로컬 개발 플로우 전부와,
`tests/integration/conftest.py` 의 `tokens` 픽스처가 네 역할로 로그인하는 **191 통합 테스트 전부**.
CLAUDE.md §6-3 이 말하는 *“조건을 바꾸면 그 결과를 소비하는 게이트까지 따라간다”* 의 자리다.

*역방향 확인 — `or` 가 무엇을 더 들여보내나.* **운영 postgres 에 플래그를 켜면 데모 계정이 생긴다.**
그 위험은 새로 만들어지는 것이 아니라 이미 있다(운영이 sqlite 면 지금도 시드된다). 기본값 `False` +
`.env.example` 등록으로 **관측 가능하게** 둔다. 시드를 앱 기동에서 아예 떼어내는 것(가장 옳은 답)은
`make dev`·`make api`·통합 픽스처 셋을 함께 바꾸는 일이라 §Deferred 1 로 남긴다.

*역방향 확인 — “넷”이라는 수가 무엇을 빠뜨리나.* 이 수는 `startswith("sqlite")`/`sqlite3.Connection`
**두 표기**로 만든 목록이다(계획 0007 §2-b f). 방언을 `engine.dialect.name` 으로 읽거나 예외
타입(`sqlite3.IntegrityError`)으로 가르는 자리는 그 표기 밖이다 — **태웠다**:
`grep -rnE 'dialect\.name|sqlite3\.(Integrity|Operational|Programming)Error' buildtwin/packages
buildtwin/services --include='*.py'` → **히트 0**. 그러므로 이 트리에서 넷은 전수다.

### 2-4. 이 사이클이 postgres 로 돌리는 집합은 `tests/integration` 이다

*근거.* ① CI 의 postgres 서비스 컨테이너는 `integration` 잡에만 있다(`:112`) — 다른 잡에 붙이려면
워크플로가 더 커진다. ② `tests/unit` 은 네 자리가 **테스트 파일 안에서 직접**
`create_engine("sqlite://")` 을 부르므로(계획 0007 §2-b e 의 목록 중
`unit/ingest/test_persistence.py:28` · `unit/ingest/test_document_identity_persistence.py:43` ·
`unit/ingest/test_document_register_reupload.py:28` · `unit/knowledge/conftest.py:17`) conftest 축
하나로 움직이지 않는다(실측 `[SWAP] direct sqlalchemy.create_engine('sqlite...')=15`).
③ `tests/e2e` 는 서브프로세스로 uvicorn 을 띄우므로 환경 전달 경로가 다르다(`e2e/conftest.py:165`).

*역방향 확인 — “통합만”이 무엇을 밖에 두나.* **`tests/unit` 이 postgres 에서 도는 것을 밖에 둔다.**
이 ADR 은 그것이 **가능함을 이미 쟀다**(스왑으로 604 통과) — 못 하는 것이 아니라 **이 사이클에
넣지 않는 것**이고, 넣지 않는 이유는 위 ②(테스트 파일 네 자리를 함께 고쳐야 한다 = `qa` 의 별도 커밋)다.
계획 0009 §후속 16 으로 등록한다.

### 2-5. **“postgres 에서 실제로 돌았다”를 값으로 남긴다** (이 ADR 의 핵심 계약)

> **컨테이너를 띄우고 테스트 한 개만 붙여도 잡은 초록이 되고, §후속 10 은 “닫혔다”고 적을 수 있다.**
> 그것은 이 항목이 겨냥한 결함(조용히 죽는 것)을 **그대로 재생산한다.** 그래서 초록은 증거가 아니다.

`tests/metrics.json` ↔ `tests/metrics.measured.json` 과 **같은 형식**을 쓴다(그 선례는
`tests/regression/test_metrics.py` 이고, 이미 이 저장소가 “조용히 0건이 되는” 실패를 그 형식으로 막는다):

| 파일 | 성격 | 내용 |
|---|---|---|
| `tests/postgres.floor.json` | **커밋된 바닥값** | `{"min_tests_on_postgres": 191}` — 초기값은 이 ADR 의 실측 |
| `tests/postgres.measured.json` | **커밋된 측정값**(드리프트가 diff 로 보이게) | `{"dialect": "...", "server_version": "...", "tests_on_postgres": N, "engines": M}` |

postgres 모드에서 통합 세션이 끝날 때 다음 셋을 **강제**한다:

1. `dialect == "postgresql"` — 아니면 실패. *이 단언이 잡는 것*: conftest 가 환경변수를 못 읽거나
   URL 이 잘못돼 **조용히 sqlite 로 떨어지는 것**. 그것이 §후속 10 의 결함 자신이다.
2. `tests_on_postgres >= min_tests_on_postgres` — 미달이면 실패. *이 단언이 잡는 것*: 테스트 하나만
   붙이고 초록을 부르는 것, 그리고 나중에 누군가 대부분을 sqlite 로 되돌리는 것.
3. sqlite 모드에서는 **아무것도 쓰지 않고 아무것도 단언하지 않는다** — 로컬 개발이 postgres 없이
   그대로 돈다.

*역방향 확인 — 이 값이 “커버리지”인가.* **아니다.** 세는 것은 *그 엔진 위에서 실행된 테스트 수*이고,
그 테스트들이 **postgres 특유의 결함을 잡는지는 재지 않는다.** §5-3 의 677 이 그 구별의 실측이다.
그러므로 이 바닥값의 이름은 커버리지가 아니라 **“조용히 줄어들지 않음”의 감시**다. ADR 은 그
한정을 계약 문장에 함께 싣는다.

*역방향 확인 — 왜 `tests_on_postgres` 이지 `engines` 가 아닌가.* 통합 conftest 의 `client` 픽스처는
**세션 스코프**라 엔진이 하나뿐이다(실측 `[SWAP] engines->postgres=1` for `tests/integration` 단독 실행).
엔진 수를 세면 바닥값이 1 이 되어 “한 개만 붙여도 초록”을 **정확히 통과시킨다** — 세야 하는 것은
그 엔진을 **쓴 테스트의 수**다.

### 2-6. CI 는 통합을 **두 번** 돌린다 (sqlite 한 번, postgres 한 번)

`.github/workflows/buildtwin-ci.yml` 의 `integration` 잡에서:

- `BUILDTWIN_CI_POSTGRES_URL` 을 **잡 레벨 `env` 에서 postgres 스텝의 `env` 로 옮긴다.** 그래야
  sqlite 스텝이 그 이름을 보지 못한다.
- 스텝 둘: `pytest tests/integration -q`(sqlite) + `pytest tests/integration -q`(postgres, 위 env).

*근거.* sqlite 실행을 잃으면 안 된다 — 로컬 개발과 `make test` 의 기본 경로이고, 이 저장소의 여덟
사이클치 실측이 전부 그 값이다. *비용의 실측*: sqlite **32.64s**, postgres **39.40s**(정렬 계수기를
붙인 실행) ~ **73.34s**(첫 실행, 스키마 생성 포함). 잡 timeout 은 30분이다.

*역방향 확인 — “두 번”이 무엇을 밀어내나.* 잡 시간이 는다(위 값). 한 번만 돌리는 두 대안은 각각
더 비싸다: postgres 만 돌리면 **로컬과 CI 가 다른 DB 를 본다**(지금 결함의 거울상), sqlite 만
돌리면 이 ADR 이 아무것도 바꾸지 않는다.

---

## 3. Consequences

**좋아지는 것**

1. `BUILDTWIN_CI_POSTGRES_URL` 이 **읽힌다.** 워크플로 `:130` 의 주석이 처음으로 참이 된다.
2. `db.py:41` 의 `else {}` 갈래, `settings.py:38` 의 `raise` 갈래, `main.py:28` 의 비-sqlite 갈래가
   **CI 에서 매번 실행된다** — 지금은 셋 다 한 번도 실행되지 않았다.
3. §후속 8·9 가 “SQLite 스캔 순서에 우연히 기댄다”고 적은 자리들이 postgres 에서도 실행된다.
   이 ADR 이 그 둘을 미리 쟀다 — §5-2.

**나빠지는 것 / 새로 생기는 부담**

4. `psycopg-binary` 5.3 MB 가 모든 설치에 들어온다(§2-1 역방향).
5. CI `integration` 잡이 통합을 두 번 돈다(§2-6 역방향).
6. **바닥값 파일 둘이 새로 생긴다** — 누군가 유지해야 한다. `tests/metrics.json` 과 같은 부담이고
   같은 소유(`qa`)다.
7. `seed_dev_data` 라는 **플래그가 하나 는다.** 플래그는 “두 갈래가 있고 한 갈래만 실행된다”를
   만드는 장치라 이 저장소가 §후속 10 에서 겪은 것과 같은 종류의 위험을 갖는다. **그래서 이 ADR 은
   그 플래그의 두 갈래를 둘 다 CI 에서 돌린다**(sqlite 스텝 = 꺼진 갈래, postgres 스텝 = 켜진 갈래).

---

## 4. 이 ADR 이 처음으로 잰 것 — 계획 0008 §리스크 2 의 답

### 4-1. postgres 에서 delete + re-insert 는 무정렬 스캔 순서를 **바꾼다**

계획 0008 §1-b-2 는 심기가 SQLite 전용인지 물으며 *“postgres 에는 순서 보장이 없다 — **다만 이것은
추론이고 실측이 아니다**”* 라고 적었고, §리스크 2 는 *“바꾸지 않으면 그 단언이 postgres 잡에서 죽는다”*
를 열린 채로 뒀다. **쟀다:**

```
[PG-before]                 scan = ['R1', 'R2']
[PG-before-plan]            Index Scan using ix_review_requests_kind on review_requests
[PG-after-delete-reinsert]  scan = ['R2', 'R1']        ← 심기가 postgres 에서도 먹는다
[PG-after-update-R2]        scan = ['R2', 'R1']        ← UPDATE 만으로는 안 바뀐다(HOT update)
[PG-fn]  document_mapping_reviews = ['R1', 'R2']       ← 정렬 계약은 지켜진다
[PG-bulk-plan]              Seq Scan on review_requests  (202행 + ANALYZE)
[PG-bulk] first5 = ['R2','R1','X000','X001','X002']    ← 힙 순서 = 물리 순서
```

그리고 그 두 테스트를 **실제로 postgres 위에서 돌렸다**:

| 실행 | 결과 |
|---|---|
| `pytest -p <스왑> tests/unit/progress/test_document_mapping_review_lifecycle.py::test_document_mapping_reviews_orders_by_created_at_not_by_db_scan_order` | **1 passed**(`engines->postgres=1`) |
| `pytest -p <스왑> tests/integration/test_20_mapping_decision_cancel.py` | **14 passed**(`engines->postgres=1`) |
| 위 둘 + `persistence.py:480` 을 `return rows` 로 변이 — **postgres** | **2 failed, 20 passed** |
| 같은 변이 — **sqlite** | **2 failed, 20 passed** (같은 두 이름) |

**결론: 계획 0008 의 심기는 postgres 에서도 먹고, 그 두 테스트는 postgres 에서도 장식이 아니다.**
§리스크 2 가 걱정한 “옳은 죽음”은 일어나지 않는다. 계획 0008 §M-4 1(*“postgres 를 켜 보지 않았다”*)은
**기록물이라 고치지 않는다**(§3-13) — 정정의 자리는 이 ADR 과 계획 0009 다.

### 4-2. UPDATE 는 순서를 바꾸지 않았다 — 한정을 달아 적는다

`[PG-after-update-*]` 두 줄은 UPDATE 뒤에도 스캔 순서가 그대로였다. 그럴듯한 설명은 HOT update
(같은 페이지에 새 튜플 버전을 쓰고 인덱스 엔트리를 유지)이지만 **그 기전을 확인하지 않았다**
(`pg_stat_*` 의 HOT 카운터를 읽지 않았다). 그러므로 이 값은 *“이 배역·이 행 수·이 플래너에서
UPDATE 만으로는 안 바뀌었다”* 까지만 말한다. 계획 0008 §1-b-2 가 *“갱신된 행은 힙에서 자리를 옮길
수 있다”* 라고 적은 것은 **이 측정이 확인하지도 반증하지도 않는다** — “옮길 수 있다”는 가능성 문장이다.

---

## 5. 한정어 역방향 확인 표 (CLAUDE.md §6-3 — 각 칸은 **실행값 또는 코드 인용**이고 다른 절 참조가 아니다)

| 한정어 | 이 단어를 빼면 무엇이 더 들어오나 | 이 단어 때문에 무엇이 빠지나 | 실행값 / 인용 |
|---|---|---|---|
| **“읽는 코드 0건”**(§1-1 b) | `DATABASE_URL` 을 읽는 코드까지 0 이라고 읽힌다 | `BUILDTWIN_CI_POSTGRES_URL` **이라는 이름**에 대해서만 참이다 | `packages/core/db.py:34` `os.environ.get("DATABASE_URL", "sqlite:///./buildtwin.db")` — 일반 경로는 있고 읽힌다 |
| **“A 층 0 실패”**(§1-3) | postgres 가 검증됐다고 읽힌다 | 검증된 것은 **지금 스위트가 통과한다**뿐 | `[ORD] noorder_multirow_exec=677` — 무정렬 다중행 조회가 677회 실행되고 **아무 단언도 그 순서를 보지 않는다**(§5-3) |
| **“분기 넷”**(§2-3) | 방언에 기대는 모든 자리 | `dialect.name`·`sqlite3.*Error` 표기 | `grep -rnE 'dialect\.name\|sqlite3\.(Integrity\|Operational\|Programming)Error' buildtwin/packages buildtwin/services --include='*.py'` → **히트 0** |
| **“조건을 넓힌다”**(§2-3 4, `or`) | 갈아치우기도 “넓히기”로 읽힌다 | 갈아치우면 sqlite 갈래가 죽는다 = 통합 191 + `make dev` | `tests/integration/conftest.py:57-66` 의 `tokens` 픽스처가 `ROLES` 네 역할로 로그인하고 `assert r.status_code == 200` |
| **“통합만”**(§2-4) | 스위트 전체가 postgres 로 간다고 읽힌다 | `tests/unit`(가능함을 쟀다) · `tests/e2e` | 스왑 실행 `tests/unit tests/invariants tests/regression` → **604 passed**. 그래도 이번이 아닌 이유는 직접 엔진 15회 |
| **“191”**(§2-5 바닥값) | 그 수가 커버리지라고 읽힌다 | 그 테스트들이 **postgres 특유의 결함을 잡는가**는 재지 않았다 | `[ORD]` 677 (§5-3) |
| **“두 번 돈다”**(§2-6) | 어느 순서든 상관없다고 읽힌다 | 두 스텝이 **같은 잡**이라 sqlite 실패가 postgres 스텝을 가린다(`set -e`) | `.github/workflows/buildtwin-ci.yml:106-148` 의 `integration` 잡은 스텝을 순서대로 돌린다(`:147-148` 이 지금의 유일한 pytest 스텝) → §Deferred 3 |
| **“PostGIS 없이 선다”**(§1-4) | 앞으로도 필요 없다고 읽힌다 | **오늘 스키마**에 대해서만 참이다 — CLAUDE.md §1 은 공간 쿼리를 위해 PostGIS 를 스택에 둔다 | `psql -tc "select count(*) from pg_available_extensions where name='postgis'"` → **0**, 그런데 `create_all` **24 테이블** 성공 |
| **“저장소 루트”**(§0) | `buildtwin/` 을 루트로 읽으면 `.github/workflows/` 가 통째로 목록 밖이다 | — (좁히면 실제로 놓쳤다 — 계획 0007 §0 의 선례) | 이 문서의 모든 grep 은 `cd /home/user/Bim` 에서 돌렸다 |

*같은 문서의 인접 절과 교차 확인(§6-3).* §1-3 은 A 층을 *“0 실패”* 라 적고 §5-3 은 같은 실행을
*“아무것도 검증하지 않았다”* 로 적는다. 정면 충돌처럼 보여서 **실행으로 갈랐다**: 두 문장은 서로 다른
것을 세고 있다 — 앞은 **실패 수**(0), 뒤는 **순서를 단언하는 조회 수**(0 / 677). 둘 다 참이고, 그
동시성이 §2-5 의 계약이 존재하는 이유다. — 그리고 §2-3 은 `settings.py:38` 을 *“변경 없음”* 으로,
§1-3 B 는 그 분기가 *“죽는다”* 로 적는다. 이것도 갈랐다: 죽는 것이 옳고, 답은 **코드가 아니라 테스트
환경이 시크릿을 주는 것**이다(`[B2-2]`).

---

### 5-3. **초록은 증거가 아니다** — 이 ADR 이 자기 자신에게 §6-2 를 건 자리

CLAUDE.md §6-2 의 물음: *“이 단언의 기대값을, 결함 있는 코드가 그대로 만족하는가?”*
이 사이클의 “단언”은 **postgres 잡이 초록이다** 이고, 답은 **그렇다**이다.

`tests/integration` 을 postgres 위에서 돌리며 실행된 SQL 을 셌다(실행값):

```
[ORD] engines_pg=1  select_exec=12126  noorder_exec=11120  noorder_multirow_exec=677
   236  FROM activity_document_mappings
   170  FROM review_requests
   114  FROM activity_object_mappings
    92  FROM bim_objects
    41  FROM documents
    18  FROM entity_object_mappings
     2  FROM state_transitions
     2  FROM files
     1  FROM activity_relations
     1  FROM activities
```

**`ORDER BY` 없이 2행 이상을 돌려준 조회가 677회 실행되고, 191 테스트가 전부 통과했다.** 즉 그 677회의
순서는 **이 postgres·이 데이터량·이 플래너**에서 우연히 단언이 견디는 순서였을 뿐이고, 어느 단언도
그 순서를 계약으로 붙들고 있지 않다. 통계가 바뀌어 플래너가 다른 접근 경로를 고르면
(§4-1 `[PG-bulk-plan]` 이 200행에서 Index Scan → Seq Scan 으로 바뀌는 것을 보였다) 그중 어느 것이
갈릴지 **아무도 모른다.**

**그러므로 이 ADR 은 §후속 10 을 “postgres 에서 아무 테스트도 돌지 않는다”에 한해 닫고, “정렬을
지정하지 않은 42자리의 순서 계약”은 별도 항목으로 연다**(계획 0009 §후속 17). 두 문장을 하나로
합치는 것이 이 항목이 겨냥한 결함 그 자체다.

---

## 6. Alternatives (기각한 것들)

| # | 대안 | 기각 근거(실행값 또는 코드 인용) |
|---|---|---|
| 1 | **`pyproject.toml` 에 `psycopg` 한 줄만 넣고 끝낸다** | 그것만으로는 **아무 테스트도 postgres 로 가지 않는다** — `tests/integration/conftest.py:35` 가 조건 없이 sqlite 로 덮는다. §후속 10 이 계획 0007 §2-b 에서 이미 기각한 답이다 |
| 2 | **`DATABASE_URL` 을 테스트 축으로 쓴다** | 개발자 `.env` 의 실제 DB 에 `DROP SCHEMA` 가 간다(§2-2 역방향) |
| 3 | **새 이름(`BUILDTWIN_TEST_DATABASE_URL`)을 만든다** | 읽히지 않는 이름이 하나 더 생긴다. §후속 10 의 결함은 “이름이 없다”가 아니라 “있는 이름을 아무도 읽지 않는다”다 |
| 4 | **통합 스텝을 postgres 로 **갈아치운다**(sqlite 실행을 없앤다)** | 로컬(`make test`)과 CI 가 다른 DB 를 보게 된다 — 지금 결함의 거울상. 그리고 여덟 사이클치 실측 기준선(807)이 재현되지 않는다 |
| 5 | **`main.py:28` 조건을 `if settings.seed_dev_data:` 로 갈아치운다** | sqlite 통합 191 + `make dev` 가 전부 죽는다(§2-3 4 역방향) |
| 6 | **`settings.py:38` 의 sqlite 조건을 넓혀 테스트에서 시크릿을 자동 생성한다** | §3-4 를 지키는 안전 장치를 테스트 편의로 넓히는 것이다. 옳은 답은 **테스트가 `JWT_SECRET` 을 주는 것**(`[B2-2]` 가 그 분기가 실제로 무엇을 하는지 보였다) |
| 7 | **`asyncpg` 를 함께 선언한다** | 이 저장소에 비동기 엔진이 0건이다(`grep -rn "create_async_engine" … --exclude-dir=.venv` → `exit=1`) |
| 8 | **CI 서비스 이미지를 `postgis/postgis` → `postgres` 로 가볍게 바꾼다** | 오늘 스키마는 PostGIS 없이 선다(§1-4 실측). 그러나 CLAUDE.md §1 이 PostGIS 를 스택으로 못박았고 공간 인덱스는 ADR 0003 의 Deferred 다 — **이미지를 바꾸는 것은 그 결정을 건드리는 별개의 판단**이라 여기서 하지 않는다. §Deferred 4 |

---

## 7. Deferred — 이 ADR 이 보고 결정하지 않는 것

1. **데모 시드를 앱 기동에서 떼어낸다.** `seed_dev_data` 플래그는 “두 갈래 중 한 갈래만 실행된다”를
   만드는 장치라 §후속 10 이 겪은 것과 같은 종류의 위험을 갖는다. 옳은 답은 시드를 CLI/픽스처로
   옮기는 것이고, 그것은 `make dev`·`make api`·통합 픽스처 셋을 함께 바꾼다.
2. **`tests/unit` 을 postgres 로 돌린다.** 가능함은 쟀다(604 passed). 테스트 파일 네 자리가 직접
   `create_engine("sqlite://")` 을 부르는 것을 함께 고쳐야 한다.
3. **두 통합 스텝이 같은 잡에 있어 앞 스텝의 실패가 뒤를 가린다.** 잡을 나누거나
   `if: always()` 를 붙이는 판단은 `qa` 의 워크플로 설계이고 여기서 정하지 않는다.
4. **CI 이미지 `postgis/postgis:16-3.4` 가 오늘 필요보다 무겁다.** §6 8 참조.
5. **`Dockerfile:5` 의 `|| pip install <긴 목록>` 폴백이 `pyproject.toml` 과 이중 관리된다.**
   본 의존성에 `psycopg[binary]` 가 들어가면 그 목록의 마지막 항목이 중복이 된다. `Dockerfile` ·
   `docker-compose.yml` 은 **CLAUDE.md §2 에 소유가 적혀 있지 않다** — 그 공백 자체가 항목이다.
6. **postgres 에서 `JSON` 컬럼이 `JSONB` 가 아니다.** `orm.py` 의 `JSON` 은 postgres 에서 `json`
   타입으로 선다. 인덱싱·연산자 이점을 얻으려면 `JSONB` 여야 하지만, 그것은 `packages/core/models/`
   의 결정이고 마이그레이션이 없는 지금(create_all 뿐) 별개의 ADR 이 필요하다.
