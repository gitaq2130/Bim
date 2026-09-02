/**
 * 3D 층별 단면(PlanSection) 오버레이. 모델 좌표 → 도면 좌표 4x4 변환을 받아 폴리라인을 투영한다.
 * 변환이 없으면 identity 로 간주하되 console.warn 을 남긴다(하드코딩 금지 — 값은 sync-2d3d 가 준다).
 */
import { num, pointsAttr } from "./dxfToSvg";
import type { SvgElementDescriptor } from "./dxfToSvg";
import type { CoordinateTransform, PlanSection } from "./types";

export const IDENTITY_4X4: CoordinateTransform = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
];

/** packages/core 의 CoordinateTransform(pydantic) 을 그대로 직렬화한 형태도 받는다. */
export type TransformInput = CoordinateTransform | { matrix: CoordinateTransform };

export function toMatrix(t: TransformInput | null | undefined): CoordinateTransform | null {
  if (!t) return null;
  const m = Array.isArray(t) ? t : t.matrix;
  if (!Array.isArray(m) || m.length < 2) return null;
  return m;
}

export function isIdentityTransform(m: CoordinateTransform, eps = 1e-12): boolean {
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const v = m[r]?.[c] ?? (r === c ? 1 : 0);
      if (Math.abs(v - (r === c ? 1 : 0)) > eps) return false;
    }
  }
  return true;
}

/** [x, y, 0, 1] 에 4x4(행 우선)를 곱해 [x', y'] 를 돌려준다. 동차 w 가 1이 아니면 나눈다. */
export function applyTransform2D(m: CoordinateTransform, p: readonly [number, number]): [number, number] {
  const v = [p[0], p[1], 0, 1];
  const row = (r: number) => {
    const mr = m[r];
    if (!mr) return r === 3 ? 1 : 0;
    let acc = 0;
    for (let c = 0; c < 4; c++) acc += (mr[c] ?? 0) * (v[c] as number);
    return acc;
  };
  const x = row(0), y = row(1);
  const w = m.length > 3 ? row(3) : 1;
  return w !== 0 && w !== 1 ? [x / w, y / w] : [x, y];
}

export interface ProjectedPolyline {
  globalId: string;
  points: [number, number][];
}

export interface ProjectOptions {
  transform?: TransformInput | null;
  /** 경고 출력 억제(테스트용). */
  silent?: boolean;
}

/** PlanSection 폴리라인을 도면 좌표로 투영. */
export function projectSection(section: PlanSection, opts: ProjectOptions = {}): ProjectedPolyline[] {
  let m = toMatrix(opts.transform);
  if (!m) {
    if (!opts.silent) {
      console.warn(
        `[viewer2d] setOverlay(level=${section.level}): transform 이 없어 identity 로 투영합니다. ` +
        "모델→도면 변환은 sync-2d3d 가 CoordinateTransform 으로 넘겨야 합니다.",
      );
    }
    m = IDENTITY_4X4;
  }
  const mat = m;
  return section.polylines.map((pl) => ({
    globalId: pl.globalId,
    points: pl.points.map((p) => applyTransform2D(mat, p)),
  }));
}

export interface OverlaySvgOptions extends ProjectOptions {
  opacity?: number;
  color?: string;
  strokeWidth?: number;
}

export const DEFAULT_OVERLAY_COLOR = "#e91e63";

/**
 * `<g class="overlay">` 기술자. 자식은 폴리라인(닫힌 단면은 polygon)이며 data-global-id 를 붙인다.
 * 좌표는 도면 좌표이므로 루트 scale(1,-1) 아래에 그대로 넣으면 엔티티와 겹친다.
 */
export function overlayToSvg(section: PlanSection, opts: OverlaySvgOptions = {}): SvgElementDescriptor {
  const projected = projectSection(section, opts);
  const color = opts.color ?? DEFAULT_OVERLAY_COLOR;
  const opacity = clampOpacity(opts.opacity ?? 0.6);
  const children: SvgElementDescriptor[] = projected
    .filter((pl) => pl.points.length >= 2)
    .map((pl) => {
      const first = pl.points[0] as [number, number];
      const last = pl.points[pl.points.length - 1] as [number, number];
      const closed = pl.points.length >= 3 && first[0] === last[0] && first[1] === last[1];
      const pts = closed ? pl.points.slice(0, -1) : pl.points;
      return {
        tag: closed ? "polygon" : "polyline",
        attrs: { points: pointsAttr(pts), fill: "none", "data-global-id": pl.globalId },
        handle: "",
        layer: "",
      };
    });
  return {
    tag: "g",
    attrs: {
      class: "overlay",
      "data-level": section.level,
      "data-elevation": num(section.elevation),
      stroke: color,
      "stroke-width": opts.strokeWidth ?? 1.5,
      opacity,
      "pointer-events": "none",
    },
    handle: "",
    layer: "",
    children,
  };
}

export function clampOpacity(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}
