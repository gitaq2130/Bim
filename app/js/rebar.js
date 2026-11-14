// 배근 상세 → 철근 가공표(BBS)
// KS D 3504 이형철근 단위중량(kg/m)
export const BAR = { D10: 0.560, D13: 0.995, D16: 1.56, D19: 2.25, D22: 3.04, D25: 3.98, D29: 5.04, D32: 6.23, D35: 7.51 };
export const dia = (d) => parseInt(String(d).replace(/\D/g, ''), 10) || 10;
export const STOCK = 8000; // 정척 길이(mm) — 초과 시 겹침이음
export const LAP = 40;     // 겹침이음 길이 = 40d
export const HOOK = 10;    // 갈고리 1개 = 10d (135°)

// "12-D22" → {n:12, d:'D22'} / "D10@150" → {d:'D10', s:150}
export function parseN(s) { const m = String(s || '').trim().match(/^(\d+)\s*-\s*(D\d+)$/i); return m ? { n: +m[1], d: m[2].toUpperCase() } : null; }
export function parseS(s) { const m = String(s || '').trim().match(/^(D\d+)\s*@\s*(\d+)$/i); return m ? { d: m[1].toUpperCase(), s: +m[2] } : null; }

export const FIELDS = {
  column: [['main', '주근 (예: 12-D22)', 'n'], ['hoop', '띠철근 (예: D10@150)', 's']],
  beam: [['top', '상부근 (예: 4-D22)', 'n'], ['bot', '하부근 (예: 4-D22)', 'n'], ['stir', '늑근 (예: D10@200)', 's']],
  slab: [['x', 'X방향 (예: D13@200)', 's'], ['y', 'Y방향 (예: D13@200)', 's'], ['layers', '단수 (1=하부만, 2=상하부)', 'num']],
  wall: [['v', '수직근 (예: D13@200)', 's'], ['h', '수평근 (예: D13@200)', 's'], ['layers', '단수 (1=단배근, 2=복배근)', 'num']],
  footing: [['x', 'X방향 (예: D19@200)', 's'], ['y', 'Y방향 (예: D19@200)', 's'], ['layers', '단수', 'num']],
};
export function defaultSpec(k, el = {}) {
  switch (k) {
    case 'column': return { main: (el.w || 600) >= 600 ? '12-D22' : '8-D22', hoop: 'D10@150', cover: 40 };
    case 'beam': return { top: '4-D22', bot: '4-D22', stir: 'D10@200', cover: 40 };
    case 'slab': return { x: 'D13@200', y: 'D13@200', layers: 2, cover: 20 };
    case 'wall': return { v: 'D13@200', h: 'D13@200', layers: 2, cover: 30 };
    case 'footing': return { x: 'D19@200', y: 'D19@200', layers: 1, cover: 75 };
  }
  return null;
}
const laps = (L, d) => Math.max(0, Math.ceil(L / STOCK) - 1) * LAP * d;

// 객체 하나의 가공표 행: [{mark, dia, len(mm), n, kg}]
export function bbs(el, lv, spec, ctx = {}) {
  if (!spec || el.mat === 'STEEL') return [];
  const c = spec.cover ?? 40, H = el.h ?? lv.height, rows = [];
  const push = (mark, d, len, n) => { if (!d || n <= 0 || len <= 0) return; rows.push({ mark, dia: d, len, n, kg: BAR[d] ? BAR[d] * len / 1000 * n : 0 }); };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  switch (el.k) {
    case 'column': {
      const m = parseN(spec.main), hp = parseS(spec.hoop);
      if (m) { const d = dia(m.d); push('주근', m.d, H + LAP * d, m.n); }
      if (hp) { const d = dia(hp.d); const per = 2 * (el.w - 2 * c) + 2 * (el.d - 2 * c) + 2 * HOOK * d; push('띠철근', hp.d, per, Math.ceil(H / hp.s) + 1); }
      break;
    }
    case 'beam': {
      const L = dist(el.a, el.b), Lc = Math.max(0, L - (ctx.deduct || 0)), t = parseN(spec.top), b = parseN(spec.bot), st = parseS(spec.stir);
      for (const [mk, x] of [['상부근', t], ['하부근', b]]) if (x) { const d = dia(x.d); const len = L + 2 * 15 * d; push(mk, x.d, len + laps(len, d), x.n); }
      if (st) { const d = dia(st.d); const per = 2 * (el.w - 2 * c) + 2 * (el.d - 2 * c) + 2 * HOOK * d; push('늑근', st.d, per, Math.ceil(Lc / st.s) + 1); }
      break;
    }
    case 'slab': {
      const xs = el.pts.map(p => p[0]), ys = el.pts.map(p => p[1]); const W = Math.max(...xs) - Math.min(...xs), D = Math.max(...ys) - Math.min(...ys);
      const A = Math.abs(el.pts.reduce((s, p, i) => { const q = el.pts[(i + 1) % el.pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2); const fill = A / (W * D || 1);
      const ly = spec.layers || 2; const x = parseS(spec.x), y = parseS(spec.y);
      if (x) { const d = dia(x.d); const len = W - 2 * c + 2 * HOOK * d; push('X방향', x.d, len + laps(len, d), Math.ceil(((D - 2 * c) / x.s + 1) * fill) * ly); }
      if (y) { const d = dia(y.d); const len = D - 2 * c + 2 * HOOK * d; push('Y방향', y.d, len + laps(len, d), Math.ceil(((W - 2 * c) / y.s + 1) * fill) * ly); }
      break;
    }
    case 'wall': {
      const L = dist(el.a, el.b), ly = spec.layers || 2, v = parseS(spec.v), hz = parseS(spec.h);
      const opW = (ctx.openings || []).filter(o => o.host === el.id).reduce((s, o) => s + o.w, 0);
      if (v) { const d = dia(v.d); push('수직근', v.d, H + LAP * d, (Math.ceil((L - opW) / v.s) + 1) * ly); }
      if (hz) { const d = dia(hz.d); const len = L - 2 * c + 2 * HOOK * d; push('수평근', hz.d, len + laps(len, d), (Math.ceil(H / hz.s) + 1) * ly); }
      break;
    }
    case 'footing': {
      const ly = spec.layers || 1, x = parseS(spec.x), y = parseS(spec.y);
      if (x) { const d = dia(x.d); push('X방향', x.d, el.w - 2 * c + 2 * (el.t - 2 * c), (Math.ceil((el.d - 2 * c) / x.s) + 1) * ly); }
      if (y) { const d = dia(y.d); push('Y방향', y.d, el.d - 2 * c + 2 * (el.t - 2 * c), (Math.ceil((el.w - 2 * c) / y.s) + 1) * ly); }
      break;
    }
  }
  return rows;
}
// 부재 리스트 키 (같은 종류+태그 = 같은 배근)
export const specKey = (el) => `${el.k}|${el.tag || '(태그없음)'}`;
export function specOf(P, el) { return el.rebar || P.rebarSchedule?.[specKey(el)] || null; }
