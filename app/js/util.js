// 빌더 공통 유틸
export const uid = (p = '') => p + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const round = (v, d = 2) => { const f = 10 ** d; return Math.round(v * f) / f; };
export const deep = (o) => JSON.parse(JSON.stringify(o));
export const fmt = (v, d = 2) => (v == null || isNaN(v)) ? '-' : Number(v).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmt0 = (v) => fmt(v, 0);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 2D 벡터
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const mul = (a, s) => [a[0] * s, a[1] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const len = (a) => Math.hypot(a[0], a[1]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
export const perp = (a) => [-a[1], a[0]];
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const mid = (a, b) => lerp(a, b, 0.5);
export const rot = (p, ang, c = [0, 0]) => { const s = Math.sin(ang), k = Math.cos(ang), x = p[0] - c[0], y = p[1] - c[1]; return [c[0] + x * k - y * s, c[1] + x * s + y * k]; };
export const angOf = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);

// 선분 교차 (t,u 매개변수)
export function segInt(a, b, c, d, inf = false) {
  const r = sub(b, a), s = sub(d, c), den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(c, a), s) / den, u = cross(sub(c, a), r) / den;
  if (!inf && (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9)) return null;
  return { p: add(a, mul(r, t)), t, u };
}
// 점-선분 최근접
export function closestOnSeg(p, a, b) {
  const ab = sub(b, a), l2 = dot(ab, ab);
  if (l2 < 1e-12) return { p: a, t: 0, d: dist(p, a) };
  const t = clamp(dot(sub(p, a), ab) / l2, 0, 1), q = add(a, mul(ab, t));
  return { p: q, t, d: dist(p, q) };
}
export function polyArea(pts) { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
export function polyPerim(pts, closed = true) { let s = 0; const n = pts.length; for (let i = 0; i < (closed ? n : n - 1); i++) s += dist(pts[i], pts[(i + 1) % n]); return s; }
export function pointInPoly(p, pts) { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if (((a[1] > p[1]) !== (b[1] > p[1])) && (p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0])) c = !c; } return c; }
export function bboxOf(pts) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1]; } return { x0, y0, x1, y1 }; }

// 간단한 이벤트 버스
export function createBus() {
  const m = new Map();
  return {
    on(ev, fn) { if (!m.has(ev)) m.set(ev, new Set()); m.get(ev).add(fn); return () => m.get(ev)?.delete(fn); },
    emit(ev, data) { for (const fn of m.get(ev) || []) { try { fn(data); } catch (e) { console.error(e); } } },
  };
}
export function debounce(fn, ms) { let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.flush = (...a) => { clearTimeout(t); fn(...a); }; return f; }
export function csv(rows) { return '﻿' + rows.map(r => r.map(c => { const s = String(c ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n'); }
