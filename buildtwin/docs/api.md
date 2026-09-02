# BuildTwin API

> 이 파일은 `make docs`(`services/api/scripts/gen_api_doc.py`)가 OpenAPI 스펙에서 **자동 생성**한다. 수동 편집 금지.
> 인증: `Authorization: Bearer <JWT>` (POST /api/auth/login). 역할: contractor | cm | client | admin.
> 모든 판정·상태 응답은 `confidence` 와 `evidence` 를 포함한다.

- 버전: 0.1.0

## 엔드포인트

### activities

| 메서드 | 경로 | 요약 | 파라미터 | 요청 본문 | 응답 |
|---|---|---|---|---|---|
| GET | `/api/activities/{activity_id}/readiness` | Activity Readiness | activity_id*(path) | - | ReadinessScore |
| GET | `/api/projects/{project_id}/activities` | List Activities | project_id*(path) | - | ActivityView[] |
| GET | `/api/projects/{project_id}/startable` | Project Startable | project_id*(path), threshold(query) | - | StartableSet |
| GET | `/api/projects/{project_id}/weekly-summary` | Weekly Summary | project_id*(path) | - | WeeklySummary |

### auth

| 메서드 | 경로 | 요약 | 파라미터 | 요청 본문 | 응답 |
|---|---|---|---|---|---|
| POST | `/api/auth/login` | Login | - | json: LoginRequest | LoginResponse |
| GET | `/api/auth/me` | Me | - | - | UserView |
| POST | `/api/auth/register` | Register | - | json: RegisterRequest | UserView |

### daily-reports

| 메서드 | 경로 | 요약 | 파라미터 | 요청 본문 | 응답 |
|---|---|---|---|---|---|
| POST | `/api/projects/{project_id}/daily-reports` | Create Daily Report | project_id*(path) | json: DailyReportCreate; form-data: object | DailyReportResponse |
| GET | `/api/projects/{project_id}/daily-reports` | List Daily Reports | project_id*(path) | - | DailyReportView[] |

### drawings

| 메서드 | 경로 | 요약 | 파라미터 | 요청 본문 | 응답 |
|---|---|---|---|---|---|
| GET | `/api/drawings/{drawing_id}` | Get Drawing | drawing_id*(path) | - | DrawingSummary |
| POST | `/api/drawings/{drawing_id}/alignment` | Set Alignment | drawing_id*(path) | json: AlignmentRequest | object |
| GET | `/api/drawings/{drawing_id}/entities` | Drawing Entities | drawing_id*(path) | - | DrawingEntitiesResponse |
| GET | `/api/drawings/{drawing_id}/mappings` | Drawing Mappings | drawing_id*(path), needs_review(query) | - | EntityObjectMapping[] |
| POST | `/api/drawings/{drawing_id}/mappings/{handle}/confirm` | Confirm Mapping | drawing_id*(path), handle*(path) | json: ConfirmMappingRequest | EntityObjectMapping |
| GET | `/api/models/{model_id}` | Get Model | model_id*(path) | - | ModelSummary |
| GET | `/api/models/{model_id}/mesh` | Model Mesh | model_id*(path) | - | - |
| GET | `/api/models/{model_id}/mesh.obj` | Model Mesh Obj | model_id*(path) | - | - |
| GET | `/api/models/{model_id}/plan-section` | Plan Section | model_id*(path), level(query), offset(query) | - | PlanSectionView |
| GET | `/api/projects/{project_id}/drawings` | List Drawings | project_id*(path) | - | DrawingSummary[] |

### files

| 메서드 | 경로 | 요약 | 파라미터 | 요청 본문 | 응답 |
|---|---|---|---|---|---|
| GET | `/api/files/{file_id}` | Get File | file_id*(path) | - | FileView |
| GET | `/api/files/{file_id}/content` | File Content | file_id*(path) | - | - |
| POST | `/api/projects/{project_id}/files` | Upload File | project_id*(path), level(query) | form-data: Body_upload_file_api_projects__project_id__files_post | UploadResponse |
| GET | `/api/projects/{project_id}/files` | List Files | project_id*(path) | - | FileView[] |

### jobs

| 메서드 | 경로 | 요약 | 파라미터 | 요청 본문 | 응답 |
|---|---|---|---|---|---|
| GET | `/api/jobs/{job_id}` | Get Job | job_id*(path) | - | JobView |

### meta

| 메서드 | 경로 | 요약 | 파라미터 | 요청 본문 | 응답 |
|---|---|---|---|---|---|
| GET | `/api/health` | Health | - | - | object |

### objects

| 메서드 | 경로 | 요약 | 파라미터 | 요청 본문 | 응답 |
|---|---|---|---|---|---|
| GET | `/api/objects/{global_id}` | Get Object | global_id*(path) | - | ObjectDetail |
| POST | `/api/objects/{global_id}/transitions` | Request Transition | global_id*(path) | json: TransitionRequest | TransitionResponse |
| GET | `/api/projects/{project_id}/objects` | List Objects | project_id*(path), level(query), ifc_type(query), state(query), page(query), page_size(query), size(query), include_orphaned(query) | - | ObjectList |

### projects

| 메서드 | 경로 | 요약 | 파라미터 | 요청 본문 | 응답 |
|---|---|---|---|---|---|
| GET | `/api/projects` | List Projects | - | - | ProjectView[] |
| POST | `/api/projects` | Create Project | - | json: ProjectCreate | ProjectView |
| GET | `/api/projects/{project_id}` | Get Project | project_id*(path) | - | ProjectView |
| GET | `/api/projects/{project_id}/levels` | List Levels | project_id*(path) | - | LevelView[] |
| GET | `/api/projects/{project_id}/models` | List Models | project_id*(path) | - | ModelSummary[] |

### review-requests

| 메서드 | 경로 | 요약 | 파라미터 | 요청 본문 | 응답 |
|---|---|---|---|---|---|
| GET | `/api/projects/{project_id}/review-requests` | List Review Requests | project_id*(path), kind(query), status(query), global_id(query) | - | ReviewRequest[] |
| GET | `/api/review-requests/{review_request_id}` | Get Review Request | review_request_id*(path) | - | ReviewRequest |
| POST | `/api/review-requests/{review_request_id}/resolve` | Resolve Review Request | review_request_id*(path) | json: ResolveRequest | ReviewRequest |

### rules

| 메서드 | 경로 | 요약 | 파라미터 | 요청 본문 | 응답 |
|---|---|---|---|---|---|
| POST | `/api/projects/{project_id}/rules/evaluate` | Evaluate Rules | project_id*(path) | json: RuleEvaluateRequest | RuleEvaluateResponse |
| GET | `/api/rules` | List Rules | - | - | Rule[] |

### scans

| 메서드 | 경로 | 요약 | 파라미터 | 요청 본문 | 응답 |
|---|---|---|---|---|---|
| GET | `/api/projects/{project_id}/scans` | List Scans | project_id*(path) | - | ScanSummary[] |
| GET | `/api/scans/{scan_id}` | Get Scan | scan_id*(path) | - | ScanSummary |
| POST | `/api/scans/{scan_id}/alignment` | Submit Alignment | scan_id*(path) | json: AlignmentInput | AlignmentJobResponse |
| GET | `/api/scans/{scan_id}/registration` | Scan Registration | scan_id*(path) | - | Registration |
| GET | `/api/scans/{scan_id}/verdicts` | Scan Verdicts | scan_id*(path) | - | ScanVerdictsResponse |

## 스키마

| 이름 | 필드 |
|---|---|
| ActivityView | `activity_id`*, `schedule_id`*, `project_id`*, `name`*, `wbs_code`, `discipline`, `level`, `zone`, `planned_start`, `planned_finish`, `duration_days`, `resources`, `percent_complete`, `source_ref`, `mapped_global_ids`, `predecessor_ids` |
| Actor | enum: system, contractor, cm |
| AlignmentInput | `control_points`, `marker_observations`, `marker_definitions`, `scanner_position` |
| AlignmentJobResponse | `job_id`*, `scan_id`*, `file_id` |
| AlignmentRequest | `origin`*, `rotation_deg`*, `scale`*, `source`, `notes` |
| BBox2D | `min`*, `max`* |
| BBox3D | `min`*, `max`* |
| BimObjectView | `global_id`*, `ifc_type`*, `group`*, `name`, `level`, `level_elevation`, `zone`, `bbox`, `mesh_ref`, `psets`, `material`, `quantity`, `express_id`, `project_id`*, `model_id`*, `model_version`*, `state`*, `is_orphaned`, `has_open_review` |
| Blocker | `component`*, `reason`*, `related_ids`, `severity` |
| Body_upload_file_api_projects__project_id__files_post | `file`*, `kind`, `level` |
| ConfirmMappingRequest | `global_id`*, `note` |
| ControlPoint | `name`*, `scan_xyz`*, `model_xyz`* |
| CoordinateSystem | `source`*, `origin`, `rotation_deg`, `scale`, `unit`, `epsg`, `extent`, `notes` |
| CoordinateTransform | `matrix`, `from_source`*, `to_source`, `rmse`, `method` |
| DailyReportResponse | `report_id`*, `project_id`*, `report_date`*, `reporter_id`*, `crew_count`, `equipment`, `items`, `note`, `submitted_at`, `transitions`, `review_requests`, `inspection_review_ids`, `skipped` |
| DailyReportView | `report_id`*, `project_id`*, `report_date`*, `reporter_id`*, `crew_count`, `equipment`, `items`, `note`, `submitted_at` |
| DrawingEntitiesResponse | `drawing_id`*, `project_id`*, `level`, `entities`*, `coordinate_system`*, `alignment`, `svg_uri` |
| DrawingEntityView | `handle`*, `layer`*, `dxftype`*, `points`, `bbox`, `block_name`, `insert_point`, `rotation_deg`, `scale`, `text`, `radius`, `attrs` |
| DrawingSummary | `drawing_id`*, `project_id`*, `name`, `level`, `coordinate_system`*, `alignment`, `svg_uri`, `file_id`, `stats` |
| EntityObjectMapping | `drawing_id`*, `entity_handle`*, `global_id`*, `confidence`*, `evidence`*, `needs_review`, `reviewed_by` |
| EntityRef | `drawing_id`*, `handle`*, `confidence`*, `needs_review`*, `reviewed_by` |
| Evidence | `source_type`*, `source_id`*, `file_uri`, `bbox`, `coordinates`, `rule_id`, `method`, `note`, `extra` |
| EvidenceIn | `source_type`, `source_id`, `file_uri`, `bbox`, `rule_id`, `method`, `note`, `extra` |
| FileView | `file_id`*, `project_id`*, `kind`*, `filename`*, `size`*, `sha256`*, `content_uri`*, `uploaded_by`, `created_at` |
| HTTPValidationError | `detail` |
| JobView | `job_id`*, `project_id`*, `kind`*, `status`*, `progress`*, `file_id`, `result_ref`, `result`, `warnings`, `error`, `created_at`, `updated_at` |
| LevelView | `name`*, `elevation`, `object_count` |
| LinkedRefs | `entity_handles`, `entity_refs`, `drawing_id`, `activity_ids`, `material_ids`, `latest_scan_verdict` |
| LoginRequest | `username`, `email`, `password`* |
| LoginResponse | `access_token`*, `token_type`, `role`*, `user_id`*, `email`* |
| MarkerDefinition | `marker_id`*, `model_xyz`* |
| MarkerObservation | `marker_id`*, `scan_xyz`* |
| ModelSummary | `model_id`*, `project_id`*, `name`, `model_uri`*, `obj_uri`, `levels`, `coordinate_system`*, `plan_section_default_offset`, `version`, `file_id`, `stats` |
| NextAction | `kind`*, `label`*, `allowed_roles`*, `to_state`, `actor`, `review_request_id`, `review_kind`, `rule_id` |
| ObjectDetail | `basic`*, `current_state`*, `history`*, `next_actions`*, `linked`* |
| ObjectDiff | `prev_scan_id`*, `prev_state`*, `curr_state`*, `density_delta`*, `volume_delta` |
| ObjectList | `items`*, `total`*, `page`*, `page_size`* |
| ObjectState | enum: PLANNED, REPORTED, IN_PROGRESS, ESTIMATED_DONE, INSPECTION_REQUESTED, CONFIRMED, MISMATCH, UNVERIFIABLE |
| ObjectStateView | `state`*, `since`, `actor`, `actor_id`, `confidence`, `evidence`, `has_open_review`, `open_review_ids` |
| PlanSectionPolyline | `global_id`*, `ifc_type`, `points`*, `closed` |
| PlanSectionView | `level`*, `elevation`*, `offset`*, `cut_elevation`*, `coordinate_system`*, `svg`, `polylines`* |
| ProjectCreate | `name`*, `project_id`, `description` |
| ProjectView | `project_id`*, `name`*, `created_at`, `description` |
| ReadinessScore | `activity_id`*, `score`*, `components`*, `weights`*, `blockers`*, `confidence`*, `evidence`*, `estimated_completion`, `computed_at` |
| RegisterRequest | `email`*, `password`*, `role`, `name` |
| Registration | `scan_id`*, `status`*, `transform`, `rmse`, `fitness`, `inlier_ratio`, `method`, `message`, `evidence` |
| ResolveRequest | `decision`, `action`, `note` |
| ReviewRequest | `review_request_id`, `project_id`*, `kind`*, `global_id`, `activity_id`, `rule_id`, `title`*, `conflicting_sources`, `confidence`*, `evidence`*, `assignee_role`, `status`, `resolution_note`, `resolved_by`, `resolved_at`, `created_at` |
| RiskLevel | enum: LOW, MEDIUM, HIGH, CRITICAL |
| Rule | `id`*, `version`, `source`*, `source_ref`, `reliability`*, `scope`, `when`*, `then`*, `tags`, `description` |
| RuleEvaluateRequest | `global_id`*, `persist` |
| RuleEvaluateResponse | `project_id`*, `global_id`*, `verdicts`*, `context`, `rules_evaluated`* |
| RuleScope | `discipline`, `object_types` |
| RuleThen | `risk_level`*, `action`*, `required_evidence` |
| RuleVerdict | `rule_id`*, `rule_version`*, `global_id`, `activity_id`, `risk_level`*, `action`*, `required_evidence`*, `confidence`*, `evidence`* |
| ScanState | enum: NOT_BUILT, IN_PROGRESS, ESTIMATED_DONE, MISMATCH, UNVERIFIABLE |
| ScanSummary | `scan_id`*, `project_id`*, `name`, `file_id`*, `model_id`, `pointcloud_uri`, `status`*, `point_count`, `registration`, `alignment_input`, `created_at` |
| ScanVerdict | `scan_id`*, `global_id`*, `state`*, `confidence`*, `evidence`*, `diff_from_previous` |
| ScanVerdictsResponse | `scan_id`*, `registration`, `items`*, `total`* |
| StartableActivityView | `activity_id`*, `name`, `readiness`, `confidence`, `evidence`, `blockers` |
| StartableSet | `project_id`*, `startable`*, `blocked`*, `threshold`*, `solver_status`*, `evidence`* |
| StateDistributionRow | `level`*, `group`*, `counts`*, `total`* |
| StateTransition | `transition_id`, `global_id`*, `from_state`*, `to_state`*, `actor`*, `actor_id`, `confidence`, `evidence`*, `review_request_id`, `occurred_at` |
| TransitionRequest | `to_state`*, `evidence`, `note`, `confidence`, `review_request_id` |
| TransitionResponse | `transition_id`, `global_id`*, `from_state`*, `to_state`*, `actor`*, `actor_id`, `confidence`, `evidence`*, `review_request_id`, `occurred_at`, `created_review_ids`, `closed_review_ids` |
| UploadResponse | `job_id`*, `file_id`*, `kind`*, `job_kind`* |
| UserView | `user_id`*, `email`*, `role`*, `name` |
| ValidationError | `loc`*, `msg`*, `type`*, `input`, `ctx` |
| WarningView | `code`*, `message`*, `context` |
| WeeklySummary | `project_id`*, `week_start`*, `week_end`*, `state_distribution`*, `confirmed_this_week`*, `open_reviews`*, `open_reviews_by_kind`*, `startable`*, `state_counts_by_level`*, `state_counts_by_group`*, `open_review_requests`*, `estimated_done_count`*, `object_total`*, `startable_set`*, `extra` |

`*` = 필수.
