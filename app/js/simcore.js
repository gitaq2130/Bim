// 빌더 거동 시뮬레이션 계산부 — 풍향, 지진 시간이력(모드중첩), 장기처짐, 시공단계 기둥 축소량(크리프·건조수축)
import { modal, Ec as EcOf, spectrum } from './structmodel.js';
import { analyze, stationForces } from './fem.js';
import { hingeCaps } from './kds.js';

const G = 9806.65;
// ---------- 재료 시간 의존 (ACI 209R) ----------
export const creep = (dt, t0, phiU = 2.0) => dt <= 0 ? 0 : phiU * Math.pow(dt, 0.6) / (10 + Math.pow(dt, 0.6)) * 1.25 * Math.pow(Math.max(t0, 1), -0.118);
export const shrink = (dt, shU = 600e-6) => dt <= 0 ? 0 : shU * dt / (35 + dt);
export const ecAge = (t) => Math.sqrt(Math.max(t, 0.5) / (4 + 0.85 * Math.max(t, 0.5)));
// KDS 장기처짐 시간계수 ξ
export const xiOf = (d) => d <= 0 ? 0 : d <= 90 ? d / 90 : d <= 180 ? 1 + 0.2 * (d - 90) / 90 : d <= 365 ? 1.2 + 0.2 * (d - 180) / 185 : d <= 1825 ? 1.4 + 0.6 * (d - 365) / 1460 : 2.0;

// ---------- 풍향 ----------
export function windField(res, deg, vRatio = 1, withGravity = false) {
  const R = res.R, n = res.M.nodes.length; const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), k = vRatio * vRatio;
  const X = R.cases.WX?.disp, Y = R.cases.WY?.disp, D = R.cases.D.disp; const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) out[i * 3 + j] = k * (c * (X ? X[i * 6 + j] : 0) + s * (Y ? Y[i * 6 + j] : 0)) + (withGravity ? D[i * 6 + j] : 0);
  return out;
}
export function caseField(res, f) { const n = res.M.nodes.length; const out = new Float64Array(n * 3); for (const [c, k] of Object.entries(f)) { const d = res.R.cases[c]?.disp; if (!d) continue; for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) out[i * 3 + j] += k * d[i * 6 + j]; } return out; }

// ---------- 지반가속도 ----------
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296); }; }
export function groundMotion({ type = 'synthetic', pga = 0.2, T = 1, dur = 20, dt = 0.01, seed = 7, soil = 'medium' }) {
  const n = Math.round(dur / dt) + 1; const a = new Float64Array(n);
  if (type === 'sine') { for (let i = 0; i < n; i++) { const t = i * dt; const env = Math.min(1, t / 2) * (t > dur - 3 ? Math.max(0, (dur - t) / 3) : 1); a[i] = Math.sin(2 * Math.PI * t / T) * env; } }
  else if (type === 'pulse') { for (let i = 0; i < n; i++) { const t = i * dt - 2; a[i] = Math.abs(t) < T ? Math.sin(Math.PI * (t + T) / T) * (t < 0 ? 1 : -1) * 0.5 * (1 + Math.cos(Math.PI * t / T)) : 0; } }
  else { // 카나이-타지미 필터 백색잡음 × 포락선
    const r = rng(seed); const wg = soil === 'firm' ? 20 : soil === 'soft' ? 9 : 15, zg = soil === 'soft' ? 0.4 : 0.6; let x = 0, v = 0;
    const t1 = 2, t2 = Math.max(4, dur * 0.45);
    for (let i = 0; i < n; i++) { const t = i * dt; const u1 = Math.max(r(), 1e-12), u2 = r(); const wn = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) / Math.sqrt(dt);
      const acc = -wn - 2 * zg * wg * v - wg * wg * x; v += acc * dt; x += v * dt; const out = -(2 * zg * wg * v + wg * wg * x);
      const env = t < t1 ? (t / t1) ** 2 : t < t2 ? 1 : Math.exp(-0.35 * (t - t2)); a[i] = out * env; }
    // 기선 보정: 평균 제거
    let m = 0; for (let i = 0; i < n; i++) m += a[i]; m /= n; for (let i = 0; i < n; i++) a[i] -= m;
  }
  let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(a[i])); for (let i = 0; i < n; i++) a[i] = a[i] / (mx || 1) * pga * G;
  return { a, dt, n };
}
// ---------- 모드 확보 (전체 변위장 포함) ----------
export function ensureModes(res, onProgress) {
  let MD = res.info.modal; if (!MD) { MD = res.info.modalSim || (res.info.modalSim = modal(res.R, res.story, onProgress)); }
  for (const mo of MD.modes) if (!mo.full) { const b = new Float64Array(res.R.N); MD.dof.forEach((d, k) => { b[d] = MD.m[k] * mo.phi[k] * mo.w * mo.w; }); mo.full = res.R.post(res.R.solveRaw(b)); }
  return MD;
}
// ---------- 모드중첩 시간이력 (Newmark 평균가속도, 감쇠 5%) ----------
export function timeHistory(res, gm, deg = 0, zeta = 0.05) {
  const MD = ensureModes(res); const md = MD.modes; const n = gm.n, dt = gm.dt; const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180);
  const Q = md.map(() => new Float64Array(n)), A = md.map(() => new Float64Array(n));
  md.forEach((mo, k) => { const w = mo.w, Gm = mo.G.X * c + mo.G.Y * s; const kk = w * w, cc = 2 * zeta * w; const keff = kk + 2 * cc / dt + 4 / (dt * dt);
    let u = 0, v = 0, a = -Gm * gm.a[0]; for (let i = 1; i < n; i++) { const p = -Gm * gm.a[i]; const pe = p + (4 / (dt * dt) * u + 4 / dt * v + a) + cc * (2 / dt * u + v); const un = pe / keff; const vn = 2 / dt * (un - u) - v; const an = 4 / (dt * dt) * (un - u) - 4 / dt * v - a; u = un; v = vn; a = an; Q[k][i] = u; A[k][i] = a; } });
  const ns = res.story.length; const top = ns - 1; const roof = new Float64Array(n * 2), Vb = new Float64Array(n * 2); const drMax = new Float64Array(ns), acMax = new Float64Array(ns);
  for (let i = 0; i < n; i++) {
    let rx = 0, ry = 0, vx = 0, vy = 0; for (let k = 0; k < md.length; k++) { const q = Q[k][i]; rx += q * md[k].phi[top * 3]; ry += q * md[k].phi[top * 3 + 1]; vx += md[k].w ** 2 * q * md[k].G.X; vy += md[k].w ** 2 * q * md[k].G.Y; }
    roof[i * 2] = rx; roof[i * 2 + 1] = ry; Vb[i * 2] = vx; Vb[i * 2 + 1] = vy;
    if (i % 2 === 0) for (let f = 0; f < ns; f++) { let dx = 0, dy = 0, ax = 0, ay = 0; for (let k = 0; k < md.length; k++) { const q = Q[k][i], p = md[k].phi; dx += q * (p[f * 3] - (f ? p[(f - 1) * 3] : 0)); dy += q * (p[f * 3 + 1] - (f ? p[(f - 1) * 3 + 1] : 0)); ax += A[k][i] * p[f * 3]; ay += A[k][i] * p[f * 3 + 1]; }
      const dr = Math.hypot(dx, dy) / res.story[f].h; if (dr > drMax[f]) drMax[f] = dr; const acc = Math.hypot(ax + gm.a[i] * c, ay + gm.a[i] * s); if (acc > acMax[f]) acMax[f] = acc; }
  }
  const field = (i, out) => { const N = res.M.nodes.length; out.fill(0); for (let k = 0; k < md.length; k++) { const q = Q[k][i]; if (!q) continue; const d = md[k].full.disp; for (let j = 0; j < N; j++) { out[j * 3] += q * d[j * 6]; out[j * 3 + 1] += q * d[j * 6 + 1]; out[j * 3 + 2] += q * d[j * 6 + 2]; } } return out; };
  return { n, dt, Q, roof, Vb, drMax, acMax, field, modes: md.length };
}
// ---------- 장기처짐 ----------
export function longTermField(res, days, psiL = 0.25) {
  const xi = xiOf(days); const D = res.R.cases.D.disp, L = res.R.cases.L.disp; const n = res.M.nodes.length; const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) out[i * 3 + j] = (D[i * 6 + j] + psiL * L[i * 6 + j]) * (1 + xi) + (1 - psiL) * L[i * 6 + j];
  return { field: out, xi };
}
// ---------- 시공단계 기둥 축소량 ----------
export function columnShortening(res, S, { cycle = 7, phiU = 2.0, shU = 600e-6, sdlDelay = 90, years = 10 } = {}) {
  const { M, R } = res; const N = M.nodes; const lv = M.lv; const lvIdx = new Map(lv.map((l, i) => [l.id, i])); const EcV = M.EcV;
  const stacks = new Map();
  for (const [mi, m] of M.members.entries()) { if (m.kind !== 'column' && m.kind !== 'wall') continue; const e = R.E[m.segs[0]].e; const a = N[e.n1]; const key = (m.kind === 'wall' ? 'W' : 'C') + `${Math.round(a.x / 300)},${Math.round(a.y / 300)}`; (stacks.get(key) || stacks.set(key, []).get(key)).push({ mi, m, e, ei: m.segs[0], s: lvIdx.get(m.r.level.id), z0: a.z, z1: N[e.n2].z }); }
  const nFl = lv.length; const tFl = (s) => s * cycle; const Tc = (nFl) * cycle + sdlDelay; const Tend = Tc + years * 365;
  const dD = R.cases.D.ef, dL = R.cases.L.ef;
  const out = [];
  for (const [key, arr] of stacks) {
    arr.sort((p, q) => p.z0 - q.z0); if (!arr.length) continue;
    const P = arr.map(x => Math.max(0, -dD[x.ei * 12])), PL = arr.map(x => Math.max(0, -dL[x.ei * 12]) * 0.25); // 압축 +
    const inc = arr.map((x, i) => (P[i] - (P[i + 1] ?? 0))); // 이 층 상부 바닥에서 들어오는 하중 (구조 자중·SDL)
    const incL = arr.map((x, i) => (PL[i] - (PL[i + 1] ?? 0)));
    const el = arr.map(x => { const m = x.m; const Ac = m.kind === 'wall' ? m.by * m.hz : m.mat === 'STEEL' ? 0 : m.by * m.hz - (m.sh ? m.sh.A : 0); const EA = x.e.EA; const fc = Math.min(1, EcV * Ac / EA); return { h: x.z1 - x.z0, EA, fc, t0: tFl(x.s) }; });
    // 하중 시점: 해당 층 바닥 타설(자중 70%) + 마감 SDL(30%)은 준공 시, 지속 활하중은 준공 후
    const loadsAt = []; arr.forEach((x, i) => { const tf = tFl(x.s + 1); loadsAt.push({ i, t: tf, P: inc[i] * 0.7 }, { i, t: Tc, P: inc[i] * 0.3 }, { i, t: Tc, P: incL[i] }); });
    const delta = (s, T) => { const E = el[s]; if (T <= E.t0) return 0; let eps = 0; for (const L of loadsAt) { if (L.i < s || L.t > T) continue; const age = L.t - E.t0; const EAt = E.EA * (E.fc * ecAge(age) + (1 - E.fc)); eps += L.P / EAt * (1 + E.fc * creep(T - L.t, age, phiU)); } eps += E.fc * shrink(T - E.t0, shU); return eps * E.h; };
    const floors = arr.map((x, j) => { const tf = tFl(x.s + 1); const at = (T) => { let v = 0; for (let k = 0; k <= j; k++) v += delta(k, T) - delta(k, tf); return v; }; return { s: x.s, level: lv[x.s + 1]?.name || 'RF', z: x.z1, Tc: at(Tc), Tend: at(Tend), total: arr.slice(0, j + 1).reduce((v, _, k) => v + delta(k, Tend), 0), node: x.e.n2 }; });
    const m0 = arr[0].m; out.push({ key, kind: m0.kind, tag: m0.el.tag || '', x: N[arr[0].e.n1].x, y: N[arr[0].e.n1].y, floors });
  }
  // 층별 그룹 통계
  const byFloor = []; for (let s = 0; s < nFl; s++) { const col = out.filter(o => o.kind === 'column').map(o => o.floors.find(f => f.s === s)).filter(Boolean), wal = out.filter(o => o.kind === 'wall').map(o => o.floors.find(f => f.s === s)).filter(Boolean); if (!col.length && !wal.length) continue;
    const avg = (a, k) => a.length ? a.reduce((v, x) => v + x[k], 0) / a.length : null, mx = (a, k) => a.length ? Math.max(...a.map(x => x[k])) : null;
    const cT = mx(col, 'Tend'), wT = avg(wal, 'Tend'), cC = mx(col, 'Tc'), wC = avg(wal, 'Tc'); byFloor.push({ s, level: lv[s + 1]?.name || 'RF', colTc: cC, colTend: cT, wallTc: wC, wallTend: wT, diff: cT != null && wT != null ? cT - wT : null, diffTc: cC != null && wC != null ? cC - wC : null }); }
  return { stacks: out, byFloor, Tc, Tend, cycle, years };
}

// ---------- 비선형 정적 해석 (푸시오버) — 이벤트 단위 순차 선형, 탄성-완전소성 힌지 ----------
// 중력 1.0D+0.25L 후 등가정적 수직분포 수평력. 힌지 발생 단부는 모멘트 해제(양축). 목표변위는 변위계수법(C0·C1·C2).
const C0of = (n) => n <= 1 ? 1.0 : n <= 2 ? 1.2 : n <= 3 ? 1.3 : n <= 5 ? 1.3 + 0.05 * (n - 3) : n < 10 ? 1.4 + 0.02 * (n - 5) : 1.5;
const aSite = { S1: 130, S2: 130, S3: 130, S4: 90, S5: 60 };
function thpUnit(Rr, c, h) {
  const E = Rr.E[h.ei]; const e = E.e, L = E.L, R = E.R; const f = c.ef.subarray(h.ei * 12, h.ei * 12 + 12); const d = c.disp;
  const loc = (n, o) => [0, 1, 2].map(r => R[r][0] * d[n * 6 + o] + R[r][1] * d[n * 6 + o + 1] + R[r][2] * d[n * 6 + o + 2]);
  const ui = loc(e.n1, 0), uj = loc(e.n2, 0), ri = loc(e.n1, 3), rj = loc(e.n2, 3);
  if (h.ax === 'My') { const k = 2 * e.EIy / L, psi = -(uj[2] - ui[2]) / L; const ti = (2 * f[4] - f[10]) / (3 * k) + psi, tj = (2 * f[10] - f[4]) / (3 * k) + psi; return h.end ? rj[1] - tj : ri[1] - ti; }
  const k = 2 * e.EIz / L, psi = (uj[1] - ui[1]) / L; const ti = (2 * f[5] - f[11]) / (3 * k) + psi, tj = (2 * f[11] - f[5]) / (3 * k) + psi; return h.end ? rj[2] - tj : ri[2] - ti;
}
export async function pushover(res, S, D, { dir = 'X', sign = 1, maxSteps, roofLim = 0.04, onProgress, tick = () => Promise.resolve() } = {}) {
  const { M, R } = res; const N = M.nodes; const story = res.story; if (!story.length) return null; const sp = res.info.seis; const k = dir === 'X' ? 0 : 1;
  const nE = M.elems.length; const gD = R.cases.D, gL = R.cases.L; const efG = new Float64Array(nE * 12); for (let i = 0; i < efG.length; i++) efG[i] = gD.ef[i] + 0.25 * gL.ef[i];
  const eloG = [...gD.eloads, ...gL.eloads.map(([e, xi, gx, gy, gz]) => [e, xi, 0.25 * gx, 0.25 * gy, 0.25 * gz])];
  const T1 = sp?.T?.[dir] || sp?.Tray?.[dir] || 1; const kx = T1 <= 0.5 ? 1 : T1 >= 2.5 ? 2 : 1 + (T1 - 0.5) / 2; const w = story.map(f => f.W * Math.pow(Math.max(1, f.z - M.zmin) / 1000, kx)); const sw = w.reduce((a, b) => a + b, 0);
  const pat = { dia: story.map((f, i) => k === 0 ? [f.dia, sign * 1000 * w[i] / sw, 0, 0] : [f.dia, 0, sign * 1000 * w[i] / sw, 0]) }; // 밑면전단 1 kN
  const elems = M.elems.map(e => ({ ...e, rel: e.rel ? [...e.rel] : undefined })); if (res.info.pdelta) elems.forEach((e, i) => { if (!e.rigid && e.vert) e.Ng = -efG[i * 12]; });
  // 힌지 후보 (부재 양단)
  const H = [], SH = []; const grav = { ef: efG, eloads: eloG };
  M.members.forEach((m, mi) => { const s0 = m.segs[0], s1 = m.segs[m.segs.length - 1]; const Pg = Math.max(0, efG[s0 * 12]); const cap = hingeCaps(res, mi, D?.[mi], S, Pg); const axes = Object.keys(cap.ax);
    for (const [ei, end] of [[s0, 0], [s1, 1]]) { const g = stationForces(R, grav, ei, [end])[0]; for (const [key, Vn] of Object.entries(cap.shear || {})) SH.push({ mi, ei, end, key, Vn, V: g[key] });
      if (elems[ei].rel?.[end]) continue; for (const ax of axes) H.push({ mi, ei, end, ax, cap: cap.ax[ax], lim: cap.lim, kind: cap.kind, M: g[ax], y: false, step: -1, thp: 0, V: 0, d: 0 }); } });
  const model = { nodes: N, elems, dias: res.model.dias, cases: ['P'], loads: { P: pat } }; const top = story[story.length - 1]; const hn = top.z - M.zmin;
  // 해석 범위: 탄성 추정 MCE 목표변위의 2.5배 (최소 높이의 0.5%, 최대 roofLim)
  const est = sp ? C0of(story.length) * spectrum(T1, sp) * 1.5 * T1 * T1 * 9806.65 / (4 * Math.PI ** 2) : Infinity; const dLim = Math.min(roofLim * hn, Math.max(2.5 * est, 0.005 * hn));
  const big = M.members.length > 1500; const tol = big ? 0.05 : 0.02; const nMax = maxSteps || (big ? 40 : 80);
  let lam = 0, roof = 0, mech = false, du0 = 0, baseWeak = null, why = '', brittle = null; const pts = [{ V: 0, d: 0, nh: 0 }]; const lat = new Float64Array(N.length * 3); const sd = new Float64Array(story.length);
  const frames = [{ disp: new Float32Array(lat), sd: Float64Array.from(sd), thp: new Float32Array(H.length) }];
  for (let step = 0; step < nMax; step++) {
    const Rr = analyze(model); const c = Rr.cases.P; if (baseWeak == null) baseWeak = Rr.weak.length; const du = sign * c.dia[top.dia][k]; if (!du0) du0 = du;
    if (Rr.weak.length > baseWeak || !(du > 0) || du > 200 * du0) { mech = true; why = '붕괴 메커니즘 (강성 소실)'; break; }
    const mu = H.map(h => h.y ? 0 : stationForces(Rr, c, h.ei, [h.end])[0][h.ax]); let best = Infinity;
    const need = H.map((h, i) => { if (h.y) return Infinity; const m = mu[i]; if (Math.abs(m) < 1e-9 * (h.cap[0] + h.cap[1] + 1)) return Infinity; const l = m > 0 ? (h.cap[0] - h.M) / m : (-h.cap[1] - h.M) / m; return Math.max(0, l); });
    for (const l of need) if (l < best) best = l; let last = false; const lRoof = (dLim - roof) / du; if (lRoof <= best) { best = lRoof; last = true; }
    const vu = SH.map(q => stationForces(Rr, c, q.ei, [q.end])[0][q.key]); let shear = null; SH.forEach((q, i) => { const v = vu[i]; if (Math.abs(v) < 1e-9) return; const l = v > 0 ? (q.Vn - q.V) / v : (-q.Vn - q.V) / v; if (l >= 0 && l < best) { best = l; shear = q; last = true; } });
    const tp = H.map(h => h.y ? thpUnit(Rr, c, h) : 0);
    lam += best; roof += best * du; H.forEach((h, i) => { if (h.y) h.thp += best * tp[i]; else h.M += best * mu[i]; });
    for (let i = 0; i < N.length; i++) for (let j = 0; j < 3; j++) lat[i * 3 + j] += best * c.disp[i * 6 + j];
    story.forEach((f, i) => { const b = i ? story[i - 1] : null; sd[i] += best * (c.dia[f.dia][k] - (b ? c.dia[b.dia][k] : 0)) * sign / f.h; });
    let nh = 0; if (!last) H.forEach((h, i) => { if (!h.y && need[i] <= best * (1 + tol) + 1e-9) { h.y = true; h.step = step; h.V = lam; h.d = roof; const e = elems[h.ei]; e.rel = e.rel ? [...e.rel] : [0, 0]; e.rel[h.end] = 1; nh++; } });
    pts.push({ V: lam, d: roof, nh: H.filter(h => h.y).length }); frames.push({ disp: new Float32Array(lat), sd: Float64Array.from(sd), thp: Float32Array.from(H.map(h => h.thp)) });
    onProgress?.(`푸시오버 ${step + 1}단계 · 힌지 ${pts[pts.length - 1].nh} · 지붕 ${roof.toFixed(0)} mm`); await tick();
    SH.forEach((q, i) => { q.V += best * vu[i]; });
    if (shear) { const mm = M.members[shear.mi]; brittle = { mi: shear.mi, tag: `${mm.r.level.name} ${mm.el.tag || ''}`.trim(), kind: mm.kind, Vn: shear.Vn }; why = `전단 파괴 — ${brittle.tag} (Vn ${(shear.Vn / 1e3).toFixed(0)} kN)`; break; }
    if (last) { why = dLim < roofLim * hn ? `목표변위 범위 도달 (MCE 추정값의 2.5배)` : `지붕 변위 한계 (높이의 ${(roofLim * 100).toFixed(0)}%)`; break; }
    if (step === nMax - 1) why = `해석 단계 한도 ${nMax}`;
  }
  // 이선형화 (등면적) · 목표변위 (변위계수법)
  const Ki = pts[1] ? pts[1].V / pts[1].d : 0; const last = pts[pts.length - 1]; let A = 0; for (let i = 1; i < pts.length; i++) A += (pts[i].V + pts[i - 1].V) / 2 * (pts[i].d - pts[i - 1].d);
  const Vmax = Math.max(...pts.map(p => p.V)); let Vy = Ki && last.d > last.V / Ki * 1.001 ? (2 * A - last.V * last.d) / (last.d - last.V / Ki) : Vmax; Vy = Math.min(Vmax, Math.max(0.3 * Vmax, Vy || Vmax)); const dy = Ki ? Vy / Ki : 0;
  let tgt = null;
  if (sp && Ki) { const Te = sp.Tray?.[dir] || T1; const W = res.info.Wt; const a = aSite[S.seis?.site] || 90;
    const calc = (scale) => { const Sa = spectrum(Te, sp) * scale; const Rs = Math.max(1, Sa * (W / 1000) / Vy); const C1 = Te >= 1 ? 1 : Math.min(1.5, 1 + (Rs - 1) / (a * Math.max(Te, 0.2) ** 2)); const C2 = Te > 0.7 ? 1 : 1 + ((Rs - 1) / Te) ** 2 / 800; const C0 = C0of(story.length); return { Sa, Rs, C0, C1, C2, dt: C0 * C1 * C2 * Sa * Te * Te * 9806.65 / (4 * Math.PI ** 2) }; };
    tgt = { Te, DE: calc(1), MCE: calc(1.5) }; }
  // 목표변위 시점 상태 (단계 보간)
  const at = (dt) => { if (!(dt > 0)) return null; let i = pts.findIndex(p => p.d >= dt); if (i < 0) return { reached: false }; if (i === 0) i = 1; const p0 = pts[i - 1], p1 = pts[i]; const t = p1.d > p0.d ? (dt - p0.d) / (p1.d - p0.d) : 1; const f0 = frames[i - 1], f1 = frames[i];
    const thp = H.map((h, j) => Math.abs(f0.thp[j] + (f1.thp[j] - f0.thp[j]) * t)); const sdr = story.map((_, j) => Math.abs(f0.sd[j] + (f1.sd[j] - f0.sd[j]) * t));
    const lv = H.map((h, j) => thp[j] <= 1e-9 && !(h.y && h.step < i - 1 + t) ? 0 : thp[j] <= h.lim[0] ? 1 : thp[j] <= h.lim[1] ? 2 : thp[j] <= h.lim[2] ? 3 : 4);
    return { reached: true, i, t, V: p0.V + (p1.V - p0.V) * t, thp, sdr, drift: Math.max(...sdr), lv, cnt: [1, 2, 3, 4].map(q => lv.filter(x => x === q).length) }; };
  if (tgt) { tgt.DE.at = at(tgt.DE.dt); tgt.MCE.at = at(tgt.MCE.dt); }
  return { dir, sign, pts, frames, H, mech, brittle, why, Ki, Vy, dy, Vmax, tgt, hn, story: story.map(f => ({ z: f.z, h: f.h })), nH: H.filter(h => h.y).length };
}
