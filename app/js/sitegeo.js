// 빌더 공용 — 대지 기하 (대지경계·건물 외곽·포장) + 지형 TIN (토목·조경 공용)
import { allElements, levelOf } from './model.js';
import { polyArea, pointInPoly } from './util.js';

// 대지경계: SITE 레이어 닫힌 폴리선 중 최대
export function siteBoundary(P) { let best = null; for (const s of P.sheets) for (const e of P.content[s.id]?.ents || []) if (e.t === 'pline' && e.closed && /SITE/i.test(e.layer || '') && (!best || Math.abs(polyArea(e.pts)) > Math.abs(polyArea(best)))) best = e.pts; return best; }
// 건물 외곽: 가장 낮은 슬래브 레벨의 슬래브 다각형 (없으면 1층 벽 외접 사각형)
export function footprints(P) {
  const lv = [...P.levels].sort((a, b) => a.elev - b.elev); const by = new Map();
  for (const r of allElements(P)) if (r.el.k === 'slab' && r.level) (by.get(r.level.id) || by.set(r.level.id, []).get(r.level.id)).push(r.el.pts);
  for (const L of lv) if (by.get(L.id)?.length) return by.get(L.id);
  const ws = allElements(P, r => r.el.k === 'wall' && r.level?.id === lv[0]?.id); if (!ws.length) return [];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const r of ws) for (const p of [r.el.a, r.el.b]) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  return [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]];
}
export const rectOf = (p, w, d, rotDeg = 0) => { const a = rotDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [p[0] + i * w / 2 * c - j * d / 2 * s, p[1] + i * w / 2 * s + j * d / 2 * c]); };
// 포장: 외부 가구 중 paving·deck (가장 낮은 레벨)
export function pavings(P) { const out = []; for (const r of allElements(P)) { const el = r.el; if (el.k === 'furn' && (el.type === 'paving' || el.type === 'deck') && (el.src === undefined)) { const L = r.level; if (L && L.elev > ([...P.levels].sort((a, b) => a.elev - b.elev)[0]?.elev ?? 0) + 100) continue; out.push(rectOf(el.p, el.w, el.d, el.rot || 0)); } } return out; }
export function bboxOf(polys) { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const pts of polys) for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); } return { x0, x1, y0, y1 }; }
// 대지 (경계 없으면 건물 외곽 + 10 m)
export function siteInfo(P) {
  const fp = footprints(P); const b = siteBoundary(P); let site = b, assumed = false;
  if (!site) { const bb = bboxOf(fp.length ? fp : [[[0, 0], [20000, 0], [20000, 20000], [0, 20000]]]); site = [[bb.x0 - 10000, bb.y0 - 10000], [bb.x1 + 10000, bb.y0 - 10000], [bb.x1 + 10000, bb.y1 + 10000], [bb.x0 - 10000, bb.y1 + 10000]]; assumed = true; }
  return { site, assumed, fp, pave: pavings(P), siteArea: Math.abs(polyArea(site)) / 1e6, fpArea: fp.reduce((s, q) => s + Math.abs(polyArea(q)), 0) / 1e6 };
}
export const inAny = (p, polys) => polys.some(q => pointInPoly(p, q));

// ---------- 지형: 들로네 삼각망 (Bowyer–Watson) ----------
export function delaunay(pts) { // pts: [[x,y,z]]
  const n = pts.length; if (n < 3) return [];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const d = Math.max(x1 - x0, y1 - y0) * 20, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const V = pts.map(p => [p[0], p[1]]); V.push([cx - d, cy - d], [cx + d, cy - d], [cx, cy + d]);
  const circ = (a, b, c) => { const ax = V[a][0], ay = V[a][1], bx = V[b][0], by = V[b][1], cx2 = V[c][0], cy2 = V[c][1]; const D = 2 * (ax * (by - cy2) + bx * (cy2 - ay) + cx2 * (ay - by)); const ux = ((ax * ax + ay * ay) * (by - cy2) + (bx * bx + by * by) * (cy2 - ay) + (cx2 * cx2 + cy2 * cy2) * (ay - by)) / D, uy = ((ax * ax + ay * ay) * (cx2 - bx) + (bx * bx + by * by) * (ax - cx2) + (cx2 * cx2 + cy2 * cy2) * (bx - ax)) / D; return [ux, uy, (ax - ux) ** 2 + (ay - uy) ** 2]; };
  let tris = [[n, n + 1, n + 2, ...circ(n, n + 1, n + 2)]];
  for (let i = 0; i < n; i++) {
    const [px, py] = V[i]; const bad = [], keep = []; for (const t of tris) ((px - t[3]) ** 2 + (py - t[4]) ** 2 < t[5] ? bad : keep).push(t);
    const edges = new Map(); for (const t of bad) for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) { const k = a < b ? a + ',' + b : b + ',' + a; edges.set(k, edges.has(k) ? null : [a, b]); }
    for (const e of edges.values()) if (e) keep.push([e[0], e[1], i, ...circ(e[0], e[1], i)]); tris = keep;
  }
  return tris.filter(t => t[0] < n && t[1] < n && t[2] < n).map(t => [t[0], t[1], t[2]]);
}
export function makeTIN(pts) {
  const tris = delaunay(pts); const cell = 5000; const grid = new Map();
  const T = tris.map(([a, b, c]) => { const A = pts[a], B = pts[b], C = pts[c]; const bx0 = Math.min(A[0], B[0], C[0]), bx1 = Math.max(A[0], B[0], C[0]), by0 = Math.min(A[1], B[1], C[1]), by1 = Math.max(A[1], B[1], C[1]); return { A, B, C, bx0, bx1, by0, by1, det: (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]) }; });
  T.forEach((t, i) => { for (let gx = Math.floor(t.bx0 / cell); gx <= Math.floor(t.bx1 / cell); gx++) for (let gy = Math.floor(t.by0 / cell); gy <= Math.floor(t.by1 / cell); gy++) { const k = gx + ',' + gy; (grid.get(k) || grid.set(k, []).get(k)).push(i); } });
  const z = (x, y) => { for (const i of grid.get(Math.floor(x / cell) + ',' + Math.floor(y / cell)) || []) { const t = T[i]; if (x < t.bx0 - 1 || x > t.bx1 + 1 || y < t.by0 - 1 || y > t.by1 + 1 || !t.det) continue; const l1 = ((t.B[1] - t.C[1]) * (x - t.C[0]) + (t.C[0] - t.B[0]) * (y - t.C[1])) / t.det, l2 = ((t.C[1] - t.A[1]) * (x - t.C[0]) + (t.A[0] - t.C[0]) * (y - t.C[1])) / t.det, l3 = 1 - l1 - l2; if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return l1 * t.A[2] + l2 * t.B[2] + l3 * t.C[2]; } return null; };
  return { tris: T, z, n: pts.length };
}
export function contours(tin, step) { // [{lv, seg:[[x,y],[x,y]]}]
  const out = []; for (const t of tin.tris) { const zs = [t.A[2], t.B[2], t.C[2]]; const lo = Math.ceil(Math.min(...zs) / step) * step, hi = Math.max(...zs);
    for (let lv = lo; lv <= hi; lv += step) { const P = []; for (const [p, q] of [[t.A, t.B], [t.B, t.C], [t.C, t.A]]) { if ((p[2] - lv) * (q[2] - lv) < 0 || (p[2] === lv && q[2] !== lv)) { const k = (lv - p[2]) / (q[2] - p[2]); P.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]); } } if (P.length >= 2) out.push({ lv: Math.round(lv * 1000) / 1000, seg: [P[0], P[1]] }); } }
  return out;
}
