// 빌더 기성 — 회차별 진척률 × 모델 물량 vs 협력사 청구 대비 검토
import { h, toast, dialog, confirmBox, saveFile, table, approvalCell, loadScript } from '../js/ui.js';
import { takeoff, billReview, cumProgress, KINDS, DISC, levelOf, elName, allElements, qtyOf, isRefElement } from '../js/model.js';
import { fmt, fmt0, csv, uid, esc } from '../js/util.js';
import { readSheets, writeBook, detectColumns, matchBoq, num as xnum } from '../js/excel.js';
import { pickFile } from '../js/ui.js';

const VCOL = { '적정': 'ok', '초과청구': 'bad', '과소청구': 'warn', '-': '' };

export function mount(root, ctx) {
  const P = ctx.P; P.bill ||= { periods: [] }; P.bill.tolPct ??= 2;
  const st = { pi: Math.max(0, P.bill.periods.length - 1), level: '', kind: '', disc: '', zone: '', tab: 'review' };
  const page = h('div', { class: 'page' }); const w = h('div', { class: 'wrap' }); page.append(w); root.append(page);
  const per = () => P.bill.periods[st.pi];

  function render() {
    w.innerHTML = '';
    w.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('div', {}, h('h1', {}, '기성검토'), h('div', { class: 'sub' }, '객체별 누계 진척률 × 모델 물량 = 검토 기성량. 협력사 청구량과 비교해 초과·과소 청구를 판정합니다.')),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: addPeriod }, '+ 회차 추가'))));
    if (!P.bill.periods.length) { w.append(h('div', { class: 'card', style: { marginTop: '16px' } }, h('div', { class: 't' }, '기성 회차가 없습니다'), h('div', { class: 'd' }, '"회차 추가"로 1회차를 만들고 진척률과 협력사 청구량을 입력하세요.'))); return; }
    st.pi = Math.min(st.pi, P.bill.periods.length - 1);
    // 회차 탭
    const tabs = h('div', { class: 'row', style: { margin: '14px 0' } });
    P.bill.periods.forEach((p, i) => tabs.append(h('button', { class: 'btn' + (i === st.pi ? ' on' : ''), onclick: () => { st.pi = i; render(); } }, `${p.name}${p.date ? ' · ' + p.date : ''}`)));
    tabs.append(h('button', { class: 'btn sm', onclick: editPeriod }, '회차 수정'), h('span', { class: 'note' }, '승인'), approvalCell(per(), () => { ctx.touch('meta'); render(); }, `${per().name} 기성 승인 상태`), h('span', { class: 'note' }, `허용 오차 ±${P.bill.tolPct}%`), h('button', { class: 'btn sm', onclick: async () => { const v = await dialog({ title: '판정 허용 오차', fields: [{ key: 't', label: '청구량 차이 허용(%)', type: 'number', value: P.bill.tolPct }] }); if (v?.t != null) { P.bill.tolPct = v.t; ctx.touch('meta'); render(); } } }, '변경'));
    w.append(tabs);
    const sub = h('div', { class: 'row', style: { marginBottom: '12px' } });
    for (const [k, l] of [['review', '① 검토 결과'], ['claim', '② 청구량 입력'], ['prog', '③ 진척률 입력'], ['status', '④ 현황 (S-커브·구역)']]) sub.append(h('button', { class: 'btn' + (st.tab === k ? ' primary' : ''), onclick: () => { st.tab = k; render(); } }, l));
    sub.append(h('button', { class: 'btn', onclick: () => { ctx.state.period3d = st.pi; ctx.go('view3d'); } }, '3D에서 진척 보기'), h('button', { class: 'btn', onclick: () => { ctx.state.progView = st.pi; ctx.go('cad'); } }, '도면에서 영역 마킹'));
    w.append(sub);
    const rows = takeoff(P);
    const known = new Set(P.boq.map(b => b.code)); const miss = [...new Set(rows.map(r => r.code))].filter(c => !known.has(c));
    if (miss.length) w.append(h('div', { class: 'card', style: { marginBottom: '12px', borderColor: 'var(--warn)' } }, h('div', { class: 't' }, `내역 미등록 코드 ${miss.length}개 — ${miss.join(', ')}`), h('div', { class: 'd' }, '이 코드의 물량은 기성 검토에서 빠집니다. 물량산출에서 내역을 보충하세요.'), h('button', { class: 'btn sm', style: { marginTop: '6px' }, onclick: () => ctx.go('qto') }, '물량산출로 이동')));
    if (st.tab === 'review') renderReview(rows); else if (st.tab === 'claim') renderClaim(rows); else if (st.tab === 'status') renderStatus(rows); else renderProg(rows);
  }

  function renderReview(rows) {
    const rv = billReview(P, st.pi, rows);
    const amt = (r, q) => q == null ? null : q * r.price;
    const tot = { contract: 0, cum: 0, rev: 0, claim: 0 };
    for (const r of rv) { tot.contract += r.contract * r.price; tot.cum += r.cum * r.price; tot.rev += r.thisQty * r.price; tot.claim += (r.claim ?? 0) * r.price; }
    const issues = rv.filter(r => r.verdict === '초과청구' || r.verdict === '과소청구');
    w.append(h('div', { class: 'cards', style: { marginBottom: '14px' } },
      card('금회 검토 기성금', fmt0(tot.rev) + '원'), card('금회 청구 기성금', fmt0(tot.claim) + '원', tot.claim > tot.rev * (1 + P.bill.tolPct / 100) ? 'bad' : ''),
      card('차액(청구-검토)', fmt0(tot.claim - tot.rev) + '원', tot.claim - tot.rev > 0 ? 'bad' : 'ok'), card('누계 기성률', tot.contract ? fmt(tot.cum / tot.contract * 100, 2) + '%' : '-'),
      card('판정 이상 항목', issues.length + '건', issues.length ? 'bad' : 'ok')));
    w.append(h('div', { class: 'tbl' }, table([
      { label: '코드', key: 'code' }, { label: '공종', key: 'name' }, { label: '단위', key: 'unit' },
      { label: '설계 물량', num: true, render: r => fmt(r.contract, 2) }, { label: '전회 누계', num: true, render: r => fmt(r.prevCum, 2) },
      { label: '금회 검토량', num: true, render: r => fmt(r.thisQty, 2) }, { label: '금회 청구량', num: true, render: r => r.claim == null ? '-' : fmt(r.claim, 2) },
      { label: '차이', num: true, render: r => r.diff == null ? '-' : fmt(r.diff, 2), cls: r => r.diff > 0 && r.verdict !== '적정' ? 'bad' : '' },
      { label: '차이율', num: true, render: r => r.diffPct == null ? '-' : isFinite(r.diffPct) ? fmt(r.diffPct, 1) + '%' : '검토량 0' },
      { label: '판정', render: r => h('span', { class: 'pill ' + VCOL[r.verdict] }, r.verdict) },
      { label: '검토 금액', key: 'revAmt', num: true, render: r => fmt0(amt(r, r.thisQty)) }, { label: '청구 금액', key: 'claimAmt', num: true, render: r => r.claim == null ? '-' : fmt0(amt(r, r.claim)) },
      { label: '누계율', num: true, render: r => r.contract ? fmt(r.cum / r.contract * 100, 1) + '%' : '-' },
    ], rv, { foot: { name: '합계', revAmt: fmt0(tot.rev), claimAmt: fmt0(tot.claim) } })));
    if (issues.length) {
      w.append(h('h2', {}, '검토 의견'));
      const ul = h('div', { class: 'card' });
      for (const r of issues) ul.append(h('div', { style: { margin: '4px 0' } }, h('span', { class: 'pill ' + VCOL[r.verdict] }, r.verdict), ` ${r.name}: 청구 ${fmt(r.claim, 2)}${r.unit} / 검토 ${fmt(r.thisQty, 2)}${r.unit} (차이 ${fmt(r.diff, 2)}${r.unit}, ${isFinite(r.diffPct) ? fmt(r.diffPct, 1) + '%' : '검토량 0'}) → ${r.verdict === '초과청구' ? '검토량 기준 조정 또는 추가 진척 근거(검측서·사진) 요청' : '청구 누락 여부 협력사 확인'}`));
      w.append(ul);
    }
    w.append(h('div', { class: 'row', style: { marginTop: '14px' } },
      h('button', { class: 'btn', onclick: () => exportXLSX(rv, tot, issues) }, '엑셀 내보내기'), h('button', { class: 'btn', onclick: () => exportCSV(rv) }, 'CSV 내보내기'), h('button', { class: 'btn', onclick: () => exportHTML(rv, tot, issues) }, '검토서(HTML) 내보내기')));
  }
  const card = (t, v, cls) => h('div', { class: 'card' }, h('div', { class: 'note' }, t), h('div', { class: 'mono', style: { fontSize: '18px', fontWeight: 600, color: cls === 'bad' ? 'var(--bad)' : cls === 'ok' ? 'var(--ok)' : 'var(--fg)' } }, v));

  function renderClaim(rows) {
    const p = per(); p.claim ||= {};
    const rv = billReview(P, st.pi, rows);
    w.append(h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '8px' } }, h('div', { class: 'note' }, `${p.name} 협력사 청구서의 금회 청구 수량을 입력하세요. 비워두면 판정하지 않습니다.`), h('button', { class: 'btn primary', onclick: () => importExcel(p) }, '엑셀 청구서 불러오기')));
    if (p.claimSrc) w.append(h('div', { class: 'note', style: { marginBottom: '8px' } }, `불러온 청구서: ${p.claimSrc.file} (${p.claimSrc.sheet}) · ${new Date(p.claimSrc.at).toLocaleString('ko-KR')} · ${p.claimSrc.rows.length}행 중 ${p.claimSrc.rows.filter(r => r.code).length}행 반영`));
    w.append(h('div', { class: 'tbl' }, table([
      { label: '코드', key: 'code' }, { label: '공종', key: 'name' }, { label: '단위', key: 'unit' }, { label: '금회 검토량', num: true, render: r => fmt(r.thisQty, 3) },
      { label: '금회 청구량', render: r => { const i = h('input', { type: 'number', step: 'any', value: p.claim[r.code] ?? '' }); i.onchange = () => { if (i.value === '') delete p.claim[r.code]; else p.claim[r.code] = +i.value; ctx.touch('meta'); }; return i; } },
      { label: '', render: r => h('button', { class: 'btn sm', onclick: () => { p.claim[r.code] = +r.thisQty.toFixed(3); ctx.touch('meta'); render(); } }, '검토량 복사') },
    ], rv)));
    const ta = h('textarea', { rows: 4, class: 'mono', placeholder: '청구서에서 복사해 붙여넣기 — 한 줄에 "코드, 수량" 또는 "공종명 수량" (예: CON 112.5 / 철근 14.42)' , style: { width: '100%', marginTop: '12px' } });
    w.append(ta, h('button', { class: 'btn', style: { marginTop: '6px' }, onclick: () => {
      let n = 0; for (const line of ta.value.split(/\n/)) { const m = line.trim().match(/^(.+?)[\s,\t]+([-\d.,]+)\s*$/); if (!m) continue; const key = m[1].trim(), q = +m[2].replace(/,/g, ''); const b = P.boq.find(x => x.code.toUpperCase() === key.toUpperCase()) || P.boq.find(x => x.name.includes(key) || key.includes(x.name.split(' ')[0])); if (b && isFinite(q)) { p.claim[b.code] = q; n++; } }
      ctx.touch('meta'); toast(`${n}개 항목 반영`, n ? 'ok' : 'err'); render(); } }, '붙여넣은 청구량 반영'));
  }

  function renderStatus(rows) {
    const pers = P.bill.periods; const totC = P.boq.reduce((s, b) => s + rows.filter(r => r.code === b.code).reduce((a, r) => a + r.qty, 0) * b.price, 0) || 1;
    const pts = pers.map((p, i) => { const rv = billReview(P, i, rows); const cum = rv.reduce((s, r) => s + r.cum * r.price, 0), th = rv.reduce((s, r) => s + r.thisQty * r.price, 0), cl = rv.reduce((s, r) => s + (r.claim ?? 0) * r.price, 0); return { p, i, act: cum / totC * 100, plan: p.plan ?? null, th, cl }; });
    // S-커브 SVG
    const Wd = 720, Hd = 260, pad = 40, n = Math.max(1, pts.length);
    const X = (i) => pad + (Wd - pad * 2) * (n === 1 ? 0.5 : i / (n - 1)), Y = (v) => Hd - pad - (Hd - pad * 2) * v / 100;
    const line = (key, col, dash) => { const q = pts.filter(x => x[key] != null); if (!q.length) return ''; return `<polyline fill="none" stroke="${col}" stroke-width="2.5" ${dash ? 'stroke-dasharray="6 5"' : ''} points="${q.map(x => `${X(x.i)},${Y(x[key])}`).join(' ')}"/>` + q.map(x => `<circle cx="${X(x.i)}" cy="${Y(x[key])}" r="4" fill="${col}"><title>${x.p.name} ${key === 'act' ? '실적' : '계획'} ${x[key].toFixed(1)}%</title></circle>`).join(''); };
    const maxBar = Math.max(1, ...pts.map(x => Math.max(x.th, x.cl)));
    const bars = pts.map(x => `<rect x="${X(x.i) - 14}" y="${Hd - pad - 60 * x.th / maxBar}" width="12" height="${60 * x.th / maxBar}" fill="#4ea1ff66"><title>검토 ${fmt0(x.th)}원</title></rect><rect x="${X(x.i) + 2}" y="${Hd - pad - 60 * x.cl / maxBar}" width="12" height="${60 * x.cl / maxBar}" fill="#ef5f5f66"><title>청구 ${fmt0(x.cl)}원</title></rect>`).join('');
    const grid = [0, 25, 50, 75, 100].map(v => `<line x1="${pad}" x2="${Wd - pad}" y1="${Y(v)}" y2="${Y(v)}" stroke="#2a3342"/><text x="${pad - 6}" y="${Y(v) + 4}" fill="#6f7a8d" font-size="11" text-anchor="end">${v}%</text>`).join('') + pts.map(x => `<text x="${X(x.i)}" y="${Hd - pad + 16}" fill="#a9b1c1" font-size="11" text-anchor="middle">${esc(x.p.name)}</text>`).join('');
    w.append(h('h2', {}, '누계 기성률 S-커브'), h('div', { class: 'card', html: `<svg viewBox="0 0 ${Wd} ${Hd}" style="width:100%;height:auto">${grid}${bars}${line('plan', '#a9b1c1', true)}${line('act', '#3fbf7f')}</svg>` }),
      h('div', { class: 'legend', style: { margin: '6px 0' } }, h('span', {}, h('i', { style: { background: '#3fbf7f' } }), '실적 누계'), h('span', {}, h('i', { style: { background: '#a9b1c1' } }), '계획 누계 (회차 수정에서 입력)'), h('span', {}, h('i', { style: { background: '#4ea1ff' } }), '금회 검토'), h('span', {}, h('i', { style: { background: '#ef5f5f' } }), '금회 청구')));
    w.append(h('div', { class: 'tbl' }, table([{ label: '회차', render: x => x.p.name }, { label: '기준일', render: x => x.p.date || '' }, { label: '계획 누계', num: true, render: x => x.plan == null ? '-' : fmt(x.plan, 1) + '%' }, { label: '실적 누계', num: true, render: x => fmt(x.act, 2) + '%' }, { label: '차이', num: true, render: x => x.plan == null ? '-' : fmt(x.act - x.plan, 2) + '%p', cls: x => x.plan != null && x.act < x.plan ? 'bad' : '' }, { label: '금회 검토', num: true, render: x => fmt0(x.th) }, { label: '금회 청구', num: true, render: x => fmt0(x.cl) }], pts)));
    // 구역별
    const cum = cumProgress(P, st.pi); const price = Object.fromEntries(P.boq.map(b => [b.code, b.price])); const z = new Map();
    for (const r of rows) { const k = r.el.zone || '(구역 미지정)'; const x = z.get(k) || { c: 0, a: 0 }; x.c += r.qty * (price[r.code] || 0); x.a += r.qty * (price[r.code] || 0) * (cum[r.el.id] || 0) / 100; z.set(k, x); }
    w.append(h('h2', {}, `구역별 기성 — ${per().name} 기준`), h('div', { class: 'tbl' }, table([{ label: '구역', key: 'k' }, { label: '계약 금액', num: true, render: r => fmt0(r.c) }, { label: '누계 기성', num: true, render: r => fmt0(r.a) }, { label: '기성률', render: r => h('div', { class: 'row', style: { gap: '8px' } }, h('div', { class: 'bar', style: { width: '120px' } }, h('i', { style: { width: (r.c ? r.a / r.c * 100 : 0) + '%' } })), h('span', { class: 'mono note' }, fmt(r.c ? r.a / r.c * 100 : 0, 1) + '%')) }], [...z.entries()].map(([k, v]) => ({ k, ...v })))));
  }

  function renderProg(rows) {
    const p = per(); p.prog ||= {};
    const prev = st.pi > 0 ? cumProgress(P, st.pi - 1) : {}, cum = cumProgress(P, st.pi);
    const els = allElements(P, r => !isRefElement(r.el, r.sheet, P) && (!st.level || r.level.id === st.level) && (!st.kind || r.el.k === st.kind) && (!st.disc || r.sheet.disc === st.disc) && (!st.zone || (r.el.zone || '') === st.zone));
    const zones = [...new Set(allElements(P).map(r => r.el.zone).filter(Boolean))];
    const sel = (label, key, opts) => { const s = h('select'); s.append(h('option', { value: '' }, label)); for (const [v, l] of opts) s.append(h('option', { value: v, selected: st[key] === v }, l)); s.onchange = () => { st[key] = s.value; render(); }; return s; };
    const bulk = h('input', { type: 'number', min: 0, max: 100, value: 100, style: { width: '80px' } });
    w.append(h('div', { class: 'row', style: { marginBottom: '10px' } },
      sel('전체 층', 'level', P.levels.map(l => [l.id, l.name])), sel('전체 공종', 'disc', Object.entries(DISC).map(([k, d]) => [k, `${k} ${d.name}`])), sel('전체 객체', 'kind', Object.entries(KINDS).map(([k, d]) => [k, d.name])), sel('전체 구역', 'zone', zones.map(z => [z, z])),
      h('span', { class: 'note' }, `${els.length}개`), bulk, h('button', { class: 'btn primary', onclick: () => { const v = Math.max(0, Math.min(100, +bulk.value)); for (const r of els) p.prog[r.el.id] = v; ctx.touch('meta'); render(); toast(`${els.length}개 객체 누계 ${v}% 적용`, 'ok'); } }, '필터 객체에 누계% 일괄 적용')));
    w.append(h('div', { class: 'note', style: { marginBottom: '8px' } }, '값은 해당 회차까지의 누계 진척률(%)입니다. 이전 회차 값은 자동 이월됩니다.'));
    const shown = els.slice(0, 500);
    w.append(h('div', { class: 'tbl', style: { maxHeight: '60vh' } }, table([
      { label: '도면', render: r => r.sheet.name }, { label: '층', render: r => r.level.name }, { label: '구역', render: r => r.el.zone || '' },
      { label: '객체', render: r => (r.el.tag ? r.el.tag + ' · ' : '') + elName(r.el) },
      { label: '물량', render: r => h('span', { class: 'note' }, qtyOf(r.el, r.level, {}).map(q => `${q.code} ${fmt(q.qty, 2)}`).join(', ')) },
      { label: '전회 누계', num: true, render: r => (prev[r.el.id] || 0) + '%' },
      { label: '금회 누계%', render: r => { const i = h('input', { type: 'number', min: 0, max: 100, value: cum[r.el.id] ?? 0, style: { width: '80px' } }); i.onchange = () => { p.prog[r.el.id] = Math.max(0, Math.min(100, +i.value || 0)); ctx.touch('meta'); }; return i; } },
      { label: '', render: r => h('div', { class: 'row' }, ...[0, 50, 100].map(v => h('button', { class: 'btn sm', onclick: () => { p.prog[r.el.id] = v; ctx.touch('meta'); render(); } }, v + '%'))) },
    ], shown)));
    if (els.length > shown.length) w.append(h('div', { class: 'note' }, `${els.length - shown.length}개 더 있음 — 필터로 좁히거나 일괄 적용을 쓰세요.`));
  }

  async function addPeriod() {
    const n = P.bill.periods.length + 1;
    const v = await dialog({ title: '회차 추가', fields: [{ key: 'name', label: '회차명', value: `${n}회차` }, { key: 'date', label: '기준일', type: 'date', value: new Date().toISOString().slice(0, 10) }] });
    if (!v) return; P.bill.periods.push({ id: uid('b'), name: v.name || `${n}회차`, date: v.date, prog: {}, claim: {} }); st.pi = P.bill.periods.length - 1; st.tab = 'prog'; ctx.touch('meta'); render();
  }
  async function editPeriod() {
    const p = per();
    const v = await dialog({ title: '회차 수정', fields: [{ key: 'name', label: '회차명', value: p.name }, { key: 'date', label: '기준일', type: 'date', value: p.date }, { key: 'plan', label: '계획 누계 기성률(%)', type: 'number', value: p.plan ?? '' }, { key: 'del', label: '이 회차 삭제', type: 'checkbox', value: false }] });
    if (!v) return;
    if (v.del) { if (!await confirmBox('회차 삭제', `${esc(p.name)}의 진척률·청구량을 모두 삭제합니다.`, '삭제', true)) return; P.bill.periods.splice(st.pi, 1); st.pi = Math.max(0, st.pi - 1); }
    else Object.assign(p, { name: v.name || p.name, date: v.date, plan: v.plan });
    ctx.touch('meta'); render();
  }
  // ---------- 엑셀 청구서 ----------
  async function importExcel(p) {
    const f = await pickFile('.xlsx,.xls,.csv'); if (!f) return;
    let sheets; try { toast('엑셀 읽는 중…'); sheets = await readSheets(f); } catch (e) { return toast('엑셀을 읽지 못했습니다: ' + e.message, 'err'); }
    let si = 0, det = detectColumns(sheets[0].rows); sheets.forEach((s, i) => { const d = detectColumns(s.rows); if (d.score > det.score) { det = d; si = i; } });
    const body = h('div'); let map = null;
    const state = { si, name: det.name, unit: det.unit, code: det.code, qty: det.qty, start: det.header + (det.two ? 2 : 1) };
    const draw = () => {
      body.innerHTML = ''; const rows = sheets[state.si].rows; const ncol = Math.max(...rows.slice(0, 50).map(r => r.length), 1);
      const colSel = (key, label) => { const s = h('select'); s.append(h('option', { value: -1 }, '(없음)')); for (let i = 0; i < ncol; i++) s.append(h('option', { value: i, selected: state[key] === i }, `${String.fromCharCode(65 + (i % 26))}열: ${String((rows[det.header] || [])[i] ?? '').slice(0, 12)}`)); s.onchange = () => { state[key] = +s.value; draw(); }; return h('label', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } }, h('span', { class: 'note' }, label), s); };
      const shSel = h('select'); sheets.forEach((s, i) => shSel.append(h('option', { value: i, selected: i === state.si }, s.name))); shSel.onchange = () => { state.si = +shSel.value; const d = detectColumns(sheets[state.si].rows); Object.assign(state, { name: d.name, unit: d.unit, code: d.code, qty: d.qty, start: d.header + (d.two ? 2 : 1) }); draw(); };
      const st0 = h('input', { type: 'number', value: state.start + 1, style: { width: '70px' } }); st0.onchange = () => { state.start = Math.max(0, +st0.value - 1); draw(); };
      body.append(h('div', { class: 'row', style: { alignItems: 'flex-end' } }, h('label', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } }, h('span', { class: 'note' }, '시트'), shSel), colSel('name', '공종명 열'), colSel('code', '코드 열'), colSel('unit', '단위 열'), colSel('qty', '금회 수량 열'), h('label', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } }, h('span', { class: 'note' }, '데이터 시작 행'), st0)));
      map = [];
      for (let r = state.start; r < rows.length; r++) {
        const row = rows[r]; const name = String(row[state.name] ?? '').trim(); const q = xnum(row[state.qty]); if (!name || q == null || q === 0) continue; if (/합\s*계|소\s*계|총\s*계/.test(name)) continue;
        const m = matchBoq(name, state.unit >= 0 ? row[state.unit] : '', state.code >= 0 ? row[state.code] : '', P.boq); map.push({ r: r + 1, name, unit: state.unit >= 0 ? String(row[state.unit] ?? '') : '', qty: q, code: m.code, conf: m.conf });
      }
      const tb = table([{ label: '행', key: 'r' }, { label: '청구서 공종', key: 'name' }, { label: '단위', key: 'unit' }, { label: '수량', num: true, render: x => fmt(x.qty, 3) },
        { label: '→ 빌더 내역', render: x => { const s = h('select'); s.append(h('option', { value: '' }, '(제외)')); for (const b of P.boq) s.append(h('option', { value: b.code, selected: x.code === b.code }, `${b.code} ${b.name} (${b.unit})`)); s.onchange = () => { x.code = s.value; x.conf = 1; }; return s; } },
        { label: '신뢰도', render: x => h('span', { class: 'pill ' + (x.conf >= 0.8 ? 'ok' : x.conf >= 0.5 ? 'warn' : 'bad') }, x.code ? Math.round(x.conf * 100) + '%' : '미매칭') }], map);
      body.append(h('div', { class: 'tbl', style: { maxHeight: '45vh', marginTop: '10px' } }, tb), h('div', { class: 'note', style: { marginTop: '6px' } }, `${map.length}행 인식 · 같은 내역으로 매칭된 행은 수량을 합산합니다. 신뢰도 낮은 행은 직접 고르세요.`));
    };
    draw();
    const ok = await dialog({ title: `엑셀 청구서 대조 — ${f.name}`, body, wide: true, ok: `${p.name} 청구량에 반영` });
    if (!ok || !map) return;
    const agg = {}; for (const x of map) if (x.code) agg[x.code] = (agg[x.code] || 0) + x.qty;
    p.claim = { ...(p.claim || {}), ...Object.fromEntries(Object.entries(agg).map(([k, v]) => [k, +v.toFixed(4)])) };
    p.claimSrc = { file: f.name, sheet: sheets[state.si].name, at: Date.now(), rows: map.map(({ r, name, unit, qty, code }) => ({ r, name, unit, qty, code })) };
    ctx.touch('meta'); st.tab = 'review'; render(); toast(`${Object.keys(agg).length}개 내역에 청구량 반영`, 'ok');
  }
  async function exportXLSX(rv, tot, issues) {
    const p = per();
    try {
      const blob = await writeBook([
        { name: '기성검토', widths: [8, 22, 6, 12, 12, 12, 12, 12, 10, 10, 14, 14], rows: [[`${P.name} — ${p.name} 기성 검토`], [`기준일 ${p.date || ''}`, `승인 ${p.approval?.status || '작성'}${p.approval?.by ? ' (' + p.approval.by + ')' : ''}`, '', `허용오차 ±${P.bill.tolPct}%`], [],
          ['코드', '공종', '단위', '설계물량', '전회누계', '금회검토', '금회청구', '차이', '차이율(%)', '판정', '검토금액', '청구금액'],
          ...rv.map(r => [r.code, r.name, r.unit, +r.contract.toFixed(3), +r.prevCum.toFixed(3), +r.thisQty.toFixed(3), r.claim ?? '', r.diff == null ? '' : +r.diff.toFixed(3), r.diffPct == null || !isFinite(r.diffPct) ? '' : +r.diffPct.toFixed(2), r.verdict, Math.round(r.thisQty * r.price), r.claim == null ? '' : Math.round(r.claim * r.price)]),
          ['합계', '', '', '', '', '', '', '', '', '', Math.round(tot.rev), Math.round(tot.claim)]] },
        { name: '검토의견', widths: [10, 30, 60], rows: [['판정', '공종', '의견'], ...issues.map(r => [r.verdict, r.name, `청구 ${fmt(r.claim, 2)}${r.unit} / 검토 ${fmt(r.thisQty, 2)}${r.unit} (차이 ${fmt(r.diff, 2)}) → ${r.verdict === '초과청구' ? '검토량 기준 조정 또는 추가 진척 근거 요청' : '청구 누락 여부 확인'}`])] },
        ...(p.claimSrc ? [{ name: '청구서 매칭', widths: [6, 30, 8, 12, 10], rows: [['행', '청구서 공종', '단위', '수량', '빌더 내역'], ...p.claimSrc.rows.map(r => [r.r, r.name, r.unit, r.qty, r.code || '(제외)'])] }] : []),
      ]);
      saveFile(`${P.name}_${p.name}_기성검토.xlsx`.replace(/[\\/:*?"<>|]/g, '_'), blob);
    } catch (e) { toast('엑셀 만들기 실패: ' + e.message, 'err'); }
  }
  function exportCSV(rv) {
    const p = per();
    const out = [['회차', '코드', '공종', '단위', '단가', '설계물량', '전회누계', '금회검토량', '금회청구량', '차이', '차이율(%)', '판정', '검토금액', '청구금액']];
    for (const r of rv) out.push([p.name, r.code, r.name, r.unit, r.price, r.contract.toFixed(3), r.prevCum.toFixed(3), r.thisQty.toFixed(3), r.claim ?? '', r.diff == null ? '' : r.diff.toFixed(3), r.diffPct == null || !isFinite(r.diffPct) ? '' : r.diffPct.toFixed(2), r.verdict, Math.round(r.thisQty * r.price), r.claim == null ? '' : Math.round(r.claim * r.price)]);
    saveFile(`${P.name}_${p.name}_기성검토.csv`.replace(/[\\/:*?"<>|]/g, '_'), csv(out));
  }
  function exportHTML(rv, tot, issues) {
    const p = per(); const c = { '적정': '#1e7a4f', '초과청구': '#b42318', '과소청구': '#9a6700', '-': '#666' }, bg = { '적정': '#e6f4ea', '초과청구': '#fde8e8', '과소청구': '#fff4d6', '-': '#fff' };
    const tr = rv.map(r => `<tr><td>${esc(r.code)}</td><td>${esc(r.name)}</td><td>${esc(r.unit)}</td><td class=n>${fmt(r.contract, 2)}</td><td class=n>${fmt(r.prevCum, 2)}</td><td class=n>${fmt(r.thisQty, 2)}</td><td class=n>${r.claim == null ? '-' : fmt(r.claim, 2)}</td><td class=n>${r.diff == null ? '-' : fmt(r.diff, 2)}</td><td class=n>${r.diffPct == null ? '-' : isFinite(r.diffPct) ? fmt(r.diffPct, 1) + '%' : '-'}</td><td style="background:${bg[r.verdict]};color:${c[r.verdict]};font-weight:700">${r.verdict}</td><td class=n>${fmt0(r.thisQty * r.price)}</td><td class=n>${r.claim == null ? '-' : fmt0(r.claim * r.price)}</td></tr>`).join('');
    const op = issues.map(r => `<li><b style="color:${c[r.verdict]}">${r.verdict}</b> ${esc(r.name)}: 청구 ${fmt(r.claim, 2)}${esc(r.unit)} / 검토 ${fmt(r.thisQty, 2)}${esc(r.unit)} (차이 ${fmt(r.diff, 2)}) — ${r.verdict === '초과청구' ? '검토량 기준 조정 또는 추가 진척 근거 요청' : '청구 누락 여부 확인'}</li>`).join('') || '<li>판정 이상 항목 없음</li>';
    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(P.name)} ${esc(p.name)} 기성 검토서</title><style>body{font-family:'Malgun Gothic',sans-serif;margin:24px;color:#111}h1{font-size:20px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #999;padding:4px 6px}th{background:#eef}td.n{text-align:right}.s{display:flex;gap:24px;margin:12px 0}.s div{border:1px solid #ccc;padding:8px 12px}</style></head><body>
<h1>${esc(P.name)} — ${esc(p.name)} 기성 검토서</h1><div>승인 상태: <b>${esc(p.approval?.status || '작성')}</b>${p.approval?.by ? ' (' + esc(p.approval.by) + ', ' + esc(p.approval.date || '') + ')' : ''}</div><div>기준일 ${esc(p.date || '')} · 작성 ${new Date().toLocaleDateString('ko-KR')} · 판정 허용오차 ±${P.bill.tolPct}%</div>
<div class=s><div>금회 검토 기성금<br><b>${fmt0(tot.rev)}원</b></div><div>금회 청구 기성금<br><b>${fmt0(tot.claim)}원</b></div><div>차액<br><b>${fmt0(tot.claim - tot.rev)}원</b></div><div>누계 기성률<br><b>${tot.contract ? fmt(tot.cum / tot.contract * 100, 2) : '-'}%</b></div></div>
<table><tr><th>코드</th><th>공종</th><th>단위</th><th>설계물량</th><th>전회누계</th><th>금회검토</th><th>금회청구</th><th>차이</th><th>차이율</th><th>판정</th><th>검토금액</th><th>청구금액</th></tr>${tr}</table>
<h2 style="font-size:15px">검토 의견</h2><ul>${op}</ul><p style="font-size:11px;color:#666">검토량 = 객체별 누계 진척률 × 빌더 모델 물량(구조 도면 기준). 단가는 프로젝트 내역 단가 적용.</p></body></html>`;
    saveFile(`${P.name}_${p.name}_기성검토서.html`.replace(/[\\/:*?"<>|]/g, '_'), html);
  }
  render();
  const off = ctx.bus.on('model', render);
  return { unmount() { off(); } };
}
