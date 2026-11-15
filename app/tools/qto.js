// 빌더 물량 — 객체 기반 물량산출 + 내역 단가 연결
import { h, toast, dialog, saveFile, table, confirmBox, approvalCell, editApproval } from '../js/ui.js';
import { loadRev, diffProject, snapshotOf } from '../js/rev.js';
import { takeoff, KINDS, DISC, levelOf, elName, REBAR_RATIO, isRefElement, allElements, DEFAULT_BOQ } from '../js/model.js';
import { BAR, FIELDS, defaultSpec, bbs, specKey, specOf, parseN, parseS, LAP, HOOK, STOCK } from '../js/rebar.js';
import { fmt, fmt0, csv, uid, esc } from '../js/util.js';

export function mount(root, ctx) {
  const P = ctx.P;
  const st = { group: 'code', level: '', disc: '', kind: '', q: '', open: null, tab: 'qto' };
  const page = h('div', { class: 'page' }); const w = h('div', { class: 'wrap' }); page.append(w); root.append(page);

  function render() {
    w.innerHTML = '';
    const tabs = h('div', { class: 'row', style: { marginBottom: '12px' } });
    for (const [k, l] of [['qto', '물량산출'], ['spec', '배근 상세 (부재 리스트)'], ['bbs', '철근 가공표 (BBS)'], ['chg', '설계변경 (Rev 증감)']]) tabs.append(h('button', { class: 'btn' + (st.tab === k ? ' primary' : ''), onclick: () => { st.tab = k; render(); } }, l));
    w.append(tabs);
    if (st.tab === 'spec') return renderSpec();
    if (st.tab === 'bbs') return renderBBS();
    if (st.tab === 'chg') return renderChange();
    const rows = takeoff(P).filter(r => (!st.level || r.level.id === st.level) && (!st.disc || r.sheet.disc === st.disc) && (!st.kind || r.el.k === st.kind) && (!st.q || (r.el.tag || '').includes(st.q) || (r.el.zone || '').includes(st.q) || r.sheet.name.includes(st.q)));
    const boqMap = Object.fromEntries(P.boq.map(b => [b.code, b]));
    w.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('div', {}, h('h1', {}, '물량산출'), h('div', { class: 'sub' }, '작도한 객체에서 바로 계산합니다. 구조 부재는 구조(S) 도면 것만 집계해 중복을 막습니다.')),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => exportCSV(rows) }, 'CSV 내보내기'), h('button', { class: 'btn', onclick: () => ctx.go('bill') }, '기성으로 →'))));
    // 필터
    const sel = (label, key, opts) => { const s = h('select', {}); s.append(h('option', { value: '' }, label)); for (const [v, l] of opts) s.append(h('option', { value: v, selected: st[key] === v }, l)); s.onchange = () => { st[key] = s.value; render(); }; return s; };
    const q = h('input', { placeholder: '태그·구역·도면 검색', value: st.q }); q.onchange = () => { st.q = q.value; render(); };
    w.append(h('div', { class: 'row', style: { margin: '14px 0' } },
      sel('전체 층', 'level', P.levels.map(l => [l.id, l.name])), sel('전체 공종', 'disc', Object.entries(DISC).map(([k, d]) => [k, `${k} ${d.name}`])), sel('전체 객체', 'kind', Object.entries(KINDS).map(([k, d]) => [k, d.name])), q,
      h('span', { class: 'note' }, '집계 기준'), sel('공종코드', 'group', [['level', '층별'], ['sheet', '도면별'], ['kind', '객체별'], ['zone', '구역별']])));

    // 내역 요약
    const sum = new Map(); for (const r of rows) sum.set(r.code, (sum.get(r.code) || 0) + r.qty);
    const sumRows = P.boq.filter(b => sum.has(b.code)).map(b => ({ ...b, qty: sum.get(b.code), amt: sum.get(b.code) * b.price }));
    for (const [code, qty] of sum) if (!boqMap[code]) sumRows.push({ code, name: '(내역 미등록)', unit: '', price: 0, qty, amt: 0 });
    const total = sumRows.reduce((s, r) => s + r.amt, 0);
    w.append(h('h2', { class: 'row', style: { justifyContent: 'space-between' } }, '내역 요약', h('button', { class: 'btn sm', onclick: editBoq }, '내역·단가 편집')));
    gapBanner(sum, boqMap);
    w.append(h('div', { class: 'tbl' }, table([
      { label: '코드', key: 'code', w: '70px' }, { label: '명칭', key: 'name' }, { label: '단위', key: 'unit', w: '60px' },
      { label: '수량', num: true, render: r => fmt(r.qty, 3) }, { label: '단가(원)', num: true, render: r => fmt0(r.price) }, { label: '금액(원)', key: 'amt', num: true, render: r => fmt0(r.amt) },
      { label: '비율', num: true, render: r => total ? fmt(r.amt / total * 100, 1) + '%' : '-' },
    ], sumRows, { foot: { name: '합계', amt: fmt0(total) }, onRow: (r) => { st.open = st.open === r.code ? null : r.code; render(); } })));
    w.append(h('div', { class: 'note', style: { marginTop: '6px' } }, '단가는 예시값입니다. "내역·단가 편집"에서 현장 계약 단가로 바꾸세요. 행을 누르면 해당 코드 산출 근거만 아래에 표시됩니다.'));

    // 그룹 집계
    if (st.group && st.group !== 'code') {
      const keyOf = { level: r => r.level.name, sheet: r => r.sheet.name, kind: r => KINDS[r.el.k]?.name || r.el.k, zone: r => r.el.zone || '(미지정)' }[st.group];
      const codes = [...sum.keys()]; const g = new Map();
      for (const r of rows) { const k = keyOf(r); if (!g.has(k)) g.set(k, {}); g.get(k)[r.code] = (g.get(k)[r.code] || 0) + r.qty; }
      w.append(h('h2', {}, { level: '층별', sheet: '도면별', kind: '객체별', zone: '구역별' }[st.group] + ' 집계'));
      w.append(h('div', { class: 'tbl' }, table([{ label: '구분', key: 'k' }, ...codes.map(c => ({ label: `${c} (${boqMap[c]?.unit || ''})`, num: true, render: r => r[c] ? fmt(r[c], 2) : '' }))], [...g.entries()].map(([k, v]) => ({ k, ...v })))));
    }

    // 산출 근거
    const det = rows.filter(r => !st.open || r.code === st.open);
    w.append(h('h2', {}, `산출 근거 ${st.open ? `— ${st.open}` : ''} (${det.length}행)`));
    const shown = det.slice(0, 600);
    w.append(h('div', { class: 'tbl', style: { maxHeight: '520px' } }, table([
      { label: '도면', render: r => r.sheet.name }, { label: '층', render: r => r.level.name }, { label: '구역', render: r => r.el.zone || '' },
      { label: '객체', render: r => (r.el.tag ? r.el.tag + ' · ' : '') + elName(r.el) }, { label: '코드', key: 'code' },
      { label: '수량', num: true, render: r => fmt(r.qty, 3) }, { label: '단위', render: r => boqMap[r.code]?.unit || '' }, { label: '근거', render: r => h('span', { class: 'note' }, r.desc || '') },
    ], shown, { onRow: (r) => { ctx.state.hi = { ids: [r.el.id], sheet: r.sheet.id, pts: [r.el.p || r.el.a || r.el.pts?.[0]], label: `${r.el.tag || elName(r.el)} (${r.code})` }; ctx.go('cad'); } })));
    if (det.length > shown.length) w.append(h('div', { class: 'note' }, `${det.length - shown.length}행 더 있음 — CSV로 전체를 받으세요.`));
    w.append(h('div', { class: 'note', style: { marginTop: '8px' } }, `산출 기준: 벽 = 길이×높이(개구부 공제)×두께, 보 = 폭×(춤-상부 슬래브)×순길이(기둥 폭/2 공제), 거푸집 = 접촉면, 철근 = 콘크리트량×철근비(기본 ${Object.entries(REBAR_RATIO).map(([k, v]) => `${KINDS[k].name} ${v}`).join(', ')} kg/m³, 객체별 변경 가능). 철골 = 길이×단위중량.`));
  }

  // ---------- 배근 상세: 종류+태그별 부재 리스트 ----------
  function structGroups() {
    const g = new Map();
    for (const r of allElements(P, r => r.sheet.disc === 'S' && FIELDS[r.el.k] && r.el.mat !== 'STEEL')) { const k = specKey(r.el); if (!g.has(k)) g.set(k, { key: k, kind: r.el.k, tag: r.el.tag || '(태그없음)', items: [], sample: r.el }); g.get(k).items.push(r); }
    return [...g.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.tag.localeCompare(b.tag));
  }
  function renderSpec() {
    P.rebarSchedule ||= {};
    w.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('div', {}, h('h1', {}, '배근 상세 — 부재 리스트'), h('div', { class: 'sub' }, '구조도 부재 리스트처럼 같은 종류·태그(C1, G1 등)에 배근을 지정하면 철근량이 철근비 대신 가공표 기준으로 계산됩니다.')),
      h('button', { class: 'btn', onclick: () => { for (const gr of structGroups()) if (!P.rebarSchedule[gr.key]) P.rebarSchedule[gr.key] = defaultSpec(gr.kind, gr.sample); ctx.touch('meta'); render(); toast('비어 있는 부재에 표준 배근을 채웠습니다', 'ok'); } }, '표준 배근 일괄 채우기')));
    const groups = structGroups();
    if (!groups.length) { w.append(h('div', { class: 'empty' }, '구조(S) 도면에 RC 기둥·보·슬래브·벽·기초가 없습니다.')); return; }
    for (const gr of groups) {
      const spec = P.rebarSchedule[gr.key];
      const card = h('div', { class: 'card', style: { marginBottom: '10px' } });
      const e = gr.sample; const size = e.k === 'column' || e.k === 'footing' ? `${e.w}×${e.d}${e.t ? '×' + e.t : ''}` : e.k === 'beam' ? `${e.w}×${e.d}` : `t${e.t}`;
      card.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('div', { class: 't' }, `${KINDS[gr.kind].name} ${gr.tag}  `, h('span', { class: 'note' }, `${size} · ${gr.items.length}개`)),
        spec ? h('button', { class: 'btn sm', onclick: () => { delete P.rebarSchedule[gr.key]; ctx.touch('meta'); render(); } }, '철근비로 되돌리기') : h('button', { class: 'btn sm primary', onclick: () => { P.rebarSchedule[gr.key] = defaultSpec(gr.kind, e); ctx.touch('meta'); render(); } }, '배근 입력')));
      if (spec) {
        const kv = h('div', { class: 'row', style: { marginTop: '8px', alignItems: 'flex-end' } });
        for (const [key, label, type] of [...FIELDS[gr.kind], ['cover', '피복(mm)', 'num']]) {
          const i = h('input', { value: spec[key] ?? '', style: { width: type === 'num' ? '70px' : '120px' } });
          const valid = () => { const ok = type === 'num' ? !isNaN(+i.value) : type === 'n' ? !!parseN(i.value) : !!parseS(i.value); i.style.borderColor = ok ? '' : 'var(--bad)'; return ok; };
          i.onchange = () => { if (!valid()) return toast(`형식 확인: ${label}`, 'err'); spec[key] = type === 'num' ? +i.value : i.value.toUpperCase().replace(/\s/g, ''); ctx.touch('meta'); sumEl.textContent = summary(gr, spec); };
          kv.append(h('label', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } }, h('span', { class: 'note' }, label), i));
        }
        card.append(kv);
        const sumEl = h('div', { class: 'note', style: { marginTop: '6px' } }, summary(gr, spec)); card.append(sumEl);
      }
      w.append(card);
    }
    w.append(h('div', { class: 'note' }, `산정 기준: 정척 ${STOCK / 1000}m 초과 시 겹침이음 ${LAP}d, 갈고리 ${HOOK}d, 기둥 주근 상층 이음 ${LAP}d, 보 주근 양단 정착 15d, 띠철근·늑근 둘레 + 갈고리 2개. KS D 3504 단위중량 적용. 객체별 예외는 작도 속성의 배근 칸에서 지정합니다.`));
  }
  function summary(gr, spec) {
    let kg = 0; for (const r of gr.items) { const openings = P.content[r.sheet.id].els.filter(e => e.k === 'opening'); for (const b of bbs(r.el, r.level, r.el.rebar || spec, { openings })) kg += b.kg; }
    return `철근 ${fmt(kg / 1000, 3)} ton (부재당 ${fmt(kg / gr.items.length, 1)} kg)`;
  }
  function bbsRows() {
    const out = [];
    for (const r of allElements(P, r => r.sheet.disc === 'S' && FIELDS[r.el.k])) { const spec = specOf(P, r.el); if (!spec) continue; const openings = P.content[r.sheet.id].els.filter(e => e.k === 'opening'); for (const b of bbs(r.el, r.level, spec, { openings })) out.push({ ...b, r }); }
    return out;
  }
  function renderBBS() {
    const rows = bbsRows();
    w.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('div', {}, h('h1', {}, '철근 가공표 (BBS)'), h('div', { class: 'sub' }, '배근 상세가 지정된 부재만 표시합니다. 지름별 합계는 철근 기성·발주 수량 검토에 씁니다.')),
      h('button', { class: 'btn', onclick: () => saveFile(`${P.name}_철근가공표.csv`.replace(/[\\/:*?"<>|]/g, '_'), csv([['도면', '층', '구역', '부재', '부호', '지름', '길이(mm)', '개수', '총길이(m)', '단위중량', '중량(kg)'], ...rows.map(b => [b.r.sheet.name, b.r.level.name, b.r.el.zone || '', (b.r.el.tag || '') + ' ' + elName(b.r.el), b.mark, b.dia, Math.round(b.len), b.n, (b.len * b.n / 1000).toFixed(2), BAR[b.dia], b.kg.toFixed(1)])])) }, 'CSV 내보내기')));
    if (!rows.length) { w.append(h('div', { class: 'card' }, h('div', { class: 'd' }, '"배근 상세" 탭에서 부재별 배근을 먼저 입력하세요.'))); return; }
    const byDia = new Map(); for (const b of rows) { const x = byDia.get(b.dia) || { len: 0, kg: 0 }; x.len += b.len * b.n / 1000; x.kg += b.kg; byDia.set(b.dia, x); }
    const dias = [...byDia.entries()].sort((a, b) => parseInt(a[0].slice(1)) - parseInt(b[0].slice(1)));
    const tot = dias.reduce((s, [, x]) => s + x.kg, 0);
    w.append(h('h2', {}, '지름별 집계'), h('div', { class: 'tbl' }, table([{ label: '지름', key: 'd' }, { label: '단위중량(kg/m)', num: true, render: r => BAR[r.d] }, { label: '총길이(m)', num: true, render: r => fmt(r.len, 1) }, { label: '중량(ton)', num: true, render: r => fmt(r.kg / 1000, 3) }, { label: '비율', num: true, render: r => fmt(r.kg / tot * 100, 1) + '%' }], dias.map(([d, x]) => ({ d, ...x })), { foot: { d: '합계', kg: '' } })));
    w.append(h('div', { class: 'note', style: { marginTop: '6px' } }, `합계 ${fmt(tot / 1000, 3)} ton`));
    const byLv = new Map(); for (const b of rows) { const k = b.r.level.name + ' · ' + KINDS[b.r.el.k].name; byLv.set(k, (byLv.get(k) || 0) + b.kg); }
    w.append(h('h2', {}, '층·부재별'), h('div', { class: 'tbl' }, table([{ label: '구분', key: 'k' }, { label: '중량(ton)', num: true, render: r => fmt(r.v / 1000, 3) }], [...byLv.entries()].map(([k, v]) => ({ k, v })))));
    w.append(h('h2', {}, `가공표 상세 (${rows.length}행)`), h('div', { class: 'tbl', style: { maxHeight: '480px' } }, table([
      { label: '부재', render: b => `${b.r.el.tag || ''} ${KINDS[b.r.el.k].name}` }, { label: '층', render: b => b.r.level.name }, { label: '부호', key: 'mark' }, { label: '지름', key: 'dia' },
      { label: '길이(mm)', num: true, render: b => fmt0(b.len) }, { label: '개수', num: true, render: b => b.n }, { label: '총길이(m)', num: true, render: b => fmt(b.len * b.n / 1000, 1) }, { label: '중량(kg)', num: true, render: b => fmt(b.kg, 1) },
    ], rows.slice(0, 800), { onRow: (b) => { ctx.state.hi = { ids: [b.r.el.id], sheet: b.r.sheet.id, pts: [b.r.el.p || b.r.el.a || b.r.el.pts?.[0]], label: `${b.r.el.tag || ''} ${b.mark}` }; ctx.go('cad'); } })));
  }

  // ---------- 설계변경: Rev 간 물량·금액 증감 ----------
  async function changeData(baseId, tgtId) {
    const bs = await loadRev(ctx, baseId); const ts = tgtId === 'cur' ? snapshotOf(P) : await loadRev(ctx, tgtId);
    if (!bs || !ts) throw new Error('리비전 데이터를 불러오지 못했습니다');
    const A = takeoff({ ...P, ...bs }), B = takeoff({ ...P, ...ts }); const price = Object.fromEntries(P.boq.map(b => [b.code, b]));
    const sum = (rows) => { const m = new Map(); for (const r of rows) m.set(r.code, (m.get(r.code) || 0) + r.qty); return m; };
    const sa = sum(A), sb = sum(B); const codes = [...new Set([...sa.keys(), ...sb.keys()])];
    const items = codes.map(c => { const b = price[c] || { code: c, name: '(미등록)', unit: '', price: 0 }; const q0 = sa.get(c) || 0, q1 = sb.get(c) || 0; return { ...b, q0, q1, dq: q1 - q0, a0: q0 * b.price, a1: q1 * b.price, da: (q1 - q0) * b.price }; }).filter(x => Math.abs(x.q0) + Math.abs(x.q1) > 1e-9);
    const byEl = (rows) => { const m = new Map(); for (const r of rows) { const k = r.el.id + '|' + r.code; const x = m.get(k) || { r, qty: 0 }; x.qty += r.qty; m.set(k, x); } return m; };
    const ea = byEl(A), eb = byEl(B); const d = diffProject(bs, ts); const els = [];
    for (const k of new Set([...ea.keys(), ...eb.keys()])) { const x = ea.get(k), y = eb.get(k); const q0 = x?.qty || 0, q1 = y?.qty || 0; if (Math.abs(q1 - q0) < 1e-6) continue; const r = (y || x).r; const code = k.split('|')[1]; els.push({ r, code, q0, q1, dq: q1 - q0, da: (q1 - q0) * (price[code]?.price || 0), st: d.status[r.el.id] || 'changed' }); }
    els.sort((a, b) => Math.abs(b.da) - Math.abs(a.da));
    return { items, els, diff: d };
  }
  async function renderChange() {
    const list = P.prevs || []; P.changeOrders ||= [];
    w.append(h('div', {}, h('h1', {}, '설계변경 — Rev 간 물량·금액 증감'), h('div', { class: 'sub' }, '두 Rev(또는 현재)의 모델 물량을 같은 단가로 계산해 당초·변경·증감 대비표를 만듭니다.')));
    if (!list.length) { w.append(h('div', { class: 'card', style: { marginTop: '12px' } }, h('div', { class: 'd' }, '저장된 Rev가 없습니다. 허브나 3D에서 Rev를 먼저 저장하세요.'))); return; }
    st.cb ??= list[0].id; st.ct ??= 'cur';
    const sel = (key, withCur) => { const s = h('select'); for (const r of list) s.append(h('option', { value: r.id, selected: st[key] === r.id }, r.name)); if (withCur) s.append(h('option', { value: 'cur', selected: st[key] === 'cur' }, '현재')); s.onchange = () => { st[key] = s.value; render(); }; return s; };
    w.append(h('div', { class: 'row', style: { margin: '12px 0' } }, h('span', { class: 'note' }, '당초'), sel('cb'), h('span', { class: 'note' }, '→ 변경'), sel('ct', true)));
    const box = h('div', {}, h('div', { class: 'note' }, '계산 중…')); w.append(box);
    let D; try { D = await changeData(st.cb, st.ct); } catch (e) { box.innerHTML = ''; box.append(h('div', { class: 'card' }, e.message)); return; }
    box.innerHTML = '';
    const nm = (id) => id === 'cur' ? '현재' : list.find(r => r.id === id)?.name;
    const tot = D.items.reduce((s, x) => ({ a0: s.a0 + x.a0, a1: s.a1 + x.a1, da: s.da + x.da }), { a0: 0, a1: 0, da: 0 });
    const sgn = (v, d = 0) => (v > 0 ? '+' : '') + fmt(v, d);
    box.append(h('div', { class: 'cards', style: { marginBottom: '12px' } },
      ...[['당초 금액', fmt0(tot.a0) + '원'], ['변경 금액', fmt0(tot.a1) + '원'], ['증감', sgn(tot.da) + '원', tot.da > 0 ? 'var(--bad)' : tot.da < 0 ? 'var(--ok)' : ''], ['증감률', tot.a0 ? sgn(tot.da / tot.a0 * 100, 2) + '%' : '-'], ['객체 변경', `추가 ${D.diff.added} · 변경 ${D.diff.changed} · 삭제 ${D.diff.removed}`]].map(([t, v, c]) => h('div', { class: 'card' }, h('div', { class: 'note' }, t), h('div', { class: 'mono', style: { fontSize: '17px', fontWeight: 600, color: c || 'var(--fg)' } }, v)))));
    box.append(h('h2', {}, `증감 대비표 (${nm(st.cb)} → ${nm(st.ct)})`), h('div', { class: 'tbl' }, table([
      { label: '코드', key: 'code' }, { label: '공종', key: 'name' }, { label: '단위', key: 'unit' }, { label: '단가', num: true, render: x => fmt0(x.price) },
      { label: '당초 수량', num: true, render: x => fmt(x.q0, 3) }, { label: '변경 수량', num: true, render: x => fmt(x.q1, 3) }, { label: '증감 수량', num: true, render: x => sgn(x.dq, 3), cls: x => x.dq > 1e-9 ? 'bad' : '' },
      { label: '당초 금액', key: 'a0', num: true, render: x => fmt0(x.a0) }, { label: '변경 금액', key: 'a1', num: true, render: x => fmt0(x.a1) }, { label: '증감 금액', key: 'da', num: true, render: x => sgn(x.da), cls: x => x.da > 0.5 ? 'bad' : '' },
    ], D.items, { foot: { name: '합계', a0: fmt0(tot.a0), a1: fmt0(tot.a1), da: sgn(tot.da) } })));
    const lab = { added: '추가', changed: '변경', removed: '삭제' };
    box.append(h('h2', {}, `부재별 증감 근거 (${D.els.length}건)`), h('div', { class: 'tbl', style: { maxHeight: '420px' } }, table([
      { label: '구분', render: x => h('span', { class: 'pill ' + (x.st === 'added' ? 'ok' : x.st === 'removed' ? 'bad' : 'warn') }, lab[x.st]) }, { label: '도면', render: x => x.r.sheet.name }, { label: '층', render: x => x.r.level.name },
      { label: '객체', render: x => (x.r.el.tag ? x.r.el.tag + ' · ' : '') + elName(x.r.el) }, { label: '코드', key: 'code' }, { label: '당초', num: true, render: x => fmt(x.q0, 3) }, { label: '변경', num: true, render: x => fmt(x.q1, 3) }, { label: '증감', num: true, render: x => sgn(x.dq, 3) }, { label: '증감 금액', num: true, render: x => sgn(x.da) },
    ], D.els.slice(0, 500), { onRow: (x) => { if (x.st === 'removed') return toast('삭제된 객체는 3D Rev 비교에서 빨간색으로 볼 수 있습니다'); ctx.state.hi = { ids: [x.r.el.id], sheet: x.r.sheet.id, pts: [x.r.el.p || x.r.el.a || x.r.el.pts?.[0]], label: `${lab[x.st]} ${x.r.el.tag || elName(x.r.el)}` }; ctx.go('cad'); } })));
    box.append(h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', { class: 'btn primary', onclick: async () => { const v = await dialog({ title: '설계변경 등록', fields: [{ key: 'n', label: '변경 차수 이름', value: `설계변경 ${P.changeOrders.length + 1}차` }, { key: 'note', label: '변경 사유', type: 'textarea', rows: 3, value: '' }] }); if (!v) return; P.changeOrders.push({ id: uid('co'), name: v.n, note: v.note, base: st.cb, target: st.ct === 'cur' ? null : st.ct, baseName: nm(st.cb), targetName: nm(st.ct), at: Date.now(), totals: tot, items: D.items.map(({ code, name, unit, price, q0, q1, dq, da }) => ({ code, name, unit, price, q0, q1, dq, da })), approval: { status: '작성' } }); ctx.touch('meta'); toast('설계변경을 등록했습니다', 'ok'); render(); } }, '설계변경으로 등록'),
      h('button', { class: 'btn', onclick: () => exportChange(D, nm(st.cb), nm(st.ct), tot) }, '내역서(HTML)'),
      h('button', { class: 'btn', onclick: () => saveFile(`${P.name}_설계변경_${nm(st.cb)}-${nm(st.ct)}.csv`.replace(/[\\/:*?"<>|]/g, '_'), csv([['코드', '공종', '단위', '단가', '당초수량', '변경수량', '증감수량', '당초금액', '변경금액', '증감금액'], ...D.items.map(x => [x.code, x.name, x.unit, x.price, x.q0.toFixed(3), x.q1.toFixed(3), x.dq.toFixed(3), Math.round(x.a0), Math.round(x.a1), Math.round(x.da)])])) }, 'CSV')));
    // 등록된 설계변경
    if (P.changeOrders.length) {
      w.append(h('h2', {}, '등록된 설계변경'), h('div', { class: 'tbl' }, table([
        { label: '차수', key: 'name' }, { label: '대상', render: c => `${c.baseName} → ${c.targetName}` }, { label: '증감 금액', num: true, render: c => sgn(c.totals.da) }, { label: '사유', render: c => h('span', { class: 'note' }, c.note || '') },
        { label: '승인', render: c => approvalCell(c, () => { ctx.touch('meta'); render(); }, `${c.name} 승인 상태`) },
        { label: '', render: c => h('button', { class: 'btn sm', onclick: () => { P.changeOrders = P.changeOrders.filter(x => x !== c); ctx.touch('meta'); render(); } }, '삭제') },
      ], P.changeOrders)));
    }
  }
  function exportChange(D, a, b, tot) {
    const sgn = (v, d = 0) => (v > 0 ? '+' : '') + fmt(v, d);
    const tr = D.items.map(x => `<tr><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td>${esc(x.unit)}</td><td class=n>${fmt0(x.price)}</td><td class=n>${fmt(x.q0, 3)}</td><td class=n>${fmt(x.q1, 3)}</td><td class=n>${sgn(x.dq, 3)}</td><td class=n>${fmt0(x.a0)}</td><td class=n>${fmt0(x.a1)}</td><td class=n style="color:${x.da > 0 ? '#b42318' : x.da < 0 ? '#1e7a4f' : '#111'}">${sgn(x.da)}</td></tr>`).join('');
    const er = D.els.slice(0, 300).map(x => `<tr><td>${{ added: '추가', changed: '변경', removed: '삭제' }[x.st]}</td><td>${esc(x.r.sheet.name)}</td><td>${esc((x.r.el.tag || '') + ' ' + elName(x.r.el))}</td><td>${x.code}</td><td class=n>${sgn(x.dq, 3)}</td><td class=n>${sgn(x.da)}</td></tr>`).join('');
    saveFile(`${P.name}_설계변경내역서_${a}-${b}.html`.replace(/[\\/:*?"<>|]/g, '_'), `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>설계변경 내역서</title><style>body{font-family:'Malgun Gothic',sans-serif;margin:24px}table{border-collapse:collapse;width:100%;font-size:12px;margin-bottom:18px}td,th{border:1px solid #999;padding:4px 6px}th{background:#eef}td.n{text-align:right}</style></head><body><h1 style="font-size:20px">${esc(P.name)} 설계변경 내역서</h1><p>${esc(a)} → ${esc(b)} · 작성 ${new Date().toLocaleDateString('ko-KR')} · 증감 ${sgn(tot.da)}원 (${tot.a0 ? sgn(tot.da / tot.a0 * 100, 2) : '-'}%)</p><table><tr><th>코드</th><th>공종</th><th>단위</th><th>단가</th><th>당초 수량</th><th>변경 수량</th><th>증감</th><th>당초 금액</th><th>변경 금액</th><th>증감 금액</th></tr>${tr}<tr><th colspan=7>합계</th><th>${fmt0(tot.a0)}</th><th>${fmt0(tot.a1)}</th><th>${sgn(tot.da)}</th></tr></table><h2 style="font-size:15px">부재별 증감 근거</h2><table><tr><th>구분</th><th>도면</th><th>객체</th><th>코드</th><th>증감 수량</th><th>증감 금액</th></tr>${er}</table><p style="font-size:11px;color:#666">빌더 모델 물량 기준. 단가는 프로젝트 내역 단가 적용.</p></body></html>`);
  }

  // ---------- 내역 정합: 물량은 있는데 내역(P.boq)에 없거나 단가 0인 코드 ----------
  function gapBanner(sum, boqMap) {
    const missing = [...sum.keys()].filter(c => !boqMap[c]);
    const zero = [...sum.keys()].filter(c => boqMap[c] && !(boqMap[c].price > 0));
    if (!missing.length && !zero.length) return;
    const def = Object.fromEntries(DEFAULT_BOQ.map(b => [b.code, b]));
    const fillable = missing.filter(c => def[c]);
    const box = h('div', { class: 'card', style: { margin: '0 0 10px', borderColor: 'var(--warn)' } });
    if (missing.length) box.append(h('div', { class: 't' }, `내역 미등록 코드 ${missing.length}개 — ${missing.join(', ')}`), h('div', { class: 'd' }, '물량은 산출되지만 내역에 없어 금액이 0원이고, 기성검토·설계변경 금액에서도 빠집니다.' + (fillable.length ? ` ${fillable.map(c => def[c].name).join(', ')}은(는) 기본 내역 단가로 바로 보충할 수 있습니다.` : '')));
    if (zero.length) box.append(h('div', { class: 'd', style: { marginTop: missing.length ? '6px' : 0 } }, `단가 0원 내역 ${zero.length}개 — ${zero.map(c => `${c} ${boqMap[c].name}`).join(', ')}`));
    box.append(h('div', { class: 'row', style: { marginTop: '8px' } },
      fillable.length ? h('button', { class: 'btn sm primary', onclick: () => { const n = fillDefaults(); toast(`기본 내역 ${n}개를 추가했습니다 (기존 내역·단가는 그대로)`, 'ok'); render(); } }, '기본 내역 단가로 보충') : null,
      (missing.length > fillable.length || zero.length) ? h('button', { class: 'btn sm', onclick: () => editBoq(missing.filter(c => !def[c])) }, '내역·단가 직접 입력') : null));
    w.append(box);
  }
  function fillDefaults() {
    const have = new Set(P.boq.map(b => b.code)); let n = 0;
    for (const b of DEFAULT_BOQ) if (!have.has(b.code)) { P.boq.push({ ...b }); n++; }
    if (n) ctx.touch('meta'); return n;
  }

  function exportCSV(rows) {
    const boqMap = Object.fromEntries(P.boq.map(b => [b.code, b]));
    const out = [['도면', '공종', '층', '구역', '태그', '객체', '코드', '명칭', '수량', '단위', '단가', '금액', '근거']];
    for (const r of rows) { const b = boqMap[r.code] || {}; out.push([r.sheet.name, r.sheet.disc, r.level.name, r.el.zone || '', r.el.tag || '', elName(r.el), r.code, b.name || '', r.qty.toFixed(4), b.unit || '', b.price || 0, Math.round(r.qty * (b.price || 0)), r.desc || '']); }
    saveFile(`${P.name}_물량산출.csv`.replace(/[\\/:*?"<>|]/g, '_'), csv(out));
  }
  async function editBoq(addCodes = []) {
    const list = JSON.parse(JSON.stringify(P.boq)); const body = h('div');
    for (const c of Array.isArray(addCodes) ? addCodes : []) if (!list.some(b => b.code === c)) list.push({ code: c, name: '', unit: '', price: 0 });
    const draw = () => {
      body.innerHTML = '';
      body.append(h('div', { class: 'tbl', style: { maxHeight: '50vh' } }, table([
        { label: '코드', render: r => { const i = h('input', { value: r.code, style: { width: '70px' } }); i.oninput = () => r.code = i.value.toUpperCase(); return i; } },
        { label: '명칭', render: r => { const i = h('input', { value: r.name }); i.oninput = () => r.name = i.value; return i; } },
        { label: '단위', render: r => { const i = h('input', { value: r.unit, style: { width: '60px' } }); i.oninput = () => r.unit = i.value; return i; } },
        { label: '단가(원)', render: r => { const i = h('input', { type: 'number', value: r.price }); i.oninput = () => r.price = +i.value; return i; } },
        { label: '', render: r => h('button', { type: 'button', class: 'btn sm', onclick: () => { list.splice(list.indexOf(r), 1); draw(); } }, '삭제') },
      ], list)));
      body.append(h('div', { class: 'note', style: { marginTop: '6px' } }, '자동 산출 코드: ' + DEFAULT_BOQ.map(b => `${b.code} ${b.name}`).join(', ')));
      const lack = DEFAULT_BOQ.filter(b => !list.some(x => x.code === b.code));
      body.append(h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { type: 'button', class: 'btn sm', onclick: () => { list.push({ code: 'NEW' + (list.length + 1), name: '', unit: '', price: 0 }); draw(); } }, '+ 항목 추가'),
        lack.length ? h('button', { type: 'button', class: 'btn sm', onclick: () => { for (const b of lack) list.push({ ...b }); draw(); } }, `기본 내역 중 없는 ${lack.length}개 추가`) : null));
    };
    draw();
    const ok = await dialog({ title: '내역·단가 편집', body, wide: true, ok: '저장' }); if (!ok) return;
    const codes = list.map(b => b.code.trim()).filter(Boolean); const dup = codes.filter((c, i) => codes.indexOf(c) !== i);
    if (dup.length) return toast(`코드가 중복됩니다: ${[...new Set(dup)].join(', ')}`, 'err');
    P.boq = list.filter(b => b.code.trim()); ctx.touch('meta'); render(); toast('내역을 저장했습니다', 'ok');
  }
  render();
  const off = ctx.bus.on('model', render);
  return { unmount() { off(); } };
}
