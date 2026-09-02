/**
 * 층별 평면 단면 — 순수 함수. WebGL 없이 단위 테스트 가능.
 *
 * 각 삼각형을 평면 z = const 와 교차시켜 선분을 모으고, 끝점을 공유하는 선분을
 * 폴리라인으로 이어 붙인다. 좌표는 입력 좌표계 그대로(모델 좌표계) 반환한다.
 * 기본 오프셋(1.2m 등)은 여기서 결정하지 않는다 — 호출자가 z 를 넘긴다.
 */
import type { SectionPolyline, Vec2 } from "./types";

export interface SliceableMesh {
  /** flat xyz */
  positions: Float32Array | Float64Array | number[];
  /** flat triangle indices. 생략하면 positions 를 3개씩 비인덱스 삼각형으로 본다. */
  indices?: Uint32Array | Uint16Array | number[] | null;
}

export interface SliceOptions {
  /** 끝점 병합 허용 오차(모델 단위). 기본 1e-6 */
  weldTolerance?: number;
  /** 공선점 제거 시 sin(각도) 허용치. 기본 1e-6. 0 이면 제거 안 함. */
  collinearEps?: number;
}

export type Segment2 = [Vec2, Vec2];

const DEFAULT_WELD = 1e-6;
const DEFAULT_COLLINEAR = 1e-6;

/**
 * 삼각형 메시 하나를 평면 z 로 잘라 2D 선분 목록을 만든다.
 * 평면 위에 정확히 놓인 정점은 "위쪽"으로 취급해 각 삼각형이 0개 또는 2개의 교점만 갖게 한다.
 */
export function sliceMeshSegments(mesh: SliceableMesh, z: number): Segment2[] {
  const p = mesh.positions;
  const vertexCount = Math.floor(p.length / 3);
  const idx: ArrayLike<number> =
    mesh.indices && mesh.indices.length > 0
      ? mesh.indices
      : Array.from({ length: vertexCount }, (_, i) => i);
  const triCount = Math.floor(idx.length / 3);
  const out: Segment2[] = [];

  for (let t = 0; t < triCount; t++) {
    const ia = idx[t * 3];
    const ib = idx[t * 3 + 1];
    const ic = idx[t * 3 + 2];
    if (ia >= vertexCount || ib >= vertexCount || ic >= vertexCount) continue;

    const ax = p[ia * 3], ay = p[ia * 3 + 1], az = p[ia * 3 + 2];
    const bx = p[ib * 3], by = p[ib * 3 + 1], bz = p[ib * 3 + 2];
    const cx = p[ic * 3], cy = p[ic * 3 + 1], cz = p[ic * 3 + 2];

    const da = az - z, db = bz - z, dc = cz - z;
    const sa = da >= 0, sb = db >= 0, sc = dc >= 0;
    if (sa === sb && sb === sc) continue; // 전부 한쪽

    const pts: Vec2[] = [];
    const cross = (
      x0: number, y0: number, d0: number,
      x1: number, y1: number, d1: number,
    ): void => {
      const tt = d0 / (d0 - d1);
      pts.push([x0 + (x1 - x0) * tt, y0 + (y1 - y0) * tt]);
    };
    if (sa !== sb) cross(ax, ay, da, bx, by, db);
    if (sb !== sc) cross(bx, by, db, cx, cy, dc);
    if (sc !== sa) cross(cx, cy, dc, ax, ay, da);

    if (pts.length === 2) {
      const [q0, q1] = pts;
      if (q0[0] !== q1[0] || q0[1] !== q1[1]) out.push([q0, q1]);
    }
  }
  return out;
}

function quantKey(pt: Vec2, tol: number): string {
  return `${Math.round(pt[0] / tol)}:${Math.round(pt[1] / tol)}`;
}

/**
 * 선분들을 끝점 공유 기준으로 이어 폴리라인을 만든다. 방향은 임의.
 */
export function chainSegments(
  segments: Segment2[],
  opts: SliceOptions = {},
): Array<{ points: Vec2[]; closed: boolean }> {
  const tol = opts.weldTolerance ?? DEFAULT_WELD;
  const adjacency = new Map<string, number[]>();
  const keyOf = (pt: Vec2) => quantKey(pt, tol);

  segments.forEach((seg, i) => {
    for (const end of seg) {
      const k = keyOf(end);
      const list = adjacency.get(k);
      if (list) list.push(i);
      else adjacency.set(k, [i]);
    }
  });

  const used = new Array<boolean>(segments.length).fill(false);
  const result: Array<{ points: Vec2[]; closed: boolean }> = [];

  const takeNext = (endPt: Vec2): Vec2 | null => {
    const k = keyOf(endPt);
    const candidates = adjacency.get(k);
    if (!candidates) return null;
    for (const j of candidates) {
      if (used[j]) continue;
      used[j] = true;
      const [a, b] = segments[j];
      return keyOf(a) === k ? b : a;
    }
    return null;
  };

  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const chain: Vec2[] = [segments[i][0], segments[i][1]];

    // 앞으로 확장
    for (;;) {
      const next = takeNext(chain[chain.length - 1]);
      if (!next) break;
      chain.push(next);
      if (keyOf(next) === keyOf(chain[0])) break;
    }
    let closed = chain.length > 2 && keyOf(chain[0]) === keyOf(chain[chain.length - 1]);
    if (closed) {
      chain.pop();
    } else {
      // 뒤로 확장
      for (;;) {
        const prev = takeNext(chain[0]);
        if (!prev) break;
        chain.unshift(prev);
        if (keyOf(prev) === keyOf(chain[chain.length - 1])) {
          chain.shift();
          closed = true;
          break;
        }
      }
    }
    result.push({ points: simplifyCollinear(chain, closed, opts.collinearEps ?? DEFAULT_COLLINEAR), closed });
  }
  return result;
}

/** 일직선 위의 중간점을 제거한다 (닫힌 경우 순환 이웃 기준). */
export function simplifyCollinear(points: Vec2[], closed: boolean, eps: number): Vec2[] {
  if (eps <= 0 || points.length < 3) return points;
  const n = points.length;
  const keep: boolean[] = new Array<boolean>(n).fill(true);
  const isCollinear = (prev: Vec2, cur: Vec2, next: Vec2): boolean => {
    const ux = cur[0] - prev[0], uy = cur[1] - prev[1];
    const vx = next[0] - cur[0], vy = next[1] - cur[1];
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (lu === 0 || lv === 0) return true;
    const crossZ = ux * vy - uy * vx;
    const dot = ux * vx + uy * vy;
    return Math.abs(crossZ) <= eps * lu * lv && dot > 0;
  };
  const start = closed ? 0 : 1;
  const end = closed ? n : n - 1;
  for (let i = start; i < end; i++) {
    const prevIdx = (i - 1 + n) % n;
    const nextIdx = (i + 1) % n;
    // 이미 제거된 이전 점은 건너뛰고 실제 남은 이전 점을 찾는다
    let p = prevIdx;
    while (!keep[p] && p !== i) p = (p - 1 + n) % n;
    if (isCollinear(points[p], points[i], points[nextIdx])) keep[i] = false;
  }
  const out = points.filter((_, i) => keep[i]);
  return out.length >= 2 ? out : points;
}

/**
 * 여러 객체 메시를 평면 z 로 자른다.
 * @returns 객체별 폴리라인 목록. 교차하지 않는 객체는 결과에 없다.
 */
export function slicePlan(
  meshes: Map<string, SliceableMesh>,
  z: number,
  opts: SliceOptions = {},
): SectionPolyline[] {
  const out: SectionPolyline[] = [];
  for (const [globalId, mesh] of meshes) {
    const segs = sliceMeshSegments(mesh, z);
    if (segs.length === 0) continue;
    for (const { points, closed } of chainSegments(segs, opts)) {
      if (points.length < 2) continue;
      out.push({ globalId, points, closed });
    }
  }
  return out;
}

export function polylinesBounds(polylines: SectionPolyline[]): { min: Vec2; max: Vec2 } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pl of polylines) {
    for (const [x, y] of pl.points) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { min: [minX, minY], max: [maxX, maxY] };
}

/**
 * 단순 SVG 문자열. 모델 XY 를 그대로 쓰되 SVG 는 y 가 아래로 증가하므로 y 를 뒤집는다.
 * 각 path 에 data-global-id 를 붙여 frontend 가 이벤트를 걸 수 있게 한다.
 */
export function polylinesToSvg(
  polylines: SectionPolyline[],
  opts: { strokeWidth?: number; padding?: number; precision?: number } = {},
): string {
  const b = polylinesBounds(polylines);
  const pad = opts.padding ?? 1;
  const prec = opts.precision ?? 4;
  const sw = opts.strokeWidth ?? 0.05;
  if (!b) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>`;
  }
  const f = (v: number) => Number(v.toFixed(prec)).toString();
  const minX = b.min[0] - pad, maxX = b.max[0] + pad;
  const minY = b.min[1] - pad, maxY = b.max[1] + pad;
  const w = maxX - minX, h = maxY - minY;
  const paths = polylines.map((pl) => {
    const d = pl.points
      .map(([x, y], i) => `${i === 0 ? "M" : "L"}${f(x)} ${f(-y)}`)
      .join(" ") + (pl.closed ? " Z" : "");
    return `<path data-global-id="${escapeAttr(pl.globalId)}" d="${d}"/>`;
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(minX)} ${f(-maxY)} ${f(w)} ${f(h)}" ` +
    `fill="none" stroke="#000" stroke-width="${sw}" stroke-linejoin="round">` +
    paths.join("") +
    `</svg>`
  );
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
