// CAD 기하 연산: 세그먼트·경계상자·선택·변형·간격띄우기·자르기/연장
import { sub, add, mul, dot, cross, len, dist, norm, perp, rot, segInt, closestOnSeg, bboxOf, pointInPoly, uid, deep, angOf, mid } from '../js/util.js';
import { elOutline, elBoxes, boxCorners } from '../js/model.js';
import { dimGeom } from '../js/dxf.js';
import { expandInsert } from '../js/blocks.js';
let BLOCKS = {};
export const setBlocks = (b) => { BLOCKS = b || {}; };

const TAU = Math.PI * 2;
export const normAng = (a) => ((a % TAU) + TAU) % TAU;
export function arcPts(c, r, a0, a1, n = 32) { let s = normAng(a0), e = normAng(a1); if (e <= s) e += TAU; const out = []; const k = Math.max(4, Math.ceil(n * (e - s) / TAU)); for (let i = 0; i <= k; i++) { const t = s + (e - s) * i / k; out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]); } return out; }
export const angInArc = (t, a0, a1) => { const s = normAng(a0), e = normAng(a1), x = normAng(t); return s <= e ? (x >= s - 1e-9 && x <= e + 1e-9) : (x >= s - 1e-9 || x <= e + 1e-9); };

// 엔티티 → 세그먼트 목록
export function entSegs(e) {
  switch (e.t) {
    case 'line': case 'grid': return [[e.a, e.b]];
    case 'pline': { const s = []; for (let i = 0; i < e.pts.length - 1; i++) s.push([e.pts[i], e.pts[i + 1]]); if (e.closed && e.pts.length > 2) s.push([e.pts[e.pts.length - 1], e.pts[0]]); return s; }
    case 'circle': { const p = arcPts(e.c, e.r, 0, TAU - 1e-6, 48); return p.slice(1).map((q, i) => [p[i], q]); }
    case 'arc': { const p = arcPts(e.c, e.r, e.a0, e.a1, 48); return p.slice(1).map((q, i) => [p[i], q]); }
    case 'dim': { const g = dimGeom(e); return [[g.p1, g.p2], [e.a, g.p1], [e.b, g.p2]]; }
    case 'text': { const b = textBox(e); return [[b[0], b[1]], [b[1], b[2]], [b[2], b[3]], [b[3], b[0]]]; }
    case 'hatch': case 'cloud': return entSegs({ t: 'pline', pts: e.pts, closed: true });
    case 'leader': return entSegs({ t: 'pline', pts: e.pts, closed: false });
    case 'insert': return expandInsert(e, BLOCKS).flatMap(entSegs);
    case 'rdim': { const d = [Math.cos(e.ang), Math.sin(e.ang)]; return [[e.c, [e.c[0] + d[0] * e.r, e.c[1] + d[1] * e.r]]]; }
    case 'adim': { const a0 = angOf(e.c, e.a), a1 = angOf(e.c, e.b); const p = arcPts(e.c, e.r, a0, a1, 24); return [...p.slice(1).map((q, i) => [p[i], q]), [e.c, e.a], [e.c, e.b]]; }
  }
  return [];
}
export function textBox(e) { const w = Math.max(1, (e.s || '').length) * e.h * 0.85, a = (e.rot || 0) * Math.PI / 180; return [[0, 0], [w, 0], [w, e.h], [0, e.h]].map(p => add(e.p, rot(p, a))); }
export function elSegs(el, host) { const o = elOutline(el, host); if (!o) return []; const s = []; for (let i = 0; i < o.length; i++) s.push([o[i], o[(i + 1) % o.length]]); return s; }
export function entBBox(e) { if (e.t === 'circle') return { x0: e.c[0] - e.r, y0: e.c[1] - e.r, x1: e.c[0] + e.r, y1: e.c[1] + e.r }; const s = entSegs(e).flat(); return s.length ? bboxOf(s) : null; }
export function elBBox(el, host) { const o = elOutline(el, host); return o ? bboxOf(o) : null; }

// 스냅 후보점
export function entSnaps(e) {
  const out = [];
  switch (e.t) {
    case 'line': case 'grid': out.push(['end', e.a], ['end', e.b], ['mid', mid(e.a, e.b)]); break;
    case 'pline': e.pts.forEach(p => out.push(['end', p])); entSegs(e).forEach(([a, b]) => out.push(['mid', mid(a, b)])); break;
    case 'circle': out.push(['cen', e.c]); for (let k = 0; k < 4; k++) out.push(['qua', [e.c[0] + e.r * Math.cos(k * Math.PI / 2), e.c[1] + e.r * Math.sin(k * Math.PI / 2)]]); break;
    case 'arc': out.push(['cen', e.c], ['end', [e.c[0] + e.r * Math.cos(e.a0), e.c[1] + e.r * Math.sin(e.a0)]], ['end', [e.c[0] + e.r * Math.cos(e.a1), e.c[1] + e.r * Math.sin(e.a1)]]); break;
    case 'dim': out.push(['end', e.a], ['end', e.b]); break;
    case 'text': out.push(['ins', e.p]); break;
    case 'hatch': case 'cloud': e.pts.forEach(p => out.push(['end', p])); break;
    case 'leader': e.pts.forEach(p => out.push(['end', p])); break;
    case 'insert': out.push(['ins', e.p]); for (const c of expandInsert(e, BLOCKS)) out.push(...entSnaps(c)); break;
    case 'rdim': case 'adim': out.push(['cen', e.c]); break;
  }
  return out;
}
export function elSnaps(el, host) {
  const out = [];
  if (el.a && el.b) out.push(['end', el.a], ['end', el.b], ['mid', mid(el.a, el.b)]);
  if (el.p) out.push(['cen', el.p]);
  const o = elOutline(el, host); if (o) { o.forEach(p => out.push(['end', p])); }
  return out;
}

// 점과의 거리(선택용)
export function distToSegs(p, segs) { let d = Infinity; for (const [a, b] of segs) { const c = closestOnSeg(p, a, b); if (c.d < d) d = c.d; } return d; }
export function hitEnt(e, p, tol) {
  if (e.t === 'circle') return Math.abs(dist(p, e.c) - e.r) <= tol;
  if (e.t === 'arc') return Math.abs(dist(p, e.c) - e.r) <= tol && angInArc(Math.atan2(p[1] - e.c[1], p[0] - e.c[0]), e.a0, e.a1);
  if (e.t === 'text') return pointInPoly(p, textBox(e)) || distToSegs(p, entSegs(e)) <= tol;
  if (e.t === 'hatch') return pointInPoly(p, e.pts) || distToSegs(p, entSegs(e)) <= tol;
  return distToSegs(p, entSegs(e)) <= tol;
}
export function hitEl(el, p, tol, host) {
  const o = elOutline(el, host); if (!o) return false;
  if (el.k === 'slab' || el.k === 'ceiling' || el.k === 'room') return distToSegs(p, elSegs(el, host)) <= tol; // 면 객체(슬래브·천장·실)는 테두리로만 선택
  if (pointInPoly(p, o)) return true;
  return distToSegs(p, elSegs(el, host)) <= tol;
}
export const bbIn = (b, w) => b && b.x0 >= w.x0 && b.x1 <= w.x1 && b.y0 >= w.y0 && b.y1 <= w.y1;
export const bbHit = (b, w) => b && !(b.x1 < w.x0 || b.x0 > w.x1 || b.y1 < w.y0 || b.y0 > w.y1);
export function segsCrossBox(segs, w) {
  const R = [[w.x0, w.y0], [w.x1, w.y0], [w.x1, w.y1], [w.x0, w.y1]];
  for (const [a, b] of segs) {
    if (a[0] >= w.x0 && a[0] <= w.x1 && a[1] >= w.y0 && a[1] <= w.y1) return true;
    for (let i = 0; i < 4; i++) if (segInt(a, b, R[i], R[(i + 1) % 4])) return true;
  }
  return false;
}

// ---------- 변형 ----------
// f: 점 변환 함수, angDelta: 회전량(rad), mirror: 반전 여부
function xfPoint(o, key, f) { if (o[key]) o[key] = f(o[key]); }
export function transformEnt(e, f, angDelta = 0, mirror = false) {
  const n = deep(e);
  ['a', 'b', 'c', 'p', 'off'].forEach(k => xfPoint(n, k, f));
  if (n.pts) n.pts = n.pts.map(f);
  if (n.t === 'insert') { const q0 = f([0, 0]), q1 = f([1000, 0]); n.sc = (e.sc || 1) * dist(q0, q1) / 1000; n.rot = ((e.rot || 0) + angDelta * 180 / Math.PI); }
  if (n.t === 'rdim') { const q = f([e.c[0] + e.r * Math.cos(e.ang), e.c[1] + e.r * Math.sin(e.ang)]); n.r = dist(n.c, q); n.ang = angOf(n.c, q); }
  if (n.t === 'adim') { const q = f([e.c[0] + e.r, e.c[1]]); n.r = dist(n.c, q); }
  if (n.t === 'leader' || n.t === 'hatch') { if (n.h) { const q0 = f([0, 0]), q1 = f([1000, 0]); n.h = e.h * dist(q0, q1) / 1000; } }
  if (n.t === 'arc') {
    if (mirror) { const p0 = f([e.c[0] + Math.cos(e.a0), e.c[1] + Math.sin(e.a0)]), p1 = f([e.c[0] + Math.cos(e.a1), e.c[1] + Math.sin(e.a1)]); n.a0 = angOf(n.c, p1); n.a1 = angOf(n.c, p0); }
    else { n.a0 += angDelta; n.a1 += angDelta; }
  }
  if (n.t === 'circle' || n.t === 'arc') { const q = f([e.c[0] + e.r, e.c[1]]); n.r = dist(n.c, q); }
  if (n.t === 'text') n.rot = ((e.rot || 0) + angDelta * 180 / Math.PI);
  return n;
}
export function transformEl(el, f, angDelta = 0, mirror = false) {
  const n = deep(el);
  ['a', 'b', 'p'].forEach(k => xfPoint(n, k, f));
  if (n.pts) n.pts = n.pts.map(f);
  if (['column', 'footing', 'furn', 'fin', 'panel', 'light'].includes(n.k)) n.rot = ((el.rot || 0) + angDelta * 180 / Math.PI) % 360;
  if (mirror && n.a && n.b && n.k === 'wall') { /* 벽 방향 유지 */ }
  return n;
}
export const fMove = (d) => (p) => [p[0] + d[0], p[1] + d[1]];
export const fRot = (c, a) => (p) => rot(p, a, c);
export const fScale = (c, s) => (p) => [c[0] + (p[0] - c[0]) * s, c[1] + (p[1] - c[1]) * s];
export const fMirror = (a, b) => (p) => { const d = norm(sub(b, a)); const v = sub(p, a); const pr = mul(d, dot(v, d)); return add(a, sub(mul(pr, 2), v)); };

// ---------- 간격띄우기 ----------
export function offsetEnt(e, d, side) {
  // side: 클릭점. d: 거리(mm)
  if (e.t === 'line' || e.t === 'grid') {
    const n = perp(norm(sub(e.b, e.a))); const s = Math.sign(dot(sub(side, e.a), n)) || 1;
    return { ...deep(e), id: uid('d'), a: add(e.a, mul(n, d * s)), b: add(e.b, mul(n, d * s)) };
  }
  if (e.t === 'circle' || e.t === 'arc') { const out = dist(side, e.c) > e.r; const r = e.r + (out ? d : -d); if (r <= 0) return null; return { ...deep(e), id: uid('d'), r }; }
  if (e.t === 'pline') {
    const pts = e.pts, n = pts.length; if (n < 2) return null;
    // 클릭점이 가까운 세그먼트의 어느 쪽인지로 방향 결정
    let best = 0, bd = Infinity; const segs = entSegs(e); segs.forEach(([a, b], i) => { const c = closestOnSeg(side, a, b); if (c.d < bd) { bd = c.d; best = i; } });
    const [sa, sb] = segs[best]; const sgn = Math.sign(cross(sub(sb, sa), sub(side, sa))) || 1; // 왼쪽 +
    const off = (a, b) => { const nn = perp(norm(sub(b, a))); return [add(a, mul(nn, d * sgn)), add(b, mul(nn, d * sgn))]; };
    const lines = segs.map(([a, b]) => off(a, b));
    const res = [];
    for (let i = 0; i < n; i++) {
      if (!e.closed && (i === 0 || i === n - 1)) { res.push(i === 0 ? lines[0][0] : lines[lines.length - 1][1]); continue; }
      const L1 = lines[(i - 1 + lines.length) % lines.length], L2 = lines[i % lines.length];
      const x = segInt(L1[0], L1[1], L2[0], L2[1], true); res.push(x ? x.p : L2[0]);
    }
    return { ...deep(e), id: uid('d'), pts: res };
  }
  return null;
}

// ---------- 자르기 / 연장 ----------
// 선분(라인) 대상만 정밀 처리. 경계: 다른 모든 세그먼트
export function trimLine(e, pick, boundarySegs) {
  if (e.t !== 'line') return null;
  const ts = [0, 1];
  for (const [a, b] of boundarySegs) { const x = segInt(e.a, e.b, a, b); if (x && x.t > 1e-6 && x.t < 1 - 1e-6) ts.push(x.t); }
  ts.sort((x, y) => x - y);
  const d = sub(e.b, e.a), L2 = dot(d, d) || 1; const tp = dot(sub(pick, e.a), d) / L2;
  let i = 0; while (i < ts.length - 2 && ts[i + 1] < tp) i++;
  const t0 = ts[i], t1 = ts[i + 1];
  if (t0 === 0 && t1 === 1) return { remove: true };
  const P = (t) => add(e.a, mul(d, t)); const out = [];
  if (t0 > 0) out.push({ ...deep(e), id: e.id, a: e.a, b: P(t0) });
  if (t1 < 1) out.push({ ...deep(e), id: out.length ? uid('d') : e.id, a: P(t1), b: e.b });
  return { replace: out };
}
export function extendLine(e, pick, boundarySegs) {
  if (e.t !== 'line') return null;
  const endB = dist(pick, e.b) < dist(pick, e.a); // 가까운 끝을 연장
  const from = endB ? e.a : e.b, to = endB ? e.b : e.a; const d = sub(to, from);
  let best = Infinity, bp = null;
  for (const [a, b] of boundarySegs) {
    const x = segInt(from, to, a, b, true); if (!x) continue;
    const u = cross(sub(a, from), d) / cross(d, sub(b, a));
    // 경계 세그먼트 위에 있고, 끝점 밖(t>1)
    const onB = (() => { const r = sub(b, a); const uu = dot(sub(x.p, a), r) / (dot(r, r) || 1); return uu >= -1e-6 && uu <= 1 + 1e-6; })();
    if (onB && x.t > 1 + 1e-6 && x.t < best) { best = x.t; bp = x.p; }
  }
  if (!bp) return null;
  return endB ? { ...e, b: bp } : { ...e, a: bp };
}
// 모서리(FILLET R=0): 두 선의 교점까지 연장/절단
export function filletZero(e1, p1, e2, p2) {
  const x = segInt(e1.a, e1.b, e2.a, e2.b, true); if (!x) return null;
  const keep = (e, pk) => { const da = dist(pk, e.a), db = dist(pk, e.b); // 클릭점에 가까운 쪽을 유지
    const ta = dot(sub(e.a, x.p), sub(pk, x.p)) > 0, tb = dot(sub(e.b, x.p), sub(pk, x.p)) > 0;
    if (ta && !tb) return { ...e, b: x.p }; if (tb && !ta) return { ...e, a: x.p }; return da > db ? { ...e, b: x.p } : { ...e, a: x.p }; };
  return [keep(e1, p1), keep(e2, p2)];
}

// 교점 스냅: 커서 근처 세그먼트들 사이
export function nearIntersections(segs, p, r) {
  const near = segs.filter(([a, b]) => closestOnSeg(p, a, b).d < r * 3);
  const out = [];
  for (let i = 0; i < near.length && i < 60; i++) for (let j = i + 1; j < near.length && j < 60; j++) { const x = segInt(near[i][0], near[i][1], near[j][0], near[j][1]); if (x && dist(x.p, p) < r) out.push(x.p); }
  return out;
}

// 선 → 객체 자동 인식: 평행선 쌍 → 벽, 작은 닫힌 사각형 → 기둥, 큰 닫힌 폴리선 → 슬래브
export function recognize(ents, opt = {}) {
  const tMin = opt.tMin ?? 80, tMax = opt.tMax ?? 450, colMax = opt.colMax ?? 1500;
  const lines = ents.filter(e => e.t === 'line' && dist(e.a, e.b) > 300);
  const used = new Set(), walls = [], cols = [], slabs = [];
  for (let i = 0; i < lines.length; i++) {
    if (used.has(lines[i].id)) continue; const A = lines[i]; const da = norm(sub(A.b, A.a)); const LA = dist(A.a, A.b);
    let best = null;
    for (let j = 0; j < lines.length; j++) {
      if (i === j || used.has(lines[j].id)) continue; const B = lines[j]; const db = norm(sub(B.b, B.a));
      if (Math.abs(cross(da, db)) > 0.01) continue;
      const nrm = perp(da); const t = Math.abs(dot(sub(B.a, A.a), nrm)); if (t < tMin || t > tMax) continue;
      const s1 = dot(sub(B.a, A.a), da), s2 = dot(sub(B.b, A.a), da); const lo = Math.max(0, Math.min(s1, s2)), hi = Math.min(LA, Math.max(s1, s2));
      if (hi - lo < 0.6 * Math.min(LA, dist(B.a, B.b))) continue;
      if (!best || t < best.t) best = { B, t, lo, hi, nrm, sgn: Math.sign(dot(sub(B.a, A.a), nrm)) };
    }
    if (best) {
      used.add(A.id); used.add(best.B.id);
      const off = mul(best.nrm, best.sgn * best.t / 2);
      const a = add(add(A.a, mul(da, best.lo)), off), b = add(add(A.a, mul(da, best.hi)), off);
      walls.push({ k: 'wall', a, b, t: Math.round(best.t / 10) * 10, mat: 'RC', src: [A.id, best.B.id] });
    }
  }
  for (const e of ents) if (e.t === 'pline' && e.closed && e.pts.length >= 4) {
    const bb = bboxOf(e.pts), w = bb.x1 - bb.x0, d = bb.y1 - bb.y0;
    if (e.pts.length === 4 && w <= colMax && d <= colMax && w > 150 && d > 150) cols.push({ k: 'column', p: [(bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2], w: Math.round(w), d: Math.round(d), rot: 0, mat: 'RC', src: [e.id] });
    else if (w > 3000 && d > 3000) slabs.push({ k: 'slab', pts: deep(e.pts), t: 200, mat: 'RC', src: [e.id] });
  }
  return { walls, cols, slabs };
}
export { elBoxes, boxCorners };

// ---------- 추가 편집 연산 ----------
// 모깎기(반지름 r): [선1', 선2', 호]
export function filletR(e1, p1, e2, p2, r) {
  const x = segInt(e1.a, e1.b, e2.a, e2.b, true); if (!x) return null; const X = x.p;
  const far = (e, pk) => (dot(sub(e.a, X), sub(pk, X)) > 0 && dist(e.a, X) > 1e-6) ? 'a' : 'b';
  const k1 = far(e1, p1), k2 = far(e2, p2);
  const u1 = norm(sub(e1[k1], X)), u2 = norm(sub(e2[k2], X));
  const th = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2)))); if (th < 1e-3 || th > Math.PI - 1e-3) return null;
  const d = r / Math.tan(th / 2); if (d > dist(e1[k1], X) || d > dist(e2[k2], X)) return null;
  const T1 = add(X, mul(u1, d)), T2 = add(X, mul(u2, d)); const bis = norm(add(u1, u2)); const C = add(X, mul(bis, r / Math.sin(th / 2)));
  const n1 = { ...e1, [k1 === 'a' ? 'b' : 'a']: T1 }, n2 = { ...e2, [k2 === 'a' ? 'b' : 'a']: T2 };
  let a0 = angOf(C, T1), a1 = angOf(C, T2); if (cross(sub(T1, C), sub(T2, C)) < 0) [a0, a1] = [a1, a0];
  return [n1, n2, { id: uid('d'), t: 'arc', c: C, r, a0, a1, layer: e1.layer }];
}
// 끊기: 선의 p1~p2 구간 제거
export function breakLine(e, p1, p2) {
  if (e.t !== 'line') return null; const d = sub(e.b, e.a), L2 = dot(d, d) || 1;
  let t1 = Math.max(0, Math.min(1, dot(sub(p1, e.a), d) / L2)), t2 = Math.max(0, Math.min(1, dot(sub(p2, e.a), d) / L2)); if (t1 > t2) [t1, t2] = [t2, t1];
  const P = (t) => add(e.a, mul(d, t)); const out = [];
  if (t1 > 1e-6) out.push({ ...deep(e), b: P(t1) }); if (t2 < 1 - 1e-6) out.push({ ...deep(e), id: out.length ? uid('d') : e.id, a: P(t2) });
  return out;
}
// 결합: 끝점이 이어진 선·폴리선 → 폴리선
export function joinChain(ents, tol = 1) {
  const segs = ents.flatMap(e => e.t === 'line' ? [[e.a, e.b]] : e.t === 'pline' ? [e.pts] : []).map(x => x.length === 2 && !Array.isArray(x[0][0]) ? x : x);
  const parts = segs.map(s => s.slice()); if (!parts.length) return null;
  let chain = parts.shift();
  let progress = true;
  while (parts.length && progress) {
    progress = false;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i], h0 = chain[0], t0 = chain[chain.length - 1];
      if (dist(t0, p[0]) < tol) chain = chain.concat(p.slice(1)); else if (dist(t0, p[p.length - 1]) < tol) chain = chain.concat(p.slice(0, -1).reverse());
      else if (dist(h0, p[p.length - 1]) < tol) chain = p.slice(0, -1).concat(chain); else if (dist(h0, p[0]) < tol) chain = p.slice(1).reverse().concat(chain);
      else continue;
      parts.splice(i, 1); progress = true; break;
    }
  }
  if (parts.length) return null;
  const closed = chain.length > 3 && dist(chain[0], chain[chain.length - 1]) < tol; if (closed) chain.pop();
  return { t: 'pline', pts: chain, closed };
}
// 신축: 창 안의 점만 이동
export function stretchObj(o, w, d) {
  const n = deep(o); const inW = (p) => p[0] >= w.x0 && p[0] <= w.x1 && p[1] >= w.y0 && p[1] <= w.y1; const mv = (p) => inW(p) ? [p[0] + d[0], p[1] + d[1]] : p;
  for (const k of ['a', 'b', 'c', 'p', 'off']) if (n[k]) n[k] = mv(n[k]);
  if (n.pts) n.pts = n.pts.map(mv);
  return n;
}
// 해치 패턴 선(월드 좌표) 생성
export function hatchLines(e, maxLines = 2500) {
  const bb = bboxOf(e.pts); const pat = HATCH[e.pat] || HATCH.ANSI31; const sc = e.sc || 1; const out = [];
  for (const fam of pat) {
    const ang = (fam.ang + (e.ang || 0)) * Math.PI / 180, sp = fam.sp * sc; const dir = [Math.cos(ang), Math.sin(ang)], nrm = [-dir[1], dir[0]];
    const corners = [[bb.x0, bb.y0], [bb.x1, bb.y0], [bb.x1, bb.y1], [bb.x0, bb.y1]];
    const ds = corners.map(c => dot(c, nrm)); const lo = Math.min(...ds), hi = Math.max(...ds); const ls = corners.map(c => dot(c, dir)); const l0 = Math.min(...ls) - 10, l1 = Math.max(...ls) + 10;
    const off = (fam.off || 0) * sc;
    for (let k = Math.ceil((lo - off) / sp); k * sp + off <= hi && out.length < maxLines; k++) {
      const o = k * sp + off; const A = add(mul(nrm, o), mul(dir, l0)), B = add(mul(nrm, o), mul(dir, l1));
      const ts = []; for (let i = 0; i < e.pts.length; i++) { const x = segInt(A, B, e.pts[i], e.pts[(i + 1) % e.pts.length]); if (x) ts.push(x.t); }
      ts.sort((a, b) => a - b);
      for (let i = 0; i + 1 < ts.length; i += 2) {
        const p0 = add(A, mul(sub(B, A), ts[i])), p1 = add(A, mul(sub(B, A), ts[i + 1]));
        if (fam.dash) { const L = dist(p0, p1), dd = fam.dash * sc, gap = (fam.gap || fam.dash) * sc; const u = norm(sub(p1, p0)); const st = ((dot(p0, dir) % (dd + gap)) + dd + gap) % (dd + gap); for (let s = -st; s < L; s += dd + gap) { const s0 = Math.max(0, s), s1 = Math.min(L, s + dd); if (s1 > s0) out.push([add(p0, mul(u, s0)), add(p0, mul(u, s1))]); } }
        else out.push([p0, p1]);
      }
    }
  }
  return out;
}
export const HATCH = {
  ANSI31: [{ ang: 45, sp: 150 }],
  ANSI37: [{ ang: 45, sp: 150 }, { ang: 135, sp: 150 }],
  CONC: [{ ang: 45, sp: 220, dash: 60, gap: 90 }, { ang: 135, sp: 300, dash: 40, gap: 160, off: 70 }],
  BRICK: [{ ang: 0, sp: 75 }, { ang: 90, sp: 230, dash: 75, gap: 75 }],
  EARTH: [{ ang: 0, sp: 120, dash: 120, gap: 120 }, { ang: 90, sp: 120, dash: 120, gap: 120, off: 60 }],
  GRASS: [{ ang: 60, sp: 300, dash: 80, gap: 220 }, { ang: 120, sp: 300, dash: 80, gap: 220 }],
  SOLID: [],
};
export const HATCH_NAMES = { ANSI31: '사선(철근콘크리트)', ANSI37: '격자 사선', CONC: '콘크리트', BRICK: '벽돌', EARTH: '토사', GRASS: '잔디', SOLID: '채움' };

export const lerpPt = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// ---------- Core 1.1.0 객체 인식 (DXF 레이어 기준) ----------
// 레이어 이름으로 실·천장·조명·스프링클러·분전반을 찾는다. 빌더 DXF 내보내기 레이어(I-ROOM 등)와 흔한 한글·영문 레이어명 대응
export const CORE_LAYER_RX = {
  room: /(^|[-_ ])(ROOM|AREA|SPACE)|실명|^실$|실[-_ ]?구획|면적/i,
  ceiling: /CEIL|CLG|천장|반자/i,
  light: /LIGHT|LGT|LITE|LUMIN|조명|등기구/i,
  sprinkler: /SPRINK|SPK|^F-SP|[-_ ]SP$|헤드|스프링/i,
  panel: /PANEL|PNL|분전|^E-P$/i,
};
export function coreLayerKind(layer) { const n = String(layer || ''); for (const [k, rx] of Object.entries(CORE_LAYER_RX)) if (rx.test(n)) return k; return null; }
const closedPts = (e) => { if (e.t !== 'pline') return null; let p = e.pts; if (p.length > 3 && dist(p[0], p[p.length - 1]) < 1) p = p.slice(0, -1); return (e.closed || dist(e.pts[0], e.pts[e.pts.length - 1]) < 1) && p.length >= 3 ? p : null; };
const areaOf = (p) => { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(s / 2); };
// 회전 사각형 → 중심·폭·깊이·회전(°)
function rectOf(p) {
  if (p.length !== 4) { const b = bboxOf(p); return { c: [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2], w: b.x1 - b.x0, d: b.y1 - b.y0, rot: 0 }; }
  const c = [(p[0][0] + p[2][0]) / 2, (p[0][1] + p[2][1]) / 2]; let a = angOf(p[0], p[1]) * 180 / Math.PI; a = Math.round(((a % 180) + 180) % 180 * 10) / 10;
  return { c, w: dist(p[0], p[1]), d: dist(p[1], p[2]), rot: a >= 179.95 ? 0 : a };
}
// 반환: { rooms, ceilings, lights, sprinklers, panels, used:Set(id) } — 각 항목은 객체 속성 + src(원본 요소 id 목록)
export function recognizeCore(ents, opt = {}) {
  const kindOf = opt.kindOf || ((e) => coreLayerKind(e.layer));
  const out = { rooms: [], ceilings: [], lights: [], sprinklers: [], panels: [], used: new Set() };
  const texts = ents.filter(e => e.t === 'text' && e.s);
  const R = (x) => Math.round(x);
  for (const e of ents) {
    const k = kindOf(e); if (!k) continue; const p = closedPts(e);
    if (k === 'room' || k === 'ceiling') {
      if (!p || areaOf(p) < 1e6) continue; // 1㎡ 미만은 제외
      const pts = p.map(q => [R(q[0]), R(q[1])]);
      (k === 'room' ? out.rooms : out.ceilings).push({ k, pts, src: [e.id] });
    } else if (k === 'sprinkler') {
      let c = null; if (e.t === 'circle' && e.r <= 200) c = e.c; else if (p && areaOf(p) <= 300 * 300) c = rectOf(p).c;
      if (!c) continue;
      const dup = out.sprinklers.find(s => dist(s.p, c) < 60); if (dup) { dup.src.push(e.id); continue; }
      out.sprinklers.push({ k, p: [R(c[0]), R(c[1])], src: [e.id] });
    } else if (k === 'light' || k === 'panel') {
      let r = null; if (p) { const a = areaOf(p); if (a >= 100 * 100 && a <= 3000 * 3000) r = rectOf(p); } else if (e.t === 'circle' && e.r >= 50 && e.r <= 600 && k === 'light') r = { c: e.c, w: e.r * 2, d: e.r * 2, rot: 0 };
      if (!r) continue;
      (k === 'light' ? out.lights : out.panels).push({ k, p: [R(r.c[0]), R(r.c[1])], w: R(r.w), d: R(r.d), rot: r.rot, src: [e.id] });
    }
  }
  // 실 안의 문자: 가장 큰 문자 → 실명, 용도 목록과 맞는 단어 → 용도
  const uses = opt.uses || [];
  for (const rm of out.rooms) {
    const inside = texts.filter(t => pointInPoly(t.p, rm.pts) && (kindOf(t) === 'room' || !kindOf(t))).sort((a, b) => (b.h || 0) - (a.h || 0));
    const useOf = (s) => uses.find(n => s === n || s.startsWith(n + ' ') || s.startsWith(n + '·'));
    for (const t of inside) {
      const s = String(t.s).trim();
      if ((s.includes('·') || uses.includes(s)) && useOf(s)) { rm.use ||= useOf(s); if (kindOf(t) === 'room') rm.src.push(t.id); continue; } // 용도 문자 ("사무실 · 46.8㎡ · 500lx" 또는 "사무실")
      if (!rm.name && !/^[\d.,\s㎡m²]+$/.test(s)) { rm.name = s; rm.src.push(t.id); }
    }
    if (!rm.use && rm.name) rm.use = useOf(rm.name); // 실명에서 용도 추정 ("회의실 2" → 회의실)
  }
  // 조명 회로·분전반 계통 문자 (같은 레이어, 가까운 문자)
  const near = (p, k, max) => texts.filter(t => kindOf(t) === k).map(t => ({ t, d: dist(t.p, p) })).filter(x => x.d <= max).sort((a, b) => a.d - b.d)[0]?.t;
  for (const l of out.lights) { const t = near(l.p, 'light', Math.max(l.w, l.d) + 400); if (t) { l.circuit = String(t.s).trim(); l.src.push(t.id); } }
  for (const pn of out.panels) { const t = near(pn.p, 'panel', Math.max(pn.w, pn.d) + 3000); if (t) { const m = String(t.s).match(/전등|전열|동력|비상/); if (m) pn.sys = m[0]; pn.src.push(t.id); } }
  // 천장 CH 문자
  for (const cl of out.ceilings) { const t = texts.find(t => kindOf(t) === 'ceiling' && pointInPoly(t.p, cl.pts) && /CH/i.test(t.s)); if (t) { const m = String(t.s).match(/CH\s*([\d,]+)/i); if (m) cl.z = +m[1].replace(/,/g, ''); const f = String(t.s).replace(/CH\s*[\d,]+/i, '').trim(); if (f) cl.fin = f; cl.src.push(t.id); } }
  for (const g of [out.rooms, out.ceilings, out.lights, out.sprinklers, out.panels]) for (const o of g) o.src.forEach(i => out.used.add(i));
  return out;
}
