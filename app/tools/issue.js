// 빌더 이슈 — RFI·간섭·정합·품질·안전 이슈 통합 관리
import { h, toast, dialog, confirmBox, saveFile, table, getSample, pickFile } from '../js/ui.js';
import { elName, levelOf, gridRef } from '../js/model.js';
import { uid, fmt0, csv, esc } from '../js/util.js';

export const TYPES = ['RFI', '간섭', '정합', '품질', '안전', '설계변경', '일반'];
export const STATES = ['열림', '답변대기', '조치중', '완료'];
const today = () => new Date().toISOString().slice(0, 10);

// 다른 툴에서 이슈 등록
export function addIssue(P, o) {
  P.issues ||= []; const no = (P.issues.reduce((m, i) => Math.max(m, i.no || 0), 0)) + 1;
  const it = { id: uid('i'), no, type: o.type || '일반', title: o.title || '', desc: o.desc || '', status: '열림', assignee: o.assignee || '', due: o.due || '', created: Date.now(), refs: o.refs || null, src: o.src || null, comments: [] };
  if (o.src && P.issues.some(i => i.src === o.src)) return null; // 중복 방지
  P.issues.push(it); return it;
}

export function mount(root, ctx) {
  const P = ctx.P; P.issues ||= [];
  const st = { type: '', status: '', q: '', sel: null };
  const page = h('div', { class: 'page' }); const w = h('div', { class: 'wrap' }); page.append(w); root.append(page);
  const save = () => ctx.touch('meta');
  const overdue = (i) => i.due && i.status !== '완료' && i.due < today();

  function render() {
    w.innerHTML = '';
    w.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('div', {}, h('h1', {}, '이슈·RFI'), h('div', { class: 'sub' }, '간섭·정합에서 찾은 문제와 현장 질의를 한 곳에서 담당자·기한·상태로 관리합니다. 각 이슈는 도면 위치와 연결됩니다.')),
      h('div', { class: 'row' }, h('button', { class: 'btn', title: 'BIMcollab·Revit·Navisworks·Solibri 등에서 내보낸 .bcfzip', onclick: importBCF }, 'BCF 가져오기'), h('button', { class: 'btn', onclick: () => exportBCF(P.issues.filter(i => i.status !== '완료')) }, 'BCF 내보내기'), h('button', { class: 'btn', onclick: importAll }, '간섭·정합 미해결 가져오기'), h('button', { class: 'btn primary', onclick: newIssue }, '+ 이슈'))));
    const cnt = (f) => P.issues.filter(f).length;
    w.append(h('div', { class: 'cards', style: { margin: '14px 0' } }, ...[['전체', cnt(() => true)], ['열림', cnt(i => i.status !== '완료')], ['기한 초과', cnt(overdue)], ['완료', cnt(i => i.status === '완료')]].map(([t, v], k) => h('div', { class: 'card' }, h('div', { class: 'note' }, t), h('div', { class: 'mono', style: { fontSize: '20px', fontWeight: 600, color: k === 2 && v ? 'var(--bad)' : 'var(--fg)' } }, v)))));
    const sel = (label, key, opts) => { const s = h('select'); s.append(h('option', { value: '' }, label)); for (const o of opts) s.append(h('option', { value: o, selected: st[key] === o }, o)); s.onchange = () => { st[key] = s.value; render(); }; return s; };
    const q = h('input', { placeholder: '검색 (제목·담당·내용)', value: st.q }); q.onchange = () => { st.q = q.value; render(); };
    w.append(h('div', { class: 'row', style: { marginBottom: '8px' } }, sel('전체 유형', 'type', TYPES), sel('전체 상태', 'status', STATES), q,
      h('button', { class: 'btn', onclick: exportCSV }, 'CSV'), h('button', { class: 'btn', onclick: () => exportRFI(P.issues.filter(i => i.type === 'RFI' && i.status !== '완료')) }, '미결 RFI 문서(HTML)')));
    const rows = P.issues.filter(i => (!st.type || i.type === st.type) && (!st.status || i.status === st.status) && (!st.q || (i.title + i.assignee + i.desc).includes(st.q))).sort((a, b) => (a.status === '완료') - (b.status === '완료') || b.no - a.no);
    if (!rows.length) w.append(h('div', { class: 'empty' }, '이슈가 없습니다. 간섭·정합 툴의 "이슈 등록" 또는 위 버튼으로 추가하세요.'));
    else w.append(h('div', { class: 'tbl' }, table([
      { label: 'No', render: i => '#' + i.no }, { label: '유형', render: i => h('span', { class: 'pill ' + (i.type === '간섭' ? 'bad' : i.type === 'RFI' ? 'acc' : i.type === '안전' ? 'warn' : '') }, i.type) },
      { label: '제목', render: i => h('div', {}, i.title, i.refs?.where ? h('div', { class: 'note mono' }, i.refs.where) : null) }, { label: '담당', key: 'assignee' },
      { label: '기한', render: i => h('span', { class: overdue(i) ? 'pill bad' : '' }, i.due || '-') },
      { label: '상태', render: i => { const s = h('select', { onclick: e => e.stopPropagation() }); for (const x of STATES) s.append(h('option', { selected: i.status === x }, x)); s.onchange = () => { i.status = s.value; if (s.value === '완료') i.closed ||= Date.now(); else delete i.closed; i.comments.push({ at: Date.now(), text: `상태 → ${s.value}` }); syncBack(i); save(); render(); }; return s; } },
      { label: '댓글', num: true, render: i => i.comments.filter(c => !c.text.startsWith('상태 →')).length },
    ], rows, { onRow: (i) => { st.sel = st.sel === i.id ? null : i.id; render(); }, rowClass: i => st.sel === i.id ? 'sel' : '' })));
    const cur = P.issues.find(i => i.id === st.sel); if (cur) renderDetail(cur);
  }
  function renderDetail(i) {
    const card = h('div', { class: 'card', style: { marginTop: '12px' } }); w.append(card);
    const fld = (label, el) => h('label', { style: { display: 'flex', flexDirection: 'column', gap: '3px', flex: '1 1 160px' } }, h('span', { class: 'note' }, label), el);
    const title = h('input', { value: i.title }); title.onchange = () => { i.title = title.value; save(); };
    const ty = h('select'); for (const t of TYPES) ty.append(h('option', { selected: i.type === t }, t)); ty.onchange = () => { i.type = ty.value; save(); render(); };
    const as = h('input', { value: i.assignee, placeholder: '예: 설계사 구조팀' }); as.onchange = () => { i.assignee = as.value; save(); };
    const du = h('input', { type: 'date', value: i.due }); du.onchange = () => { i.due = du.value; save(); render(); };
    const ds = h('textarea', { rows: 4, style: { width: '100%' } }); ds.value = i.desc; ds.onchange = () => { i.desc = ds.value; save(); };
    card.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('div', { class: 't' }, `#${i.no} ${i.title}`), h('div', { class: 'row' },
      i.refs?.pts?.length || i.refs?.ids?.length ? h('button', { class: 'btn sm', onclick: () => { ctx.state.hi = { ...i.refs, label: `#${i.no} ${i.title}` }; ctx.go('cad'); } }, '도면 위치') : null,
      i.refs?.ids?.length || i.refs?.cam ? h('button', { class: 'btn sm', onclick: () => { ctx.state.hi = { ...i.refs, label: `#${i.no} ${i.title}` }; ctx.go('view3d'); } }, i.refs?.cam ? '3D 시점' : '3D 위치') : null,
      h('button', { class: 'btn sm', onclick: () => polish(i) }, 'AI로 RFI 문장 정리'), h('button', { class: 'btn sm', onclick: () => exportRFI([i]) }, 'RFI 문서'),
      h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmBox('이슈 삭제', `#${i.no}을(를) 삭제합니다.`, '삭제', true)) { P.issues = P.issues.filter(x => x !== i); st.sel = null; save(); render(); } } }, '삭제'))));
    card.append(h('div', { class: 'row', style: { marginTop: '8px', alignItems: 'flex-end' } }, fld('제목', title), fld('유형', ty), fld('담당', as), fld('기한', du)), h('div', { style: { marginTop: '8px' } }, h('span', { class: 'note' }, '내용'), ds));
    if (i.snap) { const im = h('img', { style: { maxWidth: '100%', maxHeight: '320px', borderRadius: '6px', marginTop: '8px', display: 'block', background: '#fff' } }); card.append(im); ctx.store.getBlob(i.snap).then(b => { if (b?.d) im.src = b.d; }); }
    if (i.bcf) card.append(h('div', { class: 'note', style: { marginTop: '4px' } }, `BCF 토픽 ${i.bcf.guid}${i.bcf.author ? ' · 작성 ' + i.bcf.author : ''}${i.bcf.status ? ' · 원본 상태 ' + i.bcf.status : ''}${i.bcf.labels ? ' · ' + i.bcf.labels : ''}`));
    const cm = h('div', { style: { marginTop: '10px' } }); card.append(cm);
    for (const c of i.comments) cm.append(h('div', { class: 'note', style: { padding: '4px 0', borderBottom: '1px solid var(--line)' } }, `${new Date(c.at).toLocaleString('ko-KR')} — `, h('span', { style: { color: 'var(--fg)' } }, c.text)));
    const ci = h('input', { placeholder: '답변·조치 내용 기록', style: { flex: 1 } });
    cm.append(h('div', { class: 'row', style: { marginTop: '6px' } }, ci, h('button', { class: 'btn sm', onclick: () => { if (!ci.value.trim()) return; i.comments.push({ at: Date.now(), text: ci.value.trim() }); save(); render(); } }, '기록')));
  }
  // ---------- BCF 2.1 / 3.0 ----------
  async function importBCF() {
    const f = await pickFile('.bcfzip,.bcf,.zip'); if (!f) return;
    let files; try { const { unzip } = await import('../js/zip.js'); files = await unzip(await f.arrayBuffer()); } catch (e) { return toast('BCF 파일을 읽지 못했습니다: ' + e.message, 'err'); }
    const dec = new TextDecoder(); const X = (b) => new DOMParser().parseFromString(dec.decode(b), 'application/xml');
    const T = (n, tag) => n?.getElementsByTagName(tag)[0]?.textContent?.trim() || '';
    const topics = Object.keys(files).filter(k => /(^|\/)markup\.bcf$/i.test(k));
    if (!topics.length) return toast('BCF 토픽이 없습니다', 'err');
    const stMap = { open: '열림', 'in progress': '조치중', active: '조치중', resolved: '답변대기', closed: '완료', reopened: '열림' };
    const bx = P.base.x, by = P.base.y; let n = 0, upd = 0;
    for (const k of topics) {
      const dir = k.replace(/markup\.bcf$/i, ''); const doc = X(files[k]); const tp = doc.getElementsByTagName('Topic')[0]; if (!tp) continue;
      const guid = tp.getAttribute('Guid') || dir.replace(/\/$/, ''); const status = tp.getAttribute('TopicStatus') || T(tp, 'TopicStatus');
      const comments = [...doc.getElementsByTagName('Comment')].filter(c => c.parentNode === doc.documentElement || c.parentNode?.tagName === 'Comments').map(c => ({ at: Date.parse(T(c, 'Date')) || Date.now(), text: `${T(c, 'Author') ? T(c, 'Author') + ': ' : ''}${T(c, 'Comment')}` })).filter(c => c.text.trim());
      // 시점
      const vpName = T(doc.getElementsByTagName('Viewpoints')[0], 'Viewpoint') || 'viewpoint.bcfv'; const snapName = T(doc.getElementsByTagName('Viewpoints')[0], 'Snapshot') || 'snapshot.png';
      let cam = null, ids = []; const vb = files[dir + vpName]; if (vb) { const v = X(vb); const pc = v.getElementsByTagName('PerspectiveCamera')[0] || v.getElementsByTagName('OrthogonalCamera')[0]; if (pc) { const V3 = (tag) => { const n2 = pc.getElementsByTagName(tag)[0]; return [+T(n2, 'X'), +T(n2, 'Y'), +T(n2, 'Z')]; }; const p = V3('CameraViewPoint'), d = V3('CameraDirection'); const to3 = (q) => [q[0] - bx / 1000, q[2], -(q[1] - by / 1000)]; const P3 = to3(p), D3 = [d[0], d[2], -d[1]]; cam = { pos: P3, tgt: [P3[0] + D3[0] * 10, P3[1] + D3[1] * 10, P3[2] + D3[2] * 10] }; }
        const all = new Set(); for (const sh of P.sheets) for (const e of P.content[sh.id]?.els || []) all.add(e.id); ids = [...v.getElementsByTagName('Component')].map(c => c.getAttribute('AuthoringToolId') || c.getAttribute('IfcGuid')).filter(x => x && all.has(x)); }
      const exist = P.issues.find(x => x.bcf?.guid === guid);
      const it = exist || addIssue(P, { type: /clash|간섭/i.test(tp.getAttribute('TopicType') || '') ? '간섭' : /request|rfi/i.test(tp.getAttribute('TopicType') || '') ? 'RFI' : '일반', title: T(tp, 'Title'), desc: T(tp, 'Description'), assignee: T(tp, 'AssignedTo'), due: (T(tp, 'DueDate') || '').slice(0, 10), refs: cam || ids.length ? { ids, cam, label: T(tp, 'Title') } : null });
      if (!it) continue; if (exist) { upd++; it.title = T(tp, 'Title') || it.title; it.desc = T(tp, 'Description') || it.desc; } else n++;
      it.status = stMap[(status || '').toLowerCase()] || it.status; it.bcf = { guid, author: T(tp, 'CreationAuthor'), status, labels: [...tp.getElementsByTagName('Labels')].map(x => x.textContent).join(', '), priority: T(tp, 'Priority') };
      const have = new Set(it.comments.map(c => c.text)); for (const c of comments) if (!have.has(c.text)) it.comments.push(c);
      const sb = files[dir + snapName]; if (sb) { const key = `bs_${P.id}_${it.id}`; let bin = ''; for (let j = 0; j < sb.length; j += 0x8000) bin += String.fromCharCode.apply(null, sb.subarray(j, j + 0x8000)); await ctx.store.putBlob(key, { d: `data:image/${/\.jpe?g$/i.test(snapName) ? 'jpeg' : 'png'};base64,` + btoa(bin) }); it.snap = key; }
    }
    save(); render(); toast(`BCF 토픽 ${n}개 추가${upd ? `, ${upd}개 갱신` : ''}`, 'ok');
  }
  async function exportBCF(list) {
    if (!list.length) return toast('내보낼 이슈가 없습니다');
    const { zip } = await import('../js/zip.js'); const xe = (s) => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
    const guid = () => crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
    const files = [{ name: 'bcf.version', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Version VersionId="2.1"><DetailedVersion>2.1</DetailedVersion></Version>' }];
    const stR = { '열림': 'Open', '답변대기': 'Open', '조치중': 'In Progress', '완료': 'Closed' }; const bx = P.base.x, by = P.base.y;
    for (const i of list) {
      const tg = (i.bcf ||= { guid: guid() }).guid; const vg = guid(); let vp = '';
      const cmts = i.comments.filter(c => !c.text.startsWith('상태 →')).map(c => `<Comment Guid="${guid()}"><Date>${new Date(c.at).toISOString()}</Date><Author>Builder</Author><Comment>${xe(c.text)}</Comment></Comment>`).join('');
      let pos = null, tgt = null; if (i.refs?.cam) { const t3 = (q) => [q[0] + bx / 1000, -q[2] + by / 1000, q[1]]; pos = t3(i.refs.cam.pos); tgt = t3(i.refs.cam.tgt); } else if (i.refs?.pts3?.[0] || i.refs?.pts?.[0]) { const p = i.refs.pts3?.[0] || [...i.refs.pts[0], 1500]; tgt = [p[0] / 1000, p[1] / 1000, p[2] / 1000]; pos = [tgt[0] - 7, tgt[1] - 9, tgt[2] + 10]; }
      if (pos) { const d = [tgt[0] - pos[0], tgt[1] - pos[1], tgt[2] - pos[2]]; const l = Math.hypot(...d) || 1; const D = d.map(x => x / l); const up = [-D[0] * D[2], -D[1] * D[2], 1 - D[2] * D[2]]; const ul = Math.hypot(...up) || 1; const f3 = (a) => `<X>${a[0].toFixed(3)}</X><Y>${a[1].toFixed(3)}</Y><Z>${a[2].toFixed(3)}</Z>`;
        files.push({ name: `${tg}/viewpoint.bcfv`, data: `<?xml version="1.0" encoding="UTF-8"?>\n<VisualizationInfo Guid="${vg}"><Components><Selection>${(i.refs.ids || []).map(id => `<Component IfcGuid="${xe(id)}" AuthoringToolId="${xe(id)}" />`).join('')}</Selection><Visibility DefaultVisibility="true" /></Components><PerspectiveCamera><CameraViewPoint>${f3(pos)}</CameraViewPoint><CameraDirection>${f3(D)}</CameraDirection><CameraUpVector>${f3(up.map(x => x / ul))}</CameraUpVector><FieldOfView>60</FieldOfView></PerspectiveCamera></VisualizationInfo>` }); vp = `<Viewpoints Guid="${vg}"><Viewpoint>viewpoint.bcfv</Viewpoint>${i.snap ? '<Snapshot>snapshot.png</Snapshot>' : ''}</Viewpoints>`; }
      if (i.snap) { const b = await ctx.store.getBlob(i.snap); const m = b?.d?.match(/^data:image\/png;base64,(.*)$/); if (m) { const bin = atob(m[1]); const u = new Uint8Array(bin.length); for (let j = 0; j < bin.length; j++) u[j] = bin.charCodeAt(j); files.push({ name: `${tg}/snapshot.png`, data: u }); } else if (vp) vp = vp.replace('<Snapshot>snapshot.png</Snapshot>', ''); }
      files.push({ name: `${tg}/markup.bcf`, data: `<?xml version="1.0" encoding="UTF-8"?>\n<Markup><Topic Guid="${tg}" TopicType="${i.type === '간섭' ? 'Clash' : i.type === 'RFI' ? 'Request' : 'Issue'}" TopicStatus="${stR[i.status] || 'Open'}"><Title>${xe(`#${i.no} ${i.title}`)}</Title><Labels>${xe(i.type)}</Labels><CreationDate>${new Date(i.created).toISOString()}</CreationDate><CreationAuthor>Builder</CreationAuthor>${i.assignee ? `<AssignedTo>${xe(i.assignee)}</AssignedTo>` : ''}${i.due ? `<DueDate>${i.due}T00:00:00Z</DueDate>` : ''}<Description>${xe(i.desc)}</Description></Topic>${cmts}${vp}</Markup>` });
    }
    save(); saveFile(`${P.name}_이슈.bcfzip`.replace(/[\\/:*?"<>|]/g, '_'), zip(files)); toast(`BCF 토픽 ${list.length}개`, 'ok');
  }
  // 간섭·정합 상태와 동기화
  function syncBack(i) {
    if (!i.src) return; const [kind, ...rest] = i.src.split('::'); const key = rest.join('::'); const map = { '완료': '해결', '조치중': '검토중', '답변대기': '검토중', '열림': '신규' };
    if (kind === 'clash') { P.clash.status[key] = { ...(P.clash.status[key] || {}), s: map[i.status], at: Date.now() }; }
    if (kind === 'check') { P.check.status[key] = { s: map[i.status], at: Date.now() }; }
  }
  async function importAll() {
    const [{ runClash }, { runCheck, RULES }] = await Promise.all([import('./clash.js'), import('./check.js')]);
    let n = 0;
    for (const r of runClash(P, { sets: P.clash.sets, tol: P.clash.tol, clearance: P.clash.clearance, cover: P.clash.cover })) {
      if (['해결', '승인(무시)'].includes(P.clash.status[r.key]?.s)) continue;
      const it = addIssue(P, { type: '간섭', title: `${r.setName}: ${r.a.el.tag || elName(r.a.el)} ↔ ${r.b.el.sys || r.b.el.tag || elName(r.b.el)}`, desc: `${r.level.name} ${r.grid} / ${r.kind === 'hard' ? '관통 ' + fmt0(r.depth) : '간격 ' + fmt0(-r.depth)}mm\n${r.note}`, src: 'clash::' + r.key, refs: { ids: [r.a.el.id, r.b.el.id], pts: [r.pt], pts3: [[r.pt[0], r.pt[1], r.z]], level: r.level.id, where: `${r.level.name} ${r.grid}` } }); if (it) n++;
    }
    for (const r of runCheck(P, { tol: P.check.tol ?? 10, revs: false })) {
      if (['해결', '승인(무시)'].includes(P.check.status[r.key]?.s)) continue;
      const lvId = r.level || P.sheets.find(s => s.id === r.sheet)?.level;
      const it = addIssue(P, { type: '정합', title: r.msg.length > 60 ? r.msg.slice(0, 60) + '…' : r.msg, desc: `[${RULES[r.rule]}] ${r.msg}`, src: 'check::' + r.key, refs: { ids: r.ids, pts: r.pts, sheet: r.sheet, level: lvId, where: r.pts?.[0] && lvId ? `${levelOf(P, lvId).name} ${gridRef(P, lvId, r.pts[0])}` : '' } }); if (it) n++;
    }
    save(); render(); toast(`${n}건 새로 등록 (중복 제외)`, 'ok');
  }
  async function newIssue() {
    const v = await dialog({ title: '이슈 등록', fields: [{ key: 'type', label: '유형', type: 'select', options: TYPES, value: 'RFI' }, { key: 'title', label: '제목' }, { key: 'desc', label: '내용', type: 'textarea' }, { key: 'assignee', label: '담당' }, { key: 'due', label: '기한', type: 'date', value: '' }] });
    if (!v?.title) return; const it = addIssue(P, v); st.sel = it.id; save(); render();
  }
  async function polish(i) {
    const sample = await getSample(); if (!sample) return toast('이 화면에서는 Claude 호출을 쓸 수 없습니다', 'err');
    toast('정리 중…');
    try {
      const r = await sample(`한국 건설사업관리(CM) 실무 RFI(설계 질의서) 문체로 아래 이슈를 정리하세요. 형식: "제목: …" 한 줄, 빈 줄, "질의 내용:" 2~4문장(현황, 문제, 근거), "요청 사항:" 1~2문장. 추측은 '확인 요청'으로 표현. 마크다운 금지.\n유형: ${i.type}\n위치: ${i.refs?.where || ''}\n제목: ${i.title}\n내용: ${i.desc}`, { modelTier: 'default' });
      const t = r.text.trim(); const m = t.match(/^제목\s*:\s*(.+)$/m); if (m) i.title = m[1].trim(); i.desc = t.replace(/^제목\s*:.*\n?/m, '').trim(); i.type = i.type === '일반' ? 'RFI' : i.type; save(); render(); toast('정리했습니다', 'ok');
    } catch (e) { toast('실패: ' + (e.message || e.code), 'err'); }
  }
  function exportCSV() { saveFile(`${P.name}_이슈.csv`.replace(/[\\/:*?"<>|]/g, '_'), csv([['No', '유형', '제목', '위치', '담당', '기한', '상태', '등록일', '내용', '기록'], ...P.issues.map(i => [i.no, i.type, i.title, i.refs?.where || '', i.assignee, i.due, i.status, new Date(i.created).toLocaleDateString('ko-KR'), i.desc, i.comments.map(c => c.text).join(' / ')])])); }
  function exportRFI(list) {
    if (!list.length) return toast('내보낼 RFI가 없습니다');
    const body = list.map(i => `<div class="rfi"><table><tr><th>문서번호</th><td>RFI-${String(i.no).padStart(3, '0')}</td><th>작성일</th><td>${new Date(i.created).toLocaleDateString('ko-KR')}</td></tr><tr><th>프로젝트</th><td>${esc(P.name)}</td><th>회신 기한</th><td>${esc(i.due || '')}</td></tr><tr><th>수신</th><td>${esc(i.assignee || '')}</td><th>위치</th><td>${esc(i.refs?.where || '')}</td></tr><tr><th>제목</th><td colspan="3"><b>${esc(i.title)}</b></td></tr><tr><th>내용</th><td colspan="3" style="white-space:pre-wrap;height:160px;vertical-align:top">${esc(i.desc)}</td></tr><tr><th>회신</th><td colspan="3" style="height:120px"></td></tr></table></div>`).join('');
    saveFile(`${P.name}_RFI.html`.replace(/[\\/:*?"<>|]/g, '_'), `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>RFI</title><style>body{font-family:'Malgun Gothic',sans-serif;margin:24px}h1{font-size:20px;text-align:center}.rfi{page-break-after:always;margin-bottom:30px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #444;padding:6px}th{background:#eef;width:90px}</style></head><body><h1>설계 질의서 (RFI)</h1>${body}</body></html>`);
  }
  render();
  return { unmount() { } };
}
