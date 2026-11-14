// 리비전 관리: 프로젝트 단위 스냅샷 (Rev1, Rev1.1, Rev1.2, Rev2 …)
import { uid, deep, dist } from './util.js';

// ---- 이전 버전(도면 단위) 호환 ----
export function saveRevision(P, sid, name) {
  P.revs ||= {}; const list = (P.revs[sid] ||= []);
  const r = { id: uid('r'), name: name || `Rev.${list.length}`, at: Date.now(), data: JSON.stringify(P.content[sid]) };
  list.push(r); if (list.length > 20) list.shift(); return r;
}
export const revisions = (P, sid) => P.revs?.[sid] || [];

const strip = (o) => { const { id, ...r } = o; return JSON.stringify(r); };
// 반환: { added:[obj], removed:[obj], changed:[{now, old}], same }
export function diffContent(oldC, newC) {
  const mk = (c) => new Map([...(c?.ents || []), ...(c?.els || [])].map(o => [o.id, o]));
  const A = mk(oldC), B = mk(newC); const out = { added: [], removed: [], changed: [], same: 0 };
  for (const [id, o] of B) { const p = A.get(id); if (!p) out.added.push(o); else if (strip(p) !== strip(o)) out.changed.push({ now: o, old: p }); else out.same++; }
  for (const [id, o] of A) if (!B.has(id)) out.removed.push(o);
  return out;
}

// ---- 프로젝트 리비전 ----
export const revKey = (P, id) => `pr_${P.id}_${id}`;
export const revName = (major, minor) => minor ? `Rev${major}.${minor}` : `Rev${major}`;
export function nextRev(P, kind) {
  const L = P.prevs || []; const last = L[L.length - 1];
  if (!last) return { major: 1, minor: 0 };
  return kind === 'major' ? { major: last.major + 1, minor: 0 } : { major: last.major, minor: last.minor + 1 };
}
export const snapshotOf = (P) => ({ sheets: deep(P.sheets), levels: deep(P.levels), content: deep(P.content) });

// 프로젝트 전체 비교 → 객체별 상태
export function diffProject(oldS, newS) {
  const res = { status: {}, added: 0, changed: 0, removed: 0, removedObjs: [], bySheet: {}, moved: {} };
  const ids = new Set([...(oldS?.sheets || []).map(s => s.id), ...(newS?.sheets || []).map(s => s.id)]);
  for (const sid of ids) {
    const d = diffContent(oldS?.content?.[sid], newS?.content?.[sid]);
    res.bySheet[sid] = { added: d.added.length, changed: d.changed.length, removed: d.removed.length };
    for (const o of d.added) { res.status[o.id] = 'added'; if (o.k) res.added++; }
    for (const c of d.changed) { res.status[c.now.id] = 'changed'; if (c.now.k) res.changed++; const a = c.old.p || c.old.a, b = c.now.p || c.now.a; if (a && b) res.moved[c.now.id] = dist(a, b); }
    for (const o of d.removed) { res.status[o.id] = 'removed'; if (o.k) { res.removed++; res.removedObjs.push({ el: o, sheet: sid }); } }
  }
  return res;
}
// 저장: 블롭에 스냅샷, 메타에는 목록만
export async function createRev(ctx, { kind = 'minor', note = '' } = {}) {
  const P = ctx.P; P.prevs ||= [];
  const v = nextRev(P, kind); const id = uid('r'); const snap = snapshotOf(P);
  const prev = P.prevs[P.prevs.length - 1]; let stats = null;
  if (prev) { const old = await loadRev(ctx, prev.id); if (old) { const d = diffProject(old, snap); stats = { added: d.added, changed: d.changed, removed: d.removed }; } }
  await ctx.store.putBlob(revKey(P, id), snap, { pid: P.id });
  cache.set(id, snap);
  const r = { id, ...v, name: revName(v.major, v.minor), at: Date.now(), note, stats, base: prev?.id || null };
  P.prevs.push(r); ctx.touch('meta'); return r;
}
const cache = new Map();
export async function loadRev(ctx, id) {
  if (cache.has(id)) return cache.get(id);
  const d = await ctx.store.getBlob(revKey(ctx.P, id)).catch(() => null); if (d) cache.set(id, d); return d;
}
export async function deleteRev(ctx, id) { const P = ctx.P; P.prevs = (P.prevs || []).filter(r => r.id !== id); cache.delete(id); await ctx.store.dropBlob(revKey(P, id)); ctx.touch('meta'); }
// 복원: 현재 상태를 자동 저장한 뒤 되돌림
export async function restoreRev(ctx, id, sheetId = null) {
  const P = ctx.P; const snap = await loadRev(ctx, id); if (!snap) throw new Error('리비전 데이터를 찾을 수 없습니다');
  if (sheetId) { P.content[sheetId] = deep(snap.content[sheetId] || { ents: [], els: [] }); ctx.touch(sheetId); return; }
  P.sheets = deep(snap.sheets); P.levels = deep(snap.levels); P.content = deep(snap.content);
  ctx.touch(['meta', ...P.sheets.map(s => s.id)]);
}
// 객체 집합의 경계 박스(구름 표시용)
export function clusterBoxes(items, gap = 1500) {
  const boxes = items.map(b => ({ ...b }));
  let merged = true;
  while (merged) { merged = false; for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; if (a.x0 - gap <= b.x1 && b.x0 - gap <= a.x1 && a.y0 - gap <= b.y1 && b.y0 - gap <= a.y1) { a.x0 = Math.min(a.x0, b.x0); a.y0 = Math.min(a.y0, b.y0); a.x1 = Math.max(a.x1, b.x1); a.y1 = Math.max(a.y1, b.y1); boxes.splice(j, 1); merged = true; break; } if (merged) break; } }
  return boxes;
}
