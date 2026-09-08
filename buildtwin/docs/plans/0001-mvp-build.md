# Plan 0001 — MVP 전체 빌드

## 목표
CLAUDE.md §0의 MVP 5기능을 실제 동작 코드로 구현한다. 벤치마크 대상: CAD(2D 도면 뷰·엔티티 선택), Revit/BIM(IFC 객체 모델·3D 뷰·단면), Palantir AIP(객체 온톨로지·규칙 엔진·검토 워크플로우·상태 승인).

## 영향 범위
- 데이터 모델: `packages/core/models/*` (완료, ADR 0001·0003)
- 서비스: ingest / sync / scan / progress / knowledge / api
- 화면: apps/web (viewer3d, viewer2d, sync 브로커, 6개 화면)
- 테스트: 단위(각 서비스) → 통합(API) → E2E(핵심 시나리오) → metrics.json

## 작업 분배
| 순서 | 에이전트 | 담당 | 입력 | 출력 | 완료 조건 |
|---|---|---|---|---|---|
| 0 | architect | core models, ORM, 설정, 픽스처 생성기, 규칙 시드 | ADR 0001 | `packages/core`, `tests/fixtures/*` | 상태기계 불변식 스모크 통과 |
| 1a | bim-ingest | services/ingest | 픽스처 IFC/DXF | IngestResult, 메시 번들 | 카운트 일치 pytest |
| 1b | progress-engine | services/progress, config | 공정표 3종, ORM | 상태기계·Readiness·검증·CP-SAT | 전이 표·검증 테스트 |
| 1c | reality-capture | services/scan | PLY + 기준점 | Registration, ScanVerdictBatch | 정합 RMSE·판정 정확도 ≥0.85 |
| 1d | knowledge | services/knowledge, rules | 규칙 YAML | RuleEngine, 검토 로그 | 규칙 8+·safe_expr 테스트 |
| 1e | sync-2d3d(서버) | services/sync | 엔티티+객체+정합 | EntityObjectMapping | 기둥 매핑 ≥0.9 |
| 1f | viewer-3d | apps/web/src/viewer3d | 메시 번들 | Viewer3DHandle | 단면 슬라이스 테스트 |
| 1g | viewer-2d | apps/web/src/viewer2d | 엔티티 | Viewer2DHandle | 클릭/영역선택 테스트 |
| 1h | frontend(+sync 브로커) | apps/web | API 계약 | 6개 화면, 스토어 | 브로커·패널 테스트 |
| 2 | api | services/api | 1a~1e 함수 | FastAPI 엔드포인트, docs/api.md | TestClient 통합 테스트 |
| 3 | qa | tests/integration, e2e, metrics.json, CI | 전체 | 회귀 기준 강제 | make test 녹색 |
| 4 | reviewer | 전체 diff | — | APPROVE/REJECT | 5개 체크 PASS |

## 인터페이스
- 뷰어 ↔ 브로커: `.claude/agents/viewer-3d.md`, `viewer-2d.md`, `sync-2d3d.md`의 TS 시그니처
- 서비스 ↔ API: 각 서비스 `__init__.py`의 공개 함수 + `packages/core/models` 계약
- 비동기: `services/common/celery_app.py` (개발·테스트는 eager)

## 리스크
- 합성 픽스처로만 검증됨. 실제 IFC(고창CDC 등)·실측 스캔으로 재검증 필요.
- E57은 pye57 미설치(선택 의존성). LAS/PLY로 시작.
- MinIO 미설정 시 로컬 `storage/` 폴백.

## 후속 조치 메모 (architect)
- [ ] 픽스처 생성기: `edit_object_placement`가 `assign_container`보다 먼저 호출되어 2F 요소가 월드 z=0에 놓임. 모든 에이전트 완료 후 순서를 바꿔 재생성하고 전체 테스트 재실행(GlobalId가 바뀌므로 expected.json 동시 재생성).

## 리뷰 2차 APPROVE 이후 백로그

### 완료 (2026-09-02)
- [x] [api] mapping 검토요청 처리의 `conflicting_sources` 구조 지식을 `sync.review_queue.resolve_mapping_review()`로 이관 — API에는 역할 검사·검토 로그·응답 구성만 남음
- [x] [qa] 좌표 하드코딩 불변식 검사 범위를 `apps/web/src` 전체로 확대 (뷰어 2개 디렉터리 → 전 트리). 오탐·실제 위반 0건
- [x] [frontend] 역할 기반 라우트 가드 `RequireRole` — `/daily-report`는 contractor, `/reviews`는 cm (admin 제외, ADR 0001 §4-1). 서버 403이 실제 강제, 이건 UX 안내
- [x] [frontend] 객체 목록 전체 페이지네이션 `useAllObjects` — `total`까지 페이지 순회, 25페이지(5만 객체) 방어 상한 + 초과 시 경고 배너
- [x] [architect] ADR 0005 작성 (Accepted)

### 완료 (2026-09-02, 이어서)
- [x] **ADR 0005 구현 사이클** — `bim_objects` PK가 `(project_id, global_id)`로, 자식 4개 테이블에 `project_id` + 복합 FK. 같은 IFC를 여러 프로젝트에 업로드 가능. `GlobalIdConflictError` 경로 제거. `GET /api/objects/{global_id}`는 프로젝트가 모호하면 409 + `?project_id=`로 해소. 서비스 4개(progress·api·ingest·sync)가 각각 프로젝트 격리 회귀 테스트 보유

### 진행 예정
- [ ] 실제 IFC(고창CDC)·실측 스캔으로 `tests/metrics.json` 기준 재산정 — **사용자 파일 필요**

### 리뷰 3차 지적 반영 (2026-09-03)
- [x] [progress] 교차 프로젝트 전이 차단 — 다른 프로젝트의 activity_id를 담은 작업일보는 전이 대신 사유와 함께 `skipped`
- [x] [architect] glossary 복합 키·409 모호성 등록, ADR 0001 Consequences·Deferred 정리, ADR 0005 1단계 범위·인가 전제 명시
- [x] [frontend] 객체별 요청에 `project_id` 전달 + 캐시 키 분리 + 409 한국어 안내
- [x] [api] 깨진 호출 지점 수정, `ObjectNotFoundError`·매핑 `ValueError` → 404 매핑, 중복 사전 검사 제거
- [x] [sync] 매핑 확정 시 대상 객체 존재 검증(다른 프로젝트 객체도 거부)
- [x] [architect] SQLite 외래키 강제(`PRAGMA foreign_keys=ON`) — 개발·테스트를 운영 PostgreSQL과 동일 제약으로
- [x] [progress] 그 결과 드러난 실제 결함 수정 — `ensure_model()`이 존재하지 않는 파일을 참조하는 모델 행 생성

### 리뷰 4차 지적 반영 (2026-09-03)
- [x] [architect] ADR 0001 §1 키 표를 구현과 일치(복합 PK·복합 FK). 3차에는 산문만 고치고 표를 놓쳐 재지적됨
- [x] [api] 모든 오류 응답에 기계 판독 `code` 추가 — 409가 쓰이던 원인 5종 이상을 구분. `detail`·상태코드는 그대로라 하위 호환
- [x] [frontend] `code`별 한국어 안내로 분기. 코드가 없으면 서버 설명을 노출해 원인을 지어내지 않음. 이전에는 모든 409를 "여러 프로젝트에 존재"로 오안내
- [x] [progress] `ensure_model`이 실제 `file_id`를 요구 — 자리표시 파일 행이 파일 목록에 0바이트 IFC로 보이던 문제 제거. `open_reviews`의 `project_id` 필수화
- [x] [sync] 존재 검증의 근거 주석을 사실에 맞게 갱신(외래키 강제가 켜진 뒤에도 필요한 이유)
- [x] [qa] 검토요청 통합 테스트를 자체 프로젝트로 격리 — 공유 픽스처를 지웠다 되돌리지 않음

### 리뷰 5차 APPROVE 후 정리 (2026-09-03)
- [x] [architect] ADR 0001 §1 표에서 구현에 없는 테이블 제거, `material_movements` PK 정정
- [x] [api] 오류 코드 어휘 신뢰성 — 중립 기본값 등록, 401에 `unauthorized` 부여, "모든 응답에 code" 문장을 실제 범위로 축소, 손상 데이터(500)와 대상 없음(404) 분리, 전이 예외의 부가 필드(`from_state`/`to_state`/`review_request_ids`) 보존, `docs/api.md`에 오류 봉투 계약 명시
- [x] [sync] 타입 예외 도입(`MalformedReviewDataError`/`MappingTargetNotFoundError`/`DrawingNotFoundError`, 각각 기존 builtin의 하위 클래스)
- [x] [api] 예외 메시지 문자열 비교를 타입 기반 catch로 전환 — 문구 수정이 HTTP 상태를 바꾸지 않는다
- [x] [frontend] 오류 코드 타입 분리(알려진 코드 union + 미지 코드 허용), 캐스트 제거
- [x] [qa] 픽스처 파일 종류 어휘 정정, 중복 프로젝트 테스트가 남기던 영구 행 정리

### ADR 0006 프로젝트 멤버십·인가 (2026-09-03)
- [x] [architect] ADR 0006 + `project_members` 테이블. 역할을 전역/프로젝트 두 층으로 분리, 비멤버는 404(존재 은닉)
- [x] [api] `require_project_role` 의존성, 프로젝트 범위 라우트 전면 적용, 대리키 라우트는 행을 먼저 읽어 멤버십 검사(리뷰어가 3회 지적한 구멍), `resolve_object`를 멤버 프로젝트로 한정(ADR 0005 §3 전제 이행), 멤버 관리 엔드포인트, admin의 행위 권한 제거
- [x] [frontend] `useProjectRole`로 프로젝트별 역할 게이팅(전역 역할 사용 중단), 비멤버 접근 안내 패널, admin 전용 멤버 화면
- [x] [qa] e2e 멤버십 픽스처 + 프로젝트 격리 검증 단계(타 현장 404, 자기 현장 정상, 같은 IFC 두 현장 공존)

### 관측된 개선 후보 (미착수)
- **ORM에 `relationship()`이 없다.** 순수 FK 컬럼만 있어 SQLAlchemy가 한 flush 안에서 테이블 간 INSERT 순서를 보장하지 못한다. 운영 코드는 부모마다 `flush()`를 호출해 우회하고 있으나, 새 코드가 이 규칙을 모르면 외래키 위반이 난다. `relationship()` 도입은 cascade 영향 검토가 필요해 별도 사이클로 (담당: architect)
- Job 진행률이 SQLite에서 작업 종료 시점에만 보임(락 회피). PostgreSQL에서는 중간 진행률 노출 가능
- `queries.latest_model`과 `ingest.persistence.latest_model` 중복(읽기 전용 헬퍼)
- `services/progress/state_machine.py:82` `actor_for_role` docstring이 아직 "UserRole → Actor"로 적혀 있다. ADR 0006 규칙 7·ADR 0001 §4-1(개정 2) 이후 이 함수의 입력은 **프로젝트 역할**(`project_members.role`)이며 `usecases.caller_project_role`이 그 값을 넘긴다. 값 집합이 겹쳐 동작은 정상이나 용어가 어긋난다 — docstring만 "프로젝트 역할 → Actor"로 정정 필요(담당: progress-engine, 문서 문자열 변경뿐)

### 리뷰 14차 APPROVE 후 남긴 후속 (2026-09-03)

14차가 APPROVE 하며 minor 4건을 후속으로 분류했다. 그중 **방어를 붙드는 테스트 부재 2건은 그 자리에서 닫았다** — 이 사이클이 세 번 연속 REJECT 당한 실패 유형("코드는 옳은데 방어가 고정 안 됨")이라 미루면 같은 사고가 반복된다. 남은 2건:

- ~~**`useResolveReview` 가 객체 목록을 무효화하지 않는다.**~~ → **ADR 0010 · 계획 0004 작업 4 로 닫는다.** 2026-09-04 실측으로 이 항목의 진단 세 가지가 틀렸다. ① `documents` 함정과 **같은 모양이 아니다** — 문서는 목록·상세가 이미 같은 접두사 아래 있었고 객체는 상세 키만 `["objects", …]` 에 뿌리내려 **공통 접두사가 없다**. 그래서 `documentsRoot` 형태의 접두사 팩토리(안 A)는 현행과 **한 칸도 다르지 않다**(ADR 0010 §4 대안 표). ② `useTransition` 이 비대칭인 것이 아니라 **`useCreateDailyReport` 에 반대 방향의 같은 결함이 있다** — `["projects", pid]` 는 목록은 덮지만 상세를 못 덮어, 작업일보 제출 후 화면 목록 `REPORTED` / 상세 `PLANNED`(실측). "목록 키를 덮는가"라는 기준이 상세 방향을 볼 칸을 갖고 있지 않았다. ③ "목록은 다른 화면"이 아니다 — `ViewerPage` 가 `useAllObjects` 와 `ObjectDetailPanel` 을 **같은 화면에** 띄우므로 증상은 한 화면의 두 창이 서로 다른 상태를 말하는 것이다 (담당: frontend)
- ~~**`ObjectDetailPanel.tsx:385` "되돌리려면 사유가 필요합니다"**~~ → **ADR 0011 · 계획 0004 작업 1~3 으로 닫는다.** "문구를 사실에 맞추거나 `requireNote` 를 넘기거나 둘 중 하나"가 아니라 **둘 다** 한다: 거짓 문장은 작업 1 에서 즉시(독립 머지 가능하게) 고치고, 사유 요건은 작업 2·3 에서 실제로 건다. 요건을 거는 자리는 화면이 아니라 **모델**이다(`packages/core/models/state.py::StateTransition._check`) — 화면에만 걸면 이 저장소에 이미 있는 "화면이 지키는 척하는 규칙"(검토요청 반려의 `requireNote`)이 두 개가 된다. 2026-09-04 실측 보강: 서버는 `note=None` 과 `note=""` 둘 다 **201** 로 받고 감사 이력에 그대로 남으며, `revoke_confirmation`/`order_rework` 경로를 태우는 테스트는 저장소 전체에 **0건**이다 (담당: architect + frontend + qa)

~~**로그인/로그아웃이 Query 캐시를 비우지 않는다**~~ → **ADR 0010 · 계획 0004 작업 5 로 닫는다.** 2026-09-04 실측으로 이 항목의 한정어 둘이 틀렸다. ① **"10초 동안"이 상한이 아니다.** 마운트된 쿼리는 stale 이 됐다는 이유만으로 재요청하지 않는다(staleTime 의 40배를 기다려도 요청 누계 2→2). 노출 창은 "다음 재요청 계기(마운트·focus·재연결)가 올 때까지"이고, 계기가 없으면 그대로 남는다. ② **"인가 자체는 서버가 막는다"가 화면에서는 성립하지 않는다.** `RequireProjectAccess` 는 `useProject(id)` 의 **캐시된 결과**로 멤버십을 판정하므로, A 세션이 남긴 `my_role:"cm"` 이 비멤버 B 를 그대로 통과시킨다(1.6초 뒤에도 `denied:false`, 헤더에 `userB (CM)`). 서버가 404 로 존재를 숨기는 동안 화면이 프로젝트 id·이름·역할을 보여준다 — ADR 0006 §3 규칙 2 위배 (담당: frontend)

