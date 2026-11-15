// 빌더 MEP — 설비·전기·소방 계통 관리 (트랙: mep)
// v1: 계통별 집계와 천장 속 높이 배분 점검. 사이즈·부하·헤드 배치 계산은 다음 Rev에서 추가.
import { h, table } from '../js/ui.js';
import { allElements, DISC, KINDS, levelOf } from '../js/model.js';
import { dist, fmt, fmt0 } from '../js/util.js';

const MEP_KINDS = ['duct', 'pipe', 'tray', 'riser', 'sprinkler', 'panel'];
const LINEAR = ['duct', 'pipe', 'tray'];
const TABS = [['all', '전체'], ['M', '기계'], ['P', '배관(위생)'], ['E', '전기'], ['F', '소방']];

// 공종: 소방 계통명이면 소방, 도면 공종이 MEP면 도면 기준, 아니면 객체 종류 기준
const FIRE = /소화|소방|스프링클러|SP-|FP-|^SP|^FP/i;
const discOf = (r) => FIRE.test(r.el.sys || '') ? 'F' : (['M', 'E', 'P', 'F'].includes(r.sheet.disc) ? r.sheet.disc : KINDS[r.el.k]?.disc) || 'M';

export function mepRows(P) {
  return allElements(P, r => MEP_KINDS.includes(r.el.k)).map(r => ({ ...r, disc: discOf(r) }));
}

// 계통별 집계
export function systemSummary(rows) {
  const m = new Map();
  for (const r of rows) {
    const key = `${r.disc}|${r.el.k}|${r.el.sys || '(계통 미지정)'}`;
    const g = m.get(key) || { disc: r.disc, k: r.el.k, sys: r.el.sys || '(계통 미지정)', n: 0, len: 0, z0: Infinity, z1: -Infinity };
    g.n++;
    if (LINEAR.includes(r.el.k)) {
      g.len += dist(r.el.a, r.el.b) / 1000;
      const z = r.el.z ?? 3000, hh = r.el.hh || 0; g.z0 = Math.min(g.z0, z - hh / 2); g.z1 = Math.max(g.z1, z + hh / 2);
    }
    m.set(key, g);
  }
  return [...m.values()].sort((a, b) => a.disc.localeCompare(b.disc) || a.k.localeCompare(b.k) || a.sys.localeCompare(b.sys));
}

// 층별 공종 높이 띠(바닥 기준 mm)와 겹침
export function heightBands(P, rows) {
  const out = [];
  for (const L of P.levels) {
    const bands = {};
    for (const r of rows) {
      if (r.level.id !== L.id || !LINEAR.includes(r.el.k)) continue;
      const z = r.el.z ?? 3000, hh = r.el.hh || 0, b = bands[r.disc] ||= { z0: Infinity, z1: -Infinity, n: 0 };
      b.z0 = Math.min(b.z0, z - hh / 2); b.z1 = Math.max(b.z1, z + hh / 2); b.n++;
    }
    const ds = Object.keys(bands); if (!ds.length) continue;
    const overlaps = [];
    for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) {
      const a = bands[ds[i]], b = bands[ds[j]]; const ov = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
      if (ov > 0) overlaps.push(`${DISC[ds[i]]?.name}·${DISC[ds[j]]?.name} ${fmt0(ov)}mm`);
    }
    out.push({ level: L, bands, overlaps });
  }
  return out;
}

export function mount(root, ctx) {
  const P = ctx.P; P.mep ||= { systems: [], calc: {} };
  const st = { tab: 'all' };
  const page = h('div', { class: 'page' }), w = h('div', { class: 'wrap' }); page.append(w); root.append(page);

  function render() {
    w.innerHTML = '';
    const all = mepRows(P); const rows = st.tab === 'all' ? all : all.filter(r => r.disc === st.tab);
    w.append(h('div', {}, h('h1', {}, '설비·전기·소방'), h('div', { class: 'sub' }, '덕트·배관·트레이·라이저·스프링클러·분전반을 계통별로 묶고, 층별로 천장 속 높이 배분을 점검합니다.')));
    w.append(h('div', { class: 'row', style: { margin: '12px 0', gap: '6px', flexWrap: 'wrap' } },
      ...TABS.map(([id, nm]) => h('button', { class: 'btn' + (st.tab === id ? ' primary' : ''), onclick: () => { st.tab = id; render(); } }, `${nm} ${id === 'all' ? all.length : all.filter(r => r.disc === id).length}`))));

    if (!rows.length) {
      w.append(h('div', { class: 'card' }, h('div', { class: 't' }, 'MEP 객체가 없습니다'), h('div', { class: 'd' }, '작도에서 덕트·배관·케이블트레이·라이저를 그리면 여기에서 계통별로 집계됩니다. 스프링클러 헤드·분전반 배치 기능은 다음 Rev에서 추가됩니다.')));
      return;
    }

    const sum = systemSummary(rows);
    w.append(h('h2', {}, '계통별 집계'), table([
      { label: '공종', render: g => `${g.disc} ${DISC[g.disc]?.name || ''}` },
      { label: '종류', render: g => KINDS[g.k]?.name || g.k },
      { label: '계통', key: 'sys' },
      { label: '수량', num: true, render: g => fmt0(g.n) },
      { label: '길이(m)', num: true, render: g => g.len ? fmt(g.len, 1) : '-' },
      { label: '설치 높이(mm)', num: true, render: g => isFinite(g.z0) ? `${fmt0(g.z0)} ~ ${fmt0(g.z1)}` : '-' },
    ], sum));

    const bands = heightBands(P, rows);
    if (bands.length) {
      w.append(h('h2', {}, '층별 높이 배분'), h('div', { class: 'note' }, '층 바닥 기준. 공종별 최저~최고 높이 범위이며, 범위가 겹치는 층은 간섭검토로 실제 충돌을 확인하세요 (행을 누르면 간섭검토로 이동).'), table([
        { label: '층', render: b => b.level.name },
        ...['M', 'P', 'E', 'F'].map(d => ({ label: DISC[d].name, num: true, render: b => b.bands[d] ? `${fmt0(b.bands[d].z0)}~${fmt0(b.bands[d].z1)}` : '-' })),
        { label: '높이 띠 겹침(참고)', render: b => b.overlaps.length ? b.overlaps.join(', ') : '없음' },
      ], bands, { onRow: (b) => ctx.go('clash') }));
    }
  }
  render();
  const off = ctx.bus.on('model', render);
  return { unmount() { off(); } };
}
