// 빌더 현장 — 현장 사진을 도면 위치·부재에 연결하고 사진 기준으로 진척을 판정
import { h, toast, dialog, confirmBox, saveFile, getSample, pickFile } from '../js/ui.js';
import { KINDS, DISC, levelOf, elOutline, elName, isRefElement, cumProgress, allElements } from '../js/model.js';
import { statusAt } from './sched.js';
import { uid, fmt0, dist, bboxOf, clamp, esc, csv } from '../js/util.js';
import { entSegs } from './cad-geom.js';

export const STAGES = ['착수 전', '먹매김', '거푸집', '철근 배근', '타설 완료', '양생·탈형', '마감 진행', '완료'];
const STAGE_PCT = { '착수 전': 0, '먹매김': 5, '거푸집': 30, '철근 배근': 55, '타설 완료': 85, '양생·탈형': 95, '마감 진행': 70, '완료': 100 };
// 부재 종류별 시공 단계 → 누계 진척(%) 기준. 사진 판정·AI 판정이 같은 기준을 씁니다.
export const STAGE_SETS = {
  rc: { name: 'RC 골조', stages: [['착수 전', 0], ['먹매김', 5], ['거푸집', 30], ['철근 배근', 55], ['타설 완료', 85], ['양생·탈형', 95], ['완료', 100]] },
  fin: { name: '건축·마감', stages: [['착수 전', 0], ['먹매김', 5], ['바탕·골조', 30], ['마감 진행', 60], ['완료', 100]] },
  mep: { name: '설비·전기·소방', stages: [['착수 전', 0], ['행거·지지', 20], ['설치', 60], ['연결·시험', 85], ['완료', 100]] },
};
const MEP_KINDS = new Set(['duct', 'riser', 'pipe', 'tray', 'sprinkler', 'panel', 'light']), RC_KINDS = new Set(['footing', 'column', 'beam', 'slab']);
export function stageSetOf(el, sheet) {
  if (!el) return 'rc'; const disc = sheet?.disc || KINDS[el.k]?.disc;
  if (MEP_KINDS.has(el.k) || ['M', 'P', 'E', 'F'].includes(disc)) return 'mep';
  if (RC_KINDS.has(el.k) || (el.k === 'wall' && (disc === 'S' || el.mat === 'RC'))) return 'rc';
  return 'fin';
}
export function stagePct(stage, set = 'rc') { const r = (STAGE_SETS[set] || STAGE_SETS.rc).stages.find(s => s[0] === stage) ?? STAGE_SETS.rc.stages.find(s => s[0] === stage); return r ? r[1] : (STAGE_PCT[stage] ?? null); }
// 부재 중심에서 가장 가까운 통심 교차 위치(예: "2-B"). 같은 이름 부재를 현장에서 구분하는 용도입니다.
export function gridAddr(P, sheetId, el, tol = 1500) {
  const c = P.content[sheetId]; if (!c || !el) return ''; const o = elOutline(el, id => c.els.find(x => x.id === id)); if (!o) return '';
  const ctr = [o.reduce((a, q) => a + q[0], 0) / o.length, o.reduce((a, q) => a + q[1], 0) / o.length]; let gx = null, gy = null;
  for (const g of c.ents) { if (g.t !== 'grid' || !g.label) continue; const vert = Math.abs(g.a[0] - g.b[0]) < 1, hor = Math.abs(g.a[1] - g.b[1]) < 1;
    if (vert) { const d = Math.abs(ctr[0] - g.a[0]); if (d <= tol && (!gx || d < gx.d)) gx = { d, l: g.label }; } else if (hor) { const d = Math.abs(ctr[1] - g.a[1]); if (d <= tol && (!gy || d < gy.d)) gy = { d, l: g.label }; } }
  return gx && gy ? `${gx.l}-${gy.l}` : gx ? `${gx.l}열` : gy ? `${gy.l}열` : '';
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// 기준일까지의 사진 판정 → 부재별 실적: {elId: {pct, date, photos[], checked, ai, regress, prev}}
// 같은 부재에 사진이 여러 장이면 가장 최근 촬영일의 판정 중앙값을 쓰고, 이전 판정보다 5%p 넘게 낮으면 역행으로 표시합니다.
export function photoProgress(P, date) {
  const by = {};
  for (const p of P.photos || []) if (p.el && p.pct != null && p.date && p.date <= date) (by[p.el] ||= []).push(p);
  const out = {};
  for (const [id, arr] of Object.entries(by)) {
    arr.sort((a, b) => a.date.localeCompare(b.date)); const last = arr[arr.length - 1].date;
    const cur = arr.filter(p => p.date === last), before = arr.filter(p => p.date < last);
    const pct = Math.round(median(cur.map(p => +p.pct))); const prev = before.length ? Math.max(...before.map(p => +p.pct)) : null;
    out[id] = { pct, date: last, photos: cur.map(p => p.id), checked: cur.every(p => p.checked !== false), ai: cur.some(p => p.ai), regress: prev != null && pct < prev - 5, prev };
  }
  return out;
}
// 계획(공정표) 대비 사진 실적: 층·부재별 집계, 지연·역행·AI 미확인 목록
export function progressReport(P, date, lagTol = 20) {
  const plan = statusAt(P, date), act = photoProgress(P, date); const groups = {}; const lag = [], ahead = [], regress = [], unchecked = [], need = {};
  for (const r of allElements(P, r => !isRefElement(r.el, r.sheet, P))) {
    const e = r.el; const pl = plan[e.id], ac = act[e.id]; if (!pl && !ac) continue;
    // 계획상 착수(진행·완료)했는데 사진 판정이 없는 부재 → 활동별 "촬영 필요" (기성 근거가 비는 곳)
    if (pl && pl.pct > 0) { const n = need[pl.act] ||= { act: pl.act, n: 0, shot: 0, pct: pl.pct, sheet: r.sheet.id, ids: [] }; n.n++; if (ac) n.shot++; else n.ids.push(e.id); }
    const key = `${r.level?.name || '-'}|${KINDS[e.k]?.name || e.k}`; const g = groups[key] ||= { level: r.level?.name || '-', elev: r.level?.elev ?? 0, kind: KINDS[e.k]?.name || e.k, n: 0, planSum: 0, active: 0, shot: 0, actSum: 0, planShot: 0 };
    g.n++; const pp = pl?.pct ?? 0; g.planSum += pp; if (pp > 0) g.active++;
    if (ac) {
      g.shot++; g.actSum += ac.pct; g.planShot += pp; const row = { el: e, sheet: r.sheet, level: r.level, plan: pp, act: ac.pct, gap: ac.pct - pp, ph: ac.photos[ac.photos.length - 1], date: ac.date, act0: pl?.act || '' };
      if (row.gap <= -lagTol) lag.push(row); else if (row.gap >= lagTol) ahead.push(row);
      if (ac.regress) regress.push({ ...row, prev: ac.prev }); if (!ac.checked) unchecked.push(row);
    }
  }
  const rows = Object.values(groups).filter(g => g.planSum > 0 || g.shot).sort((a, b) => a.elev - b.elev || a.kind.localeCompare(b.kind)).map(g => ({ ...g, plan: g.planSum / g.n, act: g.shot ? g.actSum / g.shot : null, planOfShot: g.shot ? g.planShot / g.shot : null, cover: g.active ? Math.min(1, g.shot / g.active) : null }));
  lag.sort((a, b) => a.gap - b.gap); ahead.sort((a, b) => b.gap - a.gap);
  const needs = Object.values(need).filter(n => n.shot < n.n).sort((a, b) => (b.n - b.shot) - (a.n - a.shot));
  let sp = 0, sa = 0, k = 0; for (const id in act) { sa += act[id].pct; sp += plan[id]?.pct ?? 0; k++; }
  return { rows, lag, ahead, regress, unchecked, needs, plan, act, sum: { shot: k, plan: k ? sp / k : null, act: k ? sa / k : null, onTrack: k - lag.length } };
}
const photoKey = (P, id) => `ph_${P.id}_${id}`;
const imgCache = new Map();
export async function photoData(ctx, P, id, thumb = false) {
  const k = id + (thumb ? ':t' : ''); if (imgCache.has(k)) return imgCache.get(k);
  const b = await ctx.store.getBlob(photoKey(P, id) + (thumb ? 't' : '')).catch(() => null); const d = b?.d || null; if (d) imgCache.set(k, d); return d;
}
async function shrink(file, max, q) {
  const url = URL.createObjectURL(file); const img = new Image(); img.src = url; await img.decode(); URL.revokeObjectURL(url);
  const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', q);
}
const dataToBlob = async (d) => { const [h0, b64] = d.split(','); const mime = h0.match(/data:([^;]+)/)?.[1] || 'image/jpeg'; const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: mime }); };

export function mount(root, ctx) {
  const P = ctx.P; P.photos ||= [];
  const st = { sheet: ctx.state.sheet && P.sheets.some(s => s.id === ctx.state.sheet) ? ctx.state.sheet : P.sheets[0].id, sel: null, placing: false, filter: 'all', view: ctx.state.siteView === 'report' ? 'report' : 'photos', heat: ctx.state.siteView === 'report', rdate: ctx.state.siteDate || (P.photos.map(p => p.date).filter(Boolean).sort().pop()) || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), rep: null, tol: 20, back: false };
  delete ctx.state.siteView; delete ctx.state.siteDate;
  if (st.view === 'report') requestAnimationFrame(() => side.classList.add('open'));
  const planMemo = new Map(); // 날짜 → statusAt 결과
  const planAt = (date) => { if (!planMemo.has(date)) planMemo.set(date, statusAt(P, date)); return planMemo.get(date); };
  const report = () => (st.rep ||= progressReport(P, st.rdate, st.tol));
  const offModel = ctx.bus.on?.('model', () => { planMemo.clear(); st.rep = null; });
  const GAP_COL = (gap) => gap == null ? null : gap <= -25 ? '#f7768e' : gap <= -10 ? '#e0af68' : '#9ece6a';
  const V = { cx: 12000, cy: 8000, s: 0.03 };
  const cv = h('canvas', { style: { width: '100%', height: '100%', display: 'block', touchAction: 'none' } });
  const planWrap = h('div', { style: { position: 'relative', flex: 1, minWidth: 0, background: '#0b0e13' } }, cv);
  const tb = h('div', { class: 'toolbar' });
  const side = h('div', { class: 'side', style: { width: '380px' } });
  root.append(h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } }, tb, h('div', { style: { display: 'flex', flex: 1, minHeight: 0, position: 'relative' } }, planWrap, side)));
  const g = cv.getContext('2d'); let W = 0, H = 0, dpr = 1;
  const sheet = () => P.sheets.find(s => s.id === st.sheet);
  const C = () => P.content[st.sheet];
  const w2s = (p) => [(p[0] - V.cx) * V.s + W / 2, H / 2 - (p[1] - V.cy) * V.s];
  const s2w = (x, y) => [(x - W / 2) / V.s + V.cx, (H / 2 - y) / V.s + V.cy];
  const save = () => { st.rep = null; ctx.touch('meta'); };

  function resize() { const r = planWrap.getBoundingClientRect(); dpr = window.devicePixelRatio || 1; W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; draw(); }
  const ro = new ResizeObserver(resize); ro.observe(planWrap);
  function fit() { const c = C(); const pts = []; for (const e of c.els) { const o = elOutline(e, id => c.els.find(x => x.id === id)); if (o) pts.push(...o); } for (const e of c.ents) if (e.t === 'grid') pts.push(e.a, e.b); if (!pts.length) return; const b = bboxOf(pts); V.cx = (b.x0 + b.x1) / 2; V.cy = (b.y0 + b.y1) / 2; V.s = Math.min(W / ((b.x1 - b.x0) * 1.15 || 1), H / ((b.y1 - b.y0) * 1.15 || 1)); draw(); }
  function draw() {
    if (!W) return; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const c = C(); if (!c) return; const host = (id) => c.els.find(x => x.id === id);
    const path = (pts, close) => { g.beginPath(); pts.forEach((p, i) => { const q = w2s(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); if (close) g.closePath(); };
    g.lineWidth = 1; g.strokeStyle = '#3a4352'; g.setLineDash([8, 4]); for (const e of c.ents) if (e.t === 'grid') { path([e.a, e.b]); g.stroke(); } g.setLineDash([]);
    const selPh = P.photos.find(p => p.id === st.sel);
    const R = st.heat ? report() : null;
    for (const e of c.els) {
      const o = elOutline(e, host); if (!o) continue; path(o, true); const linked = selPh?.el === e.id;
      let fill = linked ? '#4ea1ff55' : e.k === 'slab' ? 'transparent' : '#2a3342', stroke = linked ? '#4ea1ff' : '#5b6578';
      if (R && !linked) { const ac = R.act[e.id], pl = R.plan[e.id]; if (ac) { const col = GAP_COL(ac.pct - (pl?.pct ?? 0)); fill = col + (e.k === 'slab' ? '33' : '99'); stroke = col; } else if (pl?.pct > 0) { stroke = '#7aa2f7'; g.setLineDash([4, 3]); } }
      g.fillStyle = fill; g.fill(); g.strokeStyle = stroke; g.stroke(); g.setLineDash([]);
    }
    for (const e of c.ents) if (e.t !== 'grid' && e.t !== 'text') { g.strokeStyle = '#46505f'; for (const [a, b] of entSegs(e)) { path([a, b]); g.stroke(); } }
    // 사진 핀
    for (const p of P.photos.filter(x => x.sheet === st.sheet && x.pt)) {
      const q = w2s(p.pt); const on = p.id === st.sel;
      if (p.dir != null) { g.fillStyle = on ? '#4ea1ff44' : '#e6b45033'; g.beginPath(); g.moveTo(q[0], q[1]); g.arc(q[0], q[1], 46, -p.dir - 0.45, -p.dir + 0.45); g.closePath(); g.fill(); }
      g.fillStyle = on ? '#4ea1ff' : '#e6b450'; g.beginPath(); g.arc(q[0], q[1] - 12, 9, 0, Math.PI * 2); g.fill(); g.beginPath(); g.moveTo(q[0] - 6, q[1] - 7); g.lineTo(q[0], q[1]); g.lineTo(q[0] + 6, q[1] - 7); g.fill();
      g.fillStyle = '#0b0e13'; g.fillRect(q[0] - 5, q[1] - 15, 10, 7); g.beginPath(); g.arc(q[0], q[1] - 12, 2.2, 0, Math.PI * 2); g.fillStyle = on ? '#4ea1ff' : '#e6b450'; g.fill();
    }
    if (R && !st.placing) { const items = [['#9ece6a', '계획 대비 정상·앞섬'], ['#e0af68', '10~25%p 지연'], ['#f7768e', '25%p 이상 지연'], ['#7aa2f7', '계획상 착수했는데 사진 없음(점선)']]; g.fillStyle = '#000b'; g.fillRect(8, 8, 230, 22 + items.length * 16); g.font = '11px sans-serif'; g.fillStyle = '#c0caf5'; g.fillText(`진척 색 — 기준일 ${st.rdate}`, 14, 23); items.forEach(([c, t], i) => { g.fillStyle = c; g.fillRect(14, 31 + i * 16, 10, 10); g.fillStyle = '#c0caf5'; g.fillText(t, 30, 40 + i * 16); }); }
    if (st.placing) { g.fillStyle = '#000a'; g.fillRect(8, 8, 330, 24); g.fillStyle = '#ffd866'; g.font = '12px sans-serif'; g.fillText('도면에서 촬영 위치를 누르세요 (드래그하면 촬영 방향)', 14, 24); }
  }
  // 상호작용
  let drag = null;
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); const r = cv.getBoundingClientRect(); drag = { x: e.clientX - r.left, y: e.clientY - r.top, V0: { ...V }, moved: false }; });
  cv.addEventListener('pointermove', (e) => { if (!drag) return; const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; if (Math.hypot(x - drag.x, y - drag.y) > 5) drag.moved = true; if (drag.moved && !st.placing) { V.cx = drag.V0.cx - (x - drag.x) / V.s; V.cy = drag.V0.cy + (y - drag.y) / V.s; draw(); } });
  cv.addEventListener('pointerup', (e) => {
    const d = drag; drag = null; if (!d) return; const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
    if (st.placing) { const ph = P.photos.find(p => p.id === st.sel); if (!ph) return; const p0 = s2w(d.x, d.y); ph.sheet = st.sheet; ph.level = sheet().level; ph.pt = p0; ph.dir = d.moved ? Math.atan2(-(y - d.y), x - d.x) : null; ph.el = nearestEl(p0)?.id || null; st.placing = false; save(); draw(); renderSide(); toast('위치를 지정했습니다' + (ph.el ? ' — 가까운 부재와 연결' : ''), 'ok'); return; }
    if (d.moved) return;
    const hit = P.photos.filter(p => p.sheet === st.sheet && p.pt).find(p => { const q = w2s(p.pt); return Math.hypot(q[0] - x, q[1] - 12 - y) < 14; });
    if (hit) { st.sel = hit.id; draw(); renderSide(); }
  });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; const w0 = s2w(x, y); V.s = clamp(V.s * Math.pow(1.0015, -e.deltaY), 1e-4, 5); const w1 = s2w(x, y); V.cx += w0[0] - w1[0]; V.cy += w0[1] - w1[1]; draw(); }, { passive: false });
  function nearestEl(p, max = 6000) { const c = C(); const host = (id) => c.els.find(x => x.id === id); let best = null, bd = max; for (const e of c.els) { if (isRefElement(e, sheet(), P) || e.k === 'slab') continue; const o = elOutline(e, host); if (!o) continue; const ctr = [o.reduce((a, q) => a + q[0], 0) / o.length, o.reduce((a, q) => a + q[1], 0) / o.length]; const d = dist(ctr, p); if (d < bd) { bd = d; best = e; } } return best; }

  // ---------- 툴바·패널 ----------
  function buildToolbar() {
    tb.innerHTML = '';
    const ss = h('select', { style: { maxWidth: '220px' } }); for (const s of P.sheets) ss.append(h('option', { value: s.id, selected: s.id === st.sheet }, `[${s.disc}] ${s.name} (${P.photos.filter(p => p.sheet === s.id).length})`)); ss.onchange = () => { st.sheet = ss.value; fit(); };
    tb.append(ss, h('span', { class: 'sep' }), h('button', { class: 'tb', onclick: upload }, '+ 사진 올리기'), h('button', { class: 'tb', onclick: fit }, '전체보기'),
      h('button', { class: 'tb' + (st.heat ? ' on' : ''), title: '계획(공정표) 대비 사진 실적으로 부재 색칠', onclick: () => { st.heat = !st.heat; buildToolbar(); draw(); } }, '진척 색'),
      h('button', { class: 'tb' + (st.view === 'report' ? ' on' : ''), onclick: () => { st.view = st.view === 'report' ? 'photos' : 'report'; buildToolbar(); renderSide(); side.classList.add('open'); } }, '진척 판정 현황'),
      h('button', { class: 'tb', onclick: () => { ctx.state.photo3d = true; ctx.go('view3d'); } }, '3D에서 사진 위치'), h('button', { class: 'tb show-m', onclick: () => side.classList.toggle('open') }, '사진 목록'));
  }
  async function upload() {
    const files = await new Promise((res) => { const i = h('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' } }); i.onchange = () => { res([...i.files]); i.remove(); }; document.body.append(i); i.click(); });
    if (!files.length) return; toast(`${files.length}장 처리 중…`);
    let n = 0;
    for (const f of files) {
      try {
        const big = await shrink(f, 1600, 0.75), th = await shrink(f, 260, 0.7); const id = uid('ph');
        await ctx.store.putBlob(photoKey(P, id), { d: big }); await ctx.store.putBlob(photoKey(P, id) + 't', { d: th }); imgCache.set(id, big); imgCache.set(id + ':t', th);
        const date = new Date((f.lastModified || Date.now()) + 9 * 3600e3).toISOString().slice(0, 10); // KST
        P.photos.push({ id, name: f.name, date, at: Date.now(), sheet: null, pt: null, el: null, note: '', stage: '', pct: null, checked: true }); n++;
      } catch (e) { console.error(e); toast(`${f.name}: ${e.message || '저장 실패'}`, 'err'); }
    }
    save(); st.sel = P.photos[P.photos.length - 1]?.id; st.placing = n === 1; renderSide(); buildToolbar(); draw(); toast(`${n}장 올림${n === 1 ? ' — 도면에서 위치를 누르세요' : ' — 각 사진의 "위치 지정"을 누르세요'}`, 'ok');
  }
  const revAt = (date) => { const t = new Date(date + 'T23:59:59').getTime(); return [...(P.prevs || [])].reverse().find(r => r.at <= t) || null; };
  async function renderSide() {
    side.innerHTML = '';
    if (st.view === 'report') return renderReport();
    const list = P.photos.filter(p => st.filter === 'all' || (st.filter === 'here' ? p.sheet === st.sheet : !p.pt)).sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
    const fsel = h('select'); for (const [v, l] of [['all', `전체 ${P.photos.length}`], ['here', '현재 도면'], ['none', `위치 미지정 ${P.photos.filter(p => !p.pt).length}`]]) fsel.append(h('option', { value: v, selected: st.filter === v }, l)); fsel.onchange = () => { st.filter = fsel.value; renderSide(); };
    side.append(h('h4', {}, '현장 사진', h('div', { class: 'row' }, st.back ? h('button', { class: 'btn sm', onclick: () => { st.view = 'report'; st.back = false; buildToolbar(); renderSide(); } }, '← 진척 현황') : null, fsel, h('button', { class: 'btn sm show-m', onclick: () => side.classList.remove('open') }, '닫기'))));
    const cur = P.photos.find(p => p.id === st.sel);
    if (cur) side.append(await detail(cur));
    const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '6px', padding: '10px' } }); side.append(grid);
    if (!list.length) grid.append(h('div', { class: 'note', style: { gridColumn: '1/-1' } }, '사진이 없습니다. "+ 사진 올리기"로 현장 사진을 추가하세요. 휴대폰에서는 사진 보관함에서 고를 수 있습니다.'));
    for (const p of list) {
      const im = h('img', { style: { width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: '6px', display: 'block', background: '#1c2330' } });
      photoData(ctx, P, p.id, true).then(d => { if (d) im.src = d; });
      grid.append(h('div', { style: { position: 'relative', cursor: 'pointer', outline: p.id === st.sel ? '2px solid var(--acc)' : 'none', borderRadius: '6px' }, onclick: () => { st.sel = p.id; if (p.sheet && p.sheet !== st.sheet) { st.sheet = p.sheet; buildToolbar(); fit(); } draw(); renderSide(); } }, im,
        h('div', { style: { position: 'absolute', left: '4px', bottom: '4px', fontSize: '10px', background: '#000a', padding: '1px 4px', borderRadius: '3px' } }, p.date.slice(5) + (p.pt ? '' : ' · 미지정'))));
    }
  }
  // ---------- 진척 판정 현황: 계획(공정표) 대비 사진 실적 ----------
  function jump(sheetId, photoId) {
    if (sheetId && sheetId !== st.sheet) { st.sheet = sheetId; fit(); }
    st.sel = photoId || null; st.heat = true;
    if (photoId) { st.view = 'photos'; st.back = true; }
    buildToolbar(); draw(); renderSide();
  }
  function renderReport() {
    const R = report(); const hasSched = (P.sched?.acts || []).length > 0; const judged = (P.photos || []).filter(p => p.el && p.pct != null).length;
    const di = h('input', { type: 'date', value: st.rdate, style: { width: '140px' } }); di.onchange = () => { if (!di.value) return; st.rdate = di.value; st.rep = null; draw(); renderSide(); };
    const tol = h('select', { title: '계획과 사진 판정의 차이가 이 값 이상이면 지연·앞섬으로 분류합니다' }); for (const v of [10, 20, 30]) tol.append(h('option', { value: v, selected: st.tol === v }, `허용 ±${v}%p`)); tol.onchange = () => { st.tol = +tol.value; st.rep = null; draw(); renderSide(); };
    side.append(h('h4', {}, '진척 판정 현황', h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => { st.view = 'photos'; buildToolbar(); renderSide(); } }, '사진 목록'), h('button', { class: 'btn sm show-m', onclick: () => side.classList.remove('open') }, '닫기'))));
    side.append(h('div', { class: 'sec' }, h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } }, h('span', { class: 'note' }, '기준일'), di, tol,
      h('button', { class: 'btn sm', title: '오늘 날짜로', onclick: () => { st.rdate = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); st.rep = null; draw(); renderSide(); } }, '오늘'))));
    if (!hasSched) side.append(h('div', { class: 'sec' }, h('div', { class: 'note' }, '공정표가 없어 계획과 비교할 수 없습니다. 사진 판정값만 집계합니다.'), h('button', { class: 'btn sm', style: { marginTop: '6px' }, onclick: () => ctx.go('sched') }, '공정 도구에서 공정표 만들기')));
    if (!judged) { side.append(h('div', { class: 'sec note' }, '판정된 사진이 없습니다. 사진을 올리고 위치를 지정한 뒤 "시공 단계"를 고르거나 "AI 시공 단계 판정"을 누르면, 여기에서 계획 대비 실적을 볼 수 있습니다.')); }
    // 요약
    const card = (l, v, cls, t) => h('div', { class: 'card', title: t || '', style: { padding: '6px 8px' } }, h('div', { class: 'note' }, l), h('div', { style: { fontSize: '16px', fontWeight: 600 }, class: cls ? 'pill ' + cls : '' }, v));
    const S = R.sum;
    side.append(h('div', { class: 'sec' }, h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '6px' } },
      card('사진 판정 부재', `${S.shot}개`, '', '기준일까지 사진으로 진척을 판정한 부재 수'),
      card('계획 / 사진', S.shot ? `${S.plan.toFixed(0)} / ${S.act.toFixed(0)}%` : '-', '', '사진 판정 부재의 평균 진척 — 공정표 계획 대비 사진 판정'),
      card('지연', `${R.lag.length}개`, R.lag.length ? 'bad' : 'ok', `계획보다 ${st.tol}%p 이상 늦은 부재`),
      card('확인 필요', `${R.unchecked.length}개`, R.unchecked.length ? 'warn' : '', 'AI가 판정하고 아직 담당자가 확인하지 않은 사진'),
      card('역행', `${R.regress.length}개`, R.regress.length ? 'warn' : '', '이전 사진보다 진척이 5%p 넘게 낮게 판정된 부재 — 판정 오류이거나 재시공'),
      card('촬영 필요', `${R.needs.reduce((a, n) => a + n.n - n.shot, 0)}개`, '', '계획상 착수했는데 사진 판정이 없는 부재'))));
    const name = (r) => { const ga = gridAddr(P, r.sheet?.id, r.el); return `${r.level?.name || ''}${ga ? ' ' + ga : ''} ${r.el.tag ? r.el.tag + ' ' : ''}${elName(r.el)}`.trim(); };
    const item = (r, right, sub) => h('div', { class: 'row', style: { justifyContent: 'space-between', padding: '5px 0', borderTop: '1px solid var(--line)', cursor: 'pointer', gap: '6px' }, onclick: () => jump(r.sheet?.id, r.ph) },
      h('div', { style: { minWidth: 0 } }, h('div', { style: { fontSize: '12.5px' } }, name(r)), h('div', { class: 'note', style: { fontSize: '11px' } }, sub)), right);
    const list = (title, arr, render, hint, max = 8) => { if (!arr.length) return; const box = h('div', { class: 'sec' }, h('div', { style: { fontWeight: 600, fontSize: '13px', marginBottom: '2px' } }, `${title} (${arr.length})`), hint ? h('div', { class: 'note', style: { marginBottom: '4px' } }, hint) : null); arr.slice(0, max).forEach(r => box.append(render(r))); if (arr.length > max) box.append(h('div', { class: 'note' }, `외 ${arr.length - max}개 — CSV로 전체를 받을 수 있습니다`)); side.append(box); };
    const gapPill = (g) => h('span', { class: 'pill ' + (g <= -25 ? 'bad' : g <= -10 ? 'warn' : 'ok') }, (g > 0 ? '+' : '') + g.toFixed(0) + '%p');
    list('확인 필요', R.unchecked, r => item(r, h('span', { class: 'pill warn' }, `AI ${r.act}%`), `${r.date} 촬영 · 눌러서 사진 확인`), 'AI 판정은 담당자가 확인해야 기성·일보 근거로 씁니다.');
    list('지연', R.lag, r => item(r, gapPill(r.gap), `계획 ${r.plan}% · 사진 ${r.act}% · ${r.date}${r.act0 ? ' · ' + r.act0 : ''}`), '차이가 큰 순서입니다. 눌러서 근거 사진으로 이동합니다.');
    list('역행', R.regress, r => item(r, h('span', { class: 'pill warn' }, `${r.prev}→${r.act}%`), `${r.date} 촬영 · 재판정 또는 재시공 확인`));
    if (R.needs.length) { const box = h('div', { class: 'sec' }, h('div', { style: { fontWeight: 600, fontSize: '13px' } }, `촬영 필요 (${R.needs.length}개 활동)`), h('div', { class: 'note', style: { marginBottom: '4px' } }, '공정표상 착수(진행·완료)했는데 사진 판정이 없는 활동입니다. 기성 근거가 비는 곳이니 촬영해 주세요. 눌러서 도면에 점선으로 표시합니다.'));
      R.needs.slice(0, 8).forEach(n => box.append(h('div', { class: 'row', style: { justifyContent: 'space-between', padding: '5px 0', borderTop: '1px solid var(--line)', cursor: 'pointer' }, onclick: () => jump(n.sheet) },
        h('div', {}, h('div', { style: { fontSize: '12.5px' } }, n.act || '(활동명 없음)'), h('div', { class: 'note', style: { fontSize: '11px' } }, `${n.n}개 중 ${n.n - n.shot}개 사진 없음 · 계획 ${n.pct}%`)), h('span', { class: 'pill acc' }, '도면'))));
      side.append(box); }
    list('앞섬', R.ahead, r => item(r, gapPill(r.gap), `계획 ${r.plan}% · 사진 ${r.act}% · ${r.date}`), null, 5);
    // 층·부재별
    if (R.rows.length) {
      const t = h('table', { style: { width: '100%', fontSize: '11.5px', borderCollapse: 'collapse' } }); const th = (x, a = 'right') => h('th', { style: { textAlign: a, padding: '3px 4px', color: 'var(--fg3)', fontWeight: 500 } }, x); const td = (x, a = 'right', c) => h('td', { style: { textAlign: a, padding: '3px 4px', borderTop: '1px solid var(--line)', color: c || '' } }, x);
      t.append(h('tr', {}, th('층', 'left'), th('부재', 'left'), th('계획'), th('사진'), th('촬영률', 'right')));
      for (const g of R.rows) { const gap = g.act == null ? null : g.act - g.planOfShot; t.append(h('tr', {}, td(g.level, 'left'), td(`${g.kind} ${g.n}`, 'left'), td(g.plan.toFixed(0) + '%'), td(g.act == null ? '-' : g.act.toFixed(0) + '%', 'right', GAP_COL(gap)), td(g.cover == null ? '-' : Math.round(g.cover * 100) + '%'))); }
      side.append(h('div', { class: 'sec' }, h('div', { style: { fontWeight: 600, fontSize: '13px', marginBottom: '4px' } }, '층·부재별'), h('div', { class: 'note', style: { marginBottom: '4px' } }, '계획: 해당 부재 전체 평균 · 사진: 판정된 부재 평균(색은 같은 부재의 계획 대비) · 촬영률: 착수한 부재 중 사진 판정 비율. 착수 전 항목은 숨깁니다.'), t));
    }
    side.append(h('div', { class: 'sec row' }, h('button', { class: 'btn sm', onclick: exportReport }, 'CSV 저장')));
  }
  function exportReport() {
    const R = report(); const rows = [['기준일', st.rdate, '허용 편차(%p)', st.tol], [], ['구분', '층', '위치(통심)', '부재', '태그', '공정 활동', '계획%', '사진%', '차이(%p)', '촬영일', '비고']];
    const add = (label, arr, memo) => arr.forEach(r => rows.push([label, r.level?.name || '', gridAddr(P, r.sheet?.id, r.el), elName(r.el), r.el.tag || '', r.act0, r.plan, r.act, r.gap, r.date, memo ? memo(r) : '']));
    add('확인 필요', R.unchecked, () => 'AI 판정 미확인'); add('지연', R.lag); add('역행', R.regress, r => `이전 ${r.prev}%`); add('앞섬', R.ahead);
    rows.push([], ['촬영 필요 활동', '부재 수', '사진 없음', '계획%']); for (const n of R.needs) rows.push([n.act, n.n, n.n - n.shot, n.pct]);
    rows.push([], ['층', '부재', '수량', '계획 평균%', '사진 평균%', '촬영률%']); for (const g of R.rows) rows.push([g.level, g.kind, g.n, g.plan.toFixed(1), g.act == null ? '' : g.act.toFixed(1), g.cover == null ? '' : Math.round(g.cover * 100)]);
    saveFile(`${P.name}_진척판정_${st.rdate}.csv`.replace(/[\\/:*?"<>|]/g, '_'), csv(rows));
  }
  async function detail(p) {
    const box = h('div', { class: 'sec' });
    const img = h('img', { style: { width: '100%', borderRadius: '8px', display: 'block', background: '#1c2330', minHeight: '120px', cursor: 'zoom-in' }, onclick: () => viewFull(p) }); photoData(ctx, P, p.id).then(d => { if (d) img.src = d; });
    box.append(img);
    const sh = P.sheets.find(s => s.id === p.sheet); const el = sh ? P.content[sh.id]?.els.find(e => e.id === p.el) : null; const rv = revAt(p.date);
    const kv = h('div', { class: 'kv', style: { marginTop: '8px' } });
    const date = h('input', { type: 'date', value: p.date }); date.onchange = () => { p.date = date.value; save(); renderSide(); };
    const elSel = h('select'); elSel.append(h('option', { value: '' }, '(연결 안 함)'));
    if (sh && p.pt) { const c = P.content[sh.id]; const host = (id) => c.els.find(x => x.id === id); c.els.filter(e => e.k !== 'opening' && !isRefElement(e, sh, P)).map(e => { const o = elOutline(e, host); const ctr = o ? [o.reduce((a, q) => a + q[0], 0) / o.length, o.reduce((a, q) => a + q[1], 0) / o.length] : [0, 0]; return { e, d: dist(ctr, p.pt) }; }).sort((a, b) => a.d - b.d).slice(0, 12).forEach(({ e, d }) => elSel.append(h('option', { value: e.id, selected: e.id === p.el }, `${e.tag ? e.tag + ' · ' : ''}${elName(e)} (${fmt0(d)}mm)`))); }
    elSel.onchange = () => { p.el = elSel.value || null; save(); draw(); renderSide(); };
    const set = stageSetOf(el, sh), names = STAGE_SETS[set].stages.map(x => x[0]);
    const stage = h('select', { title: `${STAGE_SETS[set].name} 단계 기준` }); stage.append(h('option', { value: '' }, '-')); for (const [s, v] of STAGE_SETS[set].stages) stage.append(h('option', { value: s, selected: p.stage === s }, `${s} (${v}%)`)); if (p.stage && !names.includes(p.stage)) stage.append(h('option', { value: p.stage, selected: true }, p.stage + ' (이전 기준)'));
    stage.onchange = () => { p.stage = stage.value; const v = stagePct(p.stage, set); if (v != null) p.pct = v; p.checked = true; save(); draw(); renderSide(); };
    const pct = h('input', { type: 'number', min: 0, max: 100, value: p.pct ?? '', style: { width: '80px' } }); pct.onchange = () => { p.pct = pct.value === '' ? null : clamp(+pct.value, 0, 100); p.checked = true; save(); draw(); renderSide(); };
    const pl = el && (P.sched?.acts || []).length ? planAt(p.date)[el.id] : null; const gap = pl && p.pct != null ? p.pct - pl.pct : null;
    const planInfo = pl ? h('span', { class: 'note' }, `${pl.pct}%`, gap != null ? h('span', { class: 'pill ' + (gap <= -25 ? 'bad' : gap <= -10 ? 'warn' : 'ok'), style: { marginLeft: '6px' } }, `${gap > 0 ? '+' : ''}${gap}%p`) : null, h('div', { style: { fontSize: '11px' } }, pl.act || '')) : h('span', { class: 'note' }, el ? '공정표에 연결된 활동 없음' : '부재를 연결하면 표시');
    const note = h('textarea', { rows: 2, style: { width: '100%' } }); note.value = p.note || ''; note.onchange = () => { p.note = note.value; save(); };
    kv.append(h('label', {}, '촬영일'), date, h('label', {}, '위치'), h('span', { class: 'note' }, sh ? `${sh.name}` : '미지정'), h('label', {}, '연결 부재'), elSel, h('label', {}, '시공 단계'), stage, h('label', {}, '판정 진척%'), pct, h('label', {}, '계획(촬영일)'), planInfo, h('label', {}, '당시 Rev'), h('span', { class: 'note' }, rv ? `${rv.name}${rv.approval?.status ? ' (' + rv.approval.status + ')' : ''}` : '-'));
    if (p.checked === false) box.append(h('div', { style: { margin: '8px 0 0', padding: '8px', border: '1px solid #6e5a2c', borderRadius: '6px', background: '#2a2416' } },
      h('div', { style: { fontSize: '12.5px' } }, `AI 판정 결과입니다 — ${p.stage ? p.stage + ' ' : ''}${p.pct ?? '-'}%. 사진을 보고 맞으면 확인을, 다르면 단계를 고쳐 주세요.`),
      h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { class: 'btn sm primary', onclick: () => { p.checked = true; save(); draw(); renderSide(); toast('판정을 확인했습니다', 'ok'); } }, '맞음 — 확인'), h('button', { class: 'btn sm', onclick: () => stage.focus() }, '단계 고치기'))));
    box.append(kv, h('div', { class: 'note', style: { marginTop: '6px' } }, '메모'), note);
    const prog = el && P.bill.periods.length ? (() => { const per = [...P.bill.periods].reverse().find(x => !x.date || x.date >= p.date) || P.bill.periods[P.bill.periods.length - 1]; const cur = cumProgress(P, P.bill.periods.indexOf(per))[el.id] || 0; return { per, cur }; })() : null;
    box.append(h('div', { class: 'row', style: { marginTop: '8px' } },
      h('button', { class: 'btn sm primary', onclick: () => { st.placing = true; draw(); toast('도면에서 촬영 위치를 누르세요'); } }, p.pt ? '위치 다시 지정' : '위치 지정'),
      h('button', { class: 'btn sm', onclick: () => aiJudge(p, el) }, 'AI 시공 단계 판정'),
      prog && p.pct != null && p.checked !== false ? h('button', { class: 'btn sm', title: `${prog.per.name} 현재 ${prog.cur}%`, onclick: () => { prog.per.prog ||= {}; prog.per.prog[el.id] = p.pct; (prog.per.evidence ||= {})[el.id] = p.id; save(); ctx.bus.emit('model', {}); toast(`${prog.per.name} ${el.tag || elName(el)} 누계 ${p.pct}% 반영 (근거 사진 연결)`, 'ok'); renderSide(); } }, `기성 ${prog.per.name}에 ${p.pct}% 반영`) : null,
      el ? h('button', { class: 'btn sm', onclick: () => { ctx.state.hi = { ids: [el.id], label: p.name }; ctx.state.photo3d = true; ctx.go('view3d'); } }, '3D') : null,
      h('button', { class: 'btn sm danger', onclick: async () => { if (!await confirmBox('사진 삭제', esc(p.name) + ' 사진을 삭제합니다.', '삭제', true)) return; P.photos = P.photos.filter(x => x !== p); await ctx.store.dropBlob(photoKey(P, p.id)); await ctx.store.dropBlob(photoKey(P, p.id) + 't'); st.sel = null; save(); draw(); renderSide(); } }, '삭제')));
    if (prog) box.append(h('div', { class: 'note', style: { marginTop: '4px' } }, `${prog.per.name} 현재 누계 ${prog.cur}%${prog.per.evidence?.[el.id] === p.id ? ' · 이 사진이 근거로 연결됨' : ''}`));
    return box;
  }
  async function viewFull(p) { const d = await photoData(ctx, P, p.id); if (!d) return; const bg = h('div', { class: 'modal-bg', onclick: () => bg.remove() }, h('img', { src: d, style: { maxWidth: '96vw', maxHeight: '92vh', borderRadius: '8px' } })); document.body.append(bg); }
  async function aiJudge(p, el) {
    const sample = await getSample(); if (!sample) return toast('이 화면에서는 Claude 호출을 쓸 수 없습니다', 'err');
    const lim = await sample.limits?.().catch(() => null); if (lim && !lim.images) return toast('이 화면에서는 이미지 판정을 쓸 수 없습니다', 'err');
    const d = await photoData(ctx, P, p.id); if (!d) return;
    const set = stageSetOf(el, P.sheets.find(s => s.id === p.sheet)), SS = STAGE_SETS[set].stages;
    toast('사진 분석 중…');
    try {
      const blob = await dataToBlob(d);
      const prompt = `당신은 한국 건설 현장 공정 관리자입니다. 첨부 사진을 보고 ${el ? `"${KINDS[el.k]?.name} ${el.tag || ''}" 부재의` : '보이는 골조·마감의'} 시공 단계를 판정하세요. 단계 후보(괄호는 누계 진척률 기준): ${SS.map(([n, v]) => `${n}(${v}%)`).join(', ')}. 진척률은 판정한 단계와 다음 단계 기준 사이 값으로 정하세요.
JSON만 답하세요: {"stage":"단계 후보 중 하나","pct":0~100 정수 누계 진척률,"evidence":"판단 근거 한국어 1~2문장","risks":"품질·안전상 눈에 띄는 점(없으면 빈 문자열)"}`;
      const r = await sample(prompt, { images: [blob], modelTier: 'default' });
      const m = (r.text || '').match(/\{[\s\S]*\}/); if (!m) throw new Error('응답 해석 실패');
      const o = JSON.parse(m[0]); const i = SS.findIndex(x => x[0] === o.stage); if (i < 0) throw new Error('단계 후보 밖의 답: ' + o.stage);
      p.stage = o.stage; const lo = SS[i][1], hi = SS[i + 1]?.[1] ?? 100; p.pct = Number.isFinite(+o.pct) ? clamp(Math.round(+o.pct), lo, hi) : lo; p.ai = true; p.checked = false;
      p.note = [p.note, `[AI 판정] ${p.stage} ${p.pct}% — ${o.evidence}${o.risks ? ' / 주의: ' + o.risks : ''}`].filter(Boolean).join('\n'); save(); renderSide(); draw(); toast(`AI 판정: ${p.stage} ${p.pct}% — 사진을 보고 확인해 주세요`, 'ok');
    } catch (e) { console.error(e); toast('AI 판정 실패: ' + (e.message || e.code), 'err'); }
  }
  buildToolbar(); renderSide(); requestAnimationFrame(() => { resize(); fit(); });
  return { unmount() { ro.disconnect(); offModel?.(); } };
}
