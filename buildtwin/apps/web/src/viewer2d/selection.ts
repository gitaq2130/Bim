/**
 * 영역 드래그(rubber-band) 선택과 클릭 hit-test. 순수 함수.
 * 좌표 변환(client px → SVG viewBox → 도면)은 여기서 하나의 함수(`clientToDrawing`)로만 한다.
 */
import { drawingToSvg, entityBBox, svgToDrawing } from "./dxfToSvg";
import type { BBox2D, DrawingEntityView, ViewBox } from "./types";

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function bboxIntersects(a: BBox2D, b: BBox2D): boolean {
  return !(a.max[0] < b.min[0] || b.max[0] < a.min[0] || a.max[1] < b.min[1] || b.max[1] < a.min[1]);
}

export function bboxContains(outer: BBox2D, inner: BBox2D): boolean {
  return inner.min[0] >= outer.min[0] && inner.min[1] >= outer.min[1]
    && inner.max[0] <= outer.max[0] && inner.max[1] <= outer.max[1];
}

/** 두 점(어느 순서든)에서 정규화된 bbox. */
export function normalizeBBox(p1: readonly [number, number], p2: readonly [number, number]): BBox2D {
  return {
    min: [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1])],
    max: [Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])],
  };
}

export type SelectionMode = "intersect" | "contain";

/**
 * 도면 좌표 bbox 와 교차(기본) 또는 완전히 포함되는 엔티티 handle 목록.
 * `bboxByHandle` 을 주면 재계산 없이 그것을 쓴다.
 */
export function entitiesInBBox(
  entities: readonly DrawingEntityView[],
  bbox: BBox2D,
  opts: { mode?: SelectionMode; bboxByHandle?: ReadonlyMap<string, BBox2D> } = {},
): string[] {
  const mode = opts.mode ?? "intersect";
  const out: string[] = [];
  for (const e of entities) {
    const b = opts.bboxByHandle?.get(e.handle) ?? entityBBox(e);
    if (!b) continue;
    const hit = mode === "contain" ? bboxContains(bbox, b) : bboxIntersects(bbox, b);
    if (hit) out.push(e.handle);
  }
  return out;
}

/** 이벤트 위임용: target 에서 가장 가까운 `[data-handle]` 조상의 handle. 없으면 null. */
export function hitTestHandle(target: EventTarget | null): string | null {
  if (!target || typeof (target as Element).closest !== "function") return null;
  const el = (target as Element).closest("[data-handle]");
  if (!el) return null;
  const h = el.getAttribute("data-handle");
  return h && h.length > 0 ? h : null;
}

/**
 * client px → SVG 사용자 좌표(viewBox 프레임, y-down).
 * `preserveAspectRatio="xMidYMid meet"` 규칙을 그대로 따른다: 한 축 기준 스케일 + 중앙 정렬.
 */
export function clientToSvg(vb: ViewBox, rect: RectLike, clientX: number, clientY: number): [number, number] {
  if (rect.width <= 0 || rect.height <= 0) return [vb.x, vb.y];
  const s = Math.max(vb.width / rect.width, vb.height / rect.height);
  const visibleW = rect.width * s;
  const visibleH = rect.height * s;
  const originX = vb.x + (vb.width - visibleW) / 2;
  const originY = vb.y + (vb.height - visibleH) / 2;
  return [originX + (clientX - rect.left) * s, originY + (clientY - rect.top) * s];
}

/** client px → 도면 좌표(y-up). 루트 scale(1,-1) 의 역. */
export function clientToDrawing(vb: ViewBox, rect: RectLike, clientX: number, clientY: number): [number, number] {
  return svgToDrawing(clientToSvg(vb, rect, clientX, clientY));
}

/** client px 1픽셀이 SVG 사용자 단위로 몇인지(meet 기준). 팬 델타 환산용. */
export function svgUnitsPerPixel(vb: ViewBox, rect: RectLike): number {
  if (rect.width <= 0 || rect.height <= 0) return 1;
  return Math.max(vb.width / rect.width, vb.height / rect.height);
}

/** 도면 좌표(y-up) → client px. `clientToDrawing` 의 역(테스트·마커 배치용). */
export function drawingToClient(vb: ViewBox, rect: RectLike, p: readonly [number, number]): [number, number] {
  const s = svgUnitsPerPixel(vb, rect);
  const visibleW = rect.width * s;
  const visibleH = rect.height * s;
  const originX = vb.x + (vb.width - visibleW) / 2;
  const originY = vb.y + (vb.height - visibleH) / 2;
  const [sx, sy] = drawingToSvg(p);
  return [rect.left + (sx - originX) / s, rect.top + (sy - originY) / s];
}
