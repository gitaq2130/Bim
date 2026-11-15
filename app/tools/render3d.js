// 빌더 3D 렌더링 — 절차적 PBR 재질, 물리 기반 하늘(HDR), 색온도, 실내 조명
import * as THREE from 'three';

// ---------- 유틸 ----------
const hex2rgb = (c) => { const n = parseInt((c || '#888888').slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
// 값 노이즈 (타일링)
function noiseGrid(n, cell, oct = 4) {
  const out = new Float32Array(n * n); let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const g = Math.max(2, Math.round(n / cell)); const v = new Float32Array(g * g); for (let i = 0; i < v.length; i++) v[i] = rnd();
    const s = g / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const fx = x * s, fy = y * s, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = v[(y0 % g) * g + x0 % g], b = v[(y0 % g) * g + (x0 + 1) % g], c = v[((y0 + 1) % g) * g + x0 % g], d = v[((y0 + 1) % g) * g + (x0 + 1) % g];
      out[y * n + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
    }
    tot += amp; amp *= 0.5; cell /= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot; return out;
}
function canvasFrom(n, fn) { const c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d'); const im = g.createImageData(n, n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const [r, gg, b] = fn(x, y); const i = (y * n + x) * 4; im.data[i] = r; im.data[i + 1] = gg; im.data[i + 2] = b; im.data[i + 3] = 255; } g.putImageData(im, 0, 0); return c; }
function normalFrom(n, hgt, strength) { // 높이 → 노멀 (소벨, 타일링)
  return canvasFrom(n, (x, y) => { const H = (a, b) => hgt[((b + n) % n) * n + (a + n) % n]; const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1)); const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1)); let nx = -dx * strength, ny = dy * strength, nz = 1; const l = Math.hypot(nx, ny, nz); return [(nx / l * 0.5 + 0.5) * 255, (ny / l * 0.5 + 0.5) * 255, (nz / l * 0.5 + 0.5) * 255]; });
}
const clamp255 = (v) => v < 0 ? 0 : v > 255 ? 255 : v;

// ---------- 재질 라이브러리 ----------
// size: 텍스처 한 장이 덮는 실제 크기(m)
export const FINISHES = {
  paint: { name: '도장(페인트)', size: 2, rough: 0.85, metal: 0 },
  concrete: { name: '노출콘크리트', size: 1.8, rough: 0.82, metal: 0 },
  brick: { name: '적벽돌', size: 1.0, rough: 0.9, metal: 0 },
  stone: { name: '석재 패널', size: 2.4, rough: 0.45, metal: 0 },
  metal: { name: '금속 패널(징크)', size: 1.6, rough: 0.35, metal: 0.8 },
  wood: { name: '목재', size: 1.2, rough: 0.6, metal: 0 },
  tile: { name: '타일(600각)', size: 1.2, rough: 0.25, metal: 0 },
  plaster: { name: '스타코·미장', size: 1.5, rough: 0.95, metal: 0 },
  grass: { name: '잔디', size: 6, rough: 1, metal: 0 },
  asphalt: { name: '아스팔트', size: 3, rough: 0.95, metal: 0 },
};
const texCache = new Map();
export function finishMaps(id, color) {
  const key = id + color; if (texCache.has(key)) return texCache.get(key);
  const N = 512; seed = 12345 + id.length * 77; const [R, G, B] = hex2rgb(color);
  const hgt = new Float32Array(N * N); let col, rough;
  const tone = (v) => [clamp255(R * v), clamp255(G * v), clamp255(B * v)];
  if (id === 'brick') {
    const bw = N / 5, bh = N / 15, mort = Math.max(2, N * 0.012); const nz = noiseGrid(N, 64, 3); const per = []; for (let i = 0; i < 400; i++) per.push(0.78 + rnd() * 0.38);
    col = canvasFrom(N, (x, y) => { const row = Math.floor(y / bh), off = row % 2 ? bw / 2 : 0, xx = (x + off) % N, cx = Math.floor(xx / bw); const inM = (y % bh) < mort || (xx % bw) < mort; const k = per[(row * 7 + cx) % per.length]; hgt[y * N + x] = inM ? 0 : 0.8 + nz[y * N + x] * 0.2; if (inM) return [178, 172, 162].map(v => v * (0.9 + nz[y * N + x] * 0.15)); return tone(k * (0.85 + nz[y * N + x] * 0.3)); });
    rough = canvasFrom(N, (x, y) => { const v = hgt[y * N + x] ? 215 : 245; return [v, v, v]; });
  } else if (id === 'concrete') {
    const nz = noiseGrid(N, 128, 5), sp = noiseGrid(N, 8, 2); const pw = N, ph = N / 2;
    col = canvasFrom(N, (x, y) => { const seam = (y % ph) < 2 || (x % pw) < 2; const tieX = [N * 0.15, N * 0.5, N * 0.85], tieY = [ph * 0.25, ph * 0.75]; let hole = false; for (const tx of tieX) for (const ty of tieY) { const d = Math.hypot(x - tx, (y % ph) - ty); if (d < 6) hole = true; } const v = 0.82 + (nz[y * N + x] - 0.5) * 0.28 + (sp[y * N + x] > 0.82 ? -0.08 : 0) - (seam ? 0.12 : 0) - (hole ? 0.35 : 0); hgt[y * N + x] = hole ? -1 : seam ? -0.4 : (sp[y * N + x] > 0.82 ? -0.3 : nz[y * N + x] * 0.2); return tone(v); });
    rough = canvasFrom(N, (x, y) => { const v = 200 + nz[y * N + x] * 50; return [v, v, v]; });
  } else if (id === 'stone') {
    const nz = noiseGrid(N, 160, 6), vein = noiseGrid(N, 64, 4); const pw = N / 2, ph = N;
    col = canvasFrom(N, (x, y) => { const j = (x % pw) < 3 || (y % (ph / 2)) < 3; const vv = Math.abs(Math.sin((x * 0.01 + vein[y * N + x] * 6 + y * 0.004) * 3)); const v = 0.88 + (nz[y * N + x] - 0.5) * 0.18 - (vv < 0.06 ? 0.15 : 0) - (j ? 0.3 : 0); hgt[y * N + x] = j ? -1 : 0; return tone(v); });
    rough = canvasFrom(N, (x, y) => { const v = hgt[y * N + x] ? 230 : 100 + nz[y * N + x] * 40; return [v, v, v]; });
  } else if (id === 'metal') {
    const nz = noiseGrid(N, 256, 3), br = noiseGrid(N, 4, 1); const pw = N / 4;
    col = canvasFrom(N, (x, y) => { const seam = (x % pw) < 4; const v = 0.95 + (nz[y * N + x] - 0.5) * 0.1 + (br[(y * N + x)] - 0.5) * 0.04 - (seam ? 0.25 : 0); hgt[y * N + x] = seam ? ((x % pw) < 2 ? 1 : -1) : 0; return tone(v); });
    rough = canvasFrom(N, (x, y) => { const v = 80 + nz[y * N + x] * 60; return [v, v, v]; });
  } else if (id === 'wood') {
    const nz = noiseGrid(N, 96, 4); const pw = N / 8; const per = []; for (let i = 0; i < 64; i++) per.push(0.8 + rnd() * 0.35);
    col = canvasFrom(N, (x, y) => { const pl = Math.floor(x / pw); const gap = (x % pw) < 2; const grain = Math.sin((x * 0.6 + nz[y * N + x] * 40 + pl * 13) * 0.9) * 0.5 + 0.5; const v = per[pl % 64] * (0.82 + grain * 0.2) - (gap ? 0.35 : 0); hgt[y * N + x] = gap ? -1 : grain * 0.1; return tone(v); });
    rough = canvasFrom(N, (x, y) => { const v = 140 + nz[y * N + x] * 60; return [v, v, v]; });
  } else if (id === 'tile') {
    const nz = noiseGrid(N, 64, 3); const t = N / 2;
    col = canvasFrom(N, (x, y) => { const j = (x % t) < 3 || (y % t) < 3; const k = 0.93 + (((Math.floor(x / t) * 3 + Math.floor(y / t)) % 4) - 1.5) * 0.015; hgt[y * N + x] = j ? -1 : 0; return j ? [150, 148, 144] : tone(k + (nz[y * N + x] - 0.5) * 0.05); });
    rough = canvasFrom(N, (x, y) => { const v = hgt[y * N + x] ? 235 : 50 + nz[y * N + x] * 30; return [v, v, v]; });
  } else if (id === 'plaster') {
    const nz = noiseGrid(N, 24, 4), big = noiseGrid(N, 200, 3);
    col = canvasFrom(N, (x, y) => { hgt[y * N + x] = nz[y * N + x]; return tone(0.9 + (big[y * N + x] - 0.5) * 0.08 + (nz[y * N + x] - 0.5) * 0.06); });
    rough = canvasFrom(N, () => [240, 240, 240]);
  } else if (id === 'grass') {
    const nz = noiseGrid(N, 5, 2), mid = noiseGrid(N, 60, 3), big = noiseGrid(N, 256, 3);
    col = canvasFrom(N, (x, y) => { const b = nz[y * N + x], md = mid[y * N + x], g = big[y * N + x]; hgt[y * N + x] = b; const k = 0.72 + b * 0.32 + (md - 0.5) * 0.25; const dry = Math.max(0, g - 0.55) * 1.6; return [clamp255(R * k + dry * 45), clamp255(G * k - dry * 6), clamp255(B * k * (1 - dry * 0.3))]; });
    rough = canvasFrom(N, () => [250, 250, 250]);
  } else if (id === 'asphalt') {
    const nz = noiseGrid(N, 4, 2), big = noiseGrid(N, 160, 3);
    col = canvasFrom(N, (x, y) => { const v = 0.75 + nz[y * N + x] * 0.4 + (big[y * N + x] - 0.5) * 0.15; hgt[y * N + x] = nz[y * N + x]; return tone(v); });
    rough = canvasFrom(N, () => [235, 235, 235]);
  } else { // paint
    const nz = noiseGrid(N, 32, 3);
    col = canvasFrom(N, (x, y) => { hgt[y * N + x] = nz[y * N + x] * 0.3; return tone(0.97 + (nz[y * N + x] - 0.5) * 0.03); });
    rough = canvasFrom(N, () => [220, 220, 220]);
  }
  const strength = { brick: 3, concrete: 2.2, stone: 2, metal: 3, wood: 2.5, tile: 3, plaster: 1.6, grass: 3, asphalt: 3, paint: 1.5 }[id] ?? 2;
  const nrm = normalFrom(N, hgt, strength);
  const mk = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  const out = { map: mk(col, true), roughnessMap: mk(rough), normalMap: mk(nrm) };
  texCache.set(key, out); return out;
}
// 상자/압출 형상에 실제 치수 기준 UV (텍스처 1장 = size m)
export function worldUV(geo, size) {
  const p = geo.attributes.position, n = geo.attributes.normal; if (!p || !n) return geo;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i)); let u, v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); } else if (ax >= az) { u = p.getZ(i); v = p.getY(i); } else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u / size; uv[i * 2 + 1] = v / size;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return geo;
}

// ---------- 색온도 (K → RGB) ----------
export function kelvin(K) {
  const t = Math.min(400, Math.max(10, (K || 6500) / 100)); let r, g, b;
  r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return new THREE.Color(clamp255(r) / 255, clamp255(g) / 255, clamp255(b) / 255);
}

// ---------- 물리 기반 하늘 (HDR 등장방형) ----------
// sunDir: 월드 방향(three, y 위), alt: 태양 고도(rad), ground: 지면색
export function skyTexture(sunDir, alt, { turbidity = 3, ground = '#6f7d5c', W = 512, H = 256, prev } = {}) {
  const data = prev?.image?.data?.length === W * H * 4 ? prev.image.data : new Float32Array(W * H * 4);
  const s = sunDir.clone().normalize(); const day = Math.max(0, Math.min(1, (alt + 0.1) / 0.35)), dusk = Math.max(0, 1 - Math.abs(alt - 0.03) / 0.18);
  // 기본 색 (선형)
  const zen = new THREE.Color().setRGB(0.10, 0.25, 0.62).lerp(new THREE.Color(0.018, 0.03, 0.075), 1 - day);
  const hor = new THREE.Color().setRGB(0.62, 0.74, 0.88).lerp(new THREE.Color(1.0, 0.52, 0.25), dusk * 0.85).lerp(new THREE.Color(0.05, 0.06, 0.1), 1 - day);
  const sunC = kelvin(alt > 0.3 ? 5600 : 2000 + Math.max(0, alt) / 0.3 * 3600); const [gr, gg, gb] = hex2rgb(ground).map(v => Math.pow(v / 255, 2.2));
  const skyInt = 0.7 + 1.1 * day, mie = 0.08 + turbidity * 0.02;
  for (let y = 0; y < H; y++) {
    const v = 1 - (y + 0.5) / H, lat = (v - 0.5) * Math.PI, cy = Math.sin(lat), cr = Math.cos(lat);
    for (let x = 0; x < W; x++) {
      const lon = ((x + 0.5) / W - 0.5) * 2 * Math.PI; const dx = cr * Math.cos(lon), dz = cr * Math.sin(lon), dy = cy;
      const i = (y * W + x) * 4; const cos = dx * s.x + dy * s.y + dz * s.z;
      if (dy >= 0) {
        const t = Math.pow(1 - dy, 4);
        let r = zen.r + (hor.r - zen.r) * t, g = zen.g + (hor.g - zen.g) * t, b = zen.b + (hor.b - zen.b) * t;
        const glow = Math.pow(Math.max(0, cos), 8) * mie * 6 * (0.3 + day) + Math.pow(Math.max(0, cos), 64) * 2.5 * day;
        const sunDisk = cos > 0.99996 ? 60 * Math.max(0.05, day) : cos > 0.9998 ? 12 * day : 0;
        r = (r + glow * sunC.r + sunDisk * sunC.r) * skyInt; g = (g + glow * sunC.g + sunDisk * sunC.g) * skyInt; b = (b + glow * sunC.b * 0.8 + sunDisk * sunC.b) * skyInt;
        data[i] = r; data[i + 1] = g; data[i + 2] = b;
      } else {
        const k = (0.25 + 0.5 * day) * (0.6 + 0.4 * Math.min(1, -dy * 4)); const h = Math.pow(Math.min(1, -dy * 6), 0.5);
        data[i] = (gr * k) * h + hor.r * skyInt * (1 - h); data[i + 1] = (gg * k) * h + hor.g * skyInt * (1 - h); data[i + 2] = (gb * k) * h + hor.b * skyInt * (1 - h);
      }
      data[i + 3] = 1;
    }
  }
  if (prev && prev.image.data === data) { prev.needsUpdate = true; return prev; }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType); tex.mapping = THREE.EquirectangularReflectionMapping; tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.colorSpace = THREE.LinearSRGBColorSpace; tex.needsUpdate = true;
  return tex;
}
// 하늘 평균색(안개·지평선)
export function horizonColor(alt) { const day = Math.max(0, Math.min(1, (alt + 0.1) / 0.35)), dusk = Math.max(0, 1 - Math.abs(alt - 0.03) / 0.18); return new THREE.Color().setRGB(0.62, 0.74, 0.88).lerp(new THREE.Color(1.0, 0.52, 0.25), dusk * 0.85).lerp(new THREE.Color(0.05, 0.06, 0.1), 1 - day); }

// ---------- 실내 조명 (층별 천장 격자 배치) ----------
// rects: [{x0,x1,z0,z1,y}] (three 좌표, m) — 각 층 실내 범위와 천장 높이
export function buildInteriorLights(group, rects, { K = 4000, lumen = 1800, spacing = 6, maxPer = 12, maxAll = 32 } = {}) {
  group.clear(); const color = kelvin(K); const cd = lumen / 1800 * 7; let n = 0; // 장면 단위(태양≈2.6) 기준으로 환산
  const fixMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 6, roughness: 0.4 });
  const fixGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.04, 20);
  for (const r of rects) {
    const w = r.x1 - r.x0, d = r.z1 - r.z0; if (w < 1 || d < 1) continue;
    let nx = Math.max(1, Math.round(w / spacing)), nz = Math.max(1, Math.round(d / spacing)); while (nx * nz > maxPer) { if (nx >= nz) nx--; else nz--; }
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      if (n >= maxAll) return n; const x = r.x0 + w * (i + 0.5) / nx, z = r.z0 + d * (j + 0.5) / nz;
      const L = new THREE.PointLight(color, cd, 0, 2); L.position.set(x, r.y - 0.35, z); L.castShadow = false; group.add(L);
      const f = new THREE.Mesh(fixGeo, fixMat); f.position.set(x, r.y - 0.03, z); f.userData.fixture = true; group.add(f); n++;
    }
  }
  return n;
}

// ---------- 조명기구 광원 (Core 1.1.0 light 객체) ----------
// 광속(lm) → 장면 광원 세기 환산. 격자 조명(1800lm≈7)은 약 50 lm/m² 밀도 기준이라,
// 설계 조도(≈500 lx, 약 1000 lm/m²)에서 비슷한 노출이 되도록 0.12배로 낮춤.
export const LM_SCALE = 7 / 1800 * 0.12;
// fixtures: [{x,y,z (three 좌표 m), lm}] — 광원 위치는 발광면 바로 아래
// 광원 수가 maxAll을 넘으면 인접 기구를 묶어 광속을 합산(총 광속 보존)
export function clusterFixtures(fixtures, maxAll = 32) {
  const pts = fixtures.map(f => ({ x: f.x, y: f.y, z: f.z, lm: Math.max(0, +f.lm || 0) }));
  if (pts.length <= maxAll) return pts.map(p => ({ ...p, n: 1 }));
  pts.sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z);
  const k = maxAll, C = Array.from({ length: k }, (_, i) => ({ ...pts[Math.floor((i + 0.5) * pts.length / k)] }));
  const asg = new Int32Array(pts.length);
  const d2 = (p, c) => (p.x - c.x) ** 2 + (p.z - c.z) ** 2 + ((p.y - c.y) * 6) ** 2; // 층이 다르면 묶이지 않도록 높이 가중
  for (let it = 0; it < 8; it++) {
    for (let i = 0; i < pts.length; i++) { let b = 0, bd = Infinity; for (let j = 0; j < k; j++) { const d = d2(pts[i], C[j]); if (d < bd) { bd = d; b = j; } } asg[i] = b; }
    const acc = C.map(() => ({ x: 0, y: 0, z: 0, w: 0, lm: 0, n: 0 }));
    for (let i = 0; i < pts.length; i++) { const p = pts[i], a = acc[asg[i]], w = p.lm || 1; a.x += p.x * w; a.y += p.y * w; a.z += p.z * w; a.w += w; a.lm += p.lm; a.n++; }
    for (let j = 0; j < k; j++) if (acc[j].n) Object.assign(C[j], { x: acc[j].x / acc[j].w, y: acc[j].y / acc[j].w, z: acc[j].z / acc[j].w, lm: acc[j].lm, n: acc[j].n }); else C[j].n = 0;
  }
  return C.filter(c => c.n > 0);
}
export function buildFixtureLights(group, fixtures, { K = 4000, maxAll = 32 } = {}) {
  group.clear(); if (!fixtures.length) return { sources: 0, lm: 0 };
  const color = kelvin(K); const cl = clusterFixtures(fixtures, maxAll); let lm = 0;
  for (const c of cl) { const L = new THREE.PointLight(color, c.lm * LM_SCALE, 0, 2); L.position.set(c.x, c.y, c.z); L.castShadow = false; L.userData.fixtures = c.n; group.add(L); lm += c.lm; }
  return { sources: cl.length, lm };
}
