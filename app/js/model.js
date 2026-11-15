import { furnName } from './furn.js';
// 빌더 데이터 모델: 프로젝트·시트·객체·물량·기성
import { bbs, specOf } from './rebar.js';
import { uid, sub, add, mul, norm, perp, len, dist, angOf, rot, polyArea, polyPerim, deep } from './util.js';

export const DISC = {
  A: { name: '건축', color: '#7aa2f7' },
  S: { name: '구조', color: '#e0af68' },
  M: { name: '기계', color: '#9ece6a' },
  E: { name: '전기', color: '#f7768e' },
  P: { name: '배관(위생)', color: '#7dcfff' },
  F: { name: '소방', color: '#ff7a45' },
  I: { name: '인테리어', color: '#d4a5ff' },
  C: { name: '토목', color: '#c9a36a' },
  L: { name: '조경', color: '#6cc070' },
};

// 객체 종류 정의
export const KINDS = {
  wall:    { name: '벽체', disc: 'A', geom: 'line', def: { t: 200, mat: 'RC' } },
  column:  { name: '기둥', disc: 'S', geom: 'point', def: { w: 600, d: 600, rot: 0, mat: 'RC' } },
  beam:    { name: '보', disc: 'S', geom: 'line', def: { w: 400, d: 700, mat: 'RC' } },
  slab:    { name: '슬래브', disc: 'S', geom: 'poly', def: { t: 200, mat: 'RC' } },
  footing: { name: '기초', disc: 'S', geom: 'point', def: { w: 2400, d: 2400, t: 800, mat: 'RC' } },
  opening: { name: '개구부', disc: 'A', geom: 'host', def: { w: 900, h: 2100, sill: 0, kind: 'door' } },
  duct:    { name: '덕트', disc: 'M', geom: 'line', def: { w: 800, hh: 400, z: 3000, sys: '급기' } },
  pipe:    { name: '배관', disc: 'P', geom: 'line', def: { w: 150, hh: 150, z: 3200, sys: '급수' } },
  tray:    { name: '케이블트레이', disc: 'E', geom: 'line', def: { w: 600, hh: 100, z: 2900, sys: '동력' } },
  riser:   { name: '수직 샤프트(라이저)', disc: 'M', geom: 'point', def: { w: 150, hh: 150, sys: 'CHWS', form: 'pipe' } },
  fin:     { name: '외장 핀', disc: 'A', geom: 'point', def: { w: 120, d: 500, rot: 0 } },
  furn:    { name: '가구·조경', disc: 'A', geom: 'point', def: { type: 'sofa', w: 2400, d: 950, h: 820, rot: 0 } },
  // Core 1.1.0 — MEP·인테리어 트랙용
  sprinkler: { name: '스프링클러 헤드', disc: 'F', geom: 'point', def: { type: 'pendent', kf: 80, z: 2700, w: 80, hh: 60 } },
  panel:   { name: '분전반', disc: 'E', geom: 'point', def: { w: 600, d: 250, h: 1800, z0: 0, sys: '전등', kw: 0, rot: 0 } },
  light:   { name: '조명기구', disc: 'I', geom: 'point', def: { type: 'LED 평판', w: 600, d: 600, hh: 50, z: 2700, watt: 40, lm: 4400, circuit: '' } },
  ceiling: { name: '천장', disc: 'I', geom: 'poly', def: { z: 2700, t: 20, fin: '석고보드+도장' } },
  room:    { name: '실', disc: 'I', geom: 'poly', def: { name: '실', use: '사무실', lux: 500, h: 2700 } },
};
export const MATS = {
  RC: { name: '철근콘크리트', color: '#b9b9b4' },
  CMU: { name: '조적(시멘트벽돌)', color: '#c9a27e' },
  STEEL: { name: '철골', color: '#6f7d8c' },
  GLASS: { name: '유리커튼월', color: '#8fd3ff' },
  DRY: { name: '경량벽체', color: '#e6e1d6' },
  SRC: { name: 'SRC(철골철근콘크리트)', color: '#a9a49a' },
  PC: { name: 'PC(프리캐스트 콘크리트)', color: '#c7c2b6' },
};
// H형강 단위중량(kg/m) — KS D 3502 대표 규격
export const SECTIONS = {
  'H-400x400x13x21': { h: 400, b: 400, kgm: 172 },
  'H-500x200x10x16': { h: 500, b: 200, kgm: 89.6 },
  'H-600x300x12x20': { h: 600, b: 300, kgm: 151 },
  'H-700x300x13x24': { h: 700, b: 300, kgm: 185 },
  'H-200x100x5.5x8': { h: 200, b: 100, kgm: 20.9 },
  'H-250x125x6x9': { h: 250, b: 125, kgm: 29.0 },
  'H-300x150x6.5x9': { h: 300, b: 150, kgm: 36.7 },
  'H-350x175x7x11': { h: 350, b: 175, kgm: 49.4 },
  'H-400x200x8x13': { h: 400, b: 200, kgm: 65.4 },
  'H-450x200x9x14': { h: 450, b: 200, kgm: 74.9 },
  'H-500x200x10x16': { h: 500, b: 200, kgm: 88.2 },
  'H-600x200x11x17': { h: 600, b: 200, kgm: 103.4 },
  'H-300x300x10x15': { h: 300, b: 300, kgm: 93.0 },
  'H-400x400x13x21': { h: 400, b: 400, kgm: 168.0 },
  'H-350x350x12x19': { h: 350, b: 350, kgm: 137 }, 'H-414x405x18x28': { h: 414, b: 405, kgm: 232 }, 'H-428x407x20x35': { h: 428, b: 407, kgm: 283 },
  'H-458x417x30x50': { h: 458, b: 417, kgm: 415 }, 'H-498x432x45x70': { h: 498, b: 432, kgm: 605 },
  'H-800x300x14x26': { h: 800, b: 300, kgm: 210 }, 'H-900x300x16x28': { h: 900, b: 300, kgm: 243 },
};
// 부재별 철근 비율(kg/m³) 기본값 — 개산용, 객체별 rr 속성으로 덮어씀
export const REBAR_RATIO = { footing: 100, slab: 110, wall: 90, column: 180, beam: 160 };

export const DEFAULT_BOQ = [
  { code: 'CON', name: '레미콘 25-24-150', unit: 'm³', price: 95000 },
  { code: 'FRM', name: '거푸집(유로폼)', unit: 'm²', price: 28000 },
  { code: 'RBR', name: '철근 가공·조립 SD400', unit: 'ton', price: 950000 },
  { code: 'STL', name: '철골 제작·설치', unit: 'ton', price: 2800000 },
  { code: 'CMU', name: '시멘트벽돌 쌓기 1.0B', unit: 'm²', price: 45000 },
  { code: 'DRY', name: '경량벽체(스터드)', unit: 'm²', price: 38000 },
  { code: 'GLZ', name: '유리 커튼월', unit: 'm²', price: 320000 },
  { code: 'DOR', name: '문(틀·문짝)', unit: 'EA', price: 450000 },
  { code: 'WIN', name: '창호', unit: 'm²', price: 180000 },
  { code: 'DCT', name: '덕트 설치', unit: 'm', price: 65000 },
  { code: 'PIP', name: '배관 설치', unit: 'm', price: 42000 },
  { code: 'TRY', name: '케이블트레이 설치', unit: 'm', price: 55000 },
  { code: 'FIN', name: '외장 알루미늄 핀', unit: 'm', price: 120000 },
  { code: 'SPK', name: '스프링클러 헤드 설치', unit: 'EA', price: 35000 },
  { code: 'PNL', name: '분전반 설치', unit: 'EA', price: 1200000 },
  { code: 'LGT', name: '조명기구 설치', unit: 'EA', price: 85000 },
  { code: 'CLG', name: '천장 마감', unit: 'm²', price: 42000 },
];

export function newProject(name = '새 프로젝트') {
  const L1 = { id: 'L1', name: '1F', elev: 0, height: 4000 };
  const s1 = { id: uid('s'), name: 'A-101 1층 평면도', disc: 'A', level: 'L1' };
  return {
    id: uid('p'), name, v: 1, created: Date.now(), updated: Date.now(),
    site: { lat: 37.5665, lng: 126.978, tz: 9, north: 0, address: '' },
    base: { x: 0, y: 0 },
    levels: [L1],
    sheets: [s1],
    boq: deep(DEFAULT_BOQ),
    bill: { periods: [] },
    clash: { status: {}, tol: 0, clearance: 50 },
    check: { status: {} },
    view: { mats: {} },
    content: { [s1.id]: { ents: [], els: [] } },
  };
}

// ---------- 조회 도우미 ----------
export const levelOf = (P, id) => P.levels.find(l => l.id === id) || P.levels[0];
export const sheetOf = (P, id) => P.sheets.find(s => s.id === id);
export function allElements(P, filter) {
  const out = [];
  for (const s of P.sheets) {
    const c = P.content[s.id]; if (!c) continue;
    for (const e of c.els) { const r = { el: e, sheet: s, level: levelOf(P, s.level) }; if (!filter || filter(r)) out.push(r); }
  }
  return out;
}
export function findElement(P, id) {
  for (const s of P.sheets) { const c = P.content[s.id]; const e = c?.els.find(x => x.id === id); if (e) return { el: e, sheet: s, level: levelOf(P, s.level) }; }
  return null;
}
export function elDisc(r) { return r.sheet.disc || KINDS[r.el.k]?.disc || 'A'; }
export function elName(el) {
  if (el.k === 'riser') return `라이저 ${el.sys || ''} ${el.form === 'pipe' ? 'Ø' + el.w : el.w + '×' + el.hh}`;
  if (el.k === 'fin') return `외장 핀 ${el.w}×${el.d}`;
  if (el.k === 'furn') return furnName(el) + (el.room ? ` (${el.room})` : '');
  if (el.k === 'manual') return `수동산출 ${el.tag || ''}`;
  if (el.k === 'sprinkler') return `스프링클러 헤드 ${el.type || ''} K${el.kf ?? ''}`;
  if (el.k === 'panel') return `분전반 ${el.sys || ''} ${el.w}×${el.h}`;
  if (el.k === 'light') return `조명 ${el.type || ''} ${el.watt ?? ''}W`;
  if (el.k === 'ceiling') return `천장 ${el.fin || ''}`;
  if (el.k === 'room') return `실 ${el.name || ''}${el.use ? ` (${el.use})` : ''}`;
  const k = KINDS[el.k]?.name || el.k;
  if (el.k === 'opening') return (el.kind === 'window' ? '창' : '문') + ` ${el.w}×${el.h}`;
  if (el.sec) return `${k} ${el.sec}`;
  if (el.k === 'wall') return `${k} ${MATS[el.mat]?.name || el.mat} ${el.t}`;
  if (el.k === 'column' || el.k === 'footing') return `${k} ${el.w}×${el.d}`;
  if (el.k === 'beam') return `${k} ${el.w}×${el.d}`;
  if (el.k === 'slab') return `${k} t${el.t}`;
  if (['duct', 'pipe', 'tray'].includes(el.k)) return `${k} ${el.sys || ''} ${el.k === 'pipe' ? 'Ø' + el.w : el.w + '×' + el.hh}`;
  return k;
}
export const tagOf = (el) => el.tag || elName(el);

// 높이 정보
export function elHeight(el, lv) { return el.h ?? lv.height; }
export function sizeOfSteel(el) { return SECTIONS[el.sec] || null; }

// ---------- 3D 박스 (OBB) ----------
// 반환: [{cx,cy,hl,hw,ang,z0,z1, part}] (mm, 절대 표고)
export function elBoxes(el, lv, hostLookup) {
  const E = lv.elev, H = lv.height;
  const box = (a, b, w, z0, z1, part) => {
    const c = mul(add(a, b), 0.5), L = dist(a, b);
    return { cx: c[0], cy: c[1], hl: L / 2, hw: w / 2, ang: angOf(a, b), z0, z1, part };
  };
  switch (el.k) {
    case 'wall': { const h = elHeight(el, lv); return [box(el.a, el.b, el.t, E + (el.z0 || 0), E + (el.z0 || 0) + h)]; }
    case 'column': {
      const st = el.mat === 'STEEL' ? sizeOfSteel(el) : null; const w = st ? st.b : el.w, d = st ? st.h : el.d;
      return [{ cx: el.p[0], cy: el.p[1], hl: w / 2, hw: d / 2, ang: (el.rot || 0) * Math.PI / 180, z0: E, z1: E + elHeight(el, lv) }];
    }
    case 'beam': {
      const st = el.mat === 'STEEL' ? sizeOfSteel(el) : null; const w = st ? st.b : el.w, d = st ? st.h : el.d;
      const top = E + H + (el.dz || 0); return [box(el.a, el.b, w, top - d, top)];
    }
    case 'slab': {
      const xs = el.pts.map(p => p[0]), ys = el.pts.map(p => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const top = E + (el.dz || 0);
      return [{ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hl: (x1 - x0) / 2, hw: (y1 - y0) / 2, ang: 0, z0: top - el.t, z1: top, poly: el.pts }];
    }
    case 'footing': return [{ cx: el.p[0], cy: el.p[1], hl: el.w / 2, hw: el.d / 2, ang: 0, z0: E - el.t, z1: E }];
    case 'riser': return [{ cx: el.p[0], cy: el.p[1], hl: el.w / 2, hw: (el.form === 'pipe' ? el.w : el.hh) / 2, ang: 0, z0: E, z1: E + H }];
    case 'fin': return [{ cx: el.p[0], cy: el.p[1], hl: el.d / 2, hw: el.w / 2, ang: (el.rot || 0) * Math.PI / 180, z0: E + (el.z0 || 0), z1: E + (el.h ?? H) }];
    case 'furn': return [{ cx: el.p[0], cy: el.p[1], hl: el.w / 2, hw: el.d / 2, ang: (el.rot || 0) * Math.PI / 180, z0: E + (el.z0 || 0), z1: E + (el.z0 || 0) + el.h }];
    case 'opening': {
      const host = hostLookup?.(el.host); if (!host) return [];
      const dir = norm(sub(host.b, host.a)); const a = add(host.a, mul(dir, el.s)); const b = add(a, mul(dir, el.w));
      const z0 = E + (el.sill || 0); return [box(a, b, (host.t || 200) + 20, z0, z0 + el.h, 'void')];
    }
    case 'duct': case 'pipe': case 'tray': {
      const zc = E + (el.z ?? 3000); return [box(el.a, el.b, el.w, zc - el.hh / 2, zc + el.hh / 2)];
    }
    case 'sprinkler': { const z = E + (el.z ?? 2700); return [{ cx: el.p[0], cy: el.p[1], hl: (el.w || 80) / 2, hw: (el.w || 80) / 2, ang: 0, z0: z - (el.hh || 60), z1: z }]; }
    case 'light': { const z = E + (el.z ?? 2700); return [{ cx: el.p[0], cy: el.p[1], hl: el.w / 2, hw: el.d / 2, ang: (el.rot || 0) * Math.PI / 180, z0: z - (el.hh || 50), z1: z }]; }
    case 'panel': return [{ cx: el.p[0], cy: el.p[1], hl: el.w / 2, hw: el.d / 2, ang: (el.rot || 0) * Math.PI / 180, z0: E + (el.z0 || 0), z1: E + (el.z0 || 0) + el.h }];
    case 'ceiling': {
      const xs = el.pts.map(p => p[0]), ys = el.pts.map(p => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys); const z = E + (el.z ?? 2700);
      return [{ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hl: (x1 - x0) / 2, hw: (y1 - y0) / 2, ang: 0, z0: z, z1: z + (el.t || 20), poly: el.pts }];
    }
    case 'room': return []; // 실은 공간 정의 — 3D 박스·간섭 대상 아님
  }
  return [];
}
export function boxCorners(b) {
  const c = Math.cos(b.ang), s = Math.sin(b.ang);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [b.cx + i * b.hl * c - j * b.hw * s, b.cy + i * b.hl * s + j * b.hw * c]);
}
// 평면 외곽(2D 표현용)
export function elOutline(el, hostLookup) {
  if (el.k === 'slab' || el.k === 'ceiling' || el.k === 'room') return el.pts;
  if (el.k === 'opening') { const b = elBoxes(el, { elev: 0, height: 0 }, hostLookup)[0]; return b ? boxCorners(b) : null; }
  const b = elBoxes(el, { elev: 0, height: 4000 }, hostLookup)[0]; return b ? boxCorners(b) : null;
}

// ---------- 물량 ----------
// 객체 하나의 물량 라인 [{code, qty, desc}]
export function qtyOf(el, lv, ctx = {}) {
  const out = [], H = lv.height, push = (code, qty, desc) => { if (qty > 0) out.push({ code, qty, desc }); };
  const rr = (k) => (el.rr ?? REBAR_RATIO[k] ?? 100) / 1000; // ton/m³
  const rbr = (k, V) => {
    if (ctx.spec) { const rows = bbs(el, lv, ctx.spec, { ...ctx, deduct: ctx.beamDeduct?.[el.id] }); const t = rows.reduce((s, r) => s + r.kg, 0) / 1000; if (rows.length) return push('RBR', t, '배근상세 ' + rows.map(r => `${r.mark} ${r.n}-${r.dia}`).join(', ')); }
    push('RBR', V * rr(k), `철근비 ${el.rr ?? REBAR_RATIO[k]}kg/m³`);
  };
  const m = 1 / 1000;
  switch (el.k) {
    case 'wall': {
      const L = dist(el.a, el.b) * m, h = elHeight(el, lv) * m, t = el.t * m;
      const ops = (ctx.openings || []).filter(o => o.host === el.id);
      const opA = ops.reduce((s, o) => s + o.w * o.h * 1e-6, 0);
      const A = Math.max(0, L * h - opA);
      if (el.mat === 'RC') { const V = A * t; push('CON', V, `${L.toFixed(2)}m×${h.toFixed(2)}m×${t}m`); push('FRM', 2 * A, '양면'); rbr('wall', V); }
      else if (el.mat === 'CMU') push('CMU', A, '개구부 공제');
      else if (el.mat === 'DRY') push('DRY', A, '개구부 공제');
      else if (el.mat === 'GLASS') push('GLZ', L * h, '');
      break;
    }
    case 'column': {
      const h = elHeight(el, lv) * m;
      if (el.mat === 'STEEL') { const st = sizeOfSteel(el); if (st) push('STL', st.kgm * h / 1000, `${el.sec} ${st.kgm}kg/m`); }
      else if (el.mat === 'SRC') { const st = sizeOfSteel(el); const As = st ? st.kgm / 7850 : 0; const V = (el.w * el.d * 1e-6 - As) * h; push('CON', V, 'SRC 콘크리트(철골 공제)'); push('FRM', 2 * (el.w + el.d) * m * h, '4면'); rbr('column', V); if (st) push('STL', st.kgm * h / 1000, `SRC 내부 ${el.sec}`); }
      else { const V = el.w * el.d * 1e-6 * h; push('CON', V); push('FRM', 2 * (el.w + el.d) * m * h, '4면'); rbr('column', V); }
      break;
    }
    case 'beam': {
      const L = dist(el.a, el.b) * m;
      if (el.mat === 'STEEL') { const st = sizeOfSteel(el); if (st) push('STL', st.kgm * L / 1000, `${el.sec} ${st.kgm}kg/m`); }
      else {
        const ts = (ctx.slabT ?? 0) * m; const d = el.d * m - ts, w = el.w * m;
        // 기둥 내부 공제: 순길이 = 중심길이 - 양단 기둥폭/2 (ctx.clear 제공 시)
        const Lc = Math.max(0, L - (ctx.beamDeduct?.[el.id] || 0) * m);
        const V = w * d * Lc; push('CON', V, `순길이 ${Lc.toFixed(2)}m, 슬래브 겹침 ${ts}m 공제`); push('FRM', (2 * d + w) * Lc, '양측+저면'); rbr('beam', V);
      }
      break;
    }
    case 'slab': {
      const A = Math.abs(polyArea(el.pts)) * 1e-6, P = polyPerim(el.pts) * m, t = el.t * m, V = A * t;
      push('CON', V, `${A.toFixed(2)}m²×${t}m`); push('FRM', A + P * t, '저면+측면'); rbr('slab', V);
      break;
    }
    case 'footing': { const V = el.w * el.d * el.t * 1e-9; push('CON', V); push('FRM', 2 * (el.w + el.d) * el.t * 1e-6, '측면'); rbr('footing', V); break; }
    case 'opening': { if (el.kind === 'window') push('WIN', el.w * el.h * 1e-6, `${el.w}×${el.h}`); else push('DOR', 1, `${el.w}×${el.h}`); break; }
    case 'duct': push('DCT', dist(el.a, el.b) * m, `${el.w}×${el.hh}`); break;
    case 'riser': push(el.form === 'pipe' ? 'PIP' : el.form === 'tray' ? 'TRY' : 'DCT', H * m, `수직 ${el.sys || ''}`); break;
    case 'fin': push('FIN', (el.h ?? H) * m, `${el.w}×${el.d}`); break;
    case 'pipe': push('PIP', dist(el.a, el.b) * m, `Ø${el.w}`); break;
    case 'tray': push('TRY', dist(el.a, el.b) * m, `${el.w}×${el.hh}`); break;
    case 'sprinkler': push('SPK', 1, `${el.type || ''} K${el.kf ?? ''}`); break;
    case 'panel': push('PNL', 1, `${el.sys || ''}`); break;
    case 'light': push('LGT', 1, `${el.type || ''} ${el.watt ?? ''}W`); break;
    case 'ceiling': push('CLG', Math.abs(polyArea(el.pts)) * 1e-6, el.fin || ''); break;
  }
  return out;
}

// 프로젝트 전체 물량: 객체별 라인
export function takeoff(P) {
  const rows = [];
  for (const s of P.sheets) {
    const c = P.content[s.id]; if (!c) continue; const lv = levelOf(P, s.level);
    const openings = c.els.filter(e => e.k === 'opening');
    const slabs = allElements(P, r => r.el.k === 'slab');
    // 보 위 슬래브 두께: 상부 레벨 슬래브 (보 상단 = 다음 레벨 바닥)
    const upper = P.levels.filter(l => l.elev > lv.elev).sort((a, b) => a.elev - b.elev)[0];
    const slabT = upper ? (slabs.find(r => r.level.id === upper.id)?.el.t ?? 0) : 0;
    // 보 순길이 공제: 같은 시트/레벨 기둥과 접하는 끝단
    const cols = allElements(P, r => r.el.k === 'column' && r.level.id === lv.id).map(r => r.el);
    const beamDeduct = {};
    for (const e of c.els) if (e.k === 'beam') {
      let d = 0; for (const end of [e.a, e.b]) { const col = cols.find(cc => dist(cc.p, end) < 50); if (col) d += (Math.min(col.w, col.d)) / 2; }
      beamDeduct[e.id] = d;
    }
    for (const e of c.els) {
      if (isRefElement(e, s, P)) continue;
      for (const q of qtyOf(e, lv, { openings, slabT: e.k === 'beam' ? slabT : 0, beamDeduct, spec: specOf(P, e) })) rows.push({ el: e, sheet: s, level: lv, ...q });
    }
  }
  // 도면·PDF 위 수동 산출 (길이·면적·개수)
  for (const t of P.takeoffs || []) {
    if (!t.code) continue; const s = P.sheets.find(x => x.id === t.sheet); if (!s) continue; const q = manualQty(t);
    if (q.qty > 0) rows.push({ el: { id: t.id, k: 'manual', tag: t.name, manual: true }, sheet: s, level: levelOf(P, s.level), code: t.code, qty: q.qty, desc: `수동 ${q.unit === 'EA' ? '개수' : q.unit === 'm²' ? '면적' : '길이'} ${q.raw.toFixed(2)}${q.unit}${t.mult !== 1 ? ' ×' + t.mult : ''}` });
  }
  return rows;
}
export function manualQty(t) {
  let raw = 0; const p = t.pts || [];
  if (t.type === 'len') for (let i = 1; i < p.length; i++) raw += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) / 1000;
  else if (t.type === 'area') { let a = 0; for (let i = 0; i < p.length; i++) { const j = (i + 1) % p.length; a += p[i][0] * p[j][1] - p[j][0] * p[i][1]; } raw = Math.abs(a) / 2 / 1e6; }
  else raw = p.length;
  return { raw, qty: raw * (t.mult || 1), unit: t.type === 'count' ? 'EA' : t.type === 'area' ? 'm²' : 'm' };
}
// 구조 부재가 구조 외 도면에 있으면 참조(중복 산출 방지)
export function isRefElement(e, s, P) { if (KINDS[e.k]?.disc !== 'S' || s.disc === 'S') return false; return P ? P.sheets.some(x => x.disc === 'S' && x.level === s.level) : true; }
export function sumBy(rows, keyFn) { const m = new Map(); for (const r of rows) { const k = keyFn(r); m.set(k, (m.get(k) || 0) + r.qty); } return m; }

// ---------- 기성 ----------
// 회차 p까지의 객체 누계 진척률(0~100)
export function cumProgress(P, pi) {
  const res = {}; const per = P.bill.periods;
  for (let i = 0; i <= pi && i < per.length; i++) Object.assign(res, per[i].prog || {});
  return res;
}
// 회차별 검토 결과: [{code,name,unit,price, contract, prevCum, cum, thisQty, claim, diff, diffPct, verdict}]
export function billReview(P, pi, rows = takeoff(P)) {
  const cum = cumProgress(P, pi), prev = pi > 0 ? cumProgress(P, pi - 1) : {};
  const per = P.bill.periods[pi] || {};
  const out = [];
  for (const b of P.boq) {
    let contract = 0, c = 0, pv = 0;
    for (const r of rows) if (r.code === b.code) { contract += r.qty; c += r.qty * (cum[r.el.id] || 0) / 100; pv += r.qty * (prev[r.el.id] || 0) / 100; }
    const thisQty = c - pv; const claim = per.claim?.[b.code];
    const hasClaim = claim != null && claim !== '';
    const diff = hasClaim ? claim - thisQty : null;
    const diffPct = hasClaim ? (thisQty > 1e-9 ? diff / thisQty * 100 : (claim > 0 ? Infinity : 0)) : null;
    let verdict = '-';
    if (hasClaim) verdict = Math.abs(diffPct) <= (P.bill.tolPct ?? 2) ? '적정' : diff > 0 ? '초과청구' : '과소청구';
    if (contract < 1e-9 && !hasClaim) continue;
    out.push({ ...b, contract, prevCum: pv, cum: c, thisQty, claim: hasClaim ? +claim : null, diff, diffPct, verdict });
  }
  return out;
}

// ---------- 샘플 프로젝트 ----------
export function sampleProject() {
  const P = newProject('샘플 — RC 2층 근린생활시설');
  P.site = { lat: 37.5665, lng: 126.978, tz: 9, north: 15, address: '서울 중구 (예시)' };
  P.struct = { site: { use: '근린생활(판매)', region: '서울', siteClass: 'S4', qa: 300, exp: 'B' } };
  P.levels = [
    { id: 'L1', name: '1F', elev: 0, height: 4000 },
    { id: 'L2', name: '2F', elev: 4000, height: 4000 },
    { id: 'RF', name: 'RF', elev: 8000, height: 0 },
  ];
  const X = [0, 8000, 16000, 24000], Y = [0, 8000, 16000], XL = ['1', '2', '3', '4'], YL = ['A', 'B', 'C'];
  const mk = (name, disc, level) => ({ id: uid('s'), name, disc, level });
  const A1 = mk('A-101 1층 평면도', 'A', 'L1'), A2 = mk('A-102 2층 평면도', 'A', 'L2');
  const S1 = mk('S-101 기초·1층 구조평면도', 'S', 'L1'), S2 = mk('S-102 2층 구조평면도', 'S', 'L2'), S3 = mk('S-103 지붕 구조평면도', 'S', 'RF');
  const M1 = mk('M-101 1층 공조덕트', 'M', 'L1'), E1 = mk('E-101 1층 전기트레이', 'E', 'L1'), P1 = mk('P-101 1층 배관', 'P', 'L1');
  P.sheets = [A1, A2, S1, S2, S3, M1, E1, P1];
  P.content = {}; for (const s of P.sheets) P.content[s.id] = { ents: [], els: [] };
  const E = (s, e) => { e.id = e.id || uid('e'); P.content[s.id].els.push(e); return e; };
  const G = (s, e) => { e.id = uid('g'); P.content[s.id].ents.push(e); return e; };
  const grids = (s, shiftC = 0) => {
    X.forEach((x, i) => G(s, { t: 'grid', a: [x, -3000], b: [x, 19000], label: XL[i], layer: 'GRID' }));
    Y.forEach((y, i) => G(s, { t: 'grid', a: [-3000, y + (i === 2 ? shiftC : 0)], b: [27000, y + (i === 2 ? shiftC : 0)], label: YL[i], layer: 'GRID' }));
  };
  [A1, A2, S1, S2, S3].forEach(s => grids(s, s === S2 ? 100 : 0)); // S-102의 C열 100mm 오류(정합 검토 대상)

  // 구조: 기초, 기둥, 보, 슬래브
  for (const x of X) for (const y of Y) E(S1, { k: 'footing', p: [x, y], w: 2400, d: 2400, t: 800, mat: 'RC', tag: 'F1', zone: '기초' });
  for (const [s, zone] of [[S1, '1층'], [S2, '2층']]) for (const x of X) for (const y of Y) E(s, { k: 'column', p: [x, y], w: 600, d: 600, rot: 0, mat: 'RC', tag: 'C1', zone });
  const beams = (s, zone) => {
    for (const y of Y) for (let i = 0; i < 3; i++) E(s, { k: 'beam', a: [X[i], y], b: [X[i + 1], y], w: 400, d: 700, mat: 'RC', tag: 'G1', zone });
    for (const x of X) for (let j = 0; j < 2; j++) E(s, { k: 'beam', a: [x, Y[j]], b: [x, Y[j + 1]], w: 400, d: 700, mat: 'RC', tag: 'G2', zone });
  };
  beams(S1, '1층'); beams(S2, '2층');
  // 철골 작은보 — 1층 RC 기둥 관통(철근 간섭 데모) & 받침 없는 끝단(정합 데모)
  E(S1, { k: 'beam', a: [4000, 8000], b: [4000, 16000], mat: 'STEEL', sec: 'H-400x200x8x13', w: 200, d: 400, tag: 'SB1', rel: 'both', zone: '1층' });
  E(S1, { k: 'beam', a: [16000, 4000], b: [24000, 4000], dz: -150, mat: 'STEEL', sec: 'H-300x150x6.5x9', w: 150, d: 300, tag: 'SB2', rel: 'both', zone: '1층' });
  E(S2, { k: 'beam', a: [12000, 0], b: [12000, 6500], mat: 'STEEL', sec: 'H-300x150x6.5x9', w: 150, d: 300, tag: 'SB3', zone: '2층' });
  const slab = [[-300, -300], [24300, -300], [24300, 16300], [-300, 16300]];
  E(S1, { k: 'slab', pts: deep(slab), t: 200, mat: 'RC', tag: 'S1(1층 바닥)', zone: '1층' });
  E(S2, { k: 'slab', pts: deep(slab), t: 200, mat: 'RC', tag: 'S2(2층 바닥)', zone: '2층' });
  E(S3, { k: 'slab', pts: deep(slab), t: 250, mat: 'RC', tag: 'RS(지붕)', zone: '지붕' });

  // 건축: 외벽(조적), 내벽(경량), 개구부, 기둥(건축 표기)
  for (const [s, off] of [[A1, 0], [A2, 150]]) {
    for (const x of X) for (const y of Y) E(s, { k: 'column', p: [x === 16000 && y === 8000 ? x + off : x, y], w: 600, d: 600, rot: 0, mat: 'RC', tag: 'C1', zone: s === A1 ? '1층' : '2층' }); // A-102 B3 기둥 150 오차
    const ext = [[[0, 0], [24000, 0]], [[24000, 0], [24000, 16000]], [[24000, 16000], [0, 16000]], [[0, 16000], [0, 0]]];
    const walls = ext.map(([a, b]) => E(s, { k: 'wall', a, b, t: 200, mat: s === A1 && a[1] === 0 && b[1] === 0 ? 'GLASS' : 'CMU', zone: s === A1 ? '1층' : '2층' }));
    E(s, { k: 'wall', a: [8000, 8000], b: [16000, 8000], t: 100, mat: 'DRY', zone: s === A1 ? '1층' : '2층' });
    E(s, { k: 'wall', a: [16000, 8000], b: [16000, 16000], t: 100, mat: 'DRY', zone: s === A1 ? '1층' : '2층' });
    if (s === A1) E(s, { k: 'opening', host: walls[0].id, s: 11000, w: 2000, h: 2400, sill: 0, kind: 'door', tag: 'D1' });
    else E(s, { k: 'opening', host: walls[0].id, s: 3000, w: 2400, h: 1500, sill: 900, kind: 'window', tag: 'W1' });
    for (const sx of [2500, 10500, 18500]) E(s, { k: 'opening', host: walls[2].id, s: sx, w: 3000, h: 1500, sill: 900, kind: 'window', tag: 'W2' });
    E(s, { k: 'opening', host: walls[1].id, s: 2000, w: 1800, h: 1500, sill: 900, kind: 'window', tag: 'W3' });
  }
  // 중복 벽(정합 데모)
  E(A2, { k: 'wall', a: [8000, 8000], b: [12000, 8000], t: 100, mat: 'DRY', zone: '2층' });

  // MEP — 보 하단(4000-700=3300) 기준
  E(M1, { k: 'duct', a: [2000, 4000], b: [22000, 4000], w: 1000, hh: 400, z: 3250, sys: '급기 SA-1', zone: '1층' }); // SB2·G2 간섭
  E(M1, { k: 'duct', a: [12000, 1000], b: [12000, 15000], w: 600, hh: 300, z: 2950, sys: '환기 EA-1', zone: '1층' });
  E(E1, { k: 'tray', a: [1000, 12000], b: [23000, 12000], w: 600, hh: 100, z: 2900, sys: '동력 CT-1', zone: '1층' });
  E(E1, { k: 'tray', a: [6000, 1000], b: [6000, 15000], w: 400, hh: 100, z: 3250, sys: '통신 CT-2', zone: '1층' }); // 덕트와 간섭
  E(P1, { k: 'pipe', a: [1000, 6000], b: [23000, 6000], w: 150, hh: 150, z: 3450, sys: '급수 CW-1', zone: '1층' }); // 보 관통
  E(P1, { k: 'pipe', a: [20000, 1000], b: [20000, 15000], w: 100, hh: 100, z: 2700, sys: '소화 FP-1', zone: '1층' });

  // 치수·주석
  G(A1, { t: 'dim', a: [0, 0], b: [8000, 0], off: [4000, -1800], layer: 'DIM' });
  G(A1, { t: 'dim', a: [8000, 0], b: [16000, 0], off: [12000, -1800], ovr: '8,200', layer: 'DIM' }); // 치수 문자 수정(정합 데모)
  G(A1, { t: 'dim', a: [16000, 0], b: [24000, 0], off: [20000, -1800], layer: 'DIM' });
  G(A1, { t: 'text', p: [9500, 11500], h: 500, s: '근린생활시설', rot: 0, layer: 'TEXT' });
  G(A1, { t: 'text', p: [17500, 11500], h: 400, s: '사무실', rot: 0, layer: 'TEXT' });

  // 기성 1회차: 기초 100%, 1층 기둥 100%, 1층 보 50%
  const prog = {};
  for (const e of P.content[S1.id].els) { if (e.k === 'footing' || e.k === 'column') prog[e.id] = 100; else if (e.k === 'beam') prog[e.id] = 50; else if (e.k === 'slab') prog[e.id] = 30; }
  const p1 = { id: uid('b'), name: '1회차', date: '2026-10-31', prog, claim: {} };
  P.bill.periods.push(p1);
  const rows = takeoff(P); const rv = billReview(P, 0, rows);
  for (const r of rv) { if (r.thisQty > 0) p1.claim[r.code] = +(r.thisQty * (r.code === 'RBR' ? 1.08 : r.code === 'FRM' ? 0.99 : 1.0)).toFixed(2); }
  p1.plan = 20;
  const prog2 = {}; for (const e of P.content[S1.id].els) prog2[e.id] = 100; for (const e of P.content[S2.id].els) if (e.k === 'column') prog2[e.id] = 100; else if (e.k === 'beam') prog2[e.id] = 30;
  const p2 = { id: uid('b'), name: '2회차', date: '2026-11-30', prog: prog2, claim: {}, plan: 45 };
  P.bill.periods.push(p2);
  for (const r of billReview(P, 1, takeoff(P))) if (r.thisQty > 0) p2.claim[r.code] = +(r.thisQty * (r.code === 'FRM' ? 1.05 : 1.0)).toFixed(2);
  P.updated = Date.now();
  return P;
}

// ---------- 그리드 위치 표기 (예: B/2-3) ----------
export function gridRef(P, levelId, pt) {
  const sheets = P.sheets.filter(s => s.level === levelId); const src = [...sheets, ...P.sheets];
  let grids = []; for (const s of src) { grids = (P.content[s.id]?.ents || []).filter(e => e.t === 'grid' && e.label); if (grids.length) break; }
  if (!grids.length) return '';
  const vx = [], hy = [];
  for (const g of grids) { const dx = Math.abs(g.b[0] - g.a[0]), dy = Math.abs(g.b[1] - g.a[1]); if (dy > dx) vx.push({ v: (g.a[0] + g.b[0]) / 2, l: g.label }); else hy.push({ v: (g.a[1] + g.b[1]) / 2, l: g.label }); }
  const pick = (arr, v) => { if (!arr.length) return ''; arr.sort((a, b) => a.v - b.v); const near = arr.reduce((b, x) => Math.abs(x.v - v) < Math.abs(b.v - v) ? x : b); if (Math.abs(near.v - v) <= 400) return near.l; let lo = null, hi = null; for (const x of arr) { if (x.v <= v) lo = x; if (x.v >= v && !hi) hi = x; } return lo && hi ? `${lo.l}-${hi.l}` : lo ? `${lo.l}+` : `${hi.l}-`; };
  const a = pick(hy, pt[1]), b = pick(vx, pt[0]); return [a, b].filter(Boolean).join('/');
}
