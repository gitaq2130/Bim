# ADR 0010 — 클라이언트 서버상태 캐시의 **범위**와 **수명**

- 상태: Accepted
- 작성: architect
- 날짜: 2026-09-04
- 관련: ADR 0005(객체 키 프로젝트 범위화), ADR 0006(프로젝트 멤버십·인가 — **§3 규칙 2 가 이 ADR 의
  세션 경계 규칙이 지키려는 것**), ADR 0007 §2-3·13차 리뷰(`documentsRoot` 접두사 도입), ADR 0008 §5(readiness
  키 프로젝트 범위화 + `activitiesRoot`), `docs/plans/0001-mvp-build.md` 백로그 3건
- 대체하지 않음: ADR 0005·0007·0008 의 키 결정은 그대로 유효하다. 이 ADR 은 그 셋이 각각 한 번씩 만든
  **같은 모양의 결함**을 하나의 불변식으로 묶는다.

---

## Context

### 1. 한 문장으로

TanStack Query 캐시의 한 항목이 유효한 범위는 **(사용자 세션, 프로젝트)** 두 축이다. 지금 이 저장소는
**두 축 모두를 호출부의 성실성에 맡기고 있다** — 뮤테이션마다 손으로 적은 무효화 접두사가 프로젝트 축을,
`logout()` 호출 지점마다의 기억이 세션 축을 담당한다. 두 축 모두에서 이미 결함이 관측됐고, 셋 다
**예외 없음 · 테스트 전원 통과 · 화면 정상**이라는 이 저장소의 지배적 실패 모드(CLAUDE.md §6)를 그대로 따른다.

### 2. 세션 축 — 실측: 다른 계정으로 로그인하면 이전 사용자의 프로젝트가 화면에 뜬다

`apps/web/src/store/index.ts:103` 의 `logout()` 은 토큰·역할·userId 와 localStorage 만 지우고 QueryClient
(`apps/web/src/main.tsx:8`, 앱 수명 동안 하나)는 손대지 않는다. 실제 `<App/>` 을 렌더해 A→로그아웃→B 를
태웠다(2026-09-04, 운영과 같은 `staleTime: 10_000`. 서버 모형: A 는 PA 멤버, B 는 아무 프로젝트도 없고
`GET /projects/PA` 는 ADR 0006 대로 404 `project_not_found`).

```
[A] 화면: A사 물류센터
[A] 캐시 projects: [{"project_id":"PA","name":"A사 물류센터","created_at":"2026-01-01"}]

[로그아웃 직후] localStorage: null
[로그아웃 직후] auth 스토어 token: null
[로그아웃 직후] 캐시 엔트리 수: 2
[로그아웃 직후] 캐시 projects: [{"project_id":"PA","name":"A사 물류센터", ...}]   ← 그대로 있다

>>> [B 로그인 직후] 이전 사용자 프로젝트가 화면에 보이는가: true
>>> [B] 화면 본문: A사 물류센터PA · 2026. 01. 01. AM 12:00업로드뷰어주간요약
>>> [B, 200ms 후] 여전히 보이는가: true
```

**ADR 0006 §3 규칙 2 와 정면으로 어긋난다.** 그 규칙이 비멤버에게 403 이 아니라 404
`project_not_found` 를 주는 유일한 이유는 "존재하는 프로젝트와 없는 프로젝트가 구별 불가능해야
열거 공격이 막힌다"는 것이다. 서버가 존재조차 숨기는 동안 **화면이 프로젝트 id·이름·생성일을 그대로
보여주고, 그 프로젝트로 들어가는 링크 셋을 렌더한다.**

같은 경로로 인가 가드까지 우회된다. `RequireProjectAccess`(`components/RequireProjectAccess.tsx:20`)는
`useProject(id)` 의 결과로 멤버십을 판정하는데, 그 쿼리는 **A 세션이 채운 캐시**를 그대로 읽는다.

```
[로그아웃 후] projects/PA 캐시: {"project_id":"PA","name":"A사 물류센터","my_role":"cm"}
>>> [B] RequireProjectAccess 가 막았는가: false        (1.6초 뒤에도 false)
>>> [B] 헤더/본문: BuildTwin업로드2D|3D 뷰문서관리대장검토요청주간요약userB (CM)로그아웃…
```

B 는 PA 의 프로젝트 셸 안에 들어가 있고, 화면은 그를 **`my_role: "cm"`** 으로 취급한다(A 의 역할이다).
서버가 모든 후속 요청을 404 로 막으므로 **쓰기는 일어나지 않는다** — 새는 것은 데이터 접근이 아니라
**존재와 역할이라는 사실 그 자체**이며, ADR 0006 이 숨기기로 한 것이 정확히 그것이다.

호출 지점은 둘이다: 사용자가 누르는 로그아웃(`components/AppLayout.tsx:60`)과 401 응답 시 자동
로그아웃(`api/client.ts:156`). **둘 다 같은 `logout()` 을 부르므로 결함도 하나다 — 그러나 고칠 곳을
호출 지점에 두면 셋째 호출 지점이 생기는 날 같은 사고가 다시 난다.**

#### 2-1. `staleTime: 10_000` 이 이것을 유계로 만들어 주지 않는다

`docs/plans/0001-mvp-build.md` 는 이 결함을 "`staleTime: 10_000` 이라 **10초 동안** 이전 사용자의 …
그려질 수 있다"고 적었다. 그 한정어를 태웠다: staleTime 을 50ms 로 낮춰 놓고 화면을 **마운트한 채로**
staleTime 의 2·8·20·40배를 기다렸다.

```
  t=100ms  (staleTime 의 2배)  | /projects 요청 누계: 2 (로그인 직후 2)
  t=400ms  (8배)               | /projects 요청 누계: 2
  t=1000ms (20배)              | /projects 요청 누계: 2
  t=2000ms (40배)              | /projects 요청 누계: 2
```

> **§2 와 어긋나 보이는 것을 미리 가른다(§6-3 인접 절 교차 확인).** 이 실험에서는 B 로그인 시점에
> A 의 항목이 **이미 stale** 하므로(staleTime 50ms) 라우트 이동에 따른 마운트가 재요청을 일으켜
> A 데이터가 보이지 않는다 — §2 의 `보임: true` 와 반대다. 두 값은 모순이 아니라 **같은 규칙의 두
> 경우**다: 판정을 가르는 것은 경과 시간이 아니라 **"다음 재요청 계기가 왔을 때 그 항목이 fresh 였는가"**
> 다. 이 실험이 고정하는 것은 그중 **계기가 오지 않는 구간**이다(아래 요청 누계 2→2).

**마운트된 쿼리는 stale 이 됐다는 이유만으로 스스로 재요청하지 않는다.** staleTime 은 "다음 재요청
계기(마운트·window focus·재연결)가 왔을 때 실제로 다시 받아올지"만 정한다. 따라서 노출 창은
"10초"가 아니라 **"다음 재요청 계기가 올 때까지"** 이고, 계기가 없으면 화면에 그대로 남는다.
가드(`RequireProjectAccess`)는 한술 더 떠 **마운트 시점 한 번의 판정**이므로, 그 순간 캐시가 fresh 하면
그 뒤의 만료는 판정을 뒤집지 못한다.

### 3. 프로젝트 축 — 실측: 같은 화면의 두 창이 서로 다른 상태를 말한다

저장소 루트에서 캐시를 건드리는 모든 자리를 먼저 모았다(`grep -rn "invalidateQueries\|setQueryData\|
removeQueries\|resetQueries\|qc\.clear" .`, 추적 파일 기준 21곳 — `apps/web/src/api/hooks.ts` 20,
`apps/web/src/pages/UploadPage.tsx` 1). 그 무효화 접두사 전부와 `queryKeys` 의 키 전부를 실제
`partialMatchKey` 에 통과시킨 행렬이다(2026-09-04 실행값).

```
== useTransition:objectDetail        ["objects","p1","G1"]
   HIT : objectDetail
== useTransition:['projects']        ["projects"]
   HIT : projects, project, objects(list), objects(list,q), objects(all), models, drawings, scans,
         reviews, members, documents(list), document, readiness, startable, weeklySummary
== useCreateDailyReport:['projects',pid]   ["projects","p1"]        (UploadPage 도 같은 접두사)
   HIT : project, objects(list), objects(list,q), objects(all), models, drawings, scans, reviews,
         members, documents(list), document, readiness, startable, weeklySummary
== useResolveReview:['objects']      ["objects"]
   HIT : objectDetail                                               ← 목록은 하나도 안 걸린다
```

원인은 **`objectDetail` 만 자기 프로젝트 아래에 뿌리내리고 있지 않다**는 것이다.

```
   objects(list)   = ["projects","p1","objects",{}]
   objects(all)    = ["projects","p1","objects",{},"all"]
   objectDetail    = ["objects","p1","G1"]        ← 저장소에서 유일하게 ["projects", pid, …] 로 시작하지 않는
                                                    프로젝트 범위 키
```

그래서 결함이 **두 방향으로 하나씩** 생겼다. 둘 다 실제 훅으로 태웠다(운영과 같은 QueryClient 설정).

| 뮤테이션 | 서버가 실제로 바꾸는 것 | 무효화 접두사 | 실측 결과 |
|---|---|---|---|
| `useResolveReview`(`hooks.ts:378`) | `kind=="inspection"` 승인 → `transition_with_effects(… CONFIRMED)` (`services/api/usecases.py:436-441`) | `["objects"]` | 목록 재요청 **없음**(1→1). 화면 목록 `INSPECTION_REQUESTED` / 상세 `CONFIRMED` / 서버 `CONFIRMED` |
| `useCreateDailyReport`(`hooks.ts:340`) | `apply_daily_report` 가 상태 전이를 만든다(`services/api/usecases.py:251`) | `["projects", pid]` | 상세 재요청 **없음**(1→1). 화면 목록 `REPORTED` / 상세 `PLANNED` / 서버 `REPORTED` |

`ViewerPage` 는 `useAllObjects`(3D 색칠)와 `ObjectDetailPanel`(`useObjectDetail`)을 **같은 화면에**
띄운다(`pages/ViewerPage.tsx:47`, `:269`). 즉 증상은 "잠깐 낡은 값"이 아니라 **한 화면의 두 창이 같은
객체에 대해 서로 다른 상태를 말하는 것**이고, 방향만 반대인 채 두 뮤테이션에서 각각 일어난다.

> **`useCreateDailyReport` 는 안전하다는 판정이 왜 틀렸는가(§6-1).** 이 백로그를 정리한 최초 기준은
> "무효화 접두사가 **목록 키**를 덮는가"였다. 그 기준은 `["projects", pid]` 를 통과시킨다 — 목록은
> 덮으니까. 기준이 **상세 방향을 볼 수 있는 칸을 갖고 있지 않았다.** 경로가 아니라 **저장소 루트에서
> 모든 무효화 × 모든 키의 곱**을 만들었더니 반대 방향 결함이 그 자리에서 드러났다.

### 4. ADR 0007 의 해법(`documentsRoot`)은 **여기에 듣지 않는다**

문서 쪽 함정과 모양이 같아 보이지만 아니다. 문서는 목록과 상세가 **이미 같은 접두사 아래** 있었고
(`["projects",pid,"documents",{}]` vs `["projects",pid,"documents","DOC-1"]`), 13차 리뷰가 한 일은
그 공통 접두사에 이름을 붙인 것뿐이다. 객체는 **공통 접두사가 존재하지 않는다.** 네 안을 같은
행렬에 태웠다(2026-09-04).

| 안 | `objectDetail` | `['projects']` | `['projects',pid]` | `objectsRoot` | `['objects']` |
|---|---|---|---|---|---|
| 현행 | `["objects",p1,G1]` | 목록O 상세**X** | 목록O 상세**X** | 목록O 상세**X** | 목록X 상세O |
| A: `objectsRoot` 접두사만 도입(ADR 0007 모양) | `["objects",p1,G1]` | 목록O 상세**X** | 목록O 상세**X** | 목록O 상세**X** | 목록X 상세O |
| B: 목록 키에서 질의 객체를 마지막에 두지 않음 | `["objects",p1,G1]` | 목록O 상세**X** | 목록O 상세**X** | 목록O 상세**X** | 목록X 상세O |
| **C: `objectDetail` 재루팅(채택)** | `["projects",p1,"objects",G1]` | 목록O 상세**O** | 목록O 상세**O** | 목록O 상세**O** | **아무것도 안 걸림** |

A 와 B 는 **현행과 한 칸도 다르지 않다.** 질의 객체 `{}` 는 이 결함의 원인이 아니었다 — 원인은
상세 키의 **뿌리**다. 그리고 C 를 택하면 `["objects"]` 리터럴이 **무엇에도 걸리지 않게 되므로**,
키를 옮기면서 `hooks.ts:378` 을 함께 고치지 않으면 무효화가 **완전한 무동작**이 된다(§6-3 "조건을
바꾸면 그 결과를 소비하는 게이트도 같은 PR 에서 확인한다").

### 5. 기존 테스트는 이 셋 중 어느 것도 구별하지 못한다

`git archive` 로 뜬 별도 트리에서 vitest 전량을 세 번 돌렸다(2026-09-04).

| 코드 상태 | vitest |
|---|---|
| 현행(결함 있음) | 26 files / **233 passed** |
| C 적용 + `hooks.ts:378` 을 `objectsRoot` 로 교체(옳은 고침) | 26 files / **233 passed** |
| C 적용 + `hooks.ts:378` 을 `["objects"]` 로 남김(**무효화가 완전 무동작**) | 26 files / **233 passed** |

세 번째 줄이 이 ADR 의 검증 요구가 무엇이어야 하는지 정한다: 지금 있는 233건은 **오늘의 결함보다
더 나쁜 상태도 초록으로 통과시킨다**(CLAUDE.md §6-2).

---

## Decision

**캐시 항목의 유효 범위는 (사용자 세션, 프로젝트)이고, 두 경계 모두 호출부가 아니라 구조가 강제한다.**

### 규칙 1 — 프로젝트 범위 캐시 키는 모두 `["projects", project_id, …]` 로 **시작한다**

- `queryKeys.objectDetail(pid, gid)` 를 `["projects", pid, "objects", gid]` 로 옮긴다.
  ADR 0005 가 정한 `(project_id, global_id)` 복합 키 성질은 그대로다 — 순서만 바뀐다.
- `queryKeys.objectsRoot(pid) = ["projects", pid, "objects"]` 를 추가한다(`documentsRoot`·`activitiesRoot`
  와 같은 자리). 목록·`"all"` 변종·상세를 **한 접두사로** 덮는 유일한 키다.
- `hooks.ts:378` 의 `["objects"]` 리터럴을 `queryKeys.objectsRoot(projectId)` 로 바꾼다.
  **이 두 변경은 분리 머지하지 않는다**(§4 마지막 문단: 하나만 하면 무동작이 된다).
- 앞으로 프로젝트 범위 자원의 키는 팩토리 밖에서 배열 리터럴로 적지 않는다.

*역방향 확인 — "프로젝트 범위"라는 한정어.*
- **이 단어를 빼면 무엇이 더 들어오는가**: 대리키 라우트의 캐시 4종 —
  `job(jobId)`·`drawingEntities(did)`·`drawingMappings(did)`·`planSection(mid,level)`·`scanVerdicts(sid)`.
  이들은 URL 에 `project_id` 가 없는 자원(ADR 0006 규칙 6 "대리키 라우트")이라 프로젝트 접두사를
  붙일 수 없다. 그래서 규칙 1 밖이다.
- **이 단어 때문에 무엇이 빠지는가 — 그리고 그 자리에 실제 결함이 있다.** 위 §3 행렬에서
  `drawings/…`·`scans/…`·`models/…` 로 시작하는 다섯 키는 **어떤 무효화 접두사에도 걸리지 않는다.**
  그중 `drawingMappings(did)` 는 저장소 전체에서 **무효화하는 곳이 0곳**인데
  (`git grep -n "drawingMappings" -- apps/web/src ':!*test*'` → 정의 1 · 조회 1, 무효화 0),
  `useResolveReview` 의 `kind=="mapping"` 승인·반려가 `resolve_mapping_review`
  (`services/api/usecases.py:468`)로 **바로 그 매핑 행을 바꾼다.** `ViewerPage` 는 그 결과를
  2D↔3D 브로커에 먹인다 — 즉 CM 이 매핑 검토를 처리한 직후 뷰어의 2D↔3D 연결이 낡은 채로 남는다.
  **규칙 1 은 이것을 고치지 못한다**(접두사가 없으니까). 규칙 4 로 따로 적는다.
- **옛 조건(`["objects"]`)이 잡던 것**: 상세 키 하나. 규칙 1 의 `objectsRoot` 는 그것을 포함해 잡는다
  (§4 표 C행 "상세 O"). 잃는 것은 없다.

### 규칙 2 — 세션 경계에서 캐시를 폐기한다. 트리거는 **호출 지점이 아니라 `auth.userId` 의 변화**다

`logout()` 안에서 QueryClient 를 부르지 않는다(Zustand 슬라이스가 React Query 에 의존하게 되고,
테스트가 만드는 QueryClient 와 앱 싱글턴이 어긋나 **테스트가 진짜 경로를 안 타게 된다**). 호출
지점에서 나란히 부르지도 않는다(호출 지점이 늘 때마다 같은 실수가 반복된다 — 이 저장소가 반복한
실패의 모양이다).

대신 **`auth.userId` 가 바뀌는 것 자체를 계기로 삼는 가드**를 두고 앱 진입점에서 한 번 설치한다.

```ts
// apps/web/src/api/sessionCache.ts (신규, frontend 소유)
export function installSessionCacheGuard(qc: QueryClient, store = useStore): () => void
// store.subscribe 로 auth.userId 변화를 감시한다. 값이 바뀌면(null 로 가든, 다른 id 로 가든):
//   qc.clear()  +  selection.clear()  +  ui 의 현재 자원 id 초기화
```

이 계기 선택이 세 경로를 **한 번에** 덮는다.
- 사용자가 누르는 로그아웃(`AppLayout.tsx:60`) — `userId: "userA" → null`
- 401 자동 로그아웃(`client.ts:156`) — 같은 전이
- **로그아웃을 거치지 않는 계정 전환**(`LoginPage` 가 `setAuth` 만 부르는 경로) — `"userA" → "userB"`.
  오케스트레이터가 물은 "로그인 시에도 지워야 하는가"의 답이 여기서 자동으로 나온다: 별도 규칙이
  필요 없다. **신원이 바뀌는 것**이 조건이지 로그아웃이 조건이 아니기 때문이다.

시제품을 만들어 네 시나리오로 태웠다(2026-09-04, 실제 `<App/>`).

| 시나리오 | 기대 | 실측 |
|---|---|---|
| A 로그아웃 → B 로그인 | A 데이터 안 보임 | 캐시 엔트리 0, `ui.currentProjectId` null, `selection` [], **B 화면에 A사 물류센터 보임: false**(200ms 뒤에도 false) |
| 로그아웃 중 401 폭주 | 없어야 함 | 로그아웃 중 추가 네트워크 호출 **0건** |
| 로그아웃 없이 A→B 토큰 교체 | 지워짐 | 캐시 엔트리 0, `projects: undefined` |
| **음성 대조군**: 같은 사용자가 토큰만 갱신(`userId` 동일) | 지우면 안 됨 | 캐시 **유지됨**(true) |
| 401 자동 로그아웃 경로 | 같은 가드를 탐 | 캐시 엔트리 0, `auth.token` null |

음성 대조군을 둔 이유는 §6-2 3 이다. 조건을 `token` 변화로 잡으면 토큰 갱신마다 캐시를 통째로
버리게 되는데, 그 시나리오에서 **양성 조건과 음성 조건이 같은 값을 낸다.** `userId` 로 잡아야 갈린다.

*역방향 확인 — "`auth.userId` 의 변화"라는 한정어.*
- **`userId` 대신 `token` 으로 하면 무엇이 더 들어오는가**: 같은 사람의 토큰 갱신·재로그인까지 들어와
  캐시를 불필요하게 버린다(위 표 4행이 그 대조군이다).
- **`userId` 때문에 무엇이 빠지는가**: ① **같은 `user_id` 인데 프로젝트 역할이 바뀐 경우**
  (admin 이 멤버십을 **빼고 다시 넣음** — 역할 변경 API 는 없다, §Deferred 1). `my_role` 은 서버가 주는
  값이고 캐시에 남는다 — 규칙 2 는 이것을 덮지 못한다. 다만 이것은 **세션 경계 문제가 아니라 멤버십
  변경 경보 문제**이고, `useAddProjectMember`·`useRemoveProjectMember` 가 `members(pid)` 만 무효화하고
  `project(pid)`(= `my_role` 의 출처)를 무효화하지 않는 별개의 결함이다 —
  **§Deferred 1 에 적고 이 ADR 에서 결정하지 않는다.**
  ② 서버가 세션을 만료시켰는데 화면이 아직 401 을 받지 않은 구간. 이건 401 이 오는 순간 덮인다.
- **옛 조건(`logout()` 호출 지점)이 잡던 것**: 두 호출 지점. 규칙 2 는 둘 다 `userId` 전이를 만들므로
  포함한다(위 표 1·5행에서 각각 태웠다). 잃는 것은 없다.

### 규칙 3 — 폐기 대상은 "서버 상태 + 사용자에 매인 클라이언트 상태" 전부다

`qc.clear()` 를 쓴다(`removeQueries()` 가 아니라). 근거: `clear()` 는 뮤테이션 캐시까지 비우고,
`resetQueries()` 는 활성 관찰자를 **즉시 재요청**시켜 토큰 없는 401 폭주를 만든다. 실측에서
`clear()` 는 로그아웃 중 추가 네트워크 호출 0건이었다(Zustand `set` 과 `subscribe` 가 동기라
React 리렌더 전에 비워지고, 그다음 리렌더에서 `RequireAuth` 가 `/login` 으로 보내 관찰자가 사라진다).

함께 지우는 것: `selection` 슬라이스 전체, `ui` 의 현재 자원 id
(`currentProjectId`/`currentModelId`/`currentDrawingId`/`currentScanId`/`currentLevel`).
지우지 않는 것: `ui.splitRatio`·`overlayOpacity` 등 **사람의 화면 취향**(사용자에 매인 값이 아니라
브라우저에 매인 값이고, 지우면 UX 만 나빠진다).

### 규칙 4 — 대리키 캐시는 규칙 1 밖이다. 그 대신 **무효화하는 곳이 있는지 명시적으로 센다**

`jobs/{id}`·`drawings/{did}/…`·`models/{mid}/…`·`scans/{sid}/…` 는 프로젝트 접두사를 가질 수 없다
(ADR 0006 규칙 6). 이 다섯 키에 대해서는 **키 설계가 아니라 뮤테이션마다의 명시적 무효화**가 유일한
수단이므로, 새 뮤테이션을 추가할 때 "이 뮤테이션이 대리키 자원을 바꾸는가"를 따로 묻는다.
현재 미충족 1건(`drawingMappings`)은 계획 0004 에 작업으로 올린다.

---

## Consequences

- **좋아지는 것.** ① 프로젝트 하나를 뒤집는 뮤테이션은 `["projects", pid]` 하나로 그 프로젝트의
  모든 서버 상태를 덮는다(§3 행렬 C행: 15/15). ② 세션이 바뀌면 이전 사용자의 서버 상태가 **구조적으로**
  존재할 수 없어 ADR 0006 의 "존재를 숨긴다"가 화면까지 이어진다. ③ 새 무효화 호출 지점이 늘어도
  세션 축은 영향받지 않는다.
- **치러야 하는 값.** ① `objectDetail` 키가 바뀌므로 그 키를 직접 쓰는 자리를 함께 옮겨야 한다
  (**ADR 작성 시점(변경 전) 트리** 전수: `apps/web/src/api/hooks.ts:53,242,258`,
  `apps/web/src/api/hooks.test.tsx:129,130,132` — `git grep -n "objectDetail"` 기준. 나머지 히트는 전부
  `objectDetailFixture` 라는 **다른 식별자**다). 작업 4 머지 후 같은 grep 은
  `hooks.ts:60,62,256,272` · `hooks.test.tsx:134,135,137,297,310,320,322,374,376,388,469,504` 이고
  **전부 새 키를 쓴다**(2026-09-04 재확인). 위 세 쌍은 옮기기 전 자리이므로 지금 트리의 그 행을
  가리키지 않는다.
  ② 로그아웃 후 재로그인 시 캐시가 비어 있으므로 첫 화면이 한 번 더 로딩을 보여준다. 의도한 값이다.
  ③ `installSessionCacheGuard` 를 **테스트 유틸(`test/utils.tsx`)에서도 설치**해야 웹 테스트가 진짜
  경로를 탄다 — 안 하면 §6-2 가 말하는 "결함이 있어도 통과하는 시나리오"가 된다.
- **잡지 못하는 것.** 서버가 이미 보낸 응답이 브라우저 HTTP 캐시나 개발자 도구에 남는 것,
  그리고 규칙 2 의 역방향 확인 ①(같은 사용자의 멤버십 변경). 전자는 범위 밖, 후자는 Deferred 1.

## Alternatives

1. **`logout()` 이 QueryClient 를 직접 지운다.** 기각. 스토어가 React Query 에 의존하게 되고, 앱
   싱글턴과 테스트용 QueryClient 가 어긋나 **테스트에서는 진짜 경로가 실행되지 않는다** — 결함을
   못 잡는 검증을 구조적으로 만들어 내는 안이다(§6-2).
2. **두 호출 지점(`AppLayout`, `client.ts`)에서 나란히 지운다.** 기각. 셋째 호출 지점이 생기는 날
   같은 사고가 난다. 오케스트레이터가 지적한 그대로이고, 이미 `LoginPage` 의
   "로그아웃 없는 계정 전환"이 그 셋째 경로다.
3. **`objectsRoot` 접두사만 추가하고 상세 키는 두기(ADR 0007 모양).** 기각 — §4 표 A행: 현행과
   **한 칸도 다르지 않다**.
4. **모든 목록 키에서 질의 객체를 마지막에 두지 않기.** 기각 — §4 표 B행: 역시 현행과 같다.
   질의 객체는 이 결함의 원인이 아니었다.
5. **`staleTime: 0` 으로 낮춰 항상 최신을 받는다.** 기각. §2-1 실측대로 마운트된 화면은 stale 만으로
   재요청하지 않으므로 세션 누수를 못 고치고, 프로젝트 축에서는 요청량만 늘린다.

## Deferred

1. **같은 사용자의 프로젝트 멤버십 변경이 캐시에 남는다.** `useAddProjectMember`(`hooks.ts:459`)
   ·`useRemoveProjectMember`(`hooks.ts:466`) **둘 다** `members(pid)` 만 무효화하고 `project(pid)` 를
   무효화하지 않는데, `my_role` 의 출처는 `project(pid)` 다(`useProjectRole` → `useProject`). 즉 admin 이
   방금 멤버십을 빼거나 넣어도 그 사람 화면의 행위 버튼은 옛 역할을 따른다.
   **역할 변경은 지원되는 연산이 아니다** — `services/api/routers/projects.py` 의 멤버십 엔드포인트는
   `GET`·`POST`·`DELETE` 셋뿐이라 `PUT`/`PATCH` 가 0건이고, `POST` 는 이미 멤버인 `user_id` 를
   `duplicate_member`(409)로 막는다(`:127`). 그래서 운영에서 역할을 바꾸는 **유일한** 경로가
   remove → add 이고, **두 훅이 같은 모양의 무효화를 각각 갖는다.**

   **다만 "`project(pid)` 를 함께 무효화하면 고쳐진다"는 것은 거짓이다(2026-09-04 실측 — 재심 중
   추가 발견).** 두 훅을 부르는 화면은 `ProjectMembersPage` 하나뿐이고
   (`git grep -n "useAddProjectMember\|useRemoveProjectMember" -- apps/web/src` → `hooks.ts` 정의 2 +
   그 페이지 3), 그 라우트는 `RequireAdmin` 뒤에 있으며(`App.tsx:45`) 서버 쪽 세 엔드포인트도
   `require_role("admin")` 이다. 그런데 `ProjectView` 의 필드는
   `project_id`·`name`·`created_at`·`description`·`my_role` 뿐이고 **admin 의 `my_role` 은 항상 `None`**
   이다(`schemas/projects.py:22` 주석 · `routers/projects.py:69` 가 `ctx.role` 을 그대로 싣고,
   `deps.py:121` 의 admin 분기가 `role=None` 을 돌려준다 — `usecases.caller_project_role` 도 같다).
   즉 **무효화를 수행하는 그 클라이언트에서는
   `project(pid)` 가 멤버십에 따라 달라지는 값을 하나도 싣지 않는다.** 낡은 `my_role` 을 보는 것은
   **역할이 바뀐 그 사람의 다른 브라우저**이고, 거기에는 이 뮤테이션이 도달하지 않는다 —
   클라이언트측 무효화로는 원리상 닫히지 않는 결함이다.

   **이 결론이 언제 거짓이 되는가**(`packages/core/models/state.py:118` 의 "도달 가능해지는 조건"과 같은
   줄 — 위 판정은 아래 두 사실에 **전적으로** 기대고, 둘은 코드가 바뀌면 조용히 낡는다) = ①
   `ProjectView` 에 **멤버십에 따라 값이 달라지는 필드**가 하나라도 생길 때(오늘은
   `project_id`·`name`·`created_at`·`description`·`my_role` 뿐 — `services/api/schemas/projects.py:17`~`:22`),
   또는 ② **admin 이 프로젝트 역할을 갖게 될 때**(오늘은 `deps.py:121` 의 admin 분기가 `role=None` 을
   돌려주고 `usecases.caller_project_role`(`:113`)도 admin 이면 멤버십 행을 무시하고 `None` 이라,
   `ctx.role` 을 그대로 싣는 `routers/projects.py:69` 와 `my_role` 을 채우지 않는 `:60`(admin 목록 분기)
   양쪽에서 admin 응답의 `my_role` 이 항상 `None`). 둘 중 하나라도 참이 되면 **무효화를 수행하는 그
   클라이언트 자신에게도 낡는 값이 생기므로** "클라이언트측 무효화로는 원리상 닫히지 않는다"가 거짓이
   되고, 그때는 훅 두 줄(`project(pid)` 를 함께 무효화)이 이 결함의 **일부를 실제로 닫는다**(다른
   브라우저 몫은 여전히 서버→클라이언트 통보 문제로 남는다). 둘 중 하나라도 하면 이 항목을 다시 연다.

   - *역방향 확인 — 이 두 조건이 놓치는 것.* 둘 다 **`project(pid)` 가 싣는 값**만 본다. `my_role` 같은
     멤버십 의존 값을 **다른 쿼리 키**가 싣기 시작하면 ①·② 가 모두 거짓인 채로 결론만 낡는다. 즉 이
     조건은 "역할 의존 값은 `project(pid)` 밖에 두지 않는다"를 전제로 하며, 그 전제를 깨는 변경
     (새 엔드포인트·새 훅)은 여기서 잡히지 않는다.

   **그러므로 이것은 "훅 두 줄"이 아니라 서버→클라이언트 통보 문제**다(폴링·`staleTime` 단축·
   SSE/WebSocket·401 류의 강제 재조회 중 택일). 규칙 1 이 여는 것은 "접두사 하나로 덮을 수 있다"는
   **편의**일 뿐 이 결함의 해법이 아니다. 다음 사이클에서 실측할 것: 역할이 바뀐 사용자의 화면이
   **언제** 새 `my_role` 을 받는가(마운트·`staleTime` 만료·수동 새로고침). 그 값이 나오기 전에는
   범위조차 판단할 수 없으므로 이 ADR 에서 결정하지 않는다 — 계획 0004 §열린 질문 1.
