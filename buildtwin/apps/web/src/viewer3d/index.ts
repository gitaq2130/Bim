export { Viewer3D, DEFAULT_BACKGROUND, DEFAULT_HOVER_THROTTLE_MS } from "./Viewer3D";
export { default } from "./Viewer3D";
export { STATE_COLORS, STATE_LABELS_KO, DEFAULT_STATE, HIGHLIGHT_EMISSIVE, EDGE_COLOR, colorForState } from "./colors";
export { MeshBundleLoader, buildGeometry, disposeModel, box3ToBBox, isValidEntry } from "./loader";
export type { LoadedModel, LoadedObject, MeshBundleLoaderOptions } from "./loader";
export {
  slicePlan,
  sliceMeshSegments,
  chainSegments,
  simplifyCollinear,
  polylinesToSvg,
  polylinesBounds,
} from "./section";
export type { SliceableMesh, SliceOptions, Segment2 } from "./section";
export { parseXyz, geometryFromXyz, matrix4FromTransform, loadPointCloudPoints, DEFAULT_POINT_SIZE } from "./pointcloud";
export { OBJECT_STATES } from "./types";
export type {
  ObjectState,
  CoordinateSource,
  CoordinateSystem,
  CoordinateTransform,
  BBox2D,
  BBox3D,
  Vec2,
  Vec3,
  MeshBundle,
  MeshBundleEntry,
  LevelInfo,
  PlanSection,
  SectionPolyline,
  HighlightOptions,
  Viewer3DHandle,
  Viewer3DProps,
} from "./types";
