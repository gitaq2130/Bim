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

> **역할의 두 층(ADR 0006 §2)**: 위 표의 `contractor`/`cm`/`client`는 이제 **프로젝트 역할**(`project_members.role`)에서 나온다. actor 결정과 모든 프로젝트 범위 인가는 전역 **시스템 역할**(`users.role`)이 아니라 프로젝트 역할을 본다. 문서·코드·응답에서 "역할"이라고만 쓰지 말고 두 용어를 구분해 쓴다 — 아래 "ADR 0006 추가 항목" 참조.

## 핵심 개념

| 한국어 | 영어 | 정의 |
|---|---|---|
| BIM 객체 | `BimObject` | IFC에서 추출한 단위 부재. PK = `(project_id, global_id)` 복합 키(ADR 0005). `global_id`는 IFC GlobalId |
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

## ADR 0005 추가 항목 (architect, 2026-09-02)

| 한국어 | 영어 | 정의 |
|---|---|---|
| 프로젝트 범위 객체 키 | `project-scoped object key` = `(project_id, global_id)` | 객체의 1차 키. 같은 IFC를 여러 프로젝트에 올릴 수 있으며, 모든 객체 조회는 두 키를 함께 건다(ADR 0005 규칙 2) |
| GlobalId 모호성 | `ambiguous global_id` | 한 GlobalId가 둘 이상의 프로젝트에 존재하는 상태. `/api/objects/{global_id}`는 이때 **409**를 돌려주고 `?project_id=`로 해소를 요구한다(ADR 0005 §3) |
| 프로젝트 한정 질의 파라미터 | `project_id` (query) | 객체별 API의 선택 질의 파라미터. 모호성을 직접 해소한다 |
| 고아 객체 | `is_orphaned` | 재업로드에서 사라진 GlobalId. 삭제하지 않고 표시만 하며, 판단은 **같은 프로젝트 안에서만** 한다 |

## ADR 0006 추가 항목 (architect, 2026-09-03)

프로젝트 멤버십과 인가(ADR 0006)가 도입한 개념. **핵심은 "역할"이라는 한 단어가 가리키던 두 가지를
분리하는 것이다** — 인가의 근거인 `project role`과, 계정의 전역 속성인 `system role`.

| 한국어 | 영어 | 정의 |
|---|---|---|
| 프로젝트 멤버십 | `ProjectMember` (`project_members`) | 프로젝트 접근권을 정의하는 `(project_id, user_id)` 행. **행의 존재가 곧 접근권**이며, 행이 없으면 그 프로젝트는 존재하지 않는 것처럼 취급한다(ADR 0006 §1, 규칙 2 → 404 `project_not_found`) |
| 프로젝트 역할 | `project role` (`project_members.role`) = `contractor` / `cm` / `client` | 그 프로젝트에서 이 사람이 무엇인가. **모든 프로젝트 범위 인가와 `actor` 결정의 유일한 근거**(ADR 0006 §2·규칙 1·7). 전역 `users.role`(시스템 역할)과 **다른 개념**이므로 그냥 "역할"로 부르지 않는다. `admin`은 이 집합에 없다 |
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
| `activity_not_found` | 404 | `activity_id`에 해당하는 공정 Activity 가 없음(readiness 조회) |
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
