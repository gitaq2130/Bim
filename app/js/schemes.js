// 빌더 구조 형식 대안 — 같은 건물 형상으로 구조 형식별 모델 생성 → 부재 1차 산정 → 해석·설계·단면 조정 → 물량·공사비·공기·시공성 비교·추천
import { allElements, isRefElement, SECTIONS } from './model.js';
import { pointInPoly, polyArea, uid, deep } from './util.js';
import { runStructure, hShape } from './structmodel.js';
import { designMember } from './kds.js';
import { baseSettings, USE_INFO } from './structauto.js';

export const SCHEMES = {
  RC_FRAME: { name: 'RC 라멘조', short: 'RC 라멘', desc: 'RC 기둥·보 + RC 슬래브 (재래식 거푸집)', span: 8, cycle: 10, lead: 0, build: 3, sys: 'rc_imf' },
  RC_WALL: { name: 'RC 벽식구조', short: '벽식', desc: 'RC 내력벽 + 무량 슬래브 (알루미늄폼 반복)', span: 6, cycle: 6, lead: 0, build: 4, sys: 'bw_rc' },
  RC_FLAT: { name: 'RC 무량판 (플랫플레이트)', short: '무량판', desc: 'RC 기둥 + 보 없는 두꺼운 슬래브 (테이블폼)', span: 8, cycle: 7, lead: 0, build: 4, sys: 'rc_omf' },
  STEEL_DECK: { name: '철골조 + 데크', short: '철골', desc: '철골 기둥·보 (모멘트골조) + 데크플레이트 슬래브', span: 10, cycle: 4, lead: 60, build: 4, sys: 's_imf' },
  STEEL_CORE: { name: '철골 + RC코어', short: '철골+코어', desc: 'RC 코어가 횡력, 철골 기둥·보는 단순접합 + 데크', span: 10, cycle: 5, lead: 60, build: 4, sys: 'bf_wall', needCore: true },
  SRC_DECK: { name: 'SRC조 + 데크', short: 'SRC', desc: 'SRC 기둥(철골+RC) + 철골보 + 데크플레이트', span: 10, cycle: 7, lead: 60, build: 2, sys: 's_imf' },
  PC: { name: 'PC조', short: 'PC', desc: 'PC 기둥·거더(단순 거치) + 할로우코어 슬래브 + 토핑', span: 10, cycle: 3, lead: 45, build: 4, sys: 'rc_omf' },
};
const PRICE = { CON: 120000, CONpm: 2000, RBR: 1150000, FRM: 32000, FRMal: 24000, STL: 2600000, DECK: 38000, PC: 750000, FIRE: 22000 }; // 원, 2026 국내 개략
const BEAM_SECS = Object.entries(SECTIONS).filter(([k, v]) => v.b < v.h * 0.8).map(([k]) => k).filter((k, i, a) => a.indexOf(k) === i).sort((a, b) => SECTIONS[a].kgm - SECTIONS[b].kgm);
const COL_SECS = Object.entries(SECTIONS).filter(([k, v]) => v.b >= v.h * 0.8).map(([k]) => k).sort((a, b) => SECTIONS[a].kgm - SECTIONS[b].kgm);
const r50 = (v) => Math.ceil(v / 50) * 50, r10 = (v) => Math.ceil(v / 10) * 10;

// ---------- 현재 모델에서 건물 형상 추출 ----------
export function extractTopology(P) {
  const lv = [...P.levels].sort((a, b) => a.elev - b.elev); const all = allElements(P);
  const slabs = new Map(), cols = new Map(), beams = new Map(), walls = [], foots = [], others = [];
  const seen = new Set();
  for (const r of all) {
    const el = r.el, L = r.level; if (!L) continue; const ref = isRefElement(el, r.sheet, P);
    if (el.k === 'slab' && !ref) (slabs.get(L.id) || slabs.set(L.id, []).get(L.id)).push(el);
    else if (el.k === 'column' && !ref) (cols.get(L.id) || cols.set(L.id, []).get(L.id)).push(el);
    else if (el.k === 'beam' && !ref) (beams.get(L.id) || beams.set(L.id, []).get(L.id)).push(el);
    else if (el.k === 'footing') foots.push({ el, L });
    else if (el.k === 'wall' && (el.mat === 'RC' || el.mat === 'SRC') && (el.h == null || el.h >= 0.6 * L.height)) { const k = [el.a, el.b].map(p => p.map(Math.round).join(',')).sort().join('|') + L.id; if (!seen.has(k)) { seen.add(k); walls.push({ el, L }); } }
    else if (el.k === 'wall' || el.k === 'opening') others.push({ el, L, sheet: r.sheet });
  }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const [, ss] of slabs) for (const s of ss) for (const p of s.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const cx0 = x0 + (x1 - x0) * 0.2, cx1 = x1 - (x1 - x0) * 0.2, cy0 = y0 + (y1 - y0) * 0.2, cy1 = y1 - (y1 - y0) * 0.2;
  for (const w of walls) { const m = [(w.el.a[0] + w.el.b[0]) / 2, (w.el.a[1] + w.el.b[1]) / 2]; w.core = m[0] > cx0 && m[0] < cx1 && m[1] > cy0 && m[1] < cy1; }
  const base = lv[0]; const stories = []; for (let i = 0; i < lv.length - 1; i++) stories.push({ L: lv[i], top: lv[i + 1] });
  // 바닥판: 각 층 위 바닥(top) 슬래브. 기초 레벨 슬래브는 기초로 취급
  const floorSlabs = (L) => (slabs.get(L.id) || []).filter(s => !(L === base));
  // 직교 그리드 판정
  const allCols = [...cols.values()].flat(); const cl = (arr) => { const v = [...arr].sort((a, b) => a - b); const out = []; for (const x of v) if (!out.length || x - out[out.length - 1] > 300) out.push(x); return out; };
  let grid = null; if (allCols.length) { const xs = cl(allCols.map(c => c.p[0])), ys = cl(allCols.map(c => c.p[1])); const on = allCols.filter(c => xs.some(x => Math.abs(x - c.p[0]) < 300) && ys.some(y => Math.abs(y - c.p[1]) < 300)).length; const occ = new Set(allCols.map(c => `${xs.findIndex(x => Math.abs(x - c.p[0]) < 300)},${ys.findIndex(y => Math.abs(y - c.p[1]) < 300)}`)).size; if (on / allCols.length > 0.95 && xs.length >= 2 && ys.length >= 2 && occ / (xs.length * ys.length) >= 0.5) grid = { xs, ys }; }
  return { lv, base, stories, slabs, floorSlabs, cols, beams, walls, foots, others, bbox: { x0, x1, y0, y1 }, grid, hasCols: allCols.length > 0, core: walls.filter(w => w.core) };
}

// ---------- 형식별 모델 생성 ----------
function genGrid(T, span) { const { x0, x1, y0, y1 } = T.bbox; const ins = 300; const mk = (a, b) => { const n = Math.max(1, Math.round((b - a - 2 * ins) / span)); return Array.from({ length: n + 1 }, (_, k) => a + ins + (b - a - 2 * ins) * k / n); }; return { xs: mk(x0, x1), ys: mk(y0, y1) }; }
const inAny = (p, polys, buf = 0) => polys.some(pts => pointInPoly(p, pts) || (buf && pts.some((q, i) => { const r = pts[(i + 1) % pts.length]; const dx = r[0] - q[0], dy = r[1] - q[1], l2 = dx * dx + dy * dy || 1; let t = ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(q[0] + dx * t - p[0], q[1] + dy * t - p[1]) < buf; })));
export function generate(P, T, key, opt = {}) {
  const sc = SCHEMES[key]; const site = { ...(P.struct?.site || {}) }; const U = USE_INFO[site.use] || USE_INFO['사무실']; const res = site.use === '주거';
  const P2 = { id: P.id + '_' + key, name: `${P.name} — ${sc.name}`, levels: P.levels, base: P.base, site: P.site, sheets: [], content: {}, struct: { site: P.struct?.site }, view: {}, issues: [] };
  const S = {}, A = {}; for (const L of T.lv) { S[L.id] = { id: 's_' + L.id, name: `S-${L.name} ${sc.short}`, disc: 'S', level: L.id }; A[L.id] = { id: 'a_' + L.id, name: `A-${L.name}`, disc: 'A', level: L.id }; P2.sheets.push(S[L.id], A[L.id]); P2.content[S[L.id].id] = { ents: [], els: [] }; P2.content[A[L.id].id] = { ents: [], els: [] }; }
  const E = (L, e, disc = 'S') => { e.id = e.id || uid('e'); P2.content[(disc === 'S' ? S : A)[L.id].id].els.push(e); return e; };
  // 그리드·기둥 위치
  const useExisting = T.hasCols; const grid = useExisting ? T.grid : genGrid(T, sc.span * 1000);
  const spanX = grid ? Math.max(...grid.xs.slice(1).map((x, i) => x - grid.xs[i])) : 8000, spanY = grid ? Math.max(...grid.ys.slice(1).map((y, i) => y - grid.ys[i])) : 8000;
  const Lmax = Math.max(spanX, spanY), Lmin = Math.min(spanX, spanY);
  // 하중 (사용)
  const isRoofL = (L) => L === T.lv[T.lv.length - 1];
  const slabT = (L) => { const roof = isRoofL(L); switch (key) { case 'RC_FLAT': return Math.max(250, r10(Lmax / 30)); case 'RC_WALL': return Math.max(res && !roof ? 210 : 180, r10(Lmin / 35)); case 'STEEL_DECK': case 'STEEL_CORE': case 'SRC_DECK': return res && !roof ? 210 : 150; case 'PC': return Lmax <= 8000 ? 205 : Lmax <= 12000 ? 260 : 320; default: return Math.max(res && !roof ? 210 : 150, r10(Lmin / 35)); } };
  const wu = (L) => (1.2 * (24 * slabT(L) / 1000 * (['STEEL_DECK', 'STEEL_CORE', 'SRC_DECK'].includes(key) ? 0.85 : 1) + U.SDL + 1.0) + 1.6 * U.LL) * 1e-3; // N/mm²
  const notes = [];
  // 층별 바닥판 다각형
  const floorPolys = (L) => { const ss = T.floorSlabs(L); if (ss.length) return ss.map(s => s.pts); const { x0, x1, y0, y1 } = T.bbox; return [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]; };
  // 기둥 위치: 기존 기둥 or 그리드 교점 (지지하는 위층 바닥 안)
  const colPts = (st) => { if (useExisting) return (T.cols.get(st.L.id) || []).map(c => ({ x: c.p[0], y: c.p[1], rot: c.rot || 0 })); const polys = floorPolys(st.top); const out = []; for (const x of grid.xs) for (const y of grid.ys) if (inAny([x, y], polys, 200)) out.push({ x, y, rot: 0 }); return out; };
  // 거더 선: 기존 보 or 그리드 인접 기둥
  const supAt = (st, pts, p) => pts.some(c => Math.hypot(c.x - p[0], c.y - p[1]) <= 400) || T.core.some(w => w.L.id === st.L.id && (() => { const a = w.el.a, b = w.el.b; const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1; let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]) <= w.el.t / 2 + 400; })());
  const girders = (st, pts) => { if (useExisting && (T.beams.get(st.L.id) || []).length) return (T.beams.get(st.L.id)).filter(b => !b.rel && (b.cant ? (supAt(st, pts, b.a) || supAt(st, pts, b.b)) : (supAt(st, pts, b.a) && supAt(st, pts, b.b)))).map(b => ({ a: b.a, b: b.b, cant: !!b.cant })); if (!grid) return []; const has = (x, y) => pts.some(p => Math.abs(p.x - x) < 50 && Math.abs(p.y - y) < 50); const out = [];
    for (const y of grid.ys) for (let i = 0; i < grid.xs.length - 1; i++) if (has(grid.xs[i], y) && has(grid.xs[i + 1], y)) out.push({ a: [grid.xs[i], y], b: [grid.xs[i + 1], y] });
    for (const x of grid.xs) for (let j = 0; j < grid.ys.length - 1; j++) if (has(x, grid.ys[j]) && has(x, grid.ys[j + 1])) out.push({ a: [x, grid.ys[j]], b: [x, grid.ys[j + 1]] }); return out; };
  // 부재 단면 1차 산정
  const nSt = T.stories.length; const fckV = nSt > 30 ? 50 : nSt > 15 ? 40 : 30;
  const pickSec = (list, ok) => list.find(k => ok(hShape(k))) || list[list.length - 1];
  const tribOf = (st, pts) => { const polys = floorPolys(st.top); const area = polys.reduce((s, p) => s + Math.abs(polyArea(p)), 0); const tr = new Map(pts.map((p, i) => [i, 0])); if (!pts.length) return tr; const { x0, x1, y0, y1 } = T.bbox; const step = Math.max(500, Math.sqrt((x1 - x0) * (y1 - y0) / 3000)); let tot = 0;
    for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) { if (!inAny([x, y], polys)) continue; let bi = 0, bd = Infinity; pts.forEach((p, i) => { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; bi = i; } }); tr.set(bi, tr.get(bi) + 1); tot++; }
    for (const [k, v] of tr) tr.set(k, tot ? v / tot * area : 0); return tr; };
  const hasCore = T.core.length > 0;
  // --- 벽 (코어·외곽 RC 벽) ---
  for (const w of T.walls) { const keep = w.core || key === 'RC_WALL'; const el = { ...deep(w.el), id: undefined }; if (!keep) { el.mat = 'CMU'; E(w.L, el, 'A'); } else E(w.L, el, 'S'); }
  for (const o of T.others) if (o.el.k === 'wall') E(o.L, { ...deep(o.el), id: undefined }, 'A');
  // --- 층별 생성 ---
  T.stories.forEach((st, si) => {
    const nAbove = nSt - si; const h = st.top.elev - st.L.elev;
    const tS = slabT(st.top);
    // 바닥 (st.top 레벨 슬래브)
    for (const pts of floorPolys(st.top)) E(st.top, { k: 'slab', pts: deep(pts), t: tS, mat: key === 'PC' ? 'PC' : 'RC', tag: key === 'PC' ? `HCS(등가 t${tS})` : ['STEEL_DECK', 'STEEL_CORE', 'SRC_DECK'].includes(key) ? `데크슬래브 t${tS}` : `S t${tS}`, deck: ['STEEL_DECK', 'STEEL_CORE', 'SRC_DECK'].includes(key) || undefined, pc: key === 'PC' || undefined });
    if (key === 'RC_WALL') { // 내력벽: 그리드선(또는 기존 보선)마다 벽
      const g = grid || genGrid(T, 6000); const lines = useExisting && (T.beams.get(st.L.id) || []).length ? T.beams.get(st.L.id).filter(b => !b.rel).map(b => [b.a, b.b]) : [...g.ys.flatMap(y => g.xs.slice(0, -1).map((x, i) => [[x, y], [g.xs[i + 1], y]])), ...g.xs.flatMap(x => g.ys.slice(0, -1).map((y, j) => [[x, y], [x, g.ys[j + 1]]]))];
      const polys = floorPolys(st.top); const tW = nSt > 25 && si < nSt * 0.4 ? 300 : nSt > 15 ? 250 : 200;
      for (const [a, b] of lines) { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; if (!inAny(m, polys, 300)) continue; E(st.L, { k: 'wall', a: [...a], b: [...b], t: tW, mat: 'RC', tag: `W${tW} 내력벽` }); }
      return;
    }
    const pts = colPts(st); const trib = tribOf(st, pts);
    // 기둥
    pts.forEach((p, i) => { const Pu = (trib.get(i) || 0) * wu(st.top) * nAbove; let el;
      if (key === 'STEEL_DECK' || key === 'STEEL_CORE') { const sec = pickSec(COL_SECS, s => 0.9 * 0.55 * 355 * s.A >= Pu); el = { k: 'column', p: [p.x, p.y], w: SECTIONS[sec].b, d: SECTIONS[sec].h, rot: p.rot, mat: 'STEEL', sec, tag: 'SC' }; if (0.9 * 0.55 * 355 * hShape(sec).A < Pu) notes.push('철골 기둥 축력 과대 — 각형강관(CFT)·SRC 필요'); }
      else if (key === 'SRC_DECK') { const sec = pickSec(COL_SECS, s => 0.9 * 0.6 * 355 * s.A >= 0.35 * Pu); const Ag = 0.65 * Pu / (0.52 * 0.85 * fckV) / 0.75; const sd = Math.max(r50(Math.sqrt(Ag)), SECTIONS[sec].h + 250, 600); el = { k: 'column', p: [p.x, p.y], w: sd, d: sd, rot: p.rot, mat: 'SRC', sec, tag: 'SRC' }; }
      else { const fc = key === 'PC' ? Math.max(35, fckV) : fckV; const Ag = Pu / (0.52 * (0.85 * fc * 0.98 + 500 * 0.02)) / 0.7; const sd = Math.max(r50(Math.sqrt(Ag)), nSt <= 3 ? 400 : key === 'RC_FLAT' ? 500 : 450); el = { k: 'column', p: [p.x, p.y], w: sd, d: sd, rot: p.rot, mat: key === 'PC' ? 'PC' : 'RC', tag: key === 'PC' ? 'PC기둥' : 'C' }; }
      E(st.L, el); });
    // 보
    const G = girders(st, pts); const polysTop = floorPolys(st.top); const areaTop = polysTop.reduce((s, q) => s + Math.abs(polyArea(q)), 0); const totLen = G.reduce((s, g) => s + Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]), 0) || 1;
    const steelish = ['STEEL_DECK', 'STEEL_CORE', 'SRC_DECK'].includes(key);
    // 작은보 (직교 그리드 철골 계열: 데크 스팬 3 m 이하)
    const secs = []; if (steelish && grid) for (let i = 0; i < grid.xs.length - 1; i++) for (let j = 0; j < grid.ys.length - 1; j++) { const xa = grid.xs[i], xb = grid.xs[i + 1], ya = grid.ys[j], yb = grid.ys[j + 1]; if (!inAny([(xa + xb) / 2, (ya + yb) / 2], polysTop)) continue; const wX = xb - xa, wY = yb - ya; if (wX <= wY) { const n = Math.ceil(wY / 3000) - 1; for (let k = 1; k <= n; k++) { const y = ya + wY * k / (n + 1); secs.push({ a: [xa, y], b: [xb, y], sp: wY / (n + 1) }); } } else { const n = Math.ceil(wX / 3000) - 1; for (let k = 1; k <= n; k++) { const x = xa + wX * k / (n + 1); secs.push({ a: [x, ya], b: [x, yb], sp: wX / (n + 1) }); } } }
    const tribW = (areaTop / (totLen + secs.reduce((s, g) => s + Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]), 0)));
    for (const g of G) { const L = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]); const w = wu(st.top) * tribW * (secs.length ? 1.6 : 1.2); let el;
      if (key === 'RC_FLAT') { const b = Math.max(1000, Math.round(Math.min(Lmax, 8000) * 0.5 / 100) * 100); el = { k: 'beam', a: [...g.a], b: [...g.b], w: b, d: tS, mat: 'RC', tag: '슬래브띠(주열대)', strip: true }; }
      else if (steelish) { const pin = key === 'STEEL_CORE'; const M = w * L * L / (pin ? 8 : 10); const wl = U.LL * 1e-3 * tribW * 1.4; const sec = pickSec(BEAM_SECS, s => 0.9 * 355 * s.Zx >= M && s.Ix >= 5 * wl * L ** 3 * 360 / (384 * 205000)); el = { k: 'beam', a: [...g.a], b: [...g.b], w: SECTIONS[sec].b, d: SECTIONS[sec].h, mat: 'STEEL', sec, tag: 'G', ...(pin && !g.cant ? { rel: 'both' } : {}), ...(g.cant ? { cant: true } : {}) }; }
      else { const hh = Math.max(450, r50(L / (g.cant ? 6 : key === 'PC' ? 11 : 12))); el = { k: 'beam', a: [...g.a], b: [...g.b], w: Math.max(300, r50(hh / 2)), d: hh, mat: key === 'PC' ? 'PC' : 'RC', tag: key === 'PC' ? 'PC거더' : 'G', ...(key === 'PC' && !g.cant ? { rel: 'both' } : {}), ...(g.cant ? { cant: true } : {}) }; }
      E(st.L, el); }
    for (const g of secs) { const L = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]); const w = wu(st.top) * g.sp; const M = w * L * L / 8; const wl = U.LL * 1e-3 * g.sp; const sec = pickSec(BEAM_SECS, s => 0.9 * 355 * s.Zx >= M && s.Ix >= 5 * wl * L ** 3 * 360 / (384 * 205000)); E(st.L, { k: 'beam', a: [...g.a], b: [...g.b], w: SECTIONS[sec].b, d: SECTIONS[sec].h, mat: 'STEEL', sec, tag: 'B(작은보)', rel: 'both' }); }
    if (steelish && !grid) notes.push('비직교 평면 — 작은보 자동 배치 생략 (데크 스팬 확인 필요)');
  });
  // 기초 (기존 복사)
  for (const f of T.foots) E(f.L, { ...deep(f.el), id: undefined });
  for (const s of T.slabs.get(T.base.id) || []) E(T.base, { ...deep(s), id: undefined });
  return { P2, notes: [...new Set(notes)], grid, Lmax, fckV };
}

// ---------- 해석 + 단면 조정 ----------
function upsize(m, d) { const el = m.el; const f = Math.min(1.6, Math.sqrt(Math.max(d.ratio, 1.05)) * 1.05);
  if (m.mat === 'STEEL') { const list = m.kind === 'column' ? COL_SECS : BEAM_SECS; const cur = hShape(el.sec); const need = d.ratio * 1.05; const nx = list.find(k => { const s = hShape(k); return m.kind === 'column' ? s.A >= cur.A * need && s.Zx >= cur.Zx * Math.min(need, 1.3) : s.Zx >= cur.Zx * need && s.Ix >= cur.Ix * Math.min(need, 1.5); }) || list[list.length - 1]; if (nx && nx !== el.sec) { el.sec = nx; el.w = SECTIONS[nx].b; el.d = SECTIONS[nx].h; return true; } return false; }
  if (m.kind === 'column') { const n = r50(Math.max(el.w, el.d) * f); el.w = el.d = Math.max(n, el.w + 50); return true; }
  if (m.kind === 'wall') { if (el.t >= 800) return false; el.t = Math.min(800, r50(el.t * f)); return true; }
  if (m.kind === 'beam') { if (el.strip) return false; el.d = Math.max(el.d + 50, r50(el.d * f)); el.w = Math.max(el.w, r50(el.d / 2)); return true; }
  return false; }
export async function evalScheme(P, T, key, { onProgress, tick = () => Promise.resolve(), iters = 4 } = {}) {
  const t0 = performance.now(); const sc = SCHEMES[key]; const G = generate(P, T, key); const P2 = G.P2;
  const S = baseSettings(P2); const hasCore = T.core.length > 0;
  const tall = (T.lv[T.lv.length - 1].elev - T.base.elev) >= 70000;
  Object.assign(S, { fck: 27, fckV: G.fckV, rhoAuto: true, pdelta: false }); S.seis = { ...S.seis, method: tall ? 'rs' : 'static', grade: T.stories.length >= 16 ? 'I' : S.seis.grade, sys: key === 'RC_WALL' ? 'bw_rc' : hasCore && key !== 'STEEL_CORE' ? (['STEEL_DECK', 'SRC_DECK', 'PC'].includes(key) ? 'bf_wall' : 'dual_i') : sc.sys };
  if (key === 'PC') S.fckV = Math.max(35, G.fckV);
  let res, D, drift, punchMax = null; const resized = { n: 0 };
  const punchOf = (res) => { if (key !== 'RC_FLAT') return null; const R = res.R; const N = res.M.nodes; const bot = new Map(); for (const m of res.M.members) if (m.kind === 'column') bot.set(R.E[m.segs[0]].e.n1, m.segs[0]); let mx = 0;
    for (const m of res.M.members) if (m.kind === 'column') { const eb = m.segs[m.segs.length - 1]; const top = R.E[eb].e.n2; const ea = bot.get(top); const P = (c) => -R.cases[c].ef[eb * 12 + 6] - (ea != null ? R.cases[c].ef[ea * 12] : 0); const Vu = 1.2 * P('D') + 1.6 * P('L'); const t = slabTAt(P2, N[top].z, res); const d = t * 1.25 - 30; const b0 = 2 * (m.by + d) + 2 * (m.hz + d); mx = Math.max(mx, Vu / (0.75 * Math.sqrt(S.fck) / 3 * b0 * d)); } return mx; };
  for (let it = 0; it <= iters; it++) {
    onProgress?.(`${sc.name} — 해석 ${it + 1}`); await tick();
    res = runStructure(P2, { settings: S }); if (res.empty) return { key, sc, empty: true };
    D = []; for (let i = 0; i < res.M.members.length; i++) { D.push(designMember(res, i, S)); if (i % 300 === 299) await tick(); }
    const sp = res.info.seis; const rsm = res.cases.includes('RX'); drift = sp ? { v: Math.max(0, ...res.story.map(f => rsm ? Math.max(f.drRX || 0, f.drRY || 0) : Math.max(f.drEX || 0, f.drEY || 0))) * sp.Cd / sp.Ie, lim: sp.driftLim } : { v: 0, lim: 1 };
    punchMax = punchOf(res);
    if (it === iters) break; let ch = 0;
    D.forEach((d, i) => { if (d.ratio > 1 && upsize(res.M.members[i], d)) ch++; });
    if (drift.v > drift.lim) for (const m of res.M.members) if ((m.kind === 'column' || m.kind === 'wall') && upsize(m, { ratio: 1.2 })) ch++;
    const stripNg = key === 'RC_FLAT' && D.some((d, i) => d.ratio > 1 && res.M.members[i].el.strip);
    if (punchMax > 1 || stripNg) { const inc = punchMax > 1.3 ? 60 : 30; for (const sh of P2.sheets) for (const el of P2.content[sh.id].els) { if (el.k === 'slab' && sh.level !== T.base.id) { el.t += inc; el.tag = `S t${el.t}`; } if (el.strip) el.d += inc; } ch++; }
    resized.n += ch; if (!ch || D.filter(d => d.ratio > 1).length / D.length < 0.002 && drift.v <= drift.lim && !(punchMax > 1)) break;
  }
  const punch = punchMax != null ? [punchMax] : [];
  const Q = quantities(res, D, P2, key, S); const sp = res.info.seis;
  return { key, sc, P2, res, D, S, G, notes: G.notes, ng: D.filter(d => d.ratio > 1).length, max: Math.max(...D.map(d => d.ratio)), drift, punchMax: punch.length ? Math.max(...punch) : null, Q, resized: resized.n, ms: performance.now() - t0, T1: sp?.T?.X, Wt: res.info.Wt };
}
function slabTAt(P2, z, res) { const s = res.M.slabs.find(s => s.z === z); return s ? s.t : 250; }

// ---------- 물량·공사비·공기 ----------
function quantities(res, D, P2, key, S) {
  const q = { con: 0, rbr: 0, frm: 0, stl: 0, deck: 0, pc: 0, fire: 0, conByF: {} }; const addC = (v, f) => { q.con += v; q.conByF[f] = (q.conByF[f] || 0) + v; };
  const lvH = new Map(P2.levels.map(l => [l.id, l.height])); let depth = 0, span = 0;
  for (const [mi, m] of res.M.members.entries()) { const el = m.el, d = D[mi];
    if (m.kind === 'column') { const h = m.L / 1000; if (el.mat === 'STEEL') { q.stl += SECTIONS[el.sec].kgm * h / 1000 * 1.1; q.fire += (2 * m.hz + 4 * m.by) / 1000 * h; } else { const As = el.mat === 'SRC' && m.sh ? m.sh.A : 0; const V = (m.by * m.hz - As) / 1e6 * h; if (el.mat === 'PC') q.pc += V; else { addC(V, m.fck || S.fckV); q.frm += 2 * (m.by + m.hz) / 1000 * h; q.rbr += V * 7.85 * Math.max(0.01, d.rhoReq && isFinite(d.rhoReq) ? d.rhoReq : 0.015) * 1.25; } if (As) q.stl += m.sh.kgm * h / 1000 * 1.1; } }
    else if (m.kind === 'beam') { const L = m.L / 1000; span = Math.max(span, m.L); if (el.mat === 'STEEL') { q.stl += SECTIONS[el.sec].kgm * L / 1000 * 1.1; q.fire += (2 * m.hz + 3 * m.by) / 1000 * L; depth = Math.max(depth, m.hz + 150); } else if (el.strip) { /* 슬래브 일부 */ } else { const V = m.by * Math.max(0, m.hz - 150) / 1e6 * L; if (el.mat === 'PC') q.pc += V; else { addC(V, S.fck); q.frm += (2 * (m.hz - 150) + m.by) / 1000 * L; q.rbr += V * 0.16; } depth = Math.max(depth, m.hz); } }
    else if (m.kind === 'wall') { const V = m.by * m.hz / 1e6 * m.L / 1000; addC(V, m.fck || S.fckV); q.frm += 2 * m.by / 1000 * m.L / 1000; q.rbr += V * 0.09; span = Math.max(span, m.by); } }
  for (const s of res.M.slabs) { const A = Math.abs(polyArea(s.pts)) / 1e6; const el = s.r.el;
    if (el.pc) { q.pc += A * 0.2 * 0.75; addC(A * 0.06, S.fck); q.rbr += A * 0.06 * 0.05; }
    else if (el.deck) { addC(A * s.t / 1000 * 0.85, S.fck); q.deck += A; q.rbr += A * s.t / 1000 * 0.06; }
    else { addC(A * s.t / 1000, S.fck); q.frm += A; q.rbr += A * s.t / 1000 * (key === 'RC_FLAT' ? 0.13 : 0.1); } }
  const tS = Math.max(0, ...res.M.slabs.map(s => s.t)); depth = key === 'RC_FLAT' || key === 'RC_WALL' ? tS : Math.max(depth, tS); if (key === 'RC_FLAT') span = Math.max(span, ...res.M.members.filter(m => m.kind === 'beam').map(m => m.L));
  let conCost = 0; for (const [f, v] of Object.entries(q.conByF)) conCost += v * (PRICE.CON + PRICE.CONpm * Math.max(0, f - 24));
  const cost = { con: conCost, rbr: q.rbr * PRICE.RBR, frm: q.frm * (key === 'RC_WALL' ? PRICE.FRMal : PRICE.FRM), stl: q.stl * PRICE.STL, deck: q.deck * PRICE.DECK, pc: q.pc * PRICE.PC, fire: q.fire * PRICE.FIRE };
  cost.total = Object.values(cost).reduce((a, b) => a + b, 0);
  const gfa = res.M.slabs.reduce((s, x) => s + Math.abs(polyArea(x.pts)) / 1e6, 0);
  return { ...q, cost, gfa, depth, span };
}
export function schedule(e, nSt, use) { const sc = e.sc; let cyc = sc.cycle; if (e.key === 'RC_WALL' && use === '주거') cyc = 5; if (e.key === 'RC_FRAME' && nSt > 20) cyc = 9; const lead = Math.max(0, sc.lead - 30); const days = 15 + lead + nSt * cyc; return { cyc, days, months: days / 30, lead: sc.lead }; }

// ---------- 추천 ----------
export const WEIGHTS = {
  '주거': { cost: 0.35, time: 0.2, build: 0.15, flex: 0.1, depth: 0.2 }, '사무실': { cost: 0.3, time: 0.25, build: 0.1, flex: 0.25, depth: 0.1 },
  '근린생활(판매)': { cost: 0.35, time: 0.2, build: 0.1, flex: 0.25, depth: 0.1 }, '경량 창고': { cost: 0.3, time: 0.3, build: 0.1, flex: 0.3, depth: 0 }, '주차장(승용)': { cost: 0.35, time: 0.25, build: 0.1, flex: 0.2, depth: 0.1 },
  default: { cost: 0.35, time: 0.2, build: 0.15, flex: 0.15, depth: 0.15 },
};
export function applicability(key, T, use, nSt) {
  const sc = SCHEMES[key]; const out = { ok: true, why: '' };
  if (sc.needCore && !T.core.length) return { ok: false, why: 'RC 코어 벽이 없음' };
  if (key === 'RC_WALL' && !['주거', '병원 병실'].includes(use)) return { ok: true, warn: true, why: '대공간 용도에 벽식은 평면 제약 큼' };
  if (key === 'PC' && nSt > 10 && !T.core.length) return { ok: true, warn: true, why: '코어 없는 PC 10층 초과 — 횡강성 확보 어려움' };
  if (key === 'RC_FLAT' && !T.core.length && nSt > 12) return { ok: true, warn: true, why: '코어 없는 무량판 고층 — 횡력 저항 부족' };
  return out;
}
export function rank(evals, use, nSt, W = WEIGHTS[use] || WEIGHTS.default) {
  const ok = evals.filter(e => !e.empty); if (!ok.length) return [];
  for (const e of ok) { e.sch = schedule(e, nSt, use); const res = use === '주거'; const noise = res && Math.min(...e.res.M.slabs.map(s => s.t)) < 210;
    let b = e.sc.build; if (e.key === 'RC_WALL') b = use === '주거' ? 5 : 2; if (e.key === 'PC' && nSt > 10) b = 2; if (e.key === 'SRC_DECK') b = 2; if (nSt > 30 && e.key === 'RC_FRAME') b = 2; e.buildScore = b; e.noise = noise;
    e.safe = (e.ng === 0 || (e.ng / e.D.length <= 0.005 && e.max <= 1.1)) && e.drift.v <= e.drift.lim && !(e.punchMax > 1); }
  const minC = Math.min(...ok.map(e => e.Q.cost.total)), minT = Math.min(...ok.map(e => e.sch.days)), maxS = Math.max(...ok.map(e => e.Q.span)), minD = Math.min(...ok.map(e => e.Q.depth || 1));
  for (const e of ok) { const s = { cost: minC / e.Q.cost.total, time: minT / e.sch.days, build: e.buildScore / 5, flex: e.key === 'RC_WALL' ? 0.2 : e.Q.span / maxS, depth: minD / (e.Q.depth || minD) };
    e.scores = s; e.total = Object.keys(W).reduce((a, k) => a + W[k] * s[k], 0) * (e.safe ? 1 : 0.6) * (e.noise ? 0.85 : 1) * (e.appl?.warn ? 0.85 : 1); }
  return ok.sort((a, b) => b.total - a.total);
}
export function explain(best, list, use) {
  const c0 = Math.min(...list.map(e => e.Q.cost.total)), t0 = Math.min(...list.map(e => e.sch.days)); const pts = [];
  pts.push(best.Q.cost.total <= c0 * 1.001 ? '골조 공사비 최저' : `공사비 최저 대비 +${((best.Q.cost.total / c0 - 1) * 100).toFixed(0)}%`);
  pts.push(best.sch.days <= t0 ? `골조 공기 최단 (${best.sch.months.toFixed(1)}개월)` : `골조 공기 ${best.sch.months.toFixed(1)}개월 (최단 대비 +${(best.sch.days - t0)}일)`);
  pts.push(`시공성 ${best.buildScore}/5`); if (best.Q.span) pts.push(`최대 스팬 ${(best.Q.span / 1000).toFixed(1)} m`); pts.push(`구조 춤 ${best.Q.depth} mm`);
  if (!best.safe) pts.push('일부 부재·변위 기준 미충족 — 단면 조정 필요');
  return pts.join(' · ');
}
