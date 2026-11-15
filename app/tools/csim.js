// 빌더 시공 시뮬레이션 — 착공~준공 하루 단위 3D 시공 현황, 가설·장비, 부재별 선행·체크리스트·후행, 실적 재계획, 지연 상황
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { h, toast, dialog, saveFile, table } from '../js/ui.js';
import { MATS, DISC, elName, levelOf } from '../js/model.js';
import { buildTasks, schedule, stateAt, progressAt, recoveryOptions, toD, toS, wdOf, CLIMATE, TRADES, elBoxes } from '../js/csim.js';

const COL = { steel: 0x5b8fd6, rebar: 0xd9473f, embed: 0xff9b2f, frame: 0xc9c3b4, form: 0x9a6b3f, pouring: 0xf2e08a, poured: 0x9aa6b2, curing: 0x8fb2c8, stripped: 0xbdbdb6, clad: 0xd9cdb4, wp: 0x3d7a58, coping: 0xbdbdb6, done: 0xc8c6c0 };
const LABEL = { steel: '철골', rebar: '철근 배근', embed: '매립(전선관·접지)', frame: '틀·프레임', form: '거푸집', pouring: '타설 중', poured: '타설 완료', curing: '양생', stripped: '탈형', clad: '외장 바탕', wp: '방수', coping: '두겁석', done: '완료' };
const WIRE = new Set(['rebar', 'embed']);

export function mount(root, ctx) {
  const P = ctx.P;
  P.csim ||= {}; const C = P.csim; C.start ||= P.sched?.start || new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10); C.week ||= 6; C.region ||= '서울'; C.actual ||= {}; C.events ||= []; C.checks ||= {};
  let G = null, S = null, day = 0, playing = false, speed = 1, sel = null, hiTask = null, tab = '3d', st = null;
  const save = () => ctx.touch('meta');
  const rebuild = () => { const t = performance.now(); G = buildTasks(P); reschedule(); console.log('csim build', G.T.length, Math.round(performance.now() - t) + 'ms'); };
  const reschedule = () => { S = schedule(P, G); if (!C.baseline) setBaseline(true); C.last = { fin: toS(S.fin), base: C.baseline?.fin, delay: C.baseline ? S.fin - toD(C.baseline.fin) : 0, tasks: S.T.length, issues: S.issues.length }; };
  function setBaseline(silent) { const B = schedule(P, G, { noActual: true, noEvents: true }); C.baseline = { at: new Date().toISOString(), fin: toS(B.fin), start: C.start, ef: Object.fromEntries([...B.R].map(([k, r]) => [k, r.ef])), es: Object.fromEntries([...B.R].map(([k, r]) => [k, r.es])) }; save(); if (!silent) toast('현재 계획을 기준 공정으로 저장했습니다', 'ok'); }

  // ---------- 레이아웃 ----------
  const tb = h('div', { class: 'row', style: { gap: '6px', padding: '8px 10px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap', alignItems: 'center' } });
  const body = h('div', { style: { display: 'flex', flex: 1, minHeight: 0 } });
  root.append(h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } }, tb, body));
  const holder = h('div', { style: { position: 'relative', flex: 1, minWidth: 0, background: '#a9c9e6' } });
  const side = h('div', { class: 'side', style: { width: '380px', maxWidth: '44vw', overflow: 'auto', padding: '10px 12px' } });
  const page = h('div', { style: { flex: 1, overflow: 'auto', padding: '12px 16px', display: 'none' } });
  body.append(holder, page, side);
  const bar = h('div', { style: { position: 'absolute', left: '10px', right: '10px', bottom: '10px', background: '#0f1218e6', border: '1px solid #2a3342', borderRadius: '10px', padding: '8px 10px', color: '#e6edf7', fontSize: '12.5px' } });
  const legend = h('div', { class: 'mono', style: { position: 'absolute', left: '10px', top: '10px', background: '#0f1218d9', border: '1px solid #2a3342', borderRadius: '8px', padding: '6px 8px', color: '#cfd6e2', fontSize: '11px', lineHeight: 1.6 } });
  const pop = h('div', { style: { position: 'absolute', right: '10px', top: '10px', width: '360px', maxHeight: 'calc(100% - 110px)', overflow: 'auto', background: '#0f1218f2', border: '1px solid #2a3342', borderRadius: '10px', padding: '10px 12px', color: '#e6edf7', fontSize: '12.5px', display: 'none' } });
  holder.append(bar, legend, pop);

  function renderTB() {
    tb.innerHTML = ''; const t = (k, l) => h('button', { class: 'btn' + (tab === k ? ' primary' : ''), onclick: () => { tab = k; showTab(); } }, l);
    const inp = (v, on, o = {}) => h('input', { value: v, style: { width: o.w || '120px' }, type: o.type || 'text', onchange: e => on(e.target.value) });
    tb.append(h('b', {}, '시공 시뮬레이션'), t('3d', '3D 시공 과정'), t('list', '공정표·실적'), t('delay', '현황·지연'), t('cover', '내역 반영'), h('span', { class: 'note' }, '|'),
      h('span', { class: 'note' }, '착공'), inp(C.start, v => { C.start = v; C.baseline = null; save(); rebuild(); day = 0; refresh(); }, { type: 'date', w: '140px' }),
      h('select', { onchange: e => { C.week = +e.target.value; save(); reschedule(); refresh(); } }, ...[[6, '주 6일'], [5, '주 5일']].map(([v, l]) => h('option', { value: v, selected: C.week === v }, l))),
      h('select', { onchange: e => { C.region = e.target.value; save(); reschedule(); refresh(); } }, ...Object.keys(CLIMATE).map(k => h('option', { value: k, selected: C.region === k }, `${k} 기후`))),
      h('label', { class: 'row', style: { gap: '4px', alignItems: 'center' } }, h('input', { type: 'checkbox', checked: C.climate !== false, onchange: e => { C.climate = e.target.checked; save(); reschedule(); refresh(); } }), '평년 우천 반영'),
      h('span', { style: { flex: 1 } }), h('button', { class: 'btn', onclick: () => { setBaseline(); reschedule(); refresh(); } }, '기준 공정 저장'), h('button', { class: 'btn', onclick: exportXLSX }, 'Excel'));
  }
  function showTab() { renderTB(); const is3d = tab === '3d'; holder.style.display = is3d ? '' : 'none'; side.style.display = is3d ? '' : 'none'; page.style.display = is3d ? 'none' : ''; if (is3d) { resize(); refresh(); } else renderPage(); }

  // ---------- 3D ----------
  let renderer; try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch (e) { holder.append(h('div', { style: { padding: '20px', color: '#fff' } }, 'WebGL을 사용할 수 없습니다.')); }
  const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 4000); let controls = null;
  if (renderer) { renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); holder.prepend(renderer.domElement); renderer.domElement.style.display = 'block'; controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49; }
  scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x6b7360, 1.1)); const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(60, 120, 40); scene.add(sun);
  scene.background = new THREE.Color(0xa9c9e6);
  const groundM = new THREE.MeshStandardMaterial({ color: 0x8a8f6a, roughness: 1 }); const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), groundM); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; scene.add(ground);
  const bx = P.base?.x || 0, by = P.base?.y || 0; const X = (x) => (x - bx) / 1000, Z = (y) => -(y - by) / 1000, Y = (z) => z / 1000;
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const solidM = new THREE.MeshStandardMaterial({ roughness: 0.85 }), glassM = new THREE.MeshStandardMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.4, roughness: 0.1 }), wireM = new THREE.MeshBasicMaterial({ wireframe: true }), formM = new THREE.MeshStandardMaterial({ color: COL.form, roughness: 0.9, transparent: true, opacity: 0.92 }), postM = new THREE.MeshStandardMaterial({ color: 0xe0b23a, roughness: 0.6 });
  let boxes = [], meshS, meshG, meshW, meshF, meshPost, elIndex = new Map(); const tempG = new THREE.Group(); scene.add(tempG); const hiG = new THREE.Group(); scene.add(hiG);
  const lvById = new Map(P.levels.map(l => [l.id, l]));
  function build3d() {
    for (const m of [meshS, meshG, meshW, meshF, meshPost]) if (m) { scene.remove(m); m.dispose?.(); }
    boxes = []; elIndex = new Map(); const hostOf = new Map(G.all.filter(r => r.el.k === 'wall').map(r => [r.el.id, r.el]));
    for (const r of G.all) { if (r.el.k === 'room') continue; const bs = elBoxes(r.el, r.level, (id) => hostOf.get(id)); bs.forEach((b, k) => { if (r.el.k === 'opening') b = { ...b, hw: Math.min(b.hw, 40) }; const i = boxes.length; boxes.push({ b, r, glass: r.el.mat === 'GLASS' || (r.el.k === 'opening' && r.el.kind === 'window') }); if (!k) elIndex.set(r.el.id, i); }); }
    const N = boxes.length; meshS = new THREE.InstancedMesh(unit, solidM, N); meshG = new THREE.InstancedMesh(unit, glassM, N); meshW = new THREE.InstancedMesh(unit, wireM, N); meshF = new THREE.InstancedMesh(unit, formM, N);
    for (const m of [meshS, meshG, meshW, meshF]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.setColorAt(0, new THREE.Color()); m.frustumCulled = false; scene.add(m); }
    meshPost = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 5), postM, 12000); meshPost.frustumCulled = false; scene.add(meshPost);
    buildTempStatic(); frame();
  }
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V3 = new THREE.Vector3(), SC = new THREE.Vector3(), CO = new THREE.Color(), HID = new THREE.Matrix4().makeScale(0, 0, 0), UPY = new THREE.Vector3(0, 1, 0);
  const setBox = (mesh, i, b, grow = 0) => { V3.set(X(b.cx), Y((b.z0 + b.z1) / 2), Z(b.cy)); Q.setFromAxisAngle(UPY, b.ang || 0); SC.set((b.hl * 2 + grow) / 1000, Math.max(0.02, (b.z1 - b.z0 + grow) / 1000), (b.hw * 2 + grow) / 1000); M4.compose(V3, Q, SC); mesh.setMatrixAt(i, M4); };
  // 정적 가설 (비계·크레인·울타리·흙막이) — 생성 후 표시만 전환
  let scafBy = new Map(), tc = null, hoist = null, fence = null, pit = null, retain = null, pumps = new THREE.Group(); let bbW = null;
  function buildTempStatic() {
    tempG.clear(); scafBy = new Map(); let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const r of G.all) if (r.el.k === 'slab') for (const p of r.el.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    if (!isFinite(x0)) { x0 = 0; x1 = 10000; y0 = 0; y1 = 10000; } bbW = { x0, x1, y0, y1 };
    const off = 900; const line = new THREE.LineBasicMaterial({ color: 0x3a77c9 }); const net = new THREE.MeshBasicMaterial({ color: 0x2f9a5a, transparent: true, opacity: 0.18, side: THREE.DoubleSide });
    for (const L of P.levels) { const g = new THREE.Group(); const z0 = Y(L.elev), z1 = Y(L.elev + L.height); const pts = []; const xs = [X(x0 - off), X(x1 + off)], zs = [Z(y0 - off), Z(y1 + off)];
      const edge = (a, b) => { const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.8)); for (let k = 0; k <= n; k++) { const x = a[0] + (b[0] - a[0]) * k / n, z = a[1] + (b[1] - a[1]) * k / n; pts.push(x, z0, z, x, z1, z); } for (const yy of [z0 + 0.1, (z0 + z1) / 2, z1 - 0.05]) pts.push(a[0], yy, a[1], b[0], yy, b[1]); };
      const c = [[xs[0], zs[0]], [xs[1], zs[0]], [xs[1], zs[1]], [xs[0], zs[1]]]; for (let k = 0; k < 4; k++) edge(c[k], c[(k + 1) % 4]);
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.add(new THREE.LineSegments(geo, line));
      const w = xs[1] - xs[0], d = zs[0] - zs[1], hh = z1 - z0; for (const [px, pz, ww, ry] of [[(xs[0] + xs[1]) / 2, zs[0], w, 0], [(xs[0] + xs[1]) / 2, zs[1], w, 0], [xs[0], (zs[0] + zs[1]) / 2, d, Math.PI / 2], [xs[1], (zs[0] + zs[1]) / 2, d, Math.PI / 2]]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(ww, hh), net); m.position.set(px, (z0 + z1) / 2, pz); m.rotation.y = ry; g.add(m); }
      g.visible = false; tempG.add(g); scafBy.set(L.id, g); }
    // 타워크레인
    tc = new THREE.Group(); const yel = new THREE.MeshStandardMaterial({ color: 0xf2c230 }); const mast = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1, 1.8), new THREE.MeshBasicMaterial({ color: 0xf2c230, wireframe: true })); mast.name = 'mast'; tc.add(mast);
    const jib = new THREE.Mesh(new THREE.BoxGeometry(Math.max(30, (x1 - x0) / 1000 * 1.1), 1.4, 1.2), yel); jib.name = 'jib'; tc.add(jib); const cj = new THREE.Mesh(new THREE.BoxGeometry(12, 1.2, 1.2), yel); cj.name = 'cj'; tc.add(cj); const cw = new THREE.Mesh(new THREE.BoxGeometry(3, 2.5, 2.5), new THREE.MeshStandardMaterial({ color: 0x555555 })); cw.name = 'cw'; tc.add(cw);
    tc.position.set(X(x1 + 5000), 0, Z((y0 + y1) / 2)); tc.visible = false; tempG.add(tc);
    hoist = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1, 1.6), new THREE.MeshStandardMaterial({ color: 0xff7a45, transparent: true, opacity: 0.85 })); hoist.position.set(X(x0 - 2400), 0, Z((y0 + y1) / 2)); hoist.visible = false; tempG.add(hoist);
    const fo = 9000; const fpts = [[x0 - fo, y0 - fo], [x1 + fo, y0 - fo], [x1 + fo, y1 + fo], [x0 - fo, y1 + fo]]; fence = new THREE.Group(); for (let k = 0; k < 4; k++) { const a = fpts[k], b = fpts[(k + 1) % 4]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]) / 1000; const m = new THREE.Mesh(new THREE.BoxGeometry(L, 2, 0.05), new THREE.MeshStandardMaterial({ color: 0xdedede })); m.position.set(X((a[0] + b[0]) / 2), 1, Z((a[1] + b[1]) / 2)); m.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]); fence.add(m); } fence.visible = false; tempG.add(fence);
    const lo = Math.min(0, ...P.levels.map(l => l.elev)) - 1500; pit = new THREE.Mesh(new THREE.BoxGeometry((x1 - x0 + 3000) / 1000, -lo / 1000, (y1 - y0 + 3000) / 1000), new THREE.MeshStandardMaterial({ color: 0x5c4a36, side: THREE.BackSide })); pit.position.set(X((x0 + x1) / 2), lo / 2000, Z((y0 + y1) / 2)); pit.visible = false; tempG.add(pit);
    retain = new THREE.Mesh(new THREE.BoxGeometry((x1 - x0 + 3400) / 1000, -lo / 1000 + 0.6, (y1 - y0 + 3400) / 1000), new THREE.MeshBasicMaterial({ color: 0x6d6d6d, wireframe: true })); retain.position.copy(pit.position); retain.visible = false; tempG.add(retain);
    tempG.add(pumps);
  }
  function frame() { if (!bbW) return; const cx = X((bbW.x0 + bbW.x1) / 2), cz = Z((bbW.y0 + bbW.y1) / 2); const top = Math.max(...P.levels.map(l => l.elev + l.height)) / 1000; const span = Math.max((bbW.x1 - bbW.x0) / 1000, (bbW.y1 - bbW.y0) / 1000, top * 0.6); camera.position.set(cx + span * 1.3, top * 0.55 + span * 0.7, cz + span * 1.5); controls?.target.set(cx, top * 0.35, cz); camera.near = 0.1; camera.far = 5000; camera.updateProjectionMatrix(); }
  function paint3d() {
    if (!meshS || !st) return; const fin = day > S.fin - S.s0;
    let pc = 0;
    for (let i = 0; i < boxes.length; i++) {
      const { b, r, glass } = boxes[i]; let s = st.el.get(r.el.id); if (!s && !G.elTasks.has(r.el.id) && fin) s = 'done'; if (b.part === 'void' && r.el.k !== 'opening') s = null;
      meshS.setMatrixAt(i, HID); meshG.setMatrixAt(i, HID); meshW.setMatrixAt(i, HID); meshF.setMatrixAt(i, HID);
      if (s) { const active = s.startsWith('w:') || s === 'pouring'; const k = s.replace('w:', ''); const base = k === 'done' || k === 'stripped' || k === 'coping' ? (r.el.mat && MATS[r.el.mat] && !['RC', 'SRC'].includes(r.el.mat) ? MATS[r.el.mat].color : (DISC[r.sheet.disc]?.color && r.sheet.disc !== 'A' && r.sheet.disc !== 'S' ? DISC[r.sheet.disc].color : COL[k] || COL.done)) : (COL[k] ?? COL.done);
        CO.set(base); if (active) CO.lerp(new THREE.Color(0xffd84a), 0.45); if (hiTask && S.byId.get(hiTask)?.els.includes(r.el.id)) CO.set(0xff4fd8); if (sel === r.el.id) CO.set(0xffffff);
        if (WIRE.has(k)) { setBox(meshW, i, b); meshW.setColorAt(i, CO.set(k === 'embed' ? COL.embed : COL.rebar)); }
        else if (glass && (k === 'done' || k === 'frame')) { setBox(meshG, i, b); meshG.setColorAt(i, CO); }
        else { setBox(meshS, i, b); meshS.setColorAt(i, CO); }
      }
      if (st.temp.form.has(r.el.id) && (!s || !['poured', 'curing', 'stripped', 'done'].includes(s.replace('w:', '')) || s === 'w:poured' || s === 'pouring' || s === 'curing')) { setBox(meshF, i, b, 60); meshF.setColorAt(i, CO.set(COL.form)); }
      // 동바리: 슬래브·보 아래
      if (st.temp.shore.has(r.el.id) && (r.el.k === 'slab' || r.el.k === 'beam') && pc < 11900) { const L = lvById.get(r.level.id); const below = r.el.k === 'slab' ? [...P.levels].filter(l => l.elev < L.elev).sort((a, c) => c.elev - a.elev)[0] : L; const zb = below ? below.elev : 0, zt = b.z0; if (zt - zb > 300) { const sp = Math.max(1500, Math.sqrt(b.hl * b.hw * 4 / 220)); const c = Math.cos(b.ang), sn = Math.sin(b.ang); for (let u = -b.hl + sp / 2; u < b.hl && pc < 11900; u += sp) for (let v = -b.hw + sp / 2; v < b.hw && pc < 11900; v += (r.el.k === 'beam' ? b.hw * 2 : sp)) { V3.set(X(b.cx + u * c - v * sn), Y((zb + zt) / 2), Z(b.cy + u * sn + v * c)); SC.set(1, (zt - zb) / 1000, 1); M4.compose(V3, Q.identity(), SC); meshPost.setMatrixAt(pc++, M4); } } }
    }
    meshPost.count = pc; for (const m of [meshS, meshG, meshW, meshF, meshPost]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    // 가설
    for (const [id, g] of scafBy) g.visible = st.temp.scaf.has(id);
    let topDone = 0; for (const [id, s] of st.el) { const r = G.all.find(x => x.el.id === id); void r; void s; break; }
    const doneLv = P.levels.filter(L => G.T.some(t => t.lv === L.id && t.pour && S.R.get(t.id)?.ef < S.s0 + day)); topDone = doneLv.length ? Math.max(...doneLv.map(l => l.elev + l.height)) / 1000 : 0;
    tc.visible = st.temp.tc; if (tc.visible) { const H = topDone + 12; const mast = tc.getObjectByName('mast'); mast.scale.y = H; mast.position.y = H / 2; const jib = tc.getObjectByName('jib'); jib.position.set(-jib.geometry.parameters.width / 2 + 2, H + 0.7, 0); const cj = tc.getObjectByName('cj'); cj.position.set(6, H + 0.6, 0); const cw = tc.getObjectByName('cw'); cw.position.set(10, H - 0.5, 0); tc.rotation.y = (day * 0.37) % (Math.PI * 2); }
    hoist.visible = st.temp.hoist; if (hoist.visible) { hoist.scale.y = Math.max(3, topDone); hoist.position.y = hoist.scale.y / 2; }
    fence.visible = st.temp.fence; pit.visible = st.temp.exc; retain.visible = st.temp.retain;
    pumps.clear(); for (const t of st.temp.pump) { const els = t.els.map(id => boxes[elIndex.get(id)]?.b).filter(Boolean); if (!els.length) continue; const cx = els.reduce((s, b) => s + b.cx, 0) / els.length, cy = els.reduce((s, b) => s + b.cy, 0) / els.length, zt = Math.max(...els.map(b => b.z1)); const px = X(bbW.x0 - 7000), pz = Z(cy); const truck = new THREE.Mesh(new THREE.BoxGeometry(9, 3, 2.5), new THREE.MeshStandardMaterial({ color: 0xd04a35 })); truck.position.set(px, 1.5, pz); pumps.add(truck); const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(px, 3, pz), new THREE.Vector3((px + X(cx)) / 2, Y(zt) + 8, (pz + Z(cy)) / 2), new THREE.Vector3(X(cx), Y(zt) + 2, Z(cy))]); pumps.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x222222 }))); }
    ground.material.color.set(st.info.rain ? 0x6e735a : 0x8a8f6a); scene.background.set(st.info.rain ? 0x8a949e : 0xa9c9e6);
  }
  let raf = 0, lastT = 0, acc = 0;
  function loop(t) { raf = requestAnimationFrame(loop); if (playing && S) { acc += (t - lastT) / 1000 * speed; if (acc >= 1) { const n = Math.floor(acc); acc -= n; day = Math.min(S.fin - S.s0 + 3, day + n); if (day >= S.fin - S.s0 + 3) playing = false; refresh(); } } lastT = t; controls?.update(); if (renderer && holder.style.display !== 'none') renderer.render(scene, camera); }
  function resize() { if (!renderer) return; const r = holder.getBoundingClientRect(); if (!r.width) return; renderer.setSize(r.width, r.height, false); renderer.domElement.style.width = r.width + 'px'; renderer.domElement.style.height = r.height + 'px'; camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); }
  const ro = new ResizeObserver(resize); ro.observe(holder);
  // 클릭 → 부재 팝업
  const ray = new THREE.Raycaster(); let down = null;
  renderer?.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  renderer?.domElement.addEventListener('pointerup', e => { if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return; const r = renderer.domElement.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera);
    const hit = ray.intersectObjects([meshS, meshG, meshW, meshF].filter(Boolean), false)[0]; if (!hit || hit.instanceId == null) { sel = null; pop.style.display = 'none'; paint3d(); return; } sel = boxes[hit.instanceId].r.el.id; showPop(); paint3d(); });

  // ---------- 날짜 바 ----------
  const slider = h('input', { type: 'range', min: 0, value: 0, style: { width: '100%' }, oninput: e => { day = +e.target.value; refresh(); } });
  const dateL = h('b', { class: 'mono' }), info = h('span', { class: 'mono', style: { color: '#9fb0c6' } }), playB = h('button', { class: 'btn sm', onclick: () => { playing = !playing; if (playing && day >= S.fin - S.s0) day = 0; playB.textContent = playing ? '❚❚ 정지' : '▶ 재생'; } }, '▶ 재생');
  const spd = h('select', { onchange: e => { speed = +e.target.value; } }, ...[[1, '1일/초'], [5, '5일/초'], [15, '15일/초'], [30, '30일/초']].map(([v, l]) => h('option', { value: v, selected: v === speed }, l)));
  const step = (n) => h('button', { class: 'btn sm', onclick: () => { day = Math.max(0, Math.min(S.fin - S.s0 + 3, day + n)); refresh(); } }, n > 0 ? `+${n}일` : `${n}일`);
  const jump = h('select', { onchange: e => { const id = e.target.value; if (!id) return; day = S.R.get(id).es - S.s0; e.target.value = ''; refresh(); } });
  bar.append(h('div', { class: 'row', style: { gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '4px' } }, playB, spd, step(-7), step(-1), step(1), step(7), dateL, info, h('span', { style: { flex: 1 } }), jump), slider);

  function refresh() {
    if (!S) return; const D = S.s0 + day; st = stateAt(S, G, D); const total = S.fin - S.s0 + 1; slider.max = total + 2; slider.value = day;
    const i = st.info; const base = C.baseline ? toD(C.baseline.fin) : S.fin;
    dateL.textContent = `${toS(D)} (${wdOf(D)}) · D+${day}`; info.textContent = `${i.off ? '휴무' : i.rain ? '☔ 우천(외부 작업 중지)' : `☀ ${i.temp}℃`} · 공정률 ${progressAt(S, D).toFixed(1)}% · 준공 ${toS(S.fin)}${S.fin !== base ? ` (기준 대비 ${S.fin > base ? '+' : ''}${S.fin - base}일)` : ''}`;
    if (!jump.options.length || jump.dataset.n !== String(S.T.length)) { jump.innerHTML = ''; jump.dataset.n = S.T.length; jump.append(h('option', { value: '' }, '주요 시점으로 이동…'), ...['pre.mob', 'ew.exc', 'fd.pour', 'eq.tc.up', 'ms.topout', 'rf.wp', 'rf.coping', 'ex.plant', 'ms.done'].filter(id => S.R.get(id)).map(id => h('option', { value: id }, `${toS(S.R.get(id).es)} ${S.byId.get(id).name}`))); }
    paint3d(); renderSide(); if (sel) showPop(); renderLegend();
  }
  function renderLegend() { legend.innerHTML = ''; for (const k of ['rebar', 'embed', 'form', 'pouring', 'curing', 'steel', 'wp', 'done']) legend.append(h('div', {}, h('span', { style: { display: 'inline-block', width: '10px', height: '10px', background: '#' + COL[k].toString(16).padStart(6, '0'), marginRight: '6px', verticalAlign: 'middle', border: WIRE.has(k) ? '1px dashed #fff' : '' } }), LABEL[k])); legend.append(h('div', {}, h('span', { style: { display: 'inline-block', width: '10px', height: '10px', background: '#ffd84a', marginRight: '6px' } }), '오늘 작업 중'), h('div', { style: { color: '#e0b23a' } }, '│ 동바리  ▦ 비계(초록 망)  ■ 타워크레인')); }

  // ---------- 오늘의 현장 ----------
  function renderSide() {
    if (tab !== '3d' || !st) return; side.innerHTML = ''; const D = S.s0 + day;
    const issues = S.issues.length ? h('div', { class: 'card', style: { borderColor: '#ef5f5f', marginBottom: '8px' } }, h('b', { style: { color: '#ef5f5f' } }, `역순 시공 ${S.issues.length}건 → 보완 작업 반영됨`), ...S.issues.slice(0, 3).map(x => h('div', { class: 'note', style: { fontSize: '11.5px' } }, x.msg))) : null;
    if (G.empty.length) side.append(h('div', { class: 'card', style: { borderColor: '#ef5f5f', marginBottom: '8px' } }, h('b', { style: { color: '#ef5f5f' } }, `객체가 없는 층 ${G.empty.length}개 (${G.empty.slice(0, 6).join(', ')}${G.empty.length > 6 ? ' …' : ''})`), h('div', { class: 'note', style: { fontSize: '11.5px' } }, G.all.length ? '이 층들은 시공 작업을 만들지 않았습니다.' : '도면 데이터가 불러와지지 않았습니다 — 저장이 중간에 멈춘 프로젝트일 수 있습니다. 샘플이면 홈에서 다시 만들어 주세요. 공정률은 가설·기초 등 모델과 무관한 작업만으로 계산됩니다.')));
    side.append(h('div', { class: 'note', style: { lineHeight: 1.6, marginBottom: '8px' } }, '날짜를 움직이면 그날의 현장(부재 상태·가설·장비·인원)을 보여줍니다. 부재를 누르면 선행 작업·체크리스트·후행 공정이 열립니다.'), issues || '');
    const working = st.tasks.filter(t => S.cal.can(D, t) && !t.ms); const waiting = st.tasks.filter(t => !S.cal.can(D, t) && !t.ms);
    side.append(h('div', { class: 'cards', style: { gridTemplateColumns: '1fr 1fr 1fr' } }, ...[['작업', working.length + '건'], ['투입 인원', st.total + '명'], ['장비', st.equip.length + '종']].map(([k, v]) => h('div', { class: 'card' }, h('div', { class: 'd' }, k), h('div', { class: 't', style: { fontSize: '17px' } }, v)))));
    if (st.total) { const mx = Math.max(...Object.values(st.men)); side.append(h('h4', { style: { margin: '10px 0 4px' } }, '공종별 인원'), ...Object.entries(st.men).sort((a, b) => b[1] - a[1]).map(([k, v]) => h('div', { class: 'row', style: { gap: '6px', alignItems: 'center', fontSize: '12px' } }, h('span', { style: { width: '44px' } }, k), h('div', { style: { height: '8px', width: `${v / mx * 200}px`, background: '#4ea1ff', borderRadius: '3px' } }), h('span', { class: 'mono' }, v)))); }
    if (st.equip.length) side.append(h('div', { class: 'note', style: { marginTop: '6px' } }, '장비: ' + st.equip.join(', ')));
    const row = (t, warn) => { const r = S.R.get(t.id); const a = C.actual[t.id]; return h('div', { class: 'card click', style: { padding: '6px 8px', margin: '4px 0', borderColor: hiTask === t.id ? '#ff4fd8' : S.crit.has(t.id) ? '#ef5f5f88' : '', opacity: warn ? 0.6 : 1 }, onclick: () => { hiTask = hiTask === t.id ? null : t.id; paint3d(); renderSide(); } },
      h('div', { style: { fontSize: '12.5px' } }, t.rework ? '⚠ ' : '', t.name), h('div', { class: 'note', style: { fontSize: '11px' } }, `${t.trade} · ${toS(r.es).slice(5)}~${toS(r.ef).slice(5)} (${t.cal ? r.ef - r.es + 1 + '일(달력)' : t.dur + '일'})${t.men ? ` · ${t.men}명` : ''}${S.crit.has(t.id) ? ' · 주공정' : ''}${a?.f ? ' · 실적 완료' : a?.s ? ` · 실적 ${a.pct || 0}%` : ''}${warn ? ' · 오늘 ' + (st.info.rain ? '우천 중지' : st.info.off ? '휴무' : '중지') : ''}`)); };
    side.append(h('h4', { style: { margin: '12px 0 4px' } }, `오늘 진행 작업 ${working.length}`), ...working.slice(0, 60).map(t => row(t)));
    if (waiting.length) side.append(h('h4', { style: { margin: '10px 0 4px' } }, `오늘 중지 ${waiting.length}`), ...waiting.slice(0, 20).map(t => row(t, true)));
    const next = S.T.filter(t => { const r = S.R.get(t.id); return r.es > D && r.es <= D + 7 && !t.ms; }).sort((a, b) => S.R.get(a.id).es - S.R.get(b.id).es);
    side.append(h('h4', { style: { margin: '10px 0 4px' } }, `7일 내 착수 ${next.length}`), ...next.slice(0, 15).map(t => h('div', { class: 'note', style: { fontSize: '11.5px' } }, `${toS(S.R.get(t.id).es).slice(5)} ${t.name}`)));
  }

  // ---------- 부재 팝업: 선행·체크리스트·후행 ----------
  function showPop() {
    const D = S.s0 + day; const r = G.all.find(x => x.el.id === sel); if (!r) return; pop.innerHTML = ''; pop.style.display = '';
    const ids = (G.elTasks.get(sel) || []).filter(id => S.R.get(id)); const extra = S.extra.filter(t => t.els.includes(sel)).map(t => t.id); const all = [...ids, ...extra].sort((a, b) => S.R.get(a).es - S.R.get(b).es);
    const status = (id) => { const x = S.R.get(id); const a = C.actual[id]; return a?.f || D > x.ef ? 'done' : D >= x.es ? 'prog' : 'wait'; };
    const cur = all.find(id => status(id) === 'prog') || all.find(id => status(id) === 'wait'); const s = st.el.get(sel);
    pop.append(h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center' } }, h('b', {}, `${r.level.name} ${elName(r.el)}${r.el.tag ? ' · ' + r.el.tag : ''}`), h('button', { class: 'btn sm', onclick: () => { sel = null; pop.style.display = 'none'; paint3d(); } }, '닫기')),
      h('div', { class: 'note', style: { margin: '2px 0 8px' } }, `현재 상태: ${s ? (LABEL[s.replace('w:', '').replace('pouring', 'pouring')] || s) + (s.startsWith('w:') || s === 'pouring' ? ' (작업 중)' : '') : '착수 전'} · ${toS(D)}`));
    const ico = { done: '✔', prog: '●', wait: '○' }, colr = { done: '#7bd389', prog: '#ffd84a', wait: '#8a94a6' };
    pop.append(h('div', { style: { fontWeight: 600, margin: '4px 0' } }, '이 부재의 작업 순서'));
    for (const id of all) { const t = S.byId.get(id), x = S.R.get(id), stt = status(id); pop.append(h('div', { style: { display: 'grid', gridTemplateColumns: '16px 1fr auto', gap: '6px', padding: '3px 0', borderBottom: '1px solid #1f2733', color: id === cur ? '#fff' : '#cfd6e2' } }, h('span', { style: { color: colr[stt] } }, ico[stt]), h('span', { style: { fontWeight: id === cur ? 700 : 400 } }, (t.rework ? '⚠ ' : '') + t.name.replace(r.level.name + ' ', '')), h('span', { class: 'mono', style: { fontSize: '11px', color: '#9fb0c6' } }, `${toS(x.es).slice(5)}~${toS(x.ef).slice(5)}`))); }
    const focus = cur || all[all.length - 1];
    if (focus && !cur) { const sc = [...new Set(G.succ.get(focus) || [])].map(id => S.byId.get(id)).filter(Boolean).sort((a, b) => S.R.get(a.id).es - S.R.get(b.id).es); pop.append(h('div', { style: { fontWeight: 600, margin: '10px 0 4px' } }, `이 부재 완료 후 이어지는 공정 ${sc.length}`), ...sc.slice(0, 12).map(x => h('div', { style: { fontSize: '12px' } }, `→ ${x.name} `, h('span', { class: 'mono', style: { color: '#9fb0c6', fontSize: '11px' } }, `${toS(S.R.get(x.id).es).slice(5)} · ${D > S.R.get(x.id).ef ? '완료' : D >= S.R.get(x.id).es ? '진행 중' : '예정'}`)))); }
    if (cur) {
      const t = S.byId.get(cur); const pre = (S.preds.get(cur) || []).map(p => S.byId.get(p.id)).filter(Boolean);
      pop.append(h('div', { style: { fontWeight: 600, margin: '10px 0 4px' } }, `선행 작업 확인 — ${t.name}`));
      for (const p of pre) { const sp = status(p.id); pop.append(h('div', { style: { fontSize: '12px', color: sp === 'done' ? '#7bd389' : '#ef9f5f' } }, `${sp === 'done' ? '✔' : '✖'} ${p.name}${sp === 'done' ? '' : ` (완료 예정 ${toS(S.R.get(p.id).ef).slice(5)})`}`)); }
      const ck = C.checks[cur] ||= []; pop.append(h('div', { style: { fontWeight: 600, margin: '10px 0 4px' } }, '현재 작업 체크리스트'));
      (t.check || []).forEach((c, i) => pop.append(h('label', { class: 'row', style: { gap: '6px', alignItems: 'center', fontSize: '12px', margin: '2px 0' } }, h('input', { type: 'checkbox', checked: !!ck[i], onchange: e => { ck[i] = e.target.checked; save(); } }), c)));
      const sc = [...new Set((G.succ.get(cur) || []))].map(id => S.byId.get(id)).filter(Boolean).sort((a, b) => S.R.get(a.id).es - S.R.get(b.id).es);
      pop.append(h('div', { style: { fontWeight: 600, margin: '10px 0 4px' } }, `후행 공정 ${sc.length}`), ...sc.slice(0, 12).map(x => h('div', { style: { fontSize: '12px' } }, `→ ${x.name} `, h('span', { class: 'mono', style: { color: '#9fb0c6', fontSize: '11px' } }, `${toS(S.R.get(x.id).es).slice(5)}${S.crit.has(x.id) ? ' · 주공정' : ''}`))));
      pop.append(h('div', { class: 'row', style: { gap: '6px', marginTop: '10px', flexWrap: 'wrap' } },
        h('button', { class: 'btn sm primary', onclick: () => markActual(cur, { s: C.actual[cur]?.s || toS(Math.min(D, S.R.get(cur).es)), f: toS(D) }) }, '오늘 완료로 실적 입력'),
        h('button', { class: 'btn sm', onclick: async () => { const v = await dialog({ title: '진행 실적', fields: [{ key: 's', label: '착수일', type: 'date', value: C.actual[cur]?.s || toS(D) }, { key: 'pct', label: '진척률 (%)', type: 'number', value: C.actual[cur]?.pct || 50 }] }); if (v) markActual(cur, { s: v.s, pct: +v.pct }); } }, '진행 중 실적'),
        C.actual[cur] ? h('button', { class: 'btn sm', onclick: () => { delete C.actual[cur]; save(); reschedule(); refresh(); } }, '실적 지우기') : null));
    }
    const done = all.filter(id => C.actual[id]); if (done.length) pop.append(h('div', { class: 'note', style: { marginTop: '6px', fontSize: '11px' } }, `실적 입력 ${done.length}건 — 실적·지연을 반영해 후행 공정을 다시 계산했습니다.`));
  }
  function markActual(id, a) { C.actual[id] = { ...(C.actual[id] || {}), ...a }; if (!C.dataDate || toD(C.dataDate) < S.s0 + day) C.dataDate = toS(S.s0 + day); save(); const before = S.fin; reschedule(); refresh(); const iss = S.issues.filter(x => x.t === id); toast(iss.length ? `역순 시공 감지 — 보완 작업 ${iss.length}건 추가, 준공 ${S.fin - before >= 0 ? '+' : ''}${S.fin - before}일` : `실적 반영 — 준공 ${toS(S.fin)} (${S.fin - before >= 0 ? '+' : ''}${S.fin - before}일)`, iss.length ? 'warn' : 'ok', 4000); }

  // ---------- 다른 페이지 ----------
  let filt = { ph: '', lv: '', q: '' };
  function renderPage() {
    page.innerHTML = ''; const base = C.baseline; const bd = (id, k) => base?.[k]?.[id];
    if (tab === 'list') {
      const phs = [...new Set(S.T.map(t => t.ph))];
      page.append(h('div', { class: 'row', style: { gap: '6px', marginBottom: '8px', flexWrap: 'wrap', alignItems: 'center' } }, h('b', {}, `작업 ${S.T.length}개`), h('select', { onchange: e => { filt.ph = e.target.value; renderPage(); } }, h('option', { value: '' }, '전체 단계'), ...phs.map(p => h('option', { value: p, selected: filt.ph === p }, p))),
        h('select', { onchange: e => { filt.lv = e.target.value; renderPage(); } }, h('option', { value: '' }, '전체 층'), ...P.levels.map(l => h('option', { value: l.id, selected: filt.lv === l.id }, l.name))),
        h('input', { placeholder: '작업명 검색', value: filt.q, onchange: e => { filt.q = e.target.value; renderPage(); } }), h('label', { class: 'row', style: { gap: '4px' } }, h('input', { type: 'checkbox', checked: !!filt.crit, onchange: e => { filt.crit = e.target.checked; renderPage(); } }), '주공정만'),
        h('span', { class: 'note' }, '실적(착수·완료·진척)을 넣으면 후행 공정을 다시 계산합니다. 순서를 바꿔 시공했으면 보완 작업이 자동으로 들어갑니다.')));
      const rows = S.order.map(id => S.byId.get(id)).filter(t => t && (!filt.ph || t.ph === filt.ph) && (!filt.lv || t.lv === filt.lv) && (!filt.q || t.name.includes(filt.q)) && (!filt.crit || S.crit.has(t.id))).sort((a, b) => S.R.get(a.id).es - S.R.get(b.id).es);
      const tbl = h('table', { class: 'tbl', style: { width: '100%', fontSize: '12px' } }); tbl.append(h('tr', {}, ...['단계', '작업', '공종', '기간', '기준 시작~완료', '현재 시작~완료', '차이', '실적 착수', '실적 완료', '진척%'].map(x => h('th', {}, x))));
      for (const t of rows.slice(0, 400)) { const r = S.R.get(t.id); const a = C.actual[t.id] || {}; const bf = bd(t.id, 'ef'); const diff = bf != null ? r.ef - bf : null;
        const inp = (k, type) => h('input', { type, value: a[k] ?? '', style: { width: type === 'number' ? '56px' : '128px' }, onchange: e => { const v = e.target.value; C.actual[t.id] = { ...(C.actual[t.id] || {}), [k]: type === 'number' ? +v : v }; if (!v && k === 's') delete C.actual[t.id]; const D = toD(v || C.start); if (v && (!C.dataDate || toD(C.dataDate) < D)) C.dataDate = v; save(); reschedule(); renderPage(); } });
        tbl.append(h('tr', { style: { background: t.rework ? '#ef5f5f22' : S.crit.has(t.id) ? '#ef5f5f0d' : '' } }, h('td', {}, t.ph), h('td', {}, (t.rework ? '⚠ ' : '') + t.name), h('td', {}, t.trade), h('td', { class: 'mono' }, t.cal ? `${t.dur}일(달력)` : `${t.dur || 0}일`), h('td', { class: 'mono' }, bf != null ? `${toS(bd(t.id, 'es')).slice(2)}~${toS(bf).slice(2)}` : '-'), h('td', { class: 'mono' }, `${toS(r.es).slice(2)}~${toS(r.ef).slice(2)}`), h('td', { class: 'mono', style: { color: diff > 0 ? '#ef5f5f' : diff < 0 ? '#7bd389' : '' } }, diff == null ? '신규' : diff ? (diff > 0 ? '+' : '') + diff : '0'), h('td', {}, inp('s', 'date')), h('td', {}, inp('f', 'date')), h('td', {}, inp('pct', 'number')))); }
      page.append(h('div', { class: 'tbl' }, tbl)); if (rows.length > 400) page.append(h('div', { class: 'note' }, `${rows.length - 400}개 더 — 단계·층으로 걸러 보세요.`));
    }
    if (tab === 'delay') {
      const bF = C.baseline ? toD(C.baseline.fin) : S.fin; const dl = S.fin - bF;
      page.append(h('div', { class: 'cards', style: { gridTemplateColumns: 'repeat(4,1fr)', maxWidth: '900px' } }, ...[['기준 준공', C.baseline?.fin || '-'], ['현재 준공', toS(S.fin)], ['지연', `${dl > 0 ? '+' : ''}${dl}일`], ['실적 기준일', C.dataDate || '미입력']].map(([k, v], i) => h('div', { class: 'card' }, h('div', { class: 'd' }, k), h('div', { class: 't', style: { fontSize: '18px', color: i === 2 && dl > 0 ? '#ef5f5f' : '' } }, v)))));
      page.append(h('h3', {}, '지연 상황 입력'), h('div', { class: 'note', style: { marginBottom: '6px' } }, '우천·협력사 문제·자재 지연·작업 중지를 넣으면 해당 날짜에 그 작업을 멈추고 후행 공정을 다시 계산합니다.'));
      const evT = h('table', { class: 'tbl', style: { fontSize: '12.5px', maxWidth: '900px' } }); evT.append(h('tr', {}, ...['유형', '시작일', '일수', '대상', '메모', ''].map(x => h('th', {}, x))));
      const TY = { rain: '우천(외부 작업)', trade: '협력사 문제(공종)', material: '자재 지연(내역 코드)', stop: '전체 작업 중지' };
      for (const e of C.events) evT.append(h('tr', {}, h('td', {}, TY[e.type]), h('td', { class: 'mono' }, e.from), h('td', {}, e.days + '일'), h('td', {}, e.trade || e.code || '-'), h('td', {}, e.note || ''), h('td', {}, h('button', { class: 'btn sm', onclick: () => { C.events = C.events.filter(x => x !== e); save(); reschedule(); renderPage(); } }, '삭제'))));
      page.append(h('div', { class: 'tbl' }, evT), h('button', { class: 'btn primary', style: { marginTop: '8px' }, onclick: async () => {
        const v = await dialog({ title: '지연 상황 추가', fields: [{ key: 'type', label: '유형', type: 'select', options: Object.entries(TY), value: 'rain' }, { key: 'from', label: '시작일', type: 'date', value: toS(S.s0 + day) }, { key: 'days', label: '일수', type: 'number', value: 3 }, { key: 'trade', label: '협력사 공종 (협력사 문제일 때)', type: 'select', options: [['', '-'], ...TRADES.map(t => [t, t])], value: '' }, { key: 'code', label: '내역 코드 (자재 지연일 때)', type: 'select', options: [['', '-'], ...P.boq.map(b => [b.code, `${b.code} ${b.name}`])], value: '' }, { key: 'note', label: '메모', value: '' }] });
        if (!v) return; const before = S.fin; C.events.push({ id: Date.now().toString(36), type: v.type, from: v.from, days: +v.days || 1, trade: v.type === 'trade' ? v.trade : undefined, code: v.type === 'material' ? v.code : undefined, note: v.note }); save(); reschedule(); renderPage(); toast(`준공 ${toS(S.fin)} (${S.fin - before >= 0 ? '+' : ''}${S.fin - before}일)`, S.fin > before ? 'warn' : 'ok', 4000); } }, '+ 지연 상황'));
      if (S.issues.length) page.append(h('h3', {}, `역순 시공 ${S.issues.length}건`), ...S.issues.map(x => h('div', { class: 'card', style: { margin: '4px 0', maxWidth: '900px' } }, x.msg)));
      const affected = S.T.filter(t => C.baseline?.ef?.[t.id] != null && S.R.get(t.id).ef - C.baseline.ef[t.id] > 0 && !t.ms).sort((a, b) => (S.R.get(b.id).ef - C.baseline.ef[b.id]) - (S.R.get(a.id).ef - C.baseline.ef[a.id]));
      if (affected.length) page.append(h('h3', {}, `영향받는 작업 ${affected.length}개 (지연 큰 순)`), h('div', { class: 'tbl', style: { maxWidth: '900px' } }, table([{ label: '작업', key: 'n' }, { label: '현재 완료', key: 'f' }, { label: '지연', key: 'd' }], affected.slice(0, 30).map(t => ({ n: t.name, f: toS(S.R.get(t.id).ef), d: `+${S.R.get(t.id).ef - C.baseline.ef[t.id]}일${S.crit.has(t.id) ? ' (주공정)' : ''}` })))));
      page.append(h('h3', {}, '공기 만회 대안'), h('button', { class: 'btn', onclick: (e) => { e.target.disabled = true; e.target.textContent = '계산 중…'; setTimeout(() => { const ops = recoveryOptions(P, G, S); e.target.replaceWith(h('div', { class: 'tbl', style: { maxWidth: '900px' } }, table([{ label: '대안', key: 'k' }, { label: '준공', key: 'f' }, { label: '단축', key: 'g' }], ops.map(o => ({ k: o.k, f: toS(o.fin), g: `${o.gain}일` }))))); }, 20); } }, '대안 계산'));
    }
    if (tab === 'cover') {
      page.append(h('div', { class: 'note', style: { marginBottom: '8px', maxWidth: '900px' } }, '도급내역(물량 툴의 내역)의 항목이 어떤 시공 작업으로 시뮬레이션에 들어가는지 보여줍니다. 코드로 연결되지 않은 항목은 이름으로 공종을 찾아 붙이고, 그래도 없으면 별도 작업으로 넣습니다.'));
      page.append(h('div', { class: 'tbl', style: { maxWidth: '1000px' } }, table([{ label: '코드', key: 'c' }, { label: '내역', key: 'n' }, { label: '시뮬레이션 작업', key: 't' }, { label: '상태', key: 's' }], G.cover.map(c => ({ c: c.code, n: c.name, t: c.tasks.length ? `${S.byId.get(c.tasks[0])?.name || c.tasks[0]}${c.tasks.length > 1 ? ` 외 ${c.tasks.length - 1}` : ''}` : '-', s: c.none ? '모델 물량 없음' : c.auto ? '별도 작업(위치 지정 필요)' : '반영' })))));
    }
  }
  async function exportXLSX() { const { writeBook } = await import('../js/excel.js'); const rows = [['단계', '층', '작업', '공종', '내역코드', '기간(일)', '인원', '시작', '완료', '기준 완료', '차이(일)', '주공정', '실적 착수', '실적 완료', '진척%']];
    for (const id of S.order) { const t = S.byId.get(id), r = S.R.get(id), a = C.actual[id] || {}; const bf = C.baseline?.ef?.[id]; rows.push([t.ph, t.lv ? levelOf(P, t.lv).name : '', t.name, t.trade, t.code || '', t.dur || 0, t.men || 0, toS(r.es), toS(r.ef), bf != null ? toS(bf) : '', bf != null ? r.ef - bf : '', S.crit.has(id) ? '○' : '', a.s || '', a.f || '', a.pct ?? '']); }
    saveFile(`${P.name.replace(/[\\/:*?"<>|]/g, '_')}_시공시뮬레이션.xlsx`, await writeBook([{ name: '공정', rows, widths: [8, 6, 46, 8, 8, 8, 6, 11, 11, 11, 8, 6, 11, 11, 6] }, { name: '지연 상황', rows: [['유형', '시작', '일수', '대상', '메모'], ...C.events.map(e => [e.type, e.from, e.days, e.trade || e.code || '', e.note || ''])] }])); }

  const onModel = () => { rebuild(); build3d(); refresh(); }; const offModel = ctx.bus.on('model', onModel);
  rebuild(); build3d(); showTab(); raf = requestAnimationFrame(loop);
  window.__csim = { get S() { return S; }, get G() { return G; }, setDay(d) { day = d; refresh(); }, get st() { return st; }, select(id) { sel = id; showPop(); paint3d(); } };
  return { unmount() { cancelAnimationFrame(raf); ro.disconnect(); offModel?.(); renderer?.dispose(); controls?.dispose(); } };
}
