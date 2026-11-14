// 엑셀(xlsx) 읽기·쓰기 — SheetJS를 필요할 때만 불러옴
import { loadScript } from './ui.js';
export const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
export async function xlsx() { if (!window.XLSX) await loadScript(XLSX_URL); return window.XLSX; }
export async function readSheets(file) {
  const X = await xlsx(); const wb = X.read(await file.arrayBuffer(), { type: 'array' });
  return wb.SheetNames.map(n => ({ name: n, rows: X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }) }));
}
export async function writeBook(sheets) { // sheets: [{name, rows:[[...]] , widths?}]
  const X = await xlsx(); const wb = X.utils.book_new();
  for (const s of sheets) { const ws = X.utils.aoa_to_sheet(s.rows); if (s.widths) ws['!cols'] = s.widths.map(w => ({ wch: w })); X.utils.book_append_sheet(wb, ws, s.name.slice(0, 31)); }
  return new Blob([X.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
// ---- 청구서 해석 ----
const KEY = { name: /(명\s*칭|품\s*명|공\s*종|항\s*목|내\s*역|공사명|세부)/, code: /(코드|code|번호)/i, unit: /(단\s*위)/, qty: /(수\s*량|물\s*량)/, amt: /(금\s*액)/, now: /(금\s*회|당\s*회|이\s*번|금\s*월|청\s*구)/, cum: /(누\s*계)/, prev: /(전\s*회|기\s*성\s*누계|전\s*월)/ };
export function detectColumns(rows) {
  let best = { score: -1 };
  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const row = rows[r].map(c => String(c || '')); // 2줄 머리글 지원: 다음 줄과 합침
    const nxt = (rows[r + 1] || []).map(c => String(c || ''));
    const hdr = row.map((c, i) => (c + ' ' + (nxt[i] || '')).trim());
    const find = (re, pref) => { let idx = -1; hdr.forEach((c, i) => { if (re.test(c) && (idx < 0 || (pref && pref.test(c)))) idx = i; }); return idx; };
    const name = find(KEY.name), unit = find(KEY.unit), code = find(KEY.code);
    const qtyCols = hdr.map((c, i) => KEY.qty.test(c) ? i : -1).filter(i => i >= 0);
    const qty = qtyCols.find(i => KEY.now.test(hdr[i])) ?? qtyCols.find(i => !KEY.cum.test(hdr[i]) && !KEY.prev.test(hdr[i])) ?? qtyCols[0] ?? -1;
    const score = (name >= 0) * 2 + (qty >= 0) * 2 + (unit >= 0) + (code >= 0);
    if (score > best.score) best = { score, header: r, two: nxt.some(c => KEY.qty.test(c) || KEY.now.test(c)), name, unit, code, qty, hdr };
  }
  return best;
}
const NAMEMAP = [[/레미콘|콘크리트|타설/, 'CON'], [/거푸집|형틀|유로폼|알폼/, 'FRM'], [/철근|가공|조립.*철근|SD[34]/i, 'RBR'], [/철골|H형강|강구조/, 'STL'], [/벽돌|조적|블록/, 'CMU'], [/경량|스터드|석고/, 'DRY'], [/커튼월|유리/, 'GLZ'], [/(^|[^창])문|도어|door/i, 'DOR'], [/창호|창문|window/i, 'WIN'], [/덕트|duct/i, 'DCT'], [/배관|파이프|pipe/i, 'PIP'], [/트레이|tray|케이블/i, 'TRY']];
const norm = (s) => String(s || '').replace(/[\s()\[\]·,\-_/]/g, '').toLowerCase();
export function matchBoq(name, unit, code, boq) {
  if (code) { const b = boq.find(x => x.code.toUpperCase() === String(code).trim().toUpperCase()); if (b) return { code: b.code, conf: 1 }; }
  const n = norm(name); if (!n) return { code: '', conf: 0 };
  const exact = boq.find(b => norm(b.name) === n); if (exact) return { code: exact.code, conf: 0.95 };
  // 글자 2-gram 유사도
  const grams = (s) => { const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
  const G = grams(n); let best = { code: '', conf: 0 };
  for (const b of boq) { const H = grams(norm(b.name)); let inter = 0; for (const x of G) if (H.has(x)) inter++; let sc = (2 * inter) / ((G.size + H.size) || 1); if (unit && b.unit && norm(unit) === norm(b.unit)) sc += 0.1; if (sc > best.conf) best = { code: b.code, conf: Math.min(0.9, sc) }; }
  for (const [re, c] of NAMEMAP) if (re.test(name) && boq.some(b => b.code === c)) { const sc = 0.7 + (unit && norm(boq.find(b => b.code === c).unit) === norm(unit) ? 0.15 : 0); if (sc > best.conf) best = { code: c, conf: sc }; break; }
  return best.conf >= 0.35 ? best : { code: '', conf: best.conf };
}
export const num = (v) => { if (typeof v === 'number') return v; const x = parseFloat(String(v || '').replace(/[,\s]/g, '')); return isNaN(x) ? null : x; };
