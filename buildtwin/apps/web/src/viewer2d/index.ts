export { Viewer2D, HIGHLIGHT_CLASS, SELECTED_CLASS } from "./Viewer2D";
export { default } from "./Viewer2D";
export type {
  BBox2D,
  BBox3D,
  CoordinateSource,
  CoordinateSystem,
  CoordinateTransform,
  DrawingEntityView,
  OverlayOptions,
  PlanSection,
  ViewBox,
  Viewer2DHandle,
  Viewer2DProps,
  Viewport,
} from "./types";
export {
  buildSvgModel,
  entityToSvg,
  entityBBox,
  computeDrawingBBox,
  viewBoxFromBBox,
  viewBoxToDrawingBBox,
  drawingToSvg,
  svgToDrawing,
  layerColor,
  DEFAULT_LAYER_PALETTE,
  ROOT_FLIP_TRANSFORM,
  svgModelToString,
  descriptorToString,
} from "./dxfToSvg";
export type { SvgElementDescriptor, LayerGroup, SvgModel, BuildSvgModelOptions } from "./dxfToSvg";
export {
  entitiesInBBox,
  hitTestHandle,
  clientToDrawing,
  clientToSvg,
  drawingToClient,
  svgUnitsPerPixel,
  bboxIntersects,
  bboxContains,
  normalizeBBox,
} from "./selection";
export type { RectLike, SelectionMode } from "./selection";
export {
  projectSection,
  overlayToSvg,
  applyTransform2D,
  isIdentityTransform,
  toMatrix,
  clampOpacity,
  IDENTITY_4X4,
  DEFAULT_OVERLAY_COLOR,
} from "./overlay";
export type { ProjectedPolyline, ProjectOptions, OverlaySvgOptions, TransformInput } from "./overlay";
