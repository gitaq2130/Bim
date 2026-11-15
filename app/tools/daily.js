// 빌더 작업일보 — 날씨·인원·장비·금일/명일 작업(공정표 연동)·자재 반입·품질시험·지시사항·이슈·사진·특기사항, 승인 상태(표기만)
// 출력 양식(발주처·보고 대상별): 일자 레코드의 d.form / d.signs 에 저장, 새 일보는 직전 일보의 양식을 이어받음. HTML(A4)/Excel 출력
import { h, toast, saveFile, table, approvalCell, approvalBadge, confirmBox, dialog } from '../js/ui.js';
import { esc, fmt0 } from '../js/util.js';
import { toD, toS, addDays, daysBetween, plannedPct } from './sched.js';
import { photoData, progressReport } from './site.js';
import { writeBook } from '../js/excel.js';

export const WEATHER = ['맑음', '구름많음', '흐림', '비', '눈', '비/눈', '강풍', '황사'];
export const TRADES = ['현장관리', '형틀목공', '철근공', '콘크리트공', '철골공', '조적공', '미장·방수', '설비', '전기', '소방', '도장·내장', '보통인부', '신호수·안전'];
export const MAT_CHECK = ['미검수', '합격', '조건부', '불합격', '반출'];
export const TEST_RESULT = ['진행', '합격', '불합격', '재시험'];
const today = () => toS(Date.now() + 9 * 3600e3); // KST 기준 날짜

// 섹션: prog 공정 현황, crew 인원, equip 장비, work 금일, next 명일, mat 자재 반입·검수, test 품질시험, order 지시·협의, issue 이슈, safety 안전·환경, note 특기, photo 사진
export const SECS = { prog: '공정 현황', crew: '출력 인원', equip: '투입 장비', work: '금일 작업', next: '명일 작업', mat: '자재 반입·검수', test: '품질시험', order: '감리·감독 지시 및 조치', issue: '이슈', safety: '안전·환경', note: '특기사항', photo: '현장 사진' };
// crew: detail(공종·업체·인원·비고) / cum(전일누계·금일·누계) / sum(공종별 합계)
export const FORMS = {
  std: { name: '기본', desc: '인원·장비·작업·이슈·사진을 한 장에 정리합니다.', signs: ['작성', '검토', '승인'], crew: 'detail', secs: ['crew', 'equip', 'work', 'next', 'issue', 'safety', 'note', 'photo'] },
  gc: { name: '시공사 내부 결재형', desc: '공정 현황과 공종·업체별 누계 인원·장비, 자재 반입을 포함합니다. 결재란 담당→공무→공사→현장소장.', signs: ['담당', '공무', '공사', '현장소장'], crew: 'cum', secs: ['prog', 'crew', 'equip', 'work', 'next', 'mat', 'safety', 'note', 'issue', 'photo'] },
  sup: { name: '공공 감리 보고형', desc: '자재 검수·품질시험·감리 지시 및 조치를 포함하고, 감리원 확인란을 둡니다.', signs: ['작성', '현장대리인', '감리원 확인'], crew: 'cum', secs: ['prog', 'crew', 'equip', 'work', 'next', 'mat', 'test', 'order', 'safety', 'note', 'photo'] },
  cm: { name: '발주처·CM 보고형', desc: '공정 현황과 작업을 앞에 두고, 인원은 공종별 합계로 요약합니다. 이슈를 강조합니다.', signs: ['작성', 'CM 검토', '발주처 확인'], crew: 'sum', secs: ['prog', 'work', 'next', 'issue', 'crew', 'mat', 'safety', 'note', 'photo'] },
};
const HALF = new Set(['crew', 'equip', 'work', 'next']); // A4 출력에서 2단 배치

export const formOf = (d) => FORMS[d?.form] || FORMS.std;
export const signsOf = (d) => (d?.signs?.length ? d.signs : formOf(d).signs);

export function blankDay(P, date) {
  const prev = Object.keys(P.daily || {}).filter(k => k < date).sort().pop(); const pd = prev ? P.daily[prev] : null;
  return { form: pd?.form || 'std', signs: pd?.signs ? [...pd.signs] : null, weather: '맑음', tmin: null, tmax: null, rain: null, crew: [], equip: [], work: worksOn(P, date), next: worksOn(P, addDays(date, 1)).map(w => ({ text: w.text })), mat: [], test: [], order: '', note: '', safety: '', created: Date.now() };
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
// 전일까지 누계: 행 키(공종|업체 또는 장비|규격) → 합
export function cumBefore(P, date, list, key) {
  const m = {}; for (const [k, d] of Object.entries(P.daily || {})) if (k < date) for (const r of d[list] || []) { const q = key(r); m[q] = (m[q] || 0) + (+r.n || 0); }
  return m;
}
const crewKey = (c) => `${c.trade || '기타'}|${c.co || ''}`, equipKey = (c) => `${c.name || ''}|${c.spec || ''}`;
// 공정 현황: 공기·경과·계획 공정률(금액 가중, 공정표·내역 기준)·작업 평균 진척
export function progressOf(P, date, d, memo) {
  const acts = P.sched?.acts || []; if (!acts.length) return null;
  const start = P.sched.start || acts.reduce((m, a) => a.start && a.start < m ? a.start : m, acts[0].start);
  const end = acts.reduce((m, a) => a.end && a.end > m ? a.end : m, start);
  const total = daysBetween(start, end) + 1, el = Math.max(0, daysBetween(start, date) + 1);
  let plan = memo?.get(date); if (plan === undefined) { try { plan = (P.boq || []).length ? plannedPct(P, date) : null; } catch (e) { console.error(e); plan = null; } memo?.set(date, plan); }
  const ws = (d?.work || []).filter(w => w.pct != null); const avg = ws.length ? ws.reduce((s, w) => s + +w.pct, 0) / ws.length : null;
  let ph = null; try { ph = (P.photos || []).some(p => p.el && p.pct != null && p.date <= date) ? progressReport(P, date) : null; } catch (e) { console.error(e); }
  return { start, end, total, elapsed: Math.min(el, total), timePct: Math.min(100, el / total * 100), plan, avg, acts: worksOn(P, date).length, ph };
}

export function mount(root, ctx) {
  const P = ctx.P; P.daily ||= {}; let date = ctx.state.dailyDate || today();
  const page = h('div', { class: 'page' }); const w = h('div', { class: 'wrap' }); page.append(w); root.append(page);
  const save = () => ctx.touch('meta');
  const D = () => P.daily[date];
  const memo = new Map(); const offModel = ctx.bus.on?.('model', () => memo.clear());
  const norm = (d) => { d.mat ||= []; d.test ||= []; d.order ??= ''; d.crew ||= []; d.equip ||= []; d.work ||= []; d.next ||= []; return d; };
  const dow = (dt) => '일월화수목금토'[new Date(toD(dt)).getUTCDay()];

  function render() {
    w.innerHTML = ''; ctx.state.dailyDate = date;
    const days = Object.keys(P.daily).sort();
    const di = h('input', { type: 'date', value: date, onchange: e => { if (e.target.value) { date = e.target.value; render(); } } });
    w.append(h('div', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' } },
      h('div', {}, h('h1', {}, '작업일보'), h('div', { class: 'sub' }, '날씨·인원·장비와 공정표에서 불러온 금일/명일 작업, 그날의 이슈·현장 사진을 한 장으로 정리합니다. 출력 양식은 보고 대상에 맞게 고릅니다.')),
      h('div', { class: 'row', style: { gap: '6px' } },
        h('button', { class: 'btn', onclick: () => { date = addDays(date, -1); render(); }, title: '전날' }, '◀'), di, h('button', { class: 'btn', onclick: () => { date = addDays(date, 1); render(); }, title: '다음날' }, '▶'),
        h('button', { class: 'btn', onclick: () => { date = today(); render(); } }, '오늘'))));
    if (days.length) {
      const strip = h('div', { class: 'row', style: { gap: '4px', flexWrap: 'wrap', margin: '10px 0' } }, h('span', { class: 'note' }, `작성 ${days.length}일 ·`));
      for (const k of days.slice(-14)) strip.append(h('button', { class: 'btn sm' + (k === date ? ' primary' : ''), onclick: () => { date = k; render(); } }, k.slice(5), ' ', approvalBadge(P.daily[k].approval)));
      w.append(strip);
    }
    const d0 = D();
    if (!d0) {
      const prev = days.filter(k => k < date).pop(); const nf = FORMS[prev ? P.daily[prev].form : 'std'] || FORMS.std;
      w.append(h('div', { class: 'card', style: { marginTop: '14px' } }, h('div', { class: 't' }, `${date} 작업일보가 없습니다`),
        h('div', { class: 'd' }, (P.sched?.acts?.length ? `공정표에서 이날 진행 중인 작업 ${worksOn(P, date).length}건을 불러와 시작합니다.` : '공정표가 없으면 작업 항목을 직접 입력합니다.') + ` 양식: ${nf.name}${prev ? ' (직전 일보와 동일)' : ''}`),
        h('div', { class: 'row', style: { marginTop: '10px', gap: '6px' } },
          h('button', { class: 'btn primary', onclick: () => { P.daily[date] = blankDay(P, date); save(); render(); } }, '새로 작성'),
          prev ? h('button', { class: 'btn', onclick: () => { copyFrom(prev); } }, `전일(${prev}) 인원·장비 복사해 작성`) : null)));
      return;
    }
    const d = norm(d0); const F = formOf(d); const inForm = new Set(F.secs);
    const iss = dayIssues(P, date); const photos = (P.photos || []).filter(p => p.date === date);
    // 머리
    w.append(h('div', { class: 'row', style: { margin: '12px 0', gap: '8px', flexWrap: 'wrap' } },
      h('span', { class: 'pill acc' }, `${date} (${dow(date)})`), approvalCell(d, () => { save(); render(); }, `작업일보 ${date} 승인 상태`),
      h('span', { class: 'note' }, `금일 인원 ${crewTotal(d)}명 · 누계 ${fmt0(cumCrew(P, date))}명`),
      h('button', { class: 'btn sm', title: '출력 양식·결재란 변경', onclick: pickForm }, `양식: ${F.name}`),
      h('div', { style: { flex: 1 } }),
      h('button', { class: 'btn', onclick: () => { const prev = days.filter(k => k < date).pop(); if (!prev) return toast('이전 일보가 없습니다'); copyFrom(prev, true); } }, '전일 인원·장비 복사'),
      h('button', { class: 'btn', onclick: exportXLSX }, 'Excel'), h('button', { class: 'btn primary', onclick: exportHTML }, '일보 출력(A4)'),
      h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('작업일보 삭제', `${date} 작업일보를 삭제할까요?`, '삭제', true)) { delete P.daily[date]; save(); render(); } } }, '삭제')));
    // 날씨 (모든 양식 공통 머리)
    const inp = (o, k, attrs = {}) => h('input', { value: o[k] ?? '', ...attrs, onchange: e => { const v = e.target.value; o[k] = attrs.type === 'number' ? (v === '' ? null : +v) : v; save(); if (attrs.rerender) render(); } });
    const ws = h('select', { onchange: e => { d.weather = e.target.value; save(); } }); for (const x of WEATHER) ws.append(h('option', { selected: d.weather === x }, x));
    w.append(sec('날씨', h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap' } }, lab('날씨', ws), lab('최저 ℃', inp(d, 'tmin', { type: 'number', style: { width: '70px' } })), lab('최고 ℃', inp(d, 'tmax', { type: 'number', style: { width: '70px' } })), lab('강수 mm', inp(d, 'rain', { type: 'number', style: { width: '70px' } })),
      (d.tmin != null && d.tmin <= -5) ? h('span', { class: 'pill warn' }, '한중 콘크리트 주의') : null, (d.tmax != null && d.tmax >= 33) ? h('span', { class: 'pill warn' }, '폭염 — 서중 콘크리트·온열질환 주의') : null, (d.rain >= 10) ? h('span', { class: 'pill warn' }, '우천 — 타설·고소작업 검토') : null)));
    // 섹션: 양식 순서대로, 양식에 없지만 내용이 있는 섹션은 뒤에 "출력 제외"로 표시
    const has = { prog: false, crew: d.crew.length, equip: d.equip.length, work: d.work.length, next: d.next.length, mat: d.mat.length, test: d.test.length, order: d.order, issue: iss.opened.length + iss.closed.length, safety: d.safety, note: d.note, photo: photos.length };
    const order = [...F.secs, ...Object.keys(SECS).filter(k => !inForm.has(k) && has[k])];
    const extra = Object.keys(SECS).filter(k => !inForm.has(k) && !has[k]);
    for (const k of order) { const c = uiSec(k, d, iss, photos); if (!c) continue; if (!inForm.has(k)) c.querySelector('.t')?.append(' ', h('span', { class: 'pill', title: '현재 양식의 출력 항목이 아닙니다' }, '출력 제외')); w.append(c); }
    if (extra.length) w.append(h('div', { class: 'note', style: { marginTop: '10px' } }, '이 양식에 없는 항목: ', ...extra.map(k => h('button', { class: 'btn sm', style: { marginLeft: '4px' }, onclick: () => { const c = uiSec(k, d, iss, photos); c.querySelector('.t')?.append(' ', h('span', { class: 'pill' }, '출력 제외')); w.lastChild.before(c); } }, SECS[k]))));
  }

  function uiSec(k, d, iss, photos) {
    const F = formOf(d);
    const reload = (key, dt) => h('button', { class: 'btn sm', onclick: () => { const add = worksOn(P, dt).filter(x => !d[key].some(y => y.act && y.act === x.act)); for (const x of add) d[key].push(key === 'next' ? { text: x.text, act: x.act } : x); save(); render(); toast(add.length ? `${add.length}건 추가` : '추가할 공정 활동이 없습니다'); } }, '공정표에서 불러오기');
    const ta = (key, ph) => h('textarea', { rows: 3, style: { width: '100%' }, placeholder: ph, onchange: e => { d[key] = e.target.value; save(); } }, d[key] || '');
    switch (k) {
      case 'prog': {
        const g = progressOf(P, date, d, memo);
        if (!g) return sec(SECS.prog, h('div', { class: 'note' }, '공정표가 없어 공정 현황을 계산하지 않습니다. 공정 도구에서 공정표를 만들거나 불러오세요.'), h('button', { class: 'btn sm', onclick: () => ctx.go('sched') }, '공정 도구'));
        const kv = (l, v, t) => h('div', { class: 'card', title: t || '', style: { padding: '6px 10px', minWidth: '120px' } }, h('div', { class: 'note' }, l), h('div', { class: 't' }, v));
        return sec(SECS.prog, h('div', {}, h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
          kv('공기', `${g.start} ~ ${g.end}`, '공정표 시작일 ~ 마지막 활동 종료일'), kv('경과', `${g.elapsed} / ${g.total}일 (${g.timePct.toFixed(1)}%)`),
          kv('계획 공정률', g.plan == null ? '-' : g.plan.toFixed(1) + '%', '공정표 활동 진척 × 내역 단가 × 객체 물량 (금액 가중)'),
          kv('금일 작업 평균 진척', g.avg == null ? '-' : g.avg.toFixed(0) + '%'), kv('진행 중 활동', g.acts + '건'),
          g.ph?.sum.shot ? h('div', { class: 'card click', title: '현장 사진으로 판정한 부재의 평균 진척(같은 부재의 계획 대비). 눌러서 진척 판정 현황으로 이동', style: { padding: '6px 10px', minWidth: '120px' }, onclick: () => { ctx.state.siteView = 'report'; ctx.state.siteDate = date; ctx.go('site'); } },
            h('div', { class: 'note' }, '사진 판정 실적'), h('div', { class: 't' }, `${g.ph.sum.act.toFixed(0)}% (계획 ${g.ph.sum.plan.toFixed(0)}%)`), h('div', { class: 'note', style: { fontSize: '11px' } }, `부재 ${g.ph.sum.shot} · 지연 ${g.ph.lag.length}${g.ph.unchecked.length ? ' · 확인 필요 ' + g.ph.unchecked.length : ''}`)) : null),
          h('div', { class: 'note', style: { marginTop: '4px' } }, g.plan == null ? '계획 공정률은 내역(단가)이 있어야 계산됩니다.' : '계획 공정률 근거: 공정표 일정에 따른 객체별 진척률을 내역 금액으로 가중 평균했습니다.')));
      }
      case 'crew': {
        const pre = F.crew === 'cum' ? cumBefore(P, date, 'crew', crewKey) : null;
        const cols = [{ k: 'trade', label: '공종', list: 'dl-trade', w: '160px' }, { k: 'co', label: '업체', w: '140px' }, { k: 'n', label: '금일', type: 'number', w: '70px' }, { k: 'memo', label: '비고' }];
        const box = editList(d.crew, cols, () => ({ trade: '', co: '', n: null, memo: '' }), '인원 추가', null, pre ? (r) => `전일누계 ${fmt0(pre[crewKey(r)] || 0)} → 누계 ${fmt0((pre[crewKey(r)] || 0) + (+r.n || 0))}` : null);
        return sec(`${SECS.crew} (${crewTotal(d)}명)`, box, h('datalist', { id: 'dl-trade' }, TRADES.map(t => h('option', { value: t }))));
      }
      case 'equip': {
        const pre = F.crew === 'cum' ? cumBefore(P, date, 'equip', equipKey) : null;
        return sec(SECS.equip, editList(d.equip, [{ k: 'name', label: '장비', w: '160px', list: 'dl-eq' }, { k: 'spec', label: '규격', w: '140px' }, { k: 'n', label: '대수', type: 'number', w: '70px' }, { k: 'memo', label: '비고' }], () => ({ name: '', spec: '', n: 1, memo: '' }), '장비 추가', null, pre ? (r) => `누계 ${fmt0((pre[equipKey(r)] || 0) + (+r.n || 0))}대` : null),
          h('datalist', { id: 'dl-eq' }, ['타워크레인', '이동식크레인', '굴착기', '덤프트럭', '펌프카', '레미콘', '지게차', '고소작업차', '항타기', '카고크레인'].map(t => h('option', { value: t }))));
      }
      case 'work': return sec(SECS.work, editList(d.work, [{ k: 'text', label: '작업 내용' }, { k: 'loc', label: '위치', w: '120px' }, { k: 'pct', label: '진척 %', type: 'number', w: '70px' }], () => ({ text: '', loc: '', pct: null }), '작업 추가', x => x.src === 'sched' ? h('span', { class: 'pill', title: '공정표 활동', style: { whiteSpace: 'nowrap' } }, '공정') : null), reload('work', date));
      case 'next': return sec(SECS.next, editList(d.next, [{ k: 'text', label: '작업 내용' }, { k: 'loc', label: '위치', w: '120px' }], () => ({ text: '', loc: '' }), '작업 추가'), reload('next', addDays(date, 1)));
      case 'mat': {
        const bad = d.mat.filter(m => m.check === '불합격' || m.check === '반출').length;
        return sec(`${SECS.mat} (${d.mat.length})`, h('div', {}, editList(d.mat, [{ k: 'name', label: '자재', w: '150px', list: 'dl-mat' }, { k: 'spec', label: '규격', w: '130px' }, { k: 'qty', label: '수량', type: 'number', w: '80px' }, { k: 'unit', label: '단위', w: '60px', list: 'dl-unit' }, { k: 'co', label: '공급처', w: '120px' }, { k: 'check', label: '검수', w: '90px', options: MAT_CHECK }, { k: 'memo', label: '비고' }], () => ({ name: '', spec: '', qty: null, unit: '', co: '', check: '미검수', memo: '' }), '반입 추가'),
          bad ? h('div', { class: 'pill warn', style: { marginTop: '6px' } }, `불합격·반출 ${bad}건 — 반출 확인과 재반입 일정을 특기사항에 남기세요`) : null,
          h('datalist', { id: 'dl-mat' }, ['레미콘', '철근', '거푸집', '형강', '데크플레이트', '시멘트', '블록', '방수재', '단열재', '창호', '배관재', '케이블'].map(t => h('option', { value: t }))),
          h('datalist', { id: 'dl-unit' }, ['㎥', 'ton', 'kg', '㎡', 'm', 'EA', '본', '매', '롤', 'set'].map(t => h('option', { value: t })))));
      }
      case 'test': return sec(`${SECS.test} (${d.test.length})`, editList(d.test, [{ k: 'item', label: '시험 항목', w: '180px', list: 'dl-test' }, { k: 'loc', label: '부위·로트', w: '150px' }, { k: 'value', label: '측정값', w: '110px' }, { k: 'result', label: '결과', w: '90px', options: TEST_RESULT }, { k: 'memo', label: '비고' }], () => ({ item: '', loc: '', value: '', result: '진행', memo: '' }), '시험 추가'),
        h('datalist', { id: 'dl-test' }, ['슬럼프', '공기량', '염화물량', '공시체 제작', '압축강도(7일)', '압축강도(28일)', '철근 인장', '평판재하', '다짐도', '용접부 비파괴', '방수 담수'].map(t => h('option', { value: t }))));
      case 'order': return sec(SECS.order, ta('order', '감리·감독·CM 지시 내용, 조치 결과, 협의 사항'));
      case 'issue': {
        const il = (arr) => arr.length ? h('div', { class: 'tbl' }, table([{ label: '번호', render: i => '#' + i.no }, { label: '유형', key: 'type' }, { label: '제목', key: 'title' }, { label: '담당', key: 'assignee' }, { label: '상태', key: 'status' }, { label: '', render: i => h('button', { class: 'btn sm', onclick: () => { ctx.state.issueSel = i.id; ctx.go('issue'); } }, '열기') }], arr)) : h('div', { class: 'note' }, '없음');
        return sec(`${SECS.issue} (신규 ${iss.opened.length} · 완료 ${iss.closed.length})`, h('div', {}, h('div', { class: 'd', style: { margin: '2px 0 4px' } }, '신규'), il(iss.opened), h('div', { class: 'd', style: { margin: '8px 0 4px' } }, '완료'), il(iss.closed)));
      }
      case 'safety': return sec(SECS.safety, ta('safety', 'TBM·위험성평가, 안전점검 결과, 재해·아차사고, 환경(소음·분진) 등'));
      case 'note': return sec(SECS.note, ta('note', '자재 반입·검수 특이사항, 협의 사항 등'));
      case 'photo': {
        const pg = h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } });
        if (!photos.length) pg.append(h('div', { class: 'note' }, '이날 촬영일로 등록된 현장 사진이 없습니다. 현장 도구에서 사진을 올리면 자동으로 들어옵니다.'));
        for (const p of photos) { const im = h('img', { style: { width: '150px', height: '110px', objectFit: 'cover', borderRadius: '6px', background: 'var(--bg2)' } }); photoData(ctx, P, p.id, true).then(s => { if (s) im.src = s; }); pg.append(h('div', { style: { width: '150px' } }, im, h('div', { class: 'note', style: { fontSize: '11px' } }, [p.stage, p.note || p.name].filter(Boolean).join(' · ')))); }
        return sec(`${SECS.photo} (${photos.length})`, pg, h('button', { class: 'btn sm', onclick: () => ctx.go('site') }, '현장 도구'));
      }
    }
    return null;
  }

  async function pickForm() {
    const d = D(); const F = formOf(d);
    const v = await dialog({
      title: '출력 양식', body: `<div class="note">${Object.values(FORMS).map(f => `<b>${esc(f.name)}</b> — ${esc(f.desc)}`).join('<br>')}<br><br>새 일보는 직전 일보의 양식·결재란을 이어받습니다.</div>`, wide: true,
      fields: [{ key: 'form', label: '양식', type: 'select', options: Object.entries(FORMS).map(([k, f]) => [k, f.name]), value: d.form || 'std' },
        { key: 'signs', label: '결재란 (쉼표로 구분, 비우면 양식 기본값)', value: d.signs?.length ? d.signs.join(', ') : '', placeholder: F.signs.join(', ') },
        { key: 'after', label: '이후 작성된 일보에도 적용', type: 'checkbox', value: false }]
    });
    if (!v) return;
    const signs = v.signs.split(/[,，]/).map(s => s.trim()).filter(Boolean).slice(0, 6);
    const apply = (x) => { x.form = v.form; x.signs = signs.length ? signs : null; };
    apply(d); let n = 0; if (v.after) for (const k of Object.keys(P.daily)) if (k > date) { apply(P.daily[k]); n++; }
    save(); render(); toast(`양식: ${FORMS[v.form].name}${n ? ` (이후 ${n}일 함께 변경)` : ''}`, 'ok');
  }
  function sec(title, body, extra) { return h('div', { class: 'card', style: { marginTop: '12px' } }, h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '6px' } }, h('div', { class: 't' }, title), extra || null), body); }
  function lab(t, el) { return h('label', { class: 'row', style: { gap: '4px' } }, h('span', { class: 'note' }, t), el); }
  // cols[].options 가 있으면 선택 목록, tail(r) 이 있으면 행 끝에 참고 문구(누계 등)
  function editList(arr, cols, mk, addLabel, badge, tail) {
    const box = h('div');
    const tbl = h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, badge ? h('th', { style: { width: '54px' } }) : null, cols.map(c => h('th', { class: c.type === 'number' ? 'num' : '', style: c.w ? { width: c.w } : null }, c.label)), tail ? h('th', { style: { width: '170px' } }, '누계') : null, h('th', { style: { width: '30px' } }))));
    const tb = h('tbody'); tbl.append(tb);
    const cell = (r, c) => {
      const set = (v) => { r[c.k] = c.type === 'number' ? (v === '' ? null : +v) : v; if (r.src === 'sched' && c.k === 'text') r.src = 'edit'; save(); if (c.k === 'n' || c.k === 'trade' || c.k === 'co' || c.k === 'name' || c.k === 'spec' || c.options) render(); };
      if (c.options) { const s = h('select', { style: { width: '100%' }, onchange: e => set(e.target.value) }); for (const o of c.options) s.append(h('option', { selected: (r[c.k] || c.options[0]) === o }, o)); return s; }
      return h('input', { value: r[c.k] ?? '', type: c.type || 'text', list: c.list || null, style: { width: '100%', textAlign: c.type === 'number' ? 'right' : 'left' }, onchange: e => set(e.target.value) });
    };
    arr.forEach((r, i) => tb.append(h('tr', {}, badge ? h('td', {}, badge(r)) : null,
      cols.map(c => h('td', { class: c.type === 'number' ? 'num' : '' }, cell(r, c))), tail ? h('td', { class: 'note', style: { fontSize: '11px', whiteSpace: 'nowrap' } }, tail(r)) : null,
      h('td', {}, h('button', { class: 'btn sm', title: '삭제', onclick: () => { arr.splice(i, 1); save(); render(); } }, '×')))));
    if (!arr.length) tb.append(h('tr', {}, h('td', { colspan: cols.length + 3, class: 'note' }, '항목 없음')));
    box.append(h('div', { class: 'tbl' }, tbl), h('button', { class: 'btn sm', style: { marginTop: '6px' }, onclick: () => { arr.push(mk()); save(); render(); setTimeout(() => { const ins = box.isConnected ? box : w; ins.querySelectorAll('tbody tr:last-child input')[0]?.focus(); }, 0); } }, '+ ' + addLabel));
    return box;
  }
  function copyFrom(prev, merge = false) {
    const s = P.daily[prev]; const d = merge ? D() : (P.daily[date] = blankDay(P, date));
    d.crew = (s.crew || []).map(c => ({ ...c })); d.equip = (s.equip || []).map(c => ({ ...c })); if (!merge) d.weather = s.weather;
    save(); render(); toast(`${prev} 인원·장비를 복사했습니다`);
  }

  // 출력용 행 데이터 (HTML·Excel 공통)
  function crewRows(d, mode) {
    if (mode === 'sum') { const m = {}; for (const c of d.crew) { const t = c.trade || '기타'; m[t] = (m[t] || 0) + (+c.n || 0); } const pre = cumBefore(P, date, 'crew', c => c.trade || '기타'); return { head: ['공종', '금일', '누계'], rows: Object.entries(m).map(([t, n]) => [t, n, (pre[t] || 0) + n]) }; }
    if (mode === 'cum') { const pre = cumBefore(P, date, 'crew', crewKey); return { head: ['공종', '업체', '전일누계', '금일', '누계'], rows: d.crew.map(c => { const p = pre[crewKey(c)] || 0; return [c.trade, c.co, p, c.n ?? '', p + (+c.n || 0)]; }) }; }
    return { head: ['공종', '업체', '인원', '비고'], rows: d.crew.map(c => [c.trade, c.co, c.n ?? '', c.memo]) };
  }
  function equipRows(d, mode) {
    if (mode === 'cum') { const pre = cumBefore(P, date, 'equip', equipKey); return { head: ['장비', '규격', '금일', '누계'], rows: d.equip.map(c => [c.name, c.spec, c.n ?? '', (pre[equipKey(c)] || 0) + (+c.n || 0)]) }; }
    return { head: ['장비', '규격', '대수', '비고'], rows: d.equip.map(c => [c.name, c.spec, c.n ?? '', c.memo]) };
  }
  function outSecs(d, iss) {
    const F = formOf(d); const out = {};
    const g = progressOf(P, date, d, memo);
    out.prog = { head: ['공기', '경과일', '시간 경과율', '계획 공정률', '금일 작업 평균 진척', '사진 판정 실적(계획)'], rows: g ? [[`${g.start} ~ ${g.end}`, `${g.elapsed} / ${g.total}일`, g.timePct.toFixed(1) + '%', g.plan == null ? '-' : g.plan.toFixed(1) + '%', g.avg == null ? '-' : g.avg.toFixed(0) + '%', g.ph?.sum.shot ? `${g.ph.sum.act.toFixed(0)}% (${g.ph.sum.plan.toFixed(0)}%) · 부재 ${g.ph.sum.shot} · 지연 ${g.ph.lag.length}` : '-']] : [] };
    const cr = crewRows(d, F.crew); out.crew = { ...cr, title: `${SECS.crew} — 금일 ${crewTotal(d)}명 · 누계 ${fmt0(cumCrew(P, date))}명` };
    out.equip = equipRows(d, F.crew === 'cum' ? 'cum' : 'detail');
    out.work = { head: ['작업 내용', '위치', '진척'], rows: d.work.map(c => [c.text, c.loc || '', c.pct != null ? c.pct + '%' : '']) };
    out.next = { head: ['작업 내용', '위치'], rows: d.next.map(c => [c.text, c.loc || '']) };
    out.mat = { head: ['자재', '규격', '수량', '단위', '공급처', '검수', '비고'], rows: d.mat.map(m => [m.name, m.spec, m.qty ?? '', m.unit, m.co, m.check || '미검수', m.memo]) };
    out.test = { head: ['시험 항목', '부위·로트', '측정값', '결과', '비고'], rows: d.test.map(t => [t.item, t.loc, t.value, t.result || '진행', t.memo]) };
    out.issue = { head: ['구분', '번호', '유형', '제목', '담당', '상태'], rows: [...iss.opened.map(i => ['신규', '#' + i.no, i.type, i.title, i.assignee, i.status]), ...iss.closed.map(i => ['완료', '#' + i.no, i.type, i.title, i.assignee, i.status])] };
    out.order = { text: d.order || '' }; out.safety = { text: d.safety || '' }; out.note = { text: d.note || '' };
    return out;
  }

  async function exportHTML() {
    const d = norm(D()); const F = formOf(d); const iss = dayIssues(P, date); const photos = (P.photos || []).filter(p => p.date === date).slice(0, 8);
    const imgs = await Promise.all(photos.map(p => photoData(ctx, P, p.id, true)));
    const S = outSecs(d, iss);
    const tr = (cells, th) => `<tr>${cells.map(c => `<${th ? 'th' : 'td'}>${c}</${th ? 'th' : 'td'}>`).join('')}</tr>`;
    const tblH = (head, rows) => `<table>${tr(head, true)}${rows.length ? rows.map(r => tr(r.map(x => esc(String(x ?? ''))))).join('') : `<tr><td colspan="${head.length}" class="n">-</td></tr>`}</table>`;
    const block = (k) => {
      if (k === 'photo') return photos.length ? `<h2>${SECS.photo}</h2><div class="ph">${photos.map((p, i) => `<div>${imgs[i] ? `<img src="${imgs[i]}">` : ''}${esc([p.stage, p.note || p.name].filter(Boolean).join(' · '))}</div>`).join('')}</div>` : '';
      const s = S[k]; if (!s) return '';
      if ('text' in s) return `<h2>${SECS[k]}</h2><table><tr><td class="pre">${esc(s.text)}</td></tr></table>`;
      if (k === 'prog' && !s.rows.length) return '';
      return `<h2>${esc(s.title || SECS[k])}</h2>${tblH(s.head, s.rows)}`;
    };
    let body = ''; for (let i = 0; i < F.secs.length; i++) { const k = F.secs[i], n = F.secs[i + 1]; if (HALF.has(k) && HALF.has(n)) { body += `<div class="g"><div>${block(k)}</div><div>${block(n)}</div></div>`; i++; } else body += block(k); }
    const ap = d.approval || {}; const signs = signsOf(d);
    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>작업일보 ${date}</title><style>
@page{size:A4;margin:14mm}body{font-family:'Malgun Gothic',sans-serif;color:#111;font-size:12px;max-width:182mm;margin:auto}h1{text-align:center;font-size:22px;letter-spacing:8px;margin:6px 0 10px}
table{border-collapse:collapse;width:100%;margin:4px 0 10px}th,td{border:1px solid #444;padding:4px 6px;text-align:left;vertical-align:top}th{background:#eef0f3;font-weight:600}td.n{color:#888;text-align:center}
h2{font-size:13px;margin:10px 0 2px;border-left:4px solid #335;padding-left:6px}.g{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ph{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.ph img{width:100%;height:30mm;object-fit:cover;border:1px solid #999}.ph div{font-size:10px;color:#444}
.top td,.top th{text-align:center}.sign{width:auto;float:right;margin-top:-6px}.sign th{text-align:center;font-size:11px}.sign td{width:20mm;height:14mm;text-align:center;vertical-align:middle}.pre{white-space:pre-wrap;min-height:12mm}.form{color:#666;font-size:10px;text-align:center;margin-top:-6px}</style></head><body>
<table class="sign">${tr(signs.map(esc), true)}<tr>${signs.map((_, i) => `<td>${i === signs.length - 1 && ap.status === '승인' ? esc(ap.by || '승인') : ''}</td>`).join('')}</tr></table>
<h1>작 업 일 보</h1><div class="form">${esc(F.name)}</div><table class="top">${tr(['공사명', '일자', '날씨', '기온(℃)', '강수(mm)', '상태'], true)}${tr([esc(P.name), `${date} (${dow(date)})`, esc(d.weather), `${d.tmin ?? '-'} / ${d.tmax ?? '-'}`, d.rain ?? '-', esc(ap.status || '작성')])}</table>
${body}
<p style="color:#888;font-size:10px;margin-top:12px">빌더 작업일보 · ${esc(F.name)} · 출력 ${new Date().toLocaleString('ko-KR')}</p></body></html>`;
    saveFile(`${P.name.replace(/[\\/:*?"<>|]/g, '_')}_작업일보_${date}.html`, html);
  }
  async function exportXLSX() {
    const d = norm(D()); const F = formOf(d); const iss = dayIssues(P, date); const S = outSecs(d, iss);
    const rows = [['작업일보', P.name, '양식', F.name], ['일자', date, '날씨', d.weather, '기온', `${d.tmin ?? '-'} / ${d.tmax ?? '-'}`, '강수', d.rain ?? ''], ['결재', ...signsOf(d)], ['승인 상태', d.approval?.status || '작성', d.approval?.by || ''], []];
    for (const k of F.secs) {
      if (k === 'photo') { const n = (P.photos || []).filter(p => p.date === date).length; if (n) rows.push([`[${SECS.photo}]`, `${n}장 (HTML 출력에 첨부)`], []); continue; }
      const s = S[k]; if ('text' in s) { rows.push([`[${SECS[k]}]`, s.text]); continue; }
      if (k === 'prog' && !s.rows.length) continue;
      rows.push([`[${s.title || SECS[k]}]`], s.head, ...s.rows, []);
    }
    // 월간 인원 집계 (공종 × 일자)
    const ym = date.slice(0, 7); const ds = Object.keys(P.daily).filter(k => k.startsWith(ym)).sort();
    const trades = [...new Set(ds.flatMap(k => (P.daily[k].crew || []).map(c => c.trade || '기타')))];
    const mon = [['공종', ...ds.map(k => k.slice(5)), '계'], ...trades.map(t => { const v = ds.map(k => (P.daily[k].crew || []).filter(c => (c.trade || '기타') === t).reduce((s, c) => s + (+c.n || 0), 0)); return [t, ...v, v.reduce((a, b) => a + b, 0)]; }),
      ['합계', ...ds.map(k => crewTotal(P.daily[k])), ds.reduce((s, k) => s + crewTotal(P.daily[k]), 0)]];
    const blob = await writeBook([{ name: date, rows, widths: [28, 18, 12, 30, 12, 10, 10, 10] }, { name: `${ym} 인원집계`, rows: mon, widths: [14, ...ds.map(() => 6), 8] }]);
    saveFile(`${P.name.replace(/[\\/:*?"<>|]/g, '_')}_작업일보_${date}.xlsx`, blob);
  }
  render();
  return { unmount() { if (typeof offModel === 'function') offModel(); } };
}
