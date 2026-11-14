// 빌더 공정 — 공정표(간트) + 객체 연결 + 4D + 계획 기성률 연동
import { h, toast, dialog, confirmBox, saveFile, table, pickFile } from '../js/ui.js';
import { xlsx } from '../js/excel.js';
import { allElements, KINDS, DISC, levelOf, takeoff, isRefElement } from '../js/model.js';
import { uid, fmt, fmt0, csv, esc } from '../js/util.js';

const DAY = 86400000;
export const toD = (s) => new Date(s + 'T00:00:00Z').getTime();
export const toS = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (s, n) => toS(toD(s) + n * DAY);
export const daysBetween = (a, b) => Math.round((toD(b) - toD(a)) / DAY);

// 활동에 속한 객체인지
export function matchAct(a, r) {
  if (a.ids?.length) return a.ids.includes(r.el.id);
  const f = a.filter || {}; if (!f.level && !f.kind && !f.disc && !f.zone) return false;
  return (!f.level || r.level.id === f.level) && (!f.kind || r.el.k === f.kind) && (!f.disc || r.sheet.disc === f.disc) && (!f.zone || r.el.zone === f.zone);
}
// 날짜 기준 객체 상태: {id: {s:'done'|'active'|'future', pct}}
export function statusAt(P, date) {
  const t = toD(date), out = {}; const acts = P.sched?.acts || [];
  for (const r of allElements(P)) {
    for (const a of acts) {
      if (!matchAct(a, r)) continue; const s = toD(a.start), e = toD(a.end) + DAY;
      const pct = t >= e ? 100 : t <= s ? 0 : Math.round((t - s) / (e - s) * 100);
      const cur = out[r.el.id]; if (!cur || pct < cur.pct) out[r.el.id] = { s: pct >= 100 ? 'done' : pct > 0 ? 'active' : 'future', pct, act: a.name };
    }
  }
  return out;
}
// 순방향 일정 계산 (선행 FS + 지연일)
export function schedule(acts) {
  const byId = Object.fromEntries(acts.map(a => [a.id, a])); const done = new Set();
  const visit = (a, stack = new Set()) => {
    if (done.has(a.id) || stack.has(a.id)) return; stack.add(a.id);
    let st = null;
    for (const pid of a.pred || []) { const p = byId[pid]; if (!p) continue; visit(p, stack); const s2 = addDays(p.end, 1 + (a.lag || 0)); if (!st || toD(s2) > toD(st)) st = s2; }
    if (st) a.start = st;
    a.end = addDays(a.start, Math.max(1, a.dur) - 1); done.add(a.id);
  };
  acts.forEach(a => visit(a)); return acts;
}
const DUR = { footing: 10, column: 5, beam: 6, slab: 7, wall: 8, opening: 5, duct: 10, pipe: 10, tray: 8 };
const ORDER = [['S', 'footing'], ['S', 'column'], ['S', 'wall'], ['S', 'beam'], ['S', 'slab'], ['A', 'column'], ['A', 'wall'], ['A', 'opening'], ['M', 'duct'], ['P', 'pipe'], ['E', 'tray']];
export function autoGenerate(P, start) {
  const acts = []; const lv = [...P.levels].sort((a, b) => a.elev - b.elev); const all = allElements(P, r => !isRefElement(r.el, r.sheet, P));
  let prevStruct = null; const finishByLevel = {};
  for (const L of lv) {
    let prev = prevStruct;
    for (const [disc, k] of ORDER.slice(0, 5)) {
      // 슬래브는 위층 바닥: 보 다음
      const n = all.filter(r => r.level.id === L.id && r.sheet.disc === disc && r.el.k === k).length; if (!n) continue;
      const a = { id: uid('a'), name: `${L.name} ${KINDS[k].name}`, filter: { level: L.id, kind: k, disc }, dur: DUR[k], start: start, pred: prev ? [prev.id] : [], color: DISC[disc].color, wbs: `${L.name}/구조` };
      acts.push(a); prev = a;
    }
    prevStruct = prev; finishByLevel[L.id] = prev;
  }
  for (const L of lv) {
    let prev = finishByLevel[L.id];
    for (const [disc, k] of ORDER.slice(5)) {
      const n = all.filter(r => r.level.id === L.id && r.sheet.disc === disc && r.el.k === k).length; if (!n) continue;
      const a = { id: uid('a'), name: `${L.name} ${DISC[disc].name} ${KINDS[k].name}`, filter: { level: L.id, kind: k, disc }, dur: DUR[k], start, pred: prev ? [prev.id] : [], lag: disc === 'A' ? 3 : 0, color: DISC[disc].color, wbs: `${L.name}/${DISC[disc].name}` };
      acts.push(a); prev = a;
    }
  }
  return schedule(acts);
}
// 날짜 기준 계획 기성률(금액 가중)
export function plannedPct(P, date, rows = takeoff(P)) {
  const st = statusAt(P, date); const price = Object.fromEntries(P.boq.map(b => [b.code, b.price])); let tot = 0, done = 0;
  for (const r of rows) { const v = r.qty * (price[r.code] || 0); tot += v; done += v * ((st[r.el.id]?.pct) || 0) / 100; }
  return tot ? done / tot * 100 : 0;
}

export function mount(root, ctx) {
  const P = ctx.P; P.sched ||= { acts: [], start: new Date().toISOString().slice(0, 10) }; const SC = P.sched;
  const st = { zoom: 14, sel: null };
  const page = h('div', { class: 'page' }); const w = h('div', { class: 'wrap', style: { maxWidth: '1400px' } }); page.append(w); root.append(page);
  const save = () => { ctx.touch('meta'); };

  function render() {
    w.innerHTML = '';
    w.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('div', {}, h('h1', {}, '공정 (4D)'), h('div', { class: 'sub' }, '공정 활동을 층·공종·객체 종류로 모델에 연결하면 3D에서 날짜별 시공 순서를 재생하고, 기성 회차의 계획 기성률을 자동 계산합니다.')),
      h('div', { class: 'row' }, h('button', { class: 'btn', title: 'MS Project XML(.xml), Excel(.xlsx/.csv) — P6는 XML/엑셀로 내보낸 뒤 불러오세요', onclick: importSched }, '공정표 불러오기'), h('button', { class: 'btn', onclick: gen }, '모델에서 공정 자동 생성'), h('button', { class: 'btn primary', onclick: addAct }, '+ 활동'))));
    if (!SC.acts.length) { w.append(h('div', { class: 'card', style: { marginTop: '14px' } }, h('div', { class: 't' }, '공정 활동이 없습니다'), h('div', { class: 'd' }, '"모델에서 공정 자동 생성"을 누르면 층별 기초→기둥→벽→보→슬래브, 이어서 건축·설비 순으로 활동이 만들어집니다.'))); return; }
    schedule(SC.acts);
    const s0 = SC.acts.reduce((m, a) => toD(a.start) < toD(m) ? a.start : m, SC.acts[0].start), e0 = SC.acts.reduce((m, a) => toD(a.end) > toD(m) ? a.end : m, SC.acts[0].end);
    const span = daysBetween(s0, e0) + 1;
    w.append(h('div', { class: 'row', style: { margin: '12px 0' } },
      h('span', { class: 'pill acc' }, `착공 ${s0}`), h('span', { class: 'pill acc' }, `완료 ${e0}`), h('span', { class: 'pill' }, `총 ${span}일 · 활동 ${SC.acts.length}개`),
      h('button', { class: 'btn sm', onclick: () => { ctx.state.sched4d = { date: s0 }; ctx.go('view3d'); } }, '▶ 3D 4D 재생'),
      h('button', { class: 'btn sm', onclick: fillPlan }, '기성 회차 계획률 자동 입력'),
      h('button', { class: 'btn sm', onclick: () => saveFile(`${P.name}_공정표.csv`.replace(/[\\/:*?"<>|]/g, '_'), csv([['WBS', '활동', '시작', '종료', '기간(일)', '선행', '연결 객체 수'], ...SC.acts.map(a => [a.wbs || '', a.name, a.start, a.end, a.dur, (a.pred || []).map(p => SC.acts.find(x => x.id === p)?.name || '').join('; '), count(a)])])) }, 'CSV'),
      h('label', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'note' }, '확대'), (() => { const r = h('input', { type: 'range', min: 4, max: 40, value: st.zoom }); r.oninput = () => { st.zoom = +r.value; render(); }; return r; })())));
    // 간트
    const px = st.zoom, rowH = 30, left = 300;
    const wrap = h('div', { class: 'tbl', style: { overflow: 'auto', maxHeight: '62vh', position: 'relative' } });
    const svgW = left + span * px + 40, svgH = 30 + SC.acts.length * rowH;
    const today = toS(Date.now()); const tx = left + daysBetween(s0, today) * px;
    let svg = `<svg width="${svgW}" height="${svgH}" style="display:block;font-family:inherit">`;
    for (let d = 0; d <= span; d++) { const ds = addDays(s0, d); const x = left + d * px; const dt = new Date(toD(ds)); if (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) svg += `<rect x="${x}" y="24" width="${px}" height="${svgH}" fill="#ffffff06"/>`; if (dt.getUTCDate() === 1 || d === 0) svg += `<line x1="${x}" x2="${x}" y1="0" y2="${svgH}" stroke="#364152"/><text x="${x + 3}" y="14" fill="#a9b1c1" font-size="11">${ds.slice(0, 7)}</text>`; else if (px >= 14 || dt.getUTCDay() === 1) svg += `<text x="${x + 2}" y="24" fill="#6f7a8d" font-size="9">${dt.getUTCDate()}</text>`; }
    SC.acts.forEach((a, i) => {
      const y = 30 + i * rowH, x = left + daysBetween(s0, a.start) * px, wd = (daysBetween(a.start, a.end) + 1) * px;
      svg += `<rect x="0" y="${y}" width="${svgW}" height="${rowH}" fill="${st.sel === a.id ? '#1d3350' : i % 2 ? '#ffffff04' : 'transparent'}" data-a="${a.id}" style="cursor:pointer"/>`;
      svg += `<text x="8" y="${y + 19}" fill="#e6e9ef" font-size="12.5" data-a="${a.id}" style="cursor:pointer">${esc(a.name)}</text><text x="${left - 8}" y="${y + 19}" fill="#6f7a8d" font-size="11" text-anchor="end">${a.dur}일 · ${count(a)}</text>`;
      svg += `<rect x="${x}" y="${y + 7}" width="${wd}" height="${rowH - 14}" rx="3" fill="${a.color || '#4ea1ff'}" opacity="0.85" data-a="${a.id}" style="cursor:pointer"><title>${esc(a.name)} ${a.start} ~ ${a.end}</title></rect>`;
      for (const pid of a.pred || []) { const p = SC.acts.find(z => z.id === pid); if (!p) continue; const pi = SC.acts.indexOf(p); const px1 = left + (daysBetween(s0, p.end) + 1) * px, py = 30 + pi * rowH + rowH / 2; svg += `<path d="M${px1} ${py} h6 V${y + rowH / 2} H${x}" fill="none" stroke="#6f7a8d" stroke-width="1" marker-end="url(#ar)"/>`; }
    });
    if (tx > left && tx < svgW) svg += `<line x1="${tx}" x2="${tx}" y1="24" y2="${svgH}" stroke="#ef5f5f" stroke-dasharray="4 3"/><text x="${tx + 3}" y="${svgH - 4}" fill="#ef5f5f" font-size="10">오늘</text>`;
    for (const p of P.bill.periods) if (p.date) { const x = left + daysBetween(s0, p.date) * px; if (x > left && x < svgW) svg += `<line x1="${x}" x2="${x}" y1="24" y2="${svgH}" stroke="#e6b450" stroke-dasharray="2 3"/><text x="${x + 3}" y="36" fill="#e6b450" font-size="10">${esc(p.name)}</text>`; }
    svg += `<defs><marker id="ar" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#6f7a8d"/></marker></defs></svg>`;
    wrap.innerHTML = svg; wrap.addEventListener('click', (e) => { const id = e.target.getAttribute?.('data-a'); if (id) { st.sel = id; render(); } });
    w.append(wrap);
    if (st.sel) renderEdit(SC.acts.find(a => a.id === st.sel));
  }
  const count = (a) => allElements(P, r => matchAct(a, r)).length;
  function renderEdit(a) {
    if (!a) return; const card = h('div', { class: 'card', style: { marginTop: '12px' } }); w.append(card);
    const kv = h('div', { class: 'row', style: { alignItems: 'flex-end' } });
    const fld = (label, el) => h('label', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } }, h('span', { class: 'note' }, label), el);
    const name = h('input', { value: a.name, style: { width: '200px' } }); name.onchange = () => { a.name = name.value; save(); render(); };
    const sd = h('input', { type: 'date', value: a.start }); sd.onchange = () => { a.start = sd.value; a.pred = []; save(); render(); };
    const du = h('input', { type: 'number', value: a.dur, style: { width: '70px' } }); du.onchange = () => { a.dur = Math.max(1, +du.value); save(); render(); };
    const pr = h('select', { multiple: true, style: { minWidth: '180px', height: '60px' } }); for (const o of SC.acts) if (o !== a) pr.append(h('option', { value: o.id, selected: (a.pred || []).includes(o.id) }, o.name)); pr.onchange = () => { a.pred = [...pr.selectedOptions].map(o => o.value); save(); render(); };
    const lag = h('input', { type: 'number', value: a.lag || 0, style: { width: '60px' } }); lag.onchange = () => { a.lag = +lag.value; save(); render(); };
    const sel = (label, key, opts) => { const s = h('select'); s.append(h('option', { value: '' }, '전체')); for (const [v, l] of opts) s.append(h('option', { value: v, selected: a.filter?.[key] === v }, l)); s.onchange = () => { a.filter ||= {}; a.filter[key] = s.value || undefined; a.ids = null; save(); render(); }; return fld(label, s); };
    const zones = [...new Set(allElements(P).map(r => r.el.zone).filter(Boolean))];
    kv.append(fld('활동명', name), fld('시작', sd), fld('기간(일)', du), fld('선행(FS, 여러개)', pr), fld('지연(일)', lag), sel('층', 'level', P.levels.map(l => [l.id, l.name])), sel('공종', 'disc', Object.entries(DISC).map(([k, d]) => [k, d.name])), sel('객체', 'kind', Object.entries(KINDS).map(([k, d]) => [k, d.name])), sel('구역', 'zone', zones.map(z => [z, z])));
    card.append(h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '8px' } }, h('div', { class: 't' }, `${a.name} — ${a.start} ~ ${a.end}`), h('div', { class: 'row' },
      h('button', { class: 'btn sm', onclick: () => { const ids = allElements(P, r => matchAct(a, r)).map(r => r.el.id); ctx.state.hi = { ids, label: a.name }; ctx.go('view3d'); } }, `연결 객체 ${count(a)}개 3D 보기`),
      h('button', { class: 'btn sm', onclick: () => { const i = SC.acts.indexOf(a); if (i > 0) { SC.acts.splice(i, 1); SC.acts.splice(i - 1, 0, a); save(); render(); } } }, '↑'), h('button', { class: 'btn sm', onclick: () => { const i = SC.acts.indexOf(a); SC.acts.splice(i, 1); SC.acts.splice(i + 1, 0, a); save(); render(); } }, '↓'),
      h('button', { class: 'btn sm danger', onclick: () => { SC.acts = SC.acts.filter(x => x !== a); for (const o of SC.acts) o.pred = (o.pred || []).filter(p => p !== a.id); st.sel = null; save(); render(); } }, '삭제'))), kv);
  }
  async function importSched() {
    const f = await pickFile('.xml,.xlsx,.xls,.csv'); if (!f) return;
    let rows = [];
    try {
      if (/\.xml$/i.test(f.name)) rows = parseMSP(await f.text());
      else { const X = await xlsx(); const wb = X.read(new Uint8Array(await f.arrayBuffer()), { type: 'array', cellDates: true }); const ws = wb.Sheets[wb.SheetNames[0]]; rows = parseTable(X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' })); }
    } catch (e) { console.error(e); return toast('공정표를 읽지 못했습니다: ' + e.message, 'err'); }
    if (!rows.length) return toast('활동을 찾지 못했습니다 (작업명·시작·기간/종료 열 필요)', 'err');
    const acts = rows.map(r => ({ id: uid('a'), _src: r.id, name: r.name, start: r.start, dur: r.dur, lag: 0, pred: [], filter: guessFilter(P, r.name) }));
    const bySrc = Object.fromEntries(acts.map(a => [a._src, a.id])); rows.forEach((r, i) => { acts[i].pred = (r.pred || []).map(p => bySrc[p]).filter(Boolean); });
    // 선행이 있으면 엑셀/XML 날짜가 우선(실제 계획일): 선행 계산으로 덮어쓰지 않도록 lag 보정
    const linked = acts.filter(a => Object.keys(a.filter).length).length;
    const v = await dialog({ title: '공정표 불러오기', body: `<div class="note">${esc(f.name)} — 활동 ${acts.length}개, 이 중 ${linked}개를 활동명(층·공종·부재 단어)으로 모델에 자동 연결했습니다. 연결 안 된 활동은 목록에서 필터를 지정하면 4D에 나옵니다.</div>`, fields: [{ key: 'mode', label: '방식', type: 'select', options: [['replace', '기존 활동 바꾸기'], ['append', '뒤에 추가']], value: 'replace' }, { key: 'keep', label: '파일의 날짜 그대로 쓰기 (선행 관계는 표시만)', type: 'checkbox', value: true }] });
    if (!v) return; if (v.keep) for (const a of acts) { a.predShow = a.pred; a.pred = []; }
    for (const a of acts) delete a._src;
    SC.acts = v.mode === 'append' ? [...SC.acts, ...acts] : acts; SC.start = acts.reduce((m, a) => a.start < m ? a.start : m, acts[0].start); save(); render(); toast(`활동 ${acts.length}개 불러옴`, 'ok');
  }
  async function gen() {
    if (SC.acts.length && !await confirmBox('공정 자동 생성', '기존 활동을 지우고 모델에서 다시 만듭니다.', '생성')) return;
    const v = await dialog({ title: '공정 자동 생성', fields: [{ key: 's', label: '착공일', type: 'date', value: P.bill.periods[0]?.date ? addDays(P.bill.periods[0].date, -30) : SC.start }] }); if (!v) return;
    SC.start = v.s; SC.acts = autoGenerate(P, v.s); save(); render(); toast(`활동 ${SC.acts.length}개 생성`, 'ok');
  }
  async function addAct() {
    const v = await dialog({ title: '활동 추가', fields: [{ key: 'n', label: '활동명', value: '' }, { key: 's', label: '시작', type: 'date', value: SC.acts[SC.acts.length - 1]?.end || SC.start }, { key: 'd', label: '기간(일)', type: 'number', value: 7 }] }); if (!v?.n) return;
    const a = { id: uid('a'), name: v.n, start: v.s, dur: v.d || 1, pred: [], filter: {}, color: '#a78bfa' }; SC.acts.push(a); st.sel = a.id; save(); render();
  }
  function fillPlan() {
    if (!P.bill.periods.length) return toast('기성 회차가 없습니다', 'err');
    const rows = takeoff(P); for (const p of P.bill.periods) if (p.date) p.plan = +plannedPct(P, p.date, rows).toFixed(2);
    save(); toast('회차별 계획 기성률을 공정표 기준으로 입력했습니다', 'ok'); render();
  }
  render();
  return { unmount() { } };
}

// ---------- 공정표 가져오기 ----------
const dstr = (v) => { if (v instanceof Date) return toS(v.getTime() - v.getTimezoneOffset() * 60000); if (typeof v === 'number') return toS(Math.round((v - 25569) * DAY)); const m = String(v).match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null; };
export function parseMSP(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml'); const tasks = [...doc.getElementsByTagName('Task')];
  const T = (t, n) => t.getElementsByTagName(n)[0]?.textContent?.trim() || '';
  const out = [];
  for (const t of tasks) {
    if (T(t, 'Summary') === '1' || !T(t, 'Name') || !T(t, 'Start')) continue;
    const start = dstr(T(t, 'Start')), fin = dstr(T(t, 'Finish')); const m = T(t, 'Duration').match(/PT(\d+)H(\d+)M/);
    const dur = fin ? Math.max(1, daysBetween(start, fin) + 1) : m ? Math.max(1, Math.round((+m[1] + m[2] / 60) / 8)) : 1;
    out.push({ id: T(t, 'UID'), name: T(t, 'Name'), start, dur, pred: [...t.getElementsByTagName('PredecessorLink')].map(p => T(p, 'PredecessorUID')) });
  }
  return out;
}
export function parseTable(aoa) {
  const hi = aoa.findIndex(r => r.some(c => /작업|활동|공종명|task|name/i.test(String(c))) && r.some(c => /시작|착수|start/i.test(String(c)))); if (hi < 0) return [];
  const H = aoa[hi].map(c => String(c).trim()); const col = (re) => H.findIndex(c => re.test(c));
  const cN = col(/작업|활동|공종명|task|name/i), cS = col(/시작|착수|start/i), cE = col(/종료|완료|finish|end/i), cD = col(/기간|일수|duration/i), cP = col(/선행|pred/i), cI = col(/^(id|no|번호|코드|uid)$/i);
  const out = [];
  aoa.slice(hi + 1).forEach((r, i) => {
    const name = String(r[cN] ?? '').trim(), start = dstr(r[cS]); if (!name || !start) return;
    const end = cE >= 0 ? dstr(r[cE]) : null; const d = cD >= 0 ? parseFloat(String(r[cD]).replace(/[^\d.]/g, '')) : NaN;
    out.push({ id: cI >= 0 ? String(r[cI]).trim() : String(i + 1), name, start, dur: Math.max(1, end ? daysBetween(start, end) + 1 : (d || 1)), pred: cP >= 0 ? String(r[cP]).split(/[,;\s]+/).map(x => x.replace(/(FS|SS|FF|SF).*$/i, '').trim()).filter(Boolean) : [] });
  });
  return out;
}
const KW = { footing: /기초|footing/i, column: /기둥|column/i, beam: /보\b|보\s|보$|거더|beam/i, slab: /슬래브|slab|바닥판/i, wall: /벽|조적|wall/i, duct: /덕트|duct|공조/i, pipe: /배관|급수|배수|소화|pipe/i, tray: /트레이|전기|tray|케이블/i };
export function guessFilter(P, name) {
  const f = {}; const n = name.replace(/\s+/g, ' ');
  for (const L of P.levels) { const num = (L.name.match(/(B?\d+)/) || [])[1]; if (n.includes(L.name) || (num && new RegExp(`(^|[^\\d])${num}\\s*(층|F)`, 'i').test(n))) { f.level = L.id; break; } }
  for (const [k, re] of Object.entries(KW)) if (re.test(n)) { f.kind = k; break; }
  if (/철골/.test(n)) f.kind ||= 'column';
  return (f.level || f.kind) ? f : {};
}
