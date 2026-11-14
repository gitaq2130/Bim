// 빌더 현장 — 현장 사진을 도면 위치·부재에 연결하고 사진 기준으로 진척을 판정
import { h, toast, dialog, confirmBox, saveFile, getSample, pickFile } from '../js/ui.js';
import { KINDS, DISC, levelOf, elOutline, elName, isRefElement, cumProgress } from '../js/model.js';
import { uid, fmt0, dist, bboxOf, clamp, esc } from '../js/util.js';
import { entSegs } from './cad-geom.js';

export const STAGES = ['착수 전', '먹매김', '거푸집', '철근 배근', '타설 완료', '양생·탈형', '마감 진행', '완료'];
const STAGE_PCT = { '착수 전': 0, '먹매김': 5, '거푸집': 30, '철근 배근': 55, '타설 완료': 85, '양생·탈형': 95, '마감 진행': 70, '완료': 100 };
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
  const st = { sheet: ctx.state.sheet && P.sheets.some(s => s.id === ctx.state.sheet) ? ctx.state.sheet : P.sheets[0].id, sel: null, placing: false, filter: 'all' };
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
  const save = () => ctx.touch('meta');

  function resize() { const r = planWrap.getBoundingClientRect(); dpr = window.devicePixelRatio || 1; W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; draw(); }
  const ro = new ResizeObserver(resize); ro.observe(planWrap);
  function fit() { const c = C(); const pts = []; for (const e of c.els) { const o = elOutline(e, id => c.els.find(x => x.id === id)); if (o) pts.push(...o); } for (const e of c.ents) if (e.t === 'grid') pts.push(e.a, e.b); if (!pts.length) return; const b = bboxOf(pts); V.cx = (b.x0 + b.x1) / 2; V.cy = (b.y0 + b.y1) / 2; V.s = Math.min(W / ((b.x1 - b.x0) * 1.15 || 1), H / ((b.y1 - b.y0) * 1.15 || 1)); draw(); }
  function draw() {
    if (!W) return; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const c = C(); if (!c) return; const host = (id) => c.els.find(x => x.id === id);
    const path = (pts, close) => { g.beginPath(); pts.forEach((p, i) => { const q = w2s(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); if (close) g.closePath(); };
    g.lineWidth = 1; g.strokeStyle = '#3a4352'; g.setLineDash([8, 4]); for (const e of c.ents) if (e.t === 'grid') { path([e.a, e.b]); g.stroke(); } g.setLineDash([]);
    const selPh = P.photos.find(p => p.id === st.sel);
    for (const e of c.els) { const o = elOutline(e, host); if (!o) continue; path(o, true); const linked = selPh?.el === e.id; g.fillStyle = linked ? '#4ea1ff55' : e.k === 'slab' ? 'transparent' : '#2a3342'; g.fill(); g.strokeStyle = linked ? '#4ea1ff' : '#5b6578'; g.stroke(); }
    for (const e of c.ents) if (e.t !== 'grid' && e.t !== 'text') { g.strokeStyle = '#46505f'; for (const [a, b] of entSegs(e)) { path([a, b]); g.stroke(); } }
    // 사진 핀
    for (const p of P.photos.filter(x => x.sheet === st.sheet && x.pt)) {
      const q = w2s(p.pt); const on = p.id === st.sel;
      if (p.dir != null) { g.fillStyle = on ? '#4ea1ff44' : '#e6b45033'; g.beginPath(); g.moveTo(q[0], q[1]); g.arc(q[0], q[1], 46, -p.dir - 0.45, -p.dir + 0.45); g.closePath(); g.fill(); }
      g.fillStyle = on ? '#4ea1ff' : '#e6b450'; g.beginPath(); g.arc(q[0], q[1] - 12, 9, 0, Math.PI * 2); g.fill(); g.beginPath(); g.moveTo(q[0] - 6, q[1] - 7); g.lineTo(q[0], q[1]); g.lineTo(q[0] + 6, q[1] - 7); g.fill();
      g.fillStyle = '#0b0e13'; g.fillRect(q[0] - 5, q[1] - 15, 10, 7); g.beginPath(); g.arc(q[0], q[1] - 12, 2.2, 0, Math.PI * 2); g.fillStyle = on ? '#4ea1ff' : '#e6b450'; g.fill();
    }
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
        const date = new Date(f.lastModified || Date.now()).toISOString().slice(0, 10);
        P.photos.push({ id, name: f.name, date, at: Date.now(), sheet: null, pt: null, el: null, note: '', stage: '', pct: null }); n++;
      } catch (e) { console.error(e); toast(`${f.name}: ${e.message || '저장 실패'}`, 'err'); }
    }
    save(); st.sel = P.photos[P.photos.length - 1]?.id; st.placing = n === 1; renderSide(); buildToolbar(); draw(); toast(`${n}장 올림${n === 1 ? ' — 도면에서 위치를 누르세요' : ' — 각 사진의 "위치 지정"을 누르세요'}`, 'ok');
  }
  const revAt = (date) => { const t = new Date(date + 'T23:59:59').getTime(); return [...(P.prevs || [])].reverse().find(r => r.at <= t) || null; };
  async function renderSide() {
    side.innerHTML = '';
    const list = P.photos.filter(p => st.filter === 'all' || (st.filter === 'here' ? p.sheet === st.sheet : !p.pt)).sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at);
    const fsel = h('select'); for (const [v, l] of [['all', `전체 ${P.photos.length}`], ['here', '현재 도면'], ['none', `위치 미지정 ${P.photos.filter(p => !p.pt).length}`]]) fsel.append(h('option', { value: v, selected: st.filter === v }, l)); fsel.onchange = () => { st.filter = fsel.value; renderSide(); };
    side.append(h('h4', {}, '현장 사진', h('div', { class: 'row' }, fsel, h('button', { class: 'btn sm show-m', onclick: () => side.classList.remove('open') }, '닫기'))));
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
    const stage = h('select'); stage.append(h('option', { value: '' }, '-')); for (const s of STAGES) stage.append(h('option', { selected: p.stage === s }, s)); stage.onchange = () => { p.stage = stage.value; if (p.pct == null && STAGE_PCT[p.stage] != null) p.pct = STAGE_PCT[p.stage]; save(); renderSide(); };
    const pct = h('input', { type: 'number', min: 0, max: 100, value: p.pct ?? '' }); pct.onchange = () => { p.pct = pct.value === '' ? null : clamp(+pct.value, 0, 100); save(); };
    const note = h('textarea', { rows: 2, style: { width: '100%' } }); note.value = p.note || ''; note.onchange = () => { p.note = note.value; save(); };
    kv.append(h('label', {}, '촬영일'), date, h('label', {}, '위치'), h('span', { class: 'note' }, sh ? `${sh.name}` : '미지정'), h('label', {}, '연결 부재'), elSel, h('label', {}, '시공 단계'), stage, h('label', {}, '판정 진척%'), pct, h('label', {}, '당시 Rev'), h('span', { class: 'note' }, rv ? `${rv.name}${rv.approval?.status ? ' (' + rv.approval.status + ')' : ''}` : '-'));
    box.append(kv, h('div', { class: 'note', style: { marginTop: '6px' } }, '메모'), note);
    const prog = el && P.bill.periods.length ? (() => { const per = [...P.bill.periods].reverse().find(x => !x.date || x.date >= p.date) || P.bill.periods[P.bill.periods.length - 1]; const cur = cumProgress(P, P.bill.periods.indexOf(per))[el.id] || 0; return { per, cur }; })() : null;
    box.append(h('div', { class: 'row', style: { marginTop: '8px' } },
      h('button', { class: 'btn sm primary', onclick: () => { st.placing = true; draw(); toast('도면에서 촬영 위치를 누르세요'); } }, p.pt ? '위치 다시 지정' : '위치 지정'),
      h('button', { class: 'btn sm', onclick: () => aiJudge(p, el) }, 'AI 시공 단계 판정'),
      prog && p.pct != null ? h('button', { class: 'btn sm', title: `${prog.per.name} 현재 ${prog.cur}%`, onclick: () => { prog.per.prog ||= {}; prog.per.prog[el.id] = p.pct; (prog.per.evidence ||= {})[el.id] = p.id; save(); ctx.bus.emit('model', {}); toast(`${prog.per.name} ${el.tag || elName(el)} 누계 ${p.pct}% 반영 (근거 사진 연결)`, 'ok'); renderSide(); } }, `기성 ${prog.per.name}에 ${p.pct}% 반영`) : null,
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
    toast('사진 분석 중…');
    try {
      const blob = await dataToBlob(d);
      const prompt = `당신은 한국 건설 현장 공정 관리자입니다. 첨부 사진을 보고 ${el ? `"${KINDS[el.k]?.name} ${el.tag || ''}" 부재의` : '보이는 골조·마감의'} 시공 단계를 판정하세요. 단계 후보: ${STAGES.join(', ')}.
JSON만 답하세요: {"stage":"단계 후보 중 하나","pct":0~100 정수 누계 진척률,"evidence":"판단 근거 한국어 1~2문장","risks":"품질·안전상 눈에 띄는 점(없으면 빈 문자열)"}`;
      const r = await sample(prompt, { images: [blob], modelTier: 'default' });
      const m = (r.text || '').match(/\{[\s\S]*\}/); if (!m) throw new Error('응답 해석 실패');
      const o = JSON.parse(m[0]); if (STAGES.includes(o.stage)) p.stage = o.stage; if (Number.isFinite(o.pct)) p.pct = clamp(Math.round(o.pct), 0, 100);
      p.note = [p.note, `[AI 판정] ${o.stage} ${o.pct}% — ${o.evidence}${o.risks ? ' / 주의: ' + o.risks : ''}`].filter(Boolean).join('\n'); save(); renderSide(); toast(`AI 판정: ${o.stage} ${o.pct}% (확인 후 기성에 반영하세요)`, 'ok');
    } catch (e) { console.error(e); toast('AI 판정 실패: ' + (e.message || e.code), 'err'); }
  }
  buildToolbar(); renderSide(); requestAnimationFrame(() => { resize(); fit(); });
  return { unmount() { ro.disconnect(); } };
}
