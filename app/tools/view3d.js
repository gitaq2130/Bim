// 빌더 3D — 기준점·층고 기반 3D 변환, 재질·태양 시뮬레이션, 4D 진척, 간섭 강조
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { h, toast, saveFile, dialog } from '../js/ui.js';
import { IC } from '../js/icons.js';
import { buildFurn } from './furn3d.js';
import { sysColor, mepNetwork, SYS } from '../js/mep.js';
import { FINISHES, finishMaps, worldUV, kelvin, skyTexture, horizonColor, buildInteriorLights, buildFixtureLights, sectionBasis, sectionCut, chainSegments, sectionProject, sectionSVG, sectionDXF } from './render3d.js';
import { DISC, KINDS, MATS, SECTIONS, allElements, levelOf, elName, cumProgress, takeoff, isRefElement } from '../js/model.js';
import { sunVector, localToDate, toDeg } from '../js/sun.js';
import { statusAt, toD, toS, addDays, daysBetween } from './sched.js';
import { loadRev, diffProject, snapshotOf, createRev } from '../js/rev.js';
import { dist, sub, norm, angOf, bboxOf, fmt, fmt0, clamp } from '../js/util.js';

const PRESETS = {
  '모던 화이트': { ext: '#eceae4', int: '#f4f2ee', slab: '#c9c7c2', floor: '#d9d5cc', col: '#d9d7d2', beam: '#cfcdc8', glass: '#b8dcef', ground: '#5b6e45', frame: '#3b3f45', t_ext: 'plaster', t_int: 'paint', t_slab: 'concrete', t_floor: 'tile', t_col: 'concrete', t_beam: 'concrete', t_ground: 'grass' },
  '적벽돌': { ext: '#9b4a32', int: '#efe9df', slab: '#bdb8ae', floor: '#a77c55', col: '#c8c3ba', beam: '#beb9b0', glass: '#a9cfe3', ground: '#566a40', frame: '#2d2a28', t_ext: 'brick', t_int: 'paint', t_slab: 'concrete', t_floor: 'wood', t_col: 'concrete', t_beam: 'concrete', t_ground: 'grass' },
  '노출콘크리트': { ext: '#a7a7a2', int: '#bdbcb7', slab: '#9d9c98', floor: '#8e8d89', col: '#acaba6', beam: '#a4a39e', glass: '#b3d9ec', ground: '#5d6c49', frame: '#2b2e33', t_ext: 'concrete', t_int: 'concrete', t_slab: 'concrete', t_floor: 'concrete', t_col: 'concrete', t_beam: 'concrete', t_ground: 'grass' },
  '다크 메탈': { ext: '#3a3f47', int: '#e6e3dc', slab: '#8d8b87', floor: '#c4bfb6', col: '#5b616b', beam: '#565b64', glass: '#8fbfd9', ground: '#4f6243', frame: '#15171a', t_ext: 'metal', t_int: 'paint', t_slab: 'concrete', t_floor: 'tile', t_col: 'metal', t_beam: 'metal', t_ground: 'grass' },
  '석재 오피스': { ext: '#d6cfc2', int: '#f1eee8', slab: '#c4c0b8', floor: '#e2ddd3', col: '#cfc8bb', beam: '#c9c3b8', glass: '#7fb2d4', ground: '#5c5f63', frame: '#202326', t_ext: 'stone', t_int: 'paint', t_slab: 'concrete', t_floor: 'stone', t_col: 'stone', t_beam: 'concrete', t_ground: 'asphalt' },
};
const MEP_COL = { duct: '#9ece6a', pipe: '#4fb6e6', tray: '#f7768e' };
// Core 1.1.0 객체: 도면 공종이 아니라 객체 공종(F 소방·E 전기·I 인테리어)으로 표시를 켜고 끔
const OWN_DISC = new Set(['sprinkler', 'panel', 'light', 'ceiling']);
// 천장 마감명 → 재질 (마감명에 들어간 낱말로 판정)
function ceilFinish(fin = '') {
  if (/목|우드|원목|wood/i.test(fin)) return { fin: 'wood', color: '#b08a5a' };
  if (/금속|알루미늄|메탈|스틸|SMC|metal/i.test(fin)) return { fin: 'metal', color: '#d5d7da' };
  if (/노출|콘크리트/.test(fin)) return { fin: 'concrete', color: '#b9b8b3' };
  // 도장·텍스는 근접 광원에서 요철 질감이 과장되므로 무늬 없이 무광 단색
  if (/텍스|흡음|암면|mineral/i.test(fin)) return { fin: null, color: '#e9e6de', rough: 0.95 };
  return { fin: null, color: '#f3f2ee', rough: 0.9 };
}
const isRound = (el) => /다운|원형|매입등|펜던트|down|pendant/i.test(el.type || '') || (el.w || 0) <= 250;

export function mount(root, ctx) {
  const P = ctx.P, S = ctx.state;
  P.view ||= {}; P.view.mats = Object.assign({}, PRESETS['모던 화이트'], P.view.mats || {});
  const M = P.view.mats; for (const [k, v] of Object.entries(PRESETS['모던 화이트'])) if (M[k] == null) M[k] = v;
  const RD = P.view.render = Object.assign({ quality: window.innerWidth > 800 && !window.__testFast ? 'high' : 'fast', tone: 'aces', ev: 0, ao: true, bloom: true, fog: true, lights: 'auto', K: 4000, lumen: 1800, sunMul: 1, tex: true }, P.view.render || {});
  const st = { date: P.view.sunDate || new Date().toISOString().slice(0, 10), hour: P.view.sunHour ?? 14, disc: Object.fromEntries(Object.keys(DISC).map(d => [d, true])), maxLevel: null, xray: false, mode: 'orbit', period: S.period3d ?? -1, hideUnstarted: false, ground: true, playing: false, clip: { y: null, x: null, z: null }, measure: false, sunMap: null, sched: S.sched4d?.date || null, schedPlay: !!S.sched4d };
  S.sched4d = null;
  const m = (v) => v / 1000;
  const bx = P.base.x, by = P.base.y;
  const W3 = (p, z = 0) => new THREE.Vector3(m(p[0] - bx), m(z), -m(p[1] - by));

  // ---------- DOM ----------
  const holder = h('div', { style: { position: 'relative', flex: 1, minWidth: 0, minHeight: 0, background: '#9cc8ec' } });
  const info = h('div', { class: 'p3d', style: { display: 'none' } });
  const sunInfo = h('div', { class: 'mono', style: { position: 'absolute', right: '10px', bottom: '10px', background: '#0f1218cc', border: '1px solid #2a3342', borderRadius: '6px', padding: '4px 8px', fontSize: '11.5px', color: '#cfd6e2' } });
  const walkPad = h('div', { style: { position: 'absolute', left: '12px', bottom: '12px', display: 'none', gridTemplateColumns: 'repeat(3,44px)', gap: '4px' } });
  const revBar = h('div', { style: { position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: '10px', background: '#0f1218e6', border: '1px solid #2a3342', borderRadius: '10px', padding: '6px 8px', display: 'flex', gap: '6px', alignItems: 'center', maxWidth: 'calc(100% - 20px)', overflowX: 'auto', fontSize: '12px' } });
  const revLegend = h('div', { class: 'mono', style: { position: 'absolute', left: '10px', bottom: '10px', background: '#0f1218cc', border: '1px solid #2a3342', borderRadius: '6px', padding: '4px 8px', fontSize: '11.5px', display: 'none' } });
  const cube = h('div', { class: 'vcube', title: '뷰큐브 — 면 클릭: 그 방향 보기 · 집: 홈 뷰' });
  holder.append(sunInfo, walkPad, revBar, revLegend, cube);
  const tree = h('div', { class: 'side l tree3d' });
  const side = h('div', { class: 'side' });
  const tb = h('div', { class: 'ribbon' });
  root.append(h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } }, tb, h('div', { style: { display: 'flex', flex: 1, minHeight: 0, position: 'relative' } }, tree, holder, side)));
  const SEC = P.view.sec = Object.assign({ on: false, axis: 'x', pos: {}, ang: 0, off: 0, flip: false, depth: null, plane: true }, P.view.sec || {}); st.secPick = null;
  st.hidden = new Set(P.view.hidden3d || []); st.iso = null; st.sideTab = 'prop'; st.secBox = null; st.treeQ = ''; st.treeOpen = P.view.tree3d ?? (window.innerWidth > 1100);
  const sel = new Set(); const selRef = new Map();
  const add2 = (el, ...xs) => el.append(...xs.flat().filter(x => x != null && x !== false));
  const saveHidden = () => { P.view.hidden3d = [...st.hidden]; ctx.touch('meta'); };

  // ---------- three ----------
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); }
  catch (e) { holder.append(h('div', { class: 'empty' }, '이 기기에서 WebGL을 사용할 수 없어 3D를 표시할 수 없습니다.')); return {}; }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  const clipPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6), new THREE.Plane(new THREE.Vector3(-1, 0, 0), 1e6), new THREE.Plane(new THREE.Vector3(0, 0, 1), 1e6), new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e6), new THREE.Plane(new THREE.Vector3(1, 0, 0), 1e6), new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6), new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6)]; // [6] 단면 축
  renderer.outputColorSpace = THREE.SRGBColorSpace; const TONES = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping, filmic: THREE.CineonToneMapping }; renderer.toneMapping = TONES[RD.tone] || THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  holder.prepend(renderer.domElement); renderer.domElement.style.display = 'block'; renderer.domElement.style.touchAction = 'none';
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 2000);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = Math.PI * 0.495;
  const hemi = new THREE.HemisphereLight(0xdfefff, 0x6b7360, 0.6); scene.add(hemi);
  const amb = new THREE.AmbientLight(0xffffff, 0.15); scene.add(amb);
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.6); sun.castShadow = true; sun.shadow.mapSize.set(RD.quality === 'fast' ? 2048 : 4096, RD.quality === 'fast' ? 2048 : 4096); sun.shadow.radius = 3; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; scene.add(sun, sun.target);
  const sunBall = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffe9a8 })); scene.add(sunBall);
  const groundMat = new THREE.MeshStandardMaterial({ color: M.ground, roughness: 1, transparent: true, opacity: 1 });
  function updateGround() { const F = FINISHES[M.t_ground]; if (RD.tex && F) { const t = finishMaps(M.t_ground, M.ground); for (const k of ['map', 'roughnessMap', 'normalMap']) { const c = t[k].clone(); c.repeat.set(8000 / F.size, 8000 / F.size); c.needsUpdate = true; groundMat[k]?.dispose?.(); groundMat[k] = c; } groundMat.color.set('#ffffff'); } else { for (const k of ['map', 'roughnessMap', 'normalMap']) groundMat[k] = null; groundMat.color.set(M.ground); } groundMat.needsUpdate = true; }
  const ground = new THREE.Mesh(new THREE.CircleGeometry(4000, 96), groundMat); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03; ground.receiveShadow = true; scene.add(ground); updateGround();
  const lightsG = new THREE.Group(); scene.add(lightsG);
  const model = new THREE.Group(); scene.add(model);
  const markers = new THREE.Group(); scene.add(markers);
  const measureG = new THREE.Group(); scene.add(measureG);
  const analysisG = new THREE.Group(); scene.add(analysisG);
  const photoG = new THREE.Group(); scene.add(photoG); let showPhotos = !!S.photo3d || false; S.photo3d = false;
  let bbox = new THREE.Box3();

  // 재질 캐시
  const mats = {};
  function mat(key, color, opts = {}) {
    const k = key + color + JSON.stringify(opts);
    if (opts.fin && RD.tex && FINISHES[opts.fin] && !mats[k]) { const F = FINISHES[opts.fin], t = finishMaps(opts.fin, color); const mm = new THREE.MeshStandardMaterial({ clippingPlanes: clipPlanes, clipShadows: true, color: 0xffffff, map: t.map, roughnessMap: t.roughnessMap, normalMap: t.normalMap, roughness: 1, metalness: F.metal, envMapIntensity: 1 }); mm.normalScale.set(0.8, 0.8); mm.userData.uvSize = F.size; mats[k] = mm; }
    if (!mats[k]) mats[k] = new THREE.MeshStandardMaterial({ clippingPlanes: clipPlanes, clipShadows: true, color, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0, transparent: !!opts.opacity && opts.opacity < 1, opacity: opts.opacity ?? 1, depthWrite: !(opts.opacity < 1), side: opts.double ? THREE.DoubleSide : THREE.FrontSide });
    return mats[k];
  }
  const glassMat = () => { if (RD.quality === 'fast') return mat('glass', M.glass, { opacity: 0.38, rough: 0.05, metal: 0.2, double: true }); const k = 'pglass' + M.glass; if (!mats[k]) mats[k] = new THREE.MeshPhysicalMaterial({ clippingPlanes: clipPlanes, color: M.glass, metalness: 0, roughness: 0.02, transmission: 0.92, thickness: 0.012, ior: 1.52, envMapIntensity: 1.6, side: THREE.DoubleSide, specularIntensity: 1 }); return mats[k]; };

  // 조명기구 발광면: 조명 켜짐과 연동 (applyLights에서 세기 조절)
  const fixMat = new THREE.MeshStandardMaterial({ clippingPlanes: clipPlanes, color: 0xffffff, emissive: kelvin(RD.K), emissiveIntensity: 0, roughness: 0.4 });

  // ---------- Core 1.1.0 객체 형상 ----------
  // 스프링클러 헤드: z = 천장면(헤드 상단), hh = 헤드 높이. 하향식/상향식/측벽형/은폐형
  function sprinklerObj(el, E, pm) {
    const z = E + (el.z ?? 2700), hh = el.hh || 60, r = (el.w || 80) / 2, t = String(el.type || 'pendent');
    const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner); g.position.copy(W3(el.p, z));
    const body = pm || mat('spk', '#c9ccd1', { rough: 0.3, metal: 0.9 }), bulb = pm || mat('spkb', '#e0412f', { rough: 0.2 });
    const cyl = (rr, len, y, mt) => { const me = new THREE.Mesh(new THREE.CylinderGeometry(m(rr), m(rr), m(len), 16), mt); me.position.y = m(y); me.castShadow = true; inner.add(me); return me; };
    if (/conceal|은폐/i.test(t)) { cyl(r, 6, -3, body); return g; }
    cyl(r * 0.6, 4, -2, body); cyl(9, hh * 0.65, -hh * 0.35, body); cyl(3, hh * 0.35, -hh * 0.55, bulb);
    if (/side|측벽/i.test(t)) { const d = new THREE.Mesh(new THREE.BoxGeometry(m(r * 1.6), m(hh * 0.45), m(3)), body); d.position.set(0, m(-hh + hh * 0.22), m(12)); inner.add(d); }
    else cyl(r, 3, -hh + 1.5, body);
    if (/upright|상향/i.test(t)) { inner.rotation.x = Math.PI; inner.position.y = m(-hh); }
    return g;
  }
  // 분전반: 바닥(z0)에서 h 높이 함체, 평면 -y 쪽이 문(전면)
  function panelObj(el, E, pm) {
    const z0 = E + (el.z0 || 0), z1 = z0 + (el.h || 1800), r = (el.rot || 0) * Math.PI / 180, w = el.w || 600, d = el.d || 250;
    const g = new THREE.Group(); g.add(boxAt(el.p, w, d, el.rot, z0, z1, pm || mat('pnl', '#b9bec6', { rough: 0.45, metal: 0.6 })));
    const off = d / 2 + 4, fp = [el.p[0] + Math.sin(r) * off, el.p[1] - Math.cos(r) * off];
    if (w > 80 && z1 - z0 > 80) g.add(boxAt(fp, w - 40, 8, el.rot, z0 + 20, z1 - 20, pm || mat('pnld', '#9aa1ab', { rough: 0.4, metal: 0.65 })));
    return g;
  }
  // 조명기구: z = 천장면(기구 상단), 평판=사각, 다운라이트=원형. 하부 발광면은 fixMat
  function lightObj(el, E, pm) {
    const z = E + (el.z ?? 2700), hh = el.hh || 50, w = el.w || 600, d = el.d || w; const g = new THREE.Group();
    const frame = pm || mat('lgtf', '#e4e5e7', { rough: 0.4, metal: 0.3 }), face = pm || fixMat;
    if (isRound(el)) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(m(w / 2), m(w / 2), m(hh), 24), frame); c.position.copy(W3(el.p, z - hh / 2)); g.add(c);
      const f = new THREE.Mesh(new THREE.CylinderGeometry(m(w / 2 - 12), m(w / 2 - 12), m(2), 24), face); f.position.copy(W3(el.p, z - hh - 1)); g.add(f);
    } else {
      g.add(boxAt(el.p, w, d, el.rot, z - hh, z, frame));
      const f = boxAt(el.p, Math.max(10, w - 24), Math.max(10, d - 24), el.rot, z - hh - 2, z - hh, face); f.castShadow = false; g.add(f);
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = false; });
    return g;
  }
  // 천장: 외곽 폴리곤, 하단 z ~ 상단 z+t
  function ceilingObj(el, E, pm, xr) {
    if (!el.pts || el.pts.length < 3) return null;
    const F = ceilFinish(el.fin); const mt = pm || xr(F.color) || mat('clg', F.color, F.fin ? { fin: F.fin } : { rough: F.rough });
    const shape = new THREE.Shape(el.pts.map(q => new THREE.Vector2(m(q[0] - bx), m(q[1] - by))));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: m(el.t || 20), bevelEnabled: false }); geo.rotateX(-Math.PI / 2); if (mt.userData?.uvSize) worldUV(geo, mt.userData.uvSize);
    const o = new THREE.Mesh(geo, mt); o.position.y = m(E + (el.z ?? 2700)); o.castShadow = o.receiveShadow = true; return o;
  }

  // 상자 메시: 평면 중심선 a→b, 폭 w, z0~z1
  function boxAlong(a, b, w, z0, z1, mt) {
    const L = dist(a, b); if (L < 1 || z1 - z0 < 1) return null;
    const geo = new THREE.BoxGeometry(m(L), m(z1 - z0), m(w));
    if (mt?.userData?.uvSize) worldUV(geo, mt.userData.uvSize);
    const mesh = new THREE.Mesh(geo, mt); const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    mesh.position.copy(W3(c, (z0 + z1) / 2)); mesh.rotation.y = angOf(a, b);
    mesh.castShadow = mesh.receiveShadow = true; return mesh;
  }
  function boxAt(p, w, d, rotDeg, z0, z1, mt) {
    const geo = new THREE.BoxGeometry(m(w), m(z1 - z0), m(d)); if (mt?.userData?.uvSize) worldUV(geo, mt.userData.uvSize); const mesh = new THREE.Mesh(geo, mt);
    mesh.position.copy(W3(p, (z0 + z1) / 2)); mesh.rotation.y = (rotDeg || 0) * Math.PI / 180; mesh.castShadow = mesh.receiveShadow = true; return mesh;
  }
  function hSection(a, b, sec, top, mt) { // 철골보 H형
    const s = SECTIONS[sec]; if (!s) return null; const g = new THREE.Group();
    const tf = Math.max(9, s.h * 0.035), tw = Math.max(6, s.b * 0.04);
    [boxAlong(a, b, s.b, top - tf, top, mt), boxAlong(a, b, s.b, top - s.h, top - s.h + tf, mt), boxAlong(a, b, tw, top - s.h + tf, top - tf, mt)].forEach(x => x && g.add(x));
    return g;
  }
  function hColumn(p, sec, rotDeg, z0, z1, mt) {
    const s = SECTIONS[sec]; if (!s) return null; const g = new THREE.Group(); const tf = Math.max(9, s.h * 0.05), tw = Math.max(6, s.b * 0.04);
    const r = (rotDeg || 0) * Math.PI / 180; const off = (x, y) => [p[0] + x * Math.cos(r) - y * Math.sin(r), p[1] + x * Math.sin(r) + y * Math.cos(r)];
    g.add(boxAt(off(0, s.h / 2 - tf / 2), s.b, tf, rotDeg, z0, z1, mt), boxAt(off(0, -s.h / 2 + tf / 2), s.b, tf, rotDeg, z0, z1, mt), boxAt(p, tw, s.h - 2 * tf, rotDeg, z0, z1, mt));
    return g;
  }

  // 외벽 판정용 건물 외곽
  // ---------- 리비전 ----------
  let VP = P; const RV = { cur: S.rev3d ?? null, base: 'prev', diff: null, baseSnap: null, show: true, ghost: true, play: false, dimOthers: true };
  function buildModel() {
    buildInto(VP, {});
    if (RV.diff && RV.show && RV.ghost && RV.baseSnap && RV.diff.removedObjs.length) {
      const only = new Set(RV.diff.removedObjs.map(x => x.el.id));
      buildInto({ ...P, ...RV.baseSnap }, { keep: true, only, ghost: true });
    }
    mergeStatic(); rowsCache = null; netCache = null; refreshSel(); if (SEC.on) updateSec();
  }
  // 대형 모델: 같은 재질 메시를 합쳐 그리기 호출 수를 줄임 (원본은 숨겨 선택·속성용으로 유지)
  function mergeStatic() {
    let n = 0; model.traverse(o => { if (o.isMesh) n++; }); st.meshes = n; if (n < 1500) return;
    model.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(model.matrixWorld).invert(); const groups = new Map();
    model.traverse(o => { if (!o.isMesh || !o.visible || o.userData.mergedMesh || o.material.isMeshBasicMaterial) return; const k = o.material.uuid; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); });
    const out = new THREE.Group(); out.userData.mergedGroup = true; let saved = 0;
    for (const [, list] of groups) {
      if (list.length < 4) continue;
      const geos = []; for (const o of list) { let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a); if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); if (!g.attributes.normal) g.computeVertexNormals(); g.clearGroups(); g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)); geos.push(g); }
      const mg = mergeGeometries(geos, false); geos.forEach(g => g.dispose()); if (!mg) continue;
      const mm = new THREE.Mesh(mg, list[0].material); mm.castShadow = list.some(o => o.castShadow); mm.receiveShadow = true; mm.userData.mergedMesh = true; out.add(mm);
      for (const o of list) { o.visible = false; o.userData.merged = true; } saved += list.length - 1;
    }
    model.add(out); st.merged = saved;
  }
  let rowsCache = null, netCache = null; const rowsOf = () => (rowsCache ||= takeoff(VP)); const netOf = () => (netCache ||= mepNetwork(VP));
  function buildInto(PP, opt) {
    if (!opt.keep) { model.clear(); markers.clear(); }
    const rows = allElements(PP).filter(r => !opt.only || opt.only.has(r.el.id) || (r.el.k === 'opening' && opt.only.has(r.el.host)));
    const revSt = RV.diff && RV.show ? RV.diff.status : null;
    const wallPts = rows.filter(r => r.el.k === 'wall').flatMap(r => [r.el.a, r.el.b]);
    const bb2 = wallPts.length ? bboxOf(wallPts) : null;
    const isExt = (el) => { if (!bb2) return true; const c = [(el.a[0] + el.b[0]) / 2, (el.a[1] + el.b[1]) / 2]; const t = 600; return Math.abs(c[0] - bb2.x0) < t || Math.abs(c[0] - bb2.x1) < t || Math.abs(c[1] - bb2.y0) < t || Math.abs(c[1] - bb2.y1) < t; };
    const prog = st.period >= 0 ? cumProgress(P, st.period) : null;
    const sst = st.sched && P.sched?.acts?.length ? statusAt(P, st.sched) : null;
    const hiIds = new Set(S.hi?.ids || []);
    const maxElev = st.maxLevel != null ? levelOf(P, st.maxLevel).elev : Infinity;
    const xrayMat = (c) => mat('x', c, { opacity: 0.18 });
    const fixtures = opt.keep ? [] : (st.fixtures = []);
    const endKey = (sid, p) => sid + '|' + Math.round(p[0] / 4) + ',' + Math.round(p[1] / 4); const endCnt = new Map(); const opsBy = new Map();
    for (const o of rows) { if (o.el.k === 'wall') for (const p of [o.el.a, o.el.b]) { const k = endKey(o.sheet.id, p); endCnt.set(k, (endCnt.get(k) || 0) + 1); } else if (o.el.k === 'opening') { if (!opsBy.has(o.el.host)) opsBy.set(o.el.host, []); opsBy.get(o.el.host).push(o.el); } }
    for (const r of rows) {
      const { el, sheet, level } = r; const disc = sheet.disc;
      if (!st.disc[OWN_DISC.has(el.k) ? KINDS[el.k].disc : disc]) continue; if (level.elev > maxElev) continue;
      if (!opt.ghost && (st.hidden.has(el.id) || (el.host && st.hidden.has(el.host)) || (st.iso && !st.iso.has(el.id) && !(el.host && st.iso.has(el.host))))) continue;
      // 구조 부재가 건축 도면에도 있으면(참조) 3D에서는 구조 도면 것만 표시
      if (KINDS[el.k]?.disc === 'S' && disc !== 'S' && rows.some(o => o.sheet.disc === 'S' && o.level.id === level.id && o.el.k === el.k)) continue;
      let p = prog ? (prog[el.id] || 0) : null;
      const ss = sst ? sst[el.id] : null; if (sst && ss && ss.s === 'future') continue;
      if (prog && st.hideUnstarted && !p && el.k !== 'opening') continue;
      const E = level.elev, H = level.height;
      let obj = null, color;
      const progMat = (base) => { if (ss && ss.s === 'active') return mat('sa', '#ff9f43', { rough: 0.6 }); if (!prog) return null; return p >= 100 ? mat('p', '#3fbf7f') : p > 0 ? mat('p', '#e6b450') : mat('p0', '#9aa0a8', { opacity: 0.25 }); };
      const xr = (c) => st.xray && (disc === 'A' || el.k === 'slab' || el.k === 'ceiling') ? xrayMat(c) : null;
      switch (el.k) {
        case 'wall': {
          const wh = el.h ?? H, z0 = E + (el.z0 || 0), z1 = z0 + wh;
          color = el.mat === 'GLASS' ? null : (isExt(el) ? M.ext : M.int);
          const base = el.mat === 'GLASS' ? glassMat() : progMat() || xr(color) || mat('w', color, { rough: el.mat === 'RC' ? 0.9 : 0.8, fin: isExt(el) ? M.t_ext : M.t_int });
          obj = new THREE.Group();
          const dir = norm(sub(el.b, el.a));
          // 다른 벽 끝점과 만나는 모서리는 두께/2 만큼 연장해 3D 이음부 틈을 없앰
          const joins = (pt) => (endCnt.get(endKey(sheet.id, pt)) || 0) > 1;
          const ea = joins(el.a) ? el.t / 2 : 0, eb = joins(el.b) ? el.t / 2 : 0;
          const A0 = [el.a[0] - dir[0] * ea, el.a[1] - dir[1] * ea], B0 = [el.b[0] + dir[0] * eb, el.b[1] + dir[1] * eb];
          const L = dist(A0, B0); const at = (s) => [A0[0] + dir[0] * s, A0[1] + dir[1] * s];
          const ops = (opsBy.get(el.id) || []).slice().sort((a, b) => a.s - b.s);
          let s0 = 0;
          for (const op of ops) {
            const a = clamp(op.s + ea, 0, L), b = clamp(op.s + ea + op.w, 0, L);
            if (a > s0) obj.add(boxAlong(at(s0), at(a), el.t, z0, z1, base));
            const oz0 = E + (op.sill || 0), oz1 = Math.min(z1, oz0 + op.h);
            if (oz0 > z0) obj.add(boxAlong(at(a), at(b), el.t, z0, oz0, base));
            if (oz1 < z1) obj.add(boxAlong(at(a), at(b), el.t, oz1, z1, base));
            if (op.kind === 'window') { const gl = boxAlong(at(a), at(b), 30, oz0, oz1, glassMat()); if (gl) { gl.castShadow = false; obj.add(gl); } const fr = mat('fr', M.frame, { rough: 0.5, metal: 0.4, fin: 'metal' }); [boxAlong(at(a), at(b), el.t * 0.4, oz0, oz0 + 50, fr), boxAlong(at(a), at(b), el.t * 0.4, oz1 - 50, oz1, fr)].forEach(x => x && obj.add(x)); }
            else if (op.kind !== 'sleeve') { const leaf = boxAlong(at(a), at(b), 45, oz0, oz1 - 10, mat('door', '#7a5a3c', { rough: 0.6, fin: 'wood' })); if (leaf) { leaf.position.add(new THREE.Vector3(0, 0, 0)); obj.add(leaf); } }
            s0 = Math.max(s0, b);
          }
          if (s0 < L) obj.add(boxAlong(at(s0), B0, el.t, z0, z1, base));
          obj.children = obj.children.filter(Boolean);
          break;
        }
        case 'column': {
          const z1 = E + (el.h ?? H); const mt = progMat() || (el.mat === 'STEEL' ? mat('st', '#6f7d8c', { rough: 0.45, metal: 0.6 }) : mat('c', M.col, { fin: M.t_col }));
          obj = el.mat === 'STEEL' ? hColumn(el.p, el.sec, el.rot, E, z1, mt) : boxAt(el.p, el.w, el.d, el.rot || 0, E, z1, mt);
          break;
        }
        case 'beam': {
          const top = E + H + (el.dz || 0); const mt = progMat() || (el.mat === 'STEEL' ? mat('st', '#6f7d8c', { rough: 0.45, metal: 0.6 }) : mat('b', M.beam, { fin: M.t_beam }));
          obj = el.mat === 'STEEL' ? hSection(el.a, el.b, el.sec, top, mt) : boxAlong(el.a, el.b, el.w, top - el.d, top, mt);
          break;
        }
        case 'slab': {
          const shape = new THREE.Shape(el.pts.map(q => new THREE.Vector2(m(q[0] - bx), m(q[1] - by))));
          const geo = new THREE.ExtrudeGeometry(shape, { depth: m(el.t), bevelEnabled: false }); geo.rotateX(-Math.PI / 2);
          const top = E + (el.dz || 0); const sm = progMat() || xr(M.slab) || mat('s', M.slab, { fin: M.t_slab }); if (sm.userData?.uvSize) worldUV(geo, sm.userData.uvSize); obj = new THREE.Mesh(geo, sm); obj.position.y = m(top - el.t); obj.castShadow = obj.receiveShadow = true;
          if (!progMat() && !xr(M.slab) && PP.levels.some(l => l.elev > level.elev) && M.t_floor) { const fm = mat('fl', M.floor, { fin: M.t_floor }); const fg = new THREE.ShapeGeometry(shape); fg.rotateX(-Math.PI / 2); if (fm.userData?.uvSize) worldUV(fg, fm.userData.uvSize); const fl = new THREE.Mesh(fg, fm); fl.position.y = m(el.t) + 0.006; fl.receiveShadow = true; const gg = new THREE.Group(); gg.position.y = obj.position.y; obj.position.y = 0; gg.add(obj, fl); obj = gg; }
          break;
        }
        case 'riser': { const col = sysColor(el.sys) || MEP_COL[el.form] || '#9aa'; const mt = progMat() || mat('ris', col, { rough: 0.4, metal: 0.5 }); if (el.form === 'pipe') { const geo = new THREE.CylinderGeometry(m(el.w / 2), m(el.w / 2), m(H), 14); obj = new THREE.Mesh(geo, mt); obj.position.copy(W3(el.p, E + H / 2)); obj.castShadow = true; } else obj = boxAt(el.p, el.w, el.hh, 0, E, E + H, mt); break; }
        case 'fin': { obj = boxAt(el.p, el.d, el.w, el.rot || 0, E + (el.z0 || 0), E + (el.h ?? H), progMat() || xr(el.color || '#cbb998') || mat('fin', el.color || '#cbb998', { rough: 0.3, metal: 0.85 })); break; }
        case 'furn': { obj = buildFurn(el, { mat }); obj.position.copy(W3(el.p, E + (el.z0 || 0))); obj.rotation.y = (el.rot || 0) * Math.PI / 180; break; }
        case 'footing': obj = boxAt(el.p, el.w, el.d, el.rot, E - el.t, E, progMat() || mat('f', '#8f8a80', { fin: 'concrete' })); break;
        case 'duct': case 'tray': { const zc = E + (el.z ?? 3000); obj = boxAlong(el.a, el.b, el.w, zc - el.hh / 2, zc + el.hh / 2, progMat() || mat(el.k, sysColor(el.sys) || MEP_COL[el.k], { rough: 0.4, metal: 0.5 })); break; }
        case 'pipe': {
          const zc = E + (el.z ?? 3000), L = dist(el.a, el.b); const geo = new THREE.CylinderGeometry(m(el.w / 2), m(el.w / 2), m(L), 16); geo.rotateZ(Math.PI / 2);
          obj = new THREE.Mesh(geo, progMat() || mat('pipe', sysColor(el.sys) || MEP_COL.pipe, { rough: 0.35, metal: 0.5 })); obj.position.copy(W3([(el.a[0] + el.b[0]) / 2, (el.a[1] + el.b[1]) / 2], zc)); obj.rotation.y = angOf(el.a, el.b); obj.castShadow = true;
          break;
        }
        case 'sprinkler': obj = sprinklerObj(el, E, progMat()); break;
        case 'panel': obj = panelObj(el, E, progMat()); break;
        case 'light': {
          obj = lightObj(el, E, progMat());
          if (!opt.ghost) fixtures.push({ id: el.id, lv: level.id, lm: el.lm ?? KINDS.light.def.lm, x: m(el.p[0] - bx), y: m(E + (el.z ?? 2700) - (el.hh || 50)) - 0.06, z: -m(el.p[1] - by) });
          break;
        }
        case 'ceiling': obj = ceilingObj(el, E, progMat(), xr); break;
      }
      if (!obj) continue;
      obj.traverse(o => { o.userData.ref = { id: el.id, sheet: sheet.id }; });
      obj.userData.ref = { id: el.id, sheet: sheet.id };
      if (hiIds.has(el.id)) obj.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.emissive = new THREE.Color('#ff2222'); o.material.emissiveIntensity = 0.7; o.material.transparent = false; o.material.opacity = 1; } });
      if (opt.ghost) { obj.traverse(o => { o.userData.ref = { id: el.id, sheet: sheet.id, removed: true }; if (o.isMesh) { o.material = mat('rg', '#ff4d4d', { opacity: 0.28 }); o.castShadow = false; } }); const ed = []; obj.traverse(o => { if (o.isMesh) ed.push(o); }); for (const o of ed) { const l = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry), new THREE.LineBasicMaterial({ color: 0xff4d4d })); l.position.copy(o.position); l.rotation.copy(o.rotation); l.scale.copy(o.scale); l.userData.ref = o.userData.ref; (o.parent || obj).add(l); } }
      else if (revSt && (revSt[el.id] === 'added' || revSt[el.id] === 'changed' || (el.k === 'opening' && revSt[el.host] === 'changed'))) { const col = revSt[el.id] === 'added' ? '#2ee07a' : '#ffa62b'; obj.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color = new THREE.Color(col); o.material.emissive = new THREE.Color(col); o.material.emissiveIntensity = 0.45; o.material.transparent = false; o.material.opacity = 1; o.material.depthWrite = true; } }); }
      else if (revSt && RV.dimOthers && RD.quality !== 'path' && (RV.diff.added + RV.diff.changed + RV.diff.removed) > 0) obj.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.35; o.material.depthWrite = false; } });
      model.add(obj);
    }
    if (opt.keep) return;
    // 간섭 위치 표시
    for (const q of S.hi?.pts3 || []) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff2222, transparent: true, opacity: 0.85, depthTest: false })); s.position.copy(W3([q[0], q[1]], q[2])); s.renderOrder = 10; markers.add(s); }
    bbox = new THREE.Box3().setFromObject(model); if (bbox.isEmpty()) bbox.set(new THREE.Vector3(-10, 0, -10), new THREE.Vector3(10, 5, 10));
    fitShadow(); buildLights(); updateSun(); if (pt) ptDirty();
  }
  // ---------- 렌더 품질: 고품질(후처리) / 사진(패스트레이싱) ----------
  let composer = null, aoPass = null, bloomPass = null, pt = null, ptTimer = null; const ptInfo = h('div', { class: 'mono', style: { position: 'absolute', left: '50%', bottom: '44px', transform: 'translateX(-50%)', background: '#0f1218dd', border: '1px solid #2a3342', borderRadius: '6px', padding: '4px 10px', fontSize: '12px', display: 'none' } }); holder.append(ptInfo);
  async function setupComposer() {
    if (composer) return;
    const [{ EffectComposer }, { RenderPass }, { GTAOPass }, { UnrealBloomPass }, { OutputPass }, { SMAAPass }] = await Promise.all(['postprocessing/EffectComposer.js', 'postprocessing/RenderPass.js', 'postprocessing/GTAOPass.js', 'postprocessing/UnrealBloomPass.js', 'postprocessing/OutputPass.js', 'postprocessing/SMAAPass.js'].map(p => import('three/addons/' + p)));
    const r = holder.getBoundingClientRect(), pr = renderer.getPixelRatio(); const w = Math.max(1, r.width), hh = Math.max(1, r.height);
    const rt = new THREE.WebGLRenderTarget(w * pr, hh * pr, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt); composer.setPixelRatio(pr); composer.setSize(w, hh);
    composer.addPass(new RenderPass(scene, camera));
    aoPass = new GTAOPass(scene, camera, w, hh); aoPass.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1, scale: 1.1, samples: 12 }); aoPass.blendIntensity = 1; aoPass.enabled = RD.ao; composer.addPass(aoPass);
    bloomPass = new UnrealBloomPass(new THREE.Vector2(w, hh), 0.22, 0.45, 0.92); bloomPass.enabled = RD.bloom; composer.addPass(bloomPass);
    composer.addPass(new OutputPass()); composer.addPass(new SMAAPass(w * pr, hh * pr));
  }
  function dropComposer() { if (!composer) return; composer.passes.forEach(p => p.dispose?.()); composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); composer = null; aoPass = bloomPass = null; }
  async function setQuality(q) {
    const prev = RD.quality; RD.quality = q; ctx.touch('meta');
    if (prev === 'path' && q !== 'path') stopPath();
    if (q === 'fast') dropComposer(); else if (q === 'high') { try { await setupComposer(); } catch (e) { console.warn(e); toast('후처리를 불러오지 못했습니다 — 기본 품질로 표시', 'err'); RD.quality = 'fast'; } }
    sun.shadow.mapSize.set(q === 'fast' ? 2048 : 4096, q === 'fast' ? 2048 : 4096); sun.shadow.map?.dispose(); sun.shadow.map = null;
    clearMats(); buildModel(); if (q === 'path') await startPath(); buildToolbar(); if (st.sideTab === 'set') renderSide();
  }
  async function startPath() {
    if (st.clip.x != null || st.clip.y != null || st.clip.z != null || st.secBox || SEC.on) toast('사진 렌더는 단면(클리핑)을 지원하지 않아 전체 모델로 렌더합니다');
    if (st.mode === 'walk') setMode('orbit');
    try { toast('사진 렌더 준비 중… (형상 가속구조 생성)'); const { WebGLPathTracer } = await import('three-gpu-pathtracer'); pt = new WebGLPathTracer(renderer); pt.filterGlossyFactor = 0.5; pt.minSamples = 1; pt.renderDelay = 0; pt.fadeDuration = 300; pt.tiles.set(2, 2); pt.bounces = 6; pt.dynamicLowRes = true; pt.lowResScale = 0.35;
      for (const g of [selG, markers, measureG, analysisG, photoG]) g.visible = false; scene.fog = null; await ptSet(); ptInfo.style.display = 'block'; }
    catch (e) { console.warn(e); toast('사진 렌더를 시작하지 못했습니다: ' + e.message, 'err'); pt = null; RD.quality = 'high'; }
  }
  async function ptSet() { if (!pt) return; ptInfo.textContent = '광선 추적 준비 중…'; await new Promise(r => setTimeout(r, 30)); pt.setScene(scene, camera); }
  function ptDirty() { clearTimeout(ptTimer); ptTimer = setTimeout(() => ptSet(), 350); }
  function stopPath() { clearTimeout(ptTimer); pt?.dispose?.(); pt = null; ptInfo.style.display = 'none'; for (const g of [selG, markers, measureG, analysisG, photoG]) g.visible = true; updateSun(); }
  controls.addEventListener('change', () => { if (pt) pt.updateCamera(); });
  async function renderStill(scale = 2) {
    const r = holder.getBoundingClientRect(); const w = Math.round(r.width * scale), hh = Math.round(r.height * scale);
    if (pt) { renderer.domElement.toBlob(b => saveFile(`${P.name}_렌더_${pt.samples | 0}spp.png`.replace(/[\\/:*?"<>|]/g, '_'), b), 'image/png'); return; }
    const keepPR = renderer.getPixelRatio(); renderer.setPixelRatio(1); renderer.setSize(w, hh, false); camera.aspect = w / hh; camera.updateProjectionMatrix(); if (composer) { composer.setPixelRatio(1); composer.setSize(w, hh); }
    sunBall.visible = false; selG.visible = false; if (composer) composer.render(); else renderer.render(scene, camera);
    renderer.domElement.toBlob(b => { saveFile(`${P.name}_렌더_${w}x${hh}.png`.replace(/[\\/:*?"<>|]/g, '_'), b); renderer.setPixelRatio(keepPR); if (composer) composer.setPixelRatio(keepPR); selG.visible = true; resize(); updateSun(); }, 'image/png');
  }
  // 실내 조명: 조명기구(light 객체)가 있는 층은 기구 위치·광속을 광원으로, 없는 층은 천장 격자 자동 배치
  const gridG = new THREE.Group(), fixG = new THREE.Group(); lightsG.add(gridG, fixG);
  const MAX_LIGHTS = 32; // WebGL 실시간 광원 한도 (넘으면 인접 기구를 묶어 광속 합산)
  function buildLights() {
    const rects = []; const maxElev = st.maxLevel != null ? levelOf(P, st.maxLevel).elev : Infinity;
    const all = allElements(VP); const fxLv = new Set(all.filter(r => r.el.k === 'light').map(r => r.level.id));
    for (const L of VP.levels) { if (L.elev > maxElev || (L.height || 0) < 2200 || fxLv.has(L.id)) continue; const ws = all.filter(r => r.level.id === L.id && r.el.k === 'wall' && !st.hidden.has(r.el.id)); if (ws.length < 3) continue; const pts = ws.flatMap(r => [r.el.a, r.el.b]); const b = bboxOf(pts); const pad = 600;
      rects.push({ x0: m(b.x0 + pad - bx), x1: m(b.x1 - pad - bx), z0: -m(b.y1 - pad - by), z1: -m(b.y0 + pad - by), y: m(L.elev + L.height) - 0.25 }); }
    const fx = st.fixtures || [];
    const nGrid = rects.length ? buildInteriorLights(gridG, rects, { K: RD.K, lumen: RD.lumen, maxAll: fx.length ? 12 : MAX_LIGHTS }) : (gridG.clear(), 0);
    const fr = buildFixtureLights(fixG, fx, { K: RD.K, maxAll: Math.max(8, MAX_LIGHTS - nGrid) });
    fixMat.emissive.copy(kelvin(RD.K));
    st.lightInfo = { fixtures: fx.length, lm: fr.lm, sources: fr.sources, grid: nGrid, levels: fxLv.size };
    st.nLights = nGrid + fr.sources; applyLights();
  }
  function applyLights() { const on = RD.lights === 'on' || (RD.lights === 'auto' && (st.alt ?? 1) < 0.12); lightsG.visible = on; for (const c of [...gridG.children, ...fixG.children]) c.visible = on; fixMat.emissiveIntensity = on ? 3.5 : 0; }
  function fitShadow() {
    const c = bbox.getCenter(new THREE.Vector3()), r = bbox.getSize(new THREE.Vector3()).length() / 2 + 5;
    const cam = sun.shadow.camera; cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 0.5; cam.far = r * 4; cam.updateProjectionMatrix();
    sun.target.position.copy(c);
  }
  function frame(dir = new THREE.Vector3(1, 0.7, 1.2)) {
    const c = bbox.getCenter(new THREE.Vector3()), r = bbox.getSize(new THREE.Vector3()).length() / 2;
    const sz = bbox.getSize(new THREE.Vector3()), tall = sz.y / Math.max(1, Math.max(sz.x, sz.z));
    const fov = camera.fov * Math.PI / 360, k = (1 / Math.tan(fov)) * (camera.aspect < 1 ? 1 / camera.aspect : 1) * (tall > 2 ? 1.45 : 1.08);
    controls.target.copy(c); camera.position.copy(c).add(dir.normalize().multiplyScalar(r * k + 1)); camera.near = 0.05; camera.far = r * 40 + 500; camera.updateProjectionMatrix(); controls.update();
  }

  // ---------- 뷰큐브 ----------
  const CUBE = [['위', 'rotateX(90deg)', [0, 1, 0.0001]], ['남', '', [0, 0.0001, 1]], ['북', 'rotateY(180deg)', [0, 0.0001, -1]], ['동', 'rotateY(90deg)', [1, 0.0001, 0]], ['서', 'rotateY(-90deg)', [-1, 0.0001, 0]], ['아래', 'rotateX(-90deg)', [0, -1, 0.0001]]];
  const cubeIn = h('div', { class: 'vc-cube' });
  for (const [l, t, d] of CUBE) cubeIn.append(h('div', { class: 'vc-f', style: { transform: `${t} translateZ(30px)` }, onclick: () => viewDir(new THREE.Vector3(...d)) }, l));
  cube.append(h('div', { class: 'vc-scene' }, cubeIn), h('button', { class: 'vc-home', title: '홈 뷰 (등각)', onclick: () => viewDir(new THREE.Vector3(1, 0.7, 1.2)), html: IC.HOME3 }),
    h('div', { class: 'vc-ring' }, ...[['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(([l, a]) => h('span', { style: { transform: `rotate(${a}deg) translateY(-48px) rotate(${-a}deg)` } }, l))));
  function viewDir(d) { if (st.mode === 'walk') setMode('orbit'); const tgt = controls.target.clone(), r = camera.position.distanceTo(tgt); const from = camera.position.clone(), to = tgt.clone().add(d.clone().normalize().multiplyScalar(Math.max(r, 5))); let t0 = null; const step = (t) => { t0 ??= t; const k = Math.min(1, (t - t0) / 350), e = k * (2 - k); camera.position.lerpVectors(from, to, e); camera.lookAt(tgt); if (k < 1) requestAnimationFrame(step); else controls.update(); }; requestAnimationFrame(step); }
  function syncCube() { const v = camera.position.clone().sub(controls.target); const az = Math.atan2(v.x, v.z), el = Math.atan2(v.y, Math.hypot(v.x, v.z)); cubeIn.style.transform = `translateZ(-30px) rotateX(${(-el * 180 / Math.PI).toFixed(1)}deg) rotateY(${(-az * 180 / Math.PI).toFixed(1)}deg)`; cube.querySelector('.vc-ring').style.transform = `rotateX(60deg) rotate(${(az * 180 / Math.PI).toFixed(1)}deg)`; }

  // ---------- 태양 ----------
  let skyTex = null, skyAt = 0;
  function updateSun() {
    const d = localToDate(st.date, st.hour, P.site.tz ?? 9);
    const v = sunVector(d, P.site.lat, P.site.lng, P.site.north || 0);
    const c = bbox.getCenter(new THREE.Vector3()), r = bbox.getSize(new THREE.Vector3()).length() / 2 + 20;
    const dir = new THREE.Vector3(v.x, v.z, -v.y); // 평면 x, 위, -y
    sun.position.copy(c).add(dir.clone().multiplyScalar(r * 1.5)); sunBall.position.copy(c).add(dir.clone().multiplyScalar(r * 2.2));
    const alt = v.altitude; const day = Math.max(0, Math.sin(alt)); st.alt = alt;
    sunBall.visible = alt > 0 && RD.quality !== 'path'; sun.visible = true;
    if (alt > -0.02) { sun.intensity = (alt > 0 ? 0.5 + 2.8 * Math.pow(day, 0.55) : 0.15) * (RD.sunMul ?? 1); sun.color.copy(kelvin(alt > 0.5 ? 5800 : 2200 + Math.max(0, alt) / 0.5 * 3600)); }
    else { // 밤: 달빛(차가운 약한 직사광)
      const md = new THREE.Vector3(-dir.x, 0, -dir.z); if (md.lengthSq() < 1e-6) md.set(0.3, 0, 0.6); md.normalize().multiplyScalar(Math.cos(0.8)); md.y = Math.sin(0.8);
      sun.position.copy(c).add(md.multiplyScalar(r * 1.5)); sun.intensity = 0.22 * (RD.sunMul ?? 1); sun.color.copy(kelvin(8500)); }
    // 물리 기반 하늘 → 배경 + 환경광(IBL)
    const now = performance.now(); const sd = dir.clone().normalize();
    if (!skyTex || now - skyAt > 220 || !st.playing) { const old = skyTex; skyTex = skyTexture(sd, alt, { ground: M.ground }); scene.background = skyTex; scene.environment = skyTex; scene.environmentIntensity = 0.6 + 0.4 * Math.min(1, day * 2); skyAt = now; old?.dispose(); if (pt) ptDirty(); }
    const hc = horizonColor(alt); holder.style.background = '#' + hc.clone().convertLinearToSRGB().getHexString();
    hemi.intensity = 0.04 + 0.12 * day; amb.intensity = 0.02;
    const rr = bbox.getSize(new THREE.Vector3()).length() / 2 + 10; scene.fog = RD.fog && RD.quality !== 'path' ? new THREE.Fog(hc.clone(), rr * 3, rr * 30) : null;
    renderer.toneMappingExposure = Math.pow(2, RD.ev || 0) * (alt > 0.05 ? 1 : 1 + 1.6 * Math.min(1, (0.05 - alt) / 0.2)); // 자동 노출(밤에 눈 적응)
    applyLights();
    const az = (toDeg(v.azimuth) + 180 + 360) % 360; // 북 기준 시계방향
    sunInfo.textContent = `${st.date} ${String(Math.floor(st.hour)).padStart(2, '0')}:${String(Math.round((st.hour % 1) * 60)).padStart(2, '0')} (UTC${P.site.tz >= 0 ? '+' : ''}${P.site.tz})  고도 ${fmt(toDeg(alt), 1)}°  방위 ${fmt(az, 1)}°`;
  }
  function sunTimes() { // 일출·일몰 탐색
    let rise = null, set = null, prev = null;
    for (let t = 0; t <= 24; t += 0.05) { const v = sunVector(localToDate(st.date, t, P.site.tz ?? 9), P.site.lat, P.site.lng, 0); const up = v.altitude > -0.0145; if (prev != null && up !== prev) { if (up) rise = t; else set = t; } prev = up; }
    const f = (t) => t == null ? '-' : `${String(Math.floor(t)).padStart(2, '0')}:${String(Math.round((t % 1) * 60)).padStart(2, '0')}`;
    return `일출 ${f(rise)} · 일몰 ${f(set)}`;
  }

  // ---------- 보행 모드 ----------
  const keys = new Set(); let yaw = 0, pitch = 0;
  function setMode(mode) {
    st.mode = mode;
    if (mode === 'walk') {
      controls.enabled = false;
      const lvSel = P.levels[0]; const c = bbox.getCenter(new THREE.Vector3());
      camera.position.set(c.x, m(lvSel.elev + 1600), c.z); yaw = 0; pitch = 0; applyLook(); walkPad.style.display = 'grid';
      toast('보행 모드: 드래그로 둘러보기, WASD/화살표 또는 화면 버튼으로 이동');
    } else { controls.enabled = true; walkPad.style.display = 'none'; frame(); }
    buildToolbar();
  }
  function applyLook() { const d = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)); camera.lookAt(camera.position.clone().add(d)); }
  const pad = [['', ''], ['▲', 'f'], ['', ''], ['◀', 'l'], ['▼', 'b'], ['▶', 'r'], ['', ''], ['↑층', 'u'], ['↓층', 'd']];
  for (const [l, k] of pad) { const b = h('button', { class: 'btn', style: { visibility: l ? 'visible' : 'hidden', height: '40px', padding: 0 } }, l); b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (k === 'u' || k === 'd') { camera.position.y += (k === 'u' ? 1 : -1) * m(P.levels[1]?.height || 4000); return; } keys.add(k); }); b.addEventListener('pointerup', () => keys.delete(k)); b.addEventListener('pointerleave', () => keys.delete(k)); walkPad.append(b); }
  let look = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; if (st.mode === 'walk') { look = { x: e.clientX, y: e.clientY, yaw, pitch }; } });
  renderer.domElement.addEventListener('pointermove', (e) => { if (look) { yaw = look.yaw + (e.clientX - look.x) * 0.005; pitch = clamp(look.pitch - (e.clientY - look.y) * 0.005, -1.4, 1.4); applyLook(); } });
  renderer.domElement.addEventListener('pointerup', (e) => { look = null; if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 5) pick(e); downAt = null; });
  let downAt = null;
  const onKey = (e) => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return; const k = { w: 'f', ArrowUp: 'f', s: 'b', ArrowDown: 'b', a: 'l', ArrowLeft: 'l', d: 'r', ArrowRight: 'r' }[e.key]; if (!k || st.mode !== 'walk') return; e.preventDefault(); if (e.type === 'keydown') keys.add(k); else keys.delete(k); };
  window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey);
  const onSelKey = (e) => { if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || st.mode === 'walk' || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.modal')) return; const k = e.key.toLowerCase(); if (k === 'h') hideSel(); else if (k === 'i') isolateSel(); else if (k === 'u') showAll(); else if (k === 'f') zoomSel(); else if (e.key === 'Escape') { sel.clear(); selRef.clear(); onSel(); } else return; e.preventDefault(); };
  window.addEventListener('keydown', onSelKey);

  // ---------- 선택 ----------
  const ray = new THREE.Raycaster();
  function pick(e) {
    const r = renderer.domElement.getBoundingClientRect(); const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(v, camera);
    if (showPhotos && photoG.children.length) { const hp = ray.intersectObjects(photoG.children, false)[0]; if (hp) return showPhoto(hp.object.userData.photo); }
    if (st.secPick) { const hs = ray.intersectObjects([...model.children, ground], true).find(i => !isClipped(i.point) && (i.object.visible || i.object.userData.merged)); if (hs) secPickPoint(hs.point); return; }
    if (st.measure) { const hm = ray.intersectObjects([...model.children, ground], true).find(i => !isClipped(i.point)); if (hm) addMeasurePoint(hm.point); return; }
    const hit = ray.intersectObjects(model.children, true).find(i => i.object.userData.ref && !isClipped(i.point) && (i.object.visible || i.object.userData.merged));
    const add = e.ctrlKey || e.metaKey || e.shiftKey;
    if (!hit) { if (!add) { sel.clear(); selRef.clear(); lastHit = null; onSel(); } return; }
    const ref = hit.object.userData.ref; lastHit = hit.point.clone();
    if (add) { if (sel.has(ref.id)) { sel.delete(ref.id); selRef.delete(ref.id); } else { sel.add(ref.id); selRef.set(ref.id, ref); } }
    else { sel.clear(); selRef.clear(); sel.add(ref.id); selRef.set(ref.id, ref); }
    onSel();
  }
  let lastHit = null;
  // ---------- 선택·숨기기·분리 ----------
  const selG = new THREE.Group(); scene.add(selG);
  function refreshSel() {
    selG.clear(); if (!sel.size) return;
    const boxes = new Map(); model.traverse(o => { const id = o.userData.ref?.id; if (o.isMesh && sel.has(id)) { if (!boxes.has(id)) boxes.set(id, new THREE.Box3()); boxes.get(id).expandByObject(o); } });
    for (const b of boxes.values()) { const hh = new THREE.Box3Helper(b.expandByScalar(0.02), 0x3fa9ff); hh.renderOrder = 40; hh.material.depthTest = false; hh.material.transparent = true; selG.add(hh); }
  }
  function onSel() { refreshSel(); st.sideTab = 'prop'; renderSide(); markTree(); buildToolbar(); if (sel.size && window.innerWidth <= 800) side.classList.add('open'); }
  const findEl = (id) => { const ref = selRef.get(id); const SRC = ref?.removed && RV.baseSnap ? { ...P, ...RV.baseSnap } : VP; const sh = SRC.sheets.find(x => x.id === ref?.sheet) || SRC.sheets.find(x => SRC.content[x.id]?.els.some(e => e.id === id)); const el = sh && SRC.content[sh.id]?.els.find(x => x.id === id); return el ? { el, sh, lv: levelOf(SRC, sh.level), removed: !!ref?.removed } : null; };
  function hideSel() { if (!sel.size) return toast('먼저 객체를 선택하세요 (클릭, Ctrl+클릭으로 여러 개)'); for (const id of sel) st.hidden.add(id); sel.clear(); selRef.clear(); saveHidden(); buildModel(); renderTree(); onSel(); }
  function isolateSel() { if (!sel.size) return toast('먼저 객체를 선택하세요'); st.iso = new Set(sel); buildModel(); buildToolbar(); toast(`${sel.size}개만 표시 (분리) — "모두 표시"로 해제`); }
  function showAll() { st.hidden.clear(); st.iso = null; saveHidden(); buildModel(); renderTree(); buildToolbar(); }
  function zoomSel() { const b = sel.size ? selBox3() : null; if (!b || b.isEmpty()) return frame(); const c = b.getCenter(new THREE.Vector3()); const r = Math.max(2, b.getSize(new THREE.Vector3()).length()); const dir = camera.position.clone().sub(controls.target).normalize(); controls.target.copy(c); camera.position.copy(c).add(dir.multiplyScalar(r * 1.6)); controls.update(); }
  function selectIds(ids, add) { if (!add) { sel.clear(); selRef.clear(); } for (const id of ids) { sel.add(id); const r = allElements(VP).find(x => x.el.id === id); if (r) selRef.set(id, { id, sheet: r.sheet.id }); } onSel(); }
  // 속성 팔레트 (Revit 방식)
  function propsPanel() {
    info.innerHTML = ''; info.style.display = 'block';
    if (!sel.size) {
      const cnt = {}; for (const r of allElements(VP)) if (r.el.k !== 'opening') cnt[r.sheet.disc] = (cnt[r.sheet.disc] || 0) + 1;
      add2(info, h('div', { class: 'note' }, '선택된 객체가 없습니다. 3D에서 클릭하거나 왼쪽 선택 트리에서 고르세요. Ctrl/Shift+클릭으로 여러 개를 선택합니다.'),
        h('div', { class: 'ptbl' }, ...Object.entries(cnt).map(([d, n]) => [h('span', {}, `${d} ${DISC[d]?.name || ''}`), h('span', {}, `${n}개`)]).flat()),
        h('div', { class: 'note', style: { marginTop: '8px' } }, '단축키: H 숨기기 · I 분리 · U 모두 표시 · F 선택 확대 · Esc 선택 해제'), st.hidden.size || st.iso ? h('button', { class: 'btn sm', style: { marginTop: '6px' }, onclick: showAll }, `숨김 ${st.hidden.size}개${st.iso ? ' · 분리 중' : ''} — 모두 표시`) : null);
      return;
    }
    const items = [...sel].map(findEl).filter(Boolean);
    const rows = rowsOf().filter(r => sel.has(r.el.id)); const byCode = {}; for (const r of rows) byCode[r.code] = (byCode[r.code] || 0) + r.qty;
    const qtyTbl = Object.keys(byCode).length ? h('div', { class: 'ptbl' }, ...Object.entries(byCode).map(([c, q]) => { const b = P.boq.find(x => x.code === c); return [h('span', {}, b ? b.name : c), h('span', { class: 'mono' }, `${fmt(q, 3)} ${b?.unit || ''}`)]; }).flat()) : h('div', { class: 'note' }, '산출 물량 없음 (참조 객체이거나 물량 대상이 아님)');
    const btns = h('div', { class: 'row', style: { marginTop: '8px', flexWrap: 'wrap', gap: '4px' } },
      h('button', { class: 'btn sm', onclick: zoomSel }, '확대'), h('button', { class: 'btn sm', onclick: hideSel }, '숨기기'), h('button', { class: 'btn sm', onclick: isolateSel }, '분리'),
      h('button', { class: 'btn sm', onclick: () => { const b = selBox3(); if (!b.isEmpty()) { setSecBox(b.expandByScalar(1)); toast('선택 객체 주변으로 단면 상자'); } } }, '단면 상자'));
    if (items.length === 1) {
      const { el, sh, lv, removed } = items[0]; const pr = st.period >= 0 ? cumProgress(P, st.period)[el.id] || 0 : null;
      const G = (title, kv) => { const v = kv.filter(x => x[1] != null && x[1] !== ''); if (!v.length) return null; return h('div', {}, h('div', { class: 'pgrp' }, title), h('div', { class: 'ptbl' }, ...v.map(([k, x]) => [h('span', {}, k), h('span', {}, String(x))]).flat())); };
      const sz = el.k === 'pipe' ? `Ø${el.w}` : el.k === 'wall' ? `t${el.t} · L${fmt0(Math.hypot(el.b[0] - el.a[0], el.b[1] - el.a[1]))}` : el.k === 'slab' ? `t${el.t}` : el.sec ? el.sec : el.w ? `${el.w}×${el.d ?? el.hh ?? ''}` : '';
      add2(info, h('div', { class: 'ptitle' }, el.tag ? `${el.tag} · ${elName(el)}` : elName(el)),
        removed ? h('div', { style: { color: '#ff6b6b', fontSize: '12px' } }, `삭제된 객체 — ${RV.baseName}에만 있음`) : null,
        RV.diff?.status[el.id] ? h('div', { style: { color: { added: '#2ee07a', changed: '#ffa62b', removed: '#ff6b6b' }[RV.diff.status[el.id]], fontSize: '12px' } }, `${{ added: '추가', changed: '변경', removed: '삭제' }[RV.diff.status[el.id]]} — ${RV.baseName} → ${RV.curName}${RV.diff.moved[el.id] > 0.5 ? ` (이동 ${fmt0(RV.diff.moved[el.id])}mm)` : ''}`) : null,
        G('식별 정보', [['유형', KINDS[el.k]?.name], ['부호', el.tag], ['도면', sh.name], ['공종', `${sh.disc} ${DISC[sh.disc]?.name || ''}`], ['구역', el.zone], ['계통', el.sys], ['ID', el.id]]),
        G('구속조건', [['층', `${lv.name} (FL ${fmt0(lv.elev)})`], ['상단 오프셋', el.dz], ['하단 오프셋', el.z0], ['중심 높이', el.z != null ? `FL+${el.z}` : null], ['높이', el.h]]),
        G('치수·재료', [['크기', sz], ['재료', MATS[el.mat]?.name || el.mat], ['회전', el.rot ? el.rot + '°' : null], ['철근비', el.rr ? el.rr + 'kg/m³' : null]]),
        h('div', { class: 'pgrp' }, '물량'), qtyTbl,
        pr != null ? G('기성', [[`누계 진척 (${P.bill.periods[st.period]?.name})`, pr + '%']]) : null,
        ['duct', 'pipe', 'tray', 'riser'].includes(el.k) || (el.k === 'furn' && (el.sys || el.src)) ? (() => { const cs = netOf().compOf.get(el.id) || []; if (!cs.length) return h('div', { class: 'note' }, '계통 정보 없음 (sys 미지정)'); return h('div', {}, h('div', { class: 'pgrp' }, '계통 연결'), ...cs.map(c => h('div', { class: 'row', style: { gap: '6px', margin: '3px 0', flexWrap: 'wrap' } }, h('span', { class: 'pill ' + (c.ok ? 'ok' : 'bad') }, `${SYS[c.sys]?.name || c.sys} ${c.ok ? '연결됨' : '소스 미연결'}`), h('span', { class: 'note' }, `${c.n}구간 · ${c.levels.size}개 층${c.src.length ? ' · 소스 ' + c.src.map(x => x.el.tag || x.el.type).slice(0, 2).join(', ') : ''}`), h('button', { class: 'btn sm', onclick: () => { selectIds(c.ids); toast(`${SYS[c.sys]?.name || c.sys} 계통 ${c.ids.length}개 선택`); } }, '계통 추적')))); })() : null,
        lastHit ? h('div', { class: 'note mono', style: { marginTop: '6px' } }, `클릭점 X ${fmt0(lastHit.x * 1000 + bx)}  Y ${fmt0(-lastHit.z * 1000 + by)}  Z ${fmt0(lastHit.y * 1000)}`) : null, btns,
        h('div', { class: 'row', style: { marginTop: '4px', gap: '4px' } }, h('button', { class: 'btn sm', onclick: () => { S.hi = { ids: [el.id], sheet: sh.id, pts: [el.p || el.a || el.pts?.[0]] }; ctx.go('cad'); } }, '작도에서 보기'), (VP === P && !removed) ? h('button', { class: 'btn sm primary', onclick: () => editPanel(el, sh, lv) }, '속성 편집') : null));
    } else {
      const k = {}; for (const it of items) k[KINDS[it.el.k]?.name || it.el.k] = (k[KINDS[it.el.k]?.name || it.el.k] || 0) + 1;
      add2(info, h('div', { class: 'ptitle' }, `${items.length}개 선택`), h('div', { class: 'ptbl' }, ...Object.entries(k).map(([a, n]) => [h('span', {}, a), h('span', {}, n + '개')]).flat()), h('div', { class: 'pgrp' }, '물량 합계'), qtyTbl, btns);
    }
  }
  // 3D에서 속성 편집 → 작도·물량·간섭에 즉시 반영
  function editPanel(el, sh, lv) {
    const F = [['tag', '부호', 'text'], ['zone', '구역', 'text']];
    const num = (k, l) => F.push([k, l, 'number']);
    if (el.k === 'wall') { num('t', '두께'); num('h', '높이(비우면 층고)'); num('z0', '하단 오프셋'); }
    if (el.k === 'column' || el.k === 'footing') { num('w', '폭 W'); num('d', '깊이 D'); if (el.k === 'column') num('rot', '회전(°)'); if (el.k === 'footing') num('t', '두께'); }
    if (el.k === 'beam') { num('w', '폭 W'); num('d', '춤 D'); num('dz', '상단 오프셋'); }
    if (el.k === 'slab') { num('t', '두께'); num('dz', '상단 오프셋'); }
    if (el.k === 'furn') { num('w', '폭 W'); num('d', '깊이 D'); num('h', '높이'); num('rot', '회전(°)'); num('z0', '바닥에서 띄움'); F.push(['color', '색(#hex)', 'text']); }
    if (['duct', 'pipe', 'tray'].includes(el.k)) { num('w', el.k === 'pipe' ? '관경' : '폭'); if (el.k !== 'pipe') num('hh', '높이'); num('z', '중심 높이(FL+)'); F.push(['sys', '계통', 'text']); }
    const box = h('div', { style: { marginTop: '8px', borderTop: '1px solid var(--line)', paddingTop: '8px' } }); const inputs = {};
    for (const [k, l, t] of F) { const i = h('input', { type: t, value: el[k] ?? '', style: { width: '100%' } }); inputs[k] = i; box.append(h('label', { class: 'fld', style: { display: 'grid', gridTemplateColumns: '90px 1fr', gap: '6px', alignItems: 'center', marginBottom: '4px' } }, h('span', { class: 'note' }, l), i)); }
    if (el.mat && el.k !== 'opening') { const sl = h('select', { style: { width: '100%' } }); for (const [k, mm] of Object.entries(MATS)) sl.append(h('option', { value: k, selected: el.mat === k }, mm.name)); inputs.mat = sl; box.append(h('label', { class: 'fld', style: { display: 'grid', gridTemplateColumns: '90px 1fr', gap: '6px', marginBottom: '4px' } }, h('span', { class: 'note' }, '재료'), sl)); }
    const mv = { x: h('input', { type: 'number', value: 0, style: { width: '100%' } }), y: h('input', { type: 'number', value: 0, style: { width: '100%' } }) };
    box.append(h('div', { class: 'note', style: { margin: '6px 0 2px' } }, '이동 (mm, 평면 X·Y)'), h('div', { class: 'row' }, mv.x, mv.y));
    const apply = () => {
      for (const [k, , t] of F) { const v = inputs[k].value; if (t === 'number') { if (v === '') delete el[k]; else el[k] = +v; } else if (v) el[k] = v; else delete el[k]; }
      if (inputs.mat) el.mat = inputs.mat.value;
      const dx = +mv.x.value || 0, dy = +mv.y.value || 0;
      if (dx || dy) { const T = (p) => [p[0] + dx, p[1] + dy]; if (el.p) el.p = T(el.p); if (el.a) { el.a = T(el.a); el.b = T(el.b); } if (el.pts) el.pts = el.pts.map(T); }
      ctx.touch(sh.id); ctx.bus.emit('model', { from: '3d', id: el.id }); buildModel(); propsPanel(); toast(`${el.tag || elName(el)} 수정 — 작도·물량·간섭에 반영됨`, 'ok');
    };
    const del = () => { const c = P.content[sh.id]; c.els = c.els.filter(x => x.id !== el.id && x.host !== el.id); sel.delete(el.id); ctx.touch(sh.id); ctx.bus.emit('model', {}); buildModel(); onSel(); toast('삭제했습니다'); };
    box.append(h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn sm primary', onclick: apply }, '적용'), h('button', { class: 'btn sm', onclick: del }, '삭제')));
    add2(info, box);
  }
  // 선택 트리 (Navisworks 방식: 층 → 공종 → 객체 종류 → 객체)
  function treeRows() { const all = allElements(VP).filter(r => r.el.k !== 'opening' && !isRefElement(r.el, r.sheet, VP)); return all; }
  function renderTree() {
    tree.innerHTML = ''; tree.style.display = st.treeOpen ? '' : 'none'; tree.classList.toggle('open', st.treeOpen); if (!st.treeOpen) return;
    const q = h('input', { placeholder: '검색 (부호·이름)', value: st.treeQ, style: { width: '100%' } }); q.oninput = () => { st.treeQ = q.value; clearTimeout(q._t); q._t = setTimeout(() => { const pos = q.selectionStart; renderTree(); const n = tree.querySelector('input'); n.focus(); n.setSelectionRange(pos, pos); }, 200); };
    tree.append(h('h4', {}, '선택 트리', h('button', { class: 'btn sm', onclick: () => { st.treeOpen = false; P.view.tree3d = false; renderTree(); buildToolbar(); } }, '닫기')), h('div', { class: 'sec', style: { padding: '6px 8px' } }, q));
    const rows = treeRows().filter(r => !st.treeQ || `${r.el.tag || ''} ${elName(r.el)}`.toLowerCase().includes(st.treeQ.toLowerCase()));
    const body = h('div', { class: 'tr3' }); tree.append(body);
    const node = (label, ids, depth, kids, openKey) => {
      const allHidden = ids.every(id => st.hidden.has(id)), some = ids.some(id => st.hidden.has(id));
      const cb = h('input', { type: 'checkbox', checked: !allHidden, title: '보이기/숨기기' }); cb.indeterminate = some && !allHidden;
      cb.onchange = () => { for (const id of ids) cb.checked ? st.hidden.delete(id) : st.hidden.add(id); saveHidden(); buildModel(); renderTree(); };
      const lab = h('span', { class: 'tl', onclick: (e) => selectIds(ids, e.ctrlKey || e.metaKey || e.shiftKey), ondblclick: () => { selectIds(ids); zoomSel(); } }, label, h('em', {}, ` ${ids.length}`));
      if (!kids) { const d = h('div', { class: 'tn leaf' + (ids.every(id => sel.has(id)) ? ' on' : ''), style: { paddingLeft: depth * 12 + 6 + 'px' }, 'data-ids': ids.join(',') }, cb, lab); return d; }
      const det = h('details', { open: st.treeQ ? true : (P.view.treeOpenKeys ||= {})[openKey] ?? depth < 1 }); det.ontoggle = () => { P.view.treeOpenKeys ||= {}; P.view.treeOpenKeys[openKey] = det.open; };
      det.append(h('summary', { class: 'tn', style: { paddingLeft: depth * 12 + 'px' } }, cb, lab)); for (const k of kids()) det.append(k); return det;
    };
    const levels = [...VP.levels].sort((a, b) => b.elev - a.elev);
    for (const L of levels) {
      const rl = rows.filter(r => r.level.id === L.id); if (!rl.length) continue;
      body.append(node(`${L.name} (FL ${fmt0(L.elev)})`, rl.map(r => r.el.id), 0, () => Object.keys(DISC).map(d => {
        const rd = rl.filter(r => r.sheet.disc === d); if (!rd.length) return null;
        return node(`${d} ${DISC[d].name}`, rd.map(r => r.el.id), 1, () => Object.keys(KINDS).map(k => {
          const rk = rd.filter(r => r.el.k === k); if (!rk.length) return null;
          return node(KINDS[k].name, rk.map(r => r.el.id), 2, () => rk.slice(0, 300).map(r => node(r.el.tag ? `${r.el.tag} · ${elName(r.el)}` : elName(r.el), [r.el.id], 4, null)), `${L.id}/${d}/${k}`);
        }).filter(Boolean), `${L.id}/${d}`);
      }).filter(Boolean), L.id));
    }
    if (!body.children.length) body.append(h('div', { class: 'empty', style: { padding: '16px' } }, '해당 객체 없음'));
  }
  function markTree() { for (const n of tree.querySelectorAll('.tn.leaf')) n.classList.toggle('on', n.dataset.ids.split(',').every(id => sel.has(id))); }

  // ---------- 현장 사진 마커 ----------
  function buildPhotos() {
    photoG.clear(); if (!showPhotos) return;
    const cvs = document.createElement('canvas'); cvs.width = cvs.height = 64; const cx = cvs.getContext('2d'); cx.fillStyle = '#e6b450'; cx.beginPath(); cx.arc(32, 28, 24, 0, Math.PI * 2); cx.fill(); cx.beginPath(); cx.moveTo(20, 46); cx.lineTo(32, 62); cx.lineTo(44, 46); cx.fill(); cx.fillStyle = '#0b0e13'; cx.fillRect(18, 20, 28, 18); cx.fillStyle = '#e6b450'; cx.beginPath(); cx.arc(32, 29, 6, 0, Math.PI * 2); cx.fill();
    const tex = new THREE.CanvasTexture(cvs);
    for (const p of P.photos || []) { if (!p.pt || !p.sheet) continue; const sh = VP.sheets.find(s => s.id === p.sheet) || P.sheets.find(s => s.id === p.sheet); if (!sh) continue; const lv = levelOf(P, sh.level); const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false })); sp.position.copy(W3(p.pt, lv.elev + 1800)); sp.scale.set(0.9, 0.9, 1); sp.renderOrder = 30; sp.userData.photo = p.id; photoG.add(sp); }
  }
  async function showPhoto(id) {
    const p = (P.photos || []).find(x => x.id === id); if (!p) return; const { photoData } = await import('./site.js'); const d = await photoData(ctx, P, id);
    st.sideTab = 'prop'; renderSide(); info.innerHTML = ''; info.style.display = 'block';
    add2(info, d ? h('img', { src: d, style: { width: '100%', borderRadius: '6px', display: 'block' } }) : h('div', { class: 'note' }, '사진을 불러오지 못했습니다'), h('div', { style: { fontWeight: 700, margin: '6px 0 2px' } }, `${p.date} · ${p.name}`), h('div', { class: 'note' }, `${p.stage || ''}${p.pct != null ? ' ' + p.pct + '%' : ''}${p.note ? ' — ' + p.note.slice(0, 120) : ''}`),
      h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { class: 'btn sm', onclick: () => { ctx.state.sheet = p.sheet; ctx.go('site'); } }, '현장 툴에서 열기'), h('button', { class: 'btn sm', onclick: () => { info.style.display = 'none'; } }, '닫기')));
  }

  // ---------- 리비전 타임라인 ----------
  async function setRev(id) {
    RV.cur = id; S.rev3d = id; const list = P.prevs || [];
    if (id == null) { VP = P; RV.curName = '현재'; }
    else { const snap = await loadRev(ctx, id); if (!snap) { toast('리비전 데이터를 불러오지 못했습니다', 'err'); return; } VP = { ...P, ...snap }; RV.curName = list.find(r => r.id === id)?.name; }
    // 비교 기준
    const idx = id == null ? list.length : list.findIndex(r => r.id === id);
    let baseId = RV.base === 'prev' ? (list[idx - 1]?.id ?? null) : RV.base === 'none' ? undefined : RV.base;
    if (baseId === id) baseId = list[idx - 1]?.id ?? null;
    if (baseId === undefined || (baseId == null && idx === 0)) { RV.diff = null; RV.baseSnap = null; RV.baseName = ''; }
    else { const bs = baseId ? await loadRev(ctx, baseId) : snapshotOf(P); RV.baseSnap = bs; RV.baseName = baseId ? list.find(r => r.id === baseId)?.name : '현재'; RV.diff = bs ? diffProject(bs, id == null ? snapshotOf(P) : VP) : null; }
    buildModel(); renderRevBar(); renderTree();
  }
  function renderRevBar() {
    revBar.innerHTML = ''; const list = P.prevs || [];
    revBar.append(h('span', { class: 'note', style: { whiteSpace: 'nowrap' } }, '리비전'));
    const AC = { '승인': '#3fbf7f', '검토중': '#e6b450', '반려': '#ef5f5f' };
    for (const r of list) revBar.append(h('button', { class: 'btn sm' + (RV.cur === r.id ? ' primary' : ''), style: AC[r.approval?.status] ? { boxShadow: `inset 0 -2px 0 ${AC[r.approval.status]}` } : null, title: `${r.approval?.status || '작성'}${r.approval?.by ? ' · ' + r.approval.by : ''}\n${new Date(r.at).toLocaleString('ko-KR')}${r.note ? '\n' + r.note : ''}${r.stats ? `\n추가 ${r.stats.added} · 변경 ${r.stats.changed} · 삭제 ${r.stats.removed}` : ''}`, onclick: () => setRev(r.id) }, r.name));
    revBar.append(h('button', { class: 'btn sm' + (RV.cur == null ? ' primary' : ''), onclick: () => setRev(null) }, '현재'));
    const base = h('select', { title: '비교 기준', style: { padding: '3px 4px', fontSize: '12px' } }, h('option', { value: 'prev', selected: RV.base === 'prev' }, '기준: 직전 Rev'), h('option', { value: 'none', selected: RV.base === 'none' }, '비교 안 함'), ...list.map(r => h('option', { value: r.id, selected: RV.base === r.id }, `기준: ${r.name}`)));
    base.onchange = () => { RV.base = base.value; setRev(RV.cur); };
    const dim = h('button', { class: 'btn sm' + (RV.dimOthers ? ' on' : ''), title: '변경 없는 객체 흐리게', onclick: () => { RV.dimOthers = !RV.dimOthers; buildModel(); renderRevBar(); } }, '변경만 강조');
    const play = h('button', { class: 'btn sm', title: 'Rev 순서대로 자동 전환', onclick: () => { RV.play = !RV.play; renderRevBar(); if (RV.play) stepPlay(); } }, RV.play ? '■' : '▶');
    const save = h('button', { class: 'btn sm', title: '현재 모델을 새 리비전으로 저장', onclick: saveRevDlg }, '+ Rev 저장');
    revBar.append(base, dim, play, save);
    if (RV.diff) { revLegend.style.display = 'block'; revLegend.innerHTML = `<b>${RV.baseName} → ${RV.curName}</b>  <span style="color:#2ee07a">■ 추가 ${RV.diff.added}</span>  <span style="color:#ffa62b">■ 변경 ${RV.diff.changed}</span>  <span style="color:#ff6b6b">▢ 삭제 ${RV.diff.removed}</span>`; }
    else revLegend.style.display = 'none';
    if (!list.length) revBar.append(h('span', { class: 'note', style: { whiteSpace: 'nowrap' } }, '저장된 Rev 없음'));
  }
  async function stepPlay() {
    const list = P.prevs || []; if (!RV.play || !list.length) return;
    const ids = [...list.map(r => r.id), null]; const i = ids.indexOf(RV.cur); const next = ids[(i + 1) % ids.length];
    await setRev(next); setTimeout(() => stepPlay(), 1800);
  }
  async function saveRevDlg() {
    const { dialog } = await import('../js/ui.js'); const list = P.prevs || []; const last = list[list.length - 1];
    const nm = (k) => { const v = !last ? { major: 1, minor: 0 } : k === 'major' ? { major: last.major + 1, minor: 0 } : { major: last.major, minor: last.minor + 1 }; return v.minor ? `Rev${v.major}.${v.minor}` : `Rev${v.major}`; };
    const v = await dialog({ title: '리비전 저장', fields: [{ key: 'k', label: '구분', type: 'select', options: [['minor', `부분 수정 → ${nm('minor')}`], ['major', `주요 개정 → ${nm('major')}`]], value: last ? 'minor' : 'major' }, { key: 'n', label: '변경 내용 메모', type: 'textarea', rows: 3, value: '' }], ok: '저장' });
    if (!v) return; const r = await createRev(ctx, { kind: last ? v.k : 'major', note: v.n }); toast(`${r.name} 저장${r.stats ? ` — 추가 ${r.stats.added}·변경 ${r.stats.changed}·삭제 ${r.stats.removed}` : ''}`, 'ok'); setRev(null);
  }
  const onRevKey = (e) => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || st.mode === 'walk' || !(P.prevs || []).length) return; if (e.key !== '[' && e.key !== ']') return; const ids = [...P.prevs.map(r => r.id), null]; const i = ids.indexOf(RV.cur); setRev(ids[Math.max(0, Math.min(ids.length - 1, i + (e.key === ']' ? 1 : -1)))]); };
  window.addEventListener('keydown', onRevKey);

  // ---------- 단면 ----------
  const isClipped = (p) => clipPlanes.some(pl => pl.distanceToPoint(p) < 0);
  function applyClip() {
    const c = st.clip;
    clipPlanes[0].constant = c.y == null ? 1e6 : c.y; clipPlanes[1].constant = c.x == null ? 1e6 : c.x; clipPlanes[2].constant = c.z == null ? 1e6 : -c.z;
    for (let i = 3; i < 6; i++) clipPlanes[i].constant = 1e6;
    const sp = secPlane(); if (sp) clipPlanes[6].copy(sp.plane); else clipPlanes[6].set(new THREE.Vector3(0, -1, 0), 1e6);
    if (boxHelper) { scene.remove(boxHelper); boxHelper = null; }
    const B = st.secBox; if (!B) return;
    clipPlanes[0].constant = Math.min(clipPlanes[0].constant, B.max.y); clipPlanes[3].constant = -B.min.y;
    clipPlanes[1].constant = Math.min(clipPlanes[1].constant, B.max.x); clipPlanes[4].constant = -B.min.x;
    clipPlanes[2].constant = Math.min(clipPlanes[2].constant, -B.min.z); clipPlanes[5].constant = B.max.z;
    boxHelper = new THREE.Box3Helper(new THREE.Box3(B.min.clone(), B.max.clone()), 0xffa62b); scene.add(boxHelper);
  }

  // ---------- 단면 축 (X·Y·Z·자유) ----------
  // SEC.pos.x: three x(m), SEC.pos.y: 평면 y(m, 북쪽 +), SEC.pos.z: 표고(m), 자유: SEC.ang(평면 각도°, 동=0 반시계) + SEC.off(모델 중심에서 법선 방향 m)
  const secG = new THREE.Group(); scene.add(secG);
  const secCenter = () => bbox.getCenter(new THREE.Vector3());
  function secRaw() {
    const c = secCenter(); let n, p0;
    if (SEC.axis === 'x') { n = new THREE.Vector3(1, 0, 0); p0 = new THREE.Vector3(SEC.pos.x ?? c.x, c.y, c.z); }
    else if (SEC.axis === 'y') { n = new THREE.Vector3(0, 0, -1); p0 = new THREE.Vector3(c.x, c.y, -(SEC.pos.y ?? -c.z)); }
    else if (SEC.axis === 'z') { n = new THREE.Vector3(0, -1, 0); p0 = new THREE.Vector3(c.x, SEC.pos.z ?? c.y, c.z); }
    else { const a = (SEC.ang || 0) * Math.PI / 180; n = new THREE.Vector3(Math.sin(a), 0, Math.cos(a)); p0 = c.clone().addScaledVector(n, SEC.off || 0); }
    return { n, p0 };
  }
  function secPlane() {
    if (!SEC.on) return null; const { n, p0 } = secRaw(); if (SEC.flip) n.negate();
    return { n, p0, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, p0) };
  }
  const secAxisName = () => ({ x: 'X 단면', y: 'Y 단면', z: SEC.flip ? '천장 평면(올려봄)' : '평면 단면(내려봄)', free: '자유 단면' })[SEC.axis];
  function secDir(n) { if (Math.abs(n.y) > 0.7) return n.y < 0 ? '아래' : '위'; const az = (Math.atan2(n.x, -n.z) * 180 / Math.PI + 360 + (P.site.north || 0)) % 360; return ['북', '북동', '동', '남동', '남', '남서', '서', '북서'][Math.round(az / 45) % 8]; }
  function secPosMM() { const sp = secPlane(); if (!sp) return ''; if (SEC.axis === 'x') return `X = ${fmt0(sp.p0.x * 1000 + bx)}`; if (SEC.axis === 'y') return `Y = ${fmt0(-sp.p0.z * 1000 + by)}`; if (SEC.axis === 'z') { const e = sp.p0.y * 1000; const L = [...VP.levels].sort((a, b) => b.elev - a.elev).find(l => l.elev <= e + 1); return `EL${e >= 0 ? '+' : ''}${fmt0(e)}${L ? ` (${L.name} FL+${fmt0(e - L.elev)})` : ''}`; } return `${fmt(SEC.ang, 1)}° · 오프셋 ${fmt0(SEC.off * 1000)}`; }
  function secMeshes() { model.updateMatrixWorld(true); const out = []; model.traverse(o => { if (!o.isMesh || o.userData.mergedMesh) return; const ref = o.userData.ref; if (!ref || ref.removed) return; if (!(o.visible || o.userData.merged)) return; out.push({ mesh: o, id: ref.id }); }); return out; }
  let secTimer = null;
  function updateSec(now) {
    applyClip(); secG.clear(); if (!SEC.on) return;
    const sp = secPlane(); const c = secCenter(), r = bbox.getSize(new THREE.Vector3()).length() * 0.6 + 2;
    const q = c.clone().addScaledVector(sp.n, -sp.plane.distanceToPoint(c));
    if (SEC.plane) {
      const pm = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), new THREE.MeshBasicMaterial({ color: 0xff7a45, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
      pm.position.copy(q); pm.lookAt(q.clone().add(sp.n)); pm.renderOrder = 5; secG.add(pm);
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(pm.geometry), new THREE.LineBasicMaterial({ color: 0xff7a45 })); edge.position.copy(pm.position); edge.quaternion.copy(pm.quaternion); secG.add(edge);
      const ar = new THREE.ArrowHelper(sp.n, q, Math.min(4, r * 0.25), 0xff7a45, 0.6, 0.35); secG.add(ar);
    }
    clearTimeout(secTimer); secTimer = setTimeout(() => { // 절단선 실시간 표시 (이동 중엔 120ms 늦춰 계산)
      if (!SEC.on) return; const p2 = secPlane(); const cut = sectionCut(secMeshes(), p2.plane, clipPlanes.slice(0, 6)); const arr = []; const off = p2.n.clone().multiplyScalar(-0.004);
      for (const segs of cut.values()) for (const [a, b] of segs) arr.push(a.x + off.x, a.y + off.y, a.z + off.z, b.x + off.x, b.y + off.y, b.z + off.z);
      for (const o of [...secG.children]) if (o.userData.cutLines) { o.geometry.dispose(); secG.remove(o); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      const ls = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xff2d2d })); ls.userData.cutLines = true; ls.renderOrder = 6; secG.add(ls); st.secCutN = cut.size;
      const n = side.querySelector('.sec-cutn'); if (n) n.textContent = `절단 객체 ${cut.size}개`;
    }, now ? 0 : 120);
  }
  function setSec(patch) { Object.assign(SEC, patch); ctx.touch('meta'); updateSec(); }
  function secPickPoint(p) {
    st.secPick.push(p.clone()); addMeasurePointMark(p);
    if (st.secPick.length < 2) return toast('단면 절단선: 두 번째 점을 클릭하세요');
    const [a, b] = st.secPick; st.secPick = null; measureG.clear();
    const dx = b.x - a.x, dy = -(b.z - a.z); if (Math.hypot(dx, dy) < 0.05) return toast('두 점이 너무 가깝습니다', 'err');
    const ang = Math.atan2(dy, dx) * 180 / Math.PI; SEC.axis = 'free'; SEC.ang = ang; SEC.on = true; SEC.flip = false;
    const { n } = secRaw(); SEC.off = a.clone().sub(secCenter()).dot(n); SEC.flip = camera.position.clone().sub(a).dot(n) > 0; // 카메라 쪽을 잘라내고 건너편을 봄
    ctx.touch('meta'); updateSec(true); buildToolbar(); goSec('단면 축'); toast('절단선으로 자유 단면을 만들었습니다', 'ok');
  }
  function addMeasurePointMark(p) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff7a45, depthTest: false })); s.position.copy(p); s.renderOrder = 10; measureG.add(s); }
  function secDepthDefault(sp) {
    if (SEC.axis === 'z' && !SEC.flip) { const e = sp.p0.y * 1000; const L = [...VP.levels].sort((a, b) => b.elev - a.elev).find(l => l.elev <= e + 1); if (L) return Math.max(0.2, (e - L.elev) / 1000 - 0.005); } // 바닥면 바로 위까지 (바닥 아래 기초선 제외)
    if (SEC.axis === 'z' && SEC.flip) { const e = sp.p0.y * 1000; const L = [...VP.levels].sort((a, b) => a.elev - b.elev).find(l => l.elev > e + 1); if (L) return Math.max(0.3, (L.elev - e) / 1000 + 0.05); }
    const sz = bbox.getSize(new THREE.Vector3()); return sz.length() + 2;
  }
  async function extractSection() {
    const sp = secPlane(); if (!sp) return toast('단면 축을 먼저 켜세요', 'err');
    if (pt) return toast('사진 렌더 중에는 추출할 수 없습니다 — 품질을 바꾼 뒤 다시 시도하세요', 'err');
    const basis = sectionBasis(sp.n); const extra = clipPlanes.slice(0, 6); const meshes = secMeshes(); const depth = SEC.depth ? SEC.depth / 1000 : secDepthDefault(sp);
    const toUV = basis.horiz ? (p) => [p.x * 1000 + bx, -p.z * 1000 + by] : (p) => [p.dot(basis.right) * 1000, p.y * 1000];
    const info = new Map(); for (const r of allElements(VP)) info.set(r.el.id, { k: r.el.k, disc: KINDS[r.el.k]?.disc || r.sheet.disc, mat: r.el.mat, name: elName(r.el) });
    const prog = h('div', { class: 'mono', style: { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', background: '#0f1218ee', border: '1px solid #2a3342', borderRadius: '8px', padding: '10px 16px', fontSize: '13px', zIndex: 5 } }, '단면 계산 중…'); holder.append(prog);
    await new Promise(r => setTimeout(r, 30));
    try {
      const cutMap = sectionCut(meshes, sp.plane, extra); const cuts = [];
      for (const [id, segs] of cutMap) { const ch = chainSegments(segs.map(([a, b]) => [toUV(a), toUV(b)])); if (ch.loops.length || ch.open.length) cuts.push({ id, info: info.get(id), ...ch }); }
      const lines = await sectionProject(renderer, scene, model, meshes, sp.plane, basis, { depth, extra, toUV, onProgress: (f) => { prog.textContent = `투영선·숨은선 계산 중… ${Math.round(f * 100)}%`; } });
      const res = { cuts, lines, horiz: basis.horiz };
      const meta = { title: `${secAxisName()} — ${secPosMM()}`, sub: `${P.name} · 보는 방향 ${secDir(sp.n)} · 투영 깊이 ${fmt(depth, 1)}m`, levels: basis.horiz ? [] : VP.levels.map(l => ({ name: l.name, elev: l.elev })) };
      showSectionDialog(res, meta);
    } catch (e) { console.warn(e); toast('단면 추출 실패: ' + e.message, 'err'); }
    finally { prog.remove(); }
  }
  function showSectionDialog(res, meta) {
    const { svg, S } = sectionSVG(res, meta); const base = (P.name + '_' + meta.title).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ');
    const bg = h('div', { class: 'modal-bg' }); const box = h('div', { class: 'modal', style: { width: 'min(1200px, 96vw)', height: '90vh', display: 'flex', flexDirection: 'column', padding: '12px' } });
    const view = h('div', { style: { flex: 1, minHeight: 0, background: '#fff', borderRadius: '6px', overflow: 'hidden', position: 'relative', cursor: 'grab', touchAction: 'none' }, html: svg });
    const sv = view.querySelector('svg'); sv.removeAttribute('width'); sv.removeAttribute('height'); Object.assign(sv.style, { width: '100%', height: '100%', display: 'block' });
    let vb = sv.getAttribute('viewBox').split(' ').map(Number); const vb0 = vb.slice(); const setVB = () => sv.setAttribute('viewBox', vb.map(v => v.toFixed(1)).join(' '));
    view.addEventListener('wheel', (e) => { e.preventDefault(); const r = view.getBoundingClientRect(); const k = e.deltaY > 0 ? 1.15 : 1 / 1.15; const sx = vb[2] / r.width, sy = vb[3] / r.height, s = Math.max(sx, sy); const fx = vb[0] + (e.clientX - r.left - (r.width - vb[2] / s) / 2) * s, fy = vb[1] + (e.clientY - r.top - (r.height - vb[3] / s) / 2) * s; vb = [fx - (fx - vb[0]) * k, fy - (fy - vb[1]) * k, vb[2] * k, vb[3] * k]; setVB(); }, { passive: false });
    let drag = null; view.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, vb: vb.slice() }; view.setPointerCapture(e.pointerId); view.style.cursor = 'grabbing'; });
    view.addEventListener('pointermove', (e) => { if (!drag) return; const r = view.getBoundingClientRect(); const s = Math.max(vb[2] / r.width, vb[3] / r.height); vb = [drag.vb[0] - (e.clientX - drag.x) * s, drag.vb[1] - (e.clientY - drag.y) * s, vb[2], vb[3]]; setVB(); });
    view.addEventListener('pointerup', () => { drag = null; view.style.cursor = 'grab'; });
    const close = () => { bg.remove(); window.removeEventListener('keydown', onEsc); }; const onEsc = (e) => { if (e.key === 'Escape') close(); }; window.addEventListener('keydown', onEsc);
    const png = () => { const img = new Image(); const [, , w, hh] = vb0; const pxPerMM = 8; const W = Math.round(w / S * pxPerMM), H = Math.round(hh / S * pxPerMM); img.onload = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(img, 0, 0, W, H); c.toBlob(b => saveFile(base + '.png', b), 'image/png'); }; img.onerror = () => toast('PNG 변환 실패', 'err'); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); };
    const cutN = res.cuts.length, lineN = res.lines.length;
    box.append(h('div', { class: 'row', style: { gap: '6px', marginBottom: '8px', alignItems: 'center', flexWrap: 'wrap' } },
      h('h3', { style: { margin: 0, marginRight: 'auto', fontSize: '15px' } }, meta.title),
      h('span', { class: 'note' }, `절단 객체 ${cutN}개 · 투영선 ${lineN}개 · 축척 1/${S} (A3)`),
      h('button', { class: 'btn sm', onclick: () => { vb = vb0.slice(); setVB(); } }, '전체 보기'),
      h('button', { class: 'btn sm', onclick: () => saveFile(base + '.svg', new Blob([svg], { type: 'image/svg+xml' })) }, 'SVG 저장'),
      h('button', { class: 'btn sm', onclick: () => saveFile(base + '.dxf', new Blob([sectionDXF(res, meta)], { type: 'application/dxf' })) }, 'DXF 저장'),
      h('button', { class: 'btn sm', onclick: png }, 'PNG 저장'),
      h('button', { class: 'btn sm', onclick: close }, '닫기')), view,
      h('div', { class: 'note', style: { marginTop: '6px' } }, '굵은 선·해치 = 절단면(RC는 사선 해치, 벽은 회색), 가는 선 = 평면 너머 투영선(가려진 선 제거). 휠: 확대·축소, 끌기: 이동. DXF는 작도 툴에서 가져올 수 있습니다(레이어 단면-절단·투영·레벨·문자).'));
    bg.append(box); bg.addEventListener('pointerdown', (e) => { if (e.target === bg) close(); }); document.body.append(bg);
  }
  let boxHelper = null;
  function setSecBox(b) { if (!b) { st.secBox = null; applyClip(); return; } st.secBox = { min: b.min.clone(), max: b.max.clone() }; applyClip(); }
  function selBox3() { const b = new THREE.Box3(); model.traverse(o => { if (o.isMesh && sel.has(o.userData.ref?.id) && !o.userData.ref.removed) b.expandByObject(o); }); return b; }
  // ---------- 측정 ----------
  let mPts = [];
  function label3d(text, pos, color = '#ffd866') {
    const cvs = document.createElement('canvas'); const cx = cvs.getContext('2d'); cx.font = '600 28px "JetBrains Mono", monospace'; const w = cx.measureText(text).width + 24; cvs.width = w; cvs.height = 44;
    cx.fillStyle = '#0f1218dd'; cx.fillRect(0, 0, w, 44); cx.strokeStyle = color; cx.strokeRect(1, 1, w - 2, 42); cx.fillStyle = color; cx.font = '600 28px "JetBrains Mono", monospace'; cx.fillText(text, 12, 31);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cvs), depthTest: false })); sp.position.copy(pos); const k = bbox.getSize(new THREE.Vector3()).length() / 60 + 0.4; sp.scale.set(k * w / 44, k, 1); sp.renderOrder = 20; return sp;
  }
  function addMeasurePoint(p) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd866, depthTest: false })); dot.position.copy(p); dot.renderOrder = 19; measureG.add(dot);
    mPts.push(p.clone());
    if (mPts.length === 2) {
      const [a, b] = mPts; const geo = new THREE.BufferGeometry().setFromPoints([a, b]); const ln = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd866, depthTest: false })); ln.renderOrder = 19; measureG.add(ln);
      const d = a.distanceTo(b) * 1000, dz = (b.y - a.y) * 1000, dh = Math.hypot(b.x - a.x, b.z - a.z) * 1000;
      measureG.add(label3d(`${fmt0(d)} mm  (수평 ${fmt0(dh)} / 높이 ${fmt0(dz)})`, a.clone().add(b).multiplyScalar(0.5)));
      toast(`거리 ${fmt0(d)} mm · 수평 ${fmt0(dh)} · 높이차 ${fmt0(dz)}`); mPts = [];
    }
  }
  // ---------- 일조 분석 ----------
  function sunSamples(date, from, to, step) { const out = []; for (let t = from; t <= to + 1e-9; t += step) { const v = sunVector(localToDate(date, t, P.site.tz ?? 9), P.site.lat, P.site.lng, P.site.north || 0); if (v.altitude > 0.02) out.push({ t, dir: new THREE.Vector3(v.x, v.z, -v.y).normalize() }); } return out; }
  async function runSunAnalysis(mode, res = 1) {
    analysisG.clear();
    const b = bbox.clone(); const size = b.getSize(new THREE.Vector3()); const pad = Math.max(size.x, size.z) * 0.6 + 5;
    const x0 = b.min.x - pad, x1 = b.max.x + pad, z0 = b.min.z - pad, z1 = b.max.z + pad;
    const nx = Math.min(140, Math.ceil((x1 - x0) / res)), nz = Math.min(140, Math.ceil((z1 - z0) / res)); const dx = (x1 - x0) / nx, dz = (z1 - z0) / nz;
    const date = mode === 'law' ? `${st.date.slice(0, 4)}-12-22` : st.date;
    const samples = mode === 'law' ? sunSamples(date, 8, 16, 0.25) : sunSamples(date, 0, 24, 0.25);
    const meshes = []; model.traverse(o => { if (o.isMesh && !o.material.transparent) meshes.push(o); });
    const rc = new THREE.Raycaster(); rc.far = 500; const vals = new Float32Array(nx * nz); const o = new THREE.Vector3();
    const prog = toast; let lastYield = performance.now();
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        o.set(x0 + (i + 0.5) * dx, 0.05, z0 + (j + 0.5) * dz);
        // 건물 내부(지붕 아래)는 제외
        rc.set(o, new THREE.Vector3(0, 1, 0)); if (rc.intersectObjects(meshes, false).length) { vals[j * nx + i] = -1; continue; }
        const lit = samples.map(sm => { rc.set(o, sm.dir); return rc.intersectObjects(meshes, false).length === 0; });
        if (mode === 'law') {
          // 동지 09~15시 연속 2시간 이상 또는 08~16시 총 4시간 이상
          let run = 0, best = 0, tot = 0; samples.forEach((sm, k) => { if (lit[k]) { tot += 0.25; if (sm.t >= 9 && sm.t <= 15) { run += 0.25; best = Math.max(best, run); } } else run = 0; });
          vals[j * nx + i] = (best >= 2 || tot >= 4) ? 1 : 0;
        } else vals[j * nx + i] = lit.filter(Boolean).length * 0.25;
      }
      if (performance.now() - lastYield > 40) { await new Promise(r => setTimeout(r, 0)); lastYield = performance.now(); }
    }
    let max = 0; for (const v of vals) max = Math.max(max, v);
    const cvs = document.createElement('canvas'); cvs.width = nx; cvs.height = nz; const cx = cvs.getContext('2d'); const img = cx.createImageData(nx, nz);
    const ramp = (t) => { const c = new THREE.Color(); c.setHSL(0.66 - 0.66 * t, 0.85, 0.5); return c; };
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const v = vals[j * nx + i], k = (j * nx + i) * 4; if (v < 0) { img.data[k + 3] = 0; continue; } const c = mode === 'law' ? (v ? new THREE.Color('#3fbf7f') : new THREE.Color('#ef5f5f')) : ramp(max ? v / max : 0); img.data[k] = c.r * 255; img.data[k + 1] = c.g * 255; img.data[k + 2] = c.b * 255; img.data[k + 3] = 200; }
    cx.putImageData(img, 0, 0); const tex = new THREE.CanvasTexture(cvs); tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })); pl.rotation.x = -Math.PI / 2; pl.position.set((x0 + x1) / 2, 0.03, (z0 + z1) / 2); pl.renderOrder = 2; analysisG.add(pl);
    const fail = mode === 'law' ? [...vals].filter(v => v === 0).length : 0, cells = [...vals].filter(v => v >= 0).length;
    st.sunMap = { mode, max, date, fail, cells, n: samples.length };
    renderSide();
  }

  // ---------- 툴바·패널 ----------
  function buildToolbar() {
    tb.innerHTML = '';
    const tabs = [['home', '홈'], ['view', '보기'], ['render', '렌더링'], ['review', '검토'], ['analysis', '분석'], ['sim', '4D·5D']];
    const cur = P.view.rb3d || 'home';
    const tabRow = h('div', { class: 'rb-tabs' }); for (const [k, l] of tabs) tabRow.append(h('button', { class: 'rb-tab' + (cur === k ? ' on' : ''), onclick: () => { P.view.rb3d = k; buildToolbar(); } }, l));
    tabRow.append(h('span', { class: 'fill' }), h('span', { class: 'note', style: { fontSize: '11.5px', marginRight: '6px' } }, `${RV.curName || '현재'}${sel.size ? ` · 선택 ${sel.size}` : ''}${st.hidden.size ? ` · 숨김 ${st.hidden.size}` : ''}${st.iso ? ' · 분리' : ''}`), h('button', { class: 'rb-sm show-m', onclick: () => side.classList.toggle('open') }, '속성'));
    const big = (ic, label, fn, on, title) => h('button', { class: 'rb-big' + (on ? ' on' : ''), title: title || label, onclick: fn, html: (IC[ic] || '') + `<span>${label}</span>` });
    const sm = (ic, label, fn, on, title) => h('button', { class: 'rb-sm' + (on ? ' on' : ''), title: title || label, onclick: fn, html: (IC[ic] || '') + `<span>${label}</span>` });
    const col = (...xs) => h('div', { class: 'rb-col' }, ...xs);
    const group = (title, ...items) => h('div', { class: 'rb-group' }, h('div', { class: 'rb-items' }, ...items), h('div', { class: 'rb-title' }, title));
    const R = () => buildToolbar();
    const discCol = () => { const ks = Object.keys(DISC); const half = Math.ceil(ks.length / 2); return [col(...ks.slice(0, half).map(d => sm('', `${d} ${DISC[d].name}`, () => { st.disc[d] = !st.disc[d]; buildModel(); R(); }, st.disc[d], '공종 표시'))), col(...ks.slice(half).map(d => sm('', `${d} ${DISC[d].name}`, () => { st.disc[d] = !st.disc[d]; buildModel(); R(); }, st.disc[d], '공종 표시')))]; };
    const panels = {
      home: [group('탐색', big('ORBIT', '궤도', () => setMode('orbit'), st.mode === 'orbit'), big('WALK', '보행', () => setMode('walk'), st.mode === 'walk'), col(sm('HOME3', '전체 보기', () => { setMode('orbit'); frame(); }), sm('ZOOMSEL', '선택 확대 (F)', zoomSel), sm('CAPTURE', '화면 캡처', capture))),
        group('선택', col(sm('HIDE', '숨기기 (H)', hideSel), sm('ISOLATE', '분리 (I)', isolateSel, !!st.iso), sm('SHOWALL', '모두 표시 (U)', showAll)), col(sm('TREE', '선택 트리', () => { st.treeOpen = !st.treeOpen; P.view.tree3d = st.treeOpen; renderTree(); R(); }, st.treeOpen), sm('PROPS', '속성', () => { st.sideTab = 'prop'; renderSide(); side.classList.add('open'); }), sm('', '선택 해제 (Esc)', () => { sel.clear(); selRef.clear(); onSel(); }))),
        group('공종', ...discCol()),
        group('표시', col(sm('XRAY', '투시(X-ray)', () => { st.xray = !st.xray; buildModel(); R(); }, st.xray), sm('GROUND', '지반', () => { st.ground = !st.ground; ground.visible = st.ground; R(); }, st.ground), sm('PHOTO', `현장 사진 ${(P.photos || []).filter(p => p.pt).length}`, () => { showPhotos = !showPhotos; buildPhotos(); R(); }, showPhotos)))],
      view: [group('방향', big('TOP', '평면', () => viewDir(new THREE.Vector3(0, 1, 0.0001))), big('FRONT', '남측', () => viewDir(new THREE.Vector3(0, 0.15, 1))), col(sm('FRONT', '북측', () => viewDir(new THREE.Vector3(0, 0.15, -1))), sm('SIDE', '동측', () => viewDir(new THREE.Vector3(1, 0.15, 0))), sm('SIDE', '서측', () => viewDir(new THREE.Vector3(-1, 0.15, 0)))), big('HOME3', '등각', () => viewDir(new THREE.Vector3(1, 0.7, 1.2)))),
        group('저장 시점', big('CAMERA', '현재 시점 저장', () => { const n = `시점 ${P.view.cams.length + 1}`; P.view.cams.push({ name: n, pos: camera.position.toArray(), tgt: controls.target.toArray(), hour: st.hour, date: st.date }); ctx.touch('meta'); toast(n + ' 저장'); goSec('저장 시점'); }), big('PROPS', '시점 목록', () => goSec('저장 시점'))),
        group('재질', big('MATS', '재질·색감', () => goSec('재질')))],
      render: [group('품질', big('ORBIT', '빠름', () => setQuality('fast'), RD.quality === 'fast', '기본 실시간'), big('XRAY', '고품질', () => setQuality('high'), RD.quality === 'high', '앰비언트 오클루전·블룸·안티앨리어싱·유리 굴절'), big('CAPTURE', '사진 렌더', () => setQuality(RD.quality === 'path' ? 'high' : 'path'), RD.quality === 'path', '패스 트레이싱 — 간접광·반사·굴절을 물리적으로 계산 (멈춰 있을 때 점점 선명)')),
        group('시간·빛', col(...[['새벽', 6.2], ['오전', 9.5], ['정오', 12.5]].map(([l, t]) => sm('SUN', l, () => setHour(t), Math.abs(st.hour - t) < 0.2))), col(...[['노을', 0], ['황혼', 1], ['야간', 2]].map(([l, k]) => sm('SUN', l, () => setHour(duskHour(k)), false))), col(sm('SUN', '태양·날짜…', () => goSec('태양')), sm('', `노출 ${RD.ev > 0 ? '+' : ''}${RD.ev} EV`, () => goSec('조명')))),
        group('실내 조명', col(...[['auto', '자동(해질녘)'], ['on', '켜기'], ['off', '끄기']].map(([k, l]) => sm('', l, () => { RD.lights = k; applyLights(); ctx.touch('meta'); R(); if (pt) ptDirty(); }, RD.lights === k))), col(...[[2700, '전구색 2700K'], [4000, '주백색 4000K'], [6500, '주광색 6500K']].map(([k, l]) => sm('', l, () => { RD.K = k; buildLights(); ctx.touch('meta'); R(); if (pt) ptDirty(); }, RD.K === k)))),
        group('재질', big('MATS', '재질 라이브러리', () => goSec('재질')), col(sm('', '텍스처 표시', () => { RD.tex = !RD.tex; clearMats(); updateGround(); buildModel(); ctx.touch('meta'); R(); }, RD.tex))),
        group('효과', col(sm('', '앰비언트 오클루전', () => { RD.ao = !RD.ao; if (aoPass) aoPass.enabled = RD.ao; ctx.touch('meta'); R(); }, RD.ao), sm('', '블룸(빛 번짐)', () => { RD.bloom = !RD.bloom; if (bloomPass) bloomPass.enabled = RD.bloom; ctx.touch('meta'); R(); }, RD.bloom), sm('', '대기 원근(안개)', () => { RD.fog = !RD.fog; updateSun(); ctx.touch('meta'); R(); }, RD.fog))),
        group('출력', big('CAPTURE', pt ? '렌더 저장' : '고해상 저장', () => renderStill(2), false, pt ? '현재 샘플까지의 사진 렌더 저장' : '화면 2배 해상도로 렌더해 PNG 저장'))],
      review: [group('측정', big('MEASURE', '거리 측정', () => { st.measure = !st.measure; mPts = []; toast(st.measure ? '측정: 모델 위 두 점을 클릭하세요' : '측정 끔'); R(); }, st.measure), sm('', '측정 지우기', () => { measureG.clear(); mPts = []; })),
        group('단면', big('SECBOX', '단면 상자', () => { if (st.secBox) setSecBox(null); else { const b = selBox3(); setSecBox(b.isEmpty() ? bbox.clone() : b.expandByScalar(1)); } R(); goSec('단면'); }, !!st.secBox, '선택 객체(없으면 전체)로 단면 상자 — 오른쪽에서 6면 조절'), big('SECPLANE', '단면 평면', () => goSec('단면(클리핑)'))),
        group('단면 축 · 2D', big('SECTION', '단면 축', () => { setSec({ on: !SEC.on }); R(); goSec('단면 축'); }, SEC.on, 'X·Y·Z·자유 축으로 건물을 잘라 봄 — 오른쪽에서 위치 조절'), col(...[['x', 'X축'], ['y', 'Y축'], ['z', 'Z축(수평)']].map(([a, l]) => sm('', l, () => { setSec({ on: true, axis: a }); R(); goSec('단면 축'); }, SEC.on && SEC.axis === a))), col(sm('', '두 점 절단선', () => { st.secPick = []; measureG.clear(); toast('모델 위 두 점을 클릭하면 그 선으로 수직 단면을 만듭니다'); }, !!st.secPick), sm('', '방향 반전', () => { setSec({ flip: !SEC.flip }); R(); }, SEC.flip)), big('ELEV', '2D 도면 추출', extractSection, false, '현재 단면을 절단선·투영선 2D 도면(SVG·DXF·PNG)으로 추출')),
        group('리비전', big('REV', 'Rev 비교', () => toast('화면 위쪽 Rev 타임라인에서 고르세요. [ ] 키로 이동'))),
        group('조정', big('CLASHI', '간섭검토', () => ctx.go('clash')), big('ISSUE', '이슈 등록', issueFromSel3d))],
      analysis: [group('태양', big('SUN', '태양·시각', () => goSec('태양')), big('PLAY', st.playing ? '정지' : '하루 재생', () => { st.playing = !st.playing; R(); }, st.playing)), group('일조', big('SUNMAP', '일조 분석', () => goSec('일조')))],
      sim: [group('4D 공정', big('GANTT', '공정 4D', () => goSec('공정 4D')), big('PLAY', '공정 재생', () => { goSec('공정 4D'); const b = [...side.querySelectorAll('button')].find(x => /재생/.test(x.textContent) && !/하루/.test(x.textContent)); b?.click(); })), group('5D 기성', big('MONEY', '기성 진척 색상', () => goSec('층·공정')), col(sm('', '숨김: 미착수', () => { st.hideUnstarted = !st.hideUnstarted; buildModel(); R(); }, st.hideUnstarted))), group('연동', big('GANTT', '공정 툴', () => ctx.go('sched')), big('MONEY', '기성 툴', () => ctx.go('bill')))],
    };
    const body = h('div', { class: 'rb-body' }, ...(panels[cur] || panels.home));
    tb.append(tabRow, body);
  }
  function setHour(t) { st.hour = t; P.view.sunHour = t; ctx.touch('meta'); updateSun(); buildToolbar(); if (st.sideTab === 'set') renderSide(); }
  function duskHour(k) { // 해질녘 탐색: k=0 노을(고도 4°), 1 황혼(-3°), 2 야간(+1.5h)
    let prev = null; for (let t = 12; t <= 22; t += 0.05) { const a = sunVector(localToDate(st.date, t, P.site.tz ?? 9), P.site.lat, P.site.lng, 0).altitude; const target = k === 0 ? 0.07 : -0.05; if (prev != null && prev > target && a <= target) return k === 2 ? t + 1.2 : t; prev = a; } return k === 2 ? 21 : 18; }
  function capture() { if (pt || composer) return renderStill(1); renderer.render(scene, camera); renderer.domElement.toBlob(b => saveFile(`${P.name}_3D.png`.replace(/[\\/:*?"<>|]/g, '_'), b), 'image/png'); }
  async function issueFromSel3d() {
    if (!sel.size) return toast('객체를 선택하세요');
    const items = [...sel].map(findEl).filter(Boolean); const first = items[0];
    const v = await dialog({ title: '이슈 등록 (3D 시점 포함)', fields: [{ key: 'type', label: '유형', type: 'select', options: ['RFI', '품질', '안전', '설계변경', '일반'], value: 'RFI' }, { key: 'title', label: '제목', value: first ? `${first.el.tag || elName(first.el)} 확인 요청` : '' }, { key: 'desc', label: '내용', type: 'textarea' }, { key: 'assignee', label: '담당' }, { key: 'due', label: '기한', type: 'date' }] });
    if (!v?.title) return; const { addIssue } = await import('./issue.js'); const b = selBox3(); const c = b.isEmpty() ? controls.target : b.getCenter(new THREE.Vector3());
    const it = addIssue(P, { ...v, refs: { ids: [...sel], sheet: first?.sh.id, level: first?.lv.id, where: first?.sh.name, pts: [[c.x * 1000 + bx, -c.z * 1000 + by]], pts3: [[c.x * 1000 + bx, -c.z * 1000 + by, c.y * 1000]], cam: { pos: camera.position.toArray(), tgt: controls.target.toArray() } } });
    ctx.touch('meta'); toast(`이슈 #${it.no} 등록`, 'ok');
  }
  function renderSide() {
    side.innerHTML = '';
    side.append(h('div', { class: 'ptabs' }, ...[['prop', '속성'], ['set', '표시·분석']].map(([k, l]) => h('button', { class: st.sideTab === k ? 'on' : '', onclick: () => { st.sideTab = k; renderSide(); } }, l)), h('span', { style: { flex: 1 } }), h('button', { class: 'btn sm show-m', onclick: () => side.classList.remove('open') }, '닫기')));
    if (st.sideTab === 'prop') { side.append(info); propsPanel(); return; }
    renderSettings();
  }
  function goSec(name) { st.sideTab = 'set'; renderSide(); side.classList.add('open'); const t = [...side.querySelectorAll('h4')].find(x => x.textContent.includes(name)); if (t) { t.scrollIntoView({ block: 'start' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1200); } }
  function renderSettings() {
    side.append(h('h4', {}, '태양·일조'));
    const s1 = h('div', { class: 'sec' }); side.append(s1);
    const kv = h('div', { class: 'kv' }); s1.append(kv);
    const date = h('input', { type: 'date', value: st.date }); date.onchange = () => { st.date = date.value; P.view.sunDate = st.date; ctx.touch('meta'); updateSun(); times.textContent = sunTimes(); };
    const hr = h('input', { type: 'range', min: 0, max: 24, step: 0.25, value: st.hour, style: { width: '100%' } }); hr.oninput = () => { st.hour = +hr.value; P.view.sunHour = st.hour; updateSun(); };
    hr.onchange = () => ctx.touch('meta');
    kv.append(h('label', {}, '날짜'), date, h('label', {}, '시각'), hr);
    const quick = h('div', { class: 'row', style: { marginTop: '6px' } }); const y = st.date.slice(0, 4);
    for (const [l, d] of [['춘분', `${y}-03-20`], ['하지', `${y}-06-21`], ['추분', `${y}-09-23`], ['동지', `${y}-12-21`]]) quick.append(h('button', { class: 'btn sm', onclick: () => { st.date = d; date.value = d; updateSun(); times.textContent = sunTimes(); } }, l));
    const play = h('button', { class: 'btn sm', onclick: () => { st.playing = !st.playing; play.textContent = st.playing ? '■ 정지' : '▶ 하루 재생'; } }, st.playing ? '■ 정지' : '▶ 하루 재생');
    quick.append(play); s1.append(quick);
    const times = h('div', { class: 'note', style: { marginTop: '6px' } }, sunTimes()); s1.append(times);
    const kv2 = h('div', { class: 'kv', style: { marginTop: '8px' } }); s1.append(kv2);
    const num = (label, obj, key, after) => { const i = h('input', { type: 'number', step: 'any', value: obj[key] }); i.onchange = () => { obj[key] = +i.value; ctx.touch('meta'); after?.(); }; kv2.append(h('label', {}, label), i); };
    num('위도', P.site, 'lat', updateSun); num('경도', P.site, 'lng', updateSun); num('시간대 UTC+', P.site, 'tz', updateSun); num('진북(°)', P.site, 'north', updateSun);

    side.append(h('h4', {}, '재질 라이브러리'));
    const s2 = h('div', { class: 'sec' }); side.append(s2);
    const pre = h('select', { style: { width: '100%' } }); pre.append(h('option', { value: '' }, '스타일 프리셋 선택…')); for (const k of Object.keys(PRESETS)) pre.append(h('option', { value: k }, k));
    pre.onchange = () => { if (!pre.value) return; Object.assign(M, PRESETS[pre.value]); ctx.touch('meta'); clearMats(); updateGround(); buildModel(); updateSun(); renderSide(); };
    s2.append(pre);
    const swatch = (fin, color) => { if (!fin || !FINISHES[fin] || !RD.tex) return h('span', { class: 'mswatch', style: { background: color } }); const c = finishMaps(fin, color).map.image; const u = c.toDataURL ? (c._u ||= c.toDataURL('image/jpeg', 0.7)) : ''; return h('span', { class: 'mswatch', style: { backgroundImage: `url(${u})`, backgroundSize: '64px' } }); };
    const grid = h('div', { class: 'mlib' }); s2.append(grid);
    for (const [k, l, tk] of [['ext', '외벽', 't_ext'], ['int', '내벽', 't_int'], ['floor', '바닥 마감', 't_floor'], ['slab', '슬래브(천장)', 't_slab'], ['col', '기둥', 't_col'], ['beam', '보', 't_beam'], ['ground', '대지', 't_ground'], ['glass', '유리', null], ['frame', '창틀', null]]) {
      const ci = h('input', { type: 'color', value: M[k], title: '색' }); ci.oninput = () => { M[k] = ci.value; clearMats(); if (k === 'ground') updateGround(); buildModel(); }; ci.onchange = () => { ctx.touch('meta'); renderSide(); };
      let fs = null; if (tk) { fs = h('select'); fs.append(h('option', { value: '' }, '단색')); for (const [fk, F] of Object.entries(FINISHES)) fs.append(h('option', { value: fk, selected: M[tk] === fk }, F.name)); fs.onchange = () => { M[tk] = fs.value; ctx.touch('meta'); clearMats(); if (k === 'ground') updateGround(); buildModel(); renderSide(); if (pt) ptDirty(); }; }
      grid.append(h('div', { class: 'mrow' }, swatch(tk ? M[tk] : null, M[k]), h('div', { class: 'mname' }, l), fs || h('span', { class: 'note' }, k === 'glass' ? (RD.quality === 'fast' ? '반투명' : '굴절 유리') : '금속'), ci));
    }
    s2.append(h('div', { class: 'note', style: { marginTop: '6px' } }, '재질은 실제 치수 기준으로 매핑됩니다(벽돌 1장≈200mm, 타일 600각). 색을 바꾸면 질감은 유지되고 색만 바뀝니다.'));

    side.append(h('h4', {}, '조명·노출'));
    const sL = h('div', { class: 'sec' }); side.append(sL); const kvL = h('div', { class: 'kv' }); sL.append(kvL);
    const rng = (label, key, lo, hi, stp, after, fmtv = (v) => v) => { const val = h('span', { class: 'mono note' }, fmtv(RD[key])); const i = h('input', { type: 'range', min: lo, max: hi, step: stp, value: RD[key], style: { width: '100%' } }); i.oninput = () => { RD[key] = +i.value; val.textContent = fmtv(RD[key]); after(); }; i.onchange = () => { ctx.touch('meta'); if (pt) ptDirty(); }; kvL.append(h('label', {}, label, ' ', val), i); };
    rng('노출(EV)', 'ev', -3, 3, 0.1, updateSun, v => (v > 0 ? '+' : '') + (+v).toFixed(1));
    rng('태양 세기', 'sunMul', 0, 2, 0.05, updateSun, v => '×' + (+v).toFixed(2));
    rng('실내 색온도', 'K', 2200, 7000, 100, buildLights, v => v + 'K');
    rng('격자 조명 밝기 (기구 없는 층)', 'lumen', 300, 6000, 100, buildLights, v => v + 'lm');
    const tone = h('select'); for (const [k, l] of [['aces', 'ACES 필름 (언리얼 기본과 유사)'], ['agx', 'AgX (부드러운 하이라이트)'], ['neutral', '뉴트럴 (색 정확)'], ['filmic', '시네온']]) tone.append(h('option', { value: k, selected: RD.tone === k }, l));
    tone.onchange = () => { RD.tone = tone.value; renderer.toneMapping = TONES[RD.tone]; clearMats(); buildModel(); ctx.touch('meta'); };
    kvL.append(h('label', {}, '톤 매핑'), tone);
    const lm = h('select'); for (const [k, l] of [['auto', '자동 (해질녘부터)'], ['on', '항상 켜기'], ['off', '끄기']]) lm.append(h('option', { value: k, selected: RD.lights === k }, l)); lm.onchange = () => { RD.lights = lm.value; applyLights(); ctx.touch('meta'); buildToolbar(); if (pt) ptDirty(); };
    kvL.append(h('label', {}, '실내 조명'), lm);
    const LI = st.lightInfo || {};
    sL.append(h('div', { class: 'note', style: { marginTop: '6px' } }, LI.fixtures ? `조명기구 ${LI.fixtures}개(${LI.levels}개 층, 인테리어 배치값) → 광원 ${LI.sources}개, 총 광속 ${fmt0(LI.lm)} lm. 광원은 기구의 정격 광속(lm)을 그대로 쓰며, 실시간 한도(${MAX_LIGHTS}개)를 넘으면 인접 기구를 묶어 광속을 합산합니다.${LI.grid ? ` 기구가 없는 층은 천장 격자 조명 ${LI.grid}개.` : ''} ` : `실내 조명 ${st.nLights || 0}개 (조명기구가 없어 층별 천장 격자 자동 배치). `, `하늘은 날짜·시각·위치로 계산한 HDR 하늘이 배경과 환경광(반사)으로 함께 쓰입니다.`));
    side.append(h('h4', {}, '층·공정(4D)'));
    const s3 = h('div', { class: 'sec' }); side.append(s3);
    const lvSel = h('select'); lvSel.append(h('option', { value: '' }, '전체 층')); for (const l of [...P.levels].sort((a, b) => a.elev - b.elev)) lvSel.append(h('option', { value: l.id, selected: st.maxLevel === l.id }, `${l.name}까지`));
    lvSel.onchange = () => { st.maxLevel = lvSel.value || null; buildModel(); };
    const per = h('select'); per.append(h('option', { value: -1 }, '진척 표시 안 함')); P.bill.periods.forEach((p, i) => per.append(h('option', { value: i, selected: st.period === i }, `${p.name} (${p.date || ''}) 기준`)));
    per.onchange = () => { st.period = +per.value; buildModel(); renderSide(); };
    const hide = h('input', { type: 'checkbox', checked: st.hideUnstarted }); hide.onchange = () => { st.hideUnstarted = hide.checked; buildModel(); };
    s3.append(h('div', { class: 'kv' }, h('label', {}, '표시 층'), lvSel, h('label', {}, '기성 회차'), per, h('label', {}, '미착수 숨김'), hide));
    if (st.period >= 0) s3.append(h('div', { class: 'legend', style: { marginTop: '8px' } }, h('span', {}, h('i', { style: { background: '#3fbf7f' } }), '완료'), h('span', {}, h('i', { style: { background: '#e6b450' } }), '진행'), h('span', {}, h('i', { style: { background: '#9aa0a8' } }), '미착수')));
    if (!P.bill.periods.length) s3.append(h('div', { class: 'note', style: { marginTop: '6px' } }, '기성 툴에서 회차를 만들면 진척 상태가 3D에 표시됩니다.'));
    // 공정 4D
    if (P.sched?.acts?.length) {
      const acts = P.sched.acts; const s0 = acts.reduce((m, a) => toD(a.start) < toD(m) ? a.start : m, acts[0].start), e0 = acts.reduce((m, a) => toD(a.end) > toD(m) ? a.end : m, acts[0].end); const span = daysBetween(s0, e0) + 1;
      side.append(h('h4', {}, '공정 4D'));
      const s7 = h('div', { class: 'sec' }); side.append(s7);
      const lab = h('div', { class: 'mono note' });
      const upd = () => { if (!st.sched) { lab.textContent = '꺼짐'; return; } const run = acts.filter(a => toD(a.start) <= toD(st.sched) && toD(a.end) >= toD(st.sched)).map(a => a.name); lab.textContent = `${st.sched}  진행: ${run.join(', ') || '-'}`; };
      const r = h('input', { type: 'range', min: 0, max: span, step: 1, value: st.sched ? daysBetween(s0, st.sched) : span, style: { width: '100%' } });
      r.oninput = () => { st.sched = addDays(s0, +r.value); upd(); buildModel(); };
      const cb = h('input', { type: 'checkbox', checked: !!st.sched }); cb.onchange = () => { st.sched = cb.checked ? addDays(s0, +r.value) : null; upd(); buildModel(); };
      const play = h('button', { class: 'btn sm', onclick: () => { if (!st.sched) { cb.checked = true; r.value = 0; st.sched = s0; } st.schedPlay = !st.schedPlay; play.textContent = st.schedPlay ? '■ 정지' : '▶ 재생'; } }, st.schedPlay ? '■ 정지' : '▶ 재생');
      st._schedTick = () => { if (!st.schedPlay || !st.sched) return; const d = daysBetween(s0, st.sched) + 1; if (d > span) { st.schedPlay = false; play.textContent = '▶ 재생'; return; } st.sched = addDays(s0, d); r.value = d; upd(); buildModel(); };
      s7.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('label', { class: 'row', style: { gap: '6px' } }, cb, '날짜별 시공 상태'), play), r, lab, h('div', { class: 'legend', style: { marginTop: '6px' } }, h('span', {}, h('i', { style: { background: '#ff9f43' } }), '시공 중'), h('span', {}, '완료=원래 재질, 미착수=숨김')));
      upd();
    }

    // 단면 축 · 2D 추출
    side.append(h('h4', {}, '단면 축 · 2D 추출'));
    const sx = h('div', { class: 'sec' }); side.append(sx);
    const onCb = h('input', { type: 'checkbox', checked: SEC.on }); onCb.onchange = () => { setSec({ on: onCb.checked }); buildToolbar(); renderSide(); };
    sx.append(h('label', { class: 'row', style: { gap: '6px' } }, onCb, '단면 축 켜기'));
    const axRow = h('div', { class: 'row', style: { gap: '4px', marginTop: '6px', flexWrap: 'wrap' } });
    for (const [a, l] of [['x', 'X축'], ['y', 'Y축'], ['z', 'Z축(수평)'], ['free', '자유']]) axRow.append(h('button', { class: 'btn sm' + (SEC.axis === a ? ' on' : ''), onclick: () => { setSec({ on: true, axis: a }); buildToolbar(); renderSide(); } }, l));
    sx.append(axRow);
    if (SEC.on) {
      const sp = secPlane(); const bmn = bbox.min, bmx = bbox.max; const pos = h('span', { class: 'mono note' }, secPosMM());
      const slider = (label, lo, hi, val, set, step = 0.01) => { const r = h('input', { type: 'range', min: lo, max: hi, step, value: val, style: { width: '100%' } }); r.oninput = () => { set(+r.value); SEC.on = true; updateSec(); pos.textContent = secPosMM(); dirEl.textContent = '보는 방향: ' + secDir(secPlane().n); }; r.onchange = () => ctx.touch('meta'); sx.append(h('div', { class: 'note', style: { marginTop: '6px' } }, label), r); };
      const dirEl = h('div', { class: 'note' }, '보는 방향: ' + secDir(sp.n));
      sx.append(h('div', { class: 'row', style: { justifyContent: 'space-between', marginTop: '6px' } }, h('b', { style: { fontSize: '12.5px' } }, secAxisName()), pos), dirEl);
      if (SEC.axis === 'x') slider('위치 (동서)', bmn.x - 0.5, bmx.x + 0.5, SEC.pos.x ?? sp.p0.x, v => { SEC.pos.x = v; });
      if (SEC.axis === 'y') slider('위치 (남북)', -bmx.z - 0.5, -bmn.z + 0.5, SEC.pos.y ?? -sp.p0.z, v => { SEC.pos.y = v; });
      if (SEC.axis === 'z') { slider('높이', bmn.y, bmx.y + 0.2, SEC.pos.z ?? sp.p0.y, v => { SEC.pos.z = v; });
        const lv = h('div', { class: 'row', style: { gap: '4px', marginTop: '4px', flexWrap: 'wrap' } }); for (const l of [...VP.levels].sort((a, b) => a.elev - b.elev)) lv.append(h('button', { class: 'btn sm', onclick: () => { SEC.pos.z = m(l.elev + 1200); setSec({}); renderSide(); } }, `${l.name} +1.2m`)); sx.append(lv); }
      if (SEC.axis === 'free') { const r = bbox.getSize(new THREE.Vector3()).length() / 2 + 1; slider('회전각 (평면, 동=0° 반시계)', -180, 180, SEC.ang, v => { SEC.ang = v; }, 0.5); slider('위치 (법선 방향)', -r, r, SEC.off, v => { SEC.off = v; }); }
      sx.append(h('div', { class: 'row', style: { gap: '4px', marginTop: '8px', flexWrap: 'wrap' } },
        h('button', { class: 'btn sm' + (SEC.flip ? ' on' : ''), onclick: () => { setSec({ flip: !SEC.flip }); renderSide(); } }, SEC.axis === 'z' ? (SEC.flip ? '올려봄(천장)' : '내려봄(평면)') : '방향 반전'),
        h('button', { class: 'btn sm' + (st.secPick ? ' on' : ''), onclick: () => { st.secPick = []; measureG.clear(); toast('모델 위 두 점을 클릭하세요'); renderSide(); } }, '두 점 절단선'),
        h('button', { class: 'btn sm' + (SEC.plane ? ' on' : ''), onclick: () => { setSec({ plane: !SEC.plane }); renderSide(); } }, '평면 표시'),
        h('button', { class: 'btn sm', onclick: () => { const d = secPlane().n.clone().negate(); if (Math.abs(d.y) > 0.7) d.z += 0.0001; viewDir(d); } }, '정면으로 보기')));
      const dep = h('input', { type: 'number', min: 0, step: 100, value: SEC.depth ?? '', placeholder: `자동 ${fmt0(secDepthDefault(sp) * 1000)}`, style: { width: '110px' } }); dep.onchange = () => { SEC.depth = +dep.value > 0 ? +dep.value : null; ctx.touch('meta'); };
      sx.append(h('div', { class: 'row', style: { gap: '6px', marginTop: '8px', alignItems: 'center' } }, h('span', { class: 'note' }, '투영 깊이(mm)'), dep));
      sx.append(h('div', { class: 'note sec-cutn', style: { marginTop: '4px' } }, st.secCutN != null ? `절단 객체 ${st.secCutN}개` : ''));
      sx.append(h('button', { class: 'btn', style: { width: '100%', marginTop: '8px' }, onclick: extractSection }, '2D 도면 추출 (SVG·DXF·PNG)'));
      sx.append(h('div', { class: 'note', style: { marginTop: '4px' } }, '투영 깊이 자동값: 수평 단면은 그 층 바닥(내려봄)·윗층 바닥(올려봄)까지, 수직 단면은 모델 끝까지. 숨김·분리·공종 표시와 X/Y/Z 클리핑·단면 상자가 추출에도 그대로 적용됩니다.'));
    } else sx.append(h('div', { class: 'note', style: { marginTop: '6px' } }, '축을 고르거나 "두 점 절단선"으로 3D에서 절단 위치를 찍으면, 그 단면을 2D 도면으로 추출할 수 있습니다.'));

    // 단면
    side.append(h('h4', {}, '단면(클리핑)'));
    const s4 = h('div', { class: 'sec' }); side.append(s4);
    const sz = bbox.getSize(new THREE.Vector3()), mn = bbox.min, mx = bbox.max;
    const clipRow = (label, key, lo, hi, def) => {
      const cb = h('input', { type: 'checkbox', checked: st.clip[key] != null }); const r = h('input', { type: 'range', min: lo, max: hi, step: 0.05, value: st.clip[key] ?? def, style: { width: '100%' }, disabled: st.clip[key] == null });
      const val = h('span', { class: 'mono note' }, st.clip[key] == null ? '' : fmt(st.clip[key], 2) + 'm');
      cb.onchange = () => { st.clip[key] = cb.checked ? +r.value : null; r.disabled = !cb.checked; applyClip(); val.textContent = cb.checked ? fmt(+r.value, 2) + 'm' : ''; };
      r.oninput = () => { st.clip[key] = +r.value; applyClip(); val.textContent = fmt(+r.value, 2) + 'm'; };
      s4.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('label', { class: 'row', style: { gap: '6px' } }, cb, label), val), r);
    };
    clipRow('수평 단면(높이)', 'y', mn.y, mx.y + 0.5, (mn.y + mx.y) / 2); clipRow('X 단면(동서)', 'x', mn.x - 0.5, mx.x + 0.5, (mn.x + mx.x) / 2); clipRow('Y 단면(남북)', 'z', -mx.z - 0.5, -mn.z + 0.5, -(mn.z + mx.z) / 2);
    const lvBtns = h('div', { class: 'row', style: { marginTop: '6px' } }); for (const l of [...P.levels].sort((a, b) => a.elev - b.elev)) lvBtns.append(h('button', { class: 'btn sm', onclick: () => { st.clip.y = m(l.elev + 1200); applyClip(); renderSide(); } }, `${l.name} 평면`)); s4.append(lvBtns);
    s4.append(h('div', { class: 'note', style: { marginTop: '4px' } }, '층 버튼은 해당 층 FL+1.2m에서 수평으로 잘라 평면처럼 봅니다.'));
    s4.append(h('div', { class: 'pgrp' }, '단면 상자 (Revit Section Box)'), h('div', { class: 'row', style: { gap: '4px' } },
      h('button', { class: 'btn sm' + (st.secBox ? ' on' : ''), onclick: () => { setSecBox(bbox.clone()); renderSide(); } }, '모델 전체'), h('button', { class: 'btn sm', onclick: () => { const b = selBox3(); if (b.isEmpty()) return toast('객체를 먼저 선택하세요'); setSecBox(b.expandByScalar(1)); renderSide(); } }, '선택 객체'), h('button', { class: 'btn sm', onclick: () => { setSecBox(null); renderSide(); } }, '끄기')));
    if (st.secBox) { const B = st.secBox; for (const [ax, l] of [['x', '동서'], ['y', '높이'], ['z', '남북']]) { const lo = Math.min(bbox.min[ax], B.min[ax]) - 1, hi = Math.max(bbox.max[ax], B.max[ax]) + 1; for (const end of ['min', 'max']) { const r = h('input', { type: 'range', min: lo, max: hi, step: 0.05, value: B[end][ax], style: { width: '100%' } }); r.oninput = () => { B[end][ax] = +r.value; if (B.min[ax] > B.max[ax] - 0.1) B[end][ax] = end === 'min' ? B.max[ax] - 0.1 : B.min[ax] + 0.1; applyClip(); }; s4.append(h('div', { class: 'note' }, `${l} ${end === 'min' ? '최소' : '최대'}`), r); } } }

    // 일조 분석
    side.append(h('h4', {}, '일조 분석'));
    const s5 = h('div', { class: 'sec' }); side.append(s5);
    const busy = h('span', { class: 'note' });
    s5.append(h('div', { class: 'row' },
      h('button', { class: 'btn sm', onclick: async () => { busy.textContent = '계산 중…'; await runSunAnalysis('hours', 1); busy.textContent = ''; } }, '일조시간(선택일)'),
      h('button', { class: 'btn sm', onclick: async () => { busy.textContent = '계산 중…'; await runSunAnalysis('law', 1); busy.textContent = ''; } }, '동지 일조 기준 판정'),
      h('button', { class: 'btn sm', onclick: () => { analysisG.clear(); st.sunMap = null; renderSide(); } }, '지우기'), busy));
    if (st.sunMap) {
      const sm = st.sunMap;
      if (sm.mode === 'law') s5.append(h('div', { class: 'legend', style: { marginTop: '8px' } }, h('span', {}, h('i', { style: { background: '#3fbf7f' } }), '충족'), h('span', {}, h('i', { style: { background: '#ef5f5f' } }), `미충족 ${fmt(sm.fail / Math.max(1, sm.cells) * 100, 1)}%`)), h('div', { class: 'note' }, `${sm.date} 동지 기준: 09~15시 연속 2시간 이상 또는 08~16시 합계 4시간 이상 (건축법 시행령 제86조 공동주택 인접대지 일조 기준 참고용)`));
      else s5.append(h('div', { style: { marginTop: '8px' } }, h('div', { style: { height: '10px', borderRadius: '4px', background: 'linear-gradient(90deg,hsl(238,85%,50%),hsl(120,85%,50%),hsl(0,85%,50%))' } }), h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', { class: 'note' }, '0h'), h('span', { class: 'note' }, `${fmt(sm.max, 1)}h`)), h('div', { class: 'note' }, `${sm.date} 지표면 직달 일조시간 (15분 간격, 1m 격자)`)));
    } else s5.append(h('div', { class: 'note', style: { marginTop: '6px' } }, '대지 주변 지표면의 직사광 시간을 계산합니다. 인접 건물 영향 검토용.'));

    // 저장 시점
    P.view.cams ||= [];
    side.append(h('h4', {}, '저장 시점', h('button', { class: 'btn sm', onclick: () => { const n = `시점 ${P.view.cams.length + 1}`; P.view.cams.push({ name: n, pos: camera.position.toArray(), tgt: controls.target.toArray(), hour: st.hour, date: st.date }); ctx.touch('meta'); renderSide(); toast(n + ' 저장'); } }, '+ 현재 시점')));
    const s6 = h('div', { class: 'sec' }); side.append(s6);
    if (!P.view.cams.length) s6.append(h('div', { class: 'note' }, '보고서·회의용 시점을 저장해 두면 한 번에 돌아올 수 있습니다.'));
    P.view.cams.forEach((cm, i) => s6.append(h('div', { class: 'row', style: { justifyContent: 'space-between', margin: '3px 0' } },
      h('button', { class: 'btn sm', onclick: () => { if (st.mode !== 'orbit') setMode('orbit'); camera.position.fromArray(cm.pos); controls.target.fromArray(cm.tgt); if (cm.hour != null) { st.hour = cm.hour; st.date = cm.date || st.date; updateSun(); } controls.update(); } }, cm.name),
      h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => { const n = window.prompt ? null : null; cm.name = (cm.name.endsWith('*') ? cm.name : cm.name); P.view.cams.splice(i, 1); ctx.touch('meta'); renderSide(); } }, '삭제')))));

    if (S.hi) side.append(h('div', { class: 'sec' }, h('div', { class: 'note', style: { color: '#ff8888' } }, '강조: ' + (S.hi.label || `${S.hi.ids?.length || 0}개 객체`)), h('button', { class: 'btn sm', style: { marginTop: '6px' }, onclick: () => { S.hi = null; buildModel(); renderSide(); } }, '강조 해제')));
    side.append(h('div', { class: 'sec note' }, `기준점 X ${fmt0(P.base.x)}, Y ${fmt0(P.base.y)} 를 원점으로 각 도면을 층 표고만큼 올려 3D를 만듭니다. 기준점은 작도에서 BASE 명령으로 바꿉니다.`));
  }
  function clearMats() { for (const k in mats) { mats[k].dispose(); delete mats[k]; } }

  // ---------- 루프 ----------
  let raf = 0, last = performance.now();
  function resize() { const r = holder.getBoundingClientRect(); renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false); renderer.domElement.style.width = r.width + 'px'; renderer.domElement.style.height = r.height + 'px'; camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); if (composer) composer.setSize(Math.max(1, r.width), Math.max(1, r.height)); if (pt) pt.updateCamera(); }
  const ro = new ResizeObserver(resize); ro.observe(holder);
  function loop(t) {
    raf = requestAnimationFrame(loop); const dt = Math.min(0.1, (t - last) / 1000); last = t;
    if (st.schedPlay && st._schedTick) { st._acc = (st._acc || 0) + dt; if (st._acc > 0.12) { st._acc = 0; st._schedTick(); } }
    if (st.playing) { st.hour = (st.hour + dt * 1.5) % 24; updateSun(); const r = side.querySelector('input[type=range]'); if (r) r.value = st.hour; }
    if (st.mode === 'walk' && keys.size) { const sp = 3 * dt; const f = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw)), rgt = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw)); if (keys.has('f')) camera.position.addScaledVector(f, sp); if (keys.has('b')) camera.position.addScaledVector(f, -sp); if (keys.has('l')) camera.position.addScaledVector(rgt, -sp); if (keys.has('r')) camera.position.addScaledVector(rgt, sp); applyLook(); }
    if (st.mode === 'orbit') controls.update(); syncCube();
    for (const mk of markers.children) mk.scale.setScalar(1 + 0.25 * Math.sin(t / 200));
    if (pt && !pt.isCompiling) { pt.renderSample(); ptInfo.textContent = `사진 렌더 ${pt.samples | 0} 샘플${pt.samples < 64 ? ' — 멈춰 있으면 점점 선명해집니다' : ' — 렌더 저장 가능'}`; }
    else if (pt) { ptInfo.textContent = '셰이더 컴파일 중…'; }
    else if (composer) composer.render(); else renderer.render(scene, camera);
  }
  buildToolbar(); renderSide(); resize(); buildModel(); renderTree(); buildPhotos(); renderRevBar(); if (RV.cur != null || (P.prevs || []).length) setRev(RV.cur);
  if (S.hi?.cam) { camera.position.fromArray(S.hi.cam.pos); controls.target.fromArray(S.hi.cam.tgt); camera.far = 2000; camera.updateProjectionMatrix(); controls.update(); if (S.hi.ids?.length) { for (const id of S.hi.ids) { sel.add(id); } refreshSel(); renderSide(); } }
  else if (S.hi?.ids?.length || S.hi?.pts3?.length) {
    const b = new THREE.Box3(); model.traverse(o => { if (o.isMesh && S.hi.ids?.includes(o.userData.ref?.id)) b.expandByObject(o); }); markers.children.forEach(mk => b.expandByObject(mk));
    if (!b.isEmpty()) { const c = b.getCenter(new THREE.Vector3()); const r = Math.max(4, b.getSize(new THREE.Vector3()).length()); controls.target.copy(c); camera.position.copy(c).add(new THREE.Vector3(1, 0.8, 1.1).normalize().multiplyScalar(r * 1.6)); camera.far = 2000; camera.updateProjectionMatrix(); st.xray = true; buildModel(); buildToolbar(); }
    else frame();
  } else frame();
  window.__v3d = { scene, renderer, camera, controls, sun, lightsG, RD, st, get skyTex() { return skyTex; } };
  raf = requestAnimationFrame(loop);
  if (RD.quality === 'high') setupComposer().catch(e => { console.warn(e); RD.quality = 'fast'; }); else if (RD.quality === 'path') { RD.quality = 'high'; setupComposer().catch(() => { }); }
  const offModel = ctx.bus.on('model', () => { if (RV.cur == null && (P.prevs || []).length) setRev(null); else buildModel(); });
  return {
    unmount() { stopPath(); dropComposer(); fixMat.dispose(); clearTimeout(secTimer); RV.play = false; window.removeEventListener('keydown', onRevKey); window.removeEventListener('keydown', onSelKey); cancelAnimationFrame(raf); ro.disconnect(); offModel(); window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); controls.dispose(); clearMats(); renderer.dispose(); renderer.forceContextLoss?.(); },
  };
}
