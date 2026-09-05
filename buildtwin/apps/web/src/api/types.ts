/**
 * packages/core/models/*.py 의 TS 미러 + api 라우터 응답 계약.
 * 서버 응답은 여기 타입으로만 다루고, Zustand 스토어에 복사하지 않는다.
 */

// ---- state.py ----
export type ObjectState =
  | "PLANNED"
  | "REPORTED"
  | "IN_PROGRESS"
  | "ESTIMATED_DONE"
  | "INSPECTION_REQUESTED"
  | "CONFIRMED"
  | "MISMATCH"
  | "UNVERIFIABLE";

export const OBJECT_STATES: readonly ObjectState[] = [
  "PLANNED",
  "REPORTED",
  "IN_PROGRESS",
  "ESTIMATED_DONE",
  "INSPECTION_REQUESTED",
  "CONFIRMED",
  "MISMATCH",
  "UNVERIFIABLE",
] as const;

export type Actor = "system" | "contractor" | "cm";
export type UserRole = "contractor" | "cm" | "client" | "admin";
/**
 * ADR 0006: 프로젝트 범위 인가는 이 값(project_members.role)으로 하지, 전역 UserRole로 하지 않는다.
 * admin은 이 집합에 없다 — 멤버십 없이 조회만 가능하고 행위 역할이 없다(ProjectView.my_role=null로 표현).
 */
export type ProjectRole = "contractor" | "cm" | "client";

// ---- coordinate.py ----
export type CoordinateSource =
  | "ifc_local"
  | "ifc_mapconversion"
  | "dxf_local"
  | "user_input"
  | "grid_auto_align"
  | "control_points"
  | "markers"
  | "icp_refined"
  | "scan_local";

export interface BBox3D {
  min: [number, number, number];
  max: [number, number, number];
}
export interface BBox2D {
  min: [number, number];
  max: [number, number];
}

export interface CoordinateSystem {
  source: CoordinateSource;
  origin?: [number, number, number];
  rotation_deg?: number;
  scale?: number;
  unit?: string;
  epsg?: number | null;
  extent?: BBox3D | null;
  notes?: string | null;
}

/** 4x4 동차 변환행렬 (행 우선). from_source → to_source */
export interface CoordinateTransform {
  matrix: number[][];
  from_source: CoordinateSource;
  to_source: CoordinateSource;
  rmse?: number | null;
  method?: string | null;
}

// ---- evidence.py ----
export type EvidenceSourceType =
  | "scan"
  | "daily_report"
  | "cm_action"
  | "rule"
  | "ingest"
  | "mapping"
  | "schedule"
  | "material"
  | "system_logic"
  | "user_input"
  /** ADR 0007 §3-2 규칙 4: 문서관리대장에서 온 근거. 기존 어느 축에도 속하지 않는 별도 출처 */
  | "document";

export interface Evidence {
  source_type: EvidenceSourceType;
  source_id: string;
  file_uri?: string | null;
  bbox?: BBox3D | null;
  coordinates?: [number, number, number][] | null;
  rule_id?: string | null;
  method?: string | null;
  note?: string | null;
  extra?: Record<string, unknown>;
}

// ---- identity.py ----
export interface BimObjectView {
  global_id: string;
  ifc_type: string;
  name?: string | null;
  level?: string | null;
  level_elevation?: number | null;
  zone?: string | null;
  bbox?: BBox3D | null;
  psets?: Record<string, Record<string, unknown>>;
  material?: string | null;
  quantity?: Record<string, number>;
  project_id?: string;
  model_id?: string;
  model_version?: number;
  state?: ObjectState;
  is_orphaned?: boolean;
}

export interface DrawingEntityView {
  handle: string;
  layer: string;
  dxftype: string;
  points?: [number, number][];
  bbox?: BBox2D | null;
  block_name?: string | null;
  insert_point?: [number, number] | null;
  rotation_deg?: number | null;
  scale?: [number, number] | null;
  text?: string | null;
  radius?: number | null;
  attrs?: Record<string, unknown>;
}

// ---- state.py: StateTransition ----
export interface StateTransition {
  transition_id: string;
  global_id: string;
  from_state: ObjectState;
  to_state: ObjectState;
  actor: Actor;
  actor_id?: string | null;
  confidence?: number | null;
  evidence: Evidence;
  review_request_id?: string | null;
  occurred_at: string;
}

// ---- mapping.py ----
export interface EntityObjectMapping {
  drawing_id: string;
  entity_handle: string;
  global_id: string;
  confidence: number;
  evidence: Evidence;
  needs_review: boolean;
  reviewed_by?: string | null;
}

// ---- document.py (ADR 0007) ----
export type DocumentType = "TFA" | "TFR" | "FI" | "SCAR" | "NCR" | "DN" | "VE" | "RFI" | "other";
export const DOCUMENT_TYPES: readonly DocumentType[] = ["TFA", "TFR", "FI", "SCAR", "NCR", "DN", "VE", "RFI", "other"] as const;

/**
 * 대장 `처리결과`(result_raw)를 정규화한 값. `ObjectState`와 무관하며 어떤 상태 전이도 일으키지 않는다(§3-1).
 * 공란·해석 불가는 UNKNOWN이고 절대 승인으로 추측하지 않는다(§3-2 규칙 1). APPROVED_WITH_COMMENTS(조건부승인)는
 * 기본적으로 승인으로 보지 않는다(§3-3) — 조건 충족 여부가 대장에 없다.
 */
export type DocumentApprovalStatus =
  | "APPROVED"
  | "APPROVED_WITH_COMMENTS"
  | "REJECTED"
  | "RESUBMIT_REQUIRED"
  | "IN_REVIEW"
  | "UNKNOWN";
export const DOCUMENT_APPROVAL_STATUSES: readonly DocumentApprovalStatus[] = [
  "APPROVED",
  "APPROVED_WITH_COMMENTS",
  "REJECTED",
  "RESUBMIT_REQUIRED",
  "IN_REVIEW",
  "UNKNOWN",
] as const;

/** 대장 한 행. PK = `(project_id, doc_id)`(ADR 0005 규칙과 같은 프로젝트 범위 키) — doc_id 단독 조회 금지 */
export interface Document {
  project_id: string;
  doc_id: string;
  doc_type: DocumentType;
  sender: string;
  sender_normalized: string;
  /** 대장 `공종` 원문. 신뢰 불가 필드(ADR 0007 §4 규칙 2) — 단독 매핑 근거가 될 수 없다 */
  discipline_raw?: string | null;
  discipline_normalized?: string | null;
  seq_raw?: string | null;
  seq_normalized?: string | null;
  /** 표시·검색 전용. 되파싱하지 않는다(§2-4) */
  doc_number?: string | null;
  title: string;
  /** 대조(매칭)용 정규화 텍스트. `config/document_register.yaml` `title_matching.normalize` 가 소유하며
   * 자유롭게 튜닝된다 — **`doc_id` 재료가 아니다**(ADR 0009 §1·§5 규칙 2) */
  title_normalized: string;
  /** 식별용 정규화 텍스트 — `doc_id` 해시에 실제로 들어간 문자열(ADR 0009 §2, `packages/core/models/document.identity_title`).
   * 코드에 동결돼 있고 config 를 읽지 않는다. "이 문서가 어떤 문자열로 해시됐는가"를 사람이 눈으로 확인
   * 하라고 응답에 실린다(ADR 0009 Consequences). 서버는 항상 채우지만 옛 응답 대비 optional 로 둔다 */
  title_identity?: string;
  issued_on?: string | null;
  /** 처리결과 원문 그대로(공백 포함). 화면은 이 값을 해석하지 않고 그대로 보여준다 */
  result_raw?: string | null;
  approval_status: DocumentApprovalStatus;
  approval_confidence: number;
  approval_evidence: Evidence;
  completed_on?: string | null;
  file_id: string;
  sheet_name: string;
  source_row: number;
  /** 처리결과를 해석하지 못했을 때 true(§3-2 규칙 3) */
  needs_review: boolean;
  /** 최근 대장 업로드에 없던 문서. 삭제하지 않고 표시만(§2-2). readiness 계산에서 제외 */
  is_orphaned: boolean;
  imported_at?: string;
  /** 이 행을 쓴 적재가 사용한 **식별 표면 지문**(ADR 0009 §5-2). 한 프로젝트의 문서에 서로 다른 지문이
   * 섞여 있으면 그 사이에 `doc_id` 재료 config 가 바뀐 것이다 — 드리프트 검토요청의
   * `previous_fingerprint`/`current_fingerprint` 와 맞춰 볼 수 있다. ADR 0009 이전 행에는 없다(null).
   * 적재 단위 값이라 코어 `Document` 가 아니라 API 의 `DocumentView` 가 얹는다. */
  identity_fingerprint?: string | null;
}

/** GET /projects/{pid}/documents 쿼리(services/api/routers/documents.py). 기본은 고아 문서를 숨긴다 —
 * objects 목록과 같은 관례. "고아만" 필터는 서버에 없다(include_orphaned 은 포함 여부만 토글) */
export interface DocumentsQuery {
  doc_type?: DocumentType;
  approval_status?: DocumentApprovalStatus;
  include_orphaned?: boolean;
  page?: number;
  page_size?: number;
}

/** GET /documents/{doc_id} 응답. 문서 상세 = 문서 한 건 + 그 문서에 걸린 Activity 매핑 전부 —
 * 객체 상세가 linked.activity_ids 를 함께 주는 것과 같은 이유로 화면이 한 번의 호출로 그린다. */
export interface DocumentDetail {
  document: Document;
  mappings: ActivityDocumentMapping[];
}

/** POST /documents/mappings/{activity_id}/{doc_id}/confirm 본문. note 는 선택 */
export interface ConfirmDocumentMappingRequest {
  note?: string | null;
}

/** 문서 ↔ Activity 매핑. 문서 ↔ 객체 직접 매핑은 만들지 않는다(§4-1 규칙 1) */
export interface ActivityDocumentMapping {
  activity_id: string;
  doc_id: string;
  confidence: number;
  evidence: Evidence;
  /** confidence 값과 무관하게 항상 true로 시작한다(§4 규칙 5) — 자동 확정 없음 */
  needs_review: boolean;
  reviewed_by?: string | null;
}

// ---- scan.py ----
export type ScanState = "NOT_BUILT" | "IN_PROGRESS" | "ESTIMATED_DONE" | "MISMATCH" | "UNVERIFIABLE";

export interface ControlPoint {
  name: string;
  scan_xyz: [number, number, number];
  model_xyz: [number, number, number];
}
export interface MarkerObservation {
  marker_id: string;
  scan_xyz: [number, number, number];
}
export interface MarkerDefinition {
  marker_id: string;
  model_xyz: [number, number, number];
}
export interface AlignmentInput {
  control_points?: ControlPoint[];
  marker_observations?: MarkerObservation[];
  marker_definitions?: MarkerDefinition[];
  scanner_position?: [number, number, number] | null;
}
export type RegistrationStatus = "ok" | "needs_alignment_input" | "registration_failed";
export interface Registration {
  scan_id: string;
  status: RegistrationStatus;
  transform?: CoordinateTransform | null;
  rmse?: number | null;
  fitness?: number | null;
  inlier_ratio?: number | null;
  method?: string | null;
  message?: string | null;
  evidence?: Evidence | null;
}
export interface ObjectDiff {
  prev_scan_id: string;
  prev_state: ScanState;
  curr_state: ScanState;
  density_delta: number;
  volume_delta?: number | null;
}
export interface ScanVerdict {
  scan_id: string;
  global_id: string;
  state: ScanState;
  confidence: number;
  evidence: Evidence;
  diff_from_previous?: ObjectDiff | null;
}

// ---- review.py ----
/**
 * `document_mapping`(ADR 0007 §4 규칙 6): 미확정 문서↔Activity 매핑의 CM 검토요청. 해소는 services/progress 소유.
 *
 * `document_identity_drift`(ADR 0009 §5-2·§5-3): 대장 원문은 그대로인데 우리 쪽 식별 규칙
 * (`sender_aliases`·`sheet_doc_types`·`column_aliases`)이 바뀌어 CM 이 이미 확정·반려한 매핑이 오염된
 * 사건을 알리는 **확인(acknowledgement) 전용** 요청이다. 오염되는 **경위는 셋**이고(`LostDecision.cause`)
 * 그중 하나만 "고아 문서를 가리키게 된 것"이다 — 나머지 둘(병합)은 고아가 아니다.
 * 해소에 부수 효과가 **없다** — `services/api/usecases.resolve_review` 에 이 kind 의 분기가 없고(계획 0003
 * §4 규칙 5가 추가를 금지한다) 공통 폴백이 검토요청 status/note/resolved_by 만 기록한다. 화면은 이 kind 에
 * "해소하면 복구된다"는 취지의 문구를 붙여서는 안 된다.
 */
export type ReviewKind = "mapping" | "verification" | "inspection" | "document_mapping" | "document_identity_drift";
export type ReviewStatus = "open" | "approved" | "rejected" | "on_hold";

/** 3중 검증 축별 근거. 서버는 자유 dict 를 주지만 화면은 이 키들을 기대한다. */
export interface ConflictingSource {
  claimed_state?: string | null;
  state?: string | null;
  confidence?: number | null;
  evidence?: Evidence | null;
  summary?: string | null;
  [key: string]: unknown;
}

export interface ReviewRequest {
  review_request_id: string;
  project_id: string;
  kind: ReviewKind;
  global_id?: string | null;
  activity_id?: string | null;
  rule_id?: string | null;
  title: string;
  /**
   * 서버는 `dict[str, Any]` 를 준다. 3중 검증(verification) 요청만 축별 `ConflictingSource` 를 담고,
   * 다른 kind 는 전혀 다른 모양을 담는다 — `document_mapping` 은 `{"doc_id": "..."}` 문자열,
   * `document_identity_drift` 는 지문 문자열과 `moved`/`merged`/`lost_decisions` 배열이다
   * (ADR 0009 §5-2 — `IdentityDriftSources` 참고).
   * 그래서 인덱스 시그니처는 `unknown` 이다. 이름 붙은 세 축은 그대로 타입이 있으므로 `AXES` 로 읽는
   * 자리(SourceCard)는 영향을 받지 않는다.
   */
  conflicting_sources: {
    daily_report?: ConflictingSource | null;
    scan?: ConflictingSource | null;
    system_logic?: ConflictingSource | null;
    [key: string]: unknown;
  };
  confidence: number;
  evidence: Evidence;
  assignee_role: "cm" | "admin";
  status: ReviewStatus;
  resolution_note?: string | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
  created_at: string;
}

/**
 * 사람의 판단(확정·반려)이 식별 드리프트로 **오염된 경위**.
 * 정본은 `packages/core/models/review.py` 의 `IDENTITY_DRIFT_CAUSE_*` 다(계획 0005 작업 7).
 * `services/ingest/persistence.py` 의 `_CAUSE_ROW_*` 는 그 정본을 가리키는 별칭이다. 소비자인
 * `services/progress/document_mapper._identity_drift_review_title` 이 CM 에게 보일 문구를 이 값으로 가른다.
 *
 * **개정 2에서 셋 다 이름이 바뀌었다**(ADR 0009 §5-2 (마)). 옛 이름은 전부 관측과 어긋나 있었다 —
 * `orphaned` 는 시트명 변경 경로에서 `moved=8` 인데 그 행들이 고아가 아니었고(실측 P3 `is_orphaned=False`),
 * `merge_*` 둘은 새 조건이 잡는 주 경로에 **병합이 없다**(실측 R1 `merged=0`). 이름이 거짓이면 그 이름으로
 * 갈린 화면 문구도 함께 거짓이 된다(CLAUDE.md §6-4).
 *
 * 셋을 하나로 뭉뚱그린 문구는 그 자체가 거짓이다 — 셋의 "그 판단이 지금 무엇을 가리키고 있는가"가 다르다:
 * - `row_moved` — 대장 행은 그대로인데 우리 식별 규칙이 그 행을 **다른 `doc_id`** 로 옮겼다. 옛 행이
 *   고아가 되는지는 이 값이 답하지 않는다(시트명 변경 경로는 고아가 되지 않는다). `new_doc_id` 위에서
 *   같은 판단을 다시 내리면 된다.
 * - `row_replaced` — 이 `doc_id` 가 담고 있던 **대장 행 자체**가 다른 행으로 바뀌었다. 행도 `reviewed_by`
 *   도 살아 있고 고아 표시조차 없으며, **다시 판단할 새 `doc_id` 가 없다**(`new_doc_id=null`).
 *   ADR 0009 §3 이 스스로 최악이라 적은 경로다 — 미승인 도면 위에서 착수 가능이 뜬다.
 * - `row_absorbed` — 판단이 가리키던 대장 행이 지금은 **다른 `doc_id` 아래**에 있고, 이 `doc_id` 에는
 *   대장 행이 남지 않았다. 그 `new_doc_id` 위에서 다시 판단한다.
 */
export type IdentityDriftCause = "row_moved" | "row_replaced" | "row_absorbed";

/**
 * `conflicting_sources.lost_decisions[]` 한 항목(`services/ingest/persistence._lost_decisions`).
 *
 * `cause` 를 `IdentityDriftCause` 로 좁히지 **않는다**: 서버가 새 경위를 추가하면 그 값이 그대로 실려 오는데,
 * 타입이 셋만 허용하면 화면은 "알 수 없는 값"이라는 갈래 자체를 잃고 아는 척하게 된다. `Blocker.kind` 와
 * 같은 처리다(`domain/identityDrift.classifyIdentityDriftCause` 가 모르는 값을 명시적으로 받아낸다).
 *
 * 뒤 세 필드(개정 2)는 **문구가 아는 것만 말하게 하려고** 서버가 싣는 값이다(ADR 0009 §5-2 (마),
 * CLAUDE.md §6-4 규칙 2 — 소비자가 산문을 되읽어 분류하지 않는다). 셋 다 `?`(선택)인 이유는 구버전
 * 응답에는 없기 때문이고, **없는 것과 `null` 은 다른 사실이다** — `new_doc_id` 참고.
 */
export interface LostDecision {
  activity_id?: string | null;
  doc_id?: string | null;
  /** `"confirmed"` | `"rejected"` (`services/ingest/persistence._DECISION_*`). */
  decision?: string | null;
  /** `IdentityDriftCause` 중 하나. 구버전 응답·새 경위에는 그 밖의 값이거나 없을 수 있다. */
  cause?: string | null;
  /**
   * 그 대장 행이 지금 있는 `doc_id`(`row_moved`/`row_absorbed`). `row_replaced` 는 **`null`** —
   * "다시 판단할 곳이 **없다**"는 사실이지 "모른다"가 아니다(ADR 0009 §5-2 (마)).
   * 필드 자체가 **없으면**(구버전 응답) 그것은 "모른다"이므로 화면은 어느 쪽도 단정하지 않는다.
   */
  new_doc_id?: string | null;
  /**
   * `row_replaced` 에서 달라진 행-정체 필드 이름(`sender`|`doc_number`|`seq_raw`|`title`,
   * `services/ingest/persistence._ROW_IDENTITY_FIELDS`). 행-내용만 달라진 경우(ADR 0009 §5-2 (나-ii))는
   * 빈 배열이고, 그때 "다른 대장 행으로 바뀌었다"고 적으면 관측하지 못한 것을 단정하는 것이 된다.
   */
  changed_fields?: string[] | null;
  /** 이번 적재에서 `approval_status` 가 달라졌는가. `row_moved`/`row_absorbed` 는 언제나 `false`. */
  approval_flipped?: boolean | null;
}

/** `document_identity_drift` 요청의 `conflicting_sources`(ADR 0009 §5-2). 3축(신고/스캔/논리)은 없다. */
export interface IdentityDriftSources {
  previous_fingerprint?: string | null;
  current_fingerprint?: string | null;
  /**
   * 이동 쌍 짝짓기 결과. `{previous_doc_id, new_doc_id, title}`
   * **"고아 ↔ 신규"가 아니다**(ADR 0009 §5-2 (가) 개정 1 정정): 좌변은 "이번 적재에 나타나지 않은 기존 행
   * 전부"이고, 시트명 변경 경로에서 그 행들은 고아가 되지 않는다(실측 `orphaned=0`, `moved=8`).
   */
  moved?: { previous_doc_id?: string; new_doc_id?: string; title?: string }[];
  /** 한 적재 안에서 한 doc_id 로 수렴한 서로 다른 대장 행(충돌 묶음). `{doc_id, titles}` */
  merged?: { doc_id?: string; titles?: string[] }[];
  lost_decisions?: LostDecision[];
}

export type ReviewDecision = "approved" | "rejected" | "on_hold";
export interface ResolveReviewRequest {
  decision: ReviewDecision;
  note?: string;
}

// ---- progress.py ----
export interface Blocker {
  component: string;
  reason: string;
  related_ids?: string[];
  severity?: "low" | "medium" | "high";
  /** 기계 판독 갈래(ADR 0007 §5-3). reason 산문 대신 이 값으로 분류한다. 구버전 응답에는 없다. */
  kind?: string | null;
}
export interface ReadinessScore {
  activity_id: string;
  score: number;
  components: Record<string, number>;
  weights: Record<string, number>;
  blockers: Blocker[];
  confidence: number;
  evidence: Evidence;
  estimated_completion?: number | null;
  computed_at: string;
}
export interface StartableSet {
  project_id: string;
  startable: string[];
  blocked: Record<string, Blocker[]>;
  threshold: number;
  solver_status: string;
  evidence: Evidence;
}
export type ClaimedState = "started" | "in_progress" | "completed";
export interface DailyReportItem {
  global_id?: string | null;
  activity_id?: string | null;
  zone?: string | null;
  level?: string | null;
  work_type?: string | null;
  quantity?: number | null;
  quantity_unit?: string | null;
  claimed_state: ClaimedState;
  photo_uris?: string[];
}
export interface DailyReportCreate {
  report_date: string; // YYYY-MM-DD
  crew_count: number;
  equipment: Record<string, number>;
  items: DailyReportItem[];
  note?: string | null;
}
export interface DailyReport extends DailyReportCreate {
  report_id: string;
  project_id: string;
  reporter_id: string;
  submitted_at: string;
}

// ---- ingest.py ----
export type IngestStatus = "ok" | "partial" | "failed" | "needs_ifc_export";
/** `xlsx`(ADR 0007 §8 규칙 1): 문서관리대장. 업로드는 그 프로젝트의 cm만(§7 규칙 1) — 다른 종류와 다르다 */
export type FileKind = "ifc" | "dxf" | "dwg" | "rvt" | "e57" | "las" | "ply" | "csv" | "xml" | "xer" | "xlsx" | "unknown";
export interface IngestWarning {
  code: string;
  message: string;
  context?: Record<string, unknown>;
}

// ---- api 계약 (services/api) ----
export interface LoginRequest {
  username: string;
  password: string;
}
export interface LoginResponse {
  access_token: string;
  token_type?: string;
  role: UserRole;
  user_id: string;
}

export interface Project {
  project_id: string;
  name: string;
  created_at?: string;
  description?: string | null;
  /** ADR 0006 §3 규칙 4: 호출자의 이 프로젝트 역할. admin=null(행위 역할 없음). 화면은 이 값으로 버튼을 가린다. */
  my_role?: ProjectRole | null;
}
export interface ProjectCreate {
  name: string;
  description?: string;
}

// ---- 멤버십 (ADR 0006 §4) ----
export interface ProjectMember {
  project_id: string;
  user_id: string;
  email?: string | null;
  role: ProjectRole;
  added_by?: string | null;
  added_at?: string | null;
}
export interface ProjectMemberCreate {
  user_id: string;
  role: ProjectRole;
}

export interface UploadResponse {
  job_id: string;
  file_id?: string;
  kind?: FileKind;
  job_kind?: JobKind;
}

export type JobStatus = "queued" | "running" | "done" | "failed";
/**
 * glossary 개정 1: scan_upload = 스캔 파일 등록(정합 입력 대기), verdict = 정합+판정.
 * document_register(ADR 0007 §8 규칙 2): 문서관리대장(xlsx) 적재 + 문서↔Activity 매핑 후보 생성
 */
export type JobKind = "ingest" | "scan_upload" | "schedule" | "mapping" | "verdict" | "document_register";
export interface Job {
  job_id: string;
  kind?: JobKind;
  status: JobStatus;
  /** 0~1 */
  progress: number;
  result_ref?: string | null;
  warnings?: (IngestWarning | string)[];
  /** ingest 결과 요약. RVT 는 status="needs_ifc_export" 가 올 수 있다. */
  result?: {
    status?: IngestStatus | string;
    source_kind?: FileKind;
    message?: string | null;
    model_id?: string;
    drawing_id?: string;
    scan_id?: string;
    stats?: Record<string, number>;
    levels?: { name: string; elevation: number }[];
  } | null;
  error?: string | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page?: number;
  page_size?: number;
}

export interface ObjectsQuery {
  level?: string;
  ifc_type?: string;
  state?: ObjectState;
  page?: number;
  page_size?: number;
}

/** glossary 개정 1 — 백엔드 state_machine.next_actions 가 정의하는 집합. 프론트는 이 집합만 사용 */
export type NextActionKind =
  | "confirm"
  | "request_inspection"
  | "reject_inspection"
  | "report_progress"
  | "accept_rework"
  | "order_rework"
  | "revoke_confirmation"
  | "flag_mismatch"
  | "resolve_review"
  | "align_scan"
  | "inspect";
export interface NextAction {
  kind: NextActionKind;
  label: string;
  allowed_roles: UserRole[];
  /** 전이 행동이면 백엔드가 항상 채운다. resolve_review / align_scan 은 null */
  to_state: ObjectState | null;
  review_request_id?: string | null;
}
export interface ObjectStateView {
  state: ObjectState;
  since?: string | null;
  actor?: Actor | null;
  actor_id?: string | null;
  confidence?: number | null;
  evidence?: Evidence | null;
  has_open_review?: boolean;
}
export interface LinkedRefs {
  entity_handles: string[];
  activity_ids: string[];
  material_ids: string[];
  drawing_id?: string | null;
  latest_scan_verdict?: ScanVerdict | null;
}
export interface ObjectDetail {
  basic: BimObjectView;
  current_state: ObjectStateView;
  history: StateTransition[];
  next_actions: NextAction[];
  linked: LinkedRefs;
}

export interface TransitionRequest {
  to_state: ObjectState;
  evidence: Evidence;
  review_request_id?: string | null;
}

export interface ModelSummary {
  model_id: string;
  project_id: string;
  name?: string | null;
  /** 3D 뷰어가 로드할 XKT/glTF URI */
  model_uri: string;
  levels: { name: string; elevation: number }[];
  coordinate_system: CoordinateSystem;
  /** 층별 단면 오프셋(모델 단위). Viewer3D.sectionOffset 으로 전달 */
  plan_section_default_offset?: number;
  version?: number;
}
export interface DrawingSummary {
  drawing_id: string;
  project_id: string;
  name?: string | null;
  level?: string | null;
  coordinate_system: CoordinateSystem;
  svg_uri?: string | null;
}
export interface DrawingEntitiesResponse {
  drawing_id: string;
  entities: DrawingEntityView[];
  coordinate_system: CoordinateSystem;
  svg_uri?: string | null;
}
export interface ScanSummary {
  scan_id: string;
  project_id: string;
  name?: string | null;
  pointcloud_uri?: string | null;
  registration?: Registration | null;
}

/** GET /models/{id}/plan-section 응답. viewer3d/viewer2d 의 PlanSection 과 동일 구조(snake_case, CLAUDE.md §3 규칙 12). */
export interface PlanSection {
  level: string;
  elevation: number;
  /** 층 elevation 에 더한 오프셋(모델 단위). models.plan_section_default_offset 이 없을 때 sectionOffset 폴백 */
  offset?: number;
  coordinate_system: CoordinateSystem;
  svg?: string;
  polylines: Array<{ global_id: string; points: [number, number][]; closed?: boolean }>;
}

export interface StateDistributionRow {
  level: string;
  /** 부재 그룹(IFC_TYPE_GROUP: column/beam/slab/…). 공종(discipline)과 다른 개념 */
  group: string;
  counts: Partial<Record<ObjectState, number>>;
  total?: number;
}
export interface StartableActivityView {
  activity_id: string;
  name?: string | null;
  readiness?: number | null;
  confidence?: number | null;
  evidence?: Evidence | null;
  blockers: Blocker[];
}
export interface WeeklySummary {
  project_id: string;
  week_start: string;
  week_end: string;
  state_distribution: StateDistributionRow[];
  confirmed_this_week: number;
  open_reviews: number;
  open_reviews_by_kind?: Partial<Record<ReviewKind, number>>;
  startable: StartableActivityView[];
}
