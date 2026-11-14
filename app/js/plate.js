// 빌더 슬래브 판 해석 — MITC4 직사각형 판 요소(민들린), 정형 격자, 띠 촐레스키, 균열 유효강성(Branson), Wood–Armer 설계모멘트
import { pointInPoly } from './util.js';

// 직사각형 MITC4 요소 강성 (a×b, D, kGt) — 자유도 [w, βx, βy]×4, 절점 순서 (−,−)(+,−)(+,+)(−,+)
function plateK(a, b, D, nu, kGt) {
  const ax = a / 2, by = b / 2; const K = Array.from({ length: 12 }, () => new Float64Array(12)); const xi = [-1, 1, 1, -1], et = [-1, -1, 1, 1]; const g = 1 / Math.sqrt(3);
  const Db = [[D, nu * D, 0], [nu * D, D, 0], [0, 0, D * (1 - nu) / 2]];
  for (const s of [-g, g]) for (const t of [-g, g]) {
    const N = [], dx = [], dy = []; for (let i = 0; i < 4; i++) { N.push((1 + xi[i] * s) * (1 + et[i] * t) / 4); dx.push(xi[i] * (1 + et[i] * t) / 4 / ax); dy.push(et[i] * (1 + xi[i] * s) / 4 / by); }
    const Bb = [new Float64Array(12), new Float64Array(12), new Float64Array(12)]; for (let i = 0; i < 4; i++) { Bb[0][i * 3 + 1] = dx[i]; Bb[1][i * 3 + 2] = dy[i]; Bb[2][i * 3 + 1] = dy[i]; Bb[2][i * 3 + 2] = dx[i]; }
    // MITC4 가정 전단변형률
    const gxA = new Float64Array(12), gxC = new Float64Array(12), gyD = new Float64Array(12), gyB = new Float64Array(12);
    gxA[0] = -1 / a; gxA[3] = 1 / a; gxA[1] = -0.5; gxA[4] = -0.5; // 변 1-2
    gxC[9] = -1 / a; gxC[6] = 1 / a; gxC[10] = -0.5; gxC[7] = -0.5; // 변 4-3
    gyD[0] = -1 / b; gyD[9] = 1 / b; gyD[2] = -0.5; gyD[11] = -0.5; // 변 1-4
    gyB[3] = -1 / b; gyB[6] = 1 / b; gyB[5] = -0.5; gyB[8] = -0.5; // 변 2-3
    const Bs = [new Float64Array(12), new Float64Array(12)]; for (let j = 0; j < 12; j++) { Bs[0][j] = (1 - t) / 2 * gxA[j] + (1 + t) / 2 * gxC[j]; Bs[1][j] = (1 - s) / 2 * gyD[j] + (1 + s) / 2 * gyB[j]; }
    const w = ax * by;
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) { let v = 0; for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) v += Bb[p][i] * Db[p][q] * Bb[q][j]; v += kGt * (Bs[0][i] * Bs[0][j] + Bs[1][i] * Bs[1][j]); K[i][j] += v * w; }
  }
  return K;
}
// 요소 중심 단면력 (단위폭): Mx, My, Mxy (N·mm/mm), Qx, Qy (N/mm)
function plateForces(a, b, D, nu, kGt, u) {
  const dx = [-1, 1, 1, -1].map(x => x / 4 / (a / 2)), dy = [-1, -1, 1, 1].map(y => y / 4 / (b / 2));
  let kx = 0, ky = 0, kxy = 0; for (let i = 0; i < 4; i++) { kx += dx[i] * u[i * 3 + 1]; ky += dy[i] * u[i * 3 + 2]; kxy += dy[i] * u[i * 3 + 1] + dx[i] * u[i * 3 + 2]; }
  const gA = (u[3] - u[0]) / a - (u[1] + u[4]) / 2, gC = (u[6] - u[9]) / a - (u[7] + u[10]) / 2, gD = (u[9] - u[0]) / b - (u[2] + u[11]) / 2, gB = (u[6] - u[3]) / b - (u[5] + u[8]) / 2;
  return { Mx: D * (kx + nu * ky), My: D * (ky + nu * kx), Mxy: D * (1 - nu) / 2 * kxy, Qx: kGt * (gA + gC) / 2, Qy: kGt * (gD + gB) / 2 };
}

// 메시: 다각형(구멍 = holes) 정형 격자
export function slabMesh(pts, h, holes = []) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const nx = Math.max(2, Math.round((x1 - x0) / h)), ny = Math.max(2, Math.round((y1 - y0) / h)); const a = (x1 - x0) / nx, b = (y1 - y0) / ny;
  const cells = []; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const c = [x0 + (i + 0.5) * a, y0 + (j + 0.5) * b]; if (pointInPoly(c, pts) && !holes.some(hp => pointInPoly(c, hp))) cells.push({ i, j, x: c[0], y: c[1] }); }
  // 절점 번호: 짧은 방향 먼저 (띠폭 최소화)
  const used = new Set(); for (const c of cells) for (const [di, dj] of [[0, 0], [1, 0], [1, 1], [0, 1]]) used.add((c.j + dj) * (nx + 1) + c.i + di);
  const rowMajor = nx <= ny; const ids = [...used].sort((p, q) => { const pi = p % (nx + 1), pj = Math.floor(p / (nx + 1)), qi = q % (nx + 1), qj = Math.floor(q / (nx + 1)); return rowMajor ? (pj - qj || pi - qi) : (pi - qi || pj - qj); });
  const id = new Map(ids.map((g, k) => [g, k])); const nodes = ids.map(g => ({ x: x0 + (g % (nx + 1)) * a, y: y0 + Math.floor(g / (nx + 1)) * b }));
  for (const c of cells) c.n = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([di, dj]) => id.get((c.j + dj) * (nx + 1) + c.i + di));
  let bw = 0; for (const c of cells) { const mn = Math.min(...c.n), mx = Math.max(...c.n); bw = Math.max(bw, mx - mn); }
  return { x0, y0, x1, y1, nx, ny, a, b, cells, nodes, bw: bw * 3 + 2 };
}
// 띠 촐레스키 (하삼각 띠 저장)
function bandSolve(N, bw, A, rhsList) {
  const W = bw + 1; const at = (i, j) => i * W + (i - j); // j ≤ i, i−j ≤ bw
  for (let i = 0; i < N; i++) { const j0 = Math.max(0, i - bw);
    for (let j = j0; j < i; j++) { let s = A[at(i, j)]; const k0 = Math.max(j0, j - bw); for (let k = k0; k < j; k++) s -= A[at(i, k)] * A[at(j, k)]; A[at(i, j)] = s / A[at(j, j)]; }
    let d = A[at(i, i)]; for (let k = j0; k < i; k++) d -= A[at(i, k)] ** 2; A[at(i, i)] = Math.sqrt(Math.max(d, 1e-30)); }
  return rhsList.map(b0 => { const x = Float64Array.from(b0); for (let i = 0; i < N; i++) { let s = x[i]; for (let k = Math.max(0, i - bw); k < i; k++) s -= A[at(i, k)] * x[k]; x[i] = s / A[at(i, i)]; } for (let i = N - 1; i >= 0; i--) { x[i] /= A[at(i, i)]; const xi = x[i]; for (let k = Math.max(0, i - bw); k < i; k++) x[k] -= A[at(i, k)] * xi; } return x; });
}
// 해석: loads = { 이름: q (N/mm², 하향 +) }, eff: 요소별 강성배율
export function solvePlate(mesh, sup, t, E, nu, loads, eff = null) {
  const N = mesh.nodes.length * 3, bw = mesh.bw; const A = new Float64Array(N * (bw + 1)); const at = (i, j) => i * (bw + 1) + (i - j);
  const D0 = E * t ** 3 / (12 * (1 - nu * nu)), kGt0 = 5 / 6 * E / (2 * (1 + nu)) * t;
  const K0 = plateK(mesh.a, mesh.b, D0, nu, kGt0);
  mesh.cells.forEach((c, ci) => { const f = eff ? eff[ci] : 1; const dof = c.n.flatMap(n => [n * 3, n * 3 + 1, n * 3 + 2]); for (let p = 0; p < 12; p++) for (let q = 0; q < 12; q++) { const i = dof[p], j = dof[q]; if (j > i) continue; A[at(i, j)] += K0[p][q] * f; } });
  let maxd = 0; for (let i = 0; i < N; i++) maxd = Math.max(maxd, A[at(i, i)]);
  for (let n = 0; n < mesh.nodes.length; n++) { A[at(n * 3, n * 3)] += sup[n] ? maxd * 1e6 : maxd * 1e-10; }
  const names = Object.keys(loads); const rhs = names.map(k => { const b = new Float64Array(N); const q = loads[k]; for (const c of mesh.cells) for (const n of c.n) b[n * 3] -= q * mesh.a * mesh.b / 4; return b; });
  const sol = bandSolve(N, bw, A, rhs); const out = {};
  names.forEach((k, li) => { const u = sol[li]; const w = new Float64Array(mesh.nodes.length); for (let n = 0; n < w.length; n++) w[n] = u[n * 3];
    const F = mesh.cells.map((c, ci) => { const f = eff ? eff[ci] : 1; const ue = c.n.flatMap(n => [u[n * 3], u[n * 3 + 1], u[n * 3 + 2]]); return plateForces(mesh.a, mesh.b, D0 * f, nu, kGt0 * f, ue); }); out[k] = { w, F }; });
  return out;
}
// 슬래브 전체 해석 + 설계
export function analyzeSlab({ pts, t, holes }, supports, { qD, qL, fck, fy, h, spec, crRatio = 0.3, colSize = 600 }) {
  const mesh = slabMesh(pts, h, holes); const E = 8500 * Math.cbrt(fck + 4), nu = 0.2;
  const sup = mesh.nodes.map(n => supports.lines.some(l => { const dx = l.bx - l.ax, dy = l.by - l.ay, l2 = dx * dx + dy * dy || 1; let s = ((n.x - l.ax) * dx + (n.y - l.ay) * dy) / l2; if (s < -0.02 || s > 1.02) return false; s = Math.max(0, Math.min(1, s)); return Math.hypot(l.ax + dx * s - n.x, l.ay + dy * s - n.y) <= Math.max(l.hw, Math.max(mesh.a, mesh.b) * 0.5) + 1; }) || supports.pts.some(p => Math.abs(p.x - n.x) <= p.r + mesh.a * 0.5 && Math.abs(p.y - n.y) <= p.r + mesh.b * 0.5));
  const R0 = solvePlate(mesh, sup, t, E, nu, { D: qD, L: qL });
  // 균열 유효강성 (Branson): 사용하중 D+L 모멘트
  const fr = 0.63 * Math.sqrt(fck), Mcr = fr * (t ** 3 / 12) / (t / 2);
  const eff = mesh.cells.map((c, ci) => { const fD = R0.D.F[ci], fL = R0.L.F[ci]; const Ma = Math.max(Math.abs(fD.Mx + fL.Mx), Math.abs(fD.My + fL.My)) + Math.abs(fD.Mxy + fL.Mxy); if (Ma <= Mcr) return 1; const r = (Mcr / Ma) ** 3; return Math.max(crRatio, r + (1 - r) * crRatio); });
  const R1 = solvePlate(mesh, sup, t, E, nu, { D: qD, L: qL }, eff);
  // Wood–Armer 설계모멘트 (계수하중 1.2D+1.6L, 비균열 분포)
  const d = t - 30; const AsReq = (m) => { const M = m * 1000; if (M <= 0) return 0; const Rn = M / (0.85 * 1000 * d * d); const arg = 1 - 2 * Rn / (0.85 * fck); return arg < 0 ? Infinity : 0.85 * fck / fy * (1 - Math.sqrt(arg)) * 1000 * d; };
  const Amin = 0.002 * 1000 * t;
  const des = mesh.cells.map((c, ci) => { const a = R0.D.F[ci], b = R0.L.F[ci]; const Mx = 1.2 * a.Mx + 1.6 * b.Mx, My = 1.2 * a.My + 1.6 * b.My, Mxy = Math.abs(1.2 * a.Mxy + 1.6 * b.Mxy); const Vu = Math.hypot(1.2 * a.Qx + 1.6 * b.Qx, 1.2 * a.Qy + 1.6 * b.Qy);
    const bx = Mx + Mxy, by = My + Mxy, tx = -(Mx - Mxy), ty = -(My - Mxy); return { Mx, My, Mxy, Vu, Asbx: Math.max(AsReq(bx), bx > 0 ? Amin : 0), Asby: Math.max(AsReq(by), by > 0 ? Amin : 0), Astx: AsReq(tx), Asty: AsReq(ty) }; });
  // 처짐
  const wS = R1.L.w, wD = R1.D.w; const wLT = wD.map((v, i) => 2 * v + wS[i]); let iMax = 0; for (let i = 0; i < wLT.length; i++) if (Math.abs(wLT[i]) > Math.abs(wLT[iMax])) iMax = i;
  const pM = mesh.nodes[iMax]; let dsup = Infinity; mesh.nodes.forEach((n, i) => { if (sup[i]) dsup = Math.min(dsup, Math.hypot(n.x - pM.x, n.y - pM.y)); }); const span = isFinite(dsup) ? 2 * dsup : Math.max(mesh.x1 - mesh.x0, mesh.y1 - mesh.y0);
  let iL = 0; for (let i = 0; i < wS.length; i++) if (Math.abs(wS[i]) > Math.abs(wS[iL])) iL = i;
  // 실배근 비교
  const AREA = { D10: 71.33, D13: 126.7, D16: 198.6, D19: 286.5, D22: 387.1 }; const ps = (s) => { const m = /^(D\d+)\s*@\s*(\d+)$/i.exec(String(s || '').trim()); return m ? AREA[m[1].toUpperCase()] * 1000 / +m[2] : null; };
  const Apx = ps(spec?.x), Apy = ps(spec?.y), layers = spec?.layers || 2;
  const mx = (k) => Math.max(0, ...des.map(e => e[k])); const req = { bx: mx('Asbx'), by: mx('Asby'), tx: mx('Astx'), ty: mx('Asty') };
  const rRebar = Apx && Apy ? Math.max(req.bx / Apx, req.by / Apy, layers >= 2 ? Math.max(req.tx / Apx, req.ty / Apy) : (req.tx > 0 || req.ty > 0 ? Infinity : 0)) : null;
  const Vs = des.filter((e, ci) => !mesh.cells[ci].n.some(n => sup[n])).map(e => e.Vu).sort((p, q) => p - q); const Vmax = Vs.length ? Vs[Math.floor(Vs.length * 0.98)] || Vs[Vs.length - 1] : 0; /* 98% 값: 재진입 모서리 특이점 제외 */ /* 위험단면: 지지 인접 요소 제외 */ const phiVc = 0.75 * Math.sqrt(fck) / 6 * d; // N/mm
  const defl = { L: Math.abs(wS[iL]), LT: Math.abs(wLT[iMax]), span, limL: span / 360, limLT: span / 240 };
  const ratio = Math.max(defl.L / defl.limL, defl.LT / defl.limLT, Vmax / phiVc, rRebar ?? 0);
  return { mesh, sup, R0, R1, eff, des, wLT, defl, req, Apx, Apy, layers, rRebar, Vmax, phiVc, ratio, cracked: eff.filter(v => v < 0.999).length / eff.length };
}
