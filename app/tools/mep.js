// 빌더 MEP — 설비·전기·소방 계통 관리 (트랙: mep)
// v1: 계통별 집계와 천장 속 높이 배분 점검.
// v2: 스프링클러 헤드 자동 배치(NFTC 103), 분전반 배치·조명/전열 부하 집계·간선 산정(KEC).
// v3: 가동 시뮬레이션 — 시나리오(정상·화재·정전·장비 정지)별 흐름·용량·환기·소방·전력 판정과 동작 순서.
// v4: 접점 망 해석(루프·T 분기 유량 분배), 덕트(등마찰법)·배관(유속·마찰) 사이즈 산정과 일괄 적용·취소.
import { h, table, toast } from '../js/ui.js';
import { allElements, DISC, KINDS, levelOf, elName } from '../js/model.js';
import { dist, fmt, fmt0, uid, polyArea, pointInPoly } from '../js/util.js';
import { FIRE_BLDG, fireExempt, headSpacing, headCoverage, placeHeads, fireDemand, OUTLET_VA, ELEC, circuitVA, panelLoad, panelSpots, snapToWall, feeder, mepSim, SCENARIOS, SIM, SIM_GROUPS, sysColor, sizePlan, SIZE } from '../js/mep.js';
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

const VIEWS = [['sim', '가동 시뮬레이션'], ['size', '사이즈 산정'], ['sys', '계통 집계'], ['fire', '스프링클러'], ['elec', '전기 부하']];
const LVC = { ok: '#3fb27f', warn: '#e0af68', fail: '#e5484d', off: '#4b5260', idle: '#4ea1ff', info: '#6f7a8d' };
const LVT = { ok: '정상', warn: '주의', fail: '불가', off: '정지', idle: '대기', info: '참고' };
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
  const st = { tab: 'all', view: 'sim', lv: null, sim: { type: 'normal', ...(P.mep.calc.sim?.sc || {}) }, simLv: null, groups: new Set(SIM_GROUPS.map(g => g[0])) };
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

  // ---------- 가동 시뮬레이션 (v3) ----------
  function simView() {
    const sc = st.sim; let S;
    try { S = mepSim(P, sc); } catch (e) { console.error(e); w.append(h('div', { class: 'card' }, h('div', { class: 't' }, '시뮬레이션을 실행하지 못했습니다'), h('div', { class: 'd' }, String(e.message || e)))); return; }
    const setSc = (o) => { st.sim = { ...st.sim, ...o }; st.simLv = null; const R = mepSim(P, st.sim); P.mep.calc.sim = { at: new Date().toISOString(), sc: { type: st.sim.type, level: st.sim.level, equip: st.sim.equip }, verdict: R.verdict, fail: R.checks.filter(c => c.lv === 'fail' && !c.hide).length, warn: R.checks.filter(c => c.lv === 'warn' && !c.hide).length }; ctx.touch('meta'); render(); };
    const zl = [...S.zones.values()].map(z => z.level);
    const eqOpts = S.equips.filter(e => !['vav', 'grille', 'pit', 'tank'].includes(e.type));
    w.append(h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap', alignItems: 'center', margin: '4px 0 12px' } },
      h('label', {}, '시나리오 ', h('select', { onchange: (e) => setSc({ type: e.target.value }) }, ...Object.entries(SCENARIOS).map(([k, v]) => h('option', { value: k, selected: k === sc.type }, v)))),
      sc.type === 'fire' ? h('label', {}, '화재 층 ', h('select', { onchange: (e) => setSc({ level: e.target.value }) }, ...zl.map(l => h('option', { value: l.id, selected: l.id === (S.fireLv?.id) }, l.name)))) : null,
      sc.type === 'fault' ? h('label', {}, '정지 장비 ', h('select', { onchange: (e) => setSc({ equip: e.target.value }) }, h('option', { value: '' }, '— 장비 선택 —'), ...eqOpts.map(e => h('option', { value: e.el.id, selected: e.el.id === sc.equip }, `${e.name} (${e.level.name})`)))) : null,
      h('span', { class: 'note' }, '입력은 시나리오뿐 — 부하·풍량·유량·용량은 툴이 산정합니다.')));
    // 종합 판정
    const vis = S.checks.filter(c => !c.hide), nF = vis.filter(c => c.lv === 'fail').length, nW = vis.filter(c => c.lv === 'warn').length;
    const vt = { ok: ['가동 가능', '모든 항목이 기준 이내입니다.'], warn: ['가동 가능 (주의)', `운전은 되지만 기준을 넘는 항목 ${nW}개가 있습니다.`], fail: ['가동 불가 항목 있음', `설비가 제 기능을 못 하는 항목 ${nF}개, 주의 ${nW}개.`] }[S.verdict];
    w.append(h('div', { class: 'card', style: { borderLeft: `4px solid ${LVC[S.verdict]}`, marginBottom: '12px' } },
      h('div', { class: 'd' }, SCENARIOS[sc.type] + (S.fireLv ? ` — ${S.fireLv.name}` : '') + (sc.type === 'fault' && sc.equip ? ` — ${S.equips.find(e => e.el.id === sc.equip)?.name || ''}` : '')),
      h('div', { class: 't', style: { color: LVC[S.verdict] } }, vt[0]), h('div', { class: 'note' }, vt[1] + (sc.type !== 'normal' ? ' "새로" 표시는 정상 운전에는 없던 문제입니다.' : ''))));
    const CATS = ['환기·공조', '전력', '소방', '급배수'];
    w.append(h('div', { class: 'cards', style: { marginBottom: '12px' } }, ...CATS.map(c => { const xs = vis.filter(x => x.cat === c); if (!xs.length) return h('div', { class: 'card' }, h('div', { class: 'd' }, c), h('div', { class: 't', style: { color: LVC.info } }, '해당 없음')); const lv = xs.reduce((a, x) => (x.lv === 'fail' || (x.lv === 'warn' && a !== 'fail')) ? x.lv : a, 'ok'); const n = xs.filter(x => x.lv === 'fail' || x.lv === 'warn').length; return h('div', { class: 'card click', onclick: () => document.getElementById('mep-cat-' + c)?.scrollIntoView({ behavior: 'smooth' }) }, h('div', { class: 'd' }, c), h('div', { class: 't', style: { color: LVC[lv] } }, LVT[lv]), h('div', { class: 'note' }, n ? `확인 필요 ${n}건` : `${xs.length}개 항목 이상 없음`)); })));
    // 동작 순서
    const mmss = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    w.append(h('h2', {}, '동작 순서'), h('div', { class: 'card', style: { padding: '8px 12px' } }, ...S.events.map(e => h('div', { class: 'row', style: { gap: '10px', padding: '4px 0', alignItems: 'baseline' } },
      h('span', { style: { fontFamily: 'var(--mono)', color: 'var(--fg3)', minWidth: '44px' } }, mmss(e.t)), h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: LVC[e.lv] || LVC.info, flex: 'none', transform: 'translateY(-1px)' } }), h('span', {}, e.text)))));
    // 층 × 계통
    const fl = [...S.floors].reverse(); const segN = (lid) => { let n = 0; for (const x of S.seg.values()) if (x.it.level.id === lid) n++; return n; };
    st.simLv = fl.some(f => f.level.id === st.simLv) ? st.simLv : (S.fireLv?.id || S.equips.find(e => e.el.id === sc.equip)?.level.id || [...fl].filter(f => f.zone).sort((a, b) => segN(b.level.id) - segN(a.level.id))[0]?.level.id || fl[0]?.level.id);
    if (fl.length) {
      const gs = SIM_GROUPS.filter(g => fl.some(f => f.cell[g[0]]));
      const tb = h('table', { class: 'grid', style: { fontSize: '12px' } }, h('thead', {}, h('tr', {}, h('th', {}, '층'), ...gs.map(g => h('th', { style: { textAlign: 'center' } }, g[1])), h('th', { class: 'num' }, '면적 m²'), h('th', { class: 'num' }, '재실 인'))),
        h('tbody', {}, ...fl.map(f => h('tr', { class: 'click' + (f.level.id === st.simLv ? ' sel' : ''), onclick: () => { st.simLv = f.level.id; render(); setTimeout(() => document.getElementById('mep-simplan')?.scrollIntoView({ behavior: 'smooth' }), 30); } },
          h('td', {}, f.level.name + (f.fire ? ' 🔥' : '')), ...gs.map(g => { const v = f.cell[g[0]]; return h('td', { style: { textAlign: 'center', padding: '3px' } }, v ? h('span', { title: LVT[v], style: { display: 'inline-block', width: '100%', maxWidth: '64px', height: '12px', borderRadius: '3px', background: LVC[v] } }) : ''); }),
          h('td', { class: 'num' }, f.zone ? fmt0(f.zone.A) : '-'), h('td', { class: 'num' }, f.zone ? fmt0(f.zone.occ) : '-')))));
      w.append(h('h2', {}, '층별 계통 상태'), h('div', { class: 'note', style: { marginBottom: '6px' } }, ...['ok', 'warn', 'fail', 'idle', 'off'].map(k => h('span', { style: { marginRight: '12px' } }, h('span', { style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: LVC[k], marginRight: '4px' } }), LVT[k])), ' — 행을 누르면 그 층 평면에서 흐름을 봅니다.'),
        h('div', { style: { maxHeight: '360px', overflow: 'auto', border: '1px solid var(--line)', borderRadius: '8px' } }, tb));
    }
    // 층 평면 (흐름 애니메이션)
    const L = P.levels.find(l => l.id === st.simLv);
    if (L) {
      const segs = [...S.seg.values()].filter(x => x.it.level.id === L.id && st.groups.has(SIM_GROUPS.find(g => g[2].includes(x.sys))?.[0]));
      const eqs = S.equips.filter(e => e.level.id === L.id);
      const slabs = allElements(P, r => r.level.id === L.id && (r.el.k === 'slab' || r.el.k === 'room'));
      const pts = [...segs.flatMap(x => x.it.el.a ? [x.it.el.a, x.it.el.b] : [x.it.el.p]), ...slabs.flatMap(r => r.el.pts), ...eqs.map(e => e.el.p)].filter(Boolean);
      w.append(h('h2', { id: 'mep-simplan' }, `${L.name} 흐름 평면`), h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap', marginBottom: '6px' } }, ...SIM_GROUPS.map(g => h('button', { class: 'btn sm' + (st.groups.has(g[0]) ? ' primary' : ''), onclick: () => { st.groups.has(g[0]) ? st.groups.delete(g[0]) : st.groups.add(g[0]); render(); } }, g[1]))));
      if (pts.length) {
        const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), pad = 1500;
        const W = x1 - x0 + pad * 2, H = y1 - y0 + pad * 2, T = (p) => [p[0] - x0 + pad, y1 - p[1] + pad], k = W / 900;
        const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, style: 'width:100%;max-height:560px;background:#0b0e13;border:1px solid var(--line);border-radius:8px' });
        const style = sv('style'); style.textContent = `.mf{animation:mepflow 0.9s linear infinite}@keyframes mepflow{to{stroke-dashoffset:${-16 * k}}}`; svg.append(style);
        for (const r of slabs) svg.append(sv('polygon', { points: r.el.pts.map(p => T(p).join(',')).join(' '), fill: r.el.k === 'room' ? 'rgba(212,165,255,.04)' : 'rgba(255,255,255,.025)', stroke: '#2a3342', 'stroke-width': k }));
        const order = { off: 0, idle: 1, run: 2 };
        for (const x of segs.sort((a, b) => order[a.state] - order[b.state])) {
          const el = x.it.el, col = x.state === 'off' ? (x.lv === 'fail' ? LVC.fail : LVC.off) : x.lv === 'fail' ? LVC.fail : x.lv === 'warn' ? LVC.warn : (x.sys === 'FP' ? '#ff9f43' : x.sys === 'BUS' ? '#c792ea' : sysColor(x.sys) || LVC.ok);
          const tip = sv('title'); tip.textContent = `${x.sys} ${x.it.kind === 'riser' ? '입상' : ''} ${el.w || ''}${el.hh && x.it.kind !== 'pipe' ? '×' + el.hh : ''} — ${x.state === 'off' ? '정지/미연결' : x.Q ? `${fmt0(x.Q)}m³/h, ${fmt(x.v, 1)}m/s (한도 ${x.lim[1]})` : '대기'}${x.sug ? ` → 권장 ${x.sug}` : ''}`;
          if (el.a) {
            const [a, b] = x.dir > 0 ? [T(el.a), T(el.b)] : [T(el.b), T(el.a)], wd = x.it.kind === 'duct' ? 3.2 * k : x.it.kind === 'tray' ? 1.6 * k : 2.2 * k;
            const ln = sv('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: col, 'stroke-width': wd, 'stroke-linecap': 'round', opacity: x.state === 'off' ? 0.55 : 1 });
            if (x.state === 'run' && x.Q > 0) { ln.setAttribute('stroke-dasharray', `${10 * k} ${6 * k}`); ln.setAttribute('class', 'mf'); }
            ln.append(tip); ln.style.cursor = 'pointer'; ln.addEventListener('click', () => toCad(x.it)); svg.append(ln);
          } else if (el.p) { const q = T(el.p); const c = sv('circle', { cx: q[0], cy: q[1], r: 5 * k, fill: col, stroke: '#0b0e13', 'stroke-width': k }); c.append(tip); svg.append(c); }
        }
        for (const e of eqs) {
          const q = T(e.el.p), col = e.state === '운전' ? (e.ratio > 1 ? LVC.fail : LVC.ok) : e.state === '대기' ? LVC.idle : ['고장', '미연결', '무전원'].includes(e.state) ? LVC.fail : LVC.off;
          const g = sv('g', { transform: `rotate(${-(e.el.rot || 0)} ${q[0]} ${q[1]})` }); const tip = sv('title'); tip.textContent = `${e.name} — ${e.state}${e.capTxt && e.capTxt !== '-' ? `, ${e.capTxt}` : ''}${e.ratio ? `, 부하율 ${fmt0(e.ratio * 100)}%` : ''}${e.note ? ` (${e.note})` : ''}`;
          g.append(sv('rect', { x: q[0] - (e.el.w || 600) / 2, y: q[1] - (e.el.d || 600) / 2, width: e.el.w || 600, height: e.el.d || 600, fill: col, 'fill-opacity': 0.25, stroke: col, 'stroke-width': 1.5 * k }), tip); svg.append(g);
          if (!['vav', 'grille'].includes(e.type)) { const t = sv('text', { x: q[0], y: q[1] + 4 * k, 'font-size': 10 * k, fill: col, 'text-anchor': 'middle' }); t.textContent = e.name.length > 14 ? e.name.slice(0, 14) + '…' : e.name; svg.append(t); }
        }
        w.append(svg, h('div', { class: 'note', style: { margin: '4px 0 12px' } }, '움직이는 점선: 흐르는 방향(급기·공급은 장비에서 말단으로, 환기·환수·배수는 장비 쪽으로). 계통색 = 정상, 노랑 = 유속 주의, 빨강 = 기준 초과·미연결, 회색 = 정지. 선 위에 올리면 풍량·유속·권장 규격, 누르면 작도로 이동.'));
      } else w.append(h('div', { class: 'note' }, '이 층에는 표시할 설비가 없습니다.'));
    }
    // 판정 상세
    w.append(h('h2', {}, '판정 상세'));
    for (const c of CATS) {
      const xs = vis.filter(x => x.cat === c).sort((a, b) => ({ fail: 0, warn: 1, info: 2, ok: 3 }[a.lv] - { fail: 0, warn: 1, info: 2, ok: 3 }[b.lv])); if (!xs.length) continue;
      w.append(h('h3', { id: 'mep-cat-' + c, style: { margin: '14px 0 6px' } }, c));
      const tb = h('div', { style: { border: '1px solid var(--line)', borderRadius: '8px', overflow: 'hidden' } });
      for (const x of xs) {
        const head = h('div', { class: 'row', style: { gap: '10px', padding: '8px 10px', alignItems: 'flex-start', borderBottom: '1px solid var(--line)' } },
          h('span', { class: 'pill', style: { color: LVC[x.lv], borderColor: LVC[x.lv], flex: 'none', minWidth: '34px', textAlign: 'center' } }, LVT[x.lv]),
          h('div', { style: { flex: 1, minWidth: 0 } }, h('div', {}, h('b', {}, x.item), x.isNew ? h('span', { class: 'pill bad', style: { marginLeft: '6px' } }, '새로') : null, ' — ', x.value, h('span', { class: 'note' }, `  (기준: ${x.limit})`)), h('div', { class: 'note', style: { marginTop: '2px', lineHeight: 1.5 } }, x.basis)));
        if (x.rows?.length || x.floorRows?.length) {
          const det = h('details', { style: { padding: '0 10px 8px 54px', borderBottom: '1px solid var(--line)' } }, h('summary', { class: 'note', style: { cursor: 'pointer' } }, x.rows ? `구간 ${x.rows.length}개 보기${x.rows.length >= 40 ? ' (상위 40)' : ''}` : `층 ${x.floorRows.length}개 보기`));
          if (x.rows) det.append(table([
            { label: '층', render: r => r.it.level.name }, { label: '구간', render: r => `${r.sys} ${r.it.kind === 'riser' ? '입상' : r.branch ? '분기' : '주관'}` },
            { label: '현 규격', render: r => r.it.kind === 'pipe' || r.it.el.form === 'pipe' ? `${r.it.el.w}A` : `${r.it.el.w}×${r.it.el.hh}` },
            { label: '유량 m³/h', num: true, render: r => r.Q ? fmt0(r.Q) : '-' }, { label: '유속 m/s', num: true, render: r => r.v ? fmt(r.v, 1) : '-', cls: r => r.lv === 'fail' ? 'bad' : '' },
            { label: '한도', num: true, render: r => r.v ? `${r.lim[1]}` : '-' }, { label: '권장 규격', render: r => r.sug || (r.state === 'off' ? '연결 확인' : '-') },
          ], x.rows, { onRow: r => toCad(r.it) }));
          else det.append(h('div', { class: 'note' }, x.floorRows.map(f => `${P.levels.find(l => l.id === f.level)?.name}: ${f.value}`).join(' · ')));
          tb.append(head, det);
        } else tb.append(head);
      }
      w.append(tb);
    }
    // 장비 운전 상태
    const plant = S.equips.filter(e => !['vav', 'grille', 'ahu', 'panel'].includes(e.type));
    const ahus = S.equips.filter(e => e.type === 'ahu'), pnls = S.equips.filter(e => e.type === 'panel');
    const grp = (arr, label) => arr.length ? [{ name: `${label} ${arr.length}대`, level: { name: [...new Set(arr.map(e => e.level.name))].length > 1 ? `${arr[0].level.name}~${arr.at(-1).level.name}` : arr[0].level.name }, state: `운전 ${arr.filter(e => e.state === '운전').length} / 정지 ${arr.filter(e => e.state !== '운전').length}`, capTxt: arr[0].capTxt, ratio: Math.max(...arr.map(e => e.ratio || 0)), kW: arr.reduce((s, e) => s + (e.kW || 0), 0), note: arr.filter(e => e.state !== '운전').map(e => e.name).slice(0, 4).join(', '), _g: true }] : [];
    const rows = [...plant, ...grp(ahus, '공조기'), ...grp(pnls, '분전반')];
    if (rows.length) w.append(h('h2', {}, '장비 운전 상태'), table([
      { label: '장비', render: e => e.name }, { label: '층', render: e => e.level.name },
      { label: '상태', render: e => e._g ? e.state : h('span', { class: 'pill', style: { color: LVC[e.state === '운전' ? 'ok' : e.state === '대기' ? 'idle' : ['고장', '미연결', '무전원'].includes(e.state) ? 'fail' : 'off'] } }, e.state) },
      { label: '용량', render: e => e.capTxt || '-' }, { label: '부하율', num: true, render: e => e.ratio ? `${fmt0(e.ratio * 100)}%` : '-', cls: e => e.ratio > 1 ? 'bad' : '' },
      { label: '동력 kW', num: true, render: e => e.kW ? fmt(e.kW, 1) : '-' }, { label: '비고', render: e => e.note || '' },
    ], rows, { onRow: e => e._g ? null : toCad(e) }));
    w.append(h('div', { class: 'note', style: { marginTop: '10px', lineHeight: 1.6 } },
      `산정 가정 — 실(room)이 있으면 실 용도, 없으면 층 슬래브 면적을 업무시설로 봅니다. 재실 밀도 사무실 ${SIM.occ.사무실}인/m², 필요 외기 ${SIM.oaPerson}m³/h·인(건축물의 설비기준 등에 관한 규칙 별표 1의6), 냉방부하 사무실 ${SIM.cool.사무실}W/m²·동시부하율 ${SIM.div}, 급기 온도차 ${SIM.dTair}K, 냉수·냉각수 ${SIM.dTw}K, 냉동기 COP ${SIM.cop}, ` +
      `급수 ${SIM.waterDay}L/인·일(순간최대, 입상관 동시사용률 적용), 소방 기준개수 × 80L/min·Hazen-Williams C=${SIM.C}. 루프(링) 배관·덕트는 한 방향 트리로 흘려 보수적으로(크게) 계산합니다. 장비 용량은 태그(예: 600RT, 1500kVA, 120톤)가 있으면 그 값, 없으면 부하로 자동 산정합니다. 장비는 작도에서 가구·장비(furn)에 계통(sys)·공급(src)·필요(need)를 지정하면 시뮬레이션에 들어갑니다.`));
  }

  // ---------- 사이즈 산정 (v4) ----------
  function sizeView() {
    let R; try { R = sizePlan(P); } catch (e) { console.error(e); w.append(h('div', { class: 'card' }, h('div', { class: 't' }, '사이즈 산정을 실행하지 못했습니다'), h('div', { class: 'd' }, String(e.message || e)))); return; }
    st.sz ||= { grp: 'all', lv: 'all', only: true };
    const applied = allElements(P, r => !!r.el.sizeAuto);
    const need = R.rows.filter(r => r.need);
    const apply = () => {
      for (const r of need) { const el = r.it.el; el.sizeAuto ||= { w: el.w, hh: el.hh, at: new Date().toISOString() }; if (r.duct) { el.w = r.rec.w; el.hh = r.rec.hh; } else { el.w = r.rec.d; el.hh = r.rec.d; } }
      P.mep.calc.size = { at: new Date().toISOString(), applied: need.length }; changed(); toast(`${need.length}개 구간 규격을 권장값으로 바꿨습니다 — 가동 시뮬레이션과 간섭검토로 확인하세요`, 'ok');
    };
    const undo = () => { for (const r of applied) { Object.assign(r.el, { w: r.el.sizeAuto.w, hh: r.el.sizeAuto.hh }); delete r.el.sizeAuto; } P.mep.calc.size = { at: new Date().toISOString(), applied: 0 }; changed(); toast(`${applied.length}개 구간을 원래 규격으로 되돌렸습니다`, 'ok'); };
    w.append(h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', alignItems: 'center', margin: '4px 0 12px' } },
      h('button', { class: 'btn primary', disabled: !need.length, onclick: apply }, need.length ? `확대 필요 ${fmt0(need.length)}개 구간 권장 규격 적용` : '확대할 구간 없음'),
      h('button', { class: 'btn', disabled: !applied.length, onclick: undo }, `자동 적용 취소 (${fmt0(applied.length)}개)`),
      h('span', { class: 'note' }, '정상 운전(냉방 피크) 유량 기준. 규격은 줄이지 않고 부족한 구간만 키웁니다.')));
    if (!R.rows.length) { w.append(h('div', { class: 'card' }, h('div', { class: 't' }, '산정할 구간이 없습니다'), h('div', { class: 'd' }, '장비(소스)에 연결되어 유량이 흐르는 덕트·배관이 없습니다. 가동 시뮬레이션 탭에서 연결 상태를 확인하세요.'))); return; }
    const gs = SIM_GROUPS.filter(g => R.rows.some(r => r.grp === g[0]));
    w.append(h('div', { class: 'cards', style: { marginBottom: '12px' } }, ...gs.map(g => { const xs = R.rows.filter(r => r.grp === g[0]), n = xs.filter(r => r.need).length;
      return h('div', { class: 'card click', style: { outline: st.sz.grp === g[0] ? '1px solid var(--acc)' : '' }, onclick: () => { st.sz.grp = st.sz.grp === g[0] ? 'all' : g[0]; render(); } }, h('div', { class: 'd' }, g[1]), h('div', { class: 't', style: { color: n ? LVC.warn : LVC.ok } }, n ? `확대 ${fmt0(n)}` : '적정'), h('div', { class: 'note' }, `${fmt0(xs.length)}개 구간 · 적용됨 ${fmt0(xs.filter(r => r.applied).length)}`)); })));
    const lvls = [...new Map(R.rows.map(r => [r.it.level.id, r.it.level])).values()].sort((a, b) => a.elev - b.elev);
    w.append(h('div', { class: 'row', style: { gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '6px' } },
      h('label', {}, '층 ', h('select', { onchange: (e) => { st.sz.lv = e.target.value; render(); } }, h('option', { value: 'all' }, '전체'), ...lvls.map(l => h('option', { value: l.id, selected: st.sz.lv === l.id }, l.name)))),
      h('label', {}, h('input', { type: 'checkbox', checked: st.sz.only, onchange: (e) => { st.sz.only = e.target.checked; render(); } }), ' 확대 필요만'),
      st.sz.grp !== 'all' ? h('button', { class: 'btn sm', onclick: () => { st.sz.grp = 'all'; render(); } }, `${SIM_GROUPS.find(g => g[0] === st.sz.grp)?.[1]} ✕`) : null));
    const ord = { riser: 0 };
    const rows = R.rows.filter(r => (st.sz.grp === 'all' || r.grp === st.sz.grp) && (st.sz.lv === 'all' || r.it.level.id === st.sz.lv) && (!st.sz.only || r.need || r.applied))
      .sort((a, b) => (b.need - a.need) || (b.x.v / b.x.lim[1] - a.x.v / a.x.lim[1]));
    const shown = rows.slice(0, 300);
    w.append(table([
      { label: '층', render: r => r.it.level.name }, { label: '계통', render: r => r.x.sys },
      { label: '구간', render: r => r.it.kind === 'riser' ? '입상' : r.x.branch ? '분기' : '주관' },
      { label: '풍량·유량 m³/h', num: true, render: r => fmt0(r.x.Q) },
      { label: '현 규격', render: r => r.applied ? `${r.cur} (원래 ${r.duct ? `${r.it.el.sizeAuto.w}×${r.it.el.sizeAuto.hh}` : `${r.it.el.sizeAuto.w}A`})` : r.cur },
      { label: '현 유속', num: true, render: r => fmt(r.x.v, 1), cls: r => r.x.lv === 'fail' ? 'bad' : '' },
      { label: '현 마찰 Pa/m', num: true, render: r => r.duct ? fmt(r.curPa, 2) : fmt0(r.curPa) },
      { label: '권장 규격', render: r => r.rec.txt }, { label: '권장 유속', num: true, render: r => fmt(r.rec.V, 1) },
      { label: '판정', render: r => r.need ? h('span', { class: 'pill warn' }, '확대') : r.applied ? h('span', { class: 'pill ok' }, '적용됨') : h('span', { class: 'pill ok' }, '적정') },
    ], shown, { onRow: r => toCad(r.it) }));
    if (rows.length > shown.length) w.append(h('div', { class: 'note', style: { marginTop: '4px' } }, `${fmt0(rows.length)}개 중 300개 표시 — 층·계통으로 좁혀 보세요.`));
    w.append(h('div', { class: 'note', style: { marginTop: '10px', lineHeight: 1.6 } },
      `산정 기준 — 덕트: 등마찰법 ${SIZE.ductPa}Pa/m(아연도 강판 ε=0.09mm, Altshul-Tsal 마찰계수), 유속 상한 주덕트 ${SIZE.vMain}·분기 ${SIZE.vBranch}·샤프트 ${SIZE.vRiser}m/s, 원형 등가지름 De=1.30(ab)^0.625/(a+b)^0.25 로 장방형 환산(현재 높이 유지, 종횡비 ${SIZE.maxAspect} 이하, ${SIZE.step}mm 단위). ` +
      `배관: 강관 ε=0.045mm, 마찰 ${SIZE.pipePa}Pa/m 이하·유속 50A 이하 1.5/150A 이하 2.4/그 이상 3.0m/s 이하 최소 호칭경. 소방: NFTC 103 2.5 유속(가지배관 6, 그 밖 10m/s)의 90% 이하 — 정상 운전에서는 최고층 화재 유량으로만 흐르므로 다른 층 가지배관은 헤드 배치 후 별표 1(헤드 수 기준 관경)로 확인하세요. ` +
      `유량은 가동 시뮬레이션의 망 해석(루프·T 분기 분배) 결과입니다. 규격을 키우면 천장 속 높이·간섭이 바뀌므로 계통 집계의 높이 배분과 간섭검토를 다시 확인하세요.`));
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
    w.append(h('div', {}, h('h1', {}, '설비·전기·소방'), h('div', { class: 'sub' }, '시나리오(정상·화재·정전·장비 정지)를 고르면 계통도대로 흘려 보고 환기량·전력·소방이 기준대로 작동하는지 판정합니다. 계통 집계·스프링클러 배치·전기 부하 집계도 여기서 합니다.')));
    w.append(h('div', { class: 'row', style: { margin: '12px 0', gap: '6px', flexWrap: 'wrap' } },
      ...VIEWS.map(([id, nm]) => h('button', { class: 'btn' + (st.view === id ? ' primary' : ''), onclick: () => { st.view = id; render(); } }, nm))));
    if (st.view === 'fire') fireView(); else if (st.view === 'elec') elecView(); else if (st.view === 'sim') simView(); else if (st.view === 'size') sizeView(); else sysView();
    page.scrollTop = y;
  }
  render();
  const off = ctx.bus.on('model', render);
  return { unmount() { off(); } };
}
