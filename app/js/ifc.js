// IFC 가져오기 — web-ifc(WASM)로 읽어 빌더 도면·객체로 변환
import { uid } from './util.js';
const WEBIFC = 'https://cdn.jsdelivr.net/npm/web-ifc@0.0.77/web-ifc-api.js';

function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = []; for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  up.pop(); lo.pop(); return lo.concat(up);
}
// 최소 면적 사각형: {c, L(긴변), W(짧은변), ang(긴변 방향)}
function obb(pts) {
  const H = hull(pts); if (H.length < 2) return null; let best = null;
  for (let i = 0; i < H.length; i++) {
    const a = H[i], b = H[(i + 1) % H.length]; const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); const c = Math.cos(ang), s = Math.sin(ang);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const q of H) { const u = q[0] * c + q[1] * s, v = -q[0] * s + q[1] * c; x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v); }
    const area = (x1 - x0) * (y1 - y0); if (!best || area < best.area) { const cu = (x0 + x1) / 2, cv = (y0 + y1) / 2; best = { area, c: [cu * c - cv * s, cu * s + cv * c], du: x1 - x0, dv: y1 - y0, ang }; }
  }
  const long = best.du >= best.dv; return { c: best.c, L: long ? best.du : best.dv, W: long ? best.dv : best.du, ang: long ? best.ang : best.ang + Math.PI / 2, hull: H };
}
const KMAP = (W) => ({
  [W.IFCCOLUMN]: ['column', 'S'], [W.IFCBEAM]: ['beam', 'S'], [W.IFCMEMBER]: ['beam', 'S'], [W.IFCSLAB]: ['slab', 'S'], [W.IFCFOOTING]: ['footing', 'S'],
  [W.IFCWALL]: ['wall', 'A'], [W.IFCWALLSTANDARDCASE]: ['wall', 'A'], [W.IFCCURTAINWALL]: ['wall', 'A'], [W.IFCDOOR]: ['door', 'A'], [W.IFCWINDOW]: ['window', 'A'],
  [W.IFCDUCTSEGMENT]: ['duct', 'M'], [W.IFCPIPESEGMENT]: ['pipe', 'P'], [W.IFCCABLECARRIERSEGMENT]: ['tray', 'E'],
});

export async function readIFC(buf, onProgress = () => { }) {
  onProgress('IFC 엔진 불러오는 중…');
  const W = await import(/* @vite-ignore */ WEBIFC);
  const api = new W.IfcAPI(); api.SetWasmPath(new URL('../lib/', import.meta.url).href, true); await api.Init();
  const mid = api.OpenModel(new Uint8Array(buf), { COORDINATE_TO_ORIGIN: false });
  const vals = (ids) => { const out = []; for (let i = 0; i < ids.size(); i++) out.push(ids.get(i)); return out; };
  const str = (v) => v?.value ?? v ?? '';
  // 단위
  let unitMM = 1000;
  for (const uid0 of vals(api.GetLineIDsWithType(mid, W.IFCSIUNIT))) { const u = api.GetLine(mid, uid0); if (str(u.UnitType) === 'LENGTHUNIT') { const pre = str(u.Prefix); unitMM = pre === 'MILLI' ? 1 : pre === 'CENTI' ? 10 : 1000; } }
  // 층
  const storeys = vals(api.GetLineIDsWithType(mid, W.IFCBUILDINGSTOREY)).map(id => { const l = api.GetLine(mid, id); return { id, name: str(l.Name) || `층${id}`, elev: (Number(str(l.Elevation)) || 0) * unitMM }; }).sort((a, b) => a.elev - b.elev);
  const contain = {}; for (const rid of vals(api.GetLineIDsWithType(mid, W.IFCRELCONTAINEDINSPATIALSTRUCTURE))) { const r = api.GetLine(mid, rid); const st = r.RelatingStructure?.value; for (const e of r.RelatedElements || []) contain[e.value] = st; }
  onProgress('형상 읽는 중…');
  const pts = new Map(); const kmap = KMAP(W);
  api.StreamAllMeshes(mid, (mesh) => {
    const eid = mesh.expressID; const type = api.GetLineType(mid, eid); if (!kmap[type]) return;
    const arr = pts.get(eid) || []; const n = mesh.geometries.size();
    for (let i = 0; i < n; i++) {
      const pg = mesh.geometries.get(i); const geo = api.GetGeometry(mid, pg.geometryExpressID); const v = api.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize()); const m = pg.flatTransformation;
      for (let k = 0; k < v.length; k += 6) { const x = v[k], y = v[k + 1], z = v[k + 2]; arr.push([m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]); }
      geo.delete?.();
    }
    pts.set(eid, arr);
  });
  // web-ifc 출력은 Y-up: (x, 높이, -y)
  let ext = 0; for (const a of pts.values()) for (const p of a) ext = Math.max(ext, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]));
  const k = ext < 3000 ? 1000 : 1; // 미터 출력이면 mm로
  const items = [];
  for (const [eid, a] of pts) {
    if (!a.length) continue; const line = api.GetLine(mid, eid); const [kind, disc] = kmap[api.GetLineType(mid, eid)];
    const P3 = a.map(p => [p[0] * k, -p[2] * k, p[1] * k]); let z0 = Infinity, z1 = -Infinity; for (const p of P3) { z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
    const plan = []; const seen = new Set(); for (const p of P3) { const key = Math.round(p[0]) + ',' + Math.round(p[1]); if (!seen.has(key)) { seen.add(key); plan.push([p[0], p[1]]); } }
    items.push({ eid, kind, disc, guid: str(line.GlobalId) || undefined, name: str(line.Name), cls: api.GetNameFromTypeCode?.(api.GetLineType(mid, eid)) || '', st: contain[eid], z0, z1, ob: obb(plan) });
  }
  api.CloseModel(mid);
  return { storeys, items, unitMM };
}

// 변환: 프로젝트 P 에 층·도면·객체 추가
export function ifcToProject(P, data, { prefix = 'IFC' } = {}) {
  const { storeys, items } = data;
  const lvMap = {}; const lv = storeys.length ? storeys : [{ id: 0, name: '1F', elev: 0 }];
  lv.forEach((s, i) => {
    const next = lv[i + 1]; const height = next ? next.elev - s.elev : Math.max(3000, Math.max(...items.filter(it => it.st === s.id).map(it => it.z1 - s.elev), 0));
    let L = P.levels.find(l => Math.abs(l.elev - s.elev) < 50); if (!L) { L = { id: uid('L'), name: s.name, elev: Math.round(s.elev), height: Math.round(height) }; P.levels.push(L); }
    lvMap[s.id] = L;
  });
  const levelFor = (it) => lvMap[it.st] || [...P.levels].sort((a, b) => a.elev - b.elev).filter(l => l.elev <= it.z0 + 50).pop() || P.levels[0];
  const sheetFor = {}; const sheet = (disc, L) => { const key = disc + L.id; if (!sheetFor[key]) { const s = { id: uid('s'), name: `${prefix}-${disc} ${L.name}`, disc, level: L.id }; P.sheets.push(s); P.content[s.id] = { ents: [], els: [] }; sheetFor[key] = s; } return sheetFor[key]; };
  const R = (v) => Math.round(v); const stats = {};
  const walls = [];
  const deg = (r) => ((r * 180 / Math.PI) % 180 + 180) % 180;
  for (const it of items.filter(i => !['door', 'window'].includes(i.kind))) {
    if (!it.ob) continue; const L = levelFor(it); const s = sheet(it.disc, L); const o = it.ob; const H = it.z1 - it.z0; const dir = [Math.cos(o.ang), Math.sin(o.ang)];
    const a = [R(o.c[0] - dir[0] * o.L / 2), R(o.c[1] - dir[1] * o.L / 2)], b = [R(o.c[0] + dir[0] * o.L / 2), R(o.c[1] + dir[1] * o.L / 2)];
    let el = null;
    switch (it.kind) {
      case 'column': el = { k: 'column', p: [R(o.c[0]), R(o.c[1])], w: R(o.L), d: R(o.W), rot: R(deg(o.ang)), mat: 'RC', h: Math.abs(H - L.height) > 20 ? R(H) : undefined }; break;
      case 'footing': el = { k: 'footing', p: [R(o.c[0]), R(o.c[1])], w: R(o.L), d: R(o.W), t: R(H), mat: 'RC' }; break;
      case 'beam': el = { k: 'beam', a, b, w: R(o.W), d: R(H), mat: 'RC', dz: R(it.z1 - (L.elev + L.height)) || undefined }; break;
      case 'slab': el = { k: 'slab', pts: o.hull.length <= 12 ? o.hull.map(p => [R(p[0]), R(p[1])]) : [[-o.L / 2, -o.W / 2], [o.L / 2, -o.W / 2], [o.L / 2, o.W / 2], [-o.L / 2, o.W / 2]].map(([u, v]) => [R(o.c[0] + u * dir[0] - v * dir[1]), R(o.c[1] + u * dir[1] + v * dir[0])]), t: R(H), mat: 'RC', dz: R(it.z1 - L.elev) || undefined }; break;
      case 'wall': el = { k: 'wall', a, b, t: R(o.W), mat: /CURTAIN/i.test(it.cls) ? 'GLASS' : 'RC', h: Math.abs(H - L.height) > 20 ? R(H) : undefined, z0: R(it.z0 - L.elev) || undefined }; walls.push({ el, s }); break;
      case 'duct': case 'tray': el = { k: it.kind, a, b, w: R(o.W), hh: R(H), z: R((it.z0 + it.z1) / 2 - L.elev), sys: it.name || '' }; break;
      case 'pipe': el = { k: 'pipe', a, b, w: R(Math.max(o.W, H)), hh: R(Math.max(o.W, H)), z: R((it.z0 + it.z1) / 2 - L.elev), sys: it.name || '' }; break;
    }
    if (!el) continue; for (const k2 of Object.keys(el)) if (el[k2] === undefined) delete el[k2];
    el.id = uid('e'); el.tag = it.name || undefined; el.ifc = it.eid; if (it.guid) el.guid = it.guid; if (!el.tag) delete el.tag; P.content[s.id].els.push(el); stats[it.kind] = (stats[it.kind] || 0) + 1;
  }
  // 문·창 → 가까운 벽의 개구부
  for (const it of items.filter(i => i.kind === 'door' || i.kind === 'window')) {
    if (!it.ob) continue; const L = levelFor(it); let best = null, bd = 1e9;
    for (const w of walls) { if (w.s.level !== L.id) continue; const e = w.el; const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], l2 = dx * dx + dy * dy || 1; const t = ((it.ob.c[0] - e.a[0]) * dx + (it.ob.c[1] - e.a[1]) * dy) / l2; const q = [e.a[0] + dx * t, e.a[1] + dy * t]; const d = Math.hypot(q[0] - it.ob.c[0], q[1] - it.ob.c[1]); if (t >= -0.05 && t <= 1.05 && d < bd) { bd = d; best = { w, t, len: Math.sqrt(l2) }; } }
    if (!best || bd > 600) { stats.skippedOpenings = (stats.skippedOpenings || 0) + 1; continue; }
    const s0 = best.t * best.len - it.ob.L / 2; P.content[best.w.s.id].els.push({ id: uid('e'), k: 'opening', host: best.w.el.id, s: R(Math.max(0, s0)), w: R(it.ob.L), h: R(it.z1 - it.z0), sill: R(it.z0 - L.elev), kind: it.kind === 'window' ? 'window' : 'door', tag: it.name || undefined, ifc: it.eid, ...(it.guid ? { guid: it.guid } : {}) });
    stats[it.kind] = (stats[it.kind] || 0) + 1;
  }
  return { stats, sheets: Object.values(sheetFor) };
}
