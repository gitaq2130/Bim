# ADR 0019 — 빈 DB 의 **첫 계정은 명령이 만든다** (열린 엔드포인트가 아니다)

- 상태: Accepted
- 작성: architect
- 날짜: 2026-09-08
- 관련: `docs/adr/0018-the-seed-is-a-command-not-a-side-effect.md` §2-2(이 ADR 이 기대는 명령) ·
  §Alternatives 6 · §Deferred(**이 ADR 이 그 자리를 받는다**),
  `docs/adr/0006-project-membership-and-authorization.md` §4(역할과 멤버십),
  `docs/plans/0014-the-demo-seed-leaves-app-startup.md` §B-2·§B-3(이 물음이 열린 자리) · §후속 67,
  `docs/plans/0015-the-demo-path-opens-the-front-door.md` §1-c·§1-e(이 ADR 의 실측이 나온 계획),
  CLAUDE.md §0(핵심 원칙) · §3-4 · §3-7 · §3-8 · §3-13 · §6-2 · §6-3 · §6-4

---

## 0. 이 문서의 실측이 나온 자리 (재현 방법)

**작업 트리** `/home/user/Bim/buildtwin`, **저장소 루트 `/home/user/Bim`**, 브랜치
`claude/buildtwin-initial-setup-ubulzb`, **HEAD `50ddaa5`**(= `4d06867` + 계획 0015 §0·§A 커밋).
**코드·테스트 트리는 `4d06867` 과 동일하다** — `50ddaa5` 는 `docs/` 만 담는다.

**이 문서의 모든 `파일:줄`·커밋 참조는 그 트리의 것이다**(CLAUDE.md §3-13 첫째 갈래). 예외는 둘:
**㉮ 다른 기록물을 인용하는 줄**(그 자리에서 트리를 적는다) · **㉯ CLAUDE.md 를 가리키는 줄**
(§3-13 둘째 갈래 — 줄 번호가 아니라 **그 자리에서 도는 `grep`** 으로 적는다).

**값 옆에 방법과 N 을 적는다**(§후속 27·34). 이 ADR 이 인용하는 실측은 전부 **N=1** 이고, 재현
명령은 계획 0015 §1-c 의 표에 있다. **PostgreSQL 클러스터를 기동하지 않았고 포트를 하나도 쓰지
않았다. docker 데몬은 이 환경에 없다**(계획 0015 §0) — compose 단정은 전부 `docker compose config`
축이다.

---

## 1. Context

### 1-1. 무엇이 물어졌나

`services/api/auth/router.py` 의 `register` 는 **`users` 테이블이 비어 있으면 인증 없이 호출할 수
있고, 그렇게 만들어진 첫 계정은 `admin` 이 된다.** 계획 0014 §B-2 가 그것을 빈 postgres 에서 값으로
쟀고(**201 · 응답 `role`=`admin`**, 요청은 `"client"` 를 보냈다), 같은 사이클의 `8352814` 가 sqlite
개발 갈래를 **그 자리로 수렴시켰다**(403 → 201). 그 사이클은 **닫지 않기로** 판정했고
(§B-3 — 근거 셋: 대체 경로가 없다 · 커밋 경계가 흐려진다 · 이 사이클이 만든 것이 아니다),
처분을 **§후속 67** 로 열어 두었다.

**두 가지가 그 뒤에 바뀌었다.**

1. **대체 경로가 생겼다.** `6ab9f6a` 가 `python -m services.api.seed` 를 만들었고 `779abd8` 가
   종료 코드 계약을 붙였다(ADR 0018 §2-2·§9-2). §B-3 의 첫째 근거 — *"닫으려면 대체 경로가 있어야
   한다"* — 가 **같은 사이클의 산출물로 사라졌다.**
2. **그 구멍이 in-process 가 아니라 실제 네트워크 소켓에서 열린다는 것이 측정됐다.** `reviewer` 가
   `uvicorn --host 0.0.0.0` + 빈 sqlite + 포트 55437 로 띄우고 **비-루프백 주소 `192.0.2.2` 에서**
   `Authorization` 없는 `POST /api/auth/register` 를 쳐 **201 · `role=admin`** 을 받았다.
   **나는 이 값을 재현하지 않았다**(계획 0015 §확인하지 않은 것 56).

### 1-2. 오늘의 기전 (코드 인용)

```python
# services/api/auth/router.py
def register(body: RegisterRequest, session: Session = Depends(get_session),
             user: CurrentUser | None = Depends(get_optional_user)) -> UserView:
    """admin 전용. 단, users 테이블이 비어 있으면 누구나 호출 가능하고 첫 사용자는 admin 이 된다(부트스트랩)."""
    bootstrap = users_count(session) == 0
    if not bootstrap and (user is None or user.role != "admin"):
        raise Forbidden("admin role required to register users", code="forbidden_role")
    ...
    role = "admin" if bootstrap else body.role
```

**인용 · 발췌.** 그 자리에서 도는 참조: `grep -n "bootstrap = users_count" services/api/auth/router.py`.

**이것은 사고가 아니라 문서화된 설계다** — `services/api/README.md` 가 같은 말을 한다
(`grep -n "첫 사용자는" services/api/README.md`). **그래서 이 ADR 이 필요하다**: 코드를 고치는 것이
아니라 **약속을 바꾸는** 일이고, CLAUDE.md 는 *"이 문서와 충돌하는 결정은 반드시 `docs/adr/`에
ADR로 남겨야 유효하다"* 고 적는다(`grep -n "ADR로 남겨야 유효하다" CLAUDE.md`).

### 1-3. 이 자리가 무거운 이유와, 무겁지 **않은** 축

**무거운 축.** 인증 없는 요청 하나가 도달하는 최종 상태가 **`role=admin`** 이다. 그리고 그 계정은
CLAUDE.md §3-8 이 못박은 자리와 **인접**해 있다 — `admin` 은 확정·검측 승인 권한이 없지만
(ADR 0006 §4-1), 프로젝트·사용자 관리 권한이 있어 **`cm` 계정을 만들 수 있다.**
즉 `admin` 은 `cm` 으로 가는 **한 걸음**이고, `cm` 은 `CONFIRMED` 로 가는 유일한 actor 다(§3-8).

**무겁지 않은 축 — 계획 0014 §B-3 의 판정을 뒤집지 않는다.** 이 자리는 **판정 경로가 아니라 인증
부트스트랩**이다. §B-3 이 「지금 닫지 않는다」로 간 것은 그 구분 때문이었고, 그 구분은 여전히 옳다.
**바뀐 것은 구분이 아니라 근거 1(대체 경로)** 이다. 이 ADR 은 §B-3 을 **반박하지 않고 그 조건을
성립시킨다.**

---

## 2. Decision

### 2-1. 결정 1 — **`POST /api/auth/register` 는 언제나 admin 인증을 요구한다**

`users_count(session) == 0` 갈래를 없앤다. 빈 DB 에서 `Authorization` 없는 register 는
**403 `forbidden_role`** 이다. 요청이 보낸 `role` 을 서버가 덮어쓰는 자리도 함께 없어진다
(`role = "admin" if bootstrap else body.role` → `body.role`).

**그래서 빈 DB 로 앱을 띄우면 아무도 로그인할 수 없다. 그것이 이 결정의 의도된 상태다** —
「누구든 첫 요청으로 admin 이 된다」보다 낫다는 판단이고, 다음 결정이 그 상태를 벗어나는 경로를
정한다.

### 2-2. 결정 2 — **첫 계정은 `python -m services.api.seed` 가 만든다**

빈 DB 에 계정을 만드는 경로는 **그 명령 하나**다. 그 명령은 **프로세스·파일시스템 접근**을 요구한다 —
즉 그 DB 를 운영하는 사람만 부를 수 있고, **네트워크에서 부를 수 없다.** 이것이 열린 엔드포인트와
다른 유일한 점이자 전부다.

**계약은 ADR 0018 §9-2 가 정본이다**(rc=0 이면 데모 계정 넷과 데모 프로젝트 멤버십 셋이 그 DB 에서
성립한다). 이 ADR 은 그 계약을 **넓히지 않는다** — 특히 *"비어 있지 않은 DB 에는 아무것도 만들지
않는다"*(그 명령의 `users_count(session) > 0` 무동작 갈래)를 그대로 둔다.

### 2-3. 결정 3 — **데모 스택의 시크릿은 `.env` 가 지고, 그 파일은 명령이 만든다**

`make dev` 스택은 `DATABASE_URL` 이 postgres 라 `settings.resolve_jwt_secret()` 의 **거부 갈래**에
걸린다(실측 N=1: `RuntimeError: JWT_SECRET 환경변수가 필요합니다 (.env)`). 그러므로 결정 1·2 만으로는
데모가 서지 않는다 — 계정을 만들어도 **토큰을 발급할 수 없다.**

- `.env` 는 **커밋되지 않는다**(`.gitignore:1`). 그러므로 저장소는 그 파일을 **가질 수 없고**
  **만들 수는 있다.**
- 그 파일을 만드는 명령이 `JWT_SECRET` 을 **난수**로 채운다. **코드·YAML·문서에 상수로 두지
  않는다**(CLAUDE.md §3-4 — `grep -n "외부 API 키·시크릿은" CLAUDE.md`).
- **이미 있는 `.env` 는 한 바이트도 바꾸지 않는다.**

**`resolve_jwt_secret` 의 sqlite 완화 갈래는 낮추지 않는다.** 낮추면 「개발 편의를 위해 시크릿 요구를
줄인다」가 되어 §3-4 와 부딪친다. 처방은 요구를 낮추는 것이 아니라 **요구를 충족시키는 것**이다.

### 2-4. 이 ADR 이 **보장하지 않는** 것

- **비어 있지 않은 DB 의 안전을 보장하지 않는다.** 결정 1 은 `users` 가 빈 순간만 바꾼다.
- **운영 배포의 첫 계정 절차를 정하지 않는다.** MVP 의 대상은 `make dev`·`make api` 두 갈래다.
  운영에서 「누가 그 명령을 부를 수 있는가」는 §7 Deferred 1.
- **비밀번호를 숨기지 않는다.** `DEV_SEED_PASSWORD` 는 문서화된 개발 상수다(ADR 0018 그대로).

---

## 3. 구현의 모양은 소유자(`api`·`qa`)의 판단이다 — 요구되는 것은 **완료 조건**

계획 0015 §작업 6·7 의 완료 조건 상자가 그것이고, 여기 이름만 옮긴다(**재서술 · 발췌**):

1. 빈 DB · 인증 없는 register → **403 `forbidden_role`**, 그리고 그 뒤에도 `users` **0행**.
2. **양성을 함께 단언한다**(§6-2 4): 같은 빈 DB 에 시드 명령 → rc **0** → 로그인 **200**.
   **닫힘만 단언하면 「스택이 죽었다」와 구별되지 않는다.**
3. **뒤집는 변이에서 값이 갈린다**: 부트스트랩 갈래를 되살리면 무엇이 몇 개 빨개지는가.
4. **문구를 이 사이클이 고친다**(§6-4 1): `services/api/README.md` 와 `router.py` docstring 의
   부트스트랩 서술은 결정 1 뒤 **거짓**이다.

---

## 4. Consequences

**얻는 것.** ① 인증 없는 요청이 도달할 수 있는 최고 권한이 없어진다. ② 「계정이 없는 DB」의 상태가
**명시적 실패**(403 · 로그인 401)가 되어, 사람이 다음에 무엇을 해야 하는지가 한 가지로 좁혀진다.
③ **e2e 의 시드 창이 무해해진다** — 계획 0014 작업 4 가 순서로 피하던 창(`_wait_http` 반환과 시드
완료 사이)에서 register 가 403 이므로, **순서를 규약으로 붙들 필요가 없어진다.** 이것이 리뷰어가
「작업 순서 규약」을 기각한 자리의 구조적 답이다.

**잃는 것.** ① 빈 DB 에 대해 **네트워크만으로** 할 수 있는 일이 없어진다 — 원격 배포에 셸이 없으면
계정을 만들 수 없다(§7 Deferred 1). ② `tests/integration/test_00_seed_boundary.py` 가 **오늘의 값을
계약으로** 붙들고 있으므로 그 파일이 바뀐다 — **그것이 이 결정의 관측 가능성이 옮겨 가는 자리**이고,
계획 0015 §후속 72 의 조항이 정확히 그 이동을 요구한다.

**바뀌지 않는 것.** ADR 0018 의 시드 계약 · ADR 0006 의 역할·멤버십 규칙 · §3-8 의 `actor == cm`
게이트 · 통합/e2e 픽스처의 명시 시드 배선.

---

## 5. 한정어 역방향 확인 표 (CLAUDE.md §6-3 — 각 칸은 **실행값 또는 코드 인용**이고 다른 절 참조가 아니다)

| 한정어·조건 | 빼면 무엇이 더 들어오는가 | 넣으면 무엇이 빠지는가 | 가른 값 |
|---|---|---|---|
| 결정 1 의 **「언제나」** | `users` 가 빈 순간만 좁히는 다른 조건(호출 주소·최초 1회·시간 창)이 들어온다 | **주소·시간으로 좁히는 처방이 전부 빠진다** | 리뷰어 실측: 비-루프백 `192.0.2.2` 에서 **201**. 주소로 좁히는 처방은 **compose 의 publish 설정에 기대는데**, 그 설정은 `e1e1a1a` 가 이미 루프백으로 묶었는데도 앱 자신은 `0.0.0.0` 에서 듣는다(`docker-compose.yml` 의 `api.command`, **인용 · 발췌**) — **배포 방식이 바뀌면 되돌아온다** |
| 결정 2 의 **「명령」** | 「엔드포인트 + 일회용 토큰」이 들어온다 | **토큰을 발급·전달·폐기하는 기구 전부** | 그 기구는 오늘 저장소에 **없다**(`git grep -nI "one.time\|일회용" -- services/` → 히트 0, N=1). 없는 기구를 ADR 로 약속하면 §6-4 가 이름 붙인 「미룬 판단이 한 사이클도 버티지 못한다」가 된다 |
| 결정 3 의 **「명령이 만든다」** | `env_file: [{path: .env, required: false}]` 한 줄이 들어온다 | **문 2 가 남는다** | 사본 실측 N=1: `required: false` + `.env` 없음 → `docker compose config` **rc=0**. 그러나 `JWT_SECRET` 은 여전히 비고 `resolve_jwt_secret()` 은 그대로 **RuntimeError** — **실패가 「기동 전」에서 「로그인」으로 밀린다.** 이 저장소의 지배적 실패 모드가 그쪽이다 |
| 「빈 DB」를 **`users` 0행**으로 읽는 것 | 「데모 계정이 없다」·「admin 이 없다」로 읽는 갈래가 들어온다 | **그 두 갈래가 빠진다 — 그리고 그것이 옳다** | 시드 명령이 이미 그 구분 위에 서 있다: 데모가 아닌 계정 하나가 있는 DB 에 부르면 `nothing to seed: users=1` 을 찍고 **rc=0** 인데 데모 계정은 0개다(ADR 0018 §9-2 가 그 때문에 rc 로 계약을 갈랐다) |

### 같은 사이클의 문서·코드와 교차 확인 (§6-3 11회차 — **갈리지 않은 칸도 적는다**)

| 값 | 이 ADR | 계획 0015 | 저장소 | 갈리는가 |
|---|---|---|---|---|
| 빈 DB · 인증 없는 register 의 **오늘** 값 | 201 · `role=admin` | §1-c 정문 행 | `tests/integration/test_00_seed_boundary.py` 의 단언 | 아니오 |
| 닫은 뒤의 값 | **403 `forbidden_role`** | 작업 6 조건 1 | (아직 없다) | 아니오 |
| compose 의 postgres URL 에서 JWT | **RuntimeError** | §1-c 문 2 | `packages/core/settings.py:45` | 아니오 |
| `required: false` 단독의 결과 | `config` rc=0 · 문 2 잔존 | §1-e 첫째 행 | — | 아니오 |
| 대체 경로의 이름 | `python -m services.api.seed` | 작업 3·6 | `Makefile:22` · `services/api/seed.py` | 아니오 |

---

## 6. Alternatives (기각한 것들)

| # | 대안 | 기각 근거 |
|---|---|---|
| 1 | **현상 유지 + 문서로 경고** | 「놓칠 수 있다」고 적는 것은 커버리지가 아니다(CLAUDE.md §6-1). 오늘 저장소가 이미 그렇게 적고 있고, 그 상태에서 리뷰어가 비-루프백에서 201 을 받았다 |
| 2 | **환경변수 게이트**(`ALLOW_BOOTSTRAP_REGISTER=1`) | 사이클 0014 가 **막 지운** `settings.seed_dev_data` 와 같은 모양이다(ADR 0018 §2-3). 플래그는 「꺼져 있다」를 아무도 확인하지 않는 자리를 하나 더 만든다 |
| 3 | **일회용 토큰**(기동 시 stdout 에 1회 출력) | 그 기구가 저장소에 없다(§5 둘째 행, 히트 0). 발급·전달·폐기·재기동 시 무효화까지가 딸리고, **그 전부가 이 사이클의 크기를 넘는다.** §7 Deferred 2 로 남긴다 |
| 4 | **호출 주소로 좁힌다**(루프백에서만 부트스트랩) | 앱은 `0.0.0.0` 에서 듣고 프록시 뒤에서는 원격 주소가 루프백으로 보일 수 있다. **배포 방식에 기대는 안전 장치**이고, §5 첫째 행이 그것을 값으로 적는다 |
| 5 | **데모 계정을 아예 없앤다**(ADR 0018 §Alternatives 6) | 그 ADR 이 이미 기각했다 — 개발 플로우가 길어지고 `tests/integration` 의 `tokens` 픽스처가 세션마다 계정을 만들어야 한다. **이 ADR 은 그 판정을 뒤집지 않는다** |
| 6 | **`.env` 를 커밋한다** | CLAUDE.md §3-4 정면 위반 |

---

## 7. Deferred — 이 ADR 이 보고 결정하지 않는 것

1. **운영 배포의 첫 계정.** 셸 없는 배포(PaaS·매니지드 컨테이너)에서 「명령을 부를 수 있는 사람」이
   누구인지는 MVP 밖이다. **이 ADR 은 그 경우 계정 생성 경로가 없다고 적는다** — 모르는 값을
   모른다고 적고 폴백을 두지 않는다(§6-4 2).
2. **일회용 토큰 기구.** 위 Alternatives 3. 열려면 발급·전달·폐기·재기동 무효화 넷이 함께 정해져야 한다.
3. **`resolve_jwt_secret` 의 축이 옳은가.** 「sqlite 인가」가 「개발인가」의 대리 변수다.
   명시적 환경 축(`APP_ENV`)이 더 옳은지는 이 ADR 이 묻지 않았다(계획 0015 §Deferred).
4. **`admin` → `cm` 한 걸음.** §1-3 이 그 인접을 적었지만, **`admin` 이 만들 수 있는 역할의 집합을
   좁힐지**는 ADR 0006 의 물음이고 여기서 답하지 않는다.

---

## 8. 이 ADR 이 거짓으로 만드는 문구 — **같은 사이클이 고친다** (§6-4 1)

| 자리 | 오늘 무엇을 말하는가 | 결정 1 뒤 |
|---|---|---|
| `services/api/auth/router.py` register docstring | *"admin 전용. 단, users 테이블이 비어 있으면 누구나 호출 가능하고 첫 사용자는 admin 이 된다(부트스트랩)."*(**인용 · 전체**) | **거짓** — 작업 6 이 고친다 |
| `services/api/README.md` | *"그 DB 의 첫 사용자는 `POST /api/auth/register`(`users` 가 비어 있으면 누구나 호출 가능, 첫 사용자는 admin …)로 만든다"*(**인용 · 발췌**) | **거짓** — 작업 6 이 고친다 |
| 루트 `README.md` | *"시드하지 않은 빈 DB 로 API 를 띄우면 계정이 하나도 없고, 그때 `POST /api/auth/register` 는 인증 없이도 첫 계정을 만든다"*(**인용 · 발췌**) | **거짓** — 작업 5 가 고친다(소유 없는 파일, 배정) |
| `docker-compose.yml` 머리 주석 | *"api 의 POST /api/auth/register 는 users 가 비면 인증 없이 admin 을 만든다"*(**인용 · 발췌**) | **거짓** — 작업 5 가 고친다 |
| `tests/integration/test_00_seed_boundary.py` | **201 · `role=admin`** 을 계약으로 붙든다 | **계약이 바뀐다** — 작업 7 이 옮긴다(계획 0015 §후속 72) |

*이 목록의 생성 기준(§6-1 ①)*: 루트
`git grep -nIE "부트스트랩|bootstrap|users_count|첫 사용자|first user|forbidden_role" -- . ':!docs/plans' ':!docs/adr'`
에서 **각 히트를 읽었다**(수가 아니라 히트를).
*② 이 기준이 놓치는 것*: ⓐ `forbidden_role` 을 쓰지 않고 403 을 말하는 자리 ⓑ **영어 산문**
(`first admin`·`initial setup`) ⓒ **보간**(f-문자열로 조립하는 자리 — 그 문자열이 소스에 없다).
**셋 다 재지 않았다** — 계획 0014 §확인하지 않은 것 **53** 이 그 번호이고 이 ADR 도 닫지 않는다.
*③ 블라인드 스팟 태우기*: ⓐ 를 태웠다 — `git grep -nI "403" -- services/ apps/ | grep -v forbidden_role`
가 **26줄**을 내고 **각 줄을 읽었다**. 전부 역할 가드·404 대 403 의 구분·화면 문구이고,
**부트스트랩을 말하는 자리는 없었다**(N=1). **결과가 0 이었다는 사실이 기준을 정당화하지
않는다**(§6-1) — ⓑⓒ 는 그대로 열린 채다.
