// 빌더 구조 — 빌더 모델 → 해석 모델 (절점·요소·강막·하중), KDS 41 하중 (고정·활·풍·지진 등가정적), 하중조합, 해석 실행
import { allElements, levelOf, isRefElement, SECTIONS } from './model.js';
import { pointInPoly, polyArea } from './util.js';
import { analyze, stationForces } from './fem.js';

export const USES = { '사무실': 2.5, '주거': 2.0, '근린생활(판매)': 5.0, '학교 교실': 3.0, '집회(고정석 외)': 5.0, '병원 병실': 2.0, '경량 창고': 6.0, '주차장(승용)': 3.0 };
export const SYSTEMS = {
  rc_omf: ['RC 보통모멘트골조', 3, 2.5, 0.0466, 0.9], rc_imf: ['RC 중간모멘트골조', 5, 4.5, 0.0466, 0.9], rc_smf: ['RC 특수모멘트골조', 8, 5.5, 0.0466, 0.9],
  bw_rc: ['내력벽방식 — RC 보통전단벽', 4, 4, 0.0488, 0.75], bf_wall: ['건물골조 — RC 보통전단벽', 5, 4.5, 0.0488, 0.75], bf_swall: ['건물골조 — RC 특수전단벽', 6, 5, 0.0488, 0.75],
  dual: ['이중골조 — 특수모멘트골조 + RC 특수전단벽', 7, 5.5, 0.0488, 0.75], dual_i: ['이중골조 — 중간모멘트골조 + RC 보통전단벽', 5.5, 4.5, 0.0488, 0.75], s_smf: ['철골 특수모멘트골조', 8, 5.5, 0.0724, 0.8], s_imf: ['철골 중간모멘트골조', 4.5, 4, 0.0724, 0.8],
};
export const GRADES = { '특': [1.5, 0.010], 'I': [1.2, 0.015], 'II': [1.0, 0.020] };
const FA = { S1: [1.12, 1.12, 1.12], S2: [1.4, 1.4, 1.3], S3: [1.7, 1.5, 1.3], S4: [1.6, 1.4, 1.2], S5: [1.8, 1.3, 1.3] };
const FV = { S1: [0.84, 0.84, 0.84], S2: [1.5, 1.4, 1.3], S3: [1.7, 1.6, 1.5], S4: [2.2, 2.0, 1.8], S5: [3.0, 2.7, 2.4] };
const EXPO = { A: [0.58, 20, 0.33, 550], B: [0.81, 15, 0.22, 450], C: [1.0, 10, 0.15, 350], D: [1.13, 5, 0.10, 250] };
export const DEFAULTS = {
  fck: 30, fckV: null, fy: 400, fyt: 400, Fy: 355, SDL: 1.5, use: '사무실', LLroof: 1.0, crack: { beam: 0.35, col: 0.70, wall: 0.70 }, rhoCol: 0.015, rhoWall: 0.0025,
  seis: { on: true, Z: 0.11, I: 2.0, site: 'S4', sys: 'bf_wall', R: null, Cd: null, grade: 'I', method: 'static' }, pdelta: false, qa: 300, Df: 1500,
  wind: { on: true, V0: 26, exp: 'B', Gf: 2.0, Cf: 1.3 },
};
export function settingsOf(P) { const s = P.struct?.set || {}; return { ...DEFAULTS, ...s, crack: { ...DEFAULTS.crack, ...s.crack }, seis: { ...DEFAULTS.seis, ...s.seis }, wind: { ...DEFAULTS.wind, ...s.wind } }; }
export const Ec = (fck) => 8500 * Math.cbrt(fck + (fck <= 40 ? 4 : fck >= 60 ? 6 : 4 + (fck - 40) / 10));
export function hShape(sec) { const m = /H-(\d+)x(\d+)x([\d.]+)x([\d.]+)/.exec(sec || ''); if (!m) return null; const [h, b, tw, tf] = m.slice(1).map(Number); const hw = h - 2 * tf; return { h, b, tw, tf, A: 2 * b * tf + hw * tw, Ix: (b * h ** 3 - (b - tw) * hw ** 3) / 12, Iy: (2 * tf * b ** 3 + hw * tw ** 3) / 12, J: (2 * b * tf ** 3 + (h - tf) * tw ** 3) / 3, Zx: b * tf * (h - tf) + tw * hw * hw / 4, Zy: tf * b * b / 2 + hw * tw * tw / 4, kgm: SECTIONS[sec]?.kgm }; }
const torsJ = (a, b) => { if (a < b) [a, b] = [b, a]; return a * b ** 3 * (1 / 3 - 0.21 * b / a * (1 - b ** 4 / (12 * a ** 4))); };
const interp = (arr, S) => S <= 0.1 ? arr[0] : S >= 0.3 ? arr[2] : S <= 0.2 ? arr[0] + (arr[1] - arr[0]) * (S - 0.1) / 0.1 : arr[1] + (arr[2] - arr[1]) * (S - 0.2) / 0.1;

export function seismicParams(S0) {
  const s = S0.seis; const S = s.Z * s.I; const Fa = interp(FA[s.site] || FA.S4, S), Fv = interp(FV[s.site] || FV.S4, S);
  const SDS = S * 2.5 * Fa * 2 / 3, SD1 = S * Fv * 2 / 3; const sys = SYSTEMS[s.sys] || SYSTEMS.bf_wall; const R = s.R || sys[1], Cd = s.Cd || sys[2]; const [Ie, driftLim] = GRADES[s.grade] || GRADES.I;
  const Cu = SD1 >= 0.4 ? 1.4 : SD1 >= 0.3 ? 1.4 : SD1 >= 0.2 ? 1.5 : SD1 >= 0.15 ? 1.6 : 1.7;
  return { S, Fa, Fv, SDS, SD1, R, Cd, Ie, driftLim, Ct: sys[3], x: sys[4], Cu, sysName: sys[0] };
}

// ---------- 모델 변환 ----------
export function buildModel(P, S0 = settingsOf(P)) {
  const lv = [...P.levels].sort((a, b) => a.elev - b.elev); const zs = lv.map(l => l.elev);
  const snapZ = (z) => { let best = null, bd = 401; for (const e of zs) { const d = Math.abs(e - z); if (d < bd) { bd = d; best = e; } } return best != null ? best : Math.round(z); };
  const fckH = S0.fck, fckV = S0.fckV || S0.fck; const EcH = Ec(fckH), EcV = Ec(fckV), Gc = (e) => e / 2.334, Es = 205000, Gs = 79000;
  const gc = 24e-6, gs = 77e-6;
  const nodes = [], bucket = new Map(), byZ = new Map();
  const key = (x, y, z) => `${Math.floor(x / 500)},${Math.floor(y / 500)},${z}`;
  const findNode = (x, y, z, tol) => { const bx = Math.floor(x / 500), by = Math.floor(y / 500); let best = -1, bd = tol; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const n of bucket.get(`${bx + i},${by + j},${z}`) || []) { const d = Math.hypot(nodes[n].x - x, nodes[n].y - y); if (d <= bd) { bd = d; best = n; } } return best; };
  const node = (x, y, z, tol = 30, rad = 0) => { let n = findNode(x, y, z, tol); if (n >= 0) { if (rad > nodes[n].rad) nodes[n].rad = rad; return n; } n = nodes.length; nodes.push({ x, y, z, rad, vert: false }); const k = key(x, y, z); (bucket.get(k) || bucket.set(k, []).get(k)).push(n); (byZ.get(z) || byZ.set(z, []).get(z)).push(n); return n; };
  const elems = [], protos = [], members = [], warn = [];
  const host = {}; const all = allElements(P); for (const r of all) host[r.el.id] = r.el;
  const isStructWall = (r) => r.el.k === 'wall' && (r.el.mat === 'RC' || r.el.mat === 'SRC') && (r.el.h == null || r.el.h >= 0.6 * (r.level?.height || 3000));
  const seenWall = new Set();
  const nonStruct = []; // 비구조 벽 (하중)
  // 1) 수직 부재
  for (const r of all) {
    const el = r.el, L = r.level; if (!L) continue;
    if (isRefElement(el, r.sheet, P)) continue;
    const fz = (el.k === 'column' || el.k === 'wall') && S0.fckZone ? S0.fckZone(L) : fckV; const EcL = Ec(fz);
    if (el.k === 'column') {
      const z0 = snapZ(L.elev), z1 = snapZ(L.elev + (el.h ?? L.height)); if (z1 - z0 < 300) continue;
      const ang = (el.rot || 0) * Math.PI / 180; const sh = el.mat === 'STEEL' || el.mat === 'SRC' ? hShape(el.sec) : null;
      let by, hz, EA, EIy, EIz, GJ, w; const cr = S0.crack.col;
      let GAy, GAz;
      if (el.mat === 'STEEL' && sh) { by = sh.b; hz = sh.h; EA = Es * sh.A; EIy = Es * sh.Ix; EIz = Es * sh.Iy; GJ = Gs * sh.J; w = gs * sh.A; GAz = Gs * sh.h * sh.tw; GAy = Gs * 5 / 3 * sh.b * sh.tf; }
      else { by = el.w; hz = el.d; const Ag = by * hz, As = sh ? sh.A : 0; EA = EcL * (Ag - As) + Es * As; EIy = cr * EcL * by * hz ** 3 / 12 + (sh ? Es * sh.Ix : 0); EIz = cr * EcL * hz * by ** 3 / 12 + (sh ? Es * sh.Iy : 0); GJ = cr * Gc(EcL) * torsJ(by, hz); w = gc * (Ag - As) + gs * As; GAy = GAz = Gc(EcL) * 5 / 6 * Ag; }
      const rad = Math.max(by, hz) / 2 + 50; const n1 = node(el.p[0], el.p[1], z0, 30, rad), n2 = node(el.p[0], el.p[1], z1, 30, rad); nodes[n1].vert = nodes[n2].vert = true;
      const mi = members.push({ id: el.id, el, r, kind: 'column', mat: el.mat, by, hz, sh, L: z1 - z0, segs: [], fck: el.mat === 'STEEL' ? null : fz }) - 1;
      members[mi].segs.push(elems.push({ n1, n2, EA, EIy, EIz, GJ, GAy, GAz, ang, mem: mi, w, vert: true }) - 1);
    } else if (el.k === 'wall') {
      if (!isStructWall(r)) { nonStruct.push(r); continue; }
      const kk = `${Math.round(el.a[0])},${Math.round(el.a[1])},${Math.round(el.b[0])},${Math.round(el.b[1])},${L.id}`; const kk2 = `${Math.round(el.b[0])},${Math.round(el.b[1])},${Math.round(el.a[0])},${Math.round(el.a[1])},${L.id}`;
      if (seenWall.has(kk) || seenWall.has(kk2)) continue; seenWall.add(kk);
      const z0 = snapZ(L.elev + (el.z0 || 0)), z1 = snapZ(L.elev + (el.z0 || 0) + (el.h ?? L.height)); if (z1 - z0 < 300) continue;
      const len = Math.hypot(el.b[0] - el.a[0], el.b[1] - el.a[1]); if (len < 200) continue; const ang = Math.atan2(el.b[1] - el.a[1], el.b[0] - el.a[0]); const t = el.t; const cr = S0.crack.wall;
      const c = [(el.a[0] + el.b[0]) / 2, (el.a[1] + el.b[1]) / 2];
      const cb = node(c[0], c[1], z0), ct = node(c[0], c[1], z1), ab = node(el.a[0], el.a[1], z0, 60), bb = node(el.b[0], el.b[1], z0, 60), at = node(el.a[0], el.a[1], z1, 60), bt = node(el.b[0], el.b[1], z1, 60);
      for (const n of [cb, ct, ab, bb, at, bt]) nodes[n].vert = true;
      const mi = members.push({ id: el.id, el, r, kind: 'wall', mat: 'RC', by: len, hz: t, L: z1 - z0, segs: [], wn: [ab, bb, bt, at], fck: fz }) - 1;
      members[mi].segs.push(elems.push({ n1: cb, n2: ct, EA: EcL * len * t, EIy: cr * EcL * len * t ** 3 / 12, EIz: cr * EcL * t * len ** 3 / 12, GJ: cr * Gc(EcL) * len * t ** 3 / 3, GAy: Gc(EcL) * 5 / 6 * len * t, GAz: Gc(EcL) * 5 / 6 * len * t, ang, mem: mi, w: gc * len * t, vert: true }) - 1);
      for (const [p, q] of [[ct, at], [ct, bt], [cb, ab], [cb, bb]]) protos.push({ n1: p, n2: q, rigid: true, hw: t / 2 + 50, mem: -1 });
    }
  }
  const RIG = { EA: EcV * 1e8, EIy: EcV * 1e14, EIz: EcV * 1e14, GJ: Gc(EcV) * 1e14, w: 0 };
  // 2) 보 (끝점을 기존 절점에 붙이거나 선 위에 투영)
  const projOnProto = (x, y, z) => { let best = null, bd = Infinity; for (const p of protos) { const A = nodes[p.n1], B = nodes[p.n2]; if (A.z !== z || B.z !== z) continue; const dx = B.x - A.x, dy = B.y - A.y, l2 = dx * dx + dy * dy; if (!l2) continue; const t = ((x - A.x) * dx + (y - A.y) * dy) / l2; if (t <= 0.001 || t >= 0.999) continue; const qx = A.x + dx * t, qy = A.y + dy * t, d = Math.hypot(qx - x, qy - y); if (d <= p.hw && d < bd) { bd = d; best = [qx, qy]; } } return best; };
  for (const r of all) {
    const el = r.el, L = r.level; if (!L || el.k !== 'beam' || isRefElement(el, r.sheet, P)) continue;
    const z = snapZ(L.elev + L.height + (el.dz || 0)); const sh = el.mat === 'STEEL' ? hShape(el.sec) : null; const cr = S0.crack.beam;
    let by, hz, EA, EIy, EIz, GJ, w, GAy, GAz;
    if (sh) { by = sh.b; hz = sh.h; EA = Es * sh.A; EIy = Es * sh.Ix; EIz = Es * sh.Iy; GJ = Gs * sh.J; w = gs * sh.A; GAz = Gs * sh.h * sh.tw; GAy = Gs * 5 / 3 * sh.b * sh.tf; }
    else { by = el.w; hz = el.d; EA = EcH * by * hz; EIy = cr * EcH * by * hz ** 3 / 12; EIz = cr * EcH * hz * by ** 3 / 12; GJ = cr * Gc(EcH) * torsJ(by, hz); w = gc * by * hz; GAy = GAz = Gc(EcH) * 5 / 6 * by * hz; }
    const end = (p) => { let n = findNode(p[0], p[1], z, 160); if (n >= 0) return n; for (const id of byZ.get(z) || []) { const N = nodes[id]; if (N.rad && Math.hypot(N.x - p[0], N.y - p[1]) <= N.rad) return id; } const q = projOnProto(p[0], p[1], z); return q ? node(q[0], q[1], z, 30) : node(p[0], p[1], z, 30); };
    const n1 = end(el.a), n2 = end(el.b); if (n1 === n2) continue;
    const mi = members.push({ id: el.id, el, r, kind: 'beam', mat: el.mat, by, hz, sh, L: Math.hypot(el.b[0] - el.a[0], el.b[1] - el.a[1]), segs: [] }) - 1;
    const rel = el.rel === 'both' ? [1, 1] : el.rel === 'i' ? [1, 0] : el.rel === 'j' ? [0, 1] : null;
    protos.push({ n1, n2, EA, EIy, EIz, GJ, GAy, GAz, w, mem: mi, hw: by / 2 + 60, rel });
  }
  // 3) 선 부재를 그 위 절점에서 분할
  for (const p of protos) {
    const A = nodes[p.n1], B = nodes[p.n2]; const z = A.z; const dx = B.x - A.x, dy = B.y - A.y, l2 = dx * dx + dy * dy; const on = [];
    if (A.z === B.z) for (const id of byZ.get(z) || []) { if (id === p.n1 || id === p.n2) continue; const N = nodes[id]; const t = ((N.x - A.x) * dx + (N.y - A.y) * dy) / l2; if (t <= 0.002 || t >= 0.998) continue; const d = Math.hypot(A.x + dx * t - N.x, A.y + dy * t - N.y); if (d <= Math.max(40, Math.min(N.rad || 0, p.hw + 40))) on.push([t, id]); }
    on.sort((a, b) => a[0] - b[0]); const chain = [p.n1, ...on.map(o => o[1]), p.n2];
    for (let i = 0; i < chain.length - 1; i++) { const e = p.rigid ? { n1: chain[i], n2: chain[i + 1], ...RIG, mem: -1, rigid: true } : { n1: chain[i], n2: chain[i + 1], EA: p.EA, EIy: p.EIy, EIz: p.EIz, GJ: p.GJ, GAy: p.GAy, GAz: p.GAz, w: p.w, mem: p.mem }; if (p.rel && (p.rel[0] && i === 0 || p.rel[1] && i === chain.length - 2)) e.rel = [p.rel[0] && i === 0 ? 1 : 0, p.rel[1] && i === chain.length - 2 ? 1 : 0]; const ei = elems.push(e) - 1; if (p.mem >= 0) members[p.mem].segs.push(ei); }
  }
  // 사용된 절점·지점
  const deg = new Int32Array(nodes.length); for (const e of elems) { deg[e.n1]++; deg[e.n2]++; }
  let zmin = Infinity; for (const e of elems) if (e.vert) zmin = Math.min(zmin, nodes[e.n1].z, nodes[e.n2].z);
  if (!isFinite(zmin)) zmin = lv[0]?.elev ?? 0;
  nodes.forEach((n, i) => { n.used = deg[i] > 0; if (n.used && n.z <= zmin + 1) n.fix = [1, 1, 1, 1, 1, 1]; });
  // 슬래브
  const slabs = [], mats = [], foots = []; for (const r of all) { const el = r.el, L = r.level; if (!L || isRefElement(el, r.sheet, P)) continue; if (el.k === 'footing') { foots.push(r); continue; } if (el.k !== 'slab') continue; const z = snapZ(L.elev + (el.dz || 0)); if (z <= zmin + 1) { mats.push(r); continue; } slabs.push({ r, z, pts: el.pts, t: el.t, L }); }
  return { nodes, elems, members, slabs, mats, foots, nonStruct, zmin, lv, snapZ, warn, S0, EcH, EcV, P };
}

// ---------- 하중 ----------
function nearestSupport(lines, pts, x, y) {
  let best = null, bd = Infinity;
  for (const l of lines) { const dx = l.bx - l.ax, dy = l.by - l.ay; let t = ((x - l.ax) * dx + (y - l.ay) * dy) / l.l2; t = t < 0 ? 0 : t > 1 ? 1 : t; const d = (l.ax + dx * t - x) ** 2 + (l.ay + dy * t - y) ** 2; if (d < bd) { bd = d; best = [l.ei, t]; } }
  for (const p of pts) { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd - 1) { bd = d; best = [-1, p.id]; } }
  return best;
}
export function buildLoads(M) {
  const { nodes, elems, slabs, nonStruct, lv, snapZ, zmin, S0 } = M; const gc = 24e-6;
  const L = { D: { node: [], dia: [], elem: [] }, L: { node: [], dia: [], elem: [] } };
  const mass = new Map(); const addMass = (z, F, x, y) => { if (z <= zmin + 1) return; const m = mass.get(z) || mass.set(z, { W: 0, Wx: 0, Wy: 0, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }).get(z); m.W += F; m.Wx += F * x; m.Wy += F * y; m.Wr = (m.Wr || 0) + F * (x * x + y * y); };
  const tot = { D: 0, L: 0 };
  // 자중
  elems.forEach((e, ei) => {
    if (!e.w) return; const A = nodes[e.n1], B = nodes[e.n2]; const len = Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z); const W = e.w * len; tot.D += W;
    if (e.vert) { L.D.node.push([e.n1, 0, 0, -W / 2, 0, 0, 0], [e.n2, 0, 0, -W / 2, 0, 0, 0]); addMass(A.z, W / 2, A.x, A.y); addMass(B.z, W / 2, B.x, B.y); }
    else { for (let i = 0; i < 4; i++) L.D.elem.push([ei, (i + 0.5) / 4, 0, 0, -W / 4]); addMass(A.z, W, (A.x + B.x) / 2, (A.y + B.y) / 2); }
  });
  // 층별 지지선·점
  const floors = new Map(); const floorOf = (z) => { let f = floors.get(z); if (f) return f; f = { lines: [], pts: [] }; floors.set(z, f);
    elems.forEach((e, ei) => { const A = nodes[e.n1], B = nodes[e.n2]; if (e.vert || A.z !== z || B.z !== z) return; const l2 = (B.x - A.x) ** 2 + (B.y - A.y) ** 2; if (l2 > 1) f.lines.push({ ei, ax: A.x, ay: A.y, bx: B.x, by: B.y, l2 }); });
    nodes.forEach((n, id) => { if (n.used && n.vert && n.z === z) f.pts.push({ id, x: n.x, y: n.y }); }); return f; };
  const bins = { D: new Map(), L: new Map() }; const nodeAcc = { D: new Map(), L: new Map() };
  const put = (c, z, x, y, F) => { const f = floorOf(z); const s = nearestSupport(f.lines, f.pts, x, y); if (!s) return false; tot[c] -= F; if (c === 'D') addMass(z, -F, x, y);
    if (s[0] < 0) nodeAcc[c].set(s[1], (nodeAcc[c].get(s[1]) || 0) + F); else { const k = s[0] * 8 + Math.min(7, Math.floor(s[1] * 8)); const b = bins[c].get(k) || bins[c].set(k, [0, 0]).get(k); b[0] += F; b[1] += F * s[1]; } return true; };
  const isRoof = (Lv) => Lv === lv[lv.length - 1] || /RF|지붕|옥상|ROOF/i.test(Lv.name);
  const LLof = (Lv) => (isRoof(Lv) ? S0.LLroof : (USES[S0.use] ?? 2.5)) * 1e-3;
  for (const s of slabs) {
    const area = Math.abs(polyArea(s.pts)); if (area < 1e5) continue; const sdl = (isRoof(s.L) ? (S0.SDLroof ?? S0.SDL) : S0.SDL); const step = Math.min(1000, Math.max(250, Math.sqrt(area / 3000)));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const p of s.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const m = mass.get(s.z) || (addMass(s.z, 0, 0, 0), mass.get(s.z)); if (m) { m.x0 = Math.min(m.x0, x0); m.x1 = Math.max(m.x1, x1); m.y0 = Math.min(m.y0, y0); m.y1 = Math.max(m.y1, y1); }
    const samp = []; for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) if (pointInPoly([x, y], s.pts)) samp.push([x, y]); if (!samp.length) continue;
    const da = area / samp.length; const qD = s.t * gc + sdl * 1e-3, qL = LLof(s.L);
    for (const [x, y] of samp) { put('D', s.z, x, y, -qD * da); put('L', s.z, x, y, -qL * da); }
  }
  // 비구조 벽 (선하중)
  const wNS = (el) => el.mat === 'CMU' ? 19e-6 * el.t : el.mat === 'GLASS' ? 0.8e-3 : el.mat === 'DRY' ? 0.6e-3 : 24e-6 * el.t;
  for (const r of nonStruct) {
    const el = r.el, Lv = r.level; const z = snapZ(Lv.elev + (el.z0 || 0)); if (z <= zmin + 1) continue; const h = el.h ?? Lv.height; const len = Math.hypot(el.b[0] - el.a[0], el.b[1] - el.a[1]); if (len < 10) continue;
    const n = Math.max(1, Math.round(len / 500)); const F = -wNS(el) * h * len / n; for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; put('D', z, el.a[0] + (el.b[0] - el.a[0]) * t, el.a[1] + (el.b[1] - el.a[1]) * t, F); }
  }
  for (const c of ['D', 'L']) { for (const [k, [F, Ft]] of bins[c]) L[c].elem.push([Math.floor(k / 8), Ft / F, 0, 0, F]); for (const [n, F] of nodeAcc[c]) L[c].node.push([n, 0, 0, F, 0, 0, 0]); }
  return { loads: L, mass, tot };
}

// ---------- 시공단계 해석 (고정하중 순차 재하) ----------
// 층을 최대 groups개 단계로 묶어, 단계마다 그때까지 시공된 부분 구조에 해당 층 고정하중만 재하하고 결과를 누적한다.
// 새로 설치되는 절점은 처진 하부 위에 설계 레벨로 놓인다고 보아(레벨 보정) 이전 단계 변위를 받지 않는다.
export function constructionStages(M, model, { groups = 15, onProgress } = {}) {
  const { nodes, elems } = model; const zmin = M.zmin; const nN = nodes.length;
  const zs = [...new Set(nodes.filter(n => n.used).map(n => n.z))].filter(z => z > zmin + 1).sort((a, b) => a - b); if (zs.length < 2) return null;
  const G = Math.min(groups, zs.length); const per = zs.length / G; const stZ = new Map(zs.map((z, i) => [z, Math.min(G - 1, Math.floor(i / per))]));
  const sz = (z) => z <= zmin + 1 ? 0 : (stZ.get(z) ?? G - 1); const eSt = elems.map(e => Math.max(sz(nodes[e.n1].z), sz(nodes[e.n2].z)));
  const first = new Int32Array(nN).fill(G); elems.forEach((e, i) => { first[e.n1] = Math.min(first[e.n1], eSt[i]); first[e.n2] = Math.min(first[e.n2], eSt[i]); });
  const LD = model.loads.D; const nSt = (n) => Math.max(sz(nodes[n].z), first[n]);
  const acc = { disp: new Float64Array(nN * 6), ef: new Float64Array(elems.length * 12), reac: new Map(), dia: (model.dias || []).map(() => [0, 0, 0]) }; const stages = [];
  for (let s = 0; s < G; s++) {
    const t0 = performance.now(); const keep = []; for (let i = 0; i < elems.length; i++) if (eSt[i] <= s) keep.push(i); const loc = new Int32Array(elems.length).fill(-1); keep.forEach((g, i) => { loc[g] = i; });
    const used = new Uint8Array(nN); for (const g of keep) { used[elems[g].n1] = 1; used[elems[g].n2] = 1; }
    const dm = new Map(), dias = []; const sn = nodes.map((n, i) => { let dia = null; if (used[i] && n.dia != null) { if (!dm.has(n.dia)) { dm.set(n.dia, dias.length); dias.push(model.dias[n.dia]); } dia = dm.get(n.dia); } return { x: n.x, y: n.y, z: n.z, fix: n.fix, used: !!used[i], dia }; });
    // 단계 안에서도 층별 하중을 따로 풀어(같은 분해 재사용) 절점은 자기 층 설치 이후 하중의 변위만 받게 한다
    const zt = zs.filter(z => sz(z) === s); const flo = (z) => { for (const t of zt) if (z <= t + 1) return t; return zt[zt.length - 1]; };
    const cases = zt.map((_, i) => 'F' + i); const loads = Object.fromEntries(cases.map(c => [c, { node: [], elem: [] }])); const ci = new Map(zt.map((z, i) => [z, cases[i]]));
    for (const L of LD.node) { const n = L[0]; if (used[n] && nSt(n) === s) loads[ci.get(flo(nodes[n].z))].node.push(L); }
    for (const L of LD.elem) { const ei = L[0]; if (eSt[ei] !== s) continue; const e = elems[ei]; loads[ci.get(flo(Math.max(nodes[e.n1].z, nodes[e.n2].z)))].elem.push([loc[ei], ...L.slice(1)]); }
    const R = analyze({ nodes: sn, elems: keep.map(g => elems[g]), dias, cases, loads });
    zt.forEach((zf, fi) => { const c = R.cases[cases[fi]];
      for (let n = 0; n < nN; n++) if (used[n] && nodes[n].z <= zf + 1) for (let k = 0; k < 6; k++) acc.disp[n * 6 + k] += c.disp[n * 6 + k];
      keep.forEach((g, i) => { for (let k = 0; k < 12; k++) acc.ef[g * 12 + k] += c.ef[i * 12 + k]; });
      for (const [n, r] of c.reac) { let a = acc.reac.get(n); if (!a) acc.reac.set(n, a = new Float64Array(6)); for (let k = 0; k < 6; k++) a[k] += r[k]; }
      for (const [d, i] of dm) for (let k = 0; k < 3; k++) acc.dia[d][k] += c.dia[i][k]; }); stages.push({ s, z0: zt[0], z1: zt[zt.length - 1], nEl: keep.length, dof: R.N, weak: R.weak.length, ms: performance.now() - t0 });
    onProgress?.(`시공단계 해석 ${s + 1}/${G}`);
  }
  return { case: { disp: acc.disp, ef: acc.ef, reac: acc.reac, dia: acc.dia, eloads: LD.elem }, stages, G };
}

// ---------- 해석 전체 ----------
export const COMBOS = (has) => {
  const C = [{ id: 'LC1', name: '1.4D', f: { D: 1.4 } }, { id: 'LC2', name: '1.2D+1.6L', f: { D: 1.2, L: 1.6 } }]; let k = 3;
  if (has.W) for (const [d, nm] of [['WX', 'Wx'], ['WY', 'Wy']]) for (const s of [1, -1]) { C.push({ id: 'LC' + k++, name: `1.2D+1.0L${s > 0 ? '+' : '−'}1.3${nm}`, f: { D: 1.2, L: 1.0, [d]: 1.3 * s } }); C.push({ id: 'LC' + k++, name: `0.9D${s > 0 ? '+' : '−'}1.3${nm}`, f: { D: 0.9, [d]: 1.3 * s } }); }
  if (has.E) for (const [d, nm] of has.R ? [['RX', 'Rx'], ['RY', 'Ry']] : [['EX', 'Ex'], ['EY', 'Ey']]) for (const s of [1, -1]) { C.push({ id: 'LC' + k++, name: `1.2D+1.0L${s > 0 ? '+' : '−'}1.0${nm}`, f: { D: 1.2, L: 1.0, [d]: s } }); C.push({ id: 'LC' + k++, name: `0.9D${s > 0 ? '+' : '−'}1.0${nm}`, f: { D: 0.9, [d]: s } }); }
  return C;
};
export function parseCombos(lines, cases) {
  const out = []; let k = 1; for (const ln of lines) { const t = String(ln).replace(/\s/g, '').toUpperCase(); if (!t) continue; const f = {}; let ok = true; t.replace(/([+\-−]?)([\d.]*)([A-Z]+)/g, (_, sg, num, c) => { if (!cases.includes(c)) ok = false; f[c] = (f[c] || 0) + (sg === '-' || sg === '−' ? -1 : 1) * (num === '' ? 1 : +num); return ''; }); if (ok && Object.keys(f).length) out.push({ id: 'U' + k++, name: ln.trim(), f }); }
  return out;
}
const G_ACC = 9806.65;
export function spectrum(T, sp) { const T0 = 0.2 * sp.SD1 / sp.SDS, Ts = sp.SD1 / sp.SDS, TL = 5; return T < T0 ? sp.SDS * (0.4 + 0.6 * T / T0) : T <= Ts ? sp.SDS : T <= TL ? sp.SD1 / T : sp.SD1 * TL / (T * T); }
function jacobi(A) { // 대칭 고유치 (순환 야코비)
  const n = A.length; const a = A.map(r => Float64Array.from(r)); const V = Array.from({ length: n }, (_, i) => { const r = new Float64Array(n); r[i] = 1; return r; });
  for (let sw = 0; sw < 60; sw++) { let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j]; if (off < 1e-22 * n) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) { const apq = a[p][q]; if (Math.abs(apq) < 1e-300) continue; const th = (a[q][q] - a[p][p]) / (2 * apq); const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)); const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; } for (let k = 0; k < n; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; } for (let k = 0; k < n; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; } } }
  return { val: a.map((r, i) => r[i]), vec: V };
}
export function modal(R, story, onProgress) {
  const dof = []; const m = []; for (const f of story) { const D = R.diaDof[f.dia]; dof.push(D[0], D[1], D[2]); m.push(f.W / G_ACC, f.W / G_ACC, f.Jw / G_ACC); }
  const n = dof.length; const Fx = Array.from({ length: n }, () => new Float64Array(n)); const b = new Float64Array(R.N);
  for (let j = 0; j < n; j++) { b.fill(0); b[dof[j]] = 1; const q = R.solveRaw(b); for (let i = 0; i < n; i++) Fx[i][j] = q[dof[i]]; if (j % 30 === 29) onProgress?.(`고유치 해석 — 유연도 ${j + 1}/${n}`); }
  const sm = m.map(Math.sqrt); const B = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (Fx[i][j] + Fx[j][i]) / 2 * sm[i] * sm[j]));
  const { val, vec } = jacobi(B); const idx = [...val.keys()].filter(i => val[i] > 0).sort((a, b) => val[b] - val[a]);
  const Mt = { X: story.reduce((s, f) => s + f.W / G_ACC, 0) }; Mt.Y = Mt.X; Mt.RZ = story.reduce((s, f) => s + f.Jw / G_ACC, 0);
  const modes = []; const cum = { X: 0, Y: 0, RZ: 0 };
  for (const i of idx) { const phi = Array.from({ length: n }, (_, k) => vec[k][i] / sm[k]); const w = Math.sqrt(1 / val[i]); const G = { X: 0, Y: 0, RZ: 0 }; for (let k = 0; k < n; k++) G[['X', 'Y', 'RZ'][k % 3]] += m[k] * phi[k];
    const ratio = { X: G.X * G.X / Mt.X, Y: G.Y * G.Y / Mt.Y, RZ: G.RZ * G.RZ / Mt.RZ }; cum.X += ratio.X; cum.Y += ratio.Y; cum.RZ += ratio.RZ;
    modes.push({ T: 2 * Math.PI / w, w, phi, G, ratio, cum: { ...cum } }); if (modes.length >= 3 && cum.X >= 0.9 && cum.Y >= 0.9 && modes.length >= Math.min(12, idx.length) || modes.length >= 40) break; }
  return { modes, dof, m, Mt };
}
const cqcRho = (wi, wj, z = 0.05) => { const r = wj / wi; return 8 * z * z * (1 + r) * Math.pow(r, 1.5) / ((1 - r * r) ** 2 + 4 * z * z * r * (1 + r) ** 2); };
export function cqc(vals, rho) { let s = 0; const n = vals.length; for (let i = 0; i < n; i++) { if (!vals[i]) continue; for (let j = 0; j < n; j++) s += vals[i] * rho[i][j] * vals[j]; } return Math.sqrt(Math.max(0, s)); }
export function runStructure(P, { onProgress, settings } = {}) {
  const t0 = performance.now(); const S0 = settings || settingsOf(P);
  const M = buildModel(P, S0); if (!M.members.length) return { empty: true };
  onProgress?.('하중 산정…'); const LD = buildLoads(M); const { mass } = LD;
  // 층 (강막)
  const fl = [...mass.entries()].filter(([z, m]) => m.W > 1).sort((a, b) => a[0] - b[0]).map(([z, m]) => ({ z, W: m.W, x: m.Wx / m.W, y: m.Wy / m.W, Jw: Math.max(m.Wr - (m.Wx * m.Wx + m.Wy * m.Wy) / m.W, m.W * 1e6), Bx: isFinite(m.x1) ? m.x1 - m.x0 : 0, By: isFinite(m.y1) ? m.y1 - m.y0 : 0 }));
  const slabZ = new Set(M.slabs.map(s => s.z)); const dias = [];
  for (const f of fl) { if (!slabZ.has(f.z)) continue; f.dia = dias.push({ x: f.x, y: f.y, z: f.z }) - 1; }
  const inSlab = (n) => M.slabs.some(s => s.z === n.z && (pointInPoly([n.x, n.y], s.pts) || s.pts.some((p, i) => { const q = s.pts[(i + 1) % s.pts.length]; const dx = q[0] - p[0], dy = q[1] - p[1], l2 = dx * dx + dy * dy || 1; let t = ((n.x - p[0]) * dx + (n.y - p[1]) * dy) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] + dx * t - n.x, p[1] + dy * t - n.y) < 1500; })));
  const diaOfZ = new Map(fl.filter(f => f.dia != null).map(f => [f.z, f.dia]));
  for (const n of M.nodes) if (n.used && !n.fix && diaOfZ.has(n.z) && inSlab(n)) n.dia = diaOfZ.get(n.z);
  const story = fl.filter(f => f.dia != null); // 횡하중 받는 층
  // 층 질량을 가장 가까운 강막층에 모음
  for (const f of fl) if (f.dia == null && story.length) { let b = story[0]; for (const s of story) if (Math.abs(s.z - f.z) < Math.abs(b.z - f.z)) b = s; b.W += f.W; }
  story.forEach((f, i) => { f.h = f.z - (i ? story[i - 1].z : M.zmin); });
  const zmin = M.zmin, hn = story.length ? (story[story.length - 1].z - zmin) / 1000 : 0; const Wt = story.reduce((s, f) => s + f.W, 0);
  const cases = ['D', 'L']; const loads = { ...LD.loads }; const info = { S0, Wt, hn, story, tot: LD.tot };
  // 풍하중
  if (S0.wind.on && story.length) {
    const [K0, zb, al, zg] = EXPO[S0.wind.exp] || EXPO.B; const Kzr = (z) => K0 * Math.pow(Math.min(Math.max(z, zb), zg) / zb, al);
    for (const [c, B] of [['WX', 'By'], ['WY', 'Bx']]) {
      loads[c] = { dia: [] }; cases.push(c); story.forEach((f, i) => { const zm = (f.z - zmin) / 1000; const lo = i ? story[i - 1].z : zmin, hi = i < story.length - 1 ? story[i + 1].z : f.z; const trib = (hi - lo) / 2; const qz = 0.5 * 1.225 * (S0.wind.V0 * Kzr(zm)) ** 2 * 1e-6; const F = qz * S0.wind.Gf * S0.wind.Cf * f[B] * trib; f[c] = F; f['q' + c] = qz * 1e6; loads[c].dia.push(c === 'WX' ? [f.dia, F, 0, 0] : [f.dia, 0, F, 0]); });
    }
    info.wind = { Kzr: story.map(f => Kzr((f.z - zmin) / 1000)) };
  }
  // 지진하중 (등가정적)
  let sp = null; const eqLoads = (T) => { const k = T <= 0.5 ? 1 : T >= 2.5 ? 2 : 1 + (T - 0.5) / 2; const Cs = Math.max(Math.min(sp.SDS / (sp.R / sp.Ie), sp.SD1 / (T * sp.R / sp.Ie)), Math.max(0.044 * sp.SDS * sp.Ie, 0.01)); const V = Cs * Wt; const sw = story.reduce((s, f) => s + f.W * Math.pow((f.z - zmin) / 1000, k), 0);
    const out = { T, k, Cs, V, EX: { dia: [] }, EY: { dia: [] } }; for (const f of story) { const F = V * f.W * Math.pow((f.z - zmin) / 1000, k) / sw; f.Fe = F; out.EX.dia.push([f.dia, F, 0, F * 0.05 * f.By]); out.EY.dia.push([f.dia, 0, F, -F * 0.05 * f.Bx]); } return out; };
  if (S0.seis.on && story.length) { sp = seismicParams(S0); sp.Ta = sp.Ct * Math.pow(hn, sp.x); const e0 = eqLoads(sp.Ta); loads.EX = e0.EX; loads.EY = e0.EY; cases.push('EX', 'EY'); info.seis = sp; }
  onProgress?.(`해석 중… 절점 ${M.nodes.filter(n => n.used).length.toLocaleString()} · 요소 ${M.elems.length.toLocaleString()}`);
  const model = { nodes: M.nodes, elems: M.elems, dias, cases, loads };
  let R = analyze(model, { onProgress });
  if (S0.pdelta) { // P-Δ: 1.2D+1.0L 축력으로 기하강성
    onProgress?.('P-Δ 기하강성 반영 재해석…'); const d = R.cases.D.ef, l = R.cases.L.ef; M.elems.forEach((e, i) => { if (!e.rigid && e.vert) e.Ng = -(1.2 * d[i * 12] + 1.0 * l[i * 12]); });
    R = analyze(model, { onProgress }); info.pdelta = true; M.elems.forEach(e => { delete e.Ng; });
  }
  if (S0.cs) { onProgress?.('시공단계 해석…'); const cs = constructionStages(M, model, { onProgress }); if (cs) { R.cases.D0 = R.cases.D; R.cases.D = cs.case; info.cs = { G: cs.G, stages: cs.stages, ms: cs.stages.reduce((a, x) => a + x.ms, 0) }; } }
  if (sp) { // 레일리 주기 → 상한 CuTa → 재산정
    const ray = (c) => { let a = 0, b = 0; const lds = loads[c].dia; story.forEach((f, i) => { const d = R.cases[c].dia[f.dia][c === 'EX' ? 0 : 1]; a += f.W * d * d; b += lds[i][c === 'EX' ? 1 : 2] * d; }); return 2 * Math.PI * Math.sqrt(a / (9806.65 * b)); };
    sp.Tray = { X: ray('EX'), Y: ray('EY') }; sp.T = { X: Math.min(sp.Tray.X, sp.Cu * sp.Ta), Y: Math.min(sp.Tray.Y, sp.Cu * sp.Ta) };
    const ex = eqLoads(sp.T.X); loads.EX = ex.EX; const fx = story.map(f => f.Fe); const ey = eqLoads(sp.T.Y); loads.EY = ey.EY; story.forEach((f, i) => { f.EX = fx[i]; f.EY = f.Fe; });
    sp.X = { Cs: ex.Cs, V: ex.V, k: ex.k }; sp.Y = { Cs: ey.Cs, V: ey.V, k: ey.k };
    R.solve('EX', loads.EX); R.solve('EY', loads.EY);
    // 안정계수 θ = Px·Δ·Ie / (Vx·hsx·Cd)
    { let Pab = 0; const Pz = story.map(f => 0); for (let i = story.length - 1; i >= 0; i--) { Pab += story[i].W; Pz[i] = Pab; } info.Pabove = Pz; }
  }
  if (sp && S0.seis.method === 'rs' && story.length >= 1) {
    onProgress?.('고유치 해석…'); const MD = modal(R, story, onProgress); info.modal = MD; const md = MD.modes; const n = md.length;
    const rho = md.map(a => md.map(b => cqcRho(a.w, b.w)));
    for (const dir of ['X', 'Y']) {
      const k0 = dir === 'X' ? 0 : 1; const modeRes = []; const Vb = []; const b = new Float64Array(R.N);
      for (const mo of md) { const Sa = spectrum(mo.T, sp) * sp.Ie / sp.R; b.fill(0); let V = 0; for (let k = 0; k < MD.dof.length; k++) { const F = MD.m[k] * mo.phi[k] * mo.G[dir] * Sa * G_ACC; b[MD.dof[k]] = F; if (k % 3 === k0) V += F; } Vb.push(V); mo['Sa' + dir] = Sa; modeRes.push(R.post(R.solveRaw(b))); }
      const Vrs = cqc(Vb, rho); const Vst = sp[dir].V; const scale = Vrs > 0 ? Math.max(1, 0.85 * Vst / Vrs) : 1;
      // 우발비틀림 (정적, 층전단력 기준)
      const tc = 'T' + dir; loads[tc] = { dia: story.map(f => [f.dia, 0, 0, (dir === 'X' ? f.EX * f.By : -f.EY * f.Bx) * 0.05]) }; R.solve(tc, loads[tc]);
      // 표시용 변위 (CQC)
      const disp = new Float64Array(M.nodes.length * 6); for (let i = 0; i < disp.length; i++) { const v = modeRes.map(r => r.disp[i]); disp[i] = cqc(v, rho) * scale + Math.abs(R.cases[tc].disp[i]); }
      const dia = story.map(f => { const v = [0, 1, 2].map(k => cqc(modeRes.map(r => r.dia[f.dia][k]), rho) * scale + Math.abs(R.cases[tc].dia[f.dia][k])); return v; }); const diaArr = []; story.forEach((f, i) => { diaArr[f.dia] = dia[i]; });
      R.cases['R' + dir] = { rs: true, dir, modes: modeRes, rho, scale, tors: tc, disp, dia: diaArr, reac: new Map(), ef: null, eloads: [] };
      sp['RS' + dir] = { Vrs, Vst, scale, Vb };
      // 층 결과: 모드별 층간변위 → CQC
      story.forEach((f, i) => { const below = i ? story[i - 1] : null; const dr = modeRes.map(r => (r.dia[f.dia][k0] - (below ? r.dia[below.dia][k0] : 0)) / f.h); const tdr = (R.cases[tc].dia[f.dia][k0] - (below ? R.cases[tc].dia[below.dia][k0] : 0)) / f.h; f['drR' + dir] = cqc(dr, rho) * scale + Math.abs(tdr);
        let Vs = []; for (const mo of md) { let s = 0; for (let j = i; j < story.length; j++) s += MD.m[j * 3 + k0] * mo.phi[j * 3 + k0] * mo.G[dir] * mo['Sa' + dir] * G_ACC; Vs.push(s); } f['VR' + dir] = cqc(Vs, rho) * scale; });
      cases.push('R' + dir);
    }
  }
  const auto = COMBOS({ W: cases.includes('WX'), E: cases.includes('EX'), R: cases.includes('RX') }); const user = P.struct?.combos?.length ? parseCombos(P.struct.combos, cases) : null; const combos = user?.length ? user : auto; info.userCombos = !!user?.length;
  // 층 결과
  for (const [i, f] of story.entries()) {
    const below = i ? story[i - 1] : null; f.h = f.z - (below ? below.z : zmin);
    for (const c of ['WX', 'WY', 'EX', 'EY']) { if (!R.cases[c]) continue; const d = R.cases[c].dia[f.dia][c.endsWith('X') ? 0 : 1], d0 = below ? R.cases[c].dia[below.dia][c.endsWith('X') ? 0 : 1] : 0; f['d' + c] = d; f['dr' + c] = (d - d0) / f.h; }
    if (info.Pabove && R.cases.EX) for (const c of ['EX', 'EY']) { let V = 0; for (let j = i; j < story.length; j++) V += story[j][c] || 0; f['V' + c] = V; f['th' + c] = V ? info.Pabove[i] * Math.abs(f['dr' + c]) / V : 0; }
    // 비틀림 비정형: 층 절점 최대/평균 변위
    for (const c of ['EX', 'EY']) { if (!R.cases[c]) continue; const k = c === 'EX' ? 0 : 1; let mx = 0, s = 0, n = 0; M.nodes.forEach((nd, id) => { if (nd.dia !== f.dia) return; const v = Math.abs(R.cases[c].disp[id * 6 + k]); mx = Math.max(mx, v); s += v; n++; }); f['tor' + c] = n ? mx / (s / n) : 1; }
  }
  info.time = performance.now() - t0; info.solve = R.time; info.dof = R.N; info.weak = R.weak.length;
  // 평형 검증
  const sumR = (c, k) => { let s = 0; for (const r of R.cases[c].reac.values()) s += r[k]; return s; };
  info.check = { D: { applied: LD.tot.D, reac: sumR('D', 2) }, L: { applied: LD.tot.L, reac: sumR('L', 2) } };
  if (R.cases.EX) info.check.EX = { applied: story.reduce((s, f) => s + f.EX, 0), reac: sumR('EX', 0) };
  return { M, R, model, info, combos, cases, story, at: Date.now(), P };
}

// 부재 단면력: 경우별 스테이션 값 (부재 전체 길이 기준)
export function memberForces(res, mi, st = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]) {
  const m = res.M.members[mi]; const segs = m.segs.map(ei => ({ ei, L: res.R.E[ei].L })); const Lt = segs.reduce((s, x) => s + x.L, 0) || 1;
  const K = ['N', 'Vy', 'Vz', 'T', 'My', 'Mz']; const out = {};
  for (const c of res.cases) { const cr = res.R.cases[c]; const arr = []; let x0 = 0;
    for (const s of segs) {
      if (cr.rs) { const per = cr.modes.map(mr => stationForces(res.R, mr, s.ei, st)); const tor = stationForces(res.R, res.R.cases[cr.tors], s.ei, st);
        st.forEach((xi, j) => { const o = { xi, x: x0 + xi * s.L, ei: s.ei }; for (const k of K) o[k] = cqc(per.map(p => p[j][k]), cr.rho) * cr.scale + Math.abs(tor[j][k]); arr.push(o); }); }
      else for (const f of stationForces(res.R, cr, s.ei, st)) arr.push({ ...f, x: x0 + f.xi * s.L, ei: s.ei });
      x0 += s.L; }
    out[c] = arr; }
  return { m, Lt, byCase: out };
}
export function combine(mf, combo) { const ks = Object.keys(combo.f); const n = mf.byCase.D.length; const out = []; for (let i = 0; i < n; i++) { const o = { x: mf.byCase.D[i].x, ei: mf.byCase.D[i].ei, N: 0, Vy: 0, Vz: 0, T: 0, My: 0, Mz: 0 }; for (const k of ks) { const s = mf.byCase[k]?.[i]; if (!s) continue; const f = combo.f[k]; o.N += f * s.N; o.Vy += f * s.Vy; o.Vz += f * s.Vz; o.T += f * s.T; o.My += f * s.My; o.Mz += f * s.Mz; } out.push(o); } return out; }
