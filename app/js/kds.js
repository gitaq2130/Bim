// 빌더 구조 설계 — KDS 14 20 (RC 강도설계: 등가직사각형 응력블록), KDS 14 31 (강구조 LRFD 근사), SRC 변형률 적합
import { memberForces, combine, Ec } from './structmodel.js';
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
const ES_S = 205000;
// 휨재 공칭강도 (KDS 14 31 10 4.4 — 횡비틀림좌굴 + 플랜지 국부좌굴, 압연 H형강 c=1)
export function steelFlexure(sh, Fy, Lb, Cb = 1) {
  const E = ES_S; const Sx = 2 * sh.Ix / sh.h, Zx = sh.Zx, ho = sh.h - sh.tf, ry = Math.sqrt(sh.Iy / sh.A), Cw = sh.Iy * ho * ho / 4, rts = Math.sqrt(Math.sqrt(sh.Iy * Cw) / Sx), J = sh.J;
  const Mp = Fy * Zx; const jj = J / (Sx * ho);
  const Lp = 1.76 * ry * Math.sqrt(E / Fy), Lr = 1.95 * rts * E / (0.7 * Fy) * Math.sqrt(jj + Math.sqrt(jj * jj + 6.76 * (0.7 * Fy / E) ** 2));
  let Mltb, zone;
  if (Lb <= Lp) { Mltb = Mp; zone = '소성 (Lb ≤ Lp)'; }
  else if (Lb <= Lr) { Mltb = Math.min(Mp, Cb * (Mp - (Mp - 0.7 * Fy * Sx) * (Lb - Lp) / (Lr - Lp))); zone = '비탄성 횡비틀림 (Lp < Lb ≤ Lr)'; }
  else { const s2 = (Lb / rts) ** 2; const Fcr = Cb * Math.PI ** 2 * E / s2 * Math.sqrt(1 + 0.078 * jj * s2); Mltb = Math.min(Mp, Fcr * Sx); zone = '탄성 횡비틀림 (Lb > Lr)'; }
  const lf = sh.b / (2 * sh.tf), lpf = 0.38 * Math.sqrt(E / Fy), lrf = 1.0 * Math.sqrt(E / Fy); let Mflb = Mp, flb = '조밀';
  if (lf > lrf) { const kc = Math.min(0.76, Math.max(0.35, 4 / Math.sqrt((sh.h - 2 * sh.tf) / sh.tw))); Mflb = 0.9 * E * kc * Sx / (lf * lf); flb = '세장'; }
  else if (lf > lpf) { Mflb = Mp - (Mp - 0.7 * Fy * Sx) * (lf - lpf) / (lrf - lpf); flb = '비조밀'; }
  const webOk = (sh.h - 2 * sh.tf) / sh.tw <= 3.76 * Math.sqrt(E / Fy);
  return { Mn: Math.min(Mltb, Mflb), Mp, Mltb, Mflb, Lp, Lr, zone, flb, lf, lpf, webOk, Sx };
}
// 보 상부 플랜지가 슬래브로 연속 구속되는지 (보 중앙 또는 양옆이 같은 레벨 슬래브 안)
function topBraced(res, m) {
  if (m._tb != null) return m._tb; const z = res.M.nodes[res.R.E[m.segs[0]].e.n1].z; const el = m.el; if (!el.a || !el.b) return (m._tb = false);
  const mx = (el.a[0] + el.b[0]) / 2, my = (el.a[1] + el.b[1]) / 2, dx = el.b[0] - el.a[0], dy = el.b[1] - el.a[1], l = Math.hypot(dx, dy) || 1, o = m.by / 2 + 150, nx = -dy / l * o, ny = dx / l * o;
  return (m._tb = res.M.slabs.some(s => s.z === z && [[mx, my], [mx + nx, my + ny], [mx - nx, my - ny]].some(p => pointInPoly(p, s.pts))));
}
// 비지지 구간: [{x0,x1,Lb,Cb,idx:[station 번호]}] — 모멘트도(1차)에서 산정
function unbraced(st, segL, braced, cant = false) {
  const out = []; const M = st.map(s => s.My); const X = st.map(s => s.x);
  const cbOf = (x0, x1) => { const at = (x) => { for (let i = 0; i < X.length - 1; i++) if (x >= X[i] - 1e-6 && x <= X[i + 1] + 1e-6) { const t = X[i + 1] - X[i] ? (x - X[i]) / (X[i + 1] - X[i]) : 0; return Math.abs(M[i] + (M[i + 1] - M[i]) * t); } return Math.abs(M[M.length - 1]); };
    let mx = 0; for (let i = 0; i < X.length; i++) if (X[i] >= x0 - 1e-6 && X[i] <= x1 + 1e-6) mx = Math.max(mx, Math.abs(M[i])); mx = Math.max(mx, at(x0), at(x1)); if (!mx) return 1;
    if (cant) return 1; const L = x1 - x0; return Math.min(3, 12.5 * mx / (2.5 * mx + 3 * at(x0 + L / 4) + 4 * at(x0 + L / 2) + 3 * at(x0 + 3 * L / 4))); };
  if (!braced) { // 골조 절점(부재 분할점) 사이
    let x0 = 0; for (const [ei, L] of segL) { const idx = st.map((s, i) => i).filter(i => st[i].ei === ei); out.push({ x0, x1: x0 + L, Lb: L, Cb: cbOf(x0, x0 + L), idx, why: '골조 절점 사이' }); x0 += L; }
    return out;
  }
  // 상부 플랜지 구속: 부모멘트(My<0) 구간만 비지지 — 변곡점까지
  let i = 0; while (i < st.length) {
    if (M[i] >= 0) { i++; continue; } let j = i; while (j + 1 < st.length && M[j + 1] < 0) j++;
    const zx = (a, b) => X[a] + (X[b] - X[a]) * M[a] / (M[a] - M[b]); const x0 = i > 0 ? zx(i - 1, i) : X[i], x1 = j < st.length - 1 ? zx(j, j + 1) : X[j];
    const idx = []; for (let k = i; k <= j; k++) idx.push(k); if (x1 - x0 > 1) out.push({ x0, x1, Lb: x1 - x0, Cb: cbOf(x0, x1), idx, why: cant ? '캔틸레버 (하부 플랜지 압축, Cb = 1)' : '부모멘트 구간 (변곡점까지, 하부 플랜지 압축)' }); i = j + 1;
  }
  return out;
}
function steel(m, env, S, env1 = env, res = null) {
  const sh = m.sh, Fy = S.Fy, E = ES_S; const A = sh.A, rx = Math.sqrt(sh.Ix / A), ry = Math.sqrt(sh.Iy / A); const KL = m.L;
  const lam = KL / Math.min(rx, ry); const Fe = Math.PI ** 2 * E / lam ** 2; const Fcr = Fy / Fe <= 2.25 ? Math.pow(0.658, Fy / Fe) * Fy : 0.877 * Fe;
  const Pc = 0.9 * Fcr * A, Pt = 0.9 * Fy * A, Mcy = 0.9 * Fy * sh.Zy, Vc = 0.9 * 0.6 * Fy * sh.h * sh.tw;
  const fl0 = steelFlexure(sh, Fy, 0); const Mcx0 = 0.9 * fl0.Mn; // 횡지지 충분 시 (국부좌굴만)
  const beam = m.kind === 'beam'; const braced = beam && res ? topBraced(res, m) : false; const segL = res ? m.segs.map(ei => [ei, res.R.E[ei].L]) : [[null, m.L]];
  let u = 0, at = null, Vu = 0, cV = ''; let ltbMin = null;
  env.forEach(({ c, st }, ci) => {
    const s1 = env1[ci].st; const cap = new Float64Array(st.length).fill(Mcx0); const segOf = new Array(st.length).fill(null);
    const ub = beam ? unbraced(s1, segL, braced, !!m.defl?.cant) : [{ x0: 0, x1: m.L, Lb: m.L, Cb: unbraced(s1, [[s1[0].ei, m.L]], false)[0]?.Cb || 1, idx: st.map((_, i) => i), why: '층고 (기둥 상·하단)' }];
    for (const g of ub) { const f = steelFlexure(sh, Fy, g.Lb, g.Cb); const cp = 0.9 * f.Mn; g.f = f; g.cap = cp; for (const k of g.idx) if (cp <= cap[k]) { cap[k] = cp; segOf[k] = g; } }
    st.forEach((s, k) => {
      const Pr = -s.N, Pa = Pr >= 0 ? Pc : Pt, pr = Math.abs(Pr) / Pa, mx = Math.abs(s.My) / cap[k], my = Math.abs(s.Mz) / Mcy;
      const v = pr >= 0.2 ? pr + 8 / 9 * (mx + my) : pr / 2 + mx + my; if (v > u) { u = v; at = { c: c.name, Pr, Mx: Math.abs(s.My), My: Math.abs(s.Mz), cap: cap[k], seg: segOf[k] }; }
      const g = segOf[k]; if (g && Math.abs(s.My) > 0) { const r = Math.abs(s.My) / g.cap; if (!ltbMin || r > ltbMin.r) ltbMin = { r, g, c: c.name, M: Math.abs(s.My) }; }
      const vv = Math.max(Math.abs(s.Vz), Math.abs(s.Vy)); if (vv > Vu) { Vu = vv; cV = c.name; }
    });
  });
  const rv = Vu / Vc; const a = at || {}; const df = beam ? m.defl : null; const rdf = df ? df.L / df.limL : 0; const ratio = Math.max(u, rv, rdf);
  const g = a.seg || ltbMin?.g; const ltbGov = !!(a.seg && a.cap < Mcx0 * 0.999);
  const lrow = g ? [['횡지지 (Lb · Cb)', `${beam ? (braced ? '상부 플랜지 슬래브 구속 · ' : '슬래브 구속 없음 · ') : ''}${g.why} — Lb ${(g.Lb / 1000).toFixed(2)} m · Cb ${g.Cb.toFixed(2)}`], ['Lp / Lr', `${(g.f.Lp / 1000).toFixed(2)} / ${(g.f.Lr / 1000).toFixed(2)} m — ${g.f.zone}`], ['φMn (횡비틀림)', `${kNm(g.cap)} (φMp ${kNm(0.9 * g.f.Mp)})`, ltbMin && ltbMin.g === g ? ltbMin.r : undefined]]
    : [['횡지지', beam && braced ? '상부 플랜지 슬래브 구속 · 부모멘트 구간 없음 → 횡비틀림 검토 불요' : '-']];
  const flrow = [['플랜지 국부좌굴', `b/2tf ${fl0.lf.toFixed(1)} (λp ${fl0.lpf.toFixed(1)}) — ${fl0.flb}${fl0.webOk ? '' : ' · 웨브 비조밀 (별도 검토)'}`]];
  return { type: beam ? '철골 보' : '철골 기둥', ratio, gov: rdf >= Math.max(u, rv) ? '처짐' : u >= rv ? (ltbGov ? '조합(H1-1)·횡비틀림' : '조합(H1-1)') : '전단', combo: u >= rv ? a.c : cV, extra: df ? [['처짐 활하중', `${df.L.toFixed(1)} mm ≤ L/${df.cant ? 180 : 360} = ${df.limL.toFixed(1)}`, rdf]] : [],
    rows: [['단면', `${m.el.sec} · Fy ${Fy}`], ['A / Zx', `${mm2(A)} / ${(sh.Zx / 1e3).toFixed(0)}×10³mm³`], ['KL/r', lam.toFixed(0)], ['Pr / φPn', `${kN(a.Pr || 0)} / ${kN((a.Pr || 0) >= 0 ? Pc : Pt)}`, a.c], ['Mrx / φMnx', `${kNm(a.Mx || 0)} / ${kNm(a.cap || Mcx0)}`], ...lrow, ...flrow, ['Mry / φMny', `${kNm(a.My || 0)} / ${kNm(Mcy)}`], ['H1-1 검토비', u.toFixed(3), u], ['Vu / φVn', `${kN(Vu)} / ${kN(Vc)}`, rv]] };
}
// ---------- 세장효과 (KDS 14 20 20 4.4 모멘트 확대법 · KDS 14 31 10 B1·B2) ----------
// 층 안정지수 Q = ΣPu·Δo/(Vus·lc), 접합부 강성비 ψ → 유효길이계수 k (조견표 근사식)
function frameOf(res) {
  if (res._fr) return res._fr; const { M, R } = res;
  const at = new Map(); R.E.forEach((E, ei) => { const e = E.e; if (e.rigid || e.mem < 0) return; for (const n of [e.n1, e.n2]) { let a = at.get(n); if (!a) at.set(n, a = []); a.push(ei); } });
  const st = res.story || []; const ch = res.info?.check; const lr = ch && ch.D.applied ? Math.max(0, ch.L.applied / ch.D.applied) : 0.3;
  const Q = new Array(st.length).fill(0), Qc = new Array(st.length).fill(''); let Wab = 0;
  for (let i = st.length - 1; i >= 0; i--) { Wab += st[i].W; const f = st[i]; const Pu = (1.2 + lr) * Wab; for (const c of ['WX', 'WY', 'EX', 'EY']) { if (f['dr' + c] == null) continue; let V = 0; for (let j = i; j < st.length; j++) V += st[j][c] || 0; if (!V) continue; const q = Pu * Math.abs(f['dr' + c]) / Math.abs(V); if (q > Q[i]) { Q[i] = q; Qc[i] = c; } } }
  return (res._fr = { at, Q, Qc, storyAt: new Map(st.map((f, i) => [f.z, i])) });
}
function psiAt(res, fr, n, ci, key) {
  const N = res.M.nodes; if (N[n].fix) return 1; const dirN = res.R.E[ci].R[key === 'My' ? 2 : 1]; let sc = 0, sb = 0;
  for (const ei of fr.at.get(n) || []) { const E = res.R.E[ei], e = E.e; const mem = res.M.members[e.mem]; if (!mem) continue;
    if (e.vert) { if (mem.kind === 'column') sc += (key === 'My' ? e.EIy : e.EIz) / E.L; continue; }
    if (mem.kind !== 'beam') continue; const end = e.n1 === n ? 0 : 1; if (e.rel?.[end]) continue; const d = E.R[0]; const w = (d[0] * dirN[0] + d[1] * dirN[1] + d[2] * dirN[2]) ** 2; sb += w * (e.rel?.[1 - end] ? 0.5 : 1) * e.EIy / E.L; }
  return sb > 0 ? Math.min(50, sc / sb) : 50;
}
const kBraced = (a, b) => Math.min(1, 0.7 + 0.05 * (a + b), 0.85 + 0.05 * Math.min(a, b));
const kSway = (a, b) => { const p = (a + b) / 2; return p < 2 ? (20 - p) / 20 * Math.sqrt(1 + p) : 0.9 * Math.sqrt(1 + p); };
function slender(res, mi, mf, env, S) {
  const m = res.M.members[mi]; const fr = frameOf(res); const N = res.M.nodes; const ci = m.segs[0]; const nb = res.R.E[ci].e.n1, nt = res.R.E[m.segs[m.segs.length - 1]].e.n2;
  const stl = m.mat === 'STEEL' && m.sh; const L = m.L; let hb = 0; for (const ei of fr.at.get(nt) || []) { const mm = res.M.members[res.R.E[ei].e.mem]; if (mm?.kind === 'beam') hb = Math.max(hb, mm.hz); }
  const lu = stl ? L : Math.max(0.6 * L, L - hb); const si = fr.storyAt.get(N[nt].z); const Q = si != null ? fr.Q[si] : 0; const sway = Q > 0.05; const pd = !!res.info?.pdelta;
  const fck = m.fck || S.fckV || S.fck; const Ecm = Ec(fck); const sh = m.sh;
  const AX = [{ k: 'My', d: m.hz, r: stl ? Math.sqrt(sh.Ix / sh.A) : 0.3 * m.hz, Ig: m.by * m.hz ** 3 / 12, Is: sh ? sh.Ix : 0, nm: '강축' }, { k: 'Mz', d: m.by, r: stl ? Math.sqrt(sh.Iy / sh.A) : 0.3 * m.by, Ig: m.hz * m.by ** 3 / 12, Is: sh ? sh.Iy : 0, nm: '약축' }];
  for (const a of AX) { a.pT = psiAt(res, fr, nt, ci, a.k); a.pB = psiAt(res, fr, nb, ci, a.k); a.kn = stl ? 1 : kBraced(a.pT, a.pB); a.ks = kSway(a.pT, a.pB); a.dns = 1; a.ds = 1; a.slen = false; a.lim = 0; a.lr = a.kn * lu / a.r; }
  const dsRaw = sway && !pd ? 1 / (1 - Math.min(Q, 0.9)) : 1; let unstable = 0;
  const ND = mf.byCase.D; const nS = ND.length; const ND0 = -ND.reduce((s, x) => s + x.N, 0) / nS;
  const env2 = env.map(({ c, st }) => {
    const lk = Object.keys(c.f).filter(k => /^[WER]/.test(k)); const g = combine(mf, { f: Object.fromEntries(Object.entries(c.f).filter(([k]) => !lk.includes(k))) }); const l = lk.length ? combine(mf, { f: Object.fromEntries(lk.map(k => [k, c.f[k]])) }) : null;
    const st2 = st.map(s => ({ ...s })); const Pu = Math.max(0, -st.reduce((s, x) => s + x.N, 0) / st.length); const bd = Pu > 0 ? Math.min(1, Math.max(0, (c.f.D || 0) * ND0 / Pu)) : 0.6;
    for (const a of AX) {
      const ds = l && (stl || a.ks * lu / a.r > 22) ? dsRaw : 1; for (let j = 0; j < nS; j++) st2[j][a.k] = g[j][a.k] + ds * (l ? l[j][a.k] : 0);
      const e0 = st2[0][a.k], e1 = st2[nS - 1][a.k]; const big = Math.abs(e0) >= Math.abs(e1) ? e0 : e1, small = big === e0 ? e1 : e0; const ratio = big ? small / big : 1;
      a.ds = Math.max(a.ds, ds); if (Pu <= 0) continue;
      const lim = Math.min(40, 34 - 12 * ratio); const slen = stl || a.kn * lu / a.r > lim; if (!slen) { a.lim = Math.max(a.lim, lim); continue; }
      let M2 = Math.abs(big), Cm = Math.max(0.4, 0.6 + 0.4 * ratio); const M2min = stl ? 0 : Pu * (15 + 0.03 * a.d); if (M2 < M2min) { M2 = M2min; Cm = 1; }
      const EI = stl ? ES_S * a.Is : (sh ? 0.2 * Ecm * a.Ig + ES_S * a.Is : 0.4 * Ecm * a.Ig) / (1 + bd); const Pcr = Math.PI ** 2 * EI / (a.kn * lu) ** 2; const den = 1 - Pu / ((stl ? 1 : 0.75) * Pcr);
      let dns; if (den <= 0.05) { dns = 20; unstable = Math.max(unstable, Pu / ((stl ? 1 : 0.75) * Pcr)); } else dns = Math.max(1, Cm / den);
      a.slen = true; a.lim = lim; if (dns > a.dns) { a.dns = dns; a.Cm = Cm; a.Pc = Pcr; a.c = c.name; a.min = M2min && M2 === M2min; }
      const Mc = dns * M2 * Math.sign(big || 1); for (let j = 1; j < nS - 1; j++) if (Math.abs(st2[j][a.k]) < Math.abs(Mc)) st2[j][a.k] = Mc;
      if (nS === 1) st2[0][a.k] = Mc;
    }
    return { c, st: st2 };
  });
  const f2 = (v) => v.toFixed(2); const rows = [];
  rows.push(['횡이동 판정 (층 안정지수 Q)', si == null ? '층 정보 없음 — 비횡이동 가정' : `Q ${Q.toFixed(3)} ${sway ? '> 0.05 → 횡이동 골조' : '≤ 0.05 → 비횡이동 골조'}${sway && pd ? ' · P-Δ 2차 해석 반영 (δs = 1)' : ''}${fr.Qc[si] ? ` (${fr.Qc[si]})` : ''}`]);
  rows.push(['접합부 강성비 ψ 상/하', AX.map(a => `${a.nm} ${a.pT >= 50 ? '∞' : f2(a.pT)}/${a.pB >= 50 ? '∞' : f2(a.pB)}`).join(' · ')]);
  if (stl) rows.push(['B1 (부재) / B2 (층)', AX.map(a => `${a.nm} ${f2(a.dns)} / ${f2(a.ds)}`).join(' · ') + ` · Pe1 강축 ${kN(AX[0].Pc || 0)}`]);
  else { rows.push(['유효길이 (비횡이동) k·lu/r', AX.map(a => `${a.nm} k ${f2(a.kn)} · ${a.lr.toFixed(1)}${a.slen ? ` > ${a.lim.toFixed(0)} 장주` : ` ≤ ${a.lim.toFixed(0)} 단주`}`).join(' · ') + ` (lu ${(lu / 1000).toFixed(2)} m)`]);
    if (sway) rows.push(['유효길이 (횡이동) k·lu/r', AX.map(a => `${a.nm} k ${f2(a.ks)} · ${(a.ks * lu / a.r).toFixed(1)}${a.ks * lu / a.r > 22 ? (pd ? ' > 22 → P-Δ 해석 반영' : ' > 22 → δs') : ' ≤ 22 무시'}`).join(' · ')]);
    rows.push(['모멘트 확대 δns / δs', AX.map(a => `${a.nm} ${f2(a.dns)}${a.min ? '(M2,min)' : ''} / ${f2(a.ds)}`).join(' · ')]); }
  if (dsRaw > 1.5) rows.push(['횡이동 확대 주의', `δs ${f2(dsRaw)} > 1.5 — 2차(P-Δ) 해석으로 확인 필요`]);
  if (unstable) rows.push(['좌굴', `Pu / 0.75Pc = ${unstable.toFixed(2)} — 단면 증대 필요`, unstable]);
  return { env: env2, rows, unstable, mag: Math.max(...AX.map(a => a.dns * a.ds)) };
}
const kN = (v) => `${(v / 1e3).toFixed(1)} kN`, kNm = (v) => `${(v / 1e6).toFixed(1)} kN·m`, mm2 = (v) => isFinite(v) ? `${Math.round(v).toLocaleString('ko-KR')} mm²` : '∞';

const stOf = (m) => m.kind === 'beam' ? undefined : m.mat === 'STEEL' && m.sh ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 1];
// 부재 조합 단면력 (기둥은 세장효과 확대 반영) → { env, env1(1차), sl }
function envFull(res, mi, S) {
  const m = res.M.members[mi]; const mf = memberForces(res, mi, stOf(m)); const env1 = res.combos.map(c => ({ c, st: combine(mf, c) }));
  if (m.kind !== 'column' || !res.R?.E) return { env: env1, env1, sl: null }; const sl = slender(res, mi, mf, env1, S); return { env: sl.env, env1, sl };
}
export function designMember(res, mi, S) {
  const m = res.M.members[mi]; m.P = res.P; if (m.kind === 'beam') m.defl = deflection(res, mi, m.mat === 'STEEL' ? 1 : 2);
  const { env, env1, sl } = envFull(res, mi, S);
  const d = m.mat === 'STEEL' && m.sh ? steel(m, env, S, env1, res) : m.kind === 'beam' ? rcBeam(m, env, S) : m.kind === 'wall' ? rcWall(m, env, S) : rcColumn(m, env, S);
  if (d.gov2) d.gov = d.gov2; if (d.extra) d.rows.push(...d.extra);
  if (sl) { d.rows.push(...sl.rows); d.mag = sl.mag; if (sl.unstable > d.ratio) { d.ratio = sl.unstable; d.gov = '세장(좌굴)'; } else if (sl.mag > 1.05 && /P-M|H1-1/.test(d.gov)) d.gov += ' (세장 확대)'; }
  d.mi = mi; return d;
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
export function envOf(res, mi, S = {}) { return envFull(res, mi, S).env; }
// 수직부재: 주근비 상한(rhoCap) 안에서 성립하는 최소 fck
export function minFckVertical(res, mi, S, cands, env = envOf(res, mi, S)) {
  const m = res.M.members[mi]; m.P = res.P;
  for (const fck of cands) {
    if (m.kind === 'wall') { const L = m.by, t = m.hz; const C = pmCurve(t, L, distLayers(L, 0.012 * L * t, S.fy), fck); let ok = true; let Vu = 0; for (const { st } of env) for (const s of st) { const Pu = -s.N, Mu = Math.abs(s.Mz); const cap = capAt(C, Pu); if (Pu > C.phiPmax || (cap <= 0 ? Mu > 0 && Pu > 0 : Mu > cap)) ok = false; Vu = Math.max(Vu, Math.abs(s.Vy)); } const ar = m.L / L, ac = ar <= 1.5 ? 0.25 : ar >= 2 ? 1 / 6 : 0.25 - (ar - 1.5) / 0.5 * (0.25 - 1 / 6); if (Vu > 0.75 * Math.min(L * t * (ac * Math.sqrt(fck) + 0.0025 * S.fyt), 5 / 6 * Math.sqrt(fck) * L * t)) ok = false; if (ok) return { fck, ok: true }; }
    else { const r = colUtil(m, env, S, 0.025, fck); let Vu = 0; for (const { st } of env) for (const s of st) Vu = Math.max(Vu, Math.abs(s.Vy), Math.abs(s.Vz)); const bmin = Math.min(m.by, m.hz), dmax = Math.max(m.by, m.hz) - 60; if (r.u <= 1 && Vu <= 0.75 * (5 / 6) * Math.sqrt(fck) * bmin * dmax) return { fck, ok: true }; }
  }
  return { fck: cands[cands.length - 1], ok: false };
}
export function beamOk(res, mi, S, fck, env = envOf(res, mi, S)) { const m = res.M.members[mi]; m.P = res.P; const d = rcBeam({ ...m, defl: null, P: { rebarSchedule: {} }, el: { ...m.el, rebar: null } }, env, { ...S, fck }); return d.rows.find(r => r[0].startsWith('ρ'))[2] <= 1 && d.rows.find(r => r[0] === 'φ(Vc+Vs,max)')[2] <= 1; }
export function steelOk(res, mi, S, Fy, env = envOf(res, mi, S)) { const m = res.M.members[mi]; const e1 = m.kind === 'column' ? envFull(res, mi, S).env1 : env; return steel({ ...m, defl: null }, env, { ...S, Fy }, e1, res).ratio <= 1; }

// ---------- 철골 접합부 (KDS 14 31 25 — F10T 마찰접합 볼트, 필릿·완전용입 용접) ----------
// 툴이 볼트 지름·개수, 연결판 두께, 용접 치수, 스티프너·패널존 보강판을 자동 산정 (판재 SM355, 용접봉 E49)
const BOLT = { M20: { d: 20, T0: 165e3, p: 70, e: 40, hole: 22, Ab: 314 }, M22: { d: 22, T0: 205e3, p: 75, e: 45, hole: 24, Ab: 380 }, M24: { d: 24, T0: 238e3, p: 80, e: 50, hole: 27, Ab: 452 } };
const PL = [9, 12, 16, 19, 22, 25, 28, 32, 36, 40]; const FyP = 355, FuP = 490, FEXX = 490, ECC = 65;
const minFillet = (t) => t <= 6 ? 3 : t <= 13 ? 5 : t <= 19 ? 6 : 8;
const boltCap = (B, t, Fu, planes = 1) => { const slip = 1.0 * 0.5 * B.T0 * planes, shr = 0.75 * 0.4 * 1000 * B.Ab * planes, lc = B.e - B.hole / 2, brg = 0.75 * Math.min(1.2 * lc * t * Fu, 2.4 * B.d * t * Fu); return { cap: Math.min(slip, shr, brg), slip, shr, brg }; };
// 전단판 (단일 판, 볼트 1열) — V, 축력 N, 웨브 두께 tw(보), 지지면 두께 tsup
function shearTab(V, N, beam, Fyb, tsup) {
  const sh = beam; const usable = sh.h - 2 * sh.tf - 60; const sizes = sh.h >= 700 ? ['M24'] : sh.h >= 400 ? ['M22', 'M24'] : ['M20', 'M22', 'M24']; let best = null;
  for (const cols of [1, 2]) for (const bk of sizes) { const B = BOLT[bk]; const nmax = Math.max(2, Math.floor((usable - 2 * B.e) / B.p) + 1); const gx = B.p;
    for (let n = 2; n <= nmax; n++) for (const tp of PL.slice(0, 6)) {
      if (tp > B.d / 2 + 6 && tp > sh.tw && cols === 1) continue; // 회전 연성 (1열: 판 두께 ≤ d/2+6 또는 웨브 이하)
      const hp = (n - 1) * B.p + 2 * B.e, nb = n * cols, e = ECC + (cols - 1) * gx / 2; const ys = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * B.p); const xs = cols === 2 ? [-gx / 2, gx / 2] : [0];
      let Ip = 0; for (const x of xs) for (const y of ys) Ip += x * x + y * y; Ip = Ip || 1; const xm = xs[xs.length - 1], ym = ys[n - 1];
      const Rv = V / nb + V * e * xm / Ip, Rh = V * e * ym / Ip + Math.abs(N) / nb; const Rb = Math.hypot(Rv, Rh);
      const bc = boltCap(B, Math.min(tp, sh.tw), FuP); const r1 = Rb / bc.cap;
      const ry = V / (1.0 * 0.6 * FyP * hp * tp), rr = V / (0.75 * 0.6 * FuP * (hp - n * B.hole) * tp);
      const Anv = (hp - B.e - (n - 0.5) * B.hole) * tp, Agv = (hp - B.e) * tp, Ant = (40 + (cols - 1) * gx - (cols - 0.5) * B.hole) * tp; const rbs = V / (0.75 * Math.min(0.6 * FuP * Anv + FuP * Ant, 0.6 * FyP * Agv + FuP * Ant));
      const rm = V * e / (0.9 * FyP * tp * hp * hp / 4); const ra = Math.abs(N) / (0.9 * FyP * hp * tp);
      const s1 = Math.hypot(V / (2 * 0.707 * hp), 6 * V * e / (2 * 0.707 * hp * hp), Math.abs(N) / (2 * 0.707 * hp)) / (0.75 * 0.6 * FEXX); // 필요 목두께 기준 용접 치수
      const s = Math.max(minFillet(Math.max(tp, tsup || tp)), Math.ceil(s1), Math.ceil(5 / 8 * tp)); if (s > tp) continue; const r = Math.max(r1, ry, rr, rbs, rm, ra);
      const cand = { bk, B, n, cols, nb, e, tp, hp, s, r, r1, ry, rr, rbs, rm, ra, Rb, bc };
      if (r <= 1) return cand; if (!best || r < best.r) best = cand;
    } }
  return best;
}
function supportOf(res, mi, end) {
  const { M, R } = res; const fr = frameOf(res); const m = M.members[mi]; const ei = end ? m.segs[m.segs.length - 1] : m.segs[0]; const E = R.E[ei]; const n = end ? E.e.n2 : E.e.n1;
  let col = null, girder = null; for (const ej of fr.at.get(n) || []) { if (ej === ei) continue; const e = R.E[ej].e; const mm = M.members[e.mem]; if (!mm || e.mem === mi) continue; if (mm.kind === 'column' && !col) col = { mm, ej }; else if (mm.kind === 'beam' && !girder) girder = { mm, ej }; else if (mm.kind === 'wall') col = { mm, ej, wall: true }; }
  const rigidWall = R.E.some(x => x.e.rigid && (x.e.n1 === n || x.e.n2 === n));
  const rel = !!E.e.rel?.[end ? 1 : 0]; const dir = E.R[0];
  if (col && !col.wall) { const cm = col.mm; const C = R.E[col.ej]; const zc = C.R[2]; const strong = Math.abs(dir[0] * zc[0] + dir[1] * zc[1]) >= 0.7; return { n, rel, kind: cm.mat === 'STEEL' && cm.sh ? '철골 기둥' : cm.sh ? 'SRC 기둥' : 'RC 기둥', sup: cm, strong, steel: !!cm.sh }; }
  if (girder) return { n, rel, kind: girder.mm.mat === 'STEEL' && girder.mm.sh ? '철골 큰보' : 'RC 보', sup: girder.mm, steel: girder.mm.mat === 'STEEL' && !!girder.mm.sh };
  if (rigidWall || col?.wall) return { n, rel, kind: 'RC 벽', sup: col?.mm || null, steel: false };
  return null; // 자유단
}
export function designConnections(res, S) {
  const { M } = res; const out = []; const pz = new Map(); const Fy = S.Fy || 355, E = ES_S;
  for (let mi = 0; mi < M.members.length; mi++) {
    const m = M.members[mi]; if (m.kind !== 'beam' || m.mat !== 'STEEL' || !m.sh) continue; const sh = m.sh; const mf = memberForces(res, mi);
    for (const end of [0, 1]) {
      const sp = supportOf(res, mi, end); if (!sp) continue; let V = 0, Mu = 0, N = 0, cV = '', cM = '';
      for (const c of res.combos) { const st = combine(mf, c); const s = end ? st[st.length - 1] : st[0]; if (Math.abs(s.Vz) > V) { V = Math.abs(s.Vz); cV = c.name; } if (Math.abs(s.My) > Mu) { Mu = Math.abs(s.My); cM = c.name; } N = Math.max(N, Math.abs(s.N)); }
      const rigid = !sp.rel && Mu > 1e6; const tsup = sp.sup?.sh ? (sp.strong === false ? sp.sup.sh.tw : sp.sup.sh.tf) : sp.sup?.sh ? sp.sup.sh.tw : 20;
      const tab = shearTab(V, N, sh, Fy, sp.kind === '철골 큰보' ? sp.sup.sh.tw : tsup); const rows = []; let ratio = tab.r; const items = []; const notes = [];
      rows.push(['지지', `${sp.kind}${sp.strong != null ? (sp.strong ? ' (강축·플랜지면)' : ' (약축·웨브면)') : ''} — ${sp.sup?.el?.tag || ''}`], ['설계력', `Vu ${kN(V)} (${cV}) · Mu ${kNm(rigid ? Mu : 0)}${rigid ? ` (${cM})` : ''} · Nu ${kN(N)}`]);
      rows.push(['전단판', `PL-${tab.tp}×${Math.round(tab.hp)} (SM355) · ${tab.bk} F10T ${tab.nb}개 (${tab.n}×${tab.cols}열) @${tab.B.p}`, tab.r]);
      rows.push(['볼트 1개', `작용 ${kN(tab.Rb)} / φRn ${kN(tab.bc.cap)} (미끄럼 ${kN(tab.bc.slip)} · 전단 ${kN(tab.bc.shr)} · 지압 ${kN(tab.bc.brg)}) · 편심 ${tab.e} mm`, tab.r1]);
      rows.push(['전단판 검토', `항복 ${tab.ry.toFixed(2)} · 파단 ${tab.rr.toFixed(2)} · 블록전단 ${tab.rbs.toFixed(2)} · 휨 ${tab.rm.toFixed(2)}`, Math.max(tab.ry, tab.rr, tab.rbs, tab.rm)]);
      rows.push(['용접 (전단판→지지면)', `양면 필릿 ${tab.s} mm × ${Math.round(tab.hp)} (E49)`]);
      items.push(`${tab.bk}×${tab.nb}`, `PL-${tab.tp}`);
      let type = sp.rel || !rigid ? '전단 접합' : '';
      if (!type) {
        const Ff = Mu / (sh.h - sh.tf) + N * sh.b * sh.tf / sh.A;
        if (sp.kind === '철골 기둥' || sp.kind === 'SRC 기둥') {
          const c = sp.sup.sh; const Fyc = S.Fy || 355;
          if (sp.strong) {
            type = '강접 — 플랜지 완전용입 + 웨브 전단판'; const rf = Ff / (0.9 * Fy * sh.b * sh.tf); ratio = Math.max(ratio, rf);
            rows.push(['플랜지 용접', `완전용입(CJP) · 플랜지력 Ff ${kN(Ff)} / φFy·bf·tf ${kN(0.9 * Fy * sh.b * sh.tf)} · 스캘럽 R35`, rf]);
            const k = c.tf + 15; const flb = 0.9 * 6.25 * Fyc * c.tf ** 2, wly = 1.0 * (5 * k + sh.tf) * Fyc * c.tw, wc = 0.75 * 0.8 * c.tw ** 2 * (1 + 3 * (sh.tf / c.h) * (c.tw / c.tf) ** 1.5) * Math.sqrt(E * Fyc * c.tf / c.tw); const Rmin = Math.min(flb, wly, wc);
            if (Rmin < Ff) { const As = (Ff - Rmin) / (0.9 * FyP); const bs = (c.b - c.tw) / 2 - 15; const ts = PL.find(t => 2 * bs * t >= As && t >= sh.tf / 2) || PL[PL.length - 1]; rows.push(['기둥 국부 (플랜지휨·웨브항복·크리플링)', `${kN(flb)} · ${kN(wly)} · ${kN(wc)} < Ff → 수평 스티프너 2-PL-${ts}×${Math.round(bs)} (상·하 플랜지 위치)`]); items.push(`스티프너 PL-${ts}`); }
            else rows.push(['기둥 국부 (플랜지휨·웨브항복·크리플링)', `${kN(flb)} · ${kN(wly)} · ${kN(wc)} ≥ Ff → 스티프너 불요`, Ff / Rmin]);
            const key = sp.n; const z = pz.get(key) || pz.set(key, { c, Fyc, F: 0, list: [], tag: sp.sup.el.tag }).get(key); z.F += Ff; z.list.push(out.length);
          } else {
            type = '강접 — 약축 (웨브면 수평 연결판)'; const tpl = PL.find(t => t >= sh.tf && 0.9 * FyP * sh.b * t >= Ff) || PL[PL.length - 1]; const r2 = Ff / (0.9 * FyP * sh.b * tpl); ratio = Math.max(ratio, r2);
            rows.push(['수평 연결판', `기둥 웨브·플랜지 끝에 PL-${tpl}×${sh.b} 완전용입, 보 플랜지와 완전용입 (Ff ${kN(Ff)})`, r2]); items.push(`연결판 PL-${tpl}`);
          }
        } else if (sp.kind === '철골 큰보') {
          type = '강접 — 플랜지 볼트 연결판'; const B = BOLT[sh.h >= 400 ? 'M22' : 'M20']; const tpl = PL.find(t => t >= sh.tf && 0.9 * FyP * sh.b * t >= Ff && 0.75 * FuP * (sh.b - 2 * B.hole) * t >= Ff) || PL[PL.length - 1];
          const bc = boltCap(B, Math.min(tpl, sh.tf), FuP); let nf = Math.ceil(Ff / bc.cap); nf = Math.max(4, nf + (nf % 2)); const r2 = Math.max(Ff / (0.9 * FyP * sh.b * tpl), Ff / (nf * bc.cap)); ratio = Math.max(ratio, r2);
          rows.push(['플랜지 연결판', `상·하 PL-${tpl}×${sh.b} · ${Object.keys(BOLT).find(k => BOLT[k] === B)} ${nf}개 (2열) · Ff ${kN(Ff)}`, r2]); items.push(`플랜지판 PL-${tpl}`);
        } else {
          type = '강접 — RC 매입 철판 (인장·전단 스터드)'; const studT = 0.75 * 283 * 400, studV = 0.65 * 283 * 400; const nt = Math.ceil(Ff / studT), nv = Math.ceil(V / studV); ratio = Math.max(ratio, 1e-3);
          rows.push(['매입 철판', `인장측 스터드 ${nt}개 · 전단 스터드 ${nv}개 (φ19, 강재 강도 기준)`]); notes.push('콘크리트 파괴(KDS 14 20 54) 별도 검토 — 핀 접합 전환 권장'); items.push(`스터드 ${nt + nv}`);
        }
      } else if (sp.kind === 'RC 벽' || sp.kind === 'RC 기둥' || sp.kind === 'RC 보') { const nv = Math.ceil(V / (0.65 * 283 * 400)); rows.push(['매입 철판', `전단 스터드 φ19 ${Math.max(4, nv)}개 · 철판 PL-16×${Math.round(tab.hp + 80)}`]); notes.push('콘크리트 파괴(KDS 14 20 54) 별도 검토'); items.push(`매입판+스터드 ${Math.max(4, nv)}`); }
      if (sp.rel && Mu > 1e6) notes.push('모델은 핀 — 해석 단부 모멘트 무시');
      if (notes.length) rows.push(['비고', notes.join(' · ')]);
      out.push({ mi, end, n: sp.n, kind: sp.kind, type, V, Mu: rigid ? Mu : 0, N, ratio, rows, items, tag: m.el.tag || '', level: m.r.level.name });
    }
  }
  // 패널존 (강축 강접 보가 모이는 철골·SRC 기둥 절점)
  for (const [, z] of pz) { const c = z.c; const phiRv = 0.9 * 0.6 * z.Fyc * c.h * c.tw; const r = z.F / phiRv; let txt = `ΣFf ${kN(z.F)} / φRv ${kN(phiRv)}`; if (r > 1) { const td = PL.find(t => 0.9 * 0.6 * z.Fyc * c.h * (c.tw + t) >= z.F) || PL[PL.length - 1]; txt += ` → 웨브 보강판 PL-${td} (패널존)`; } else txt += ' → 보강 불요';
    for (const i of z.list) { out[i].rows.splice(out[i].rows.length - (out[i].rows[out[i].rows.length - 1][0] === '비고' ? 1 : 0), 0, ['패널존 전단', txt, Math.min(r, 1)]); if (r > 1) out[i].items.push('패널존 보강판'); } }
  return out;
}
