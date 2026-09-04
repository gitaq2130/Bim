# 계획 0004 — 캐시 범위·수명(ADR 0010)과 확정 취소 사유(ADR 0011)

- 작성: architect
- 날짜: 2026-09-04
- 기준선: HEAD `eedc6da`, 트리 clean, CI 8 체크 초록, **pytest 733 / vitest 233 / `make lint` exit 0**
- 근거 ADR: [0010](../adr/0010-client-cache-scope-and-lifetime.md), [0011](../adr/0011-leaving-confirmed-requires-reason.md)
- 닫는 백로그: `docs/plans/0001-mvp-build.md` "리뷰 14차 APPROVE 후 남긴 후속" 3건

---

## 목표

`docs/plans/0001-mvp-build.md` 에 쌓인 백로그 3건을 닫는다. 실측 결과 **3건이 아니라 5건**이고
(§전수 목록), 그중 3건은 **하나의 원인**에서 나온다.

1. 다른 계정으로 로그인하면 이전 사용자의 프로젝트가 화면에 뜨고 인가 가드까지 통과한다(ADR 0006 위배).
2. 객체 목록과 상세가 같은 화면에서 서로 다른 상태를 말한다 — 방향이 반대인 두 뮤테이션에서 각각.
3. CM 이 확정을 되돌린 기록에 이유가 남지 않는데 화면은 "사유가 필요합니다"라고 말한다.

---

## 영향 범위

| 층 | 파일 | 소유 | 성격 |
|---|---|---|---|
| 데이터 모델 | `packages/core/models/state.py` | architect | `StateTransition._check` 에 불변식 1줄 + 주석 |
| 화면(상태) | `apps/web/src/api/hooks.ts` | frontend | `objectDetail` 재루팅 · `objectsRoot` 추가 · 무효화 3곳 |
| 화면(세션) | `apps/web/src/api/sessionCache.ts`(신규) · `main.tsx` · `test/utils.tsx` | frontend | 세션 캐시 가드 + 설치 |
| 화면(문구) | `apps/web/src/components/ObjectDetailPanel.tsx` | frontend | `:385` 문구 · `requireNote` |
| 서버 | `services/api/errors.py`, `services/api/scripts/gen_api_doc.py`, `docs/api.md` | api | `RevocationReasonRequiredError` 전용 핸들러 + 문서 재생성 (**초판은 "`services/` 는 수정하지 않는다"였다 — 아래**) |
| 용어 | `docs/glossary.md` "오류 응답 code 어휘" | api 추가 / architect 승인 | `revocation_reason_required` 행 |
| 테스트 | `tests/unit/…`, `tests/integration/…`, `apps/web/src/**/*.test.tsx` | qa | 아래 §검증 시나리오 |

**초판의 "`services/` 무수정"은 왜 거짓이 됐는가(2026-09-04 리뷰 m8, §6-4 규칙 1 로 여기서 고친다).**
그 판단은 ADR 0011 §Decision 의 **초판 코드 블록**(`raise ValueError(…)`)에서 계산한 것이다.
`ValueError` 면 서버는 손댈 곳이 없다 — 실제로 없다. 그런데 구현 단계에서 그 설계가 바뀌었다:
`ValueError` 는 pydantic 이 `ValidationError` 로 감싸고 `services/api/errors.py` 에 그 핸들러가 없어
**500 + `code` 없음**이 되므로(ADR 0011 규칙 1-a) 전용 예외 타입 + 전용 핸들러가 필요했고, 그 순간
`services/api/` 가 범위 안으로 들어왔다. **영향 범위 표는 ADR 의 코드 블록에서 파생됐는데, 바뀐 것이
바로 그 코드 블록이었다.** 파생을 다시 계산한 사람이 없어 계획만 옛 사실에 남았다.

여전히 참인 것: 불변식 자체는 `packages/core/models/state.py` 의 모델 검증자에 있고,
`services/progress/state_machine.py:180` 이 그 모델을 구성하는 유일한 운영 경로이며,
`services/api/usecases.py:187-188` 이 `req.note` 를 `evidence.note` 로 합류시키므로 **API 스키마·
유스케이스 로직은 바꿀 것이 없다.** 바뀐 것은 오류 표현 계층뿐이다.

---

## 작업 분배

| 순서 | 에이전트 | 담당 파일 | 입력 | 출력 | 완료 조건 |
|---|---|---|---|---|---|
| **1** | `frontend` | `apps/web/src/components/ObjectDetailPanel.tsx:385` | ADR 0011 규칙 3 **1단계** | 지금 참인 문구 | `make lint` 0, vitest 233 유지. 문구에 "사유가 필요"류 표현이 **없다**. 이 커밋은 뒤 단계와 독립적으로 머지 가능해야 한다(거짓 문장이 구현 지연에 볼모 잡히지 않게) |
| **2** | `architect` | `packages/core/models/state.py` | ADR 0011 규칙 1 | `_check` 에 `from_state == CONFIRMED → evidence.note` 불변식 + 근거 주석(ADR 0011 링크) | **단독 커밋**(CLAUDE.md §2: `packages/core/models/` 는 architect 단독 커밋). pytest 733 중 새로 깨지는 것 0건(실측 확인됨). `validate_transition` 시그니처 불변 |
| **3** | `frontend` | `apps/web/src/components/ObjectDetailPanel.tsx` | ADR 0011 규칙 2·3 **3단계** | `requireNote={kind ∈ {revoke_confirmation, order_rework}}` + `:385` 문구를 새 사실로 갱신 | `kind` 로 가른다(`to_state` 아님). CONFIRMED 패널에서 두 버튼의 다이얼로그가 사유 없이는 확인 불가 |
| **4** | `frontend` | `apps/web/src/api/hooks.ts` | ADR 0010 규칙 1 | `objectDetail` 재루팅 + `objectsRoot` + `hooks.ts:378` 교체 | **한 커밋 안에서 둘 다.** 저장소 루트 잔여 0: `git grep -n '\["objects"' -- apps/web/src` 가 `hooks.ts` 에서 0줄. `git grep -n 'objectDetail' -- apps/web/src` 의 모든 히트가 새 키를 씀 |
| **5** | `frontend` | `apps/web/src/api/sessionCache.ts`(신규), `main.tsx`, `test/utils.tsx` | ADR 0010 규칙 2·3 | `installSessionCacheGuard(qc, store)` + 진입점 설치 + **테스트 유틸에도 설치** | 스토어가 React Query 를 import 하지 않는다. `logout()` 본문 불변. `renderWithProviders` 가 가드를 설치한다 |
| **6** | `frontend` | `apps/web/src/api/hooks.ts` | ADR 0010 규칙 4 | `useResolveReview` 가 `drawingMappings` 도 무효화 | `kind=="mapping"` 해소 후 뷰어 2D↔3D 매핑이 갱신된다. `drawingMappings` 무효화 호출 ≥ 1곳 |
| **2-a** | `api` | `services/api/errors.py`, `services/api/scripts/gen_api_doc.py`, `docs/api.md`, `docs/glossary.md`(행 추가) | ADR 0011 규칙 1-a | `RevocationReasonRequiredError` 전용 핸들러 → 409 + `code="revocation_reason_required"` | 상태코드 409 유지, `from_state`/`to_state`/`actor` 유지. **초판 계획에 이 행이 없었다** — 아래 §계획과 사실이 어긋난 자리 |
| **7** | `qa` | `tests/unit/`, `tests/integration/`(**`test_18_revocation_reason.py` 포함**), `apps/web/src/**/*.test.tsx` | 아래 §검증 시나리오 **V1~V10**(초판은 "V1~V7"이라고 적었다) | 테스트 + `tests/metrics.json` 갱신 | **각 시나리오가 §6-2 반증 조건을 통과**해야 한다(아래 반증 목록) |
| **8** | `reviewer` | — | 전체 | 리뷰 | ADR 0010·0011 이 §6-1·§6-3 을 지켰는지, 대조표 칸이 참조로 갈음되지 않았는지, 새 문구가 §6-4 를 지켰는지 |

**순서 제약.** 1 은 어디에도 매이지 않는다(먼저·독립). 2 → 3(모델이 먼저 서야 화면 요건이 거짓말이
아니다). 4 는 한 커밋(§ADR 0010 §4: 반쪽이면 무효화가 완전 무동작). 5·6 은 4 와 독립. 7 은 전부 뒤.

---

## 인터페이스 정의

```ts
// apps/web/src/api/hooks.ts  (변경)
objectDetail: (pid: string, gid: string) => ["projects", pid, "objects", gid] as const,   // 기존: ["objects", pid, gid]
objectsRoot:  (pid: string)              => ["projects", pid, "objects"] as const,        // 신규 (documentsRoot/activitiesRoot 와 같은 자리)

// apps/web/src/api/sessionCache.ts  (신규)
/** auth.userId 가 바뀌면(로그아웃·401·계정 전환 전부) 서버 상태와 사용자에 매인 클라이언트 상태를 폐기한다.
 *  트리거가 호출 지점이 아니라 상태 전이라는 것이 이 함수의 요점이다(ADR 0010 규칙 2). */
export function installSessionCacheGuard(qc: QueryClient, store?: typeof useStore): () => void;
```

```python
# packages/core/models/state.py :: StateTransition._check  (추가 1줄)
if self.from_state == S.CONFIRMED and not (self.evidence.note or "").strip():
    raise RevocationReasonRequiredError(self.from_state, self.to_state, self.actor)

# 같은 파일 (ADR 0011 규칙 1-a·1-b). `InvalidTransitionError` 하위 타입이되 부모 포맷("… not allowed.")은
# 쓰지 않는다 — 이 거부에서 그 앞머리는 거짓이다.
class RevocationReasonRequiredError(InvalidTransitionError):
    def __init__(self, from_state, to_state, actor) -> None: ...   # "{from} -> {to} by {actor} requires evidence.note (revocation reason)"
```

**초판은 이 자리에 `raise ValueError(…)` 라고 적었다.** 그 한 줄이 "`services/` 무수정"의 근거였고,
설계가 바뀌면서 근거가 사라졌다(위 §영향 범위).

---

## 검증 시나리오 (qa)

각 줄의 "결함 코드에서의 값"은 **실제로 태운 값**이다(2026-09-04, `git archive` 별도 트리).

| # | 시나리오 | 옳은 코드의 기대값 | **결함 코드에서의 값(실측)** | 갈리는가 |
|---|---|---|---|---|
| V1 | A 로그인 → 프로젝트 목록 조회 → 로그아웃 → B 로그인 → `/projects` | B 화면에 A 프로젝트 **없음** | `A사 물류센터` **보임**(200ms 뒤에도) | O |
| V2 | A 세션이 `["projects","PA"]`(`my_role:"cm"`)를 캐시 → 로그아웃 → B 로그인 → `/projects/PA/…` | `project-access-denied` 렌더 | 가드 **통과**(1.6초 뒤에도 `denied:false`), 헤더에 PA 내비 + `userB (CM)` | O |
| V3 | 로그아웃 없이 `setAuth` 로 A→B 전환 | 캐시 0 | 캐시 유지 | O |
| V4 | **음성 대조군**: 같은 `userId` 로 토큰만 갱신 | 캐시 **유지** | (가드 도입 후) `token` 을 트리거로 잡으면 캐시 0 → 실패 | O |
| V5 | 로그아웃 순간 네트워크 호출 | 추가 호출 0건 | (`resetQueries` 를 쓰면) 401 폭주 | O |
| V6 | 검토요청(inspection) 승인 → 뷰어 재진입 | 목록·상세 **둘 다** `CONFIRMED` | 목록 `INSPECTION_REQUESTED` / 상세 `CONFIRMED`, 목록 재요청 1→1 | O |
| V7 | 작업일보 제출 → 뷰어 재진입 | 목록·상세 **둘 다** `REPORTED` | 목록 `REPORTED` / 상세 `PLANNED`, 상세 재요청 1→1 | O |
| V8 | CM 이 CONFIRMED→MISMATCH 를 note 없이 시도 | 거부 | **201**, 이력 `note: None` | O |
| V9 | 같은 전이를 `note=""` 로 | 거부 | **201**, 이력 `note: ''` | O |
| V10 | 확정 다이얼로그 문구 ↔ 되돌리기 다이얼로그의 `requireNote` | **함께** 참 | 문구는 "사유가 필요", 되돌리기 다이얼로그는 `requireNote` 없음·확인 버튼 활성 | O |

### 반증 목록 — "결함이 있어도 통과하는 단언"으로 쓰면 안 되는 것 (§6-2)

전부 실측으로 확인했다. **생각으로 적지 않았다**(0009 계획 §7 이 그렇게 해서 숫자가 틀렸다).

1. **"vitest 전량이 초록이면 캐시 키가 옳다"** — 거짓. 세 상태에서 모두 **26 files / 233 passed**:
   현행(결함), 옳은 고침, 그리고 **`["objects"]` 가 아무것도 안 걸리는 반쪽 고침**(오늘보다 나쁜 상태).
   따라서 V6·V7 은 **재요청이 실제로 일어났는지(호출 수 증가)와 화면이 보는 값**을 함께 단언해야 한다.
2. **"pytest 전량이 초록이면 되돌리기 사유 요건이 산다"** — 거짓. 불변식을 넣고 전량을 돌려 기준선과
   diff 했을 때 새로 깨진 것은 **내 탐침 1건뿐**이었다. 기존 733건 중 이 경로를 태우는 것이 0건이다
   (`git grep -n "revoke_confirmation\|order_rework" -- tests/` → 0). V8·V9 가 없으면 규칙 1 은
   **넣자마자 무보호**다.
3. **"`invalidateQueries` 가 호출됐다"를 스파이로 세는 것** — 부족하다. 결함 코드도 `["objects"]` 를
   **호출은 한다**. 세야 하는 것은 호출이 아니라 **그 결과 해당 쿼리가 무효화됐는가**
   (`qc.getQueryState(key)?.isInvalidated`) 또는 **재요청이 갔는가**이다.
4. **V2 를 "짧게 기다렸다가 denied 가 뜨는지" 로 세우는 것** — 함정이다. `staleTime: 10_000` 이라
   기다림 자체로는 낫지 않는다(ADR 0010 §2-1: 마운트된 쿼리는 stale 만으로 재요청하지 않는다 —
   staleTime 의 40배를 기다려도 요청 누계 2→2). 시드된 캐시가 **fresh 한 상태에서** 판정이 갈려야 한다.
5. **V4 를 빼는 것** — §6-2 3(음성 대조군을 한 축에만 몰지 않는다). V1~V3 은 전부 "지워지는가" 축이다.
   "지우면 안 되는데 지우는가" 축이 없으면 `qc.clear()` 를 무조건 부르는 코드도 통과한다.

---

## 전수 목록 — 백로그 3(사용자별 상태를 들고 있는 모든 자리)

**생성 기준.** 경로로 먼저 좁히지 않고 **저장소 루트에서** 만들었다(§6-1). 네 기준을 겹쳤다.
① 브라우저 영속 API 문자열 전수(`git grep "localStorage\|sessionStorage\|indexedDB\|document.cookie"`)
② 클라이언트 상태 컨테이너 전수(`git grep "new QueryClient\|QueryClientProvider\|create(" -- apps/web/src`,
Zustand 슬라이스 정의 파일 전부)
③ `apps/web/src` 의 **모듈 최상위 가변 바인딩** 전수(`git grep "^let \|^var \|^const … = new (Map|Set|WeakMap)"`)
④ 서버 프로세스 내 캐시 전수(`git grep -n "lru_cache" -- services/`)
그리고 §6-1 이 **이름 붙은 블라인드 스팟**으로 지목한 `packages/core/models/` 를 별도로 열었다.

| # | 자리 | 사용자에 매인가 | `logout()` 이 지우는가(실측) | 조치 |
|---|---|---|---|---|
| 1 | `QueryClient`(`main.tsx:8`) — 앱 수명 싱글턴 | **예**. 실측: 로그아웃 뒤 8개 엔트리에 `["projects"]`·`["projects","PA"]`(`my_role:"cm"`)·`["objects","PA","GID-A-1"]`·`["projects","PA","documents",{}]`·`["projects","PA","members"]`·`["projects","PA","weekly-summary"]`·`["scans","S-A","verdicts"]`·`["drawings","D-A","entities"]` 가 그대로 | **아니오** (엔트리 수 8 → 8) | ADR 0010 규칙 2·3 |
| 2 | `auth` 슬라이스(`store/index.ts`) | 예 | **예** (token/role/userId 모두 null) | 없음 |
| 3 | `localStorage["buildtwin.auth"]` — 저장소 전체에서 **유일한** 브라우저 영속 키 | 예 | **예** (`null`) | 없음 |
| 4 | `ui` 슬라이스의 현재 자원 id | 예(A 의 프로젝트·모델·도면·스캔 id) | **아니오**: 실측 `currentProjectId="PA"`, `currentModelId="M-A"`, `currentDrawingId="D-A"`, `currentScanId="S-A"`, `currentLevel="3F"` 잔존 | ADR 0010 규칙 3 |
| 5 | `ui` 슬라이스의 화면 취향(`splitRatio` 등) | **아니오**(브라우저에 매인 값) | 아니오 (`0.3` 잔존) | **의도적으로 두다** |
| 6 | `selection` 슬라이스(`sync/selectionSlice.ts`) | 예(A 객체의 `global_id`·`entity_handle`) | **아니오**: 실측 `globalIds:["GID-A-1"]`, `entityHandles:["h-A-1"]`, `source:"3d"` 잔존 | ADR 0010 규칙 3 |
| 7 | 선택 브로커(`sync/broker.ts` 의 `handleToGids`/`gidToHandles`) | 예 | 해당 없음 — `ViewerPage.tsx:63` 의 `useMemo(…, [])` 라 **마운트 수명**이고 로그아웃 시 라우트 이동으로 언마운트된다 | 없음 |
| 8 | `viewer2d`/`viewer3d` 의 Map/Set | 아니오 — 전부 `useRef`(컴포넌트 수명). 모듈 최상위는 `ATTR_NAME_CACHE`(`Viewer2D.tsx:55`) 하나이고 SVG **속성명 → React prop 명** 변환표다 | 해당 없음 | 없음 |
| 9 | `DailyReportPage.tsx:16 itemSeq`, `UploadPage.tsx:24 seq` | 아니오(단조 카운터) | 해당 없음 | 없음 |
| 10 | 서버 `lru_cache` 6곳(`services/api/usecases.py:555`, `ingest/config.py:21`, `progress/importers/_common.py:16`, `progress/verification.py:41`, `sync/config.py`, `sync/rules.py`) | **아니오** — 전부 설정·규칙 YAML 로딩. 인자에 user/project 가 없다 | 해당 없음 | 없음 |
| 11 | **`packages/core/models/`(이름 붙은 블라인드 스팟 — 명시 확인)** | **아니오**. 열어서 확인했다: 사용자 관련 정의는 `orm.py:19-20 UserRow`, `orm.py:39 ProjectMemberRow.user_id` 뿐이고 **서버 DB 행**이다. 클라이언트 세션 상태도, 로그아웃·캐시를 언급한 주석도 **없다**(`git grep -n "user\|캐시\|cache\|logout\|세션\|auth" -- packages/core/models/` → 5줄, 전부 위 두 종류 + `evidence.py`/`coordinate.py` 의 `"user_input"` 리터럴) | 해당 없음 | 없음. **단, ADR 0011 의 불변식이 이 디렉터리에 들어가므로 작업 2 는 architect 단독 커밋이다** |
| 12 | 서비스워커 / Cache API / 쿠키 | — | — | `git grep "serviceWorker\|caches\.\|Cookie" -- apps/web/` → **0건** |

**이 기준이 놓치는 것(§6-1 ②).** ① 축을 "문자 그대로의 API 이름"으로 잡았으므로 **간접 호출**은 밖이다
(`const s = globalThis["local"+"Storage"]` 같은 것). 2026-09-04 실측으로 그런 변종은 0건이지만,
**0건이었다는 사실이 기준을 정당화하지는 않는다.** ② `useRef` 로 컴포넌트 수명이라 안전하다고 본 8번은
**"로그아웃이 반드시 언마운트를 일으킨다"에 기대고 있다** — 지금은 `RequireAuth` 가 `/login` 으로 보내
성립하지만(태워서 확인: 가드 도입 후 로그아웃 중 추가 네트워크 호출 0건), 라우팅이 바뀌면 이 칸의
근거가 사라진다. ③ 서버 축은 `lru_cache` 만 셌다 — 모듈 전역 dict 로 만든 캐시는 이 기준 밖이다.

**태워 본 블라인드 스팟(§6-1 ③).** ②를 골라 실제로 태웠다: 가드를 설치한 뒤 로그아웃을 실행하고
로그아웃 구간의 네트워크 호출을 셌다 — **0건**, 그리고 `ui`/`selection` 이 실제로 초기화됐다
(`currentProjectId: null`, `selection: []`). 즉 "언마운트에 기댄다"는 전제가 지금은 참이다.

---

## 열린 질문 / 리스크

1. **같은 사용자의 프로젝트 역할 변경**(ADR 0010 §Deferred 1). `useAddMember`/`useUpdateMember` 가
   `members(pid)` 만 무효화하고 `my_role` 의 출처인 `project(pid)` 를 무효화하지 않는다. ADR 0010
   규칙 1 을 적용하면 `["projects", pid]` 로 덮을 수 있는 자리가 열리지만, **실측을 하지 않았으므로
   이번 범위에 넣지 않는다.** 다음 사이클에서 태워야 한다.
2. **검토요청 반려의 `requireNote` 가 화면에만 있다**(ADR 0011 §Deferred 2). `ReviewsPage.tsx:177` ↔
   `usecases.resolve_review(… note: str | None …)`. ADR 0011 과 같은 모양이지만 다른 경로다.
3. **`drawingEntities`/`planSection` 재업로드 경로.** `UploadPage.tsx:150` 은 `["projects", pid]` 로
   무효화하는데 이 둘은 `["drawings",did,…]`/`["models",mid,…]` 라 걸리지 않는다. 같은 도면 id 로
   재업로드하는 경로가 실제로 있는지 확인하지 않았다 — 있으면 작업 6 과 같은 종류의 결함이 2건 더 있다.
4. **리스크: 작업 4 의 반쪽 머지.** 키만 옮기고 `hooks.ts:378` 을 남기면 무효화가 **완전 무동작**이 되고
   vitest 233 은 그대로 초록이다(실측). 작업 4 의 완료 조건에 `git grep` 잔여 0 을 넣은 이유다.

---

## 계획과 사실이 어긋난 자리 (2026-09-04 리뷰 반려 m8 — 왜 생겼는가)

**어긋난 것 둘.** ① 작업 7 의 입력이 "V1~V7"인데 검증 시나리오 표는 **V10 까지**다 →
**V8·V9·V10 이 무주공산**이었다. ② 영향 범위의 "`services/` 는 수정하지 않는다"가 거짓이 됐다.
둘 다 위에서 사실에 맞게 고쳤다.

**①은 드리프트가 아니라 태어날 때부터 있었다.** `git show de5734f -- docs/plans/0004-*.md` 로 확인했다 —
계획 최초 커밋에 이미 시나리오 표는 V10 까지이고 작업 7 의 입력은 "V1~V7"이다.

**왜 생겼는가(§6-1).** 한 문서 안의 두 표를 **다른 축으로** 만들고 교차 확인을 하지 않았다.

| 표 | 생성 축 | 그 축에 없는 칸 |
|---|---|---|
| 작업 분배 | **ADR 규칙 하나당 한 행**(0010 규칙 1·2·3·4 → 작업 4·5·6, 0011 규칙 3-1단계·1·2 → 작업 1·2·3) | ADR 이 "규칙"으로 적지 않은 일 — 오류 표현 계층(→ 작업 2-a 누락), 그리고 **시나리오** |
| 검증 시나리오 | **결함 하나당 한 행**(백로그 1·2·3 의 실측 5건 → V1~V7, V8~V10) | 그 시나리오를 **누가** 쓰는가 |

작업 7 의 "입력" 칸은 ADR 0010 시나리오를 훑으며 적혔고, ADR 0011 의 V8~V10 이 시나리오 표에 뒤이어
붙을 때 **작업 분배 표로 되돌아간 사람이 없었다** — 그 표의 축이 "시나리오"가 아니라 "ADR 규칙"이라
V8~V10 을 받을 칸 자체가 없었기 때문이다. **§6-3 의 마지막 항("같은 문서 안에 이미 반박이 적혀 있어도
결론이 그것을 따라가지 못한다")이 그대로 재현됐다**: 시나리오 표 V8~V10 이 작업 7 의 "V1~V7"을
같은 파일 40줄 아래에서 이미 반박하고 있었다.

**치른 값(실해).** V8·V9 의 통합 테스트를 **api 가** 썼다(`tests/integration/test_18_revocation_reason.py`,
`3f358db`) — qa 소유 트리를 명시 허가 없이 건드린 것이고 reviewer 형식 체크 3 이 FAIL 했다.
V10 의 웹 테스트는 frontend 가 썼다(`2520619`). 테스트 자체의 품질 문제가 아니라 **소유가 비어 있었다**는
문제다. ②의 실해는 계획 문서의 거짓 문장 하나(고쳤다).

**다음 계획에 거는 요구(§6-1 규칙의 이행).** 계획 문서 안에 표가 둘 이상이면, 각 표의 **생성 축**을
표 옆에 적고 **한 표의 행이 다른 표의 어느 칸으로 들어가는지**를 마지막에 한 번 대조한다. 여기서는
"시나리오 V# → 그것을 쓰는 작업 행"의 대응이 그 대조였다.

---

## 후속 — 다음 사이클로 넘기는 것

1. **`packages/core/models/` 주석의 기계적 감사(리뷰어 격상 Deferred (d), qa 소유).** §6-1 이
   **이름 붙은 블라인드 스팟**으로 지목한 디렉터리에서 **세 사이클 연속** 주석이 낡았다
   (0009 `review.py` 의 `cause` 정본 · `moved=9` 오기, 이번 `state.py:94` 의 시제 문장).
   `make lint` 에 다음 한 줄을 얹는다 — **`Makefile`·`.github/workflows/` 는 qa 소유이므로 architect 가
   직접 넣지 않는다.**
   ```
   ! grep -rnE "그 후속이|후속이 오|오기 전까지|아직 .*않는다|나중에|추후|TODO|FIXME|예정이다" packages/core/models/
   ```
   *역방향 확인 — 이 검사가 놓치는 것(§6-1 ②).* **셋 중 하나만 잡는다.** 이번 `state.py:94`(미래 시제
   약속)는 잡지만, 0009 의 두 건은 **시제가 아니라 값**이 낡은 것이라(`cause` 정본 자리, `moved=9`)
   이 grep 밖이다. 그리고 현재 시제로 적힌 거짓("핸들러는 다섯뿐" 같은 개수·목록 주장)도 밖이다.
   즉 이것은 **부분 방어**이고, 그렇게 적어 두는 것이 이 검사의 값이다 — "커버한다"고 적으면
   다음 사이클이 그것을 커버리지로 읽는다(§6-1: "놓칠 수 있다"고 적는 것은 커버리지가 아니다).
   *리뷰어가 함께 제안한 대안(주석이 언급하는 심볼·경로가 실재하는지 보는 grep)은 채택하지 않는다.*
   이번 거짓 문장이 언급한 심볼·경로(`services/api/errors.py`, `revocation_reason_required`)는
   **전부 실재한다** — 그 검사는 이번 major 를 잡지 못했다. 관측된 적 없는 종류(끊어진 참조)를 막느라
   관측된 종류를 놓치는 검사를 CI 에 넣지 않는다.
2. **`apps/web/src/components/ErrorBox.test.tsx:48`(qa/frontend).** 그 테스트가 픽스처로 들고 있는
   `detail` 문자열이 서버의 옛 문구(`… by cm not allowed. leaving CONFIRMED requires evidence.note …`)다.
   단언은 그 값을 **입력**으로만 쓰므로 이번 변경으로 깨지지 않지만(vitest 확인), 지금은 서버가 내지
   않는 문자열이다. 새 원문은 `CONFIRMED -> MISMATCH by cm requires evidence.note (revocation reason)`.
3. **`docs/api.md`(api 소유, 자동 생성) — 확인했고 조치 없음.** `RevocationReasonRequiredError` 를
   언급하는 자리(`:221`·`:230`·`:234`)는 응답 **모양**과 code 규약만 적고 `detail` **문구**를 인용하지
   않는다(`grep -n "detail\|not allowed" docs/api.md`). 재생성 불필요.

---

## ADR 필요 여부

- **필요했다, 2건.** ADR 0010(백로그 1+3), ADR 0011(백로그 2).
- 백로그 1 을 계획서만으로 끝내지 않은 이유: 고침이 `queryKeys` 한 줄이 아니라 **"프로젝트 범위 키는
  `["projects", pid, …]` 로 시작한다"는 불변식**이고, 그 불변식이 없으면 백로그 3 의 고침도
  다음 키에서 다시 깨진다. ADR 0005·0007·0008 이 각각 한 번씩 이 함정에 빠졌다는 것이 그 근거다.
- 백로그 1 과 3 을 한 ADR 에 둔 이유: **하나의 결정**이기 때문이다 — "캐시 항목의 유효 범위는
  (사용자 세션, 프로젝트)이고 두 경계 모두 호출부가 아니라 구조가 강제한다". 두 규칙은 그 결정의
  두 집행 지점이다.
- 백로그 2 를 분리한 이유: 주제가 다르다(캐시가 아니라 상태기계). ADR 0001 을 개정하지 않고 새 ADR 로
  쓴 것은 이 저장소의 관례를 따른 것이다(0005·0008 이 0001 의 키 전략을 그렇게 좁혔다).
