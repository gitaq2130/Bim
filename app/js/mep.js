// 설비·전기 계통 연결 해석 — 덕트·배관·트레이·라이저·장비를 계통별로 묶고, 소스(장비)까지 이어지는지 판정
import { allElements, elBoxes, boxCorners } from './model.js';
import { fmt, fmt0 } from './util.js';

export const SYS = {
  SA: { name: '급기', color: '#4ea8de' }, RA: { name: '환기(리턴)', color: '#b48ead' }, OA: { name: '외기', color: '#7fc06b' }, EA: { name: '배기', color: '#c9a04f' },
  CHWS: { name: '냉수 공급', color: '#3366ff' }, CHWR: { name: '냉수 환수', color: '#33aaff' }, CDWS: { name: '냉각수 공급', color: '#1fa38e' }, CDWR: { name: '냉각수 환수', color: '#4fd1bd' },
  CW: { name: '급수', color: '#40c4ff' }, SD: { name: '오배수', color: '#9c6b3f' }, FP: { name: '스프링클러', color: '#e5484d' },
  BUS: { name: '전력 간선(버스덕트)', color: '#ff9f43' }, ELEC: { name: '케이블트레이(조명·전열)', color: '#f7768e' },
};
export const sysKey = (s) => { const k = String(s || '').trim().split(/[\s\-(]/)[0].toUpperCase(); return SYS[k] ? k : k || ''; };
export const sysColor = (s) => SYS[sysKey(s)]?.color || null;
const sysList = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map(x => sysKey(x)).filter(Boolean);

function segDist(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1; let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }
function inBox(p, b, mg) { const c = Math.cos(-b.ang), s = Math.sin(-b.ang), x = (p[0] - b.cx) * c - (p[1] - b.cy) * s, y = (p[0] - b.cx) * s + (p[1] - b.cy) * c; return Math.abs(x) <= b.hl + mg && Math.abs(y) <= b.hw + mg; }

// 연결 그래프: 덕트·배관·트레이·라이저·장비를 계통별 노드로 만들고, 끝점 근접으로 이어진 쌍을 간선으로 기록
export function mepGraph(P) {
  const lv = [...P.levels].sort((a, b) => a.elev - b.elev); const li = Object.fromEntries(lv.map((l, i) => [l.id, i]));
  const items = []; // {key, id, sys, kind, L, el, level, sheet}
  for (const r of allElements(P)) {
    const el = r.el, L = li[r.level.id];
    if (['duct', 'pipe', 'tray', 'riser'].includes(el.k)) { const k = sysKey(el.sys) || (el.k === 'tray' ? 'ELEC' : ''); if (k) items.push({ key: el.id + '|' + k, id: el.id, sys: k, kind: el.k, L, el, level: r.level, sheet: r.sheet }); }
    else if (el.k === 'furn' && (el.sys || el.src)) { for (const k of new Set([...sysList(el.sys), ...sysList(el.src)])) items.push({ key: el.id + '|' + k, id: el.id, sys: k, kind: 'equip', L, el, level: r.level, sheet: r.sheet, box: elBoxes(el, r.level)[0], src: sysList(el.src).includes(k) }); }
  }
  const edges = []; const join = (a, b) => edges.push([a, b]);
  // 계통·층별 버킷
  const B = new Map(); for (const it of items) { const k = it.sys + '@' + it.L; if (!B.has(k)) B.set(k, []); B.get(k).push(it); }
  const bucket = (sys, L) => B.get(sys + '@' + L) || [];
  const ends = (it) => [it.el.a, it.el.b];
  const half = (it) => it.kind === 'riser' ? Math.max(it.el.w, it.el.form === 'pipe' ? it.el.w : it.el.hh) / 2 : (it.el.w || 0) / 2;
  for (const [, arr] of B) {
    const segs = arr.filter(x => x.el.a), risers = arr.filter(x => x.kind === 'riser'), eq = arr.filter(x => x.kind === 'equip');
    for (let i = 0; i < segs.length; i++) for (let j = 0; j < segs.length; j++) { if (i === j) continue; const A = segs[i], C = segs[j]; if (Math.abs((A.el.z ?? 0) - (C.el.z ?? 0)) > 600) continue; const tol = half(A) + half(C) + 60; if (ends(A).some(p => segDist(p, C.el.a, C.el.b) <= tol)) join(A.key, C.key); }
    for (const R of risers) for (const S of segs) if (ends(S).some(p => Math.hypot(p[0] - R.el.p[0], p[1] - R.el.p[1]) <= half(R) + half(S) + 80)) join(R.key, S.key);
    for (const Q of eq) { for (const S of segs) if (ends(S).some(p => inBox(p, Q.box, half(S) + 150))) join(Q.key, S.key); for (const R of risers) if (inBox(R.el.p, Q.box, half(R) + 150)) join(Q.key, R.key); }
  }
  // 층간: 라이저 적층, 라이저 상단 ↔ 윗층 수평관·장비
  for (const it of items) if (it.kind === 'riser') {
    for (const up of bucket(it.sys, it.L + 1)) {
      if (up.kind === 'riser' && Math.hypot(up.el.p[0] - it.el.p[0], up.el.p[1] - it.el.p[1]) < 100) join(it.key, up.key);
      else if (up.el.a && ends(up).some(p => Math.hypot(p[0] - it.el.p[0], p[1] - it.el.p[1]) <= half(it) + half(up) + 80)) join(it.key, up.key);
      else if (up.kind === 'equip' && inBox(it.el.p, up.box, half(it) + 150)) join(it.key, up.key);
    }
  }
  return { items, edges, levels: lv };
}

export function mepNetwork(P) {
  const { items, edges } = mepGraph(P);
  const par = new Map(items.map(it => [it.key, it.key])); const find = (k) => { while (par.get(k) !== k) { par.set(k, par.get(par.get(k))); k = par.get(k); } return k; };
  for (const [a, b] of edges) { const x = find(a), y = find(b); if (x !== y) par.set(x, y); }
  // 결과
  const comps = new Map();
  for (const it of items) { const r = find(it.key); if (!comps.has(r)) comps.set(r, { sys: it.sys, items: [], src: [], levels: new Set() }); const c = comps.get(r); c.items.push(it); c.levels.add(it.level.name); if (it.src) c.src.push(it); }
  const list = [...comps.values()].map(c => ({ ...c, ok: c.src.length > 0, ids: [...new Set(c.items.map(i => i.id))], n: c.items.filter(i => i.kind !== 'equip').length }));
  const compOf = new Map(); for (const c of list) for (const it of c.items) { if (!compOf.has(it.id)) compOf.set(it.id, []); compOf.get(it.id).push(c); }
  // 장비 요구 계통 (예: AHU는 냉수·외기·배기·전원 필요)
  const needs = [];
  for (const r of allElements(P)) { const el = r.el; if (el.k !== 'furn' || !el.need) continue; for (const k of sysList(el.need)) { const c = (compOf.get(el.id) || []).find(x => x.sys === k); if (!c || !c.ok) needs.push({ el, sys: k, level: r.level, sheet: r.sheet, comp: c }); } }
  const summary = {}; for (const c of list) { const s = (summary[c.sys] ||= { comps: 0, ok: 0, bad: 0, n: 0 }); s.comps++; s.n += c.n; if (c.ok) s.ok++; else s.bad++; }
  return { comps: list, compOf, needs, summary };
}

// ===================== v2: 소방(스프링클러)·전기(분전반·부하) 기준과 계산 =====================
// 계산은 순수 함수로 두고, 화면(tools/mep.js)이 P를 읽어 호출한다. 단위 mm·W·VA.

// ---- 소방: NFTC 103 (스프링클러설비) ----
// 건물 용도 → 헤드 수평거리 R(mm). 2.7.3: 무대부·특수가연물 1.7m, 랙식창고 2.5m, 아파트 세대 3.2m, 그 밖 2.1m(내화구조 2.3m)
export const FIRE_BLDG = {
  일반: { name: '일반(업무·근린생활)', R: (fp) => fp ? 2300 : 2100, base: 'h8' },
  판매: { name: '판매·운수·복합건축물', R: (fp) => fp ? 2300 : 2100, base: 30 },
  특수가연물: { name: '공장·창고(특수가연물)·무대부', R: () => 1700, base: 30 },
  랙식창고: { name: '랙식 창고', R: () => 2500, base: 30 },
  아파트: { name: '아파트(세대 내)', R: () => 3200, base: 10 },
};
// 설치 제외 장소 (NFTC 103 2.12) — 실명·용도로 판정
const FIRE_EXEMPT = /계단|화장실|욕실|목욕|샤워|EPS|TPS|PS실|AD실|덕트|피트|승강로|전기실|변전실|발전기실|통신실|전산실|테라스|발코니/;
export const fireExempt = (name, use) => { const m = `${name || ''} ${use || ''}`.match(FIRE_EXEMPT); return m ? m[0] : null; };

// 정방형 배치: 헤드 간격 S = 2R·cos45° = R√2, 벽까지 S/2 이하
export const headSpacing = (R) => Math.floor(R * Math.SQRT2 / 10) * 10;

function inPoly(p, pts) { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if (((a[1] > p[1]) !== (b[1] > p[1])) && (p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0])) c = !c; } return c; }
function bb(pts) { const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }; }
// 실 내부 시험점 (커버리지 검증용, 벽에서 50mm 안쪽까지)
function samples(pts, step) {
  const b = bb(pts), out = []; const nx = Math.max(2, Math.ceil((b.x1 - b.x0) / step)), ny = Math.max(2, Math.ceil((b.y1 - b.y0) / step));
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) {
    const p = [b.x0 + 50 + (b.x1 - b.x0 - 100) * i / nx, b.y0 + 50 + (b.y1 - b.y0 - 100) * j / ny];
    if (inPoly(p, pts)) out.push(p);
  }
  return out;
}
// 커버리지: 실 내부 시험점 중 가장 가까운 헤드까지 수평거리 ≤ R 인 비율
export function headCoverage(pts, heads, R) {
  const sp = samples(pts, 250); if (!sp.length) return { ratio: 1, miss: [] };
  const g = new Map(), key = (i, j) => i * 100003 + j; // 헤드를 R 크기 격자에 넣어 주변 9칸만 검사
  for (const q of heads) { const k = key(Math.floor(q[0] / R), Math.floor(q[1] / R)); if (!g.has(k)) g.set(k, []); g.get(k).push(q); }
  const hit = (p) => { const i = Math.floor(p[0] / R), j = Math.floor(p[1] / R); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const q of g.get(key(i + a, j + b)) || []) if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= R) return true; return false; };
  const miss = sp.filter(p => !hit(p));
  return { ratio: 1 - miss.length / sp.length, miss };
}
// 헤드 자동 배치: 외접 사각형을 S 이하 간격 격자로 나누고, 실 밖 점은 버린 뒤 비는 곳을 보충
export function placeHeads(pts, R) {
  const S = headSpacing(R), b = bb(pts), W = b.x1 - b.x0, D = b.y1 - b.y0;
  const nx = Math.max(1, Math.ceil(W / S)), ny = Math.max(1, Math.ceil(D / S)), sx = W / nx, sy = D / ny;
  let heads = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { const p = [Math.round(b.x0 + sx * (i + 0.5)), Math.round(b.y0 + sy * (j + 0.5))]; if (inPoly(p, pts)) heads.push(p); }
  for (let k = 0; k < 40; k++) { // L자 등 비정형 실 보충 (미경계 시험점 중 하나에 추가)
    const { miss } = headCoverage(pts, heads, R); if (!miss.length) break;
    const c = miss.reduce((a, p) => [a[0] + p[0] / miss.length, a[1] + p[1] / miss.length], [0, 0]);
    const p = inPoly(c, pts) && !heads.some(q => Math.hypot(c[0] - q[0], c[1] - q[1]) < 600) ? c : miss[0];
    heads.push([Math.round(p[0]), Math.round(p[1])]);
  }
  return { heads, S, sx: Math.round(sx), sy: Math.round(sy), nx, ny };
}
// 기준개수·수원량 (NFTC 103 2.1.1): Q = N × 80 L/min × 20분(30층 미만) / 40분(30~49층) / 60분(50층 이상)
export function fireDemand(bldg, floors, maxCeil, totalHeads) {
  const B = FIRE_BLDG[bldg] || FIRE_BLDG.일반;
  let base = B.base === 'h8' ? (maxCeil >= 8000 ? 20 : 10) : B.base;
  if (bldg !== '아파트' && floors >= 11) base = 30;
  const N = Math.min(base, totalHeads), min = floors >= 50 ? 60 : floors >= 30 ? 40 : 20;
  return { base, N, min, flow: N * 80, Q: N * 80 * min / 1000 };
}

// ---- 전기: KEC·내선규정 기반 (분기회로·수용률·간선) ----
// 전열(콘센트) 부하밀도 VA/m² — 내선규정 표준부하(건물 종류별 10~40VA/m²)를 실 용도별로 나눈 가정치
export const OUTLET_VA = { 사무실: 30, 회의실: 20, 로비: 10, 복도: 5, 계단: 0, 화장실: 10, 창고: 5, 주차장: 2, 거실: 40, 침실: 20, 주방: 60, 식당: 20, 기계실: 10, 전기실: 10 };
export const ELEC = {
  V1: 220, V3: 380, pf: 0.9,
  branchA: 20, cont: 0.8,          // 분기회로 20A, 연속부하 80% → 회로당 3,520VA
  dfLight: 1.0, dfOutlet: 0.5,     // 수용률 가정: 전등 100%, 전열 50%
  spare: 0.2, panelR: 30000,       // 예비회로 20%, 분전반 공급 반경 30m
  lmPerW: 110,                     // 조명 미배치 실의 전등 부하 추정용 LED 효율(lm/W)
};
export const circuitVA = () => ELEC.V1 * ELEC.branchA * ELEC.cont;
const BREAKERS = [20, 30, 40, 50, 60, 75, 100, 125, 150, 175, 200, 225, 250, 300, 350, 400, 500, 600, 630, 800];
// F-CV 0.6/1kV 3·4심, 케이블트레이(기중 30°C) 허용전류 대략치 — 실시 설계 시 KEC 232.5 허용전류표·보정계수로 재확인
const CABLES = [[4, 34], [6, 44], [10, 60], [16, 80], [25, 105], [35, 128], [50, 154], [70, 194], [95, 233], [120, 268], [150, 300], [185, 340], [240, 398], [300, 455]];
export function feeder(kVA) {
  const three = kVA > 7, I = three ? kVA * 1000 / (Math.sqrt(3) * ELEC.V3) : kVA * 1000 / ELEC.V1;
  const brk = BREAKERS.find(a => a >= I * 1.25) || BREAKERS[BREAKERS.length - 1];
  const c = CABLES.find(([, a]) => a >= brk) || CABLES[CABLES.length - 1];
  return { phase: three ? '3상4선 380/220V' : '단상2선 220V', I, brk, cable: `F-CV ${c[0]}sq×${three ? '4C' : '2C'}`, amp: c[1] };
}
// 분전반 1면 부하 집계 → 회로수·최대수요·간선
export function panelLoad(lightW, outletVA) {
  const cv = circuitVA(), nl = Math.ceil(lightW / cv), no = Math.ceil(outletVA / cv);
  const n = nl + no, spare = Math.ceil(n * ELEC.spare);
  const kVA = (lightW / ELEC.pf * ELEC.dfLight + outletVA * ELEC.dfOutlet) / 1000; // 전등 W는 역률로 VA 환산
  return { nl, no, spare, circuits: n + spare, kVA, kW: kVA * ELEC.pf, ...feeder(kVA) };
}
// 층 부하점 → 분전반 위치 (공급 반경 초과 시 긴 방향으로 분할, 부하 가중 중심)
export function panelSpots(loads) { // loads: [{p:[x,y], va}]
  if (!loads.length) return [];
  const b = bb(loads.map(l => l.p)), W = b.x1 - b.x0, D = b.y1 - b.y0, ax = W >= D ? 0 : 1;
  const k = Math.max(1, Math.ceil(Math.max(W, D) / (ELEC.panelR * 2)));
  const sorted = [...loads].sort((a, c) => a.p[ax] - c.p[ax]); const tot = sorted.reduce((s, l) => s + (l.va || 1), 0);
  const groups = Array.from({ length: k }, () => []); let acc = 0;
  for (const l of sorted) { groups[Math.min(k - 1, Math.floor(acc / tot * k))].push(l); acc += l.va || 1; }
  return groups.filter(g => g.length).map(g => { const s = g.reduce((t, l) => t + (l.va || 1), 0); return [g.reduce((t, l) => t + l.p[0] * (l.va || 1), 0) / s, g.reduce((t, l) => t + l.p[1] * (l.va || 1), 0) / s]; });
}
// 위치를 가장 가까운 벽면에 붙임 (벽: {a,b,t}), 분전반 깊이 d만큼 띄우고 벽 방향으로 회전
export function snapToWall(p, walls, d) {
  let best = null;
  for (const w of walls) {
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], L = Math.hypot(dx, dy); if (L < 900) continue;
    let t = ((p[0] - w.a[0]) * dx + (p[1] - w.a[1]) * dy) / (L * L); t = Math.max(450 / L, Math.min(1 - 450 / L, t));
    const q = [w.a[0] + dx * t, w.a[1] + dy * t], dd = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (!best || dd < best.dd) { let nx = -dy / L, ny = dx / L; if ((p[0] - q[0]) * nx + (p[1] - q[1]) * ny < 0) { nx = -nx; ny = -ny; } const off = (w.t || 200) / 2 + d / 2; best = { dd, p: [Math.round(q[0] + nx * off), Math.round(q[1] + ny * off)], rot: Math.round(Math.atan2(dy, dx) * 180 / Math.PI) }; }
  }
  return best ? { p: best.p, rot: best.rot, wall: true } : { p: p.map(Math.round), rot: 0, wall: false };
}

// ===================== v3: 가동 시뮬레이션 =====================
// 시나리오(정상·화재·정전·장비 정지)를 주면 계통 그래프를 따라 풍량·유량·전력을 흘려 보고,
// 구간 유속·장비 용량·환기량·소방 압력·비상전원을 기준과 비교한다. 단위: 풍량·수량 m³/h(소방 L/min), 전력 kW·kVA.
export const SIM = {
  occ: { 사무실: 0.2, 회의실: 0.5, 로비: 0.1, 식당: 0.5, 거실: 0.05, 침실: 0.05, 주방: 0.1, 복도: 0.05, 기본: 0.1 },        // 재실 밀도 인/m²
  oaPerson: 29,                                                                                                          // 필요 외기량 m³/h·인 (건축물의 설비기준 등에 관한 규칙 별표 1의6)
  cool: { 사무실: 110, 회의실: 150, 로비: 120, 식당: 150, 거실: 80, 침실: 60, 주방: 150, 복도: 50, 화장실: 40, 창고: 30, 계단: 0, 주차장: 0, 기계실: 0, 전기실: 0, 기본: 110 }, // 냉방부하 밀도 W/m²
  div: 0.85, dTair: 10, dTw: 5, cop: 5.0,                     // 동시부하율, 급기 온도차, 냉수·냉각수 온도차(K), 냉동기 COP
  waterDay: 100, waterHrs: 8,                                 // 1인 1일 급수량(L), 사용 시간
  fanPa: 1000, fanEff: 0.6, pumpEff: 0.7, chwHead: 30, cdwHead: 25, ctFan: 0.015,
  lightW: 10, outletVA: 30, dfOutlet: 0.5, pf: 0.9, trLoad: 0.8, emLight: 0.1,
  hw: 6.053e4, C: 120, fit: 1.2, hdMin: 0.1, hdMax: 1.2,       // Hazen-Williams 계수(NFTC 103 수리계산), 부속 손실 가산, 헤드 방수압 범위 MPa
};
const RETURN_SYS = new Set(['RA', 'CHWR', 'CDWR', 'EA', 'SD']); // 흐름이 소스(장비) 쪽으로 돌아오는 계통
const DUCT_SYS = new Set(['SA', 'RA', 'OA', 'EA']);
export const SIM_GROUPS = [
  ['air', '공조(급기·환기)', ['SA', 'RA']], ['oa', '외기·배기', ['OA', 'EA']], ['chw', '냉수', ['CHWS', 'CHWR']], ['cdw', '냉각수', ['CDWS', 'CDWR']],
  ['cw', '급수', ['CW']], ['sd', '배수', ['SD']], ['fp', '소방', ['FP']], ['el', '전력', ['BUS', 'ELEC']],
];
const groupOf = (sys) => SIM_GROUPS.find(g => g[2].includes(sys))?.[0] || 'etc';
const PIPE_STD = [15, 20, 25, 32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500, 600];
const TR_STD = [300, 500, 750, 1000, 1250, 1500, 2000, 2500, 3000, 3750, 5000];
const RANK = { ok: 0, info: 0, warn: 1, fail: 2 };
const worst = (a, b) => (RANK[b] || 0) > (RANK[a] || 0) ? b : a;

// 태그에서 용량 읽기 ("600RT", "1500kVA", "120톤", "30kW", "2400L/min", "18000CMH")
export function capOf(el) {
  const t = String(el.tag || '') + ' ' + String(el.cap || ''); let m;
  if ((m = t.match(/([\d.]+)\s*RT/i))) return { kW: +m[1] * 3.517, label: `${m[1]}RT` };
  if ((m = t.match(/([\d.]+)\s*kVA/i))) return { kVA: +m[1], label: `${m[1]}kVA` };
  if ((m = t.match(/([\d.]+)\s*(톤|ton|m³|m3)(?!\/)/i))) return { m3: +m[1], label: `${m[1]}톤` };
  if ((m = t.match(/([\d.]+)\s*(L\/min|LPM)/i))) return { lpm: +m[1], label: `${m[1]}L/min` };
  if ((m = t.match(/([\d.]+)\s*(CMH|m³\/h|m3\/h)/i))) return { cmh: +m[1], label: `${m[1]}m³/h` };
  if ((m = t.match(/([\d.]+)\s*kW/i))) return { kWe: +m[1], label: `${m[1]}kW` };
  return null;
}
// 구간 유속 한도 [주의, 부적합] m/s
function vLimit(sys, it, branch) {
  if (DUCT_SYS.has(sys)) return branch ? [6, 9] : [10, 15];
  if (sys === 'FP') return branch ? [5.4, 6] : [9, 10];
  const d = it.el.w || 100; return d <= 50 ? [1.5, 2.0] : d <= 150 ? [2.4, 3.0] : [3.0, 3.5];
}
const areaOf = (it) => { const el = it.el; if (DUCT_SYS.has(it.sys) && (it.kind === 'duct' || el.form === 'duct')) return (el.w || 0) * (el.hh || el.w || 0) * 1e-6; const d = (el.w || 0) * 1e-3; return Math.PI / 4 * d * d; };
const isPipe = (it) => !DUCT_SYS.has(it.sys);
function suggestSize(it, Q, vmax) { // Q m³/h → 한도 이하가 되는 최소 규격
  const A = Q / 3600 / vmax; if (!(A > 0)) return '';
  if (isPipe(it)) { const d = Math.sqrt(4 * A / Math.PI) * 1000; return `${PIPE_STD.find(x => x >= d) || Math.ceil(d / 50) * 50}A`; }
  let hh = it.el.hh || 300, w = Math.ceil(A * 1e6 / hh / 50) * 50; if (w / hh > 4) { hh = Math.ceil(Math.sqrt(A * 1e6 / 4) / 50) * 50; w = Math.ceil(A * 1e6 / hh / 50) * 50; }
  return `${w}×${hh}`;
}
const hwLoss = (lpm, d, Lm) => d > 0 && lpm > 0 ? SIM.hw * lpm ** 1.85 / (SIM.C ** 1.85 * d ** 4.87) * Lm : 0; // MPa
const elevZ = (it) => (it.level.elev || 0) + (it.el.z ?? it.el.z0 ?? 0);

// 층별 부하 존 (실이 있으면 실 기준, 없으면 슬래브 면적 × 업무시설 가정)
export function simZones(P) {
  const all = allElements(P), top = [...P.levels].sort((a, b) => b.elev - a.elev)[0];
  const area = (pts) => { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2e6; };
  const zones = new Map();
  for (const L of P.levels) {
    const rooms = all.filter(r => r.level.id === L.id && r.el.k === 'room' && r.el.pts?.length >= 3);
    const slabs = all.filter(r => r.level.id === L.id && r.el.k === 'slab' && r.el.pts?.length >= 3);
    let parts;
    if (rooms.length) parts = rooms.map(r => ({ A: area(r.el.pts), use: r.el.use || '사무실' }));
    else if (slabs.length && L !== top) parts = [{ A: Math.max(...slabs.map(s => area(s.el.pts))), use: '사무실', assumed: true }];
    else continue;
    const A = parts.reduce((s, p) => s + p.A, 0); if (A <= 0) continue;
    const occ = parts.reduce((s, p) => s + p.A * (SIM.occ[p.use] ?? SIM.occ.기본), 0);
    const coolKW = parts.reduce((s, p) => s + p.A * (SIM.cool[p.use] ?? SIM.cool.기본), 0) / 1000;
    const lights = all.filter(r => r.level.id === L.id && r.el.k === 'light');
    const lightKW = lights.length ? lights.reduce((s, l) => s + (l.el.watt || 0), 0) / 1000 : A * SIM.lightW / 1000;
    const outletKVA = parts.reduce((s, p) => s + p.A * (OUTLET_VA[p.use] ?? SIM.outletVA), 0) / 1000;
    zones.set(L.id, { level: L, A, occ, coolKW, sa: coolKW / (1.2 * 1.006 * SIM.dTair) * 3600, oa: occ * SIM.oaPerson,
      water: occ * SIM.waterDay / SIM.waterHrs * 1.5 * 3 / 60 /* L/min 순간최대 */, lightKW, outletKVA, assumed: !!parts[0].assumed });
  }
  return zones;
}

export const SCENARIOS = { normal: '정상 운전 (여름 냉방 피크)', fire: '화재 발생', blackout: '정전 (상용전원 차단)', fault: '장비 정지·고장' };
const EQUIP_TYPES = { ahu: '공조기', chiller: '냉동기', ctower: '냉각탑', pump: '펌프', fan: '팬', louver: '외기 루버', tr: '변압기', swgr: '수배전반', gen: '비상발전기', tank: '저수조', panel: '분전반', vav: 'VAV', grille: '그릴', pit: '배수 피트' };

export function mepSim(P, sc = { type: 'normal' }) {
  const G = mepGraph(P), all = allElements(P), zones = simZones(P);
  const items = G.items, byKey = new Map(items.map(i => [i.key, i])), adj = new Map(items.map(i => [i.key, []]));
  for (const [a, b] of G.edges) if (a !== b) { adj.get(a).push(b); adj.get(b).push(a); }
  for (const [k, v] of adj) adj.set(k, [...new Set(v)]);
  const lvSorted = G.levels, lvIdx = Object.fromEntries(lvSorted.map((l, i) => [l.id, i]));
  // 장비
  const equips = all.filter(r => r.el.k === 'furn' && (EQUIP_TYPES[r.el.type] || r.el.sys || r.el.src)).filter(r => EQUIP_TYPES[r.el.type] || r.el.src || r.el.need)
    .map(r => ({ el: r.el, level: r.level, sheet: r.sheet, type: r.el.type, kind: EQUIP_TYPES[r.el.type] || r.el.type, name: r.el.tag || EQUIP_TYPES[r.el.type] || r.el.type, cap: capOf(r.el), state: '운전', note: '', capTxt: '-', load: 0, ratio: 0, kW: 0 }));
  const eqById = new Map(equips.map(e => [e.el.id, e]));
  const off = new Set(); const events = []; const checks = [];
  const ev = (t, text, lv = 'info') => events.push({ t, text, lv });
  const chk = (cat, item, value, limit, lv, basis, extra = {}) => checks.push({ cat, item, value, limit, lv, basis, ...extra });
  const typeOf = (t) => equips.filter(e => e.type === t);
  const gens = typeOf('gen'), genLinked = gens.filter(g => /BUS/i.test(`${g.el.sys || ''},${g.el.src || ''}`));
  let fireLv = null;

  // ---- 시나리오별 운전 상태 ----
  if (sc.type === 'fire') {
    fireLv = P.levels.find(l => l.id === sc.level) || [...zones.values()][0]?.level || lvSorted[0];
    for (const e of equips) if (e.type === 'ahu' && e.level.id === fireLv.id) { off.add(e.el.id); e.state = '정지'; e.note = '화재 연동 정지(연기 확산 방지)'; }
  } else if (sc.type === 'blackout') {
    const genOk = genLinked.length > 0;
    for (const e of equips) {
      if (['tank', 'pit', 'louver', 'grille'].includes(e.type)) continue;
      const emerg = (e.type === 'pump' && /소화|FP/i.test(`${e.name} ${e.el.sys}`)) || e.type === 'gen' || e.type === 'swgr';
      if (e.type === 'gen') { e.state = genOk ? '운전' : '미연결'; e.note = genOk ? '정전 10초 내 전압 확립' : 'BUS 계통 연결 없음'; continue; }
      if (emerg && genOk) { e.note = '비상전원'; continue; }
      off.add(e.el.id); e.state = '정지'; e.note = emerg ? '비상전원 미확보' : '상용전원 차단';
    }
  } else if (sc.type === 'fault' && sc.equip) {
    const e = eqById.get(sc.equip); if (e) { off.add(e.el.id); e.state = '고장'; e.note = '정지 지정'; }
  }
  for (const e of equips) if (e.state === '운전' && e.type === 'gen' && sc.type !== 'blackout') { e.state = '대기'; e.note = genLinked.includes(e) ? '정전 시 자동 기동' : 'BUS 계통 연결 없음'; }

  // ---- 존 부하 (정지된 AHU 층은 공조 부하 0) ----
  const ahuOf = new Map(); for (const e of typeOf('ahu')) { if (!ahuOf.has(e.level.id)) ahuOf.set(e.level.id, []); ahuOf.get(e.level.id).push(e); }
  const conditioned = (lid) => (ahuOf.get(lid) || []).some(e => !off.has(e.el.id));
  let coolTot = 0; for (const [lid, z] of zones) if (conditioned(lid)) coolTot += z.coolKW;
  const plantCool = coolTot * SIM.div;
  const chillers = typeOf('chiller'), chOn = chillers.filter(e => !off.has(e.el.id));

  // 소방 설계 유량
  const heads = all.filter(r => r.el.k === 'sprinkler'); const headsOn = (lid) => heads.filter(h => h.level.id === lid).length;
  const fd = fireDemand(P.mep?.calc?.input?.bldg || '일반', [...zones.keys()].length || 1, 0, Math.max(heads.length, 1));
  const Nfire = fd.base, fireFlow = (lid) => Math.min(Nfire, headsOn(lid) || Nfire) * 80;

  // ---- 계통 요소 연결 요소(component) ----
  const comp = new Map(); let cid = 0;
  for (const it of items) { if (comp.has(it.key)) continue; const q = [it.key]; comp.set(it.key, cid); while (q.length) { const k = q.pop(); for (const n of adj.get(k)) if (!comp.has(n)) { comp.set(n, cid); q.push(n); } } cid++; }
  const comps = Array.from({ length: cid }, () => []); for (const it of items) comps[comp.get(it.key)].push(it);

  const seg = new Map(); // key → {it, Q, v, lv, dir, state, branch, lim, sug}
  const fpPath = []; let fpTopLv = null;
  for (const C of comps) {
    const sys = C[0].sys, srcAll = C.filter(i => i.kind === 'equip' && i.src), src = srcAll.filter(i => !off.has(i.id));
    const demand = new Map();
    let leaves = C.filter(i => i.kind === 'equip' && !i.src);
    if (!leaves.length) leaves = C.filter(i => i.kind !== 'equip' && adj.get(i.key).length <= 1 && !adj.get(i.key).some(n => byKey.get(n).src));
    const perLv = (arr) => { const m = new Map(); for (const l of arr) { if (!m.has(l.level.id)) m.set(l.level.id, []); m.get(l.level.id).push(l); } return m; };
    const lvLeaves = perLv(leaves);
    const setDemand = (fn) => { for (const [lid, arr] of lvLeaves) { const z = zones.get(lid); for (const l of arr) { const v = fn(l, z, arr.length); if (v > 0) demand.set(l.key, v); } } };
    const ahuOn = (l) => !(l.kind === 'equip' && l.el.type === 'ahu' && off.has(l.id));
    if (sys === 'SA' || sys === 'RA') setDemand((l, z, n) => z && conditioned(l.level.id) ? z.sa * (sys === 'RA' ? 0.9 : 1) / n : 0);
    else if (sys === 'OA' || sys === 'EA') setDemand((l, z, n) => z && ahuOn(l) && conditioned(l.level.id) ? z.oa / (l.kind === 'equip' ? (ahuOf.get(l.level.id)?.length || 1) : n) : 0);
    else if (sys === 'CHWS' || sys === 'CHWR') setDemand((l, z, n) => z && ahuOn(l) && conditioned(l.level.id) ? z.coolKW / (4.186 * SIM.dTw) * 3.6 / (l.kind === 'equip' ? (ahuOf.get(l.level.id)?.length || 1) : n) : 0);
    else if (sys === 'CDWS' || sys === 'CDWR') setDemand((l) => l.kind === 'equip' && l.el.type === 'chiller' ? (off.has(l.id) || !chOn.length ? 0 : plantCool * (1 + 1 / SIM.cop) / chOn.length / (4.186 * SIM.dTw) * 3.6) : 0);
    else if (sys === 'CW') setDemand((l, z, n) => z ? z.water / n * 0.06 : 0);
    else if (sys === 'FP') {
      const fl = [...lvLeaves.keys()].sort((a, b) => lvIdx[b] - lvIdx[a]); fpTopLv = fpTopLv || P.levels.find(l => l.id === fl[0]);
      const target = sc.type === 'fire' ? fireLv?.id : fl[0]; // 정상 시에는 최고층(최원단) 화재를 가정해 설계 확인
      const arr = lvLeaves.get(target) || []; for (const l of arr) demand.set(l.key, fireFlow(target) / arr.length / 1000 * 60); // m³/h
    }
    // BFS (가동 중인 소스에서)
    const par = new Map(), order = [];
    for (const s of src) { par.set(s.key, null); order.push(s.key); }
    for (let i = 0; i < order.length; i++) for (const n of adj.get(order[i])) if (!par.has(n)) { par.set(n, order[i]); order.push(n); }
    const Q = new Map(), nL = new Map(), kids = new Map();
    for (const k of order) { const p = par.get(k); if (p) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(k); } }
    for (let i = order.length - 1; i >= 0; i--) {
      const k = order[i]; let q = demand.get(k) || 0, n = demand.has(k) ? 1 : 0;
      for (const c of kids.get(k) || []) { q += Q.get(c) || 0; n += nL.get(c) || 0; }
      Q.set(k, q); nL.set(k, n);
    }
    const designed = srcAll.length > 0;
    for (const it of C) {
      if (it.kind === 'equip') continue;
      const reached = par.has(it.key); let q = Q.get(it.key) || 0; const n = nL.get(it.key) || 0;
      if (sys === 'CW' && n > 1) q *= n ** -0.4; else if ((sys.startsWith('CHW') || sys.startsWith('CDW')) && n > 1) q *= SIM.div;
      const childSeg = (kids.get(it.key) || []).some(c => byKey.get(c).kind !== 'equip');
      const branch = it.kind !== 'riser' && !childSeg;
      const A = areaOf(it), v = A > 0 && q > 0 && it.sys !== 'BUS' && it.sys !== 'ELEC' && it.sys !== 'SD' ? q / 3600 / A : 0;
      const lim = vLimit(sys, it, branch), lv = !reached ? (designed ? (src.length ? 'warn' : 'off') : 'fail') : v > lim[1] ? 'fail' : v > lim[0] ? 'warn' : 'ok';
      let dir = 1; const p = par.get(it.key);
      if (p && it.el.a) { const P0 = byKey.get(p); const pt = P0.el.p || (P0.el.a ? [(P0.el.a[0] + P0.el.b[0]) / 2, (P0.el.a[1] + P0.el.b[1]) / 2] : P0.box ? [P0.box.cx, P0.box.cy] : it.el.a); const da = Math.hypot(it.el.a[0] - pt[0], it.el.a[1] - pt[1]), db = Math.hypot(it.el.b[0] - pt[0], it.el.b[1] - pt[1]); dir = da <= db ? 1 : -1; if (P0.el.a) { const segd = (x) => { const ax = P0.el.a, bx = P0.el.b, dx = bx[0] - ax[0], dy = bx[1] - ax[1], L2 = dx * dx + dy * dy || 1; let t = ((x[0] - ax[0]) * dx + (x[1] - ax[1]) * dy) / L2; t = Math.max(0, Math.min(1, t)); return Math.hypot(x[0] - ax[0] - t * dx, x[1] - ax[1] - t * dy); }; dir = segd(it.el.a) <= segd(it.el.b) ? 1 : -1; } }
      if (RETURN_SYS.has(sys)) dir = -dir;
      const avail = ['BUS', 'ELEC', 'SD'].includes(sys); // 유량 계산 없이 공급 가능 여부만 보는 계통
      seg.set(it.key, { it, sys, Q: q, v, lv, dir, branch, lim, state: !reached ? 'off' : q > 0 || avail ? 'run' : 'idle', sug: lv === 'fail' || lv === 'warn' ? suggestSize(it, q, lim[0]) : '' });
    }
    // 소방: 최원단 말단까지 마찰손실 경로
    if (sys === 'FP' && src.length) {
      let far = null, best = -1; for (const [k] of demand) { let s = 0, x = k; while (x && par.get(x) !== undefined) { const p = par.get(x); if (!p) break; s++; x = p; } if (s > best) { best = s; far = k; } }
      let x = far, loss = 0, len = 0; const pump = src[0];
      while (x) { const it = byKey.get(x), st = seg.get(x); if (st) { const Lm = it.kind === 'riser' ? (it.level.height || 3000) / 1000 : Math.hypot(it.el.b[0] - it.el.a[0], it.el.b[1] - it.el.a[1]) / 1000; loss += hwLoss(st.Q * 1000 / 60, it.el.w, Lm * SIM.fit); len += Lm; } x = par.get(x); }
      const farIt = far && byKey.get(far); if (farIt) fpPath.push({ pump, far: farIt, loss, len, static: Math.max(0, (elevZ(farIt) - elevZ(pump)) / 1e5) /* MPa (100m ≈ 1MPa) */ });
    }
  }

  // ---- 장비 동력·용량 ----
  const run = (e) => !off.has(e.el.id) && e.state !== '미연결';
  const sumQ = (sys, fn) => { let s = 0; for (const [, x] of seg) if (x.sys === sys && fn(x)) s = Math.max(s, x.Q); return s; };
  for (const e of typeOf('ahu')) { const z = zones.get(e.level.id), n = ahuOf.get(e.level.id).length; e.load = z && run(e) ? z.sa / n : 0; e.kW = e.load / 3600 * SIM.fanPa / SIM.fanEff / 1000; e.capTxt = e.cap?.cmh ? `${fmt0(e.cap.cmh)}m³/h` : `${fmt0(z ? z.sa / n : 0)}m³/h (자동)`; e.ratio = e.cap?.cmh ? e.load / e.cap.cmh : e.load ? 1 : 0; }
  const chCap = chillers.reduce((s, e) => s + (e.cap?.kW || 0), 0), chAuto = !chillers.some(e => e.cap?.kW);
  const chUnit = chAuto ? Math.ceil(coolTot * SIM.div / Math.max(1, chillers.length) / 3.517 / 50) * 50 * 3.517 : 0;
  for (const e of chillers) { const cap = e.cap?.kW || chUnit; e.capTxt = `${fmt0(cap / 3.517)}RT${e.cap ? '' : ' (자동)'}`; e.load = run(e) && chOn.length ? plantCool / chOn.length : 0; e.ratio = cap ? e.load / cap : 0; e.kW = Math.min(e.load, cap) / SIM.cop; }
  const cts = typeOf('ctower'), ctOn = cts.filter(run), rej = Math.min(plantCool, chOn.reduce((s, e) => s + (e.cap?.kW || chUnit), 0)) * (1 + 1 / SIM.cop);
  for (const e of cts) { const cap = e.cap?.kW || (rej / Math.max(1, cts.length)) * 1.0; e.capTxt = `${fmt0(cap / 3.517 / 1.25)}RT${e.cap ? '' : ' (자동)'}`; e.load = run(e) && ctOn.length ? rej / ctOn.length : 0; e.ratio = cap ? e.load / cap : 0; e.kW = e.load * SIM.ctFan; e._cap = cap; }
  const fpRec = fpPath[0];
  for (const e of typeOf('pump')) {
    const sys = sysKey(e.el.sys) || sysKey(e.el.src);
    if (sys === 'FP') { const Qd = Nfire * 80, Hreq = fpRec ? (fpRec.static + fpRec.loss + SIM.hdMin) : 0; const fireNow = sc.type === 'fire' && run(e); e.design = { Q: Qd, H: Hreq * 1.1 }; e.capTxt = e.cap?.lpm ? `${e.cap.lpm}L/min` : `${fmt0(Qd)}L/min × ${fmt0(Hreq * 110)}m (자동)`; e.load = fireNow ? Qd : 0; e.ratio = fireNow ? 1 : 0; e.kW = fireNow ? 9.8 * Qd / 60000 * Hreq * 110 / SIM.pumpEff : 0; if (sc.type !== 'fire' && run(e)) { e.state = '대기'; e.note ||= '압력 저하 시 자동 기동'; } }
    else if (sys === 'CW') { const q = sumQ('CW', () => true); e.load = run(e) ? q : 0; const H = ((lvSorted.at(-1)?.elev || 0) - (e.level.elev || 0)) / 1000 + 30; e.capTxt = `${fmt0(q)}m³/h × ${fmt0(H)}m (자동)`; e.ratio = e.load ? 1 : 0; e.kW = 9.8 * e.load / 3600 * H / SIM.pumpEff; }
    else { e.load = 0; e.kW = 0; e.capTxt = '-'; }
  }
  // 냉수·냉각수 순환 펌프 (모델에 없으면 냉동기에 포함된 것으로 보고 동력만 산입)
  const chwFlow = plantCool / (4.186 * SIM.dTw) * 3.6, cdwFlow = rej / (4.186 * SIM.dTw) * 3.6;
  const auxKW = chOn.length ? 9.8 * chwFlow / 3600 * SIM.chwHead / SIM.pumpEff + 9.8 * cdwFlow / 3600 * SIM.cdwHead / SIM.pumpEff : 0;

  // ---- 전력 ----
  const zoneKVA = (z) => (z.lightKW / SIM.pf + z.outletKVA * SIM.dfOutlet);
  let bldgKVA = 0; for (const [, z] of zones) bldgKVA += zoneKVA(z);
  const mechKW = equips.reduce((s, e) => s + (run(e) ? e.kW || 0 : 0), 0) + auxKW;
  const demandKVA = sc.type === 'blackout' ? 0 : bldgKVA + mechKW / SIM.pf;
  const trs = typeOf('tr'), trCapTag = trs.reduce((s, e) => s + (e.cap?.kVA || 0), 0);
  const designKVA = (() => { let k = 0; for (const [, z] of zones) k += zoneKVA(z); return k + (coolTot * SIM.div / SIM.cop + coolTot * SIM.div / SIM.cop * 0.25) / SIM.pf; })();
  const trUnit = TR_STD.find(x => x * Math.max(1, trs.length) * SIM.trLoad >= designKVA) || TR_STD.at(-1);
  const trCap = trCapTag || (trs.length ? trUnit * trs.length : 0), trOn = trs.filter(run).length;
  for (const e of trs) { e.capTxt = e.cap?.kVA ? `${e.cap.kVA}kVA` : `${trUnit}kVA (자동)`; e.load = run(e) && trOn ? demandKVA / trOn : 0; e.ratio = (e.cap?.kVA || trUnit) ? e.load / (e.cap?.kVA || trUnit) : 0; }
  const emKW = typeOf('pump').filter(e => sysKey(e.el.sys) === 'FP').reduce((s, e) => s + (e.design ? 9.8 * e.design.Q / 60000 * e.design.H * 100 / SIM.pumpEff : 0), 0) + [...zones.values()].reduce((s, z) => s + z.lightKW * SIM.emLight, 0);
  for (const e of gens) { const cap = e.cap?.kVA || Math.ceil(emKW / SIM.pf * 1.5 / 50) * 50; e.capTxt = `${fmt0(cap)}kVA${e.cap ? '' : ' (자동)'}`; e.load = sc.type === 'blackout' && genLinked.includes(e) ? emKW / SIM.pf : 0; e.ratio = cap ? e.load / cap : 0; e._cap = cap; }

  // ================= 판정 =================
  const segArr = [...seg.values()];
  // 1) 환기·공조
  const hasAhu = typeOf('ahu').length > 0;
  if (!hasAhu) chk('환기·공조', '중앙 공조 설비', '공조기 없음', '-', zones.size ? 'warn' : 'info', '공조기(AHU)가 모델에 없어 환기량·냉방을 확인할 수 없습니다. 개별 냉난방·환기 설비라면 작도에 장비(furn, sys 지정)를 추가하세요.');
  if (hasAhu && sc.type === 'blackout') chk('환기·공조', '공조·환기 전 층', '정지 (상용전원 차단)', '-', 'info', '정전 중 공조기는 비상부하가 아니므로 정지가 정상입니다. 장시간 정전 시 자연환기·제연설비로 대응합니다.');
  for (const [lid, z] of zones) {
    if (!hasAhu || sc.type === 'blackout') break;
    const ah = ahuOf.get(lid) || [];
    if (!ah.length) { chk('환기·공조', `${z.level.name} 공조 계통`, '공조기 없음', '층별 공조기 또는 상층 공조기 덕트', 'warn', '이 층에 공조기가 없고 다른 층 덕트도 닿지 않습니다.', { level: lid, kind: '공조기 없는 층' }); continue; }
    const allOff = ah.every(e => off.has(e.el.id)), intended = sc.type === 'fire' && fireLv?.id === lid;
    if (allOff) { chk('환기·공조', `${z.level.name} 공조·환기`, '정지', `외기 ${fmt0(z.oa)}m³/h 필요`, intended ? 'info' : 'fail', intended ? '화재층 공조 정지는 정상 연동입니다 (제연설비가 별도 작동해야 함).' : '공조기 정지로 외기 공급이 끊깁니다 — 예비 공조기나 다른 층 연결이 필요합니다.', { level: lid, kind: intended ? null : '공조 정지 층' }); continue; }
    const oaOK = ah.some(e => [...seg.values()].some(x => x.sys === 'OA' && x.state === 'run' && x.it.level.id === lid) || items.some(i => i.id === e.el.id && i.sys === 'OA' && comps[comp.get(i.key)].some(j => j.kind === 'equip' && j.src && !off.has(j.id))));
    const eaOK = ah.some(e => items.some(i => i.id === e.el.id && i.sys === 'EA' && comps[comp.get(i.key)].some(j => j.kind === 'equip' && j.src && !off.has(j.id))));
    const saOK = segArr.some(x => x.sys === 'SA' && x.it.level.id === lid && x.state === 'run');
    chk('환기·공조', `${z.level.name} 외기 공급`, oaOK ? `${fmt0(z.oa)}m³/h (${fmt0(z.occ)}인)` : '외기 경로 없음', `${SIM.oaPerson}m³/h·인`, oaOK && eaOK ? 'ok' : 'fail', `재실 ${fmt0(z.occ)}인 × ${SIM.oaPerson}m³/h — 건축물의 설비기준 등에 관한 규칙 별표 1의6.` + (eaOK ? '' : ' 배기(EA) 경로가 없어 외기를 넣을 수 없습니다.'), { level: lid, grp: 'oa', hide: oaOK && eaOK, kind: oaOK && eaOK ? null : '외기 공급 불가 층' });
    if (!saOK) chk('환기·공조', `${z.level.name} 급기`, '급기 덕트 미가동', `${fmt0(z.sa)}m³/h`, 'fail', '공조기에서 급기 덕트로 이어지는 경로가 없습니다.', { level: lid, kind: '급기 불가 층' });
  }
  if (chillers.length) {
    const capOn = chOn.reduce((s, e) => s + (e.cap?.kW || chUnit), 0), r = plantCool ? capOn / plantCool : 1;
    chk('환기·공조', '냉동기 용량', `${fmt0(capOn / 3.517)}RT 운전 / 부하 ${fmt0(plantCool / 3.517)}RT`, '부하 이상', r >= 1 ? 'ok' : r >= 0.9 ? 'warn' : 'fail', `냉방부하 = Σ(층 면적 × 용도별 W/m²) × 동시부하율 ${SIM.div}. ${chAuto ? '태그에 용량이 없어 부하 기준으로 자동 산정했습니다.' : '용량은 장비 태그 기준.'}` + (r < 1 ? ` 부족률 ${fmt0((1 - r) * 100)}% — 일부 층 실내온도 상승.` : ''));
    if (cts.length) { const capC = ctOn.reduce((s, e) => s + e._cap, 0), rc = rej ? capC / rej : 1; chk('환기·공조', '냉각탑 방열', `${fmt0(capC)}kW / 필요 ${fmt0(rej)}kW`, '필요 이상', rc >= 1 ? 'ok' : rc >= 0.9 ? 'warn' : 'fail', `방열량 = 냉동능력 × (1 + 1/COP ${SIM.cop}).`); }
    else chk('환기·공조', '냉각탑', '없음', '-', 'warn', '냉동기는 있으나 냉각탑(방열 장비)이 없습니다.');
  } else if (hasAhu && coolTot > 0) chk('환기·공조', '열원 설비', '냉동기 없음', '-', 'warn', '공조기는 있으나 냉수를 만드는 냉동기가 모델에 없습니다.');
  // 2) 구간 유속 (계통별 집계)
  for (const g of SIM_GROUPS) {
    const xs = segArr.filter(x => g[2].includes(x.sys) && x.v > 0); if (!xs.length) continue;
    const bad = xs.filter(x => x.lv === 'fail'), warn = xs.filter(x => x.lv === 'warn'), top = xs.reduce((a, b) => b.v / b.lim[1] > a.v / a.lim[1] ? b : a);
    const cat = g[0] === 'fp' ? '소방' : ['cw', 'sd'].includes(g[0]) ? '급배수' : '환기·공조';
    chk(cat, `${g[1]} 구간 유속`, `최대 ${fmt(top.v, 1)}m/s (${top.it.level.name} ${top.it.kind === 'riser' ? '입상' : top.branch ? '분기' : '주관'})`, `${top.lim[0]}/${top.lim[1]}m/s`, bad.length ? 'fail' : warn.length ? 'warn' : 'ok',
      `${xs.length}개 구간 중 초과 ${bad.length}·주의 ${warn.length}. ${DUCT_SYS.has(top.sys) ? '덕트 주관 10/15, 분기 6/9m/s(소음·저속덕트 기준)' : g[0] === 'fp' ? 'NFTC 103 2.5: 가지배관 6m/s, 그 밖 10m/s 이하' : '배관 50A 이하 1.5/2.0, 150A 이하 2.4/3.0, 그 이상 3.0/3.5m/s(침식·소음)'}.`, { rows: [...bad, ...warn].sort((a, b) => b.v / b.lim[1] - a.v / a.lim[1]).slice(0, 40), grp: g[0] });
  }
  // 3) 연결 (소스 없는 계통)
  for (const g of SIM_GROUPS) {
    const xs = segArr.filter(x => g[2].includes(x.sys)); if (!xs.length) continue;
    const dead = xs.filter(x => x.state === 'off'); if (!dead.length) continue;
    const intended = sc.type !== 'normal', expected = sc.type === 'blackout'; const lvls = [...new Set(dead.map(x => x.it.level.name))];
    const cat = g[0] === 'fp' ? '소방' : g[0] === 'el' ? '전력' : ['cw', 'sd'].includes(g[0]) ? '급배수' : '환기·공조';
    chk(cat, `${g[1]} 미가동 구간`, `${dead.length}개 구간 (${lvls.slice(0, 4).join(', ')}${lvls.length > 4 ? ` 외 ${lvls.length - 4}개 층` : ''})`, '0', dead.some(x => x.lv === 'fail') ? 'fail' : expected ? 'info' : intended ? 'warn' : 'fail', dead.some(x => x.lv === 'fail') ? '공급 장비(소스)에 연결되지 않은 구간입니다 — 작도에서 끝점 연결·계통명을 확인하세요.' : '공급 장비가 정지되어 흐름이 없는 구간입니다.', { rows: dead.slice(0, 40), grp: g[0] });
  }
  // 4) 급배수
  const tanks = typeOf('tank'), occTot = [...zones.values()].reduce((s, z) => s + z.occ, 0), dayM3 = occTot * SIM.waterDay / 1000;
  if (tanks.length && occTot) { const cap = tanks.reduce((s, e) => s + (e.cap?.m3 || 0), 0); for (const e of tanks) { e.capTxt = e.cap?.label || '-'; e.state = '운전'; e.ratio = cap ? dayM3 * 0.5 / cap : 0; } chk('급배수', '저수조 용량', `${fmt0(cap)}톤 / 1일 사용 ${fmt0(dayM3)}톤`, '1일 사용량의 40~60%', cap >= dayM3 * 0.4 ? 'ok' : cap ? 'warn' : 'warn', `재실 ${fmt0(occTot)}인 × ${SIM.waterDay}L/인·일. 저수조는 보통 1일 사용량의 절반 내외.`); }
  if (segArr.some(x => x.sys === 'CW') && sc.type === 'blackout') chk('급배수', '정전 시 급수', '부스터펌프 정지', '-', 'warn', '정전 중 급수는 고가수조·저수조 잔량에 의존합니다.');
  // 5) 소방
  const fpSegs = segArr.filter(x => x.sys === 'FP'), fpPumps = typeOf('pump').filter(e => sysKey(e.el.sys) === 'FP' || sysKey(e.el.src) === 'FP');
  if (!fpSegs.length && !heads.length && !fpPumps.length) chk('소방', '소화설비', '모델에 없음', '스프링클러·소화펌프·소화배관', zones.size ? (sc.type === 'fire' ? 'fail' : 'warn') : 'info', zones.size ? '소방 계통(FP 배관·헤드·소화펌프)이 모델에 없어 화재 시 작동을 확인할 수 없습니다. 스프링클러 탭에서 헤드를 배치하고, 작도에서 FP 배관과 소화펌프(sys·src=FP)를 그리세요.' : '층 정보(실·슬래브)가 없습니다.');
  if (fpSegs.length || heads.length) {
    const lvNoHead = [...zones.values()].filter(z => fpSegs.some(x => x.it.level.id === z.level.id) && !headsOn(z.level.id));
    chk('소방', '스프링클러 헤드', heads.length ? `${heads.length}개` : '배치 없음', '소화배관이 있는 층 전부', lvNoHead.length ? (sc.type === 'fire' && lvNoHead.some(z => z.level.id === fireLv?.id) ? 'fail' : 'warn') : 'ok', lvNoHead.length ? `헤드가 없는 층 ${lvNoHead.length}개 (${lvNoHead.slice(0, 4).map(z => z.level.name).join(', ')}…) — 스프링클러 탭에서 자동 배치하세요(실 정의 필요).` : '소화배관이 있는 모든 층에 헤드가 있습니다.');
    if (!fpPumps.length) chk('소방', '소화펌프', '없음', '-', 'fail', '소화배관에 가압송수장치(소화펌프)가 연결되어 있지 않습니다.');
    if (fpRec) {
      const pr = fpPumps[0], Hrate = pr?.design ? pr.design.H : 0, atHead = Hrate - fpRec.static - fpRec.loss;
      chk('소방', `소화펌프 양정 (${fpRec.far.level.name} 최원단)`, `필요 ${fmt(fpRec.static + fpRec.loss + SIM.hdMin, 2)}MPa`, `낙차 ${fmt(fpRec.static, 2)} + 마찰 ${fmt(fpRec.loss, 3)} + 방수압 ${SIM.hdMin}`, 'ok', `NFTC 103 2.3: 양정 ≥ 낙차 + 배관 마찰손실(Hazen-Williams C=${SIM.C}, 부속 ${Math.round((SIM.fit - 1) * 100)}% 가산, 경로 ${fmt0(fpRec.len)}m) + 0.1MPa. 정격 ${fmt(Hrate, 2)}MPa(여유 10%)로 자동 산정. 최원단 방수압 ${fmt(atHead, 2)}MPa.`);
      const lowZ = Math.min(...fpSegs.map(x => elevZ(x.it))), hiP = Hrate - Math.max(0, (lowZ - elevZ(fpRec.pump)) / 1e5);
      chk('소방', '최저층 헤드 방수압', `${fmt(hiP, 2)}MPa`, `${SIM.hdMin}~${SIM.hdMax}MPa`, hiP > SIM.hdMax ? 'warn' : 'ok', hiP > SIM.hdMax ? `고층 건물이라 저층부 방수압이 ${SIM.hdMax}MPa를 넘습니다 — 감압밸브 또는 고·저층 구역 분리 송수가 필요합니다 (NFTC 103 2.1.1.10).` : '방수압 범위 이내.');
      if (sc.type === 'fire') { const reach = fpSegs.some(x => x.it.level.id === fireLv.id && x.state === 'run'); chk('소방', `${fireLv.name} 화재층 방수`, reach ? `${fmt0(fireFlow(fireLv.id))}L/min (${Math.min(Nfire, headsOn(fireLv.id) || Nfire)}개 헤드)` : '화재층에 물이 닿지 않음', `기준개수 ${Nfire} × 80L/min`, reach && fpPumps.some(run) ? 'ok' : 'fail', reach ? 'NFTC 103 2.1.1: 기준개수 헤드 동시 방수.' : '소화펌프 → 화재층 배관 경로가 끊겼거나 펌프가 정지했습니다.', { level: fireLv.id }); }
    }
    if (sc.type === 'blackout' && fpPumps.length) chk('소방', '정전 시 소화펌프 전원', genLinked.length ? '비상발전기 공급' : '전원 없음', '비상전원 확보', genLinked.length ? 'ok' : 'fail', genLinked.length ? 'NFTC 103 2.9: 비상전원(자가발전설비) 연결.' : '비상발전기가 모델에 있지만 BUS 계통과 연결되지 않았습니다(장비의 계통에 BUS 지정 필요). 정전 시 소화펌프가 정지합니다.');
  }
  // 6) 전력
  if (trs.length || zones.size) {
    const r = trCap ? demandKVA / (trCap * (trOn / Math.max(1, trs.length))) : 0;
    if (trs.length) chk('전력', '변압기 용량', `수요 ${fmt0(demandKVA)}kVA / 운전 ${fmt0(trCap * trOn / trs.length)}kVA`, `부하율 ${SIM.trLoad * 100}% 이하`, sc.type === 'blackout' ? 'info' : r <= SIM.trLoad ? 'ok' : r <= 1 ? 'warn' : 'fail', `수요 = 조명/역률 + 전열×${SIM.dfOutlet} + 공조기·냉동기·펌프·냉각탑 동력. ${trCapTag ? '용량은 태그 기준.' : `태그에 용량이 없어 설계 수요 ${fmt0(designKVA)}kVA로 대당 ${trUnit}kVA 자동 산정.`}` + (sc.type === 'blackout' ? ' 정전 중이라 상용 부하 0.' : ''));
    else chk('전력', '수전 설비', `수요 ${fmt0(demandKVA)}kVA`, '-', 'info', '변압기가 모델에 없어 건물 수요만 산정했습니다.');
    if (gens.length) { const g = gens[0]; chk('전력', '비상발전기', genLinked.length ? `${g.capTxt}` : 'BUS 계통 미연결', `비상부하 ${fmt0(emKW / SIM.pf)}kVA`, genLinked.length ? (g._cap >= emKW / SIM.pf ? 'ok' : 'fail') : (sc.type === 'blackout' ? 'fail' : 'warn'), genLinked.length ? `비상부하 = 소화펌프 + 비상조명(조명의 ${SIM.emLight * 100}%). 기동 용량을 고려해 1.5배로 산정.` : '발전기 장비에 계통(sys) BUS가 지정되지 않아 수배전반과 연결되지 않습니다. 작도에서 장비 속성 sys에 BUS를 넣고 간선을 연결하세요.'); }
    else if (fpPumps.length) chk('전력', '비상발전기', '없음', '소방 비상전원', sc.type === 'blackout' ? 'fail' : 'warn', '소화펌프의 비상전원(NFTC 103 2.9)이 필요합니다.');
    const pnl = typeOf('panel'); const pnlDead = pnl.filter(e => e.el.need && !items.some(i => i.id === e.el.id && i.sys === 'BUS' && comps[comp.get(i.key)].some(j => j.kind === 'equip' && j.src && !off.has(j.id))));
    if (pnl.length) chk('전력', '층 분전반 수전', pnlDead.length ? `${pnlDead.length}면 무전원` : `${pnl.length}면 정상`, '전 분전반 수전', pnlDead.length ? (sc.type === 'blackout' ? 'info' : 'fail') : 'ok', pnlDead.length ? (sc.type === 'blackout' ? '정전 — 비상부하 외 분전반은 정전 상태가 정상입니다.' : '간선(BUS)이 닿지 않는 분전반이 있습니다.') : '모든 분전반이 간선에 연결되어 있습니다.');
    for (const e of pnl) { const z = zones.get(e.level.id); e.load = z && !pnlDead.includes(e) ? zoneKVA(z) : 0; e.capTxt = '-'; if (pnlDead.includes(e) && e.state === '운전') { e.state = '무전원'; } }
  }

  // ---- 층별 같은 종류 판정 묶기 (3개 층 넘으면 한 줄) ----
  const kinds = new Map(); for (const c of checks) if (c.kind) { if (!kinds.has(c.kind)) kinds.set(c.kind, []); kinds.get(c.kind).push(c); }
  for (const [k, cs] of kinds) if (cs.length > 3) {
    for (const c of cs) c.hide = true;
    const names = cs.map(c => P.levels.find(l => l.id === c.level)?.name);
    checks.push({ cat: cs[0].cat, item: k, value: `${cs.length}개 층 (${names.slice(0, 5).join(', ')}${names.length > 5 ? ' …' : ''})`, limit: cs[0].limit, lv: cs.reduce((a, c) => worst(a, c.lv), 'ok'), basis: cs[0].basis, floorRows: cs, grp: cs[0].grp });
  }
  // 정상 운전 대비 새로 생긴 문제 표시
  if (sc.type !== 'normal' && !sc._base) {
    const B = mepSim(P, { type: 'normal', _base: true }); const before = new Map(B.checks.map(c => [c.item.replace(/^\S+F /, ''), c.lv]));
    for (const c of checks) { const b = before.get(c.item.replace(/^\S+F /, '')); c.isNew = (RANK[c.lv] || 0) > (RANK[b] || 0); }
  }

  // ---- 층 × 계통 상태 ----
  const floors = lvSorted.map(L => {
    const cell = {}; for (const g of SIM_GROUPS) { const xs = segArr.filter(x => x.it.level.id === L.id && g[2].includes(x.sys)); if (!xs.length) continue; let lv = 'ok'; for (const x of xs) lv = worst(lv, x.state === 'off' ? (x.lv === 'fail' ? 'fail' : 'off') : x.lv); if (lv === 'ok' && xs.every(x => x.state !== 'run')) lv = xs.some(x => x.state === 'idle') ? 'idle' : 'off'; cell[g[0]] = lv; }
    for (const c of checks) if (c.level === L.id && c.lv !== 'ok') { const k = c.grp || 'air'; cell[k] = worst(cell[k] || 'ok', c.lv === 'info' ? 'ok' : c.lv); }
    return { level: L, cell, zone: zones.get(L.id), fire: fireLv?.id === L.id };
  }).filter(f => Object.keys(f.cell).length || f.zone);

  // ---- 동작 순서 ----
  const nm = (t) => typeOf(t).filter(run).map(e => e.name).slice(0, 3).join(', ');
  if (sc.type === 'normal') {
    let t = 0;
    if (trs.length) ev(t, `수전 — 변압기 ${trs.length}대 투입, 수요 ${fmt0(demandKVA)}kVA`);
    if (cts.length) ev(t += 30, `냉각탑 팬·냉각수 순환 기동 (${nm('ctower')})`);
    if (chillers.length) ev(t += 30, `냉수 펌프 기동 → 냉동기 ${chOn.length}대 운전 (${nm('chiller')}), 냉방부하 ${fmt0(plantCool / 3.517)}RT`);
    if (hasAhu) ev(t += 120, `공조기 ${typeOf('ahu').filter(run).length}대 기동 — 외기 ${fmt0([...zones.values()].reduce((s, z) => s + z.oa, 0))}m³/h 도입`);
    if (typeOf('pump').some(e => sysKey(e.el.sys) === 'CW')) ev(t += 10, '급수 부스터펌프 압력 제어 운전');
    if (fpPumps.length) ev(t, `소화펌프 자동 대기 (설정압 유지)`);
    if (!events.length) ev(0, '가동할 설비 장비가 모델에 없습니다 — 계통 집계 탭에서 연결 상태를 먼저 확인하세요.', 'warn');
  } else if (sc.type === 'fire') {
    ev(0, `${fireLv.name} 화재 감지 (감지기 동작) → 수신기 경보, 비상방송`, 'warn');
    if (typeOf('ahu').some(e => e.level.id === fireLv.id)) ev(5, `${fireLv.name} 공조기 정지·방화댐퍼 폐쇄 (연기 확산 방지)`);
    ev(60, headsOn(fireLv.id) ? `헤드 개방 (표시온도 72℃ 가정) — ${Math.min(Nfire, headsOn(fireLv.id))}개 × 80L/min` : `${fireLv.name}에 헤드가 없음 — 기준개수 ${Nfire}개 방수를 가정해 배관·펌프만 검토`, headsOn(fireLv.id) ? 'info' : 'fail');
    if (fpPumps.length) ev(65, `배관 압력 저하 → ${fpPumps[0].name} 자동 기동 (${fmt0(Nfire * 80)}L/min)`, fpPumps.some(run) ? 'info' : 'fail'); else ev(65, '소화펌프 없음 — 방수 불가', 'fail');
    const fc = checks.find(c => c.item.includes('화재층 방수')); if (fc) ev(70, `${fireLv.name} 방수 ${fc.lv === 'ok' ? '개시' : '실패'} — ${fc.value}`, fc.lv);
    ev(1200, `방수 ${fd.min}분 지속 시 수원 ${fmt(Nfire * 80 * fd.min / 1000, 1)}m³ 소요`);
  } else if (sc.type === 'blackout') {
    ev(0, '상용전원 정전 — 공조·냉동기·급수펌프·일반 조명 정지', 'warn');
    if (gens.length) ev(10, genLinked.length ? `${gens[0].name} 기동·전압 확립 → 비상부하 ${fmt0(emKW / SIM.pf)}kVA 공급` : `${gens[0].name} 기동했으나 BUS 계통 미연결 — 공급 불가`, genLinked.length ? 'info' : 'fail');
    else ev(10, '비상발전기 없음 — 비상부하 공급 불가', 'fail');
    if (fpPumps.length) ev(15, `${fpPumps[0].name} ${genLinked.length ? '비상전원으로 대기 유지' : '전원 상실 — 화재 시 방수 불가'}`, genLinked.length ? 'info' : 'fail');
    ev(15, `비상조명 ${fmt(([...zones.values()].reduce((s, z) => s + z.lightKW, 0)) * SIM.emLight, 1)}kW ${genLinked.length ? '점등' : '(내장 배터리 의존)'}`);
  } else if (sc.type === 'fault') {
    const e = eqById.get(sc.equip);
    if (e) { ev(0, `${e.name} 정지`, 'warn'); const aff = checks.filter(c => c.isNew && !c.hide && (c.lv === 'fail' || c.lv === 'warn')).slice(0, 5); for (const c of aff) ev(5, `영향: ${c.item} — ${c.value}`, c.lv); if (!aff.length) ev(5, '나머지 장비가 부하를 나눠 받아 정상 운전 대비 새로 생긴 문제 없음', 'ok'); }
    else ev(0, '정지할 장비를 고르세요.', 'warn');
  }

  let verdict = 'ok'; for (const c of checks) verdict = worst(verdict, c.lv === 'info' ? 'ok' : c.lv);
  return { sc, fireLv, zones, equips, checks, events, seg, floors, verdict, totals: { coolKW: plantCool, demandKVA, trCap, emKW, Nfire, heads: heads.length }, off };
}
