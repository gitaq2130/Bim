/**
 * viewer2d 공개 타입.
 *
 * - DrawingEntityView 는 packages/core/models/identity.py 의 DrawingEntityDraft 를 그대로 옮긴 것이다.
 * - CoordinateSystem / CoordinateTransform / BBox2D 는 packages/core/models/coordinate.py 와 구조가 같다.
 * - PlanSection 은 viewer3d 가 만드는 형태(level, elevation, coordinateSystem, polylines)와 import-호환이다.
 *
 * 이 모듈은 엔티티 handle 만 이해한다. globalId ↔ handle 매핑은 sync-2d3d 의 일이다.
 */

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

export interface BBox2D {
  min: [number, number];
  max: [number, number];
}

export interface BBox3D {
  min: [number, number, number];
  max: [number, number, number];
}

/** packages/core/models/coordinate.py 의 CoordinateSystem 과 동일 구조. 값은 항상 DB/사용자 입력에서 온다. */
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

/** 4x4 동차 변환행렬(행 우선). [x, y, 0, 1] 에 곱한다. */
export type CoordinateTransform = number[][];

/** DrawingEntityDraft(identity.py) 의 TS 미러. points 는 원본 도면 단위(y-up). */
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

/** viewer3d 의 PlanSection 과 동일 형태(svg 는 옵션). 좌표는 모델 좌표계 그대로 온다. */
export interface PlanSection {
  level: string;
  elevation: number;
  coordinateSystem: CoordinateSystem;
  svg?: string;
  polylines: Array<{ globalId: string; points: [number, number][] }>;
}

/** SVG viewBox (SVG 좌표계, y-down). */
export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  /** 현재 viewBox (SVG 좌표, y-down). */
  viewBox: ViewBox;
  /** 현재 보이는 영역을 도면 좌표(y-up)로 표현한 bbox. */
  drawingBBox: BBox2D;
  /** 도면 전체 bbox (도면 좌표). */
  drawingExtent: BBox2D;
}

export interface OverlayOptions {
  opacity?: number;
  /** 모델 좌표 → 도면 좌표 4x4 행렬. 없으면 identity 로 간주하고 경고를 남긴다. */
  transform?: CoordinateTransform;
  color?: string;
  strokeWidth?: number;
}

export interface Viewer2DHandle {
  /** entityHandle 목록을 하이라이트. 알 수 없는 handle 은 무시한다. */
  highlight(ids: string[], opts?: { exclusive?: boolean }): void;
  clearHighlight(): void;
  /** 해당 엔티티 bbox 중심으로 viewBox 를 옮긴다. zoom 은 배율(1 = 유지). */
  panTo(id: string, opts?: { zoom?: number }): void;
  setOverlay(section: PlanSection | null, opts?: OverlayOptions): void;
  setOverlayOpacity(opacity: number): void;
  fitToView(): void;
  getViewport(): Viewport;
}

export interface Viewer2DProps {
  drawingId: string;
  entities: DrawingEntityView[];
  coordinateSystem: CoordinateSystem;
  onSelect?: (id: string | null) => void;
  onAreaSelect?: (ids: string[], bbox: BBox2D) => void;
  onHover?: (id: string | null) => void;
  /** 하이라이트 색(viewer 전용 cosmetics). */
  highlightColor?: string;
  /** 제어형 선택 상태. 주어지면 highlight 와 별개로 `.selected` 클래스를 붙인다. */
  selectedIds?: string[];
  className?: string;
  style?: React.CSSProperties;
}
