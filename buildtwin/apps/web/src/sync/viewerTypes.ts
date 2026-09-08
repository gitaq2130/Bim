/**
 * 뷰어 핸들 계약. 실제 구현 모듈의 index 배럴(src/viewer3d, src/viewer2d)에서만 타입을 재노출한다.
 * frontend·sync 는 이 파일을 통해서만 뷰어 타입을 참조한다 (구현 내부 파일 접근 금지).
 */
export type {
  Viewer3DHandle,
  Viewer3DProps,
  PlanSection,
  CoordinateSystem as ViewerCoordinateSystem,
  CoordinateTransform as ViewerCoordinateTransform,
  LevelInfo,
  ObjectState,
} from "../viewer3d";
export type { Viewer2DHandle, Viewer2DProps, DrawingEntityView, BBox2D } from "../viewer2d";
