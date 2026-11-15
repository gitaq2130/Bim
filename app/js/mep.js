// 설비·전기 계통 연결 해석 — 덕트·배관·트레이·라이저·장비를 계통별로 묶고, 소스(장비)까지 이어지는지 판정
import { allElements, elBoxes, boxCorners } from './model.js';

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

export function mepNetwork(P) {
  const lv = [...P.levels].sort((a, b) => a.elev - b.elev); const li = Object.fromEntries(lv.map((l, i) => [l.id, i]));
  const items = []; // {key, id, sys, kind, L, el, level, sheet}
  for (const r of allElements(P)) {
    const el = r.el, L = li[r.level.id];
    if (['duct', 'pipe', 'tray', 'riser'].includes(el.k)) { const k = sysKey(el.sys) || (el.k === 'tray' ? 'ELEC' : ''); if (k) items.push({ key: el.id + '|' + k, id: el.id, sys: k, kind: el.k, L, el, level: r.level, sheet: r.sheet }); }
    else if (el.k === 'furn' && (el.sys || el.src)) { for (const k of new Set([...sysList(el.sys), ...sysList(el.src)])) items.push({ key: el.id + '|' + k, id: el.id, sys: k, kind: 'equip', L, el, level: r.level, sheet: r.sheet, box: elBoxes(el, r.level)[0], src: sysList(el.src).includes(k) }); }
  }
  const par = new Map(items.map(it => [it.key, it.key])); const find = (k) => { while (par.get(k) !== k) { par.set(k, par.get(par.get(k))); k = par.get(k); } return k; }; const join = (a, b) => { a = find(a); b = find(b); if (a !== b) par.set(a, b); };
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
