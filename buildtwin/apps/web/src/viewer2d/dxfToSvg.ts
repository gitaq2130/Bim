/**
 * DXF 엔티티 → SVG 요소 기술자(descriptor) 변환. 순수 함수만 있다(DOM/React 의존 없음).
 *
 * 좌표 규칙:
 * - 엔티티 좌표는 원본 도면 단위(y-up) 그대로 SVG 속성에 쓴다. 엔티티별 y 반전 계산은 하지 않는다.
 * - DXF(y-up) ↔ SVG(y-down) 반전은 루트 `<g transform="scale(1,-1)">` 하나로만 처리하고,
 *   viewBox 는 도면 bbox 에서 유도한다(`viewBoxFromBBox`). 특정 도면에 묶인 상수는 없다.
 * - 텍스트·블록 마커처럼 "글리프 방향"이 있는 요소만 자기 로컬 프레임에서 되돌린다(위치 계산은 여전히 루트 변환).
 */
import type { BBox2D, DrawingEntityView, ViewBox } from "./types";

export interface SvgElementDescriptor {
  tag: string;
  attrs: Record<string, string | number>;
  handle: string;
  layer: string;
  /** TEXT/MTEXT 의 본문. */
  text?: string;
  /** INSERT 마커 등 자식 요소. */
  children?: SvgElementDescriptor[];
}

export interface LayerGroup {
  layer: string;
  index: number;
  color: string;
  elements: SvgElementDescriptor[];
}

export interface SvgModel {
  /** 도면 좌표(y-up) 전체 bbox. 엔티티가 없으면 null. */
  bbox: BBox2D | null;
  /** SVG 좌표(y-down) viewBox. bbox 에서 유도. */
  viewBox: ViewBox;
  /** 루트 `<g>` 에 붙일 변환. y 반전 단 하나. */
  rootTransform: string;
  layers: LayerGroup[];
  /** handle → 도면 bbox. 선택·panTo 용. */
  bboxByHandle: Map<string, BBox2D>;
}

/** 레이어 인덱스별 기본 색(viewer 전용 cosmetics). */
export const DEFAULT_LAYER_PALETTE: readonly string[] = [
  "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
  "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf",
];

export function layerColor(index: number, palette: readonly string[] = DEFAULT_LAYER_PALETTE): string {
  const p = palette.length > 0 ? palette : DEFAULT_LAYER_PALETTE;
  return p[((index % p.length) + p.length) % p.length] as string;
}

/** 속성 문자열 길이를 줄이기 위한 숫자 정리(소수 4자리). */
export function num(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

export function pointsAttr(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y]) => `${num(x)},${num(y)}`).join(" ");
}

// ---------------------------------------------------------------- bbox

export function unionBBox(a: BBox2D | null, b: BBox2D | null): BBox2D | null {
  if (!a) return b;
  if (!b) return a;
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1])],
  };
}

export function bboxFromPoints(points: readonly (readonly [number, number])[]): BBox2D | null {
  if (points.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { min: [minX, minY], max: [maxX, maxY] };
}

export function bboxCenter(b: BBox2D): [number, number] {
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2];
}

function attrNumber(attrs: Record<string, unknown> | undefined, key: string): number | undefined {
  const v = attrs?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function attrPoint(attrs: Record<string, unknown> | undefined, key: string): [number, number] | undefined {
  const v = attrs?.[key];
  if (Array.isArray(v) && v.length >= 2 && typeof v[0] === "number" && typeof v[1] === "number") {
    return [v[0], v[1]];
  }
  return undefined;
}

/** 엔티티의 도면 좌표 bbox. 서버가 준 bbox 가 있으면 그것을 우선 쓴다. */
export function entityBBox(e: DrawingEntityView): BBox2D | null {
  if (e.bbox) return e.bbox;
  const type = e.dxftype.toUpperCase();
  const pts = e.points ?? [];
  if (type === "CIRCLE" || type === "ARC") {
    const c = pts[0] ?? attrPoint(e.attrs, "center") ?? e.insert_point ?? null;
    const r = e.radius ?? attrNumber(e.attrs, "radius") ?? 0;
    if (c) return { min: [c[0] - r, c[1] - r], max: [c[0] + r, c[1] + r] };
    return null;
  }
  if (type === "INSERT" || type === "TEXT" || type === "MTEXT") {
    const p = e.insert_point ?? pts[0] ?? null;
    const fromPts = bboxFromPoints(pts);
    if (p) return unionBBox(fromPts, { min: [p[0], p[1]], max: [p[0], p[1]] });
    return fromPts;
  }
  return bboxFromPoints(pts);
}

export function computeDrawingBBox(entities: readonly DrawingEntityView[]): BBox2D | null {
  let acc: BBox2D | null = null;
  for (const e of entities) acc = unionBBox(acc, entityBBox(e));
  return acc;
}

// ---------------------------------------------------------------- viewBox / y-flip

/** y 반전 루트 변환. 도면(y-up) → SVG(y-down). */
export const ROOT_FLIP_TRANSFORM = "scale(1,-1)";

/** 도면 점 → SVG 점 (루트 변환과 동일: y 부호 반전). */
export function drawingToSvg(p: readonly [number, number]): [number, number] {
  return [p[0], 0 - p[1]];
}

/** SVG 점 → 도면 점. */
export function svgToDrawing(p: readonly [number, number]): [number, number] {
  return [p[0], 0 - p[1]];
}

/**
 * 도면 bbox(y-up) → SVG viewBox(y-down). 루트 scale(1,-1) 아래에서 도면 y ∈ [minY, maxY] 는 SVG y ∈ [-maxY, -minY].
 * paddingRatio 는 bbox 크기 대비 여백 비율(도면 상수 아님).
 */
export function viewBoxFromBBox(bbox: BBox2D | null, paddingRatio = 0.05): ViewBox {
  if (!bbox) return { x: 0, y: -1, width: 1, height: 1 };
  const w = Math.max(bbox.max[0] - bbox.min[0], 0);
  const h = Math.max(bbox.max[1] - bbox.min[1], 0);
  const base = Math.max(w, h) || 1;
  const pad = base * paddingRatio;
  return {
    x: bbox.min[0] - pad,
    y: -bbox.max[1] - pad,
    width: (w || base) + pad * 2,
    height: (h || base) + pad * 2,
  };
}

/** SVG viewBox → 보이는 영역의 도면 bbox. */
export function viewBoxToDrawingBBox(vb: ViewBox): BBox2D {
  return { min: [vb.x, -(vb.y + vb.height)], max: [vb.x + vb.width, -vb.y] };
}

// ---------------------------------------------------------------- entity → descriptor

export interface EntityToSvgOptions {
  /** INSERT 마커 크기(도면 단위). 기본값은 도면 bbox 에서 유도(`buildSvgModel`). */
  markerSize?: number;
  /** HATCH 채움 불투명도. */
  hatchFillOpacity?: number;
}

function isClosed(e: DrawingEntityView): boolean {
  const a = e.attrs ?? {};
  if (a.closed === true || a.is_closed === true) return true;
  const flags = attrNumber(a, "flags");
  return flags !== undefined && (flags & 1) === 1;
}

function base(e: DrawingEntityView, tag: string, attrs: Record<string, string | number>): SvgElementDescriptor {
  return { tag, attrs, handle: e.handle, layer: e.layer };
}

export function arcPath(center: readonly [number, number], r: number, startDeg: number, endDeg: number): string {
  const toRad = (d: number) => (d * Math.PI) / 180;
  let sweep = ((endDeg - startDeg) % 360 + 360) % 360;
  if (sweep === 0 && endDeg !== startDeg) sweep = 360;
  const sx = center[0] + r * Math.cos(toRad(startDeg));
  const sy = center[1] + r * Math.sin(toRad(startDeg));
  if (sweep >= 360) {
    // 완전한 원: 반원 두 개로
    const mx = center[0] + r * Math.cos(toRad(startDeg + 180));
    const my = center[1] + r * Math.sin(toRad(startDeg + 180));
    return `M ${num(sx)} ${num(sy)} A ${num(r)} ${num(r)} 0 1 1 ${num(mx)} ${num(my)} A ${num(r)} ${num(r)} 0 1 1 ${num(sx)} ${num(sy)}`;
  }
  const ex = center[0] + r * Math.cos(toRad(endDeg));
  const ey = center[1] + r * Math.sin(toRad(endDeg));
  const largeArc = sweep > 180 ? 1 : 0;
  // DXF 호는 반시계(CCW). 도면(y-up) 프레임에서 sweep-flag=1 이 양의 각 방향(CCW)이다.
  return `M ${num(sx)} ${num(sy)} A ${num(r)} ${num(r)} 0 ${largeArc} 1 ${num(ex)} ${num(ey)}`;
}

/** 엔티티 하나 → SVG 요소 기술자. 지원하지 않는 타입은 null. */
export function entityToSvg(e: DrawingEntityView, opts: EntityToSvgOptions = {}): SvgElementDescriptor | null {
  const type = e.dxftype.toUpperCase();
  const pts = e.points ?? [];
  const a = e.attrs ?? {};

  switch (type) {
    case "LINE": {
      const p0 = pts[0], p1 = pts[1];
      if (!p0 || !p1) return null;
      return base(e, "line", { x1: num(p0[0]), y1: num(p0[1]), x2: num(p1[0]), y2: num(p1[1]) });
    }
    case "LWPOLYLINE":
    case "POLYLINE": {
      if (pts.length < 2) return null;
      const closed = isClosed(e);
      const d = base(e, closed ? "polygon" : "polyline", { points: pointsAttr(pts), fill: "none" });
      if (closed) d.attrs["data-closed"] = "true";
      return d;
    }
    case "CIRCLE": {
      const c = pts[0] ?? attrPoint(a, "center") ?? e.insert_point;
      const r = e.radius ?? attrNumber(a, "radius");
      if (!c || r === undefined) return null;
      return base(e, "circle", { cx: num(c[0]), cy: num(c[1]), r: num(r), fill: "none" });
    }
    case "ARC": {
      const c = pts[0] ?? attrPoint(a, "center") ?? e.insert_point;
      const r = e.radius ?? attrNumber(a, "radius");
      const start = attrNumber(a, "start_angle") ?? attrNumber(a, "startAngle");
      const end = attrNumber(a, "end_angle") ?? attrNumber(a, "endAngle");
      if (!c || r === undefined || start === undefined || end === undefined) {
        // 각도가 없고 점만 있으면 폴리라인으로 근사
        if (pts.length >= 2) return base(e, "polyline", { points: pointsAttr(pts), fill: "none" });
        return null;
      }
      return base(e, "path", { d: arcPath(c, r, start, end), fill: "none" });
    }
    case "INSERT": {
      const p = e.insert_point ?? pts[0];
      if (!p) return null;
      const rot = e.rotation_deg ?? 0;
      const [sx, sy] = e.scale ?? [1, 1];
      const size = opts.markerSize ?? 1;
      const h = size / 2;
      const transform = `translate(${num(p[0])},${num(p[1])}) rotate(${num(rot)}) scale(${num(sx)},${num(sy)})`;
      const d = base(e, "g", { transform, "data-block": e.block_name ?? "", class: "insert-marker" });
      d.children = [
        { tag: "line", attrs: { x1: num(-h), y1: 0, x2: num(h), y2: 0 }, handle: e.handle, layer: e.layer },
        { tag: "line", attrs: { x1: 0, y1: num(-h), x2: 0, y2: num(h) }, handle: e.handle, layer: e.layer },
        { tag: "circle", attrs: { cx: 0, cy: 0, r: num(h * 0.6), fill: "none" }, handle: e.handle, layer: e.layer },
      ];
      return d;
    }
    case "TEXT":
    case "MTEXT": {
      const p = e.insert_point ?? pts[0];
      if (!p) return null;
      const height = attrNumber(a, "height") ?? attrNumber(a, "char_height") ?? opts.markerSize ?? 1;
      const rot = e.rotation_deg ?? attrNumber(a, "rotation") ?? 0;
      // 위치는 루트 변환이 처리. 글리프가 뒤집히지 않도록 로컬 프레임만 되돌린다.
      const transform = `translate(${num(p[0])},${num(p[1])}) scale(1,-1) rotate(${num(-rot)})`;
      const d = base(e, "text", { transform, "font-size": num(height), stroke: "none", "data-text": e.text ?? "" });
      d.text = e.text ?? "";
      return d;
    }
    case "HATCH": {
      if (pts.length < 3) return null;
      return base(e, "polygon", {
        points: pointsAttr(pts),
        "fill-opacity": opts.hatchFillOpacity ?? 0.25,
        stroke: "none",
        "data-hatch": "true",
      });
    }
    default:
      // 알 수 없는 타입: 점이 있으면 폴리라인으로라도 그린다(클릭 가능해야 하므로).
      if (pts.length >= 2) return base(e, "polyline", { points: pointsAttr(pts), fill: "none", "data-fallback": type });
      return null;
  }
}

// ---------------------------------------------------------------- model

export interface BuildSvgModelOptions extends EntityToSvgOptions {
  palette?: readonly string[];
  paddingRatio?: number;
  /** INSERT 마커 크기를 도면 bbox 최대 변 대비 비율로 정한다(markerSize 가 없을 때). */
  markerSizeRatio?: number;
}

/** 엔티티를 레이어별 `<g data-layer>` 로 묶고 viewBox·루트 변환을 계산한다. */
export function buildSvgModel(entities: readonly DrawingEntityView[], opts: BuildSvgModelOptions = {}): SvgModel {
  const bbox = computeDrawingBBox(entities);
  const bboxByHandle = new Map<string, BBox2D>();
  const extent = bbox ? Math.max(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1]) : 0;
  const markerSize = opts.markerSize ?? (extent > 0 ? extent * (opts.markerSizeRatio ?? 0.01) : 1);

  const layerMap = new Map<string, LayerGroup>();
  for (const e of entities) {
    const b = entityBBox(e);
    if (b) bboxByHandle.set(e.handle, b);
    const d = entityToSvg(e, { markerSize, hatchFillOpacity: opts.hatchFillOpacity });
    if (!d) continue;
    let g = layerMap.get(e.layer);
    if (!g) {
      const index = layerMap.size;
      g = { layer: e.layer, index, color: layerColor(index, opts.palette), elements: [] };
      layerMap.set(e.layer, g);
    }
    g.elements.push(d);
  }

  return {
    bbox,
    viewBox: viewBoxFromBBox(bbox, opts.paddingRatio),
    rootTransform: ROOT_FLIP_TRANSFORM,
    layers: [...layerMap.values()],
    bboxByHandle,
  };
}

// ---------------------------------------------------------------- string serialisation (서버·테스트용)

function escapeAttr(v: string | number): string {
  return String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeText(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function descriptorToString(d: SvgElementDescriptor): string {
  const attrs = Object.entries(d.attrs).map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join("");
  const open = `<${d.tag} data-handle="${escapeAttr(d.handle)}" data-layer="${escapeAttr(d.layer)}"${attrs}>`;
  const inner = (d.children ?? []).map(descriptorToString).join("") + (d.text !== undefined ? escapeText(d.text) : "");
  return `${open}${inner}</${d.tag}>`;
}

/** 전체 모델을 SVG 문자열로(디버깅·스냅샷용. 컴포넌트는 React 요소로 직접 렌더). */
export function svgModelToString(model: SvgModel): string {
  const vb = model.viewBox;
  const layers = model.layers
    .map((g) => `<g data-layer="${escapeAttr(g.layer)}" stroke="${g.color}">${g.elements.map(descriptorToString).join("")}</g>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(vb.x)} ${num(vb.y)} ${num(vb.width)} ${num(vb.height)}"><g transform="${model.rootTransform}">${layers}</g></svg>`;
}
