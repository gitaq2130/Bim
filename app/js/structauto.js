// 빌더 구조 — 설계 조건 자동 산정 (사용자는 현장·용도 조건만 입력, 재료·시스템·해석법은 툴이 산정해 제안)
import { runStructure, DEFAULTS, SYSTEMS, GRADES, USES, seismicParams } from './structmodel.js';
import { envOf, minFckVertical, beamOk, steelOk, designMember } from './kds.js';
import { polyArea } from './util.js';

// 지역 대표값 (KDS 41 12 00 기본풍속 · KDS 41 17 00 지진구역 — 시·도 단위 근사, 상세 위치는 기준 지도 확인)
export const REGIONS = {
  '서울': [26, 0.11], '인천': [28, 0.11], '경기 (내륙)': [26, 0.11], '경기 (서해안)': [28, 0.11], '강원 (영서)': [26, 0.11], '강원 (북부)': [26, 0.07], '강원 (영동)': [34, 0.11],
  '대전·세종': [26, 0.11], '충북': [26, 0.11], '충남 (내륙)': [26, 0.11], '충남 (서해안)': [30, 0.11], '대구': [26, 0.11], '경북 (내륙)': [26, 0.11], '경북 (동해안)': [34, 0.11], '울릉': [40, 0.11],
  '부산': [38, 0.11], '울산': [34, 0.11], '경남 (내륙)': [28, 0.11], '경남 (남해안)': [38, 0.11], '광주': [28, 0.11], '전북': [28, 0.11], '전남 (내륙)': [30, 0.11], '전남 (서남부 해안)': [38, 0.07], '제주': [44, 0.07],
};
// 용도별: 활하중, 마감·설비 고정하중(SDL, 칸막이 포함), 최소 fck(내구성)
export const USE_INFO = {
  '주거': { LL: 2.0, SDL: 2.4, fmin: 24, note: '온돌 마감(기포·모르타르) 포함' }, '사무실': { LL: 2.5, SDL: 2.5, fmin: 24, note: '마감 1.0 + 천장·설비 0.5 + 칸막이 1.0' },
  '근린생활(판매)': { LL: 5.0, SDL: 2.0, fmin: 24, note: '마감·천장·설비' }, '학교 교실': { LL: 3.0, SDL: 2.0, fmin: 24, note: '마감·천장·설비' }, '집회(고정석 외)': { LL: 5.0, SDL: 1.5, fmin: 24, note: '' },
  '병원 병실': { LL: 2.0, SDL: 2.5, fmin: 24, note: '마감·설비 + 칸막이' }, '경량 창고': { LL: 6.0, SDL: 1.0, fmin: 24, note: '' }, '주차장(승용)': { LL: 3.0, SDL: 1.0, fmin: 27, note: '노출 환경(염화물) 고려' },
};
export const SITE_DEFAULT = { use: '사무실', region: '서울', siteClass: '', qa: null, exp: 'B' };
const EXPO_GF = { A: 2.2, B: 2.0, C: 1.9, D: 1.8 };
const FCK = [24, 27, 30, 35, 40, 45, 50, 60, 70, 80];
const siteOf = (P) => ({ ...SITE_DEFAULT, ...(P.struct?.site || {}) });

function gradeOf(use, stories, gfa) {
  if (use === '병원 병실') return gfa >= 1000 ? ['특', '연면적 1,000㎡ 이상 병원 → 내진특등급'] : ['I', '병원 → 내진I등급'];
  if (use === '학교 교실' || use === '집회(고정석 외)') return ['I', `${use} → 다수 이용 시설, 내진I등급`];
  if (stories >= 16) return ['I', `${stories}층 (16층 이상) → 내진I등급`];
  if (use === '경량 창고' || use === '주차장(승용)') return ['II', `${use} → 내진II등급`];
  return ['II', `${stories}층 ${use} → 내진II등급`];
}
function geomInfo(P, res) {
  const M = res.M; const stories = res.story.length; let gfa = 0; for (const s of M.slabs) gfa += Math.abs(polyArea(s.pts)) / 1e6;
  const typ = M.slabs[Math.floor(M.slabs.length / 2)]; let shapeRatio = 1; if (typ) { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const p of typ.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); } shapeRatio = Math.abs(polyArea(typ.pts)) / ((x1 - x0) * (y1 - y0)); }
  const has = { wall: M.members.some(m => m.kind === 'wall'), col: M.members.some(m => m.kind === 'column'), steel: M.members.some(m => m.mat === 'STEEL' || m.mat === 'SRC') };
  return { stories, gfa, shapeRatio, has, hn: res.info.hn };
}
// 1차 추정 (해석 전)
export function baseSettings(P) {
  const site = siteOf(P); const U = USE_INFO[site.use] || USE_INFO['사무실']; const [V0, Z] = site.region === '직접 입력' ? [site.V0 || 26, site.Z || 0.11] : (REGIONS[site.region] || REGIONS['서울']);
  const n = P.levels.length - 1; const fv = n <= 5 ? 27 : n <= 15 ? 35 : n <= 30 ? 45 : 60;
  return { ...DEFAULTS, fck: Math.max(27, U.fmin), fckV: fv, fy: n <= 3 && site.use === '주거' ? 400 : 500, fyt: 400, Fy: 355, SDL: U.SDL, SDLroof: 2.0, use: site.use, LLroof: 1.0, crack: { ...DEFAULTS.crack },
    seis: { ...DEFAULTS.seis, on: true, Z, I: 2.0, site: site.siteClass || 'S4', sys: 'bf_wall', grade: 'II', method: 'static' }, wind: { on: true, V0, exp: site.exp || 'B', Gf: EXPO_GF[site.exp || 'B'], Cf: 1.3 }, pdelta: false, qa: site.qa, Df: 1500, fckF: 30 };
}
// 해석 → 자동 산정 → (필요시) 재해석 → 설계
export async function autoRun(P, { onProgress, tick = () => Promise.resolve() } = {}) {
  const site = siteOf(P); const U = USE_INFO[site.use] || USE_INFO['사무실']; const rows = []; const add = (k, v, why, cat = '자동') => rows.push({ k, v, why, cat });
  let S = baseSettings(P); if (P.struct?.combos) { /* 사용자 하중조합은 그대로 */ }
  onProgress?.('1차 해석 (구조시스템·재료 산정용)…'); await tick();
  let res = runStructure(P, { settings: S, onProgress }); if (res.empty) return { empty: true };
  const G = geomInfo(P, res);
  // --- 내진등급 ---
  const [grade, gWhy] = gradeOf(site.use, G.stories, G.gfa); S.seis.grade = grade;
  // --- 구조시스템: 벽 밑면전단 분담률 ---
  const R = res.R; const N = res.M.nodes; const wallBase = new Set(); for (const m of res.M.members) if (m.kind === 'wall') { const e = R.E[m.segs[0]].e; for (const n of [e.n1, m.wn[0], m.wn[1]]) if (N[n].fix) wallBase.add(n); }
  const share = (c) => { let w = 0, t = 0; const k = c === 'EX' ? 0 : 1; for (const [n, r] of R.cases[c].reac) { t += Math.abs(r[k]); if (wallBase.has(n)) w += Math.abs(r[k]); } return t ? w / t : 0; };
  const sw = G.has.wall ? Math.min(share('EX'), share('EY')) : 0; let sys, sysWhy;
  if (G.has.wall && !G.has.col) { sys = 'bw_rc'; sysWhy = '기둥 없이 RC 벽이 수직·횡하중을 모두 부담'; }
  else if (G.has.wall) { if (sw >= 0.75) { sys = 'bf_wall'; sysWhy = `RC 벽이 지진 밑면전단의 ${(sw * 100).toFixed(0)}% 부담 (≥75%) → 건물골조`; } else { sys = 'dual_i'; sysWhy = `골조가 밑면전단의 ${((1 - sw) * 100).toFixed(0)}% 부담 (≥25%) → 이중골조`; } }
  else if (G.has.steel && !res.M.members.some(m => m.kind === 'column' && m.mat === 'RC')) { sys = 's_imf'; sysWhy = '철골·SRC 기둥 + 철골보 모멘트골조 (지진구역 I 보편: 중간모멘트골조)'; }
  else { sys = 'rc_imf'; sysWhy = 'RC 기둥·보 모멘트골조 (지진구역 I 보편: 중간모멘트골조)'; }
  S.seis.sys = sys;
  // --- 해석법·P-Δ ---
  const torMax = Math.max(1, ...res.story.map(f => Math.max(f.torEX || 1, f.torEY || 1))); const thMax = Math.max(0, ...res.story.map(f => Math.max(f.thEX || 0, f.thEY || 0)));
  const rs = G.hn >= 70 || torMax > 1.2 || G.stories >= 20; S.seis.method = rs ? 'rs' : 'static';
  S.pdelta = thMax > 0.1 || G.hn >= 70;
  // --- 풍하중 계수 ---
  S.wind.Cf = G.shapeRatio < 0.85 ? 0.8 : 1.3;
  // --- 재료: 수직부재 fck 구간 ---
  onProgress?.('재료 강도 산정 중…'); await tick();
  const lv = res.M.lv; const need = new Map(); const S1 = { ...S }; const ng = [];
  const tall = G.hn >= 70; const vMin = Math.max(U.fmin, tall ? 30 : 0); const cands = FCK.filter(f => f >= vMin);
  for (const [mi, m] of res.M.members.entries()) { if (m.kind === 'beam' || m.mat === 'STEEL') continue; const r = minFckVertical(res, mi, S1, cands); if (!r.ok) ng.push(m); const li = lv.findIndex(l => l.id === m.r.level.id); need.set(li, Math.max(need.get(li) || 0, r.fck)); if (mi % 200 === 199) { onProgress?.(`재료 강도 산정 ${mi + 1}/${res.M.members.length}`); await tick(); } }
  const levels = [...need.keys()].sort((a, b) => a - b); let zones = [];
  if (levels.length) {
    const n = levels.length; const g = n <= 6 ? n : Math.max(5, Math.round(n / 4)); for (let i = 0; i < n; i += g) { const grp = levels.slice(i, i + g); zones.push({ from: grp[0], to: grp[grp.length - 1], fck: Math.max(...grp.map(l => need.get(l))) }); }
    for (let i = zones.length - 2; i >= 0; i--) zones[i].fck = Math.max(zones[i].fck, zones[i + 1].fck); // 아래층 ≥ 위층
    const merged = []; for (const z of zones) { const p = merged[merged.length - 1]; if (p && p.fck === z.fck) p.to = z.to; else merged.push({ ...z }); } zones = merged;
  }
  const zoneOf = (L) => { const li = lv.findIndex(l => l.id === L.id); const z = zones.find(z => li >= z.from && li <= z.to) || (li < (zones[0]?.from ?? 0) ? zones[0] : zones[zones.length - 1]); return z ? z.fck : S.fckV; };
  // --- 재료: 보·슬래브 fck ---
  const beams = res.M.members.map((m, i) => i).filter(i => res.M.members[i].kind === 'beam' && res.M.members[i].mat !== 'STEEL'); const envB = new Map(beams.map(i => [i, envOf(res, i)]));
  let fckH = null; const hMin = Math.max(24, U.fmin, tall ? 27 : 0); for (const f of [24, 27, 30, 35, 40].filter(f => f >= hMin)) { if (beams.every(i => beamOk(res, i, S, f, envB.get(i)))) { fckH = f; break; } } const beamNg = fckH == null; if (beamNg) fckH = 40; fckH = Math.max(fckH, 24);
  // --- 강재 ---
  const steels = res.M.members.map((m, i) => i).filter(i => res.M.members[i].mat === 'STEEL' && res.M.members[i].sh); const envS = new Map(steels.map(i => [i, envOf(res, i)]));
  const fixable = steels.filter(i => steelOk(res, i, S, 460, envS.get(i))); const steelBad = steels.filter(i => !fixable.includes(i)); let Fy = 355; for (const f of [355, 420, 460]) { if (fixable.every(i => steelOk(res, i, S, f, envS.get(i)))) { Fy = f; break; } } const steelNg = steelBad.length > 0;
  const res0 = res;
  // --- 확정 + 재해석 ---
  const vmax = zones.length ? Math.max(...zones.map(z => z.fck)) : S.fckV;
  Object.assign(S, { fck: fckH, fckV: vmax, Fy, fckZone: zoneOf, zones, fckF: G.stories >= 30 ? 40 : G.stories >= 10 ? 35 : 27, rhoAuto: true });
  // 층간변위 만족할 때까지 수직부재 강도 상향 (강성 ∝ fck^(1/3))
  const driftOf = (r) => { const sp = r.info.seis; if (!sp) return { v: 0, lim: 1 }; const rs = r.cases.includes('RX'); return { v: Math.max(0, ...r.story.map(f => rs ? Math.max(f.drRX || 0, f.drRY || 0) : Math.max(f.drEX || 0, f.drEY || 0))) * sp.Cd / sp.Ie, lim: sp.driftLim }; };
  let bump = 0; let drift;
  for (let it = 0; it < 4; it++) { onProgress?.(it ? `층간변위 초과 — 수직부재 강도 상향 후 재해석 (${it})…` : '제안 조건으로 최종 해석…'); await tick(); res = runStructure(P, { settings: S, onProgress }); drift = driftOf(res); if (drift.v <= drift.lim) break;
    zones = zones.map(z => ({ ...z, fck: FCK[Math.min(FCK.length - 1, FCK.indexOf(z.fck) + 1)] })); bump++; S.zones = zones; S.fckV = Math.max(...zones.map(z => z.fck)); }
  const sp = res.info.seis;
  // --- 근거 정리 ---
  const reg = site.region === '직접 입력' ? `직접 입력` : site.region;
  add('용도', `${site.use} — 활하중 ${U.LL} kN/m²`, 'KDS 41 10 15 용도별 등분포활하중', '입력'); add('지역', `${reg} — 기본풍속 ${S.wind.V0} m/s, 지진구역 ${S.seis.Z >= 0.11 ? 'I' : 'II'} (Z=${S.seis.Z})`, '시·도 대표값 (상세 위치는 기준 지도 확인)', '입력');
  add('지반', `${site.siteClass || 'S4 (미조사 → 기준 기본값)'}${site.qa ? ` · 허용지내력 ${site.qa} kPa` : ' · 허용지내력 미입력'}`, '지반조사 결과', '입력'); add('노풍도', `${S.wind.exp}`, '주변 환경', '입력');
  add('마감·설비 하중 SDL', `${S.SDL} kN/m² (지붕 ${S.SDLroof})`, U.note || '용도 대표값');
  add('내진등급', `${grade}등급 (Ie=${GRADES[grade][0]}, 허용 층간변위 ${GRADES[grade][1] * 100}%)`, gWhy + ' — KDS 41 17 00');
  add('구조시스템', `${SYSTEMS[sys][0]} (R=${SYSTEMS[sys][1]}, Cd=${SYSTEMS[sys][2]})`, sysWhy);
  add('지진 해석법', rs ? '응답스펙트럼 + 등가정적' : '등가정적', rs ? `${G.hn >= 70 ? `높이 ${G.hn.toFixed(0)} m ≥ 70 m` : G.stories >= 20 ? `${G.stories}층 고층` : `비틀림비 ${torMax.toFixed(2)} > 1.2`} → 동적해석` : `높이 ${G.hn.toFixed(1)} m, 정형 (비틀림비 ${torMax.toFixed(2)})`);
  add('P-Δ', S.pdelta ? '고려' : '생략', `안정계수 θmax = ${thMax.toFixed(3)}${S.pdelta ? (thMax > 0.1 ? ' > 0.1' : ' (고층 — 보수적으로 고려)') : ' ≤ 0.1'}`);
  add('콘크리트 — 기둥·벽', zones.length ? zones.map(z => `${lv[z.from].name}~${lv[z.to].name} ${z.fck}`).join(' · ') + ' MPa' : '-', `주근비 2.5% 이내로 모든 수직부재가 P-M·전단을 만족하는 최소 강도를 층 구간별로 산정${bump ? ` → 층간변위(${(drift.v * 100).toFixed(2)}% / 허용 ${(drift.lim * 100).toFixed(1)}%) 만족 위해 ${bump}단계 상향` : ''}${ng.length ? ` (단면 부족 ${ng.length}개 — 단면 증대 필요)` : ''}${tall ? ' · 고층 수직부재 최소 30 MPa (축소량·품질 관리)' : ''}${vmax / fckH > 1.4 ? ` · 기둥/바닥 강도비 ${(vmax / fckH).toFixed(1)} > 1.4 → 접합부 고강도 콘크리트 타설 필요` : ''}`);
  add('콘크리트 — 보·슬래브', `${fckH} MPa`, beamNg ? '40 MPa에서도 일부 보 단면 부족 — 단면 증대 필요' : `모든 RC 보가 인장지배 철근비·전단 한도를 만족하는 최소 강도 (최소 ${hMin}${tall ? ' — 고층 바닥 균열·처짐 관리' : ' — 내구성'})`);
  add('콘크리트 — 기초', `${S.fckF} MPa`, `${G.stories}층 규모 — 기초 펀칭·매스 고려`);
  add('철근', `주근 SD${S.fy} · 전단철근 SD${S.fyt}`, S.fy === 500 ? '국내 보편 고강도 주근 (철근량 절감), 전단철근은 가공성·연성 고려 SD400' : '소규모 주거 — 조달·가공 용이');
  if (steels.length) add('강재', `SM${Fy}`, `철골 부재가 조합식(H1-1)을 만족하는 최소 등급${steelNg ? ` · 등급으로 해결 안 되는 ${steelBad.length}개 (${[...new Set(steelBad.map(i => res0.M.members[i].el.tag || '철골'))].join(', ')}) → 단면 증대·지지 조건 확인` : ''}`);
  add('풍하중 계수', `Gf ${S.wind.Gf} · Cf ${S.wind.Cf}`, `노풍도 ${S.wind.exp} · 평면 ${G.shapeRatio < 0.85 ? '곡면(원형)' : '사각형'}`);
  add('안전계수', '하중계수·강도감소계수 KDS 고정값', '1.2D+1.6L 등 18개 조합, 휨 φ0.85 · 압축 φ0.65 · 전단 φ0.75', '기준');
  return { res, S, rows, G, sys, grade };
}
export { USES };
