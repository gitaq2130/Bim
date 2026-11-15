// 빌더 구조 설계 — KDS 14 20 (RC 강도설계: 등가직사각형 응력블록), KDS 14 31 (강구조 LRFD 근사), SRC 변형률 적합
import { memberForces, combine } from './structmodel.js';
import { specOf, parseN, parseS } from './rebar.js';
import { pointInPoly, polyArea } from './util.js';
const AREA = { D10: 71.33, D13: 126.7, D16: 198.6, D19: 286.5, D22: 387.1, D25: 506.7, D29: 642.4, D32: 794.2, D35: 956.6 };
const asN = (s) => { const p = parseN(s); return p ? p.n * (AREA[p.d] || 0) : null; };
const asS = (s, width = 1000) => { const p = parseS(s); return p ? (AREA[p.d] || 0) * width / p.s : null; };
const phiMnRect = (As, b, d, fck, fy) => { const a = As * fy / (0.85 * fck * b); const c = a / beta1(fck); const et = 0.003 * (d - c) / c, ey = fy / 200000; const phi = et >= 0.005 ? 0.85 : et <= ey ? 0.65 : 0.65 + 0.2 * (et - ey) / (0.005 - ey); return phi * As * fy * (d - a / 2); };

const BARS = [[10, 71.33], [13, 126.7], [16, 198.6], [19, 286.5], [22, 387.1], [25, 506.7], [29, 642.4]];
const beta1 = (fck) => Math.min(0.85, Math.max(0.65, 0.85 - 0.007 * (fck - 28)));
const ECU = 0.003, ES = 200000;

// ---------- RC 보 ----------
export function asReq(Mu, b, d, fck, fy) {
  if (Mu <= 0) return 0; const Rn = Mu / (0.85 * b * d * d); const arg = 1 - 2 * Rn / (0.85 * fck); if (arg < 0) return Infinity;
  return 0.85 * fck / fy * (1 - Math.sqrt(arg)) * b * d;
}
export function barsFor(As, maxN = 8) { if (!isFinite(As)) return '단면 부족'; for (const [D, a] of BARS.slice(4)) { const n = Math.max(2, Math.ceil(As / a)); if (n <= maxN) return `${n}-D${D}`; } const [D, a] = BARS[6]; return `${Math.ceil(As / a)}-D${D}`; }
function rcBeam(m, env, S) {
  const b = m.by, h = m.hz, d = h - 65, fck = S.fck, fy = S.fy, fyt = S.fyt;
  let Mneg = 0, Mpos = 0, Vu = 0, cN = '', cP = '', cV = '';
  for (const { c, st } of env) for (const s of st) { if (-s.My > Mneg) { Mneg = -s.My; cN = c.name; } if (s.My > Mpos) { Mpos = s.My; cP = c.name; } if (Math.abs(s.Vz) > Vu) { Vu = Math.abs(s.Vz); cV = c.name; } }
  const Amin = Math.max(0.25 * Math.sqrt(fck) / fy, 1.4 / fy) * b * d;
  const rmax = 0.85 * beta1(fck) * fck / fy * ECU / (ECU + 0.005);
  const At = Mneg > 0 ? Math.max(asReq(Mneg, b, d, fck, fy), Amin) : Amin, Ab = Mpos > 0 ? Math.max(asReq(Mpos, b, d, fck, fy), Amin) : Amin;
  const rf = Math.max(At, Ab) / (b * d) / rmax;
  const Vc = Math.sqrt(fck) / 6 * b * d, Vsmax = 2 / 3 * Math.sqrt(fck) * b * d, phi = 0.75; const rv = Vu / (phi * (Vc + Vsmax));
  let s = null; if (Vu > phi * Vc / 2) { const Av = 2 * 71.33; const sReq = Vu > phi * Vc ? phi * Av * fyt * d / (Vu - phi * Vc) : Infinity; const sMax = Vu - phi * Vc > phi * Math.sqrt(fck) / 3 * b * d ? Math.min(d / 4, 300) : Math.min(d / 2, 600); s = Math.max(50, Math.floor(Math.min(sReq, sMax) / 25) * 25); }
  const sp = specOf(m.P, m.el); const pT = asN(sp?.top), pB = asN(sp?.bot), pS = parseS(sp?.stir); let prov = null;
  if (pT && pB) { const cT = phiMnRect(pT, b, d, fck, fy), cB = phiMnRect(pB, b, d, fck, fy); const Vs = pS ? Math.min(2 * (AREA[pS.d] || 71.33) * fyt * d / pS.s, Vsmax) : 0; prov = { rT: Mneg / cT, rB: Mpos / cB, rV: Vu / (phi * (Vc + Vs)), cT, cB, Vs }; }
  const df = m.defl; const rdf = df ? Math.max(df.L / df.limL, df.LT / df.limLT) : 0;
  const ratio = prov ? Math.max(prov.rT, prov.rB, prov.rV, rdf) : Math.max(rf, rv, rdf); const gv = prov ? (rdf >= Math.max(prov.rT, prov.rB, prov.rV) ? '처짐' : Math.max(prov.rT, prov.rB) >= prov.rV ? '휨(실배근)' : '전단(실배근)') : (rdf >= Math.max(rf, rv) ? '처짐' : rf >= rv ? '휨' : '전단');
  const extra = [...(prov ? [['실배근 상부', `${sp.top} → φMn ${kNm(prov.cT)}`, prov.rT], ['실배근 하부', `${sp.bot} → φMn ${kNm(prov.cB)}`, prov.rB], ['실배근 늑근', `${sp.stir || '-'} → φ(Vc+Vs) ${kN(phi * (Vc + prov.Vs))}`, prov.rV]] : [['배근', '미입력 — 필요 철근 기준 검토']]), ...(df ? [['처짐 활하중', `${df.L.toFixed(1)} mm ≤ L/${df.cant ? 180 : 360} = ${df.limL.toFixed(1)}`, df.L / df.limL], ['처짐 장기+활하중', `${df.LT.toFixed(1)} mm ≤ L/${df.cant ? 120 : 240} = ${df.limLT.toFixed(1)}`, df.LT / df.limLT]] : [])];
  return { type: 'RC 보', ratio, provided: !!prov, extra, gov2: gv, gov: rf >= rv ? '휨' : '전단', combo: rf >= rv ? (Mneg >= Mpos ? cN : cP) : cV,
    rows: [['단면', `${b}×${h} (d=${d})`], ['Mu(−) 단부', kNm(Mneg), cN], ['Mu(+) 중앙', kNm(Mpos), cP], ['상부근 As', `${mm2(At)} → ${barsFor(At)}`], ['하부근 As', `${mm2(Ab)} → ${barsFor(Ab)}`], ['ρ 필요/ρmax(인장지배)', `${(Math.max(At, Ab) / (b * d) * 100).toFixed(2)}% / ${(rmax * 100).toFixed(2)}%`, rf], ['Vu', kN(Vu), cV], ['φ(Vc+Vs,max)', kN(phi * (Vc + Vsmax)), rv], ['늑근', s ? `D10@${s}` : `최소 D10@${Math.min(Math.floor(d / 2 / 25) * 25, 600)}`]], auto: { top: barsFor(At), bot: barsFor(Ab), stir: `D10@${s || Math.min(Math.floor(d / 2 / 25) * 25, 600)}` } };
}
// ---------- P-M 상관도 (변형률 적합) ----------
// layers: [{y(압축연단에서 깊이), A, fy, Es}], 콘크리트 b×h
function pmCurve(b, h, layers, fck) {
  const b1 = beta1(fck); const Ast = layers.reduce((s, l) => s + l.A, 0); const Ag = b * h; const dt = Math.max(...layers.map(l => l.y));
  const P0 = 0.85 * fck * (Ag - Ast) + layers.reduce((s, l) => s + l.A * l.fy, 0); const phiPmax = 0.65 * 0.80 * P0;
  const pts = []; const cs = []; for (let i = 0; i <= 40; i++) cs.push(h * (3 - 2.97 * i / 40)); for (let i = 1; i <= 20; i++) cs.push(h * 0.03 * (1 - i / 21));
  for (const c of cs) {
    const a = Math.min(b1 * c, h); let P = 0.85 * fck * a * b, M = P * (h / 2 - a / 2);
    for (const l of layers) { const e = ECU * (c - l.y) / c; let f = Math.max(-l.fy, Math.min(l.fy, l.Es * e)); if (l.y < a) f -= 0.85 * fck; P += l.A * f; M += l.A * f * (h / 2 - l.y); }
    const et = ECU * (dt - c) / c, ey = layers[0].fy / ES; const phi = et <= ey ? 0.65 : et >= 0.005 ? 0.85 : 0.65 + 0.2 * (et - ey) / (0.005 - ey);
    pts.push([Math.min(phi * P, phiPmax), phi * Math.abs(M)]);
  }
  pts.push([-0.85 * layers.reduce((s, l) => s + l.A * l.fy, 0), 0]);
  return { pts, phiPmax, Pt: pts[pts.length - 1][0] };
}
function capAt(C, Pu) { // φMn at Pu
  if (Pu >= C.phiPmax) return 0; if (Pu <= C.Pt) return 0; const p = C.pts;
  let best = 0; for (let i = 0; i < p.length - 1; i++) { const [P1, M1] = p[i], [P2, M2] = p[i + 1]; if ((P1 - Pu) * (P2 - Pu) <= 0 && P1 !== P2) best = Math.max(best, M1 + (M2 - M1) * (Pu - P1) / (P2 - P1)); } return best;
}
const rectLayers = (h, As, fy, cover = 60) => [[cover, 0.35], [cover + (h - 2 * cover) / 4, 0.1], [h / 2, 0.1], [h - cover - (h - 2 * cover) / 4, 0.1], [h - cover, 0.35]].map(([y, f]) => ({ y, A: As * f, fy, Es: ES }));
const distLayers = (h, As, fy, n = 7) => Array.from({ length: n }, (_, i) => ({ y: 50 + (h - 100) * i / (n - 1), A: As / n, fy, Es: ES }));
function steelLayers(sh, h, Fy, strong) { // SRC 내장 철골 (단면 중심)
  const o = (h - (strong ? sh.h : sh.b)) / 2; const E = 205000;
  if (strong) return [{ y: o + sh.tf / 2, A: sh.b * sh.tf, fy: Fy, Es: E }, { y: h / 2, A: (sh.h - 2 * sh.tf) * sh.tw, fy: Fy, Es: E }, { y: o + sh.h - sh.tf / 2, A: sh.b * sh.tf, fy: Fy, Es: E }];
  return [0, 0.5, 1].map(t => ({ y: o + sh.b * (0.17 + 0.66 * t), A: 2 * sh.b * sh.tf / 3 + (t === 0.5 ? (sh.h - 2 * sh.tf) * sh.tw : 0), fy: Fy, Es: E }));
}
function colUtil(m, env, S, rho, fck) {
  const b = m.by, h = m.hz, As = rho * b * h; const fy = S.fy;
  const LY = rectLayers(h, As, fy), LZ = rectLayers(b, As, fy); if (m.sh) { LY.push(...steelLayers(m.sh, h, S.Fy, true)); LZ.push(...steelLayers(m.sh, b, S.Fy, false)); }
  const CY = pmCurve(b, h, LY.sort((p, q) => p.y - q.y), fck), CZ = pmCurve(h, b, LZ.sort((p, q) => p.y - q.y), fck);
  let u = 0, at = null;
  for (const { c, st } of env) for (const s of st) {
    const Pu = -s.N, Mx = Math.abs(s.My), My = Math.abs(s.Mz); const cx = capAt(CY, Pu), cy = capAt(CZ, Pu);
    let v = (cx <= 0 || cy <= 0) ? (Pu > 0 ? Pu / CY.phiPmax : Math.max(Pu / CY.Pt, 1.01)) : Math.pow(Math.pow(Mx / cx, 1.15) + Math.pow(My / cy, 1.15), 1 / 1.15);
    if (Pu > 0) v = Math.max(v, Pu / CY.phiPmax); if (v > u) { u = v; at = { c: c.name, Pu, Mx, My, cx, cy }; }
  }
  return { u, at, CY, CZ };
}
function rcColumn(m, env, S) {
  const fck = m.fck || S.fckV || S.fck; const sp = specOf(m.P, m.el); const pAs = asN(sp?.main); let rho = pAs ? pAs / (m.by * m.hz) : (m.el.rho || S.rhoCol);
  if (!pAs && S.rhoAuto) { let lo = 0.01, hi = 0.04; if (colUtil(m, env, S, lo, fck).u <= 1) rho = lo; else if (colUtil(m, env, S, hi, fck).u > 1) rho = hi; else { for (let i = 0; i < 12; i++) { const md = (lo + hi) / 2; if (colUtil(m, env, S, md, fck).u <= 1) hi = md; else lo = md; } rho = Math.ceil(hi * 1000) / 1000; } }
  const r = colUtil(m, env, S, rho, fck);
  let lo = 0.01, hi = 0.06, req = null; if (colUtil(m, env, S, lo, fck).u <= 1) req = lo; else if (colUtil(m, env, S, hi, fck).u > 1) req = Infinity; else { for (let i = 0; i < 14; i++) { const md = (lo + hi) / 2; if (colUtil(m, env, S, md, fck).u <= 1) hi = md; else lo = md; } req = hi; }
  let Vu = 0, cV = ''; for (const { c, st } of env) for (const s of st) { const v = Math.max(Math.abs(s.Vy), Math.abs(s.Vz)); if (v > Vu) { Vu = v; cV = c.name; } }
  const bmin = Math.min(m.by, m.hz), dmax = Math.max(m.by, m.hz) - 60; const phiVmax = 0.75 * (Math.sqrt(fck) / 6 + 2 / 3 * Math.sqrt(fck)) * bmin * dmax; const rv = Vu / phiVmax;
  const a = r.at || {}; const ratio = Math.max(r.u, rv);
  const autoN = (() => { if (req == null || !isFinite(req)) return null; const A = req * m.by * m.hz; for (const [D, a] of [['D22', 387.1], ['D25', 506.7], ['D29', 642.4], ['D32', 794.2]]) { let n = Math.max(4, Math.ceil(A / a)); n = Math.ceil(n / 4) * 4; if (n <= 24) return `${n}-${D}`; } return null; })();
  return { type: m.sh ? 'SRC 기둥' : 'RC 기둥', ratio, provided: !!pAs, auto: autoN ? { main: autoN, hoop: 'D10@150' } : null, gov: r.u >= rv ? 'P-M' : '전단', combo: r.u >= rv ? a.c : cV, rhoReq: req,
    rows: [['단면', `${m.by}×${m.hz}${m.sh ? ' + ' + m.el.sec : ''} · fck ${fck}`], [pAs ? '주근 (실배근)' : S.rhoAuto ? '주근비 ρ (제안)' : '주근비 ρ (가정)', `${pAs ? sp.main + ' · ' : ''}${(rho * 100).toFixed(2)}% (${mm2(rho * m.by * m.hz)})`], ['Pu', kN(a.Pu || 0), a.c], ['Mux / φMnx', `${kNm(a.Mx || 0)} / ${kNm(a.cx || 0)}`], ['Muy / φMny', `${kNm(a.My || 0)} / ${kNm(a.cy || 0)}`], ['φPn,max', kN(r.CY.phiPmax)], ['P-M 검토비 (2축, α=1.15)', r.u.toFixed(3), r.u], ['필요 주근비', req == null ? '-' : !isFinite(req) ? '6% 초과 — 단면 증대' : `${(req * 100).toFixed(2)}% (${barsFor(req * m.by * m.hz, 40)})`], ['Vu / φVn,max', `${kN(Vu)} / ${kN(phiVmax)}`, rv]], pm: r };
}
function rcWall(m, env, S) {
  const fck = m.fck || S.fckV || S.fck, L = m.by, t = m.hz; const hw = m.L;
  const util = (rho) => { const C = pmCurve(t, L, distLayers(L, rho * L * t, S.fy), fck); let u = 0, at = null; for (const { c, st } of env) for (const s of st) { const Pu = -s.N, Mu = Math.abs(s.Mz); const cap = capAt(C, Pu); let v = cap <= 0 ? (Pu > 0 ? Pu / C.phiPmax : Math.max(Pu / C.Pt, 1.01)) : Mu / cap; if (Pu > 0) v = Math.max(v, Pu / C.phiPmax); if (v > u) { u = v; at = { c: c.name, Pu, Mu, cap }; } } return { u, at, C }; };
  const sp = specOf(m.P, m.el); const ly = sp?.layers || 2; const pv = parseS(sp?.v), ph = parseS(sp?.h); let rho = pv ? ly * AREA[pv.d] / (pv.s * t) : Math.max(S.rhoWall, 0.0025);
  if (!pv && S.rhoAuto) { if (util(0.0025).u <= 1) rho = 0.0025; else if (util(0.03).u > 1) rho = 0.03; else { let lo = 0.0025, hi = 0.03; for (let i = 0; i < 12; i++) { const md = (lo + hi) / 2; if (util(md).u <= 1) hi = md; else lo = md; } rho = Math.ceil(hi * 2000) / 2000; } } const rhoT = ph ? ly * AREA[ph.d] / (ph.s * t) : S.rhoWall; const r = util(rho);
  let req = null; if (util(0.0025).u <= 1) req = 0.0025; else if (util(0.04).u > 1) req = Infinity; else { let lo = 0.0025, hi = 0.04; for (let i = 0; i < 14; i++) { const md = (lo + hi) / 2; if (util(md).u <= 1) hi = md; else lo = md; } req = hi; }
  let Vu = 0, cV = ''; for (const { c, st } of env) for (const s of st) if (Math.abs(s.Vy) > Vu) { Vu = Math.abs(s.Vy); cV = c.name; }
  const ar = hw / L, ac = ar <= 1.5 ? 0.25 : ar >= 2 ? 1 / 6 : 0.25 - (ar - 1.5) / 0.5 * (0.25 - 1 / 6); const Acv = L * t;
  const phiVn = 0.75 * Math.min(Acv * (ac * Math.sqrt(fck) + Math.max(rhoT, 0.0025) * S.fyt), 5 / 6 * Math.sqrt(fck) * Acv); const rv = Vu / phiVn; const a = r.at || {};
  const ratio = Math.max(r.u, rv);
  const autoW = (() => { if (req == null || !isFinite(req)) return null; for (const D of ['D10', 'D13', 'D16', 'D19', 'D22']) { const s2 = Math.floor(2 * AREA[D] / (Math.max(req, 0.0025) * t) / 25) * 25; if (s2 >= 150) return { v: `${D}@${Math.min(s2, 400)}`, h: `D13@${Math.min(400, Math.max(150, Math.floor(2 * 126.7 / (0.0025 * t) / 25) * 25))}`, layers: 2 }; } return null; })();
  return { type: 'RC 전단벽', ratio, provided: !!pv, auto: autoW, gov: r.u >= rv ? '면내 P-M' : '면내 전단', combo: r.u >= rv ? a.c : cV, rhoReq: req,
    rows: [['단면', `L ${L} × t ${t} · hw ${Math.round(hw)} · fck ${fck}`], [pv ? '수직근 (실배근)' : S.rhoAuto ? '수직근비 ρv (제안)' : '수직근비 ρv (가정)', `${pv ? `${sp.v} ${ly}단 · ` : ''}${(rho * 100).toFixed(2)}%`], ['Pu', kN(a.Pu || 0), a.c], ['Mu / φMn (면내)', `${kNm(a.Mu || 0)} / ${kNm(a.cap || 0)}`, r.u], ['필요 수직근비', req == null ? '-' : !isFinite(req) ? '4% 초과 — 벽 두께·길이 증대' : `${(req * 100).toFixed(2)}%`], ['Vu / φVn (αc ' + ac.toFixed(3) + ')', `${kN(Vu)} / ${kN(phiVn)}`, rv]] };
}
// ---------- 강구조 ----------
function steel(m, env, S) {
  const sh = m.sh, Fy = S.Fy, E = 205000; const A = sh.A, rx = Math.sqrt(sh.Ix / A), ry = Math.sqrt(sh.Iy / A); const KL = m.L;
  const lam = KL / Math.min(rx, ry); const Fe = Math.PI ** 2 * E / lam ** 2; const Fcr = Fy / Fe <= 2.25 ? Math.pow(0.658, Fy / Fe) * Fy : 0.877 * Fe;
  const Pc = 0.9 * Fcr * A, Pt = 0.9 * Fy * A, Mcx = 0.9 * Fy * sh.Zx, Mcy = 0.9 * Fy * sh.Zy, Vc = 0.9 * 0.6 * Fy * sh.h * sh.tw;
  let u = 0, at = null, Vu = 0, cV = '';
  for (const { c, st } of env) for (const s of st) {
    const Pr = -s.N, Pa = Pr >= 0 ? Pc : Pt, pr = Math.abs(Pr) / Pa, mx = Math.abs(s.My) / Mcx, my = Math.abs(s.Mz) / Mcy;
    const v = pr >= 0.2 ? pr + 8 / 9 * (mx + my) : pr / 2 + mx + my; if (v > u) { u = v; at = { c: c.name, Pr, Mx: Math.abs(s.My), My: Math.abs(s.Mz) }; }
    const vv = Math.max(Math.abs(s.Vz), Math.abs(s.Vy)); if (vv > Vu) { Vu = vv; cV = c.name; }
  }
  const rv = Vu / Vc; const a = at || {}; const df = m.kind === 'beam' ? m.defl : null; const rdf = df ? df.L / df.limL : 0; const ratio = Math.max(u, rv, rdf);
  return { type: m.kind === 'beam' ? '철골 보' : '철골 기둥', ratio, gov: rdf >= Math.max(u, rv) ? '처짐' : u >= rv ? '조합(H1-1)' : '전단', combo: u >= rv ? a.c : cV, extra: df ? [['처짐 활하중', `${df.L.toFixed(1)} mm ≤ L/${df.cant ? 180 : 360} = ${df.limL.toFixed(1)}`, rdf]] : [],
    rows: [['단면', `${m.el.sec} · Fy ${Fy}`], ['A / Zx', `${mm2(A)} / ${(sh.Zx / 1e3).toFixed(0)}×10³mm³`], ['KL/r', lam.toFixed(0)], ['Pr / φPn', `${kN(a.Pr || 0)} / ${kN((a.Pr || 0) >= 0 ? Pc : Pt)}`, a.c], ['Mrx / φMnx', `${kNm(a.Mx || 0)} / ${kNm(Mcx)}`], ['Mry / φMny', `${kNm(a.My || 0)} / ${kNm(Mcy)}`], ['H1-1 검토비', u.toFixed(3), u], ['Vu / φVn', `${kN(Vu)} / ${kN(Vc)}`, rv]] };
}
const kN = (v) => `${(v / 1e3).toFixed(1)} kN`, kNm = (v) => `${(v / 1e6).toFixed(1)} kN·m`, mm2 = (v) => isFinite(v) ? `${Math.round(v).toLocaleString('ko-KR')} mm²` : '∞';

export function designMember(res, mi, S) {
  const m = res.M.members[mi]; m.P = res.P; if (m.kind === 'beam') m.defl = deflection(res, mi, m.mat === 'STEEL' ? 1 : 2); const st = m.kind === 'beam' ? undefined : [0, 0.5, 1]; const mf = memberForces(res, mi, st);
  const env = res.combos.map(c => ({ c, st: combine(mf, c) }));
  const d = m.mat === 'STEEL' && m.sh ? steel(m, env, S) : m.kind === 'beam' ? rcBeam(m, env, S) : m.kind === 'wall' ? rcWall(m, env, S) : rcColumn(m, env, S);
  if (d.gov2) d.gov = d.gov2; if (d.extra) d.rows.push(...d.extra); d.mi = mi; return d;
}
export function designAll(res, S, onProgress) {
  const out = []; const M = res.M.members; for (let i = 0; i < M.length; i++) { out.push(designMember(res, i, S)); if (i % 500 === 499) onProgress?.(`부재 검토 ${i + 1}/${M.length}`); } return out;
}
export function memberEnvelope(res, mi, combo) { const mf = memberForces(res, mi); return combo ? combine(mf, combo) : null; }

// ---------- 보 처짐 (사용하중: L, D) ----------
function segDefl(res, cr, ei, xs) { // 국부 z 처짐 at xi
  const E = res.R.E[ei]; const e = E.e, L = E.L, R = E.R, N = res.M.nodes; const d = cr.disp;
  const loc = (n, o) => [0, 1, 2].map(r => R[r][0] * d[n * 6 + o] + R[r][1] * d[n * 6 + o + 1] + R[r][2] * d[n * 6 + o + 2]);
  const u1 = loc(e.n1, 0), t1 = loc(e.n1, 3), u2 = loc(e.n2, 0), t2 = loc(e.n2, 3); const EI = e.EIy;
  if (!cr._byEl) { cr._byEl = new Map(); for (const l of cr.eloads) { let a = cr._byEl.get(l[0]); if (!a) cr._byEl.set(l[0], a = []); a.push(l); } }
  const pl = []; for (const [e2, xi, gx, gy, gz] of cr._byEl.get(ei) || []) { const p = R[2][0] * gx + R[2][1] * gy + R[2][2] * gz; pl.push([xi * L, p]); }
  const ss = e.rel?.[0] && e.rel?.[1];
  return xs.map(xi => { const x = xi * L, x2 = xi * xi, x3 = x2 * xi; const H1 = 1 - 3 * x2 + 2 * x3, H2 = L * (xi - 2 * x2 + x3), H3 = 3 * x2 - 2 * x3, H4 = L * (-x2 + x3);
    let w = H1 * u1[2] - H2 * t1[1] + H3 * u2[2] - H4 * t2[1];
    for (const [a, P] of pl) { const b = L - a; let xx = x, aa = a, bb = b; if (x > a) { xx = L - x; aa = b; bb = a; }
      w += ss ? P * bb * xx * (L * L - bb * bb - xx * xx) / (6 * EI * L) : P * bb * bb * xx * xx * (3 * aa * L - 3 * aa * xx - bb * xx) / (6 * EI * L ** 3); }
    return w; });
}
export function deflection(res, mi, lam = 2) {
  const m = res.M.members[mi]; const xs = [0, 0.25, 0.5, 0.75, 1]; const N = res.M.nodes; const deg = res.M._deg || (res.M._deg = (() => { const g = new Int32Array(N.length); for (const e of res.M.elems) { g[e.n1]++; g[e.n2]++; } return g; })());
  const first = res.R.E[m.segs[0]].e, last = res.R.E[m.segs[m.segs.length - 1]].e; const cant = m.el.cant || deg[first.n1] === 1 || deg[last.n2] === 1;
  const prof = (c) => { const cr = res.R.cases[c]; if (!cr || cr.rs) return null; const pts = []; let x0 = 0; for (const ei of m.segs) { const L = res.R.E[ei].L; segDefl(res, cr, ei, xs).forEach((w, j) => pts.push([x0 + xs[j] * L, w])); x0 += L; } return { pts, Lt: x0 }; };
  const rel = (p) => { if (!p) return 0; const [xa, wa] = p.pts[0], [xb, wb] = p.pts[p.pts.length - 1]; let mx = 0; for (const [x, w] of p.pts) { const ref = cant ? (deg[first.n1] === 1 ? wb : wa) : wa + (wb - wa) * (x - xa) / (xb - xa || 1); mx = Math.max(mx, Math.abs(w - ref)); } return mx; };
  const pL = prof('L'), pD = prof('D'); if (!pL) return null; const Lt = pL.Lt; const dL = rel(pL), dD = rel(pD);
  return { L: dL, LT: lam * dD + dL, limL: Lt / (cant ? 180 : 360), limLT: Lt / (cant ? 120 : 240), cant };
}
// ---------- 기초 ----------
export function designFoundations(res, S) {
  const { M, R } = res; const N = M.nodes; const fck = S.fckF || 30; const qaIn = S.qa > 0; const qa = (qaIn ? S.qa : 1e9) * 1e-3; const Df = S.Df || 1500; const gc = 24e-6, gsoil = 18e-6;
  const sup = []; N.forEach((n, id) => { if (n.used && n.fix) { const rD = R.cases.D.reac.get(id), rL = R.cases.L.reac.get(id); if (!rD) return; sup.push({ id, n, D: rD[2], L: rL ? rL[2] : 0, MD: [rD[3], rD[4]], ML: rL ? [rL[3], rL[4]] : [0, 0] }); } });
  const colAt = new Map(); for (const m of M.members) if (m.kind === 'column') { const e = R.E[m.segs[0]].e; if (N[e.n1].fix) colAt.set(e.n1, m); }
  const used = new Set(); const out = [];
  const punch = (Pu, qu, c1, c2, d) => { const b0 = 2 * (c1 + d) + 2 * (c2 + d); const bc = Math.max(c1, c2) / Math.min(c1, c2); const vc = Math.min((1 + 2 / bc) / 6, (40 * d / b0 + 2) / 12, 1 / 3) * Math.sqrt(fck); const Vu = Math.max(0, Pu - qu * (c1 + d) * (c2 + d)); return { Vu, phiVc: 0.75 * vc * b0 * d }; };
  for (const r of M.foots) {
    const el = r.el; const B = el.w, Lf = el.d, t = el.t, A = B * Lf; const ins = sup.filter(s => Math.abs(s.n.x - el.p[0]) <= B / 2 + 100 && Math.abs(s.n.y - el.p[1]) <= Lf / 2 + 100); if (!ins.length) continue; ins.forEach(s => used.add(s.id));
    let Ps = 0, Pu = 0, Mx = 0, My = 0; for (const s of ins) { Ps += s.D + s.L; Pu += 1.2 * s.D + 1.6 * s.L; Mx += s.MD[0] + s.ML[0] + (s.D + s.L) * (s.n.y - el.p[1]); My += s.MD[1] + s.ML[1] - (s.D + s.L) * (s.n.x - el.p[0]); }
    const W = gc * A * t + gsoil * A * Math.max(0, Df - t); const qmax = (Ps + W) / A + Math.abs(Mx) * 6 / (B * Lf * Lf) + Math.abs(My) * 6 / (Lf * B * B);
    const col = colAt.get(ins[0].id); const c1 = col ? col.by : 400, c2 = col ? col.hz : 400; const d = t - 95; const qu = Pu / A;
    const pc = punch(Pu, qu, c1, c2, d); const Vu1 = qu * B * Math.max(0, (Lf - c2) / 2 - d), phiV1 = 0.75 * Math.sqrt(fck) / 6 * B * d;
    const Mu = qu * B * ((Lf - c2) / 2) ** 2 / 2; const AsR = Math.max(asReq(Mu, B, d, fck, S.fy), 0.002 * B * t); const sp = specOf(M.P, el); const AsP = sp?.x ? asS(sp.x, B) : null;
    const rows = { kind: '독립기초', tag: el.tag || '', size: `${B}×${Lf}×${t}`, el, r, Ps, Pu, q: qmax, qa: qaIn ? qa : null, rq: qaIn ? qmax / qa : null, rp: pc.Vu / pc.phiVc, rv: Vu1 / phiV1, rm: AsP ? AsR / AsP : null, AsR, AsP, sp };
    rows.ratio = Math.max(rows.rq || 0, rows.rp, rows.rv, rows.rm || 0); out.push(rows);
  }
  for (const r of M.mats) {
    const el = r.el; const pts = el.pts; const A = Math.abs(polyArea(pts)); const t = el.t; let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; const ins = sup.filter(s => !used.has(s.id) && (pointInPoly([s.n.x, s.n.y], pts))); if (!ins.length) continue; ins.forEach(s => used.add(s.id));
    let Ps = 0, Pu = 0, Mx = 0, My = 0; for (const s of ins) { Ps += s.D + s.L; Pu += 1.2 * s.D + 1.6 * s.L; Mx += s.MD[0] + s.ML[0] + (s.D + s.L) * (s.n.y - cy); My += s.MD[1] + s.ML[1] - (s.D + s.L) * (s.n.x - cx); }
    const Bx = x1 - x0, By = y1 - y0; const W = gc * A * t; const qmax = (Ps + W) / A + Math.abs(Mx) * 6 / (Bx * By * By) * (A / (Bx * By)) + Math.abs(My) * 6 / (By * Bx * Bx) * (A / (Bx * By));
    const qu = Pu / A; const d = t - 100; let rp = 0, worst = null; for (const s of ins) { const col = colAt.get(s.id); if (!col) continue; const pc = punch(1.2 * s.D + 1.6 * s.L, qu, col.by, col.hz, d); const v = pc.Vu / pc.phiVc; if (v > rp) { rp = v; worst = col; } }
    const row = { kind: '매트기초', tag: el.tag || '', size: `${(A / 1e6).toFixed(0)}m² × t${t}`, el, r, Ps, Pu, q: qmax, qa: qaIn ? qa : null, rq: qaIn ? qmax / qa : null, rp, rv: 0, rm: null, n: ins.length, worst };
    row.ratio = Math.max(row.rq || 0, row.rp); out.push(row);
  }
  for (const s of sup) if (!used.has(s.id) && s.D + s.L > 1e3) { const col = colAt.get(s.id); const Ps = s.D + s.L; const net = qa - gc * Df; const B = Math.ceil(Math.sqrt(Ps / Math.max(net, 1e-5)) / 100) * 100; out.push({ kind: '기초 없음', tag: col?.el.tag || '', size: qaIn ? `필요 ≈ ${B}×${B}` : '지내력 입력 후 산정', Ps, Pu: 1.2 * s.D + 1.6 * s.L, q: null, qa, rq: null, ratio: null, node: s.n, el: col?.el, r: col?.r }); }
  return out;
}

// ---------- 재료 자동 산정용 ----------
export function envOf(res, mi) { const m = res.M.members[mi]; const st = m.kind === 'beam' ? undefined : [0, 0.5, 1]; const mf = memberForces(res, mi, st); return res.combos.map(c => ({ c, st: combine(mf, c) })); }
// 수직부재: 주근비 상한(rhoCap) 안에서 성립하는 최소 fck
export function minFckVertical(res, mi, S, cands, env = envOf(res, mi)) {
  const m = res.M.members[mi]; m.P = res.P;
  for (const fck of cands) {
    if (m.kind === 'wall') { const L = m.by, t = m.hz; const C = pmCurve(t, L, distLayers(L, 0.012 * L * t, S.fy), fck); let ok = true; let Vu = 0; for (const { st } of env) for (const s of st) { const Pu = -s.N, Mu = Math.abs(s.Mz); const cap = capAt(C, Pu); if (Pu > C.phiPmax || (cap <= 0 ? Mu > 0 && Pu > 0 : Mu > cap)) ok = false; Vu = Math.max(Vu, Math.abs(s.Vy)); } const ar = m.L / L, ac = ar <= 1.5 ? 0.25 : ar >= 2 ? 1 / 6 : 0.25 - (ar - 1.5) / 0.5 * (0.25 - 1 / 6); if (Vu > 0.75 * Math.min(L * t * (ac * Math.sqrt(fck) + 0.0025 * S.fyt), 5 / 6 * Math.sqrt(fck) * L * t)) ok = false; if (ok) return { fck, ok: true }; }
    else { const r = colUtil(m, env, S, 0.025, fck); let Vu = 0; for (const { st } of env) for (const s of st) Vu = Math.max(Vu, Math.abs(s.Vy), Math.abs(s.Vz)); const bmin = Math.min(m.by, m.hz), dmax = Math.max(m.by, m.hz) - 60; if (r.u <= 1 && Vu <= 0.75 * (5 / 6) * Math.sqrt(fck) * bmin * dmax) return { fck, ok: true }; }
  }
  return { fck: cands[cands.length - 1], ok: false };
}
export function beamOk(res, mi, S, fck, env = envOf(res, mi)) { const m = res.M.members[mi]; m.P = res.P; const d = rcBeam({ ...m, defl: null, P: { rebarSchedule: {} }, el: { ...m.el, rebar: null } }, env, { ...S, fck }); return d.rows.find(r => r[0].startsWith('ρ'))[2] <= 1 && d.rows.find(r => r[0] === 'φ(Vc+Vs,max)')[2] <= 1; }
export function steelOk(res, mi, S, Fy, env = envOf(res, mi)) { const m = res.M.members[mi]; return steel({ ...m, defl: null }, env, { ...S, Fy }).ratio <= 1; }
