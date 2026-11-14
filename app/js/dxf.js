// DXF 가져오기/내보내기 (ASCII DXF, 단위 mm 가정)
import { elOutline, KINDS } from './model.js';
import { dist, uid } from './util.js';
import { expandInsert } from './blocks.js';

const ACI = { 1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff', 5: '#0000ff', 6: '#ff00ff', 7: '#ffffff', 8: '#808080', 9: '#c0c0c0', 30: '#ff7f00', 40: '#ffbf00', 140: '#7fbfff', 250: '#333333', 251: '#505050', 252: '#696969', 253: '#828282', 254: '#bebebe', 255: '#ffffff' };
export const aciToHex = (n) => ACI[Math.abs(n)] || '#ffffff';
const HEX2ACI = (hex) => { let best = 7, bd = 1e9; const h = parseInt((hex || '#ffffff').slice(1), 16), r = h >> 16, g = (h >> 8) & 255, b = h & 255; for (const [k, v] of Object.entries(ACI)) { const q = parseInt(v.slice(1), 16), d = (r - (q >> 16)) ** 2 + (g - ((q >> 8) & 255)) ** 2 + (b - (q & 255)) ** 2; if (d < bd) { bd = d; best = +k; } } return best; };

function pairs(text) {
  const L = text.split(/\r?\n/), out = [];
  for (let i = 0; i + 1 < L.length; i += 2) out.push([parseInt(L[i].trim(), 10), L[i + 1].replace(/\s+$/, '')]);
  return out;
}
function decodeText(s) {
  return s.replace(/\\U\+([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\P/g, ' ').replace(/\{\\[^;]*;|\}|\\[A-Za-z][^;]*;/g, '').replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±');
}

// 반환: {ents, layers:[{name,color}], stats}
export function parseDXF(text) {
  const P = pairs(text);
  const layers = new Map(), blocks = new Map();
  let i = 0;
  const readEntity = () => { // P[i] = [0, TYPE]
    const type = P[i][1], g = []; i++;
    while (i < P.length && P[i][0] !== 0) { g.push(P[i]); i++; }
    return { type, g };
  };
  const val = (g, c, d) => { const x = g.find(p => p[0] === c); return x ? x[1] : d; };
  const num = (g, c, d = 0) => { const v = val(g, c); return v == null ? d : parseFloat(v); };
  const raw = []; // 엔티티 원본 (블록 정의 포함)
  let section = null, curBlock = null, polyOpen = null;
  while (i < P.length) {
    const [c, v] = P[i];
    if (c !== 0) { i++; continue; }
    if (v === 'SECTION') { section = P[i + 1]?.[1]; i += 2; continue; }
    if (v === 'ENDSEC') { section = null; i++; continue; }
    if (v === 'EOF') break;
    if (section === 'TABLES' && v === 'LAYER') {
      const e = readEntity(); const name = val(e.g, 2); if (name) layers.set(name, { name, color: aciToHex(num(e.g, 62, 7)) }); continue;
    }
    if (section === 'BLOCKS' && v === 'BLOCK') { const e = readEntity(); curBlock = { name: val(e.g, 2), base: [num(e.g, 10), num(e.g, 20)], ents: [] }; blocks.set(curBlock.name, curBlock); continue; }
    if (section === 'BLOCKS' && v === 'ENDBLK') { curBlock = null; readEntity(); continue; }
    if (section === 'ENTITIES' || (section === 'BLOCKS' && curBlock)) {
      const e = readEntity(); const target = curBlock ? curBlock.ents : raw;
      if (e.type === 'POLYLINE') { polyOpen = { type: 'POLYLINE', g: e.g, verts: [] }; target.push(polyOpen); continue; }
      if (e.type === 'VERTEX' && polyOpen) { polyOpen.verts.push([num(e.g, 10), num(e.g, 20)]); continue; }
      if (e.type === 'SEQEND') { polyOpen = null; continue; }
      target.push(e); continue;
    }
    i++;
  }
  const ents = []; const stats = {}; let skipped = 0;
  const T = (p, m) => [m.a * p[0] + m.c * p[1] + m.e, m.b * p[0] + m.d * p[1] + m.f];
  const mScale = (m) => Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
  const mAng = (m) => Math.atan2(m.b, m.a);
  const conv = (e, m, depth, inLayer) => {
    let layer = val(e.g, 8, '0'); if (layer === '0' && inLayer) layer = inLayer;
    const push = (o) => { o.id = uid('d'); o.layer = layer; ents.push(o); stats[o.t] = (stats[o.t] || 0) + 1; };
    switch (e.type) {
      case 'LINE': push({ t: 'line', a: T([num(e.g, 10), num(e.g, 20)], m), b: T([num(e.g, 11), num(e.g, 21)], m) }); break;
      case 'LWPOLYLINE': {
        const xs = e.g.filter(p => p[0] === 10).map(p => +p[1]), ys = e.g.filter(p => p[0] === 20).map(p => +p[1]);
        const pts = xs.map((x, k) => T([x, ys[k]], m)); if (pts.length > 1) push({ t: 'pline', pts, closed: !!(num(e.g, 70) & 1) }); break;
      }
      case 'POLYLINE': { const pts = e.verts.map(p => T(p, m)); if (pts.length > 1) push({ t: 'pline', pts, closed: !!(num(e.g, 70) & 1) }); break; }
      case 'CIRCLE': push({ t: 'circle', c: T([num(e.g, 10), num(e.g, 20)], m), r: num(e.g, 40) * mScale(m) }); break;
      case 'ARC': { const r0 = mAng(m); push({ t: 'arc', c: T([num(e.g, 10), num(e.g, 20)], m), r: num(e.g, 40) * mScale(m), a0: num(e.g, 50) * Math.PI / 180 + r0, a1: num(e.g, 51) * Math.PI / 180 + r0 }); break; }
      case 'TEXT': case 'MTEXT': {
        let s = val(e.g, 1, ''); if (e.type === 'MTEXT') s = e.g.filter(p => p[0] === 3).map(p => p[1]).join('') + s;
        push({ t: 'text', p: T([num(e.g, 10), num(e.g, 20)], m), h: num(e.g, 40, 250) * mScale(m), s: decodeText(s), rot: num(e.g, 50) + mAng(m) * 180 / Math.PI }); break;
      }
      case 'INSERT': case 'DIMENSION': {
        const b = blocks.get(val(e.g, 2)); if (!b || depth > 5) { skipped++; break; }
        const sx = e.type === 'INSERT' ? num(e.g, 41, 1) : 1, sy = e.type === 'INSERT' ? num(e.g, 42, 1) : 1, ang = (e.type === 'INSERT' ? num(e.g, 50) : 0) * Math.PI / 180;
        const ix = e.type === 'INSERT' ? num(e.g, 10) : 0, iy = e.type === 'INSERT' ? num(e.g, 20) : 0;
        const c = Math.cos(ang), s = Math.sin(ang);
        // local = R*S*(p - base) + ins
        const L = { a: c * sx, b: s * sx, c: -s * sy, d: c * sy, e: 0, f: 0 };
        L.e = ix - (L.a * b.base[0] + L.c * b.base[1]); L.f = iy - (L.b * b.base[0] + L.d * b.base[1]);
        const M = { a: m.a * L.a + m.c * L.b, b: m.b * L.a + m.d * L.b, c: m.a * L.c + m.c * L.d, d: m.b * L.c + m.d * L.d, e: m.a * L.e + m.c * L.f + m.e, f: m.b * L.e + m.d * L.f + m.f };
        for (const be of b.ents) conv(be, M, depth + 1, layer);
        break;
      }
      default: skipped++;
    }
  };
  const I = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  for (const e of raw) conv(e, I, 0);
  stats.skipped = skipped;
  return { ents, layers: [...layers.values()], stats };
}

// ---------- 내보내기 (R12) ----------
export function toDXF(P, sheetIds, opts = {}) {
  const out = []; const w = (c, v) => out.push(String(c), String(v));
  const layerSet = new Map([['0', '#ffffff']]);
  const ents = [];
  const L = (layer, color) => { if (!layerSet.has(layer)) layerSet.set(layer, color || '#ffffff'); return layer; };
  for (const sid of sheetIds) {
    const c = P.content[sid]; if (!c) continue;
    const host = (id) => c.els.find(e => e.id === id);
    const norm1 = (e) => {
      if (e.t === 'insert') return expandInsert(e, P.blocks).flatMap(norm1);
      if (e.t === 'hatch') return [{ t: 'pline', pts: e.pts, closed: true, layer: e.layer }];
      if (e.t === 'cloud') return [{ t: 'pline', pts: e.pts, closed: true, layer: e.layer }, ...(e.label ? [{ t: 'text', p: e.pts[2] || e.pts[0], h: 300, s: 'REV ' + e.label, layer: e.layer }] : [])];
      if (e.t === 'leader') return [{ t: 'pline', pts: e.pts, closed: false, layer: e.layer }, ...(e.s ? [{ t: 'text', p: e.pts[e.pts.length - 1], h: e.h || 250, s: e.s, layer: e.layer }] : [])];
      if (e.t === 'rdim') { const p = [e.c[0] + e.r * Math.cos(e.ang), e.c[1] + e.r * Math.sin(e.ang)]; return [{ t: 'line', a: e.c, b: p, layer: e.layer }, { t: 'text', p: [(e.c[0] + p[0]) / 2, (e.c[1] + p[1]) / 2], h: 250, s: 'R' + Math.round(e.r), layer: e.layer }]; }
      if (e.t === 'adim') { const a0 = Math.atan2(e.a[1] - e.c[1], e.a[0] - e.c[0]), a1 = Math.atan2(e.b[1] - e.c[1], e.b[0] - e.c[0]); const deg = ((a1 - a0) * 180 / Math.PI + 360) % 360; return [{ t: 'arc', c: e.c, r: e.r, a0, a1, layer: e.layer }, { t: 'text', p: [e.c[0] + e.r * Math.cos(a0 + deg * Math.PI / 360), e.c[1] + e.r * Math.sin(a0 + deg * Math.PI / 360)], h: 250, s: deg.toFixed(1) + '%%d', layer: e.layer }]; }
      return [e];
    };
    for (const e0 of c.ents) for (const e of norm1(e0)) ents.push({ ...e, layer: L(e.layer || '0', (P.layers || []).find(l => l.name === e.layer)?.color) });
    for (const el of c.els) {
      const o = elOutline(el, host); if (!o) continue;
      const lay = L(`${KINDS[el.k]?.disc || 'A'}-${el.k.toUpperCase()}`, el.k === 'column' ? '#ffff00' : el.k === 'wall' ? '#ffffff' : '#00ffff');
      ents.push({ t: 'pline', pts: o, closed: true, layer: lay });
    }
  }
  w(0, 'SECTION'); w(2, 'HEADER'); w(9, '$ACADVER'); w(1, 'AC1009'); w(9, '$INSUNITS'); w(70, 4); w(0, 'ENDSEC');
  w(0, 'SECTION'); w(2, 'TABLES'); w(0, 'TABLE'); w(2, 'LAYER'); w(70, layerSet.size);
  for (const [n, col] of layerSet) { w(0, 'LAYER'); w(2, n.replace(/[<>/\\":;?*|=`]/g, '_')); w(70, 0); w(62, HEX2ACI(col)); w(6, 'CONTINUOUS'); }
  w(0, 'ENDTAB'); w(0, 'ENDSEC');
  w(0, 'SECTION'); w(2, 'ENTITIES');
  const f = (n) => (+n).toFixed(4);
  const line = (a, b, lay) => { w(0, 'LINE'); w(8, lay); w(10, f(a[0])); w(20, f(a[1])); w(30, 0); w(11, f(b[0])); w(21, f(b[1])); w(31, 0); };
  const text = (p, h, s, rot, lay) => { w(0, 'TEXT'); w(8, lay); w(10, f(p[0])); w(20, f(p[1])); w(30, 0); w(40, f(h)); w(1, s); if (rot) w(50, f(rot)); };
  for (const e of ents) {
    const lay = (e.layer || '0').replace(/[<>/\\":;?*|=`]/g, '_');
    if (e.t === 'line' || e.t === 'grid') { line(e.a, e.b, lay); if (e.t === 'grid' && e.label) text(e.a, 400, e.label, 0, lay); }
    else if (e.t === 'pline') { w(0, 'POLYLINE'); w(8, lay); w(66, 1); w(70, e.closed ? 1 : 0); for (const p of e.pts) { w(0, 'VERTEX'); w(8, lay); w(10, f(p[0])); w(20, f(p[1])); w(30, 0); } w(0, 'SEQEND'); w(8, lay); }
    else if (e.t === 'circle') { w(0, 'CIRCLE'); w(8, lay); w(10, f(e.c[0])); w(20, f(e.c[1])); w(30, 0); w(40, f(e.r)); }
    else if (e.t === 'arc') { w(0, 'ARC'); w(8, lay); w(10, f(e.c[0])); w(20, f(e.c[1])); w(30, 0); w(40, f(e.r)); w(50, f(e.a0 * 180 / Math.PI)); w(51, f(e.a1 * 180 / Math.PI)); }
    else if (e.t === 'text') text(e.p, e.h, e.s, e.rot, lay);
    else if (e.t === 'dim') { // 치수: 선 + 문자
      const g = dimGeom(e); line(g.p1, g.p2, lay); line(e.a, g.p1, lay); line(e.b, g.p2, lay); text(g.tp, opts.dimH || 250, e.ovr || String(Math.round(dist(e.a, e.b))), g.ang * 180 / Math.PI, lay);
    }
  }
  w(0, 'ENDSEC'); w(0, 'EOF');
  return out.join('\r\n');
}

// 치수 기하: a,b 측정점, off 치수선 통과점 → 정렬 치수
export function dimGeom(e) {
  const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const o = (e.off[0] - e.a[0]) * nx + (e.off[1] - e.a[1]) * ny;
  const p1 = [e.a[0] + nx * o, e.a[1] + ny * o], p2 = [e.b[0] + nx * o, e.b[1] + ny * o];
  let ang = Math.atan2(uy, ux); if (ang > Math.PI / 2 || ang <= -Math.PI / 2) ang += Math.PI;
  const tp = [(p1[0] + p2[0]) / 2 + nx * 120 * Math.sign(o || 1), (p1[1] + p2[1]) / 2 + ny * 120 * Math.sign(o || 1)];
  return { p1, p2, ang, tp, len: L, o };
}
