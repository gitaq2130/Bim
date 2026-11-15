// 빌더 인테리어·조명 — 실별 마감·조명 검토 (트랙: interior)
// v1: 실 목록, 광속법 평균 조도, 슬래브에서 실 생성, 목표 조도 기준 조명 자동 배치.
import { h, table, toast, dialog } from '../js/ui.js';
import { allElements, KINDS } from '../js/model.js';
import { uid, fmt, fmt0, polyArea, pointInPoly, bboxOf } from '../js/util.js';

// 용도별 기본 목표 조도(lx) — KS A 3011 범위의 대표값. 사용자는 용도만 고른다.
export const LUX_BY_USE = {
  사무실: 500, 회의실: 500, 로비: 300, 복도: 150, 계단: 100, 화장실: 150, 창고: 150, 주차장: 75,
  거실: 150, 침실: 100, 주방: 300, 식당: 300, 기계실: 150, 전기실: 200,
};
const USES = Object.keys(LUX_BY_USE);

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

export function mount(root, ctx) {
  const P = ctx.P; P.interior ||= { finishes: {}, lighting: { uf: 0.6, mf: 0.8 } }; P.interior.lighting ||= { uf: 0.6, mf: 0.8 };
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

  async function editRoom(x) {
    const v = await dialog({ title: `실 — ${x.r.el.name || ''}`, fields: [
      { key: 'name', label: '실명', value: x.r.el.name || '' },
      { key: 'use', label: '용도', type: 'select', options: USES, value: x.r.el.use || '사무실' },
      { key: 'h', label: '천장고 mm', type: 'number', value: x.r.el.h || 2700 },
      { key: 'fin', label: '천장 마감', value: x.r.el.fin || '석고보드+도장' },
    ] });
    if (!v) return;
    Object.assign(x.r.el, { name: v.name, use: v.use, lux: LUX_BY_USE[v.use], h: +v.h || 2700, fin: v.fin });
    changed(); render();
  }

  function render() {
    w.innerHTML = '';
    const rows = roomLighting(P);
    w.append(h('div', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' } },
      h('div', {}, h('h1', {}, '인테리어·조명'), h('div', { class: 'sub' }, '실(방)을 정의하고 용도를 고르면 목표 조도가 정해지고, 조명기구 배치로 평균 조도를 계산합니다 (광속법).')),
      h('div', { class: 'row', style: { gap: '6px' } },
        h('button', { class: 'btn', onclick: roomsFromSlabs }, '슬래브에서 실 만들기'),
        h('button', { class: 'btn primary', disabled: !rows.length, onclick: () => autoLights(rows.filter(x => !x.ok)) }, '부족한 실 조명 자동 배치'))));

    if (!rows.length) {
      w.append(h('div', { class: 'card', style: { marginTop: '14px' } }, h('div', { class: 't' }, '실이 없습니다'), h('div', { class: 'd' }, '"슬래브에서 실 만들기"로 층 슬래브 외곽을 실로 가져오거나, 작도에서 실 영역을 그리세요.')));
      return;
    }
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
    w.append(h('div', { class: 'note', style: { marginTop: '8px' } }, `계산 조건: 조명률 U=${P.interior.lighting.uf}, 보수율 M=${P.interior.lighting.mf}, 기본 기구 ${KINDS.light.def.type} ${KINDS.light.def.watt}W / ${fmt0(KINDS.light.def.lm)}lm. 판정은 목표의 90% 이상이면 적합. 행을 누르면 실명·용도·천장고를 바꿀 수 있습니다.`));
  }
  render();
  const off = ctx.bus.on('model', render);
  return { unmount() { off(); } };
}
