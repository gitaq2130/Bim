// 빌더 작업일보 — 날씨·인원·장비·금일/명일 작업(공정표 연동)·이슈·사진·특기사항, 승인 상태(표기만), HTML(A4)/Excel 출력
import { h, toast, saveFile, table, approvalCell, approvalBadge, confirmBox } from '../js/ui.js';
import { esc, fmt0 } from '../js/util.js';
import { toD, toS, addDays } from './sched.js';
import { photoData } from './site.js';
import { writeBook } from '../js/excel.js';

export const WEATHER = ['맑음', '구름많음', '흐림', '비', '눈', '비/눈', '강풍', '황사'];
export const TRADES = ['현장관리', '형틀목공', '철근공', '콘크리트공', '철골공', '조적공', '미장·방수', '설비', '전기', '소방', '도장·내장', '보통인부', '신호수·안전'];
const today = () => toS(Date.now() + 9 * 3600e3); // KST 기준 날짜

export function blankDay(P, date) {
  return { weather: '맑음', tmin: null, tmax: null, rain: null, crew: [], equip: [], work: worksOn(P, date), next: worksOn(P, addDays(date, 1)).map(w => ({ text: w.text })), note: '', safety: '', created: Date.now() };
}
// 해당일에 진행 중인 공정표 활동 → 작업 항목
export function worksOn(P, date) {
  const t = toD(date); const out = [];
  for (const a of P.sched?.acts || []) {
    if (!a.start || !a.end) continue; const s = toD(a.start), e = toD(a.end);
    if (t < s || t > e) continue; const pct = Math.round((t - s + 864e5) / (e - s + 864e5) * 100);
    out.push({ text: a.name, act: a.id, pct, src: 'sched' });
  }
  return out;
}
export function dayIssues(P, date) {
  const same = (ms) => ms && toS(ms + 9 * 3600e3) === date;
  const is = P.issues || []; return { opened: is.filter(i => same(i.created)), closed: is.filter(i => same(i.closed)) };
}
export function crewTotal(d) { return (d?.crew || []).reduce((s, c) => s + (+c.n || 0), 0); }
export function cumCrew(P, date) { let s = 0; for (const [k, d] of Object.entries(P.daily || {})) if (k <= date) s += crewTotal(d); return s; }

export function mount(root, ctx) {
  const P = ctx.P; P.daily ||= {}; let date = ctx.state.dailyDate || today();
  const page = h('div', { class: 'page' }); const w = h('div', { class: 'wrap' }); page.append(w); root.append(page);
  const save = () => ctx.touch('meta');
  const D = () => P.daily[date];

  function render() {
    w.innerHTML = ''; ctx.state.dailyDate = date;
    const days = Object.keys(P.daily).sort();
    const di = h('input', { type: 'date', value: date, onchange: e => { if (e.target.value) { date = e.target.value; render(); } } });
    w.append(h('div', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' } },
      h('div', {}, h('h1', {}, '작업일보'), h('div', { class: 'sub' }, '날씨·인원·장비와 공정표에서 불러온 금일/명일 작업, 그날의 이슈·현장 사진을 한 장으로 정리합니다.')),
      h('div', { class: 'row', style: { gap: '6px' } },
        h('button', { class: 'btn', onclick: () => { date = addDays(date, -1); render(); }, title: '전날' }, '◀'), di, h('button', { class: 'btn', onclick: () => { date = addDays(date, 1); render(); }, title: '다음날' }, '▶'),
        h('button', { class: 'btn', onclick: () => { date = today(); render(); } }, '오늘'))));
    if (days.length) {
      const strip = h('div', { class: 'row', style: { gap: '4px', flexWrap: 'wrap', margin: '10px 0' } }, h('span', { class: 'note' }, `작성 ${days.length}일 ·`));
      for (const k of days.slice(-14)) strip.append(h('button', { class: 'btn sm' + (k === date ? ' primary' : ''), onclick: () => { date = k; render(); } }, k.slice(5), ' ', approvalBadge(P.daily[k].approval)));
      w.append(strip);
    }
    const d = D();
    if (!d) {
      const prev = days.filter(k => k < date).pop();
      w.append(h('div', { class: 'card', style: { marginTop: '14px' } }, h('div', { class: 't' }, `${date} 작업일보가 없습니다`),
        h('div', { class: 'd' }, (P.sched?.acts?.length ? `공정표에서 이날 진행 중인 작업 ${worksOn(P, date).length}건을 불러와 시작합니다.` : '공정표가 없으면 작업 항목을 직접 입력합니다.')),
        h('div', { class: 'row', style: { marginTop: '10px', gap: '6px' } },
          h('button', { class: 'btn primary', onclick: () => { P.daily[date] = blankDay(P, date); save(); render(); } }, '새로 작성'),
          prev ? h('button', { class: 'btn', onclick: () => { copyFrom(prev); } }, `전일(${prev}) 인원·장비 복사해 작성`) : null)));
      return;
    }
    const iss = dayIssues(P, date); const photos = (P.photos || []).filter(p => p.date === date);
    // 머리
    w.append(h('div', { class: 'row', style: { margin: '12px 0', gap: '8px', flexWrap: 'wrap' } },
      h('span', { class: 'pill acc' }, `${date} (${'일월화수목금토'[new Date(toD(date)).getUTCDay()]})`), approvalCell(d, () => { save(); render(); }, `작업일보 ${date} 승인 상태`),
      h('span', { class: 'note' }, `금일 인원 ${crewTotal(d)}명 · 누계 ${fmt0(cumCrew(P, date))}명`),
      h('div', { style: { flex: 1 } }),
      h('button', { class: 'btn', onclick: () => { const prev = days.filter(k => k < date).pop(); if (!prev) return toast('이전 일보가 없습니다'); copyFrom(prev, true); } }, '전일 인원·장비 복사'),
      h('button', { class: 'btn', onclick: exportXLSX }, 'Excel'), h('button', { class: 'btn primary', onclick: exportHTML }, '일보 출력(A4)'),
      h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('작업일보 삭제', `${date} 작업일보를 삭제할까요?`, '삭제', true)) { delete P.daily[date]; save(); render(); } } }, '삭제')));
    // 날씨
    const inp = (o, k, attrs = {}) => h('input', { value: o[k] ?? '', ...attrs, onchange: e => { const v = e.target.value; o[k] = attrs.type === 'number' ? (v === '' ? null : +v) : v; save(); if (attrs.rerender) render(); } });
    const ws = h('select', { onchange: e => { d.weather = e.target.value; save(); } }); for (const x of WEATHER) ws.append(h('option', { selected: d.weather === x }, x));
    w.append(sec('날씨', h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap' } }, lab('날씨', ws), lab('최저 ℃', inp(d, 'tmin', { type: 'number', style: { width: '70px' } })), lab('최고 ℃', inp(d, 'tmax', { type: 'number', style: { width: '70px' } })), lab('강수 mm', inp(d, 'rain', { type: 'number', style: { width: '70px' } })),
      (d.tmin != null && d.tmin <= -5) ? h('span', { class: 'pill warn' }, '한중 콘크리트 주의') : null, (d.tmax != null && d.tmax >= 33) ? h('span', { class: 'pill warn' }, '폭염 — 서중 콘크리트·온열질환 주의') : null, (d.rain >= 10) ? h('span', { class: 'pill warn' }, '우천 — 타설·고소작업 검토') : null)));
    // 인원
    w.append(sec(`출력 인원 (${crewTotal(d)}명)`, editList(d.crew, [{ k: 'trade', label: '공종', list: 'dl-trade', w: '160px' }, { k: 'co', label: '업체', w: '140px' }, { k: 'n', label: '인원', type: 'number', w: '70px' }, { k: 'memo', label: '비고' }], () => ({ trade: '', co: '', n: null, memo: '' }), '인원 추가'),
      h('datalist', { id: 'dl-trade' }, TRADES.map(t => h('option', { value: t })))));
    w.append(sec('투입 장비', editList(d.equip, [{ k: 'name', label: '장비', w: '160px', list: 'dl-eq' }, { k: 'spec', label: '규격', w: '140px' }, { k: 'n', label: '대수', type: 'number', w: '70px' }, { k: 'memo', label: '비고' }], () => ({ name: '', spec: '', n: 1, memo: '' }), '장비 추가'),
      h('datalist', { id: 'dl-eq' }, ['타워크레인', '이동식크레인', '굴착기', '덤프트럭', '펌프카', '레미콘', '지게차', '고소작업차', '항타기', '카고크레인'].map(t => h('option', { value: t })))));
    // 작업
    const reload = (k, dt) => h('button', { class: 'btn sm', onclick: () => { const add = worksOn(P, dt).filter(x => !d[k].some(y => y.act && y.act === x.act)); for (const x of add) d[k].push(k === 'next' ? { text: x.text, act: x.act } : x); save(); render(); toast(add.length ? `${add.length}건 추가` : '추가할 공정 활동이 없습니다'); } }, '공정표에서 불러오기');
    w.append(sec('금일 작업', editList(d.work, [{ k: 'text', label: '작업 내용' }, { k: 'loc', label: '위치', w: '120px' }, { k: 'pct', label: '진척 %', type: 'number', w: '70px' }], () => ({ text: '', loc: '', pct: null }), '작업 추가', x => x.src === 'sched' ? h('span', { class: 'pill', title: '공정표 활동', style: { whiteSpace: 'nowrap' } }, '공정') : null), reload('work', date)));
    w.append(sec('명일 작업', editList(d.next, [{ k: 'text', label: '작업 내용' }, { k: 'loc', label: '위치', w: '120px' }], () => ({ text: '', loc: '' }), '작업 추가'), reload('next', addDays(date, 1))));
    // 이슈
    const il = (arr) => arr.length ? h('div', { class: 'tbl' }, table([{ label: '번호', render: i => '#' + i.no }, { label: '유형', key: 'type' }, { label: '제목', key: 'title' }, { label: '담당', key: 'assignee' }, { label: '상태', key: 'status' }, { label: '', render: i => h('button', { class: 'btn sm', onclick: () => { ctx.state.issueSel = i.id; ctx.go('issue'); } }, '열기') }], arr)) : h('div', { class: 'note' }, '없음');
    w.append(sec(`이슈 (신규 ${iss.opened.length} · 완료 ${iss.closed.length})`, h('div', {}, h('div', { class: 'd', style: { margin: '2px 0 4px' } }, '신규'), il(iss.opened), h('div', { class: 'd', style: { margin: '8px 0 4px' } }, '완료'), il(iss.closed))));
    // 사진
    const pg = h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } });
    if (!photos.length) pg.append(h('div', { class: 'note' }, '이날 촬영일로 등록된 현장 사진이 없습니다. 현장 도구에서 사진을 올리면 자동으로 들어옵니다.'));
    for (const p of photos) { const im = h('img', { style: { width: '150px', height: '110px', objectFit: 'cover', borderRadius: '6px', background: 'var(--bg2)' } }); photoData(ctx, P, p.id, true).then(s => { if (s) im.src = s; }); pg.append(h('div', { style: { width: '150px' } }, im, h('div', { class: 'note', style: { fontSize: '11px' } }, [p.stage, p.note || p.name].filter(Boolean).join(' · ')))); }
    w.append(sec(`현장 사진 (${photos.length})`, pg, h('button', { class: 'btn sm', onclick: () => ctx.go('site') }, '현장 도구')));
    // 특기
    const ta = (k, ph) => h('textarea', { rows: 3, style: { width: '100%' }, placeholder: ph, onchange: e => { d[k] = e.target.value; save(); } }, d[k] || '');
    w.append(sec('안전·환경', ta('safety', 'TBM·위험성평가, 안전점검 결과, 재해·아차사고, 환경(소음·분진) 등')));
    w.append(sec('특기사항', ta('note', '감리 지시, 자재 반입·검수, 협의 사항 등')));
  }
  function sec(title, body, extra) { return h('div', { class: 'card', style: { marginTop: '12px' } }, h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '6px' } }, h('div', { class: 't' }, title), extra || null), body); }
  function lab(t, el) { return h('label', { class: 'row', style: { gap: '4px' } }, h('span', { class: 'note' }, t), el); }
  function editList(arr, cols, mk, addLabel, badge) {
    const box = h('div');
    const tbl = h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, badge ? h('th', { style: { width: '54px' } }) : null, cols.map(c => h('th', { class: c.type === 'number' ? 'num' : '', style: c.w ? { width: c.w } : null }, c.label)), h('th', { style: { width: '30px' } }))));
    const tb = h('tbody'); tbl.append(tb);
    arr.forEach((r, i) => tb.append(h('tr', {}, badge ? h('td', {}, badge(r)) : null,
      cols.map(c => h('td', { class: c.type === 'number' ? 'num' : '' }, h('input', { value: r[c.k] ?? '', type: c.type || 'text', list: c.list || null, style: { width: '100%', textAlign: c.type === 'number' ? 'right' : 'left' }, onchange: e => { const v = e.target.value; r[c.k] = c.type === 'number' ? (v === '' ? null : +v) : v; if (r.src === 'sched' && c.k === 'text') r.src = 'edit'; save(); if (c.k === 'n') render(); } }))),
      h('td', {}, h('button', { class: 'btn sm', title: '삭제', onclick: () => { arr.splice(i, 1); save(); render(); } }, '×')))));
    if (!arr.length) tb.append(h('tr', {}, h('td', { colspan: cols.length + 2, class: 'note' }, '항목 없음')));
    box.append(h('div', { class: 'tbl' }, tbl), h('button', { class: 'btn sm', style: { marginTop: '6px' }, onclick: () => { arr.push(mk()); save(); render(); setTimeout(() => { const ins = box.querySelectorAll('tbody tr:last-child input'); ins[0]?.focus(); }, 0); } }, '+ ' + addLabel));
    return box;
  }
  function copyFrom(prev, merge = false) {
    const s = P.daily[prev]; const d = merge ? D() : (P.daily[date] = blankDay(P, date));
    d.crew = s.crew.map(c => ({ ...c })); d.equip = s.equip.map(c => ({ ...c })); if (!merge) d.weather = s.weather;
    save(); render(); toast(`${prev} 인원·장비를 복사했습니다`);
  }
  async function exportHTML() {
    const d = D(); const iss = dayIssues(P, date); const photos = (P.photos || []).filter(p => p.date === date).slice(0, 8);
    const imgs = await Promise.all(photos.map(p => photoData(ctx, P, p.id, true)));
    const tr = (cells, th) => `<tr>${cells.map(c => `<${th ? 'th' : 'td'}>${c}</${th ? 'th' : 'td'}>`).join('')}</tr>`;
    const tblH = (head, rows) => `<table>${tr(head, true)}${rows.length ? rows.map(r => tr(r.map(esc))).join('') : `<tr><td colspan="${head.length}" class="n">-</td></tr>`}</table>`;
    const ap = d.approval || {};
    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>작업일보 ${date}</title><style>
@page{size:A4;margin:14mm}body{font-family:'Malgun Gothic',sans-serif;color:#111;font-size:12px;max-width:182mm;margin:auto}h1{text-align:center;font-size:22px;letter-spacing:8px;margin:6px 0 10px}
table{border-collapse:collapse;width:100%;margin:4px 0 10px}th,td{border:1px solid #444;padding:4px 6px;text-align:left;vertical-align:top}th{background:#eef0f3;font-weight:600}td.n{color:#888;text-align:center}
h2{font-size:13px;margin:10px 0 2px;border-left:4px solid #335;padding-left:6px}.g{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ph{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.ph img{width:100%;height:30mm;object-fit:cover;border:1px solid #999}.ph div{font-size:10px;color:#444}
.top td,.top th{text-align:center}.sign{width:auto;float:right;margin-top:-6px}.sign td{width:22mm;height:14mm}.pre{white-space:pre-wrap;min-height:12mm}</style></head><body>
<table class="sign"><tr><th>작성</th><th>검토</th><th>승인</th></tr><tr><td></td><td></td><td>${ap.status === '승인' ? esc(ap.by || '승인') : ''}</td></tr></table>
<h1>작 업 일 보</h1><table class="top">${tr(['공사명', '일자', '날씨', '기온(℃)', '강수(mm)', '상태'], true)}${tr([esc(P.name), `${date} (${'일월화수목금토'[new Date(toD(date)).getUTCDay()]})`, esc(d.weather), `${d.tmin ?? '-'} / ${d.tmax ?? '-'}`, d.rain ?? '-', esc(ap.status || '작성')])}</table>
<div class="g"><div><h2>출력 인원 — 금일 ${crewTotal(d)}명 · 누계 ${fmt0(cumCrew(P, date))}명</h2>${tblH(['공종', '업체', '인원', '비고'], d.crew.map(c => [c.trade, c.co, c.n ?? '', c.memo]))}</div>
<div><h2>투입 장비</h2>${tblH(['장비', '규격', '대수', '비고'], d.equip.map(c => [c.name, c.spec, c.n ?? '', c.memo]))}</div></div>
<div class="g"><div><h2>금일 작업</h2>${tblH(['작업 내용', '위치', '진척'], d.work.map(c => [c.text, c.loc || '', c.pct != null ? c.pct + '%' : '']))}</div>
<div><h2>명일 작업</h2>${tblH(['작업 내용', '위치'], d.next.map(c => [c.text, c.loc || '']))}</div></div>
<h2>이슈</h2>${tblH(['구분', '번호', '유형', '제목', '담당', '상태'], [...iss.opened.map(i => ['신규', '#' + i.no, i.type, i.title, i.assignee, i.status]), ...iss.closed.map(i => ['완료', '#' + i.no, i.type, i.title, i.assignee, i.status])])}
<h2>안전·환경</h2><table><tr><td class="pre">${esc(d.safety || '')}</td></tr></table><h2>특기사항</h2><table><tr><td class="pre">${esc(d.note || '')}</td></tr></table>
${photos.length ? `<h2>현장 사진</h2><div class="ph">${photos.map((p, i) => `<div>${imgs[i] ? `<img src="${imgs[i]}">` : ''}${esc([p.stage, p.note || p.name].filter(Boolean).join(' · '))}</div>`).join('')}</div>` : ''}
<p style="color:#888;font-size:10px;margin-top:12px">빌더 작업일보 · 출력 ${new Date().toLocaleString('ko-KR')}</p></body></html>`;
    saveFile(`${P.name.replace(/[\\/:*?"<>|]/g, '_')}_작업일보_${date}.html`, html);
  }
  async function exportXLSX() {
    const d = D(); const iss = dayIssues(P, date);
    const rows = [['작업일보', P.name], ['일자', date, '날씨', d.weather, '기온', `${d.tmin ?? '-'} / ${d.tmax ?? '-'}`, '강수', d.rain ?? ''], ['승인 상태', d.approval?.status || '작성', d.approval?.by || ''], [],
      ['[출력 인원]', '', '금일', crewTotal(d), '누계', cumCrew(P, date)], ['공종', '업체', '인원', '비고'], ...d.crew.map(c => [c.trade, c.co, c.n ?? '', c.memo]), [],
      ['[투입 장비]'], ['장비', '규격', '대수', '비고'], ...d.equip.map(c => [c.name, c.spec, c.n ?? '', c.memo]), [],
      ['[금일 작업]'], ['작업 내용', '위치', '진척 %'], ...d.work.map(c => [c.text, c.loc || '', c.pct ?? '']), [],
      ['[명일 작업]'], ['작업 내용', '위치'], ...d.next.map(c => [c.text, c.loc || '']), [],
      ['[이슈]'], ['구분', '번호', '유형', '제목', '담당', '상태'], ...iss.opened.map(i => ['신규', i.no, i.type, i.title, i.assignee, i.status]), ...iss.closed.map(i => ['완료', i.no, i.type, i.title, i.assignee, i.status]), [],
      ['[안전·환경]', d.safety || ''], ['[특기사항]', d.note || '']];
    // 월간 인원 집계 (공종 × 일자)
    const ym = date.slice(0, 7); const ds = Object.keys(P.daily).filter(k => k.startsWith(ym)).sort();
    const trades = [...new Set(ds.flatMap(k => P.daily[k].crew.map(c => c.trade || '기타')))];
    const mon = [['공종', ...ds.map(k => k.slice(5)), '계'], ...trades.map(t => { const v = ds.map(k => P.daily[k].crew.filter(c => (c.trade || '기타') === t).reduce((s, c) => s + (+c.n || 0), 0)); return [t, ...v, v.reduce((a, b) => a + b, 0)]; }),
      ['합계', ...ds.map(k => crewTotal(P.daily[k])), ds.reduce((s, k) => s + crewTotal(P.daily[k]), 0)]];
    const blob = await writeBook([{ name: date, rows, widths: [28, 18, 10, 30, 10, 10, 8, 8] }, { name: `${ym} 인원집계`, rows: mon, widths: [14, ...ds.map(() => 6), 8] }]);
    saveFile(`${P.name.replace(/[\\/:*?"<>|]/g, '_')}_작업일보_${date}.xlsx`, blob);
  }
  render();
  return { unmount() { } };
}
