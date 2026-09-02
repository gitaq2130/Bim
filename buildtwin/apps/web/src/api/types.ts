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
  | "user_input";

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
export type ReviewKind = "mapping" | "verification" | "inspection";
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
  conflicting_sources: {
    daily_report?: ConflictingSource | null;
    scan?: ConflictingSource | null;
    system_logic?: ConflictingSource | null;
    [key: string]: ConflictingSource | null | undefined;
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
export type FileKind = "ifc" | "dxf" | "dwg" | "rvt" | "e57" | "las" | "ply" | "csv" | "xml" | "xer" | "unknown";
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
}
export interface ProjectCreate {
  name: string;
  description?: string;
}

export interface UploadResponse {
  job_id: string;
  file_id?: string;
  kind?: FileKind;
}

export type JobStatus = "queued" | "running" | "done" | "failed";
export interface Job {
  job_id: string;
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

export type NextActionKind = "confirm" | "inspect" | "reject" | "resolve_review" | "align_scan" | "report" | string;
export interface NextAction {
  kind: NextActionKind;
  label: string;
  allowed_roles: UserRole[];
  to_state?: ObjectState | null;
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

export interface PlanSection {
  level: string;
  elevation: number;
  coordinateSystem: CoordinateSystem;
  svg?: string;
  polylines: Array<{ globalId: string; points: [number, number][] }>;
}

export interface StateDistributionRow {
  level: string;
  discipline: string;
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
