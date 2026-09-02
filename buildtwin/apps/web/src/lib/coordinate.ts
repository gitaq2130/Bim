/**
 * 좌표계 유틸. 값은 항상 서버(CoordinateSystem)에서 온다 — 상수 하드코딩 금지.
 * packages/core/models/coordinate.py 의 CoordinateTransform.from_system 과 동일한 행렬을 만든다.
 */
import type { CoordinateSystem, CoordinateTransform } from "../api/types";
import type { ViewerCoordinateSystem } from "../sync/viewerTypes";

export type Matrix4 = number[][];

export const IDENTITY4: Matrix4 = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
];

/** Python 모델의 기본값과 동일하게 채운다(optional → required). */
export function normalizeCoordinateSystem(cs: CoordinateSystem | null | undefined): ViewerCoordinateSystem {
  return {
    source: cs?.source ?? "ifc_local",
    origin: cs?.origin ?? [0, 0, 0],
    rotation_deg: cs?.rotation_deg ?? 0,
    scale: cs?.scale ?? 1,
    unit: cs?.unit ?? "m",
    epsg: cs?.epsg ?? null,
    extent: cs?.extent ?? null,
    notes: cs?.notes ?? null,
  };
}

/** CoordinateSystem(origin/rotation/scale) → 그 좌표계에서 모델 좌표계로 가는 4x4 (행 우선). */
export function matrixFromSystem(cs: CoordinateSystem | null | undefined): Matrix4 {
  const n = normalizeCoordinateSystem(cs);
  const t = (n.rotation_deg * Math.PI) / 180;
  const c = Math.cos(t) * n.scale;
  const s = Math.sin(t) * n.scale;
  return [
    [c, -s, 0, n.origin[0]],
    [s, c, 0, n.origin[1]],
    [0, 0, n.scale, n.origin[2]],
    [0, 0, 0, 1],
  ];
}

/** 일반 4x4 역행렬 (가우스-조던). 특이행렬이면 null. */
export function invert4(m: Matrix4): Matrix4 | null {
  const a = m.map((r, i) => [...r, ...IDENTITY4[i]]);
  for (let col = 0; col < 4; col++) {
    let piv = col;
    for (let r = col + 1; r < 4; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    if (Math.abs(a[piv][col]) < 1e-12) return null;
    [a[col], a[piv]] = [a[piv], a[col]];
    const d = a[col][col];
    for (let k = 0; k < 8; k++) a[col][k] /= d;
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const f = a[r][col];
      if (f === 0) continue;
      for (let k = 0; k < 8; k++) a[r][k] -= f * a[col][k];
    }
  }
  return a.map((r) => r.slice(4));
}

/** 모델 좌표 → 도면 좌표 4x4. 3D 단면(모델 좌표)을 2D 도면 위에 겹칠 때 쓴다. */
export function modelToDrawingMatrix(drawingCs: CoordinateSystem | null | undefined): Matrix4 {
  return invert4(matrixFromSystem(drawingCs)) ?? IDENTITY4;
}

export function multiply4(a: Matrix4, b: Matrix4): Matrix4 {
  return a.map((row, i) => b[0].map((_, j) => row.reduce((acc, _v, k) => acc + a[i][k] * b[k][j], 0)));
}

export function applyMatrix(m: Matrix4, p: [number, number, number?]): [number, number, number] {
  const [x, y, z = 0] = p;
  return [
    m[0][0] * x + m[0][1] * y + m[0][2] * z + m[0][3],
    m[1][0] * x + m[1][1] * y + m[1][2] * z + m[1][3],
    m[2][0] * x + m[2][1] * y + m[2][2] * z + m[2][3],
  ];
}

/** 서버 CoordinateTransform → 뷰어(three.js) 용 객체 (구조 동일, from_source 필수) */
export function toViewerTransform(t: CoordinateTransform | null | undefined, fallbackFrom: CoordinateSystem["source"] = "scan_local"): CoordinateTransform {
  if (t && Array.isArray(t.matrix) && t.matrix.length === 4) return t;
  return { matrix: IDENTITY4, from_source: fallbackFrom, to_source: "ifc_local", method: "identity" };
}
