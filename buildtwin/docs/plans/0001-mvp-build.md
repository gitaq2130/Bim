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

## 리뷰 2차 APPROVE 이후 백로그 (비차단)
- [api] mapping 검토요청 처리 시 `conflicting_sources` 구조 지식을 `sync.review_queue.resolve_mapping_review(session, row, decision, user_id, note)`로 이관
- [qa] 좌표 하드코딩 불변식 lint 대상에 `apps/web/src/lib`, `sync/`, `pages/` 포함
- [frontend] 역할 기반 라우트 가드(`/daily-report` contractor, `/reviews` cm) — 현재는 서버 403만 의존
- [frontend] 객체 목록 2000개 초과 시 페이지네이션(현재 page_size=2000 상한)
- [architect] ADR 0005: `bim_objects` 복합 키 `(project_id, global_id)`
- 실제 IFC(고창CDC)·실측 스캔으로 metrics.json 기준 재산정
