// 클릭 한 번 영역 인식 — 화면 래스터에서 닫힌 영역을 채우고 외곽선을 추적 (Bluebeam/Togal식)
// lum: 밝기 배열(0~255, 어두운 바탕·밝은 선), w,h, 시작점(x,y), gap: 선 틈 메움 반경(px)
export function wandRegion(lum, w, h, sx, sy, { thr = 80, gap = 2, maxFrac = 0.9 } = {}) {
  const N = w * h; const bar = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (lum[i] > thr) bar[i] = 1;
  // 선 두껍게(틈 메움)
  let wall = bar;
  if (gap > 0) { wall = new Uint8Array(N); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (!bar[y * w + x]) continue; for (let dy = -gap; dy <= gap; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -gap; dx <= gap; dx++) { const xx = x + dx; if (xx < 0 || xx >= w || dx * dx + dy * dy > gap * gap) continue; wall[yy * w + xx] = 1; } } } }
  const s = sy * w + sx; if (wall[s]) return { err: '선 위를 클릭했습니다 — 방 안쪽 빈 곳을 클릭하세요' };
  const fill = new Uint8Array(N); const st = [s]; fill[s] = 1; let cnt = 0, edge = false;
  while (st.length) { const i = st.pop(); cnt++; const x = i % w, y = (i / w) | 0; if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
    if (x > 0 && !fill[i - 1] && !wall[i - 1]) { fill[i - 1] = 1; st.push(i - 1); } if (x < w - 1 && !fill[i + 1] && !wall[i + 1]) { fill[i + 1] = 1; st.push(i + 1); }
    if (y > 0 && !fill[i - w] && !wall[i - w]) { fill[i - w] = 1; st.push(i - w); } if (y < h - 1 && !fill[i + w] && !wall[i + w]) { fill[i + w] = 1; st.push(i + w); }
    if (cnt > N * maxFrac) break; }
  if (edge) return { err: '닫힌 영역이 아닙니다 (화면 끝까지 이어짐) — 확대하거나 벽 틈을 확인하세요' };
  // 틈 메움만큼 다시 키움 (선 중심까지)
  let m = fill; if (gap > 0) { m = new Uint8Array(N); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (!fill[y * w + x]) continue; for (let dy = -gap; dy <= gap; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -gap; dx <= gap; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; m[yy * w + xx] = 1; } } } }
  return { poly: simplify(trace(m, w, h), 1.2), px: cnt };
}
// Moore 이웃 외곽 추적
function trace(m, w, h) {
  let s = -1; for (let i = 0; i < m.length; i++) if (m[i]) { s = i; break; } if (s < 0) return [];
  const D = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x];
  let cx = s % w, cy = (s / w) | 0; const sx = cx, sy = cy; let bx = cx - 1, by = cy; const out = [[cx, cy]];
  for (let guard = 0; guard < m.length; guard++) {
    let k0 = D.findIndex(d => d[0] === bx - cx && d[1] === by - cy); let found = -1;
    for (let j = 1; j <= 8; j++) { const k = (k0 + j) % 8; if (at(cx + D[k][0], cy + D[k][1])) { found = k; break; } }
    if (found < 0) break; const pk = (found + 7) % 8; bx = cx + D[pk][0]; by = cy + D[pk][1]; cx += D[found][0]; cy += D[found][1];
    if (cx === sx && cy === sy) break; out.push([cx, cy]);
  }
  return out;
}
function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  // 가장 먼 두 점으로 나눠 RDP
  let far = 0, fd = 0; for (let i = 1; i < pts.length; i++) { const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const rdp = (a) => { if (a.length < 3) return a; const [p, q] = [a[0], a[a.length - 1]]; const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; let mi = 0, md = 0; for (let i = 1; i < a.length - 1; i++) { const d = Math.abs((q[0] - p[0]) * (p[1] - a[i][1]) - (p[0] - a[i][0]) * (q[1] - p[1])) / L; if (d > md) { md = d; mi = i; } } if (md <= tol) return [p, q]; return [...rdp(a.slice(0, mi + 1)).slice(0, -1), ...rdp(a.slice(mi))]; };
  const A = rdp(pts.slice(0, far + 1)), B = rdp([...pts.slice(far), pts[0]]);
  return [...A.slice(0, -1), ...B.slice(0, -1)];
}
