/**
 * 포인트클라우드 오버레이. PLY(binary/ascii) 또는 ascii xyz 를 THREE.Points 로 만든다.
 * 변환행렬은 항상 인자(CoordinateTransform)로 받는다 — 하드코딩 금지.
 */
import * as THREE from "three";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import type { CoordinateTransform } from "./types";

export const DEFAULT_POINT_SIZE = 0.02;
export const DEFAULT_POINT_COLOR = "#1565C0";

/** 행 우선 4x4 → THREE.Matrix4 */
export function matrix4FromTransform(transform: CoordinateTransform): THREE.Matrix4 {
  const m = transform.matrix;
  if (!m || m.length !== 4 || m.some((row) => !row || row.length !== 4)) {
    throw new Error("CoordinateTransform.matrix must be 4x4");
  }
  const out = new THREE.Matrix4();
  // Matrix4.set 은 행 우선 인자를 받는다.
  out.set(
    m[0][0], m[0][1], m[0][2], m[0][3],
    m[1][0], m[1][1], m[1][2], m[1][3],
    m[2][0], m[2][1], m[2][2], m[2][3],
    m[3][0], m[3][1], m[3][2], m[3][3],
  );
  return out;
}

/**
 * ascii xyz 파서. 줄마다 공백/쉼표 구분 숫자, 앞 3개를 xyz 로 본다.
 * `#`/`//` 로 시작하는 줄과 숫자가 아닌 헤더 줄은 건너뛴다. 4~6번째 값이 있고 0~255 범위면 RGB 로 본다.
 */
export function parseXyz(text: string): { positions: Float32Array; colors: Float32Array | null } {
  const pos: number[] = [];
  const col: number[] = [];
  let hasColor = true;
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const parts = line.split(/[\s,;]+/);
    if (parts.length < 3) continue;
    const x = Number(parts[0]), y = Number(parts[1]), z = Number(parts[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    pos.push(x, y, z);
    if (parts.length >= 6) {
      const r = Number(parts[3]), g = Number(parts[4]), b = Number(parts[5]);
      if ([r, g, b].every((v) => Number.isFinite(v))) {
        const scale = r > 1 || g > 1 || b > 1 ? 1 / 255 : 1;
        col.push(r * scale, g * scale, b * scale);
        continue;
      }
    }
    hasColor = false;
  }
  return {
    positions: new Float32Array(pos),
    colors: hasColor && col.length === pos.length && pos.length > 0 ? new Float32Array(col) : null,
  };
}

export function geometryFromXyz(text: string): THREE.BufferGeometry {
  const { positions, colors } = parseXyz(text);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  if (colors) geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geom;
}

export function isPlyUrl(url: string): boolean {
  return /\.ply(\?.*)?$/i.test(url);
}

export interface PointCloudOptions {
  pointSize?: number;
  color?: string;
  fetchImpl?: typeof fetch;
}

/**
 * URL 에서 포인트클라우드를 받아 transform 을 적용한 THREE.Points 를 만든다.
 * 정점을 직접 변환하지 않고 Points.matrix 에 행렬을 심어 원본 좌표를 보존한다.
 */
export async function loadPointCloudPoints(
  url: string,
  transform: CoordinateTransform,
  opts: PointCloudOptions = {},
): Promise<THREE.Points> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`point cloud fetch failed: ${res.status} ${url}`);

  let geometry: THREE.BufferGeometry;
  if (isPlyUrl(url)) {
    const buf = await res.arrayBuffer();
    geometry = new PLYLoader().parse(buf);
  } else {
    geometry = geometryFromXyz(await res.text());
  }

  const hasColor = geometry.getAttribute("color") !== undefined;
  const material = new THREE.PointsMaterial({
    size: opts.pointSize ?? DEFAULT_POINT_SIZE,
    vertexColors: hasColor,
    color: hasColor ? 0xffffff : new THREE.Color(opts.color ?? DEFAULT_POINT_COLOR),
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geometry, material);
  points.name = "pointcloud";
  points.matrixAutoUpdate = false;
  points.matrix.copy(matrix4FromTransform(transform));
  points.updateMatrixWorld(true);
  points.userData.transform = transform;
  return points;
}

export function disposePoints(points: THREE.Points): void {
  points.geometry.dispose();
  const mat = points.material;
  if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
  else mat.dispose();
}
