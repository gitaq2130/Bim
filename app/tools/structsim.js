// 빌더 구조 — 거동 시뮬레이션 · 슬래브 판 해석 · 시공단계 기둥 축소량 화면 (struct.js 에서 api 로 호출)
import * as THREE from 'three';
import { h, toast, dialog, table, saveFile } from '../js/ui.js';
import { settingsOf, USES, constructionStages } from '../js/structmodel.js';
import { stationForces } from '../js/fem.js';
import { windField, caseField, groundMotion, timeHistory, longTermField, columnShortening, xiOf, ensureModes, pushover } from '../js/simcore.js';
import { analyzeSlab } from '../js/plate.js';
import { specOf, FIELDS as RB_FIELDS, parseN, parseS } from '../js/rebar.js';
import { rebarOf, beamEnds, devLen, envOf, steelFlexure } from '../js/kds.js';
import { SYSTEMS, GRADES } from '../js/structmodel.js';

export const heat = (t) => { t = Math.max(0, Math.min(1, t)); const stops = [[0, [0.19, 0.42, 0.85]], [0.3, [0.2, 0.75, 0.85]], [0.55, [0.45, 0.85, 0.35]], [0.75, [0.98, 0.82, 0.25]], [1, [0.95, 0.25, 0.22]]]; for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) { const [a, ca] = stops[i - 1], [b, cb] = stops[i]; const u = (t - a) / (b - a); return ca.map((v, k) => v + (cb[k] - v) * u); } return stops[4][1]; };
const kN = (v) => (v / 1e3).toFixed(0);
function chart(series, { w = 400, hgt = 120, label = '', unit = '', mark = null, sym = true, color = '#5ab0ff' } = {}) {
  const cv = h('canvas', { width: w, height: hgt, style: { width: '100%', background: '#0f1218', borderRadius: '6px', marginBottom: '4px' } }); const g = cv.getContext('2d');
  const n = series.length; let mx = 1e-12, mn = 0; for (const v of series) { mx = Math.max(mx, sym ? Math.abs(v) : v); mn = Math.min(mn, v); } const lo = sym ? -mx : mn, hi = mx;
  const X = (i) => 34 + i / Math.max(1, n - 1) * (w - 42), Y = (v) => 10 + (hi - v) / (hi - lo || 1) * (hgt - 22);
  g.strokeStyle = '#2a3342'; g.beginPath(); g.moveTo(34, Y(0)); g.lineTo(w - 8, Y(0)); g.stroke(); g.strokeStyle = color; g.lineWidth = 1.2; g.beginPath(); for (let i = 0; i < n; i++) g.lineTo(X(i), Y(series[i])); g.stroke();
  g.fillStyle = '#cfd6e2'; g.font = '11px sans-serif'; g.fillText(label, 38, 12); g.fillStyle = '#8a94a6'; g.fillText(`${hi.toFixed(hi < 10 ? 2 : 0)}${unit}`, 2, 14); if (sym || lo < 0) g.fillText(`${lo.toFixed(hi < 10 ? 2 : 0)}`, 2, hgt - 4);
  cv.mark = (i) => { const c2 = cv.getContext('2d'); c2.putImageData(img, 0, 0); c2.strokeStyle = '#ff9f1c'; c2.beginPath(); c2.moveTo(X(i), 4); c2.lineTo(X(i), hgt - 4); c2.stroke(); };
  const img = g.getImageData(0, 0, w, hgt); if (mark != null) cv.mark(mark); return cv;
}
function profile(rows, { w = 400, hgt = 260, label = '', lim = null, unit = '' } = {}) { // rows: [{y(0..1), vals:[{v,color}]}]
  const cv = h('canvas', { width: w, height: hgt, style: { width: '100%', background: '#0f1218', borderRadius: '6px', marginBottom: '4px' } }); const g = cv.getContext('2d');
  let mx = lim || 0; for (const r of rows) for (const v of r.vals) if (v.v != null) mx = Math.max(mx, Math.abs(v.v)); mx = mx * 1.1 || 1; const X = (v) => 40 + v / mx * (w - 60), Y = (y) => hgt - 16 - y * (hgt - 34);
  g.strokeStyle = '#2a3342'; g.beginPath(); g.moveTo(40, 16); g.lineTo(40, hgt - 16); g.lineTo(w - 10, hgt - 16); g.stroke();
  const ns = rows[0]?.vals.length || 0; for (let k = 0; k < ns; k++) { g.strokeStyle = rows[0].vals[k].color; g.lineWidth = 1.5; g.beginPath(); let pen = false; for (const r of rows) { const v = r.vals[k].v; if (v == null) { pen = false; continue; } pen ? g.lineTo(X(v), Y(r.y)) : g.moveTo(X(v), Y(r.y)); pen = true; } g.stroke(); }
  if (lim) { g.strokeStyle = '#ff4d4f'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(X(lim), 16); g.lineTo(X(lim), hgt - 16); g.stroke(); g.setLineDash([]); }
  g.fillStyle = '#cfd6e2'; g.font = '11px sans-serif'; g.fillText(label, 44, 12); g.fillStyle = '#8a94a6'; g.fillText(`${mx.toFixed(mx < 1 ? 3 : 1)}${unit}`, w - 70, hgt - 4); return cv;
}
const sec = (t) => h('h4', { style: { margin: '14px 0 6px' } }, t);
const row = (...xs) => h('div', { class: 'row', style: { gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '6px' } }, ...xs);
const lab = (t, el) => h('label', { class: 'row', style: { gap: '6px', alignItems: 'center' } }, h('span', { class: 'note', style: { minWidth: '64px' } }, t), el);

// =====================================================================
// 거동 시뮬레이션
export function simUI(api) {
  const { side } = api; const res = api.C.res; const sp = res.info.seis; let raf = 0, playing = true, t0 = performance.now();
  const S = api.simState ||= { kind: res.cases.includes('WX') ? 'wind' : 'eq', deg: 0, V: api.C.S.wind.V0, grav: false, sweep: true, scale: 1, gm: 'synthetic', pga: 0.22, eqDeg: 0, dur: 20, days: 3650, lc: res.combos[1]?.id || 'LC1', speed: 1 };
  const anim = api.anim.build(); let th = null, frame = 0, info = h('div'), charts = h('div');
  const size = anim.size; const vmaxOf = (f) => { let m = 0; for (let i = 0; i < f.length; i += 3) m = Math.max(m, Math.hypot(f[i], f[i + 1], f[i + 2])); return m; };
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), size * 0.25, 0x5ab0ff, size * 0.06, size * 0.035); api.G.add(arrow); arrow.visible = false;
  const placeArrow = (deg, color) => { const a = deg * Math.PI / 180; const dir = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)); const c = anim.center; arrow.position.set(c.x - dir.x * size * 0.75, c.y, c.z - dir.z * size * 0.75); arrow.setDirection(dir); arrow.setColor(color); arrow.visible = true; };
  function render() {
    side.innerHTML = '';
    const kinds = [['wind', '풍하중 — 방향·풍속'], ['eq', '지진 — 시간이력 (모드중첩)'], ['lt', '장기처짐 — 크리프 시간 경과'], ['case', '하중 케이스·조합 — 진동 표시']].filter(([k]) => k !== 'wind' || res.cases.includes('WX'));
    side.append(h('div', { class: 'note', style: { marginBottom: '8px', lineHeight: 1.6 } }, '해석 모델의 선형 응답으로 외력 방향·종류·시간에 따른 건물 변형을 애니메이션으로 보여줍니다. 색은 변위 크기, 변형은 보기 쉽게 확대해 표시합니다.'),
      row(sel(kinds, S.kind, v => { S.kind = v; th = null; frame = 0; render(); })),
      row(lab('변형 배율', h('input', { type: 'range', min: 0.2, max: 5, step: 0.1, value: S.scale, style: { width: '150px' }, oninput: e => { S.scale = +e.target.value; } })), h('button', { class: 'btn sm', onclick: () => { playing = !playing; render(); } }, playing ? '일시정지' : '재생')));
    if (S.kind === 'wind') {
      side.append(row(lab('풍향 θ', h('input', { type: 'range', min: 0, max: 360, step: 5, value: S.deg, style: { width: '150px' }, oninput: e => { S.deg = +e.target.value; S.sweep = false; render(); } })), h('span', { class: 'mono' }, `${S.deg}°`)),
        row(lab('풍속 V0', h('input', { type: 'range', min: 10, max: 60, step: 1, value: S.V, style: { width: '150px' }, oninput: e => { S.V = +e.target.value; render(); } })), h('span', { class: 'mono' }, `${S.V} m/s`)),
        row(h('label', { class: 'row', style: { gap: '4px' } }, h('input', { type: 'checkbox', checked: S.sweep, onchange: e => { S.sweep = e.target.checked; } }), '풍향 회전'), h('label', { class: 'row', style: { gap: '4px' } }, h('input', { type: 'checkbox', checked: S.grav, onchange: e => { S.grav = e.target.checked; } }), '자중 포함')));
      // 풍향별 지붕 변위 극좌표
      const V0 = api.C.S.wind.V0; const pts = []; for (let d = 0; d < 360; d += 10) { const f = windField(res, d, S.V / V0); let m = 0; const top = res.story[res.story.length - 1]; for (let i = 0; i < res.M.nodes.length; i++) if (res.M.nodes[i].dia === top.dia) m = Math.max(m, Math.hypot(f[i * 3], f[i * 3 + 1])); pts.push([d, m]); }
      const cv = h('canvas', { width: 260, height: 260, style: { width: '62%', background: '#0f1218', borderRadius: '6px' } }); const g = cv.getContext('2d'); const mx = Math.max(...pts.map(p => p[1])) || 1; g.strokeStyle = '#2a3342'; for (const r of [0.33, 0.66, 1]) { g.beginPath(); g.arc(130, 130, 110 * r, 0, 7); g.stroke(); } g.strokeStyle = '#5ab0ff'; g.beginPath(); for (const [d, m] of [...pts, pts[0]]) { const a = d * Math.PI / 180; g.lineTo(130 + Math.cos(a) * 110 * m / mx, 130 - Math.sin(a) * 110 * m / mx); } g.stroke(); g.fillStyle = '#cfd6e2'; g.font = '11px sans-serif'; g.fillText(`최대 ${mx.toFixed(1)} mm`, 8, 252); g.fillText('0°=+X', 214, 126); g.fillText('90°=+Y', 140, 12);
      side.append(sec('풍향별 최상층 최대 변위'), cv, info);
    } else if (S.kind === 'eq') {
      side.append(row(sel([['synthetic', '합성 지진파 (중간 지반)'], ['soft', '합성 지진파 (연약 지반)'], ['firm', '합성 지진파 (단단한 지반)'], ['sine', `정현파 — 1차 주기 공진`], ['pulse', '근거리 펄스']], S.gm, v => { S.gm = v; th = null; render(); })),
        row(lab('PGA', h('input', { type: 'range', min: 0.05, max: 0.6, step: 0.01, value: S.pga, style: { width: '140px' }, oninput: e => { S.pga = +e.target.value; e.target.parentNode.nextSibling.textContent = `${S.pga.toFixed(2)} g`; } })), h('span', { class: 'mono' }, `${S.pga.toFixed(2)} g`)),
        row(lab('방향', h('input', { type: 'range', min: 0, max: 180, step: 15, value: S.eqDeg, style: { width: '140px' }, oninput: e => { S.eqDeg = +e.target.value; e.target.parentNode.nextSibling.textContent = `${S.eqDeg}°`; } })), h('span', { class: 'mono' }, `${S.eqDeg}°`)),
        row(lab('지속시간', h('input', { type: 'number', value: S.dur, style: { width: '70px' }, onchange: e => { S.dur = Math.max(5, Math.min(60, +e.target.value || 20)); } })), h('span', { class: 'note' }, '초'), h('button', { class: 'btn primary sm', onclick: runEQ }, th ? '다시 계산' : '시간이력 계산')), info, charts);
      if (th) drawEQCharts();
    } else if (S.kind === 'lt') {
      const tSl = h('input', { type: 'range', min: 0, max: 1, step: 0.001, value: Math.log10(S.days + 1) / Math.log10(3651), style: { width: '170px' }, oninput: e => { S.days = Math.round(Math.pow(3651, +e.target.value) - 1); render(); } });
      side.append(row(lab('경과 시간', tSl), h('span', { class: 'mono' }, S.days < 365 ? `${S.days}일` : `${(S.days / 365).toFixed(1)}년`)), h('div', { class: 'note', style: { marginBottom: '6px' } }, `장기처짐 = 즉시처짐(D + 0.25L 지속) × (1 + ξ(t)) + 나머지 활하중, KDS 시간계수 ξ: 3개월 1.0 · 6개월 1.2 · 1년 1.4 · 5년 이상 2.0. 현재 ξ = ${xiOf(S.days).toFixed(2)}`), info);
      const ts = [0, 30, 90, 180, 365, 730, 1825, 3650]; const top = []; for (const d of ts) { const { field } = longTermField(res, d); let m = 0; for (let i = 2; i < field.length; i += 3) m = Math.min(m, field[i]); top.push(-m); }
      side.append(sec('시간에 따른 최대 연직 처짐 (mm)'), chart(top, { label: '0일 → 10년', unit: 'mm', sym: false }));
    } else {
      side.append(row(sel([...res.cases.filter(c => !c.startsWith('T')).map(c => [c, c]), ...res.combos.map(c => [c.id, `${c.id} ${c.name}`])], S.lc, v => { S.lc = v; render(); })), info);
    }
  }
  function sel(opts, v, on) { const s = h('select', { onchange: e => on(e.target.value) }); for (const [k, l] of opts) s.append(h('option', { value: k, selected: String(k) === String(v) }, l)); return s; }
  function runEQ() {
    const T1 = (ensureModes(res).modes[0] || {}).T || 1; const gm = groundMotion({ type: S.gm === 'sine' ? 'sine' : S.gm === 'pulse' ? 'pulse' : 'synthetic', soil: S.gm === 'soft' ? 'soft' : S.gm === 'firm' ? 'firm' : 'medium', pga: S.pga, T: S.gm === 'pulse' ? 1.2 : T1, dur: S.dur, seed: 11 });
    const t = performance.now(); th = timeHistory(res, gm, S.eqDeg); th.gm = gm; th.ms = performance.now() - t; frame = 0; t0 = performance.now(); let mx = 0; for (let i = 0; i < th.n; i++) mx = Math.max(mx, Math.hypot(th.roof[i * 2], th.roof[i * 2 + 1])); th.roofMax = mx; let vb = 0; for (let i = 0; i < th.n; i++) vb = Math.max(vb, Math.hypot(th.Vb[i * 2], th.Vb[i * 2 + 1])); th.VbMax = vb; th.buf = new Float64Array(res.M.nodes.length * 3);
    // 전체 변위 최대 추정 (지붕 변위 기준)
    render();
  }
  function drawEQCharts() {
    charts.innerHTML = ''; const n = th.n, step = Math.max(1, Math.floor(n / 400)); const pick = (arr, k) => { const o = []; for (let i = 0; i < n; i += step) o.push(arr(i)); return o; };
    const c = Math.cos(S.eqDeg * Math.PI / 180), s = Math.sin(S.eqDeg * Math.PI / 180);
    const Vd = sp?.X?.V; const story = res.story;
    charts.append(sec(`응답 (탄성, 감쇠 5%, ${th.modes}개 모드, ${th.ms.toFixed(0)} ms)`),
      th.cg = chart(pick(i => th.gm.a[i] / 9806.65), { label: '지반가속도 (g)' }), th.cr = chart(pick(i => th.roof[i * 2] * c + th.roof[i * 2 + 1] * s), { label: '최상층 변위 (mm)', color: '#ff9f1c' }), th.cv = chart(pick(i => (th.Vb[i * 2] * c + th.Vb[i * 2 + 1] * s) / 1e3), { label: '밑면전단력 (kN)', color: '#7bd389' }),
      sec('층별 최대값 (전 시간)'), profile(story.map((f, i) => ({ y: (i + 1) / story.length, vals: [{ v: th.drMax[i] * 100, color: '#ff9f1c' }] })), { label: '층간변위비 (%) — 탄성', unit: '%' }),
      profile(story.map((f, i) => ({ y: (i + 1) / story.length, vals: [{ v: th.acMax[i] / 9806.65, color: '#5ab0ff' }] })), { label: '층 최대 절대가속도 (g)', unit: 'g' }));
    info.innerHTML = ''; info.append(h('div', { class: 'tbl' }, table([{ label: '항목', key: 'k' }, { label: '값', key: 'v' }], [{ k: '최상층 최대 변위', v: `${th.roofMax.toFixed(1)} mm (H/${Math.round(res.info.hn * 1000 / Math.max(th.roofMax, 1e-9))})` }, { k: '최대 층간변위비 (탄성)', v: `${(Math.max(...th.drMax) * 100).toFixed(3)}%` }, { k: '최대 밑면전단력 (탄성)', v: `${kN(th.VbMax)} kN${Vd ? ` = 설계값의 ${(th.VbMax / Vd).toFixed(1)}배 (설계는 R=${sp.R}로 감소)` : ''}` }])));
  }
  // ---------- 애니메이션 루프 ----------
  let lastKey = '', lastField = null, lastMax = 1;
  function tick() {
    raf = requestAnimationFrame(tick); const now = performance.now(); const t = (now - t0) / 1000 * S.speed; let field = null, vmax = 1, k = 1;
    if (S.kind === 'wind') { if (S.sweep && playing) S.deg = Math.round((t * 30) % 360); const key = `w${S.deg},${S.V},${S.grav}`; if (key !== lastKey) { lastField = windField(res, S.deg, S.V / api.C.S.wind.V0, S.grav); lastMax = vmaxOf(lastField); lastKey = key; } field = lastField; vmax = lastMax; k = playing ? 0.85 + 0.15 * Math.sin(t * 2 * Math.PI / Math.min(4, Math.max(0.8, (res.info.seis?.T?.X || 2)))) : 1; placeArrow(S.deg, 0x5ab0ff);
      if (now - (tick.l || 0) > 250) { tick.l = now; const top = res.story[res.story.length - 1]; let m = 0; for (let i = 0; i < res.M.nodes.length; i++) if (res.M.nodes[i].dia === top.dia) m = Math.max(m, Math.hypot(field[i * 3], field[i * 3 + 1])); info.innerHTML = `<div class="note" style="margin-top:8px">풍향 ${S.deg}° · 풍속 ${S.V} m/s (풍압 ∝ V²) · 최상층 변위 <b>${m.toFixed(1)} mm</b> (H/${Math.round(res.info.hn * 1000 / Math.max(m, 1e-9))})</div>`; } }
    else if (S.kind === 'eq') { arrow.visible = false; if (!th) { anim.update(null); api.markDirty(); return; } if (playing) frame = Math.floor(((now - t0) / 1000 * S.speed) / th.dt) % th.n; field = th.field(frame, th.buf); vmax = th.roofMax * 1.1 || 1; k = 1; placeArrow(S.eqDeg, 0xff9f1c); arrow.scale.setScalar(0.4 + 0.6 * Math.abs(th.gm.a[frame]) / (S.pga * 9806.65)); const i = Math.floor(frame / Math.max(1, Math.floor(th.n / 400))); for (const c of [th.cg, th.cr, th.cv]) c?.mark(i); }
    else if (S.kind === 'lt') { arrow.visible = false; const key = `l${S.days}`; if (key !== lastKey) { const lt = longTermField(res, S.days); lastField = lt.field; lastMax = Math.max(vmaxOf(longTermField(res, 3650).field), 1e-9); lastKey = key; let m = 0; for (let i = 2; i < lastField.length; i += 3) m = Math.min(m, lastField[i]); info.innerHTML = `<div class="note">최대 연직 변위 <b>${(-m).toFixed(1)} mm</b> (${S.days < 365 ? S.days + '일' : (S.days / 365).toFixed(1) + '년'} 후) — 10년 대비 색상</div>`; } field = lastField; vmax = lastMax; }
    else { arrow.visible = false; const cb = res.combos.find(c => c.id === S.lc); const f = cb ? cb.f : { [S.lc]: 1 }; const key = 'c' + S.lc; if (key !== lastKey) { lastField = caseField(res, f); lastMax = vmaxOf(lastField); lastKey = key; } field = lastField; vmax = lastMax; k = playing ? Math.sin(t * 2.2) : 1; }
    anim.update(field, k * anim.size * 1000 * 0.06 / (vmax || 1) * S.scale, vmax); api.markDirty();
  }
  render(); tick();
  return { leave() { cancelAnimationFrame(raf); api.G.remove(arrow); } };
}

// =====================================================================
// 슬래브 판 해석
export function slabUI(api) {
  const { side } = api; const res = api.C.res; const M = res.M; const P = api.P; const S0 = api.C.S;
  const st = api.slabState ||= { idx: 0, h: 0, q: 'wLT', out: null };
  const slabs = M.slabs.map((s, i) => ({ ...s, i, name: `${s.L.name} · ${s.r.el.tag || '슬래브'} t${s.t}` }));
  const ov = h('canvas', { style: { position: 'absolute', inset: 0, width: '100%', height: '100%', background: '#0d1016', cursor: 'crosshair' } }); api.overlay(ov); const tip = h('div', { class: 'mono', style: { position: 'absolute', right: '10px', top: '10px', background: '#0f1218dd', border: '1px solid #2a3342', borderRadius: '6px', padding: '4px 8px', fontSize: '12px', color: '#cfd6e2', pointerEvents: 'none', display: 'none' } }); api.holderEl.append(tip);
  const QTY = { wLT: ['장기처짐 (mm)', 'node'], wL: ['활하중 처짐 (mm)', 'node'], Mx: ['Mx 계수 (kN·m/m)', 'cell'], My: ['My 계수 (kN·m/m)', 'cell'], Asbx: ['하부근 X 필요 (mm²/m)', 'cell'], Asby: ['하부근 Y 필요 (mm²/m)', 'cell'], Astx: ['상부근 X 필요 (mm²/m)', 'cell'], Asty: ['상부근 Y 필요 (mm²/m)', 'cell'], eff: ['유효강성 Ie/Ig (균열)', 'cell'] };
  function run() {
    const s = slabs[st.idx]; if (!s) return; const z = s.z;
    const lines = []; res.R.E.forEach((E, ei) => { const e = E.e; const a = M.nodes[e.n1], b = M.nodes[e.n2]; if (e.vert || a.z !== z || b.z !== z) return; const m = e.mem >= 0 ? M.members[e.mem] : null; lines.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, hw: m ? m.by / 2 : 100, rigid: !!e.rigid }); });
    const pts = []; for (const m of M.members) if (m.kind === 'column') { const e = res.R.E[m.segs[0]].e; const top = M.nodes[e.n2]; if (top.z === z) pts.push({ x: top.x, y: top.y, r: Math.max(m.by, m.hz) / 2 }); }
    const area = Math.abs(s.pts.reduce((a, p, i) => { const q = s.pts[(i + 1) % s.pts.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2; const hh = st.h || Math.min(1000, Math.max(250, Math.sqrt(area / 2200)));
    const isRoof = s.L === M.lv[M.lv.length - 1] || /RF|지붕|옥상/i.test(s.L.name); const LL = isRoof ? S0.LLroof : (USES[S0.use] ?? 2.5); const sdl = isRoof ? (S0.SDLroof ?? S0.SDL) : S0.SDL;
    const t = performance.now(); st.out = analyzeSlab({ pts: s.pts, t: s.t }, { lines, pts }, { qD: s.t * 24e-6 + sdl * 1e-3, qL: LL * 1e-3, fck: S0.fck, fy: S0.fy, h: hh, spec: specOf(P, s.r.el) }); st.out.ms = performance.now() - t; st.out.lines = lines; st.out.pts = pts; st.out.s = s; st.out.LL = LL; st.out.sdl = sdl; render(); paint();
  }
  function valOf(k) { const o = st.out; if (k === 'wLT') return o.wLT.map(v => -v); if (k === 'wL') return Array.from(o.R1.L.w, v => -v); if (k === 'eff') return o.eff; return o.des.map(d => k.startsWith('As') ? (isFinite(d[k]) ? d[k] : 1e6) : d[k] / 1e3); }
  let view = null;
  function paint() {
    const r = ov.getBoundingClientRect(); ov.width = r.width * devicePixelRatio; ov.height = r.height * devicePixelRatio; const g = ov.getContext('2d'); g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); g.clearRect(0, 0, r.width, r.height);
    const o = st.out; if (!o) { g.fillStyle = '#8a94a6'; g.font = '14px sans-serif'; g.fillText('오른쪽에서 슬래브를 고르고 "판 해석"을 누르세요', 24, 40); return; }
    const m = o.mesh; const pad = 50; const sc = Math.min((r.width - 2 * pad - 80) / (m.x1 - m.x0), (r.height - 2 * pad) / (m.y1 - m.y0)); const X = (x) => pad + (x - m.x0) * sc, Y = (y) => r.height - pad - (y - m.y0) * sc; view = { X, Y, sc, m };
    const [lbl, where] = QTY[st.q]; const vals = valOf(st.q); const cellV = where === 'node' ? m.cells.map(c => c.n.reduce((s, n) => s + vals[n], 0) / 4) : vals;
    let lo = Math.min(...cellV), hi = Math.max(...cellV); if (st.q.startsWith('As')) { lo = 0; hi = Math.max(1, ...cellV.filter(v => v < 1e5)); } if (st.q === 'eff') { lo = 0.25; hi = 1; } const sym = (st.q === 'Mx' || st.q === 'My'); if (sym) { const a = Math.max(Math.abs(lo), Math.abs(hi)); lo = -a; hi = a; }
    const col = (v) => { const t = (v - lo) / (hi - lo || 1); const c = sym ? (t < 0.5 ? [0.2 + (0.5 - t) * 0, 0.45 + t, 0.95] : heat(0.5 + (t - 0.5))) : heat(st.q === 'eff' ? 1 - t : t); return `rgb(${c.map(x => Math.round(x * 255)).join(',')})`; };
    for (let i = 0; i < m.cells.length; i++) { const c = m.cells[i]; g.fillStyle = cellV[i] >= 1e5 ? '#ff00ff' : col(cellV[i]); g.fillRect(X(c.x - m.a / 2), Y(c.y + m.b / 2), m.a * sc + 0.6, m.b * sc + 0.6); }
    g.strokeStyle = '#e6edf7'; g.lineWidth = 1; g.beginPath(); o.s.pts.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.closePath(); g.stroke();
    for (const l of o.lines) { g.strokeStyle = l.rigid ? '#9aa6b8' : '#111'; g.lineWidth = Math.max(2, l.hw * 2 * sc * 0.6); g.globalAlpha = 0.7; g.beginPath(); g.moveTo(X(l.ax), Y(l.ay)); g.lineTo(X(l.bx), Y(l.by)); g.stroke(); g.globalAlpha = 1; }
    g.fillStyle = '#111'; for (const p of o.pts) g.fillRect(X(p.x - p.r), Y(p.y + p.r), 2 * p.r * sc, 2 * p.r * sc);
    // 범례
    const lx = r.width - 70; for (let i = 0; i < 160; i++) { g.fillStyle = col(hi - (hi - lo) * i / 159); g.fillRect(lx, 40 + i, 16, 1.2); } g.fillStyle = '#cfd6e2'; g.font = '11px sans-serif'; g.fillText(lbl, Math.max(8, lx - 120), 30); g.fillText(hi.toFixed(hi < 10 ? 2 : 0), lx + 20, 46); g.fillText(lo.toFixed(Math.abs(lo) < 10 ? 2 : 0), lx + 20, 200);
    if (st.q === 'wLT') { const lim = o.defl.limLT; g.fillText(`한계 L/240 ≈ ${lim.toFixed(1)}`, lx - 40, 216); }
    ov.onmousemove = (e) => { const b = ov.getBoundingClientRect(); const x = m.x0 + (e.clientX - b.left - pad) / sc, y = m.y0 + (b.bottom - e.clientY - pad) / sc; const ci = m.cells.findIndex(c => Math.abs(c.x - x) <= m.a / 2 && Math.abs(c.y - y) <= m.b / 2); if (ci < 0) { tip.style.display = 'none'; return; } tip.style.display = ''; const d = o.des[ci]; tip.innerHTML = `${lbl}: <b>${cellV[ci] >= 1e5 ? '단면 부족' : cellV[ci].toFixed(2)}</b><br>Mx ${(d.Mx / 1e3).toFixed(1)} · My ${(d.My / 1e3).toFixed(1)} · Mxy ${(d.Mxy / 1e3).toFixed(1)} kN·m/m<br>장기처짐 ${(-o.wLT[m.cells[ci].n[0]]).toFixed(1)} mm · Ie/Ig ${o.eff[ci].toFixed(2)}`; };
  }
  function render() {
    side.innerHTML = '';
    if (!slabs.length) return side.append(h('div', { class: 'note' }, '해석 모델에 슬래브가 없습니다.'));
    side.append(h('div', { class: 'note', style: { marginBottom: '8px', lineHeight: 1.6 } }, 'MITC4 판 요소로 바닥판을 해석합니다. 보·벽은 선지지, 기둥은 점지지로 보고 바닥 전체를 연속판으로 풉니다. 처짐은 균열 유효강성(Branson)과 장기 계수 λ=2, 배근은 Wood–Armer 설계모멘트로 산정합니다.'),
      row(h('select', { onchange: e => { st.idx = +e.target.value; st.out = null; render(); paint(); } }, slabs.map(s => h('option', { value: s.i, selected: s.i === st.idx }, s.name)))),
      row(lab('요소 크기', h('input', { type: 'number', placeholder: '자동', value: st.h || '', style: { width: '80px' }, onchange: e => { st.h = +e.target.value || 0; } })), h('span', { class: 'note' }, 'mm'), h('button', { class: 'btn primary sm', onclick: () => { side.querySelector('.busy')?.remove(); side.append(h('div', { class: 'note busy' }, '해석 중…')); setTimeout(run, 20); } }, st.out ? '다시 해석' : '판 해석')));
    const o = st.out; if (!o) { paint(); return; }
    side.append(row(h('select', { onchange: e => { st.q = e.target.value; paint(); } }, Object.entries(QTY).map(([k, [l]]) => h('option', { value: k, selected: k === st.q }, l)))));
    const pill = (ok, t) => h('span', { class: 'pill ' + (ok ? 'ok' : 'bad') }, t);
    const dfl = o.defl; const r1 = dfl.L / dfl.limL, r2 = dfl.LT / dfl.limLT, rv = o.Vmax / o.phiVc;
    side.append(h('div', { class: 'tbl' }, table([{ label: '항목', key: 'k' }, { label: '값', key: 'v' }, { label: '', key: 'r' }], [
      { k: '요소 / 자유도', v: `${o.mesh.cells.length.toLocaleString()} (${o.mesh.a.toFixed(0)}×${o.mesh.b.toFixed(0)}) / ${(o.mesh.nodes.length * 3).toLocaleString()} · ${o.ms.toFixed(0)} ms` },
      { k: '하중 (사용)', v: `D ${(o.s.t * 0.024 + o.sdl).toFixed(2)} · L ${o.LL} kN/m² · fck ${S0.fck} · SD${S0.fy}` },
      { k: '활하중 처짐', v: `${dfl.L.toFixed(1)} mm ≤ L/360 = ${dfl.limL.toFixed(1)}`, r: pill(r1 <= 1, r1.toFixed(2)) },
      { k: '장기처짐 (2D+L)', v: `${dfl.LT.toFixed(1)} mm ≤ L/240 = ${dfl.limLT.toFixed(1)} (지배경간 ≈ ${(dfl.span / 1000).toFixed(1)} m)`, r: pill(r2 <= 1, r2.toFixed(2)) },
      { k: '균열 요소 비율', v: `${(o.cracked * 100).toFixed(0)}%` },
      { k: '필요 철근 하부 X/Y', v: `${o.req.bx.toFixed(0)} / ${o.req.by.toFixed(0)} mm²/m` }, { k: '필요 철근 상부 X/Y', v: `${isFinite(o.req.tx) ? o.req.tx.toFixed(0) : '∞'} / ${isFinite(o.req.ty) ? o.req.ty.toFixed(0) : '∞'} mm²/m` },
      { k: '배근', v: o.Apx ? `${specOf(P, o.s.r.el).x} / ${specOf(P, o.s.r.el).y} · ${o.layers}단 (${o.Apx.toFixed(0)}/${o.Apy.toFixed(0)} mm²/m)` : '미입력', r: o.rRebar != null ? pill(o.rRebar <= 1, isFinite(o.rRebar) ? o.rRebar.toFixed(2) : '상부근 없음') : '' },
      { k: '1방향 전단 Vu / φVc', v: `${(o.Vmax).toFixed(0)} / ${o.phiVc.toFixed(0)} N/mm`, r: pill(rv <= 1, rv.toFixed(2)) }])));
    const sugg = (A) => { for (const D of ['D10', 'D13', 'D16']) { const a = { D10: 71.33, D13: 126.7, D16: 198.6 }[D]; const s = Math.floor(a * 1000 / A / 25) * 25; if (s >= 150) return `${D}@${Math.min(s, 300)}`; } return 'D19@150'; };
    side.append(row(h('button', { class: 'btn sm', onclick: async () => { const cur = specOf(P, o.s.r.el) || {}; const v = await dialog({ title: '슬래브 배근', fields: RB_FIELDS.slab.map(([k, l, t]) => ({ key: k, label: l, type: t === 'num' ? 'number' : 'text', value: cur[k] ?? '' })) }); if (!v) return; o.s.r.el.rebar = { ...v, layers: +v.layers || 2 }; api.ctx.touch(o.s.r.sheet.id); run(); } }, '배근 입력'),
      h('button', { class: 'btn sm', onclick: () => { o.s.r.el.rebar = { x: sugg(Math.max(o.req.bx, isFinite(o.req.tx) ? o.req.tx : 0)), y: sugg(Math.max(o.req.by, isFinite(o.req.ty) ? o.req.ty : 0)), layers: 2, cover: 20 }; api.ctx.touch(o.s.r.sheet.id); run(); toast('필요 철근으로 배근했습니다', 'ok'); } }, '필요 철근으로 배근')));
  }
  const ro = new ResizeObserver(() => paint()); ro.observe(ov);
  render(); paint();
  return { leave() { ro.disconnect(); api.overlay(null); tip.remove(); } };
}

// =====================================================================
// 시공단계 기둥 축소량
export function shortUI(api) {
  const { side } = api; const res = api.C.res; const st = api.shortState ||= { cycle: 7, years: 10, phiU: 2.0, shU: 600, out: null, show: 'Tend' };
  const anim = api.anim.build();
  function run() { const t = performance.now(); st.out = columnShortening(res, api.C.S, { cycle: st.cycle, years: st.years, phiU: st.phiU, shU: st.shU * 1e-6 }); st.out.ms = performance.now() - t; render(); show(); }
  function show() {
    if (!st.out) { anim.update(null); api.markDirty(); return; } const f = new Float64Array(res.M.nodes.length * 3); let mx = 0;
    for (const s of st.out.stacks) for (const fl of s.floors) { const v = fl[st.show]; f[fl.node * 3 + 2] = -v; mx = Math.max(mx, v); }
    // 같은 층 강막 절점은 가까운 수직부재 값으로 (보·슬래브 기울기 표현)
    anim.update(f, anim.size * 1000 * 0.08 / (mx || 1), mx); api.markDirty();
  }
  function render() {
    side.innerHTML = '';
    side.append(h('div', { class: 'note', style: { marginBottom: '8px', lineHeight: 1.6 } }, '층별 시공 순서(타설 주기)대로 하중이 쌓일 때 기둥·벽의 탄성·크리프·건조수축 축소량을 계산합니다(ACI 209). 각 층 바닥 타설 후 발생하는 축소량이 레벨 보정 대상입니다. SRC·철골은 강재 비율만큼 크리프를 줄입니다.'),
      row(lab('층당 주기', h('input', { type: 'number', value: st.cycle, style: { width: '60px' }, onchange: e => { st.cycle = Math.max(2, +e.target.value || 7); } })), h('span', { class: 'note' }, '일'), lab('기간', h('input', { type: 'number', value: st.years, style: { width: '50px' }, onchange: e => { st.years = Math.max(1, +e.target.value || 10); } })), h('span', { class: 'note' }, '년')),
      row(lab('크리프 φu', h('input', { type: 'number', step: 0.1, value: st.phiU, style: { width: '60px' }, onchange: e => { st.phiU = +e.target.value || 2; } })), lab('건조수축', h('input', { type: 'number', value: st.shU, style: { width: '60px' }, onchange: e => { st.shU = +e.target.value || 600; } })), h('span', { class: 'note' }, 'με')),
      row(h('button', { class: 'btn primary sm', onclick: run }, st.out ? '다시 계산' : '축소량 계산')));
    const o = st.out; if (!o) return;
    side.append(row(h('select', { onchange: e => { st.show = e.target.value; show(); } }, [['Tend', `${o.years}년 후 (설치 후 누적)`], ['Tc', '준공 시 (설치 후 누적)'], ['total', `${o.years}년 후 전체 (타설 시작부터)`]].map(([k, l]) => h('option', { value: k, selected: k === st.show }, l)))), h('span', { class: 'note' }, `준공 ≈ ${o.Tc}일 · ${o.ms.toFixed(0)} ms`));
    const B = o.byFloor; const n = B.length;
    side.append(sec('층별 축소량 (mm) — 기둥 최대 · 코어벽 평균'), profile(B.map((b, i) => ({ y: (i + 1) / n, vals: [{ v: b.colTend, color: '#e0c27a' }, { v: b.wallTend, color: '#9aa6b8' }, { v: b.colTc, color: '#e0c27a66' }, { v: b.wallTc, color: '#9aa6b866' }] })), { label: '— 장기  ·  흐린 선: 준공 시', unit: ' mm' }));
    side.append(h('div', { class: 'note' }, h('span', { style: { color: '#e0c27a' } }, '■'), ' 기둥  ', h('span', { style: { color: '#9aa6b8' } }, '■'), ' 코어벽'));
    const maxDiff = Math.max(0, ...B.map(b => Math.abs(b.diff ?? 0)));
    side.append(sec(`레벨 보정량 (설치 시 높임, mm) — 최대 부등축소 ${maxDiff.toFixed(1)} mm`), h('div', { class: 'tbl' }, table([{ label: '층', key: 'level' }, { label: '기둥 준공', num: true, render: b => b.colTc?.toFixed(1) ?? '-' }, { label: '기둥 장기', num: true, render: b => b.colTend?.toFixed(1) ?? '-' }, { label: '코어 준공', num: true, render: b => b.wallTc?.toFixed(1) ?? '-' }, { label: '코어 장기', num: true, render: b => b.wallTend?.toFixed(1) ?? '-' }, { label: '부등', num: true, render: b => b.diff != null ? h('span', { style: { color: Math.abs(b.diff) > 10 ? '#ff9f1c' : '' } }, b.diff.toFixed(1)) : '-' }, { label: '보정 기둥/코어', num: true, render: b => `${Math.round(b.colTend ?? 0)}/${Math.round(b.wallTend ?? 0)}` }], [...B].reverse())));
    side.append(row(h('button', { class: 'btn sm', onclick: async () => { const { writeBook } = await import('../js/excel.js'); saveFile(`${api.P.name.replace(/[\\/:*?"<>|]/g, '_')}_기둥축소량.xlsx`, await writeBook([{ name: '층별', rows: [['층', '기둥 준공(mm)', '기둥 장기(mm)', '코어 준공(mm)', '코어 장기(mm)', '부등(mm)'], ...B.map(b => [b.level, b.colTc, b.colTend, b.wallTc, b.wallTend, b.diff].map(v => typeof v === 'number' ? +v.toFixed(2) : v ?? ''))] }, { name: '부재별', rows: [['구분', '태그', 'X', 'Y', '층', '준공(mm)', '장기(mm)', '전체(mm)'], ...o.stacks.flatMap(s => s.floors.map(f => [s.kind === 'wall' ? '벽' : '기둥', s.tag, Math.round(s.x), Math.round(s.y), f.level, +f.Tc.toFixed(2), +f.Tend.toFixed(2), +f.total.toFixed(2)]))] }])); } }, 'Excel')));
  }
  render(); show();
  return { leave() { } };
}

// =====================================================================
// 시공단계 해석 — 일괄 재하 vs 순차 재하 비교
export function csUI(api) {
  const { side } = api; const res = api.C.res; const M = res.M, N = M.nodes; const st = api.csState ||= { out: null, show: 'cs' };
  const anim = api.anim.build();
  function compute() {
    const t = performance.now(); let D0, D1, stages, applied = !!res.info.cs;
    if (applied) { D0 = res.R.cases.D0; D1 = res.R.cases.D; stages = res.info.cs.stages; }
    else { const cs = constructionStages(M, res.model, {}); if (!cs) { toast('층이 2개 이상이어야 시공단계 해석을 할 수 있습니다', 'err'); return; } D0 = res.R.cases.D; D1 = cs.case; stages = cs.stages; }
    const byz = new Map(); N.forEach((n, i) => { if (!n.used || !n.vert) return; const a = byz.get(n.z) || { a: 0, b: 0 }; a.a = Math.min(a.a, D0.disp[i * 6 + 2]); a.b = Math.min(a.b, D1.disp[i * 6 + 2]); byz.set(n.z, a); });
    const zs = [...byz.keys()].sort((a, b) => a - b);
    const beams = [], verts = [];
    M.members.forEach((m, mi) => {
      const s0 = m.segs[0], s1 = m.segs[m.segs.length - 1];
      if (m.kind === 'beam') { for (const [ei, xi, end] of [[s0, 0, '시작'], [s1, 1, '끝']]) { const a = stationForces(res.R, D0, ei, [xi])[0].My, b = stationForces(res.R, D1, ei, [xi])[0].My; beams.push({ mi, m, end, a, b, d: b - a }); } }
      else { const a = -stationForces(res.R, D0, s0, [0])[0].N, b = -stationForces(res.R, D1, s0, [0])[0].N; verts.push({ mi, m, a, b, d: b - a, r: a ? (b - a) / Math.abs(a) : 0 }); }
    });
    beams.sort((p, q) => Math.abs(q.d) - Math.abs(p.d)); verts.sort((p, q) => Math.abs(q.r) - Math.abs(p.r));
    st.out = { D0, D1, stages, applied, zs, byz, beams, verts, ms: performance.now() - t }; render(); show();
  }
  function show() {
    const o = st.out; if (!o) { anim.update(null); api.markDirty(); return; } const d = st.show === 'cs' ? o.D1.disp : o.D0.disp; const f = new Float64Array(N.length * 3); let mx = 0;
    for (let i = 0; i < N.length; i++) { f[i * 3] = d[i * 6]; f[i * 3 + 1] = d[i * 6 + 1]; f[i * 3 + 2] = d[i * 6 + 2]; mx = Math.max(mx, Math.hypot(d[i * 6], d[i * 6 + 1], d[i * 6 + 2])); }
    let ref = 0; for (let i = 0; i < N.length; i++) if (N[i].vert) ref = Math.max(ref, Math.abs(o.D0.disp[i * 6 + 2]), Math.abs(o.D1.disp[i * 6 + 2]));
    anim.update(f, anim.size * 1000 * 0.08 / (ref || 1), ref); api.markDirty();
  }
  const tag = (m) => `${m.r.level.name} ${m.el.tag || ''}`.trim();
  function render() {
    side.innerHTML = ''; const cs = res.info.cs;
    side.append(h('div', { class: 'note', style: { marginBottom: '8px', lineHeight: 1.6 } }, '층 순서대로 골조를 세우고 각 층 고정하중을 그때까지 지어진 부분 구조에만 재하합니다. 새 층은 처진 하부 위에 설계 레벨로 설치된다고 보므로(레벨 보정) 상층 연직변위가 줄고, 기둥·코어의 부등 축소에 따른 보 모멘트 재분배가 일괄 재하와 달라집니다.'),
      h('div', { class: 'card', style: { marginBottom: '8px' } }, h('div', { class: 'd' }, '설계 반영'), h('div', { style: { fontSize: '12.5px', marginTop: '4px' } }, cs ? `적용 — 고정하중 D를 ${cs.G}단계 순차 재하 결과로 검토 (툴 산정: 15층 또는 50 m 이상)` : '미적용 — 저층이라 일괄 재하로 검토합니다. 아래 비교는 참고용입니다.')));
    if (!st.out) { side.append(row(h('button', { class: 'btn primary sm', onclick: () => { side.append(h('div', { class: 'note' }, '계산 중…')); setTimeout(compute, 20); } }, cs ? '비교 보기' : '시공단계 비교 계산'))); return; }
    const o = st.out; const pct = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
    side.append(row(h('select', { onchange: e => { st.show = e.target.value; show(); } }, [['cs', '시공단계 (순차 재하) 변형'], ['all', '일괄 재하 변형']].map(([k, l]) => h('option', { value: k, selected: k === st.show }, l))), h('span', { class: 'note' }, `${o.stages.length}단계 · ${(o.stages.reduce((a, x) => a + x.ms, 0) / 1000).toFixed(1)}초`)));
    const zmax = o.zs[o.zs.length - 1] || 1, z0 = o.zs[0];
    side.append(sec('층별 기둥·벽 최대 연직변위 (mm, 고정하중)'), profile(o.zs.map(z => ({ y: (z - z0) / (zmax - z0 || 1), vals: [{ v: -o.byz.get(z).a, color: '#8a94a6' }, { v: -o.byz.get(z).b, color: '#ff9f1c' }] })), { label: '— 회색: 일괄 재하 · 주황: 시공단계', unit: ' mm' }));
    const top = o.byz.get(zmax); const peak = Math.max(...o.zs.map(z => -o.byz.get(z).b)); const zp = o.zs.find(z => -o.byz.get(z).b === peak);
    side.append(h('div', { class: 'note' }, `최상층 ${(-top.a).toFixed(1)} → ${(-top.b).toFixed(1)} mm · 시공단계 최대 ${peak.toFixed(1)} mm (높이 ${(zp / 1000).toFixed(1)} m)`));
    side.append(sec('보 단부 고정하중 모멘트 변화 (상위 15)'), h('div', { class: 'tbl' }, table([{ label: '보', render: b => tag(b.m) }, { label: '단부', key: 'end' }, { label: '일괄 kN·m', num: true, render: b => (b.a / 1e6).toFixed(1) }, { label: '시공단계', num: true, render: b => (b.b / 1e6).toFixed(1) }, { label: '변화', num: true, render: b => h('span', { style: { color: Math.abs(b.d) > 0.2 * Math.abs(b.a) ? '#ff9f1c' : '' } }, (b.d / 1e6).toFixed(1)) }], o.beams.slice(0, 15), { onRow: b => api.select?.(b.mi) })));
    side.append(sec('기둥·벽 하단 고정하중 축력 변화 (상위 10)'), h('div', { class: 'tbl' }, table([{ label: '부재', render: v => tag(v.m) }, { label: '종류', render: v => v.m.kind === 'wall' ? '벽' : '기둥' }, { label: '일괄 kN', num: true, render: v => (v.a / 1e3).toFixed(0) }, { label: '시공단계', num: true, render: v => (v.b / 1e3).toFixed(0) }, { label: '변화', num: true, render: v => pct(v.r) }], o.verts.slice(0, 10))));
    side.append(sec('시공 단계'), h('div', { class: 'tbl' }, table([{ label: '단계', render: x => x.s + 1 }, { label: '층 높이 (m)', render: x => `${(x.z0 / 1000).toFixed(1)} ~ ${(x.z1 / 1000).toFixed(1)}` }, { label: '요소', num: true, key: 'nEl' }, { label: '자유도', num: true, key: 'dof' }, { label: '불안정', num: true, render: x => x.weak || '-' }], o.stages)));
    side.append(row(h('button', { class: 'btn sm', onclick: async () => { const { writeBook } = await import('../js/excel.js'); saveFile(`${api.P.name.replace(/[\\/:*?"<>|]/g, '_')}_시공단계.xlsx`, await writeBook([{ name: '층별 연직변위', rows: [['높이(m)', '일괄 재하(mm)', '시공단계(mm)'], ...o.zs.map(z => [+(z / 1000).toFixed(2), +o.byz.get(z).a.toFixed(2), +o.byz.get(z).b.toFixed(2)])] }, { name: '보 단부 모멘트', rows: [['층', '보', '단부', '일괄(kN·m)', '시공단계(kN·m)', '변화(kN·m)'], ...o.beams.map(b => [b.m.r.level.name, b.m.el.tag || '', b.end, +(b.a / 1e6).toFixed(2), +(b.b / 1e6).toFixed(2), +(b.d / 1e6).toFixed(2)])] }, { name: '기둥·벽 축력', rows: [['층', '부재', '종류', '일괄(kN)', '시공단계(kN)', '변화(%)'], ...o.verts.map(v => [v.m.r.level.name, v.m.el.tag || '', v.m.kind === 'wall' ? '벽' : '기둥', +(v.a / 1e3).toFixed(1), +(v.b / 1e3).toFixed(1), +(v.r * 100).toFixed(2)])] }])); } }, 'Excel')));
  }
  render(); if (st.out) show(); else if (res.info.cs) compute();
  return { leave() { } };
}

// =====================================================================
// 푸시오버 (비선형 정적) — 역량곡선 · 성능점 · 소성힌지
const LV = [['탄성', '#3a8fd6'], ['IO 이내', '#4cc38a'], ['LS 이내', '#f5d547'], ['CP 이내', '#ff9f1c'], ['CP 초과', '#ff4d4f']];
export function pushUI(api) {
  const { side } = api; const res = api.C.res; const M = res.M, N = M.nodes; const sp = res.info.seis; const st = api.pushState ||= { dir: 'X', sign: 1, out: null, frame: -1, scale: 1 };
  const anim = api.anim.build(); let pts3 = null;
  const bx = api.P.base?.x || 0, by = api.P.base?.y || 0;
  async function run() {
    const msg = h('div', { class: 'note' }, '계산 중…'); side.append(msg); const t = performance.now();
    st.out = await pushover(res, api.C.S, api.C.D, { dir: st.dir, sign: st.sign, onProgress: (m) => { msg.textContent = m; }, tick: () => new Promise(r => setTimeout(r, 0)) });
    if (!st.out) { toast('강막 층이 없어 푸시오버를 할 수 없습니다', 'err'); return; } st.out.ms = performance.now() - t; st.frame = st.out.frames.length - 1; api.C.push = st.out; render(); show();
  }
  function lvAt(o, i) { // 단계 i 의 힌지 성능 수준
    const f = o.frames[i]; return o.H.map((h, j) => !h.y || h.step >= i ? 0 : Math.abs(f.thp[j]) <= h.lim[0] ? 1 : Math.abs(f.thp[j]) <= h.lim[1] ? 2 : Math.abs(f.thp[j]) <= h.lim[2] ? 3 : 4);
  }
  function show() {
    if (pts3) { api.G.remove(pts3); pts3.geometry.dispose(); pts3.material.dispose(); pts3 = null; }
    const o = st.out; if (!o) { anim.update(null); api.markDirty(); return; } const fr = o.frames[st.frame]; const last = o.frames[o.frames.length - 1].disp; let vmax = 0; for (let i = 0; i < N.length; i++) vmax = Math.max(vmax, Math.hypot(last[i * 3], last[i * 3 + 1], last[i * 3 + 2]));
    const amp = anim.size * 1000 * 0.06 / (vmax || 1) * st.scale; anim.update(fr.disp, amp, vmax || 1);
    const lv = lvAt(o, st.frame); const pos = [], col = [];
    o.H.forEach((h2, j) => { if (!lv[j]) return; const E = res.R.E[h2.ei]; const n = h2.end ? E.e.n2 : E.e.n1, n2 = h2.end ? E.e.n1 : E.e.n2; const a = N[n], b = N[n2]; const t = Math.min(0.12, 400 / (E.L || 1));
      const x = a.x + (b.x - a.x) * t + (fr.disp[n * 3] * (1 - t) + fr.disp[n2 * 3] * t) * amp / 1000, y = a.y + (b.y - a.y) * t + (fr.disp[n * 3 + 1] * (1 - t) + fr.disp[n2 * 3 + 1] * t) * amp / 1000, z = a.z + (b.z - a.z) * t + (fr.disp[n * 3 + 2] * (1 - t) + fr.disp[n2 * 3 + 2] * t) * amp / 1000;
      pos.push((x - bx) / 1000, z / 1000, -(y - by) / 1000); const c = new THREE.Color(LV[lv[j]][1]); col.push(c.r, c.g, c.b); });
    if (pos.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); pts3 = new THREE.Points(g, new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, depthTest: false })); pts3.renderOrder = 10; api.G.add(pts3); }
    api.markDirty();
  }
  function curve(o) {
    const W = 400, H = 240; const cv = h('canvas', { width: W, height: H, style: { width: '100%', background: '#0f1218', borderRadius: '6px' } }); const g = cv.getContext('2d');
    const dmax = Math.max(o.pts[o.pts.length - 1].d, o.tgt?.MCE.dt || 0) * 1.08 || 1, vmax = o.Vmax * 1.15 || 1; const X = (d) => 44 + d / dmax * (W - 56), Y = (v) => H - 26 - v / vmax * (H - 40);
    g.strokeStyle = '#2a3342'; g.beginPath(); g.moveTo(44, 10); g.lineTo(44, H - 26); g.lineTo(W - 8, H - 26); g.stroke();
    g.strokeStyle = '#8a94a6'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(o.dy), Y(o.Vy)); g.lineTo(X(o.pts[o.pts.length - 1].d), Y(o.pts[o.pts.length - 1].V)); g.stroke(); g.setLineDash([]);
    g.strokeStyle = '#5ab0ff'; g.lineWidth = 1.6; g.beginPath(); o.pts.forEach((p, i) => i ? g.lineTo(X(p.d), Y(p.V)) : g.moveTo(X(p.d), Y(p.V))); g.stroke(); g.lineWidth = 1;
    if (o.brittle || o.mech) { const p = o.pts[o.pts.length - 1]; g.fillStyle = '#ff4d4f'; g.beginPath(); g.arc(X(p.d), Y(p.V), 4, 0, 7); g.fill(); }
    if (o.tgt) for (const [k, c, lab] of [['DE', '#ff9f1c', '설계지진'], ['MCE', '#ff4d4f', 'MCE']]) { const t = o.tgt[k]; if (!(t.dt > 0)) continue; g.strokeStyle = c; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(t.dt), 10); g.lineTo(X(t.dt), H - 26); g.stroke(); g.setLineDash([]); g.fillStyle = c; g.font = '11px sans-serif'; g.fillText(`${lab} ${t.dt.toFixed(0)}`, Math.min(W - 80, X(t.dt) + 3), k === 'DE' ? 22 : 36); }
    const p = o.pts[Math.min(st.frame, o.pts.length - 1)]; g.fillStyle = '#e6edf7'; g.beginPath(); g.arc(X(p.d), Y(p.V), 3.5, 0, 7); g.fill();
    g.fillStyle = '#8a94a6'; g.font = '11px sans-serif'; g.fillText(`V (kN) ${o.Vmax.toFixed(0)}`, 4, 12); g.fillText('지붕 변위 (mm) →', W - 110, H - 8); g.fillText(dmax.toFixed(0), W - 36, H - 14); return cv;
  }
  function render() {
    side.innerHTML = '';
    side.append(h('div', { class: 'note', style: { marginBottom: '8px', lineHeight: 1.6 } }, '중력(1.0D+0.25L) 상태에서 등가정적 분포의 수평력을 단계적으로 늘리며, 부재 양단에 소성힌지(기대강도, 탄성-완전소성)가 생길 때마다 강성을 갱신합니다. 전단강도 도달은 취성 파괴로 보고 종료합니다. 목표변위는 변위계수법(C0·C1·C2)으로 산정합니다.'),
      row(h('select', { onchange: e => { st.dir = e.target.value; } }, [['X', 'X 방향'], ['Y', 'Y 방향']].map(([k, l]) => h('option', { value: k, selected: k === st.dir }, l))), h('select', { onchange: e => { st.sign = +e.target.value; } }, [[1, '+ 방향'], [-1, '− 방향']].map(([k, l]) => h('option', { value: k, selected: k === st.sign }, l))), h('button', { class: 'btn primary sm', onclick: () => setTimeout(run, 10) }, st.out ? '다시 계산' : '푸시오버 계산')));
    const o = st.out; if (!o) return; const fmt = (v, d = 0) => v.toFixed(d);
    side.append(curve(o), row(lab('단계', h('input', { type: 'range', min: 0, max: o.frames.length - 1, step: 1, value: st.frame, style: { width: '170px' }, oninput: e => { st.frame = +e.target.value; render(); show(); } })), h('span', { class: 'mono' }, `${st.frame}/${o.frames.length - 1} · V ${fmt(o.pts[st.frame].V)} kN · 힌지 ${o.pts[st.frame].nh}`)),
      row(lab('변형 배율', h('input', { type: 'range', min: 0.2, max: 5, step: 0.1, value: st.scale, style: { width: '120px' }, onchange: e => { st.scale = +e.target.value; show(); } }))),
      h('div', { class: 'note', style: { marginBottom: '6px' } }, LV.slice(1).map(([l, c]) => `<span style="color:${c}">●</span> ${l}`).join('  ')));
    side.lastChild.innerHTML = LV.slice(1).map(([l, c]) => `<span style="color:${c}">●</span> ${l}`).join(' &nbsp; ');
    const W = res.info.Wt / 1e3; const pill = (ok, t) => h('span', { class: 'pill ' + (ok ? 'ok' : 'bad') }, t);
    const rows = [{ k: '종료 사유', v: o.why || '-' }, { k: '초기 강성 / 항복 (이선형)', v: `${fmt(o.Ki, 1)} kN/mm · Vy ${fmt(o.Vy)} kN (Vy/W ${(o.Vy / W).toFixed(3)}) · δy ${fmt(o.dy, 1)} mm` }, { k: '최대 밑면전단', v: `${fmt(o.Vmax)} kN · 힌지 ${o.nH}개 · ${o.pts.length - 1}단계 · ${(o.ms / 1000).toFixed(1)}초` }];
    side.append(sec(`역량곡선 — ${st.dir}${st.sign > 0 ? '+' : '−'}`), h('div', { class: 'tbl' }, table([{ label: '항목', key: 'k' }, { label: '값', key: 'v' }], rows)));
    if (o.tgt) {
      const lim = sp.driftLim; const ev = (k, dl, maxLv, nm) => { const t = o.tgt[k], a = t.at; const ok = a?.reached && a.drift <= dl && a.cnt[maxLv] === 0 && (maxLv >= 3 || a.cnt[3] === 0); return { k: nm, v: a?.reached ? `δt ${fmt(t.dt, 1)} mm · V ${fmt(a.V)} kN · 층간변위 ${(a.drift * 100).toFixed(2)}% (≤ ${(dl * 100).toFixed(1)}%) · 힌지 IO ${a.cnt[0]} / LS ${a.cnt[1]} / CP ${a.cnt[2]} / 초과 ${a.cnt[3]}` : `δt ${fmt(t.dt, 1)} mm — 도달 전 ${o.brittle ? '전단 파괴' : '붕괴'}`, r: pill(ok, ok ? '만족' : '불만족') }; };
      const DE = o.tgt.DE, MC = o.tgt.MCE;
      side.append(sec('성능점 (변위계수법)'), h('div', { class: 'tbl' }, table([{ label: '수준', key: 'k' }, { label: '결과', key: 'v' }, { label: '', key: 'r' }], [
        { k: '계수', v: `Te ${o.tgt.Te.toFixed(2)} s · C0 ${DE.C0.toFixed(2)} · C1 ${DE.C1.toFixed(2)}/${MC.C1.toFixed(2)} · C2 ${DE.C2.toFixed(2)}/${MC.C2.toFixed(2)} · R ${DE.Rs.toFixed(2)}/${MC.Rs.toFixed(2)} · Sa ${DE.Sa.toFixed(3)}/${MC.Sa.toFixed(3)} g`, r: '' },
        ev('DE', lim, 2, '설계지진 — 인명안전'), ev('MCE', lim * 1.5, 3, 'MCE (×1.5) — 붕괴방지')])));
      const a = o.tgt.MCE.at; if (a?.reached) { const worst = o.H.map((h2, j) => ({ h: h2, th: a.thp[j], r: a.thp[j] / h2.lim[2] })).filter(x => x.th > 1e-6).sort((p, q) => q.r - p.r).slice(0, 15);
        if (worst.length) side.append(sec('MCE 시 소성회전각 상위 힌지'), h('div', { class: 'tbl' }, table([{ label: '부재', render: x => { const m = M.members[x.h.mi]; return `${m.r.level.name} ${m.el.tag || ''}`; } }, { label: '종류', render: x => x.h.kind }, { label: '단부·축', render: x => `${x.h.end ? '끝' : '시작'} ${x.h.ax}` }, { label: 'θp (rad)', num: true, render: x => x.th.toFixed(4) }, { label: 'LS / CP', num: true, render: x => `${x.h.lim[1].toFixed(3)} / ${x.h.lim[2].toFixed(3)}` }, { label: '비', num: true, render: x => h('b', { style: { color: x.r > 1 ? '#ff4d4f' : x.th > x.h.lim[1] ? '#ff9f1c' : '' } }, x.r.toFixed(2)) }], worst, { onRow: x => api.select?.(x.h.mi) }))); }
    } else side.append(h('div', { class: 'note', style: { marginTop: '6px' } }, '지진하중이 꺼져 있어 성능점은 산정하지 않습니다.'));
    if (o.brittle) side.append(h('div', { class: 'note', style: { color: '#ff9f1c', marginTop: '6px' } }, `취성 파괴: ${o.brittle.tag} 전단강도 ${(o.brittle.Vn / 1e3).toFixed(0)} kN 도달 — 전단 보강 또는 단면 증대 검토`));
    side.append(row(h('button', { class: 'btn sm', onclick: async () => { const { writeBook } = await import('../js/excel.js'); saveFile(`${api.P.name.replace(/[\\/:*?"<>|]/g, '_')}_푸시오버_${st.dir}.xlsx`, await writeBook([{ name: '역량곡선', rows: [['단계', '밑면전단(kN)', '지붕변위(mm)', '힌지 수'], ...o.pts.map((p, i) => [i, +p.V.toFixed(1), +p.d.toFixed(2), p.nh])] }, { name: '소성힌지', rows: [['층', '부재', '종류', '단부', '축', '발생 단계', '발생 V(kN)', '최종 θp(rad)', 'IO', 'LS', 'CP'], ...o.H.filter(x => x.y).map(x => { const m = M.members[x.mi]; return [m.r.level.name, m.el.tag || '', x.kind, x.end ? '끝' : '시작', x.ax, x.step, +x.V.toFixed(1), +x.thp.toFixed(5), +x.lim[0].toFixed(4), +x.lim[1].toFixed(4), +x.lim[2].toFixed(4)]; })] }])); } }, 'Excel')));
  }
  render(); if (st.out) show();
  return { leave() { if (pts3) { api.G.remove(pts3); pts3.geometry.dispose(); pts3.material.dispose(); } } };
}

// =====================================================================
// 단면·배근도 · 시공도면 — 도면 요소(선·원·문자·치수)를 한 번 만들고 SVG(화면·A3 시트)와 DXF로 출력
// 좌표: 모델 mm (y 위쪽). 문자 높이·오프셋은 출력 용지 mm(ph, ox, oy)로 지정해 축척과 무관하게 읽히게 한다.
const DIA = (s) => { const p = parseN(s) || parseS(s); return p ? +p.d.slice(1) : 0; };
function Pr() {
  const a = [];
  const o = { a,
    L(x1, y1, x2, y2, ly = 'S-CONC') { a.push({ t: 'L', x1, y1, x2, y2, ly }); return o; },
    R(x, y, w, h, ly = 'S-CONC') { o.L(x, y, x + w, y, ly).L(x + w, y, x + w, y + h, ly).L(x + w, y + h, x, y + h, ly).L(x, y + h, x, y, ly); return o; },
    P(pts, ly = 'S-CONC', close = false) { for (let i = 0; i < pts.length - 1; i++) o.L(...pts[i], ...pts[i + 1], ly); if (close) o.L(...pts[pts.length - 1], ...pts[0], ly); return o; },
    C(x, y, r, ly = 'S-REBAR', fill = true) { a.push({ t: 'C', x, y, r, ly, fill }); return o; },
    T(x, y, s, { ph = 2.5, ox = 0, oy = 0, al = 'l', ly = 'S-TEXT', b = false } = {}) { a.push({ t: 'T', x, y, s: String(s), ph, ox, oy, al, ly, b }); return o; },
    D(x1, y1, x2, y2, off, txt) { a.push({ t: 'D', x1, y1, x2, y2, off, txt: txt ?? String(Math.round(Math.hypot(x2 - x1, y2 - y1))), ly: 'S-DIM' }); return o; },
    Q(x, y, ox, oy, txt) { a.push({ t: 'Q', x, y, ox, oy, txt, ly: 'S-TEXT' }); return o; },
    Z(x1, y1, x2, y2) { const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy) || 1, nx = -dy / l * 60, ny = dx / l * 60; o.P([[x1, y1], [mx - dx * 0.05, my - dy * 0.05], [mx + nx, my + ny], [mx - nx, my - ny], [mx + dx * 0.05, my + dy * 0.05], [x2, y2]], 'S-CONC'); return o; }, // 절단선
  };
  return o;
}
function bbox(a) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; const u = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const e of a) { if (e.t === 'L' || e.t === 'D') { u(e.x1, e.y1); u(e.x2, e.y2); } else if (e.t === 'C') { u(e.x - e.r, e.y - e.r); u(e.x + e.r, e.y + e.r); } else if (e.t === 'T' || e.t === 'Q') u(e.x, e.y); } return isFinite(x0) ? { x0, y0, x1, y1, w: x1 - x0 || 1, h: y1 - y0 || 1 } : { x0: 0, y0: 0, x1: 1, y1: 1, w: 1, h: 1 }; }
const SCALES = [1, 2, 5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 150, 200, 250, 300, 500];
// 출력기: mode 'svg' (용지 mm, 축척 s=1/S) 또는 'dxf' (모델 mm)
function emit(cell, out, X, Y, s) {
  const LC = { 'S-CONC': ['#222', 0.35], 'S-REBAR': ['#c8102e', 0.3], 'S-STEEL': ['#0057b8', 0.4], 'S-DIM': ['#555', 0.15], 'S-TEXT': ['#111', 0.15], 'S-WELD': ['#0a7d3b', 0.3] };
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  for (const e of cell.pr.a) {
    if (e.t === 'L') out.line(X(e.x1), Y(e.y1), X(e.x2), Y(e.y2), e.ly, LC[e.ly]);
    else if (e.t === 'C') out.circle(X(e.x), Y(e.y), e.r * s, e.ly, LC[e.ly], e.fill);
    else if (e.t === 'T') out.text(X(e.x) + e.ox, Y(e.y) - e.oy, e.s, e.ph, e.al, e.b);
    else if (e.t === 'Q') { const tx = X(e.x) + e.ox, ty = Y(e.y) - e.oy; out.line(X(e.x), Y(e.y), tx, ty, 'S-TEXT', LC['S-DIM']); out.line(tx, ty, tx + (e.ox >= 0 ? 2 : -2), ty, 'S-TEXT', LC['S-DIM']); out.text(tx + (e.ox >= 0 ? 3 : -3), ty + 0.9, e.txt, 2.2, e.ox >= 0 ? 'l' : 'r'); }
    else if (e.t === 'D') { const dx = e.x2 - e.x1, dy = e.y2 - e.y1, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, nx = -uy, ny = ux; const o2 = e.off; // 용지 mm
      const p1 = [X(e.x1), Y(e.y1)], p2 = [X(e.x2), Y(e.y2)]; const vx = nx * o2, vy = -ny * o2; const q1 = [p1[0] + vx, p1[1] + vy], q2 = [p2[0] + vx, p2[1] + vy]; const sg = Math.sign(o2) || 1;
      out.line(p1[0] + nx * 0.8 * sg, p1[1] - ny * 0.8 * sg, q1[0] + nx * 1.2 * sg, q1[1] - ny * 1.2 * sg, 'S-DIM', LC['S-DIM']); out.line(p2[0] + nx * 0.8 * sg, p2[1] - ny * 0.8 * sg, q2[0] + nx * 1.2 * sg, q2[1] - ny * 1.2 * sg, 'S-DIM', LC['S-DIM']); out.line(...q1, ...q2, 'S-DIM', LC['S-DIM']);
      for (const q of [q1, q2]) out.line(q[0] - 0.8 * (ux - nx), q[1] + 0.8 * (uy - ny), q[0] + 0.8 * (ux - nx), q[1] - 0.8 * (uy - ny), 'S-DIM', LC['S-DIM']);
      const mx = (q1[0] + q2[0]) / 2 + nx * 1.4 * sg, my = (q1[1] + q2[1]) / 2 - ny * 1.4 * sg; out.text(mx, my + (Math.abs(ny) > 0.5 ? (sg > 0 ? 0 : 1.8) : 0.7), e.txt, 2.0, 'c', false, Math.abs(ux) < 0.5 ? -90 : 0); }
  }
}
function svgOut() { const parts = []; const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return { parts, line(x1, y1, x2, y2, ly, c) { parts.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${c[0]}" stroke-width="${c[1]}" stroke-linecap="round"/>`); },
    circle(x, y, r, ly, c, fill) { parts.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${Math.max(r, 0.35).toFixed(2)}" fill="${fill ? c[0] : 'none'}" stroke="${c[0]}" stroke-width="${c[1]}"/>`); },
    text(x, y, s, ph, al, b, rot = 0) { parts.push(`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${ph}" text-anchor="${al === 'c' ? 'middle' : al === 'r' ? 'end' : 'start'}"${b ? ' font-weight="700"' : ''}${rot ? ` transform="rotate(${rot} ${x.toFixed(2)} ${y.toFixed(2)})"` : ''}>${esc(s)}</text>`); } }; }
function dxfOut() { const L = []; const u = (s) => String(s).replace(/[^\x20-\x7e]/g, ch => '\\U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'));
  return { L, line(x1, y1, x2, y2, ly) { L.push('0', 'LINE', '8', ly, '10', x1.toFixed(2), '20', (-y1).toFixed(2), '30', '0', '11', x2.toFixed(2), '21', (-y2).toFixed(2), '31', '0'); },
    circle(x, y, r, ly) { L.push('0', 'CIRCLE', '8', ly, '10', x.toFixed(2), '20', (-y).toFixed(2), '30', '0', '40', r.toFixed(2)); },
    text(x, y, s, ph, al, b, rot = 0) { const h = ph * this.k; const a = al === 'c' ? 1 : al === 'r' ? 2 : 0; L.push('0', 'TEXT', '8', 'S-TEXT', '10', x.toFixed(2), '20', (-y).toFixed(2), '30', '0', '40', h.toFixed(2), '1', u(s), '50', String(-rot), '72', String(a), '11', x.toFixed(2), '21', (-y).toFixed(2), '31', '0'); }, k: 1 }; }
// 칸 하나를 용지 영역(px,py,pw,ph — mm)에 축척 맞춰 배치
function placeCell(cell, out, px, py, pw, ph) {
  const bb = bbox(cell.pr.a); const padL = cell.padL ?? 12, padR = cell.padR ?? 46, padT = 9, padB = 12; const sFit = Math.min((pw - padL - padR) / bb.w, (ph - padT - padB) / bb.h);
  const S = cell.fixed ? 1 : SCALES.find(v => 1 / v <= sFit) || 500; const s = cell.fixed ? 1 : 1 / S;
  const ox = cell.fixed ? px + padL : px + padL + ((pw - padL - padR) - bb.w * s) / 2, oy = cell.fixed ? py + padT + 4 : py + padT + ((ph - padT - padB) - bb.h * s) / 2;
  const X = (x) => ox + (x - bb.x0) * s, Y = (y) => oy + (bb.y1 - y) * s;
  if (cell.title) { out.text(px + 2, py + 5, cell.title, 3, 'l', true); if (!cell.fixed) out.text(px + pw - 2, py + 5, `S = 1/${S}`, 2.2, 'r'); }
  emit(cell, out, X, Y, s); return S;
}
const A3 = { W: 420, H: 297 };
function titleBlock(out, P, sheet, no, total) {
  const x = A3.W - 10, y = A3.H - 10; out.line(10, 10, A3.W - 10, 10, 'S-TEXT', ['#111', 0.5]); out.line(A3.W - 10, 10, A3.W - 10, A3.H - 10, 'S-TEXT', ['#111', 0.5]); out.line(A3.W - 10, A3.H - 10, 10, A3.H - 10, 'S-TEXT', ['#111', 0.5]); out.line(10, A3.H - 10, 10, 10, 'S-TEXT', ['#111', 0.5]);
  const bx = x - 150, by = y - 22; for (const [a, b, c, d] of [[bx, by, x, by], [bx, by, bx, y], [bx, by + 11, x, by + 11], [bx + 100, by, bx + 100, y]]) out.line(a, b, c, d, 'S-TEXT', ['#111', 0.3]);
  out.text(bx + 3, by + 7, P.name, 3.2, 'l', true); out.text(bx + 3, by + 18, sheet, 3.4, 'l', true); out.text(bx + 103, by + 7, `S-${String(no).padStart(3, '0')} / ${total}`, 3, 'l', true); out.text(bx + 103, by + 18, `${new Date().toLocaleDateString('ko-KR')} · 빌더 구조`, 2.4, 'l');
}
// ---------- 부재별 도면 요소 ----------
function beamSection(b, h, rb, title) {
  const p = Pr(); const c = rb.cover || 40, dt = DIA(rb.stir) || 10; p.R(0, 0, b, h); p.R(c, c, b - 2 * c, h - 2 * c, 'S-REBAR'); p.L(c, h - c, c + 7 * dt, h - c - 7 * dt, 'S-REBAR').L(c + 6, h - c, c + 6 + 7 * dt, h - c - 7 * dt, 'S-REBAR');
  const bars = (spec, top) => { const q = parseN(spec); if (!q) return null; const db = +q.d.slice(1); const sMin = Math.max(25, db, 33); const w = b - 2 * (c + dt) - db; const per = Math.max(2, Math.floor((w + sMin) / (db + sMin))); let rem = q.n, k = 0, y0 = top ? h - c - dt - db / 2 : c + dt + db / 2;
    while (rem > 0) { const m = Math.min(rem, per); const y = y0 + (top ? -1 : 1) * k * (db + 25); for (let i = 0; i < m; i++) p.C(m === 1 ? b / 2 : c + dt + db / 2 + w * i / (m - 1), y, db / 2); rem -= m; k++; } return { y: y0, db, layers: k }; };
  const t = bars(rb.top, true), bo = bars(rb.bot, false);
  if (t) p.Q(b - c - dt - t.db / 2, t.y, 10, 5, `상부근 ${rb.top}${t.layers > 1 ? ` (${t.layers}단)` : ''}`); if (bo) p.Q(b - c - dt - bo.db / 2, bo.y, 10, -5, `하부근 ${rb.bot}${bo.layers > 1 ? ` (${bo.layers}단)` : ''}`); p.Q(b - c, h / 2, 10, 0, `늑근 ${rb.stir}`);
  p.D(0, 0, b, 0, -5).D(0, 0, 0, h, 5); return { pr: p, title };
}
function columnSection(bx, hy, rb, title, sh) {
  const p = Pr(); const c = rb.cover || 40, dt = DIA(rb.hoop) || 10; p.R(0, 0, bx, hy); p.R(c, c, bx - 2 * c, hy - 2 * c, 'S-REBAR'); p.L(c, hy - c, c + 7 * dt, hy - c - 7 * dt, 'S-REBAR');
  const q = parseN(rb.main); if (q) { const db = +q.d.slice(1); const S = Math.max(4, Math.round((q.n + 4) / 2)); let nx = Math.min(S - 2, Math.max(2, Math.round(S * bx / (bx + hy)))); const ny = S - nx; const x0 = c + dt + db / 2, x1 = bx - x0, y0 = c + dt + db / 2, y1 = hy - y0;
    for (let i = 0; i < nx; i++) { const x = x0 + (x1 - x0) * i / (nx - 1); p.C(x, y0, db / 2).C(x, y1, db / 2); if (i > 0 && i < nx - 1 && nx > 3 && i % 2 === 0) p.L(x, y0, x, y1, 'S-REBAR'); }
    for (let j = 1; j < ny - 1; j++) { const y = y0 + (y1 - y0) * j / (ny - 1); p.C(x0, y, db / 2).C(x1, y, db / 2); if (ny > 3 && j % 2 === 0) p.L(x0, y, x1, y, 'S-REBAR'); }
    p.Q(x1, y1, 10, 6, `주근 ${rb.main} (${nx}×${ny})`); }
  p.Q(bx - c, hy / 2, 10, -2, `띠철근 ${rb.hoop}${q && (q.n > 8) ? ' + 보조띠철근' : ''}`);
  if (sh) { const cx = bx / 2, cy = hy / 2; p.P([[cx - sh.b / 2, cy - sh.h / 2], [cx + sh.b / 2, cy - sh.h / 2], [cx + sh.b / 2, cy - sh.h / 2 + sh.tf], [cx + sh.tw / 2, cy - sh.h / 2 + sh.tf], [cx + sh.tw / 2, cy + sh.h / 2 - sh.tf], [cx + sh.b / 2, cy + sh.h / 2 - sh.tf], [cx + sh.b / 2, cy + sh.h / 2], [cx - sh.b / 2, cy + sh.h / 2], [cx - sh.b / 2, cy + sh.h / 2 - sh.tf], [cx - sh.tw / 2, cy + sh.h / 2 - sh.tf], [cx - sh.tw / 2, cy - sh.h / 2 + sh.tf], [cx - sh.b / 2, cy - sh.h / 2 + sh.tf]], 'S-STEEL', true); p.Q(cx + sh.b / 2, cy - sh.h / 2, 10, -10, `내장 철골 H-${sh.h}×${sh.b}×${sh.tw}×${sh.tf}`); }
  p.D(0, 0, bx, 0, -5).D(0, 0, 0, hy, 5); return { pr: p, title };
}
function wallSection(L, t, rb, title) {
  const p = Pr(); const c = rb.cover || 30; const Ls = Math.min(L, 1600); const v = parseS(rb.v), hh = parseS(rb.h); const dv = v ? +v.d.slice(1) : 13, dh = hh ? +hh.d.slice(1) : 13;
  p.L(0, 0, Ls, 0).L(0, t, Ls, t); if (Ls < L) p.Z(Ls, -80, Ls, t + 80); p.L(0, 0, 0, t);
  for (const y of rb.layers >= 2 ? [c + dh / 2, t - c - dh / 2] : [t / 2]) p.L(30, y, Ls - 30, y, 'S-REBAR');
  const yv = rb.layers >= 2 ? [c + dh + dv / 2, t - c - dh - dv / 2] : [t / 2 + dh]; if (v) for (let x = 75; x < Ls - 40; x += v.s) for (const y of yv) p.C(x, y, dv / 2);
  p.Q(75, yv[yv.length - 1], 8, 8, `수직근 ${rb.v} ${rb.layers >= 2 ? '복배근' : '단배근'}`); p.Q(Ls * 0.6, rb.layers >= 2 ? c + dh / 2 : t / 2, 8, -7, `수평근 ${rb.h}`); p.D(0, 0, 0, t, 5); p.T(Ls / 2, 0, `벽 길이 ${L} (부분 표시)`, { ph: 2.2, oy: -8, al: 'c' });
  return { pr: p, title, padR: 40 };
}
function beamElevation(m, rb, ends, fck, fy, title) {
  const p = Pr(); const h = m.hz, c = rb.cover || 40; const st = parseS(rb.stir) || { d: 'D10', s: 200 }; const dt = +st.d.slice(1); const tq = parseN(rb.top), bq = parseN(rb.bot); const dbt = tq ? +tq.d.slice(1) : 22, dbb = bq ? +bq.d.slice(1) : 22;
  const w0 = ends[0].w || 0, w1 = ends[1].w || 0; const Lc = Math.max(1000, m.L - w0 / 2 - w1 / 2); const LT = devLen(dbt, fck, fy, { top: h >= 380 }), LB = devLen(dbb, fck, fy);
  p.L(0, 0, Lc, 0).L(0, h, Lc, h);
  for (const [i, E] of ends.entries()) { const x = i ? Lc : 0, w = E.w, sg = i ? 1 : -1; if (E.kind === '기둥' || E.kind === '벽') { p.L(x, -500, x, 0).L(x, h, x, h + 500).L(x + sg * w, -500, x + sg * w, h + 500).Z(x, -500, x + sg * w, -500).Z(x, h + 500, x + sg * w, h + 500); p.T(x + sg * w / 2, h + 500, `${E.kind} ${E.sup?.el?.tag || ''}`, { ph: 2.2, oy: 2, al: 'c' }); }
    else if (E.kind === '보') { p.R(i ? x : x - w, 0, w, h); p.L(i ? x : x - w, 0, i ? x + w : x, h, 'S-DIM'); } }
  const yt = h - c - dt - dbt / 2, yb = c + dt + dbb / 2;
  const barEnd = (i, y, db, L, up) => { const E = ends[i], sg = i ? 1 : -1, x = i ? Lc : 0; if (E.cont) return { x: x + sg * (E.w + 700), cont: true }; if (E.kind === '자유단') return { x: x - sg * c }; const xf = x + sg * (E.w - c - dt - db / 2); return { x: xf, hook: true, hk: 12 * db * (up ? 1 : -1), ld: L.ldh, avail: E.w - c - dt }; };
  for (const [y, db, L, up, spec, nm] of [[yt, dbt, LT, false, rb.top, '상부근'], [yb, dbb, LB, true, rb.bot, '하부근']]) { const a = barEnd(0, y, db, L, up), b2 = barEnd(1, y, db, L, up); p.L(a.x, y, b2.x, y, 'S-REBAR');
    for (const [e, i] of [[a, 0], [b2, 1]]) { if (e.hook) { p.L(e.x, y, e.x, y + e.hk, 'S-REBAR'); p.T(e.x, y + e.hk / 2, `${12 * db}`, { ph: 1.8, ox: i ? 1 : -1, al: i ? 'l' : 'r' }); }
      if (e.cont) p.T(e.x, y, '연속', { ph: 1.8, ox: i ? 1 : -1, oy: 0.6, al: i ? 'l' : 'r' }); }
    p.Q(Lc * (up ? 0.3 : 0.62), y, 0, up ? -26 : 9, `${nm} ${spec}${a.hook || b2.hook ? ` · 외단 90° 갈고리 ldh ${Math.ceil(L.ldh / 10) * 10}` : ''}`); }
  // 이음 구간
  const lapT = Math.ceil(LT.lap / 10) * 10, lapB = Math.ceil(LB.lap / 10) * 10; p.L(Lc / 3, yt - 30, 2 * Lc / 3, yt - 30, 'S-DIM').L(Lc / 3, yt - 15, Lc / 3, yt - 45, 'S-DIM').L(2 * Lc / 3, yt - 15, 2 * Lc / 3, yt - 45, 'S-DIM'); p.T(Lc / 2, yt - 30, `상부근 이음 구간 (L/3) · 이음 ${lapT}`, { ph: 1.9, oy: -3, al: 'c' });
  for (const [x0, x1] of [[0, Lc / 4], [3 * Lc / 4, Lc]]) { p.L(x0, yb + 30, x1, yb + 30, 'S-DIM'); } p.T(Lc / 8, yb + 30, `하부근 이음 (L/4) ${lapB}`, { ph: 1.9, oy: 1.5, al: 'c' });
  // 늑근
  const z = Math.min(2 * h, Lc / 2); const sE = st.s, sM = Math.min(2 * st.s, Math.floor((h - c - 30) / 2 / 25) * 25, 300); const xs = []; for (let x = 50; x <= z; x += sE) xs.push(x); for (let x = xs[xs.length - 1] + sM; x < Lc - z; x += sM) xs.push(x); for (let x = Lc - z; x <= Lc - 49; x += sE) xs.push(x);
  for (const x of xs) p.L(x, c, x, h - c, 'S-REBAR');
  p.D(0, 0, z, 0, -5, `2h=${Math.round(z)} @${sE}`).D(z, 0, Lc - z, 0, -5, `@${sM}`).D(Lc - z, 0, Lc, 0, -5, `@${sE}`).D(0, 0, Lc, 0, -11, `순경간 ${Math.round(Lc)}`).D(0, 0, 0, h, 6);
  p.T(Lc / 2, 0, `늑근 ${st.d} — 단부(2h) @${sE} · 중앙 @${sM}`, { ph: 2.2, oy: -17, al: 'c' });
  return { pr: p, title, padR: 20, padL: 14 };
}
function columnElevation(m, rb, hb, top, fck, fy, title) {
  const p = Pr(); const H = m.L, bx = m.by, c = rb.cover || 40; const q = parseN(rb.main); const db = q ? +q.d.slice(1) : 22; const hp = parseS(rb.hoop) || { d: 'D10', s: 150 }; const dt = +hp.d.slice(1); const L = devLen(db, fck, fy); const lap = Math.ceil(Math.max(L.lap, L.lapc) / 10) * 10;
  const Hc = H - hb; p.L(0, 0, 0, Hc).L(bx, 0, bx, Hc); p.R(-400, Hc, bx + 800, hb).Z(-400, Hc, -400, H).Z(bx + 400, Hc, bx + 400, H); p.L(-400, 0, bx + 400, 0).L(-400, -200, bx + 400, -200).Z(-400, 0, -400, -200).Z(bx + 400, 0, bx + 400, -200);
  const xL = c + dt + db / 2, xR = bx - xL;
  for (const x of [xL, xR]) { p.L(x, -200, x, top ? H - c : H + 300, 'S-REBAR'); if (top) p.L(x, H - c, x + (x === xL ? 1 : -1) * 12 * db, H - c, 'S-REBAR'); p.L(x + (x === xL ? db + 4 : -db - 4), -250, x + (x === xL ? db + 4 : -db - 4), lap, 'S-REBAR'); }
  const lo = Math.max(bx, m.hz, Hc / 6, 450); const ys = []; const s1 = Math.min(hp.s, 100), s2 = Math.min(hp.s, 150); for (let y = 50; y <= lap; y += s1) ys.push(y); for (let y = ys[ys.length - 1] + hp.s; y < Hc - lo; y += hp.s) ys.push(y); for (let y = Math.max(ys[ys.length - 1] + s2, Hc - lo); y <= Hc - 40; y += s2) ys.push(y);
  for (const y of ys) p.L(c, y, bx - c, y, 'S-REBAR');
  p.D(bx, 0, bx, lap, -6, `이음 ${lap}`).D(bx, Hc - lo, bx, Hc, -6, `lo ${Math.round(lo)}`).D(0, -200, 0, H, 10, `층고 ${Math.round(H)}`);
  p.Q(xR, Hc * 0.55, 12, 0, `주근 ${rb.main || '-'}`); p.Q(bx - c, lap / 2, 12, -6, `띠철근 이음구간 ${hp.d}@${s1}`); p.Q(bx - c, Hc * 0.4, 12, -4, `띠철근 ${hp.d}@${hp.s}`); p.Q(bx - c, Hc - lo / 2, 12, 4, `상단 lo 구간 ${hp.d}@${s2}`);
  if (top) p.T(bx / 2, H, `최상층 — 주근 90° 갈고리 ${12 * db} 보 안쪽 정착`, { ph: 2, oy: 3, al: 'c' }); else p.T(bx / 2, H, `상층 주근과 겹침이음 ${lap}`, { ph: 2, oy: 3, al: 'c' });
  return { pr: p, title, padR: 50 };
}
function steelConnDetail(j, m, title) {
  const p = Pr(); const sh = m.sh, t = j.tab; const hb = sh.h; const L = 900; const g = 12;
  p.R(-30, -hb / 2 - 250, 30, hb + 500, 'S-STEEL'); p.T(-15, hb / 2 + 250, j.kind, { ph: 2.2, oy: 2, al: 'c' });
  p.L(g, hb / 2, L, hb / 2, 'S-STEEL').L(g, hb / 2 - sh.tf, L, hb / 2 - sh.tf, 'S-STEEL').L(g, -hb / 2, L, -hb / 2, 'S-STEEL').L(g, -hb / 2 + sh.tf, L, -hb / 2 + sh.tf, 'S-STEEL').L(g, -hb / 2, g, hb / 2, 'S-STEEL').Z(L, -hb / 2 - 40, L, hb / 2 + 40);
  const wp = t.ecc + 40 + (t.cols - 1) * t.p / 2 + (t.cols > 1 ? t.p / 2 : 0); p.R(0, -t.hp / 2, wp, t.hp, 'S-STEEL');
  const xb = t.cols === 1 ? [t.ecc] : [t.ecc - t.p / 2 + t.p / 2, t.ecc + t.p / 2 + t.p / 2]; for (const x of xb) for (let i = 0; i < t.n; i++) p.C(x, (i - (t.n - 1) / 2) * t.p, t.d / 2 + 1, 'S-STEEL', false);
  p.Q(wp, t.hp / 2 - 10, 14, 6, `PL-${t.tp}×${Math.round(t.hp)} (SM355)`); p.Q(xb[xb.length - 1], -(t.n - 1) / 2 * t.p, 14, -6, `${t.bk} F10T ${t.n * t.cols}개 (${t.n}×${t.cols}열) @${t.p}, 연단 ${t.e}`); p.Q(0, -t.hp / 2 + 20, -10, -8, `필릿 ${t.s} 양면 (E49)`);
  if (j.rigid && (j.kind === '철골 기둥' || j.kind === 'SRC 기둥') && j.strong) { p.Q(g, hb / 2 - sh.tf / 2, -12, 8, '플랜지 완전용입(CJP) · 스캘럽 R35'); if (j.items.some(x => /스티프너/.test(x))) { p.L(-30, hb / 2 - sh.tf / 2, -330, hb / 2 - sh.tf / 2, 'S-STEEL').L(-30, -hb / 2 + sh.tf / 2, -330, -hb / 2 + sh.tf / 2, 'S-STEEL'); p.T(-180, -hb / 2, j.items.find(x => /스티프너/.test(x)), { ph: 1.9, oy: -3, al: 'c' }); } }
  else if (j.rigid) p.T(L / 2, -hb / 2, j.type, { ph: 2, oy: -5, al: 'c' });
  p.D(wp + 40, -t.hp / 2, wp + 40, t.hp / 2, -4).D(0, -t.hp / 2, t.ecc, -t.hp / 2, -4).D(L, -hb / 2, L, hb / 2, -4, `${sh.h}`);
  return { pr: p, title, padR: 58, padL: 30 };
}
function textCell(title, lines, maxCh = 95) { const p = Pr(); let y = 0;
  const wrap = (t) => { const out = []; let cur = ''; for (const part of t.split(/(?<= · )|(?<=, )/)) { if ((cur + part).length > maxCh && cur) { out.push(cur); cur = '   ' + part; } else cur += part; } if (cur) out.push(cur); return out; };
  for (const ln of lines) { if (typeof ln === 'object') { const { head, rows, w } = ln; const xs = w.reduce((a, v) => (a.push(a[a.length - 1] + v), a), [2]); const row = (r, b) => { r.forEach((c, i) => p.T(xs[i] + 1.5, y, c, { ph: 2.3, b })); }; p.L(2, y + 3.4, xs[xs.length - 1], y + 3.4, 'S-DIM'); row(head, true); y -= 1.6; p.L(2, y, xs[xs.length - 1], y, 'S-DIM'); y -= 3.6; for (const r of rows) { row(r); y -= 1.4; p.L(2, y, xs[xs.length - 1], y, 'S-DIM'); y -= 3.6; } for (const x of xs) p.L(x, y + 3.6 + 1.4 * 0, x, y + 3.6 + (rows.length + 1) * 5 + 0.2, 'S-DIM'); y -= 2; continue; }
    if (ln.startsWith('## ')) { y -= 2.5; p.T(0, y, ln.slice(3), { ph: 3, b: true }); y -= 5.5; } else for (const w of wrap(ln)) { p.T(2, y, w, { ph: 2.3 }); y -= 4.4; } }
  return { pr: p, title, fixed: true, padL: 6, padR: 4 }; }
// ---------- 부재 묶음 → 도면 칸 ----------
export function memberCells(res, D, J, S, mi) {
  const m = res.M.members[mi]; const d = D[mi]; const rb = rebarOf(res, mi, d); const tag = `${m.r.level.name} ${m.el.tag || ''}`.trim(); const fck = m.fck || (m.kind === 'beam' ? S.fck : S.fckV || S.fck); const out = [];
  if (m.mat === 'STEEL') { for (const j of J.filter(j => j.mi === mi)) out.push(steelConnDetail(j, m, `${tag} ${j.end ? '끝단' : '시작단'} 접합 상세`)); return out; }
  if (m.kind === 'beam' && rb.top && rb.bot) { out.push(beamSection(m.by, m.hz, rb, `${tag} 단면 (${rb.src})`)); out.push(beamElevation(m, rb, beamEnds(res, mi), fck, S.fy, `${tag} 배근 상세`)); }
  else if (m.kind === 'column' && rb.main) { out.push(columnSection(m.by, m.hz, rb, `${tag} 단면 ${m.by}×${m.hz} (${rb.src})`, m.sh)); const fr = res.R.E[m.segs[m.segs.length - 1]].e.n2; let hb = 0, top = true; for (const [ei, E] of res.R.E.entries()) { const e = E.e; if (e.n1 !== fr && e.n2 !== fr) continue; const mm = res.M.members[e.mem]; if (!mm) continue; if (mm.kind === 'beam') hb = Math.max(hb, mm.hz); if (mm.kind === 'column' && e.mem !== mi && e.vert) top = false; } out.push(columnElevation(m, rb, hb || 600, top, fck, S.fy, `${tag} 배근 상세`)); }
  else if (m.kind === 'wall') out.push(wallSection(m.by, m.hz, rb, `${tag} 벽 배근 t${m.hz} (${rb.src})`));
  return out;
}
export function memberSVG(cells) { const out = svgOut(); const n = cells.length; const W = 140, CH = 95, H = CH * n; cells.forEach((c, i) => placeCell({ ...c, padR: Math.min(c.padR ?? 46, 40) }, out, 0, i * CH, W, CH)); return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="background:#fff;border-radius:6px;font-family:'Noto Sans KR','Malgun Gothic',sans-serif">${out.parts.join('')}</svg>`; }
// 일람표·상세 시트 구성
export function drawingSet(res, D, J, S, { scope = 'all' } = {}) {
  const M = res.M; const sheets = []; const grp = (kind, f) => { const g = new Map(); M.members.forEach((m, mi) => { if (m.kind !== kind || !f(m)) return; const k = m.el.tag || `${kind}-${m.by}x${m.hz}`; const a = g.get(k) || g.set(k, { list: [], lv: new Set() }).get(k); a.list.push(mi); a.lv.add(m.r.level.name); }); for (const a of g.values()) a.rep = a.list.reduce((p, q) => (D[q]?.ratio || 0) > (D[p]?.ratio || 0) ? q : p, a.list[0]); return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko', { numeric: true })); };
  const lvs = (a) => { const v = [...a.lv]; return v.length > 3 ? `${v[0]}~${v[v.length - 1]}` : v.join(','); };
  // 구조 일반사항
  const bars = [10, 13, 16, 19, 22, 25, 29]; const fH = S.fck, fV = S.fckV || S.fck; const r10 = (v) => Math.ceil(v / 10) * 10;
  const gen = ['## 1. 설계 기준', 'KDS 41 10 15 (설계하중), KDS 41 17 00 (내진), KDS 14 20 (콘크리트), KDS 14 31 (강구조), KDS 21 50 00 (거푸집·동바리)', '## 2. 재료', `콘크리트 — 보·슬래브 fck ${fH} MPa · 기둥·벽 ${S.zones?.length ? S.zones.map(z => `${M.lv[z.from]?.name}~${M.lv[z.to]?.name} ${z.fck}`).join(', ') : fV} MPa · 기초 ${S.fckF || 30} MPa`, `철근 — 주근 SD${S.fy}, 전단철근 SD${S.fyt || 400} · 강재 SM${S.Fy} · 고력볼트 F10T (마찰접합, 미끄럼계수 0.5) · 용접봉 E49`, '## 3. 피복 두께 (mm)', '슬래브·벽 20~30 · 보·기둥 40 · 흙에 접하는 부재 50 · 기초 75 (흙에 접해 타설)',
    `## 4. 정착·이음 길이 (mm) — 보·슬래브 fck ${fH} / 기둥·벽 fck ${fV}, SD${S.fy}`, { head: ['철근', 'ld 인장', '상부근 ld', 'ldh 갈고리', 'ldt 확대머리', '이음 B급', '기둥·벽 이음'], w: [16, 20, 22, 24, 26, 22, 26], rows: bars.map(db => { const a = devLen(db, fH, S.fy), t = devLen(db, fH, S.fy, { top: true }), v = devLen(db, fV, S.fy); return [`D${db}`, r10(a.ld), r10(t.ld), r10(a.ldh), r10(a.ldt), r10(a.lap), r10(Math.max(v.lap, v.lapc))].map(String); }) }, '피복·순간격 조건(피복 ≥ db, 순간격 ≥ db) 충족 기준 — 미충족 시 ld·이음을 1/0.8배, 상부근: 아래 콘크리트 300 mm 이상인 수평철근(α=1.3)',
    '## 5. 표준갈고리', '주근 90° 갈고리 연장 12db · 180° 갈고리 4db 이상(60 이상) · 늑근·띠철근 135° 갈고리 6db(75 이상)', '## 6. 이음 위치', '보 상부근: 경간 중앙 L/3 구간 · 보 하부근: 지지부 L/4 구간 · 기둥 주근: 층 하단(띠철근 @100 이하), 집중 시 커플러 50% 엇갈림 · 벽 수직근: 층 하단',
    '## 7. 철골', '볼트 구멍 표준(d+2, M24 d+3) · 마찰면 블라스트 처리 · 완전용입 용접부 초음파 탐상 · 스캘럽 R35 · 데크 용접(횡지지) 완료 후 콘크리트 타설', '## 8. 시공 순서', '거푸집 해체: 압축강도 ≥ 2/3·fck 및 14 MPa 확인 · 되받이 동바리 · 기둥 강도가 바닥의 1.4배 초과 시 기둥 주변 선타설'];
  if (scope !== 'detail') { const k = gen.findIndex(x => typeof x === 'string' && x.startsWith('## 5.')); sheets.push({ name: '구조 일반사항', cells: [textCell('구조 일반사항', gen.slice(0, k)), textCell('', gen.slice(k))], cols: 2, rows: 1 }); }
  if (scope !== 'detail') {
    const cols = grp('column', m => m.mat !== 'STEEL').map(([k, a]) => { const m = M.members[a.rep]; const rb = rebarOf(res, a.rep, D[a.rep]); return rb.main ? columnSection(m.by, m.hz, rb, `${k} (${lvs(a)}) ${m.by}×${m.hz}`, m.sh) : null; }).filter(Boolean); if (cols.length) sheets.push({ name: '기둥 일람표', cells: cols, cols: 4, rows: 2 });
    const bms = []; for (const [k, a] of grp('beam', m => m.mat !== 'STEEL')) { const m = M.members[a.rep]; const rb = rebarOf(res, a.rep, D[a.rep]); if (!rb.top) continue; bms.push(beamSection(m.by, m.hz, rb, `${k} (${lvs(a)}) ${m.by}×${m.hz} — 단부`)); const st = parseS(rb.stir); bms.push(beamSection(m.by, m.hz, { ...rb, stir: st ? `${st.d}@${Math.min(2 * st.s, Math.floor((m.hz - 70) / 2 / 25) * 25, 300)}` : rb.stir }, `${k} — 중앙`)); } if (bms.length) sheets.push({ name: '보 일람표', cells: bms, cols: 4, rows: 2 });
    const wls = grp('wall', () => true).map(([k, a]) => { const m = M.members[a.rep]; return wallSection(m.by, m.hz, rebarOf(res, a.rep, D[a.rep]), `${k} (${lvs(a)}) t${m.hz}`); }); if (wls.length) sheets.push({ name: '벽 일람표', cells: wls, cols: 3, rows: 3 });
  }
  if (scope !== 'list') {
    const be = []; for (const [k, a] of grp('beam', m => m.mat !== 'STEEL')) { const c = memberCells(res, D, J, S, a.rep).filter(x => /배근 상세/.test(x.title)); c.forEach(x => { x.title = `${k} (${lvs(a)}) 배근 상세`; }); be.push(...c); } if (be.length) sheets.push({ name: '보 배근 상세', cells: be, cols: 1, rows: 2 });
    const ce = []; for (const [k, a] of grp('column', m => m.mat !== 'STEEL')) { const c = memberCells(res, D, J, S, a.rep).filter(x => /배근 상세/.test(x.title)); c.forEach(x => { x.title = `${k} (${lvs(a)}) 배근 상세`; }); ce.push(...c); } if (ce.length) sheets.push({ name: '기둥 배근 상세', cells: ce, cols: 3, rows: 1 });
    const seen = new Map(); for (const j of J) { const m = M.members[j.mi]; const k = `${m.el.sec}|${j.kind}|${j.type}|${j.tab.bk}|${j.tab.n}|${j.tab.cols}|${j.tab.tp}|${j.items.join()}`; if (!seen.has(k)) seen.set(k, { j, m, n: 0 }); seen.get(k).n++; }
    const sc = [...seen.values()].map((v, i) => steelConnDetail(v.j, v.m, `C${i + 1} ${v.m.el.sec} — ${v.j.kind} ${v.j.rigid ? '강접' : '전단'} (${v.n}곳)`)); if (sc.length) sheets.push({ name: '철골 접합 상세', cells: sc, cols: 2, rows: 2 });
  }
  return sheets;
}
// A3 시트 HTML (인쇄·PDF) / DXF
export function drawingHTML(P, sheets) {
  const pages = []; for (const sh of sheets) { const per = sh.cols * sh.rows; for (let i = 0; i < sh.cells.length; i += per) pages.push({ sh, cells: sh.cells.slice(i, i + per), k: Math.floor(i / per) + 1, nk: Math.ceil(sh.cells.length / per) }); }
  const svgs = pages.map((pg, pi) => { const out = svgOut(); const aw = A3.W - 20, ah = A3.H - 20 - 26; const cw = aw / pg.sh.cols, ch = ah / pg.sh.rows;
    pg.cells.forEach((c, i) => { const cx = 10 + (i % pg.sh.cols) * cw, cy = 10 + Math.floor(i / pg.sh.cols) * ch; placeCell(c, out, cx, cy, cw, ch); out.line(cx, cy + ch, cx + cw, cy + ch, 'S-TEXT', ['#bbb', 0.15]); if (i % pg.sh.cols) out.line(cx, cy, cx, cy + ch, 'S-TEXT', ['#bbb', 0.15]); });
    titleBlock(out, P, `${pg.sh.name}${pg.nk > 1 ? ` (${pg.k}/${pg.nk})` : ''}`, pi + 1, pages.length);
    return `<svg class="pg" viewBox="0 0 ${A3.W} ${A3.H}" xmlns="http://www.w3.org/2000/svg">${out.parts.join('')}</svg>`; });
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>구조 시공도면 — ${P.name.replace(/</g, '')}</title><style>@page{size:A3 landscape;margin:0}body{margin:0;background:#888;font-family:'Noto Sans KR','Malgun Gothic',sans-serif}.pg{display:block;width:420mm;height:297mm;margin:10px auto;background:#fff;page-break-after:always}@media print{body{background:#fff}.pg{margin:0}}</style></head><body>${svgs.join('\n')}</body></html>`;
}
export function drawingDXF(sheets) {
  const out = dxfOut(); let X0 = 0;
  for (const sh of sheets) { let x = X0, y = 0, rowH = 0, col = 0, maxX = X0;
    out.k = 25; out.text(X0, -1500, sh.name, 6, 'l', true);
    for (const c of sh.cells) { const bb = bbox(c.pr.a); const S = c.fixed ? 50 : Math.max(10, SCALES.find(v => 1 / v <= Math.min(160 / bb.w, 110 / bb.h)) || 100); out.k = S; const s = c.fixed ? 1 / 50 : 1;
      const pad = 60 * S / 2; const w = (c.fixed ? 200 * 50 : bb.w) + pad * 2, hh = (c.fixed ? 140 * 50 : bb.h) + pad * 2;
      const X = (v) => x + pad + (v - bb.x0) * (c.fixed ? 50 : 1), Y = (v) => y + pad + (bb.y1 - v) * (c.fixed ? 50 : 1);
      const k = S;
      // 문자·치수 오프셋(용지 mm)을 모델 단위로: X·Y에 S를 곱한 좌표계로 emit
      const Xs = (v) => X(v) / k, Ys = (v) => Y(v) / k; const scaled = { line: (a, b2, c2, d2, ly) => out.line(a * k, b2 * k, c2 * k, d2 * k, ly), circle: (a, b2, r, ly) => out.circle(a * k, b2 * k, r * k, ly), text: (tx, ty, str, ph, al, b, rot) => out.text(tx * k, ty * k, str, ph, al, b, rot) };
      if (c.title) out.text(x, y, c.title + (c.fixed ? '' : `  S=1/${S}`), 3.5, 'l', true);
      emit(c, scaled, Xs, Ys, c.fixed ? 50 / k : 1 / k);
      x += w; rowH = Math.max(rowH, hh); maxX = Math.max(maxX, x); col++; if (col >= sh.cols) { col = 0; x = X0; y += rowH; rowH = 0; } }
    X0 = Math.max(maxX, X0 + 6 * 25 * sh.name.length) + 8000; }
  const lay = ['S-CONC', 'S-REBAR', 'S-STEEL', 'S-DIM', 'S-TEXT', 'S-WELD']; const col = { 'S-CONC': 7, 'S-REBAR': 1, 'S-STEEL': 5, 'S-DIM': 8, 'S-TEXT': 7, 'S-WELD': 3 };
  return ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', String(lay.length), ...lay.flatMap(l => ['0', 'LAYER', '2', l, '70', '0', '62', String(col[l]), '6', 'CONTINUOUS']), '0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', ...out.L, '0', 'ENDSEC', '0', 'EOF'].join('\r\n');
}

// =====================================================================
// 구조계산서 (제출용) — 표지·구조안전 확인 요약·목차·설계개요·하중 근거·해석·층·부재 전수 OK/NG·대표 부재 상세 계산·접합부·기초·시공 체크·비선형
export function reportHTML(P, C) {
  const { res, D, S } = C; const I = res.info, sp = I.seis; const M = res.M.members; const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const kN = (v) => (v / 1e3).toFixed(1), kNm = (v) => (v / 1e6).toFixed(1), f3 = (v) => (+v).toFixed(3);
  const ok = (b) => `<span class="${b ? 'ok' : 'ng'}">${b ? 'OK' : 'NG'}</span>`; const T = (head, rows, cls = '') => `<table class="${cls}"><thead><tr>${head.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const rs = res.cases.includes('RX'); const drift = sp ? Math.max(0, ...res.story.map(f => rs ? Math.max(f.drRX || 0, f.drRY || 0) : Math.max(f.drEX || 0, f.drEY || 0))) * sp.Cd / sp.Ie : null;
  const ng = D.filter(d => d.ratio > 1); const F = C.F || [], J = C.J || [], X = C.X || []; const Fng = F.filter(x => x.ratio > 1), Jng = J.filter(j => j.ratio > 1), Xr = X.filter(x => x.lv === '위험');
  const eq = I.check; const eqOk = Math.abs(eq.D.applied - eq.D.reac) <= Math.max(1, eq.D.applied * 1e-3);
  const lvName = (z) => res.M.lv.find(l => l.elev === z)?.name || (z / 1000).toFixed(1) + 'm'; let gfa = 0; for (const s2 of res.M.slabs) gfa += Math.abs(s2.pts.reduce((a, p, i) => { const q = s2.pts[(i + 1) % s2.pts.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2e6;
  const sysName = sp?.sysName || (SYSTEMS[S.seis?.sys]?.[0] ?? '-'); const push = C.push;
  const checks = [['부재 설계 (KDS 14)', `${D.length}개 중 NG ${ng.length}개 · 최대 검토비 ${f3(Math.max(...D.map(d => d.ratio)))}`, !ng.length],
    ...(sp ? [['층간변위 (KDS 41 17 00)', `최대 ${(drift * 100).toFixed(3)}% ≤ 허용 ${(sp.driftLim * 100).toFixed(1)}%`, drift <= sp.driftLim]] : []),
    ['기초 (지내력·펀칭·전단·휨)', F.length ? `${F.length}개 중 NG ${Fng.length}개${F.some(x => x.qa == null && x.q) ? ' · 허용지내력 미입력(필요 지내력 표기)' : ''}` : '기초 객체 없음', !Fng.length],
    ...(J.length ? [['철골 접합부 (KDS 14 31 25)', `${J.length}개 중 NG ${Jng.length}개`, !Jng.length]] : []),
    ['시공 중 검토', `위험 ${Xr.length} · 경고 ${X.filter(x => x.lv === '경고').length} · 확인 ${X.filter(x => x.lv === '확인').length}`, !Xr.length],
    ...(push?.tgt ? [['비선형 정적해석 (성능점)', `설계지진 ${push.tgt.DE.at?.reached ? `${(push.tgt.DE.at.drift * 100).toFixed(2)}%` : '도달 전 파괴'} · MCE ${push.tgt.MCE.at?.reached ? `${(push.tgt.MCE.at.drift * 100).toFixed(2)}%` : '도달 전 파괴'}`, !!(push.tgt.DE.at?.reached && push.tgt.MCE.at?.reached && push.tgt.MCE.at.cnt[3] === 0)]] : []),
    ['평형 검증 (고정하중)', `작용 ${kN(eq.D.applied)} kN = 반력 ${kN(eq.D.reac)} kN`, eqOk]];
  const allOk = checks.every(c => c[2]);
  const H = []; const sec = (id, t) => H.push(`<h2 id="${id}">${t}</h2>`); const toc = [];
  const S2 = (id, t) => { toc.push([id, t]); sec(id, t); };
  // 1. 설계 개요
  S2('s1', '1. 설계 개요'); H.push(T(['항목', '내용'], [['건물명', esc(P.name)], ['위치', esc(P.site?.address || '-')], ['용도', `${S.use} (활하중 ${USES[S.use] ?? '-'} kN/m²)`], ['규모', `지상 ${res.story.length}개 층 · 높이 ${I.hn.toFixed(1)} m · 연면적(슬래브) ${gfa.toFixed(0)} m²`], ['구조형식', `${sysName} — 부재: ${['column', 'beam', 'wall'].map(k => `${{ column: '기둥', beam: '보', wall: '벽' }[k]} ${M.filter(m => m.kind === k).length}`).join(' · ')}`], ['해석 방법', `3차원 골조 선형정적${I.modal ? ' + 응답스펙트럼(CQC)' : ''}${I.pdelta ? ' · P-Δ' : ''}${I.cs ? ` · 고정하중 시공단계(${I.cs.G}단계)` : ''} · 층 강막`], ['설계 기준', 'KDS 41 10 15 · KDS 41 12 00 · KDS 41 17 00 · KDS 14 20 (콘크리트) · KDS 14 31 (강구조) · KDS 21 50 00 (가설)'], ['해석 프로그램', `빌더 구조해석 (브라우저 내 FEM, 자유도 ${I.dof.toLocaleString()})`]]));
  // 2. 재료·설계 조건
  S2('s2', '2. 재료 및 설계 조건'); if (C.auto) H.push(T(['구분', '항목', '값', '근거'], C.auto.map(r => [r.cat, esc(r.k), esc(r.v), esc(r.why)]), 'k2'));
  H.push(T(['재료', '강도', '비고'], [['콘크리트 (보·슬래브)', `fck ${S.fck} MPa`, `Ec = ${Math.round(8500 * Math.cbrt(S.fck + 4))} MPa`], ['콘크리트 (기둥·벽)', S.zones?.length ? S.zones.map(z => `${res.M.lv[z.from]?.name}~${res.M.lv[z.to]?.name} ${z.fck}`).join(', ') + ' MPa' : `fck ${S.fckV || S.fck} MPa`, '층 구간별'], ['철근', `주근 SD${S.fy} · 전단 SD${S.fyt}`, 'Es = 200,000 MPa'], ['강재', `SM${S.Fy}`, 'E = 205,000 MPa'], ['균열 강성', `보 ${S.crack.beam}Ig · 기둥 ${S.crack.col}Ig · 벽 ${S.crack.wall}Ig`, 'KDS 41 17 00 유효강성']]));
  // 3. 하중
  S2('s3', '3. 설계 하중'); const ts = [...new Set(res.M.slabs.map(x => x.t))].sort((a, b) => a - b);
  H.push('<h3>3.1 고정하중</h3>', T(['슬래브 두께', '자중 (24 kN/m³)', '마감·설비 SDL', '합계'], ts.map(t => [`${t} mm`, `${(t * 0.024).toFixed(2)} kN/m²`, `${S.SDL} kN/m² (지붕 ${S.SDLroof ?? S.SDL})`, `${(t * 0.024 + S.SDL).toFixed(2)} kN/m²`])), '<p class="n">부재 자중(RC 24, 강재 77 kN/m³), 비구조벽은 재료별 선하중(조적 19 kN/m³, 유리 0.8, 경량 0.6 kN/m²).</p>');
  H.push('<h3>3.2 활하중</h3>', T(['구분', '값'], [[S.use, `${USES[S.use]} kN/m²`], ['지붕', `${S.LLroof} kN/m²`]]));
  if (res.cases.includes('WX')) H.push('<h3>3.3 풍하중 (KDS 41 12 00)</h3>', `<p>기본풍속 V0 = ${S.wind.V0} m/s, 노풍도 ${S.wind.exp}, 가스트영향계수 Gf = ${S.wind.Gf}, 풍력계수 Cf = ${S.wind.Cf}. 설계풍압 qz = ½ρ(V0·Kzr)², F = qz·Gf·Cf·B·h.</p>`, T(['층', '높이 (m)', 'Kzr', 'qz (N/m²)', 'Fx (kN)', 'Fy (kN)'], res.story.slice().reverse().map((f, i, a) => [lvName(f.z), ((f.z - res.M.zmin) / 1000).toFixed(1), (I.wind?.Kzr?.[a.length - 1 - i] ?? 0).toFixed(3), (f.qWX || 0).toFixed(0), kN(f.WX || 0), kN(f.WY || 0)]), 'sm'));
  if (sp) H.push('<h3>3.4 지진하중 (KDS 41 17 00)</h3>', T(['항목', '값'], [['지진구역계수 · 위험도계수', `Z ${S.seis.Z} × I ${S.seis.I} = S ${sp.S.toFixed(3)}`], ['지반 · Fa · Fv', `${S.seis.site} · ${sp.Fa.toFixed(2)} · ${sp.Fv.toFixed(2)}`], ['SDS · SD1', `${sp.SDS.toFixed(3)} · ${sp.SD1.toFixed(3)}`], ['내진등급 · Ie · 허용 층간변위', `${S.seis.grade} · ${sp.Ie} · ${(sp.driftLim * 100).toFixed(1)}%`], ['구조시스템 · R · Cd', `${esc(sp.sysName)} · ${sp.R} · ${sp.Cd}`], ['근사주기 Ta · CuTa · 레일리 T', `${sp.Ta.toFixed(2)} · ${(sp.Cu * sp.Ta).toFixed(2)} · ${sp.Tray.X.toFixed(2)}/${sp.Tray.Y.toFixed(2)} s`], ['적용 주기 T (X/Y)', `${sp.T.X.toFixed(2)} / ${sp.T.Y.toFixed(2)} s`], ['Cs (X/Y)', `${sp.X.Cs.toFixed(4)} / ${sp.Y.Cs.toFixed(4)}`], ['건물 유효중량 W', `${kN(I.Wt)} kN`], ['밑면전단력 V = Cs·W (X/Y)', `${kN(sp.X.V)} / ${kN(sp.Y.V)} kN`], ['우발편심', '5%']]),
    T(['층', '높이 (m)', 'W (kN)', 'Fx (kN)', 'Vx (kN)', 'Fy (kN)'], res.story.slice().reverse().map(f => [lvName(f.z), ((f.z - res.M.zmin) / 1000).toFixed(1), kN(f.W), kN(f.EX || 0), kN(f.VEX || 0), kN(f.EY || 0)]), 'sm'));
  H.push('<h3>3.5 하중조합 (강도설계법)</h3>', T(['ID', '조합'], res.combos.map(c => [c.id, esc(c.name)]), 'sm'));
  // 4. 해석 결과
  S2('s4', '4. 구조해석 결과'); H.push(T(['항목', '값'], [['절점 / 요소 / 자유도', `${res.M.nodes.filter(n => n.used).length.toLocaleString()} / ${res.M.elems.length.toLocaleString()} / ${I.dof.toLocaleString()}`], ['평형 — 고정하중', `${kN(eq.D.applied)} = ${kN(eq.D.reac)} kN ${ok(eqOk)}`], ['평형 — 활하중', `${kN(eq.L.applied)} = ${kN(eq.L.reac)} kN`], ...(eq.EX ? [['평형 — 지진 X', `${kN(eq.EX.applied)} = ${kN(-eq.EX.reac)} kN`]] : []), ...(I.weak ? [['불안정 자유도', `${I.weak}개 — 연결 확인 필요`]] : [])]));
  if (I.modal) H.push('<h3>4.1 고유치 해석</h3>', T(['모드', 'T (s)', 'X %', 'Y %', 'RZ %', '누적 X', '누적 Y'], I.modal.modes.slice(0, 12).map((m, i) => [i + 1, m.T.toFixed(3), (m.ratio.X * 100).toFixed(1), (m.ratio.Y * 100).toFixed(1), (m.ratio.RZ * 100).toFixed(1), (m.cum.X * 100).toFixed(1), (m.cum.Y * 100).toFixed(1)]), 'sm'), sp.RSX ? `<p>응답스펙트럼 밑면전단 X ${kN(sp.RSX.Vrs)} kN · Y ${kN(sp.RSY.Vrs)} kN → 등가정적의 85% 보정계수 ${sp.RSX.scale.toFixed(3)} / ${sp.RSY.scale.toFixed(3)}</p>` : '');
  if (sp) H.push('<h3>4.2 층간변위·안정성·비틀림</h3>', T(['층', 'h (m)', 'Δ/h X (%)', 'Δ/h Y (%)', '허용', '판정', 'θ', '비틀림비'], res.story.slice().reverse().map(f => { const x = (rs ? f.drRX : f.drEX) * sp.Cd / sp.Ie, y = (rs ? f.drRY : f.drEY) * sp.Cd / sp.Ie; const th = Math.max(f.thEX || 0, f.thEY || 0), tr = Math.max(f.torEX || 1, f.torEY || 1); return [lvName(f.z), (f.h / 1000).toFixed(2), (x * 100).toFixed(3), (y * 100).toFixed(3), (sp.driftLim * 100).toFixed(1), ok(Math.max(x, y) <= sp.driftLim), `${th.toFixed(3)}${th > 0.1 ? ' (P-Δ)' : ''}`, `${tr.toFixed(2)}${tr > 1.2 ? ' 비정형' : ''}`]; }), 'sm'), `<p class="n">층간변위 = Cd·δxe/Ie (질량중심, ${rs ? '응답스펙트럼' : '등가정적'}). 안정계수 θ ≤ 0.1이면 P-Δ 생략 가능. 비틀림비 > 1.2는 비틀림 비정형.</p>`);
  // 5. 부재 설계 — 전수
  S2('s5', '5. 부재 설계 결과 (전수)');
  const items = (d) => d.rows.filter(r => typeof r[2] === 'number').map(r => `${esc(r[0].replace(/ \(.*\)$/, ''))} ${r[2].toFixed(2)}`).join(' · ');
  const groups = new Map(); D.forEach(d => { const m = M[d.mi]; const k = `${d.type}|${m.el.tag || '-'}|${m.r.level.name}`; const g = groups.get(k); if (!g || d.ratio > g.d.ratio) groups.set(k, { d, m, n: (g?.n || 0) + 1 }); else g.n++; });
  const byType = {}; for (const g of groups.values()) (byType[g.d.type] ||= []).push(g);
  H.push(T(['종류', '개수', 'NG', '최대 검토비', '판정'], Object.entries(byType).map(([k, v]) => { const n = D.filter(d => d.type === k); const mx = Math.max(...n.map(d => d.ratio)); return [k, n.length, n.filter(d => d.ratio > 1).length || '-', f3(mx), ok(mx <= 1)]; })));
  for (const [k, list] of Object.entries(byType)) { list.sort((a, b) => b.d.ratio - a.d.ratio); H.push(`<h3>${k} (${list.length}개 부호·층 묶음)</h3>`, T(['층', '부호', '수량', '단면', '배근', '검토 항목별 비 (≤ 1.0)', '지배', '최대비', '판정'], list.map(({ d, m, n }) => { const rb = rebarOf(res, d.mi, d); const bar = m.mat === 'STEEL' ? '-' : m.kind === 'beam' ? `${rb.top || '-'} / ${rb.bot || '-'} / ${rb.stir}` : m.kind === 'column' ? `${rb.main || '-'} / ${rb.hoop}` : `${rb.v} / ${rb.h} ${rb.layers}단`; return [m.r.level.name, esc(m.el.tag || '-'), n, esc(d.rows[0][1]), esc(bar) + (m.mat !== 'STEEL' ? ` <span class="n">(${rb.src})</span>` : ''), items(d), esc(d.gov), f3(d.ratio), ok(d.ratio <= 1)]; }), 'sm k3')); }
  // 6. 대표 부재 상세 계산
  S2('s6', '6. 대표 부재 상세 계산'); const fmt = (v, u = '') => `${typeof v === 'number' ? (Math.abs(v) >= 1e5 ? v.toExponential(3) : v.toFixed(Math.abs(v) < 10 ? 3 : 1)) : v}${u}`;
  for (const [k, list] of Object.entries(byType)) { const { d, m } = list[0]; const mi = d.mi; H.push(`<h3>${esc(k)} — ${m.r.level.name} ${esc(m.el.tag || '')} (검토비 ${f3(d.ratio)}, ${esc(d.gov)})</h3>`);
    const lines = [];
    if (m.kind === 'beam' && m.mat !== 'STEEL') { const rb = rebarOf(res, mi, d); const env = envOf(res, mi, S); let Mn = 0, Mp = 0, Vu = 0; for (const { st } of env) for (const x of st) { Mn = Math.max(Mn, -x.My); Mp = Math.max(Mp, x.My); Vu = Math.max(Vu, Math.abs(x.Vz)); }
      const b = m.by, h = m.hz, dd = h - 65, fck = S.fck, fy = S.fy, b1 = Math.min(0.85, Math.max(0.65, 0.85 - 0.007 * (fck - 28))); const As = (s3) => { const q = parseN(s3); return q ? q.n * ({ D10: 71.33, D13: 126.7, D16: 198.6, D19: 286.5, D22: 387.1, D25: 506.7, D29: 642.4, D32: 794.2 }[q.d] || 0) : 0; };
      for (const [nm, spec, Mu] of [['부모멘트 (상부근)', rb.top, Mn], ['정모멘트 (하부근)', rb.bot, Mp]]) { const A = As(spec); if (!A) continue; const a = A * fy / (0.85 * fck * b), c = a / b1, et = 0.003 * (dd - c) / c, ey = fy / 2e5, phi = et >= 0.005 ? 0.85 : et <= ey ? 0.65 : 0.65 + 0.2 * (et - ey) / (0.005 - ey), pM = phi * A * fy * (dd - a / 2);
        lines.push(`<b>${nm}</b> As = ${spec} = ${A.toFixed(0)} mm², d = h − 65 = ${dd} mm`, `a = As·fy/(0.85·fck·b) = ${A.toFixed(0)}×${fy}/(0.85×${fck}×${b}) = ${a.toFixed(1)} mm, c = a/β1 = ${c.toFixed(1)} mm (β1 = ${b1.toFixed(3)})`, `εt = 0.003(d − c)/c = ${et.toFixed(4)} → φ = ${phi.toFixed(3)} ${et >= 0.005 ? '(인장지배)' : '(변화구간)'}`, `φMn = φ·As·fy·(d − a/2) = ${kNm(pM)} kN·m ${pM >= Mu ? '≥' : '<'} Mu = ${kNm(Mu)} kN·m → ${ok(pM >= Mu)}`); }
      const sq = parseS(rb.stir); const Vc = Math.sqrt(S.fck) / 6 * b * dd, Vs = sq ? 2 * ({ D10: 71.33, D13: 126.7 }[sq.d] || 71.33) * S.fyt * dd / sq.s : 0; lines.push(`<b>전단</b> Vc = (1/6)√fck·bw·d = ${kN(Vc)} kN, Vs = Av·fyt·d/s = ${kN(Vs)} kN (${rb.stir})`, `φVn = 0.75(Vc + Vs) = ${kN(0.75 * (Vc + Vs))} kN ${0.75 * (Vc + Vs) >= Vu ? '≥' : '<'} Vu = ${kN(Vu)} kN → ${ok(0.75 * (Vc + Vs) >= Vu)}`); }
    else if (m.kind === 'column' && d.pm?.at) { const a = d.pm.at; const u = Math.pow(Math.pow(a.Mx / (a.cx || 1), 1.15) + Math.pow(a.My / (a.cy || 1), 1.15), 1 / 1.15); lines.push(`<b>2축 휨-압축</b> 변형률 적합(εcu = 0.003, 등가응력블록)으로 P-M 상관도 작성, 조합 ${esc(a.c)}`, `Pu = ${kN(a.Pu)} kN 에서 φMnx = ${kNm(a.cx)} kN·m, φMny = ${kNm(a.cy)} kN·m`, `(Mux/φMnx)^α + (Muy/φMny)^α = (${kNm(a.Mx)}/${kNm(a.cx)})^1.15 + (${kNm(a.My)}/${kNm(a.cy)})^1.15 → 검토비 ${f3(u)} → ${ok(u <= 1)}`, `φPn,max = 0.65×0.80×P0 = ${kN(d.pm.CY.phiPmax)} kN`); }
    else if (m.mat === 'STEEL' && m.sh) { const sh = m.sh; const fl0 = steelFlexure(sh, S.Fy, 0); lines.push(`<b>단면</b> ${esc(m.el.sec)} — A = ${sh.A.toFixed(0)} mm², Ix = ${sh.Ix.toExponential(3)} mm⁴, Zx = ${(sh.Zx / 1e3).toFixed(0)}×10³ mm³, Fy = ${S.Fy} MPa`, `Mp = Fy·Zx = ${kNm(fl0.Mp)} kN·m, 플랜지 폭두께비 b/2tf = ${fl0.lf.toFixed(1)} (λp = 0.38√(E/Fy) = ${fl0.lpf.toFixed(1)}) → ${fl0.flb}`, `횡비틀림: Lp = 1.76·ry·√(E/Fy) = ${(fl0.Lp / 1000).toFixed(2)} m, Lr = ${(fl0.Lr / 1000).toFixed(2)} m — Lb·Cb는 아래 표`, `조합력: Pr/φPn ≥ 0.2 → Pr/φPn + 8/9(Mrx/φMnx + Mry/φMny) ≤ 1.0, 그 외 Pr/2φPn + (Mrx/φMnx + Mry/φMny) ≤ 1.0`); }
    if (lines.length) H.push(`<div class="calc">${lines.map(l => `<div>${l}</div>`).join('')}</div>`);
    H.push(T(['항목', '값', '비 / 조합'], d.rows.map(r => [esc(r[0]), esc(r[1]), typeof r[2] === 'number' ? `${f3(r[2])} ${ok(r[2] <= 1)}` : esc(r[2] || '')]), 'sm')); }
  // 7. 접합부
  if (J.length) { S2('s7', '7. 철골 접합부'); const by = {}; for (const j of J) { const k = `${j.kind} — ${j.type}`; (by[k] ||= { n: 0, ng: 0, max: 0 }); by[k].n++; if (j.ratio > 1) by[k].ng++; by[k].max = Math.max(by[k].max, j.ratio); }
    H.push('<p class="n">F10T 고력볼트 마찰접합(미끄럼계수 0.5, 표준구멍), 연결판 SM355, 용접봉 E49. 전단판 볼트군 편심은 탄성법, 강접은 Ff = Mu/(d − tf)로 기둥 플랜지 휨·웨브 항복·크리플링·패널존 검토.</p>', T(['지지 — 형식', '개수', 'NG', '최대비', '판정'], Object.entries(by).map(([k, v]) => [esc(k), v.n, v.ng || '-', f3(v.max), ok(!v.ng)])));
    for (const j of [...J].sort((a, b) => b.ratio - a.ratio).slice(0, 4)) H.push(`<h3>${j.level} ${esc(j.tag)} ${j.end ? '끝단' : '시작단'} — ${esc(j.type)} (${f3(j.ratio)})</h3>`, T(['항목', '값', '비'], j.rows.map(r => [esc(r[0]), esc(r[1]), typeof r[2] === 'number' ? `${f3(r[2])} ${ok(r[2] <= 1)}` : '']), 'sm')); }
  // 8. 기초
  S2('s8', `${J.length ? 8 : 7}. 기초`); H.push(F.length ? T(['종류', '부호', '크기', 'Ps (kN)', 'q / qa (kPa)', '펀칭', '1방향 전단', '휨', '판정'], F.map(x => [x.kind, esc(x.tag || ''), x.size, kN(x.Ps), x.q ? (x.qa == null ? `필요 ≥ ${(x.q * 1e3).toFixed(0)}` : `${(x.q * 1e3).toFixed(0)} / ${(x.qa * 1e3).toFixed(0)}`) : '-', x.rp != null ? f3(x.rp) : '-', x.rv ? f3(x.rv) : '-', x.rm != null ? f3(x.rm) : '-', x.ratio == null ? '기초 없음' : ok(x.ratio <= 1)]), 'sm') : '<p>기초 객체 없음</p>');
  // 9. 시공 중 검토
  const nSec = (J.length ? 9 : 8); S2('s9', `${nSec}. 시공 중 검토`); const Xw = X.filter(x => x.lv !== '확인'); H.push(Xw.length ? T(['등급', '분류', '항목', '내용', '조치'], Xw.map(x => [`<span class="${x.lv === '위험' ? 'ng' : 'warn'}">${x.lv}</span>`, x.cat, esc(x.title), esc(x.detail), esc(x.act)]), 'sm k2') : '<p>위험·경고 항목 없음</p>', T(['확인 항목', '내용'], X.filter(x => x.lv === '확인').map(x => [esc(x.title), esc(x.detail)]), 'sm'));
  // 10. 비선형
  if (push?.tgt) { S2('s10', `${nSec + 1}. 비선형 정적해석 (푸시오버 ${push.dir}${push.sign > 0 ? '+' : '−'})`); const r = (k) => { const t = push.tgt[k], a = t.at; return [k === 'DE' ? '설계지진 — 인명안전' : 'MCE ×1.5 — 붕괴방지', `${t.dt.toFixed(1)} mm`, a?.reached ? `${a.V.toFixed(0)} kN` : '-', a?.reached ? `${(a.drift * 100).toFixed(2)}%` : '도달 전 파괴', a?.reached ? a.cnt.join(' / ') : '-']; };
    H.push(`<p class="n">중력 1.0D+0.25L 후 등가정적 분포 수평력, 부재 양단 소성힌지(기대강도, 탄성-완전소성), 전단강도 도달 시 취성 파괴 종료, 변위계수법 목표변위. 종료: ${esc(push.why)}</p>`, T(['항목', '값'], [['초기강성', `${push.Ki.toFixed(1)} kN/mm`], ['Vy (이선형) · Vy/W', `${push.Vy.toFixed(0)} kN · ${(push.Vy / (I.Wt / 1e3)).toFixed(3)}`], ['Te · C0 · C1 · C2', `${push.tgt.Te.toFixed(2)} s · ${push.tgt.DE.C0.toFixed(2)} · ${push.tgt.DE.C1.toFixed(2)} · ${push.tgt.DE.C2.toFixed(2)}`]]), T(['수준', '목표변위', '밑면전단', '층간변위', '힌지 IO / LS / CP / 초과'], [r('DE'), r('MCE')])); }
  // 결론·한계
  S2('s11', '결론 및 한계'); H.push(`<p>${allOk ? '검토한 모든 항목이 KDS 기준을 만족합니다.' : `기준을 만족하지 않는 항목이 있습니다: ${checks.filter(c => !c[2]).map(c => c[0]).join(', ')}. 해당 부재의 단면·배근·접합 상세를 수정한 뒤 재해석이 필요합니다.`}</p><p class="n">본 계산서는 건축 모델로부터 자동 생성한 구조해석·설계 결과입니다. 배근 미입력 부재는 툴이 제안한 배근(필요 철근량 기준)으로 검토했습니다. RC 매입 철판의 콘크리트 파괴, 철골 기둥 이음·주각, 비선형 동적해석, 균열폭, 패턴 활하중은 포함하지 않습니다. 최종 설계는 건축구조기술사의 검토·확인이 필요합니다.</p>`,
    T(['구분', '성명', '서명', '일자'], [['작성', '', '', new Date().toLocaleDateString('ko-KR')], ['검토', '', '', ''], ['확인 (건축구조기술사)', '', '', '']]));
  // 앞부분: 표지·구조안전 확인 요약·목차
  const cover = `<section class="cover"><div class="ct">구 조 계 산 서</div><div class="cp">${esc(P.name)}</div><table class="cv">${[['위치', esc(P.site?.address || '-')], ['용도', esc(S.use)], ['규모', `${res.story.length}개 층 · ${I.hn.toFixed(1)} m · ${gfa.toFixed(0)} m²`], ['구조형식', esc(sysName)], ['작성일', new Date().toLocaleDateString('ko-KR')]].map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join('')}</table><div class="cf">빌더 구조해석 · KDS 기준</div></section>`;
  const summary = `<section><h2>구조안전 확인 요약</h2><div class="verdict ${allOk ? 'vok' : 'vng'}">종합 판정 — ${allOk ? '적합' : '부적합'}</div>${T(['검토 항목', '결과', '판정'], checks.map(c => [c[0], esc(c[1]), ok(c[2])]))}${sp ? `<h3>내진설계 확인</h3>${T(['항목', '값'], [['내진등급 · 중요도계수', `${S.seis.grade} · ${sp.Ie}`], ['지반 · SDS · SD1', `${S.seis.site} · ${sp.SDS.toFixed(3)} · ${sp.SD1.toFixed(3)}`], ['구조시스템 · R · Cd · Ω0', `${esc(sp.sysName)} · ${sp.R} · ${sp.Cd} · ${({ rc_omf: 3, rc_imf: 3, rc_smf: 3, s_smf: 3, s_imf: 3 })[S.seis.sys] || 2.5}`], ['해석법', `${I.modal ? '응답스펙트럼 + 등가정적' : '등가정적'}`], ['밑면전단력 X · Y', `${kN(sp.X.V)} · ${kN(sp.Y.V)} kN (Cs ${sp.X.Cs.toFixed(4)})`], ['최대 층간변위 / 허용', `${(drift * 100).toFixed(3)}% / ${(sp.driftLim * 100).toFixed(1)}% ${ok(drift <= sp.driftLim)}`]])}` : ''}</section>`;
  const tocH = `<section><h2>목차</h2><ul class="toc">${toc.map(([id, t]) => `<li><a href="#${id}">${t}</a></li>`).join('')}</ul></section>`;
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>구조계산서 — ${esc(P.name)}</title><style>
@page{size:A4;margin:16mm 14mm 18mm}body{font-family:'Noto Sans KR','Malgun Gothic',sans-serif;max-width:900px;margin:24px auto;color:#111;font-size:12.5px;line-height:1.55}
h2{font-size:16px;border-bottom:2px solid #223;padding-bottom:3px;margin-top:28px;page-break-after:avoid}h3{font-size:13.5px;margin:16px 0 4px;page-break-after:avoid}table{border-collapse:collapse;width:100%;margin:6px 0 12px;page-break-inside:auto}tr{page-break-inside:avoid}th,td{border:1px solid #999;padding:3px 6px;text-align:left;vertical-align:top}th{background:#eef0f3}table.sm{font-size:11px}
.ok{color:#080;font-weight:700}.ng{color:#c00;font-weight:700}.warn{color:#b86e00;font-weight:700}.n{color:#555;font-size:11.5px}.calc{background:#f7f8fa;border-left:3px solid #223;padding:6px 10px;margin:6px 0;font-family:'Noto Sans KR',sans-serif}.calc div{margin:2px 0}
.cover{height:250mm;display:flex;flex-direction:column;justify-content:center;align-items:center;page-break-after:always}.ct{font-size:40px;font-weight:700;letter-spacing:6px;margin-bottom:24px}.cp{font-size:22px;margin-bottom:30px}.cv{width:70%}.cv th{width:30%}.cf{margin-top:40px;color:#555}
.verdict{font-size:18px;font-weight:700;padding:10px 14px;margin:8px 0 12px;border-radius:4px}.vok{background:#e6f4ea;color:#0a6b2c}.vng{background:#fdecea;color:#b3261e}.toc{list-style:none;padding-left:4px}.toc li{margin:5px 0;font-size:14px}th{white-space:nowrap}.k2 td:nth-child(-n+2),.k3 td:nth-child(-n+3){white-space:nowrap}section{page-break-after:always}
@media print{body{margin:0;max-width:none}a{color:#111;text-decoration:none}}</style></head><body>${cover}${summary}${tocH}<section>${H.join('\n')}</section></body></html>`;
}
