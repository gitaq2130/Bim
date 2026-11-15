// 빌더 구조 — 구조 형식 비교·추천 화면 (struct.js 에서 api 로 호출)
import { h, toast, confirmBox } from '../js/ui.js';
import { deep, esc, polyArea } from '../js/util.js';
import { SCHEMES, WEIGHTS, extractTopology, evalScheme, rank, explain, applicability, schedule } from '../js/schemes.js';
import { SECTIONS } from '../js/model.js';

const won = (v) => `${(v / 1e8).toFixed(1)}억`;
const BUILD_WHY = {
  RC_FRAME: '범용·자재 수급 쉬움 / 거푸집·철근 인력 많고 공기 김', RC_WALL: '알폼 반복으로 빠름(주거) / 평면 변경 불가, 대공간 불리', RC_FLAT: '보 없어 거푸집 단순·층고 절감 / 펀칭 전단·처짐 관리',
  STEEL_DECK: '건식·빠른 세우기, 장스팬 / 내화피복·진동·접합부 품질, 제작 리드타임', STEEL_CORE: '코어 선행 후 철골 동시 진행 / 코어-철골 접합 디테일', SRC_DECK: '고강성·고내력 / 철골+철근 간섭으로 시공 복잡',
  PC: '공장 제작 품질·현장 인력 최소 / 양중·운반 계획, 접합부 방수·일체성',
};
export function schemeUI(api) {
  const { side, P, ctx } = api; const st = api.schemeState ||= { sel: null, list: null, pick: null, view: 'table', W: null, running: false };
  const T = extractTopology(P); const use = P.struct?.site?.use || '사무실'; const nSt = T.stories.length;
  st.W ||= { ...(WEIGHTS[use] || WEIGHTS.default) };
  st.sel ||= Object.fromEntries(Object.keys(SCHEMES).map(k => [k, applicability(k, T, use, nSt).ok]));
  const ov = h('div', { style: { position: 'absolute', inset: 0, overflow: 'auto', background: '#0d1016', padding: '16px', color: '#e6edf7' } }); api.overlay(ov);
  let gfa = 0; for (const L of T.lv) for (const s of T.floorSlabs(L)) gfa += Math.abs(polyArea(s.pts)) / 1e6;
  function renderSide() {
    side.innerHTML = '';
    side.append(h('div', { class: 'note', style: { lineHeight: 1.6, marginBottom: '8px' } }, '현재 건물 형상(층·바닥판·코어·그리드)과 용도로 구조 형식별 모델을 자동 생성하고, 부재를 산정해 해석·검토·단면 조정까지 한 뒤 물량·공사비·공기·시공성·층고를 비교해 추천합니다.'),
      h('div', { class: 'card' }, h('div', { class: 'd' }, '건물'), h('div', { style: { fontSize: '12.5px', lineHeight: 1.8 } }, `${use} · 지상 ${nSt}층 · 연면적 ≈ ${gfa.toFixed(0)}㎡`, h('br'), `그리드 ${T.grid ? `직교 ${T.grid.xs.length}×${T.grid.ys.length}` : T.hasCols ? '기존 기둥 배치(비직교) 사용' : '없음 — 형식별 표준 스팬으로 생성'}`, h('br'), `RC 코어 ${T.core.length ? `있음 (${T.core.length}개 벽)` : '없음'}`)));
    side.append(h('h4', { style: { margin: '12px 0 4px' } }, '비교할 구조 형식'));
    for (const [k, sc] of Object.entries(SCHEMES)) { const ap = applicability(k, T, use, nSt); side.append(h('label', { style: { display: 'flex', gap: '6px', alignItems: 'flex-start', margin: '4px 0', opacity: ap.ok ? 1 : 0.45 } }, h('input', { type: 'checkbox', checked: !!st.sel[k] && ap.ok, disabled: !ap.ok, onchange: e => { st.sel[k] = e.target.checked; } }), h('div', { style: { flex: 1, minWidth: 0 } }, h('b', {}, sc.name), h('div', { class: 'note', style: { fontSize: '11.5px' } }, sc.desc + (ap.why ? ` — ${ap.why}` : ''))))); }
    side.append(h('h4', { style: { margin: '12px 0 4px' } }, `우선순위 (${use} 기본값)`));
    for (const [k, l] of [['cost', '공사비'], ['time', '공기'], ['build', '시공성'], ['flex', '평면 자유도(스팬)'], ['depth', '층고(구조 춤)']]) side.append(h('label', { class: 'row', style: { gap: '6px', alignItems: 'center' } }, h('span', { class: 'note', style: { minWidth: '110px' } }, l), h('input', { type: 'range', min: 0, max: 0.5, step: 0.05, value: st.W[k], style: { width: '140px' }, oninput: e => { st.W[k] = +e.target.value; if (st.list) { st.list = rank(st.list, use, nSt, st.W); renderTable(); } } }), h('span', { class: 'mono' }, `${Math.round(st.W[k] * 100)}`)));
    const est = Math.max(2, Math.round(Object.values(st.sel).filter(Boolean).length * nSt * (nSt > 20 ? 0.4 : 0.15)));
    side.append(h('div', { class: 'row', style: { gap: '6px', marginTop: '12px' } }, h('button', { class: 'btn primary', disabled: st.running, onclick: run }, st.list ? '다시 비교' : '구조 형식 비교'), h('span', { class: 'note' }, `예상 ${est < 60 ? est + '초' : Math.round(est / 60) + '분'} 내외`)), prog);
    if (P.struct?.schemeBackup) side.append(h('div', { class: 'card', style: { marginTop: '12px' } }, h('div', { class: 'd' }, `적용됨: ${SCHEMES[P.struct.schemeBackup.key]?.name || ''} (${new Date(P.struct.schemeBackup.at).toLocaleString('ko-KR')})`), h('button', { class: 'btn sm', style: { marginTop: '6px' }, onclick: undo }, '적용 취소 (원래 구조로)')));
  }
  const prog = h('div', { class: 'note', style: { marginTop: '6px' } });
  async function run() {
    st.running = true; renderSide(); const keys = Object.keys(SCHEMES).filter(k => st.sel[k] && applicability(k, T, use, nSt).ok); const out = []; const tick = () => new Promise(r => setTimeout(r, 0)); const t0 = performance.now();
    ov.innerHTML = ''; ov.append(h('div', { class: 'note', style: { fontSize: '14px' } }, '구조 형식별 모델 생성·해석 중…'));
    try { for (const [i, k] of keys.entries()) { const e = await evalScheme(P, T, k, { tick, onProgress: (m) => { prog.textContent = `(${i + 1}/${keys.length}) ${m} · ${((performance.now() - t0) / 1000).toFixed(0)}초`; } }); e.appl = applicability(k, T, use, nSt); out.push(e); } }
    catch (err) { console.error(err); toast('비교 중 오류: ' + (err.message || err), 'err', 6000); }
    st.list = rank(out, use, nSt, st.W); st.ms = performance.now() - t0; st.running = false; prog.textContent = `완료 ${(st.ms / 1000).toFixed(1)}초`; renderSide(); renderTable();
  }
  function typical(e) { const els = Object.values(e.P2.content).flatMap(c => c.els); const cols = els.filter(x => x.k === 'column'), beams = els.filter(x => x.k === 'beam' && !x.strip), walls = els.filter(x => x.k === 'wall' && x.mat === 'RC'), slabs = els.filter(x => x.k === 'slab');
    const mode = (arr, f) => { const m = new Map(); for (const a of arr) { const k = f(a); m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]; };
    const c = cols.length ? mode(cols, x => x.mat === 'STEEL' ? x.sec : x.mat === 'SRC' ? `${x.w}□+${x.sec}` : `${x.w}×${x.d}`) : null; const bmax = beams.reduce((a, b) => (b.d > (a?.d || 0) ? b : a), null);
    return { col: c ? `${c}${cols.length ? ` (${cols.length}개)` : ''}` : '-', beam: bmax ? (bmax.mat === 'STEEL' ? bmax.sec : `${bmax.w}×${bmax.d}`) : e.key === 'RC_FLAT' ? '없음 (슬래브띠)' : '-', wall: walls.length ? `t${mode(walls, x => x.t)} (${walls.length})` : '-', slab: slabs.length ? mode(slabs.filter(s => s.t), x => x.tag) : '-' }; }
  function renderTable() {
    ov.innerHTML = ''; const L = st.list; if (!L?.length) { ov.append(h('div', { class: 'note' }, '왼쪽에서 비교할 형식을 고르고 "구조 형식 비교"를 누르세요. (오른쪽 패널)')); return; }
    const best = L[0]; const c0 = Math.min(...L.map(e => e.Q.cost.total)), t0 = Math.min(...L.map(e => e.sch.days));
    ov.append(h('div', { style: { display: 'flex', gap: '14px', alignItems: 'flex-start', marginBottom: '14px', flexWrap: 'wrap' } },
      h('div', { style: { flex: '1 1 420px', background: '#13251a', border: '1px solid #2f6b45', borderRadius: '10px', padding: '12px 14px' } }, h('div', { style: { fontSize: '12px', color: '#7bd389' } }, '추천 구조'), h('div', { style: { fontSize: '20px', fontWeight: 700, margin: '2px 0 6px' } }, best.sc.name), h('div', { style: { fontSize: '13px', lineHeight: 1.6 } }, explain(best, L, use)), h('div', { class: 'note', style: { marginTop: '6px', fontSize: '12px' } }, BUILD_WHY[best.key])),
      h('div', { style: { flex: '1 1 320px', fontSize: '12.5px', lineHeight: 1.7 } }, ...L.slice(1, 4).map((e, i) => h('div', {}, h('b', {}, `${i + 2}위 ${e.sc.short}`), ` — ${!e.safe ? '부재·변위 기준 미충족 · ' : ''}공사비 ${e.Q.cost.total <= c0 * 1.001 ? '최저' : '+' + ((e.Q.cost.total / c0 - 1) * 100).toFixed(0) + '%'}, 공기 ${e.sch.days <= t0 ? '최단' : '+' + (e.sch.days - t0) + '일'}`)))));
    const rows = [
      ['구조 개요', e => h('div', { style: { fontSize: '11.5px', color: '#aab4c3' } }, e.sc.desc)],
      ['주요 부재', e => { const t = typical(e); return h('div', { style: { fontSize: '11.5px', lineHeight: 1.6 } }, `기둥 ${t.col}`, h('br'), `보 ${t.beam}`, h('br'), `벽 ${t.wall}`, h('br'), `바닥 ${t.slab}`); }],
      ['부재 검토', e => h('span', { style: { color: e.ng ? '#ff9f1c' : '#7bd389' } }, `${e.D.length - e.ng}/${e.D.length} 적합 · 최대비 ${e.max.toFixed(2)}`), true],
      ['층간변위비', e => h('span', { style: { color: e.drift.v > e.drift.lim ? '#ff6b6b' : '' } }, `${(e.drift.v * 100).toFixed(2)}% / ${(e.drift.lim * 100).toFixed(1)}%`)],
      ['펀칭 (무량판)', e => e.punchMax != null ? h('span', { style: { color: e.punchMax > 1 ? '#ff6b6b' : '' } }, e.punchMax.toFixed(2)) : '-'],
      ['고유주기 T', e => e.res.info.seis?.T ? `${e.res.info.seis.T.X.toFixed(2)} s` : '-'],
      ['건물 중량', e => `${(e.Wt / 9.81 / 1e3 / e.Q.gfa).toFixed(2)} t/㎡`, false, (e) => e.Wt / e.Q.gfa],
      ['구조 춤 (층고 영향)', e => `${e.Q.depth} mm`, false, e => e.Q.depth],
      ['최대 스팬', e => e.key === 'RC_WALL' ? `벽 간격 (평면 고정)` : `${(e.Q.span / 1000).toFixed(1)} m`],
      ['콘크리트', e => `${Math.round(e.Q.con).toLocaleString()} ㎥`, false, e => e.Q.con], ['철근', e => `${Math.round(e.Q.rbr).toLocaleString()} t`, false, e => e.Q.rbr], ['철골', e => e.Q.stl ? `${Math.round(e.Q.stl).toLocaleString()} t` : '-', false, e => e.Q.stl],
      ['데크 / PC', e => [e.Q.deck ? `데크 ${Math.round(e.Q.deck).toLocaleString()}㎡` : '', e.Q.pc ? `PC ${Math.round(e.Q.pc).toLocaleString()}㎥` : ''].filter(Boolean).join(' · ') || '-'], ['거푸집', e => `${Math.round(e.Q.frm).toLocaleString()} ㎡`, false, e => e.Q.frm],
      ['골조 공사비', e => h('b', {}, won(e.Q.cost.total)), true, e => e.Q.cost.total], ['㎡당', e => `${Math.round(e.Q.cost.total / e.Q.gfa / 1e4).toLocaleString()}만원`],
      ['골조 공기', e => h('span', {}, h('b', {}, `${e.sch.months.toFixed(1)}개월`), h('div', { style: { fontSize: '11px', color: '#aab4c3' } }, `층당 ${e.sch.cyc}일${e.sch.lead ? ` · 제작 리드 ${e.sch.lead}일` : ''}`)), true, e => e.sch.days],
      ['시공성', e => h('div', {}, `${'●'.repeat(e.buildScore)}${'○'.repeat(5 - e.buildScore)}`, h('div', { style: { fontSize: '11px', color: '#aab4c3' } }, BUILD_WHY[e.key]))],
      ['비고', e => h('div', { style: { fontSize: '11px', color: '#ffcf8a', lineHeight: 1.5 } }, [...(e.appl?.why ? [e.appl.why] : []), ...(e.noise ? ['주거 층간소음 표준바닥(210 mm) 미달'] : []), ...e.notes].join(' · ') || '-')],
      ['종합 점수', e => h('div', {}, h('div', { style: { height: '8px', borderRadius: '4px', background: '#22303f', width: '100%' } }, h('div', { style: { height: '8px', borderRadius: '4px', width: `${Math.round(e.total / L[0].total * 100)}%`, background: e === best ? '#7bd389' : '#5ab0ff' } })), h('div', { class: 'mono', style: { marginTop: '3px' } }, (e.total * 100).toFixed(0))), true],
    ];
    const tbl = h('table', { class: 'grid', style: { minWidth: `${180 + L.length * 170}px` } });
    tbl.append(h('thead', {}, h('tr', {}, h('th', { style: { width: '150px' } }, ''), ...L.map((e, i) => h('th', { style: { textAlign: 'left', background: i === 0 ? '#1d3a28' : '' } }, h('div', { style: { fontSize: '11px', color: '#aab4c3' } }, `${i + 1}위`), h('div', { style: { fontSize: '13.5px' } }, e.sc.name), !e.safe ? h('span', { class: 'pill bad', style: { marginTop: '3px' } }, '기준 미충족') : null)))));
    const tb = h('tbody'); for (const [lab, f, bold, num] of rows) { const vals = num ? L.map(num) : null; const mn = vals ? Math.min(...vals.filter(v => v > 0)) : null; tb.append(h('tr', {}, h('td', { style: { fontWeight: bold ? 700 : 500, whiteSpace: 'nowrap' } }, lab), ...L.map((e, i) => h('td', { style: { background: vals && vals[i] === mn && L.length > 1 ? '#17301f' : '' } }, f(e))))); }
    tb.append(h('tr', {}, h('td', {}, ''), ...L.map(e => h('td', {}, h('div', { class: 'row', style: { gap: '4px', flexWrap: 'wrap' } }, h('button', { class: 'btn sm', onclick: () => preview(e) }, '3D 보기'), h('button', { class: 'btn sm primary', onclick: () => apply(e) }, '이 구조로 적용'))))));
    tbl.append(tb); ov.append(h('div', { style: { overflow: 'auto' } }, tbl));
    ov.append(h('div', { class: 'note', style: { marginTop: '10px', fontSize: '11.5px', lineHeight: 1.6 } }, `공사비는 골조 직접공사비 개략(레미콘·철근·거푸집·철골·데크·PC·내화피복, 2026 국내 시장 단가 근사)이며 가설·양중·기초·마감은 제외. 공기는 기준층 사이클 × 층수 + 제작 리드타임(기초 공사와 중첩분 제외). 각 형식은 1차 산정 후 해석·검토 결과로 최대 4회 단면을 조정했습니다. 초록 칸 = 항목별 최소값. ${st.ms ? `계산 ${(st.ms / 1000).toFixed(1)}초.` : ''}`));
  }
  function preview(e) { ov.style.display = 'none'; api.preview(e.res, e.D); const back = h('button', { class: 'btn primary', style: { position: 'absolute', top: '10px', left: '10px', zIndex: 4 }, onclick: () => { back.remove(); ov.style.display = ''; api.preview(null); } }, `← 비교표로 (${e.sc.name} 3D, 색 = 검토비)`); api.holderEl.append(back); }
  async function apply(e) {
    if (!await confirmBox('구조 형식 적용', `현재 모델의 구조 부재(기둥·보·슬래브·구조 벽)를 "${e.sc.name}" 안으로 교체합니다. 원래 구조는 백업되며 "적용 취소"로 되돌릴 수 있습니다.`, '적용')) return;
    const touched = new Set(); const backup = { key: e.key, at: Date.now(), contents: {}, added: [], levels: P.levels.map(l => ({ ...l })) };
    const keep = (sid) => { if (!(sid in backup.contents)) backup.contents[sid] = deep(P.content[sid].els); touched.add(sid); };
    // 비구조로 바뀐 외곽 RC 벽 → CMU
    const coreIds = new Set(T.core.map(w => w.el.id)); if (e.key !== 'RC_WALL') for (const s of P.sheets) for (const el of P.content[s.id]?.els || []) if (el.k === 'wall' && (el.mat === 'RC' || el.mat === 'SRC') && !coreIds.has(el.id) && T.walls.some(w => w.el === el)) { keep(s.id); el.mat = 'CMU'; }
    for (const L of P.levels) {
      let sheets = P.sheets.filter(s => s.disc === 'S' && s.level === L.id); if (!sheets.length) { const s = { id: 's' + Date.now().toString(36) + L.id, name: `S-${L.name} 구조평면도 (${e.sc.short})`, disc: 'S', level: L.id }; P.sheets.push(s); P.content[s.id] = { ents: [], els: [] }; backup.added.push(s.id); sheets = [s]; }
      for (const s of sheets) { keep(s.id); P.content[s.id].els = P.content[s.id].els.filter(el => !(el.k === 'column' || el.k === 'beam' || (el.k === 'slab' && L !== T.base) || (el.k === 'wall' && (el.mat === 'RC' || el.mat === 'SRC') && e.key === 'RC_WALL' && !coreIds.has(el.id)))); }
      const src = e.P2.content['s_' + L.id]?.els || []; for (const el of src) { if (el.k === 'footing' || (el.k === 'slab' && L === T.base)) continue; if (el.k === 'wall' && coreIds.size && T.core.some(w => w.L.id === L.id && w.el.a[0] === el.a[0] && w.el.a[1] === el.a[1] && w.el.b[0] === el.b[0] && w.el.b[1] === el.b[1])) continue; P.content[sheets[0].id].els.push({ ...deep(el), id: 'e' + Math.random().toString(36).slice(2, 10) }); }
    }
    P.struct.schemeBackup = backup; P.struct.scheme = e.key; ctx.touch(['meta', ...touched, ...backup.added]); api.invalidate(); toast(`${e.sc.name} 적용 — "해석 실행"으로 상세 설계 조건을 산정하세요`, 'ok', 5000); renderSide();
  }
  async function undo() { const b = P.struct.schemeBackup; if (!b) return; if (!await confirmBox('적용 취소', '구조 형식 적용 전의 구조 부재로 되돌립니다.', '되돌리기')) return;
    for (const [sid, els] of Object.entries(b.contents)) if (P.content[sid]) P.content[sid].els = els; P.sheets = P.sheets.filter(s => !b.added.includes(s.id)); for (const sid of b.added) delete P.content[sid];
    delete P.struct.schemeBackup; delete P.struct.scheme; ctx.touch(['meta', ...Object.keys(b.contents)]); api.invalidate(); toast('원래 구조로 되돌렸습니다', 'ok'); renderSide(); }
  renderSide(); renderTable();
  return { leave() { api.overlay(null); api.preview(null); api.holderEl.querySelectorAll('button.btn.primary').forEach(b => { if (b.textContent.startsWith('←')) b.remove(); }); } };
}
