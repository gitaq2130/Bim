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
| 관리자 | `admin` | 프로젝트·사용자 관리. **시스템 역할 전용**이며 actor로 매핑되지 않는다 — 프로젝트 멤버가 될 수 없고, 남아 있는 멤버 행도 인가·actor 결정에서 무시된다(ADR 0006 §2-1) |

> **역할의 두 층(ADR 0006 §2)**: 위 표의 `contractor`/`cm`/`client`는 이제 **프로젝트 역할**(`project_members.role`)에서 나온다. actor 결정과 모든 프로젝트 범위 인가는 전역 **시스템 역할**(`users.role`)이 아니라 프로젝트 역할을 본다(예외: 멤버십 관리 라우트 — ADR 0006 §4). 문서·코드·응답에서 "역할"이라고만 쓰지 말고 두 용어를 구분해 쓴다 — 아래 "ADR 0006 추가 항목" 참조.

## 핵심 개념

| 한국어 | 영어 | 정의 |
|---|---|---|
| BIM 객체 | `BimObject` | IFC에서 추출한 단위 부재. PK = `(project_id, global_id)` 복합 키(ADR 0005). `global_id`는 IFC GlobalId |
| 도면 엔티티 | `DrawingEntity` | DXF에서 추출한 단위 도형. 키 = `(drawing_id, handle)` |
| 엔티티-객체 매핑 | `EntityObjectMapping` | 2D 엔티티 ↔ BIM 객체 연결. confidence·evidence 필수 |
| 공정 작업 | `Activity` (`activities`) | 공정표의 단위 작업. PK = `(project_id, activity_id)` 복합 키(ADR 0008). `activity_id`는 공정표 파일에 적혀 오는 코드이므로 프로젝트가 다르면 겹친다 — `activity_id` 단독 조회 금지 |
| 작업-객체 매핑 | `ActivityObjectMapping` (`activity_object_mappings`) | Activity ↔ BIM 객체 연결. PK = **`(project_id, activity_id, global_id)`**(ADR 0008), 복합 FK `(project_id, global_id)`→`bim_objects`. confidence·evidence 필수 |
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
| 검토요청 | `ReviewRequest` | 자동 확정을 막고 CM 확인을 요구하는 항목. kind: `mapping` / `verification` / `inspection` / `document_mapping`(ADR 0007) |
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
| 문서관리대장 | `xlsx` | progress-engine `document_register` importer(ADR 0007). 확장자 우선, 확장자가 없으면 ZIP 시그니처 + 아카이브 내 `xl/workbook.xml` 존재로 판별(`.ifczip`과 구분). 대장 CSV는 지원하지 않는다(`csv`가 공정표로 예약됨) |

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
| 검토요청 상태 | `ReviewStatus` = `open` / `approved` / `rejected` / `on_hold` | 해소(approved/rejected)는 cm만. 시스템이 만드는 on_hold는 두 사유뿐이다 — ① 대체된 요청(`resolution_note`에 `superseded_by=<id>`) ② 판단 대상이 소실된 요청(예: `document_mapping` 요청이 가리키는 문서가 고아가 됨 — ADR 0001 §6 개정 3, 근거는 ADR 0007 §4-2 규칙 6) |
| 신고 상태 | `claimed_state` = `started` / `in_progress` / `completed` | 작업일보 항목의 시공사 주장 |
| 작업 종류 | Job `kind` = `ingest` / `scan_upload` / `schedule` / `mapping` / `verdict` / `document_register` | 비동기 작업 분류. `scan_upload`는 스캔 파일 등록(정합 입력 대기), `verdict`가 정합+판정 수행, `document_register`는 문서관리대장(xlsx) 적재+문서↔Activity 매핑 후보 생성(ADR 0007) |
| 작업 상태 | Job `status` = `queued` / `running` / `done` / `failed` | |
| 정합 상태 | `RegistrationStatus` = `ok` / `needs_alignment_input` / `registration_failed` | |
| 도면 정합 | `DrawingAlignment` (`source`: `user_input` / `grid_auto_align`) | DXF 좌표계 → 모델 좌표계 파라미터(origin·rotation_deg·scale) |
| 좌표계 출처 | `CoordinateSource` += `dxf_local`, `scan_local` | 원본 파일 로컬 좌표계 |
| 근거 출처 | `Evidence.source_type` = scan / daily_report / cm_action / rule / ingest / mapping / schedule / material / system_logic / user_input / **document** | ADR 0001 §5. `document`는 문서관리대장에서 온 근거(ADR 0007 §3-2 규칙 4) — 기존 어느 축에도 속하지 않아 감사에서 구분되어야 하므로 별도 값으로 둔다 |
| 다음 행동 종류 | NextAction `kind` = `confirm` / `request_inspection` / `reject_inspection` / `report_progress` / `accept_rework` / `order_rework` / `revoke_confirmation` / `flag_mismatch` / `resolve_review` / `align_scan` / `inspect` | 백엔드 `state_machine.next_actions`가 정의, 프론트는 이 집합만 사용 |
| 준비도 구성요소 | `predecessor_completion` / `inspection` / `material_delivery` / `drawing_approval` / `open_clashes` / `crew_assigned` | `config/readiness.yaml` 가중치 키 |
| 차단 구성요소 | `Blocker.component` = 위 6개 + `predecessor` / `readiness` / `resource` | scheduler가 추가로 쓰는 값 |
| 부재 그룹 | `group` (`IFC_TYPE_GROUP`) = `column` / `beam` / `slab` / `wall` / `duct` / `pipe` / `cable_tray` / `facade_panel` / `other` | IfcType을 화면·집계용으로 묶은 것. **공종(discipline)과 다른 개념** |
| 공종 | `discipline` = `structure` / `architecture` / `mechanical` / `electrical` / `civil` / `finishing` | 규칙·공정표·사례에서 공통 사용. `mep`는 쓰지 않는다 |
| 근거 방법 | `Evidence.method` | 자유 문자열이되 서비스별 규약값: sync `user_align|grid_align|bbox_iou|layer_rule`, scan `control_points+icp`, progress `wbs_rule|keyword_rule|level_zone|readiness_weighted_sum|triple_verification|daily_report_item`, knowledge `rule_engine`, scan `preregistered`, api/sync `manual_mapping|review_resolution|model_ingest`, progress(문서, ADR 0007) `register_status_rule|register_status_blank|register_status_unmatched|document_title_match`(확정 시에도 이 값 유지 — evidence는 제안 근거를 보존하고 확정자는 `reviewed_by`가 기록한다. `document_manual_mapping`은 ADR 0007 §4 규칙 7 개정 1에서 폐기 — 어떤 코드도 만들지 않음) |

## ADR 0005 추가 항목 (architect, 2026-09-02)

| 한국어 | 영어 | 정의 |
|---|---|---|
| 프로젝트 범위 객체 키 | `project-scoped object key` = `(project_id, global_id)` | 객체의 1차 키. 같은 IFC를 여러 프로젝트에 올릴 수 있으며, 모든 객체 조회는 두 키를 함께 건다(ADR 0005 규칙 2) |
| 프로젝트 범위 Activity 키 | `project-scoped activity key` = `(project_id, activity_id)` | Activity의 1차 키. 같은 공정표를 여러 프로젝트에 올릴 수 있으며, 모든 Activity 조회는 두 키를 함께 건다(ADR 0008 규칙 2). Activity를 참조하는 테이블에는 FK를 걸지 않고 각자 `project_id`를 PK 구성요소로 든다(ADR 0008 §Decision 2) |
| GlobalId 모호성 | `ambiguous global_id` | 한 GlobalId가 둘 이상의 프로젝트에 존재하는 상태. `/api/objects/{global_id}`는 이때 **409**를 돌려주고 `?project_id=`로 해소를 요구한다(ADR 0005 §3) |
| 프로젝트 한정 질의 파라미터 | `project_id` (query) | 객체별 API의 선택 질의 파라미터. 모호성을 직접 해소한다 |
| 고아 객체 | `is_orphaned` | 재업로드에서 사라진 GlobalId. 삭제하지 않고 표시만 하며, 판단은 **같은 프로젝트 안에서만** 한다 |

## ADR 0006 추가 항목 (architect, 2026-09-03)

프로젝트 멤버십과 인가(ADR 0006)가 도입한 개념. **핵심은 "역할"이라는 한 단어가 가리키던 두 가지를
분리하는 것이다** — 인가의 근거인 `project role`과, 계정의 전역 속성인 `system role`.

| 한국어 | 영어 | 정의 |
|---|---|---|
| 프로젝트 멤버십 | `ProjectMember` (`project_members`) | 프로젝트 접근권을 정의하는 `(project_id, user_id)` 행. **행의 존재가 곧 접근권**이며, 행이 없으면 그 프로젝트는 존재하지 않는 것처럼 취급한다(ADR 0006 §1, 규칙 2 → 404 `project_not_found`) |
| 프로젝트 역할 | `project role` (`project_members.role`) = `contractor` / `cm` / `client` | 그 프로젝트에서 이 사람이 무엇인가. **모든 프로젝트 범위 인가와 `actor` 결정의 유일한 근거**(ADR 0006 §2·규칙 1·7). 유일한 예외는 멤버십 관리 라우트 자체로, 시스템 역할 `admin`으로 검사한다(ADR 0006 §4). 전역 `users.role`(시스템 역할)과 **다른 개념**이므로 그냥 "역할"로 부르지 않는다. `admin`은 이 집합에 없다 |
| 시스템 역할 | `system role` (`users.role`) = `contractor` / `cm` / `client` / `admin` | 계정의 전역 속성. 이 중 **`admin`만 인가에 쓰이며 용도는 전 프로젝트 조회와 멤버십 관리뿐**이다 — 행위 역할이 아니고 actor로 매핑되지 않으며, admin 계정은 어떤 프로젝트의 멤버도 될 수 없고, 규칙 도입 이전에 남은 멤버 행이 있어도 읽기측에서 무시된다(ADR 0006 §2-1의 쓰기·읽기 두 겹). 나머지 값(`contractor`/`cm`/`client`)은 **인가 판단에 쓰지 않는다** — `users.role`을 읽는 인가 검사는 `require_role("admin")`뿐이다. 이 값을 멤버십 생성 시 기본 역할로 제안하는 UX는 **미구현(Deferred, ADR 0006 §4)** |
| 내 프로젝트 역할 | `my_role` (`ProjectView.my_role`) | 응답을 받는 사용자의 그 프로젝트에서의 프로젝트 역할. 화면의 버튼 게이팅은 이 값만 본다(전역 역할로 가리면 안 된다). **admin은 `null`** — 조회는 되지만 행위 역할이 없다는 뜻(ADR 0006 규칙 4) |
| 멤버 뷰 | `MemberView` | 멤버십 행의 응답 표현: `project_id` / `user_id` / `email` / `role`(프로젝트 역할) / `added_by` / `added_at` |
| 멤버 추가 요청 | `MemberCreate` | `POST /api/projects/{pid}/members` 요청 본문: `user_id` + `role`(프로젝트 역할). 대상이 admin 계정이면 422 `admin_cannot_be_member` |
| 추가자 | `added_by` | 그 멤버십 행을 만든 admin의 `user_id`. 감사 흔적(ADR 0006 Consequences) |
| 추가 시각 | `added_at` | 멤버십 행 생성 시각. 삭제는 행 제거이므로 이력이 남지 않는다(`removed_at` 소프트 삭제는 Deferred) |
| 프로젝트 멤버 (UI 라벨) | "프로젝트 멤버" (`ProjectMembersPage`) | 멤버십 관리 화면의 한국어 라벨. admin 전용(ADR 0006 §4) |

## 오류 응답 code 어휘 (api, 2026-09-03)

reviewer 4차 지적 1: 동일 상태코드(특히 409)가 서로 무관한 여러 원인에 쓰여 클라이언트가 원인을 구분할 수 없었다
(예: GlobalId 모호함 / 전이 거부 / 검토요청 재처리 모두 409). 이제 모든 오류 응답 본문은 기존 `detail`(사람이
읽는 문자열, 문구·상태코드 불변)에 안정적인 식별자 `code`(snake_case)를 추가로 싣는다:
`{"detail": "...", "code": "ambiguous_global_id"}`. 프론트는 `code`로 분기하고, 모르는 `code`는 `detail`을
그대로 보여준다(신규 code 추가는 이 표에 행만 더하면 되고 기존 프론트 분기를 깨지 않는다).

| code | HTTP | 발생 조건 |
|---|---|---|
| `ambiguous_global_id` | 409 | `global_id`가 둘 이상의 프로젝트에 존재하는데 `?project_id=`를 주지 않고 `/api/objects/{global_id}`(조회·전이)를 호출함(ADR 0005 §3) |
| `invalid_transition` | 409 | 상태기계가 허용하지 않는 전이 요청(예: PLANNED→CONFIRMED 직행, actor 불일치) |
| `transition_blocked_by_review` | 409 | 미결 verification ReviewRequest 가 있어 system 전이가 막힘(ADR 0001 불변식 4) |
| `review_already_resolved` | 409 | 이미 `open`이 아닌(approved/rejected/on_hold) ReviewRequest 를 다시 처리하려 함 |
| `inspection_confirm_failed` | 409 | 검측(inspection) ReviewRequest 승인 시 CONFIRMED 전이가 상태기계에 의해 거부됨 |
| `duplicate_project` | 409 | `POST /api/projects`에 이미 존재하는 `project_id`를 지정함 |
| `duplicate_user_email` | 409 | `POST /api/auth/register`에 이미 등록된 이메일을 지정함 |
| `object_not_found` | 404 | `(project_id, global_id)` 또는 `global_id` 단독으로 객체를 찾을 수 없음(모호함이 아니라 0건) |
| `review_object_not_found` | 404 | 검측 ReviewRequest 가 가리키는 객체가 이후 삭제/재업로드로 사라짐(orphan) |
| `mapping_target_not_found` | 404 | 매핑 확정(`candidate_global_id`)이 가리키는 객체가 그 프로젝트에 없음(직접 확정 또는 mapping ReviewRequest 승인 경로 공통) |
| `review_request_not_found` | 404 | `review_request_id`에 해당하는 ReviewRequest 가 없음 |
| `drawing_not_found` | 404 | `drawing_id`에 해당하는 도면이 없음 |
| `model_not_found` | 404 | `model_id`에 해당하는 모델이 없음 |
| `mesh_not_found` | 404 | 모델의 메시 번들(JSON)이 아직 생성/저장되지 않음 |
| `model_obj_not_found` | 404 | 모델의 OBJ 내보내기가 아직 생성/저장되지 않음 |
| `job_not_found` | 404 | `job_id`에 해당하는 작업이 없음 |
| `file_not_found` | 404 | `file_id`에 해당하는 파일 행이 없음 |
| `file_content_not_found` | 404 | 파일 행은 있으나 저장된 실제 콘텐츠가 없음 |
| `scan_not_found` | 404 | `scan_id`에 해당하는 스캔이 없음 |
| `project_not_found` | 404 | `project_id`에 해당하는 프로젝트가 없음 |
| `activity_not_found` | 404 | `(project_id, activity_id)`에 해당하는 공정 Activity 가 없음(readiness 조회). `project_id`는 쿼리 필수이며 멤버십을 먼저 검사하므로, 비멤버는 이 code 대신 `project_not_found`를 받는다(ADR 0008 §5) |
| `plan_section_not_found` | 404 | 지정한 레벨에 기하가 있는 객체가 없어 평면 단면을 만들 수 없음 |
| `forbidden_role` | 403 | 역할이 요구 권한 집합에 없음(예: CONFIRMED 전이·검측 승인·검토요청 처리는 `cm`만, `admin` 전용 라우트 등, ADR 0001 §4-1) |
| `unsupported_file_kind` | 415 | 업로드 파일 종류를 인식할 수 없거나(매직넘버/확장자) 그 종류를 처리할 파이프라인이 없음 |
| `daily_report_missing_field` | 422 | multipart 작업일보 업로드에 `report` JSON 필드가 없음 |
| `daily_report_invalid` | 422 | 작업일보 본문이 스키마 검증에 실패함 |
| `alignment_input_insufficient` | 422 | 스캔 정합 입력이 기준점·마커 최소 조건(각 ≥3)을 못 채움 |
| `unauthorized` | 401 | 인증 실패(토큰 없음/무효/만료, 알 수 없는 사용자). `auth/router.py`(`/auth/login`)와 `deps.py`(`get_optional_user`/`get_current_user`)가 던지는 raw `HTTPException(401)`에 `errors.py`의 `HTTPException` 전용 핸들러가 공통으로 부여한다 |
| `not_found` | 404 | `NotFound`의 중립 기본값(호출부가 `code=`를 지정하지 않았을 때만 나타남). 오늘 기준 모든 `raise NotFound(...)`가 위 표의 구체적 404 code 중 하나를 명시하므로 실제로는 아직 관측되지 않는다 — 다음에 추가되는 raise 지점이 code 지정을 빠뜨렸을 때의 안전망이다 |
| `bad_request` | 400 | `ApiError`의 중립 기본값(호출부가 `code=` 미지정 시). 오늘 기준 모든 400 raise 지점이 구체적 code를 지정한다 |
| `conflict` | 409 | `Conflict`의 중립 기본값(호출부가 `code=` 미지정 시). 오늘 기준 모든 409 raise 지점이 구체적 code를 지정한다 |
| `unprocessable_entity` | 422 | `Unprocessable`의 중립 기본값(호출부가 `code=` 미지정 시). 오늘 기준 모든 422 raise 지점이 구체적 code를 지정한다 |
| `unsupported_media_type` | 415 | `UnsupportedMedia`의 중립 기본값(호출부가 `code=` 미지정 시). 오늘 기준 모든 415 raise 지점은 `unsupported_file_kind`를 명시한다 |
| `mapping_review_data_corrupt` | 500 | mapping ReviewRequest 처리 중 저장된 `conflicting_sources`에 `drawing_id`/`entity_handle`이 없어 파싱할 수 없음(`services.sync.review_queue.resolve_mapping_review`) — 대상 객체가 없는 것(`mapping_target_not_found`, 404)이 아니라 서버에 저장된 검토요청 데이터 자체의 손상이므로 5xx로 구분한다 |
| `user_not_found` | 404 | `POST /api/projects/{pid}/members`에 지정한 `user_id`가 `users`에 없음(ADR 0006 §4) |
| `duplicate_member` | 409 | `POST /api/projects/{pid}/members`가 이미 그 프로젝트의 멤버인 `user_id`를 다시 추가하려 함 |
| `member_not_found` | 404 | `DELETE /api/projects/{pid}/members/{user_id}`가 가리키는 멤버십 행이 없음 |
| `document_not_found` | 404 | `(project_id, doc_id)`로 문서를 찾을 수 없음(ADR 0007 §8). 문서 조회는 언제나 두 키를 함께 건다 |
| `document_register_invalid` | 422 | 업로드된 문서관리대장(xlsx)에서 헤더 행을 찾지 못했거나 필수 컬럼(`제목`)이 없어 어떤 시트도 읽을 수 없음(ADR 0007 §2-5 규칙 3). 요청은 잘 형성되었고 거부 사유가 파일 내용의 의미적 자격이므로 400이 아닌 422 |
| `document_mapping_target_not_found` | 404 | 문서↔Activity 매핑 생성·확정이 가리키는 `doc_id` 또는 `activity_id`가 그 프로젝트에 없음(ADR 0007 §4·§7) |
| `admin_cannot_be_member` | 422 | `POST /api/projects/{pid}/members`의 대상 `user_id`가 전역 `admin` 계정임. admin은 **어떤 프로젝트의 멤버도 될 수 없다**(ADR 0006 §2-1) — 멤버십 행이 있으면 그 프로젝트 역할이 인가의 근거가 되므로, 이 금지가 없으면 admin이 스스로 `cm` 프로젝트 역할을 발급해 확정 권한을 얻는다. 읽기측(`project_role`/`caller_project_role`)이 admin 호출자의 멤버십 행을 무시하는 심층 방어와 한 쌍이다. 400이 아닌 이유는 요청이 잘 형성되었고 거부 사유가 대상의 의미적 자격이기 때문이며, 409가 아닌 이유는 상태를 바꿔 재시도할 수 있다는 뜻이 아니기 때문이다(ADR 0006 §2-1 근거) |

### 부칙 — reviewer 5차 지적 반영 (api, 2026-09-03)

이 절은 위 "오류 응답 code 어휘" 표·서문에 대한 추가 설명이며, 기존 문장·행은 그대로 둔 채 덧붙인다(append-only).

- **적용 범위 정정**: 위 서문의 "모든 오류 응답 본문은 code를 싣는다"는 `ApiError` 계열(및 `install_handlers`에 등록된
  `InvalidTransitionError`/`TransitionBlockedByReviewError`/`ObjectNotFoundError`)과, 이제 `code="unauthorized"`를
  함께 싣는 인증 401(`HTTPException`)에 한정된다. FastAPI 자체 422(`RequestValidationError`, 요청 스키마 검증
  실패)는 이 계약 밖이며 `code` 없이 FastAPI 기본 형식(`{"detail": [...]}`)을 그대로 반환한다 — 반려 3번 선택지 중
  "401에 code 부여 + 스키마 검증 422는 문장에서 제외"를 택했다.
- **응답 모양 일관성**(반려 5번): `invalid_transition`/`transition_blocked_by_review`는 어느 경로로 발생하든(직접
  전이 요청이든 검토요청 처리 경로든) 같은 부가 필드(`from_state`/`to_state`/`actor` 또는 `review_request_ids`)를
  싣는다. `transition_object`가 더 이상 이 예외들을 `Conflict`로 재포장하지 않고 `errors.py`의 전용 핸들러까지
  그대로 전파하도록 고쳤다.
- **`drawing_not_found`(404, 위 표) 사용처 확장**: mapping ReviewRequest 승인 처리 중 `confirm_mapping_row`가
  참조하는 도면이 그 사이 삭제된 경우(`services.sync.persistence._project_id_of_drawing`의 `LookupError`)도
  이 code로 보고한다 — `confirm_entity_mapping`(직접 확정 경로)과 같은 code.

### 부칙 — ADR 0006 프로젝트 멤버십 인가 (api, 2026-09-03)

이 절도 append-only — 기존 문장·행은 그대로 둔다.

- **`project_not_found`(404, 위 표) 조건 확장**: `project_id`가 실제로 없는 경우뿐 아니라, **호출자가 그
  프로젝트의 멤버가 아닌 경우**(admin 제외)에도 같은 code·같은 상태코드를 돌려준다(ADR 0006 규칙 2 — 403은
  프로젝트 존재를 흘리므로 두 경우를 구분하지 않는다). `services/api/deps.py`의 `project_role`/`require_project_role`이
  프로젝트 범위 라우트 전체에서 이 판단을 통일한다.
- **`forbidden_role`(403, 위 표) 조건 확장**: 이제 "역할이 요구 권한 집합에 없음"의 "역할"은 (전역이 아니라)
  **그 프로젝트에서의 `project_members.role`**을 뜻한다(ADR 0006 규칙 1·7 — 상태 전이의 actor, 검토요청 처리,
  업로드·정합 입력 등 프로젝트 범위 행위 전부). `admin`은 멤버십이 없어 행위 라우트에서 이 code로 거부된다
  (별도 cm/contractor 계정이 필요하다는 안내를 `detail`에 남긴다).
- **대상 행 우선 조회(ADR 0006 규칙 6)**: `project_id`를 경로에 갖지 않는 라우트(`GET/POST /review-requests/{id}`,
  `GET /activities/{id}/readiness`, 그리고 `drawings/{id}`·`scans/{id}`·`models/{id}`·`files/{id}`·`jobs/{id}` 등
  surrogate id 라우트 전부)는 대상 행을 먼저 읽어(없으면 그 자원의 기존 404 code, 예: `review_request_not_found`)
  그 행의 `project_id`로 멤버십을 검사한다.

## ADR 0007 추가 항목 (architect, 2026-09-03) — 문서관리대장 연동

문서관리대장(ADR 0007)이 도입한 개념. **핵심은 두 가지다** — ① `drawing_approval`의 입력이 수동 플래그에서
발주처가 대장에 적은 사실로 바뀐다, ② 문서의 `공종`은 **신뢰할 수 없는 필드**이며 대조는 **제목 텍스트**로 한다.

| 한국어 | 영어(식별자) | 정의 |
|---|---|---|
| 차단 갈래 | `Blocker.kind` = `document_unapproved` / `document_status_unknown` / `document_mapping_pending` | 착수 차단 사유의 **기계 판독** 갈래(ADR 0007 §5-3 개정 1). `reason` 은 사람이 읽는 산문이라 다듬어지면 화면 분류가 조용히 깨지므로, 오류 응답의 `code` 와 같은 이유로 갈래를 따로 내보낸다. 셋은 CM 이 할 일이 다르다 — 문서를 쫓는다 / 대장을 갱신한다 / 매핑을 확정한다. 선택 필드이며 없으면 기존 blocker 와 동일 |
| 문서관리대장 | `DocumentRegister` (`document_register`) | 현장의 문서 발신·회신을 기록한 xlsx 대장. **BuildTwin이 아니라 이 파일이 정본**이며 우리는 읽기만 한다(ADR 0007 §1). 시트 하나가 문서 종류 하나 |
| 문서 | `Document` (`documents`) | 대장의 한 행을 적재한 것. PK = **`(project_id, doc_id)` 복합 키**(ADR 0005와 같은 프로젝트 범위 키). `doc_id` 단독 조회 금지 |
| 문서 식별자 | `doc_id` | `"doc-v{DOC_ID_SCHEME}-" + sha256("{doc_type}\|{sender_normalized}\|{seq_normalized}\|{title_identity}")[:16]`의 결정적 대리키(ADR 0009 §2, 현재 `doc-v1-…`). **공종이 산출식에 들어가지 않는다** — 신뢰할 수 없는 필드가 문서의 정체성에 관여하면 안 되기 때문(ADR 0007 §2-1). 재료 네 번째는 대조용 `title_normalized`가 **아니라** 동결된 `title_identity`다. 만드는 곳은 `packages/core/models/document.compute_doc_id()` 하나뿐. 주간 재업로드가 그대로 upsert 가 된다 |
| `doc_id` 스킴 버전 | `DOC_ID_SCHEME` (`doc-v1-…`) | `doc_id` 산출 규칙의 버전. 재료·정규화가 바뀌면 반드시 올리고 마이그레이션을 함께 낸다(ADR 0009 §5 규칙 4·5). 접두사가 없으면 재적재가 "새 문서"인지 "같은 문서의 키 규칙 변경"인지 데이터만으로 구분할 수 없다 |
| 식별용 제목 정규화 | `title_identity` / `identity_title()` | `doc_id` 재료가 되는 제목 정규화. **코드에 동결**돼 있고 `config/`를 읽지 않는다. NFKC + 공백 정리 + `casefold()` **셋뿐** — 표기 인코딩만 흡수하고 내용(괄호·하이픈·머리말)은 건드리지 않는다(ADR 0009 §3) |
| 대조용 제목 정규화 | `title_normalized` (`title_matching.normalize`) | 문서 제목 ↔ Activity 이름 유사도 대조에 쓰는 정규화. `config/document_register.yaml`이 소유하며 **자유롭게 튜닝할 수 있다 — `doc_id`를 움직이지 않는다**(ADR 0009 §1) |
| 식별 표면 | `identity surface` / `identity_fingerprint` | `doc_id` 재료에 영향을 주는 config 전체(`normalization.sender_aliases`, `register_layout.sheet_doc_types`, `register_layout.column_aliases`). 운영상 동결할 수 없어 대신 적재마다 지문을 남겨 변화를 탐지한다(ADR 0009 §4·§5-2) |
| 식별 드리프트 | `document identity drift` (`ReviewKind` += `document_identity_drift`) | 대장 원문은 그대로인데 우리 쪽 식별 규칙이 바뀌어 문서의 정체성이 흔들린 사건. **보고서(`IdentityDriftReport`)가 싣는 관측 목록은 셋이다** — **이동**(`moved`: 이번 적재에 나타나지 않은 기존 행 ↔ 이번 적재에 새로 생긴 문서를 **제목 원문이 글자 그대로 같은** 쌍으로 1:1 짝지은 것. **고아로 좁히지 않는다** — 시트명 변경 경로는 고아를 만들지 않는다), **충돌 묶음**(`merged`: 한 적재 안에서 두 개 이상의 대장 행이 같은 `doc_id` 로 수렴한 것), **오염된 판단**(`lost_decisions[]` — 아래 항목). **`merged` 는 판정 조건이 아니라 보고 값이다**(§5-2 (라)) — "한 적재 안에서"를 판정에 걸면 크로스-적재 병합(사명 변경 주: 별칭표 통합 + 옛 법인명 행이 대장에서 빠짐)이 표 밖으로 나간다. 판정이 묻는 것은 **이 `doc_id` 가 담고 있는 대장 행이 바뀌었는가**이고, 같은 `doc_id` 아래를 **행-정체**(`sender`·`doc_number`·`seq_raw`·`title` — 전부 대장 원문)와 **행-내용**(`result_raw`·`approval_status`)으로 갈라 **(나-i) 행-정체가 달라졌다** ∪ **(나-ii) 이 `doc_id` 가 다른 `doc_id` 를 흡수했고 행-내용이 달라졌다** 의 **합집합**으로 판정한다(충돌 묶음 소속을 묻지 않는다). 지문 변화도 판정 조건이 아니라 보고 값이다. CM이 확정·반려한 매핑이 걸려 있으면 적재당 1건의 **확인 전용** 검토요청을 만든다 — 해소에 부수 효과가 없다. 보고서를 만드는 게이트는 `moved or merged or lost_decisions` 다(`lost_decisions` 항이 빠지면 위 판정이 게이트에서 다시 조용히 삼켜진다). 이 줄의 한정어 역방향 확인은 ADR 0009 §5-2 (바-2) 표에 있다 (ADR 0009 **§5-2 개정 2**·§5-3) |
| 오염된 판단 | `lost_decisions[]` / `cause` = `row_moved` / `row_replaced` / `row_absorbed` | 식별 드리프트가 건드린 **사람의 판단**(확정·반려)과 그 **경위**. 항목 계약은 `{activity_id, doc_id, decision, cause, new_doc_id, changed_fields, approval_flipped}`. `row_moved`=**대장 행은 그대로인데 우리 식별 규칙이 그 행을 다른 `doc_id`(=`new_doc_id`)로 옮겼다** — 옛 행이 고아가 되는지는 이 값이 답하지 않는다(시트명 변경 경로는 고아를 만들지 않는다: 실측 P3 `moved=9`·`is_orphaned=False`). `new_doc_id` 위에서 같은 판단을 다시 내린다. `row_replaced`=행도 `reviewed_by` 도 살아 있고 고아 표시조차 없는데 그 `doc_id` 가 **담고 있는 대장 행이 바뀌었다** — 승인 상태가 뒤집힐 수 있고 **다시 판단할 새 `doc_id` 가 없다**(`new_doc_id=null` 은 "모른다"가 아니라 "없다"는 사실이다). 가장 위험한 경위이며 **병합을 전제하지 않는다**(주 경로는 `merged=0`). `row_absorbed`=판단이 가리키던 대장 행이 **다른 `doc_id` 아래로 갔고** 이 `doc_id` 에는 대장 행이 남지 않았다(`new_doc_id` 위에서 다시 판단한다). **셋을 뭉뚱그리면 반드시 거짓이 된다** — 검토요청 제목·경고 문구·화면 카드가 모두 이 값으로 갈린다. **모르는 값을 `row_moved` 로 떨어뜨리는 폴백은 금지**이고, 값이 없거나 해석되지 않는 항목은 `unspecified` 로 **따로 모아** 원문을 그대로 드러낸다(`document_mapper._CAUSE_UNSPECIFIED`, 화면 `classifyIdentityDriftCause`). 옛 이름 셋(`orphaned`/`merge_overwritten`/`merge_absorbed`)은 개정 2 가 관측과 어긋난다고 폐기했고, 개명 이전에 저장된 요청은 **새 갈래로 번역하지 않는다** (ADR 0009 §5-2 (마)·§5-3-a·§Deferred 5) |
| 문서 종류 | `doc_type` = `TFA` / `TFR` / `FI` / `SCAR` / `NCR` / `DN` / `VE` / `RFI` / `other` | TFA=승인/검토/참조 요청서(시공상세도 승인), TFR=자료제출서, FI=현장지시, SCAR=시정조치요구, NCR=부적합보고, DN=통보, VE=설계변경/가치공학, RFI=질의회신. 시트명→종류 표는 `config/document_register.yaml` |
| 문서번호 | `doc_number` | 대장에서 `발신-HG-종류-공종-번호` 형식으로 **수식 생성되는 파생 컬럼**. **파싱하지 않는다** — 표시·검색·blocker 문구 전용이며 구조화된 값은 언제나 대장의 개별 컬럼에서 읽는다(ADR 0007 §2-4). 공란·중복이 가능하므로 유니크 제약도 식별자 용도도 없다 |
| 처리결과 | `result_raw` | 대장 `처리결과` 컬럼의 **원문 그대로**(자유 텍스트, 공란 가능). 절대 해석해 덮어쓰지 않는다. 정규화 결과는 `approval_status`에 따로 담는다 |
| 승인 상태 | `DocumentApprovalStatus` = `APPROVED` / `APPROVED_WITH_COMMENTS` / `REJECTED` / `RESUBMIT_REQUIRED` / `IN_REVIEW` / `UNKNOWN` | `result_raw`를 정규화한 값. **`ObjectState`와 무관하며 어떤 상태 전이도 일으키지 않는다**(ADR 0007 §3-1). 공란·해석 불가는 `UNKNOWN`이고 **절대 승인으로 추측하지 않는다** |
| 조건부승인 | `APPROVED_WITH_COMMENTS` | 기본적으로 **승인으로 보지 않는다** — 조건 충족 여부가 대장에 없어 착수 가능 여부를 알 수 없기 때문(ADR 0007 §3-3). 무엇을 승인으로 볼지는 `readiness.yaml`의 `document_approval.approved_statuses`가 정한다 |
| 처리결과 정규화 규칙 | `status_normalization` (`config/document_register.yaml`) | 정규식 → 상태 + confidence 표. 코드에 한국어 문자열 리터럴을 두지 않기 위한 장치. 규칙 id는 `DOCST-nnn`이며 `evidence.rule_id`에 남는다 |
| 신뢰 불가 공종 | `discipline_raw` (untrusted) | 대장의 `공종` 원문. 협력사가 원본과 다르게 적는 일이 흔해 **단독 매핑 근거가 될 수 없고, 일치는 가점만, 불일치는 감점·배제하지 않는다**(ADR 0007 §4 규칙 2). 정규화 결과는 `discipline_normalized` |
| 번호 정규화 | `seq_normalized` | `번호` 원문에서 숫자 이외를 모두 제거해 이어붙인 값(`26-049`→`26049`, `제26-07-09호`→`260709`). **자릿수를 재해석하지 않는다**(연도 확장·선행 0 제거 금지) |
| 제목 대조 | `title matching` | 문서↔Activity 매핑의 **필수 근거**. `min_similarity` 미만이면 다른 근거가 모두 맞아도 후보가 아니다(ADR 0007 §4 규칙 1). 유사도 = `SequenceMatcher` 비율과 토큰 Jaccard의 가중합 |
| 판별 토큰 | `discriminative token` (`zone` / `section` / `revision` / `level`) | 문서 제목과 Activity **양쪽에 모두 존재하고 값이 다르면 유사도와 무관하게 후보에서 하드 배제**하는 토큰. "ASRS-1구간 vs ASRS-4구간", "1차 vs 2차"를 걸러낸다. 한쪽에만 있으면 배제하지 않고 confidence만 낮춘다(ADR 0007 §4 규칙 3) |
| 문서-작업 매핑 | `ActivityDocumentMapping` (`activity_document_mappings`) | 문서 ↔ Activity 연결. PK = **`(project_id, activity_id, doc_id)`**(ADR 0008), `project_id`는 Activity에서 유도, **복합 FK `(project_id, doc_id)`**→`documents`. `confidence`·`evidence`·`needs_review`·`reviewed_by` 필수. 문서↔객체 직접 매핑은 만들지 않는다(대장에 객체 식별 정보가 없음) |
| 매핑 자동 확정 금지 | `always_needs_review` | 시스템이 만든 문서 매핑은 **confidence 값과 무관하게 항상 `needs_review=True`**다. 유사도 0.99여도 그렇다. ADR 0001의 "스캔 AI는 `ESTIMATED_DONE`까지, `CONFIRMED`는 cm만"과 같은 구조이며, `MAPPING_REVIEW_THRESHOLD`(0.7)는 문서 매핑에 적용되지 않는다 |
| 문서 매핑 검토요청 | `ReviewKind` += `document_mapping` | 미확정 문서 매핑을 CM 검토 큐로 보내는 검토요청. `assignee_role="cm"`. 기존 `mapping`을 재사용하지 않는 이유는 `services/sync`의 해소 로직이 `drawing_id`/`entity_handle`을 기대하기 때문. 해소는 `services/progress`가 소유 |
| 문서 승인 우선순위 | document evidence > manual flag > unknown default | `drawing_approval` 입력의 3단 사다리(ADR 0007 §5-2). ① 확정 매핑된 필수 문서 → 전부 승인이면 1.0, 아니면 0.0 ② 없으면 기존 `resources.drawing_approved` ③ 둘 다 없으면 `component_defaults.drawing_approval_unknown`. **사실(대장)이 주장(수동 플래그)을 이긴다** |
| 필수 문서 | `required_doc_types` (`config/readiness.yaml`, 기본 `[TFA]`) | 착수 가능 판단을 좌우하는 문서 종류. "필수"란 **그 Activity에 확정 매핑된 문서 중 이 종류에 속하는 것**이며, 문서가 없는데 요구사항을 발명하지 않는다 |
| 도면승인 논리곱 | `scoring: all_or_nothing` | `drawing_approval`은 비율이 아니라 AND다 — 필수 문서 전부 승인이면 1.0, 하나라도 아니면 0.0. 비율(9/10=0.9)을 쓰면 `start_threshold` 0.75를 넘겨 미승인 도면 위에서 착수 가능이 뜬다. 비율은 점수가 아니라 `Blocker.reason`·`evidence`로만 보고한다(ADR 0007 §5-1) |
| 고아 문서 | `documents.is_orphaned` | 최근 대장 업로드에 없던 문서. **삭제하지 않고 표시만** 하며 판단은 **그 업로드에 존재한 `doc_type` 안에서만** 한다(TFA 시트만 올렸다고 TFR이 고아가 되면 안 된다). readiness 계산에서 제외(ADR 0007 §2-2) |
| 문서 근거 가용성 | `logic.document_evidence_available` / `logic.drawing_approval_status` = `approved` / `not_approved` / `unknown` | 3중 검증 `logic` 축의 새 입력(ADR 0007 §6-1). **`unknown`을 조건으로 삼는 검증 패턴은 만들지 않는다** — 문서 데이터가 없는 프로젝트가 통째로 검토요청으로 뒤덮이기 때문 |
| 반려 문서 수 | `logic.rejected_document_count` | 확정 매핑된 필수 문서 중 `approval_status == REJECTED`(발주처가 명시적으로 거부)인 것의 수. `document_evidence_available`이 `False`면 언제나 `0`(ADR 0007 §6-1 개정 1). `drawing_approval_status == 'not_approved'`는 반려(확실)와 RESUBMIT_REQUIRED/IN_REVIEW/UNKNOWN(대장 갱신이 늦었을 뿐일 수 있음 — 불확실)을 뭉뚱그리므로, 이 필드가 `rules/verification.yaml`의 VER-008(반려, confidence 0.9)과 VER-009(그 외 미승인, confidence 0.6)를 가른다 |

### 대장 업로드 인가 (ADR 0007 §7)

문서관리대장 업로드는 **그 프로젝트의 `cm`만** 가능하다 — 다른 파일 종류가 `contractor`/`cm` 모두를 허용하는 것과
다르다. 근거: 대장의 `처리결과`는 발주처·CM 측 판단의 기록이고 그것이 착수 가능 판단을 움직이므로, 시공사가
올릴 수 있으면 **피검자가 자기 승인 상태를 스스로 기록**하는 구조가 되어 ADR 0001 불변식 1("확정은 cm만")을
데이터 입력 경로로 우회한다. 문서 조회는 모든 프로젝트 멤버(+admin), 매핑 생성·확정은 `cm`만, 전역 `admin`은
행위 라우트에서 403 `forbidden_role`(ADR 0006 §2-1).

## ADR 0007 개정 2 추가 항목 (architect, 2026-09-03) — 9차 리뷰: 코드가 앞서고 문서가 뒤따르지 못한 4건

| 한국어 | 영어(식별자) | 정의 |
|---|---|---|
| 검토요청 복귀 | `review revival` | `document_mapping` 검토요청이 `on_hold`(고아화)로 닫힌 뒤, 그 문서가 대장에 다시 나타나면 **새** `ReviewRequest`가 자동으로 다시 열리는 것(옛 `on_hold` 행을 재사용하지 않음 — `open_document_mapping_review`는 `status="open"`만 조회). 이미 사람이 판단한(확정이든 반려든, `reviewed_by is not None`) 매핑은 복귀 대상이 아니다(ADR 0007 §4-2 규칙 6 개정 2·개정 3) |
| 매핑 재계산 시점 | `mapping resync triggers` | `map_project_documents`가 다시 도는 세 지점 — 대장 업로드 시(정상 경로) / 공정표 업로드 시(대장이 먼저 올라온 순서를 회복하는 부가 경로) / 수동 요청 시(`generate_document_mappings`, cm만). 부가 경로(공정표 업로드)의 실패는 본 작업(공정표 적재)을 롤백시키지 않아야 한다는 원칙이 딸려 있다 — "부가 회복이 본 작업을 인질로 잡지 않는다"(ADR 0007 §4-3) |
| 매핑되지 않은 문서 경고 | `DOCUMENT_UNMAPPED` | 어떤 Activity 에도 매핑 후보가 없는 문서가 있을 때 `JobRow.warnings`에 실리는 경고 code(`services/progress/document_mapper`). 대장이 공정표보다 먼저 올라왔거나 제목 유사도가 임계값 미만인 경우 등을 알린다. 발화 조건은 `progress-engine`이 소유하며 이 ADR은 고정하지 않는다(ADR 0007 §8 규칙 6). `config/document_register.yaml`의 `import_warnings` 카탈로그(snake_case)와 대소문자 스타일이 다르다는 점도 등록해 둔다 |
| 매핑 재동기화 실패 경고 | `DOCUMENT_MAPPING_RESYNC_FAILED` | 공정표 적재는 성공했으나 뒤이은 문서↔Activity 매핑 재동기화가 실패했을 때 `JobRow.warnings`에 실리는 경고 code(`services/api/jobs.py`). job 은 `done` 으로 남는다 — 문서 매핑은 공정표 적재의 부수 효과이므로 대장 설정 오류가 공정표 적재를 막지 않는다(ADR 0007 §4-3) |
| 설정 불변식 위반 예외 | `UnsafeConfigOverrideError` (`services/progress/config_loader`, `ValueError` 서브클래스) | `readiness.yaml`/`document_register.yaml`의 특정 키(§9-2, 4개)가 코드에 하드코딩된 안전 불변식과 다른 값으로 바뀌면 로딩 시점에 던지는 예외. 조용히 무시하지 않는 이유는 "설정했으니 됐다"는 잘못된 믿음이 가장 위험하기 때문(ADR 0007 §9-1). **폭발 반경**(ADR 0007 §9-3): `readiness.yaml` 오염은 readiness·startable API 요청을 500으로(요청 단위) 만들고, 3중 검증 `logic` 축을 만드는 verdict job도 함께 `failed`로 만든다(job 단위 — `build_logic_context`가 무조건 호출). `document_register.yaml` 오염은 대장 업로드 job을 `failed`로 만들며 오늘 코드 기준으로는 공정표 업로드 job도 함께 `failed`가 된다(§4-3의 "부가 회복이 본 작업을 인질로 잡지 않는다" 원칙을 아직 못 지키는 상태 — api가 수정 중). 어느 경우도 프로세스는 안 죽는다 |

## ADR 0007 개정 3 추가 항목 (architect, 2026-09-03) — 10차 리뷰: 매핑 반려

`document_mapping` 검토요청 생애주기에 ⑥ 반려가 더해지며 도입된 개념(ADR 0007 §4-2 규칙 6). **핵심은
`reviewed_by`를 확정과 반려가 공유한다는 것**이다 — 이 필드 하나로 "확정됐다"를 판별하던 기존 코드는 이제
`mapping_review_decision`을 함께 봐야 한다.

| 한국어 | 영어(식별자) | 정의 |
|---|---|---|
| 매핑 반려 | `mapping rejection` (`reject_document_mapping`, `services/progress/document_mapper`) | CM이 `document_mapping` 검토요청을 검토 큐에서 반려(`resolve_review`에 `decision="rejected"`)하면 대응 `ActivityDocumentMappingRow`에 남는 영구 표시. **매핑 행을 삭제하지 않는다** — 감사를 위해 남긴다(ADR 0007 §4-2 규칙 7과 같은 원칙). 확정과 달리 Activity가 바뀌어도 되살아나지 않는다(§4-2 규칙 6 ⑥) — 확정은 readiness·3중 검증의 증거로 쓰이므로 근거가 흔들리면 재확인이 필요하지만, 반려는 애초에 증거로 쓰이지 않으므로 같은 위험이 없다. `doc_id`가 title의 해시라 문서 제목이 바뀌면 자동으로 새 후보가 되는 것과 대칭이다(별도 코드 불필요) |
| 매핑 검토 결정 | `mapping_review_decision` (`ActivityDocumentMapping.evidence.extra.mapping_review_decision`) | 매핑 반려의 표시값. 값은 `"rejected"` 하나뿐 — 확정된 매핑에는 이 키 자체가 없다. `reviewed_by is not None`을 "확정됐다"의 근거로 쓰는 모든 코드는 이 값도 함께 확인해야 확정과 반려를 구분할 수 있다(§4-2 규칙 6 ⑥의 "누수 A·B" 방어가 이 원칙의 실제 적용 사례) |
| 반려 근거 필드 | `Evidence.extra` 의 `rejected_by` / `rejected_at` / `rejection_note` | 매핑 반려 시 `mapping_review_decision`과 함께 남는 부가 필드 — 누가·언제·왜 반려했는지. `evidence.source_type`/`.method`는 시스템이 제안했을 때의 값(`document`/`document_title_match`)을 그대로 두고 `note`만 반려 코멘트로 갱신한다(확정 시 evidence를 보존하는 §4-2 규칙 7과 같은 관례) |
| 확정·반려 공통 필터 | `_drop_already_confirmed` (`services/progress/document_mapper`) | 이름은 "확정만 거른다"는 인상을 주지만 ⑥ 이후로는 `reviewed_by is not None`이면(확정이든 반려든) 재계산 후보에서 제외하는 함수다 — 이름이 실제 역할보다 좁다. ADR 0007 §4-2 규칙 6이 이 이름을 직접 인용하므로 문서·코드 명칭을 맞추기 위해 개명하지 않았다 |
| 문서 반려 / 매핑 반려 구분 | `documents.approval_status == REJECTED` ≠ `mapping_review_decision == "rejected"` | 같은 한국어 "반려"를 쓰지만 서로 다른 축이다. **문서 반려**는 발주처가 대장 처리결과에 명시적으로 거부라고 적은 것(`logic.rejected_document_count`, ADR 0007 §6-1)이고, **매핑 반려**는 CM이 "이 문서는 이 Activity와 무관하다"고 문서↔Activity 매핑 후보를 반려한 것(위 `mapping rejection`)이다. 매핑이 반려되면 그 문서는 `confirmed_required_documents`의 확정 목록에서 아예 빠지므로, 매핑 반려는 `logic.rejected_document_count`를 절대 늘리지 않는다 |
