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
