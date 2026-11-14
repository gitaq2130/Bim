// UI 도우미: 대화상자, 알림, 내보내기
import { esc } from './util.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v; else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'html') e.innerHTML = v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(c));
  return e;
}

export function toast(msg, kind = 'info', ms = 2600) {
  let box = $('#toasts'); if (!box) { box = h('div', { id: 'toasts' }); document.body.append(box); }
  const t = h('div', { class: 'toast ' + kind }, msg); box.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

// 모달 대화상자. fields: [{key,label,type,value,options,step}] → 값 객체 또는 null
export function dialog({ title, body, fields = [], ok = '확인', cancel = '취소', wide = false, danger = false }) {
  return new Promise((resolve) => {
    const bg = h('div', { class: 'modal-bg' });
    const form = h('form', { class: 'modal' + (wide ? ' wide' : '') });
    form.append(h('h3', {}, title || ''));
    if (body) form.append(typeof body === 'string' ? h('div', { class: 'modal-body', html: body }) : body);
    const inputs = {};
    for (const f of fields) {
      let inp;
      if (f.type === 'select') { inp = h('select', { name: f.key }); for (const o of f.options) { const [v, l] = Array.isArray(o) ? o : [o, o]; const op = h('option', { value: v }, l); if (String(v) === String(f.value)) op.selected = true; inp.append(op); } }
      else if (f.type === 'textarea') { inp = h('textarea', { name: f.key, rows: f.rows || 4 }); inp.value = f.value ?? ''; }
      else if (f.type === 'checkbox') { inp = h('input', { type: 'checkbox', name: f.key }); inp.checked = !!f.value; }
      else { inp = h('input', { name: f.key, type: f.type || 'text', step: f.step || 'any', placeholder: f.placeholder || '' }); inp.value = f.value ?? ''; }
      inputs[f.key] = inp;
      form.append(h('label', { class: 'fld' + (f.type === 'checkbox' ? ' chk' : '') }, h('span', {}, f.label), inp));
    }
    const bar = h('div', { class: 'modal-bar' });
    if (cancel) bar.append(h('button', { type: 'button', class: 'btn', onclick: () => done(null) }, cancel));
    bar.append(h('button', { type: 'submit', class: 'btn ' + (danger ? 'danger' : 'primary') }, ok));
    form.append(bar);
    const done = (v) => { bg.remove(); resolve(v); };
    form.addEventListener('submit', (e) => {
      e.preventDefault(); const out = {};
      for (const f of fields) { const i = inputs[f.key]; out[f.key] = f.type === 'checkbox' ? i.checked : f.type === 'number' ? (i.value === '' ? null : +i.value) : i.value; }
      done(out);
    });
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) done(null); });
    bg.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } });
    bg.append(form); document.body.append(bg);
    setTimeout(() => (Object.values(inputs)[0] || form.querySelector('button[type=submit]'))?.focus(), 30);
  });
}
export const confirmBox = (title, body, ok = '확인', danger = false) => dialog({ title, body, ok, danger }).then(v => !!v);

// 파일 선택
export function pickFile(accept) {
  return new Promise((resolve) => {
    const i = h('input', { type: 'file', accept, style: { display: 'none' } });
    i.addEventListener('change', () => { resolve(i.files[0] || null); i.remove(); });
    document.body.append(i); i.click();
  });
}
export const readText = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); });

// 파일 내보내기: downloads 기능 → 실패 시 복사용 창
let dl = undefined;
export async function saveFile(filename, data) {
  if (dl === undefined) dl = window.claude?.use ? await Promise.race([window.claude.use('downloads'), new Promise(r => setTimeout(() => r(null), 4000))]) : null;
  if (dl) {
    try { await dl.save({ filename, data }); toast('저장했습니다: ' + filename, 'ok'); return true; }
    catch (e) { if (e?.code === 'declined') { toast('저장을 취소했습니다'); return false; } console.warn(e); }
  }
  // 대체: 링크 다운로드 시도 + 텍스트 복사
  try {
    const blob = data instanceof Blob ? data : new Blob([data]);
    const a = h('a', { href: URL.createObjectURL(blob), download: filename }); document.body.append(a); a.click(); a.remove();
  } catch { }
  if (typeof data === 'string' && data.length < 2_000_000) {
    const ta = h('textarea', { class: 'mono', rows: 10, readonly: true }); ta.value = data;
    await dialog({ title: '내보내기 — ' + filename, body: h('div', {}, h('p', {}, '이 화면에서 파일 저장이 막혀 있으면 아래 내용을 복사해 파일로 저장하세요.'), ta, h('button', { type: 'button', class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(data); toast('복사했습니다', 'ok'); } catch { ta.select(); } } }, '복사')), cancel: null, ok: '닫기', wide: true });
  }
  return false;
}

// Claude 호출(sample) — 사용 불가면 null
let smp = undefined;
export async function getSample() {
  if (smp === undefined) smp = window.claude?.use ? await Promise.race([window.claude.use('sample'), new Promise(r => setTimeout(() => r(null), 6000))]) : null;
  return smp;
}

export function table(cols, rows, opts = {}) {
  const t = h('table', { class: 'grid' + (opts.cls ? ' ' + opts.cls : '') });
  const thead = h('thead', {}, h('tr', {}, cols.map(c => h('th', { class: c.num ? 'num' : '', style: c.w ? { width: c.w } : null }, c.label))));
  const tb = h('tbody');
  for (const r of rows) {
    const tr = h('tr', { class: opts.rowClass?.(r) || '' });
    if (opts.onRow) { tr.classList.add('click'); tr.addEventListener('click', () => opts.onRow(r, tr)); }
    for (const c of cols) { const v = c.render ? c.render(r) : r[c.key]; tr.append(h('td', { class: (c.num ? 'num ' : '') + (c.cls?.(r) || '') }, v instanceof Node ? v : (v ?? ''))); }
    tb.append(tr);
  }
  t.append(thead, tb);
  if (opts.foot) t.append(h('tfoot', {}, h('tr', {}, cols.map(c => h('td', { class: c.num ? 'num' : '' }, opts.foot[c.key] ?? '')))));
  return t;
}
export { esc };

// ---------- 승인 상태 (표기만, 알림 없음) ----------
export const APPROVAL = { '작성': '', '검토중': 'warn', '승인': 'ok', '반려': 'bad' };
export function approvalBadge(a) {
  const s = a?.status || '작성';
  return h('span', { class: 'pill ' + APPROVAL[s], title: a?.by || a?.date ? `${s}${a.by ? ' · ' + a.by : ''}${a.date ? ' · ' + a.date : ''}${a.note ? '\n' + a.note : ''}` : s }, s + (a?.by ? ` · ${a.by}` : ''));
}
// 대상 객체 o 의 o.approval 편집. 저장되면 true
export async function editApproval(o, title = '승인 상태') {
  const a = o.approval || {};
  const v = await dialog({ title, body: '<div class="note">상태만 기록합니다. 알림은 보내지 않습니다.</div>', fields: [{ key: 'status', label: '상태', type: 'select', options: Object.keys(APPROVAL), value: a.status || '작성' }, { key: 'by', label: '처리자 (예: 감리단 홍길동)', value: a.by || '' }, { key: 'date', label: '처리일', type: 'date', value: a.date || new Date().toISOString().slice(0, 10) }, { key: 'note', label: '의견', type: 'textarea', rows: 2, value: a.note || '' }], ok: '저장' });
  if (!v) return false;
  o.approval = { ...v, at: Date.now(), log: [...(a.log || []), { status: v.status, by: v.by, date: v.date, note: v.note, at: Date.now() }].slice(-30) };
  return true;
}
export function approvalCell(o, onSave, title) { const wrap = h('span', { style: { cursor: 'pointer' }, title: '눌러서 승인 상태 변경', onclick: async (e) => { e.stopPropagation(); if (await editApproval(o, title)) onSave?.(); } }, approvalBadge(o.approval)); return wrap; }

// 외부 스크립트 1회 로드
const loaded = new Map();
export function loadScript(src) { if (!loaded.has(src)) loaded.set(src, new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('스크립트를 불러오지 못했습니다: ' + src)); document.head.append(s); })); return loaded.get(src); }
