# ADR 0001 — 객체 식별(Identity)과 상태 모델(State Model)

- 상태: Accepted (개정 1: 2026-09-02 — §2 좌표계 출처·§4-1 역할 매핑·§5 근거 출처 확장)
- 작성: architect
- 날짜: 2026-09-02
- 관련: CLAUDE.md §0 핵심 원칙, `packages/core/models/`

## Context

BuildTwin의 핵심은 3D 뷰어가 아니라 "계획 / 신고 / 물리적 증거 / 전문가 판단 / 승인" 상태를 **객체 단위로 비교**하는 데이터 구조다. 이를 위해 두 가지를 먼저 확정해야 모든 서비스가 같은 키와 같은 상태 의미를 쓴다.

1. 2D 엔티티·공정 Activity·자재·스캔 판정·검토요청이 모두 매달릴 **단일 객체 키**.
2. 한 객체가 가질 수 있는 **상태 집합과 허용 전이**, 그리고 "누가(actor) 어떤 근거(evidence)로" 전이시켰는지의 기록 방식. 특히 스캔 AI가 "확정"까지 갈 수 없도록 구조적으로 막아야 한다.

## Decision

### 1. 키 전략: IFC GlobalId를 1차 키로

- `BimObject.global_id` = IFC `IfcGloballyUniqueId`(22자 base64 GUID). 이것이 PK이며 프로젝트 내에서 유일하다고 가정한다. 충돌 시 ingest가 `warnings`로 보고하고 두 번째 이후 객체는 `global_id + "#" + n`으로 suffix를 붙이되 `warnings`에 반드시 남긴다.
- **키의 범위는 프로젝트다(ADR 0005).** `global_id`는 `(project_id, global_id)` 복합 키의 일부이며, 같은 IFC를 여러 프로젝트에 올릴 수 있다. 아래 "충돌 시" 접미사 규칙은 한 파일 안의 중복에만 적용된다.
- IFC 없이 DXF만 있는 프로젝트는 MVP 범위에서 지원하지 않는다(2D 엔티티는 항상 객체에 매핑되는 부속 데이터).
- 모델 재업로드 시 같은 GlobalId는 같은 객체로 간주하고 속성·기하만 갱신한다(`model_version` 증가). 상태·이력은 유지한다. GlobalId가 사라진 객체는 `is_orphaned=True`로 표시하고 삭제하지 않는다.
- 파생 엔티티는 모두 `global_id` FK를 가진다:

| 테이블 | 키 | FK |
|---|---|---|
| `bim_objects` | `global_id` PK | — |
| `drawing_entities` | `(drawing_id, handle)` PK | 매핑 테이블 경유 |
| `entity_object_mappings` | `(drawing_id, handle, global_id)` | `global_id` |
| `activities` | `activity_id` PK | — |
| `activity_object_mappings` | `(activity_id, global_id)` | `global_id` |
| `materials` / `material_movements` | `material_id` | `global_id` (nullable, 객체 귀속 시) |
| `scan_verdicts` | `(scan_id, global_id)` | `global_id` |
| `state_transitions` | `transition_id` PK | `global_id` |
| `review_requests` | `review_request_id` PK | `global_id` (nullable: 프로젝트 단위 요청) |
| `daily_reports` / `daily_report_items` | — | `global_id` |

- 매핑 테이블(`entity_object_mappings`, `activity_object_mappings`)은 반드시 `confidence`(0~1)·`evidence`·`needs_review`를 가진다.

### 2. 좌표계

- 모든 기하는 **모델 좌표계(IFC 월드 좌표)**를 기준으로 저장한다. DXF·스캔은 각각 `CoordinateSystem{origin, rotation, scale, epsg?, source}`를 가지며 모델 좌표계로의 변환을 `CoordinateTransform(4x4)`로 저장한다.
- `source ∈ {ifc_local, ifc_mapconversion, dxf_local, scan_local, user_input, grid_auto_align, control_points, markers, icp_refined}`. `dxf_local`·`scan_local`은 각각 DXF 파일·스캔 파일의 원본 로컬 좌표계(모델 좌표계로의 변환이 아직 없음)를 뜻한다. 변환 값은 항상 DB 레코드에서 온다. 코드 상수 금지.

### 3. 객체 상태기계 — 8단계

```python
class ObjectState(str, Enum):
    PLANNED = "PLANNED"                          # 미시공 (계획만 존재)
    REPORTED = "REPORTED"                        # 시공사 신고됨 (착수/진행 보고)
    IN_PROGRESS = "IN_PROGRESS"                  # 시공중 (스캔 또는 신고로 확인된 진행)
    ESTIMATED_DONE = "ESTIMATED_DONE"            # 완료추정 (스캔 AI 최대 판정)
    INSPECTION_REQUESTED = "INSPECTION_REQUESTED"# 검측요청 (CM 확인 대기)
    CONFIRMED = "CONFIRMED"                      # 확정 (CM 승인 — 사람만 가능)
    MISMATCH = "MISMATCH"                        # 위치불일치 (스캔이 계획과 다름)
    UNVERIFIABLE = "UNVERIFIABLE"                # 확인불가 (가림·데이터 부족)
```

상태의 의미 축:

| 상태 | 계획 | 신고 | 물리 증거 | 전문가 판단 | 승인 |
|---|---|---|---|---|---|
| PLANNED | ○ | — | — | — | — |
| REPORTED | ○ | ○ | — | — | — |
| IN_PROGRESS | ○ | ○/— | 부분 | — | — |
| ESTIMATED_DONE | ○ | ○/— | ○ | — | — |
| INSPECTION_REQUESTED | ○ | ○ | ○/— | 대기 | — |
| CONFIRMED | ○ | ○ | ○ | ○ | **○(cm)** |
| MISMATCH | ○ | ○/— | 불일치 | 대기 | — |
| UNVERIFIABLE | ○ | ○/— | 없음 | 대기 | — |

### 4. 허용 전이 표

`actor ∈ {system, contractor, cm}`. 표에 없는 (from, to, actor) 조합은 `InvalidTransitionError`.

| from | to | 허용 actor | 트리거 예 |
|---|---|---|---|
| PLANNED | REPORTED | contractor | 작업일보 착수 신고 |
| PLANNED | IN_PROGRESS | system | 스캔 verdict IN_PROGRESS |
| PLANNED | ESTIMATED_DONE | system | 스캔 verdict ESTIMATED_DONE (신고 없이 발견 → 3중 검증 ReviewRequest 동반) |
| PLANNED | MISMATCH | system | 스캔 verdict MISMATCH |
| PLANNED | UNVERIFIABLE | system | 스캔 verdict UNVERIFIABLE |
| REPORTED | IN_PROGRESS | system, contractor | 스캔 확인 / 진행 신고 |
| REPORTED | ESTIMATED_DONE | system | 스캔 verdict |
| REPORTED | INSPECTION_REQUESTED | contractor | 완료 신고 → 검측 요청 |
| REPORTED | MISMATCH / UNVERIFIABLE | system | 스캔 verdict |
| IN_PROGRESS | ESTIMATED_DONE | system | 스캔 verdict |
| IN_PROGRESS | INSPECTION_REQUESTED | contractor | 완료 신고 |
| IN_PROGRESS | MISMATCH / UNVERIFIABLE | system | 스캔 verdict |
| ESTIMATED_DONE | INSPECTION_REQUESTED | contractor, system | 완료 신고 / 3중 검증 일치 시 자동 검측 요청 생성 |
| ESTIMATED_DONE | IN_PROGRESS | system | 재스캔에서 후퇴(diff) |
| ESTIMATED_DONE | MISMATCH / UNVERIFIABLE | system | 재스캔 |
| INSPECTION_REQUESTED | **CONFIRMED** | **cm** | CM 승인 |
| INSPECTION_REQUESTED | IN_PROGRESS | cm | CM 반려(재작업) |
| INSPECTION_REQUESTED | MISMATCH | cm, system | CM 불일치 판정 / 재스캔 |
| MISMATCH | IN_PROGRESS | cm | CM이 시정 지시 후 재작업 인정 |
| MISMATCH | INSPECTION_REQUESTED | contractor | 시정 완료 신고 |
| MISMATCH | ESTIMATED_DONE | system | 재스캔에서 일치 |
| UNVERIFIABLE | IN_PROGRESS / ESTIMATED_DONE / MISMATCH | system | 재스캔(가림 해소) |
| UNVERIFIABLE | INSPECTION_REQUESTED | contractor | 완료 신고(스캔 불가 시 현장 검측으로) |
| CONFIRMED | MISMATCH | cm | 확정 취소(후속 발견). 반드시 사유 evidence |
| CONFIRMED | IN_PROGRESS | cm | 재시공 지시 |

#### 4-1. 사용자 역할 → actor 매핑

| 역할(UserRole) | actor | 비고 |
|---|---|---|
| `contractor` | `contractor` | 작업일보·완료 신고 |
| `cm` | `cm` | 검측·확정·검토요청 처리 |
| `client` | — | 조회 전용. 전이 요청 403 |
| `admin` | — | 프로젝트·사용자 관리 전용. **확정·검측 승인·검토요청 처리 불가**(403). 운영상 CM 권한이 필요하면 cm 계정을 별도로 발급한다 |

불변식(코드·테스트로 강제):

1. **`to == CONFIRMED` ⇒ `actor == cm`.** 다른 actor의 시도는 예외. `system`에게는 `CONFIRMED`가 도달 불가능한 상태다.
2. `CONFIRMED`에서 나가는 전이도 `cm`만.
3. `reality-capture`의 출력 enum `ScanState`에는 `CONFIRMED`·`INSPECTION_REQUESTED`·`REPORTED`·`PLANNED`가 없다(스캔은 `NOT_BUILT/IN_PROGRESS/ESTIMATED_DONE/MISMATCH/UNVERIFIABLE`만 냄). `NOT_BUILT` verdict는 객체 상태를 바꾸지 않고 3중 검증 입력으로만 쓴다(신고=완료인데 NOT_BUILT면 ReviewRequest).
4. 3중 검증 불일치가 열려 있는 객체(`open ReviewRequest(kind=verification)`)는 `system` actor 전이가 차단된다. CM이 해소해야 전이 재개.

### 5. 전이 기록

```python
class StateTransition(BaseModel):
    transition_id: UUID
    global_id: str
    from_state: ObjectState
    to_state: ObjectState
    actor: Literal["system", "contractor", "cm"]
    actor_id: str | None          # user id 또는 태스크 id
    confidence: float | None      # system 전이 시 필수(0~1); 사람 전이는 1.0 또는 None
    evidence: Evidence            # {source_type: scan|daily_report|cm_action|rule, source_id, file_uri?, bbox?, rule_id?, note?}
    review_request_id: UUID | None
    occurred_at: datetime
```

`Evidence`는 공용 모델로 최소 `source_type`, `source_id`를 필수로 하고 나머지는 선택. 빈 evidence로 전이를 만들 수 없다.

`source_type` 집합(개정 1): `scan`(스캔 판정) · `daily_report`(작업일보) · `cm_action`(CM 조치) · `rule`(규칙 엔진) · `ingest`(도면 인식 결과) · `mapping`(2D↔3D 매핑) · `schedule`(공정표) · `material`(자재 입출고) · `system_logic`(BIM 수량·선후행 계산) · `user_input`(사용자 직접 입력: 정합 파라미터·수동 매핑·화면 조작 전이). 화면에서 사람이 누르는 전이는 `user_input`(actor는 역할에 따름)이다.

### 6. 3중 검증과 상태의 관계

- 축: ① 신고(`DailyReport`) ② 물리적 증거(`ScanVerdict`) ③ 시스템 논리(BIM 수량·선후행·자재 입출고).
- `rules/verification.yaml`의 패턴에 걸리면 `ReviewRequest(kind="verification")`를 만들고 그 객체의 `system` 전이를 막는다. 상태 자체는 바꾸지 않는다(현 상태 유지 + `has_open_review=True` 파생 필드).
- `ReviewRequest`의 해소(`approved/rejected`)는 사람(cm)만 한다. 시스템은 대체된 요청(예: 도면 재정합으로 무의미해진 mapping 검토요청)을 `on_hold`로 바꾸고 `resolution_note`에 `superseded_by=<new id>`를 남길 수만 있다.
- `INSPECTION_REQUESTED` 진입 시 상태기계가 `ReviewRequest(kind="inspection")`를 생성하고, cm의 `CONFIRMED`/`IN_PROGRESS`/`MISMATCH` 전이 시 종료한다(소유: progress-engine).

## Consequences

- 장점: 모든 서비스가 `global_id` 하나로 조인된다. "확정"이 사람 액션임이 타입·전이 표·테스트 세 겹으로 보장된다. 판정과 승인이 분리돼 AI 오판이 곧바로 공식 진도에 반영되지 않는다.
- 비용: IFC 없는 프로젝트 불가(MVP 한계). **MVP에서는 `bim_objects.global_id`가 시스템 전역 PK**다. 같은 IFC 파일을 두 프로젝트에 올리면 `GlobalIdConflictError`로 거부한다(다른 프로젝트 행을 덮어쓰지 않기 위함). 프로젝트 범위 유일성으로의 전환(복합 키 `(project_id, global_id)`)은 ADR 0005 Deferred. GlobalId 재발급(Revit에서 요소 복사 등)이 일어나면 이력이 끊긴다 — 재업로드 시 `is_orphaned` 목록을 사용자에게 보여주고 수동 재연결 기능은 Deferred.
- 상태 8개는 UI 색상 7개(`viewer-3d/colors.ts`)와 1:1로 맞춘다. `REPORTED`와 `IN_PROGRESS`는 같은 노랑 계열로 표시한다.

## Alternatives considered

- **UUID를 자체 발급하고 GlobalId를 속성으로**: 재업로드·다른 도구와의 상호운용에서 매번 매핑이 필요해 기각.
- **상태를 축별로 분리 저장(planned_state, reported_state, scanned_state, approved_state)**: 비교는 쉬우나 "지금 이 객체가 무슨 상태인가"의 단일 답이 없어 UI·Readiness 계산이 복잡해짐. 대신 단일 `ObjectState` + 축별 최신 근거(`latest_daily_report`, `latest_scan_verdict`, `latest_review`)를 파생 뷰로 제공.
- **5단계(미시공/시공중/완료추정/확정/불일치)**: `REPORTED`·`INSPECTION_REQUESTED`·`UNVERIFIABLE`이 없으면 3중 검증과 CM 검측 대기를 표현할 수 없어 기각.

## Deferred (별도 ADR 예정)

- 0002: RVT 처리 경로 — Revit 애드인(pyRevit/C#) 기반 IFC+메타데이터 내보내기 (MVP는 IFC 내보내기 안내 + APS)
- 0003: 만회 시나리오(CP-SAT 목적함수 확장)
- 0004: GlobalId 변경 객체의 수동 재연결
- 0005: 객체 키를 프로젝트 범위로 (Accepted — `docs/adr/0005-project-scoped-object-key.md`)
- 0005: `bim_objects` 복합 키 `(project_id, global_id)` 전환(같은 IFC를 여러 프로젝트에 올리는 경우)
