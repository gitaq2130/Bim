// 빌더 정합 — 도면 간 일치 검토 (규칙 기반 + AI 검토)
import { h, toast, saveFile, table, getSample } from '../js/ui.js';
import { allElements, elName, levelOf, isRefElement, DISC, KINDS } from '../js/model.js';
import { fmt, fmt0, csv, dist, sub, dot, norm, cross, perp, closestOnSeg, esc } from '../js/util.js';
import { dimGeom } from '../js/dxf.js';
import { mepNetwork, SYS } from '../js/mep.js';
import { diffContent, revisions, loadRev } from '../js/rev.js';

const STATUS = ['신규', '검토중', '해결', '승인(무시)'];
export const RULES = {
  COL: '건축↔구조 기둥 위치·크기', GRID: '도면 간 그리드 위치', DIM: '치수 문자 수정(실제 길이와 다름)', DUP: '중복·겹침 객체', BEAM: '보 단부 지지', STACK: '상·하층 기둥 연속',
  OPEN: '개구부 위치·크기', HGT: '층고 대비 높이', MEP: '설비 설치 높이', REV: '리비전 변경 내역', XREF: '건축↔구조 벽체 정렬', NET: '설비·전기 계통 연결',
};

export function runCheck(P, opts = {}) {
  const tolPos = opts.tol ?? 10; const out = [];
  const add = (rule, sev, msg, ids, pts, sheet, level) => out.push({ key: rule + '|' + [...ids].sort().join('|') + '|' + msg.replace(/[\d.,]+/g, '#'), rule, sev, msg, ids, pts, sheet, level });
  const all = allElements(P);
  const byLevel = (lid, f) => all.filter(r => r.level.id === lid && f(r));
  // 1. 기둥 A↔S
  for (const L of P.levels) {
    const aCols = byLevel(L.id, r => r.sheet.disc === 'A' && r.el.k === 'column'), sCols = byLevel(L.id, r => r.sheet.disc === 'S' && r.el.k === 'column');
    if (!aCols.length || !sCols.length) continue;
    for (const a of aCols) {
      const near = sCols.map(s => ({ s, d: dist(s.el.p, a.el.p) })).sort((x, y) => x.d - y.d)[0];
      if (!near || near.d > 2000) add('COL', '높음', `${L.name} 건축도 기둥(${fmt0(a.el.p[0])}, ${fmt0(a.el.p[1])})이 구조도에 없음`, [a.el.id], [a.el.p], a.sheet.id, L.id);
      else if (near.d > tolPos) add('COL', '높음', `${L.name} 기둥 위치 ${fmt0(near.d)}mm 차이 — ${a.sheet.name} vs ${near.s.sheet.name}`, [a.el.id, near.s.el.id], [a.el.p], a.sheet.id, L.id);
      else if (a.el.mat !== 'STEEL' && (Math.abs(a.el.w - near.s.el.w) > 1 || Math.abs(a.el.d - near.s.el.d) > 1)) add('COL', '중간', `${L.name} 기둥 크기 불일치 ${a.el.w}×${a.el.d} vs ${near.s.el.w}×${near.s.el.d}`, [a.el.id, near.s.el.id], [a.el.p], a.sheet.id, L.id);
    }
    for (const s of sCols) if (!aCols.some(a => dist(a.el.p, s.el.p) <= 2000)) add('COL', '중간', `${L.name} 구조도 기둥(${fmt0(s.el.p[0])}, ${fmt0(s.el.p[1])})이 건축도에 없음`, [s.el.id], [s.el.p], s.sheet.id, L.id);
  }
  // 2. 그리드
  const grids = []; for (const s of P.sheets) for (const e of P.content[s.id]?.ents || []) if (e.t === 'grid' && e.label) grids.push({ e, s });
  const byLabel = new Map(); for (const g of grids) { if (!byLabel.has(g.e.label)) byLabel.set(g.e.label, []); byLabel.get(g.e.label).push(g); }
  for (const [label, gs] of byLabel) {
    if (gs.length < 2) continue; const ref = gs[0]; const d0 = norm(sub(ref.e.b, ref.e.a)), n0 = perp(d0);
    const offs = gs.map(g => ({ g, o: dot(sub(g.e.a, ref.e.a), n0), par: Math.abs(cross(d0, norm(sub(g.e.b, g.e.a)))) < 0.001 }));
    const bad = offs.filter(x => !x.par || Math.abs(x.o) > 1);
    if (bad.length) {
      const vals = offs.map(x => `${x.g.s.name.split(' ')[0]}:${x.par ? (x.o >= 0 ? '+' : '') + fmt0(x.o) : '각도 다름'}`).join(', ');
      add('GRID', '높음', `그리드 ${label} 위치 불일치 (기준 ${ref.s.name.split(' ')[0]} 대비 ${vals})`, bad.map(x => x.g.e.id), bad.map(x => x.g.e.a), bad[0].g.s.id, bad[0].g.s.level);
    }
  }
  // 3. 치수 문자 수정
  for (const s of P.sheets) for (const e of P.content[s.id]?.ents || []) if (e.t === 'dim' && e.ovr) {
    const v = parseFloat(String(e.ovr).replace(/,/g, '')); const L = dist(e.a, e.b);
    if (isNaN(v)) add('DIM', '낮음', `치수 문자 "${e.ovr}" (실제 ${fmt0(L)}) — 숫자가 아닌 문자로 대체됨`, [e.id], [dimGeom(e).tp], s.id, s.level);
    else if (Math.abs(v - L) > 1) add('DIM', '높음', `치수 문자 ${e.ovr} ≠ 실제 길이 ${fmt0(L)} (차이 ${fmt0(v - L)}mm)`, [e.id], [dimGeom(e).tp], s.id, s.level);
  }
  // 4. 중복·겹침
  for (const s of P.sheets) {
    const els = P.content[s.id]?.els || [];
    const lin = els.filter(e => ['wall', 'beam', 'duct', 'pipe', 'tray'].includes(e.k));
    for (let i = 0; i < lin.length; i++) for (let j = i + 1; j < lin.length; j++) {
      const a = lin[i], b = lin[j]; if (a.k !== b.k) continue; const da = norm(sub(a.b, a.a));
      if (Math.abs(cross(da, norm(sub(b.b, b.a)))) > 0.001) continue; if (Math.abs(dot(sub(b.a, a.a), perp(da))) > Math.max(a.w || a.t || 0, b.w || b.t || 0) / 2) continue;
      if (['duct', 'pipe', 'tray'].includes(a.k) && Math.abs((a.z ?? 0) - (b.z ?? 0)) > (a.hh + b.hh) / 2) continue;
      const La = dist(a.a, a.b); const s1 = dot(sub(b.a, a.a), da), s2 = dot(sub(b.b, a.a), da); const ov = Math.min(La, Math.max(s1, s2)) - Math.max(0, Math.min(s1, s2));
      if (ov > 100) add('DUP', '중간', `${KINDS[a.k].name} 겹침 ${fmt0(ov)}mm (${s.name}) — 중복 산출 위험`, [a.id, b.id], [closestOnSeg(b.a, a.a, a.b).p], s.id, s.level);
    }
    const pts = els.filter(e => e.k === 'column' || e.k === 'footing');
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (pts[i].k === pts[j].k && dist(pts[i].p, pts[j].p) < 50) add('DUP', '중간', `${KINDS[pts[i].k].name} 중복 배치 (${s.name})`, [pts[i].id, pts[j].id], [pts[i].p], s.id, s.level);
  }
  // 5. 보 지지
  for (const L of P.levels) {
    const beams = byLevel(L.id, r => r.sheet.disc === 'S' && r.el.k === 'beam'); if (!beams.length) continue;
    const cols = byLevel(L.id, r => r.el.k === 'column' && !isRefElement(r.el, r.sheet, P)); const walls = byLevel(L.id, r => r.el.k === 'wall' && r.el.mat === 'RC');
    for (const b of beams) for (const end of [b.el.a, b.el.b]) {
      if (b.el.cant && end === b.el.b) continue; // 캔틸레버 자유단(설계 의도)
      const onCol = cols.some(c => Math.abs(end[0] - c.el.p[0]) <= c.el.w / 2 + 50 && Math.abs(end[1] - c.el.p[1]) <= c.el.d / 2 + 50);
      const onBeam = beams.some(o => o !== b && closestOnSeg(end, o.el.a, o.el.b).d <= Math.max(50, (o.el.w || 0) / 2));
      const onWall = walls.some(w => closestOnSeg(end, w.el.a, w.el.b).d <= w.el.t / 2 + 50);
      if (!onCol && !onBeam && !onWall) add('BEAM', '높음', `${L.name} ${b.el.tag || elName(b.el)} 단부(${fmt0(end[0])}, ${fmt0(end[1])}) 지지 부재 없음`, [b.el.id], [end], b.sheet.id, L.id);
    }
  }
  // 6. 상·하층 기둥 연속
  const lv = [...P.levels].sort((a, b) => a.elev - b.elev);
  for (let i = 1; i < lv.length; i++) {
    const up = byLevel(lv[i].id, r => r.sheet.disc === 'S' && r.el.k === 'column'), dn = byLevel(lv[i - 1].id, r => r.sheet.disc === 'S' && r.el.k === 'column');
    if (!dn.length) continue;
    for (const u of up) if (!dn.some(d => dist(d.el.p, u.el.p) <= 50)) add('STACK', '높음', `${lv[i].name} 기둥(${fmt0(u.el.p[0])}, ${fmt0(u.el.p[1])}) 아래층에 기둥 없음 — 전이보 확인`, [u.el.id], [u.el.p], u.sheet.id, lv[i].id);
  }
  // 7. 개구부
  for (const r of all.filter(r => r.el.k === 'opening')) {
    const host = P.content[r.sheet.id].els.find(e => e.id === r.el.host);
    if (!host) { add('OPEN', '중간', `개구부 ${r.el.tag || ''} 의 벽이 없음 (${r.sheet.name})`, [r.el.id], [], r.sheet.id, r.level.id); continue; }
    const L = dist(host.a, host.b), H = host.h ?? r.level.height;
    if (r.el.s < 0 || r.el.s + r.el.w > L + 1) add('OPEN', '중간', `${r.el.tag || elName(r.el)} 가 벽 길이(${fmt0(L)}) 밖으로 나감`, [r.el.id, host.id], [host.a], r.sheet.id, r.level.id);
    if ((r.el.sill || 0) + r.el.h > H) add('OPEN', '중간', `${r.el.tag || elName(r.el)} 상단(${fmt0((r.el.sill || 0) + r.el.h)})이 벽 높이(${fmt0(H)}) 초과`, [r.el.id], [host.a], r.sheet.id, r.level.id);
  }
  // 8. 층고 대비 높이
  for (const r of all) if ((r.el.k === 'column' || r.el.k === 'wall') && r.el.h != null && r.el.h > r.level.height + 1) add('HGT', '낮음', `${elName(r.el)} 높이 ${fmt0(r.el.h)} > 층고 ${fmt0(r.level.height)} (${r.sheet.name})`, [r.el.id], [r.el.p || r.el.a], r.sheet.id, r.level.id);
  // 9. 설비 높이
  for (const r of all) if (['duct', 'pipe', 'tray'].includes(r.el.k)) {
    const top = (r.el.z ?? 0) + r.el.hh / 2, bot = (r.el.z ?? 0) - r.el.hh / 2;
    if (top > r.level.height) add('MEP', '높음', `${elName(r.el)} 상단 FL+${fmt0(top)} 이 층고 ${fmt0(r.level.height)} 초과 — 상부 슬래브 관통`, [r.el.id], [r.el.a], r.sheet.id, r.level.id);
    else if (bot < 2100) add('MEP', '낮음', `${elName(r.el)} 하단 FL+${fmt0(bot)} — 유효 높이 2.1m 미만`, [r.el.id], [r.el.a], r.sheet.id, r.level.id);
  }
  // 10. 건축 RC벽 ↔ 구조 벽(같은 층)
  for (const L of P.levels) {
    const aw = byLevel(L.id, r => r.sheet.disc === 'A' && r.el.k === 'wall' && r.el.mat === 'RC'), sw = byLevel(L.id, r => r.sheet.disc === 'S' && r.el.k === 'wall');
    if (!sw.length) continue;
    for (const a of aw) { const m = sw.find(s => closestOnSeg(a.el.a, s.el.a, s.el.b).d < 600 && closestOnSeg(a.el.b, s.el.a, s.el.b).d < 600); if (!m) add('XREF', '중간', `${L.name} 건축 RC벽이 구조도에 없음 (${fmt0(dist(a.el.a, a.el.b))}mm)`, [a.el.id], [a.el.a], a.sheet.id, L.id); else { const off = closestOnSeg(a.el.a, m.el.a, m.el.b).d; if (off > tolPos) add('XREF', '높음', `${L.name} RC벽 중심 ${fmt0(off)}mm 어긋남`, [a.el.id, m.el.id], [a.el.a], a.sheet.id, L.id); if (Math.abs(a.el.t - m.el.t) > 1) add('XREF', '중간', `${L.name} RC벽 두께 ${a.el.t} vs ${m.el.t}`, [a.el.id, m.el.id], [a.el.a], a.sheet.id, L.id); } }
  }
  // 11. 리비전 변경 내역
  if (opts.revs !== false) for (const s of P.sheets) {
    let last, d;
    if (opts.revSnap) { last = { name: opts.revName }; d = diffContent(opts.revSnap.content?.[s.id], P.content[s.id]); }
    else { const rv = revisions(P, s.id); if (!rv.length) continue; last = rv[rv.length - 1]; d = diffContent(JSON.parse(last.data), P.content[s.id]); }
    const nm = (o) => o.k ? (o.tag ? o.tag + ' ' : '') + elName(o) : ({ line: '선', pline: '폴리선', text: '문자', dim: '치수', grid: '그리드 ' + (o.label || '') }[o.t] || o.t);
    const ptOf = (o) => o.p || o.a || o.pts?.[0] || o.c || null;
    for (const o of d.added) if (o.k || o.t === 'grid' || o.t === 'dim') add('REV', '낮음', `${s.name}: ${last.name} 이후 추가 — ${nm(o)}`, [o.id], ptOf(o) ? [ptOf(o)] : [], s.id, s.level);
    for (const o of d.removed) if (o.k || o.t === 'grid' || o.t === 'dim') add('REV', '중간', `${s.name}: ${last.name} 이후 삭제 — ${nm(o)}`, [o.id], ptOf(o) ? [ptOf(o)] : [], s.id, s.level);
    for (const c of d.changed) { const a = ptOf(c.old), b = ptOf(c.now); const mv = a && b ? dist(a, b) : 0; const keys = Object.keys(c.now).filter(k => JSON.stringify(c.now[k]) !== JSON.stringify(c.old[k])); add('REV', '낮음', `${s.name}: ${last.name} 이후 변경 — ${nm(c.now)} (${mv > 0.5 ? `이동 ${fmt0(mv)}mm` : keys.join(', ')})`, [c.now.id], b ? [b] : [], s.id, s.level); }
  }
  // 계통 연결: 소스(장비)까지 이어지지 않은 덕트·배관·트레이 묶음, 필요한 계통이 빠진 장비
  if (!opts.rules || opts.rules.includes('NET')) {
    const N = mepNetwork(P);
    for (const c of N.comps) if (!c.ok && c.n > 0) { const it = c.items.find(x => x.el.a || x.el.p); const pt = it.el.a || it.el.p; add('NET', c.n > 3 ? '높음' : '중간', `${SYS[c.sys]?.name || c.sys} 계통 ${c.n}개 구간이 소스 장비에 연결되지 않음 (${[...c.levels].slice(0, 4).join(', ')}${c.levels.size > 4 ? ' 외' : ''})`, c.ids, [pt], it.sheet.id, it.level.id); }
    for (const q of N.needs) add('NET', '높음', `${q.el.tag || elName(q.el)} — ${SYS[q.sys]?.name || q.sys} 미연결 (${q.level.name})`, [q.el.id], [q.el.p], q.sheet.id, q.level.id);
  }
  return out;
}

export function mount(root, ctx) {
  const P = ctx.P; P.check ||= { status: {} }; const C = P.check; C.status ||= {};
  let res = null, ai = null; const flt = { rule: '', status: '' };
  const page = h('div', { class: 'page' }); const w = h('div', { class: 'wrap' }); page.append(w); root.append(page);
  async function run() { const lr = (P.prevs || [])[P.prevs?.length - 1]; const snap = lr ? await loadRev(ctx, lr.id) : null; res = runCheck(P, { tol: C.tol ?? 10, revSnap: snap, revName: lr?.name }); C.last = { count: res.length, open: res.filter(r => !['해결', '승인(무시)'].includes(C.status[r.key]?.s)).length, at: Date.now() }; ctx.touch('meta'); toast(`지적 ${res.length}건`); render(); }
  function render() {
    w.innerHTML = '';
    w.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('div', {}, h('h1', {}, '도면정합'), h('div', { class: 'sub' }, '건축·구조·설비 도면을 서로 대조해 위치·크기·치수·연속성 불일치를 찾습니다.')),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: run }, '▶ 정합 검토 실행'), h('button', { class: 'btn', onclick: aiReview }, 'AI 검토 의견'))));
    const tol = h('input', { type: 'number', value: C.tol ?? 10, style: { width: '80px' } }); tol.onchange = () => { C.tol = +tol.value; ctx.touch('meta'); };
    w.append(h('div', { class: 'row', style: { margin: '12px 0' } }, h('span', { class: 'note' }, '위치 허용오차(mm)'), tol, h('span', { class: 'note' }, '검토 규칙: ' + Object.values(RULES).join(' · '))));
    if (ai) w.append(h('div', { class: 'card', style: { marginBottom: '12px', whiteSpace: 'pre-wrap' } }, h('div', { class: 't' }, 'AI 검토 의견 (Claude)'), h('div', { class: 'd' }, ai)));
    if (!res) { w.append(h('div', { class: 'card' }, h('div', { class: 'd' }, C.last ? `지난 검토: ${new Date(C.last.at).toLocaleString('ko-KR')} · ${C.last.count}건 (미해결 ${C.last.open}).` : '"정합 검토 실행"을 누르세요.'))); return; }
    const cnt = {}; for (const r of res) cnt[r.rule] = (cnt[r.rule] || 0) + 1;
    w.append(h('div', { class: 'legend', style: { marginBottom: '10px' } }, ...Object.entries(cnt).map(([k, v]) => h('span', { class: 'pill' + (flt.rule === k ? ' acc' : ''), style: { cursor: 'pointer' }, onclick: () => { flt.rule = flt.rule === k ? '' : k; render(); } }, `${RULES[k]} ${v}`))));
    const fs = h('select'); fs.append(h('option', { value: '' }, '전체 상태')); for (const s of STATUS) fs.append(h('option', { value: s, selected: flt.status === s }, s)); fs.onchange = () => { flt.status = fs.value; render(); };
    w.append(h('div', { class: 'row', style: { marginBottom: '8px' } }, fs, h('button', { class: 'btn', onclick: exportCSV }, 'CSV')));
    const rows = res.filter(r => (!flt.rule || r.rule === flt.rule) && (!flt.status || (C.status[r.key]?.s || '신규') === flt.status));
    w.append(h('div', { class: 'tbl' }, table([
      { label: '#', render: r => res.indexOf(r) + 1 }, { label: '규칙', render: r => h('span', { class: 'note' }, RULES[r.rule]) },
      { label: '중요도', render: r => h('span', { class: 'pill ' + (r.sev === '높음' ? 'bad' : r.sev === '중간' ? 'warn' : '') }, r.sev) },
      { label: '내용', key: 'msg' }, { label: '도면', render: r => h('span', { class: 'note' }, P.sheets.find(s => s.id === r.sheet)?.name || '') },
      { label: '상태', render: r => { const s = h('select', { onclick: e => e.stopPropagation() }); for (const x of STATUS) s.append(h('option', { selected: (C.status[r.key]?.s || '신규') === x }, x)); s.onchange = () => { C.status[r.key] = { s: s.value, at: Date.now() }; C.last.open = res.filter(q => !['해결', '승인(무시)'].includes(C.status[q.key]?.s)).length; ctx.touch('meta'); }; return s; } },
      { label: '', render: r => h('div', { class: 'row' }, r.pts?.length ? h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); ctx.state.hi = { ids: r.ids, pts: r.pts, sheet: r.sheet, level: r.level, label: r.msg }; ctx.go('cad'); } }, '작도에서 보기') : null, h('button', { class: 'btn sm', onclick: async (e) => { e.stopPropagation(); const { addIssue } = await import('./issue.js'); const it = addIssue(P, { type: '정합', title: r.msg.length > 60 ? r.msg.slice(0, 60) + '…' : r.msg, desc: `[${RULES[r.rule]}] ${r.msg}`, src: 'check::' + r.key, refs: { ids: r.ids, pts: r.pts, sheet: r.sheet, level: r.level, where: P.sheets.find(s => s.id === r.sheet)?.name || '' } }); ctx.touch('meta'); toast(it ? `이슈 #${it.no} 등록` : '이미 등록된 지적입니다', it ? 'ok' : 'info'); } }, '이슈')) },
    ], rows)));
    if (!res.length) w.append(h('div', { class: 'empty' }, '불일치가 없습니다.'));
  }
  async function aiReview() {
    const sample = await getSample(); if (!sample) return toast('이 화면에서는 Claude 호출을 쓸 수 없습니다', 'err');
    if (!res) res = runCheck(P, { tol: C.tol ?? 10 });
    const inv = P.sheets.map(s => { const c = P.content[s.id]; const k = {}; for (const e of c.els) k[e.k] = (k[e.k] || 0) + 1; return { sheet: s.name, disc: s.disc, level: levelOf(P, s.level).name, elements: k, grids: c.ents.filter(e => e.t === 'grid').map(e => e.label).join(','), dims: c.ents.filter(e => e.t === 'dim').length }; });
    const prompt = `당신은 한국 건설사업관리(CM) 도면 검토 전문가입니다. 아래는 BIM-CAD 프로젝트의 도면 목록과 규칙 기반 정합 검토 결과입니다.
1) 가장 중요한 지적 3~5개를 우선순위로 정리하고 각각 설계사에 보낼 질의(RFI) 문장을 1줄씩, 2) 규칙 검토가 놓쳤을 가능성이 있는 추가 확인 항목을 3개 이내로 제안하세요. 한국어, 간결하게, 마크다운 기호 없이 번호 목록으로.
층: ${JSON.stringify(P.levels)}
도면: ${JSON.stringify(inv)}
지적(${res.length}건): ${JSON.stringify(res.slice(0, 60).map(r => ({ rule: RULES[r.rule], sev: r.sev, msg: r.msg })))}`;
    ai = '검토 중…'; render();
    try { const r = await sample(prompt, { modelTier: 'default', onText: ({ text }) => { ai = text; const d = w.querySelector('.card .d'); if (d) d.textContent = text; } }); ai = r.text; render(); }
    catch (e) { ai = null; render(); toast('AI 검토 실패: ' + (e.message || e.code), 'err'); }
  }
  function exportCSV() {
    const out = [['#', '규칙', '중요도', '내용', '도면', '상태']]; res.forEach((r, i) => out.push([i + 1, RULES[r.rule], r.sev, r.msg, P.sheets.find(s => s.id === r.sheet)?.name || '', C.status[r.key]?.s || '신규']));
    saveFile(`${P.name}_도면정합.csv`.replace(/[\\/:*?"<>|]/g, '_'), csv(out));
  }
  render();
  return { unmount() { } };
}
