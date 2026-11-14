// 빌더 법규 — 건축개요(대지·건축·연면적, 건폐율·용적률, 높이·층수) + 정북일조 사선 + 초고층 피난안전구역 안내
import { h, toast, dialog, saveFile, table } from '../js/ui.js';
import { allElements, elBoxes, boxCorners, levelOf, elName, DISC } from '../js/model.js';
import { fmt, fmt0, esc, polyArea, bboxOf } from '../js/util.js';

// 용도지역별 상한 (서울특별시 도시계획 조례 기준 — 지자체마다 다르므로 수정 가능)
export const ZONES = {
  '제1종전용주거지역': [50, 100], '제2종전용주거지역': [40, 120], '제1종일반주거지역': [60, 150], '제2종일반주거지역': [60, 200], '제3종일반주거지역': [50, 250], '준주거지역': [60, 400],
  '중심상업지역': [60, 1000], '일반상업지역': [60, 800], '근린상업지역': [60, 600], '유통상업지역': [60, 600], '준공업지역': [60, 400], '자연녹지지역': [20, 50],
};
const SUN_ZONES = /전용주거|일반주거/;

// ---------- 래스터 (순수 JS) ----------
function raster(ext, res) { const W = Math.max(4, Math.ceil((ext.x1 - ext.x0) / res) + 4), H = Math.max(4, Math.ceil((ext.y1 - ext.y0) / res) + 4); return { W, H, res, x0: ext.x0 - 2 * res, y0: ext.y0 - 2 * res, m: new Uint8Array(W * H) }; }
function fillPoly(R, pts, v = 1) {
  const ys = pts.map(p => (p[1] - R.y0) / R.res), xs = pts.map(p => (p[0] - R.x0) / R.res);
  const j0 = Math.max(0, Math.floor(Math.min(...ys))), j1 = Math.min(R.H - 1, Math.ceil(Math.max(...ys)));
  for (let j = j0; j <= j1; j++) { const yc = j + 0.5, cr = []; for (let i = 0, k = pts.length - 1; i < pts.length; k = i++) { const ya = ys[k], yb = ys[i]; if ((ya > yc) !== (yb > yc)) cr.push(xs[k] + (yc - ya) / (yb - ya) * (xs[i] - xs[k])); } cr.sort((a, b) => a - b); for (let c = 0; c + 1 < cr.length; c += 2) { const i0 = Math.max(0, Math.ceil(cr[c] - 0.5)), i1 = Math.min(R.W - 1, Math.floor(cr[c + 1] - 0.5)); for (let i = i0; i <= i1; i++) R.m[j * R.W + i] = v; } }
}
const count = (R, v = 1) => { let n = 0; for (let i = 0; i < R.m.length; i++) if (R.m[i] === v) n++; return n; };

export function computeCode(P, opts = {}) {
  const C = { ...(P.code || {}), ...opts }; const zone = C.zone || '제2종일반주거지역'; const [bcrMax, farMax] = [C.bcrMax ?? ZONES[zone]?.[0] ?? 60, C.farMax ?? ZONES[zone]?.[1] ?? 200];
  const lv = [...P.levels].sort((a, b) => a.elev - b.elev); const base = lv[0];
  // 대지: SITE 레이어 닫힌 폴리선 중 가장 큰 것
  let site = null; for (const s of P.sheets) for (const e of P.content[s.id]?.ents || []) if (e.t === 'pline' && e.closed && /SITE/i.test(e.layer || '') && (!site || Math.abs(polyArea(e.pts)) > Math.abs(polyArea(site)))) site = e.pts;
  const siteArea = C.siteArea ? +C.siteArea : site ? Math.abs(polyArea(site)) / 1e6 : null;
  const host = (r) => (id) => P.content[r.sheet.id].els.find(e => e.id === id);
  const parts = []; // 건물 부위 {poly, z0, z1, r}
  for (const r of allElements(P)) { const el = r.el; if (['opening', 'furn', 'duct', 'pipe', 'tray', 'riser', 'fin', 'footing'].includes(el.k)) continue; if (el.k === 'wall' && el.h != null && el.h < 2000) continue; const bx = elBoxes(el, r.level, host(r))[0]; if (!bx) continue; parts.push({ poly: el.k === 'slab' ? el.pts : boxCorners(bx), z0: bx.z0, z1: bx.z1, r }); }
  if (!parts.length) return { empty: true, zone, bcrMax, farMax, siteArea };
  const all = parts.flatMap(p => p.poly); const ext = bboxOf(all); const res = Math.max(50, Math.max(ext.x1 - ext.x0, ext.y1 - ext.y0) / 900);
  // 건축면적: 지상 부위 수평투영 합집합 (최하층 바닥·기초 슬래브 제외)
  // RB: 1=슬래브·기둥·벽 안쪽, 2=벽체만(외벽 중심선 밖 절반은 나중에 공제)
  const RB = raster(ext, res); for (const p of parts) { if (p.r.el.k === 'wall' || (p.r.el.k === 'slab' && p.r.level.id === base.id) || p.z1 <= base.elev + 1) continue; fillPoly(RB, p.poly); }
  let extHalf = [];
  // 층별 바닥면적: 그 층 벽(높이 2m 이상)으로 둘러싸인 면적 (벽 중심선 기준 근사)
  const floors = [];
  for (const L of lv) {
    const ws = parts.filter(p => p.r.level.id === L.id && p.r.el.k === 'wall'); if (ws.length < 3) { floors.push({ L, area: 0, note: ws.length ? '닫힌 벽 없음' : '벽 없음' }); continue; }
    const R = raster(ext, res); for (const w of ws) fillPoly(R, w.poly, 2);
    // 바깥에서 채우기
    const q = []; for (let i = 0; i < R.W; i++) { q.push(i, (R.H - 1) * R.W + i); } for (let j = 0; j < R.H; j++) q.push(j * R.W, j * R.W + R.W - 1);
    for (const k of q) if (R.m[k] === 0) R.m[k] = 3; let head = 0; const qq = q.filter(k => R.m[k] === 3);
    while (head < qq.length) { const k = qq[head++], i = k % R.W, j = (k / R.W) | 0; for (const n of [i > 0 ? k - 1 : -1, i < R.W - 1 ? k + 1 : -1, j > 0 ? k - R.W : -1, j < R.H - 1 ? k + R.W : -1]) if (n >= 0 && R.m[n] === 0) { R.m[n] = 3; qq.push(n); } }
    const inside = R.m.length - count(R, 3); let edge = 0; for (let k = 0; k < R.m.length; k++) if (R.m[k] === 2) { const i = k % R.W; if ((i > 0 && R.m[k - 1] === 3) || (i < R.W - 1 && R.m[k + 1] === 3) || R.m[k - R.W] === 3 || R.m[k + R.W] === 3) edge++; }
    const extT = ws.filter(w => ['RC', 'GLASS', 'CMU', 'SRC'].includes(w.r.el.mat)).map(w => w.r.el.t).sort((a, b) => a - b); const tHalf = (extT[extT.length >> 1] || 200) / 2; extHalf.push(tHalf);
    if (L.elev + L.height > base.elev) for (let k = 0; k < R.m.length; k++) { if (R.m[k] === 0 && RB.m[k] !== 1) RB.m[k] = 1; else if (R.m[k] === 2 && RB.m[k] === 0) RB.m[k] = 2; }
    const area = Math.max(0, inside * res * res - edge * res * tHalf) / 1e6; floors.push({ L, area: area > 1 ? area : 0, note: area > 1 ? '' : '닫힌 벽 없음' });
  }
  let bEdge = 0; for (let k = 0; k < RB.m.length; k++) if (RB.m[k] === 2) { const i = k % RB.W; if ((i > 0 && RB.m[k - 1] === 0) || (i < RB.W - 1 && RB.m[k + 1] === 0) || RB.m[k - RB.W] === 0 || RB.m[k + RB.W] === 0) bEdge++; }
  extHalf.sort((a, b) => a - b); const bldgArea = Math.max(0, (count(RB, 1) + count(RB, 2)) * res * res - bEdge * res * (extHalf[extHalf.length >> 1] || 100)) / 1e6;
  const gfa = floors.reduce((s, f) => s + f.area, 0), above = floors.filter(f => f.area > 0 && f.L.elev >= base.elev).length;
  const zTop = Math.max(...parts.map(p => p.z1)); const allTop = Math.max(zTop, ...allElements(P).filter(r => r.el.k === 'fin').map(r => elBoxes(r.el, r.level)[0]?.z1 || 0));
  const topLevel = [...floors].reverse().find(f => f.area > 0);
  // 정북일조: 높이 10m 이하 1.5m, 초과 부분은 높이의 1/2 이상 정북 대지경계선에서 이격
  const sun = { applies: SUN_ZONES.test(zone), viol: [] };
  if (sun.applies && site) {
    const th = -(P.site.north || 0) * Math.PI / 180; const toN = (p) => p[0] * Math.sin(th) + p[1] * Math.cos(th); // 진북 방향 좌표
    const nMax = Math.max(...site.map(toN));
    for (const p of parts) { const hgt = p.z1 - base.elev; if (hgt <= 0) continue; const dn = nMax - Math.max(...p.poly.map(toN)); const need = hgt <= 10000 ? 1500 : hgt / 2; if (dn < need - 1) sun.viol.push({ el: p.r.el, sheet: p.r.sheet, level: p.r.level, hgt, dn, need, short: need - dn, pt: p.poly.reduce((a, b) => toN(b) > toN(a) ? b : a) }); }
    sun.viol.sort((a, b) => b.short - a.short);
  }
  const notes = [];
  const H = allTop - base.elev;
  if (above >= 50 || H >= 200000) notes.push('초고층 건축물(50층 이상 또는 200m 이상): 피난안전구역을 지상층으로부터 최대 30개 층마다 1개소 이상 설치 (건축법 시행령 제34조).');
  else if (above >= 30 || H >= 120000) notes.push('준초고층 건축물(30~49층 또는 120~200m): 전체 층수의 1/2 층으로부터 상·하 5개 층 이내에 피난안전구역 1개소 이상.');
  if (above >= 6 && !P.sheets.some(s => P.content[s.id]?.els.some(e => e.k === 'furn' && /stair/.test(e.type)))) notes.push('직통계단이 모델에 없습니다 — 계단 배치를 확인하세요.');
  return { zone, bcrMax, farMax, site: !!site, siteArea, bldgArea, gfa, bcr: siteArea ? bldgArea / siteArea * 100 : null, far: siteArea ? gfa / siteArea * 100 : null, floors, above, height: H, roofH: topLevel ? topLevel.L.elev + topLevel.L.height - base.elev : null, sun, notes, res };
}

export function mount(root, ctx) {
  const P = ctx.P; P.code ||= {}; let R = null;
  const page = h('div', { class: 'page' }); const w = h('div', { class: 'wrap' }); page.append(w); root.append(page);
  const run = () => { try { R = computeCode(P); P.code.last = { at: Date.now(), bcr: R.bcr, far: R.far, bldg: R.bldgArea, gfa: R.gfa, sunViol: R.sun?.viol.length || 0 }; ctx.touch('meta'); } catch (e) { console.error(e); toast('계산하지 못했습니다: ' + e.message, 'err'); } render(); };
  function render() {
    w.innerHTML = '';
    w.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('div', {}, h('h1', {}, '건축개요·법규'), h('div', { class: 'sub' }, '모델에서 대지·건축·연면적을 계산해 건폐율·용적률·높이를 확인하고, 주거지역이면 정북일조 사선을 검토합니다.')),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: settings }, '용도지역·대지 설정'), h('button', { class: 'btn', onclick: exportHTML, disabled: !R || R.empty }, '건축개요 보고서'), h('button', { class: 'btn primary', onclick: run }, '▶ 다시 계산'))));
    if (!R) return w.append(h('div', { class: 'empty' }, '계산 중…'));
    if (R.empty) return w.append(h('div', { class: 'card', style: { marginTop: '14px' } }, h('div', { class: 't' }, '계산할 건물 객체가 없습니다'), h('div', { class: 'd' }, '작도에서 벽·슬래브·기둥을 그리세요.')));
    const pill = (ok, txt) => h('span', { class: 'pill ' + (ok == null ? '' : ok ? 'ok' : 'bad') }, txt);
    const card = (k, v, sub, ok) => h('div', { class: 'card' }, h('div', { class: 'd' }, k), h('div', { class: 't', style: { fontSize: '20px', margin: '4px 0' } }, v), sub ? h('div', {}, ok === undefined ? h('span', { class: 'note' }, sub) : pill(ok, sub)) : null);
    w.append(h('div', { class: 'row', style: { margin: '12px 0', gap: '8px' } }, h('span', { class: 'pill acc' }, R.zone), h('span', { class: 'note' }, `건폐율 ${R.bcrMax}% · 용적률 ${R.farMax}% 이하 (서울시 조례 기본값 — 대지 조건에 맞게 수정)`)));
    w.append(h('div', { class: 'cards' },
      card('대지면적', R.siteArea ? `${fmt(R.siteArea, 2)}㎡` : '미지정', R.siteArea ? `${fmt(R.siteArea / 3.3058, 1)}평${R.site ? ' · SITE 경계선' : ' · 직접 입력'}` : '작도에서 SITE 레이어에 닫힌 폴리선으로 대지경계선을 그리거나 직접 입력'),
      card('건축면적', `${fmt(R.bldgArea, 2)}㎡`, `${fmt(R.bldgArea / 3.3058, 1)}평 · 수평투영`),
      card('건폐율', R.bcr != null ? `${fmt(R.bcr, 2)}%` : '-', R.bcr != null ? `${R.bcr <= R.bcrMax ? '적합' : '초과'} (≤ ${R.bcrMax}%)` : null, R.bcr != null ? R.bcr <= R.bcrMax : undefined),
      card('연면적(지상)', `${fmt(R.gfa, 2)}㎡`, `${fmt(R.gfa / 3.3058, 1)}평 · ${R.above}개 층`),
      card('용적률', R.far != null ? `${fmt(R.far, 1)}%` : '-', R.far != null ? `${R.far <= R.farMax ? '적합' : '초과'} (≤ ${R.farMax}%)` : null, R.far != null ? R.far <= R.farMax : undefined),
      card('높이', `${fmt(R.height / 1000, 2)}m`, R.roofH ? `최상층 지붕 ${fmt(R.roofH / 1000, 2)}m · 옥탑·핀 포함 최고` : undefined)));
    if (R.sun.applies) {
      const v = R.sun.viol;
      w.append(h('h3', { style: { margin: '18px 0 6px' } }, '정북일조 사선 (건축법 시행령 제86조)'), h('div', { class: 'note', style: { marginBottom: '6px' } }, '높이 10m 이하 부분은 정북 대지경계선에서 1.5m 이상, 10m 초과 부분은 그 높이의 1/2 이상 띄워야 합니다. 대지경계선 북쪽 변과 진북(위치 설정의 진북 각도)을 기준으로 검토합니다.'));
      if (!R.site) w.append(h('div', { class: 'card' }, h('div', { class: 'd' }, 'SITE 레이어 대지경계선이 없어 검토하지 못했습니다.')));
      else if (!v.length) w.append(h('div', { class: 'card' }, pill(true, '적합'), h('span', { class: 'note', style: { marginLeft: '8px' } }, '모든 부위가 정북 이격 기준을 만족합니다.')));
      else w.append(h('div', { class: 'row', style: { marginBottom: '6px' } }, pill(false, `${v.length}개 부위 부족`), h('span', { class: 'note' }, `최대 ${fmt0(v[0].short)}mm 부족 — ${v[0].level.name} ${elName(v[0].el)}`)), h('div', { class: 'tbl' }, table([
        { label: '층', render: x => x.level.name }, { label: '부위', render: x => `${x.el.tag ? x.el.tag + ' · ' : ''}${elName(x.el)}` }, { label: '높이', num: true, render: x => fmt(x.hgt / 1000, 2) + 'm' }, { label: '정북 거리', num: true, render: x => fmt0(x.dn) }, { label: '필요', num: true, render: x => fmt0(x.need) }, { label: '부족', num: true, render: x => h('b', { style: { color: 'var(--bad)' } }, fmt0(x.short)) },
        { label: '', render: x => h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => { ctx.state.hi = { ids: [x.el.id], pts: [x.pt], sheet: x.sheet.id, label: '정북일조 부족' }; ctx.go('cad'); } }, '작도'), h('button', { class: 'btn sm', onclick: () => { ctx.state.hi = { ids: [x.el.id], label: '정북일조 부족' }; ctx.go('view3d'); } }, '3D')) }], v.slice(0, 60))));
    } else w.append(h('div', { class: 'note', style: { marginTop: '14px' } }, `정북일조 사선: ${R.zone}은(는) 적용 대상이 아닙니다 (전용·일반주거지역만 적용).`));
    if (R.notes.length) w.append(h('h3', { style: { margin: '18px 0 6px' } }, '안내'), ...R.notes.map(t => h('div', { class: 'card', style: { marginBottom: '6px' } }, h('div', { class: 'd' }, t))));
    w.append(h('h3', { style: { margin: '18px 0 6px' } }, '층별 바닥면적'), h('div', { class: 'tbl' }, table([{ label: '층', render: f => f.L.name }, { label: 'FL', num: true, render: f => fmt(f.L.elev / 1000, 2) }, { label: '층고', num: true, render: f => fmt(f.L.height / 1000, 2) }, { label: '바닥면적 ㎡', num: true, render: f => f.area ? fmt(f.area, 2) : '-' }, { label: '평', num: true, render: f => f.area ? fmt(f.area / 3.3058, 1) : '-' }, { label: '비고', render: f => h('span', { class: 'note' }, f.note) }], [...R.floors].reverse())));
    w.append(h('div', { class: 'note', style: { marginTop: '10px' } }, `계산 방식: 건축면적은 지상 부위(벽·기둥·슬래브)의 수평투영 합집합, 바닥면적은 각 층 벽으로 둘러싸인 면적(벽 중심선 근사, 격자 ${fmt0(R.res)}mm). 발코니·필로티·주차장 등 면적 산정 특례와 지하층은 반영하지 않으니 인허가 도서 작성 시 별도 확인하세요.`));
  }
  async function settings() {
    const v = await dialog({ title: '용도지역·대지', fields: [{ key: 'zone', label: '용도지역', type: 'select', options: Object.keys(ZONES), value: P.code.zone || '제2종일반주거지역' }, { key: 'bcrMax', label: '건폐율 상한 %(빈칸=기본값)', type: 'number', value: P.code.bcrMax ?? '' }, { key: 'farMax', label: '용적률 상한 %(빈칸=기본값)', type: 'number', value: P.code.farMax ?? '' }, { key: 'siteArea', label: '대지면적 ㎡ (빈칸=SITE 경계선에서 계산)', type: 'number', value: P.code.siteArea ?? '' }] });
    if (!v) return; P.code.zone = v.zone; for (const k of ['bcrMax', 'farMax', 'siteArea']) { if (v[k] == null || v[k] === '') delete P.code[k]; else P.code[k] = +v[k]; } ctx.touch('meta'); run();
  }
  function exportHTML() {
    const r = R; const row = (a, b) => `<tr><th>${a}</th><td>${b}</td></tr>`;
    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>건축개요</title><style>body{font-family:'Malgun Gothic',sans-serif;margin:28px;color:#111}table{border-collapse:collapse;margin:8px 0 18px;min-width:520px}th,td{border:1px solid #888;padding:5px 9px;font-size:13px;text-align:left}th{background:#eef1f5;width:160px}h1{font-size:20px}h2{font-size:15px;margin-top:18px}.bad{color:#c00;font-weight:700}.ok{color:#080;font-weight:700}</style></head><body>
<h1>${esc(P.name)} — 건축개요</h1><p>${esc(P.site.address || '')} · ${new Date().toLocaleDateString('ko-KR')} · 빌더 모델 자동 산정</p>
<table>${row('용도지역', esc(r.zone))}${row('대지면적', r.siteArea ? `${fmt(r.siteArea, 2)}㎡ (${fmt(r.siteArea / 3.3058, 1)}평)` : '-')}${row('건축면적', `${fmt(r.bldgArea, 2)}㎡ (${fmt(r.bldgArea / 3.3058, 1)}평)`)}${row('건폐율', r.bcr != null ? `${fmt(r.bcr, 2)}% <span class="${r.bcr <= r.bcrMax ? 'ok' : 'bad'}">(법정 ${r.bcrMax}% 이하 ${r.bcr <= r.bcrMax ? '적합' : '초과'})</span>` : '-')}${row('연면적(지상)', `${fmt(r.gfa, 2)}㎡ (${fmt(r.gfa / 3.3058, 1)}평)`)}${row('용적률', r.far != null ? `${fmt(r.far, 1)}% <span class="${r.far <= r.farMax ? 'ok' : 'bad'}">(법정 ${r.farMax}% 이하 ${r.far <= r.farMax ? '적합' : '초과'})</span>` : '-')}${row('층수', `지상 ${r.above}층`)}${row('높이', `${fmt(r.height / 1000, 2)}m`)}${row('정북일조', r.sun.applies ? (r.sun.viol.length ? `<span class="bad">${r.sun.viol.length}개 부위 부족 (최대 ${fmt0(r.sun.viol[0].short)}mm)</span>` : '<span class="ok">적합</span>') : '적용 대상 아님')}</table>
<h2>층별 바닥면적</h2><table><tr><th>층</th><th>FL(m)</th><th>바닥면적(㎡)</th><th>평</th></tr>${[...r.floors].reverse().map(f => `<tr><td>${esc(f.L.name)}</td><td>${fmt(f.L.elev / 1000, 2)}</td><td>${f.area ? fmt(f.area, 2) : '-'}</td><td>${f.area ? fmt(f.area / 3.3058, 1) : '-'}</td></tr>`).join('')}</table>
${r.notes.map(t => `<p>· ${esc(t)}</p>`).join('')}<p style="color:#666;font-size:12px">모델 기반 근사 산정이며 면적 산정 특례(발코니·필로티·주차장 등)와 지하층은 반영되지 않았습니다. 용도지역별 상한은 서울시 조례 기본값으로, 해당 지자체 조례·지구단위계획을 확인하세요.</p></body></html>`;
    saveFile(`${P.name.replace(/[\\/:*?"<>|]/g, '_')}_건축개요.html`, html);
  }
  run();
  return { unmount() { } };
}
