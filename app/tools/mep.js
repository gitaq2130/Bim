// 빌더 MEP — 설비·전기·소방 계통 관리 (트랙: mep)
// v1: 계통별 집계와 천장 속 높이 배분 점검.
// v2: 스프링클러 헤드 자동 배치(NFTC 103), 분전반 배치·조명/전열 부하 집계·간선 산정(KEC).
import { h, table, toast } from '../js/ui.js';
import { allElements, DISC, KINDS, levelOf, elName } from '../js/model.js';
import { dist, fmt, fmt0, uid, polyArea, pointInPoly } from '../js/util.js';
import { FIRE_BLDG, fireExempt, headSpacing, headCoverage, placeHeads, fireDemand, OUTLET_VA, ELEC, circuitVA, panelLoad, panelSpots, snapToWall, feeder } from '../js/mep.js';
import { roomLighting } from './interior.js';

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

// ===================== v2 계산 (P 읽기) =====================
const centroid = (pts) => { const a = polyArea(pts); if (Math.abs(a) < 1) return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]; let cx = 0, cy = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length], c = p[0] * q[1] - q[0] * p[1]; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c; } return [cx / (6 * a), cy / (6 * a)]; };
const inputOf = (P) => ({ bldg: '일반', fireproof: true, ...(P.mep?.calc?.input || {}) });
const floorsOf = (P) => P.levels.filter(l => l.elev >= 0 && (l.height || 3000) >= 2000).length || 1;
// 층 대상 시트: 해당 공종 도면 → 없으면 기준 시트
const sheetFor = (P, levelId, disc, fallback) => P.sheets.find(s => s.level === levelId && s.disc === disc) || fallback;

// 실별 스프링클러 검토 (현재 헤드 커버리지 + 자동 배치안)
export function sprinklerPlan(P) {
  const inp = inputOf(P), B = FIRE_BLDG[inp.bldg] || FIRE_BLDG.일반, R = B.R(inp.fireproof);
  const all = allElements(P), rooms = all.filter(r => r.el.k === 'room' && r.el.pts?.length >= 3);
  const ceils = all.filter(r => r.el.k === 'ceiling'), heads = all.filter(r => r.el.k === 'sprinkler');
  const rows = rooms.map(r => {
    const c = centroid(r.el.pts), A = Math.abs(polyArea(r.el.pts)) * 1e-6;
    const cl = ceils.find(x => x.level.id === r.level.id && pointInPoly(c, x.el.pts));
    const zc = cl ? (cl.el.z ?? 2700) : (r.el.h || 2700);
    const ex = fireExempt(r.el.name, r.el.use);
    const inside = heads.filter(x => x.level.id === r.level.id && pointInPoly(x.el.p, r.el.pts));
    const cov = ex ? { ratio: 1, miss: [] } : headCoverage(r.el.pts, inside.map(x => x.el.p), R);
    const plan = ex ? { heads: [], S: headSpacing(R) } : placeHeads(r.el.pts, R);
    return { r, c, A, zc, ceilSrc: cl ? '천장' : '실 천장고', ex, R, S: headSpacing(R), inside, cov, plan, ok: ex ? true : inside.length > 0 && cov.ratio >= 0.999 };
  });
  const total = rows.reduce((s, x) => s + x.inside.length, 0), planned = rows.reduce((s, x) => s + x.plan.heads.length, 0);
  const maxCeil = Math.max(0, ...rows.map(x => x.zc));
  return { inp, B, R, S: headSpacing(R), rows, total, planned, demand: fireDemand(inp.bldg, floorsOf(P), maxCeil, Math.max(total, planned)) };
}

// 층별 전기 부하점·분전반 배정
export function elecPlan(P) {
  const U = P.interior?.lighting?.uf ?? 0.6, M = P.interior?.lighting?.mf ?? 0.8;
  const all = allElements(P), lr = roomLighting(P);
  const lights = all.filter(r => r.el.k === 'light'), panels = all.filter(r => r.el.k === 'panel');
  const inRoom = new Set(lr.flatMap(x => x.lights.map(l => l.el.id)));
  const loads = [];
  for (const x of lr) {
    const est = !x.n, lightW = est ? Math.round(x.target * x.A / (ELEC.lmPerW * U * M)) : x.watt;
    const ova = Math.round((OUTLET_VA[x.r.el.use] ?? 20) * x.A);
    loads.push({ level: x.r.level, p: centroid(x.r.el.pts), name: x.r.el.name || '실', use: x.r.el.use || '-', A: x.A, lightW, est, outletVA: ova, va: lightW / ELEC.pf + ova, room: x });
  }
  for (const l of lights) if (!inRoom.has(l.el.id)) loads.push({ level: l.level, p: l.el.p, name: '실 밖 조명', use: '-', A: 0, lightW: l.el.watt || 0, est: false, outletVA: 0, va: (l.el.watt || 0) / ELEC.pf });
  const levels = [];
  for (const L of P.levels) {
    const ld = loads.filter(x => x.level.id === L.id), pn = panels.filter(x => x.level.id === L.id);
    if (!ld.length && !pn.length) continue;
    const groups = pn.map(p => ({ p, loads: [] })), un = [];
    for (const x of ld) { if (!groups.length) { un.push(x); continue; } let g = groups[0], dmin = Infinity; for (const q of groups) { const d = dist(q.p.el.p, x.p); if (d < dmin) { dmin = d; g = q; } } x.d = dmin; x.panel = g.p.el.id; g.loads.push(x); }
    for (const g of groups) { const lw = g.loads.reduce((s, x) => s + x.lightW, 0), ov = g.loads.reduce((s, x) => s + x.outletVA, 0); Object.assign(g, { lightW: lw, outletVA: ov, far: Math.max(0, ...g.loads.map(x => x.d || 0)), ...panelLoad(lw, ov) }); }
    levels.push({ level: L, loads: ld, groups, un, spots: panelSpots(ld) });
  }
  const kVA = levels.reduce((s, l) => s + l.groups.reduce((t, g) => t + g.kVA, 0), 0);
  return { levels, kVA, main: feeder(kVA), U, M };
}

const VIEWS = [['sys', '계통 집계'], ['fire', '스프링클러'], ['elec', '전기 부하']];
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, a = {}) => { const e = document.createElementNS(SVGNS, tag); for (const k in a) e.setAttribute(k, a[k]); return e; };

// 층 평면 미리보기 (y 위쪽 +). mode: fire | elec
function planSvg(rooms, draw) {
  const pts = rooms.flatMap(r => r.el.pts); if (!pts.length) return null;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), pad = 1200;
  const W = x1 - x0 + pad * 2, H = y1 - y0 + pad * 2, T = (p) => [p[0] - x0 + pad, y1 - p[1] + pad];
  const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, style: `width:100%;max-height:440px;background:#0b0e13;border:1px solid var(--line);border-radius:8px` });
  const k = W / 900; // 화면 1px ≈ k mm
  for (const r of rooms) { s.append(sv('polygon', { points: r.el.pts.map(p => T(p).join(',')).join(' '), fill: 'rgba(212,165,255,.05)', stroke: '#6f7a8d', 'stroke-width': 1.2 * k })); }
  draw({ s, T, k });
  for (const r of rooms) { const c = centroid(r.el.pts), q = T(c); const t = sv('text', { x: q[0], y: q[1], 'font-size': 11 * k, fill: '#a9b1c1', 'text-anchor': 'middle' }); t.textContent = r.el.name || ''; s.append(t); }
  return s;
}

export function mount(root, ctx) {
  const P = ctx.P; P.mep ||= { systems: [], calc: {} }; P.mep.calc ||= {};
  const st = { tab: 'all', view: 'sys', lv: null };
  const page = h('div', { class: 'page' }), w = h('div', { class: 'wrap' }); page.append(w); root.append(page);
  const changed = () => { ctx.touch('meta'); ctx.bus.emit('model'); };
  const card = (k, v, d) => h('div', { class: 'card' }, h('div', { class: 'd' }, k), h('div', { class: 't' }, String(v)), d ? h('div', { class: 'note' }, d) : null);
  const pill = (ok, t) => h('span', { class: 'pill ' + (ok ? 'ok' : 'bad') }, t);
  const toCad = (r) => ctx.go('cad', { sheet: r.sheet.id, hi: { ids: [r.el.id], sheet: r.sheet.id } });

  // ---------- 소방 ----------
  function applyHeads(plan) {
    let n = 0;
    for (const s of P.sheets) { const c = P.content[s.id]; if (!c) continue; for (let i = c.els.length - 1; i >= 0; i--) { const e = c.els[i]; if (e.k === 'sprinkler' && e.auto) c.els.splice(i, 1); } }
    for (const x of plan.rows) {
      if (x.ex) continue;
      const sh = sheetFor(P, x.r.level.id, 'F', x.r.sheet); P.content[sh.id] ||= { ents: [], els: [] };
      for (const p of x.plan.heads) { P.content[sh.id].els.push({ id: uid('e'), k: 'sprinkler', ...KINDS.sprinkler.def, p, z: x.zc, auto: x.r.el.id }); n++; }
    }
    const after = sprinklerPlan(P);
    P.mep.calc.fire = { at: new Date().toISOString(), input: after.inp, R: after.R, S: after.S, heads: after.total, ...after.demand };
    changed(); toast(`스프링클러 헤드 ${n}개를 배치했습니다 (수평거리 ${fmt(after.R / 1000, 1)}m, 간격 ${fmt(after.S / 1000, 2)}m 이하)`, 'ok');
  }
  function fireView() {
    const F = sprinklerPlan(P), inp = F.inp;
    const setInp = (k, v) => { P.mep.calc.input = { ...inp, [k]: v }; ctx.touch('meta'); render(); };
    w.append(h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap', alignItems: 'center', margin: '4px 0 12px' } },
      h('label', {}, '건물 용도 ', h('select', { onchange: (e) => setInp('bldg', e.target.value) }, ...Object.entries(FIRE_BLDG).map(([k, b]) => h('option', { value: k, selected: k === inp.bldg }, b.name)))),
      h('label', {}, h('input', { type: 'checkbox', checked: inp.fireproof, onchange: (e) => setInp('fireproof', e.target.checked) }), ' 주요구조부 내화구조'),
      h('button', { class: 'btn primary', disabled: !F.rows.length, onclick: () => applyHeads(F) }, '헤드 자동 배치 (자동 배치분 교체)')));
    if (!F.rows.length) { w.append(h('div', { class: 'card' }, h('div', { class: 't' }, '실이 없습니다'), h('div', { class: 'd' }, '인테리어·조명 툴에서 "슬래브에서 실 만들기"로 실을 먼저 정의하면 실·천장 기준으로 헤드를 배치합니다.'), h('button', { class: 'btn', style: { marginTop: '8px' }, onclick: () => ctx.go('interior') }, '인테리어·조명으로 이동'))); return; }
    const D = F.demand, bad = F.rows.filter(x => !x.ok).length;
    w.append(h('div', { class: 'cards', style: { marginBottom: '12px' } },
      card('헤드 수평거리 R / 간격 S', `${fmt(F.R / 1000, 1)}m / ${fmt(F.S / 1000, 2)}m`, `NFTC 103 2.7.3 · 정방형 S=R√2`),
      card('설치 헤드 (자동안)', `${fmt0(F.total)}개 (${fmt0(F.planned)}개)`, bad ? `미경계 실 ${bad}개` : '전 실 경계 완료'),
      card('기준개수 N', `${D.N}개`, `표 2.1.1.1 기준 ${D.base}개 (지상 ${floorsOf(P)}층)`),
      card('수원 / 펌프 토출량', `${fmt(D.Q, 1)}m³ / ${fmt0(D.flow)} L/min`, `N×80L/min×${D.min}분 (2.1.1)`)));
    // 평면
    const lvls = [...new Set(F.rows.map(x => x.r.level.id))]; st.lv = lvls.includes(st.lv) ? st.lv : lvls[0];
    w.append(h('div', { class: 'row', style: { gap: '6px', margin: '6px 0' } }, h('h2', { style: { margin: 0 } }, '헤드 배치 평면'), ...lvls.map(id => h('button', { class: 'btn sm' + (st.lv === id ? ' primary' : ''), onclick: () => { st.lv = id; render(); } }, levelOf(P, id).name))));
    const rs = F.rows.filter(x => x.r.level.id === st.lv);
    const svg = planSvg(rs.map(x => x.r), ({ s, T, k }) => {
      for (const x of rs) {
        if (x.ex) { s.append(sv('polygon', { points: x.r.el.pts.map(p => T(p).join(',')).join(' '), fill: 'rgba(111,122,141,.18)', stroke: 'none' })); continue; }
        for (const m of x.cov.miss) { const q = T(m); s.append(sv('rect', { x: q[0] - 60, y: q[1] - 60, width: 120, height: 120, fill: 'rgba(229,72,77,.35)' })); }
        for (const hd of x.inside) { const q = T(hd.el.p); s.append(sv('circle', { cx: q[0], cy: q[1], r: x.R, fill: 'rgba(255,122,69,.06)', stroke: 'rgba(255,122,69,.45)', 'stroke-width': k, 'stroke-dasharray': `${4 * k} ${3 * k}` })); }
        for (const hd of x.inside) { const q = T(hd.el.p); s.append(sv('circle', { cx: q[0], cy: q[1], r: 3.5 * k, fill: '#ff7a45' })); }
      }
    });
    if (svg) w.append(svg, h('div', { class: 'note', style: { margin: '4px 0 12px' } }, '주황 점: 헤드, 점선 원: 수평거리 R 경계 범위, 빨간 칸: 미경계 지점, 회색 실: 설치 제외 장소.'));
    w.append(h('h2', {}, '실별 검토'), table([
      { label: '층', render: x => x.r.level.name },
      { label: '실', render: x => x.r.el.name || '-' },
      { label: '용도', render: x => x.r.el.use || '-' },
      { label: '면적 m²', num: true, render: x => fmt(x.A, 1) },
      { label: '헤드 높이', num: true, render: x => `${fmt0(x.zc)} (${x.ceilSrc})` },
      { label: '배치안', num: true, render: x => x.ex ? '-' : `${x.plan.heads.length}개 (${x.plan.nx}×${x.plan.ny}, ${fmt0(x.plan.sx)}×${fmt0(x.plan.sy)})` },
      { label: '설치', num: true, render: x => fmt0(x.inside.length) },
      { label: '경계율', num: true, render: x => x.ex ? '-' : `${fmt0(x.cov.ratio * 100)}%` },
      { label: '판정', render: x => x.ex ? h('span', { class: 'pill' }, `설치 제외(${x.ex})`) : pill(x.ok, x.ok ? '적합' : '미경계') },
    ], F.rows, { onRow: x => toCad(x.r) }));
    w.append(h('div', { class: 'note', style: { marginTop: '8px', lineHeight: 1.6 } },
      `근거 — NFTC 103(스프링클러설비): 헤드 수평거리 ${F.B.name} ${fmt(F.R / 1000, 1)}m(2.7.3), 정방형 배치 간격 S = 2R·cos45° = ${fmt0(F.S)}mm, 벽까지 S/2 이하. ` +
      `경계율은 실 내부 250mm 격자 시험점 중 가장 가까운 헤드까지 거리가 R 이하인 비율. 헤드 높이는 실 안의 천장 객체 높이(없으면 실 천장고), 폐쇄형 하향식 K80. ` +
      `계단·화장실·욕실·전기실·통신실·덕트피트·외기 개방 테라스 등은 설치 제외(2.12)로 처리. 기준개수·수원량은 2.1.1 기준 계획값이며 실시 설계 시 수리계산으로 확정하세요.`));
  }

  // ---------- 전기 ----------
  function applyPanels(E) {
    let n = 0;
    for (const s of P.sheets) { const c = P.content[s.id]; if (!c) continue; for (let i = c.els.length - 1; i >= 0; i--) { const e = c.els[i]; if (e.k === 'panel' && e.auto === 'elec') c.els.splice(i, 1); } }
    const all = allElements(P);
    for (const L of E.levels) {
      const user = all.filter(r => r.el.k === 'panel' && r.level.id === L.level.id); if (user.length) continue; // 사용자 배치 분전반이 있는 층은 유지
      const walls = all.filter(r => r.el.k === 'wall' && r.level.id === L.level.id && (r.el.h == null || r.el.h > 2000)).map(r => r.el);
      const base = L.loads[0]?.room?.r.sheet || P.sheets.find(s => s.level === L.level.id); if (!base) continue;
      const sh = sheetFor(P, L.level.id, 'E', base); P.content[sh.id] ||= { ents: [], els: [] };
      L.spots.forEach((p, i) => { const sn = snapToWall(p, walls, KINDS.panel.def.d); P.content[sh.id].els.push({ id: uid('e'), k: 'panel', ...KINDS.panel.def, sys: '전등전열', name: `${L.level.name}-LP${i + 1}`, p: sn.p, rot: sn.rot, auto: 'elec' }); n++; });
    }
    storeElec(); changed(); toast(n ? `분전반 ${n}면을 배치하고 부하를 집계했습니다` : '부하를 다시 집계했습니다 (사용자 배치 분전반 유지)', 'ok');
  }
  function storeElec() { // 분전반 kw 기록 + 계산 결과 저장
    const E = elecPlan(P), out = [];
    for (const L of E.levels) for (const g of L.groups) { g.p.el.kw = Math.round(g.kW * 10) / 10; out.push({ id: g.p.el.id, level: L.level.id, lightW: g.lightW, outletVA: g.outletVA, kVA: +g.kVA.toFixed(2), circuits: g.circuits, brk: g.brk, cable: g.cable }); }
    P.mep.calc.elec = { at: new Date().toISOString(), panels: out, kVA: +E.kVA.toFixed(2), main: { brk: E.main.brk, cable: E.main.cable } };
  }
  function elecView() {
    const E = elecPlan(P);
    const noPanel = E.levels.filter(L => !L.groups.length).length;
    w.append(h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap', alignItems: 'center', margin: '4px 0 12px' } },
      h('button', { class: 'btn primary', disabled: !E.levels.length, onclick: () => applyPanels(E) }, noPanel ? `분전반 자동 배치·부하 집계 (${noPanel}개 층)` : '부하 다시 집계'),
      h('span', { class: 'note' }, '사용자가 직접 놓은 분전반이 있는 층은 그대로 두고 부하만 배정합니다.')));
    if (!E.levels.length) { w.append(h('div', { class: 'card' }, h('div', { class: 't' }, '부하가 없습니다'), h('div', { class: 'd' }, '실(용도)과 조명기구를 인테리어·조명 툴에서 정의하면 층별 부하를 집계합니다.'), h('button', { class: 'btn', style: { marginTop: '8px' }, onclick: () => ctx.go('interior') }, '인테리어·조명으로 이동'))); return; }
    const lw = E.levels.reduce((s, L) => s + L.loads.reduce((t, x) => t + x.lightW, 0), 0), ov = E.levels.reduce((s, L) => s + L.loads.reduce((t, x) => t + x.outletVA, 0), 0);
    const est = E.levels.reduce((s, L) => s + L.loads.filter(x => x.est).length, 0);
    const total = E.kVA || panelLoad(lw, ov).kVA, main = feeder(total);
    w.append(h('div', { class: 'cards', style: { marginBottom: '12px' } },
      card('전등 부하', `${fmt(lw / 1000, 2)} kW`, est ? `조명 미배치 실 ${est}개는 목표 조도로 추정` : '배치된 조명기구 합계'),
      card('전열(콘센트) 부하', `${fmt(ov / 1000, 2)} kVA`, '실 용도별 부하밀도 × 면적'),
      card('최대 수요전력', `${fmt(total, 2)} kVA`, `수용률 전등 ${ELEC.dfLight * 100}%·전열 ${ELEC.dfOutlet * 100}%`),
      card('전등전열 주간선(참고)', `${main.brk}AT · ${main.cable}`, `${main.phase}, I=${fmt(main.I, 1)}A`)));
    // 평면
    const lvls = E.levels.map(L => L.level.id); st.lv = lvls.includes(st.lv) ? st.lv : lvls[0]; const L = E.levels.find(x => x.level.id === st.lv);
    w.append(h('div', { class: 'row', style: { gap: '6px', margin: '6px 0' } }, h('h2', { style: { margin: 0 } }, '분전반·부하 평면'), ...E.levels.map(x => h('button', { class: 'btn sm' + (st.lv === x.level.id ? ' primary' : ''), onclick: () => { st.lv = x.level.id; render(); } }, x.level.name))));
    const rooms = L.loads.filter(x => x.room).map(x => x.room.r);
    const svg = planSvg(rooms, ({ s, T, k }) => {
      for (const x of L.loads) { const pn = L.groups.find(g => g.p.el.id === x.panel); if (!pn) continue; const a = T(x.p), b = T(pn.p.el.p); s.append(sv('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: 'rgba(247,118,142,.45)', 'stroke-width': k, 'stroke-dasharray': `${3 * k} ${3 * k}` })); }
      for (const x of L.loads) for (const l of x.room?.lights || []) { const q = T(l.el.p); s.append(sv('rect', { x: q[0] - 2.5 * k, y: q[1] - 2.5 * k, width: 5 * k, height: 5 * k, fill: '#e0c36b' })); }
      for (const sp of L.groups.length ? [] : L.spots) { const q = T(sp); s.append(sv('circle', { cx: q[0], cy: q[1], r: 6 * k, fill: 'none', stroke: '#f7768e', 'stroke-width': 1.5 * k, 'stroke-dasharray': `${3 * k} ${2 * k}` })); }
      for (const g of L.groups) { const q = T(g.p.el.p), e = g.p.el; const r = sv('rect', { x: q[0] - e.w / 2, y: q[1] - e.d / 2, width: e.w, height: e.d, fill: '#f7768e', transform: `rotate(${-(e.rot || 0)} ${q[0]} ${q[1]})` }); s.append(r, Object.assign(sv('text', { x: q[0], y: q[1] - e.d / 2 - 4 * k, 'font-size': 11 * k, fill: '#f7768e', 'text-anchor': 'middle' }), { textContent: e.name || '분전반' })); }
    });
    if (svg) w.append(svg, h('div', { class: 'note', style: { margin: '4px 0 12px' } }, L.groups.length ? '분홍 사각형: 분전반, 점선: 실 부하 → 담당 분전반, 노란 점: 조명기구.' : '분홍 점선 원: 분전반 제안 위치 (부하 가중 중심). 자동 배치 시 가장 가까운 벽면에 붙입니다.'));
    // 분전반 표
    const G = E.levels.flatMap(x => x.groups.map(g => ({ ...g, L: x.level })));
    if (G.length) w.append(h('h2', {}, '분전반별 부하 집계'), table([
      { label: '층', render: g => g.L.name },
      { label: '분전반', render: g => g.p.el.name || elName(g.p.el) },
      { label: '담당 실', num: true, render: g => fmt0(g.loads.length) },
      { label: '전등 W', num: true, render: g => fmt0(g.lightW) },
      { label: '전열 VA', num: true, render: g => fmt0(g.outletVA) },
      { label: '회로(전등+전열+예비)', num: true, render: g => `${g.nl}+${g.no}+${g.spare} = ${g.circuits}` },
      { label: '최대수요 kVA', num: true, render: g => fmt(g.kVA, 2) },
      { label: '주차단기 · 간선', render: g => `${g.brk}AT · ${g.cable}` },
      { label: '최원단 m', num: true, render: g => fmt(g.far / 1000, 1), cls: g => g.far > ELEC.panelR ? 'bad' : '' },
    ], G, { onRow: g => toCad(g.p) }));
    w.append(h('h2', {}, '실별 부하'), table([
      { label: '실', render: x => x.name },
      { label: '용도', render: x => x.use },
      { label: '면적 m²', num: true, render: x => x.A ? fmt(x.A, 1) : '-' },
      { label: '전등 W', num: true, render: x => `${fmt0(x.lightW)}${x.est ? ' (추정)' : ''}` },
      { label: '전열 VA', num: true, render: x => fmt0(x.outletVA) },
      { label: '전열 밀도', num: true, render: x => x.A ? `${OUTLET_VA[x.use] ?? 20} VA/m²` : '-' },
      { label: '분전반', render: x => L.groups.find(g => g.p.el.id === x.panel)?.p.el.name || (L.groups.length ? '-' : '미배치') },
    ], L.loads));
    w.append(h('div', { class: 'note', style: { marginTop: '8px', lineHeight: 1.6 } },
      `근거 — 분기회로 ${ELEC.branchA}A·${ELEC.V1}V, 연속부하 ${ELEC.cont * 100}% 적용 회로당 ${fmt0(circuitVA())}VA(KEC 212·내선규정), 예비회로 ${ELEC.spare * 100}%. ` +
      `전등 부하는 배치된 조명기구 W 합(미배치 실은 목표 조도 ÷ (${ELEC.lmPerW}lm/W × U${E.U} × M${E.M})로 추정), 전열은 내선규정 표준부하를 실 용도별로 나눈 가정치(VA/m²). ` +
      `최대수요 = 전등/역률${ELEC.pf} × ${ELEC.dfLight} + 전열 × ${ELEC.dfOutlet}. 7kVA 초과는 3상4선 380/220V, 주차단기 ≥ 1.25I, 간선은 F-CV 트레이 포설 허용전류 대략치 — 실시 설계 시 KEC 232.5 허용전류·전압강하로 확정하세요. 분전반 공급 반경 ${ELEC.panelR / 1000}m 초과 층은 분할 배치합니다.`));
  }

  // ---------- 계통 집계 (v1) ----------
  function sysView() {
    const all = mepRows(P); const rows = st.tab === 'all' ? all : all.filter(r => r.disc === st.tab);
    w.append(h('div', { class: 'row', style: { margin: '0 0 12px', gap: '6px', flexWrap: 'wrap' } },
      ...TABS.map(([id, nm]) => h('button', { class: 'btn sm' + (st.tab === id ? ' primary' : ''), onclick: () => { st.tab = id; render(); } }, `${nm} ${id === 'all' ? all.length : all.filter(r => r.disc === id).length}`))));

    if (!rows.length) {
      w.append(h('div', { class: 'card' }, h('div', { class: 't' }, 'MEP 객체가 없습니다'), h('div', { class: 'd' }, '작도에서 덕트·배관·케이블트레이·라이저를 그리거나, 스프링클러·전기 부하 탭에서 헤드와 분전반을 자동 배치하면 여기에서 계통별로 집계됩니다.')));
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

  function render() {
    const y = page.scrollTop; w.innerHTML = '';
    w.append(h('div', {}, h('h1', {}, '설비·전기·소방'), h('div', { class: 'sub' }, '계통별 집계·천장 속 높이 배분, 스프링클러 헤드 자동 배치(NFTC 103), 분전반 배치와 조명·전열 부하 집계(KEC)를 합니다. 사용자는 건물 용도와 구조만 고르면 됩니다.')));
    w.append(h('div', { class: 'row', style: { margin: '12px 0', gap: '6px', flexWrap: 'wrap' } },
      ...VIEWS.map(([id, nm]) => h('button', { class: 'btn' + (st.view === id ? ' primary' : ''), onclick: () => { st.view = id; render(); } }, nm))));
    if (st.view === 'fire') fireView(); else if (st.view === 'elec') elecView(); else sysView();
    page.scrollTop = y;
  }
  render();
  const off = ctx.bus.on('model', render);
  return { unmount() { off(); } };
}
