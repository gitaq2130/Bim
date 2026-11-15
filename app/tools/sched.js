// 빌더 공정 — 공정표(간트) + 객체 연결 + 4D + 계획 기성률 연동
import { h, toast, dialog, confirmBox, saveFile, table, pickFile } from '../js/ui.js';
import { xlsx } from '../js/excel.js';
import { allElements, KINDS, DISC, levelOf, takeoff, isRefElement } from '../js/model.js';
import { uid, fmt, fmt0, csv, esc, polyArea, pointInPoly, segInt, closestOnSeg, dist, clamp } from '../js/util.js';
import { siteInfo } from '../js/sitegeo.js';

const DAY = 86400000;
export const toD = (s) => new Date(s + 'T00:00:00Z').getTime();
export const toS = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (s, n) => toS(toD(s) + n * DAY);
export const daysBetween = (a, b) => Math.round((toD(b) - toD(a)) / DAY);

// 활동에 속한 객체인지
export function matchAct(a, r) {
  if (a.ids?.length) return a.ids.includes(r.el.id);
  const f = a.filter || {}; if (!f.level && !f.kind && !f.disc && !f.zone) return false;
  return (!f.level || r.level.id === f.level) && (!f.kind || r.el.k === f.kind) && (!f.disc || r.sheet.disc === f.disc) && (!f.zone || r.el.zone === f.zone);
}
// 날짜 기준 객체 상태: {id: {s:'done'|'active'|'future', pct}}
export function statusAt(P, date) {
  const t = toD(date), out = {}; const acts = P.sched?.acts || [];
  for (const r of allElements(P)) {
    for (const a of acts) {
      if (!matchAct(a, r)) continue; const s = toD(a.start), e = toD(a.end) + DAY;
      const pct = t >= e ? 100 : t <= s ? 0 : Math.round((t - s) / (e - s) * 100);
      const cur = out[r.el.id]; if (!cur || pct < cur.pct) out[r.el.id] = { s: pct >= 100 ? 'done' : pct > 0 ? 'active' : 'future', pct, act: a.name };
    }
  }
  return out;
}
// 순방향 일정 계산 (선행 FS + 지연일)
export function schedule(acts) {
  const byId = Object.fromEntries(acts.map(a => [a.id, a])); const done = new Set();
  const visit = (a, stack = new Set()) => {
    if (done.has(a.id) || stack.has(a.id)) return; stack.add(a.id);
    let st = null;
    for (const pid of a.pred || []) { const p = byId[pid]; if (!p) continue; visit(p, stack); const s2 = addDays(p.end, 1 + (a.lag || 0)); if (!st || toD(s2) > toD(st)) st = s2; }
    if (st) a.start = st;
    a.end = addDays(a.start, Math.max(1, a.dur) - 1); done.add(a.id);
  };
  acts.forEach(a => visit(a)); return acts;
}
const DUR = { footing: 10, column: 5, beam: 6, slab: 7, wall: 8, opening: 5, duct: 10, pipe: 10, tray: 8 };
const ORDER = [['S', 'footing'], ['S', 'column'], ['S', 'wall'], ['S', 'beam'], ['S', 'slab'], ['A', 'column'], ['A', 'wall'], ['A', 'opening'], ['M', 'duct'], ['P', 'pipe'], ['E', 'tray']];

// ---------- 공법·흙막이·기초 계획 (현장 수치 → 툴 자동 산정) ----------
export const METHODS = {
  bu: { name: '순타 (Bottom-up)', short: '순타', desc: '흙막이 → 전체 터파기 → 기초 → 지하층부터 위로 올라가는 일반 공법입니다.' },
  td: { name: '탑다운 (역타)', short: '탑다운', desc: '지하연속벽·기둥을 먼저 세우고 1층 바닥을 친 뒤, 아래로 굴착하며 지하 바닥을 칩니다. 1층 바닥 완료 후 지상층을 동시에 올립니다.' },
  std: { name: '세미 탑다운', short: '세미탑다운', desc: '지하는 역타로 내려가되, 지상층은 기초(매트) 완료 후 착수합니다. 1층 바닥을 작업장으로 씁니다.' },
  uu: { name: '업업 (Up-Up)', short: '업업', desc: '기둥을 먼저 세우고 전체 굴착·기초 후, 지하층(순타)과 지상층을 동시에 위로 올립니다.' },
};
export const PH_COL = { 가설: '#8a94a6', 토공: '#c8a46b', 말뚝: '#b48ead', 기초: '#7aa2f7', 지하: '#5f87d6', 지상: '#9ece6a', 마감: '#e0af68' };
// 생산성 기준값(일반 실적 기준 — 현장 여건에 따라 공정표에서 기간을 고쳐 쓰세요)
const RATE = { hpile: 20, cip: 8, sw: 3, excBU: 500, excTD: 250, phc: 12, cast: 0.5 }; // m/일·조, m³/일, 본/일·대
const lvSorted = (P) => [...(P.levels || [])].sort((a, b) => a.elev - b.elev);
export function planBasis(P, cond = {}) {
  const lv = lvSorted(P); const base = lv.filter(l => l.elev < 0).sort((a, b) => b.elev - a.elev); const above = lv.filter(l => l.elev >= 0);
  const nB = base.length, nA = above.filter(l => l.height > 0 || l !== above[above.length - 1]).length;
  const all = allElements(P, r => !isRefElement(r.el, r.sheet, P)); const low = lv[0];
  const foots = all.filter(r => r.el.k === 'footing'); const mats = all.filter(r => r.el.k === 'slab' && r.level?.id === low?.id); const tF = Math.max(0, ...foots.map(r => r.el.t || 0), ...mats.map(r => r.el.t || 0), nB ? 1000 : 0) / 1000;
  const lowElev = (low?.elev || 0) / 1000; const depth = +(Math.max(0, -lowElev) + tF + 0.3).toFixed(1); // 굴착 깊이(m): 최하층 + 기초 두께 + 버림·잡석
  // 대지·외곽
  let fp = [], siteP = null, assumed = true; try { const si = siteInfoSafe(P); fp = si.fp; siteP = si.site; assumed = si.assumed; } catch (e) { console.error(e); }
  const fpb = fp.length ? bboxAll(fp) : null; const sb = siteP ? bboxAll([siteP]) : null;
  const gaps = fpb && sb ? { N: sb.y1 - fpb.y1, S: fpb.y0 - sb.y0, E: sb.x1 - fpb.x1, W: fpb.x0 - sb.x0 } : null;
  const minGap = gaps ? Math.min(...Object.values(gaps)) / 1000 : null; // m
  const fpArea = fp.reduce((s, q) => s + Math.abs(polyArea(q)), 0) / 1e6, perim = fpb ? 2 * ((fpb.x1 - fpb.x0) + (fpb.y1 - fpb.y0)) / 1000 + 8 : 0;
  // 공법 추천
  const why = []; let rec = 'bu';
  const tight = minGap != null && minGap < Math.max(2, depth * 0.5);
  if (!nB) why.push('지하층이 없어 순타가 기본입니다.');
  else {
    if (nB >= 3) why.push(`지하 ${nB}개 층 — 굴착이 깊어(약 ${depth} m) 슬래브를 버팀으로 쓰는 역타가 흙막이 변형에 유리합니다.`);
    if (cond.adj) why.push('인접 건물이 가까워 굴착 중 변위를 줄여야 합니다.');
    if (tight) why.push(`대지 여유가 ${minGap.toFixed(1)} m로 좁아 1층 바닥을 작업장으로 써야 합니다.`);
    if (nB >= 3 || (cond.adj && nB >= 2) || tight) rec = cond.fast || nA >= 10 ? 'td' : 'std';
    else if (cond.fast && nA >= 5) { rec = 'uu'; why.push('공기 우선 — 지하와 지상을 동시에 올려 공기를 줄입니다(기둥 선시공 필요).'); }
    else why.push('지하가 얕고 대지 여유가 있어 순타가 경제적입니다.');
    if (rec === 'td') why.push(cond.fast ? '공기 우선이라 지상 동시 시공(탑다운)을 권합니다.' : `지상 ${nA}개 층으로 높아 지상 동시 시공(탑다운)을 권합니다.`);
    if (rec === 'std') why.push('지상층은 기초 완료 후 착수해 선시공 기둥 축력 부담을 줄입니다(세미 탑다운).');
  }
  let method = cond.method && METHODS[cond.method] ? cond.method : rec; const notes = [];
  if (method !== 'bu' && !nB) { notes.push(`${METHODS[method].short} 공법은 지하층이 있어야 의미가 있어 순타로 생성합니다.`); method = 'bu'; }
  // 흙막이
  let shore = { type: '없음', why: '굴착 깊이가 얕아 비탈면(1:1) 오픈컷으로 처리합니다.', dur: 0, support: '' };
  if (method === 'td' || method === 'std') shore = { type: '지하연속벽 (Slurry Wall)', why: '역타 공법은 영구 지하외벽을 겸하는 지하연속벽과 슬래브 버팀(SPS 개념)을 씁니다.', rate: RATE.sw, support: '지하 슬래브(역타)' };
  else if (depth > 10 || (cond.adj && nB)) shore = { type: 'CIP (현장타설 주열벽)', why: depth > 10 ? `굴착 ${depth} m — 10 m 초과로 강성이 큰 주열벽을 씁니다.` : '인접 건물 근접 — 차수·강성이 필요합니다.', rate: RATE.cip, support: cond.adj ? '스트럿(인접 대지 앵커 불가)' : '어스앵커' };
  else if (depth > 1.5 && (nB || tight)) shore = { type: 'H-Pile + 토류판', why: `굴착 ${depth} m — 일반 흙막이로 충분합니다.`, rate: RATE.hpile, support: tight || cond.adj ? '스트럿' : '어스앵커' };
  if (shore.rate) shore.dur = Math.max(5, Math.ceil(perim / shore.rate / (perim > 150 ? 2 : 1))); shore.len = Math.round(perim);
  // 기초
  const bear = cond.bear === '' || cond.bear == null ? null : +cond.bear; // 지지층 깊이 GL-m
  const plunge = method === 'td' || method === 'std' || method === 'uu';
  const found = { type: '직접기초', why: '', piles: [], total: 0, D: 0, L: 0, rigs: 0, dur: 0 };
  if (bear == null) { found.why = '지지층 깊이가 입력되지 않아 직접기초로 가정했습니다. 지반조사 결과(지지층 깊이)를 넣으면 말뚝을 자동 산정합니다.'; found.warn = true; }
  else if (bear <= depth + 1 && !plunge) found.why = `지지층 GL-${bear} m가 기초 바닥(GL-${depth} m) 부근이라 직접기초로 지지합니다.`;
  if (plunge) {
    const cols = all.filter(r => r.el.k === 'column' && r.level && (nB ? r.level.elev < 0 : r.level.id === low.id)); const pos = uniqPts(cols.map(r => r.el.p));
    Object.assign(found, { type: '현장타설말뚝 + 선시공 철골기둥 (PRD/RCD)', D: 1500, why: `${METHODS[method].short} 공법은 기둥을 먼저 세워 상부 하중을 받으므로 기둥마다 대구경 현장타설말뚝(φ1500)을 둡니다.`, piles: pos.map(p => ({ p })), colIds: cols.map(r => r.el.id) });
    found.L = bear != null ? Math.max(5, +(bear - depth + 3).toFixed(1)) : 15; if (bear == null) found.why += ' 길이는 지지층 미입력으로 15 m 가정.';
  } else if (bear != null && bear > depth + 1) {
    const L = +(bear - depth + 1).toFixed(1), cast = L > 40; const D = cast ? 1000 : 500;
    Object.assign(found, { type: cast ? '현장타설말뚝 (RCD φ1000)' : 'PHC 말뚝 (φ500)', D, L, why: `지지층 GL-${bear} m가 기초 바닥보다 ${(bear - depth).toFixed(1)} m 깊어 말뚝으로 지지합니다${cast ? ' (40 m 초과로 현장타설)' : ''}.` });
    const s = 2.5 * D, e = D / 2 + 300; // 간격 2.5D, 연단거리 = 말뚝 반경 + 300 mm
    for (const r of foots) { const f = r.el; const nx = Math.max(1, Math.floor((f.w - 2 * e) / s) + 1), ny = Math.max(1, Math.floor((f.d - 2 * e) / s) + 1); const sx = nx > 1 ? (f.w - 2 * e) / (nx - 1) : 0, sy = ny > 1 ? (f.d - 2 * e) / (ny - 1) : 0;
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) found.piles.push({ p: [f.p[0] + (nx > 1 ? -f.w / 2 + e + i * sx : 0), f.p[1] + (ny > 1 ? -f.d / 2 + e + j * sy : 0)], f: f.id }); }
    if (!foots.length && fpb) { // 매트 기초: 4 m 격자
      for (let x = fpb.x0 + 2000; x < fpb.x1; x += 4000) for (let y = fpb.y0 + 2000; y < fpb.y1; y += 4000) if (fp.some(q => pointInPoly([x, y], q))) found.piles.push({ p: [x, y] }); found.why += ' 독립기초가 없어 매트 하부 4 m 격자로 배치했습니다.'; }
    found.basis = `간격 2.5D(${s} mm), 연단거리 말뚝 반경+300 mm, 근입 1 m`;
  }
  found.total = found.piles.length;
  if (found.total) { const rate = found.D >= 1000 ? RATE.cast : RATE.phc; found.rigs = Math.max(1, Math.min(minGap != null && minGap < 6 ? 1 : 4, Math.ceil(found.total / rate / (found.D >= 1000 ? 40 : 15)))); found.dur = Math.max(2, Math.ceil(found.total / rate / found.rigs)); found.rate = rate; }
  const upLimit = method === 'td' ? Math.max(2, nB * 2) : method === 'uu' ? Math.max(2, nB * 3) : 0;
  return { lv, base, above, nB, nA, depth, fp, site: siteP, siteAssumed: assumed, fpb, sb, gaps, minGap, fpArea, perim, rec, why, method, notes, shore, found, upLimit, tall: nA >= 6 || (fpb && Math.max(fpb.x1 - fpb.x0, fpb.y1 - fpb.y0) > 45000), cond: { ...cond } };
}
const bboxAll = (polys) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of polys) for (const p of q) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } return { x0, y0, x1, y1 }; };
const uniqPts = (ps) => { const out = []; for (const p of ps) if (p && !out.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 500)) out.push(p); return out; };
function siteInfoSafe(P) { return siteInfo(P); }

// 모델 + 공법 계획에서 공정 자동 생성. plan을 주지 않으면 P.sched.cond로 계산합니다.
export function autoGenerate(P, start, plan) {
  plan ||= planBasis(P, P.sched?.cond || {});
  const acts = []; const all = allElements(P, r => !isRefElement(r.el, r.sheet, P)); const { lv, base, above, method } = plan;
  const A = (name, dur, pred, o = {}) => { const a = { id: uid('a'), name, dur: Math.max(1, Math.round(dur)), start, pred: [...new Set((pred || []).filter(Boolean).map(p => p.id))], color: o.color || PH_COL[o.ph] || '#8a94a6', wbs: o.wbs || o.ph || '', ph: o.ph || '', filter: o.filter || {} }; if (o.ids) a.ids = o.ids; if (o.lag) a.lag = o.lag; if (o.note) a.note = o.note; acts.push(a); return a; };
  const has = (L, disc, k) => L && all.some(r => r.level.id === L.id && r.sheet.disc === disc && r.el.k === k);
  const below = (L) => lv[lv.indexOf(L) - 1];
  // 바닥판(plate): 레벨 L 바닥 = L의 슬래브 + 아래층 보(보 윗면 = 아래층 천장) — 최하층은 기초 포함
  const plate = (L, pred, ph, f = 1) => {
    let last = pred; const b = below(L); const tag = L.elev < 0 && (method === 'td' || method === 'std') ? '(역타) ' : '';
    if (b && has(b, 'S', 'beam')) last = A(`${L.name} 바닥 ${tag}보 (${b.name} 천장)`, DUR.beam * f, [last], { ph, filter: { level: b.id, kind: 'beam', disc: 'S' }, wbs: `${L.name}/구조` });
    if (has(L, 'S', 'slab')) last = A(`${L.name} 바닥 ${tag}슬래브`, DUR.slab * f, [last], { ph, filter: { level: L.id, kind: 'slab', disc: 'S' }, wbs: `${L.name}/구조` });
    return last;
  };
  const verts = (L, pred, ph, f = 1, skipCol = false) => { let last = pred; for (const k of ['column', 'wall']) { if (k === 'column' && skipCol) continue; if (has(L, 'S', k)) last = A(`${L.name} ${KINDS[k].name}${ph === '지하' && f > 1 ? ' (역타 후속)' : ''}`, DUR[k] * f, [last], { ph, filter: { level: L.id, kind: k, disc: 'S' }, wbs: `${L.name}/구조` }); } return last; };
  const ph = (L) => L.elev < 0 ? '지하' : '지상';
  // 0. 가설
  const mob = A('착공·가설 (가설울타리·게이트·세륜·가설사무소·가설전기/용수)', 10, [], { ph: '가설' });
  let shore = null; if (plan.shore.dur) shore = A(`흙막이 — ${plan.shore.type}${plan.shore.support ? ' · ' + plan.shore.support : ''}`, plan.shore.dur, [mob], { ph: '토공', note: plan.shore.why });
  const F = plan.found; const pileName = F.total ? `${F.type} ${F.total}본 (L=${F.L} m, 장비 ${F.rigs}대)` : null;
  const excV = Math.round(plan.fpArea * plan.depth * 1.15); const lowL = lv[0]; const foot = (pred) => has(lowL, 'S', 'footing') ? A(`기초${method === 'td' || method === 'std' ? ' 매트' : ''} (${lowL.name})`, DUR.footing, [pred], { ph: '기초', filter: { level: lowL.id, kind: 'footing', disc: 'S' }, wbs: '기초' }) : pred;
  let topStruct = {}; // 레벨별 마지막 구조 활동
  if (method === 'bu') {
    let pre = shore || mob; let piles = null;
    if (F.total && !plan.nB) piles = A(`말뚝 — ${pileName}`, F.dur, [pre], { ph: '말뚝', note: F.why });
    const exc = A(`터파기·잔토 반출 (약 ${excV.toLocaleString()} m³, 깊이 ${plan.depth} m)`, Math.max(2, Math.ceil(excV / RATE.excBU)), [piles || pre], { ph: '토공' });
    if (F.total && plan.nB) piles = A(`말뚝 — ${pileName}`, F.dur, [exc], { ph: '말뚝', note: F.why });
    const lean = A('잡석 다짐·버림 콘크리트', Math.max(1, Math.ceil(plan.fpArea / 400)), [piles && plan.nB ? piles : exc], { ph: '기초' });
    let last = foot(lean);
    for (const L of lv) { last = plate(L, last, L === lowL ? '기초' : ph(L)); last = verts(L, last, ph(L)); topStruct[L.id] = [last]; if (plan.nB && L === base[0]) { const bf = A('지하 외벽 방수·되메우기', Math.max(3, Math.ceil(plan.perim / 40)), [last], { ph: '토공' }); last = bf; } }
  } else {
    // 기둥 선시공 (PRD/RCD + 철골기둥 플런지)
    const pc = A(`기둥 선시공 — ${pileName || '현장타설말뚝 + 철골기둥'}`, F.dur || 20, [shore || mob], { ph: '말뚝', ids: F.colIds?.length ? F.colIds : undefined, note: F.why });
    if (method === 'uu') {
      const exc = A(`전체 터파기·잔토 반출 (약 ${excV.toLocaleString()} m³) — 스트럿/앵커 단계 설치`, Math.max(3, Math.ceil(excV / RATE.excBU * 1.2)), [pc], { ph: '토공' });
      const lean = A('잡석 다짐·버림 콘크리트', Math.max(1, Math.ceil(plan.fpArea / 400)), [exc], { ph: '기초' }); const mat = foot(lean);
      let last = mat; for (const L of lv.filter(l => l.elev < 0)) { last = plate(L, last, L === lowL ? '기초' : '지하'); last = verts(L, last, '지하', 1, true); topStruct[L.id] = [last]; }
      const L0 = above[0]; const f1 = plate(L0, last, '지하'); const bf = A('지하 외벽 방수·되메우기', Math.max(3, Math.ceil(plan.perim / 40)), [f1], { ph: '토공' });
      // 지상: 기초 완료 후 선시공 철골기둥을 이용해 지하와 동시에 상향 (1층 바닥판은 지하 최상층 완료 후)
      let up = mat; above.forEach((L, i) => { if (i > 0) up = plate(L, up, '지상'); up = verts(L, up, '지상'); topStruct[L.id] = i === 0 ? [up, f1] : [up]; });
    } else {
      // 탑다운/세미: 1층 바닥 → 하향 굴착·지하 바닥 → 기초 매트 → 지하 수직부재(역타 후속)
      const L0 = above[0]; const g = A('1층 바닥 하부 터파기 (약 1 m)', Math.max(2, Math.ceil(plan.fpArea / 800)), [pc], { ph: '토공' });
      const f1 = plate(L0, g, '지하', 1.2); let last = f1; const perLv = Math.max(4, Math.ceil(plan.fpArea * (Math.abs(base[0]?.elev || 4000) / 1000) * 1.1 / RATE.excTD));
      for (let i = 0; i < base.length; i++) { const L = base[i]; const ex = A(`${L.name} 하향 굴착·잔토 반출 (슬래브 개구부 반출)`, perLv, [last], { ph: '토공' }); last = L === lowL ? A('잡석 다짐·버림 콘크리트', Math.max(1, Math.ceil(plan.fpArea / 400)), [ex], { ph: '기초' }) : ex; last = L === lowL ? plate(L, foot(last), '기초', 1.3) : plate(L, last, '지하', 1.3); }
      const mat = last; for (const L of [...base].reverse()) { last = verts(L, last, '지하', 1.3, true); topStruct[L.id] = [last]; }
      // 지상: 탑다운 = 1층 바닥 후 동시(선행 층수 제한), 세미 = 기초 매트 후
      let up = method === 'td' ? f1 : mat;
      above.forEach((L, i) => { if (i > 0) { const x0 = acts.length; up = plate(L, up, '지상'); if (method === 'td' && i > plan.upLimit && acts.length > x0) acts[x0].pred.push(mat.id); } up = verts(L, up, '지상'); topStruct[L.id] = [up]; });
    }
  }
  // 마감·설비 (층별 구조 완료 후)
  for (const L of lv) { let prev = topStruct[L.id]; if (!prev) continue;
    for (const [disc, k] of ORDER.slice(5)) { if (!has(L, disc, k)) continue; prev = [A(`${L.name} ${DISC[disc].name} ${KINDS[k].name}`, DUR[k], prev, { ph: '마감', filter: { level: L.id, kind: k, disc }, lag: disc === 'A' ? 3 : 0, color: DISC[disc].color, wbs: `${L.name}/${DISC[disc].name}` })]; } }
  return schedule(acts);
}
// ---------- 부지·동선 계획 (가설 배치) ----------
export const LOGI = {
  gateV: { name: '차량 게이트', col: '#e0af68', shape: 'rect', w: 8000, d: 1200, basis: '레미콘·덤프 교행 폭 6 m + 여유 (일반 가설계획 기준)' },
  gateP: { name: '보행 게이트', col: '#9ece6a', shape: 'rect', w: 1500, d: 1200, basis: '보행자 전용, 차량 게이트와 5 m 이상 분리' },
  wash: { name: '세륜시설', col: '#7dcfff', shape: 'rect', w: 4000, d: 10000, basis: '차량 게이트 안쪽, 반출 차량 바퀴 세척' },
  office: { name: '가설사무소·휴게', col: '#bb9af7', shape: 'rect', w: 9000, d: 3000, basis: '컨테이너 3동 기준, 보행 게이트 인접' },
  store: { name: '자재 야적장', col: '#c8a46b', shape: 'rect', basis: '건축면적의 12% (80~600 m²), 크레인 반경 안' },
  unload: { name: '하역·레미콘·펌프카', col: '#ff9e64', shape: 'rect', w: 14000, d: 8000, basis: '펌프카 길이 약 12 m, 아웃리거 전개 폭 약 8 m' },
  tc: { name: '타워크레인', col: '#f7768e', shape: 'crane', w: 6000, d: 6000, basis: '작업 반경 = 크레인에서 건물·야적장·하역장 가장 먼 점 + 2 m, 5 m 단위 올림' },
  mc: { name: '이동식 크레인', col: '#f7768e', shape: 'crane', w: 8000, d: 8000, basis: '작업 반경 = 건물 가장 먼 점 + 2 m, 아웃리거 8×8 m' },
  vpath: { name: '차량 동선', col: '#e0af68', shape: 'path', width: 6000, basis: '폭 6 m (일방 통행 4 m 이상)' },
  ppath: { name: '보행 통로', col: '#9ece6a', shape: 'path', width: 1200, basis: '폭 1.2 m, 차량 동선과 펜스로 분리' },
};
export const PHASES = { all: '전 기간', ew: '토공·기초', fr: '골조', fn: '마감' };
const SIDES = { N: '북', S: '남', E: '동', W: '서' };
function siteFrame(plan) {
  const { fpb, sb } = plan; if (!fpb || !sb) return null; const off = plan.nB || plan.depth > 1.5 ? 1000 : 0;
  const ex = { x0: fpb.x0 - off, y0: fpb.y0 - off, x1: fpb.x1 + off, y1: fpb.y1 + off }; // 흙막이·굴착선
  const th = { N: sb.y1 - ex.y1, S: ex.y0 - sb.y0, E: sb.x1 - ex.x1, W: ex.x0 - sb.x0 };
  const mid = { N: (ex.y1 + sb.y1) / 2, S: (sb.y0 + ex.y0) / 2, E: (ex.x1 + sb.x1) / 2, W: (sb.x0 + ex.x0) / 2 };
  const horiz = (s) => s === 'N' || s === 'S';
  // side s, 변 방향 위치 t(0~1, 건물 변 기준), 띠 안쪽 위치(mid)
  const at = (s, t, across = mid[s]) => horiz(s) ? [ex.x0 + (ex.x1 - ex.x0) * t, across] : [across, ex.y0 + (ex.y1 - ex.y0) * t];
  const edge = (s, t) => horiz(s) ? [sb.x0 + (sb.x1 - sb.x0) * t, s === 'S' ? sb.y0 : sb.y1] : [s === 'W' ? sb.x0 : sb.x1, sb.y0 + (sb.y1 - sb.y0) * t];
  const inward = (s, p, d) => s === 'S' ? [p[0], p[1] + d] : s === 'N' ? [p[0], p[1] - d] : s === 'W' ? [p[0] + d, p[1]] : [p[0] - d, p[1]];
  return { ex, th, mid, horiz, at, edge, inward };
}
export function autoLayout(P, plan) {
  const F = siteFrame(plan); if (!F) return { items: [], notes: ['대지·건물 외곽을 찾지 못했습니다. 작도에서 SITE 레이어 대지경계와 1층 슬래브를 그려 주세요.'] };
  const road = plan.cond.road || 'S'; const notes = []; const items = []; const I = (type, o) => { const it = { id: uid('lg'), type, phase: 'all', w: LOGI[type].w, d: LOGI[type].d, ...o }; items.push(it); return it; };
  const opp = { N: 'S', S: 'N', E: 'W', W: 'E' }; const sides = ['N', 'S', 'E', 'W'];
  const W = sides.reduce((b, s) => F.th[s] > F.th[b] + 500 || (Math.abs(F.th[s] - F.th[b]) <= 500 && s === road) ? s : b, road); // 작업 띠(가장 넓은 쪽)
  const tW = F.th[W]; const rot = (s) => F.horiz(s) ? 0 : 90; const adj = W !== road && W !== opp[road];
  if (tW < 3000) return tightLayout(plan, F, road, I, items, notes, rot);
  // 게이트: 도로 쪽, 차량은 작업 띠에 가까운 끝, 보행은 반대 끝
  const towardW = adj ? ((road === 'S' || road === 'N') ? (W === 'E' ? 0.85 : 0.15) : (W === 'N' ? 0.85 : 0.15)) : 0.8; const pedT = towardW > 0.5 ? 0.1 : 0.9;
  const gv = I('gateV', { p: F.inward(road, F.edge(road, towardW), 600), rot: rot(road), side: road }); const gp = I('gateP', { p: F.inward(road, F.edge(road, pedT), 600), rot: rot(road), side: road });
  const ws = I('wash', { p: F.inward(road, gv.p, 5600), rot: (rot(road) + 90) % 180, phase: 'all', side: road }); ws.w = 4000; ws.d = 10000;
  // 하역·야적·크레인: 작업 띠
  const tight = tW < 4500; const across = Math.max(2500, Math.min(8000, tW - 600));
  const un = I('unload', { p: F.at(W, 0.5), rot: rot(W), d: across, side: W });
  if (tight) notes.push(`작업 공간이 가장 넓은 ${SIDES[W]}측도 ${(tW / 1000).toFixed(1)} m라 하역장 폭이 부족합니다 — 도로 점용(하역) 허가 또는 ${plan.method === 'td' || plan.method === 'std' ? '1층 슬래브 작업장' : '탑다운 1층 슬래브 작업장'} 활용을 검토하세요.`);
  const area = clamp(plan.fpArea * 0.12, 80, 600) * 1e6; const sd = Math.max(2500, Math.min(10000, tW - 600)); const sLen = Math.min(area / sd, (F.horiz(W) ? F.ex.x1 - F.ex.x0 : F.ex.y1 - F.ex.y0) * 0.35);
  // 야적장: 도로 쪽이 작업 띠면 다른 넓은 쪽으로 분산(게이트·하역 혼잡 방지)
  const W2 = W === road ? sides.filter(s => s !== road).reduce((b, s) => F.th[s] > F.th[b] ? s : b, opp[road]) : W; const useW2 = W2 !== W && F.th[W2] >= 4500;
  const sd2 = useW2 ? Math.max(2500, Math.min(10000, F.th[W2] - 600)) : sd; const sLen2 = Math.min(area / sd2, (F.horiz(useW2 ? W2 : W) ? F.ex.x1 - F.ex.x0 : F.ex.y1 - F.ex.y0) * (useW2 ? 0.8 : 0.35));
  const st = I('store', { p: useW2 ? F.at(W2, 0.5) : F.at(W, 0.15), rot: rot(useW2 ? W2 : W), w: Math.round(sLen2 / 500) * 500, d: sd2, side: useW2 ? W2 : W });
  if (tight && (plan.method === 'td' || plan.method === 'std')) { const c = [(plan.fpb.x0 + plan.fpb.x1) / 2, (plan.fpb.y0 + plan.fpb.y1) / 2]; I('store', { p: c, rot: 0, w: 12000, d: 8000, phase: 'fr', onSlab: true }); notes.push('역타 공법이라 1층 바닥 완료 후 슬래브 위를 골조 기간 야적장으로 씁니다 (슬래브 작업하중 검토 필요).'); }
  // 굴착 영향 범위(굴착 깊이)보다 작업 띠가 좁으면: 역타는 1층 바닥 완료 후 슬래브 위로 하역·야적을 옮기고, 그 전(토공·기초)에는 띠를 쓰되 흙막이 설계에 하중 반영
  const pit = plan.depth > 1.5 && tW < plan.depth * 1000; const slabC = [(plan.fpb.x0 + plan.fpb.x1) / 2, (plan.fpb.y0 + plan.fpb.y1) / 2];
  if (pit) {
    if ((plan.method === 'td' || plan.method === 'std') && !items.some(i => i.onSlab)) { un.phase = 'ew'; st.phase = 'ew'; I('unload', { p: [slabC[0] + 8000, slabC[1]], rot: 0, phase: 'fr', onSlab: true }); I('store', { p: [slabC[0] - 8000, slabC[1]], rot: 0, w: 12000, d: 8000, phase: 'fr', onSlab: true });
      notes.push(`작업 띠(${(tW / 1000).toFixed(1)} m)가 굴착 깊이(${plan.depth} m)보다 좁아 굴착 영향 범위 안입니다. 역타 공법이라 골조 기간에는 1층 슬래브 위로 하역·야적을 옮기고(슬래브 작업하중·램프 검토), 토공 기간의 하역 하중은 흙막이 설계에 반영하세요.`); }
    else notes.push(`작업 띠(${(tW / 1000).toFixed(1)} m)가 굴착 깊이(${plan.depth} m)보다 좁아 장비·자재가 흙막이 영향 범위 안에 놓입니다 — 흙막이 설계에 상재하중(장비·자재)을 반영하거나 역타 공법을 검토하세요.`);
  }
  if (plan.tall) { const inside = tW < 7500; const p = inside ? F.inward(W, F.at(W, 0.85, W === 'S' ? F.ex.y0 : W === 'N' ? F.ex.y1 : W === 'W' ? F.ex.x0 : F.ex.x1), 5000) : F.at(W, 0.85); I('tc', { p, rot: 0, inside }); if (inside) notes.push('작업 띠가 좁아 타워크레인을 건물 안쪽에 세웁니다 — 슬래브 개구부·마스트 관통부 보강 필요.'); }
  else I('mc', { p: F.inward(W, un.p, 0), rot: 0, phase: 'fr' });
  const of = I('office', { p: F.inward(road, F.edge(road, pedT > 0.5 ? 0.78 : 0.22), 2100), rot: rot(road), side: road });
  resolveOverlaps(items, plan, F);
  // 동선: 차량 = 게이트 → 세륜 → 작업 띠 중심선 → 하역장 / 보행 = 보행 게이트 → 사무소 → 건물(도로 쪽 굴착선)
  const vp = [gv.p, F.inward(road, gv.p, 5600)]; const mR = F.mid[road];
  const onMid = (s, p) => F.horiz(s) ? [p[0], F.mid[s]] : [F.mid[s], p[1]];
  if (W === road) vp.push(onMid(road, un.p));
  else { vp.push(onMid(road, vp[1])); const corner = (a, b) => F.horiz(a) ? [F.mid[b], F.mid[a]] : [F.mid[a], F.mid[b]];
    if (adj) vp.push(corner(road, W)); else { const side2 = F.horiz(road) ? (F.th.E >= F.th.W ? 'E' : 'W') : (F.th.N >= F.th.S ? 'N' : 'S'); vp.push(corner(road, side2), corner(W, side2)); }
    vp.push(onMid(W, un.p)); }
  I('vpath', { pts: vp });
  const pin = F.horiz(road) ? [gp.p[0], road === 'S' ? F.ex.y0 : F.ex.y1] : [road === 'W' ? F.ex.x0 : F.ex.x1, gp.p[1]];
  I('ppath', { pts: [gp.p, F.inward(road, gp.p, 1500), pin] });
  return { items, notes, W, road };
}
// 협소 부지(작업 띠 3 m 미만): 하역·양중은 도로 점용, 야적은 최소화, 사무소는 부지 밖
function tightLayout(plan, F, road, I, items, notes, rot) {
  const out = (p, d) => F.inward(road, p, -d); const e = (t) => F.edge(road, t);
  const gv = I('gateV', { p: F.inward(road, e(0.7), 600), rot: rot(road), side: road }); I('gateP', { p: F.inward(road, e(0.12), 600), rot: rot(road), side: road });
  const un = I('unload', { p: out(e(0.55), 4600), rot: rot(road), d: 8000, roadUse: true, phase: 'all' }); I('mc', { p: [...un.p], rot: 0, roadUse: true, phase: 'fr' });
  const others = ['N', 'S', 'E', 'W'].filter(s => s !== road).sort((a, b) => F.th[b] - F.th[a]); const s2 = others[0];
  if (F.th[s2] >= 1500) I('store', { p: F.at(s2, 0.5), rot: rot(s2), w: 6000, d: Math.max(1000, F.th[s2] - 400), side: s2 }); else notes.push('부지 안에 야적 공간이 없어 자재는 당일 반입·당일 사용(JIT)으로 계획하세요.');
  I('vpath', { pts: [out(e(0.98), 2500), out(e(0.1), 2500)], roadUse: true });
  const pin = F.horiz(road) ? [items[1].p[0], road === 'S' ? F.ex.y0 : F.ex.y1] : [road === 'W' ? F.ex.x0 : F.ex.x1, items[1].p[1]]; I('ppath', { pts: [items[1].p, pin] });
  notes.push(`협소 부지 — 건물 주변 여유가 ${(F.th[road] / 1000).toFixed(1)} m 이하라 하역·양중을 도로 점용으로 계획했습니다. 도로 점용 허가, 교통 통제(신호수·안전 콘), 보행자 우회 동선이 필요합니다.`, '가설사무소는 부지 밖(인근 임차 또는 도로 점용 컨테이너 1동)으로 두고, 세륜은 이동식 세륜기 또는 수동 세척으로 대체합니다.');
  return { items, notes, W: road, road };
}
// 겹침 해소: 우선순위 순으로 고정하고, 뒤 항목을 자기 띠 방향으로 밀어냄
function resolveOverlaps(items, plan, F) {
  const bb = (it) => { const q = rectPts(it); return { x0: Math.min(...q.map(p => p[0])), x1: Math.max(...q.map(p => p[0])), y0: Math.min(...q.map(p => p[1])), y1: Math.max(...q.map(p => p[1])) }; };
  const ov = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0;
  const order = ['gateV', 'gateP', 'wash', 'unload', 'tc', 'store', 'office']; const fixed = []; const sb = plan.sb;
  for (const it of [...items].filter(i => order.includes(i.type) && !i.inside && !i.onSlab).sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))) {
    const ax = it.side ? (F.horiz(it.side) ? 0 : 1) : 0; const p0 = [...it.p];
    for (const step of [0, 1, -1, 2, -2, 3, -3, 4, -4, 6, -6, 8, -8]) { it.p = [...p0]; it.p[ax] += step * 3000; const b = bb(it); if (b.x0 < sb.x0 || b.x1 > sb.x1 || b.y0 < sb.y0 || b.y1 > sb.y1) continue; if (!fixed.some(f => ov(b, bb(f)))) break; }
    fixed.push(it);
  }
}
const rectPts = (it) => { const a = (it.rot || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [it.p[0] + i * it.w / 2 * c - j * it.d / 2 * s, it.p[1] + i * it.w / 2 * s + j * it.d / 2 * c]); };
export { rectPts };
// 크레인 작업 반경 자동 산정(mm)
export function craneReach(it, plan, items) {
  const pts = []; const b = plan.fpb; if (b) pts.push([b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]);
  for (const o of items) if ((o.type === 'store' || o.type === 'unload') && !o.onSlab) pts.push(...rectPts(o));
  const r = Math.max(0, ...pts.map(p => dist(p, it.p))) + 2000; return Math.ceil(r / 5000) * 5000;
}
const inPhase = (it, ph) => ph === 'all' || it.phase === 'all' || it.phase === ph;
const bboxDist = (q, b) => { const dx = Math.max(b.x0 - q[0], 0, q[0] - b.x1), dy = Math.max(b.y0 - q[1], 0, q[1] - b.y1); return Math.hypot(dx, dy); };
export function siteChecks(plan, items, phase = 'all') {
  const out = []; const F = siteFrame(plan); if (!F) return out; const V = items.filter(i => inPhase(i, phase));
  const segs = (it) => it.pts.slice(1).map((p, i) => [it.pts[i], p]);
  const vps = V.filter(i => i.type === 'vpath'), pps = V.filter(i => i.type === 'ppath'), cranes = V.filter(i => LOGI[i.type].shape === 'crane');
  for (const v of vps) for (const q of pps) { let crossed = false; for (const [a, b] of segs(v)) for (const [c, d] of segs(q)) { const x = segInt(a, b, c, d); if (x) { crossed = true; out.push({ lv: '위험', msg: '차량 동선과 보행 통로가 교차합니다.', fix: '보행 통로를 우회시키거나, 교차부에 신호수·차단봉·횡단 표시를 두세요.', at: x.p, ids: [v.id, q.id] }); } }
    if (!crossed) { let m = Infinity, at = null; for (const [a, b] of segs(v)) for (const p of q.pts) { const c = closestOnSeg(p, a, b); if (c.d < m) { m = c.d; at = p; } } const need = (LOGI.vpath.width + LOGI.ppath.width) / 2 + 1000; if (m < need) out.push({ lv: '주의', msg: `차량 동선과 보행 통로가 ${(m / 1000).toFixed(1)} m로 가깝습니다 (필요 ${(need / 1000).toFixed(1)} m).`, fix: '사이에 분리 펜스(1 m 이상 이격)를 설치하세요.', at, ids: [v.id, q.id] }); } }
  for (const c of cranes) { const r = craneReach(c, plan, items); c.r = r;
    for (const q of pps) for (const p of q.pts) if (dist(p, c.p) < r) { out.push({ lv: '주의', msg: `보행 통로가 ${LOGI[c.type].name} 작업 반경(${r / 1000} m) 안을 지납니다.`, fix: '양중 중 통행 통제, 보행 통로 상부에 낙하물 방호 터널을 설치하세요.', at: p, ids: [q.id, c.id] }); break; }
    for (const o of V.filter(i => i.type === 'office')) if (dist(o.p, c.p) < r) out.push({ lv: '주의', msg: `가설사무소가 크레인 작업 반경 안에 있습니다.`, fix: '반경 밖으로 옮기거나 지붕 방호(낙하물)를 보강하세요.', at: o.p, ids: [o.id, c.id] });
    if (r > 70000) out.push({ lv: '주의', msg: `필요 작업 반경 ${r / 1000} m — 타워크레인 1대로는 무리입니다.`, fix: '크레인 2대 배치 또는 위치를 건물 중앙 쪽으로 옮기세요.', at: c.p, ids: [c.id] });
    const sb = plan.sb; if (sb && (c.p[0] - r < sb.x0 || c.p[0] + r > sb.x1 || c.p[1] - r < sb.y0 || c.p[1] + r > sb.y1)) out.push({ lv: '주의', msg: '크레인 선회 반경이 대지 밖(인접 대지·도로) 상공으로 나갑니다.', fix: '무부하 선회 제한 장치 설정, 인접 소유자·도로 관리청 협의가 필요합니다.', at: c.p, ids: [c.id] }); }
  if (!cranes.length && plan.nA >= 2) out.push({ lv: '주의', msg: '양중 장비(크레인)가 배치되지 않았습니다.', fix: '"자동 배치"를 누르거나 크레인을 추가하세요.', at: null, ids: [] });
  for (const o of V.filter(i => i.type === 'store' || i.type === 'unload')) { if (o.onSlab) continue; const inR = cranes.some(c => rectPts(o).every(p => dist(p, c.p) <= (c.r || craneReach(c, plan, items)))); if (cranes.length && !inR) out.push({ lv: '주의', msg: `${LOGI[o.type].name} — 크레인 작업 반경 밖입니다.`, fix: '재취급이 생깁니다. 반경 안으로 옮기세요.', at: o.p, ids: [o.id] }); }
  if (plan.depth > 1.5) for (const o of V.filter(i => ['unload', 'mc', 'store', 'tc'].includes(i.type) && !i.inside && !i.onSlab)) { const dd = Math.min(...rectPts(o).map(p => bboxDist(p, F.ex))); if (dd < plan.depth * 1000) out.push({ lv: '위험', msg: `${LOGI[o.type].name} — 굴착선에서 ${(dd / 1000).toFixed(1)} m, 굴착 깊이(${plan.depth} m) 영향 범위 안이라 흙막이에 상재하중이 걸립니다.`, fix: `굴착 깊이 이상 이격하거나, 흙막이 설계에 장비·자재 하중을 반영하세요.`, at: o.p, ids: [o.id] }); }
  if (plan.site) for (const o of V.filter(i => LOGI[i.type].shape !== 'path')) if (!rectPts(o).every(p => pointInPoly(p, plan.site))) out.push(o.roadUse ? { lv: '주의', msg: `${LOGI[o.type].name} — 도로 점용 구역입니다.`, fix: '도로 점용 허가, 작업 중 교통 통제(신호수·안전 콘)와 보행자 우회 안내를 준비하세요.', at: o.p, ids: [o.id] } : { lv: o.type === 'gateV' || o.type === 'gateP' ? '주의' : '위험', msg: `${LOGI[o.type].name} — 대지 경계 밖으로 나갑니다.`, fix: o.type.startsWith('gate') ? '게이트는 대지 경계선에 맞추세요.' : '대지 안으로 옮기거나 도로 점용 허가를 받으세요.', at: o.p, ids: [o.id] });
  const gv = V.find(i => i.type === 'gateV'), gp = V.find(i => i.type === 'gateP');
  if (gv && gp && dist(gv.p, gp.p) < 5000) out.push({ lv: '주의', msg: '차량 게이트와 보행 게이트가 5 m 이내입니다.', fix: '보행 게이트를 떨어뜨려 출입을 분리하세요.', at: gp.p, ids: [gv.id, gp.id] });
  if (!vps.length || !pps.length) out.push({ lv: '주의', msg: '차량 동선·보행 통로가 모두 지정되어야 분리 여부를 점검할 수 있습니다.', fix: '동선을 추가하세요.', at: null, ids: [] });
  return out.sort((a, b) => (a.lv === '위험' ? 0 : 1) - (b.lv === '위험' ? 0 : 1));
}

// 날짜 기준 계획 기성률(금액 가중)
export function plannedPct(P, date, rows = takeoff(P)) {
  const st = statusAt(P, date); const price = Object.fromEntries(P.boq.map(b => [b.code, b.price])); let tot = 0, done = 0;
  for (const r of rows) { const v = r.qty * (price[r.code] || 0); tot += v; done += v * ((st[r.el.id]?.pct) || 0) / 100; }
  return tot ? done / tot * 100 : 0;
}

export function mount(root, ctx) {
  const P = ctx.P; P.sched ||= { acts: [], start: new Date().toISOString().slice(0, 10) }; const SC = P.sched;
  const st = { zoom: 14, sel: null, tab: ctx.state.schedTab || 'gantt' }; delete ctx.state.schedTab; const cleanups = [];
  const page = h('div', { class: 'page' }); const w = h('div', { class: 'wrap', style: { maxWidth: '1400px' } }); page.append(w); root.append(page);
  const save = () => { ctx.touch('meta'); };

  function render() {
    while (cleanups.length) cleanups.pop()(); w.innerHTML = '';
    w.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('div', {}, h('h1', {}, '공정 (4D)'), h('div', { class: 'sub' }, '공정 활동을 층·공종·객체 종류로 모델에 연결하면 3D에서 날짜별 시공 순서를 재생하고, 기성 회차의 계획 기성률을 자동 계산합니다.')),
      h('div', { class: 'row' }, h('button', { class: 'btn', title: 'MS Project XML(.xml), Excel(.xlsx/.csv) — P6는 XML/엑셀로 내보낸 뒤 불러오세요', onclick: importSched }, '공정표 불러오기'), h('button', { class: 'btn', onclick: gen }, '모델에서 공정 자동 생성'), h('button', { class: 'btn primary', onclick: addAct }, '+ 활동'))));
    const tabs = h('div', { class: 'row', style: { gap: '4px', marginTop: '10px', borderBottom: '1px solid var(--line)' } });
    for (const [k, n] of [['gantt', '공정표'], ['method', '공법·기초'], ['site', '부지·동선']]) tabs.append(h('button', { class: 'tb' + (st.tab === k ? ' on' : ''), onclick: () => { st.tab = k; render(); } }, n));
    w.append(tabs);
    if (st.tab === 'method') return renderMethod();
    if (st.tab === 'site') return renderSite();
    if (!SC.acts.length) { w.append(h('div', { class: 'card', style: { marginTop: '14px' } }, h('div', { class: 't' }, '공정 활동이 없습니다'), h('div', { class: 'd' }, '"모델에서 공정 자동 생성"을 누르면 "공법·기초" 탭의 현장 조건과 공법에 따라 가설·흙막이·터파기·말뚝·기초·골조(지하·지상)·마감 순으로 활동이 만들어집니다.', h('button', { class: 'btn sm', style: { marginTop: '8px' }, onclick: () => { st.tab = 'method'; render(); } }, '공법·기초 먼저 보기')))); return; }
    schedule(SC.acts);
    const s0 = SC.acts.reduce((m, a) => toD(a.start) < toD(m) ? a.start : m, SC.acts[0].start), e0 = SC.acts.reduce((m, a) => toD(a.end) > toD(m) ? a.end : m, SC.acts[0].end);
    const span = daysBetween(s0, e0) + 1;
    w.append(h('div', { class: 'row', style: { margin: '12px 0' } },
      h('span', { class: 'pill acc' }, `착공 ${s0}`), h('span', { class: 'pill acc' }, `완료 ${e0}`), h('span', { class: 'pill' }, `총 ${span}일 · 활동 ${SC.acts.length}개`), SC.method ? h('span', { class: 'pill', title: '공법·기초 탭에서 바꿀 수 있습니다' }, `공법 ${METHODS[SC.method]?.short || '-'}`) : null,
      h('button', { class: 'btn sm', onclick: () => { ctx.state.sched4d = { date: s0 }; ctx.go('view3d'); } }, '▶ 3D 4D 재생'),
      h('button', { class: 'btn sm', onclick: fillPlan }, '기성 회차 계획률 자동 입력'),
      h('button', { class: 'btn sm', onclick: () => saveFile(`${P.name}_공정표.csv`.replace(/[\\/:*?"<>|]/g, '_'), csv([['WBS', '활동', '시작', '종료', '기간(일)', '선행', '연결 객체 수'], ...SC.acts.map(a => [a.wbs || '', a.name, a.start, a.end, a.dur, (a.pred || []).map(p => SC.acts.find(x => x.id === p)?.name || '').join('; '), count(a)])])) }, 'CSV'),
      h('label', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'note' }, '확대'), (() => { const r = h('input', { type: 'range', min: 4, max: 40, value: st.zoom }); r.oninput = () => { st.zoom = +r.value; render(); }; return r; })())));
    // 간트
    const px = st.zoom, rowH = 30, left = 300;
    const wrap = h('div', { class: 'tbl', style: { overflow: 'auto', maxHeight: '62vh', position: 'relative' } });
    const svgW = left + span * px + 40, svgH = 30 + SC.acts.length * rowH;
    const today = toS(Date.now()); const tx = left + daysBetween(s0, today) * px;
    let svg = `<svg width="${svgW}" height="${svgH}" style="display:block;font-family:inherit">`;
    for (let d = 0; d <= span; d++) { const ds = addDays(s0, d); const x = left + d * px; const dt = new Date(toD(ds)); if (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) svg += `<rect x="${x}" y="24" width="${px}" height="${svgH}" fill="#ffffff06"/>`; if (dt.getUTCDate() === 1 || d === 0) svg += `<line x1="${x}" x2="${x}" y1="0" y2="${svgH}" stroke="#364152"/><text x="${x + 3}" y="14" fill="#a9b1c1" font-size="11">${ds.slice(0, 7)}</text>`; else if (px >= 14 || dt.getUTCDay() === 1) svg += `<text x="${x + 2}" y="24" fill="#6f7a8d" font-size="9">${dt.getUTCDate()}</text>`; }
    SC.acts.forEach((a, i) => {
      const y = 30 + i * rowH, x = left + daysBetween(s0, a.start) * px, wd = (daysBetween(a.start, a.end) + 1) * px;
      svg += `<rect x="0" y="${y}" width="${svgW}" height="${rowH}" fill="${st.sel === a.id ? '#1d3350' : i % 2 ? '#ffffff04' : 'transparent'}" data-a="${a.id}" style="cursor:pointer"/>`;
      svg += `<text x="8" y="${y + 19}" fill="#e6e9ef" font-size="12.5" data-a="${a.id}" style="cursor:pointer"><title>${esc(a.name)}</title>${esc(a.name.length > 25 ? a.name.slice(0, 24) + '…' : a.name)}</text><text x="${left - 8}" y="${y + 19}" fill="#6f7a8d" font-size="11" text-anchor="end">${a.dur}일 · ${count(a)}</text>`;
      svg += `<rect x="${x}" y="${y + 7}" width="${wd}" height="${rowH - 14}" rx="3" fill="${a.color || '#4ea1ff'}" opacity="0.85" data-a="${a.id}" style="cursor:pointer"><title>${esc(a.name)} ${a.start} ~ ${a.end}${a.note ? '\n' + esc(a.note) : ''}</title></rect>`;
      for (const pid of a.pred || []) { const p = SC.acts.find(z => z.id === pid); if (!p) continue; const pi = SC.acts.indexOf(p); const px1 = left + (daysBetween(s0, p.end) + 1) * px, py = 30 + pi * rowH + rowH / 2; svg += `<path d="M${px1} ${py} h6 V${y + rowH / 2} H${x}" fill="none" stroke="#6f7a8d" stroke-width="1" marker-end="url(#ar)"/>`; }
    });
    if (tx > left && tx < svgW) svg += `<line x1="${tx}" x2="${tx}" y1="24" y2="${svgH}" stroke="#ef5f5f" stroke-dasharray="4 3"/><text x="${tx + 3}" y="${svgH - 4}" fill="#ef5f5f" font-size="10">오늘</text>`;
    for (const p of P.bill.periods) if (p.date) { const x = left + daysBetween(s0, p.date) * px; if (x > left && x < svgW) svg += `<line x1="${x}" x2="${x}" y1="24" y2="${svgH}" stroke="#e6b450" stroke-dasharray="2 3"/><text x="${x + 3}" y="36" fill="#e6b450" font-size="10">${esc(p.name)}</text>`; }
    svg += `<defs><marker id="ar" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#6f7a8d"/></marker></defs></svg>`;
    wrap.innerHTML = svg; wrap.addEventListener('click', (e) => { const id = e.target.getAttribute?.('data-a'); if (id) { st.sel = id; render(); } });
    w.append(wrap);
    if (st.sel) renderEdit(SC.acts.find(a => a.id === st.sel));
  }
  const count = (a) => allElements(P, r => matchAct(a, r)).length;
  function renderEdit(a) {
    if (!a) return; const card = h('div', { class: 'card', style: { marginTop: '12px' } }); w.append(card);
    const kv = h('div', { class: 'row', style: { alignItems: 'flex-end' } });
    const fld = (label, el) => h('label', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } }, h('span', { class: 'note' }, label), el);
    const name = h('input', { value: a.name, style: { width: '200px' } }); name.onchange = () => { a.name = name.value; save(); render(); };
    const sd = h('input', { type: 'date', value: a.start }); sd.onchange = () => { a.start = sd.value; a.pred = []; save(); render(); };
    const du = h('input', { type: 'number', value: a.dur, style: { width: '70px' } }); du.onchange = () => { a.dur = Math.max(1, +du.value); save(); render(); };
    const pr = h('select', { multiple: true, style: { minWidth: '180px', height: '60px' } }); for (const o of SC.acts) if (o !== a) pr.append(h('option', { value: o.id, selected: (a.pred || []).includes(o.id) }, o.name)); pr.onchange = () => { a.pred = [...pr.selectedOptions].map(o => o.value); save(); render(); };
    const lag = h('input', { type: 'number', value: a.lag || 0, style: { width: '60px' } }); lag.onchange = () => { a.lag = +lag.value; save(); render(); };
    const sel = (label, key, opts) => { const s = h('select'); s.append(h('option', { value: '' }, '전체')); for (const [v, l] of opts) s.append(h('option', { value: v, selected: a.filter?.[key] === v }, l)); s.onchange = () => { a.filter ||= {}; a.filter[key] = s.value || undefined; a.ids = null; save(); render(); }; return fld(label, s); };
    const zones = [...new Set(allElements(P).map(r => r.el.zone).filter(Boolean))];
    kv.append(fld('활동명', name), fld('시작', sd), fld('기간(일)', du), fld('선행(FS, 여러개)', pr), fld('지연(일)', lag), sel('층', 'level', P.levels.map(l => [l.id, l.name])), sel('공종', 'disc', Object.entries(DISC).map(([k, d]) => [k, d.name])), sel('객체', 'kind', Object.entries(KINDS).map(([k, d]) => [k, d.name])), sel('구역', 'zone', zones.map(z => [z, z])));
    card.append(h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '8px' } }, h('div', { class: 't' }, `${a.name} — ${a.start} ~ ${a.end}`), h('div', { class: 'row' },
      h('button', { class: 'btn sm', onclick: () => { const ids = allElements(P, r => matchAct(a, r)).map(r => r.el.id); ctx.state.hi = { ids, label: a.name }; ctx.go('view3d'); } }, `연결 객체 ${count(a)}개 3D 보기`),
      h('button', { class: 'btn sm', onclick: () => { const i = SC.acts.indexOf(a); if (i > 0) { SC.acts.splice(i, 1); SC.acts.splice(i - 1, 0, a); save(); render(); } } }, '↑'), h('button', { class: 'btn sm', onclick: () => { const i = SC.acts.indexOf(a); SC.acts.splice(i, 1); SC.acts.splice(i + 1, 0, a); save(); render(); } }, '↓'),
      h('button', { class: 'btn sm danger', onclick: () => { SC.acts = SC.acts.filter(x => x !== a); for (const o of SC.acts) o.pred = (o.pred || []).filter(p => p !== a.id); st.sel = null; save(); render(); } }, '삭제'))), kv);
  }
  async function importSched() {
    const f = await pickFile('.xml,.xlsx,.xls,.csv'); if (!f) return;
    let rows = [];
    try {
      if (/\.xml$/i.test(f.name)) rows = parseMSP(await f.text());
      else { const X = await xlsx(); const wb = X.read(new Uint8Array(await f.arrayBuffer()), { type: 'array', cellDates: true }); const ws = wb.Sheets[wb.SheetNames[0]]; rows = parseTable(X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' })); }
    } catch (e) { console.error(e); return toast('공정표를 읽지 못했습니다: ' + e.message, 'err'); }
    if (!rows.length) return toast('활동을 찾지 못했습니다 (작업명·시작·기간/종료 열 필요)', 'err');
    const acts = rows.map(r => ({ id: uid('a'), _src: r.id, name: r.name, start: r.start, dur: r.dur, lag: 0, pred: [], filter: guessFilter(P, r.name) }));
    const bySrc = Object.fromEntries(acts.map(a => [a._src, a.id])); rows.forEach((r, i) => { acts[i].pred = (r.pred || []).map(p => bySrc[p]).filter(Boolean); });
    // 선행이 있으면 엑셀/XML 날짜가 우선(실제 계획일): 선행 계산으로 덮어쓰지 않도록 lag 보정
    const linked = acts.filter(a => Object.keys(a.filter).length).length;
    const v = await dialog({ title: '공정표 불러오기', body: `<div class="note">${esc(f.name)} — 활동 ${acts.length}개, 이 중 ${linked}개를 활동명(층·공종·부재 단어)으로 모델에 자동 연결했습니다. 연결 안 된 활동은 목록에서 필터를 지정하면 4D에 나옵니다.</div>`, fields: [{ key: 'mode', label: '방식', type: 'select', options: [['replace', '기존 활동 바꾸기'], ['append', '뒤에 추가']], value: 'replace' }, { key: 'keep', label: '파일의 날짜 그대로 쓰기 (선행 관계는 표시만)', type: 'checkbox', value: true }] });
    if (!v) return; if (v.keep) for (const a of acts) { a.predShow = a.pred; a.pred = []; }
    for (const a of acts) delete a._src;
    SC.acts = v.mode === 'append' ? [...SC.acts, ...acts] : acts; SC.start = acts.reduce((m, a) => a.start < m ? a.start : m, acts[0].start); save(); render(); toast(`활동 ${acts.length}개 불러옴`, 'ok');
  }
  // ---------- 공법·기초 탭 ----------
  const cond = () => (SC.cond ||= { bear: '', road: 'S', adj: false, fast: false, method: '' });
  function spanOf(acts) { if (!acts.length) return 0; const s0 = acts.reduce((m, a) => a.start < m ? a.start : m, acts[0].start), e0 = acts.reduce((m, a) => a.end > m ? a.end : m, acts[0].end); return daysBetween(s0, e0) + 1; }
  function renderMethod() {
    const C = cond(); const pl = planBasis(P, C);
    const fld = (label, el, hint) => h('label', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } }, h('span', { class: 'note' }, label), el, hint ? h('span', { class: 'note', style: { fontSize: '11px' } }, hint) : null);
    const upd = (k, v) => { C[k] = v; save(); render(); };
    const bear = h('input', { type: 'number', step: 0.5, min: 0, value: C.bear ?? '', placeholder: '예: 18', style: { width: '110px' } }); bear.onchange = () => upd('bear', bear.value === '' ? '' : +bear.value);
    const road = h('select'); for (const [k, n] of Object.entries(SIDES)) road.append(h('option', { value: k, selected: C.road === k }, n + '측')); road.onchange = () => upd('road', road.value);
    const chk = (k, label) => { const c = h('input', { type: 'checkbox', checked: !!C[k] }); c.onchange = () => upd(k, c.checked); return h('label', { class: 'row', style: { gap: '6px' } }, c, label); };
    const msel = h('select'); msel.append(h('option', { value: '', selected: !C.method }, `자동 — 추천: ${METHODS[pl.rec].short}`)); for (const [k, m] of Object.entries(METHODS)) msel.append(h('option', { value: k, selected: C.method === k }, m.name)); msel.onchange = () => upd('method', msel.value);
    w.append(h('div', { class: 'card', style: { marginTop: '12px' } }, h('div', { class: 't' }, '현장 조건 (입력)'), h('div', { class: 'note', style: { margin: '2px 0 10px' } }, '현장에서 확인한 값만 넣으세요. 공법·흙막이·기초·말뚝 본수·장비 대수는 툴이 기준에 따라 정하고 근거를 아래에 표시합니다.'),
      h('div', { class: 'row', style: { gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' } }, fld('지지층 깊이 (GL- m)', bear, '지반조사 보고서 기준, 모르면 비워 두세요'), fld('도로에 접한 방향', road), h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, chk('adj', '인접 건물이 가까움 (굴착 영향권)'), chk('fast', '공기 우선')), fld('공법', msel, C.method && C.method !== pl.rec ? `추천(${METHODS[pl.rec].short})과 다릅니다` : null))));
    const kv = (l, v, sub) => h('div', { class: 'card', style: { padding: '8px 12px' } }, h('div', { class: 'note' }, l), h('div', { style: { fontSize: '16px', fontWeight: 600 } }, v), sub ? h('div', { class: 'note', style: { fontSize: '11px', marginTop: '2px' } }, sub) : null);
    w.append(h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: '8px', marginTop: '10px' } },
      kv('굴착 깊이', `${pl.depth} m`, pl.nB ? `지하 ${pl.nB}개 층 + 기초 두께 + 버림` : '기초 두께 + 버림'),
      kv('대지 여유 (최소)', pl.minGap == null ? '-' : `${pl.minGap.toFixed(1)} m`, pl.siteAssumed ? '대지경계(SITE 레이어)가 없어 건물+10 m로 가정' : pl.gaps ? Object.entries(pl.gaps).map(([k, v]) => `${SIDES[k]} ${(v / 1000).toFixed(1)}`).join(' · ') + ' m' : ''),
      kv('공법', METHODS[pl.method].name, pl.method === pl.rec ? '추천 공법' : `추천: ${METHODS[pl.rec].short}`),
      kv('흙막이', pl.shore.type, pl.shore.dur ? `둘레 약 ${pl.shore.len} m · ${pl.shore.dur}일${pl.shore.support ? ' · 지보 ' + pl.shore.support : ''}` : ''),
      kv('기초', pl.found.type, pl.found.total ? `${pl.found.total}본 · L=${pl.found.L} m · 장비 ${pl.found.rigs}대 · ${pl.found.dur}일` : ''),
      pl.method === 'td' ? kv('지상 동시 시공 한도', `${pl.upLimit}개 층`, '기초 매트 전 선행 가능 층수 (지하층수×2, 선시공 기둥 축력 구조 검토 필요)') : pl.method === 'uu' ? kv('지상 동시 시공', '기초 완료 후', '선시공 철골기둥으로 지상 선행, 기둥 축력 구조 검토 필요') : null));
    const why = h('div', { class: 'card', style: { marginTop: '10px' } }, h('div', { class: 't' }, '산정 근거'));
    const li = (t, warn) => h('li', { style: { margin: '3px 0', color: warn ? 'var(--warn)' : '' } }, t);
    why.append(h('div', { class: 'note', style: { marginTop: '6px' } }, `공법 — ${METHODS[pl.method].desc}`), h('ul', { style: { margin: '4px 0 8px 18px', fontSize: '13px' } }, ...pl.why.map(t => li(t)), ...pl.notes.map(t => li(t, true))),
      h('div', { class: 'note' }, '흙막이'), h('ul', { style: { margin: '4px 0 8px 18px', fontSize: '13px' } }, li(pl.shore.why)),
      h('div', { class: 'note' }, '기초·말뚝'), h('ul', { style: { margin: '4px 0 0 18px', fontSize: '13px' } }, li(pl.found.why, pl.found.warn), pl.found.basis ? li(`배치 기준: ${pl.found.basis}`) : null, pl.found.total ? li(`시공 속도: ${pl.found.D >= 1000 ? '현장타설 0.5본/일·대' : 'PHC 12본/일·대'} → ${pl.found.total}본 ÷ ${pl.found.rigs}대 = ${pl.found.dur}일`) : null));
    w.append(why);
    // 공법별 공기 비교
    const cmp = h('div', { class: 'card', style: { marginTop: '10px' } }, h('div', { class: 't' }, '공법별 공기 비교'), h('div', { class: 'note', style: { margin: '2px 0 8px' } }, '같은 모델·현장 조건으로 공법만 바꿔 생성한 총 공기입니다. 선택한 공법으로 공정표를 만듭니다.'));
    const t0 = SC.start || toS(Date.now()); const tb = h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } });
    for (const k of Object.keys(METHODS)) { const p2 = planBasis(P, { ...C, method: k }); const ok = p2.method === k; const d = ok ? spanOf(autoGenerate(P, t0, p2)) : null;
      tb.append(h('div', { class: 'card' + (ok ? ' click' : ''), style: { padding: '8px 12px', minWidth: '150px', opacity: ok ? 1 : 0.5, outline: pl.method === k ? '2px solid var(--acc)' : 'none' }, onclick: ok ? () => upd('method', k === pl.rec ? '' : k) : null },
        h('div', { class: 'note' }, METHODS[k].short + (k === pl.rec ? ' (추천)' : '')), h('div', { style: { fontSize: '16px', fontWeight: 600 } }, ok ? `${d}일` : '해당 없음'), !ok ? h('div', { class: 'note', style: { fontSize: '11px' } }, '지하층 없음') : null)); }
    cmp.append(tb, h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn primary', onclick: gen }, `${METHODS[pl.method].short} 공법으로 공정표 생성`), h('button', { class: 'btn', onclick: () => { st.tab = 'site'; render(); } }, '부지·동선 계획 →')));
    w.append(cmp);
  }
  // ---------- 부지·동선 탭 ----------
  const LG = () => (SC.site ||= { items: [] });
  let siteView = null;
  function renderSite() {
    const pl = planBasis(P, cond()); const S = LG(); st.phase ||= 'all';
    if (!pl.fpb) { w.append(h('div', { class: 'card', style: { marginTop: '12px' } }, h('div', { class: 't' }, '건물 외곽을 찾지 못했습니다'), h('div', { class: 'd' }, '작도에서 1층 슬래브(또는 벽)를 그리고, 대지경계는 SITE 레이어 닫힌 폴리선으로 그려 주세요.'))); return; }
    if (!S.items.length) { const r = autoLayout(P, pl); S.items = r.items; S.notes = r.notes; save(); }
    const cv = h('canvas', { style: { width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: 'default' } });
    const box = h('div', { style: { position: 'relative', flex: '1 1 420px', minWidth: '280px', height: '68vh', minHeight: '360px', background: '#0b0e13', borderRadius: '8px', overflow: 'hidden' } }, cv);
    const side = h('div', { style: { flex: '0 1 340px', minWidth: '280px', maxHeight: '68vh', overflow: 'auto' } });
    const wrap = h('div', { class: 'row', style: { alignItems: 'stretch', gap: '10px', marginTop: '10px', flexWrap: 'wrap' } }, box, side);
    const psel = h('select'); for (const [k, n] of Object.entries(PHASES)) psel.append(h('option', { value: k, selected: st.phase === k }, n)); psel.onchange = () => { st.phase = psel.value; draw(); renderSide(); };
    w.append(h('div', { class: 'row', style: { marginTop: '12px', gap: '8px', flexWrap: 'wrap' } }, h('span', { class: 'note' }, '단계'), psel,
      h('button', { class: 'btn sm', onclick: async () => { if (S.items.length && !await confirmBox('자동 배치', '현재 배치를 지우고 현장 조건·공법 기준으로 다시 배치합니다.', '다시 배치')) return; const r = autoLayout(P, pl); S.items = r.items; S.notes = r.notes; st.lsel = null; save(); render(); } }, '자동 배치'),
      h('span', { class: 'note' }, `공법 ${METHODS[pl.method].short} · 도로 ${SIDES[cond().road || 'S']}측 · 굴착 ${pl.depth} m`), h('span', { class: 'note' }, '끌어서 옮기기 · 휠로 확대 · 빈 곳 끌기로 이동')), wrap);
    const g = cv.getContext('2d'); let W = 0, H = 0, dpr = 1; const V = siteView ||= { cx: 0, cy: 0, s: 0 };
    const w2s = (p) => [(p[0] - V.cx) * V.s + W / 2, H / 2 - (p[1] - V.cy) * V.s], s2w = (x, y) => [(x - W / 2) / V.s + V.cx, (H / 2 - y) / V.s + V.cy];
    const fit = () => { const b = { ...(pl.sb || pl.fpb) }; for (const it of S.items) for (const q of it.pts || rectPts(it)) { b.x0 = Math.min(b.x0, q[0]); b.x1 = Math.max(b.x1, q[0]); b.y0 = Math.min(b.y0, q[1]); b.y1 = Math.max(b.y1, q[1]); } V.cx = (b.x0 + b.x1) / 2; V.cy = (b.y0 + b.y1) / 2; V.s = Math.min(W / ((b.x1 - b.x0) * 1.15), H / ((b.y1 - b.y0) * 1.15)); };
    let checks = [];
    function draw() {
      if (!W) return; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); const vis = S.items.filter(i => inPhase(i, st.phase)); checks = siteChecks(pl, S.items, st.phase);
      const poly = (pts, close = true) => { g.beginPath(); pts.forEach((p, i) => { const q = w2s(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); if (close) g.closePath(); };
      if (pl.site) { poly(pl.site); g.fillStyle = '#141a22'; g.fill(); g.strokeStyle = '#e6e9ef'; g.lineWidth = 1.5; g.setLineDash([10, 4, 2, 4]); g.stroke(); g.setLineDash([]); }
      const F = siteFrame(pl); if (F && (pl.nB || pl.depth > 1.5)) { const e = F.ex; poly([[e.x0, e.y0], [e.x1, e.y0], [e.x1, e.y1], [e.x0, e.y1]]); g.strokeStyle = '#c8a46b'; g.setLineDash([6, 4]); g.lineWidth = 1.5; g.stroke(); g.setLineDash([]); const q = w2s([e.x0, e.y1]); g.fillStyle = '#c8a46b'; g.font = '11px sans-serif'; g.fillText(`굴착선·흙막이 (${pl.shore.type})`, q[0] + 4, q[1] - 4); }
      for (const q of pl.fp) { poly(q); g.fillStyle = '#2a3342'; g.fill(); g.strokeStyle = '#5b6578'; g.lineWidth = 1; g.stroke(); }
      if (pl.found.total && (st.phase === 'all' || st.phase === 'ew')) { g.fillStyle = '#b48ead'; for (const pp of pl.found.piles) { const q = w2s(pp.p); g.beginPath(); g.arc(q[0], q[1], Math.max(2, pl.found.D / 2 * V.s), 0, 7); g.fill(); } }
      // 크레인 반경
      for (const it of vis) if (LOGI[it.type].shape === 'crane') { const r = craneReach(it, pl, S.items); it.r = r; const q = w2s(it.p); g.beginPath(); g.arc(q[0], q[1], r * V.s, 0, 7); g.fillStyle = '#f7768e10'; g.fill(); g.strokeStyle = '#f7768e88'; g.setLineDash([8, 6]); g.stroke(); g.setLineDash([]); g.fillStyle = '#f7768e'; g.font = '11px sans-serif'; g.fillText(`반경 ${r / 1000} m`, q[0] + r * V.s * 0.7, q[1] - r * V.s * 0.7); }
      for (const it of vis) { const L = LOGI[it.type]; const on = st.lsel === it.id;
        if (L.shape === 'path') { poly(it.pts, false); g.strokeStyle = L.col + (on ? 'ff' : 'aa'); g.lineWidth = Math.max(3, L.width * V.s); g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke(); poly(it.pts, false); g.strokeStyle = '#0b0e13'; g.lineWidth = 1; g.setLineDash(it.type === 'ppath' ? [3, 3] : [10, 8]); g.stroke(); g.setLineDash([]);
          for (const p of it.pts) { const q = w2s(p); g.fillStyle = on ? '#fff' : L.col; g.fillRect(q[0] - 4, q[1] - 4, 8, 8); }
          const m = it.pts[Math.floor(it.pts.length / 2) - (it.pts.length % 2 ? 0 : 1)]; const q = w2s(m); g.fillStyle = L.col; g.font = '11px sans-serif'; g.fillText(L.name, q[0] + 6, q[1] - 6); continue; }
        poly(rectPts(it)); g.fillStyle = L.col + (on ? '66' : '33'); g.fill(); g.strokeStyle = on ? '#fff' : L.col; g.lineWidth = on ? 2 : 1.2; g.stroke();
        if (L.shape === 'crane') { const q = w2s(it.p); g.strokeStyle = L.col; g.beginPath(); g.moveTo(q[0] - 6, q[1] - 6); g.lineTo(q[0] + 6, q[1] + 6); g.moveTo(q[0] + 6, q[1] - 6); g.lineTo(q[0] - 6, q[1] + 6); g.stroke(); }
        const q = w2s(it.p); g.fillStyle = '#e6e9ef'; g.font = '11px sans-serif'; g.textAlign = 'center'; g.fillText(L.name + (it.onSlab ? ' (1층 슬래브)' : it.roadUse ? ' (도로 점용)' : ''), q[0], q[1] + (L.shape === 'crane' ? -12 : 4)); g.textAlign = 'left'; }
      for (const c of checks) if (c.at) { const q = w2s(c.at); g.strokeStyle = c.lv === '위험' ? '#f7768e' : '#e0af68'; g.lineWidth = 2; g.beginPath(); g.arc(q[0], q[1], 11, 0, 7); g.stroke(); g.fillStyle = g.strokeStyle; g.font = 'bold 12px sans-serif'; g.fillText('!', q[0] - 2, q[1] + 4); }
      // 방위·축척
      g.fillStyle = '#a9b1c1'; g.font = '11px sans-serif'; g.fillText('N ↑', W - 36, 18); const sc = 10000 * V.s; g.fillRect(12, H - 16, sc, 3); g.fillText('10 m', 12, H - 22);
    }
    function resize() { const r = box.getBoundingClientRect(); dpr = devicePixelRatio || 1; const first = !W; W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; if (first && !V.s) fit(); draw(); }
    const ro = new ResizeObserver(resize); ro.observe(box); cleanups.push(() => ro.disconnect());
    const hit = (p) => { const vis = S.items.filter(i => inPhase(i, st.phase)); const tol = 8 / V.s;
      for (const it of vis) if (it.pts) { const k = it.pts.findIndex(q => dist(q, p) < tol); if (k >= 0) return { it, k }; }
      for (const it of [...vis].reverse()) if (!it.pts && pointInPoly(p, rectPts(it))) return { it };
      for (const it of vis) if (it.pts) for (let i = 1; i < it.pts.length; i++) if (closestOnSeg(p, it.pts[i - 1], it.pts[i]).d < tol) return { it, seg: i }; return null; };
    let drag = null;
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; const p = s2w(x, y); const ht = hit(p);
      if (ht) { st.lsel = ht.it.id; if (ht.seg && e.detail >= 2) { ht.it.pts.splice(ht.seg, 0, p); ht.k = ht.seg; } drag = { ht, p0: p, o: ht.it.p ? [...ht.it.p] : null, moved: false }; renderSide(); }
      else drag = { pan: true, x, y, cx: V.cx, cy: V.cy }; draw(); });
    cv.addEventListener('pointermove', (e) => { if (!drag) return; const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
      if (drag.pan) { V.cx = drag.cx - (x - drag.x) / V.s; V.cy = drag.cy + (y - drag.y) / V.s; return draw(); }
      const p = s2w(x, y); const snap = (v) => Math.round(v / 250) * 250; drag.moved = true;
      if (drag.ht.k != null) drag.ht.it.pts[drag.ht.k] = [snap(p[0]), snap(p[1])]; else if (drag.o) drag.ht.it.p = [snap(drag.o[0] + p[0] - drag.p0[0]), snap(drag.o[1] + p[1] - drag.p0[1])]; draw(); });
    cv.addEventListener('pointerup', () => { if (drag && !drag.pan && drag.moved) { save(); renderSide(); } drag = null; });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; const a = s2w(x, y); V.s *= Math.pow(1.0015, -e.deltaY); const b = s2w(x, y); V.cx += a[0] - b[0]; V.cy += a[1] - b[1]; draw(); }, { passive: false });
    function renderSide() {
      side.innerHTML = ''; draw(); const it = S.items.find(i => i.id === st.lsel);
      const nD = checks.filter(c => c.lv === '위험').length, nW = checks.length - nD;
      side.append(h('div', { class: 'card', style: { padding: '10px 12px' } }, h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('div', { class: 't' }, '안전·동선 점검'), h('span', {}, h('span', { class: 'pill ' + (nD ? 'bad' : 'ok') }, `위험 ${nD}`), ' ', h('span', { class: 'pill ' + (nW ? 'warn' : 'ok') }, `주의 ${nW}`))),
        ...(checks.length ? checks.map(c => h('div', { style: { padding: '6px 0', borderTop: '1px solid var(--line)', cursor: c.ids.length ? 'pointer' : 'default' }, onclick: () => { if (c.ids[0]) { st.lsel = c.ids[0]; renderSide(); } } },
          h('div', { style: { fontSize: '12.5px' } }, h('span', { class: 'pill ' + (c.lv === '위험' ? 'bad' : 'warn'), style: { marginRight: '6px' } }, c.lv), c.msg), h('div', { class: 'note', style: { fontSize: '11.5px', marginTop: '2px' } }, '조치: ' + c.fix))) : [h('div', { class: 'note', style: { marginTop: '6px' } }, '이 단계에서 발견된 문제가 없습니다.')])));
      if (S.notes?.length) side.append(h('div', { class: 'card', style: { padding: '10px 12px', marginTop: '8px' } }, h('div', { class: 't' }, '배치 메모'), ...S.notes.map(n => h('div', { class: 'note', style: { marginTop: '4px', fontSize: '12px' } }, n))));
      if (it) { const L = LOGI[it.type]; const c = h('div', { class: 'card', style: { padding: '10px 12px', marginTop: '8px' } }, h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('div', { class: 't' }, L.name), h('button', { class: 'btn sm danger', onclick: () => { S.items = S.items.filter(x => x !== it); st.lsel = null; save(); renderSide(); } }, '삭제')));
        const ph = h('select'); for (const [k, n] of Object.entries(PHASES)) ph.append(h('option', { value: k, selected: it.phase === k }, n)); ph.onchange = () => { it.phase = ph.value; save(); renderSide(); };
        const row = (l, el) => h('div', { class: 'row', style: { gap: '8px', marginTop: '6px' } }, h('span', { class: 'note', style: { width: '70px' } }, l), el);
        c.append(row('사용 단계', ph));
        if (!it.pts) { const num = (k, lab) => { const x = h('input', { type: 'number', step: 500, value: it[k], style: { width: '90px' } }); x.onchange = () => { it[k] = Math.max(500, +x.value); save(); renderSide(); }; return row(lab, h('span', { class: 'row', style: { gap: '4px' } }, x, h('span', { class: 'note' }, 'mm'))); };
          c.append(num('길이', 'w'), num('폭', 'd'), row('방향', h('button', { class: 'btn sm', onclick: () => { it.rot = ((it.rot || 0) + 90) % 180; save(); renderSide(); } }, '90° 회전'))); }
        else c.append(h('div', { class: 'note', style: { marginTop: '6px', fontSize: '11.5px' } }, '점을 끌어 경로를 고치고, 선을 두 번 눌러 점을 추가합니다.'), h('button', { class: 'btn sm', style: { marginTop: '6px' }, disabled: it.pts.length <= 2, onclick: () => { it.pts.splice(-1, 1); save(); renderSide(); } }, '마지막 점 삭제'));
        if (L.shape === 'crane') c.append(row('작업 반경', h('span', {}, `${craneReach(it, pl, S.items) / 1000} m `, h('span', { class: 'note' }, '(자동)'))));
        c.append(h('div', { class: 'note', style: { marginTop: '6px', fontSize: '11.5px' } }, '기준: ' + L.basis)); side.append(c); }
      const add = h('div', { class: 'card', style: { padding: '10px 12px', marginTop: '8px' } }, h('div', { class: 't' }, '추가'), h('div', { class: 'row', style: { gap: '4px', flexWrap: 'wrap', marginTop: '6px' } }, ...Object.entries(LOGI).map(([k, L]) => h('button', { class: 'btn sm', onclick: () => {
        const c = [V.cx, V.cy]; const n = { id: uid('lg'), type: k, phase: st.phase, w: L.w || 10000, d: L.d || 6000, rot: 0, p: c }; if (L.shape === 'path') { delete n.p; n.pts = [[c[0] - 5000, c[1]], [c[0] + 5000, c[1]]]; } S.items.push(n); st.lsel = n.id; save(); renderSide(); } }, L.name))));
      const list = h('div', { class: 'card', style: { padding: '10px 12px', marginTop: '8px' } }, h('div', { class: 't' }, `배치 항목 (${S.items.filter(i => inPhase(i, st.phase)).length})`));
      for (const x of S.items.filter(i => inPhase(i, st.phase))) list.append(h('div', { class: 'row', style: { justifyContent: 'space-between', padding: '4px 0', borderTop: '1px solid var(--line)', cursor: 'pointer', background: x.id === st.lsel ? '#1d3350' : '' }, onclick: () => { st.lsel = x.id; renderSide(); } },
        h('span', { style: { fontSize: '12.5px' } }, h('span', { style: { display: 'inline-block', width: '10px', height: '10px', background: LOGI[x.type].col, marginRight: '6px', borderRadius: '2px' } }), LOGI[x.type].name + (x.onSlab ? ' (1층 슬래브)' : '')), h('span', { class: 'note' }, PHASES[x.phase])));
      side.append(add, list);
    }
    requestAnimationFrame(() => { resize(); renderSide(); });
  }

  async function gen() {
    if (SC.acts.length && !await confirmBox('공정 자동 생성', '기존 활동을 지우고 모델에서 다시 만듭니다.', '생성')) return;
    const v = await dialog({ title: '공정 자동 생성', fields: [{ key: 's', label: '착공일', type: 'date', value: P.bill.periods[0]?.date ? addDays(P.bill.periods[0].date, -30) : SC.start }] }); if (!v) return;
    const pl = planBasis(P, cond()); SC.start = v.s; SC.acts = autoGenerate(P, v.s, pl); SC.method = pl.method; st.tab = 'gantt'; save(); render(); toast(`${METHODS[pl.method].short} 공법 — 활동 ${SC.acts.length}개 생성`, 'ok');
  }
  async function addAct() {
    const v = await dialog({ title: '활동 추가', fields: [{ key: 'n', label: '활동명', value: '' }, { key: 's', label: '시작', type: 'date', value: SC.acts[SC.acts.length - 1]?.end || SC.start }, { key: 'd', label: '기간(일)', type: 'number', value: 7 }] }); if (!v?.n) return;
    const a = { id: uid('a'), name: v.n, start: v.s, dur: v.d || 1, pred: [], filter: {}, color: '#a78bfa' }; SC.acts.push(a); st.sel = a.id; save(); render();
  }
  function fillPlan() {
    if (!P.bill.periods.length) return toast('기성 회차가 없습니다', 'err');
    const rows = takeoff(P); for (const p of P.bill.periods) if (p.date) p.plan = +plannedPct(P, p.date, rows).toFixed(2);
    save(); toast('회차별 계획 기성률을 공정표 기준으로 입력했습니다', 'ok'); render();
  }
  render();
  return { unmount() { while (cleanups.length) cleanups.pop()(); } };
}

// ---------- 공정표 가져오기 ----------
const dstr = (v) => { if (v instanceof Date) return toS(v.getTime() - v.getTimezoneOffset() * 60000); if (typeof v === 'number') return toS(Math.round((v - 25569) * DAY)); const m = String(v).match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null; };
export function parseMSP(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml'); const tasks = [...doc.getElementsByTagName('Task')];
  const T = (t, n) => t.getElementsByTagName(n)[0]?.textContent?.trim() || '';
  const out = [];
  for (const t of tasks) {
    if (T(t, 'Summary') === '1' || !T(t, 'Name') || !T(t, 'Start')) continue;
    const start = dstr(T(t, 'Start')), fin = dstr(T(t, 'Finish')); const m = T(t, 'Duration').match(/PT(\d+)H(\d+)M/);
    const dur = fin ? Math.max(1, daysBetween(start, fin) + 1) : m ? Math.max(1, Math.round((+m[1] + m[2] / 60) / 8)) : 1;
    out.push({ id: T(t, 'UID'), name: T(t, 'Name'), start, dur, pred: [...t.getElementsByTagName('PredecessorLink')].map(p => T(p, 'PredecessorUID')) });
  }
  return out;
}
export function parseTable(aoa) {
  const hi = aoa.findIndex(r => r.some(c => /작업|활동|공종명|task|name/i.test(String(c))) && r.some(c => /시작|착수|start/i.test(String(c)))); if (hi < 0) return [];
  const H = aoa[hi].map(c => String(c).trim()); const col = (re) => H.findIndex(c => re.test(c));
  const cN = col(/작업|활동|공종명|task|name/i), cS = col(/시작|착수|start/i), cE = col(/종료|완료|finish|end/i), cD = col(/기간|일수|duration/i), cP = col(/선행|pred/i), cI = col(/^(id|no|번호|코드|uid)$/i);
  const out = [];
  aoa.slice(hi + 1).forEach((r, i) => {
    const name = String(r[cN] ?? '').trim(), start = dstr(r[cS]); if (!name || !start) return;
    const end = cE >= 0 ? dstr(r[cE]) : null; const d = cD >= 0 ? parseFloat(String(r[cD]).replace(/[^\d.]/g, '')) : NaN;
    out.push({ id: cI >= 0 ? String(r[cI]).trim() : String(i + 1), name, start, dur: Math.max(1, end ? daysBetween(start, end) + 1 : (d || 1)), pred: cP >= 0 ? String(r[cP]).split(/[,;\s]+/).map(x => x.replace(/(FS|SS|FF|SF).*$/i, '').trim()).filter(Boolean) : [] });
  });
  return out;
}
const KW = { footing: /기초|footing/i, column: /기둥|column/i, beam: /보\b|보\s|보$|거더|beam/i, slab: /슬래브|slab|바닥판/i, wall: /벽|조적|wall/i, duct: /덕트|duct|공조/i, pipe: /배관|급수|배수|소화|pipe/i, tray: /트레이|전기|tray|케이블/i };
export function guessFilter(P, name) {
  const f = {}; const n = name.replace(/\s+/g, ' ');
  for (const L of P.levels) { const num = (L.name.match(/(B?\d+)/) || [])[1]; if (n.includes(L.name) || (num && new RegExp(`(^|[^\\d])${num}\\s*(층|F)`, 'i').test(n))) { f.level = L.id; break; } }
  for (const [k, re] of Object.entries(KW)) if (re.test(n)) { f.kind = k; break; }
  if (/철골/.test(n)) f.kind ||= 'column';
  return (f.level || f.kind) ? f : {};
}
