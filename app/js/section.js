// 단면도·입면도 자동 생성 — 모델 객체를 절단선(평면)으로 잘라 2D 요소로 만든다
// 결과 좌표: x = 절단선 시작점부터의 거리(mm), y = 표고(mm, GL=0)
import { allElements, elBoxes, boxCorners, levelOf, elName } from './model.js';
import { sysColor } from './mep.js';

const CUT_STRUCT = new Set(['wall', 'slab', 'column', 'beam', 'footing']);
// 다각형과 직선(t=0)의 교차 구간 [u0,u1]들
function cutIntervals(poly, toUT) {
  const q = poly.map(toUT); const us = [];
  for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; if ((a[1] > 0) !== (b[1] > 0)) { const t = a[1] / (a[1] - b[1]); us.push(a[0] + (b[0] - a[0]) * t); } }
  us.sort((x, y) => x - y); const out = []; for (let i = 0; i + 1 < us.length; i += 2) if (us[i + 1] - us[i] > 1) out.push([us[i], us[i + 1]]); return out;
}

/**
 * opts: { a, b: 평면 절단선(시점→종점), side: +1(좌측 법선 방향을 봄)|-1, depth: 투영 깊이(mm), mode: 'section'|'elevation', title }
 * 반환: { ents: [...], box: {x0,y0,x1,y1} }
 */
export function buildSection(P, opts) {
  const { a, b } = opts; const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const n = [-d[1] * (opts.side || 1), d[0] * (opts.side || 1)]; const depth = opts.depth ?? 1e9; const elev = opts.mode === 'elevation';
  const toUT = (p) => [(p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1], (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1]];
  const ents = []; const E = (e) => { ents.push(e); return e; };
  const rect = (u0, z0, u1, z1) => [[u0, z0], [u1, z0], [u1, z1], [u0, z1]];
  const rows = allElements(P).filter(r => r.el.k !== 'opening');
  const opsBy = new Map(); for (const r of allElements(P, x => x.el.k === 'opening')) { if (!opsBy.has(r.el.host)) opsBy.set(r.el.host, []); opsBy.get(r.el.host).push(r.el); }
  const cut = [], beyond = []; let zMax = 0, uMin = Infinity, uMax = -Infinity;
  for (const r of rows) {
    const el = r.el; if (el.k === 'furn' && ['rug', 'floor', 'paving', 'grille'].includes(el.type)) continue;
    const host = (id) => P.content[r.sheet.id].els.find(e => e.id === id);
    const bx = elBoxes(el, r.level, host)[0]; if (!bx) continue;
    const poly = el.k === 'slab' ? el.pts : boxCorners(bx); const q = poly.map(toUT);
    const tMin = Math.min(...q.map(p => p[1])), tMax = Math.max(...q.map(p => p[1]));
    if (tMax < 0 || tMin > depth) continue;
    const z0 = el.k === 'slab' ? bx.z0 : bx.z0, z1 = bx.z1; zMax = Math.max(zMax, z1);
    const isCut = !elev && tMin <= 0 && tMax >= 0;
    if (isCut) for (const [u0, u1] of cutIntervals(poly, toUT)) { cut.push({ r, el, u0, u1, z0, z1 }); uMin = Math.min(uMin, u0); uMax = Math.max(uMax, u1); }
    else { const us = q.map(p => p[0]); const u0 = Math.min(...us), u1 = Math.max(...us); beyond.push({ r, el, u0, u1, z0, z1, t: Math.max(0, tMin) }); uMin = Math.min(uMin, u0); uMax = Math.max(uMax, u1); }
  }
  if (!isFinite(uMin)) return { ents: [], box: null, empty: true };
  const H = Math.max(zMax, 3000), txt = Math.max(250, Math.min(1200, (uMax - uMin + H) / 120));
  // 0) 가림 판정: 가까운 불투명 객체가 덮은 칸(u·z 격자)은 뒤쪽 객체를 생략
  {
    const cs = Math.max(300, Math.max(uMax - uMin, zMax) / 450), nu = Math.ceil((uMax - uMin) / cs) + 1, nz = Math.ceil((zMax + 3000) / cs) + 1; const buf = new Float32Array(nu * nz).fill(Infinity);
    const opaque = (el) => ['wall', 'slab', 'column', 'beam', 'footing'].includes(el.k) && !(el.k === 'wall' && el.h != null && el.h < 1500);
    const cells = (o) => { const i0 = Math.max(0, Math.floor((o.u0 - uMin) / cs) + 1), i1 = Math.min(nu - 1, Math.ceil((o.u1 - uMin) / cs) - 1), j0 = Math.max(0, Math.floor((o.z0 + 3000) / cs) + 1), j1 = Math.min(nz - 1, Math.ceil((o.z1 + 3000) / cs) - 1); return [i0, i1, j0, j1]; };
    const vis = []; beyond.sort((x, y) => x.t - y.t);
    for (const o of beyond) { const [i0, i1, j0, j1] = cells(o); let seen = i1 < i0 || j1 < j0; for (let i = i0; i <= i1 && !seen; i++) for (let j = j0; j <= j1; j++) if (buf[j * nu + i] > o.t - 1) { seen = true; break; } if (!seen) continue; vis.push(o); if (opaque(o.el)) for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (buf[j * nu + i] > o.t) buf[j * nu + i] = o.t; }
    beyond.length = 0; beyond.push(...vis);
  }
  // 1) 투영(먼 것부터 — 채움으로 뒤를 가림)
  beyond.sort((x, y) => y.t - x.t);
  const near = beyond.length ? Math.min(...beyond.map(x => x.t)) : 0, far = beyond.length ? Math.max(...beyond.map(x => x.t)) : 1;
  for (const o of beyond) {
    const { el } = o; if (o.u1 - o.u0 < 1 || o.z1 - o.z0 < 1) continue;
    const k = far > near ? (o.t - near) / (far - near) : 0; const tone = Math.round(205 - k * 110); const col = el.k === 'furn' && ['tree', 'shrub'].includes(el.type) ? '#6fbf73' : ['duct', 'pipe', 'tray', 'riser'].includes(el.k) ? (sysColor(el.sys) || '#9ece6a') : `#${tone.toString(16).padStart(2, '0').repeat(3)}`;
    const layer = 'SEC-BEYOND';
    if (el.k === 'furn' && el.type === 'tree') { const r2 = (o.u1 - o.u0) / 2, cx = (o.u0 + o.u1) / 2; E({ t: 'line', a: [cx, o.z0], b: [cx, o.z0 + el.h * 0.45], layer, color: '#8a6a4c' }); E({ t: 'circle', c: [cx, o.z0 + el.h * 0.65], r: Math.min(r2, el.h * 0.35), layer, color: col }); continue; }
    E({ t: 'hatch', pts: rect(o.u0, o.z0, o.u1, o.z1), pat: 'SOLID', fill: 'bg', layer, color: col });
    // 외벽 개구부(창·문)
    if (el.k === 'wall' && opsBy.has(el.id)) { const wd = [(el.b[0] - el.a[0]), (el.b[1] - el.a[1])]; const wl = Math.hypot(...wd) || 1; const par = Math.abs((wd[0] * d[0] + wd[1] * d[1]) / wl);
      if (par > 0.3) for (const op of opsBy.get(el.id)) { if (op.kind === 'sleeve') continue; const p0 = [el.a[0] + wd[0] / wl * op.s, el.a[1] + wd[1] / wl * op.s], p1 = [el.a[0] + wd[0] / wl * (op.s + op.w), el.a[1] + wd[1] / wl * (op.s + op.w)]; const u0 = Math.min(toUT(p0)[0], toUT(p1)[0]), u1 = Math.max(toUT(p0)[0], toUT(p1)[0]); const zb = levelOf(P, o.r.level.id).elev + (op.sill || 0); E({ t: 'hatch', pts: rect(u0, zb, u1, zb + op.h), pat: 'SOLID', fill: op.kind === 'window' ? '#7fa6bf' : 'bg', layer, color: op.kind === 'window' ? '#9ec3dc' : col }); if (op.kind === 'window') E({ t: 'line', a: [(u0 + u1) / 2, zb], b: [(u0 + u1) / 2, zb + op.h], layer, color: '#c8d6e0' }); else E({ t: 'line', a: [u0, zb], b: [(u0 + u1) / 2, zb + op.h * 0.95], layer, color: col }); } }
    if (el.k === 'wall' && el.mat === 'GLASS') for (let z = o.z0 + 1500; z < o.z1 - 200; z += 1500) E({ t: 'line', a: [o.u0, z], b: [o.u1, z], layer, color: '#9ec3dc' });
  }
  // 2) 절단(굵은 선 + 해치)
  for (const o of cut) {
    const { el } = o; const struct = CUT_STRUCT.has(el.k) && el.mat !== 'GLASS' && el.mat !== 'DRY';
    const col = ['duct', 'pipe', 'tray', 'riser'].includes(el.k) ? (sysColor(el.sys) || '#9ece6a') : struct ? '#f2f2f2' : el.mat === 'GLASS' ? '#9ec3dc' : '#d8d8d8';
    let parts = [[o.z0, o.z1]];
    if (el.k === 'wall' && opsBy.has(el.id)) { // 절단 위치의 개구부만큼 비움
      const wd = [el.b[0] - el.a[0], el.b[1] - el.a[1]], wl = Math.hypot(...wd) || 1; const um = (o.u0 + o.u1) / 2; const pc = [a[0] + d[0] * um, a[1] + d[1] * um];
      const s = ((pc[0] - el.a[0]) * wd[0] + (pc[1] - el.a[1]) * wd[1]) / wl; const E0 = levelOf(P, o.r.level.id).elev;
      for (const op of opsBy.get(el.id)) if (s >= op.s && s <= op.s + op.w) { const zb = E0 + (op.sill || 0), zt = zb + op.h; parts = parts.flatMap(([p0, p1]) => [[p0, Math.min(p1, zb)], [Math.max(p0, zt), p1]]).filter(([p0, p1]) => p1 - p0 > 1); if (op.kind === 'window') E({ t: 'hatch', pts: rect(o.u0 + (o.u1 - o.u0) * 0.35, zb, o.u1 - (o.u1 - o.u0) * 0.35, zt), pat: 'SOLID', fill: '#7fa6bf', layer: 'SEC-CUT', color: '#9ec3dc' }); }
    }
    for (const [p0, p1] of parts) { const pts = rect(o.u0, p0, o.u1, p1); E({ t: 'hatch', pts, pat: struct ? 'ANSI31' : 'SOLID', fill: struct ? 'bg' : undefined, layer: 'SEC-CUT', color: col, lw: struct ? 0.6 : 0.3, sc: struct ? Math.max(0.3, txt / 600) : 1 }); }
  }
  // 3) 주석: 지반선, 층 레벨, 그리드, 제목
  const ux0 = uMin - txt * 8, ux1 = uMax + txt * 4;
  E({ t: 'line', a: [ux0, 0], b: [ux1, 0], layer: 'SEC-ANNO', color: '#c8a46e', lw: 0.7 });
  for (const lv of [...P.levels].sort((x, y) => x.elev - y.elev)) { E({ t: 'line', a: [ux0 + txt * 5, lv.elev], b: [ux1, lv.elev], layer: 'SEC-ANNO', color: '#7aa2c8', lt: 'CENTER' }); E({ t: 'text', p: [ux0, lv.elev + txt * 0.3], h: txt * 0.8, s: `${lv.name}  FL+${(lv.elev / 1000).toFixed(2)}`, rot: 0, layer: 'SEC-ANNO', color: '#9cc3e8' }); }
  E({ t: 'line', a: [ux0 + txt * 5, zMax], b: [ux1, zMax], layer: 'SEC-ANNO', color: '#c97a7a', lt: 'DASHED' }); E({ t: 'text', p: [ux0, zMax + txt * 0.3], h: txt * 0.8, s: `최고높이 ${(zMax / 1000).toFixed(2)}m`, rot: 0, layer: 'SEC-ANNO', color: '#e0a0a0' });
  // 그리드: 평면 그리드가 절단선(또는 입면 방향)과 만나는 위치
  const seen = new Set();
  for (const s of P.sheets) { if (s.kind === 'section') continue; for (const g of P.content[s.id]?.ents || []) { if (g.t !== 'grid' || seen.has(g.label)) continue; const gd = [g.b[0] - g.a[0], g.b[1] - g.a[1]], gl = Math.hypot(...gd) || 1; if (Math.abs((gd[0] * d[0] + gd[1] * d[1]) / gl) > 0.3) continue; // 절단선과 거의 직교하는 그리드만
    const den = d[0] * gd[1] - d[1] * gd[0]; if (Math.abs(den) < 1e-9) continue; const t = ((g.a[0] - a[0]) * gd[1] - (g.a[1] - a[1]) * gd[0]) / den; if (t < uMin - 2000 || t > uMax + 2000) continue; seen.add(g.label);
    E({ t: 'line', a: [t, -txt * 2], b: [t, zMax + txt * 3], layer: 'SEC-ANNO', color: '#6b7a8c', lt: 'CENTER' }); E({ t: 'circle', c: [t, zMax + txt * 4.2], r: txt * 1.1, layer: 'SEC-ANNO', color: '#9cc3e8' }); E({ t: 'text', p: [t - txt * 0.35 * String(g.label).length, zMax + txt * 3.8], h: txt * 0.9, s: String(g.label), rot: 0, layer: 'SEC-ANNO', color: '#9cc3e8' }); } }
  E({ t: 'dim', a: [uMin, 0], b: [uMax, 0], off: [(uMin + uMax) / 2, -txt * 4], layer: 'DIM' });
  E({ t: 'dim', a: [ux1 - txt * 2, 0], b: [ux1 - txt * 2, zMax], off: [ux1, zMax / 2], layer: 'DIM' });
  E({ t: 'text', p: [uMin, -txt * 8], h: txt * 1.6, s: opts.title || (elev ? '입면도' : '단면도'), rot: 0, layer: 'SEC-ANNO', color: '#f2f2f2' });
  E({ t: 'text', p: [uMin, -txt * 10.2], h: txt * 0.8, s: `${elev ? '투영' : '절단 ' + cut.length + '개 · 투영'} ${beyond.length}개 객체 · 모델에서 자동 생성 (${new Date().toLocaleDateString('ko-KR')})`, rot: 0, layer: 'SEC-ANNO', color: '#9aa5b1' });
  return { ents, box: { x0: ux0, y0: -txt * 11, x1: ux1, y1: zMax + txt * 6 }, nCut: cut.length, nBeyond: beyond.length };
}

// 모델 평면 범위 (입면 자동 배치용)
export function modelExtent(P) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of allElements(P)) { if (r.el.k === 'opening' || (r.el.k === 'furn' && ['tree', 'shrub', 'paving', 'fence', 'deck', 'car', 'outdoor'].includes(r.el.type))) continue; const bx = elBoxes(r.el, r.level, (id) => P.content[r.sheet.id].els.find(e => e.id === id))[0]; if (!bx) continue; for (const p of (r.el.k === 'slab' ? r.el.pts : boxCorners(bx))) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } }
  return isFinite(x0) ? { x0, y0, x1, y1 } : null;
}
export function elevationLines(P) {
  const e = modelExtent(P); if (!e) return []; const m = 6000;
  return [
    { key: 'S', title: '남측 입면도', a: [e.x0 - m, e.y0 - m], b: [e.x1 + m, e.y0 - m] },
    { key: 'N', title: '북측 입면도', a: [e.x1 + m, e.y1 + m], b: [e.x0 - m, e.y1 + m] },
    { key: 'E', title: '동측 입면도', a: [e.x1 + m, e.y0 - m], b: [e.x1 + m, e.y1 + m] },
    { key: 'W', title: '서측 입면도', a: [e.x0 - m, e.y1 + m], b: [e.x0 - m, e.y0 - m] },
  ].map(o => ({ ...o, side: 1, mode: 'elevation' }));
}
