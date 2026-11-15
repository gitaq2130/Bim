// 빌더 구조 — 거동 시뮬레이션 · 슬래브 판 해석 · 시공단계 기둥 축소량 화면 (struct.js 에서 api 로 호출)
import * as THREE from 'three';
import { h, toast, dialog, table, saveFile } from '../js/ui.js';
import { settingsOf, USES, constructionStages } from '../js/structmodel.js';
import { stationForces } from '../js/fem.js';
import { windField, caseField, groundMotion, timeHistory, longTermField, columnShortening, xiOf, ensureModes } from '../js/simcore.js';
import { analyzeSlab } from '../js/plate.js';
import { specOf, FIELDS as RB_FIELDS } from '../js/rebar.js';

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
