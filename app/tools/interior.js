// 빌더 인테리어·조명 — 실별 마감·조명 검토 (트랙: interior)
// v1: 실 목록, 광속법 평균 조도, 슬래브에서 실 생성, 목표 조도 기준 조명 자동 배치.
// v2: 실별 마감표(바닥·걸레받이·벽·천장)와 마감 물량, 천장고 자동 산정, 실 → 천장 자동 생성.
import { h, table, toast, dialog, saveFile } from '../js/ui.js';
import { allElements, KINDS } from '../js/model.js';
import { uid, fmt, fmt0, polyArea, polyPerim, pointInPoly, bboxOf, closestOnSeg, segInt, sub, add, mul, norm, csv } from '../js/util.js';

// 용도별 기본 목표 조도(lx) — KS A 3011 범위의 대표값. 사용자는 용도만 고른다.
export const LUX_BY_USE = {
  사무실: 500, 회의실: 500, 로비: 300, 복도: 150, 계단: 100, 화장실: 150, 창고: 150, 주차장: 75,
  거실: 150, 침실: 100, 주방: 300, 식당: 300, 기계실: 150, 전기실: 200,
};
const USES = Object.keys(LUX_BY_USE);

// 용도별 표준 마감 — [바닥, 걸레받이, 벽, 천장]. 천장 '노출'이면 천장을 만들지 않는다.
export const FIN_BY_USE = {
  사무실: ['OA플로어+카펫타일', '스틸 H100', '석고보드 2겹+수성페인트', '마이톤 텍스 600×600'],
  회의실: ['카펫타일', '목재 H100', '흡음 패널', '흡음 텍스 600×600'],
  로비: ['화강석 물갈기 30T', '화강석 H100', '화강석 판석', '석고보드 2겹+도장'],
  복도: ['포세린 타일 600×600', '스틸 H100', '석고보드 2겹+수성페인트', '마이톤 텍스 600×600'],
  계단: ['화강석 버너 30T', '화강석 H100', '수성페인트', '노출(수성페인트)'],
  화장실: ['자기질 타일 300×300', '-', '도기질 타일 300×600', '방수 석고보드+도장'],
  창고: ['에폭시 코팅', '에폭시 H100', '수성페인트', '노출(수성페인트)'],
  주차장: ['에폭시 라이닝', '-', '수성페인트', '노출(수성페인트)'],
  거실: ['강마루', '목재 H80', '실크벽지', '석고보드+벽지'],
  침실: ['강마루', '목재 H80', '실크벽지', '석고보드+벽지'],
  주방: ['강마루', '목재 H80', '주방 타일 300×600', '석고보드+도장'],
  식당: ['강마루', '목재 H80', '실크벽지', '석고보드+벽지'],
  기계실: ['에폭시 코팅', '에폭시 H100', '수성페인트', '노출(수성페인트)'],
  전기실: ['대전방지 에폭시', '에폭시 H100', '수성페인트', '노출(수성페인트)'],
};
// 용도별 권장 천장고(mm) — 공간이 허락하면 이 높이, 모자라면 천장 속 필요 높이를 빼고 가능한 최대.
const CH_BY_USE = { 사무실: 2700, 회의실: 2700, 로비: 3000, 복도: 2400, 화장실: 2400, 거실: 2300, 침실: 2300, 주방: 2300, 식당: 2400 };
// 거실(사람이 머무는 실) — 반자높이 2.1m 이상 (건축물의 피난·방화구조 등의 기준에 관한 규칙 제16조)
const HABITABLE = ['사무실', '회의실', '로비', '거실', '침실', '주방', '식당'];
const CH_MIN = 2100, CLR_MEP = 100, CLR_STR = 150; // 설비 하단 여유, 구조체 하단~천장 상단 최소 (행거·매입등)
const FIN_KEYS = [['floor', '바닥'], ['base', '걸레받이'], ['wall', '벽'], ['ceil', '천장']];
const isExposed = (c) => !c || c === '-' || c.startsWith('노출');
const LINEAR = ['duct', 'pipe', 'tray'];

const centroid = (pts) => { const n = pts.length; return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n]; };

// 실별 조명 계산 (광속법: E = N·Φ·U·M / A)
export function roomLighting(P) {
  const L = P.interior?.lighting || {}; const U = L.uf ?? 0.6, M = L.mf ?? 0.8;
  const all = allElements(P);
  const rooms = all.filter(r => r.el.k === 'room');
  const lights = all.filter(r => r.el.k === 'light');
  return rooms.map(r => {
    const A = Math.abs(polyArea(r.el.pts)) * 1e-6;
    const inside = lights.filter(l => l.level.id === r.level.id && pointInPoly(l.el.p, r.el.pts));
    const lm = inside.reduce((s, l) => s + (l.el.lm || 0), 0), watt = inside.reduce((s, l) => s + (l.el.watt || 0), 0);
    const target = r.el.lux || LUX_BY_USE[r.el.use] || 300;
    const E = A > 0 ? lm * U * M / A : 0;
    return { r, A, n: inside.length, lm, watt, wpm2: A ? watt / A : 0, E, target, ok: E >= target * 0.9, lights: inside };
  });
}

// 실 하나의 천장고 자동 산정: 층고·상부 슬래브·보 춤·설비 하단을 읽어 가능한 최대 천장고와 용도 권장값 중 작은 값.
function ceilingOf(P, r, all) {
  const lv = r.level, H = lv.height || 3000, pts = r.el.pts, bb = bboxOf(pts);
  const inRoom = (p) => pointInPoly(p, pts);
  // 선분이 실을 지나는지: 끝점·중점이 안에 있거나 경계와 교차 (경계를 따라가는 보도 포함)
  const segIn = (a, b) => inRoom(a) || inRoom(b) || inRoom(mul(add(a, b), 0.5)) || pts.some((p, i) => segInt(a, b, p, pts[(i + 1) % pts.length]));
  const upper = P.levels.filter(l => l.elev > lv.elev).sort((a, b) => a.elev - b.elev)[0];
  const c = [(bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2];
  const slab = upper && all.find(x => x.el.k === 'slab' && x.level.id === upper.id && pointInPoly(c, x.el.pts));
  const ts = slab ? slab.el.t : 0;
  const beams = all.filter(x => x.el.k === 'beam' && x.level.id === lv.id && segIn(x.el.a, x.el.b));
  const bd = beams.reduce((m, x) => Math.max(m, (x.el.d || 0) - (x.el.dz || 0)), 0);
  const strBot = H - Math.max(ts, bd);
  const meps = all.filter(x => LINEAR.includes(x.el.k) && x.level.id === lv.id && segIn(x.el.a, x.el.b));
  const mepBot = meps.reduce((m, x) => Math.min(m, (x.el.z ?? 3000) - (x.el.hh || 0) / 2), Infinity);
  const t = KINDS.ceiling.def.t;
  const cap = Math.min(strBot - CLR_STR, mepBot - CLR_MEP) - t;
  const avail = Math.floor(cap / 50) * 50;
  const want = CH_BY_USE[r.el.use] ?? 2700;
  const z = Math.max(0, Math.min(want, avail));
  const why = [`층고 ${fmt0(H)}`, ts ? `상부 슬래브 ${fmt0(ts)}` : null, bd ? `보 춤 ${fmt0(bd)}` : null,
    meps.length ? `설비 하단 ${fmt0(mepBot)} (${meps.length}개)` : '설비 없음', `가능 최대 ${fmt0(avail)}`, `용도 권장 ${fmt0(want)}`].filter(Boolean).join(' · ');
  return { z, avail, want, strBot, mepBot: isFinite(mepBot) ? mepBot : null, why };
}

// 실별 마감표·물량. 마감은 용도 표준 + 실별 수정값(P.interior.finishes.rooms[실 id]).
// 반환 행: { r, use, fin{floor,base,wall,ceil}, own{...}, A, perim, ch, chAuto, chWhy, wallH, open, doorW, q{floor,base,wall,ceil}, warn }
export function roomFinishes(P) {
  const all = allElements(P); const store = P.interior?.finishes?.rooms || {};
  return all.filter(x => x.el.k === 'room').map(r => {
    const use = r.el.use || '사무실', std = FIN_BY_USE[use] || FIN_BY_USE.사무실, own = store[r.el.id] || {};
    const fin = {}; FIN_KEYS.forEach(([k], i) => { fin[k] = own[k] ?? (k === 'ceil' ? r.el.fin : null) ?? std[i]; }); // r.el.fin: v1에서 실에 적던 천장 마감
    const A = Math.abs(polyArea(r.el.pts)) * 1e-6, perim = polyPerim(r.el.pts) * 1e-3;
    const auto = ceilingOf(P, r, all); const exposed = isExposed(fin.ceil);
    const ch = own.h ?? auto.z;
    const wallH = exposed ? auto.strBot : ch;   // 노출천장이면 구조체 하단까지 벽 마감
    // 실 경계 위의 개구부 공제 (벽 두께/2 + 100mm 이내)
    const hosts = new Map(all.filter(x => x.el.k === 'wall' && x.level.id === r.level.id).map(x => [x.el.id, x.el]));
    let open = 0, doorW = 0;
    for (const o of all.filter(x => x.el.k === 'opening' && x.level.id === r.level.id)) {
      const w = hosts.get(o.el.host); if (!w) continue;
      const d = norm(sub(w.b, w.a)), cp = add(w.a, mul(d, (o.el.s || 0) + o.el.w / 2));
      let m = Infinity; for (let i = 0; i < r.el.pts.length; i++) m = Math.min(m, closestOnSeg(cp, r.el.pts[i], r.el.pts[(i + 1) % r.el.pts.length]).d);
      if (m > (w.t || 200) / 2 + 100) continue;
      const oh = Math.max(0, Math.min(o.el.h, wallH - (o.el.sill || 0)));
      open += o.el.w * oh * 1e-6; if (o.el.kind !== 'window') doorW += o.el.w * 1e-3;
    }
    const q = {
      floor: A,
      base: fin.base && fin.base !== '-' ? Math.max(0, perim - doorW) : 0,
      wall: Math.max(0, perim * wallH * 1e-3 - open),
      ceil: exposed ? 0 : A,
    };
    const warn = [];
    if (!exposed && HABITABLE.includes(use) && ch < CH_MIN) warn.push(`반자높이 ${fmt0(ch)} < ${CH_MIN} (피난·방화규칙 제16조)`);
    if (own.h != null && own.h > auto.avail) warn.push(`지정 천장고가 가능 최대 ${fmt0(auto.avail)}를 넘음 — 설비·보 간섭`);
    return { r, use, fin, own, std, A, perim, ch, chAuto: auto.z, chWhy: auto.why, avail: auto.avail, exposed, wallH, open, doorW, q, warn };
  });
}

export function mount(root, ctx) {
  const P = ctx.P; P.interior ||= { finishes: {}, lighting: { uf: 0.6, mf: 0.8 } }; P.interior.lighting ||= { uf: 0.6, mf: 0.8 };
  P.interior.finishes ||= {}; P.interior.finishes.rooms ||= {};
  const st = { tab: 'light' };
  const page = h('div', { class: 'page' }), w = h('div', { class: 'wrap' }); page.append(w); root.append(page);
  const changed = () => { ctx.touch('meta'); ctx.bus.emit('model'); };

  // 슬래브 외곽에서 실 생성 (이미 실이 있는 위치는 건너뜀)
  function roomsFromSlabs() {
    const all = allElements(P); const rooms = all.filter(r => r.el.k === 'room'); let n = 0;
    const top = P.levels.length > 1 ? P.levels.reduce((a, b) => (b.elev > a.elev ? b : a)) : null; // 최상층(지붕) 슬래브는 제외
    for (const s of all.filter(r => r.el.k === 'slab' && r.level !== top)) {
      const c = centroid(s.el.pts);
      if (rooms.some(r => r.level.id === s.level.id && pointInPoly(c, r.el.pts))) continue;
      const sheet = P.sheets.find(x => x.level === s.level.id && x.disc === 'A') || s.sheet;
      const el = { id: uid('e'), k: 'room', ...KINDS.room.def, pts: s.el.pts.map(p => [...p]), name: `${s.level.name} 실${++n}`, h: Math.max(2400, (s.level.height || 3000) - 600) };
      P.content[sheet.id].els.push(el); rooms.push({ el, level: s.level, sheet });
    }
    if (!n) return toast('새로 만들 실이 없습니다 (슬래브가 없거나 이미 실이 있음)');
    changed(); toast(`실 ${n}개를 만들었습니다 — 용도를 지정하면 목표 조도가 정해집니다`, 'ok'); render();
  }

  // 목표 조도를 만족하도록 격자 배치 (자동 배치분만 교체)
  function autoLights(rows) {
    const { uf: U, mf: M } = P.interior.lighting; let total = 0;
    for (const x of rows) {
      const els = P.content[x.r.sheet.id].els;
      for (let i = els.length - 1; i >= 0; i--) { const e = els[i]; if (e.k === 'light' && e.auto === x.r.el.id) els.splice(i, 1); }
      const def = KINDS.light.def; const need = Math.max(1, Math.ceil(x.target * x.A / (def.lm * U * M)));
      const bb = bboxOf(x.r.el.pts); const W = bb.x1 - bb.x0, D = bb.y1 - bb.y0;
      let nx = Math.max(1, Math.round(Math.sqrt(need * W / Math.max(D, 1)))), ny = Math.max(1, Math.ceil(need / nx));
      let pts = [];
      for (let tries = 0; tries < 6; tries++) {
        pts = [];
        for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { const p = [bb.x0 + W * (i + 0.5) / nx, bb.y0 + D * (j + 0.5) / ny]; if (pointInPoly(p, x.r.el.pts)) pts.push(p); }
        if (pts.length >= need) break; nx++; ny++;
      }
      const z = (x.r.el.h || def.z);
      for (const p of pts) els.push({ id: uid('e'), k: 'light', ...def, p, z, auto: x.r.el.id });
      total += pts.length;
    }
    changed(); toast(`조명 ${total}개를 배치했습니다`, 'ok'); render();
  }

  // 실 → 천장 생성·갱신. 노출 천장인 실은 연결된 천장을 지운다. 천장고는 자동 산정값(지정값이 있으면 지정값).
  function syncCeilings() {
    const rows = roomFinishes(P); let made = 0, upd = 0, del = 0;
    const linked = allElements(P, x => x.el.k === 'ceiling' && x.el.room);
    for (const x of rows) {
      const mine = linked.filter(c => c.el.room === x.r.el.id);
      if (x.exposed) { for (const c of mine) { const els = P.content[c.sheet.id].els; els.splice(els.indexOf(c.el), 1); del++; } }
      else if (mine.length) { for (const c of mine) { Object.assign(c.el, { pts: x.r.el.pts.map(p => [...p]), z: x.ch, fin: x.fin.ceil }); upd++; } }
      else { P.content[x.r.sheet.id].els.push({ id: uid('e'), k: 'ceiling', ...KINDS.ceiling.def, pts: x.r.el.pts.map(p => [...p]), z: x.ch, fin: x.fin.ceil, room: x.r.el.id }); made++; }
      x.r.el.h = x.exposed ? x.wallH : x.ch;
      // 자동 배치 조명은 천장면을 따라간다
      for (const l of allElements(P, y => y.el.k === 'light' && y.el.auto === x.r.el.id)) l.el.z = x.r.el.h;
    }
    changed(); toast(`천장 생성 ${made} · 갱신 ${upd} · 삭제(노출) ${del}`, 'ok'); render();
  }

  async function editRoom(x) {
    const f = roomFinishes(P).find(y => y.r.el.id === x.r.el.id); const own = P.interior.finishes.rooms[x.r.el.id] || {};
    const v = await dialog({ title: `실 — ${x.r.el.name || ''}`, body: `천장고 자동 산정: ${f.chWhy} → ${fmt0(f.chAuto)}mm`, wide: true, fields: [
      { key: 'name', label: '실명', value: x.r.el.name || '' },
      { key: 'use', label: '용도', type: 'select', options: USES, value: x.r.el.use || '사무실' },
      ...FIN_KEYS.map(([k, nm]) => ({ key: k, label: `${nm} 마감`, value: f.fin[k] })),
      { key: 'h', label: '천장고 직접 지정 mm (비우면 자동)', type: 'number', value: own.h ?? '' },
    ] });
    if (!v) return;
    const useChanged = v.use !== x.r.el.use;
    Object.assign(x.r.el, { name: v.name, use: v.use, lux: LUX_BY_USE[v.use] }); delete x.r.el.fin;
    const std = FIN_BY_USE[v.use] || FIN_BY_USE.사무실, o = {};
    FIN_KEYS.forEach(([k], i) => {
      const val = (v[k] || '').trim();
      if (useChanged && val === f.fin[k] && own[k] == null) return; // 용도를 바꾸면 새 용도 표준을 따른다
      if (val && val !== std[i]) o[k] = val;
    });
    if (v.h != null && v.h > 0) o.h = v.h;
    if (Object.keys(o).length) P.interior.finishes.rooms[x.r.el.id] = o; else delete P.interior.finishes.rooms[x.r.el.id];
    changed(); render();
  }

  function exportFinishes(rows) {
    const out = [['층', '실명', '용도', '면적 m²', '천장고 mm', '바닥', '바닥 m²', '걸레받이', '걸레받이 m', '벽', '벽 m²', '천장', '천장 m²', '비고']];
    for (const x of rows) out.push([x.r.level.name, x.r.el.name || '', x.use, x.A.toFixed(2), x.exposed ? '노출' : x.ch, x.fin.floor, x.q.floor.toFixed(2), x.fin.base, x.q.base.toFixed(2), x.fin.wall, x.q.wall.toFixed(2), x.fin.ceil, x.q.ceil.toFixed(2), x.warn.join(' / ')]);
    saveFile(`${P.name || '프로젝트'}_실별마감표.csv`, csv(out));
  }

  function renderFinish() {
    const rows = roomFinishes(P);
    w.append(h('div', { class: 'row', style: { margin: '12px 0', gap: '6px', flexWrap: 'wrap' } },
      h('button', { class: 'btn primary', onclick: syncCeilings }, '실 → 천장 자동 생성·갱신'),
      h('button', { class: 'btn', onclick: () => exportFinishes(rows) }, '마감표 CSV 저장')));
    // 마감별 물량 집계
    const sum = {};
    for (const x of rows) for (const [k, nm] of FIN_KEYS) { if (!x.q[k]) continue; const key = `${nm}|${x.fin[k]}`; sum[key] = (sum[key] || 0) + x.q[k]; }
    const nCeil = allElements(P, y => y.el.k === 'ceiling' && y.el.room).length;
    w.append(h('div', { class: 'cards', style: { margin: '0 0 14px' } },
      ...[['실', rows.length], ['바닥 m²', fmt(rows.reduce((s, x) => s + x.q.floor, 0), 1)], ['벽 m²', fmt(rows.reduce((s, x) => s + x.q.wall, 0), 1)], ['천장 m²', fmt(rows.reduce((s, x) => s + x.q.ceil, 0), 1)], ['천장 객체', nCeil], ['검토 필요', rows.filter(x => x.warn.length).length]]
        .map(([k, v]) => h('div', { class: 'card' }, h('div', { class: 'd' }, k), h('div', { class: 't' }, String(v))))));
    const fc = (k) => (x) => h('span', { style: x.own[k] != null ? { fontWeight: 600 } : null, title: x.own[k] != null ? `수정값 (표준: ${x.std[FIN_KEYS.findIndex(f => f[0] === k)]})` : '용도 표준' }, x.fin[k]);
    w.append(table([
      { label: '층', render: x => x.r.level.name },
      { label: '실명', render: x => x.r.el.name || '-' },
      { label: '용도', render: x => x.use },
      { label: '면적 m²', num: true, render: x => fmt(x.A, 1) },
      { label: '바닥', render: fc('floor') },
      { label: '걸레받이', render: fc('base') },
      { label: '벽', render: fc('wall') },
      { label: '벽 m²', num: true, render: x => fmt(x.q.wall, 1) },
      { label: '천장', render: fc('ceil') },
      { label: '천장고', num: true, render: x => h('span', { title: x.chWhy }, x.exposed ? '노출' : fmt0(x.ch) + (x.own.h != null ? ' (지정)' : '')) },
      { label: '판정', render: x => x.warn.length ? '검토' : '적합', cls: x => x.warn.length ? 'warn' : 'ok' },
    ], rows, { onRow: editRoom }));
    const warns = rows.filter(x => x.warn.length);
    if (warns.length) w.append(h('div', { class: 'note', style: { marginTop: '8px' } }, ...warns.map(x => h('div', {}, `⚠ ${x.r.level.name} ${x.r.el.name}: ${x.warn.join(' / ')}`))));
    w.append(h('h3', { style: { marginTop: '16px' } }, '마감별 물량'));
    w.append(table([
      { label: '부위', render: e => e[0].split('|')[0] }, { label: '마감', render: e => e[0].split('|')[1] },
      { label: '수량', num: true, render: e => fmt(e[1], 2) }, { label: '단위', render: e => e[0].startsWith('걸레받이') ? 'm' : 'm²' },
    ], Object.entries(sum)));
    w.append(h('div', { class: 'note', style: { marginTop: '8px' } },
      `산정 기준: 바닥·천장 = 실 면적, 걸레받이 = 둘레 − 문 폭, 벽 = 둘레 × 천장고(노출천장은 구조체 하단까지) − 실 경계 위 개구부. ` +
      `천장고 = min(용도 권장, 구조체 하단 − ${CLR_STR}, 설비 하단 − ${CLR_MEP}) − 천장재 ${KINDS.ceiling.def.t}, 50mm 단위 내림. 거실류는 반자높이 ${CH_MIN}mm 이상 점검. ` +
      `마감은 용도 표준을 따르고, 행을 눌러 실별로 바꿀 수 있습니다(굵게 = 수정값). 천장 물량은 천장 객체를 만들면 내역(CLG)에 들어갑니다.`));
  }

  function render() {
    w.innerHTML = '';
    const rows = roomLighting(P);
    w.append(h('div', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' } },
      h('div', {}, h('h1', {}, '인테리어·조명'), h('div', { class: 'sub' }, '실(방)을 정의하고 용도를 고르면 목표 조도가 정해지고, 조명기구 배치로 평균 조도(광속법)를, 마감표에서 실별 마감·물량과 천장고를 산정합니다.')),
      h('div', { class: 'row', style: { gap: '6px' } },
        h('button', { class: 'btn', onclick: roomsFromSlabs }, '슬래브에서 실 만들기'),
        st.tab === 'light' ? h('button', { class: 'btn primary', disabled: !rows.length, onclick: () => autoLights(rows.filter(x => !x.ok)) }, '부족한 실 조명 자동 배치') : null)));
    w.append(h('div', { class: 'row', style: { marginTop: '12px', gap: '6px' } },
      ...[['light', '조명'], ['finish', '마감표·천장']].map(([id, nm]) => h('button', { class: 'btn' + (st.tab === id ? ' primary' : ''), onclick: () => { st.tab = id; render(); } }, nm))));

    if (!rows.length) {
      w.append(h('div', { class: 'card', style: { marginTop: '14px' } }, h('div', { class: 't' }, '실이 없습니다'), h('div', { class: 'd' }, '"슬래브에서 실 만들기"로 층 슬래브 외곽을 실로 가져오거나, 작도에서 실 영역을 그리세요.')));
      return;
    }
    if (st.tab === 'finish') return renderFinish();
    const A = rows.reduce((s, x) => s + x.A, 0), Wt = rows.reduce((s, x) => s + x.watt, 0);
    w.append(h('div', { class: 'cards', style: { margin: '14px 0' } },
      ...[['실', rows.length], ['면적 m²', fmt(A, 1)], ['조명기구', rows.reduce((s, x) => s + x.n, 0)], ['조도 부족', rows.filter(x => !x.ok).length], ['조명 밀도 W/m²', A ? fmt(Wt / A, 1) : '-']]
        .map(([k, v]) => h('div', { class: 'card' }, h('div', { class: 'd' }, k), h('div', { class: 't' }, String(v))))));
    w.append(table([
      { label: '층', render: x => x.r.level.name },
      { label: '실명', render: x => x.r.el.name || '-' },
      { label: '용도', render: x => x.r.el.use || '-' },
      { label: '면적 m²', num: true, render: x => fmt(x.A, 1) },
      { label: '기구', num: true, render: x => fmt0(x.n) },
      { label: '평균 조도 lx', num: true, render: x => fmt0(x.E) },
      { label: '목표 lx', num: true, render: x => fmt0(x.target) },
      { label: '판정', render: x => x.ok ? '적합' : '부족', cls: x => x.ok ? 'ok' : 'warn' },
    ], rows, { onRow: editRoom }));
    w.append(h('div', { class: 'note', style: { marginTop: '8px' } }, `계산 조건: 조명률 U=${P.interior.lighting.uf}, 보수율 M=${P.interior.lighting.mf}, 기본 기구 ${KINDS.light.def.type} ${KINDS.light.def.watt}W / ${fmt0(KINDS.light.def.lm)}lm. 판정은 목표의 90% 이상이면 적합. 행을 누르면 실명·용도·마감·천장고를 바꿀 수 있습니다.`));
  }
  render();
  const off = ctx.bus.on('model', render);
  return { unmount() { off(); } };
}
