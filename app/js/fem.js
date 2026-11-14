// 빌더 FEM — 3D 골조 선형정적 해석 (12자유도 보-기둥 요소, 강막 가정, RCM + 스카이라인 촐레스키, 다중 하중경우)
// 단위: N, mm. 자유도 순서: ux uy uz rx ry rz. 요소 국부축 x=부재축, θy = -dw/dx, θz = dv/dx (표준 강성행렬과 일치)

// 국부축: 수직부재는 ang(국부 y 방향, 라디안)로, 그 외는 국부 z가 전역 Z에 가깝게
export function localAxes(p1, p2, ang = 0) {
  const d = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]]; const L = Math.hypot(...d); const x = d.map(v => v / L);
  let y;
  if (Math.abs(x[2]) > 0.999) y = [Math.cos(ang), Math.sin(ang), 0];
  else { y = [-x[1], x[0], 0]; const l = Math.hypot(y[0], y[1]); y = [y[0] / l, y[1] / l, 0]; } // Z × x
  const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  return { L, R: [x, y, z] };
}
export function localK(e, L) {
  const k = Array.from({ length: 12 }, () => new Float64Array(12)); const s = (i, j, v) => { k[i][j] += v; if (i !== j) k[j][i] += v; };
  const a = e.EA / L, t = e.GJ / L, Iz = e.EIz, Iy = e.EIy, L2 = L * L, L3 = L2 * L;
  s(0, 0, a); s(0, 6, -a); s(6, 6, a); s(3, 3, t); s(3, 9, -t); s(9, 9, t);
  const py = e.GAy ? 12 * Iz / (e.GAy * L2) : 0, pz = e.GAz ? 12 * Iy / (e.GAz * L2) : 0; const cy = 1 + py, cz = 1 + pz; // 전단변형 (티모셴코)
  s(1, 1, 12 * Iz / L3 / cy); s(1, 5, 6 * Iz / L2 / cy); s(1, 7, -12 * Iz / L3 / cy); s(1, 11, 6 * Iz / L2 / cy); s(5, 5, (4 + py) * Iz / L / cy); s(5, 7, -6 * Iz / L2 / cy); s(5, 11, (2 - py) * Iz / L / cy); s(7, 7, 12 * Iz / L3 / cy); s(7, 11, -6 * Iz / L2 / cy); s(11, 11, (4 + py) * Iz / L / cy);
  s(2, 2, 12 * Iy / L3 / cz); s(2, 4, -6 * Iy / L2 / cz); s(2, 8, -12 * Iy / L3 / cz); s(2, 10, -6 * Iy / L2 / cz); s(4, 4, (4 + pz) * Iy / L / cz); s(4, 8, 6 * Iy / L2 / cz); s(4, 10, (2 - pz) * Iy / L / cz); s(8, 8, 12 * Iy / L3 / cz); s(8, 10, 6 * Iy / L2 / cz); s(10, 10, (4 + pz) * Iy / L / cz);
  if (e.Ng) { const g = e.Ng / L; for (const [a, b] of [[1, 7], [2, 8]]) { k[a][a] += g; k[b][b] += g; k[a][b] -= g; k[b][a] -= g; } } // P-Δ 기하강성 (인장 +)
  return k;
}
// 단부 모멘트 해제(핀): 국부 자유도 4,5(i) / 10,11(j) 정적 응축
export function relDofs(e) { const d = []; if (e.rel?.[0]) d.push(4, 5); if (e.rel?.[1]) d.push(10, 11); return d; }
function invSmall(A) { const n = A.length; const M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => +(i === j))]); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; const v = M[c][c] || 1e-30; for (let j = 0; j < 2 * n; j++) M[c][j] /= v; for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; if (f) for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; } } return M.map(r => r.slice(n)); }
export function condense(k, D) {
  if (!D.length) return { k, T: null }; const I = invSmall(D.map(i => D.map(j => k[i][j]))); const T = Array.from({ length: 12 }, (_, r) => D.map((_, a) => D.reduce((s, dj, b) => s + k[r][dj] * I[b][a], 0))); // T = K[:,D] Kdd⁻¹
  const kc = Array.from({ length: 12 }, () => new Float64Array(12)); for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) { let v = k[r][c]; for (let a = 0; a < D.length; a++) v -= T[r][a] * k[D[a]][c]; kc[r][c] = D.includes(r) || D.includes(c) ? 0 : v; }
  return { k: kc, T };
}
const condQ = (Q, T, D) => { if (!T) return Q; const q = Float64Array.from(Q); for (let r = 0; r < 12; r++) { let v = 0; for (let a = 0; a < D.length; a++) v += T[r][a] * Q[D[a]]; q[r] -= v; } for (const d of D) q[d] = 0; return q; };
// 국부 집중하중 (px,py,pz at ξ) → 등가절점하중 (형상함수)
export function eqLoad(Q, L, xi, px, py, pz) {
  const x2 = xi * xi, x3 = x2 * xi; const H1 = 1 - 3 * x2 + 2 * x3, H2 = L * (xi - 2 * x2 + x3), H3 = 3 * x2 - 2 * x3, H4 = L * (-x2 + x3);
  Q[0] += px * (1 - xi); Q[6] += px * xi;
  Q[1] += py * H1; Q[5] += py * H2; Q[7] += py * H3; Q[11] += py * H4;
  Q[2] += pz * H1; Q[4] -= pz * H2; Q[8] += pz * H3; Q[10] -= pz * H4;
}
const toLocal = (R, v) => [R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2], R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2], R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2]];
const toGlobal = (R, v) => [R[0][0] * v[0] + R[1][0] * v[1] + R[2][0] * v[2], R[0][1] * v[0] + R[1][1] * v[1] + R[2][1] * v[2], R[0][2] * v[0] + R[1][2] * v[1] + R[2][2] * v[2]];

// RCM 순서
function rcm(n, adj) {
  const deg = adj.map(a => a.length), perm = new Int32Array(n), seen = new Uint8Array(n); let p = 0;
  const order = [...Array(n).keys()].sort((a, b) => deg[a] - deg[b]);
  for (const s0 of order) {
    if (seen[s0]) continue;
    // 의사 주변점: BFS 두 번
    let s = s0; for (let it = 0; it < 2; it++) { const q = [s]; const vis = new Set([s]); let last = s; for (let h = 0; h < q.length; h++) { for (const v of adj[q[h]]) if (!vis.has(v) && !seen[v]) { vis.add(v); q.push(v); } last = q[q.length - 1]; } s = last; }
    const q = [s]; seen[s] = 1; for (let h = 0; h < q.length; h++) { perm[p++] = q[h]; const nb = adj[q[h]].filter(v => !seen[v]).sort((a, b) => deg[a] - deg[b]); for (const v of nb) { seen[v] = 1; q.push(v); } }
  }
  const out = new Int32Array(n); for (let i = 0; i < n; i++) out[perm[n - 1 - i]] = i; return out; // old → new
}

/* model = {
  nodes: [{x,y,z, fix:bool(6) | null, dia: 다이어프램 번호 | null}],
  dias: [{x,y}]  // 강막 주절점(질량중심)
  elems: [{n1,n2, EA,EIy,EIz,GJ, ang}],
  cases: ['D','L',...],
  loads: { case: { node: [[n, fx,fy,fz,mx,my,mz]], dia: [[d, fx, fy, mz]], elem: [[e, xi, gx, gy, gz]] } }  // elem: 전역 방향 집중하중 at ξ
} */
export function analyze(model, { onProgress } = {}) {
  const t0 = performance.now(); const { nodes, elems, dias = [] } = model;
  // ---- 자유도 번호 ----
  let nd = 0; const map = nodes.map(() => new Array(6)); const diaDof = dias.map(() => [nd++, nd++, nd++]); // ux uy rz
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i], m = map[i]; const used = n.used !== false;
    for (let k = 0; k < 6; k++) {
      if (!used || n.fix?.[k]) { m[k] = []; continue; }
      if (n.dia != null && (k === 0 || k === 1 || k === 5)) {
        const d = dias[n.dia], D = diaDof[n.dia], dx = n.x - d.x, dy = n.y - d.y;
        m[k] = k === 0 ? [[D[0], 1], [D[2], -dy]] : k === 1 ? [[D[1], 1], [D[2], dx]] : [[D[2], 1]];
      } else m[k] = [[nd++, 1]];
    }
  }
  const N = nd;
  // ---- 요소 강성 (전역) ----
  const E = elems.map(e => { const a = nodes[e.n1], b = nodes[e.n2]; const { L, R } = localAxes([a.x, a.y, a.z], [b.x, b.y, b.z], e.ang || 0); const D = relDofs(e); const c = condense(localK(e, L), D); return { e, L, R, k: c.k, T: c.T, D }; });
  const KG = (ee) => { // Λᵀ k Λ
    const { k, R } = ee; const T = new Float64Array(144); // T = k Λ
    for (let i = 0; i < 12; i++) for (let b = 0; b < 4; b++) for (let c = 0; c < 3; c++) { let s = 0; for (let r = 0; r < 3; r++) s += k[i][b * 3 + r] * R[r][c]; T[i * 12 + b * 3 + c] = s; }
    const G = new Float64Array(144); for (let a = 0; a < 4; a++) for (let r = 0; r < 3; r++) for (let j = 0; j < 12; j++) { let s = 0; for (let q = 0; q < 3; q++) s += R[q][r] * T[(a * 3 + q) * 12 + j]; G[(a * 3 + r) * 12 + j] = s; }
    return G;
  };
  const emap = (ee) => { const out = []; for (const n of [ee.e.n1, ee.e.n2]) for (let k = 0; k < 6; k++) out.push(map[n][k]); return out; };
  // 인접 그래프 → RCM
  const adjS = Array.from({ length: N }, () => new Set());
  for (const ee of E) { const ds = [...new Set(emap(ee).flat().map(t => t[0]))]; for (const a of ds) for (const b of ds) if (a !== b) adjS[a].add(b); }
  const perm = rcm(N, adjS.map(s => [...s]));
  // 프로파일
  const first = new Int32Array(N); for (let i = 0; i < N; i++) first[i] = i;
  for (let a = 0; a < N; a++) for (const b of adjS[a]) { const pa = perm[a], pb = perm[b]; if (pa < pb && pa < first[pb]) first[pb] = pa; }
  const start = new Float64Array(N + 1); for (let j = 0; j < N; j++) start[j + 1] = start[j] + (j - first[j] + 1);
  const nnz = start[N]; const U = new Float64Array(nnz); const at = (i, j) => start[j] + (i - first[j]); // i<=j (perm 공간)
  const add = (ga, gb, v) => { let i = perm[ga], j = perm[gb]; if (i > j) return; U[at(i, j)] += v; };
  for (const ee of E) {
    const G = KG(ee); const m = emap(ee); ee.G = G;
    for (let i = 0; i < 12; i++) for (const [ga, ca] of m[i]) for (let j = 0; j < 12; j++) { const v = G[i * 12 + j]; if (v === 0) continue; for (const [gb, cb] of m[j]) add(ga, gb, ca * cb * v); }
  }
  onProgress?.(`강성 조립 ${N.toLocaleString()} 자유도, 프로파일 ${(nnz / 1e6).toFixed(1)}M`);
  // ---- 촐레스키 (UᵀU) ----
  let maxD = 0; const d0 = new Float64Array(N); for (let j = 0; j < N; j++) { d0[j] = U[at(j, j)]; maxD = Math.max(maxD, d0[j]); }
  const weak = [];
  for (let j = 0; j < N; j++) {
    const fj = first[j], sj = start[j];
    for (let i = fj; i < j; i++) {
      const fi = first[i], si = start[i]; const k0 = Math.max(fi, fj); let s = U[sj + (i - fj)];
      for (let k = k0, pi = si + (k0 - fi), pj = sj + (k0 - fj); k < i; k++, pi++, pj++) s -= U[pi] * U[pj];
      U[sj + (i - fj)] = s / U[si + (i - fi)];
    }
    let d = U[sj + (j - fj)]; for (let k = fj, p = sj; k < j; k++, p++) d -= U[p] * U[p];
    if (!(d > d0[j] * 1e-9) || !(d > maxD * 1e-20)) { weak.push(j); d = Math.max(d0[j], maxD * 1e-12) * 1e6; }
    U[sj + (j - fj)] = Math.sqrt(d);
  }
  const tFac = performance.now() - t0;
  const inv = new Int32Array(N); for (let i = 0; i < N; i++) inv[perm[i]] = i;
  const solve = (b0) => { // b0: 원래 번호
    const b = new Float64Array(N); for (let i = 0; i < N; i++) b[perm[i]] = b0[i];
    for (let j = 0; j < N; j++) { const fj = first[j], sj = start[j]; let s = b[j]; for (let k = fj, p = sj; k < j; k++, p++) s -= U[p] * b[k]; b[j] = s / U[sj + (j - fj)]; }
    for (let j = N - 1; j >= 0; j--) { const fj = first[j], sj = start[j]; b[j] /= U[sj + (j - fj)]; const xj = b[j]; for (let k = fj, p = sj; k < j; k++, p++) b[k] -= U[p] * xj; }
    const x = new Float64Array(N); for (let i = 0; i < N; i++) x[i] = b[perm[i]]; return x;
  };
  // ---- 하중경우별 해석 ----
  const res = { N, nnz, weak: weak.map(j => inv[j]), cases: {}, tFac, E };
  for (const c of model.cases) res.cases[c] = runCase(c, model.loads[c] || {});
  function runCase(c, Ld) {
    const F = new Float64Array(N); const Qe = new Map(); // 요소 국부 등가하중
    for (const [n, ...f] of Ld.node || []) for (let k = 0; k < 6; k++) if (f[k]) for (const [g, cf] of map[n][k]) F[g] += cf * f[k];
    for (const [d, fx, fy, mz] of Ld.dia || []) { const D = diaDof[d]; F[D[0]] += fx; F[D[1]] += fy; F[D[2]] += mz; }
    for (const [ei, xi, gx, gy, gz] of Ld.elem || []) { const ee = E[ei]; let Q = Qe.get(ei); if (!Q) Qe.set(ei, Q = new Float64Array(12)); const [px, py, pz] = toLocal(ee.R, [gx, gy, gz]); eqLoad(Q, ee.L, xi, px, py, pz); }
    for (const [ei, Q0] of Qe) { const ee = E[ei], m = emap(ee); const Q = condQ(Q0, ee.T, ee.D); Qe.set(ei, Q); for (let a = 0; a < 4; a++) { const g = toGlobal(ee.R, [Q[a * 3], Q[a * 3 + 1], Q[a * 3 + 2]]); for (let r = 0; r < 3; r++) for (const [gd, cf] of m[a * 3 + r]) F[gd] += cf * g[r]; } }
    return post(solve(F), Qe, Ld);
  }
  function post(q, Qe, Ld) {
    const disp = new Float64Array(nodes.length * 6); for (let i = 0; i < nodes.length; i++) for (let k = 0; k < 6; k++) { let s = 0; for (const [g, cf] of map[i][k]) s += cf * q[g]; disp[i * 6 + k] = s; }
    // 요소 단부력 (국부): F = k uₗ − Q
    const ef = new Float64Array(E.length * 12);
    for (let ei = 0; ei < E.length; ei++) {
      const ee = E[ei], { e, R, k } = ee; const ul = new Float64Array(12);
      for (let a = 0; a < 4; a++) { const n = a < 2 ? e.n1 : e.n2, o = (a % 2) * 3; const v = toLocal(R, [disp[n * 6 + o], disp[n * 6 + o + 1], disp[n * 6 + o + 2]]); ul[a * 3] = v[0]; ul[a * 3 + 1] = v[1]; ul[a * 3 + 2] = v[2]; }
      const Q = Qe.get(ei); for (let i = 0; i < 12; i++) { let s = 0; for (let j = 0; j < 12; j++) s += k[i][j] * ul[j]; ef[ei * 12 + i] = s - (Q ? Q[i] : 0); }
    }
    // 반력: 고정 자유도에 모이는 요소 단부력(전역) − 절점하중
    const reac = new Map();
    for (let ei = 0; ei < E.length; ei++) { const { e, R } = E[ei]; for (const [a, n] of [[0, e.n1], [1, e.n2]]) { if (!nodes[n].fix) continue; let r = reac.get(n); if (!r) reac.set(n, r = new Float64Array(6)); const f = toGlobal(R, [ef[ei * 12 + a * 6], ef[ei * 12 + a * 6 + 1], ef[ei * 12 + a * 6 + 2]]), m = toGlobal(R, [ef[ei * 12 + a * 6 + 3], ef[ei * 12 + a * 6 + 4], ef[ei * 12 + a * 6 + 5]]); for (let k = 0; k < 3; k++) { r[k] += f[k]; r[k + 3] += m[k]; } } }
    for (const [n, ...f] of Ld.node || []) { const r = reac.get(n); if (r) for (let k = 0; k < 6; k++) r[k] -= f[k]; }
    const dia = diaDof.map(D => [q[D[0]], q[D[1]], q[D[2]]]);
    return { disp, ef, reac, dia, eloads: Ld.elem || [] };
  }
  res.solve = (c, Ld) => (res.cases[c] = runCase(c, Ld));
  res.solveRaw = solve; res.diaDof = diaDof; res.post = (q) => post(q, new Map(), {});
  res.time = performance.now() - t0;
  return res;
}

// 부재 내 단면력 (국부): stations ξ 배열 → [{xi, N, Vy, Vz, T, My, Mz}]  (N 인장+, My 처짐(새깅)+ 는 보 하부 인장)
export function stationForces(res, cr, ei, stations = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]) {
  const ee = res.E[ei], L = ee.L, f = cr.ef.subarray(ei * 12, ei * 12 + 12);
  const pl = []; for (const [e2, xi, gx, gy, gz] of cr.eloads) if (e2 === ei) { const [px, py, pz] = toLocal(ee.R, [gx, gy, gz]); pl.push([xi * L, px, py, pz]); }
  return stations.map(xi => {
    const x = xi * L; let sx = f[0], sy = f[1], sz = f[2], my = f[4] + f[2] * x, mz = f[5] - f[1] * x;
    for (const [a, px, py, pz] of pl) if (a < x - 1e-9 || (xi === 1 && a <= x)) { sx += px; sy += py; sz += pz; my += (x - a) * pz; mz -= (x - a) * py; }
    return { xi, N: -sx, Vy: -sy, Vz: -sz, T: -f[3], My: my, Mz: -mz };
  });
}
