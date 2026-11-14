// 빌더 간섭 — 공종 간 충돌·여유공간, 철근-철골 간섭 검토
import { h, toast, saveFile, table, dialog } from '../js/ui.js';
import { zip } from '../js/zip.js';
import { allElements, elBoxes, boxCorners, DISC, KINDS, elName, isRefElement, levelOf, gridRef } from '../js/model.js';
import { fmt, fmt0, csv, dist, segInt, esc, pointInPoly } from '../js/util.js';

export const CLASH_SETS = [
  { id: 'SM', name: '구조 ↔ 기계(덕트)', a: r => r.disc === 'S', b: r => r.disc === 'M' },
  { id: 'SP', name: '구조 ↔ 배관·소방', a: r => r.disc === 'S', b: r => r.disc === 'P' },
  { id: 'SE', name: '구조 ↔ 전기', a: r => r.disc === 'S', b: r => r.disc === 'E' },
  { id: 'ME', name: '기계 ↔ 전기', a: r => r.disc === 'M', b: r => r.disc === 'E' },
  { id: 'MP', name: '기계 ↔ 배관·소방', a: r => r.disc === 'M', b: r => r.disc === 'P' },
  { id: 'EP', name: '전기 ↔ 배관·소방', a: r => r.disc === 'E', b: r => r.disc === 'P' },
  { id: 'AW', name: '건축 벽체 ↔ 설비 관통', a: r => r.disc === 'A' && r.el.k === 'wall', b: r => ['M', 'E', 'P'].includes(r.disc) },
  { id: 'RS', name: '철근(RC 부재) ↔ 철골', a: r => r.disc === 'S' && r.el.mat === 'RC' && ['column', 'beam'].includes(r.el.k), b: r => r.disc === 'S' && r.el.mat === 'STEEL', rebar: true },
];
const STATUS = ['신규', '검토중', '해결', '승인(무시)'];

// 2D OBB SAT: 반환 {overlap(최소 관통량, 음수면 간격)}
function sat(b1, b2) {
  const c1 = boxCorners(b1), c2 = boxCorners(b2); let minOv = Infinity;
  for (const b of [b1, b2]) for (const ang of [b.ang, b.ang + Math.PI / 2]) {
    const ax = [Math.cos(ang), Math.sin(ang)];
    const pr = (cs) => { let lo = Infinity, hi = -Infinity; for (const p of cs) { const v = p[0] * ax[0] + p[1] * ax[1]; lo = Math.min(lo, v); hi = Math.max(hi, v); } return [lo, hi]; };
    const [a0, a1] = pr(c1), [d0, d1] = pr(c2); const ov = Math.min(a1, d1) - Math.max(a0, d0);
    if (ov < minOv) minOv = ov;
  }
  return minOv;
}
// 원통(배관) 정밀 판정 — 축선과 상자/축선 간 3D 거리 (볼록함수 → 삼분탐색)
function ptBox(p, b) {
  const dx = p[0] - b.cx, dy = p[1] - b.cy, c = Math.cos(b.ang), s = Math.sin(b.ang);
  const u = Math.abs(dx * c + dy * s) - b.hl, v = Math.abs(-dx * s + dy * c) - b.hw, zc = (b.z0 + b.z1) / 2, w = Math.abs(p[2] - zc) - (b.z1 - b.z0) / 2;
  const out = Math.hypot(Math.max(u, 0), Math.max(v, 0), Math.max(w, 0)); return out > 0 ? out : Math.max(u, v, w);
}
const tern = (f) => { let lo = 0, hi = 1; for (let i = 0; i < 40; i++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (f(m1) < f(m2)) hi = m2; else lo = m1; } const t = (lo + hi) / 2; return Math.min(f(t), f(0), f(1)); };
const axisOf = (it) => { const zc = (it.box.z0 + it.box.z1) / 2; return { a: [it.el.a[0], it.el.a[1], zc], b: [it.el.b[0], it.el.b[1], zc], r: it.el.w / 2 }; };
const lerp3 = (A, t) => [A.a[0] + (A.b[0] - A.a[0]) * t, A.a[1] + (A.b[1] - A.a[1]) * t, A.a[2] + (A.b[2] - A.a[2]) * t];
export function pipeDepth(a, b, boxA, boxB) {
  const pa = a.el.k === 'pipe' && a.el.a, pb = b.el.k === 'pipe' && b.el.a; if (!pa && !pb) return null;
  if (pa && pb) { const A = axisOf(a), B = axisOf(b); const d = tern(t => { const p = lerp3(A, t); return tern(s => { const q = lerp3(B, s); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }); }); return A.r + B.r - d; }
  const [pp, ob] = pa ? [a, boxB] : [b, boxA]; const A = axisOf(pp); return A.r - tern(t => ptBox(lerp3(A, t), ob));
}
const shrink = (b, c) => ({ ...b, hl: Math.max(1, b.hl - c), hw: Math.max(1, b.hw - c), z0: b.z0 + c, z1: b.z1 - c });

export function runClash(P, opts = {}) {
  const sets = CLASH_SETS.filter(s => (opts.sets || CLASH_SETS.map(x => x.id)).includes(s.id));
  const tol = opts.tol ?? 0, clr = opts.clearance ?? 0, cover = opts.cover ?? 50;
  const items = [];
  for (const r of allElements(P)) {
    if (r.el.k === 'opening' || r.el.k === 'furn' || isRefElement(r.el, r.sheet, P)) continue; // 가구·장비는 간섭 대상 제외
    const host = (id) => P.content[r.sheet.id].els.find(e => e.id === id);
    const bx = elBoxes(r.el, r.level, host)[0]; if (!bx) continue;
    items.push({ ...r, disc: r.sheet.disc, box: bx, voids: r.el.k === 'wall' ? P.content[r.sheet.id].els.filter(o => o.k === 'opening' && o.host === r.el.id).map(o => elBoxes(o, r.level, host)[0]).filter(Boolean) : [] });
  }
  const out = [];
  const lvOrder = [...P.levels].sort((x, y) => x.elev - y.elev).map(l => l.id); const lvIdx = Object.fromEntries(lvOrder.map((id, i) => [id, i]));
  for (const set of sets) {
    const A = items.filter(set.a), Bk = new Map(); for (const b of items.filter(set.b)) { const i = lvIdx[b.level.id]; if (!Bk.has(i)) Bk.set(i, []); Bk.get(i).push(b); }
    for (const a of A) for (const d of [-1, 0, 1]) for (const b of Bk.get(lvIdx[a.level.id] + d) || []) {
      if (a.el.id === b.el.id) continue;
      let ba = set.rebar ? shrink(a.box, cover) : a.box, bb = b.box;
      const zOv = Math.min(ba.z1, bb.z1) - Math.max(ba.z0, bb.z0);
      if (zOv < -clr) continue;
      const dx = Math.abs(ba.cx - bb.cx), dy = Math.abs(ba.cy - bb.cy), rr = Math.hypot(ba.hl, ba.hw) + Math.hypot(bb.hl, bb.hw) + clr;
      if (dx > rr || dy > rr) continue;
      if ((a.el.k === 'slab' && b.el.k === 'riser') || (b.el.k === 'slab' && a.el.k === 'riser')) continue; // 라이저는 샤프트 개구부로 슬래브 관통
      let pOv = sat(ba, bb);
      if (a.el.k === 'slab' || b.el.k === 'slab') { const s = a.el.k === 'slab' ? a : b, o = a.el.k === 'slab' ? b : a; if (!pointInPoly([o.box.cx, o.box.cy], s.el.pts)) continue; }
      let depth = Math.min(pOv, zOv); const pd = pipeDepth(a, b, ba, bb); if (pd != null) depth = Math.min(depth, pd);
      let kind = null;
      if (depth > tol) kind = 'hard'; else if (clr > 0 && depth > -clr && !set.rebar) kind = 'clearance';
      if (!kind) continue;
      // 위치
      let pt = [(ba.cx + bb.cx) / 2, (ba.cy + bb.cy) / 2];
      if (a.el.a && b.el.a) { const x = segInt(a.el.a, a.el.b, b.el.a, b.el.b); if (x) pt = x.p; }
      else if (a.el.p && b.el.a) pt = a.el.p; else if (b.el.p && a.el.a) pt = b.el.p;
      const z = (Math.max(ba.z0, bb.z0) + Math.min(ba.z1, bb.z1)) / 2;
      // 벽 개구부를 통과하면 제외
      const thru = (wl, o) => wl.el.k === 'wall' && wl.voids.some(v => sat(v, o) > 0 && Math.min(v.z1, o.z1) - Math.max(v.z0, o.z0) >= Math.min(o.z1 - o.z0, v.z1 - v.z0) - 1);
      if (thru(a, bb) || thru(b, ba)) continue; // 개구부·슬리브 통과
      const sev = kind === 'clearance' ? '여유부족' : depth > 100 ? '높음' : depth > 30 ? '중간' : '낮음';
      const key = [set.id, ...[a.el.id, b.el.id].sort()].join('|');
      let note = '';
      if (set.id === 'AW') note = '벽 관통 — 슬리브·개구부 반영 필요';
      else if (set.rebar) note = '철골이 RC 부재 철근 배근 영역 관통 — 접합 상세(관통 슬리브/커플러) 검토';
      else if (['duct', 'pipe', 'tray'].includes(a.el.k) && ['duct', 'pipe', 'tray'].includes(b.el.k)) { const up = a.box.z1 >= b.box.z1 ? a : b, dn = up === a ? b : a; const need = Math.ceil((dn.box.z1 - up.box.z0 + clr) / 10) * 10; note = `${KINDS[up.el.k].name}(${up.el.sys || ''}) ${need}mm 상향 또는 ${KINDS[dn.el.k].name}(${dn.el.sys || ''}) ${need}mm 하향 — 교차부 높이 조정`; }
      else if (a.el.k === 'beam' || b.el.k === 'beam') { const bm = a.el.k === 'beam' ? a : b, mp = bm === a ? b : a; note = `보 하단 FL+${fmt0(bm.box.z0 - bm.level.elev)} / 설비 상단 FL+${fmt0(mp.box.z1 - mp.level.elev)} → ${fmt0(mp.box.z1 - bm.box.z0)}mm 하향 또는 보 관통 슬리브`; }
      const lvl = a.level.elev <= b.level.elev ? b.level : a.level;
      out.push({ key, set: set.id, setName: set.name, a, b, depth, kind, sev, pt, z, level: lvl, note, grid: gridRef(P, lvl.id, pt) });
    }
  }
  return out.sort((x, y) => (y.kind === 'hard') - (x.kind === 'hard') || y.depth - x.depth);
}

export function mount(root, ctx) {
  const P = ctx.P; P.clash ||= { status: {}, tol: 0, clearance: 50 };
  const C = P.clash; C.sets ||= CLASH_SETS.map(s => s.id); C.status ||= {};
  let res = null; const flt = { status: '', set: '', group: '' };
  const page = h('div', { class: 'page' }); const w = h('div', { class: 'wrap' }); page.append(w); root.append(page);

  function run() {
    const t0 = performance.now(); res = runClash(P, { sets: C.sets, tol: C.tol, clearance: C.clearance, cover: C.cover ?? 50 });
    const open = res.filter(r => !['해결', '승인(무시)'].includes(C.status[r.key]?.s)).length;
    C.last = { count: res.length, open, at: Date.now() }; ctx.touch('meta');
    toast(`간섭 ${res.length}건 (${fmt0(performance.now() - t0)}ms)`, res.length ? 'info' : 'ok'); render();
  }
  function render() {
    w.innerHTML = '';
    w.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('div', {}, h('h1', {}, '간섭검토'), h('div', { class: 'sub' }, '같은 층의 공종 간 객체를 3D 상자(배관은 원통)로 비교해 충돌(관통)과 여유 부족을 찾습니다.')),
      h('button', { class: 'btn primary', onclick: run }, '▶ 간섭 검토 실행')));
    // 설정
    const sets = h('div', { class: 'row', style: { margin: '12px 0' } });
    for (const s of CLASH_SETS) { const cb = h('input', { type: 'checkbox', checked: C.sets.includes(s.id) }); cb.onchange = () => { C.sets = cb.checked ? [...C.sets, s.id] : C.sets.filter(x => x !== s.id); ctx.touch('meta'); }; sets.append(h('label', { class: 'pill', style: { display: 'inline-flex', gap: '6px', alignItems: 'center', padding: '4px 10px' } }, cb, s.name)); }
    w.append(sets);
    const num = (label, key, def) => { const i = h('input', { type: 'number', value: C[key] ?? def, style: { width: '90px' } }); i.onchange = () => { C[key] = +i.value; ctx.touch('meta'); }; return h('label', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'note' }, label), i); };
    w.append(h('div', { class: 'row' }, num('허용 관통(mm)', 'tol', 0), num('여유 검사 거리(mm)', 'clearance', 50), num('철근 피복(mm)', 'cover', 50)));
    if (!res) { w.append(h('div', { class: 'card', style: { marginTop: '16px' } }, h('div', { class: 'd' }, C.last ? `지난 검토: ${new Date(C.last.at).toLocaleString('ko-KR')} · ${C.last.count}건 (미해결 ${C.last.open}). 다시 실행해 최신 모델로 검토하세요.` : '"간섭 검토 실행"을 누르세요.'))); return; }
    // 요약
    const cnt = (f) => res.filter(f).length;
    w.append(h('div', { class: 'cards', style: { margin: '14px 0' } }, ...[['전체', res.length], ['충돌', cnt(r => r.kind === 'hard')], ['여유부족', cnt(r => r.kind === 'clearance')], ['미해결', cnt(r => !['해결', '승인(무시)'].includes(C.status[r.key]?.s))]].map(([t, v]) => h('div', { class: 'card' }, h('div', { class: 'note' }, t), h('div', { class: 'mono', style: { fontSize: '20px', fontWeight: 600 } }, v)))));
    const bySet = h('div', { class: 'legend', style: { marginBottom: '10px' } }); for (const s of CLASH_SETS) { const n = res.filter(r => r.set === s.id).length; if (n) bySet.append(h('span', {}, `${s.name} ${n}`)); } w.append(bySet);
    const fs = h('select'); fs.append(h('option', { value: '' }, '전체 상태')); for (const s of STATUS) fs.append(h('option', { value: s, selected: flt.status === s }, s)); fs.onchange = () => { flt.status = fs.value; render(); };
    const ft = h('select'); ft.append(h('option', { value: '' }, '전체 세트')); for (const s of CLASH_SETS) ft.append(h('option', { value: s.id, selected: flt.set === s.id }, s.name)); ft.onchange = () => { flt.set = ft.value; render(); };
    const fg = h('select'); for (const [v, l] of [['', '묶음 없음'], ['a', '객체 A별 묶음'], ['grid', '그리드 구역별 묶음'], ['level', '층별 묶음']]) fg.append(h('option', { value: v, selected: flt.group === v }, l)); fg.onchange = () => { flt.group = fg.value; render(); };
    w.append(h('div', { class: 'row', style: { marginBottom: '8px' } }, fs, ft, fg, h('button', { class: 'btn', onclick: exportCSV }, 'CSV'), h('button', { class: 'btn', onclick: exportHTML }, '보고서(HTML)'), h('button', { class: 'btn', title: 'Revit·Navisworks·Solibri·BIMcollab 등에서 열 수 있는 이슈 교환 형식', onclick: exportBCF }, 'BCF 2.1'), h('button', { class: 'btn', onclick: () => { const ids = new Set(); const pts3 = []; for (const r of res.filter(q => !['해결', '승인(무시)'].includes(C.status[q.key]?.s))) { ids.add(r.a.el.id); ids.add(r.b.el.id); pts3.push([r.pt[0], r.pt[1], r.z]); } ctx.state.hi = { ids: [...ids], pts3, label: `미해결 간섭 ${pts3.length}건` }; ctx.go('view3d'); } }, '미해결 전체 3D')));
    const rows = res.filter(r => (!flt.set || r.set === flt.set) && (!flt.status || (C.status[r.key]?.s || '신규') === flt.status));
    const lab = (x) => `${x.el.tag ? x.el.tag + ' · ' : ''}${elName(x.el)}`;
    if (flt.group) {
      const keyOf = { a: r => lab(r.a) + ' — ' + r.a.sheet.name, grid: r => `${r.level.name} ${r.grid || '(그리드 없음)'}`, level: r => r.level.name }[flt.group];
      const grp = new Map(); for (const r of rows) { const k = keyOf(r); if (!grp.has(k)) grp.set(k, []); grp.get(k).push(r); }
      w.append(h('div', { class: 'tbl', style: { marginBottom: '10px' } }, table([{ label: '묶음', key: 'k' }, { label: '건수', num: true, render: g => g.v.length }, { label: '최대 깊이', num: true, render: g => fmt0(Math.max(...g.v.map(r => r.depth))) }, { label: '세트', render: g => h('span', { class: 'note' }, [...new Set(g.v.map(r => r.setName))].join(', ')) }, { label: '', render: g => h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); const ids = new Set(); g.v.forEach(r => { ids.add(r.a.el.id); ids.add(r.b.el.id); }); ctx.state.hi = { ids: [...ids], pts3: g.v.map(r => [r.pt[0], r.pt[1], r.z]), label: g.k }; ctx.go('view3d'); } }, '3D') }],
        [...grp.entries()].map(([k, v]) => ({ k, v })).sort((a, b) => b.v.length - a.v.length))));
    }
    w.append(h('div', { class: 'tbl' }, table([
      { label: '#', render: r => res.indexOf(r) + 1 }, { label: '세트', render: r => h('span', { class: 'note' }, r.setName) },
      { label: '심각도', render: r => h('span', { class: 'pill ' + (r.sev === '높음' ? 'bad' : r.sev === '중간' ? 'warn' : r.sev === '여유부족' ? 'acc' : '') }, r.sev) },
      { label: '객체 A', render: r => h('div', {}, lab(r.a), h('div', { class: 'note' }, r.a.sheet.name)) }, { label: '객체 B', render: r => h('div', {}, lab(r.b), h('div', { class: 'note' }, r.b.sheet.name)) },
      { label: '층·그리드', render: r => h('div', {}, r.level.name, h('div', { class: 'note mono' }, r.grid || '')) }, { label: r => '', num: true, render: r => r.kind === 'hard' ? `관통 ${fmt0(r.depth)}` : `간격 ${fmt0(-r.depth)}` },
      { label: '위치', render: r => h('span', { class: 'mono note' }, `${fmt0(r.pt[0])}, ${fmt0(r.pt[1])}, Z${fmt0(r.z)}`) },
      { label: '조치 의견', render: r => h('span', { class: 'note' }, r.note) },
      { label: '상태', render: r => { const s = h('select', { onclick: e => e.stopPropagation() }); for (const x of STATUS) s.append(h('option', { selected: (C.status[r.key]?.s || '신규') === x }, x)); s.onchange = () => { C.status[r.key] = { ...(C.status[r.key] || {}), s: s.value, at: Date.now() }; C.last.open = res.filter(q => !['해결', '승인(무시)'].includes(C.status[q.key]?.s)).length; ctx.touch('meta'); }; return s; } },
      { label: '', render: r => h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); focus(r, 'view3d'); } }, '3D'), h('button', { class: 'btn sm', title: '간섭 위치 평면 스냅샷', onclick: (e) => { e.stopPropagation(); const c = snapshot(r); c.style.width = '100%'; dialog({ title: `간섭 #${res.indexOf(r) + 1} 평면`, body: c, wide: true, cancel: null, ok: '닫기' }); } }, '평면'), h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); focus(r, 'cad'); } }, '작도'), h('button', { class: 'btn sm', title: '이슈로 등록', onclick: async (e) => { e.stopPropagation(); const { addIssue } = await import('./issue.js'); const it = addIssue(P, { type: '간섭', title: `${r.setName}: ${r.a.el.tag || elName(r.a.el)} ↔ ${r.b.el.sys || r.b.el.tag || elName(r.b.el)}`, desc: `${r.level.name} ${r.grid} / ${r.kind === 'hard' ? '관통 ' + fmt0(r.depth) : '간격 ' + fmt0(-r.depth)}mm\n${r.note}`, src: 'clash::' + r.key, refs: { ids: [r.a.el.id, r.b.el.id], pts: [r.pt], pts3: [[r.pt[0], r.pt[1], r.z]], level: r.level.id, where: `${r.level.name} ${r.grid}` } }); ctx.touch('meta'); toast(it ? `이슈 #${it.no} 등록` : '이미 등록된 간섭입니다', it ? 'ok' : 'info'); } }, '이슈')) },
    ].map(c => typeof c.label === 'function' ? { ...c, label: '깊이(mm)' } : c), rows.slice(0, 500))));
    if (!res.length) w.append(h('div', { class: 'empty' }, '간섭이 없습니다.'));
  }
  function focus(r, tool) {
    ctx.state.hi = { ids: [r.a.el.id, r.b.el.id], pts: [r.pt], pts3: [[r.pt[0], r.pt[1], r.z]], sheet: tool === 'cad' ? (r.b.disc !== 'S' ? r.b.sheet.id : r.a.sheet.id) : null, level: r.level.id, label: `간섭 #${res.indexOf(r) + 1} ${r.setName}` };
    ctx.go(tool);
  }
  function exportCSV() {
    const out = [['#', '세트', '심각도', '층', '그리드', '객체A', '도면A', '객체B', '도면B', '깊이/간격(mm)', 'X', 'Y', 'Z', '조치의견', '상태']];
    res.forEach((r, i) => out.push([i + 1, r.setName, r.sev, r.level.name, r.grid, elName(r.a.el) + (r.a.el.tag ? ` (${r.a.el.tag})` : ''), r.a.sheet.name, elName(r.b.el) + (r.b.el.tag ? ` (${r.b.el.tag})` : ''), r.b.sheet.name, Math.round(r.depth), Math.round(r.pt[0]), Math.round(r.pt[1]), Math.round(r.z), r.note, C.status[r.key]?.s || '신규']));
    saveFile(`${P.name}_간섭검토.csv`.replace(/[\\/:*?"<>|]/g, '_'), csv(out));
  }
  function exportHTML() {
    const tr = res.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.setName)}</td><td>${r.sev}</td><td>${esc(r.level.name)} ${esc(r.grid || '')}</td><td>${esc(elName(r.a.el))}<br><small>${esc(r.a.sheet.name)}</small></td><td>${esc(elName(r.b.el))}<br><small>${esc(r.b.sheet.name)}</small></td><td style="text-align:right">${fmt0(r.depth)}</td><td>${fmt0(r.pt[0])}, ${fmt0(r.pt[1])}, Z${fmt0(r.z)}</td><td>${esc(r.note)}</td><td>${esc(C.status[r.key]?.s || '신규')}</td></tr>`).join('');
    saveFile(`${P.name}_간섭검토.html`.replace(/[\\/:*?"<>|]/g, '_'), `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>간섭 검토 보고서</title><style>body{font-family:'Malgun Gothic',sans-serif;margin:24px}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #999;padding:4px}th{background:#eef}</style></head><body><h1 style="font-size:20px">${esc(P.name)} 간섭 검토 보고서</h1><p>${new Date().toLocaleString('ko-KR')} · ${res.length}건 · 허용 관통 ${C.tol}mm · 여유 ${C.clearance}mm</p><table><tr><th>#</th><th>세트</th><th>심각도</th><th>층</th><th>객체A</th><th>객체B</th><th>깊이/간격</th><th>위치</th><th>조치 의견</th><th>상태</th></tr>${tr}</table></body></html>`);
  }
  // 평면 스냅샷(PNG) — 간섭 위치 주변 객체 윤곽
  function snapshot(r, size = 640) {
    const cv = document.createElement('canvas'); cv.width = size; cv.height = Math.round(size * 0.75); const g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, cv.width, cv.height); const R = 6000, s = cv.width / (2 * R);
    const X = (p) => [cv.width / 2 + (p[0] - r.pt[0]) * s, cv.height / 2 - (p[1] - r.pt[1]) * s];
    const near = allElements(P, x => x.level.id === r.level.id || x.level.id === r.a.level.id).filter(x => x.el.k !== 'opening');
    const poly = (cs, st, fill, lw) => { g.beginPath(); cs.forEach((p, i) => { const q = X(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } g.strokeStyle = st; g.lineWidth = lw; g.stroke(); };
    for (const x of near) { const b = elBoxes(x.el, x.level, id => P.content[x.sheet.id].els.find(e => e.id === id))[0]; if (!b || Math.hypot(b.cx - r.pt[0], b.cy - r.pt[1]) > R * 3) continue; poly(b.poly || boxCorners(b), '#9aa3ad', null, 1); }
    poly(boxCorners(r.a.box), '#d92d20', '#d92d2033', 2.5); poly(boxCorners(r.b.box), '#1570ef', '#1570ef33', 2.5);
    const c = X(r.pt); g.strokeStyle = '#111'; g.lineWidth = 2; g.beginPath(); g.arc(c[0], c[1], 14, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#111'; g.font = '600 15px sans-serif'; g.fillText(`#${res.indexOf(r) + 1} ${r.setName} · ${r.level.name} ${r.grid || ''}`, 12, 22);
    g.font = '13px sans-serif'; g.fillText(`A(빨강) ${elName(r.a.el)} / B(파랑) ${elName(r.b.el)} · ${r.kind === 'hard' ? '관통' : '간격'} ${fmt0(Math.abs(r.depth))}mm · Z${fmt0(r.z)}`, 12, cv.height - 14);
    g.strokeStyle = '#111'; g.beginPath(); g.moveTo(cv.width - 112, cv.height - 40); g.lineTo(cv.width - 112 + 2000 * s, cv.height - 40); g.stroke(); g.fillText('2m', cv.width - 112, cv.height - 46);
    return cv;
  }
  const guid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  const xe = (s) => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
  async function exportBCF() {
    if (!res?.length) return toast('먼저 간섭 검토를 실행하세요');
    const v = await dialog({ title: 'BCF 2.1 내보내기', body: '<div class="note">간섭 1건 = BCF 토픽 1개. 각 토픽에 평면 스냅샷과 3D 시점(카메라 위치·대상 객체)이 들어갑니다. 객체 GUID는 빌더 내부 ID이므로, IFC에서 가져온 모델이 아니면 다른 프로그램에서는 시점·스냅샷으로 위치를 찾습니다.</div>', fields: [{ key: 'scope', label: '대상', type: 'select', options: [['open', '미해결만'], ['all', '전체'], ['hard', '충돌(관통)만']], value: 'open' }, { key: 'author', label: '작성자(이메일 또는 이름)', value: C.author || '' }] });
    if (!v) return; C.author = v.author; ctx.touch('meta');
    const list = res.filter(r => v.scope === 'all' || (v.scope === 'hard' ? r.kind === 'hard' : !['해결', '승인(무시)'].includes(C.status[r.key]?.s)));
    if (!list.length) return toast('내보낼 항목이 없습니다');
    const files = [{ name: 'bcf.version', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Version VersionId="2.1"><DetailedVersion>2.1</DetailedVersion></Version>' }];
    const pg = (P.prj ||= guid()); files.push({ name: 'project.bcfp', data: `<?xml version="1.0" encoding="UTF-8"?>\n<ProjectExtension><Project ProjectId="${pg}"><Name>${xe(P.name)}</Name></Project><ExtensionSchema></ExtensionSchema></ProjectExtension>` });
    const now = new Date().toISOString(); const stMap = { '신규': 'Open', '검토중': 'In Progress', '해결': 'Resolved', '승인(무시)': 'Closed' };
    for (const r of list) {
      const st = C.status[r.key] ||= {}; const tg = (st.bcf ||= guid()); const vg = guid(); ctx.touch('meta');
      const blob = await new Promise(res2 => snapshot(r).toBlob(res2, 'image/png')); const png = new Uint8Array(await blob.arrayBuffer());
      const m = 0.001, t = [r.pt[0] * m, r.pt[1] * m, r.z * m], cam = [t[0] - 7, t[1] - 9, t[2] + 10], dir = [t[0] - cam[0], t[1] - cam[1], t[2] - cam[2]]; const dl = Math.hypot(...dir); const D = dir.map(x => x / dl);
      const up = [-D[0] * D[2], -D[1] * D[2], 1 - D[2] * D[2]]; const ul = Math.hypot(...up); const U = up.map(x => x / ul);
      const title = `#${res.indexOf(r) + 1} ${r.setName} — ${elName(r.a.el)} / ${elName(r.b.el)}`;
      const desc = `${r.level.name} ${r.grid || ''} · ${r.kind === 'hard' ? '관통' : '간격'} ${fmt0(Math.abs(r.depth))}mm · 위치 X${fmt0(r.pt[0])} Y${fmt0(r.pt[1])} Z${fmt0(r.z)} (mm)\nA: ${elName(r.a.el)} [${r.a.sheet.name}]\nB: ${elName(r.b.el)} [${r.b.sheet.name}]\n조치 의견: ${r.note}`;
      files.push({ name: `${tg}/markup.bcf`, data: `<?xml version="1.0" encoding="UTF-8"?>
<Markup><Topic Guid="${tg}" TopicType="Clash" TopicStatus="${stMap[st.s || '신규']}"><Title>${xe(title)}</Title><Priority>${r.sev === '높음' ? 'High' : r.sev === '중간' ? 'Normal' : 'Low'}</Priority><Labels>${xe(r.set)}</Labels><CreationDate>${now}</CreationDate><CreationAuthor>${xe(v.author || 'Builder')}</CreationAuthor><Description>${xe(desc)}</Description></Topic>
<Viewpoints Guid="${vg}"><Viewpoint>viewpoint.bcfv</Viewpoint><Snapshot>snapshot.png</Snapshot></Viewpoints></Markup>` });
      const comp = [r.a, r.b].map(x => `<Component IfcGuid="${xe(x.el.gid || x.el.id)}" AuthoringToolId="${xe(x.el.id)}" />`).join('');
      files.push({ name: `${tg}/viewpoint.bcfv`, data: `<?xml version="1.0" encoding="UTF-8"?>
<VisualizationInfo Guid="${vg}"><Components><Selection>${comp}</Selection><Visibility DefaultVisibility="true" /></Components>
<PerspectiveCamera><CameraViewPoint><X>${cam[0].toFixed(3)}</X><Y>${cam[1].toFixed(3)}</Y><Z>${cam[2].toFixed(3)}</Z></CameraViewPoint><CameraDirection><X>${D[0].toFixed(4)}</X><Y>${D[1].toFixed(4)}</Y><Z>${D[2].toFixed(4)}</Z></CameraDirection><CameraUpVector><X>${U[0].toFixed(4)}</X><Y>${U[1].toFixed(4)}</Y><Z>${U[2].toFixed(4)}</Z></CameraUpVector><FieldOfView>60</FieldOfView></PerspectiveCamera></VisualizationInfo>` });
      files.push({ name: `${tg}/snapshot.png`, data: png });
    }
    saveFile(`${P.name}_간섭.bcfzip`.replace(/[\\/:*?"<>|]/g, '_'), zip(files)); toast(`BCF 토픽 ${list.length}개`, 'ok');
  }
  render();
  return { unmount() { } };
}
