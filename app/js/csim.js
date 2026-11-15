// 빌더 시공 시뮬레이션 엔진 — 착공~준공 일 단위 공정 생성·계산
// 모델 객체 + 도급내역(P.boq)에서 세부 작업(공종 템플릿)을 만들고, 물량·생산성으로 기간을 잡고,
// 달력(휴일·우천·기온)·실적(역순 시공 보완)·지연 상황을 반영해 다시 계산한다. 단위: 날짜 = 착공일 기준 일 번호(정수).
import { allElements, takeoff, isRefElement, KINDS, elBoxes } from './model.js';
import { polyArea } from './util.js';

const DAY = 86400000;
export const toD = (s) => Math.floor(new Date(s + 'T00:00:00Z').getTime() / DAY);
export const toS = (d) => new Date(d * DAY).toISOString().slice(0, 10);
const WD = ['일', '월', '화', '수', '목', '금', '토'];
export const wdOf = (d) => WD[(d + 4) % 7]; // 1970-01-01 = 목

// ---------- 달력 ----------
const HOLI = ['01-01', '03-01', '05-05', '06-06', '08-15', '10-03', '10-09', '12-25'];
const LUNAR = { 2026: ['02-16', '02-17', '02-18', '05-24', '09-24', '09-25', '09-26'], 2027: ['02-06', '02-07', '02-08', '05-13', '09-14', '09-15', '09-16'], 2028: ['01-26', '01-27', '01-28', '05-02', '10-02', '10-03', '10-04'], 2029: ['02-12', '02-13', '02-14', '05-20', '09-21', '09-22', '09-23'], 2030: ['02-02', '02-03', '02-04', '05-09', '09-11', '09-12', '09-13'], 2031: ['01-22', '01-23', '01-24', '05-28', '09-30', '10-01', '10-02'] };
const isHoliday = (s) => HOLI.includes(s.slice(5)) || (LUNAR[s.slice(0, 4)] || []).includes(s.slice(5));
// 서울 평년: 월 평균기온(℃), 일강수 10mm 이상 일수(30일당)
export const CLIMATE = { 서울: { t: [-2, 1, 6, 13, 18, 23, 25, 26, 21, 15, 7, 0], rain: [1, 1.5, 2.5, 3.5, 4, 5, 10, 9, 5, 3, 3, 1.5] }, 부산: { t: [3, 5, 9, 14, 18, 21, 25, 26, 23, 18, 12, 6], rain: [1.5, 2, 3.5, 4.5, 5, 6, 8, 7, 6, 3, 2.5, 1.5] }, 하노이: { t: [17, 18, 21, 25, 28, 30, 30, 29, 28, 26, 22, 19], rain: [0.5, 1, 1.5, 3, 6, 8, 10, 11, 8, 4, 1.5, 0.5] } };
const rnd = (seed) => { let x = Math.sin(seed * 12.9898) * 43758.5453; return x - Math.floor(x); };
export function makeCalendar(C) {
  const cl = CLIMATE[C.region] || CLIMATE.서울; const week = C.week || 6; const ev = C.events || [];
  const cache = new Map();
  const info = (d) => {
    let r = cache.get(d); if (r) return r; const s = toS(d), m = +s.slice(5, 7) - 1, w = (d + 4) % 7;
    const off = w === 0 || (week === 5 && w === 6) || isHoliday(s);
    let rain = C.climate !== false && rnd(d * 7.31 + 3) < cl.rain[m] / 30;
    const stop = []; for (const e of ev) { const a = toD(e.from), b = a + (+e.days || 1); if (d < a || d >= b) continue; if (e.type === 'rain') rain = true; else stop.push(e); }
    r = { s, off, rain, temp: cl.t[m], stop }; cache.set(d, r); return r;
  };
  // 이 작업이 그날 일할 수 있나
  const can = (d, t) => { const i = info(d); if (t.cal) return true; if (i.off && !t.anyDay) return false; if (t.out && i.rain) return false; for (const e of i.stop) { if (e.type === 'stop') return false; if (e.trade && e.trade === t.trade) return false; if (e.code && e.code === t.code) return false; if (e.zone && t.lv === e.zone) return false; } return true; };
  return { info, can };
}

// ---------- 생산성 (1조·1일 기준) ----------
// [수량/조·일, 조 인원, 협력 공종]
export const PROD = {
  RBR: [2.2, 6, '철근'], FRM: [70, 7, '형틀'], CON: [300, 8, '타설'], STL: [12, 6, '철골'], CMU: [18, 3, '조적'], DRY: [45, 4, '수장'], GLZ: [40, 5, '커튼월'],
  WIN: [25, 3, '창호'], DOR: [8, 2, '창호'], DCT: [30, 4, '설비'], PIP: [35, 3, '설비'], TRY: [40, 3, '전기'], FIN: [30, 4, '금속'], SPK: [40, 3, '소방'], PNL: [3, 3, '전기'],
  LGT: [30, 3, '전기'], CLG: [45, 4, '수장'], FLR: [55, 4, '바닥'], WLF: [80, 4, '도장'], BSE: [90, 2, '수장'], LTR: [12, 5, '조경'], LSH: [300, 5, '조경'],
};
export const TRADES = ['가설', '토공', '철근', '형틀', '타설', '철골', '데크', '전기', '설비', '소방', '조적', '방수', '창호', '커튼월', '금속', '수장', '도장', '바닥', '조경', '포장', '공무'];
const ZONES_PER = 420; // ㎡당 1존 (타설 구획)

// 매립·검측 체크리스트
const CK = {
  layout: ['기준점·레벨 확인', '먹매김 검측(감리)'],
  vrebar: ['철근 규격·개수·간격 (배근도)', '이음 위치·길이', '띠철근·후크 각도', '피복 스페이서'],
  embed: ['전선관(CD관)·박스 위치 도면 대조', '접지선 주철근 결속·연속성', '설비 슬리브·인서트 위치', '매립물 고정(타설 시 이탈 방지)'],
  vform: ['수직도·치수', '긴결재·폼타이 간격', '개구부 박스', '박리제 도포'],
  hform: ['동바리 간격·수직도·수평연결재', '보·슬래브 레벨(캠버)', '거푸집 이음 틈'],
  srebar: ['하부근 피복(스페이서)', '상부근 받침(체어)', '보 정착 길이', '개구부 보강근'],
  sembed: ['슬래브 전선관·박스·접지 연결', '설비 슬리브(바닥 관통)·인서트', '배수구·드레인 위치'],
  pourck: ['타설 전 검측 서명(감리)', '레미콘 배합·슬럼프·공기량', '공시체 채취', '타설 순서·이음 계획', '기상(강우·기온) 확인'],
  cure: ['습윤 양생·살수', '한중/서중 양생 조치', '양생 중 적재 금지'],
  strip: ['측면 거푸집: 압축강도 5MPa 이상', '탈형 후 면 보수(곰보·재료분리)'],
  shore: ['슬래브 하부 동바리: 설계기준강도 2/3 이상·최소 14MPa', '상부 2개층 타설 후 해체(존치)'],
  steel: ['반입 검수(밀시트·도장)', '앵커볼트 위치·레벨', '건립 수직도·본조임 토크', '용접 비파괴검사'],
  deck: ['데크 걸침 길이·고정 용접', '스터드(전단연결재) 용접·타격시험', '단부 막음판'],
  parapet: ['파라펫 철근 정착', '피뢰 파라펫링(도체) 철근 결속', '인하도선 연결·저항 측정'],
  wp: ['바탕 함수율·청소', '모서리·드레인 보강', '도막 두께', '담수 시험 48시간'],
  coping: ['방수층 손상 여부', '후레싱 고정·실링', '두겁석 구배(안쪽)'],
  win: ['창틀 수직·수평', '고정 앵커', '창틀 주위 사춤·실링', '살수 시험'],
  mep: ['행거·인서트 간격', '수압·누설 시험', '절연저항 측정', '보온·방화구획 관통부 처리'],
  ceil: ['천장 속 설비 검측 완료(수압·누설·절연)', '점검구 위치', '조명·헤드 개구 위치'],
  fin: ['바탕 평활·함수율', '마감 자재 승인품 확인'],
  scaf: ['비계 벽이음 간격', '작업발판·안전난간', '추락방호망'],
};

// ---------- 작업 생성 ----------
const isGlassWall = (el) => el.mat === 'GLASS';
const isRC = (el) => !el.mat || el.mat === 'RC' || el.mat === 'SRC' || el.mat === 'PC';
export function buildTasks(P) {
  const C = P.csim; const lv = [...P.levels].sort((a, b) => a.elev - b.elev); const n = lv.length;
  const all = allElements(P, r => !isRefElement(r.el, r.sheet, P));
  // 부재별 수량 (코드별)
  const q = new Map(); for (const r of takeoff(P)) { if (!r.el?.id) continue; const m = q.get(r.el.id) || {}; m[r.code] = (m[r.code] || 0) + r.qty; q.set(r.el.id, m); }
  const qOf = (els, code) => els.reduce((s, r) => s + ((q.get(r.el.id) || {})[code] || 0) * (share.get(r.el.id) || 1), 0);
  // 층 면적·존
  const area = lv.map(L => { const s = all.filter(r => r.el.k === 'slab' && r.level.id === L.id); return s.reduce((a, r) => a + Math.abs(polyArea(r.el.pts)) / 1e6, 0); });
  const maxA = Math.max(100, ...area); const Z = C.zones || Math.max(1, Math.min(4, Math.round(maxA / ZONES_PER)));
  const bb = (() => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const r of all) if (r.el.k === 'slab') for (const p of r.el.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); } if (!isFinite(x0)) { x0 = 0; x1 = 10000; y0 = 0; y1 = 10000; } return { x0, x1, y0, y1 }; })();
  const alongX = bb.x1 - bb.x0 >= bb.y1 - bb.y0;
  const cen = (el) => el.p || (el.a && el.b ? [(el.a[0] + el.b[0]) / 2, (el.a[1] + el.b[1]) / 2] : el.pts ? [el.pts.reduce((s, p) => s + p[0], 0) / el.pts.length, el.pts.reduce((s, p) => s + p[1], 0) / el.pts.length] : [0, 0]);
  const zoneOf = (el) => { if (Z === 1) return 0; const c = cen(el); const t = alongX ? (c[0] - bb.x0) / (bb.x1 - bb.x0 || 1) : (c[1] - bb.y0) / (bb.y1 - bb.y0 || 1); return Math.max(0, Math.min(Z - 1, Math.floor(t * Z))); };
  // 여러 존에 걸친 큰 부재(슬래브 등)는 모든 존에 나눠 담는다 (수량은 1/Z)
  const span = (el) => { if (Z === 1 || !el.pts) return false; const xs = el.pts.map(p => alongX ? p[0] : p[1]); return (Math.max(...xs) - Math.min(...xs)) > ((alongX ? bb.x1 - bb.x0 : bb.y1 - bb.y0) / Z) * 1.5; };
  const inZone = (r, z) => span(r.el) || zoneOf(r.el) === z;
  const share = new Map();
  const ZN = (z) => Z === 1 ? '' : ` ${String.fromCharCode(65 + z)}존`;
  // 슬래브 외곽 근처 = 외벽
  const slabsBy = new Map(); for (const r of all) if (r.el.k === 'slab') (slabsBy.get(r.level.id) || slabsBy.set(r.level.id, []).get(r.level.id)).push(r.el.pts);
  const nearEdge = (r) => { const c = cen(r.el); const lvSl = slabsBy.get(r.level.id) || slabsBy.get(lv[Math.max(0, lv.indexOf(r.level) - 1)]?.id) || []; for (const pts of lvSl) for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; const dx = b[0] - a[0], dy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))); if (Math.hypot(a[0] + dx * t - c[0], a[1] + dy * t - c[1]) < 600) return true; } return false; };
  const crewsFor = (A) => Math.max(1, Math.min(4, Math.round(A / 600)));

  const T = []; const byId = new Map();
  const add = (o) => { const t = { preds: [], els: [], out: false, check: [], ...o }; if (byId.has(t.id)) return byId.get(t.id); T.push(t); byId.set(t.id, t); return t; };
  const dep = (t, p, lag = 0, cal = 0) => { if (t && p) t.preds.push({ id: p.id, lag, cal }); };
  const durQ = (code, qty, crews = 1, min = 1) => { const p = PROD[code]; if (!p || !qty) return min; return Math.max(min, Math.ceil(qty / (p[0] * crews))); };
  const men = (code, crews = 1) => (PROD[code]?.[1] || 4) * crews;
  // 목표 기간 안에 끝내도록 조 편성 (상한 cap조) → { dur, men }
  const TGT = C.target || {}; const tg = (k, d) => TGT[k] ?? d;
  const plan = (code, qty, days, cap = 8) => { const p = PROD[code]; if (!p || !qty) return { dur: 1, men: p ? p[1] : 3, qty: qty || 0 }; const cr = Math.max(1, Math.min(cap, Math.ceil(qty / (p[0] * days)))); return { dur: Math.max(1, Math.ceil(qty / (p[0] * cr))), men: p[1] * cr, crews: cr, qty }; };
  const elIds = (rs) => rs.map(r => r.el.id);

  // 0. 착공·가설
  const t0 = add({ id: 'pre.mob', name: '착공·현장 개설 (가설울타리·가설사무소·가설전기/용수)', ph: '가설', trade: '가설', code: 'TMP', dur: 10, men: 8, out: true, check: ['착공계·안전관리계획서 승인', '가설울타리·출입 게이트', '세륜시설', '가설 전기·용수 인입'], temp: 'fence' });
  const tSurvey = add({ id: 'pre.survey', name: '측량·규준틀·지장물 확인', ph: '가설', trade: '공무', dur: 3, men: 4, out: true, check: ['기준점 인수', '경계 측량', '지장물(매설관) 확인'] }); dep(tSurvey, t0, 0);
  // 1. 토공·흙막이·기초
  const L0 = lv[0]; const basement = L0.elev < 0; const lo = Math.min(0, ...lv.map(l => l.elev));
  const fp = (slabsBy.get(L0.id) || [])[0]; const fpA = area[0] || maxA; const exDepth = basement ? -lo / 1000 + 1.5 : 1.5;
  const excV = (P.civil?.last ? P.civil.last.cut : 0) + fpA * exDepth * 1.15;
  let prev = tSurvey;
  if (basement || exDepth > 3) { const tSh = add({ id: 'ew.shore', name: '흙막이 (CIP·H-pile·토류판) 시공', ph: '토공', trade: '토공', dur: Math.ceil(Math.sqrt(fpA) * 4 / 12), men: 10, out: true, check: ['흙막이 계측기 설치', '인접 건물 사전 조사'], temp: 'retain' }); dep(tSh, prev); prev = tSh; }
  const tEx = add({ id: 'ew.exc', name: `터파기 (${Math.round(excV).toLocaleString()} m³) · 잔토 반출`, ph: '토공', trade: '토공', dur: Math.max(2, Math.ceil(excV / 400)), men: 4, out: true, equip: ['굴착기 0.7m³', '덤프'], check: ['굴착 깊이·경사', '지하수·배수', '터파기 바닥 지내력 확인(평판재하)'], temp: 'exc' }); dep(tEx, prev);
  const tLean = add({ id: 'ew.lean', name: '잡석 다짐·버림 콘크리트·방습층', ph: '토공', trade: '타설', dur: Math.max(1, Math.ceil(fpA / 400)), men: 6, out: true, check: ['다짐도', '버림 레벨'] }); dep(tLean, tEx);
  // 기초: footing + 최하층 슬래브(기초 매트/지중보/바닥)
  const fEls = all.filter(r => r.el.k === 'footing' || (r.el.k === 'slab' && r.level.id === L0.id));
  const fRB = qOf(fEls, 'RBR'), fFR = qOf(fEls, 'FRM'), fCO = qOf(fEls, 'CON'); const fc = crewsFor(fpA);
  const tFg = add({ id: 'fd.ground', name: '구조체 접지(기초 접지망) 매설·측정', ph: '기초', trade: '전기', code: null, dur: 1, men: 3, out: true, check: ['접지 저항 측정', '인하도선 인출 위치'], els: elIds(fEls) }); dep(tFg, tLean);
  const tFr = add({ id: 'fd.rebar', name: '기초 철근 배근', ph: '기초', trade: '철근', code: 'RBR', ...plan('RBR', fRB, 4), out: true, els: elIds(fEls), st: 'rebar', check: CK.srebar }); dep(tFr, tFg);
  const tFe = add({ id: 'fd.embed', name: '기초 매립 (배수 피트·설비 슬리브·접지 연결)', ph: '기초', trade: '설비', dur: 1, men: 3, out: true, els: elIds(fEls), st: 'embed', check: CK.sembed }); dep(tFe, tFr);
  const tFf = add({ id: 'fd.form', name: '기초 거푸집', ph: '기초', trade: '형틀', code: 'FRM', ...plan('FRM', fFR, 4), out: true, els: elIds(fEls), st: 'form', check: CK.vform }); dep(tFf, tFr);
  const tFp = add({ id: 'fd.pour', name: `기초 콘크리트 타설 (${Math.round(fCO)} m³)`, ph: '기초', trade: '타설', code: 'CON', qty: fCO, dur: durQ('CON', fCO), men: 10, out: true, els: elIds(fEls), st: 'poured', equip: ['펌프카', '레미콘'], check: CK.pourck, pour: true }); dep(tFp, tFf); dep(tFp, tFe);
  const tFc = add({ id: 'fd.cure', name: '기초 양생', ph: '기초', trade: '타설', dur: 5, cal: true, curing: true, els: elIds(fEls), st: 'curing', check: CK.cure }); dep(tFc, tFp);
  const tFs = add({ id: 'fd.strip', name: '기초 탈형·되메우기·다짐', ph: '기초', trade: '토공', dur: Math.max(2, Math.ceil(fpA / 300)), men: 5, out: true, els: elIds(fEls), st: 'done', check: ['되메우기 다짐도', '외부 방수(지하)'] }); dep(tFs, tFc);
  if (basement) tFs.name = '기초 탈형·지하 외벽 방수·되메우기';
  // 타워크레인
  const tall = n > 6 || maxA > 1500; let tTC = null, tHo = null;
  if (tall) { tTC = add({ id: 'eq.tc.up', name: '타워크레인 기초·설치·검사', ph: '가설', trade: '가설', dur: 4, men: 6, out: true, check: ['TC 기초 앵커', '설치 검사(안전인증)', '작업 반경·충돌 방지'], temp: 'tc' }); dep(tTC, tFp, 0, 7); }

  // 2. 골조 사이클 (층 i: 수직부재 i + 수평부재 = 층 i 보 + 층 i+1 슬래브)
  const sPour = []; // [i][z] 타설 작업
  const sForm = [];
  let prevVert = null;
  for (let i = 0; i < n; i++) {
    const L = lv[i], up = lv[i + 1]; const top = !up; sPour[i] = []; sForm[i] = [];
    const vert = all.filter(r => r.level.id === L.id && ((r.el.k === 'column') || (r.el.k === 'wall' && isRC(r.el) && (r.sheet.disc === 'S' || r.el.mat === 'RC'))));
    const hor = all.filter(r => (r.level.id === L.id && r.el.k === 'beam') || (up && r.level.id === up.id && r.el.k === 'slab'));
    if (!vert.length && !hor.length) continue;
    const steel = hor.some(r => r.el.mat === 'STEEL') || vert.some(r => r.el.mat === 'STEEL' || r.el.mat === 'SRC');
    const parapet = top && vert.length && vert.every(r => r.el.k === 'wall' && (r.el.h ?? L.height) <= 1600);
    const A = area[i + 1] || area[i] || maxA; const cr = Math.max(1, Math.round(crewsFor(A) / Z));
    for (let z = 0; z < Z; z++) {
      const V = vert.filter(r => inZone(r, z)), Hh = hor.filter(r => inZone(r, z)); for (const r of [...V, ...Hh]) if (span(r.el)) share.set(r.el.id, 1 / Z); if (!V.length && !Hh.length) continue;
      const tag = `${L.name}${ZN(z)}`; const key = `${L.id}.${z}`; const base = { lv: L.id, zone: z, ph: parapet ? '옥상' : '골조', out: true };
      const below = i > 0 ? (sPour[i - 1][z] || sPour[i - 1].find(Boolean)) : tFs;
      if (parapet) { // 옥상 파라펫 → 방수 → 후레싱·두겁석
        const r1 = add({ ...base, id: `rf.rebar.${key}`, name: `${tag} 파라펫 철근 배근 + 피뢰 파라펫링 결속`, trade: '철근', code: 'RBR', ...plan('RBR', qOf(V, 'RBR'), 2), els: elIds(V), st: 'rebar', check: CK.parapet }); dep(r1, below, 1);
        const r1e = add({ ...base, id: `rf.ground.${key}`, name: `${tag} 피뢰 도체·인하도선 연결 확인`, trade: '전기', dur: 1, men: 2, els: elIds(V), st: 'embed', check: CK.parapet }); dep(r1e, r1);
        const r2 = add({ ...base, id: `rf.form.${key}`, name: `${tag} 파라펫 거푸집`, trade: '형틀', code: 'FRM', ...plan('FRM', qOf(V, 'FRM'), 2), els: elIds(V), st: 'form', check: CK.vform }); dep(r2, r1e);
        const r3 = add({ ...base, id: `rf.pour.${key}`, name: `${tag} 파라펫 타설`, trade: '타설', code: 'CON', qty: qOf(V, 'CON'), dur: 1, men: 8, els: elIds(V), st: 'poured', pour: true, equip: ['펌프카'], check: CK.pourck }); dep(r3, r2);
        const r4 = add({ ...base, id: `rf.cure.${key}`, name: `${tag} 파라펫 양생`, trade: '타설', dur: 3, cal: true, curing: true, els: elIds(V), st: 'curing', check: CK.cure }); dep(r4, r3);
        const r5 = add({ ...base, id: `rf.strip.${key}`, name: `${tag} 파라펫 탈형·면보수`, trade: '형틀', dur: 1, men: 4, els: elIds(V), st: 'done', check: CK.strip }); dep(r5, r4);
        sPour[i][z] = r3; continue;
      }
      let last = below;
      const tLay = add({ ...base, id: `st.lay.${key}`, name: `${tag} 먹매김`, trade: '형틀', dur: 1, men: 3, check: CK.layout }); dep(tLay, last, 0); if (z > 0) dep(tLay, byId.get(`st.lay.${L.id}.${z - 1}`)); else if (i > 0) { const pl = [...Array(Z).keys()].reverse().map(k => byId.get(`st.lay.${lv[i - 1].id}.${k}`)).find(Boolean); if (pl) dep(tLay, pl, 2); } last = tLay;
      let vDone = tLay;
      if (V.length) {
        const vs = V.filter(r => r.el.mat === 'STEEL' || r.el.mat === 'SRC');
        if (vs.length) { const tE = add({ ...base, id: `st.erect.${key}`, name: `${tag} 철골 기둥 세우기·접합`, trade: '철골', code: 'STL', ...plan('STL', qOf(vs, 'STL'), tg('steel', 2)), els: elIds(vs), st: 'steel', equip: ['타워크레인'], check: CK.steel }); dep(tE, last); last = tE; }
        const vrc = V.filter(r => r.el.mat !== 'STEEL');
        if (vrc.length) {
          const tR = add({ ...base, id: `st.vrebar.${key}`, name: `${tag} 기둥·벽 철근 배근`, trade: '철근', code: 'RBR', ...plan('RBR', qOf(vrc, 'RBR'), tg('vrebar', 2)), els: elIds(vrc), st: 'rebar', check: CK.vrebar }); dep(tR, last);
          const tE = add({ ...base, id: `st.vembed.${key}`, name: `${tag} 기둥·벽 매립 (전선관·박스·접지선·설비 슬리브)`, trade: '전기', dur: 1, men: 4, els: elIds(vrc), st: 'embed', check: CK.embed }); dep(tE, tR, -1);
          const tF = add({ ...base, id: `st.vform.${key}`, name: `${tag} 기둥·벽 거푸집 (갱폼/알폼)`, trade: '형틀', code: 'FRM', ...plan('FRM', qOf(vrc, 'FRM'), tg('vform', 2)), els: elIds(vrc), st: 'form', check: CK.vform }); dep(tF, tE);
          vDone = tF;
        } else vDone = last;
      }
      let hDone = vDone;
      if (Hh.length) {
        const hb = Hh.filter(r => r.el.k === 'beam'), hs = Hh.filter(r => r.el.k === 'slab');
        if (steel) {
          const bs = hb.filter(r => r.el.mat === 'STEEL'); let tB = null;
          if (bs.length) { tB = add({ ...base, id: `st.beam.${key}`, name: `${tag} 철골 보 설치·본조임`, trade: '철골', code: 'STL', ...plan('STL', qOf(bs, 'STL'), tg('steel', 2)), els: elIds(bs), st: 'steel', equip: ['타워크레인'], check: CK.steel }); dep(tB, last); }
          const tD = add({ ...base, id: `st.deck.${key}`, name: `${tag} 데크플레이트 설치·스터드 용접`, trade: '데크', code: 'FRM', qty: qOf(hs, 'FRM'), dur: Math.max(1, Math.ceil(qOf(hs, 'FRM') / 250)), men: 6, els: elIds(hs), st: 'form', check: CK.deck }); dep(tD, tB || last);
          sForm[i][z] = tD; hDone = tD;
        } else {
          const tF = add({ ...base, id: `st.hform.${key}`, name: `${tag} 동바리·보/슬래브 거푸집`, trade: '형틀', code: 'FRM', ...plan('FRM', qOf(Hh, 'FRM'), tg('hform', 3)), els: elIds(Hh), st: 'form', check: CK.hform, temp: 'shore' }); dep(tF, vDone);
          if (hb.length) { const tBR = add({ ...base, id: `st.brebar.${key}`, name: `${tag} 보 철근 배근`, trade: '철근', code: 'RBR', ...plan('RBR', qOf(hb, 'RBR'), 1), els: elIds(hb), st: 'rebar', check: CK.srebar }); dep(tBR, tF); hDone = tBR; } else hDone = tF;
          sForm[i][z] = tF;
        }
        if (hs.length) {
          const tS1 = add({ ...base, id: `st.slow.${key}`, name: `${tag} 슬래브 하부근 배근`, trade: '철근', code: 'RBR', ...plan('RBR', qOf(hs, 'RBR') * 0.5, 1), els: elIds(hs), st: 'rebar', check: CK.srebar }); dep(tS1, hDone);
          const tS2 = add({ ...base, id: `st.sembed.${key}`, name: `${tag} 슬래브 매립 (전선관·박스·접지·설비 슬리브·인서트)`, trade: '전기', dur: 1, men: 5, els: elIds(hs), st: 'embed', check: CK.sembed }); dep(tS2, tS1, -1);
          const tS3 = add({ ...base, id: `st.sup.${key}`, name: `${tag} 슬래브 상부근 배근·배근 검측`, trade: '철근', code: 'RBR', ...plan('RBR', qOf(hs, 'RBR') * 0.5, 1), els: elIds(hs), st: 'rebar', check: CK.srebar }); dep(tS3, tS2);
          hDone = tS3;
        }
      }
      const pv = qOf([...V, ...Hh], 'CON');
      const tP = add({ ...base, id: `st.pour.${key}`, name: `${tag} 콘크리트 타설 (${Math.round(pv)} m³)`, trade: '타설', code: 'CON', qty: pv, dur: durQ('CON', pv), men: 10, els: elIds([...V.filter(r => r.el.mat !== 'STEEL'), ...Hh.filter(r => r.el.mat !== 'STEEL')]), st: 'poured', pour: true, equip: ['펌프카', '레미콘'], check: CK.pourck }); dep(tP, hDone); dep(tP, vDone); if (z > 0) dep(tP, sPour[i][z - 1], 1);
      const tC = add({ ...base, id: `st.cure.${key}`, name: `${tag} 양생`, trade: '타설', dur: 2, cal: true, curing: true, els: tP.els, st: 'curing', check: CK.cure }); dep(tC, tP);
      const tSt = add({ ...base, id: `st.strip.${key}`, name: `${tag} 기둥·벽 측면 거푸집 탈형`, trade: '형틀', dur: 1, men: 4, els: elIds(V.filter(r => r.el.mat !== 'STEEL')), st: 'stripped', check: CK.strip }); dep(tSt, tC);
      sPour[i][z] = tP; void key; void prevVert;
    }
  }
  // 동바리 해체: 위 2개층 타설 후 + 14일
  for (let i = 0; i < n; i++) for (let z = 0; z < Z; z++) {
    const f = sForm[i]?.[z]; const p = sPour[i]?.[z]; if (!f || !p || f.trade === '데크') continue;
    const up2 = sPour[i + 2]?.[z] || sPour[i + 2]?.find(Boolean);
    const t = add({ lv: lv[i].id, zone: z, ph: '골조', id: `st.shore.${lv[i].id}.${z}`, name: `${lv[i].name}${ZN(z)} 보·슬래브 동바리 해체`, trade: '형틀', dur: 1, men: 5, els: f.els, st: 'done', check: CK.shore }); dep(t, p, 0, 14); if (up2) dep(t, up2, 0, 3);
  }
  const topPour = (() => { for (let i = n - 1; i >= 0; i--) { const xs = (sPour[i] || []).filter(Boolean); if (xs.length) return xs; } return [tFp]; })();
  const structEnd = add({ id: 'ms.topout', name: '골조 완료 (상량)', ph: '골조', trade: '공무', dur: 0, ms: true }); for (const t of topPour) dep(structEnd, t);
  if (tTC) { const d = add({ id: 'eq.tc.down', name: '타워크레인 해체', ph: '가설', trade: '가설', dur: 3, men: 6, out: true, temp: 'tc', check: ['해체 계획서', '하부 통제'] }); dep(d, structEnd, 5); }

  // 3. 외부 비계 (층별 설치 → 외장 후 해체)
  const scafUp = [], scafDn = [];
  for (let i = 0; i < n; i++) { const p = (sPour[i] || []).find(Boolean); if (!p) continue; const hi = n > 15; const t = add({ lv: lv[i].id, id: `sc.up.${lv[i].id}`, name: hi ? `${lv[i].name} 외부 보호망(SCN)·작업발판 인상` : `${lv[i].name} 외부 시스템비계 설치`, ph: '가설', trade: '가설', dur: 1, men: 4, out: true, temp: 'scaf', check: CK.scaf }); dep(t, p, 1); scafUp[i] = t; }
  // 4. 외장·창호 (층별)
  const envEnd = [];
  for (let i = 0; i < n; i++) {
    const L = lv[i]; const ext = all.filter(r => r.level.id === L.id && ((r.el.k === 'wall' && (isGlassWall(r.el) || (r.el.mat === 'CMU' && nearEdge(r)) || (isRC(r.el) && nearEdge(r) && r.sheet.disc !== 'S'))) || r.el.k === 'fin' || (r.el.k === 'opening' && r.el.kind === 'window')));
    if (!ext.length) continue;
    const pS = (sPour[i] || []).filter(Boolean), pU = (sPour[i + 1] || []).filter(Boolean); const base = { lv: L.id, ph: '외장', out: true };
    const cmu = ext.filter(r => r.el.k === 'wall' && r.el.mat === 'CMU'), gl = ext.filter(r => r.el.k === 'wall' && isGlassWall(r.el)), rcw = ext.filter(r => r.el.k === 'wall' && isRC(r.el) && !isGlassWall(r.el)), wins = ext.filter(r => r.el.k === 'opening'), fins = ext.filter(r => r.el.k === 'fin');
    let last = null; const after = (t) => { for (const p of [...pS, ...pU]) dep(t, p, 3); if (scafUp[i]) dep(t, scafUp[i]); if (last) dep(t, last); last = t; return t; };
    if (cmu.length) after(add({ ...base, id: `ex.cmu.${L.id}`, name: `${L.name} 외벽 조적·외단열`, trade: '조적', code: 'CMU', ...plan('CMU', qOf(cmu, 'CMU'), 4, 6), els: elIds(cmu), st: 'done', check: ['단열재 틈 없음', '테두리보·인방'] }));
    if (rcw.length) after(add({ ...base, id: `ex.ins.${L.id}`, name: `${L.name} 외단열·외장 바탕`, trade: '금속', dur: 2, men: 4, els: elIds(rcw), st: 'clad', check: CK.fin }));
    if (wins.length) { after(add({ ...base, id: `ex.winf.${L.id}`, name: `${L.name} 창호 프레임 설치`, trade: '창호', code: 'WIN', ...plan('WIN', qOf(wins, 'WIN'), 4, 6), els: elIds(wins), st: 'frame', check: CK.win })); after(add({ ...base, id: `ex.wing.${L.id}`, name: `${L.name} 유리 끼우기·창호 실링`, trade: '창호', dur: Math.max(1, Math.ceil(wins.length / 20)), men: 3, els: elIds(wins), st: 'done', check: CK.win })); }
    if (gl.length) after(add({ ...base, id: `ex.cw.${L.id}`, name: `${L.name} 커튼월 유닛 설치·층간 방화 실란트`, trade: '커튼월', code: 'GLZ', ...plan('GLZ', qOf(gl, 'GLZ'), 4, 6), els: elIds(gl), st: 'done', equip: ['타워크레인'], check: ['앵커 위치·레벨', '층간 방화 채움', '살수 시험'] }));
    if (fins.length) after(add({ ...base, id: `ex.fin.${L.id}`, name: `${L.name} 외장 알루미늄 핀 설치`, trade: '금속', code: 'FIN', qty: qOf(fins, 'FIN'), dur: durQ('FIN', qOf(fins, 'FIN'), 2), men: 6, els: elIds(fins), st: 'done', check: ['브래킷 고정', '수직 정렬'] }));
    if (rcw.length) after(add({ ...base, id: `ex.paint.${L.id}`, name: `${L.name} 외벽 마감 (도장·석재)·실링`, trade: '도장', dur: 2, men: 4, els: elIds(rcw), st: 'done', check: CK.fin }));
    envEnd[i] = last;
  }
  // 옥상 방수 → 후레싱·두겁석
  const rf = lv[n - 1]; const roofSlab = all.filter(r => r.el.k === 'slab' && r.level.id === rf.id); const roofA = roofSlab.reduce((s, r) => s + Math.abs(polyArea(r.el.pts)) / 1e6, 0) || area[n - 1] || fpA;
  const parTasks = T.filter(t => t.id.startsWith('rf.strip.'));
  const rB = add({ id: 'rf.base', name: '옥상 바탕 정리·구배 몰탈·드레인 보강', ph: '옥상', trade: '방수', dur: Math.max(2, Math.ceil(roofA / 300)), men: 4, out: true, els: elIds(roofSlab), check: CK.wp }); dep(rB, structEnd, 7); for (const t of parTasks) dep(rB, t);
  const rW = add({ id: 'rf.wp', name: '옥상 방수 (도막/시트)', ph: '옥상', trade: '방수', dur: Math.max(2, Math.ceil(roofA / 250)), men: 5, out: true, els: elIds(roofSlab), st: 'wp', check: CK.wp }); dep(rW, rB);
  const rT = add({ id: 'rf.test', name: '담수 시험 (48시간)', ph: '옥상', trade: '방수', dur: 2, cal: true, men: 1, els: elIds(roofSlab), check: ['누수 확인(하부 층)'] }); dep(rT, rW);
  const rP = add({ id: 'rf.prot', name: '방수 보호층 (누름 콘크리트·보호 몰탈)', ph: '옥상', trade: '타설', dur: Math.max(1, Math.ceil(roofA / 400)), men: 6, out: true, els: elIds(roofSlab), st: 'done', check: ['신축 줄눈', '보호층 두께'] }); dep(rP, rT);
  const rC = add({ id: 'rf.coping', name: '파라펫 후레싱·두겁석(코핑) 설치·실링', ph: '옥상', trade: '금속', dur: 2, men: 4, out: true, els: parTasks.flatMap(t => t.els), st: 'coping', check: CK.coping }); dep(rC, rP);
  const rD = add({ id: 'rf.mep', name: '옥상 설비 기초·장비 반입·루프드레인 연결', ph: '옥상', trade: '설비', dur: 3, men: 5, out: true, els: elIds(all.filter(r => r.level.id === rf.id && r.el.k !== 'slab' && r.el.k !== 'wall')), st: 'done', check: CK.mep }); dep(rD, rP);

  // 5. 실내 (층별): 동바리 해체(위 2층 타설) 후
  const intEnd = []; const mepTr = { duct: ['DCT', '설비', '덕트 설치'], pipe: ['PIP', '설비', '배관 설치'], tray: ['TRY', '전기', '케이블트레이 설치'], riser: [null, '설비', '수직 샤프트 배관·덕트'], sprinkler: ['SPK', '소방', '스프링클러 배관·헤드'] };
  for (let i = 0; i < n; i++) {
    const L = lv[i]; const E = all.filter(r => r.level.id === L.id); if (!E.length || (i === n - 1 && !E.some(r => r.el.k === 'room'))) continue;
    const base = { lv: L.id, ph: '내부' }; const shoreT = T.filter(t => t.id.startsWith(`st.shore.${L.id}.`)); const pS = (sPour[i] || []).filter(Boolean);
    const start = add({ ...base, id: `in.start.${L.id}`, name: `${L.name} 실내 작업 착수 (동바리 해체·청소·먹매김)`, trade: '공무', dur: 1, men: 3, check: ['동바리 해체 완료', '층 청소·자재 양중 계획'] }); for (const t of shoreT) dep(start, t); if (!shoreT.length) for (const t of pS) dep(start, t, 5); if (scafUp[i]) dep(start, scafUp[i]);
    const A = area[i] || maxA; const cr = crewsFor(A); let last = start; const seq = (o) => { const t = add({ ...base, ...o }); dep(t, last); last = t; return t; };
    const inWalls = E.filter(r => r.el.k === 'wall' && !isRC(r.el) && !isGlassWall(r.el) && !(r.el.mat === 'CMU' && nearEdge(r)));
    const dry = inWalls.filter(r => r.el.mat === 'DRY'), cmuI = inWalls.filter(r => r.el.mat !== 'DRY');
    if (cmuI.length) seq({ id: `in.cmu.${L.id}`, name: `${L.name} 내부 조적벽 (전선관·박스 동시 매립)`, trade: '조적', code: 'CMU', ...plan('CMU', qOf(cmuI, 'CMU'), 4, 6), els: elIds(cmuI), st: 'done', check: [...CK.embed.slice(0, 1), '조적 줄눈·보강 철물'] });
    if (dry.length) seq({ id: `in.dry1.${L.id}`, name: `${L.name} 경량벽 스터드·한쪽 면 보드`, trade: '수장', code: 'DRY', ...plan('DRY', qOf(dry, 'DRY') * 0.5, 4, 6), els: elIds(dry), st: 'frame', check: ['스터드 간격·런너 고정', '문틀 보강'] });
    // MEP 본설치 (천장 속)
    const mepEls = {}; for (const r of E) if (mepTr[r.el.k]) (mepEls[r.el.k] ||= []).push(r);
    const mepStart = last; const mepTasks = [];
    for (const k of ['duct', 'pipe', 'tray', 'riser', 'sprinkler']) { const rs = mepEls[k]; if (!rs?.length) continue; const [code, trade, nm] = mepTr[k]; const qq = code ? qOf(rs, code) : rs.length; const pl = code ? plan(code, qq, 6, 6) : { dur: Math.max(1, Math.ceil(rs.length / 12)), men: 4, q2: { DCT: qOf(rs, 'DCT'), PIP: qOf(rs, 'PIP'), TRY: qOf(rs, 'TRY') } }; const t = add({ ...base, id: `in.mep.${k}.${L.id}`, name: `${L.name} ${nm}`, trade, code, ...pl, els: elIds(rs), st: 'done', check: CK.mep }); dep(t, mepStart); mepTasks.push(t); }
    if (!mepTasks.length) mepTasks.push(add({ ...base, id: `in.mep.basic.${L.id}`, name: `${L.name} 설비·전기 배관·입선 (천장 속·벽체 내)`, trade: '설비', dur: Math.max(2, Math.ceil(A / 150)), men: 4, check: CK.mep }) && byId.get(`in.mep.basic.${L.id}`));
    if (mepTasks.length && !mepTasks[0].preds.length) dep(mepTasks[0], mepStart);
    const wire = add({ ...base, id: `in.wire.${L.id}`, name: `${L.name} 벽체 내 배관·배선 입선, 분전반 설치`, trade: '전기', code: E.some(r => r.el.k === 'panel') ? 'PNL' : null, qty: qOf(E.filter(r => r.el.k === 'panel'), 'PNL'), dur: Math.max(1, Math.ceil(A / 250)), men: 4, els: elIds(E.filter(r => r.el.k === 'panel')), st: 'done', check: ['입선·결선 표시', '절연저항'] }); dep(wire, last);
    const test = add({ ...base, id: `in.test.${L.id}`, name: `${L.name} 천장 속 설비 검측 (수압·누설·절연·풍량)`, trade: '공무', dur: 1, men: 3, check: CK.ceil }); for (const t of [...mepTasks, wire]) dep(test, t); last = test;
    if (dry.length) seq({ id: `in.dry2.${L.id}`, name: `${L.name} 경량벽 반대 면 보드·흡음재`, trade: '수장', code: 'DRY', ...plan('DRY', qOf(dry, 'DRY') * 0.5, 4, 6), els: elIds(dry), st: 'done', check: ['벽체 내 배관·배선 검측 완료', '방화벽 충전'] });
    const ceils = E.filter(r => r.el.k === 'ceiling');
    seq({ id: `in.cframe.${L.id}`, name: `${L.name} 천장 틀(M-bar·행거) 설치`, trade: '수장', dur: Math.max(1, Math.ceil(A / 200)), men: 4, els: elIds(ceils), st: 'frame', check: ['행거 간격', '점검구·조명 개구 위치'] });
    seq({ id: `in.cboard.${L.id}`, name: `${L.name} 천장 보드·마감`, trade: '수장', code: 'CLG', ...plan('CLG', qOf(ceils, 'CLG') || A, 4, 6), qty: qOf(ceils, 'CLG'), els: elIds(ceils), st: 'done', check: CK.ceil });
    const rooms = E.filter(r => r.el.k === 'room');
    seq({ id: `in.paint.${L.id}`, name: `${L.name} 벽 마감 (퍼티·도장·타일)`, trade: '도장', code: 'WLF', ...plan('WLF', qOf(rooms, 'WLF') || A * 2.5, 4, 6), qty: qOf(rooms, 'WLF'), els: elIds(rooms), check: CK.fin });
    seq({ id: `in.floor.${L.id}`, name: `${L.name} 바닥 마감 (미장·타일·바닥재)`, trade: '바닥', code: 'FLR', ...plan('FLR', qOf(rooms, 'FLR') || A, 4, 6), qty: qOf(rooms, 'FLR'), els: elIds(rooms), check: CK.fin });
    if (rooms.length) seq({ id: `in.base.${L.id}`, name: `${L.name} 걸레받이`, trade: '수장', code: 'BSE', ...plan('BSE', qOf(rooms, 'BSE'), 3, 4), els: elIds(rooms), check: ['몰딩 이음·코너 처리'] });
    const fix = E.filter(r => r.el.k === 'light' || (r.el.k === 'sprinkler'));
    seq({ id: `in.fix.${L.id}`, name: `${L.name} 조명기구·헤드 정위치·스위치/콘센트 결선`, trade: '전기', code: E.some(r => r.el.k === 'light') ? 'LGT' : null, qty: qOf(E.filter(r => r.el.k === 'light'), 'LGT'), dur: Math.max(1, Math.ceil((fix.length || A / 10) / 40)), men: 4, els: elIds(E.filter(r => r.el.k === 'light')), st: 'done', check: ['조도·회로 확인', '헤드 정위치·캡 제거'] });
    const doors = E.filter(r => r.el.k === 'opening' && r.el.kind !== 'window');
    if (doors.length) seq({ id: `in.door.${L.id}`, name: `${L.name} 문짝·철물 설치`, trade: '창호', code: 'DOR', ...plan('DOR', doors.length, 3, 4), els: elIds(doors), st: 'done', check: ['도어클로저·잠금', '방화문 인증'] });
    const furn = E.filter(r => r.el.k === 'furn' && !r.el.landscape && !['tree', 'shrub', 'paving', 'deck', 'fence', 'car', 'plant', 'outdoor'].includes(r.el.type));
    if (furn.length) seq({ id: `in.furn.${L.id}`, name: `${L.name} 가구·위생기구·장비 설치`, trade: '수장', dur: Math.max(1, Math.ceil(furn.length / 25)), men: 4, els: elIds(furn), st: 'done', check: ['위생기구 누수', '장비 시운전'] });
    seq({ id: `in.clean.${L.id}`, name: `${L.name} 준공 청소·자체 점검(펀치리스트)`, trade: '공무', dur: 1, men: 4, check: ['하자 펀치리스트 정리'] });
    intEnd[i] = last;
  }
  // 비계 해체 (위에서 아래로): 외장 완료 후
  for (let i = n - 1; i >= 0; i--) { if (!scafUp[i]) continue; const hi = n > 15; const t = add({ lv: lv[i].id, id: `sc.dn.${lv[i].id}`, name: hi ? `${lv[i].name} 보호망 인상 완료(상부 이동)` : `${lv[i].name} 외부 비계 해체`, ph: '가설', trade: '가설', dur: hi ? 0 : 1, ms: hi, men: 4, out: true, temp: 'scaf', check: ['하부 통제·낙하물 방지'] }); if (hi) { const up3 = scafUp[i + 3]; if (up3) { dep(t, up3); scafDn[i] = t; continue; } } if (envEnd[i]) dep(t, envEnd[i]); dep(t, scafUp[i], 3); const above = scafDn[i + 1]; if (above) dep(t, above); if (i === n - 1) dep(t, rC); scafDn[i] = t; }
  // 6. 외부·조경·준공
  const outEls = all.filter(r => r.el.k === 'furn' && (r.el.landscape || ['tree', 'shrub', 'paving', 'deck', 'fence', 'outdoor', 'car', 'plant'].includes(r.el.type)));
  const ext1 = add({ id: 'ex.civil', name: '부대토목 (우·오수관·맨홀·포장 기층)', ph: '외부', trade: '포장', dur: Math.max(4, Math.ceil(fpA / 150)), men: 6, out: true, check: ['관 구배·관저고', '맨홀 레벨', '수밀 시험'] }); for (const t of scafDn.filter(Boolean)) dep(ext1, t);
  const pav = outEls.filter(r => ['paving', 'deck', 'fence', 'outdoor', 'car'].includes(r.el.type)); const ext2 = add({ id: 'ex.pave', name: '외부 포장·데크·울타리', ph: '외부', trade: '포장', dur: Math.max(2, pav.length), men: 5, out: true, els: elIds(pav), st: 'done', check: ['포장 구배·배수'] }); dep(ext2, ext1);
  const plants = outEls.filter(r => ['tree', 'shrub', 'plant'].includes(r.el.type)); const nT = plants.filter(r => r.el.type === 'tree').reduce((s, r) => s + (r.el.cnt || 1), 0), nS = plants.filter(r => r.el.type === 'shrub').reduce((s, r) => s + (r.el.cnt || 1), 0);
  const ext3 = add({ id: 'ex.plant', name: `조경 식재 (교목 ${nT}주·관목 ${nS}주)·잔디`, ph: '외부', trade: '조경', code: 'LTR', qty: qOf(plants, 'LTR'), q2: { LSH: qOf(plants, 'LSH') }, dur: Math.max(2, durQ('LTR', nT, 1) + durQ('LSH', nS, 1)), men: 6, out: true, els: elIds(plants), st: 'done', check: ['식재 시기(동절기 회피)', '지주목·관수'] }); dep(ext3, ext2);
  const fin = add({ id: 'ms.done', name: '준공 검사·사용승인', ph: '준공', trade: '공무', dur: 5, men: 4, check: ['소방 완공검사', '승강기 검사', '사용승인 신청', '준공도서'] }); for (const t of [...intEnd.filter(Boolean), ext3, rC, rD]) dep(fin, t);
  if (tall) { tHo = add({ id: 'eq.hoist', name: '호이스트(리프트카) 설치', ph: '가설', trade: '가설', dur: 2, men: 4, out: true, temp: 'hoist', check: ['안전인증', '층별 출입문 인터록'] }); const p3 = (sPour[Math.min(3, n - 1)] || []).find(Boolean); if (p3) dep(tHo, p3); const tHd = add({ id: 'eq.hoist.dn', name: '호이스트 해체·벽체 마감', ph: '가설', trade: '가설', dur: 2, men: 4, out: true, temp: 'hoist' }); for (const t of intEnd.filter(Boolean)) dep(tHd, t, -3); dep(fin, tHd); }

  // 7. 도급내역 커버리지: 내역 코드 → 작업, 매칭 안 되는 항목은 이름 키워드로 배정, 그래도 없으면 '기타 내역' 작업으로 공정에 포함
  const KW = [[/방수/, 'rf.wp'], [/실링|코킹/, 'ex.wing'], [/도장|페인트/, 'in.paint'], [/타일|바닥|에폭시|장판/, 'in.floor'], [/천장|텍스|보드/, 'in.cboard'], [/창호|창|AL|PVC/, 'ex.winf'], [/문|도어/, 'in.door'], [/석재|외장|판넬|패널/, 'ex.paint'], [/흙막이|CIP|파일/, 'ew.shore'], [/터파기|토공|잔토/, 'ew.exc'], [/비계/, 'sc.up'], [/조경|식재|수목/, 'ex.plant'], [/포장|아스팔트/, 'ex.pave'], [/전기|조명|콘센트|배선/, 'in.wire'], [/소방|스프링클러|소화/, 'in.mep.sprinkler'], [/위생|급수|배수|배관/, 'in.mep.pipe'], [/덕트|공조/, 'in.mep.duct'], [/승강기|엘리베이터/, 'in.furn'], [/철골/, 'st.erect'], [/데크/, 'st.deck'], [/접지|피뢰/, 'rf.ground'], [/코핑|두겁|후레싱/, 'rf.coping'], [/가설|안전/, 'pre.mob']];
  const qCodes0 = (c) => { for (const m of q.values()) if (m[c] > 0) return true; return c === 'TMP'; };
  const cover = []; const codes = new Set(T.filter(t => t.code && (t.code !== 'RBR' || true)).map(t => t.code).filter(c => qCodes0(c)));
  const qCodes = new Set(); for (const m of q.values()) for (const k in m) if (m[k] > 0) qCodes.add(k); const STD = new Set([...Object.keys(PROD), 'CON', 'TMP']);
  for (const b of P.boq || []) {
    if (STD.has(b.code) && !qCodes.has(b.code) && !codes.has(b.code)) { cover.push({ code: b.code, name: b.name, tasks: [], none: true }); continue; }
    let hit = codes.has(b.code) ? T.filter(t => t.code === b.code) : [];
    if (!hit.length) for (const [re, pre] of KW) if (re.test(b.name)) { hit = T.filter(t => t.id.startsWith(pre)); if (hit.length) { for (const t of hit) (t.boq ||= []).push(b.code); break; } }
    if (!hit.length) { const t = add({ id: `boq.${b.code}`, name: `내역 항목: ${b.name}`, ph: '내부', trade: '공무', code: b.code, dur: 3, men: 3, check: ['공정 위치 지정 필요 (기본: 실내 마감 후)'], unassigned: true }); const li = intEnd.filter(Boolean); dep(t, li[li.length - 1] || structEnd); dep(fin, t); hit = [t]; }
    cover.push({ code: b.code, name: b.name, tasks: hit.map(t => t.id), auto: !!hit[0]?.unassigned });
  }
  // 기성 금액: 작업 물량 × 도급내역 단가 (공정률 가중치)
  const price = Object.fromEntries((P.boq || []).map(b => [b.code, +b.price || 0]));
  for (const t of T) { let a = (t.qty || 0) * (price[t.code] || 0); for (const [c, v] of Object.entries(t.q2 || {})) a += v * (price[c] || 0); t.amt = a; }
  // 부재 → 작업 순서
  const elTasks = new Map(); for (const t of T) for (const id of t.els) (elTasks.get(id) || elTasks.set(id, []).get(id)).push(t.id);
  const succ = new Map(); for (const t of T) for (const p of t.preds) (succ.get(p.id) || succ.set(p.id, []).get(p.id)).push(t.id);
  const empty = lv.filter(L => !all.some(r => r.level.id === L.id)).map(L => L.name);
  return { T, byId, elTasks, succ, Z, lv, cover, all, empty };
}

// ---------- 일정 계산 ----------
// 실적(actual)·지연(events)·데이터 기준일(dataDate) 반영. 역순 시공이면 보완 작업을 끼워 넣는다.
export function schedule(P, G, opt = {}) {
  const C = P.csim; const s0 = toD(C.start); const cal = makeCalendar({ ...C, events: opt.noEvents ? [] : C.events, week: opt.week || C.week });
  const act = opt.noActual ? {} : (C.actual || {}); const dd = !opt.noActual && C.dataDate ? toD(C.dataDate) : null;
  const T = G.T.slice(); const byId = new Map(G.byId); const extra = []; const issues = [];
  // 역순 시공 감지: 후행이 시작됐는데 선행이 끝나지 않음
  if (!opt.noActual) for (const t of G.T) { const a = act[t.id]; if (!a?.s) continue; for (const p of t.preds) { const pa = act[p.id]; const pt = byId.get(p.id); if (!pt || pt.ms || pt.cal) continue; if (!pa?.f) {
    const rid = `rw.${p.id}>${t.id}`; const rw = { id: rid, name: `보완: ${pt.name} 완료 후 ${t.name} 부분 해체·복구·재검측`, ph: t.ph, trade: t.trade, lv: t.lv, zone: t.zone, dur: Math.max(1, Math.ceil((t.dur || 1) * 0.3)), men: t.men || 3, out: t.out, preds: [{ id: p.id, lag: 0, cal: 0 }], els: t.els, check: ['역순 시공 구간 확인', `선행 "${pt.name}" 완료 확인`, '해체 범위 최소화', '재검측 후 복구'], rework: true };
    if (!byId.has(rid)) { T.push(rw); byId.set(rid, rw); extra.push(rw); }
    issues.push({ t: t.id, p: p.id, msg: `역순 시공 — "${t.name}"이(가) 선행 "${pt.name}"보다 먼저 시작됨 → 보완 작업 추가, 후행 공정 재검토` }); } } }
  // 보완 작업은 해당 작업의 후행 작업들의 선행으로 들어간다
  const preds = new Map(T.map(t => [t.id, t.preds.slice()])); for (const rw of extra) { const tid = rw.id.split('>')[1]; for (const s of G.succ.get(tid) || []) preds.get(s)?.push({ id: rw.id, lag: 0, cal: 0 }); }
  // 위상 정렬
  const indeg = new Map(T.map(t => [t.id, 0])); const out = new Map(); for (const t of T) for (const p of preds.get(t.id)) { if (!byId.has(p.id)) continue; indeg.set(t.id, indeg.get(t.id) + 1); (out.get(p.id) || out.set(p.id, []).get(p.id)).push(t.id); }
  const Q = T.filter(t => !indeg.get(t.id)).map(t => t.id); const order = []; while (Q.length) { const id = Q.shift(); order.push(id); for (const s of out.get(id) || []) { indeg.set(s, indeg.get(s) - 1); if (!indeg.get(s)) Q.push(s); } }
  const R = new Map(); const nextWork = (d, t) => { let k = 0; while (!cal.can(d, t) && k++ < 400) d++; return d; };
  const addWork = (d, n, t) => { let k = 0; while (n > 0 && k++ < 2000) { d++; if (cal.can(d, t)) n--; } return d; };
  const finishFrom = (es, dur, t) => { if (!dur) return es - 1; if (t.cal) return es + dur - 1; let d = es, left = dur; let k = 0; while (k++ < 5000) { if (cal.can(d, t)) { left--; if (!left) return d; } d++; } return d; };
  const lost = []; // 우천·지연으로 쉰 날 (작업별)
  for (const id of order) {
    const t = byId.get(id); const a = act[id];
    let es = s0; let drv = null; for (const p of preds.get(id)) { const r = R.get(p.id); if (!r) continue; let d = r.ef + 1; if (p.lag > 0) d = addWork(r.ef, p.lag, t) ; else if (p.lag < 0) d = r.ef + 1 + p.lag; if (p.cal) d = Math.max(d, r.ef + 1 + p.cal); if (d > es) { es = d; drv = p.id; } }
    let ef, st = 'plan';
    if (a?.s && a?.f) { es = toD(a.s); ef = toD(a.f); st = 'done'; }
    else if (a?.s) { es = toD(a.s); const rem = Math.max(1, Math.ceil((t.dur || 1) * (1 - (a.pct || 0) / 100))); const from = Math.max(dd ?? es, es); ef = finishFrom(t.cal ? from : nextWork(from, t), rem, t); st = 'prog'; }
    else { if (dd != null) es = Math.max(es, dd); es = t.cal || !t.dur ? es : nextWork(es, t); ef = finishFrom(es, t.dur, t); }
    R.set(id, { es, ef, st, drv });
  }
  // 주공정(구동 경로): 준공에서 역추적
  const crit = new Set(); let c = 'ms.done'; let guard = 0; while (c && guard++ < 5000) { crit.add(c); c = R.get(c)?.drv; }
  const fin = R.get('ms.done')?.ef ?? Math.max(...[...R.values()].map(r => r.ef));
  return { R, T, byId, preds, crit, fin, s0, cal, issues, extra, order };
}

// 날짜 d의 작업·부재 상태
const ST_ORDER = ['none', 'steel', 'rebar', 'embed', 'frame', 'form', 'poured', 'curing', 'stripped', 'clad', 'wp', 'coping', 'done'];
export function stateAt(S, G, d) {
  const tasks = []; const el = new Map(); const temp = { scaf: new Set(), shore: new Set(), form: new Set(), tc: false, hoist: false, pump: [], fence: false, exc: false, retain: false };
  for (const t of S.T) { const r = S.R.get(t.id); if (!r) continue; const started = d >= r.es, finished = d > r.ef; const active = started && !finished;
    if (active) tasks.push(t);
    if (t.st && started) for (const id of t.els) { const cur = el.get(id); const s = active ? (t.st === 'poured' ? 'pouring' : 'w:' + t.st) : t.st; const rank = (x) => ST_ORDER.indexOf(x.replace(/^w:/, '').replace('pouring', 'poured')); if (!cur || rank(s) >= rank(cur)) el.set(id, s); }
    if (t.temp === 'scaf' && t.lv) { if (t.id.startsWith('sc.up') && started) temp.scaf.add(t.lv); if (t.id.startsWith('sc.dn') && finished) temp.scaf.delete(t.lv); }
    if (t.temp === 'tc') { if (t.id === 'eq.tc.up' && finished) temp.tc = true; if (t.id === 'eq.tc.down' && finished) temp.tc = false; }
    if (t.temp === 'hoist') { if (t.id === 'eq.hoist' && finished) temp.hoist = true; if (t.id === 'eq.hoist.dn' && finished) temp.hoist = false; }
    if (t.id === 'pre.mob' && started) temp.fence = true; if (t.id === 'ex.pave' && finished) temp.fence = false;
    if (t.temp === 'exc' && started) temp.exc = true; if (t.id === 'fd.strip' && finished) temp.exc = false;
    if (t.temp === 'retain' && started) temp.retain = true; if (t.id === 'fd.strip' && finished) temp.retain = false;
    if (t.pour && active) temp.pump.push(t);
  }
  // 동바리·거푸집: 수평 거푸집 시작 ~ 동바리 해체
  for (const t of S.T) { if (!t.id.startsWith('st.hform.')) continue; const r = S.R.get(t.id); const sh = S.R.get(t.id.replace('st.hform.', 'st.shore.')); if (r && d >= r.es && (!sh || d <= sh.ef)) for (const id of t.els) temp.shore.add(id); }
  for (const t of S.T) { if (!(t.id.startsWith('st.vform.') || t.id.startsWith('rf.form.') || t.id.startsWith('fd.form'))) continue; const r = S.R.get(t.id); const strip = S.R.get(t.id.replace('st.vform.', 'st.strip.').replace('rf.form.', 'rf.strip.').replace('fd.form', 'fd.strip')); if (r && d >= r.es && (!strip || d <= strip.ef)) for (const id of t.els) temp.form.add(id); }
  const men = {}; let total = 0; for (const t of tasks) { if (!t.men || t.cal || !S.cal.can(d, t)) continue; men[t.trade] = (men[t.trade] || 0) + t.men; total += t.men; }
  const equip = new Set(); for (const t of tasks) if (S.cal.can(d, t)) for (const e of t.equip || []) equip.add(e); if (temp.tc) equip.add('타워크레인'); if (temp.hoist) equip.add('호이스트');
  return { tasks, el, temp, men, total, equip: [...equip], info: S.cal.info(d) };
}
// 공정률(금액 가중 근사: 작업 인·일)
export function progressAt(S, d) { const a = amountAt(S, d); if (a.tot > 0) return a.done / a.tot * 100; return progressByLabor(S, d); }
// 기성 금액 누계 (작업 기간에 따라 선형 배분)
export function amountAt(S, d) { let tot = 0, done = 0; for (const t of S.T) { const v = t.amt || 0; if (!v) continue; const r = S.R.get(t.id); if (!r) continue; tot += v; if (d > r.ef) done += v; else if (d >= r.es) done += v * Math.min(1, (d - r.es + 1) / Math.max(1, r.ef - r.es + 1)); } return { tot, done }; }
function progressByLabor(S, d) { let tot = 0, done = 0; for (const t of S.T) { const r = S.R.get(t.id); if (!r || t.cal || !t.dur) continue; const w = (t.men || 3) * t.dur; tot += w; if (d > r.ef) done += w; else if (d >= r.es) done += w * Math.min(1, (d - r.es + 1) / Math.max(1, r.ef - r.es + 1)); } return tot ? done / tot * 100 : 0; }

// 공기 만회 대안
export function recoveryOptions(P, G, base) {
  const out = []; const C = P.csim;
  if ((C.week || 6) < 6) { const S = schedule(P, G, { week: 6 }); out.push({ k: '주 6일 작업', fin: S.fin, gain: base.fin - S.fin }); }
  // 주공정 작업 인원 1.5배 (기간 2/3)
  const G2 = { ...G, T: G.T.map(t => base.crit.has(t.id) && !t.cal && t.dur > 1 ? { ...t, dur: Math.ceil(t.dur * 0.67), men: Math.ceil((t.men || 3) * 1.5) } : t) }; G2.byId = new Map(G2.T.map(t => [t.id, t]));
  const S2 = schedule(P, G2); out.push({ k: '주공정 작업 인원 1.5배 투입', fin: S2.fin, gain: base.fin - S2.fin });
  const Z = G.Z; if (Z < 4) { const P3 = { ...P, csim: { ...C, zones: Z + 1 } }; const G3 = buildTasks(P3); const S3 = schedule(P3, G3); out.push({ k: `타설 구획 ${Z}→${Z + 1}존 (사이클 단축)`, fin: S3.fin, gain: base.fin - S3.fin }); }
  return out;
}
export { ST_ORDER, elBoxes, KINDS };
