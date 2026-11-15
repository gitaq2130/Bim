// 빌더 통합 서비스: 프로젝트 관리 + 툴 연동
import { createStore } from './store.js';
import { BOQ_ADDED, DEFAULT_BOQ } from './model.js';
import { newProject, sampleProject, DISC, allElements, takeoff, sumBy, billReview, levelOf } from './model.js';
import { h, $, toast, dialog, confirmBox, pickFile, readText, saveFile, table, approvalCell } from './ui.js';
import { uid, deep, createBus, fmt, fmt0, esc } from './util.js';
import { createRev, deleteRev, restoreRev, nextRev, revName } from './rev.js';
import { elName as elNm } from './model.js';

const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const ICONS = {
  hub: I('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  cad: I('<path d="M3 21l6-6"/><path d="M14 4l6 6-9 9H5v-6z"/><path d="M12 6l6 6"/>'),
  view3d: I('<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 22V12"/><path d="M21 7l-9 5-9-5"/>'),
  qto: I('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>'),
  bill: I('<path d="M12 2v20"/><path d="M17 6H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>'),
  clash: I('<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>'),
  check: I('<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>'),
  sched: I('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M7 13h5M10 17h7"/>'),
  issue: I('<path d="M4 22V3"/><path d="M4 4h13l-2 4 2 4H4"/>'),
  code: I('<path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M9 21v-6h6v6"/><path d="M3 8h4M17 8h4"/>'),
  struct: I('<path d="M4 20h16"/><path d="M6 20V6h12v14"/><path d="M6 11h12M6 6l12 5M18 6L6 11"/>'),
  daily: I('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2h6v4H9z"/><path d="M8 11h8M8 15h5"/>'),
  mep: I('<path d="M3 7h10a3 3 0 013 3v11"/><path d="M3 12h6a2 2 0 012 2v7"/><circle cx="19" cy="5" r="2"/><path d="M19 7v3"/>'),
  interior: I('<path d="M9 2h6l2 6H7z"/><path d="M12 8v3"/><path d="M8 15l-2 6M16 15l2 6"/><path d="M5 15h14"/>'),
  civil: I('<path d="M2 20h20"/><path d="M2 20l6-8 4 4 3-5 7 9"/><path d="M8 12v8M15 11v9" stroke-dasharray="2 2"/>'),
  landscape: I('<path d="M12 22v-7"/><path d="M12 15c-4 0-6-3-6-6a6 6 0 0112 0c0 3-2 6-6 6z"/><path d="M4 22h16"/><path d="M5 22c0-2 1-3 2.5-3S10 20 10 22"/>'),
  site: I('<path d="M3 8a2 2 0 012-2h2l2-2h6l2 2h2a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><circle cx="12" cy="13" r="3.5"/>'),
};
export const PHASES = [{ id: 'plan', name: '기획·대지' }, { id: 'design', name: '설계' }, { id: 'review', name: '설계검토' }, { id: 'est', name: '적산·공정' }, { id: 'build', name: '시공·관리' }];
// 빌딩 라이프사이클 순서: 기획·대지 → 설계 → 설계검토 → 적산·공정 → 시공·관리
export const TOOLS = [
  // 기획·대지
  { id: 'code', phase: 'plan', name: '법규', full: '건축개요·법규', color: '#c3a6ff', desc: '모델에서 대지·건축·연면적을 계산해 건폐율·용적률·높이·정북일조를 검토하고 건축개요를 만듭니다.', load: () => import('../tools/code.js') },
  { id: 'civil', phase: 'plan', name: '토목', full: '토목(지형·토공·배수)', color: '#c9a36a', desc: '측점으로 지형(TIN·등고선)을 만들고 계획고(균형고)로 정지할 때 절·성토량, 터파기, 잔토 운반, 우수 유출량·우수관 관경을 산정합니다.', load: () => import('../tools/civil.js') },
  // 설계
  { id: 'cad', phase: 'design', name: '작도', full: '빌더 CAD', color: '#4ea1ff', desc: 'AutoCAD식 명령·단축키로 작도하고 치수를 잽니다. 벽·기둥·보 등 객체로 그려 다른 툴과 연결됩니다.', load: () => import('../tools/cad.js') },
  { id: 'view3d', phase: 'design', name: '3D', full: '3D 뷰어', color: '#a78bfa', desc: '기준점과 층고로 도면을 3D로 올리고, 재질·태양 위치를 바꿔 외관·실내를 검토합니다.', load: () => import('../tools/view3d.js') },
  { id: 'struct', phase: 'design', name: '구조', full: '구조해석·설계', color: '#ff9e64', desc: '기둥·보·RC벽으로 3D 골조 해석 모델을 만들어 고정·활·풍·지진하중(KDS)으로 해석하고 부재 검토비·층간변위를 확인합니다.', load: () => import('../tools/struct.js') },
  { id: 'mep', phase: 'design', name: 'MEP', full: '설비·전기·소방', color: '#73daca', desc: '덕트·배관·트레이·스프링클러·분전반을 계통으로 묶어 경로·높이를 배분하고, 공종별 사이즈·부하·헤드 배치를 검토합니다.', load: () => import('../tools/mep.js') },
  { id: 'interior', phase: 'design', name: '실내', full: '인테리어·조명', color: '#d4a5ff', desc: '실(방)별 마감·천장·가구를 정리하고, 조명기구 배치로 평균 조도를 계산해 목표 조도와 비교합니다.', load: () => import('../tools/interior.js') },
  { id: 'landscape', phase: 'design', name: '조경', full: '조경·식재', color: '#6cc070', desc: '녹지를 산정해 법정 조경면적·식재 기준(교목·관목·상록·향토)을 검토하고, 자동 식재 계획과 수목 일람표·공사비·탄소흡수를 만듭니다.', load: () => import('../tools/landscape.js') },
  // 설계검토
  { id: 'clash', phase: 'review', name: '간섭', full: '간섭검토', color: '#ef5f5f', desc: '구조·기계·전기·배관 공종 간 충돌과 여유공간, 철근-철골 간섭을 찾습니다.', load: () => import('../tools/clash.js') },
  { id: 'check', phase: 'review', name: '정합', full: '도면정합', color: '#7dcfff', desc: '건축·구조 도면 간 기둥·그리드·벽체 불일치, 치수 수정, 중복 객체, 리비전 변경을 검토합니다.', load: () => import('../tools/check.js') },
  // 적산·공정
  { id: 'qto', phase: 'est', name: '물량', full: '물량산출', color: '#3fbf7f', desc: '객체에서 콘크리트·거푸집·철근·철골·마감 물량을 자동 산출하고 내역 단가를 연결합니다.', load: () => import('../tools/qto.js') },
  { id: 'sched', phase: 'est', name: '공정', full: '공정(4D)', color: '#9ece6a', desc: '공정표를 모델 객체에 연결해 3D로 시공 순서를 재생하고, 기성 계획률을 자동 계산합니다.', load: () => import('../tools/sched.js') },
  // 시공·관리
  { id: 'site', phase: 'build', name: '현장', full: '현장 사진', color: '#e6b450', desc: '현장 사진을 도면 위치·부재에 붙이고, 사진 기준(AI 보조)으로 시공 단계와 기성 진척을 판정합니다.', load: () => import('../tools/site.js') },
  { id: 'daily', phase: 'build', name: '일보', full: '작업일보', color: '#e0af68', desc: '날씨·인원·장비와 공정표 연동 금일/명일 작업, 그날의 이슈·사진으로 작업일보를 작성하고 출력합니다.', load: () => import('../tools/daily.js') },
  { id: 'bill', phase: 'build', name: '기성', full: '기성검토', color: '#e6b450', desc: '회차별 진척률을 입력하고 협력사 청구량과 모델 물량을 대비해 기성을 검토합니다.', load: () => import('../tools/bill.js') },
  { id: 'issue', phase: 'build', name: '이슈', full: '이슈·RFI', color: '#f7768e', desc: '간섭·정합 결과와 현장 질의를 담당·기한·상태로 관리하고 RFI 문서를 만듭니다.', load: () => import('../tools/issue.js') },
];

const store = createStore();
const bus = createBus();
const state = { P: null, sheet: null, sel: new Set(), hi: null, tool: null, mounted: null, projects: [] };
window.__builder = { store, state, bus }; // 디버그용

const ctx = {
  get P() { return state.P; }, store, bus, state,
  touch(what = 'meta') { if (state.P) store.touch(state.P, what); },
  go, refreshHeader,
  tools: TOOLS,
};

// ---------- 헤더 ----------
function renderNav() {
  const nav = $('#nav'); nav.innerHTML = '';
  const add = (id, name, icon) => nav.append(h('a', { href: '#' + id, class: state.tool === id ? 'on' : '', html: icon + `<span>${name}</span>`, title: name }));
  add('hub', '통합', ICONS.hub);
  if (state.P) { let ph = null; for (const t of TOOLS) { if (t.phase !== ph) { ph = t.phase; nav.append(h('span', { class: 'ph', title: PHASES.find(x => x.id === ph)?.name }, PHASES.find(x => x.id === ph)?.name)); } add(t.id, t.name, ICONS[t.id]); } }
}
function refreshHeader() { $('#projName').textContent = state.P ? '/ ' + state.P.name : ''; renderNav(); }
store.bus.on('status', (s) => {
  const el = $('#saveSt'); el.className = 'save-st ' + s.state;
  const where = store.kind === 'db' ? '계정 저장' : store.kind === 'local' ? '브라우저 저장' : '임시(저장 안 됨)';
  el.textContent = s.state === 'saving' ? (s.total ? `저장 중 ${s.done}/${s.total}` : '저장 중…') : s.state === 'loading' ? `불러오는 중 ${s.done}/${s.total}` : s.state === 'pending' ? '변경됨' : s.state === 'error' ? '저장 실패' : `${where} ✓`;
  if (s.state === 'error') toast('저장 실패: ' + (s.error?.message || s.error?.code || '알 수 없음'), 'err', 5000);
});
window.addEventListener('beforeunload', (e) => { if (store.hasPending() || saving) { store.flush(); e.preventDefault(); e.returnValue = '저장 중입니다'; } });
let saving = false;
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') store.flush(); });

// ---------- 라우팅 ----------
async function go(route, opts = {}) {
  if (opts.sheet) state.sheet = opts.sheet;
  if (opts.hi !== undefined) state.hi = opts.hi;
  if (location.hash.slice(1) !== route) { history.replaceState(null, '', '#' + route); }
  await mount(route);
}
window.addEventListener('hashchange', () => mount(location.hash.slice(1) || 'hub'));
$('#logo').addEventListener('click', () => go('hub'));

let mountSeq = 0;
async function mount(route) {
  const seq = ++mountSeq;
  const tool = TOOLS.find(t => t.id === route);
  if (tool && !state.P) route = 'hub';
  if (state.mounted?.unmount) { try { state.mounted.unmount(); } catch (e) { console.error(e); } }
  state.mounted = null; state.tool = tool ? tool.id : 'hub'; renderNav();
  const view = $('#view'); view.innerHTML = '';
  if (!tool) { renderHub(view); return; }
  view.append(h('div', { class: 'empty' }, `${tool.full} 불러오는 중…`));
  try {
    const mod = await tool.load(); if (seq !== mountSeq) return;
    view.innerHTML = ''; const root = h('div', { style: { height: '100%' } }); view.append(root);
    state.mounted = mod.mount(root, ctx) || {};
  } catch (e) {
    console.error(e); view.innerHTML = ''; view.append(h('div', { class: 'empty' }, `${tool.full}을(를) 불러오지 못했습니다: ${e.message}`));
  }
}

// ---------- 프로젝트 ----------
async function openProject(pid) {
  const t0 = Date.now(); const P = await store.load(pid); if (!P) { toast('프로젝트를 열 수 없습니다', 'err'); return; }
  if (P._missing) toast(`도면 ${P._missing}장의 데이터를 찾지 못했습니다 — 저장이 중간에 멈췄던 프로젝트일 수 있습니다. 샘플이라면 다시 만들어 주세요.`, 'err', 8000);
  delete P._missing; migrate(P); state.P = P; state.sheet = P.sheets[0]?.id; state.sel.clear(); state.hi = null;
  try { localStorage.setItem('bld:last', pid); } catch { }
  refreshHeader(); bus.emit('project', P);
}
function migrate(P) {
  P.issues ||= []; P.photos ||= []; P.sched ||= { acts: [] }; P.bill ||= { periods: [] }; P.clash ||= { status: {}, tol: 0, clearance: 50 }; P.check ||= { status: {} }; P.view ||= { mats: {} }; P.mep ||= { systems: [], calc: {} }; P.interior ||= { finishes: {}, lighting: { uf: 0.6, mf: 0.8 } }; P.civil ||= { pts: [], mode: 'balance', cell: 2000, I: 100, slope: 1 }; P.landscape ||= { areas: [], plan: [], auto: true };
  P.base ||= { x: 0, y: 0 }; P.site ||= { lat: 37.5665, lng: 126.978, tz: 9, north: 0 }; P.layers ||= [];
  for (const s of P.sheets) P.content[s.id] ||= { ents: [], els: [] };
  if (P.boq) for (const c of BOQ_ADDED) if (!P.boq.some(b => b.code === c)) P.boq.push({ ...DEFAULT_BOQ.find(b => b.code === c) });
}
async function createProject(P) {
  migrate(P);
  // 메모리에서 바로 열고, 저장은 뒤에서 진행 (큰 프로젝트도 즉시 사용 가능)
  store.setCurrent(P); state.P = P; state.sheet = P.sheets[0]?.id; state.sel.clear(); state.hi = null;
  try { localStorage.setItem('bld:last', P.id); } catch { }
  refreshHeader(); bus.emit('project', P); renderHub($('#view'));
  saving = true;
  try { await store.saveAll(P); state.projects = await store.list(); } finally { saving = false; }
  if (P.sheets.length > 12) toast(`저장 완료 — 도면 ${P.sheets.length}장`, 'ok');
}

// ---------- 허브 ----------
function renderHub(view) {
  view.innerHTML = '';
  const page = h('div', { class: 'page' }), w = h('div', { class: 'wrap' }); page.append(w); view.append(page);
  if (!state.P) return renderProjectList(w);
  renderDashboard(w);
}

async function renderProjectList(w) {
  w.append(h('h1', {}, '빌더'), h('div', { class: 'sub' }, '작도에서 3D·물량·기성·간섭·정합까지, 건축물의 일생을 하나의 프로젝트로 연결합니다.'));
  const bar = h('div', { class: 'row', style: { margin: '16px 0' } },
    h('button', { class: 'btn primary', onclick: async () => { const v = await dialog({ title: '새 프로젝트', fields: [{ key: 'name', label: '프로젝트 이름', value: '새 프로젝트' }] }); if (v?.name) createProject(newProject(v.name)); } }, '+ 새 프로젝트'),
    h('button', { class: 'btn', onclick: async () => { const P = sampleProject(); const { autoGenerate } = await import('../tools/sched.js'); P.sched = { acts: autoGenerate(P, '2026-10-01'), start: '2026-10-01' }; await createProject(P); await sampleRevs(); renderHub($('#view')); } }, '샘플 프로젝트 만들기'),
    h('button', { class: 'btn', onclick: async () => { const { sampleHouse } = await import('./house.js'); const P = sampleHouse(); const { autoGenerate } = await import('../tools/sched.js'); P.sched = { acts: autoGenerate(P, '2027-03-02'), start: '2027-03-02' }; await createProject(P); renderHub($('#view')); } }, '샘플: 2층 단독주택'),
    h('button', { class: 'btn', onclick: async () => { toast('50층 타워 생성 중… (객체 약 1만 2천 개)'); await new Promise(r => setTimeout(r, 50)); const { sampleTower } = await import('./tower.js'); const P = sampleTower(); const { autoGenerate } = await import('../tools/sched.js'); P.sched = { acts: autoGenerate(P, '2027-01-04'), start: '2027-01-04' }; await createProject(P); renderHub($('#view')); } }, '샘플: 50층 오피스 타워'),
    h('button', { class: 'btn', onclick: importJSON }, 'JSON 가져오기'),
    h('button', { class: 'btn', onclick: () => importIFC(true) }, 'IFC로 새 프로젝트'));
  w.append(bar);
  const where = store.kind === 'db' ? 'Claude 계정에 저장되어 다른 기기에서도 열립니다.' : store.kind === 'local' ? '이 브라우저에 저장됩니다. 다른 기기로 옮길 때는 JSON 내보내기를 쓰세요.' : '저장소를 쓸 수 없어 창을 닫으면 사라집니다. JSON으로 내보내 보관하세요.';
  w.append(h('div', { class: 'note', style: { marginBottom: '12px' } }, '저장 위치: ' + where));
  const list = h('div', { class: 'cards' }); w.append(list);
  state.projects = await store.list().catch(() => []);
  if (!state.projects.length) list.append(h('div', { class: 'card' }, h('div', { class: 't' }, '프로젝트가 없습니다'), h('div', { class: 'd' }, '새 프로젝트를 만들거나, 샘플 프로젝트로 전체 기능을 먼저 둘러보세요. 샘플에는 간섭·정합 오류가 일부러 들어 있습니다.')));
  for (const m of state.projects) {
    const card = h('div', { class: 'card click pcard' + (state.P?.id === m.id ? ' cur' : '') },
      h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', flexWrap: 'nowrap' } }, h('div', { class: 't' }, m.name),
        h('button', { class: 'btn sm pmore', title: '메뉴 (길게 누르기·우클릭)', onclick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); projMenu(m, r.right - 190, r.bottom + 4); } }, '⋯')),
      h('div', { class: 'd' }, `도면 ${m.sheets ?? '-'}장 · 수정 ${new Date(m.updated).toLocaleString('ko-KR')}${m.partial ? ' · ⚠ 저장이 끝나지 않음' : ''}`));
    let pressT = null, start = null, longFired = false;
    card.addEventListener('pointerdown', (e) => { if (e.button !== 0 || e.target.closest('.pmore')) return; longFired = false; start = [e.clientX, e.clientY]; card.classList.add('pressing'); pressT = setTimeout(() => { longFired = true; card.classList.remove('pressing'); try { navigator.vibrate?.(15); } catch { } projMenu(m, e.clientX, e.clientY); }, 520); });
    const cancelPress = () => { clearTimeout(pressT); pressT = null; card.classList.remove('pressing'); };
    card.addEventListener('pointermove', (e) => { if (start && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 10) cancelPress(); });
    card.addEventListener('pointerup', cancelPress); card.addEventListener('pointerleave', cancelPress); card.addEventListener('pointercancel', cancelPress);
    card.addEventListener('contextmenu', (e) => { e.preventDefault(); cancelPress(); if (!longFired) projMenu(m, e.clientX, e.clientY); });
    card.addEventListener('click', async (e) => { if (longFired) { longFired = false; return; } if (e.target.closest('.pmore')) return; await openProject(m.id); renderHub($('#view')); });
    list.append(card);
  }
}

// ---------- 프로젝트 메뉴 (길게 누르기 · 우클릭 · ⋯) ----------
function projMenu(m, x, y) {
  document.querySelector('.ctx')?.remove();
  const items = [
    ['열기', async () => { await openProject(m.id); renderHub($('#view')); }],
    ['이름 바꾸기', () => renameProject(m)],
    ['복제', () => duplicateProject(m)],
    ['JSON 내보내기', () => exportProject(m)],
    null,
    ['삭제', () => deleteProject(m), true],
  ];
  const menu = h('div', { class: 'ctx', style: { left: Math.max(6, Math.min(x, window.innerWidth - 200)) + 'px', top: Math.max(6, Math.min(y, window.innerHeight - 230)) + 'px' } }, h('div', { class: 'ctx-h' }, m.name));
  for (const it of items) { if (!it) { menu.append(h('hr')); continue; } menu.append(h('div', { class: it[2] ? 'danger' : '', onclick: () => { menu.remove(); it[1](); } }, it[0])); }
  document.body.append(menu);
  setTimeout(() => { const off = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); window.removeEventListener('pointerdown', off, true); } }; window.addEventListener('pointerdown', off, true); }, 0);
}
const fullProject = async (m) => (state.P?.id === m.id ? state.P : await store.load(m.id));
async function renameProject(m) {
  const v = await dialog({ title: '이름 바꾸기', fields: [{ key: 'name', label: '프로젝트 이름', value: m.name }], ok: '바꾸기' }); const name = v?.name?.trim(); if (!name || name === m.name) return;
  try { if (state.P?.id === m.id) { state.P.name = name; store.touch(state.P, 'meta'); await store.flush(); refreshHeader(); } else await store.rename(m.id, name); toast('이름을 바꿨습니다', 'ok'); }
  catch (e) { toast('이름을 바꾸지 못했습니다: ' + (e.message || e), 'err'); }
  renderHub($('#view'));
}
async function duplicateProject(m) {
  const v = await dialog({ title: '복제', fields: [{ key: 'name', label: '사본 이름', value: m.name + ' (사본)' }], ok: '복제' }); if (!v?.name) return;
  try {
    toast('복제 중…'); const src = await fullProject(m); const c = deep(src); c.id = uid('p'); c.name = v.name.trim(); c.created = Date.now();
    // 별도 저장된 데이터(리비전 스냅샷·현장 사진·PDF 언더레이·이슈 스냅샷)도 새 프로젝트 키로 복사
    const pairs = [];
    for (const r of c.prevs || []) pairs.push([`pr_${src.id}_${r.id}`, `pr_${c.id}_${r.id}`]);
    for (const ph of c.photos || []) { pairs.push([`ph_${src.id}_${ph.id}`, `ph_${c.id}_${ph.id}`]); pairs.push([`ph_${src.id}_${ph.id}t`, `ph_${c.id}_${ph.id}t`]); }
    for (const [sid, u] of Object.entries(c.underlays || {})) if (u?.key) { const nk = `ul_${c.id}_${sid}`; pairs.push([u.key, nk]); u.key = nk; }
    for (const i of c.issues || []) if (i.snap) { const nk = `bs_${c.id}_${i.id}`; pairs.push([i.snap, nk]); i.snap = nk; }
    for (const [a, b] of pairs) { const d = await store.getBlob(a).catch(() => null); if (d) await store.putBlob(b, d); }
    if (state.P && state.P.id !== src.id) store.setCurrent(state.P);
    await store.saveAll(c); toast(`'${c.name}' 을(를) 만들었습니다`, 'ok');
  } catch (e) { console.error(e); toast('복제하지 못했습니다: ' + (e.message || e), 'err'); }
  renderHub($('#view'));
}
async function exportProject(m) { try { const P = await fullProject(m); saveFile(`${P.name.replace(/[\\/:*?"<>|]/g, '_')}.json`, JSON.stringify(P)); } catch (e) { toast('내보내지 못했습니다: ' + (e.message || e), 'err'); } }
async function deleteProject(m) {
  if (!await confirmBox('프로젝트 삭제', `'${m.name}' 을(를) 삭제합니다. 도면·리비전·사진이 모두 지워지며 되돌릴 수 없습니다.`, '삭제', true)) return;
  try { await store.remove(m.id); if (state.P?.id === m.id) { state.P = null; try { localStorage.removeItem('bld:last'); } catch { } refreshHeader(); } toast('삭제했습니다'); }
  catch (e) { toast('삭제하지 못했습니다: ' + (e.message || e), 'err'); }
  renderHub($('#view'));
}

function toolStats(P, id, cache) {
  const els = cache.els;
  switch (id) {
    case 'cad': return [['도면', P.sheets.length], ['객체', els.length], ['요소', P.sheets.reduce((s, x) => s + (P.content[x.id]?.ents.length || 0), 0)]];
    case 'view3d': return [['층', P.levels.length], ['3D 객체', els.filter(r => r.el.k !== 'opening').length]];
    case 'qto': { const m = cache.sum; return [['콘크리트 m³', fmt(m.get('CON') || 0, 1)], ['철근 ton', fmt(m.get('RBR') || 0, 1)]]; }
    case 'bill': { const n = P.bill.periods.length; if (!n) return [['회차', 0]]; const rv = billReview(P, n - 1, cache.rows); const amt = rv.reduce((s, r) => s + r.cum * r.price, 0), tot = rv.reduce((s, r) => s + r.contract * r.price, 0); return [['회차', n], ['누계 기성률', tot ? fmt(amt / tot * 100, 1) + '%' : '-'], ['이상 항목', rv.filter(r => r.verdict === '초과청구' || r.verdict === '과소청구').length]]; }
    case 'clash': { const l = P.clash.last; return l ? [['간섭', l.count], ['미해결', l.open], ['검토일', new Date(l.at).toLocaleDateString('ko-KR')]] : [['간섭', '미실행']]; }
    case 'sched': { const a = P.sched?.acts || []; if (!a.length) return [['활동', 0]]; const s0 = a.reduce((m, x) => x.start < m ? x.start : m, a[0].start), e0 = a.reduce((m, x) => x.end > m ? x.end : m, a[0].end); return [['활동', a.length], ['착공', s0.slice(2)], ['완료', e0.slice(2)]]; }
    case 'site': { const ph = P.photos || []; return [['사진', ph.length], ['위치 지정', ph.filter(p => p.pt).length], ['기성 근거', P.bill.periods.reduce((s, p) => s + Object.keys(p.evidence || {}).length, 0)]]; }
    case 'issue': { const is = P.issues || []; const td = new Date().toISOString().slice(0, 10); return [['전체', is.length], ['열림', is.filter(i => i.status !== '완료').length], ['기한초과', is.filter(i => i.due && i.status !== '완료' && i.due < td).length]]; }
    case 'code': { const l = P.code?.last; return l ? [['건폐율', l.bcr != null ? fmt(l.bcr, 1) + '%' : '-'], ['용적률', l.far != null ? fmt(l.far, 1) + '%' : '-'], ['일조 부족', l.sunViol]] : [['검토', '미실행']]; }
    case 'struct': { const l = P.struct?.last; return l ? [['부재', l.members], ['NG', l.ng], ['최대비', fmt(l.max, 2)]] : [['해석', '미실행']]; }
    case 'daily': { const ks = Object.keys(P.daily || {}).sort(); if (!ks.length) return [['작성', 0]]; const k = ks[ks.length - 1]; const n = (P.daily[k].crew || []).reduce((s, c) => s + (+c.n || 0), 0); return [['작성', ks.length + '일'], ['최근', k.slice(5)], ['인원', n + '명']]; }
    case 'check': { const l = P.check.last; return l ? [['지적', l.count], ['미해결', l.open], ['검토일', new Date(l.at).toLocaleDateString('ko-KR')]] : [['지적', '미실행']]; }
    case 'mep': { const n = (k) => els.filter(r => r.el.k === k).length; return [['덕트·배관·트레이', n('duct') + n('pipe') + n('tray')], ['헤드', n('sprinkler')], ['분전반', n('panel')]]; }
    case 'civil': { const l = P.civil?.last; return l ? [['절토', fmt(l.cut, 0) + 'm³'], ['성토', fmt(l.fill, 0) + 'm³'], ['우수관', 'Ø' + l.D]] : [['측점', (P.civil?.pts || []).length]]; }
    case 'landscape': { const l = P.landscape?.last; return l ? [['조경', fmt(l.credit, 0) + '/' + fmt(l.need, 0) + '㎡'], ['교목', l.trees], ['기준', l.ok ? '적합' : '부족']] : [['검토', '미실행']]; }
    case 'interior': { const n = (k) => els.filter(r => r.el.k === k).length; return [['실', n('room')], ['조명', n('light')], ['천장', n('ceiling')]]; }
  }
  return [];
}

function renderDashboard(w) {
  const P = state.P;
  const rows = takeoff(P); const cache = { els: allElements(P), rows, sum: sumBy(rows, r => r.code) };
  w.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } },
    h('div', {}, h('h1', {}, P.name), h('div', { class: 'sub' }, `${P.site.address || '위치 미지정'} · 위도 ${P.site.lat} 경도 ${P.site.lng} · 층 ${P.levels.length} · 도면 ${P.sheets.length}장`)),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => { state.P = null; store.flush(); refreshHeader(); renderHub($('#view')); } }, '프로젝트 목록'),
      h('button', { class: 'btn', onclick: editProject }, '프로젝트 설정'))));
  // 할 일
  const todo = todoItems(P);
  w.append(h('h2', {}, `할 일 ${todo.length ? '(' + todo.length + ')' : ''}`));
  if (!todo.length) w.append(h('div', { class: 'card' }, h('div', { class: 'd' }, '처리할 항목이 없습니다.')));
  else w.append(h('div', { class: 'card' }, h('ul', { class: 'todo', style: { margin: 0, paddingLeft: '18px' } }, ...todo.map(t => h('li', {}, h('span', { class: 'pill ' + (t.lv || '') }, t.tag), ' ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); t.go(); } }, t.text))))));
  if (!localStorageGet('bld:guide-off')) w.append(h('div', { class: 'card', style: { marginTop: '10px' } }, h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('div', { class: 't' }, '처음 쓰는 순서'), h('button', { class: 'btn sm ghost', onclick: (e) => { localStorageSet('bld:guide-off', '1'); e.target.closest('.card').remove(); } }, '숨기기')),
    h('ol', { class: 'd', style: { margin: '6px 0 0', paddingLeft: '18px', lineHeight: 1.8 } }, h('li', {}, '기획·대지 — 법규에서 건폐율·용적률 확인, 토목에 측량 CSV를 넣어 토공량·우수관 산정'), h('li', {}, '설계 — 작도에서 그리거나 DXF·IFC 가져오기 → 3D 확인 → 구조(용도·지반만 입력) → MEP·실내 → 조경 자동 식재'), h('li', {}, '설계검토 — 간섭·정합 실행 → 문제는 이슈로 등록 → 수정 후 Rev 저장'), h('li', {}, '적산·공정 — 물량·내역 단가 연결, 공정표를 모델에 연결해 4D 확인'), h('li', {}, '시공·관리 — 현장 사진을 도면에 붙여 기성 근거로, 작업일보·기성·이슈 관리 · 어디서든 Ctrl+K로 검색'))));

  // 툴 카드
  w.append(h('h2', {}, '툴 — 빌딩 라이프사이클 순'));
  for (const ph of PHASES) {
  w.append(h('div', { class: 'phase-h' }, h('b', {}, `${PHASES.indexOf(ph) + 1}. ${ph.name}`)));
  const cards = h('div', { class: 'cards' });
  for (const t of TOOLS.filter(x => x.phase === ph.id)) {
    const k = h('div', { class: 'k' }, toolStats(P, t.id, cache).map(([a, b]) => h('div', {}, h('b', {}, String(b)), a)));
    cards.append(h('div', { class: 'card click', onclick: () => go(t.id) },
      h('div', { class: 'ic', style: { background: t.color + '22', color: t.color }, html: ICONS[t.id] }),
      h('div', { class: 't' }, t.full), h('div', { class: 'd' }, t.desc), k));
  }
  w.append(cards);
  }

  // 연동 흐름
  w.append(h('h2', {}, '데이터 흐름'), h('div', { class: 'card' }, h('div', { class: 'd', html:
    '<b>작도</b>에서 그린 객체가 프로젝트에 저장되면 <b>3D</b>는 층고·기준점으로 입체를 만들고, <b>물량</b>은 같은 객체에서 수량을 뽑고, <b>기성</b>은 그 물량에 회차별 진척률을 곱해 청구량과 대비합니다. <b>간섭</b>과 <b>정합</b>에서 찾은 문제를 누르면 작도·3D에서 해당 위치가 강조됩니다. <b>공정</b>은 활동을 객체에 연결해 3D 4D 재생과 기성 계획률을 만들고, <b>이슈</b>는 간섭·정합 결과를 담당·기한으로 관리하며 상태를 되돌려 동기화합니다. 각 툴은 필요할 때만 불러와 가볍게 동작합니다.' })));

  // 도면(시트)
  w.append(h('h2', { class: 'row', style: { justifyContent: 'space-between' } }, '도면', h('button', { class: 'btn sm', onclick: addSheet }, '+ 도면 추가')));
  const discPill = (d) => h('span', { class: 'pill', style: { color: DISC[d]?.color, borderColor: DISC[d]?.color + '66' } }, `${d} ${DISC[d]?.name || ''}`);
  w.append(h('div', { class: 'tbl' }, table([
    { label: '도면명', render: r => r.name },
    { label: '공종', render: r => discPill(r.disc) },
    { label: '층', render: r => levelOf(P, r.level)?.name },
    { label: '객체', num: true, render: r => P.content[r.id]?.els.length || 0 },
    { label: '', render: r => h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
      h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); go('cad', { sheet: r.id }); } }, '작도'),
      h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); editSheet(r); } }, '수정')) },
  ], P.sheets)));

  // 리비전
  const prevs = P.prevs || [];
  w.append(h('h2', { class: 'row', style: { justifyContent: 'space-between' } }, '리비전', h('div', { class: 'row' },
    h('button', { class: 'btn sm', onclick: () => saveRevHub(prevs.length ? 'minor' : 'major') }, prevs.length ? `+ ${revName(nextRev(P, 'minor').major, nextRev(P, 'minor').minor)} 저장` : '+ Rev1 저장'),
    prevs.length ? h('button', { class: 'btn sm', onclick: () => saveRevHub('major') }, `+ ${revName(nextRev(P, 'major').major, 0)} 저장`) : null,
    prevs.length ? h('button', { class: 'btn sm primary', onclick: () => { state.rev3d = prevs[prevs.length - 1].id; go('view3d'); } }, '3D에서 비교') : null)));
  if (!prevs.length) w.append(h('div', { class: 'card' }, h('div', { class: 'd' }, '설계 변경 전후를 Rev로 저장하면 3D 상단 Rev 버튼으로 시점별 모델을 바로 전환하고, 바뀐 부재를 색으로 확인합니다. Rev1 저장 → 수정 → Rev1.1 저장 순으로 쓰세요.')));
  else w.append(h('div', { class: 'tbl' }, table([
    { label: 'Rev', render: r => h('b', {}, r.name) }, { label: '승인', render: r => approvalCell(r, () => { ctx.touch('meta'); renderHub($('#view')); }, `${r.name} 승인 상태`) }, { label: '저장일', render: r => new Date(r.at).toLocaleString('ko-KR') }, { label: '메모', render: r => h('span', { class: 'note' }, r.note || '') },
    { label: '직전 대비', render: r => r.stats ? h('span', { class: 'mono note' }, h('span', { style: { color: '#2ee07a' } }, `+${r.stats.added} `), h('span', { style: { color: '#ffa62b' } }, `~${r.stats.changed} `), h('span', { style: { color: '#ff6b6b' } }, `-${r.stats.removed}`)) : '-' },
    { label: '', render: r => h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
      h('button', { class: 'btn sm', onclick: () => { state.rev3d = r.id; go('view3d'); } }, '3D'),
      h('button', { class: 'btn sm', onclick: async () => { if (!await confirmBox('프로젝트 되돌리기', `모든 도면·층을 ${esc(r.name)} 상태로 되돌립니다. 현재 상태가 필요하면 먼저 새 Rev로 저장하세요.`, '되돌리기', true)) return; await restoreRev(ctx, r.id); toast(`${r.name}로 되돌렸습니다`, 'ok'); renderHub($('#view')); } }, '되돌리기'),
      h('button', { class: 'btn sm', onclick: async () => { if (!await confirmBox('리비전 삭제', `${esc(r.name)} 스냅샷을 삭제합니다.`, '삭제', true)) return; await deleteRev(ctx, r.id); renderHub($('#view')); } }, '삭제')) },
  ], [...prevs].reverse())));

  // 층
  w.append(h('h2', { class: 'row', style: { justifyContent: 'space-between' } }, '층(레벨)', h('button', { class: 'btn sm', onclick: editLevels }, '층 편집')));
  w.append(h('div', { class: 'tbl' }, table([
    { label: '층', key: 'name' }, { label: '바닥 표고(mm)', num: true, render: r => fmt0(r.elev) }, { label: '층고(mm)', num: true, render: r => fmt0(r.height) },
    { label: '도면', render: r => P.sheets.filter(s => s.level === r.id).map(s => s.disc).join(' ') },
  ], [...P.levels].sort((a, b) => b.elev - a.elev))));

  // 데이터
  w.append(h('h2', {}, '데이터'), h('div', { class: 'row' },
    h('button', { class: 'btn', onclick: () => saveFile(`${P.name.replace(/[\\/:*?"<>|]/g, '_')}.json`, JSON.stringify(P)) }, 'JSON 내보내기'),
    h('button', { class: 'btn', onclick: () => importIFC(false) }, 'IFC 가져오기 (도면 추가)'),
    h('button', { class: 'btn', onclick: exportIFC }, 'IFC4 내보내기'),
    h('button', { class: 'btn', onclick: importJSON }, 'JSON 가져오기(새 프로젝트)'),
    h('button', { class: 'btn', onclick: () => duplicateProject({ id: P.id, name: P.name }) }, '복제'),
    h('button', { class: 'btn danger', onclick: () => deleteProject({ id: state.P.id, name: state.P.name }) }, '프로젝트 삭제')));
  w.append(h('div', { class: 'note', style: { marginTop: '8px' } }, '저장 위치: ' + (store.kind === 'db' ? 'Claude 계정 (본인만 접근)' : store.kind === 'local' ? '이 브라우저' : '임시 메모리')));
}

// 샘플: Rev1 → Rev1.1 → Rev1.2 설계 변경 이력
async function sampleRevs() {
  const P = state.P; const sh = (pre) => P.sheets.find(s => s.name.startsWith(pre)); const C = (pre) => P.content[sh(pre).id];
  await createRev(ctx, { kind: 'major', note: '최초 설계 (실시설계 납품본)' });
  // Rev1.1: 환기덕트 경로 변경, 1층 칸막이 연장, 회의실 신설
  const ea = C('M-101').els.find(e => e.sys?.startsWith('환기')); if (ea) { ea.a = [13000, 1000]; ea.b = [13000, 15000]; }
  const pw = C('A-101').els.find(e => e.k === 'wall' && e.mat === 'DRY' && e.a[1] === 8000); if (pw) pw.a = [4000, 8000];
  C('A-101').els.push({ id: uid('e'), k: 'wall', a: [4000, 8000], b: [4000, 16000], t: 100, mat: 'DRY', zone: '1층', tag: '회의실 칸막이' });
  await createRev(ctx, { kind: 'minor', note: '환기덕트 EA-1 경로 1m 이동, 1층 회의실 신설' });
  // Rev1.2: 급수관 높이 조정(보 간섭 해소), 2층 창 확대, 2층 기초 보강 기둥 삭제 없음
  const cw = C('P-101').els.find(e => e.sys?.startsWith('급수')); if (cw) cw.z = 3150;
  for (const e of C('A-102').els) if (e.k === 'opening' && e.tag === 'W2') { e.w = 3600; e.s -= 300; }
  const ct = C('E-101').els.find(e => e.sys?.startsWith('통신')); if (ct) { const i = C('E-101').els.indexOf(ct); C('E-101').els.splice(i, 1); }
  await createRev(ctx, { kind: 'minor', note: '급수관 CW-1 FL+3150 하향(보 간섭 해소), 2층 W2 창 3.6m 확대, 통신트레이 CT-2 삭제' });
  const ap = (i, status, by, date, note) => { if (P.prevs[i]) P.prevs[i].approval = { status, by, date, note, at: Date.now() }; };
  ap(0, '승인', '감리단 김OO', '2026-10-05', '실시설계 승인'); ap(1, '승인', '감리단 김OO', '2026-10-20', ''); ap(2, '검토중', '설계사 구조팀', '2026-11-10', '급수관 하향 검토 요청');
  if (P.bill.periods[0]) P.bill.periods[0].approval = { status: '승인', by: '발주처 이OO', date: '2026-11-05', at: Date.now() };
  ctx.touch(['meta', ...P.sheets.map(s => s.id)]);
}
function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { } }
function todoItems(P) {
  const out = []; const td = new Date().toISOString().slice(0, 10);
  const od = (P.issues || []).filter(i => i.due && i.status !== '완료' && i.due < td); if (od.length) out.push({ tag: '이슈', lv: 'bad', text: `기한 지난 이슈 ${od.length}건 (#${od.slice(0, 3).map(i => i.no).join(', #')})`, go: () => go('issue') });
  const op = (P.issues || []).filter(i => i.status !== '완료').length; if (op && !od.length) out.push({ tag: '이슈', lv: 'warn', text: `열린 이슈 ${op}건`, go: () => go('issue') });
  for (const r of P.prevs || []) if (r.approval?.status === '검토중' || r.approval?.status === '반려') out.push({ tag: 'Rev', lv: r.approval.status === '반려' ? 'bad' : 'warn', text: `${r.name} ${r.approval.status}${r.approval.by ? ' (' + r.approval.by + ')' : ''}`, go: () => { state.rev3d = r.id; go('view3d'); } });
  const lastRev = (P.prevs || [])[P.prevs?.length - 1]; if (lastRev && !lastRev.approval) out.push({ tag: 'Rev', lv: '', text: `${lastRev.name} 승인 상태 미기록`, go: () => {} });
  P.bill.periods.forEach((p, i) => { if (!p.claim || !Object.keys(p.claim).length) out.push({ tag: '기성', lv: 'warn', text: `${p.name} 청구량 미입력 — 엑셀 청구서 불러오기`, go: () => go('bill') }); else if (!p.approval || p.approval.status === '작성') out.push({ tag: '기성', lv: '', text: `${p.name} 검토 후 승인 상태 기록`, go: () => go('bill') }); });
  for (const c of P.changeOrders || []) if (c.approval?.status !== '승인') out.push({ tag: '설계변경', lv: c.approval?.status === '반려' ? 'bad' : 'warn', text: `${c.name} ${c.approval?.status || '작성'} (${c.totals.da > 0 ? '+' : ''}${fmt0(c.totals.da)}원)`, go: () => go('qto') });
  if (P.clash.last?.open) out.push({ tag: '간섭', lv: 'warn', text: `미해결 간섭 ${P.clash.last.open}건`, go: () => go('clash') });
  if (P.check.last?.open) out.push({ tag: '정합', lv: 'warn', text: `미해결 도면 지적 ${P.check.last.open}건`, go: () => go('check') });
  const np = (P.photos || []).filter(p => !p.pt).length; if (np) out.push({ tag: '현장', lv: '', text: `위치 미지정 사진 ${np}장`, go: () => go('site') });
  return out.slice(0, 12);
}
// ---------- 통합 검색 (Ctrl+K) ----------
function paletteItems(q) {
  const P = state.P; const out = []; const ql = q.trim().toLowerCase(); const hit = (s) => !ql || String(s).toLowerCase().includes(ql);
  out.push(...[['hub', '통합 대시보드'], ...TOOLS.map(t => [t.id, t.full])].filter(([, n]) => hit(n)).map(([id, n]) => ({ k: '툴', t: n, run: () => go(id) })));
  if (!P) { for (const m of state.projects) if (hit(m.name)) out.push({ k: '프로젝트', t: m.name, run: async () => { await openProject(m.id); go('hub'); } }); return out; }
  for (const s of P.sheets) if (hit(s.name)) out.push({ k: '도면', t: s.name, s: s.disc, run: () => go('cad', { sheet: s.id }) });
  for (const r of P.prevs || []) if (hit(r.name) || hit(r.note || '')) out.push({ k: 'Rev', t: r.name, s: r.note?.slice(0, 30), run: () => { state.rev3d = r.id; go('view3d'); } });
  for (const i of P.issues || []) if (hit('#' + i.no) || hit(i.title)) out.push({ k: '이슈', t: `#${i.no} ${i.title}`, s: i.status, run: () => go('issue') });
  if (ql.length >= 1) { let n = 0; for (const s of P.sheets) for (const e of P.content[s.id]?.els || []) { if (n > 30) break; const label = (e.tag || '') + ' ' + elNm(e) + ' ' + (e.sys || '') + ' ' + (e.zone || ''); if (hit(label)) { n++; out.push({ k: '객체', t: `${e.tag ? e.tag + ' · ' : ''}${elNm(e)}`, s: s.name, run: () => { state.hi = { ids: [e.id], sheet: s.id, pts: [e.p || e.a || e.pts?.[0]], label: e.tag || elNm(e) }; go('cad'); } }); } } }
  const acts = [['Rev 저장(부분 수정)', () => saveRevHub('minor')], ['간섭 검토', () => go('clash')], ['엑셀 청구서 불러오기', () => go('bill')], ['사진 올리기', () => go('site')], ['IFC 가져오기', () => importIFC(false)], ['프로젝트 목록', () => { state.P = null; refreshHeader(); go('hub'); }]];
  for (const [n, f] of acts) if (hit(n)) out.push({ k: '실행', t: n, run: f });
  return out.slice(0, 60);
}
function openPalette() {
  if (document.querySelector('.pal')) return; let sel = 0, items = [];
  const inp = h('input', { placeholder: '툴·도면·부재 태그·이슈 번호·Rev 검색 (예: C1, #3, Rev1.1, 덕트)' }); const list = h('div', { class: 'pal-list' });
  const close = () => bg.remove();
  const draw = () => { items = paletteItems(inp.value); sel = Math.min(sel, Math.max(0, items.length - 1)); list.innerHTML = ''; items.forEach((it, i) => list.append(h('div', { class: 'pal-item' + (i === sel ? ' on' : ''), onclick: () => { close(); it.run(); } }, h('span', { class: 'k' }, it.k), h('span', {}, it.t), it.s ? h('span', { class: 's' }, it.s) : null))); if (!items.length) list.append(h('div', { class: 'pal-item' }, '결과 없음')); list.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); };
  inp.addEventListener('input', () => { sel = 0; draw(); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { sel++; draw(); e.preventDefault(); } else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); } else if (e.key === 'Enter') { const it = items[sel]; close(); it?.run(); } else if (e.key === 'Escape') close(); e.stopPropagation(); });
  const bg = h('div', { class: 'pal', onmousedown: (e) => { if (e.target === bg) close(); } }, h('div', { class: 'pal-box' }, inp, list)); document.body.append(bg); draw(); inp.focus(); setTimeout(() => inp.focus(), 10);
}
window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); e.stopPropagation(); openPalette(); } }, true);
$('#searchBtn').addEventListener('click', openPalette);

async function saveRevHub(kind) {
  const v = await dialog({ title: '리비전 저장', fields: [{ key: 'n', label: '변경 내용 메모', type: 'textarea', rows: 3, value: '' }], ok: '저장' }); if (!v) return;
  const r = await createRev(ctx, { kind, note: v.n }); toast(`${r.name} 저장${r.stats ? ` — 추가 ${r.stats.added}·변경 ${r.stats.changed}·삭제 ${r.stats.removed}` : ''}`, 'ok'); renderHub($('#view'));
}
async function editProject() {
  const P = state.P;
  const v = await dialog({ title: '프로젝트 설정', fields: [
    { key: 'name', label: '프로젝트 이름', value: P.name },
    { key: 'address', label: '주소/위치 메모', value: P.site.address || '' },
    { key: 'lat', label: '위도(°)', type: 'number', value: P.site.lat },
    { key: 'lng', label: '경도(°)', type: 'number', value: P.site.lng },
    { key: 'tz', label: '시간대(UTC+시간)', type: 'number', value: P.site.tz },
    { key: 'north', label: '진북 방향(도면 위쪽에서 시계방향 °)', type: 'number', value: P.site.north },
    { key: 'bx', label: '기준점 X(mm)', type: 'number', value: P.base.x },
    { key: 'by', label: '기준점 Y(mm)', type: 'number', value: P.base.y },
  ] });
  if (!v) return;
  P.name = v.name || P.name; Object.assign(P.site, { address: v.address, lat: v.lat ?? P.site.lat, lng: v.lng ?? P.site.lng, tz: v.tz ?? P.site.tz, north: v.north ?? 0 });
  P.base = { x: v.bx ?? 0, y: v.by ?? 0 };
  ctx.touch('meta'); refreshHeader(); renderHub($('#view'));
}
async function addSheet() {
  const P = state.P;
  const v = await dialog({ title: '도면 추가', fields: [
    { key: 'name', label: '도면명', value: '' },
    { key: 'disc', label: '공종', type: 'select', options: Object.entries(DISC).map(([k, d]) => [k, `${k} ${d.name}`]), value: 'A' },
    { key: 'level', label: '층', type: 'select', options: P.levels.map(l => [l.id, l.name]), value: P.levels[0].id },
    { key: 'copy', label: '그리드 복사(같은 층 다른 도면에서)', type: 'checkbox', value: true },
  ] });
  if (!v) return;
  const s = { id: uid('s'), name: v.name || `${v.disc}-${P.sheets.length + 101}`, disc: v.disc, level: v.level };
  P.sheets.push(s); P.content[s.id] = { ents: [], els: [] };
  if (v.copy) { const src = P.sheets.find(x => x.id !== s.id && P.content[x.id]?.ents.some(e => e.t === 'grid')); if (src) P.content[s.id].ents = deep(P.content[src.id].ents.filter(e => e.t === 'grid')).map(e => ({ ...e, id: uid('g') })); }
  ctx.touch(['meta', s.id]); renderHub($('#view'));
}
async function editSheet(s) {
  const P = state.P;
  const v = await dialog({ title: '도면 수정', fields: [
    { key: 'name', label: '도면명', value: s.name },
    { key: 'disc', label: '공종', type: 'select', options: Object.entries(DISC).map(([k, d]) => [k, `${k} ${d.name}`]), value: s.disc },
    { key: 'level', label: '층', type: 'select', options: P.levels.map(l => [l.id, l.name]), value: s.level },
    { key: 'del', label: '이 도면 삭제', type: 'checkbox', value: false },
  ] });
  if (!v) return;
  if (v.del) {
    if (P.sheets.length < 2) return toast('마지막 도면은 삭제할 수 없습니다', 'err');
    if (!await confirmBox('도면 삭제', `"${esc(s.name)}"과 안의 객체 ${P.content[s.id]?.els.length || 0}개를 삭제합니다.`, '삭제', true)) return;
    P.sheets = P.sheets.filter(x => x.id !== s.id); delete P.content[s.id]; ctx.touch(['meta', s.id]);
    if (state.sheet === s.id) state.sheet = P.sheets[0].id;
  } else { Object.assign(s, { name: v.name || s.name, disc: v.disc, level: v.level }); ctx.touch('meta'); }
  renderHub($('#view'));
}
async function editLevels() {
  const P = state.P; const lv = deep(P.levels).sort((a, b) => a.elev - b.elev);
  const body = h('div');
  const draw = () => {
    body.innerHTML = '';
    body.append(table([
      { label: '층 이름', render: r => { const i = h('input', { value: r.name }); i.oninput = () => r.name = i.value; return i; } },
      { label: '바닥 표고(mm)', render: r => { const i = h('input', { type: 'number', value: r.elev }); i.oninput = () => r.elev = +i.value; return i; } },
      { label: '층고(mm)', render: r => { const i = h('input', { type: 'number', value: r.height }); i.oninput = () => r.height = +i.value; return i; } },
      { label: '', render: r => h('button', { type: 'button', class: 'btn sm', onclick: () => { if (P.sheets.some(s => s.level === r.id)) return toast('도면이 연결된 층은 삭제할 수 없습니다', 'err'); lv.splice(lv.indexOf(r), 1); draw(); } }, '삭제') },
    ], lv));
    body.append(h('div', { class: 'row', style: { marginTop: '8px' } },
      h('button', { type: 'button', class: 'btn sm', onclick: () => { const top = lv[lv.length - 1]; lv.push({ id: uid('L'), name: `${lv.length + 1}F`, elev: (top?.elev || 0) + (top?.height || 4000), height: 4000 }); draw(); } }, '+ 위층 추가'),
      h('button', { type: 'button', class: 'btn sm', onclick: () => { let e = lv[0]?.elev ?? 0; for (const l of lv) { l.elev = e; e += l.height; } draw(); } }, '표고 자동 정렬(층고 누적)')));
  };
  draw();
  const ok = await dialog({ title: '층 편집', body, wide: true, ok: '저장' });
  if (!ok) return; P.levels = lv; ctx.touch('meta'); renderHub($('#view'));
}
async function exportIFC() {
  const P = state.P; toast('IFC4 파일을 만드는 중…');
  try {
    const { writeIFC } = await import('./ifcout.js'); await new Promise(r => setTimeout(r, 30));
    const r = writeIFC(P); const n = Object.values(r.stats).reduce((a, b) => a + b, 0);
    await saveFile(`${P.name.replace(/[\\/:*?"<>|]/g, '_')}.ifc`, new Blob([r.text], { type: 'application/x-step' }));
    toast(`IFC4: 객체 ${n.toLocaleString('ko-KR')}개 · ${(r.text.length / 1e6).toFixed(1)}MB`, 'ok', 5000);
  } catch (e) { console.error(e); toast('IFC 내보내기 실패: ' + (e.message || e), 'err', 6000); }
}
async function importIFC(asNew) {
  const f = await pickFile('.ifc'); if (!f) return;
  const box = h('div', { class: 'note' }, '준비 중…'); const bg = h('div', { class: 'modal-bg' }, h('div', { class: 'modal' }, h('h3', {}, 'IFC 가져오기 — ' + f.name), box)); document.body.append(bg);
  try {
    const { readIFC, ifcToProject } = await import('./ifc.js');
    const data = await readIFC(await f.arrayBuffer(), (m) => box.textContent = m);
    box.textContent = `층 ${data.storeys.length}개, 부재 ${data.items.length}개 변환 중…`;
    let P = asNew ? newProject(f.name.replace(/\.ifc$/i, '')) : state.P;
    if (asNew) { P.sheets = []; P.content = {}; P.levels = []; }
    const r = ifcToProject(P, data);
    if (!P.levels.length) P.levels.push({ id: 'L1', name: '1F', elev: 0, height: 4000 });
    bg.remove();
    if (asNew) await createProject(P); else { ctx.touch(['meta', ...r.sheets.map(s => s.id)]); renderHub($('#view')); }
    toast(`IFC 변환: ${Object.entries(r.stats).map(([k, v]) => `${k} ${v}`).join(', ')} → 도면 ${r.sheets.length}장`, 'ok', 6000);
  } catch (e) { console.error(e); bg.remove(); toast('IFC 가져오기 실패: ' + (e.message || e), 'err', 6000); }
}
async function importJSON() {
  const f = await pickFile('.json,application/json'); if (!f) return;
  try {
    const P = JSON.parse(await readText(f)); if (!P.sheets || !P.content) throw new Error('빌더 프로젝트 형식이 아닙니다');
    P.id = uid('p'); await createProject(P); toast('가져왔습니다', 'ok');
  } catch (e) { toast('가져오기 실패: ' + e.message, 'err'); }
}

// ---------- 시작 ----------
(async function boot() {
  renderNav();
  const kind = await store.init();
  store.bus.emit('status', { state: 'saved' });
  let last = null; try { last = localStorage.getItem('bld:last'); } catch { }
  state.projects = await store.list().catch(() => []);
  if (last && state.projects.some(p => p.id === last)) await openProject(last).catch(() => { });
  const r = location.hash.slice(1) || 'hub';
  await mount(r);
  console.log('[빌더] 저장소:', kind);
})();
