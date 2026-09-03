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

### 관측된 개선 후보 (미착수)
- **ORM에 `relationship()`이 없다.** 순수 FK 컬럼만 있어 SQLAlchemy가 한 flush 안에서 테이블 간 INSERT 순서를 보장하지 못한다. 운영 코드는 부모마다 `flush()`를 호출해 우회하고 있으나, 새 코드가 이 규칙을 모르면 외래키 위반이 난다. `relationship()` 도입은 cascade 영향 검토가 필요해 별도 사이클로 (담당: architect)
- 프로젝트 멤버십·인가가 없다. 도입 시 `resolve_object`의 후보 조회와 명시 `project_id` 경로 양쪽에 필터 필요(ADR 0005 §3 전제)
- Job 진행률이 SQLite에서 작업 종료 시점에만 보임(락 회피). PostgreSQL에서는 중간 진행률 노출 가능
- `queries.latest_model`과 `ingest.persistence.latest_model` 중복(읽기 전용 헬퍼)
