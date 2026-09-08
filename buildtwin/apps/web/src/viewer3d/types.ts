/**
 * viewer3d 공개 타입.
 *
 * 이 모듈은 IFC GlobalId만 안다. 2D 엔티티 handle·스토어·상태 전이 로직은 알지 못한다.
 * 좌표계 타입은 packages/core/models/coordinate.py 와 동일한 필드명(snake_case)을 그대로 쓴다.
 */

// ---------------------------------------------------------------------------
// 객체 상태 (ADR 0001 / docs/glossary.md)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 좌표계 (packages/core/models/coordinate.py 미러)
// ---------------------------------------------------------------------------

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

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export interface BBox3D {
  min: Vec3;
  max: Vec3;
}

export interface BBox2D {
  min: Vec2;
  max: Vec2;
}

/** 어떤 파일/데이터의 좌표계 정의. 값은 항상 DB·사용자 입력에서 온다(하드코딩 금지). */
export interface CoordinateSystem {
  source: CoordinateSource;
  origin: Vec3;
  /** Z축 회전(도) */
  rotation_deg: number;
  /** 이 좌표계 1단위 → 미터 */
  scale: number;
  unit: string;
  epsg?: number | null;
  extent?: BBox3D | null;
  notes?: string | null;
}

/** 4x4 동차 변환행렬(행 우선). from_source 좌표 → to_source 좌표. */
export interface CoordinateTransform {
  /** 4행 x 4열, 행 우선(row-major). */
  matrix: number[][];
  from_source: CoordinateSource;
  to_source?: CoordinateSource;
  rmse?: number | null;
  method?: string | null;
}

// ---------------------------------------------------------------------------
// 메시 번들 (services/ingest 출력)
// ---------------------------------------------------------------------------

/** 객체 하나의 삼각형 메시. 월드 좌표, 미터 단위. */
export interface MeshBundleEntry {
  /** flat xyz: [x0,y0,z0, x1,y1,z1, ...] */
  vertices: number[];
  /** flat triangle indices: [a0,b0,c0, a1,b1,c1, ...] */
  faces: number[];
}

/** `{ [globalId]: MeshBundleEntry }` */
export type MeshBundle = Record<string, MeshBundleEntry>;

// ---------------------------------------------------------------------------
// 층 / 단면
// ---------------------------------------------------------------------------

/** IfcBuildingStorey 기준 층 정보. elevation 은 모델 좌표계 Z(모델 단위). */
export interface LevelInfo {
  name: string;
  elevation: number;
}

export interface SectionPolyline {
  global_id: string;
  /** 모델 좌표계 XY (변환 없음) */
  points: Vec2[];
  /** 마지막 점이 첫 점과 이어지면 true (중복 점은 포함하지 않는다) */
  closed: boolean;
}

export interface PlanSection {
  level: string;
  /** 실제로 자른 높이 = 층 elevation + offset (모델 단위) */
  elevation: number;
  /** 모델 좌표계(packages/core 와 동일 구조). 변환은 sync-2d3d 가 담당. */
  coordinate_system: CoordinateSystem;
  /** 옵션: 단순 SVG 문자열 */
  svg?: string;
  polylines: SectionPolyline[];
}

// ---------------------------------------------------------------------------
// 컴포넌트 계약
// ---------------------------------------------------------------------------

export interface HighlightOptions {
  /** true 면 나머지 객체를 반투명 처리한다. */
  exclusive?: boolean;
}

export interface Viewer3DHandle {
  highlight(globalIds: string[], opts?: HighlightOptions): void;
  clearHighlight(): void;
  /** 객체 bbox 에 맞춰 카메라를 애니메이션 이동. 객체가 없으면 즉시 resolve. */
  flyTo(globalId: string): Promise<void>;
  setState(globalId: string, state: ObjectState): void;
  setStates(map: Record<string, ObjectState>): void;
  /**
   * 층별 평면 단면. `offset` 을 생략하면 props.sectionOffset(필수, 서버 값) 을 쓴다.
   * levels 는 props.levels 에서 찾는다. 없는 층이면 reject.
   */
  getPlanSection(level: string, offset?: number): Promise<PlanSection>;
  togglePointCloud(visible: boolean): void;
  /** PLY(binary/ascii) 또는 ascii xyz. transform 은 반드시 인자로 받는다(하드코딩 금지). */
  loadPointCloud(url: string, transform: CoordinateTransform): Promise<void>;
  /** null 이면 전체 표시 복원 */
  isolate(globalIds: string[] | null): void;
  /** 로드된 GlobalId 목록 (디버그·테스트용) */
  getObjectIds(): string[];
}

export interface Viewer3DProps {
  /** JSON 메시 번들 URL (`{ [globalId]: { vertices, faces } }`) */
  modelUrl: string;
  onSelect?: (globalId: string | null) => void;
  onHover?: (globalId: string | null) => void;
  /** 로드 직후 한 번 적용되는 상태 맵 */
  initialStates?: Record<string, ObjectState>;
  /** 변경될 때마다 재적용되는 상태 맵 (setStates 와 동일 효과) */
  stateMap?: Record<string, ObjectState>;
  /** 층 목록. getPlanSection 이 참조한다. */
  levels?: LevelInfo[];
  /** 단면 오프셋(모델 단위). 필수 — 서버(models.plan_section_default_offset 또는 plan-section.offset)에서 온다. 뷰어에 숫자 기본값 없음. */
  sectionOffset: number;
  /** 모델 좌표계. 생략 시 ifc_local 항등 좌표계로 보고한다. */
  coordinateSystem?: CoordinateSystem;
  /** 마운트 시 자동 로드할 포인트클라우드 (transform 과 함께 주어야 한다) */
  pointCloudUrl?: string;
  pointCloudTransform?: CoordinateTransform;
  /** 포인트 크기(모델 단위). 기본 0.02 */
  pointSize?: number;
  /** 선택 외곽선(EdgesGeometry) 표시. 기본 true */
  showEdges?: boolean;
  /** 배경색 (CSS hex). 기본 #F5F5F5 */
  background?: string;
  /** onHover 스로틀(ms). 기본 50 */
  hoverThrottleMs?: number;
  onLoad?: (info: { objectCount: number; bbox: BBox3D }) => void;
  onError?: (err: unknown) => void;
  className?: string;
  style?: React.CSSProperties;
}
