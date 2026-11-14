// IFC4 내보내기 — 빌더 모델 → IFC4 (STEP, ReferenceView 수준: 박스·압출 형상, 개구부 보이드, 문·창 채움, 재료·색상·속성)
import { allElements, elBoxes, elName, MATS, levelOf } from './model.js';
import { furnName } from './furn.js';

const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
export function ifcGuid() { let s = B64[Math.floor(Math.random() * 4)]; for (let i = 0; i < 21; i++) s += B64[Math.floor(Math.random() * 64)]; return s; }
// STEP 문자열: ASCII 외 문자는 \X2\HHHH\X0\
export function stepStr(v) {
  if (v == null || v === '') return '$';
  let out = '', run = '';
  const flush = () => { if (run) { out += '\\X2\\' + run + '\\X0\\'; run = ''; } };
  for (const ch of String(v)) {
    const c = ch.codePointAt(0);
    if (c >= 32 && c < 127) { flush(); out += ch === "'" ? "''" : ch === '\\' ? '\\\\' : ch; }
    else if (c < 32) { flush(); out += ' '; }
    else { const units = c > 0xffff ? [0xd800 + ((c - 0x10000) >> 10), 0xdc00 + ((c - 0x10000) & 0x3ff)] : [c]; for (const u of units) run += u.toString(16).toUpperCase().padStart(4, '0'); }
  }
  flush(); return `'${out}'`;
}
const R = (v) => { const x = Math.round(v * 1000) / 1000; if (Math.abs(x) < 1e-9) return '0.'; const s = String(x); return /[.eE]/.test(s) ? s : s + '.'; };
const hex = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(c || ''); const n = m ? parseInt(m[1], 16) : 0xb0b0b0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const SYSCOL = { SA: '#5aa9e6', RA: '#7bd389', OA: '#4ecdc4', EA: '#c9a227', CHWS: '#3a86ff', CHWR: '#8338ec', CDWS: '#06d6a0', CDWR: '#118ab2', CW: '#4dabf7', SD: '#a0785a', FP: '#e63946', BUS: '#ff9f1c', ELEC: '#ffbf69' };

export function writeIFC(P, { onProgress } = {}) {
  const L = []; let n = 0;
  const E = (s) => { n++; L.push(`#${n}=${s};`); return '#' + n; };
  const bx = P.base?.x || 0, by = P.base?.y || 0;
  // ---- 공통 ----
  const units = ['IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)', 'IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)', 'IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)', 'IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)'].map(E);
  const ua = E(`IFCUNITASSIGNMENT((${units.join(',')}))`);
  const O3 = E('IFCCARTESIANPOINT((0.,0.,0.))'), Z = E('IFCDIRECTION((0.,0.,1.))'), O2 = E('IFCCARTESIANPOINT((0.,0.))');
  const WCS = E(`IFCAXIS2PLACEMENT3D(${O3},$,$)`); const A2 = E(`IFCAXIS2PLACEMENT2D(${O2},$)`);
  const nr = -(P.site?.north || 0) * Math.PI / 180; const TN = E(`IFCDIRECTION((${R(Math.sin(-nr))},${R(Math.cos(nr))}))`);
  const ctx = E(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${WCS},${TN})`);
  const body = E(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`);
  const proj = E(`IFCPROJECT('${ifcGuid()}',$,${stepStr(P.name)},${stepStr('빌더 내보내기')},$,$,$,(${ctx}),${ua})`);
  const sitePl = E(`IFCLOCALPLACEMENT($,${WCS})`);
  const lat = P.site?.lat, lng = P.site?.lng; const dms = (v) => { const s = v < 0 ? -1 : 1; v = Math.abs(v); const d = Math.floor(v), m = Math.floor((v - d) * 60), se = Math.floor(((v - d) * 60 - m) * 60); return `(${s * d},${s * m},${s * se})`; };
  const site = E(`IFCSITE('${ifcGuid()}',$,'Site',$,$,${sitePl},$,${stepStr(P.site?.address || '')},.ELEMENT.,${lat != null ? dms(lat) : '$'},${lng != null ? dms(lng) : '$'},0.,$,$)`);
  const bPl = E(`IFCLOCALPLACEMENT(${sitePl},${WCS})`);
  const bldg = E(`IFCBUILDING('${ifcGuid()}',$,${stepStr(P.name)},$,$,${bPl},$,$,.ELEMENT.,$,$,$)`);
  E(`IFCRELAGGREGATES('${ifcGuid()}',$,$,$,${proj},(${site}))`); E(`IFCRELAGGREGATES('${ifcGuid()}',$,$,$,${site},(${bldg}))`);
  // ---- 층 ----
  const lv = [...P.levels].sort((a, b) => a.elev - b.elev); const ST = {};
  for (const l of lv) {
    const pt = E(`IFCCARTESIANPOINT((0.,0.,${R(l.elev)}))`); const pl = E(`IFCLOCALPLACEMENT(${bPl},${E(`IFCAXIS2PLACEMENT3D(${pt},$,$)`)})`);
    ST[l.id] = { id: E(`IFCBUILDINGSTOREY('${ifcGuid()}',$,${stepStr(l.name)},$,$,${pl},$,$,.ELEMENT.,${R(l.elev)})`), pl, L: l, els: [] };
  }
  E(`IFCRELAGGREGATES('${ifcGuid()}',$,$,$,${bldg},(${lv.map(l => ST[l.id].id).join(',')}))`);
  // ---- 재료·스타일 ----
  const matE = {}, styE = {};
  const material = (k) => matE[k] ||= { id: E(`IFCMATERIAL(${stepStr(k)},${stepStr(MATS[k]?.name || '')},$)`), els: [] };
  const style = (key, color, transp = 0) => styE[key] ||= (() => { const [r, g, b] = hex(color); const c = E(`IFCCOLOURRGB($,${R(r)},${R(g)},${R(b)})`); const sh = E(`IFCSURFACESTYLESHADING(${c},${R(transp)})`); return E(`IFCSURFACESTYLE(${stepStr(key)},.BOTH.,(${sh}))`); })();
  // ---- 속성 (같은 값 조합은 공유) ----
  const propE = {}, psetE = {};
  const prop = (k, v) => propE[k + '\u0000' + v] ||= E(`IFCPROPERTYSINGLEVALUE(${stepStr(k)},$,${typeof v === 'number' ? `IFCREAL(${R(v)})` : `IFCLABEL(${stepStr(v)})`},$)`);
  const pset = (o) => { const ks = Object.keys(o).filter(k => o[k] != null && o[k] !== ''); if (!ks.length) return null; const key = ks.map(k => k + '=' + o[k]).join('|'); return psetE[key] ||= { id: E(`IFCPROPERTYSET('${ifcGuid()}',$,'Pset_Builder',$,(${ks.map(k => prop(k, o[k])).join(',')}))`), els: [] }; };

  // 배치 + 압출 형상 (b: elBoxes 박스, 층 좌표)
  const place = (st, x, y, z, ang) => { const p = E(`IFCCARTESIANPOINT((${R(x - bx)},${R(y - by)},${R(z)}))`); const d = Math.abs(ang) > 1e-9 ? E(`IFCDIRECTION((${R(Math.cos(ang))},${R(Math.sin(ang))},0.))`) : '$'; return E(`IFCLOCALPLACEMENT(${st.pl},${E(`IFCAXIS2PLACEMENT3D(${p},${d === '$' ? '$' : Z},${d})`)})`); };
  const shape = (solid, sty) => { if (sty) E(`IFCSTYLEDITEM(${solid},(${sty}),$)`); return E(`IFCPRODUCTDEFINITIONSHAPE($,$,(${E(`IFCSHAPEREPRESENTATION(${body},'Body','SweptSolid',(${solid}))`)}))`); };
  const boxSolid = (b, round = false) => { const prof = round ? E(`IFCCIRCLEPROFILEDEF(.AREA.,$,${A2},${R(Math.max(1, b.hw))})`) : E(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${A2},${R(Math.max(1, 2 * b.hl))},${R(Math.max(1, 2 * b.hw))})`); return E(`IFCEXTRUDEDAREASOLID(${prof},${WCS},${Z},${R(Math.max(1, b.z1 - b.z0))})`); };
  // 수평 부재(덕트·배관·보 등)는 길이 방향 압출이 정석이지만 ReferenceView 호환을 위해 박스(수직 압출)로 표현
  const all = allElements(P); const hostOf = {}; for (const r of all) hostOf[r.el.id] = r;
  const stats = {}; const openings = [];
  const CLS = { wall: 'IFCWALL', column: 'IFCCOLUMN', beam: 'IFCBEAM', slab: 'IFCSLAB', footing: 'IFCFOOTING', duct: 'IFCDUCTSEGMENT', pipe: 'IFCPIPESEGMENT', tray: 'IFCCABLECARRIERSEGMENT', fin: 'IFCMEMBER', furn: 'IFCFURNITURE' };
  const PRE = { slab: '.FLOOR.', footing: '.PAD_FOOTING.', duct: '.RIGIDSEGMENT.', pipe: '.RIGIDSEGMENT.', tray: '.CABLETRAYSEGMENT.', fin: '.MULLION.', beam: '.BEAM.', column: '.COLUMN.', wall: '.STANDARD.', furn: '.NOTDEFINED.' };
  const wallE = {};
  let i = 0;
  for (const r of all) {
    if (++i % 2000 === 0) onProgress?.(`IFC 쓰는 중… ${i}/${all.length}`);
    const el = r.el, lvl = r.level, st = ST[lvl?.id]; if (!st) continue;
    if (el.k === 'opening') { openings.push(r); continue; }
    const host = (id) => hostOf[id]?.el; const bs = elBoxes(el, lvl, host); if (!bs.length) continue; const b = bs[0];
    let cls = CLS[el.k], pre = PRE[el.k] || '.NOTDEFINED.';
    if (el.k === 'riser') { cls = el.form === 'pipe' ? 'IFCPIPESEGMENT' : el.form === 'tray' || el.form === 'bus' ? 'IFCCABLECARRIERSEGMENT' : 'IFCDUCTSEGMENT'; pre = cls === 'IFCCABLECARRIERSEGMENT' ? '.CABLETRAYSEGMENT.' : '.RIGIDSEGMENT.'; }
    if (el.k === 'wall' && el.mat === 'GLASS') { cls = 'IFCCURTAINWALL'; pre = '.NOTDEFINED.'; }
    if (el.k === 'furn' && el.src) { cls = 'IFCBUILDINGELEMENTPROXY'; pre = '.NOTDEFINED.'; }
    if (!cls) continue;
    const z0 = b.z0 - lvl.elev; let solid, pl;
    if (el.k === 'slab') {
      const pts = el.pts.map(p => E(`IFCCARTESIANPOINT((${R(p[0] - bx)},${R(p[1] - by)}))`)); const prof = E(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${E(`IFCPOLYLINE((${[...pts, pts[0]].join(',')}))`)})`);
      solid = E(`IFCEXTRUDEDAREASOLID(${prof},${WCS},${Z},${R(Math.max(1, b.z1 - b.z0))})`); pl = E(`IFCLOCALPLACEMENT(${st.pl},${E(`IFCAXIS2PLACEMENT3D(${E(`IFCCARTESIANPOINT((0.,0.,${R(z0)}))`)},$,$)`)})`);
    } else {
      solid = boxSolid(b, (el.k === 'pipe') || (el.k === 'riser' && el.form === 'pipe')); pl = place(st, b.cx, b.cy, z0, b.ang);
    }
    const color = el.sys ? (SYSCOL[String(el.sys).toUpperCase()] || el.color) : el.k === 'furn' ? (el.color || '#c8b89a') : MATS[el.mat]?.color || '#b0b0b0';
    const sty = style(el.sys ? 'SYS-' + el.sys : el.k === 'furn' ? 'FURN-' + (el.color || '') : el.mat || 'DEFAULT', color, el.mat === 'GLASS' ? 0.55 : 0);
    const name = el.k === 'furn' ? furnName(el.type) : elName(el);
    const id = E(`${cls}('${ifcGuid()}',$,${stepStr(name)},${stepStr(el.room || '')},$,${pl},${shape(solid, sty)},${stepStr(el.tag || el.id)},${pre})`);
    st.els.push(id); stats[cls] = (stats[cls] || 0) + 1;
    if (el.k === 'wall') wallE[el.id] = { id, pl };
    if (el.mat) material(el.mat).els.push(id);
    const ps = pset({ Tag: el.tag, Sheet: r.sheet.name, System: el.sys, Room: el.room, Zone: el.zone, Section: el.sec || el.size, Thickness: el.k === 'wall' || el.k === 'slab' ? el.t : null });
    if (ps) ps.els.push(id);
  }
  // 개구부 → IfcOpeningElement + IfcRelVoidsElement, 문·창 → IfcRelFillsElement
  for (const r of openings) {
    const el = r.el, lvl = r.level, st = ST[lvl?.id]; const hr = hostOf[el.host]; const w = wallE[el.host]; if (!st || !hr || !w) continue;
    const b = elBoxes(el, lvl, () => hr.el)[0]; if (!b) continue; const hl = hr.level || lvl; const z0 = b.z0 - hl.elev; const hst = ST[hl.id] || st;
    const op = E(`IFCOPENINGELEMENT('${ifcGuid()}',$,${stepStr((el.tag || '') + ' 개구부')},$,$,${place(hst, b.cx, b.cy, z0, b.ang)},${shape(boxSolid(b), null)},$,.OPENING.)`);
    E(`IFCRELVOIDSELEMENT('${ifcGuid()}',$,$,$,${w.id},${op})`); stats.IFCOPENINGELEMENT = (stats.IFCOPENINGELEMENT || 0) + 1;
    if (el.kind === 'door' || el.kind === 'window') {
      const t = (hr.el.t || 200) / 2; const fb = { ...b, hw: el.kind === 'window' ? Math.min(40, t) : Math.min(50, t) };
      const sty = style(el.kind === 'window' ? 'GLAZING' : 'DOOR', el.kind === 'window' ? '#9fd4f5' : '#8a6a4a', el.kind === 'window' ? 0.6 : 0);
      const cls = el.kind === 'door' ? 'IFCDOOR' : 'IFCWINDOW';
      const fe = E(`${cls}('${ifcGuid()}',$,${stepStr(el.tag || (el.kind === 'door' ? '문' : '창'))},$,$,${place(hst, b.cx, b.cy, z0, b.ang)},${shape(boxSolid(fb), sty)},${stepStr(el.tag || el.id)},${R(el.h)},${R(el.w)},${el.kind === 'door' ? '.DOOR.' : '.WINDOW.'},$,$)`);
      E(`IFCRELFILLSELEMENT('${ifcGuid()}',$,$,$,${op},${fe})`); hst.els.push(fe); stats[cls] = (stats[cls] || 0) + 1;
      const ps = pset({ Tag: el.tag, Sheet: r.sheet.name }); if (ps) ps.els.push(fe);
    }
  }
  // 관계
  const chunk = (arr, f) => { for (let k = 0; k < arr.length; k += 5000) f(arr.slice(k, k + 5000)); };
  for (const s of Object.values(ST)) if (s.els.length) chunk(s.els, a => E(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${ifcGuid()}',$,$,$,(${a.join(',')}),${s.id})`));
  for (const m of Object.values(matE)) if (m.els.length) chunk(m.els, a => E(`IFCRELASSOCIATESMATERIAL('${ifcGuid()}',$,$,$,(${a.join(',')}),${m.id})`));
  for (const p of Object.values(psetE)) if (p.els.length) chunk(p.els, a => E(`IFCRELDEFINESBYPROPERTIES('${ifcGuid()}',$,$,$,(${a.join(',')}),${p.id})`));
  const now = new Date().toISOString().slice(0, 19);
  const head = `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');\nFILE_NAME(${stepStr((P.name || 'builder') + '.ifc')},'${now}',(''),(''),'Builder','Builder IFC4 exporter','');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n`;
  return { text: head + L.join('\n') + '\nENDSEC;\nEND-ISO-10303-21;\n', stats, count: n };
}
