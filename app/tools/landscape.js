// 빌더 조경 — 녹지 산정(법정 조경면적), 자동 식재 계획(조경기준), 수목 일람표·물량·탄소흡수, 모델 반영
// 참고: Vectorworks Landmark / Land F/X 식재 계획 워크플로를 웹으로 단순화
import { h, toast, saveFile, table, confirmBox } from '../js/ui.js';
import { uid, esc, polyArea, pointInPoly } from '../js/util.js';
import { allElements } from '../js/model.js';
import { siteInfo, inAny, bboxOf } from '../js/sitegeo.js';

// 수종 DB — 규격·단가(원, 식재 포함 근사)·상록·향토·연 CO2 흡수(kg/주·년, 국립산림과학원 수종별 근사)·수관폭(mm)
export const SPECIES = [
  { id: 'pine', g: '교목', name: '소나무', spec: 'H3.0×W1.5×R12', price: 420000, ever: 1, native: 1, co2: 6.6, cw: 2500, ht: 3000, water: 0.6 },
  { id: 'zelkova', g: '교목', name: '느티나무', spec: 'H4.0×R12', price: 380000, ever: 0, native: 1, co2: 11.2, cw: 4000, ht: 4000, water: 0.8 },
  { id: 'cherry', g: '교목', name: '왕벚나무', spec: 'H3.5×B10', price: 260000, ever: 0, native: 1, co2: 8.4, cw: 3500, ht: 3500, water: 0.8 },
  { id: 'fringe', g: '교목', name: '이팝나무', spec: 'H3.5×R10', price: 280000, ever: 0, native: 1, co2: 7.6, cw: 3000, ht: 3500, water: 0.8 },
  { id: 'dogwood', g: '교목', name: '산딸나무', spec: 'H3.0×R8', price: 230000, ever: 0, native: 1, co2: 5.2, cw: 2500, ht: 3000, water: 0.7 },
  { id: 'maple', g: '교목', name: '단풍나무', spec: 'H3.0×R8', price: 240000, ever: 0, native: 1, co2: 6.0, cw: 3000, ht: 3000, water: 0.8 },
  { id: 'strobus', g: '교목', name: '스트로브잣나무', spec: 'H3.0×W1.5', price: 160000, ever: 1, native: 0, co2: 5.8, cw: 2000, ht: 3000, water: 0.6 },
  { id: 'yew', g: '교목', name: '주목', spec: 'H2.0×W1.0', price: 210000, ever: 1, native: 1, co2: 2.4, cw: 1500, ht: 2000, water: 0.5 },
  { id: 'meta', g: '교목', name: '메타세쿼이아', spec: 'H4.0×B10', price: 230000, ever: 0, native: 0, co2: 12.0, cw: 2500, ht: 4000, water: 0.9 },
  { id: 'azalea', g: '관목', name: '산철쭉', spec: 'H0.4×W0.5', price: 4500, ever: 0, native: 1, co2: 0.3, cw: 500, ht: 400, water: 0.15 },
  { id: 'boxwood', g: '관목', name: '회양목', spec: 'H0.3×W0.3', price: 5000, ever: 1, native: 1, co2: 0.2, cw: 300, ht: 300, water: 0.1 },
  { id: 'euonymus', g: '관목', name: '사철나무', spec: 'H1.0×W0.3', price: 6500, ever: 1, native: 1, co2: 0.4, cw: 400, ht: 1000, water: 0.15 },
  { id: 'spiraea', g: '관목', name: '조팝나무', spec: 'H0.6×5가지', price: 3000, ever: 0, native: 1, co2: 0.3, cw: 600, ht: 600, water: 0.15 },
  { id: 'privet', g: '관목', name: '쥐똥나무', spec: 'H1.0×W0.3', price: 3500, ever: 0, native: 1, co2: 0.3, cw: 400, ht: 1000, water: 0.15 },
  { id: 'nandina', g: '관목', name: '남천', spec: 'H0.6×3가지', price: 6000, ever: 1, native: 0, co2: 0.2, cw: 400, ht: 600, water: 0.12 },
  { id: 'grass', g: '지피', name: '잔디(평떼)', spec: '0.3×0.3 m', price: 9000, ever: 0, native: 1, co2: 0.1, unit: '㎡', water: 0.005 },
  { id: 'liriope', g: '지피', name: '맥문동', spec: '3~5분얼, 25주/㎡', price: 22000, ever: 1, native: 1, co2: 0.15, unit: '㎡', water: 0.004 },
];
const SP = Object.fromEntries(SPECIES.map(s => [s.id, s]));
// 건축법 시행령 제27조 (조례 위임 범위 근사) — 연면적 기준 대지면적 대비 조경 비율
export function legalRatio(gfa) { return gfa >= 2000 ? 0.15 : gfa >= 1000 ? 0.10 : gfa >= 200 ? 0.05 : 0; }
const gfaOf = (P) => { let s = 0; for (const r of allElements(P)) if (r.el.k === 'slab') s += Math.abs(polyArea(r.el.pts)) / 1e6; return s; };
// 옥상 녹지 (조경 툴 옥상 폴리곤)
export function landCalc(P) {
  const L = P.landscape; const S = siteInfo(P); const gfa = gfaOf(P); const ratio = legalRatio(gfa); const need = S.siteArea * ratio;
  // 자동 녹지: 대지 − 건물 − 포장 − (이격 1 m) 를 래스터로 산정 (+ 사용자가 그린 녹지 ∪)
  const cell = 500; const bb = bboxOf([S.site]); let autoA = 0, drawnA = 0; const cells = [];
  const user = (L.areas || []).filter(a => !a.roof).map(a => a.pts), roofs = (L.areas || []).filter(a => a.roof);
  for (let x = bb.x0 + cell / 2; x < bb.x1; x += cell) for (let y = bb.y0 + cell / 2; y < bb.y1; y += cell) {
    const p = [x, y]; if (!pointInPoly(p, S.site)) continue; const inU = inAny(p, user);
    const blocked = inAny(p, S.fp) || inAny(p, S.pave); const ok = L.auto !== false && !blocked;
    if (inU) { drawnA++; cells.push(p); } else if (ok) { autoA++; cells.push(p); }
  }
  const ca = cell * cell / 1e6; const ground = (drawnA + autoA) * ca; const roofA = roofs.reduce((s, a) => s + Math.abs(polyArea(a.pts)) / 1e6, 0);
  const credit = ground + roofA * 2 / 3; // 옥상조경 2/3 인정 (조경기준 제15조, 법정면적의 50% 한도)
  const creditCap = ground + Math.min(roofA * 2 / 3, need * 0.5);
  const green = ground; // 지상 녹지
  // 식재 기준 (조경기준 제5조 근사): 교목 0.2주/㎡, 관목 1.0주/㎡ — 법정 조경면적 기준
  const base = Math.max(need, 0); const reqTree = Math.ceil(base * 0.2), reqShrub = Math.ceil(base * 1.0);
  const plan = L.plan || []; const cnt = (g) => plan.filter(p => SP[p.sp]?.g === g).reduce((s, p) => s + (p.n || 1), 0);
  const trees = cnt('교목'), shrubs = cnt('관목'); const treeEver = plan.filter(p => SP[p.sp]?.g === '교목' && SP[p.sp].ever).reduce((s, p) => s + (p.n || 1), 0);
  const nat = plan.filter(p => SP[p.sp]?.g !== '지피' && SP[p.sp]?.native).reduce((s, p) => s + (p.n || 1), 0);
  const rows = SPECIES.map(s => { const n = plan.filter(p => p.sp === s.id).reduce((a, p) => a + (p.n || 1), 0); return n ? { ...s, n, cost: n * s.price, co2y: n * s.co2, waterD: n * s.water } : null; }).filter(Boolean);
  const cost = rows.reduce((s, r) => s + r.cost, 0), co2 = rows.reduce((s, r) => s + r.co2y, 0), water = rows.reduce((s, r) => s + r.waterD, 0);
  const checks = [
    { k: `조경면적 ≥ 대지 × ${(ratio * 100).toFixed(0)}% (연면적 ${gfa.toFixed(0)}㎡)`, need: need, have: creditCap, ok: creditCap >= need - 0.01, u: '㎡' },
    { k: '교목 0.2주/㎡ 이상', need: reqTree, have: trees, ok: trees >= reqTree, u: '주' },
    { k: '관목 1.0주/㎡ 이상', need: reqShrub, have: shrubs, ok: shrubs >= reqShrub, u: '주' },
    { k: '상록교목 20% 이상', need: Math.ceil(reqTree * 0.2), have: treeEver, ok: trees ? treeEver / trees >= 0.2 : reqTree === 0, u: '주' },
    { k: '향토수종 10% 이상 (교·관목)', need: Math.ceil((reqTree + reqShrub) * 0.1), have: nat, ok: (trees + shrubs) ? nat / (trees + shrubs) >= 0.1 : reqTree + reqShrub === 0, u: '주' }];
  return { S, gfa, ratio, need, ground, drawn: drawnA * ca, auto: autoA * ca, roofA, credit, creditCap, green, cells, cell, reqTree, reqShrub, trees, shrubs, treeEver, nat, rows, cost, co2, water, checks };
}
// 자동 식재: 녹지 셀에 교목 간격 배치 (건물 이격 2 m), 관목은 군식(㎡당 1주 → 군락 기호로 묶음), 나머지는 지피
export function autoPlant(P, R, opt = {}) {
  const S = R.S; const L = P.landscape; const need = Math.max(R.need, R.ground * 0.5); const nTree = Math.max(R.reqTree, Math.ceil(need * 0.2)), nShrub = Math.max(R.reqShrub, Math.ceil(need * 1.0));
  const mix = opt.mix || ['zelkova', 'cherry', 'fringe', 'pine', 'strobus', 'dogwood', 'maple', 'pine'];
  // 후보 위치: 녹지 셀 중 건물에서 2 m, 대지경계에서 1 m 이상
  const far = (p, polys, d) => !polys.some(q => q.some((a, i) => { const b = q[(i + 1) % q.length]; const dx = b[0] - a[0], dy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]) < d; }) || inAny(p, [q]));
  const edgeDist = (p) => { const q = S.site; let m = Infinity; for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; const dx = b[0] - a[0], dy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))); m = Math.min(m, Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1])); } return m; };
  // 건물 이격 2 m·경계 1 m가 기본, 좁은 대지는 단계적으로 완화 (1 m / 0.5 m)
  let pool = []; for (const [db, de] of [[2000, 1000], [1000, 500], [500, 300]]) { pool = R.cells.filter(p => far(p, S.fp, db) && edgeDist(p) >= de); if (pool.length >= nTree * 4) break; }
  const plan = []; const edgeD = edgeDist;
  const sorted = [...pool].sort((a, b) => edgeD(a) - edgeD(b)); const placed = [];
  for (const sp of [4500, 3500, 2500, 1800]) { for (const p of sorted) { if (placed.length >= nTree) break; if (placed.every(q => Math.hypot(q[0] - p[0], q[1] - p[1]) >= sp)) placed.push(p); } if (placed.length >= nTree) break; }
  placed.forEach((p, i) => plan.push({ id: uid('pl'), sp: mix[i % mix.length], p, n: 1 }));
  // 상록 20% 보정
  const tr = plan.filter(x => SP[x.sp].g === '교목'); let ev = tr.filter(x => SP[x.sp].ever).length; for (const x of tr) { if (ev >= Math.ceil(tr.length * 0.2)) break; if (!SP[x.sp].ever) { x.sp = ev % 2 ? 'strobus' : 'pine'; ev++; } }
  // 관목: 건물 주변 띠 (건물에서 0.6~2 m) + 교목 하부, 군락당 10주
  const shrubSp = ['azalea', 'boxwood', 'euonymus', 'spiraea', 'privet', 'nandina'];
  const band = R.cells.filter(p => !far(p, S.fp, 2000) && far(p, S.fp, 400)); const spots = [...band, ...sorted.filter(p => !placed.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1500))];
  const groups = Math.ceil(nShrub / 10); const picked = []; const dmin = (p, arr) => arr.reduce((m, q) => Math.min(m, Math.hypot(q[0] - p[0], q[1] - p[1])), Infinity);
  const sp0 = spots.length ? spots : R.cells; // 최원점 샘플링으로 군락을 고르게 분산 (교목 하부 1.5 m 이내 회피)
  for (let k = 0; k < groups && sp0.length; k++) { let best = null, bd = -1; for (const p of sp0) { const d = Math.min(dmin(p, picked), dmin(p, placed) * 1.6); if (d > bd) { bd = d; best = p; } } if (!best || (k && bd < 900)) break; picked.push(best); }
  let left = nShrub; picked.forEach((p, i) => { const n = Math.min(10, left); left -= n; if (n > 0) plan.push({ id: uid('pl'), sp: shrubSp[i % shrubSp.length], p, n }); });
  if (left > 0 && picked.length) plan[plan.length - 1].n += left;
  // 지피: 녹지 면적 중 관목 군락(10주 ≈ 10㎡) 제외 → 잔디 70% / 맥문동 30%
  const gc = Math.max(0, R.ground - nShrub * 1.0); if (gc > 0) { plan.push({ id: uid('pl'), sp: 'grass', n: Math.round(gc * 0.7) }); plan.push({ id: uid('pl'), sp: 'liriope', n: Math.round(gc * 0.3) }); }
  L.plan = plan; return plan;
}
// 모델 반영: 최하층 L 시트에 furn tree/shrub 배치
export function applyToModel(P) {
  const L0 = [...P.levels].sort((a, b) => a.elev - b.elev)[0]; let sh = P.sheets.find(s => s.disc === 'L' && s.level === L0.id && s.landscape);
  if (!sh) { sh = { id: uid('s'), name: `L-101 ${L0.name} 조경`, disc: 'L', level: L0.id, landscape: true }; P.sheets.push(sh); P.content[sh.id] = { ents: [], els: [] }; }
  const c = P.content[sh.id]; c.els = c.els.filter(e => !e.landscape); let n = 0;
  for (const x of P.landscape.plan || []) { const s = SP[x.sp]; if (!x.p || s.g === '지피') continue; const tree = s.g === '교목'; const w = tree ? s.cw : Math.max(1200, Math.sqrt(x.n) * 600);
    c.els.push({ id: uid('e'), k: 'furn', type: tree ? 'tree' : 'shrub', p: x.p, w, d: w, h: tree ? s.ht + 1500 : s.ht, rot: 0, zone: '조경', tag: `${s.name}${x.n > 1 ? ' ×' + x.n : ''}`, landscape: true, sp: s.id, cnt: x.n }); n++; }
  return { sheet: sh, n };
}

export function mount(root, ctx) {
  const P = ctx.P; P.landscape ||= { areas: [], plan: [], auto: true }; const L = P.landscape;
  let R = null, mode = 'view', draft = [], view = null, sel = null;
  const cv = h('canvas', { style: { width: '100%', height: '100%', display: 'block', background: '#0d1016' } });
  const holder = h('div', { style: { position: 'relative', flex: 1, minWidth: 0 } }, cv);
  const side = h('div', { class: 'side', style: { width: '440px', maxWidth: '48vw', overflow: 'auto', padding: '10px 12px' } });
  const tb = h('div', { class: 'row', style: { gap: '6px', padding: '8px 10px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap', alignItems: 'center' } });
  root.append(h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } }, tb, h('div', { style: { display: 'flex', flex: 1, minHeight: 0 } }, holder, side)));
  const save = () => ctx.touch('meta');
  const recalc = () => { R = landCalc(P); L.last = { at: Date.now(), green: R.ground, need: R.need, credit: R.creditCap, trees: R.trees, shrubs: R.shrubs, cost: R.cost, co2: R.co2, ok: R.checks.every(c => c.ok) }; };
  const all = () => { recalc(); renderTB(); renderSide(); paint(); };
  function renderTB() { tb.innerHTML = ''; const b = (k, l) => h('button', { class: 'btn' + (mode === k ? ' primary' : ''), onclick: () => { mode = k; draft = []; renderTB(); paint(); } }, l);
    tb.append(h('b', {}, '조경'), b('view', '선택'), b('area', '녹지 그리기'), b('roof', '옥상녹지 그리기'), b('tree', '교목 심기'), b('shrub', '관목 심기'), h('span', { class: 'note' }, mode === 'area' || mode === 'roof' ? '클릭으로 점 추가 · 더블클릭으로 닫기' : ''),
      h('span', { style: { flex: 1 } }), h('button', { class: 'btn', onclick: exportXLSX, disabled: !R?.rows.length }, '수목 일람표 Excel')); }
  function paint() {
    const r = cv.getBoundingClientRect(); if (!r.width || !R) return; cv.width = r.width * devicePixelRatio; cv.height = r.height * devicePixelRatio; const g = cv.getContext('2d'); g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); g.clearRect(0, 0, r.width, r.height);
    const bb = bboxOf([R.S.site]); const pad = 36; const sc = Math.min((r.width - 2 * pad) / (bb.x1 - bb.x0 || 1), (r.height - 2 * pad) / (bb.y1 - bb.y0 || 1)); const X = (x) => pad + (x - bb.x0) * sc, Y = (y) => r.height - pad - (y - bb.y0) * sc; view = { bb, sc, pad, H: r.height };
    g.fillStyle = '#2f6b3c88'; for (const p of R.cells) g.fillRect(X(p[0] - R.cell / 2), Y(p[1] + R.cell / 2), R.cell * sc + 0.6, R.cell * sc + 0.6);
    const poly = (pts, stroke, fill, dash) => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } g.setLineDash(dash || []); g.strokeStyle = stroke; g.lineWidth = 1.5; g.stroke(); g.setLineDash([]); };
    poly(R.S.site, '#ff9f1c', null, [8, 4]); for (const q of R.S.pave) poly(q, '#8a94a6', '#5b627055'); for (const q of R.S.fp) poly(q, '#e6edf7', '#2a3342');
    for (const a of L.areas || []) poly(a.pts, a.roof ? '#b3e283' : '#7bd389', a.roof ? '#b3e28333' : null, a.roof ? [4, 3] : null);
    for (const x of L.plan || []) { if (!x.p) continue; const s = SP[x.sp]; const tree = s.g === '교목'; const rad = (tree ? s.cw / 2 : Math.max(600, Math.sqrt(x.n) * 300)) * sc;
      g.beginPath(); g.arc(X(x.p[0]), Y(x.p[1]), Math.max(3, rad), 0, 7); g.fillStyle = tree ? (s.ever ? '#2e8b57aa' : '#6cc070aa') : '#c8a2d6aa'; g.fill(); g.strokeStyle = sel === x.id ? '#fff' : (tree ? '#a6e3a1' : '#e2c4f0'); g.lineWidth = sel === x.id ? 2 : 1; g.stroke();
      if (rad > 9) { g.fillStyle = '#0d1016'; g.font = '10px sans-serif'; g.textAlign = 'center'; g.fillText(tree ? s.name.slice(0, 2) : `${s.name.slice(0, 2)}${x.n}`, X(x.p[0]), Y(x.p[1]) + 3); g.textAlign = 'left'; } }
    if (draft.length) { g.strokeStyle = '#fff'; g.beginPath(); draft.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.stroke(); }
    g.fillStyle = '#cfd6e2'; g.font = '11px sans-serif'; g.fillText(`초록 셀: 지상 녹지 ${R.ground.toFixed(0)}㎡ (${L.auto !== false ? '자동: 대지 − 건물 − 포장' : '그린 녹지만'})`, 10, 16);
    if (R.S.assumed) { g.fillStyle = '#ffcf8a'; g.fillText('대지경계선 없음 — 건물 외곽 +10 m 가정 (작도에서 SITE 레이어 폴리선으로 지정)', 10, r.height - 10); }
  }
  const toW = (e) => { const b = cv.getBoundingClientRect(); return [view.bb.x0 + (e.clientX - b.left - view.pad) / view.sc, view.bb.y0 + (view.H - (e.clientY - b.top) - view.pad) / view.sc]; };
  let clickT = 0;
  cv.addEventListener('click', (e) => { if (!view) return; const p = toW(e).map(Math.round);
    if (mode === 'area' || mode === 'roof') { draft.push(p); paint(); return; }
    if (mode === 'tree' || mode === 'shrub') { const sp = side.querySelector('select[data-k=' + mode + ']')?.value || (mode === 'tree' ? 'zelkova' : 'azalea'); (L.plan ||= []).push({ id: uid('pl'), sp, p, n: mode === 'tree' ? 1 : 10 }); save(); all(); return; }
    const hit = (L.plan || []).find(x => x.p && Math.hypot(x.p[0] - p[0], x.p[1] - p[1]) < Math.max(800, (SP[x.sp].cw || 1200) / 2)); sel = hit?.id || null; renderSide(); paint(); });
  cv.addEventListener('dblclick', () => { if ((mode === 'area' || mode === 'roof') && draft.length >= 3) { draft.pop(); (L.areas ||= []).push({ id: uid('ga'), pts: draft, roof: mode === 'roof' }); draft = []; save(); all(); } });
  window.addEventListener('keydown', onKey); function onKey(e) { if (e.key === 'Escape') { draft = []; paint(); } if ((e.key === 'Delete' || e.key === 'Backspace') && sel && document.activeElement?.tagName !== 'INPUT') { L.plan = L.plan.filter(x => x.id !== sel); sel = null; save(); all(); } }
  const card = (k, v, s, ok) => h('div', { class: 'card' }, h('div', { class: 'd' }, k), h('div', { class: 't', style: { fontSize: '18px', margin: '2px 0', color: ok === false ? 'var(--bad, #ef5f5f)' : ok ? 'var(--ok, #7bd389)' : '' } }, v), s ? h('div', { class: 'note', style: { fontSize: '11.5px' } }, s) : null);
  function renderSide() {
    side.innerHTML = ''; if (!R) return; const won = (v) => `${(v / 1e6).toFixed(1)}백만원`;
    side.append(h('div', { class: 'note', style: { lineHeight: 1.6, marginBottom: '8px' } }, '대지 안 녹지를 산정해 법정 조경면적·식재 기준을 검토하고, 자동 식재 계획과 수목 일람표(물량·공사비·탄소흡수)를 만듭니다.'));
    side.append(h('div', { class: 'cards', style: { gridTemplateColumns: '1fr 1fr' } },
      card('법정 조경면적', `${R.need.toFixed(0)}㎡`, `대지 ${R.S.siteArea.toFixed(0)}㎡ × ${(R.ratio * 100).toFixed(0)}% (연면적 ${R.gfa.toFixed(0)}㎡)`),
      card('계획 조경면적', `${R.creditCap.toFixed(0)}㎡`, `지상 ${R.ground.toFixed(0)} + 옥상 ${R.roofA.toFixed(0)}×2/3`, R.creditCap >= R.need - 0.01),
      card('교목 / 관목', `${R.trees} / ${R.shrubs}주`, `기준 ${R.reqTree} / ${R.reqShrub}주`, R.trees >= R.reqTree && R.shrubs >= R.reqShrub),
      card('식재 공사비', won(R.cost), `CO₂ 흡수 ${(R.co2 / 1000).toFixed(2)} t/년 · 관수 ${R.water.toFixed(1)} m³/일(하절기)`)));
    side.append(h('div', { class: 'row', style: { gap: '6px', margin: '10px 0', flexWrap: 'wrap' } },
      h('button', { class: 'btn primary', onclick: async () => { if (L.plan?.length && !(await confirmBox('자동 식재', '현재 식재 계획을 자동 계획으로 바꿀까요?', '바꾸기'))) return; autoPlant(P, R); save(); all(); toast('조경기준에 맞춰 자동 식재했습니다', 'ok'); } }, '자동 식재 계획'),
      h('button', { class: 'btn', disabled: !L.plan?.some(x => x.p), onclick: () => { const r = applyToModel(P); ctx.touch('meta'); ctx.touch(r.sheet.id); ctx.bus?.emit?.('model'); toast(`${r.sheet.name}에 수목 ${r.n}개를 배치했습니다 (작도·3D에서 확인)`, 'ok'); } }, '모델에 반영'),
      h('label', { class: 'row', style: { gap: '4px', alignItems: 'center' } }, h('input', { type: 'checkbox', checked: L.auto !== false, onchange: e => { L.auto = e.target.checked; save(); all(); } }), '자동 녹지(대지−건물−포장)')));
    side.append(h('h4', { style: { margin: '8px 0 6px' } }, '조경기준 검토'), h('div', { class: 'tbl' }, table([{ label: '항목', key: 'k' }, { label: '기준', key: 'n' }, { label: '계획', key: 'v' }, { label: '판정', key: 'o' }],
      R.checks.map(c => ({ k: c.k, n: `${Math.round(c.need)}${c.u}`, v: `${Math.round(c.have)}${c.u}`, o: h('b', { style: { color: c.ok ? '#7bd389' : '#ef5f5f' } }, c.ok ? '적합' : '부족') })))),
      h('div', { class: 'note', style: { fontSize: '11.5px', marginTop: '4px' } }, '건축법 시행령 제27조·국토부 조경기준 근사. 지자체 조례 비율이 다르면 조례가 우선합니다. 옥상조경은 법정면적의 50%까지 2/3 인정.'));
    const pick = (k, g) => h('div', { class: 'row', style: { gap: '6px', alignItems: 'center', marginTop: '6px' } }, h('span', { style: { width: '64px' } }, g === '교목' ? '교목 수종' : '관목 수종'), h('select', { 'data-k': k }, ...SPECIES.filter(s => s.g === g).map(s => h('option', { value: s.id }, `${s.name} ${s.spec}${s.ever ? ' · 상록' : ''}`))));
    side.append(h('h4', { style: { margin: '14px 0 4px' } }, '직접 심기'), pick('tree', '교목'), pick('shrub', '관목'));
    if (sel) { const x = L.plan.find(y => y.id === sel); if (x) { const s = SP[x.sp]; side.append(h('div', { class: 'card', style: { marginTop: '8px' } }, h('b', {}, `${s.name} ${s.spec}`), h('div', { class: 'row', style: { gap: '6px', marginTop: '6px', alignItems: 'center' } },
      h('select', { onchange: e => { x.sp = e.target.value; save(); all(); } }, ...SPECIES.filter(q => q.g === s.g).map(q => h('option', { value: q.id, selected: q.id === x.sp }, q.name))),
      s.g === '관목' ? h('input', { type: 'number', value: x.n, style: { width: '70px' }, onchange: e => { x.n = Math.max(1, +e.target.value || 1); save(); all(); } }) : null, s.g === '관목' ? '주' : null,
      h('button', { class: 'btn sm', onclick: () => { L.plan = L.plan.filter(y => y.id !== sel); sel = null; save(); all(); } }, '삭제')))); } }
    if (R.rows.length) side.append(h('h4', { style: { margin: '14px 0 6px' } }, '수목 일람표'), h('div', { class: 'tbl' }, table([{ label: '구분', key: 'g' }, { label: '수종', key: 'name' }, { label: '규격', key: 'spec' }, { label: '수량', key: 'q', num: true }, { label: '금액(천원)', key: 'c', num: true }, { label: 'CO₂ kg/년', key: 'co', num: true }],
      R.rows.map(r => ({ g: r.g, name: r.name + (r.ever ? ' ●' : '') + (r.native ? '' : ' (외래)'), spec: r.spec, q: `${r.n.toLocaleString()}${r.unit || '주'}`, c: Math.round(r.cost / 1000).toLocaleString(), co: r.co2y.toFixed(0) })))), h('div', { class: 'note', style: { fontSize: '11.5px' } }, '● 상록. 단가는 굴취·운반·식재·지주 포함 근사, CO₂는 수종별 연간 흡수량 근사.'));
    if (L.areas?.length) side.append(h('h4', { style: { margin: '14px 0 6px' } }, `그린 녹지 ${L.areas.length}개`), ...L.areas.map((a, i) => h('div', { class: 'row', style: { gap: '6px', alignItems: 'center' } }, `${a.roof ? '옥상' : '지상'} ${i + 1} · ${(Math.abs(polyArea(a.pts)) / 1e6).toFixed(1)}㎡`, h('button', { class: 'btn sm', onclick: () => { L.areas.splice(i, 1); save(); all(); } }, '삭제'))));
  }
  async function exportXLSX() { const { writeBook } = await import('../js/excel.js');
    const rows = [['구분', '수종', '규격', '수량', '단위', '단가', '금액', '상록', '향토', 'CO₂ kg/년'], ...R.rows.map(r => [r.g, r.name, r.spec, r.n, r.unit || '주', r.price, r.cost, r.ever ? '○' : '', r.native ? '○' : '', +r.co2y.toFixed(1)]), [], ['합계', '', '', '', '', '', R.cost, '', '', +R.co2.toFixed(1)]];
    const chk = [['항목', '기준', '계획', '판정'], ...R.checks.map(c => [c.k, Math.round(c.need), Math.round(c.have), c.ok ? '적합' : '부족'])];
    saveFile(`${P.name.replace(/[\\/:*?"<>|]/g, '_')}_수목일람표.xlsx`, await writeBook([{ name: '수목 일람표', rows, widths: [8, 16, 22, 8, 6, 10, 12, 6, 6, 10] }, { name: '조경기준 검토', rows: chk, widths: [36, 10, 10, 8] }])); }
  const ro = new ResizeObserver(() => paint()); ro.observe(holder);
  all();
  return { unmount() { ro.disconnect(); window.removeEventListener('keydown', onKey); } };
}
