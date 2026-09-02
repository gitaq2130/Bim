# BuildTwin 용어집 (Glossary)

> 새 도메인 개념은 여기에 **한국어 + 영어(코드 식별자)**로 먼저 등록한다. 코드·API·UI는 영어 표기를 그대로 쓴다.
> 기존 항목 변경은 `architect` 승인 필요. 추가는 누구나 가능.

## 객체 상태 (ObjectState) — ADR 0001

| 한국어 | 영어(식별자) | 정의 | 색 |
|---|---|---|---|
| 미시공 | `PLANNED` | 계획(BIM)에만 존재, 신고·증거 없음 | 회색 |
| 신고됨 | `REPORTED` | 시공사가 작업일보로 착수/진행 신고 | 노랑 |
| 시공중 | `IN_PROGRESS` | 스캔 또는 신고로 진행 확인 | 노랑 |
| 완료추정 | `ESTIMATED_DONE` | 스캔 AI가 완료로 추정 (AI 최대 판정) | 연두 |
| 검측요청 | `INSPECTION_REQUESTED` | CM 확인 대기 | 주황 |
| 확정 | `CONFIRMED` | CM이 승인한 완료. 사람(cm)만 전이 가능 | 녹색 |
| 위치불일치 | `MISMATCH` | 스캔이 계획 위치와 허용치 이상 다름 | 빨강 |
| 확인불가 | `UNVERIFIABLE` | 가림·데이터 부족으로 판정 불가 | 보라 |

## 스캔 판정 (ScanState) — reality-capture 출력. `CONFIRMED` 없음

| 한국어 | 영어 |
|---|---|
| 미시공 | `NOT_BUILT` |
| 시공중 | `IN_PROGRESS` |
| 완료추정 | `ESTIMATED_DONE` |
| 위치불일치 | `MISMATCH` |
| 확인불가(가림) | `UNVERIFIABLE` |

## 행위자 (Actor)

| 한국어 | 영어 | 설명 |
|---|---|---|
| 시스템 | `system` | 스캔 판정·규칙 엔진 등 자동 전이 |
| 시공사 | `contractor` | 작업일보 입력, 완료 신고 |
| CM(건설사업관리자) | `cm` | 검측·확정·검토요청 처리 |
| 발주처 | `client` | 조회 전용 |
| 관리자 | `admin` | 프로젝트·사용자 관리 |

## 핵심 개념

| 한국어 | 영어 | 정의 |
|---|---|---|
| BIM 객체 | `BimObject` | IFC에서 추출한 단위 부재. PK = `global_id`(IFC GlobalId) |
| 도면 엔티티 | `DrawingEntity` | DXF에서 추출한 단위 도형. 키 = `(drawing_id, handle)` |
| 엔티티-객체 매핑 | `EntityObjectMapping` | 2D 엔티티 ↔ BIM 객체 연결. confidence·evidence 필수 |
| 공정 작업 | `Activity` | 공정표의 단위 작업 |
| 작업-객체 매핑 | `ActivityObjectMapping` | Activity ↔ BIM 객체 연결 |
| 작업 준비도 점수 | `ReadinessScore` (Work Readiness Score) | 선행공정·검측·자재·도면승인·간섭·인력의 가중합(0~1) |
| 차단 원인 | `Blocker` | Readiness를 낮추는 구체 사유 |
| 착수 가능 작업 | `startable activities` | Readiness ≥ 임계값이고 선후행 제약을 만족하는 Activity 집합 |
| 스캔 판정 | `ScanVerdict` | 객체별 스캔 기반 상태 추정 + confidence·evidence |
| 정합 | `registration` | 포인트클라우드를 BIM 좌표계로 맞추는 변환 |
| 기준점 | `control point` | 스캔 좌표와 모델 좌표를 잇는 사용자 입력 점(≥3) |
| 마커 | `marker` (AprilTag/QR) | 현장 부착 인식표. 모델 좌표 테이블과 매칭 |
| 정합 오차 | `rmse` | 정합 후 잔차 RMS(m). 임계값 초과 시 판정 중단 |
| 가림 | `occlusion` | 스캐너 시점에서 객체가 다른 물체에 가려진 비율 |
| 변화량 | `ObjectDiff` | 직전 스캔 대비 상태·밀도·부피 변화 |
| 3중 검증 | `triple verification` | 신고(daily report) / 물리 증거(scan) / 시스템 논리(BIM·선후행·자재) 대조 |
| 검토요청 | `ReviewRequest` | 자동 확정을 막고 CM 확인을 요구하는 항목. kind: `mapping` / `verification` / `inspection` |
| 작업일보 | `DailyReport` | 시공사가 입력하는 일일 작업 기록(구역·인원·장비·수량·사진) |
| 상태 전이 | `StateTransition` | 객체 상태 변경 기록. actor·evidence 필수 |
| 신뢰도 | `confidence` | 판정·매핑의 확신도 0~1 |
| 근거 | `Evidence` | 판정 근거: 원본 파일·좌표·규칙 ID 등 |
| 좌표계 | `CoordinateSystem` | 원점·회전·스케일·EPSG·출처. 하드코딩 금지 |
| 판단 규칙 | `Rule` | IF 조건식 THEN 위험등급+권고행동+필수확인자료 |
| 규칙 판정 | `RuleVerdict` | 규칙 엔진 출력 |
| 사례 | `CaseRecord` | 과거 프로젝트 상황·영향·조치·결과 기록 |
| 전문가 검토 로그 | `ExpertReviewLog` | AI/규칙 제안 vs 사람 최종 수정의 diff |
| 층 | `level` | IfcBuildingStorey 기준 |
| 구역 | `zone` | 층 내 작업 구역(IfcZone/IfcSpace 또는 사용자 정의) |
| 층별 단면 | `PlanSection` | 3D 모델을 층 높이에서 자른 2D 폴리라인 집합 |
| 작업 | `Job` | 업로드 후 비동기 처리 단위(Celery 태스크). 상태 폴링 대상 |

## 파일 종류

| 한국어 | 영어 | 처리 |
|---|---|---|
| IFC | `ifc` | IfcOpenShell 직접 파싱 (1순위) |
| DXF | `dxf` | ezdxf 직접 파싱 |
| DWG | `dwg` | ODA File Converter 또는 APS로 DXF 변환 후 처리 |
| RVT | `rvt` | 직접 파싱 불가. APS Model Derivative → IFC, 또는 IFC 내보내기 안내 |
| 포인트클라우드 | `e57` / `las` / `ply` | Open3D 정합 |
| 공정표 | `csv` / MS Project `xml` / P6 `xer` | progress-engine importer |

## 지식 엔진 (knowledge) — services/knowledge, rules/

| 한국어 | 영어 | 정의 |
|---|---|---|
| 안전 표현식 | `safe expression` (`services/common/safe_expr`) | 규칙 `when` 조건식. `eval` 없이 AST 허용목록(비교·and/or/not·산술·속성·상수 키 인덱싱·`len/abs/min/max/norm`)만 평가 |
| 위험등급 | `RiskLevel` | 규칙 판정의 심각도: `LOW` / `MEDIUM` / `HIGH` / `CRITICAL` |
| 규칙 범위 | `RuleScope` | 규칙이 적용되는 공종(`discipline`)과 IFC 타입(`object_types`). 비어 있으면 전체 적용 |
| 규칙 신뢰도 | `reliability` | 규칙 출처의 신뢰도(0~1). `RuleVerdict.confidence = reliability × 입력 confidence` |
| 규칙 출처 | `source` (`expert` / `case` / `standard`) | 전문가 인터뷰 / 사례 DB(`source_ref: CASE-xxxx`) / 시방서·기준 |
| 규칙 컨텍스트 | `rule context` (`scan` / `object` / `activity` / `readiness` / `report` / `logic`) | 규칙 엔진 입력 이름. `logic.days_until_planned_start`는 엔진이 `activity.planned_start`에서 파생 |
| 매칭 입력 | `matched_inputs` | 규칙 판정 `evidence.extra`에 기록되는, 조건식이 참조한 컨텍스트 이름 목록 |
| 사례 저장소 | `CaseStore` (`rules/cases/*.yaml`) | 사례 DB 파일 저장소. `to_rule_draft`로 `source: case` 규칙 초안 생성 |
| 추론 제공자 | `ReasoningProvider` / `NullReasoningProvider` | LLM 추론 인터페이스(Protocol). MVP는 빈 결과를 돌려주는 Null 구현만 |
| 검토 diff | `json_diff` (`{path, op: add\|remove\|change, before, after}`) | 전문가 검토 로그의 제안 vs 최종값 차이. 중첩 dict는 `a.b`, 리스트는 `a[0]` 경로 |

## 개정 1 추가 항목 (architect, 2026-09-02)

| 한국어 | 영어 | 정의 |
|---|---|---|
| 검토요청 상태 | `ReviewStatus` = `open` / `approved` / `rejected` / `on_hold` | 해소(approved/rejected)는 cm만. 시스템은 on_hold(대체)만 |
| 신고 상태 | `claimed_state` = `started` / `in_progress` / `completed` | 작업일보 항목의 시공사 주장 |
| 작업 종류 | Job `kind` = `ingest` / `scan_upload` / `schedule` / `mapping` / `verdict` | 비동기 작업 분류. `scan_upload`는 스캔 파일 등록(정합 입력 대기), `verdict`가 정합+판정 수행 |
| 작업 상태 | Job `status` = `queued` / `running` / `done` / `failed` | |
| 정합 상태 | `RegistrationStatus` = `ok` / `needs_alignment_input` / `registration_failed` | |
| 도면 정합 | `DrawingAlignment` (`source`: `user_input` / `grid_auto_align`) | DXF 좌표계 → 모델 좌표계 파라미터(origin·rotation_deg·scale) |
| 좌표계 출처 | `CoordinateSource` += `dxf_local`, `scan_local` | 원본 파일 로컬 좌표계 |
| 근거 출처 | `Evidence.source_type` = scan / daily_report / cm_action / rule / ingest / mapping / schedule / material / system_logic / user_input | ADR 0001 §5 |
| 다음 행동 종류 | NextAction `kind` = `confirm` / `request_inspection` / `reject_inspection` / `report_progress` / `accept_rework` / `order_rework` / `revoke_confirmation` / `flag_mismatch` / `resolve_review` / `align_scan` / `inspect` | 백엔드 `state_machine.next_actions`가 정의, 프론트는 이 집합만 사용 |
| 준비도 구성요소 | `predecessor_completion` / `inspection` / `material_delivery` / `drawing_approval` / `open_clashes` / `crew_assigned` | `config/readiness.yaml` 가중치 키 |
| 차단 구성요소 | `Blocker.component` = 위 6개 + `predecessor` / `readiness` / `resource` | scheduler가 추가로 쓰는 값 |
| 부재 그룹 | `group` (`IFC_TYPE_GROUP`) = `column` / `beam` / `slab` / `wall` / `duct` / `pipe` / `cable_tray` / `facade_panel` / `other` | IfcType을 화면·집계용으로 묶은 것. **공종(discipline)과 다른 개념** |
| 공종 | `discipline` = `structure` / `architecture` / `mechanical` / `electrical` / `civil` / `finishing` | 규칙·공정표·사례에서 공통 사용. `mep`는 쓰지 않는다 |
| 근거 방법 | `Evidence.method` | 자유 문자열이되 서비스별 규약값: sync `user_align|grid_align|bbox_iou|layer_rule`, scan `control_points+icp`, progress `wbs_rule|keyword_rule|level_zone|readiness_weighted_sum|triple_verification|daily_report_item`, knowledge `rule_engine`, scan `preregistered`, api/sync `manual_mapping|review_resolution|model_ingest` |
