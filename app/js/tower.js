// 샘플 — 50층 SRC 오피스 타워 "빌더 타워" (건축면적 300평)
// 형태: 원형 포디움(1~3층, 991.7㎡=300평) 위 47개 층 비틀림 타워(층당 1.5° 회전, 중간부 잘록), 나선형 알루미늄 핀, 스카이가든(16·31·46층), 핀 크라운
// 구조: 중앙 RC 코어(벽두께 800→600→500) + SRC 외주 기둥 12본 + 철골 보(방사·외주·캔틸레버) + 데크 슬래브
// 설비: 3층 중앙 기계실(냉동기) · 2층 변전실 · 옥상 냉각탑 → 코어 샤프트 라이저 → 층별 공조기·VAV·스프링클러·트레이 (계통 연결 검토로 전 계통 소스 연결 확인)
import { newProject } from './model.js';
import { uid } from './util.js';

export function sampleTower() {
  const P = newProject('샘플 — 50층 SRC 오피스 타워 (건축면적 300평)');
  P.site = { lat: 37.5133, lng: 127.1028, tz: 9, north: 0, address: '서울 (예시) 일반상업지역 업무시설 부지' };
  const C = [35000, 34000], SW = 70000, SD = 62000; const T = ([x, y]) => [Math.round(x + C[0]), Math.round(y + C[1])];
  P.base = { x: C[0], y: C[1] };
  const N = 50; const lv = [];
  for (let i = 1; i <= N; i++) { const elev = i === 1 ? 0 : i === 2 ? 6000 : i === 3 ? 10500 : 15000 + (i - 4) * 4200; lv.push({ id: 'L' + i, name: i + 'F', elev, height: i === 1 ? 6000 : i <= 3 ? 4500 : 4200, i }); }
  const RFe = 15000 + (N - 3) * 4200; lv.push({ id: 'RF', name: 'RF', elev: RFe, height: 12000, i: N + 1 });
  P.levels = lv.map(({ i, ...l }) => l);
  P.sheets = []; P.content = {}; const SH = {};
  const pad = (i) => String(100 + i);
  for (const L of lv) {
    const n = L.i > N ? '151' : pad(L.i), nm = L.i > N ? 'RF 크라운·옥상' : `${L.i}층`;
    for (const [d, t] of [['A', '평면도'], ['S', '구조'], ['M', '공조·냉난방'], ['E', '전기'], ['P', '위생·소방']]) { if (L.i > N && (d === 'E' || d === 'P')) continue; const s = { id: uid('s'), name: `${d}-${n} ${nm} ${t}`, disc: d, level: L.id }; P.sheets.push(s); P.content[s.id] = { ents: [], els: [] }; (SH[L.id] ||= {})[d] = s; }
  }
  P.layers = [...(P.layers || []).filter(l => !['SITE', 'ROOM'].includes(l.name)), { name: 'SITE', color: '#ff6b6b', visible: true, lt: 'PHANTOM', lw: 0.35 }, { name: 'ROOM', color: '#e0d6a8', visible: true }];
  const E = (L, d, e) => { e.id ||= uid('e'); P.content[SH[L.id][d].id].els.push(e); return e; };
  const G = (L, d, e) => { e.id = uid('g'); P.content[SH[L.id][d].id].ents.push(e); return e; };
  const deg = Math.PI / 180, pol = (r, a) => [r * Math.cos(a), r * Math.sin(a)];

  // ---------- 형태 ----------
  const PODIUM_R = Math.sqrt(2 * 991.74e6 / (48 * Math.sin(2 * Math.PI / 48))); // 48각형 면적 = 991.74㎡ (300평)
  const circle = (R, n = 48, ph = 0) => Array.from({ length: n }, (_, k) => pol(R, ph + k * 2 * Math.PI / n));
  const aOf = (i) => 14900 * (1 - 0.06 * Math.sin(Math.PI * Math.min(1, Math.max(0, (i - 4) / 46))));
  const rotOf = (i) => Math.max(0, i - 4) * 1.5;
  const squircle = (a, rotDeg, n = 32) => Array.from({ length: n }, (_, k) => { const t = k * 2 * Math.PI / n, c = Math.cos(t), s = Math.sin(t); const x = a * Math.sign(c) * Math.sqrt(Math.abs(c)), y = a * Math.sign(s) * Math.sqrt(Math.abs(s)); const r = rotDeg * deg; return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)]; });
  const plateOf = (i) => i <= 3 ? circle(PODIUM_R) : squircle(aOf(i), rotOf(i));
  const edgeR = (i, th) => { if (i <= 3) return PODIUM_R; const a = aOf(i), ph = th - rotOf(i) * deg; return a / Math.pow(Math.pow(Math.abs(Math.cos(ph)), 4) + Math.pow(Math.abs(Math.sin(ph)), 4), 0.25) * 0.985; };
  const scale = (pts, k) => pts.map(([x, y]) => [x * k, y * k]);
  const SKY = new Set([16, 31, 46]);

  // ---------- 높이(설비) ----------
  const zT = (H) => H - 810, zD = (H) => H - 1095, zS = (H) => H - 1380, zC = 2600;

  // ---------- 코어 (S, 로컬) ----------
  const coreT = (i) => i <= 15 ? 800 : i <= 30 ? 600 : 500;
  const coreWalls = (i) => { const t = coreT(i); return [
    [[-6500, -6500], [6500, -6500], t], [[6500, -6500], [6500, 6500], t], [[6500, 6500], [-6500, 6500], t], [[-6500, 6500], [-6500, -6500], t],
    [[-4000, -4800], [-4000, 4800], 300], [[-6500, -4800], [-4000, -4800], 300], [[-6500, 4800], [-4000, 4800], 300], [[-6500, -2400], [-4000, -2400], 200], [[-6500, 0], [-4000, 0], 200], [[-6500, 2400], [-4000, 2400], 200],
    [[-2000, -6500], [-2000, 6500], 300], [[-2000, 2500], [6500, 2500], 300], [[-2000, -2500], [6500, -2500], 300], [[3500, 2500], [3500, 6500], 300], [[3500, -6500], [3500, -2500], 300],
    [[1500, 2500], [1500, 6500], 200], [[3000, -2500], [3000, 2500], 300], [[4750, -2500], [4750, 2500], 200], [[3000, 0], [6500, 0], 200]]; };
  const coreDoors = [[[-3000, 6500], 2000, 2600], [[-3000, -6500], 2000, 2600], [[-250, 6500], 1000, 2200], [[2500, 6500], 1000, 2200], [[5000, 6500], 1000, 2200], [[5000, -6500], 1000, 2200], [[750, -6500], 1000, 2200], [[6500, 1250], 900, 2100], [[6500, -1250], 900, 2100], [[-2000, 0], 1500, 2400], [[3000, 1250], 900, 2100], [[3000, -1250], 900, 2100], [[-4000, -3600], 1100, 2400], [[-4000, -1200], 1100, 2400], [[-4000, 1200], 1100, 2400], [[-4000, 3600], 1100, 2400]];
  const onSeg = (p, a, b, tol = 5) => { const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2; const t = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / L2; if (t < -1e-6 || t > 1 + 1e-6) return null; const q = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]; return Math.hypot(q[0] - p[0], q[1] - p[1]) < tol ? t * Math.sqrt(L2) : null; };

  // ---------- 층별 생성 ----------
  const colAng = Array.from({ length: 12 }, (_, k) => k * 30 * deg), RC = 12500;
  const colSize = (i) => i <= 10 ? 1400 : i <= 25 ? 1200 : i <= 40 ? 1000 : 900;
  const podColAng = Array.from({ length: 24 }, (_, k) => k * 15 * deg), RPC = 16300;
  const coreHit = (th) => 6500 / Math.max(Math.abs(Math.cos(th)), Math.abs(Math.sin(th)));
  let totalGFA = 0;
  for (const L of lv) {
    const i = L.i, H = L.height, roof = i > N;
    // --- 슬래브 (S) ---
    if (i === 1) E(L, 'S', { k: 'slab', pts: circle(PODIUM_R + 1500).map(T), t: 2500, mat: 'RC', tag: 'MAT(매트기초 t2500)', zone: '기초' });
    else E(L, 'S', { k: 'slab', pts: (roof ? squircle(aOf(N), rotOf(N + 1)) : i === 4 ? circle(PODIUM_R) : plateOf(i)).map(T), t: i <= 4 ? 300 : 220, mat: 'RC', tag: roof ? 'RS(지붕)' : i === 4 ? 'S4(포디움 옥상정원)' : `S${i}(데크)`, zone: L.name });
    if (!roof) { const pl = plateOf(i); let a2 = 0; for (let k = 0; k < pl.length; k++) { const p = pl[k], q = pl[(k + 1) % pl.length]; a2 += p[0] * q[1] - q[0] * p[1]; } totalGFA += Math.abs(a2) / 2 / 1e6; }
    if (roof) {
      // 크라운 핀 + 옥상 설비
      const pr = squircle(aOf(N), rotOf(N + 1));
      pr.forEach(([x, y]) => { const th = Math.atan2(y, x), r = Math.hypot(x, y); E(L, 'A', { k: 'fin', p: T(pol(r + 150, th)), w: 180, d: 700, rot: th / deg, h: 12000, color: '#cbb998', tag: '크라운 핀' }); });
      E(L, 'M', { k: 'furn', type: 'ctower', p: T([9500, -4500]), w: 4000, d: 4000, h: 4500, rot: 0, tag: 'CT-1', sys: 'CDWS,CDWR', src: 'CDWS,CDWR' });
      E(L, 'M', { k: 'furn', type: 'ctower', p: T([9500, 2500]), w: 4000, d: 4000, h: 4500, rot: 0, tag: 'CT-2', sys: 'CDWS,CDWR', src: 'CDWS,CDWR' });
      const pp = (a, b, w, sys) => E(L, 'M', { k: 'pipe', a: T(a), b: T(b), w, hh: w, z: 2300, sys, zone: 'RF' });
      pp([4500, -1100], [9500, -1100], 200, 'CDWS'); pp([9500, -1100], [9500, -2600], 200, 'CDWS'); pp([9500, -1100], [9500, 600], 200, 'CDWS');
      pp([4500, -600], [11000, -600], 200, 'CDWR'); pp([11000, -600], [11000, -2600], 200, 'CDWR'); pp([11000, -600], [11000, 600], 200, 'CDWR');
      E(L, 'M', { k: 'furn', type: 'louver', p: T([3875, 1800]), w: 1500, d: 700, h: 1500, rot: 0, tag: 'OA 루버', sys: 'OA', src: 'OA' });
      E(L, 'M', { k: 'furn', type: 'fan', p: T([3875, 700]), w: 1500, d: 1500, h: 1200, rot: 0, tag: 'EF-1 배기팬', sys: 'EA', src: 'EA' });
      E(L, 'A', { k: 'furn', type: 'paving', p: T([0, 0]), w: 13000, d: 13000, h: 40, fin: 'concrete', color: '#9d9a94', rot: 0, room: '옥상 기계실 바닥' });
      continue;
    }
    // --- 코어 (S) ---
    const walls = coreWalls(i).map(([a, b, t]) => E(L, 'S', { k: 'wall', a: T(a), b: T(b), t, mat: 'RC', tag: t >= 500 ? `CW1 코어벽 ${t}` : `CW2 코어 내벽 ${t}`, zone: L.name }));
    const lw = coreWalls(i);
    for (const [c, w, h] of coreDoors) { const k = lw.findIndex(([a, b]) => onSeg(c, a, b) != null); if (k < 0) continue; const s = onSeg(c, lw[k][0], lw[k][1]); E(L, 'S', { k: 'opening', host: walls[k].id, s: Math.round(s - w / 2), w, h, sill: 0, kind: 'door', tag: w === 1100 ? 'EV' : 'D' }); }
    // --- 기둥 (S, SRC) ---
    const cs = colSize(i);
    colAng.forEach((th, k) => E(L, 'S', { k: 'column', p: T(pol(RC, th)), w: cs, d: cs, rot: th / deg, mat: 'SRC', sec: 'H-400x400x13x21', tag: `SC1`, zone: L.name }));
    if (i <= 3) podColAng.forEach(th => E(L, 'S', { k: 'column', p: T(pol(RPC, th)), w: 900, d: 900, rot: th / deg, mat: 'SRC', sec: 'H-400x400x13x21', tag: 'SC2', zone: L.name }));
    // --- 보 (S, 철골) — 이 층 보는 윗층 바닥을 받침 ---
    const up = i + 1; const B = (a, b, sec, tag, w, d, cant) => E(L, 'S', { k: 'beam', a: T(a), b: T(b), mat: 'STEEL', sec, w, d, tag, zone: L.name, ...(cant ? { cant: true } : {}) });
    colAng.forEach((th, k) => { B(pol(coreHit(th), th), pol(RC, th), 'H-700x300x13x24', 'SG1', 300, 700); const th2 = colAng[(k + 1) % 12]; B(pol(RC, th), pol(RC, th2), 'H-700x300x13x24', 'SG2', 300, 700); });
    if (i <= 3) { podColAng.forEach((th, k) => { const th2 = podColAng[(k + 1) % 24]; B(pol(RPC, th), pol(RPC, th2), 'H-600x300x12x20', 'SG4', 300, 600); if (k % 2 === 0) B(pol(RC, th), pol(RPC, th), 'H-600x300x12x20', 'SG5', 300, 600); else B(pol(coreHit(th), th), pol(RPC, th), 'H-700x300x13x24', 'SG5', 300, 700); }); }
    else if (up <= N) colAng.forEach(th => { const re = edgeR(up, th) - 450; if (re > RC + 800) B(pol(RC, th), pol(re, th), 'H-600x300x12x20', 'SG3 캔틸레버', 300, 600, true); });

    // --- 외장 (A): 커튼월 + 핀 ---
    const pl = plateOf(i), sky = SKY.has(i);
    const cwK = i <= 3 ? (PODIUM_R - 450) / PODIUM_R : sky ? 0.8 : (aOf(i) - 300) / aOf(i);
    const cw = scale(pl, cwK);
    const cwWalls = cw.map((p, k) => E(L, 'A', { k: 'wall', a: T(p), b: T(cw[(k + 1) % cw.length]), t: 150, mat: 'GLASS', tag: i <= 3 ? '포디움 커튼월 CW-P' : sky ? '스카이가든 커튼월' : '커튼월 CW-T', zone: L.name }));
    if (i === 1) { for (const k of [35, 37]) E(L, 'A', { k: 'opening', host: cwWalls[k].id, s: 100, w: 2000, h: 2700, sill: 0, kind: 'door', tag: '주출입구' }); }
    pl.forEach(([x, y]) => { const th = Math.atan2(y, x), r = Math.hypot(x, y); E(L, 'A', { k: 'fin', p: T(pol(r + (i <= 3 ? 300 : 150), th)), w: i <= 3 ? 220 : 160, d: i <= 3 ? 800 : 620, rot: th / deg, color: '#cbb998', tag: i <= 3 ? '포디움 핀' : '나선 핀' }); });
    if (sky || i === 4) { // 스카이가든·포디움 옥상정원: 슬래브 끝 난간 + 조경
      const ed = i === 4 ? circle(PODIUM_R - 150) : scale(pl, 0.985);
      ed.forEach((p, k) => { const q = ed[(k + 1) % ed.length]; const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; E(L, 'A', { k: 'furn', type: 'rail', p: T(m), w: Math.hypot(q[0] - p[0], q[1] - p[1]), d: 50, h: 1200, rot: Math.atan2(q[1] - p[1], q[0] - p[0]) / deg, room: '난간' }); });
      for (let k = 0; k < 4; k++) for (const sg of [-1, 1]) { const th = (k * 90 + sg * (i === 4 ? 7.5 : 16)) * deg + rotOf(i) * deg; E(L, 'A', { k: 'furn', type: sg > 0 ? 'tree' : 'shrub', p: T(pol(i === 4 ? 16100 : aOf(i) * 0.9, th)), w: sg > 0 ? 2400 : 1300, d: sg > 0 ? 2400 : 1300, h: sg > 0 ? 4200 : 1000, rot: 0, room: i === 4 ? '옥상정원' : '스카이가든' }); }
      if (i === 4) for (let k = 0; k < 4; k++) { const th = k * 90 * deg; E(L, 'A', { k: 'furn', type: 'deck', p: T(pol(16200, th)), w: 4000, d: 1200, h: 120, rot: th / deg + 90, room: '데크' }); }
    }
    // --- 코어 실내 (A) ---
    E(L, 'A', { k: 'furn', type: 'stair_u', p: T([5000, 4350]), w: 2700, d: 3300, h: H, rot: 0, room: '특별피난계단1' });
    E(L, 'A', { k: 'furn', type: 'stair_u', p: T([5000, -4350]), w: 2700, d: 3300, h: H, rot: 180, room: '특별피난계단2' });
    for (const x of [-1400, -500, 400]) E(L, 'A', { k: 'furn', type: 'toilet', p: T([x, 5500]), w: 400, d: 700, h: 780, rot: 0, room: '남자화장실' });
    for (const x of [-1000, 600]) E(L, 'A', { k: 'furn', type: 'vanity', p: T([x, 3000]), w: 900, d: 500, h: 850, rot: 180, room: '남자화장실' });
    for (const x of [2000, 3000]) E(L, 'A', { k: 'furn', type: 'toilet', p: T([x, 5500]), w: 400, d: 700, h: 780, rot: 0, room: '여자화장실' });
    E(L, 'A', { k: 'furn', type: 'vanity', p: T([2500, 3000]), w: 900, d: 500, h: 850, rot: 180, room: '여자화장실' });
    if (i === 1) {
      for (const y of [-3600, -1200, 1200, 3600]) E(L, 'A', { k: 'furn', type: 'elevator', p: T([-5250, y]), w: 2000, d: 1900, h: 2500, rot: 90, room: '승강기' });
      E(L, 'A', { k: 'furn', type: 'reception', p: T([0, -10500]), w: 5000, d: 900, h: 1100, rot: 180, room: '로비 안내' });
      for (const [x, y, r] of [[-9000, -9000, 45], [9000, -9000, -45], [-9000, 9000, 135], [9000, 9000, -135]]) { E(L, 'A', { k: 'furn', type: 'sofa', p: T([x, y]), w: 2400, d: 950, h: 820, rot: r, color: '#5b6b7a', room: '로비 라운지' }); E(L, 'A', { k: 'furn', type: 'coffee', p: T([x * 0.86, y * 0.86]), w: 1200, d: 600, h: 400, rot: r, room: '로비 라운지' }); }
      for (let k = 0; k < 8; k++) { const th = (k * 45 + 22.5) * deg; E(L, 'A', { k: 'furn', type: 'tree', p: T(pol(14500, th)), w: 2200, d: 2200, h: 4800, rot: 0, room: '로비 실내정원' }); }
      E(L, 'A', { k: 'furn', type: 'floor', p: T([0, 0]), w: 24000, d: 24000, h: 10, fin: 'stone', color: '#d8d2c8', rot: 0, room: '로비 석재 바닥' });
    }
    if (i === 10 || i === 30) { colAng.forEach(th => { E(L, 'A', { k: 'furn', type: 'workstation', p: T(pol(9600, th + 15 * deg)), w: 2800, d: 1600, h: 1150, rot: (th + 15 * deg) / deg + 90, room: '오피스' }); }); for (const th of [45, 135, 225, 315]) E(L, 'A', { k: 'furn', type: 'plant', p: T(pol(11300, th * deg)), w: 600, d: 600, h: 1500, rot: 0, room: '오피스' }); }
    // 실명
    for (const [n, x, y] of [['EV홀', -3000, 0], ['공조실', 500, -1800], ['남자화장실', -250, 4300], ['여자화장실', 2500, 4300], ['계단1', 5000, 4500], ['계단2', 5000, -4500], ['탕비실', 750, -4500], ['AD', 3875, 2300], ['PS', 3875, -2350], ['EPS', 5625, 2300], ['TPS', 5625, -2350]]) G(L, 'A', { t: 'text', p: T([x - n.length * 120, y]), h: 240, s: n, rot: 0, layer: 'ROOM' });
    G(L, 'A', { t: 'text', p: T([-1800, -10500]), h: 600, s: i === 1 ? '로비' : i <= 3 ? (i === 2 ? '변전실·오피스' : '기계실·오피스') : sky ? '스카이가든' : '오피스', rot: 0, layer: 'ROOM' });

    // ---------- 설비 (M·P·E) ----------
    const M = (k, a, b, w, hh, z, sys, d = 'M') => E(L, d, { k, a: T(a), b: T(b), w, hh, z, sys, zone: L.name });
    const R = (p, form, w, hh, sys, d) => E(L, d, { k: 'riser', p: T(p), form, w, hh, sys, zone: L.name });
    const D = zD(H), Tz = zT(H), Sz = zS(H), RE = sky ? 9800 : 11000;
    // 공조 — 층별 AHU
    E(L, 'M', { k: 'furn', type: 'ahu', p: T([500, 0]), w: 4000, d: 2000, h: 2400, rot: 0, tag: `AHU-${i}`, sys: 'SA,RA,OA,EA,CHWS,CHWR', src: 'SA,RA', need: 'CHWS,CHWR,OA,EA' });
    R([3875, 1800], 'duct', 1200, 500, 'OA', 'M'); R([3875, 700], 'duct', 1200, 500, 'EA', 'M');
    R([3300, -2150], 'pipe', 150, 150, 'CHWS', 'M'); R([3300, -1600], 'pipe', 150, 150, 'CHWR', 'M');
    if (i >= 3) { R([4500, -1100], 'pipe', 200, 200, 'CDWS', 'M'); R([4500, -600], 'pipe', 200, 200, 'CDWR', 'M'); }
    M('duct', [3875, 1800], [1800, 1800], 600, 400, D, 'OA-' + i); M('duct', [1800, 1800], [1800, 900], 600, 400, D, 'OA-' + i);
    M('duct', [3875, 700], [2700, 700], 600, 400, D, 'EA-' + i);
    M('pipe', [3300, -2150], [2000, -2150], 100, 100, zC, 'CHWS'); M('pipe', [2000, -2150], [2000, -900], 100, 100, zC, 'CHWS');
    M('pipe', [3300, -1600], [2300, -1600], 100, 100, zC, 'CHWR'); M('pipe', [2300, -1600], [2300, -900], 100, 100, zC, 'CHWR');
    const SR = sky ? 7300 : 8300, SA = 'SA-' + i;
    M('duct', [0, -1000], [0, -SR], 1200, 350, D, SA);
    for (const [a, b] of [[[-SR, -SR], [SR, -SR]], [[SR, -SR], [SR, SR]], [[SR, SR], [-SR, SR]], [[-SR, SR], [-SR, -SR]]]) M('duct', a, b, 800, 350, D, SA);
    for (let k = 0; k < 8; k++) { const th = (22.5 + 45 * k) * deg, c = Math.cos(th), s = Math.sin(th), r0 = SR / Math.max(Math.abs(c), Math.abs(s)); M('duct', pol(r0, th), pol(RE, th), 400, 300, D, SA); E(L, 'M', { k: 'furn', type: 'vav', p: T(pol(RE + 450, th)), w: 900, d: 600, h: 450, rot: th / deg, z0: D - 225, tag: `VAV-${i}-${k + 1}`, sys: SA }); }
    M('duct', [-1000, 1000], [-1000, 7300], 800, 350, D, 'RA-' + i);
    E(L, 'M', { k: 'furn', type: 'grille', p: T([-1000, 7300]), w: 900, d: 900, h: 60, rot: 0, z0: D - 200, tag: 'RG 리턴그릴', sys: 'RA-' + i });
    // 위생·소방
    R([3300, -1100], 'pipe', 80, 80, 'CW', 'P'); R([3300, -600], 'pipe', 150, 150, 'SD', 'P'); R([4100, -350], 'pipe', 150, 150, 'FP', 'P');
    M('pipe', [3300, -1100], [2650, -1100], 50, 50, zC, 'CW', 'P'); M('pipe', [2650, -1100], [2650, 4500], 50, 50, zC, 'CW', 'P'); M('pipe', [2650, 4500], [-1600, 4500], 50, 50, zC, 'CW', 'P');
    const FR = 7200;
    M('pipe', [4100, -350], [FR, -350], 100, 100, Sz, 'FP', 'P');
    for (const [a, b] of [[[-FR, -FR], [FR, -FR]], [[FR, -FR], [FR, FR]], [[FR, FR], [-FR, FR]], [[-FR, FR], [-FR, -FR]]]) M('pipe', a, b, 100, 100, Sz, 'FP', 'P');
    for (let k = 0; k < 12; k++) { const th = (15 + 30 * k) * deg, c = Math.cos(th), s = Math.sin(th), r0 = FR / Math.max(Math.abs(c), Math.abs(s)); M('pipe', pol(r0, th), pol(RE, th), 65, 65, Sz, 'FP', 'P'); }
    // 전기
    R([5625, 1250], 'tray', 600, 300, 'BUS', 'E');
    E(L, 'E', { k: 'furn', type: 'panel', p: T([5625, 700]), w: 1000, d: 300, h: 2000, rot: 0, tag: `분전반 P-${i}`, sys: 'BUS,ELEC', src: 'ELEC', need: 'BUS' });
    const TR = 7600;
    M('tray', [5625, 700], [TR, 700], 400, 100, Tz, 'ELEC', 'E');
    for (const [a, b] of [[[-TR, -TR], [TR, -TR]], [[TR, -TR], [TR, TR]], [[TR, TR], [-TR, TR]], [[-TR, TR], [-TR, -TR]]]) M('tray', a, b, 400, 100, Tz, 'ELEC', 'E');
    for (const th of [0, 90, 180, 270]) { const t2 = th * deg; M('tray', pol(TR, t2), pol(RE, t2), 300, 100, Tz, 'ELEC', 'E'); }

    // ---------- 중앙 플랜트 ----------
    if (i === 1) E(L, 'P', { k: 'furn', type: 'pit', p: T([3300, -600]), w: 900, d: 900, h: 120, rot: 0, tag: '오수 배출(공공하수 연결)', sys: 'SD', src: 'SD' });
    if (i === 2) { // 변전실
      E(L, 'E', { k: 'furn', type: 'swgr', p: T([9000, 1250]), w: 4000, d: 1000, h: 2300, rot: 90, tag: '수배전반 MCC', sys: 'BUS', src: 'BUS' });
      E(L, 'E', { k: 'furn', type: 'tr', p: T([9300, -2800]), w: 2400, d: 1600, h: 2200, rot: 90, tag: 'TR-1 22.9kV/380V', sys: 'BUS', src: 'BUS' });
      E(L, 'E', { k: 'furn', type: 'tr', p: T([9300, -5600]), w: 2400, d: 1600, h: 2200, rot: 90, tag: 'TR-2', sys: 'BUS', src: 'BUS' });
      E(L, 'E', { k: 'furn', type: 'gen', p: T([0, -10300]), w: 5000, d: 2000, h: 2500, rot: 0, tag: '비상발전기 G-1' });
      M('tray', [5625, 1250], [8700, 1250], 600, 100, Tz, 'BUS', 'E');
    }
    if (i === 3) { // 기계실
      E(L, 'M', { k: 'furn', type: 'chiller', p: T([8000, -3500]), w: 3000, d: 1400, h: 2200, rot: 90, tag: 'R-1 냉동기 600RT', sys: 'CHWS,CHWR,CDWS,CDWR', src: 'CHWS,CHWR', need: 'CDWS,CDWR' });
      E(L, 'M', { k: 'furn', type: 'chiller', p: T([9700, -3500]), w: 3000, d: 1400, h: 2200, rot: 90, tag: 'R-2 냉동기 600RT', sys: 'CHWS,CHWR,CDWS,CDWR', src: 'CHWS,CHWR', need: 'CDWS,CDWR' });
      const pz = 2600, cz = 2600;
      M('pipe', [3300, -2150], [9800, -2150], 200, 200, pz, 'CHWS'); M('pipe', [8000, -2150], [8000, -2500], 200, 200, pz, 'CHWS');
      M('pipe', [3300, -1600], [9700, -1600], 200, 200, pz + 300, 'CHWR'); M('pipe', [8000, -1600], [8000, -2100], 200, 200, pz + 300, 'CHWR'); M('pipe', [9700, -1600], [9700, -2100], 200, 200, pz + 300, 'CHWR');
      M('pipe', [4500, -1100], [10000, -1100], 250, 250, cz, 'CDWS'); M('pipe', [8300, -1100], [8300, -2100], 250, 250, cz, 'CDWS'); M('pipe', [10000, -1100], [10000, -2100], 250, 250, cz, 'CDWS');
      M('pipe', [4500, -600], [10200, -600], 250, 250, cz + 250, 'CDWR'); M('pipe', [8500, -600], [8500, -2050], 250, 250, cz + 250, 'CDWR'); M('pipe', [10200, -600], [10200, -2050], 250, 250, cz + 250, 'CDWR');
      E(L, 'P', { k: 'furn', type: 'tank', p: T([-500, -10400]), w: 4000, d: 2000, h: 2400, rot: 0, tag: '저수조 120톤' });
      E(L, 'P', { k: 'furn', type: 'pump', p: T([2650, -9500]), w: 1200, d: 700, h: 900, rot: 90, tag: '급수 부스터펌프 BP-1', sys: 'CW', src: 'CW' });
      M('pipe', [2650, -1100], [2650, -9000], 80, 80, zC - 300, 'CW', 'P');
      E(L, 'P', { k: 'furn', type: 'pump', p: T([-9000, -6000]), w: 1200, d: 700, h: 900, rot: 0, tag: '소화펌프 FP-1', sys: 'FP', src: 'FP' });
      M('pipe', [-FR, -6000], [-8600, -6000], 100, 100, Sz, 'FP', 'P');
    }

    // ---------- 코어벽 관통 슬리브 (수평 설비 × 코어벽 교차점) ----------
    const isect = (a, b, c, d) => { const r = [b[0] - a[0], b[1] - a[1]], s2 = [d[0] - c[0], d[1] - c[1]], den = r[0] * s2[1] - r[1] * s2[0]; if (Math.abs(den) < 1e-9) return null; const t = ((c[0] - a[0]) * s2[1] - (c[1] - a[1]) * s2[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den; return t > 0.001 && t < 0.999 && u > -0.001 && u < 1.001 ? { t, u } : null; };
    for (const d of ['M', 'P', 'E']) for (const el of P.content[SH[L.id][d].id].els) {
      if (!el.a) continue; const sz = el.k === 'pipe' ? el.w : el.hh;
      walls.forEach((wl, k) => { const x = isect(el.a, el.b, wl.a, wl.b); if (!x) return; const len = Math.hypot(wl.b[0] - wl.a[0], wl.b[1] - wl.a[1]); const w = el.w + 100, h = sz + 100; E(L, 'S', { k: 'opening', host: wl.id, s: Math.round(x.u * len - w / 2), w, h, sill: Math.round(el.z - sz / 2 - 50), kind: 'sleeve', tag: `슬리브 ${el.sys}` }); });
    }
  }

  // ---------- 대지·배치 (1층 A) ----------
  const L1 = lv[0];
  G(L1, 'A', { t: 'pline', pts: [[0, 0], [SW, 0], [SW, SD], [0, SD]], closed: true, layer: 'SITE' });
  E(L1, 'A', { k: 'furn', type: 'paving', p: [SW / 2, 8000], w: SW, d: 16000, h: 40, fin: 'stone', color: '#b9b2a6', rot: 0, room: '전면 광장' });
  for (let k = 0; k < 9; k++) E(L1, 'A', { k: 'furn', type: 'tree', p: [4000 + k * 7750, 2500], w: 4200, d: 4200, h: 8000, rot: 0, room: '가로수' });
  for (const [x, y] of [[5000, 22000], [5000, 34000], [5000, 46000], [65000, 22000], [65000, 34000], [65000, 46000], [20000, 57000], [35000, 58000], [50000, 57000]]) E(L1, 'A', { k: 'furn', type: 'tree', p: [x, y], w: 5000, d: 5000, h: 9000, rot: 0, room: '조경' });
  for (let k = 0; k < 14; k++) E(L1, 'A', { k: 'furn', type: 'shrub', p: [8000 + k * 4000, 15200], w: 1200, d: 1200, h: 900, rot: 0, room: '화단' });
  const tx = (s2, x, y, h = 700) => G(L1, 'A', { t: 'text', p: [x, y], h, s: s2, rot: 0, layer: 'TEXT' });
  tx('전면도로 (폭 25m)', SW / 2 - 4000, -2500, 900);
  tx(`대지면적 ${(SW * SD / 1e6).toFixed(1)}㎡ · 건축면적 991.74㎡ (300.0평) · 건폐율 ${(991.74 / (SW * SD / 1e6) * 100).toFixed(1)}%`, SW + 1500, SD - 1000, 600);
  tx(`연면적 약 ${Math.round(totalGFA).toLocaleString()}㎡ · 지상 50층 · 높이 ${(RFe / 1000).toFixed(1)}m (크라운 포함 ${((RFe + 12000) / 1000).toFixed(1)}m)`, SW + 1500, SD - 2000, 600);
  tx('구조: 중앙 RC 코어 + SRC 기둥 12본(1400→900) + 철골 보 · 매트기초 t2500', SW + 1500, SD - 3000, 600);
  tx('외장: 층당 1.5° 비틀림(총 70.5°) · 중간부 6% 잘록 · 나선 알루미늄 핀 · 스카이가든 16/31/46층', SW + 1500, SD - 4000, 600);

  // 표시
  P.view = { ...(P.view || {}), mats: { ext: '#e8e4dc', t_ext: 'stone', int: '#f2f0ec', t_int: 'paint', floor: '#cfc9bf', t_floor: 'stone', slab: '#e9e6e0', t_slab: 'paint', col: '#d7d3cb', t_col: 'concrete', beam: '#8d939a', t_beam: 'metal', glass: '#7fa6bf', frame: '#2b2f33', ground: '#5b6e45', t_ground: 'grass' }, sunDate: '2026-10-15', sunHour: 14.5, render: { lights: 'auto', K: 4000 }, tree3d: false, rb3d: 'home' };
  P.check = P.check || { status: {} };
  P.code = { zone: '중심상업지역' }; P.struct = { site: { use: '사무실', region: '서울', siteClass: 'S2', qa: 1000, exp: 'B' } };
  return P;
}
