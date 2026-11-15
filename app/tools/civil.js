// 빌더 토목 — 지형(측점·TIN·등고선), 정지 계획(계획고·균형고), 토공량(절·성토, 터파기, 운반), 우수 배수(합리식·관경·빗물관리시설)
// 참고: Civil 3D 지형/정지/토공 워크플로를 웹으로 단순화
import { h, toast, dialog, saveFile, table, pickFile, readText } from '../js/ui.js';
import { esc } from '../js/util.js';
import { siteInfo, makeTIN, contours, inAny, bboxOf } from '../js/sitegeo.js';

const PIPES = [250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000, 1200];
const Cc = { roof: 0.9, pave: 0.85, green: 0.25, bare: 0.3 };
export function civilCalc(P) {
  const C = P.civil; const S = siteInfo(P); const tin = C.pts?.length >= 3 ? makeTIN(C.pts) : null; const cell = C.cell || 2000;
  const bb = bboxOf([S.site]); const cells = [];
  for (let x = bb.x0 + cell / 2; x < bb.x1; x += cell) for (let y = bb.y0 + cell / 2; y < bb.y1; y += cell) { if (!inAny([x, y], [S.site])) continue; const zt = tin?.z(x, y); cells.push({ x, y, zt, inFp: inAny([x, y], S.fp) }); }
  const valid = cells.filter(c => c.zt != null); const A = cell * cell / 1e6;
  const vol = (pad) => { let cut = 0, fill = 0; for (const c of valid) { const d = c.zt - pad; if (d > 0) cut += d * A; else fill -= d * A; } return { cut, fill }; };
  const zs = valid.map(c => c.zt); const zmin = zs.length ? Math.min(...zs) : 0, zmax = zs.length ? Math.max(...zs) : 0;
  const Cf = C.Cfac ?? 0.9, Lf = C.Lfac ?? 1.25;
  let balance = null; if (valid.length) { let lo = zmin, hi = zmax; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; const v = vol(m); if (v.cut * Cf > v.fill) lo = m; else hi = m; } balance = (lo + hi) / 2; }
  const pad = C.mode === 'balance' || C.pad == null ? balance : C.pad; const v = valid.length ? vol(pad) : { cut: 0, fill: 0 };
  // 터파기 (기초): 건물 외곽 × 깊이 (+ 여굴 0.5 m)
  const lo = Math.min(0, ...P.levels.map(l => l.elev)); const exAuto = lo < 0 ? -lo / 1000 + 1.5 : 1.5; const exDepth = C.exDepth ?? exAuto; /* 지하층이 있으면 최하층 FL + 기초·버림 1.5 m */ const fpArea = S.fpArea; const fpPerim = S.fp.reduce((s, q) => s + q.reduce((a, p, i) => a + Math.hypot(q[(i + 1) % q.length][0] - p[0], q[(i + 1) % q.length][1] - p[1]), 0), 0) / 1000; const exc = (fpArea + fpPerim * 0.5) * exDepth;
  const net = v.cut * Cf + exc * Cf - v.fill; // + 잔토, − 부족
  const haul = Math.abs(net) / Cf * Lf; const trucks = Math.ceil(haul / (C.truck ?? 10)); const days = Math.ceil((v.cut + exc + v.fill) / (C.prod ?? 400));
  const cost = (v.cut + exc) * (C.pExc ?? 4500) + v.fill * (C.pFill ?? 6500) + haul * (C.pHaul ?? 18000);
  // 우수
  const site = S.siteArea, roof = S.fpArea, pave = S.pave.reduce((s, q) => s + Math.abs(q.reduce((a, p, i) => a + p[0] * q[(i + 1) % q.length][1] - q[(i + 1) % q.length][0] * p[1], 0)) / 2, 0) / 1e6;
  const greenL = P.landscape?.last?.green; const green = greenL != null ? greenL : Math.max(0, site - roof - pave);
  const other = Math.max(0, site - roof - pave - green); const Cpost = (roof * Cc.roof + pave * Cc.pave + green * Cc.green + other * Cc.pave) / (site || 1);
  const I = C.I ?? 100; const Aha = site / 1e4; const Qpost = Cpost * I * Aha / 360, Qpre = Cc.bare * I * Aha / 360; // m³/s
  const S0 = (C.slope ?? 1) / 100, n = 0.013; const Dreq = Math.pow(Qpost * n * Math.pow(4, 5 / 3) / (Math.PI * Math.sqrt(S0)), 3 / 8) * 1000; const D = PIPES.find(d => d >= Dreq) || 1500;
  const vFull = (1 / n) * Math.pow(D / 4000, 2 / 3) * Math.sqrt(S0);
  const rain = site >= 1000 ? site * 0.05 : 0; // 빗물관리시설 (서울시 물순환 조례 기준 근사 0.05 m³/㎡)
  return { S, tin, cells, valid, zmin, zmax, balance, pad, cut: v.cut, fill: v.fill, exc, exDepth, exBase: lo < 0, net, haul, trucks, days, cost, cell, Cf, Lf,
    storm: { site, roof, pave, green, other, Cpost, I, Qpost, Qpre, Dreq, D, vFull, slope: C.slope ?? 1, rain, greenFrom: greenL != null ? '조경 툴' : '대지−건물−포장' } };
}
function sampleTerrain(S) {
  const bb = bboxOf([S.site]); const pad = 15000; const x0 = bb.x0 - pad, x1 = bb.x1 + pad, y0 = bb.y0 - pad, y1 = bb.y1 + pad; let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const cx = x0 + (x1 - x0) * 0.75, cy = y0 + (y1 - y0) * 0.7; const pts = [];
  const zf = (x, y) => 50 + (y - y0) / 1000 * 0.06 + (x - x0) / 1000 * 0.02 + 4 * Math.exp(-(((x - cx) / ((x1 - x0) * 0.25)) ** 2 + ((y - cy) / ((y1 - y0) * 0.25)) ** 2));
  const n = 180; for (let i = 0; i < n; i++) { const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0); pts.push([Math.round(x), Math.round(y), Math.round(zf(x, y) * 100) / 100]); }
  for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) pts.push([x, y, Math.round(zf(x, y) * 100) / 100]);
  return pts;
}

export function mount(root, ctx) {
  const P = ctx.P; P.civil ||= { pts: [], mode: 'balance', cell: 2000, I: 100, slope: 1 }; const C = P.civil;
  let R = null, mode = 'view', layer = 'cutfill', sec = null, secPts = [], hover = null;
  const cv = h('canvas', { style: { width: '100%', height: '100%', display: 'block', cursor: 'crosshair', background: '#0d1016' } });
  const holder = h('div', { style: { position: 'relative', flex: 1, minWidth: 0 } }, cv);
  const tip = h('div', { class: 'mono', style: { position: 'absolute', right: '10px', top: '10px', background: '#0f1218dd', border: '1px solid #2a3342', borderRadius: '6px', padding: '4px 8px', fontSize: '12px', color: '#cfd6e2', pointerEvents: 'none', display: 'none' } }); holder.append(tip);
  const side = h('div', { class: 'side', style: { width: '420px', maxWidth: '46vw', overflow: 'auto', padding: '10px 12px' } });
  const tb = h('div', { class: 'row', style: { gap: '6px', padding: '8px 10px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap', alignItems: 'center' } });
  root.append(h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } }, tb, h('div', { style: { display: 'flex', flex: 1, minHeight: 0 } }, holder, side)));
  const save = () => ctx.touch('meta');
  const recalc = () => { try { R = civilCalc(P); P.civil.last = { at: Date.now(), cut: R.cut, fill: R.fill, net: R.net, pad: R.pad, Q: R.storm.Qpost, D: R.storm.D }; } catch (e) { console.error(e); toast('계산 실패: ' + e.message, 'err'); } };
  function renderTB() { tb.innerHTML = ''; const b = (k, l) => h('button', { class: 'btn' + (mode === k ? ' primary' : ''), onclick: () => { mode = k; secPts = []; renderTB(); paint(); } }, l);
    tb.append(h('b', {}, '토목'), b('view', '보기'), b('pt', '측점 추가'), b('sec', '단면선'), h('span', { class: 'note' }, '|'),
      ...[['cutfill', '절·성토'], ['contour', '등고선'], ['slope', '경사']].map(([k, l]) => h('button', { class: 'btn' + (layer === k ? ' primary' : ''), onclick: () => { layer = k; renderTB(); paint(); } }, l)),
      h('span', { style: { flex: 1 } }), h('button', { class: 'btn', onclick: exportXLSX, disabled: !R?.valid.length }, 'Excel'), h('button', { class: 'btn', onclick: exportHTML, disabled: !R?.valid.length }, '토공·배수 보고서')); }
  // ---------- 그리기 ----------
  let view = null;
  function paint() {
    const r = cv.getBoundingClientRect(); if (!r.width) return; cv.width = r.width * devicePixelRatio; cv.height = r.height * devicePixelRatio; const g = cv.getContext('2d'); g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); g.clearRect(0, 0, r.width, r.height);
    if (!R) return; const polys = [R.S.site, ...(C.pts.length ? [C.pts.map(p => [p[0], p[1]])] : [])]; const bb = bboxOf(polys); const pad = 40; const sc = Math.min((r.width - 2 * pad) / (bb.x1 - bb.x0 || 1), (r.height - 2 * pad) / (bb.y1 - bb.y0 || 1));
    const X = (x) => pad + (x - bb.x0) * sc, Y = (y) => r.height - pad - (y - bb.y0) * sc; view = { X, Y, sc, bb, pad, H: r.height };
    // 레이어
    if (R.valid.length && layer === 'cutfill') { const mx = Math.max(0.1, ...R.valid.map(c => Math.abs(c.zt - R.pad))); for (const c of R.valid) { const d = c.zt - R.pad, t = Math.min(1, Math.abs(d) / mx); g.fillStyle = d > 0 ? `rgba(239,95,95,${0.15 + 0.75 * t})` : `rgba(90,176,255,${0.15 + 0.75 * t})`; g.fillRect(X(c.x - R.cell / 2), Y(c.y + R.cell / 2), R.cell * sc + 0.5, R.cell * sc + 0.5); }
      g.fillStyle = '#cfd6e2'; g.font = '11px sans-serif'; g.fillText(`■ 절토(빨강) ■ 성토(파랑) · 계획고 EL ${R.pad?.toFixed(2)} m · 최대 ${mx.toFixed(2)} m`, 10, 16); }
    if (R.tin && layer === 'slope') { for (const t of R.tin.tris) { const ux = (t.B[0] - t.A[0]), uy = (t.B[1] - t.A[1]), uz = t.B[2] - t.A[2], vx = t.C[0] - t.A[0], vy = t.C[1] - t.A[1], vz = t.C[2] - t.A[2]; const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = (ux * vy - uy * vx) / 1000; const sl = Math.hypot(nx, ny) / Math.abs(nz || 1e-9) * 100 / 1000; const tt = Math.min(1, sl / 30); g.fillStyle = `rgba(${Math.round(80 + 175 * tt)},${Math.round(200 - 120 * tt)},90,0.55)`; g.beginPath(); g.moveTo(X(t.A[0]), Y(t.A[1])); g.lineTo(X(t.B[0]), Y(t.B[1])); g.lineTo(X(t.C[0]), Y(t.C[1])); g.fill(); }
      g.fillStyle = '#cfd6e2'; g.font = '11px sans-serif'; g.fillText('경사도: 초록 0% → 빨강 30% 이상', 10, 16); }
    if (R.tin) { const rng = R.zmax - R.zmin || 1; const step = [0.1, 0.25, 0.5, 1, 2, 5].find(s => rng / s <= 25) || 10; const cs = contours(R.tin, step); g.lineWidth = 1;
      for (const c of cs) { const major = Math.abs(c.lv / (step * 5) - Math.round(c.lv / (step * 5))) < 1e-6; g.strokeStyle = major ? '#c9b48a' : '#8a7a5a88'; g.lineWidth = major ? 1.4 : 0.8; g.beginPath(); g.moveTo(X(c.seg[0][0]), Y(c.seg[0][1])); g.lineTo(X(c.seg[1][0]), Y(c.seg[1][1])); g.stroke(); }
      if (layer === 'contour') { g.fillStyle = '#cfd6e2'; g.font = '11px sans-serif'; g.fillText(`등고선 간격 ${step} m (굵은 선 ${step * 5} m) · EL ${R.zmin.toFixed(2)} ~ ${R.zmax.toFixed(2)} m`, 10, 16); } }
    // 대지·건물·포장
    const poly = (pts, stroke, fill, dash) => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))); g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } g.setLineDash(dash || []); g.strokeStyle = stroke; g.lineWidth = 1.5; g.stroke(); g.setLineDash([]); };
    poly(R.S.site, '#ff9f1c', null, [8, 4]); for (const q of R.S.pave) poly(q, '#8a94a6', '#8a94a633'); for (const q of R.S.fp) poly(q, '#e6edf7', '#2a3342cc');
    g.fillStyle = '#7bd389'; for (const p of C.pts) { g.beginPath(); g.arc(X(p[0]), Y(p[1]), 2.2, 0, 7); g.fill(); }
    if (sec) { g.strokeStyle = '#ffffff'; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(X(sec[0][0]), Y(sec[0][1])); g.lineTo(X(sec[1][0]), Y(sec[1][1])); g.stroke(); g.setLineDash([]); g.fillStyle = '#fff'; g.fillText('A', X(sec[0][0]) + 4, Y(sec[0][1]) - 4); g.fillText("A'", X(sec[1][0]) + 4, Y(sec[1][1]) - 4); }
    for (const p of secPts) { g.fillStyle = '#fff'; g.beginPath(); g.arc(X(p[0]), Y(p[1]), 4, 0, 7); g.fill(); }
    if (!C.pts.length) { g.fillStyle = '#8a94a6'; g.font = '14px sans-serif'; g.fillText('측점이 없습니다 — 오른쪽에서 CSV를 불러오거나 샘플 지형을 만드세요', 20, r.height / 2); }
    if (R.S.assumed) { g.fillStyle = '#ffcf8a'; g.font = '11px sans-serif'; g.fillText('대지경계선 없음 — 건물 외곽 +10 m를 가정 (작도에서 SITE 레이어 폴리선으로 지정)', 10, r.height - 10); }
  }
  const toW = (e) => { const b = cv.getBoundingClientRect(); return [view.bb.x0 + (e.clientX - b.left - view.pad) / view.sc, view.bb.y0 + (view.H - (e.clientY - b.top) - view.pad) / view.sc]; };
  cv.addEventListener('mousemove', (e) => { if (!view || !R) return; const [x, y] = toW(e); const zt = R.tin?.z(x, y); if (zt == null) { tip.style.display = 'none'; return; } tip.style.display = ''; tip.innerHTML = `EL <b>${zt.toFixed(2)}</b> m · 계획 ${R.pad?.toFixed(2)} → ${zt > R.pad ? '절토' : '성토'} ${Math.abs(zt - R.pad).toFixed(2)} m`; });
  cv.addEventListener('click', async (e) => { if (!view) return; const p = toW(e);
    if (mode === 'pt') { const zt = R?.tin?.z(p[0], p[1]); const v = await dialog({ title: '측점 추가', fields: [{ key: 'z', label: '표고 EL (m)', type: 'number', value: zt != null ? +zt.toFixed(2) : 50 }] }); if (!v || v.z == null) return; C.pts.push([Math.round(p[0]), Math.round(p[1]), +v.z]); save(); recalc(); renderSide(); paint(); }
    else if (mode === 'sec') { secPts.push(p); if (secPts.length === 2) { sec = secPts; secPts = []; mode = 'view'; renderTB(); renderSide(); } paint(); } });
  // ---------- 사이드 ----------
  const card = (k, v, s) => h('div', { class: 'card' }, h('div', { class: 'd' }, k), h('div', { class: 't', style: { fontSize: '18px', margin: '2px 0' } }, v), s ? h('div', { class: 'note', style: { fontSize: '11.5px' } }, s) : null);
  const m3 = (v) => `${Math.round(v).toLocaleString('ko-KR')} m³`;
  function renderSide() {
    side.innerHTML = ''; if (!R) return;
    side.append(h('div', { class: 'note', style: { lineHeight: 1.6, marginBottom: '8px' } }, '측점으로 지형(TIN)을 만들고 대지 안을 계획고로 정지할 때의 절·성토량, 건물 터파기, 잔토 운반, 우수 유출량과 우수관 관경을 산정합니다.'));
    side.append(h('h4', { style: { margin: '6px 0' } }, `지형 — 측점 ${C.pts.length}개${R.tin ? ` · 삼각망 ${R.tin.tris.length}` : ''}`),
      h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
        h('button', { class: 'btn sm', onclick: importCSV }, '측점 CSV 불러오기'), h('button', { class: 'btn sm', onclick: () => { C.pts = sampleTerrain(R.S); save(); recalc(); renderSide(); paint(); toast('샘플 경사지 지형을 만들었습니다'); } }, '샘플 지형'),
        C.pts.length ? h('button', { class: 'btn sm', onclick: async () => { const { confirmBox } = await import('../js/ui.js'); if (await confirmBox('측점 삭제', '모든 측점을 지울까요?', '삭제', true)) { C.pts = []; save(); recalc(); renderSide(); paint(); } } }, '측점 지우기') : null),
      h('div', { class: 'note', style: { fontSize: '11.5px', margin: '4px 0 0' } }, 'CSV 형식: X(m), Y(m), Z(EL m) — 도면 좌표계 기준, 머리글 자동 무시'));
    if (!R.valid.length) return;
    side.append(h('h4', { style: { margin: '12px 0 6px' } }, '정지 계획'), h('div', { class: 'row', style: { gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
      h('select', { onchange: e => { C.mode = e.target.value; if (C.mode === 'fixed' && C.pad == null) C.pad = +R.pad.toFixed(2); save(); recalc(); renderSide(); paint(); } }, h('option', { value: 'balance', selected: C.mode !== 'fixed' }, '절·성토 균형고 (자동)'), h('option', { value: 'fixed', selected: C.mode === 'fixed' }, '계획고 직접 지정')),
      C.mode === 'fixed' ? h('input', { type: 'number', step: 0.05, value: C.pad, style: { width: '90px' }, onchange: e => { C.pad = +e.target.value; save(); recalc(); renderSide(); paint(); } }) : h('span', { class: 'mono' }, `EL ${R.balance.toFixed(2)} m`)),
      h('div', { class: 'note', style: { fontSize: '11.5px', marginTop: '4px' } }, `현황 EL ${R.zmin.toFixed(2)} ~ ${R.zmax.toFixed(2)} m · 1층 FL 권장 EL ${(R.pad + 0.15).toFixed(2)} m (계획고 + 150)`));
    side.append(h('div', { class: 'cards', style: { gridTemplateColumns: '1fr 1fr', marginTop: '10px' } },
      card('절토', m3(R.cut), `대지 정지`), card('성토', m3(R.fill), `다짐 환산 C=${R.Cf}`), card('기초 터파기', m3(R.exc), `건물 외곽 × ${R.exDepth.toFixed(1)} m${R.exBase ? ' (지하층 + 기초)' : ' (기초)'} · 여굴 0.5 m`),
      card(R.net >= 0 ? '잔토 반출' : '토사 반입', m3(R.haul), `흐트러진 상태 L=${R.Lf} · 덤프 ${R.trucks.toLocaleString()}대 (10 m³)`),
      card('토공 기간', `${R.days}일`, '굴착기 0.7 m³ 1대 기준 400 m³/일'), card('토공 개략비', `${(R.cost / 1e6).toFixed(1)}백만원`, '굴착·성토다짐·운반 단가 근사')));
    const st = R.storm;
    side.append(h('h4', { style: { margin: '14px 0 6px' } }, '우수 배수 (합리식 Q = C·I·A/360)'), h('div', { class: 'tbl' }, table([{ label: '항목', key: 'k' }, { label: '값', key: 'v' }], [
      { k: '대지 / 지붕 / 포장 / 녹지', v: `${st.site.toFixed(0)} / ${st.roof.toFixed(0)} / ${st.pave.toFixed(0)} / ${st.green.toFixed(0)} ㎡ (녹지: ${st.greenFrom})` },
      { k: '유출계수 C (개발 후 / 전)', v: `${st.Cpost.toFixed(2)} / ${Cc.bare}` },
      { k: '강우강도 I', v: h('span', {}, h('input', { type: 'number', value: st.I, style: { width: '70px' }, onchange: e => { C.I = +e.target.value || 100; save(); recalc(); renderSide(); } }), ' mm/hr (지역 강우강도식, 10년 빈도 10분)') },
      { k: '유출량 Q (개발 후 / 전)', v: `${(st.Qpost * 1000).toFixed(1)} / ${(st.Qpre * 1000).toFixed(1)} L/s` },
      { k: '우수 본관 (구배 ' + st.slope + '%, n=0.013)', v: `필요 Ø${st.Dreq.toFixed(0)} → Ø${st.D} mm · 만관 유속 ${st.vFull.toFixed(2)} m/s` },
      { k: '빗물관리시설 (조례 근사)', v: st.rain ? `${st.rain.toFixed(1)} m³ 이상 (대지 1,000㎡ 이상 0.05 m³/㎡)` : '대상 아님 (1,000㎡ 미만)' }])));
    if (sec && R.tin) { // 단면
      const N = 120; const [a, b] = sec; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const ex = [], ds = []; for (let i = 0; i <= N; i++) { const t = i / N, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t; const zt = R.tin.z(x, y); ex.push(zt); ds.push(inAny([x, y], [R.S.site]) ? R.pad : zt); }
      const W = 400, H = 170; const cv2 = h('canvas', { width: W, height: H, style: { width: '100%', background: '#0f1218', borderRadius: '6px' } }); const g = cv2.getContext('2d'); const vals = [...ex, ...ds].filter(v => v != null); const lo = Math.min(...vals) - 0.5, hi = Math.max(...vals) + 0.5; const Xs = (i) => 30 + i / N * (W - 40), Ys = (z) => H - 18 - (z - lo) / (hi - lo) * (H - 30);
      for (let i = 0; i < N; i++) { if (ex[i] == null || ex[i + 1] == null) continue; const cut = ex[i] > ds[i]; g.fillStyle = cut ? '#ef5f5f55' : '#5ab0ff55'; g.beginPath(); g.moveTo(Xs(i), Ys(ex[i])); g.lineTo(Xs(i + 1), Ys(ex[i + 1])); g.lineTo(Xs(i + 1), Ys(ds[i + 1])); g.lineTo(Xs(i), Ys(ds[i])); g.fill(); }
      const line = (arr, c) => { g.strokeStyle = c; g.lineWidth = 1.6; g.beginPath(); let pen = false; arr.forEach((z, i) => { if (z == null) { pen = false; return; } pen ? g.lineTo(Xs(i), Ys(z)) : g.moveTo(Xs(i), Ys(z)); pen = true; }); g.stroke(); };
      line(ex, '#c9b48a'); line(ds, '#7bd389'); g.fillStyle = '#cfd6e2'; g.font = '11px sans-serif'; g.fillText(`단면 A–A' (${(L / 1000).toFixed(1)} m) · 갈색 현황 · 초록 계획`, 34, 14); g.fillText(hi.toFixed(1), 2, 20); g.fillText(lo.toFixed(1), 2, H - 18);
      side.append(h('h4', { style: { margin: '14px 0 6px' } }, '단면'), cv2);
    } else side.append(h('div', { class: 'note', style: { marginTop: '12px' } }, '"단면선"으로 두 점을 찍으면 현황·계획 단면이 나옵니다.'));
  }
  async function importCSV() {
    const f = await pickFile('.csv,.txt'); if (!f) return; const txt = await readText(f); const pts = [];
    for (const ln of txt.split(/\r?\n/)) { const v = ln.split(/[,\t; ]+/).map(Number).filter(x => !isNaN(x)); if (v.length >= 3) { const [x, y, z] = v.length >= 4 ? v.slice(1) : v; pts.push([Math.round(x * 1000), Math.round(y * 1000), z]); } }
    if (pts.length < 3) return toast('측점 3개 이상이 필요합니다 (X, Y, Z m)', 'err'); C.pts = pts; save(); recalc(); renderSide(); paint(); toast(`측점 ${pts.length}개를 불러왔습니다`, 'ok');
  }
  async function exportXLSX() { const { writeBook } = await import('../js/excel.js'); const st = R.storm;
    const sum = [['항목', '값', '단위'], ['계획고', +R.pad.toFixed(3), 'EL m'], ['절토', +R.cut.toFixed(1), 'm³'], ['성토', +R.fill.toFixed(1), 'm³'], ['기초 터파기', +R.exc.toFixed(1), 'm³'], [R.net >= 0 ? '잔토 반출(흐트러진)' : '토사 반입(흐트러진)', +R.haul.toFixed(1), 'm³'], ['덤프 대수(10m³)', R.trucks, '대'], ['토공 기간', R.days, '일'], ['토공 개략비', Math.round(R.cost), '원'], [], ['유출계수 C', +st.Cpost.toFixed(3), ''], ['강우강도', st.I, 'mm/hr'], ['유출량', +(st.Qpost * 1000).toFixed(2), 'L/s'], ['우수 본관', st.D, 'mm'], ['빗물관리시설', +st.rain.toFixed(1), 'm³']];
    const grid = [['X(m)', 'Y(m)', '현황 EL', '계획 EL', '절(+)/성(−) m', '체적 m³'], ...R.valid.map(c => [+(c.x / 1000).toFixed(2), +(c.y / 1000).toFixed(2), +c.zt.toFixed(3), +R.pad.toFixed(3), +(c.zt - R.pad).toFixed(3), +((c.zt - R.pad) * R.cell * R.cell / 1e6).toFixed(3)])];
    saveFile(`${P.name.replace(/[\\/:*?"<>|]/g, '_')}_토공·배수.xlsx`, await writeBook([{ name: '집계', rows: sum, widths: [24, 14, 8] }, { name: '격자 토공', rows: grid }, { name: '측점', rows: [['X(m)', 'Y(m)', 'EL(m)'], ...C.pts.map(p => [p[0] / 1000, p[1] / 1000, p[2]])] }])); }
  function exportHTML() { const st = R.storm; const img = cv.toDataURL('image/png'); const tr = (a, b) => `<tr><th>${a}</th><td>${b}</td></tr>`;
    saveFile(`${P.name.replace(/[\\/:*?"<>|]/g, '_')}_토공·배수보고서.html`, `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>토공·배수 검토</title><style>body{font-family:'Malgun Gothic',sans-serif;max-width:860px;margin:24px auto;color:#111;font-size:13px}table{border-collapse:collapse;width:100%;margin:8px 0 16px}th,td{border:1px solid #999;padding:5px 8px;text-align:left}th{background:#eef0f3;width:40%}img{width:100%;border:1px solid #ccc}</style></head><body>
<h1>토공·배수 검토</h1><p>${esc(P.name)} · ${new Date().toLocaleDateString('ko-KR')} · 측점 ${C.pts.length}개, 격자 ${R.cell / 1000} m</p><img src="${img}">
<h2>정지·토공</h2><table>${tr('계획고', `EL ${R.pad.toFixed(2)} m (${C.mode === 'fixed' ? '지정' : '절·성토 균형고'})`)}${tr('절토 / 성토', `${Math.round(R.cut)} / ${Math.round(R.fill)} m³`)}${tr('기초 터파기', `${Math.round(R.exc)} m³`)}${tr(R.net >= 0 ? '잔토 반출' : '토사 반입', `${Math.round(R.haul)} m³ (덤프 ${R.trucks}대)`)}${tr('토공 기간 · 개략비', `${R.days}일 · ${(R.cost / 1e6).toFixed(1)}백만원`)}</table>
<h2>우수 배수</h2><table>${tr('면적 (대지/지붕/포장/녹지)', `${st.site.toFixed(0)} / ${st.roof.toFixed(0)} / ${st.pave.toFixed(0)} / ${st.green.toFixed(0)} ㎡`)}${tr('유출계수 C', st.Cpost.toFixed(2))}${tr('강우강도 I', `${st.I} mm/hr`)}${tr('유출량 Q', `${(st.Qpost * 1000).toFixed(1)} L/s (개발 전 ${(st.Qpre * 1000).toFixed(1)})`)}${tr('우수 본관', `Ø${st.D} mm (구배 ${st.slope}%)`)}${tr('빗물관리시설', st.rain ? `${st.rain.toFixed(1)} m³` : '대상 아님')}</table>
<p style="color:#666;font-size:12px">TIN 선형보간·격자법 근사입니다. 토량환산계수 C=${R.Cf}, L=${R.Lf}. 강우강도·빗물관리 기준은 지자체 기준을 확인하세요.</p></body></html>`); }
  const ro = new ResizeObserver(() => paint()); ro.observe(holder);
  recalc(); renderTB(); renderSide(); paint();
  return { unmount() { ro.disconnect(); } };
}
