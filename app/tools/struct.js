// 빌더 구조해석·설계 — 3D 골조 해석(강막), KDS 41 하중·조합, KDS 14 부재 검토, 결과 3D(검토비·변형·단면력도), 보고서
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { h, toast, dialog, saveFile, table } from '../js/ui.js';
import { esc } from '../js/util.js';
import { runStructure, settingsOf, seismicParams, USES, SYSTEMS, GRADES, memberForces, combine, DEFAULTS } from '../js/structmodel.js';
import { designMember, designFoundations, designConnections, constructionChecks } from '../js/kds.js';
import { FIELDS as RB_FIELDS, specOf } from '../js/rebar.js';
import { simUI, slabUI, shortUI, csUI, pushUI, heat } from './structsim.js';
import { schemeUI } from './structscheme.js';
import { autoRun, baseSettings, REGIONS, USE_INFO, SITE_DEFAULT } from '../js/structauto.js';

const CACHE = new WeakMap();
const maxDrift = (res) => { const sp = res.info.seis; if (!sp) return null; const rs = res.cases.includes('RX'); return Math.max(0, ...res.story.map(f => rs ? Math.max(f.drRX || 0, f.drRY || 0) : Math.max(f.drEX || 0, f.drEY || 0))) * sp.Cd / sp.Ie; };
const CASE_NAME = { D: '고정하중 D', L: '활하중 L', WX: '풍하중 Wx', WY: '풍하중 Wy', EX: '지진 등가정적 Ex', EY: '지진 등가정적 Ey', RX: '응답스펙트럼 Rx', RY: '응답스펙트럼 Ry' };
const ratioColor = (r) => r == null ? 0x8a94a6 : r > 1 ? 0xff4d4f : r > 0.9 ? 0xff9f1c : r > 0.7 ? 0xf5d547 : r > 0.4 ? 0x4cc38a : 0x3a8fd6;
const css = (c) => '#' + c.toString(16).padStart(6, '0');
const kN = (v) => (v / 1e3).toFixed(1), kNm = (v) => (v / 1e6).toFixed(1);

export function mount(root, ctx) {
  const P = ctx.P; P.struct ||= {}; let C = CACHE.get(P) || null;
  const st = { view: 'ratio', lc: 'env', floor: 'all', scale: 1, tab: 'sum', sel: null, mode: 0, page: 'res' }; let sub = null; const api = {};
  // ---------- DOM ----------
  const tb = h('div', { class: 'row', style: { gap: '6px', padding: '8px 10px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap', alignItems: 'center' } });
  const holder = h('div', { style: { position: 'relative', flex: 1, minWidth: 0, minHeight: 0, background: '#11151c' } });
  const side = h('div', { class: 'side', style: { width: '440px', maxWidth: '46vw', overflow: 'auto', padding: '10px 12px' } });
  const legend = h('div', { class: 'mono', style: { position: 'absolute', left: '10px', bottom: '10px', background: '#0f1218dd', border: '1px solid #2a3342', borderRadius: '6px', padding: '6px 8px', fontSize: '11.5px', color: '#cfd6e2', lineHeight: 1.6 } });
  const busy = h('div', { style: { position: 'absolute', inset: 0, display: 'none', alignItems: 'center', justifyContent: 'center', background: '#0b0e13cc', color: '#e6edf7', fontSize: '15px', zIndex: 5 } });
  holder.append(legend, busy);
  root.append(h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } }, tb, h('div', { style: { display: 'flex', flex: 1, minHeight: 0 } }, holder, side)));
  // ---------- three ----------
  let renderer; try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); } catch { holder.append(h('div', { class: 'empty' }, 'WebGL을 사용할 수 없습니다.')); }
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x11151c); const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
  let controls = null; const G = new THREE.Group(); scene.add(G); scene.add(new THREE.AmbientLight(0xffffff, 0.9)); const dl = new THREE.DirectionalLight(0xffffff, 0.8); dl.position.set(1, 2, 1.5); scene.add(dl);
  if (renderer) { renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); holder.prepend(renderer.domElement); renderer.domElement.style.display = 'block'; renderer.domElement.style.touchAction = 'none'; controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; }
  const bx = P.base?.x || 0, by = P.base?.y || 0; const V3 = (x, y, z) => new THREE.Vector3((x - bx) / 1000, z / 1000, -(y - by) / 1000);
  let raf = 0, dirty = true; const loop = () => { raf = requestAnimationFrame(loop); if (controls?.update() || dirty) { renderer?.render(scene, camera); dirty = false; } }; if (renderer) loop(); controls?.addEventListener('change', () => dirty = true);
  const resize = () => { const r = holder.getBoundingClientRect(); if (!renderer || !r.width) return; renderer.setSize(r.width, r.height); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); dirty = true; };
  const ro = new ResizeObserver(resize); ro.observe(holder);
  let pickables = [];

  // ---------- 툴바 ----------
  function sel(opts, v, on) { const s = h('select', { onchange: e => on(e.target.value) }); for (const [k, l] of opts) s.append(h('option', { value: k, selected: String(k) === String(v) }, l)); return s; }
  function renderTB() {
    tb.innerHTML = '';
    tb.append(h('b', { style: { marginRight: '6px' } }, '구조해석'), h('button', { class: 'btn', onclick: settings }, '현장·용도 조건'), h('button', { class: 'btn primary', onclick: run }, C ? '다시 해석' : '해석 실행'), h('button', { class: 'btn' + (st.page === 'scheme' ? ' primary' : ''), onclick: () => setPage(st.page === 'scheme' ? 'res' : 'scheme') }, '구조 형식 비교·추천'));
    if (!C) return;
    tb.append(h('span', { class: 'note', style: { margin: '0 4px' } }, '|'), ...[['res', '해석 결과'], ['sim', '거동 시뮬레이션'], ['slab', '슬래브'], ['cs', '시공단계'], ['push', '푸시오버'], ['short', '기둥 축소량']].map(([k, l]) => h('button', { class: 'btn' + (st.page === k ? ' primary' : ''), onclick: () => setPage(k) }, l)));
    if (st.page !== 'res') return;
    tb.append(h('span', { class: 'note', style: { margin: '0 4px' } }, '|'),
      sel([['ratio', '검토비'], ['model', '모델'], ['defo', '변형'], ...(C.res.info.modal ? [['mode', '모드 형상']] : []), ['My', '모멘트 My(강축)'], ['Mz', '모멘트 Mz(약축·면내)'], ['N', '축력 N'], ['V', '전단 V']], st.view, v => { st.view = v; draw(); }),
      sel([['env', '포락(전 조합)'], ...C.res.cases.map(c => [c, CASE_NAME[c]]), ...C.res.combos.map(c => [c.id, `${c.id} ${c.name}`])], st.lc, v => { st.lc = v; draw(); renderSide(); }),
      st.view === 'mode' ? sel(C.res.info.modal.modes.map((m, i) => [i, `${i + 1}차 T=${m.T.toFixed(3)}s`]), st.mode, v => { st.mode = +v; draw(); }) : '',
      sel([['all', '전체 층'], ...C.res.M.lv.map(l => [l.id, l.name])], st.floor, v => { st.floor = v; draw(); }),
      h('label', { class: 'row', style: { gap: '4px' } }, h('span', { class: 'note' }, '배율'), h('input', { type: 'range', min: 0.2, max: 5, step: 0.1, value: st.scale, style: { width: '90px' }, oninput: e => { st.scale = +e.target.value; draw(); } })),
      h('span', { style: { flex: 1 } }), h('button', { class: 'btn', onclick: autoRebar, title: '필요 철근으로 배근(일람표)을 만들고 실배근으로 다시 검토' }, '자동 배근'), h('button', { class: 'btn', onclick: editCombos }, '하중조합'), h('button', { class: 'btn', onclick: exportXLSX }, 'Excel'), h('button', { class: 'btn', onclick: exportHTML }, '구조계산서'));
  }
  // ---------- 현장·용도 조건 (사용자 입력) ----------
  async function settings() {
    const site = { ...SITE_DEFAULT, ...(P.struct.site || {}) };
    const v = await dialog({ title: '현장·용도 조건', wide: true, body: '<div class="note" style="line-height:1.6">현장마다 다른 값만 입력합니다. 콘크리트 강도·철근 등급·구조시스템·내진등급·해석법·마감하중 등은 해석 결과로 툴이 산정해 제안합니다. 하중계수·강도감소계수는 KDS 기준값으로 고정입니다.</div>', fields: [
      { key: 'use', label: '건물 용도', type: 'select', options: Object.entries(USE_INFO).map(([k, u]) => [k, `${k} (활하중 ${u.LL} kN/m²)`]), value: site.use },
      { key: 'region', label: '지역 (기본풍속·지진구역)', type: 'select', options: [...Object.keys(REGIONS).map(k => [k, `${k} — ${REGIONS[k][0]} m/s · 구역 ${REGIONS[k][1] >= 0.11 ? 'I' : 'II'}`]), ['직접 입력', '직접 입력 (해외·특수 위치)']], value: site.region },
      { key: 'V0', label: '직접 입력 시 — 기본풍속 V0 (m/s)', type: 'number', value: site.V0 ?? '' }, { key: 'Z', label: '직접 입력 시 — 지진구역계수 Z', type: 'number', value: site.Z ?? '' },
      { key: 'siteClass', label: '지반 분류 (지반조사)', type: 'select', options: [['', '미조사 — 기준 기본값 S4 적용'], ['S1', 'S1 암반'], ['S2', 'S2 얕고 단단한 지반'], ['S3', 'S3 얕고 연약한 지반'], ['S4', 'S4 깊고 단단한 지반'], ['S5', 'S5 깊고 연약한 지반']], value: site.siteClass || '' },
      { key: 'qa', label: '허용지내력 qa (kPa, 지반조사·평판재하)', type: 'number', placeholder: '미입력 시 필요 지내력만 산정', value: site.qa ?? '' },
      { key: 'exp', label: '노풍도 (주변 환경)', type: 'select', options: [['A', 'A — 대도시 중심 (고층 밀집)'], ['B', 'B — 도시·교외 (주택·저층 건물)'], ['C', 'C — 평탄·장애물 산재'], ['D', 'D — 해안·수면']], value: site.exp }], ok: '저장' });
    if (!v) return;
    P.struct.site = { use: v.use, region: v.region, siteClass: v.siteClass, qa: v.qa === '' || v.qa == null ? null : +v.qa, exp: v.exp, ...(v.region === '직접 입력' ? { V0: +v.V0 || 26, Z: +v.Z || 0.11 } : {}) };
    delete P.struct.set; ctx.touch('meta'); toast('현장·용도 조건을 저장했습니다 — 다시 해석하면 설계 조건을 새로 산정합니다');
  }
  // ---------- 실행 ----------
  const tick = () => new Promise(r => setTimeout(r, 0));
  async function run() {
    busy.style.display = 'flex'; busy.textContent = '해석 모델 만드는 중…'; await tick();
    try {
      const A = await autoRun(P, { onProgress: (m) => { busy.textContent = m; }, tick }); const res = A.res; const S = A.S;
      if (A.empty || res.empty) { busy.style.display = 'none'; C = null; CACHE.delete(P); renderTB(); renderSide(); draw(); return toast('해석할 구조 부재(기둥·보·RC벽)가 없습니다', 'err'); }
      busy.textContent = `해석 완료 ${(res.info.time / 1000).toFixed(1)}초 — 부재 검토 중…`; await tick();
      const D = []; const n = res.M.members.length; const t0 = performance.now();
      for (let i = 0; i < n; i++) { D.push(designMember(res, i, S)); if (i % 150 === 149) { busy.textContent = `부재 검토 ${i + 1}/${n}`; await tick(); } }
      res.info.tDesign = performance.now() - t0;
      busy.textContent = '접합부 설계 중…'; await tick(); const J = res.M.members.some(m => m.kind === 'beam' && m.mat === 'STEEL' && m.sh) ? designConnections(res, S) : [];
      C = { res, D, S, at: Date.now(), F: designFoundations(res, S), J, X: constructionChecks(res, D, S), auto: A.rows }; CACHE.set(P, C); P.struct.auto = { at: Date.now(), rows: A.rows };
      const sp = res.info.seis; const drift = sp ? maxDrift(res) : null;
      P.struct.last = { at: Date.now(), members: n, ng: D.filter(d => d.ratio > 1).length, max: Math.max(...D.map(d => d.ratio)), drift, driftLim: sp?.driftLim, T: sp?.T?.X, V: sp?.X?.V }; ctx.touch('meta');
      st.view = 'ratio'; st.lc = 'env'; st.tab = 'sum'; sub?.leave?.(); sub = null; st.page = 'res'; api.simState = api.slabState = api.shortState = api.csState = api.pushState = null;
    } catch (e) { console.error(e); toast('해석 실패: ' + (e.message || e), 'err', 6000); }
    busy.style.display = 'none'; renderTB(); renderSide(); draw(true);
  }

  // ---------- 그리기 ----------
  const comboOf = (id) => C.res.combos.find(c => c.id === id);
  function forcesFor(mi, stations) { const mf = memberForces(C.res, mi, stations); if (C.res.cases.includes(st.lc)) return mf.byCase[st.lc].map(s => ({ ...s })); const cb = comboOf(st.lc) || C.res.combos[1] || C.res.combos[0]; return combine(mf, cb); }
  let PV = null;
  function draw(fit = false) { return drawWith((st.page === 'scheme' && PV) ? PV : (st.page === 'scheme' ? null : C), fit); }
  function drawWith(C, fit = false) {
    for (const o of [...G.children]) { G.remove(o); o.geometry?.dispose(); o.material?.dispose?.(); } pickables = [];
    if (!C) { // 미해석: 모델 윤곽만
      legend.innerHTML = '해석 전 — 현장·용도 조건 확인 후 "해석 실행"'; dirty = true; return;
    }
    const { M, R } = C.res; const N = M.nodes; const lvF = st.floor === 'all' ? null : M.lv.find(l => l.id === st.floor);
    const vis = (m) => !lvF || m.r.level.id === lvF.id;
    const D = C.D; const pos = [], col = [], lpos = []; const defo = st.view === 'defo' || st.view === 'mode';
    // 변형 배율
    const modeOn = st.view === 'mode'; let cr = C.res.cases.includes(st.lc) ? R.cases[st.lc] : null;
    if (modeOn) { const MD = C.res.info.modal; const mo = MD.modes[st.mode]; if (!mo.full) { const b = new Float64Array(R.N); MD.dof.forEach((d, k) => { b[d] = MD.m[k] * mo.phi[k] * mo.w * mo.w; }); mo.full = R.post(R.solveRaw(b)); } cr = mo.full; } const cb = !cr && st.lc !== 'env' ? comboOf(st.lc) : null;
    const disp = (n) => { const out = [0, 0, 0]; if (cr) for (let k = 0; k < 3; k++) out[k] = cr.disp[n * 6 + k]; else { const c2 = cb || C.res.combos[1]; for (const [k2, f] of Object.entries(c2.f)) { const d = R.cases[k2]; if (d) for (let k = 0; k < 3; k++) out[k] += f * d.disp[n * 6 + k]; } } return out; };
    let ext = 0; for (const n of N) if (n.used) ext = Math.max(ext, Math.abs(n.x - bx), Math.abs(n.y - by), n.z); const size = ext / 1000 || 10;
    let dmax = 0; if (defo) N.forEach((n, i) => { if (n.used) { const d = disp(i); dmax = Math.max(dmax, Math.hypot(...d)); } });
    const ds = defo && dmax ? size * 1000 * 0.06 / dmax * st.scale : 0;
    const P3 = (i) => { const n = N[i]; if (!ds) return V3(n.x, n.y, n.z); const d = disp(i); return V3(n.x + d[0] * ds, n.y + d[1] * ds, n.z + d[2] * ds); };
    const wallGeo = [], wallCol = [];
    M.members.forEach((m, mi) => {
      if (!vis(m)) return; const r = D[mi]?.ratio; const c = new THREE.Color(st.view === 'ratio' ? ratioColor(r) : m.kind === 'beam' ? 0x6fa8dc : m.kind === 'wall' ? 0x9aa6b8 : 0xe0c27a);
      if (m.kind === 'wall') { const el = m.el; const e0 = R.E[m.segs[0]].e; const z0 = N[e0.n1].z, z1 = N[e0.n2].z; const a = el.a, b = el.b;
        const q = defo ? [P3(e0.n1), P3(e0.n2)] : null; const off = q ? [q[0].clone().sub(V3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z0)), q[1].clone().sub(V3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z1))] : [new THREE.Vector3(), new THREE.Vector3()];
        const A0 = V3(a[0], a[1], z0).add(off[0]), B0 = V3(b[0], b[1], z0).add(off[0]), A1 = V3(a[0], a[1], z1).add(off[1]), B1 = V3(b[0], b[1], z1).add(off[1]);
        const base = wallGeo.length / 3; wallGeo.push(...A0.toArray(), ...B0.toArray(), ...B1.toArray(), ...A1.toArray()); for (let k = 0; k < 4; k++) wallCol.push(c.r, c.g, c.b); wallIdx.push(base, base + 1, base + 2, base, base + 2, base + 3); wallMem.push(mi, mi);
        for (const [p, q2] of [[A0, B0], [B0, B1], [B1, A1], [A1, A0]]) { pos.push(...p.toArray(), ...q2.toArray()); col.push(c.r * 0.7, c.g * 0.7, c.b * 0.7, c.r * 0.7, c.g * 0.7, c.b * 0.7); lmem.push(mi); }
        return; }
      for (const ei of m.segs) { const e = R.E[ei].e; const a = P3(e.n1), b = P3(e.n2); pos.push(...a.toArray(), ...b.toArray()); col.push(c.r, c.g, c.b, c.r, c.g, c.b); lmem.push(mi); }
    });
    // 강체 연결·원형
    if (defo) M.members.forEach((m) => { if (!vis(m) || m.kind === 'wall') return; for (const ei of m.segs) { const e = R.E[ei].e; const a = N[e.n1], b = N[e.n2]; lpos.push(...V3(a.x, a.y, a.z).toArray(), ...V3(b.x, b.y, b.z).toArray()); } });
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); lg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true })); lines.userData.mem = lmem.slice(); G.add(lines); pickables.push(lines);
    if (wallGeo.length) { const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wallGeo, 3)); wg.setAttribute('color', new THREE.Float32BufferAttribute(wallCol, 3)); wg.setIndex(wallIdx.slice()); const wm = new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })); wm.userData.mem = wallMem.slice(); G.add(wm); pickables.push(wm); }
    wallIdx.length = 0; wallMem.length = 0; lmem.length = 0;
    if (lpos.length) { const og = new THREE.BufferGeometry(); og.setAttribute('position', new THREE.Float32BufferAttribute(lpos, 3)); G.add(new THREE.LineSegments(og, new THREE.LineBasicMaterial({ color: 0x3a4456 }))); }
    // 지점
    const sp = []; N.forEach(n => { if (n.used && n.fix && (!lvF || true)) sp.push(...V3(n.x, n.y, n.z).toArray()); }); if (sp.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); G.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x7bd389, size: 6, sizeAttenuation: false }))); }
    // 단면력도
    let note = '';
    if (['My', 'Mz', 'N', 'V'].includes(st.view)) {
      const ms = M.members.map((m, i) => i).filter(i => vis(M.members[i]) && M.members[i].kind !== 'wall' || (vis(M.members[i]) && M.members[i].kind === 'wall' && st.view !== 'My'));
      if (!lvF && ms.length > 1200) note = '부재가 많아 단면력도는 층을 고르면 표시합니다';
      else {
        const lc = st.lc === 'env' ? (C.res.combos[1]?.id || 'LC1') : st.lc; const keep = st.lc; st.lc = lc;
        const data = ms.map(mi => ({ mi, f: forcesFor(mi) })); st.lc = keep;
        const key = st.view === 'V' ? (m) => m.kind === 'beam' ? 'Vz' : 'Vy' : st.view; let vmax = 0; for (const d of data) { const k = typeof key === 'function' ? key(M.members[d.mi]) : key; for (const s of d.f) vmax = Math.max(vmax, Math.abs(s[k])); }
        const sc = vmax ? size * 0.05 / vmax * st.scale : 0; const dp = [], dc = [];
        for (const d of data) {
          const m = M.members[d.mi]; const k = typeof key === 'function' ? key(m) : key; let x0 = 0; let i = 0;
          for (const ei of m.segs) { const E = R.E[ei]; const a = N[E.e.n1], b = N[E.e.n2]; const Rr = E.R; const dir = st.view === 'My' || (st.view === 'V' && m.kind === 'beam') || (st.view === 'N' && m.kind === 'beam') ? Rr[2] : Rr[1];
            const pts = []; for (let j = 0; j < 9; j++, i++) { const s = d.f[i]; if (!s) continue; const t = j / 8; const base = [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t]; const v = s[k] * sc * 1000 * (st.view === 'My' && m.kind === 'beam' ? -1 : 1); pts.push([V3(...base), V3(base[0] + dir[0] * v, base[1] + dir[1] * v, base[2] + dir[2] * v), s[k]]); }
            for (let j = 0; j < pts.length; j++) { const [p0, p1, v] = pts[j]; const cc = new THREE.Color(v >= 0 ? 0x5ab0ff : 0xff6b6b); if (j % 2 === 0) { dp.push(...p0.toArray(), ...p1.toArray()); dc.push(cc.r, cc.g, cc.b, cc.r, cc.g, cc.b); } if (j) { const q = pts[j - 1][1]; dp.push(...q.toArray(), ...p1.toArray()); dc.push(cc.r, cc.g, cc.b, cc.r, cc.g, cc.b); } }
            x0 += E.L; }
        }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(dc, 3)); G.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true })));
        note = `최대 ${st.view.startsWith('M') ? kNm(vmax) + ' kN·m' : kN(vmax) + ' kN'} · ${lc} ${comboOf(lc)?.name || CASE_NAME[lc] || ''}`;
      }
    }
    // 선택 강조
    if (st.sel != null) { const m = M.members[st.sel]; const hp = []; for (const ei of m.segs) { const e = R.E[ei].e; const a = N[e.n1], b = N[e.n2]; hp.push(...V3(a.x, a.y, a.z).toArray(), ...V3(b.x, b.y, b.z).toArray()); } if (m.kind === 'wall') { const el = m.el; const e = R.E[m.segs[0]].e; const z0 = N[e.n1].z, z1 = N[e.n2].z; hp.push(...V3(el.a[0], el.a[1], z0).toArray(), ...V3(el.b[0], el.b[1], z0).toArray(), ...V3(el.a[0], el.a[1], z1).toArray(), ...V3(el.b[0], el.b[1], z1).toArray()); } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3)); const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false })); l.renderOrder = 9; G.add(l); }
    // 범례
    if (st.view === 'ratio') legend.innerHTML = `검토비 (${st.lc === 'env' ? '전 조합 포락' : '포락'})<br>` + [[1.01, '> 1.0 NG'], [0.95, '0.9 ~ 1.0'], [0.8, '0.7 ~ 0.9'], [0.5, '0.4 ~ 0.7'], [0.2, '< 0.4']].map(([r, t]) => `<span style="color:${css(ratioColor(r))}">■</span> ${t}`).join('<br>');
    else if (st.view === 'mode') { const mo = C.res.info.modal.modes[st.mode]; legend.innerHTML = `${st.mode + 1}차 모드 · T = ${mo.T.toFixed(3)} s<br>질량참여 X ${(mo.ratio.X * 100).toFixed(1)}% · Y ${(mo.ratio.Y * 100).toFixed(1)}% · RZ ${(mo.ratio.RZ * 100).toFixed(1)}%`; }
    else if (defo) legend.innerHTML = `변형 ${st.lc === 'env' ? C.res.combos[1]?.name : (CASE_NAME[st.lc] || comboOf(st.lc)?.name)}<br>최대 ${dmax.toFixed(1)} mm · 표시 배율 ×${Math.round(ds)}`;
    else if (st.view === 'model') legend.innerHTML = `<span style="color:#e0c27a">■</span> 기둥 <span style="color:#6fa8dc">■</span> 보 <span style="color:#9aa6b8">■</span> 벽 <span style="color:#7bd389">●</span> 고정지점`;
    else legend.innerHTML = `${{ My: '모멘트 My', Mz: '모멘트 Mz', N: '축력 N (인장 +)', V: '전단력' }[st.view]}<br>${note}<br><span style="color:#5ab0ff">■</span> + <span style="color:#ff6b6b">■</span> −`;
    if (fit || !G.userData.fitted) { const c = V3((Math.min(...N.filter(n => n.used).map(n => n.x)) + Math.max(...N.filter(n => n.used).map(n => n.x))) / 2, (Math.min(...N.filter(n => n.used).map(n => n.y)) + Math.max(...N.filter(n => n.used).map(n => n.y))) / 2, ext / 2); controls?.target.copy(c); const hz = Math.max(...N.filter(n => n.used).map(n => n.z)) / 1000; c.y = hz / 2; controls?.target.copy(c); const sp2 = Math.max(size, hz); camera.position.set(c.x + sp2 * 0.95, c.y + sp2 * 0.55, c.z + sp2 * 1.15); camera.far = size * 20; camera.updateProjectionMatrix(); G.userData.fitted = true; }
    dirty = true;
  }
  const wallIdx = [], wallMem = [], lmem = [];
  // 선택 (클릭)
  const ray = new THREE.Raycaster(); let down = null;
  renderer?.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  renderer?.domElement.addEventListener('pointerup', e => {
    if (!C || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return; const r = renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(v, camera); ray.params.Line.threshold = camera.position.distanceTo(controls.target) * 0.008;
    const hit = ray.intersectObjects(pickables, false)[0]; if (!hit) return; const o = hit.object; const mi = o.isMesh ? o.userData.mem[Math.floor(hit.faceIndex / 2)] : o.userData.mem[Math.floor(hit.index / 2)];
    if (mi == null) return; select(mi);
  });
  function setPage(p) {
    sub?.leave?.(); sub = null; st.page = p; renderTB();
    if (p === 'res') { renderSide(); draw(); return; }
    if (p !== 'scheme' && !C) { st.page = 'res'; renderTB(); renderSide(); return; }
    legend.innerHTML = ''; side.innerHTML = '';
    sub = (p === 'sim' ? simUI : p === 'slab' ? slabUI : p === 'scheme' ? schemeUI : p === 'cs' ? csUI : p === 'push' ? pushUI : shortUI)(api);
  }
  Object.defineProperty(api, 'C', { get: () => C });
  Object.assign(api, { P, ctx, side, G, holderEl: holder, markDirty: () => { dirty = true; }, select: (mi) => { setPage('res'); select(mi); },
    overlay(el) { holder.querySelector('.st-ov')?.remove(); if (el) { el.classList.add('st-ov'); holder.append(el); } },
    anim: { build: buildAnim }, preview(res, D) { PV = res ? { res, D } : null; st.view = 'ratio'; st.lc = 'env'; G.userData.fitted = false; draw(true); }, invalidate() { C = null; CACHE.delete(P); delete P.struct.last; renderTB(); } });
  function clearG() { for (const o of [...G.children]) { G.remove(o); o.geometry?.dispose(); o.material?.dispose?.(); } pickables = []; }
  function buildAnim() {
    clearG(); const { M, R } = C.res; const N = M.nodes; const lid = [], wid = [], widx = [];
    for (const m of M.members) { if (m.kind === 'wall') { const b = wid.length; wid.push(...m.wn); widx.push(b, b + 1, b + 2, b, b + 2, b + 3); for (const [p, q] of [[0, 1], [1, 2], [2, 3], [3, 0]]) lid.push(m.wn[p], m.wn[q]); continue; } for (const ei of m.segs) { const e = R.E[ei].e; lid.push(e.n1, e.n2); } }
    const base = (i) => [(N[i].x - bx) / 1000, N[i].z / 1000, -(N[i].y - by) / 1000];
    const mk = (ids) => { const g = new THREE.BufferGeometry(); const p = new Float32Array(ids.length * 3); ids.forEach((n, k) => p.set(base(n), k * 3)); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(ids.length * 3).fill(0.6), 3)); return g; };
    const lg = mk(lid); const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true })); G.add(lines);
    let wm = null; if (wid.length) { const wg = mk(wid); wg.setIndex(widx); wm = new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })); G.add(wm); }
    const ghost = new THREE.LineSegments(mk(lid), new THREE.LineBasicMaterial({ color: 0x2a3342 })); G.add(ghost);
    const spts = []; N.forEach((n, i) => { if (n.used && n.fix) spts.push(...base(i)); }); if (spts.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(spts, 3)); G.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x7bd389, size: 5, sizeAttenuation: false }))); }
    let ext = 0, cx = 0, cy = 0, cz = 0, cnt = 0; N.forEach(n => { if (!n.used) return; ext = Math.max(ext, Math.abs(n.x - bx), Math.abs(n.y - by), n.z); cx += n.x; cy += n.y; cz += n.z; cnt++; });
    const size = ext / 1000 || 10; const center = new THREE.Vector3((cx / cnt - bx) / 1000, cz / cnt / 1000, -(cy / cnt - by) / 1000);
    legend.innerHTML = '';
    const upd = (geo, ids, f, amp, vmax) => { const P3 = geo.attributes.position.array, C3 = geo.attributes.color.array; for (let k = 0; k < ids.length; k++) { const n = ids[k]; const b = base(n); if (f) { const ux = f[n * 3], uy = f[n * 3 + 1], uz = f[n * 3 + 2]; P3[k * 3] = b[0] + ux * amp / 1000; P3[k * 3 + 1] = b[1] + uz * amp / 1000; P3[k * 3 + 2] = b[2] - uy * amp / 1000; const c = heat(Math.hypot(ux, uy, uz) / (vmax || 1)); C3[k * 3] = c[0]; C3[k * 3 + 1] = c[1]; C3[k * 3 + 2] = c[2]; } else { P3.set(b, k * 3); C3[k * 3] = C3[k * 3 + 1] = C3[k * 3 + 2] = 0.6; } } geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; };
    return { size, center, update(f, amp = 1, vmax = 1) { upd(lg, lid, f, amp, vmax); if (wm) upd(wm.geometry, wid, f, amp, vmax); if (f) legend.innerHTML = `변위 크기 (색) · 최대 ${vmax.toFixed(1)} mm<br>` + [1, 0.75, 0.5, 0.25, 0].map(t => { const c = heat(t); return `<span style="color:rgb(${c.map(x => Math.round(x * 255)).join(',')})">■</span> ${(vmax * t).toFixed(1)}`; }).join(' '); else legend.innerHTML = ''; dirty = true; } };
  }
  function select(mi) { st.sel = mi; st.tab = 'mem'; renderSide(); draw(); }

  // ---------- 사이드 ----------
  function renderSide() {
    side.innerHTML = '';
    if (!C) {
      const site = { ...SITE_DEFAULT, ...(P.struct.site || {}) }; const U = USE_INFO[site.use];
      side.append(h('h3', {}, '구조해석·설계'), h('div', { class: 'note', style: { lineHeight: 1.7 } },
        '작도·3D 모델의 기둥·보·RC 벽·슬래브로 3D 해석 모델을 만들고, 현장·용도 조건만으로 설계 조건을 자동 산정한 뒤 해석·부재 검토까지 진행합니다.'),
        h('div', { class: 'card', style: { marginTop: '10px' } }, h('div', { class: 'd' }, '현장·용도 조건 (입력)'), h('div', { style: { fontSize: '12.5px', lineHeight: 1.8, marginTop: '4px' } },
          `용도 ${site.use} (활하중 ${U?.LL} kN/m²)`, h('br'), `지역 ${site.region}`, h('br'), `지반 ${site.siteClass || '미조사 (S4 적용)'} · 허용지내력 ${site.qa ? site.qa + ' kPa' : h('b', { style: { color: '#ff9f1c' } }, '미입력')}`, h('br'), `노풍도 ${site.exp}`)),
        h('div', { class: 'card', style: { marginTop: '8px' } }, h('div', { class: 'd' }, '툴이 산정하는 항목'), h('div', { class: 'note', style: { fontSize: '12px', lineHeight: 1.7, marginTop: '4px' } }, '콘크리트 강도(층 구간별) · 철근·강재 등급 · 구조시스템(R) · 내진등급 · 지진 해석법 · P-Δ · 마감하중 · 풍하중 계수 · 주근비. 하중계수·강도감소계수는 KDS 고정.')),
        h('div', { class: 'row', style: { gap: '6px', marginTop: '10px' } }, h('button', { class: 'btn', onclick: settings }, '현장·용도 조건'), h('button', { class: 'btn primary', onclick: run }, '해석 실행')));
      return;
    }
    const tabs = [['sum', '요약'], ['story', '층'], ...(C.res.info.modal ? [['modal', '모드']] : []), ['found', '기초'], ...(C.J?.length ? [['conn', '접합부']] : []), ['site', '시공 체크'], ['mem', '부재'], ['list', '목록']];
    side.append(h('div', { class: 'row', style: { gap: '4px', marginBottom: '10px' } }, tabs.map(([k, l]) => h('button', { class: 'btn sm' + (st.tab === k ? ' primary' : ''), onclick: () => { st.tab = k; renderSide(); } }, l))));
    ({ sum: sideSum, story: sideStory, mem: sideMem, list: sideList, modal: sideModal, found: sideFound, conn: sideConn, site: sideSite })[st.tab]?.();
  }
  const pill = (ok, t) => h('span', { class: 'pill ' + (ok ? 'ok' : 'bad') }, t);
  function sideSum() {
    const { res, D } = C; const I = res.info; const ng = D.filter(d => d.ratio > 1); const sp = I.seis;
    const drift = sp ? maxDrift(res) : null;
    const card = (k, v, s) => h('div', { class: 'card' }, h('div', { class: 'd' }, k), h('div', { class: 't', style: { fontSize: '18px', margin: '2px 0' } }, v), s ? h('div', {}, s) : null);
    side.append(h('div', { class: 'cards', style: { gridTemplateColumns: '1fr 1fr' } },
      card('부재 검토', `${D.length - ng.length}/${D.length} 적합`, ng.length ? pill(false, `NG ${ng.length}`) : pill(true, '전 부재 적합')),
      card('최대 검토비', Math.max(...D.map(d => d.ratio)).toFixed(2), h('span', { class: 'note' }, (() => { const w = D.reduce((a, b) => b.ratio > a.ratio ? b : a); const m = res.M.members[w.mi]; return `${m.r.level.name} ${m.el.tag || w.type}`; })())),
      sp ? card(res.cases.includes('RX') ? '층간변위비 (응답스펙트럼)' : '층간변위비 (설계)', `${(drift * 100).toFixed(3)}%`, pill(drift <= sp.driftLim, `허용 ${(sp.driftLim * 100).toFixed(1)}%`)) : null,
      sp ? card('밑면전단력 Ex', `${kN(sp.X.V)} kN`, h('span', { class: 'note' }, `Cs ${sp.X.Cs.toFixed(4)} · T ${sp.T.X.toFixed(2)}s`)) : null));
    if (C.auto) { const tag = (c) => h('span', { class: 'pill ' + (c === '입력' ? 'acc' : c === '기준' ? '' : 'ok'), style: { whiteSpace: 'nowrap' } }, c);
      side.append(h('h4', { style: { margin: '14px 0 4px' } }, '설계 조건 — 툴 산정·제안'), h('div', { class: 'tbl' }, table([{ label: '', render: r => tag(r.cat) }, { label: '항목', render: r => h('b', { style: { whiteSpace: 'nowrap' } }, r.k) }, { label: '제안값 · 근거', render: r => h('div', {}, r.v, h('div', { class: 'note', style: { fontSize: '11.5px' } }, r.why)) }], C.auto))); }
    const eq = I.check; const ok = (a, b) => Math.abs(a - b) <= Math.max(1, Math.abs(a) * 1e-3);
    side.append(h('h4', { style: { margin: '14px 0 4px' } }, '해석 정보'), h('div', { class: 'tbl' }, table([{ label: '항목', key: 'k' }, { label: '값', key: 'v' }], [
      { k: '절점 / 요소 / 자유도', v: `${res.M.nodes.filter(n => n.used).length.toLocaleString()} / ${res.M.elems.length.toLocaleString()} / ${I.dof.toLocaleString()}` },
      { k: '부재 (기둥·보·벽)', v: ['column', 'beam', 'wall'].map(k => res.M.members.filter(m => m.kind === k).length).join(' · ') },
      { k: '강막 층', v: `${res.story.length}개 · 건물높이 ${I.hn.toFixed(1)} m` },
      { k: '해석 / 검토 시간', v: `${(I.time / 1000).toFixed(2)}초 / ${((I.tDesign || 0) / 1000).toFixed(2)}초` },
      { k: '평형 — 고정하중', v: h('span', {}, `${kN(eq.D.applied)} kN = 반력 ${kN(eq.D.reac)} `, pill(ok(eq.D.applied, eq.D.reac), ok(eq.D.applied, eq.D.reac) ? '일치' : '불일치')) },
      { k: '평형 — 활하중', v: h('span', {}, `${kN(eq.L.applied)} kN = 반력 ${kN(eq.L.reac)} `, pill(ok(eq.L.applied, eq.L.reac), ok(eq.L.applied, eq.L.reac) ? '일치' : '불일치')) },
      ...(eq.EX ? [{ k: '평형 — 지진 Ex', v: h('span', {}, `${kN(eq.EX.applied)} kN = 반력 ${kN(-eq.EX.reac)} `, pill(ok(eq.EX.applied, -eq.EX.reac), '일치')) }] : []),
      { k: '해석 옵션', v: `${I.modal ? '응답스펙트럼' : '등가정적'}${I.pdelta ? ' · P-Δ' : ''}${I.cs ? ` · 시공단계 ${I.cs.G}단계` : ''}${I.userCombos ? ' · 사용자 하중조합' : ''} · 조합 ${res.combos.length}개` },
      { k: '건물 중량 W', v: `${kN(I.Wt)} kN (${(I.Wt / 1e3 / 9.81).toFixed(0)} ton)` },
      ...(I.weak ? [{ k: '불안정 자유도', v: h('span', { style: { color: '#ff8a8a' } }, `${I.weak}개 — 연결되지 않은 부재 확인`) }] : []),
    ])));
    if (sp) side.append(h('h4', { style: { margin: '14px 0 4px' } }, '지진하중 (KDS 41 17 00 등가정적)'), h('div', { class: 'tbl' }, table([{ label: '항목', key: 'k' }, { label: 'X', key: 'x' }, { label: 'Y', key: 'y' }], [
      { k: 'S / SDS / SD1', x: `${sp.S.toFixed(3)} / ${sp.SDS.toFixed(3)} / ${sp.SD1.toFixed(3)}`, y: `Fa ${sp.Fa.toFixed(2)} · Fv ${sp.Fv.toFixed(2)}` },
      { k: '시스템 R / Cd / Ie', x: `${sp.R} / ${sp.Cd} / ${sp.Ie}`, y: sp.sysName },
      { k: 'Ta (근사) · CuTa', x: `${sp.Ta.toFixed(2)}s · ${(sp.Cu * sp.Ta).toFixed(2)}s`, y: '' },
      { k: '레일리 주기', x: `${sp.Tray.X.toFixed(2)}s`, y: `${sp.Tray.Y.toFixed(2)}s` }, { k: '적용 주기 T', x: `${sp.T.X.toFixed(2)}s`, y: `${sp.T.Y.toFixed(2)}s` },
      { k: 'Cs', x: sp.X.Cs.toFixed(4), y: sp.Y.Cs.toFixed(4) }, { k: '밑면전단력 V', x: `${kN(sp.X.V)} kN`, y: `${kN(sp.Y.V)} kN` }])));
    // 종류별
    const by = {}; for (const d of D) { (by[d.type] ||= { n: 0, ng: 0, max: 0 }); by[d.type].n++; if (d.ratio > 1) by[d.type].ng++; by[d.type].max = Math.max(by[d.type].max, d.ratio); }
    side.append(h('h4', { style: { margin: '14px 0 4px' } }, '부재 종류별'), h('div', { class: 'tbl' }, table([{ label: '종류', key: 'k' }, { label: '개수', key: 'n', num: true }, { label: 'NG', key: 'ng', num: true }, { label: '최대비', key: 'max', num: true }], Object.entries(by).map(([k, v]) => ({ k, n: v.n, ng: v.ng || '-', max: v.max.toFixed(2) })))));
    if (ng.length) side.append(h('h4', { style: { margin: '14px 0 4px' } }, `NG 부재 (${ng.length})`), memTable(ng.sort((a, b) => b.ratio - a.ratio).slice(0, 30)));
  }
  function memTable(list) {
    const M = C.res.M.members;
    return h('div', { class: 'tbl' }, table([{ label: '층', render: d => M[d.mi].r.level.name }, { label: '부재', render: d => `${M[d.mi].el.tag || ''}`.slice(0, 18) || d.type }, { label: '종류', key: 'type' }, { label: '지배', key: 'gov' }, { label: '검토비', num: true, render: d => h('b', { style: { color: css(ratioColor(d.ratio)) } }, d.ratio.toFixed(2)) }], list, { onRow: d => select(d.mi) }));
  }
  function sideList() {
    const q = h('input', { placeholder: '부재 태그·층 검색', style: { width: '100%' } }); const box = h('div');
    const f = () => { const s = q.value.trim().toLowerCase(); const M = C.res.M.members; const list = C.D.filter(d => !s || `${M[d.mi].el.tag || ''} ${M[d.mi].r.level.name} ${d.type}`.toLowerCase().includes(s)).sort((a, b) => b.ratio - a.ratio); box.innerHTML = ''; box.append(h('div', { class: 'note', style: { margin: '6px 0' } }, `${list.length}개 · 검토비 순`), memTable(list.slice(0, 300))); };
    q.oninput = f; side.append(q, box); f();
  }
  function sideStory() {
    const { res } = C; const sp = res.info.seis; const S = res.story.slice().reverse(); const lvName = (z) => res.M.lv.find(l => l.elev === z)?.name || (z / 1000).toFixed(1);
    const dr = (f, c) => f['dr' + c] != null ? (f['dr' + c] * (c[0] === 'E' ? sp.Cd / sp.Ie : 1) * 100).toFixed(3) : '-';
    side.append(h('div', { class: 'note', style: { marginBottom: '6px' } }, sp ? `지진 층간변위비 = Cd·δ/Ie (질량중심), 허용 ${(sp.driftLim * 100).toFixed(1)}%. 풍하중은 탄성 변위비(참고 H/400 = 0.25%).` : '층별 결과'));
    side.append(h('div', { class: 'tbl' }, table([{ label: '층', render: f => lvName(f.z) }, { label: 'W kN', num: true, render: f => kN(f.W) }, ...(sp ? [{ label: 'Fx kN', num: true, render: f => kN(f.EX || 0) }, { label: 'Δ/h Ex %', num: true, render: f => { const v = f.drEX * sp.Cd / sp.Ie; return h('span', { style: { color: v > sp.driftLim ? '#ff6b6b' : '' } }, dr(f, 'EX')); } }, { label: 'Δ/h Ey %', num: true, render: f => { const v = f.drEY * sp.Cd / sp.Ie; return h('span', { style: { color: v > sp.driftLim ? '#ff6b6b' : '' } }, dr(f, 'EY')); } }, ...(C.res.cases.includes('RX') ? [{ label: 'Δ/h Rx %', num: true, render: f => { const v = f.drRX * sp.Cd / sp.Ie; return h('span', { style: { color: v > sp.driftLim ? '#ff6b6b' : '' } }, (v * 100).toFixed(3)); } }, { label: 'Δ/h Ry %', num: true, render: f => { const v = f.drRY * sp.Cd / sp.Ie; return h('span', { style: { color: v > sp.driftLim ? '#ff6b6b' : '' } }, (v * 100).toFixed(3)); } }] : []), { label: 'θ', num: true, render: f => { const th = Math.max(f.thEX || 0, f.thEY || 0); return h('span', { style: { color: th > 0.1 ? '#ff9f1c' : '' }, title: '안정계수 θ (0.1 초과 시 P-Δ 고려 필요)' }, th.toFixed(3)); } }, { label: '비틀림', num: true, render: f => h('span', { style: { color: (f.torEX > 1.2 || f.torEY > 1.2) ? '#ff9f1c' : '' }, title: '층 최대/평균 변위 (1.2 초과: 비틀림 비정형)' }, Math.max(f.torEX || 1, f.torEY || 1).toFixed(2)) }] : []), ...(res.cases.includes('WX') ? [{ label: 'Wx kN', num: true, render: f => kN(f.WX || 0) }, { label: 'Δ/h Wx %', num: true, render: f => dr(f, 'WX') }] : [])], S)));
    // 층전단력 그래프
    if (sp) { const cv = h('canvas', { width: 400, height: 260, style: { width: '100%', marginTop: '10px', background: '#0f1218', borderRadius: '6px' } }); side.append(h('h4', { style: { margin: '12px 0 4px' } }, '층전단력 · 층간변위비 (Ex)'), cv); const g = cv.getContext('2d'); const n = res.story.length; let acc = 0; const Vs = []; for (let i = n - 1; i >= 0; i--) { acc += res.story[i].EX || 0; Vs[i] = acc; } const vmax = Vs[0] || 1, dmax = Math.max(sp.driftLim, ...res.story.map(f => f.drEX * sp.Cd / sp.Ie));
      g.font = '11px sans-serif'; g.fillStyle = '#8a94a6'; g.fillText('V (kN)', 8, 14); g.fillText('Δ/h', 220, 14); const H = 230, y = (i) => 250 - (i + 1) / n * H;
      g.strokeStyle = '#5ab0ff'; g.beginPath(); for (let i = 0; i < n; i++) { const x = 10 + Vs[i] / vmax * 180; g.lineTo(x, y(i - 1)); g.lineTo(x, y(i)); } g.stroke();
      g.strokeStyle = '#ff9f1c'; g.beginPath(); for (let i = 0; i < n; i++) g.lineTo(215 + res.story[i].drEX * sp.Cd / sp.Ie / dmax * 170, y(i)); g.stroke();
      g.strokeStyle = '#ff4d4f'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(215 + sp.driftLim / dmax * 170, 20); g.lineTo(215 + sp.driftLim / dmax * 170, 250); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#cfd6e2'; g.fillText(`${kN(vmax)}`, 120, 248); g.fillText(`허용 ${(sp.driftLim * 100).toFixed(1)}%`, 300, 30); }
  }
  function sideMem() {
    if (st.sel == null) { side.append(h('div', { class: 'note' }, '3D에서 부재를 클릭하거나 목록에서 고르세요.')); return; }
    const d = C.D[st.sel]; const m = C.res.M.members[st.sel]; const el = m.el;
    side.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('div', {}, h('div', { class: 't' }, `${m.r.level.name} · ${el.tag || d.type}`), h('div', { class: 'note' }, `${d.type} · 길이 ${(m.L / 1000).toFixed(2)} m · ${m.r.sheet.name}`)),
      h('div', { style: { textAlign: 'right' } }, h('div', { style: { fontSize: '22px', fontWeight: 700, color: css(ratioColor(d.ratio)) } }, d.ratio.toFixed(2)), pill(d.ratio <= 1, d.ratio <= 1 ? '적합' : 'NG'))));
    side.append(h('div', { class: 'note', style: { margin: '4px 0 8px' } }, `지배: ${d.gov} · ${d.combo || ''}`));
    side.append(h('div', { class: 'tbl' }, table([{ label: '항목', render: r => r[0] }, { label: '값', render: r => r[1] }, { label: '', num: true, render: r => typeof r[2] === 'number' ? h('b', { style: { color: css(ratioColor(r[2])) } }, r[2].toFixed(2)) : (r[2] ? h('span', { class: 'note' }, r[2]) : '') }], d.rows)));
    // 단면력도 (조합 선택)
    const lc = st.lc === 'env' ? (C.res.combos.find(c => c.name === d.combo)?.id || C.res.combos[1].id) : st.lc; const keep = st.lc; st.lc = lc; const f = forcesFor(st.sel); st.lc = keep;
    const comps = m.kind === 'beam' ? [['My', 'M (kN·m)', 1e6], ['Vz', 'V (kN)', 1e3]] : m.kind === 'wall' ? [['Mz', 'M 면내 (kN·m)', 1e6], ['Vy', 'V 면내 (kN)', 1e3], ['N', 'N (kN)', 1e3]] : [['My', 'My (kN·m)', 1e6], ['Mz', 'Mz (kN·m)', 1e6], ['N', 'N (kN)', 1e3]];
    side.append(h('h4', { style: { margin: '12px 0 4px' } }, `단면력도 — ${lc} ${comboOf(lc)?.name || CASE_NAME[lc] || ''}`));
    for (const [k, lab, u] of comps) side.append(diagram(f, k, lab, u, m.kind === 'beam' && k === 'My'));
    side.append(h('div', { class: 'row', style: { gap: '6px', marginTop: '10px' } },
      h('button', { class: 'btn sm', onclick: () => { ctx.state.hi = { ids: [el.id], sheet: m.r.sheet.id, pts: [el.p || el.a], label: `구조 ${d.ratio.toFixed(2)} ${d.gov}` }; ctx.go('cad'); } }, '작도에서 보기'),
      h('button', { class: 'btn sm', onclick: () => { ctx.state.hi = { ids: [el.id], label: `구조 ${d.ratio.toFixed(2)} ${d.gov}` }; ctx.go('view3d'); } }, '3D에서 보기'),
      d.ratio > 1 ? h('button', { class: 'btn sm', onclick: () => raiseIssue(d, m) }, '이슈 등록') : null));
    const kind = m.kind === 'wall' ? 'wall' : m.kind; if (m.mat !== 'STEEL' && RB_FIELDS[kind]) side.append(h('div', { class: 'row', style: { gap: '6px', marginTop: '8px' } }, h('button', { class: 'btn sm primary', onclick: () => editRebar(st.sel) }, d.provided ? '배근 수정' : '배근 입력'), d.auto ? h('button', { class: 'btn sm', onclick: () => applyAuto([st.sel]) }, '필요 철근으로 배근') : null));
    const xs = (C.X || []).filter(x => x.mi === st.sel && x.lv !== '확인'); if (xs.length) side.append(h('h4', { style: { margin: '12px 0 4px' } }, '시공 체크'), ...xs.map(siteCard));
    const js = (C.J || []).filter(j => j.mi === st.sel); for (const j of js) side.append(h('h4', { style: { margin: '12px 0 4px' } }, `접합부 — ${j.end ? '끝단' : '시작단'} · ${j.type} `, pill(j.ratio <= 1, j.ratio.toFixed(2))), connTable(j));
    if (m.kind === 'beam') side.append(h('div', { class: 'row', style: { gap: '6px', marginTop: '8px', alignItems: 'center' } }, h('span', { class: 'note' }, '단부 접합'), sel([['', '강접 (모멘트)'], ['both', '양단 핀'], ['i', '시작단 핀'], ['j', '끝단 핀']], el.rel || '', v => { if (v) el.rel = v; else delete el.rel; ctx.touch(m.r.sheet.id); toast('단부 조건을 바꿨습니다 — 다시 해석하세요'); })));
  }
  function diagram(f, k, label, u, invert) {
    const W = 400, H = 110; const cv = h('canvas', { width: W, height: H, style: { width: '100%', background: '#0f1218', borderRadius: '6px', marginBottom: '4px' } }); const g = cv.getContext('2d');
    const L = f[f.length - 1].x || 1; const vmax = Math.max(1e-9, ...f.map(s => Math.abs(s[k]))); const y0 = H / 2, sy = (H / 2 - 16) / vmax * (invert ? -1 : 1); const X = (x) => 30 + x / L * (W - 60);
    g.strokeStyle = '#3a4456'; g.beginPath(); g.moveTo(X(0), y0); g.lineTo(X(L), y0); g.stroke();
    g.fillStyle = '#5ab0ff33'; g.strokeStyle = '#5ab0ff'; g.beginPath(); g.moveTo(X(f[0].x), y0); for (const s of f) g.lineTo(X(s.x), y0 + s[k] * sy); g.lineTo(X(f[f.length - 1].x), y0); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#cfd6e2'; g.font = '11px sans-serif'; g.fillText(label, 6, 13); let im = 0; f.forEach((s, i) => { if (Math.abs(s[k]) > Math.abs(f[im][k])) im = i; }); const s = f[im]; g.fillText((s[k] / u).toFixed(1), Math.min(W - 50, X(s.x) + 4), Math.max(12, Math.min(H - 4, y0 + s[k] * sy + (s[k] * sy > 0 ? 12 : -4))));
    for (const i of [0, f.length - 1]) { if (i === im) continue; const q = f[i]; if (Math.abs(q[k]) > vmax * 0.05) g.fillText((q[k] / u).toFixed(1), i ? X(q.x) - 34 : X(q.x) + 2, Math.max(12, Math.min(H - 4, y0 + q[k] * sy + (q[k] * sy > 0 ? 12 : -4)))); }
    return cv;
  }
  function raiseIssue(d, m) {
    P.issues ||= []; const no = (P.issues.reduce((a, i) => Math.max(a, i.no || 0), 0)) + 1;
    P.issues.push({ id: 'i' + Date.now().toString(36), no, type: '구조', title: `${m.r.level.name} ${m.el.tag || d.type} 검토비 ${d.ratio.toFixed(2)} (${d.gov})`, desc: `${d.type} · ${d.combo}\n` + d.rows.map(r => `${r[0]}: ${r[1]}`).join('\n'), status: '열림', assignee: '', due: '', created: Date.now(), refs: [m.el.id], comments: [] });
    ctx.touch('meta'); toast(`이슈 #${no} 등록`, 'ok');
  }
  function redesign(list) { const S = C.S; for (const mi of list) C.D[mi] = designMember(C.res, mi, S); C.F = designFoundations(C.res, S); C.X = constructionChecks(C.res, C.D, S); P.struct.last = { ...P.struct.last, ng: C.D.filter(d => d.ratio > 1).length, max: Math.max(...C.D.map(d => d.ratio)) }; ctx.touch('meta'); renderSide(); draw(); }
  async function editRebar(mi) {
    const m = C.res.M.members[mi], el = m.el; const kind = m.kind; const cur = specOf(P, el) || {}; const F = RB_FIELDS[kind];
    const v = await dialog({ title: `배근 — ${m.r.level.name} ${el.tag || ''}`, body: '<div class="note">이 부재에만 적용됩니다 (물량 산출의 철근 가공표에도 반영). 비우면 일람표·철근비 기준으로 돌아갑니다.</div>', fields: F.map(([k, l, t]) => ({ key: k, label: l, type: t === 'num' ? 'number' : 'text', value: cur[k] ?? '' })) });
    if (!v) return; const any = Object.values(v).some(x => x !== '' && x != null); if (any) el.rebar = { ...(el.rebar || {}), ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '' && x != null)) }; else delete el.rebar;
    ctx.touch(m.r.sheet.id); redesign([mi]);
  }
  function applyAuto(list) { const sheets = new Set(); let n = 0; for (const mi of list) { const d = C.D[mi]; const m = C.res.M.members[mi]; if (!d.auto || m.mat === 'STEEL') continue; m.el.rebar = { ...d.auto, cover: m.kind === 'wall' ? 30 : 40 }; sheets.add(m.r.sheet.id); n++; } if (n) ctx.touch([...sheets]); redesign(list); toast(`${n}개 부재에 배근을 넣었습니다`, 'ok'); }
  async function autoRebar() {
    const v = await dialog({ title: '자동 배근', body: '<div class="note">해석 결과의 필요 철근량으로 RC 보(상·하부근·늑근)·기둥(주근)·벽(수직·수평근)의 배근을 만들어 부재에 넣고 실배근으로 다시 검토합니다. 철골 부재는 제외합니다.</div>', fields: [{ key: 'scope', label: '대상', type: 'select', options: [['empty', '배근이 없는 부재만'], ['ng', 'NG 부재만'], ['all', '모든 RC 부재 (기존 배근 덮어쓰기)']], value: 'empty' }], ok: '배근 생성' });
    if (!v) return; const list = C.D.map((d, i) => i).filter(i => { const d = C.D[i]; return v.scope === 'all' || (v.scope === 'ng' ? d.ratio > 1 : !d.provided); }); applyAuto(list);
  }
  async function editCombos() {
    const cur = P.struct.combos?.length ? P.struct.combos.join('\n') : C.res.combos.map(c => c.name.replace(/−/g, '-')).join('\n');
    const v = await dialog({ title: '하중조합', wide: true, body: `<div class="note">한 줄에 하나씩. 사용 가능한 하중: ${C.res.cases.join(', ')} (예: 1.2D+1.0L-1.0RX). 비우면 KDS 기본 조합을 자동 생성합니다.</div>`, fields: [{ key: 't', label: '조합', type: 'textarea', rows: 14, value: cur }], ok: '저장 후 재검토' });
    if (!v) return; const lines = v.t.split('\n').map(x => x.trim()).filter(Boolean); P.struct.combos = lines.length ? lines : null; ctx.touch('meta'); run();
  }
  function sideModal() {
    const MD = C.res.info.modal; const sp = C.res.info.seis; const last = MD.modes[MD.modes.length - 1].cum;
    side.append(h('div', { class: 'note', style: { marginBottom: '6px' } }, `강막 층 집중질량(병진 2 + 회전 1)으로 고유치 해석. 누적 질량참여 X ${(last.X * 100).toFixed(1)}% · Y ${(last.Y * 100).toFixed(1)}% · RZ ${(last.RZ * 100).toFixed(1)}% (기준 90%)`));
    side.append(h('div', { class: 'tbl' }, table([{ label: '모드', render: m => MD.modes.indexOf(m) + 1 }, { label: 'T (s)', num: true, render: m => m.T.toFixed(3) }, { label: 'X %', num: true, render: m => (m.ratio.X * 100).toFixed(1) }, { label: 'Y %', num: true, render: m => (m.ratio.Y * 100).toFixed(1) }, { label: 'RZ %', num: true, render: m => (m.ratio.RZ * 100).toFixed(1) }, { label: '누적 X/Y', num: true, render: m => `${(m.cum.X * 100).toFixed(0)}/${(m.cum.Y * 100).toFixed(0)}` }, { label: 'Sa/g (설계)', num: true, render: m => (m.SaX ?? 0).toFixed(4) }], MD.modes, { onRow: m => { st.view = 'mode'; st.mode = MD.modes.indexOf(m); renderTB(); draw(); } })));
    if (sp.RSX) side.append(h('h4', { style: { margin: '14px 0 4px' } }, '응답스펙트럼 밑면전단력 (KDS: 등가정적의 85% 이상)'), h('div', { class: 'tbl' }, table([{ label: '방향', key: 'd' }, { label: 'V 응답스펙트럼', num: true, key: 'a' }, { label: '0.85 V 정적', num: true, key: 'b' }, { label: '보정계수', num: true, key: 'c' }], ['X', 'Y'].map(d => ({ d, a: kN(sp['RS' + d].Vrs) + ' kN', b: kN(0.85 * sp['RS' + d].Vst) + ' kN', c: sp['RS' + d].scale.toFixed(3) })))));
    // 설계 스펙트럼 그래프
    const cv = h('canvas', { width: 400, height: 200, style: { width: '100%', marginTop: '10px', background: '#0f1218', borderRadius: '6px' } }); side.append(h('h4', { style: { margin: '12px 0 4px' } }, '설계 응답스펙트럼 Sa (g)'), cv); const g = cv.getContext('2d'); const X = (T) => 30 + T / 6 * 360, Y = (a) => 180 - a / (sp.SDS * 1.1) * 160;
    g.strokeStyle = '#3a4456'; g.beginPath(); g.moveTo(30, 180); g.lineTo(390, 180); g.moveTo(30, 20); g.lineTo(30, 180); g.stroke(); g.strokeStyle = '#5ab0ff'; g.beginPath(); for (let i = 0; i <= 300; i++) { const T = i / 50; const T0 = 0.2 * sp.SD1 / sp.SDS, Ts = sp.SD1 / sp.SDS; const a = T < T0 ? sp.SDS * (0.4 + 0.6 * T / T0) : T <= Ts ? sp.SDS : T <= 5 ? sp.SD1 / T : sp.SD1 * 5 / T / T; g.lineTo(X(T), Y(a)); } g.stroke();
    g.fillStyle = '#ff9f1c'; for (const m of MD.modes.slice(0, 6)) { const a = (m.SaX ?? 0) * sp.R / sp.Ie; g.beginPath(); g.arc(X(Math.min(6, m.T)), Y(a), 3, 0, 7); g.fill(); } g.fillStyle = '#cfd6e2'; g.font = '11px sans-serif'; g.fillText(`SDS ${sp.SDS.toFixed(3)}`, 36, 30); g.fillText('T (s) →', 340, 196); g.fillText('6', 384, 194);
  }
  const connTable = (j) => h('div', { class: 'tbl' }, table([{ label: '항목', render: r => r[0] }, { label: '값', render: r => r[1] }, { label: '', num: true, render: r => typeof r[2] === 'number' ? h('b', { style: { color: css(ratioColor(r[2])) } }, r[2].toFixed(2)) : '' }], j.rows));
  function sideConn() {
    const J = C.J || []; const by = {}; for (const j of J) { const k = `${j.kind} · ${j.type}`; (by[k] ||= { n: 0, ng: 0, max: 0, add: 0 }); by[k].n++; if (j.ratio > 1) by[k].ng++; by[k].max = Math.max(by[k].max, j.ratio); if (j.items.some(x => /스티프너|보강판/.test(x))) by[k].add++; }
    side.append(h('div', { class: 'note', style: { marginBottom: '6px', lineHeight: 1.6 } }, '철골 보 양단마다 지지 부재와 단부 조건(핀/강접)으로 접합 형식을 정하고, 볼트(F10T 마찰접합)·연결판(SM355)·용접(E49)·스티프너·패널존 보강판을 자동 산정합니다. 설계력은 해석 단부력의 전 조합 최대값입니다.'));
    side.append(h('div', { class: 'tbl' }, table([{ label: '지지 · 형식', key: 'k' }, { label: '개수', key: 'n', num: true }, { label: '보강', key: 'add', num: true }, { label: 'NG', key: 'ng', num: true }, { label: '최대비', key: 'max', num: true }], Object.entries(by).map(([k, v]) => ({ k, n: v.n, add: v.add || '-', ng: v.ng || '-', max: v.max.toFixed(2) })))));
    const list = [...J].sort((a, b) => b.ratio - a.ratio).slice(0, 300);
    side.append(h('h4', { style: { margin: '14px 0 4px' } }, `접합부 목록 (검토비 순, ${J.length}개)`), h('div', { class: 'tbl' }, table([{ label: '층', key: 'level' }, { label: '보', render: j => `${j.tag}`.slice(0, 14) + (j.end ? ' (끝)' : ' (시작)') }, { label: '지지', key: 'kind' }, { label: '구성', render: j => h('span', { style: { fontSize: '11.5px' } }, j.items.join(' · ')) }, { label: '비', num: true, render: j => h('b', { style: { color: css(ratioColor(j.ratio)) } }, j.ratio.toFixed(2)) }], list, { onRow: j => select(j.mi) })));
  }
  const LVC = { 위험: '#ff4d4f', 경고: '#ff9f1c', 확인: '#4cc38a' };
  function siteCard(x) {
    return h('div', { class: 'card', style: { marginBottom: '6px', borderLeft: `3px solid ${LVC[x.lv]}`, cursor: x.mi != null ? 'pointer' : 'default' }, onclick: () => { if (x.mi != null && st.tab !== 'mem') select(x.mi); } },
      h('div', { class: 'row', style: { gap: '6px', alignItems: 'center' } }, h('span', { class: 'pill', style: { background: LVC[x.lv] + '33', color: LVC[x.lv] } }, x.lv), h('span', { class: 'note' }, x.cat), h('b', { style: { fontSize: '12.5px' } }, x.title)),
      h('div', { class: 'note', style: { fontSize: '12px', marginTop: '3px' } }, x.detail), h('div', { style: { fontSize: '12px', marginTop: '2px' } }, '→ ' + x.act));
  }
  function sideSite() {
    const X = C.X || []; const cnt = (lv) => X.filter(x => x.lv === lv).length; const f = st.siteLv || 'all';
    side.append(h('div', { class: 'note', style: { marginBottom: '6px', lineHeight: 1.6 } }, '해석·설계 결과에서 시공 중 문제가 될 항목을 자동으로 찾습니다 — 철근 정착·이음·배치(KDS 14 20 52), 철골 보 콘크리트 타설 중 처짐·강도·캠버, 거푸집·동바리(KDS 21 50 00), 강도차 타설, 레벨 보정. 위험: 설계 변경 필요 · 경고: 시공 조치 필요 · 확인: 시공 시 반영할 값.'),
      h('div', { class: 'row', style: { gap: '4px', marginBottom: '8px', flexWrap: 'wrap' } }, ...[['all', `전체 ${X.length}`], ['위험', `위험 ${cnt('위험')}`], ['경고', `경고 ${cnt('경고')}`], ['확인', `확인 ${cnt('확인')}`]].map(([k, l]) => h('button', { class: 'btn sm' + (f === k ? ' primary' : ''), onclick: () => { st.siteLv = k; renderSide(); } }, l)),
        h('span', { style: { flex: 1 } }), h('button', { class: 'btn sm', title: '위험·경고 항목을 이슈(품질·안전)로 등록 — 이미 등록된 항목은 건너뜀', onclick: siteIssues }, '이슈로 등록'), h('button', { class: 'btn sm', onclick: siteXLSX }, 'Excel')));
    const list = X.filter(x => f === 'all' || x.lv === f); if (!list.length) side.append(h('div', { class: 'note' }, '항목이 없습니다.'));
    for (const x of list.slice(0, 300)) side.append(siteCard(x));
  }
  function siteIssues() {
    P.issues ||= []; let n = 0; const M = C.res.M.members;
    for (const x of (C.X || []).filter(x => x.lv !== '확인')) { const src = `struct-site:${x.cat}:${x.title}`; if (P.issues.some(i => i.src === src)) continue; const no = P.issues.reduce((a, i) => Math.max(a, i.no || 0), 0) + 1; const m = x.mi != null ? M[x.mi] : null;
      P.issues.push({ id: 'i' + Date.now().toString(36) + n, no, type: /철골|거푸집|타설/.test(x.cat) ? '안전' : '품질', title: `[${x.lv}] ${x.title}`, desc: `${x.cat}\n${x.detail}\n조치: ${x.act}`, status: '열림', assignee: '', due: '', created: Date.now(), refs: m ? [m.el.id] : null, src, comments: [] }); n++; }
    if (n) ctx.touch('meta'); toast(n ? `이슈 ${n}건 등록` : '새로 등록할 항목이 없습니다', n ? 'ok' : undefined);
  }
  async function siteXLSX() { const { writeBook } = await import('../js/excel.js'); const M = C.res.M.members; saveFile(`${P.name.replace(/[\\/:*?"<>|]/g, '_')}_시공체크.xlsx`, await writeBook([{ name: '시공 체크', rows: [['등급', '분류', '층', '부재', '항목', '내용', '조치'], ...(C.X || []).map(x => { const m = x.mi != null ? M[x.mi] : null; return [x.lv, x.cat, m?.r.level.name || '', m?.el.tag || '', x.title, x.detail, x.act]; })], widths: [6, 10, 6, 12, 40, 70, 60] }])); }
  function sideFound() {
    const F = C.F || []; const S = C.S;
    side.append(h('div', { class: 'note', style: { marginBottom: '6px', lineHeight: 1.6 } }, `지점 반력(D+L 사용하중)으로 지내력, 1.2D+1.6L로 펀칭·1방향 전단·휨을 검토합니다. ${S.qa ? `qa = ${S.qa} kPa (입력)` : '허용지내력 미입력 — 기초별 필요 지내력을 표시합니다. 지반조사 값을 현장·용도 조건에 입력하세요.'} · 기초 fck ${S.fckF} MPa`));
    if (!F.length) return side.append(h('div', { class: 'note' }, '기초 객체가 없습니다.'));
    side.append(h('div', { class: 'tbl' }, table([{ label: '기초', render: x => h('span', { style: { whiteSpace: 'nowrap' } }, `${x.kind.replace('기초', '').replace(' 없음', '없음')} ${String(x.tag || '').slice(0, 10)}`) }, { label: '크기', render: x => h('span', { style: { whiteSpace: 'nowrap', fontSize: '11.5px' } }, x.size) }, { label: 'Ps kN', num: true, render: x => kN(x.Ps) }, { label: 'q / qa', num: true, render: x => x.q ? (x.qa == null ? h('span', { style: { color: '#ff9f1c' }, title: '허용지내력 미입력 — 이 값 이상이 필요' }, `필요 ≥${(x.q * 1e3).toFixed(0)}`) : h('span', { style: { color: css(ratioColor(x.rq)) } }, `${(x.q * 1e3).toFixed(0)}/${(x.qa * 1e3).toFixed(0)}`)) : '-' }, { label: '펀칭', num: true, render: x => x.rp != null ? h('span', { style: { color: css(ratioColor(x.rp)) } }, x.rp.toFixed(2)) : '-' }, { label: '전단', num: true, render: x => x.rv ? x.rv.toFixed(2) : '-' }, { label: '휨', num: true, render: x => x.rm != null ? x.rm.toFixed(2) : x.AsR ? h('span', { class: 'note', title: '배근 미입력' }, `As ${Math.round(x.AsR / 1e3)}k`) : '-' }, { label: '판정', render: x => x.ratio == null ? h('span', { class: 'pill warn' }, '기초 없음') : pill(x.ratio <= 1, x.ratio.toFixed(2)) }], F, { onRow: x => { if (x.el) { ctx.state.hi = { ids: [x.el.id], sheet: x.r?.sheet.id, pts: [x.el.p || x.el.pts?.[0] || x.el.a], label: `기초 ${x.kind}` }; ctx.go('cad'); } } })));
    const ng = F.filter(x => x.ratio > 1); if (ng.some(x => x.rq > 1)) side.append(h('div', { class: 'note', style: { marginTop: '8px', color: '#ff9f1c' } }, '지내력 초과 — 기초 확대, 말뚝기초 또는 지반 개량을 검토하세요.'));
  }
  // ---------- 출력 ----------
  async function exportXLSX() {
    const { writeBook } = await import('../js/excel.js'); const M = C.res.M.members; const sp = C.res.info.seis;
    const mem = [['층', '부재', '종류', '단면', '길이(m)', '검토비', '판정', '지배', '조합', '필요 철근비(%)', '상세'], ...C.D.map(d => { const m = M[d.mi]; return [m.r.level.name, m.el.tag || '', d.type, d.rows[0][1], +(m.L / 1000).toFixed(2), +d.ratio.toFixed(3), d.ratio <= 1 ? 'OK' : 'NG', d.gov, d.combo || '', d.rhoReq != null && isFinite(d.rhoReq) ? +(d.rhoReq * 100).toFixed(2) : '', d.rows.slice(1).map(r => `${r[0]} ${r[1]}`).join(' / ')]; })];
    const sto = [['층', '높이(m)', 'W(kN)', ...(sp ? ['Fx(kN)', 'Fy(kN)', 'Δ/h Ex(%)', 'Δ/h Ey(%)', '비틀림비'] : []), 'Wx(kN)', 'Wy(kN)', 'Δ/h Wx(%)', 'Δ/h Wy(%)'], ...C.res.story.slice().reverse().map(f => [C.res.M.lv.find(l => l.elev === f.z)?.name || '', +(f.z / 1000).toFixed(2), +kN(f.W), ...(sp ? [+kN(f.EX || 0), +kN(f.EY || 0), +((f.drEX || 0) * sp.Cd / sp.Ie * 100).toFixed(4), +((f.drEY || 0) * sp.Cd / sp.Ie * 100).toFixed(4), +Math.max(f.torEX || 1, f.torEY || 1).toFixed(2)] : []), +kN(f.WX || 0), +kN(f.WY || 0), +((f.drWX || 0) * 100).toFixed(4), +((f.drWY || 0) * 100).toFixed(4)])];
    const cmb = [['ID', '조합', ...C.res.cases], ...C.res.combos.map(c => [c.id, c.name, ...C.res.cases.map(k => c.f[k] ?? '')])];
    const jn = [['층', '보', '단부', '지지', '형식', 'Vu(kN)', 'Mu(kN·m)', '검토비', '판정', '구성', '상세'], ...(C.J || []).map(j => [j.level, j.tag, j.end ? '끝' : '시작', j.kind, j.type, +(j.V / 1e3).toFixed(1), +(j.Mu / 1e6).toFixed(1), +j.ratio.toFixed(3), j.ratio <= 1 ? 'OK' : 'NG', j.items.join(' · '), j.rows.map(r => `${r[0]} ${r[1]}`).join(' / ')])];
    saveFile(`${P.name.replace(/[\\/:*?"<>|]/g, '_')}_구조검토.xlsx`, await writeBook([{ name: '부재검토', rows: mem, widths: [8, 22, 10, 26, 8, 8, 6, 10, 18, 10, 80] }, { name: '층별', rows: sto }, { name: '하중조합', rows: cmb }, ...((C.J || []).length ? [{ name: '접합부', rows: jn, widths: [8, 16, 6, 10, 28, 9, 9, 8, 6, 30, 90] }] : [])]));
  }
  function exportHTML() {
    const { res, D, S } = C; const I = res.info, sp = I.seis; const M = res.M.members; const ng = D.filter(d => d.ratio > 1);
    const drift = sp ? maxDrift(res) : null;
    const T = (head, rows) => `<table><tr>${head.map(x => `<th>${x}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
    const by = {}; for (const d of D) { (by[d.type] ||= { n: 0, ng: 0, max: 0 }); by[d.type].n++; if (d.ratio > 1) by[d.type].ng++; by[d.type].max = Math.max(by[d.type].max, d.ratio); }
    const worst = [...D].sort((a, b) => b.ratio - a.ratio).slice(0, 40);
    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>구조계산서 — ${esc(P.name)}</title><style>body{font-family:'Malgun Gothic',sans-serif;max-width:900px;margin:24px auto;color:#111;font-size:13px;line-height:1.55}h1{font-size:22px}h2{font-size:16px;border-bottom:2px solid #223;padding-bottom:3px;margin-top:26px}h3{font-size:14px;margin:14px 0 4px}table{border-collapse:collapse;width:100%;margin:6px 0 12px}th,td{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top}th{background:#eef0f3}.ng{color:#c00;font-weight:700}.ok{color:#080;font-weight:700}.n{color:#666;font-size:12px}@media print{h2{page-break-after:avoid}}</style></head><body>
<h1>구조계산서</h1><p>${esc(P.name)} · ${esc(P.site?.address || '')} · ${new Date().toLocaleDateString('ko-KR')} · 빌더 구조해석</p>
<h2>1. 개요 및 결론</h2>${T(['항목', '결과'], [['부재 검토', `${D.length - ng.length}/${D.length} 적합 ${ng.length ? `<span class="ng">NG ${ng.length}개</span>` : '<span class="ok">전 부재 적합</span>'}`], ['최대 검토비', Math.max(...D.map(d => d.ratio)).toFixed(3)], ...(sp ? [['최대 층간변위비 (지진)', `${(drift * 100).toFixed(3)}% — 허용 ${(sp.driftLim * 100).toFixed(1)}% <span class="${drift <= sp.driftLim ? 'ok' : 'ng'}">${drift <= sp.driftLim ? 'OK' : 'NG'}</span>`], ['밑면전단력', `X ${kN(sp.X.V)} kN · Y ${kN(sp.Y.V)} kN`]] : []), ['건물 중량', `${kN(I.Wt)} kN`], ['평형 검증', `고정하중 ${kN(I.check.D.applied)} kN = 반력 ${kN(I.check.D.reac)} kN`]])}
<h2>2. 설계 조건 (현장 입력 · 툴 산정)</h2>${C.auto ? T(['구분', '항목', '값', '근거'], C.auto.map(r => [r.cat, esc(r.k), esc(r.v), esc(r.why)])) : ''}<h3>기준·재료 요약</h3>${T(['항목', '내용'], [['기준', 'KDS 41 10 15 (설계하중), KDS 41 17 00 (내진), KDS 14 20 (콘크리트), KDS 14 31 (강구조)'], ['콘크리트', `fck ${S.fck} MPa (보·슬래브)${S.fckV ? `, ${S.fckV} MPa (기둥·벽)` : ''}`], ['철근 / 강재', `fy ${S.fy} MPa / Fy ${S.Fy} MPa`], ['세장효과·횡비틀림', '기둥: 층 안정지수 Q로 횡이동 판정, 접합부 강성비 ψ로 k 산정, 모멘트 확대(RC δns·δs, 철골 B1·B2). 철골 보: 슬래브 구속 여부·모멘트도로 비지지길이 Lb·Cb 산정'], ['강성', `균열단면 보 ${S.crack.beam}Ig, 기둥 ${S.crack.col}Ig, 벽 ${S.crack.wall}Ig, 전단변형 고려`], ['해석', `3차원 골조 선형정적${I.cs ? `, 고정하중 시공단계 해석(${I.cs.G}단계 순차 재하·레벨 보정)` : ''}, 층 강막 가정, 절점 ${res.M.nodes.filter(n => n.used).length} · 요소 ${res.M.elems.length} · 자유도 ${I.dof}`]])}
<h2>3. 하중</h2>${T(['하중', '값'], [['고정하중', `부재 자중(RC 24, 강재 77 kN/m³) + 슬래브 자중 + 마감·설비 ${S.SDL} kN/m² + 비구조벽`], ['활하중', `${S.use} ${USES[S.use]} kN/m², 지붕 ${S.LLroof} kN/m²`], ['풍하중', S.wind.on ? `V0 ${S.wind.V0} m/s, 노풍도 ${S.wind.exp}, Gf ${S.wind.Gf}, Cf ${S.wind.Cf} (약식)` : '미적용'], ['지진하중', sp ? `S ${sp.S.toFixed(3)} (Z ${S.seis.Z}×I ${S.seis.I}), 지반 ${S.seis.site}, SDS ${sp.SDS.toFixed(3)}, SD1 ${sp.SD1.toFixed(3)}, ${esc(sp.sysName)} R ${sp.R} Cd ${sp.Cd}, Ie ${sp.Ie}, Ta ${sp.Ta.toFixed(2)}s, 레일리 T ${sp.Tray.X.toFixed(2)}/${sp.Tray.Y.toFixed(2)}s → 적용 ${sp.T.X.toFixed(2)}/${sp.T.Y.toFixed(2)}s, Cs ${sp.X.Cs.toFixed(4)}, 우발편심 5%` : '미적용']])}
<h3>하중조합 (강도설계)</h3>${T(['ID', '조합'], res.combos.map(c => [c.id, c.name]))}
<h2>4. 층별 결과</h2>${T(['층', 'W (kN)', ...(sp ? ['Fx (kN)', 'Δ/h Ex', 'Δ/h Ey', '비틀림비'] : []), ...(res.cases.includes('WX') ? ['Wx (kN)', 'Δ/h Wx'] : [])], res.story.slice().reverse().map(f => [res.M.lv.find(l => l.elev === f.z)?.name || '', kN(f.W), ...(sp ? [kN(f.EX || 0), `${((f.drEX || 0) * sp.Cd / sp.Ie * 100).toFixed(3)}%`, `${((f.drEY || 0) * sp.Cd / sp.Ie * 100).toFixed(3)}%`, Math.max(f.torEX || 1, f.torEY || 1).toFixed(2)] : []), ...(res.cases.includes('WX') ? [kN(f.WX || 0), `${((f.drWX || 0) * 100).toFixed(3)}%`] : [])]))}
<h2>5. 부재 검토 요약</h2>${T(['종류', '개수', 'NG', '최대 검토비'], Object.entries(by).map(([k, v]) => [k, v.n, v.ng ? `<span class="ng">${v.ng}</span>` : '-', v.max.toFixed(3)]))}
<h3>검토비 상위 ${worst.length}개</h3>${T(['층', '부재', '종류', '단면', '검토비', '지배', '조합'], worst.map(d => { const m = M[d.mi]; return [m.r.level.name, esc(m.el.tag || ''), d.type, esc(d.rows[0][1]), `<span class="${d.ratio > 1 ? 'ng' : 'ok'}">${d.ratio.toFixed(3)}</span>`, d.gov, esc(d.combo || '')]; }))}
<h2>6. 상세 검토 (상위 10개)</h2>${worst.slice(0, 10).map(d => { const m = M[d.mi]; return `<h3>${m.r.level.name} ${esc(m.el.tag || '')} — ${d.type} 검토비 ${d.ratio.toFixed(3)}</h3>${T(['항목', '값', ''], d.rows.map(r => [esc(r[0]), esc(r[1]), typeof r[2] === 'number' ? r[2].toFixed(3) : esc(r[2] || '')]))}`; }).join('')}
${I.modal ? `<h2>7. 고유치·응답스펙트럼</h2>${T(['모드', 'T (s)', 'X %', 'Y %', 'RZ %', '누적 X', '누적 Y'], I.modal.modes.map((m, i) => [i + 1, m.T.toFixed(3), (m.ratio.X * 100).toFixed(1), (m.ratio.Y * 100).toFixed(1), (m.ratio.RZ * 100).toFixed(1), (m.cum.X * 100).toFixed(1), (m.cum.Y * 100).toFixed(1)]))}${sp.RSX ? T(['방향', 'V 응답스펙트럼 (kN)', 'V 등가정적 (kN)', '보정계수 (85%)'], ['X', 'Y'].map(d => [d, kN(sp['RS' + d].Vrs), kN(sp['RS' + d].Vst), sp['RS' + d].scale.toFixed(3)])) : ''}<p class="n">CQC 조합(감쇠 5%), 우발비틀림 정적 편심 5% 추가${I.pdelta ? ', P-Δ 기하강성 반영 (1.2D+1.0L)' : ''}.</p>` : ''}
<h2>8. 기초</h2>${(C.F || []).length ? T(['종류', '부재', '크기', 'Ps (kN)', 'q / qa (kPa)', '펀칭', '1방향 전단', '휨(실배근)', '판정'], C.F.map(x => [x.kind, esc(x.tag || ''), x.size, kN(x.Ps), x.q ? (x.qa == null ? `필요 ≥ ${(x.q * 1e3).toFixed(0)}` : `${(x.q * 1e3).toFixed(0)} / ${(x.qa * 1e3).toFixed(0)}`) : '-', x.rp != null ? x.rp.toFixed(3) : '-', x.rv ? x.rv.toFixed(3) : '-', x.rm != null ? x.rm.toFixed(3) : '-', x.ratio == null ? '기초 없음' : `<span class="${x.ratio > 1 ? 'ng' : 'ok'}">${x.ratio.toFixed(3)}</span>`])) : '<p>기초 객체 없음</p>'}
${(C.J || []).length ? (() => { const J = C.J; const by = {}; for (const j of J) { const k = `${j.kind} — ${j.type}`; (by[k] ||= { n: 0, ng: 0, max: 0 }); by[k].n++; if (j.ratio > 1) by[k].ng++; by[k].max = Math.max(by[k].max, j.ratio); } const top = [...J].sort((a, b) => b.ratio - a.ratio).slice(0, 8);
  return `<h2>9. 철골 접합부</h2><p class="n">F10T 고력볼트 마찰접합(미끄럼계수 0.5, 표준구멍), 연결판 SM355, 용접봉 E49. 전단판은 탄성법으로 볼트군 편심을 고려하고, 강접은 플랜지력 Ff = Mu/(d−tf)로 기둥 플랜지 휨·웨브 항복·크리플링과 패널존 전단을 검토합니다.</p>${T(['지지 — 형식', '개수', 'NG', '최대 검토비'], Object.entries(by).map(([k, v]) => [esc(k), v.n, v.ng ? `<span class="ng">${v.ng}</span>` : '-', v.max.toFixed(3)]))}${top.map(j => `<h3>${j.level} ${esc(j.tag)} (${j.end ? '끝단' : '시작단'}) — ${esc(j.type)} 검토비 ${j.ratio.toFixed(3)}</h3>${T(['항목', '값', ''], j.rows.map(r => [esc(r[0]), esc(r[1]), typeof r[2] === 'number' ? r[2].toFixed(3) : '']))}`).join('')}`; })() : ''}
${C.push?.tgt ? (() => { const o = C.push; const r = (k) => { const t = o.tgt[k], a = t.at; return [k === 'DE' ? '설계지진 (인명안전)' : 'MCE ×1.5 (붕괴방지)', `${t.dt.toFixed(1)} mm`, a?.reached ? `${a.V.toFixed(0)} kN` : '-', a?.reached ? `${(a.drift * 100).toFixed(2)}%` : '도달 전 파괴', a?.reached ? a.cnt.join(' / ') : '-']; };
  return `<h2>${(C.J || []).length ? 10 : 9}. 비선형 정적해석 (푸시오버, ${o.dir}${o.sign > 0 ? '+' : '−'})</h2><p class="n">중력 1.0D+0.25L 후 등가정적 분포 수평력, 부재 양단 소성힌지(기대강도 — 철근 1.2fy·콘크리트 1.1fck·강재 1.1Fy, 탄성-완전소성), 전단강도 도달 시 취성 파괴로 종료. 목표변위는 변위계수법, 회전 한계는 ASCE 41 대표값(단순화). 종료: ${esc(o.why || '')}</p>${T(['항목', '값'], [['초기 강성', `${o.Ki.toFixed(1)} kN/mm`], ['항복 밑면전단 Vy (이선형)', `${o.Vy.toFixed(0)} kN (Vy/W ${(o.Vy / (I.Wt / 1e3)).toFixed(3)})`], ['최대 밑면전단', `${o.Vmax.toFixed(0)} kN`], ['유효주기 Te', `${o.tgt.Te.toFixed(2)} s`]])}${T(['수준', '목표변위', '밑면전단', '최대 층간변위', '힌지 IO / LS / CP / 초과'], [r('DE'), r('MCE')])}`; })() : ''}
<h2>${(C.J || []).length ? (C.push?.tgt ? 11 : 10) : (C.push?.tgt ? 10 : 9)}. 한계</h2><p class="n">본 계산서는 모델 기반 약식 검토로, 등가정적 지진하중·약식 풍하중을 사용한 선형정적 해석입니다. 철골 보의 횡비틀림좌굴(슬래브 구속·모멘트도 기반 Lb·Cb)과 기둥 세장효과(층 안정지수 Q, ψ 기반 k, δns·δs / B1·B2)는 부재 검토에 반영했습니다. 철골 보 접합부(전단판·플랜지 용접·스티프너·패널존)를 자동 설계했으며, RC 매입 철판의 콘크리트 파괴와 철골 기둥 이음·주각은 포함하지 않습니다. ${I.cs ? '' : '시공단계 해석은 15층·50 m 미만이라 적용하지 않았고, '}${C.push ? '' : '비선형 정적해석(푸시오버)은 해당 화면에서 실행 시 포함되며, '}비선형 동적해석, 균열폭, 패턴 활하중, 시공 중 콘크리트 재령에 따른 강성 변화는 포함하지 않습니다(슬래브는 별도 판 해석 화면). 배근 미입력 부재는 필요 철근량(가정 철근비) 기준이며, 최종 설계는 구조기술사의 검토가 필요합니다.</p>
</body></html>`;
    saveFile(`${P.name.replace(/[\\/:*?"<>|]/g, '_')}_구조계산서.html`, html);
  }

  renderTB(); renderSide(); draw(true); resize();
  return { unmount() { sub?.leave?.(); cancelAnimationFrame(raf); ro.disconnect(); controls?.dispose(); renderer?.dispose(); renderer?.domElement.remove(); } };
}
