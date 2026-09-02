/**
 * 뷰어 핸들 계약 (.claude/agents/viewer-3d.md / viewer-2d.md 에서 복사).
 * frontend·sync 는 이 타입으로만 뷰어를 다룬다. 실제 구현은 src/viewer3d, src/viewer2d.
 */
import type { CoordinateSystem, ObjectState, PlanSection, BBox2D, DrawingEntityView } from "../api/types";

export type { CoordinateSystem, ObjectState, PlanSection, BBox2D, DrawingEntityView };

/** 뷰어에 넘기는 4x4 행렬 (viewer2d/types.ts 의 CoordinateTransform 과 동일). */
export type ViewerTransform = number[][];

export interface Viewer3DHandle {
  highlight(globalIds: string[], opts?: { exclusive?: boolean }): void;
  clearHighlight(): void;
  flyTo(globalId: string): Promise<void>;
  setState(globalId: string, state: ObjectState): void;
  setStates(map: Record<string, ObjectState>): void;
  getPlanSection(level: string): Promise<PlanSection>;
  togglePointCloud(visible: boolean): void;
  loadPointCloud(url: string, transform: ViewerTransform): Promise<void>;
  isolate(globalIds: string[] | null): void;
}

export interface Viewer3DProps {
  modelUrl: string;
  onSelect?: (globalId: string | null) => void;
  onHover?: (globalId: string | null) => void;
  initialStates?: Record<string, ObjectState>;
  className?: string;
  style?: React.CSSProperties;
}

export interface Viewer2DHandle {
  highlight(ids: string[], opts?: { exclusive?: boolean }): void;
  clearHighlight(): void;
  panTo(id: string, opts?: { zoom?: number }): void;
  setOverlay(section: PlanSection | null, opts?: { opacity?: number; transform?: ViewerTransform }): void;
  setOverlayOpacity(opacity: number): void;
  fitToView(): void;
}

export interface Viewer2DProps {
  drawingId: string;
  entities: DrawingEntityView[];
  coordinateSystem: CoordinateSystem;
  onSelect?: (id: string | null) => void;
  onAreaSelect?: (ids: string[], bbox: BBox2D) => void;
  onHover?: (id: string | null) => void;
  className?: string;
  style?: React.CSSProperties;
}
