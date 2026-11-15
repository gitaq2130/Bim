// 빌더 CAD — AutoCAD식 2D 작도 + 객체(BIM) 작도
import { h, $, toast, dialog, confirmBox, pickFile, readText, saveFile, getSample, table, loadScript } from '../js/ui.js';
import { uid, deep, dist, sub, add, mul, norm, perp, dot, angOf, rot, mid, bboxOf, closestOnSeg, polyArea, polyPerim, fmt, fmt0, clamp, esc } from '../js/util.js';
import { KINDS, MATS, SECTIONS, DISC, levelOf, elOutline, elName, elBoxes, boxCorners, cumProgress, isRefElement } from '../js/model.js';
import { parseDXF, toDXF, dimGeom } from '../js/dxf.js';
import * as G from './cad-geom.js';
import { pdfDoc, pdfFromJpeg, pdfPagesFromJpeg } from './pdf.js';
import { IC } from '../js/icons.js';
import { wandRegion } from '../js/wand.js';
import { FURN, FURN_CATS, furnPlan, furnXf } from '../js/furn.js';
import { sysColor as sysColorC } from '../js/mep.js';
import { LUX_BY_USE } from './interior.js';
import { buildSection, elevationLines } from '../js/section.js';
import { LIBRARY, expandInsert, blockNames } from '../js/blocks.js';
import { saveRevision, revisions, diffContent, loadRev, createRev, restoreRev, clusterBoxes, nextRev, revName } from '../js/rev.js';
import { FIELDS as RB_FIELDS, specKey, defaultSpec, bbs, parseN, parseS } from '../js/rebar.js';

const DEF_DEFAULTS = {
  wall: { t: 200, mat: 'RC', h: null, z0: 0 }, column: { w: 600, d: 600, rot: 0, mat: 'RC', sec: 'H-300x300x10x15' }, beam: { w: 400, d: 700, mat: 'RC', sec: 'H-400x200x8x13', dz: 0 },
  slab: { t: 200, mat: 'RC', dz: 0 }, footing: { w: 2400, d: 2400, t: 800, mat: 'RC' }, door: { w: 900, h: 2100, sill: 0 }, window: { w: 1500, h: 1500, sill: 900 },
  duct: { w: 800, hh: 400, z: 3000, sys: '급기' }, pipe: { w: 150, hh: 150, z: 3200, sys: '급수' }, tray: { w: 600, hh: 100, z: 2900, sys: '동력' }, text: { h: 300 }, grid: { next: '1' },
};
// 다각형 도심(면적 가중) — 실 라벨 위치
function polyCenter(pts) { let A = 0, x = 0, y = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const f = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]; A += f; x += (pts[j][0] + pts[i][0]) * f; y += (pts[j][1] + pts[i][1]) * f; } if (Math.abs(A) < 1e-6) return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]; return [x / (3 * A), y / (3 * A)]; }
// 스프링클러 헤드 유형 → K-factor(표준형 기준) — 설계값은 툴이 정함
const SPK_TYPES = { pendent: ['하향형', 80], upright: ['상향형', 80], sidewall: ['측벽형', 80], concealed: ['은폐형', 80] };
const EL_STYLE = {
  wall: { RC: ['#4b5059', '#9aa3ad'], CMU: ['#6b5138', '#c9a27e'], DRY: ['#4a4840', '#cfc8b6'], GLASS: ['#24506a', '#8fd3ff'], STEEL: ['#3a4452', '#8fa3ba'] },
  column: { RC: ['#6a717c', '#d6dbe1'], STEEL: ['#3f5168', '#a9c1dc'] },
};
const ALIASES = {
  L: 'LINE', LINE: 'LINE', PL: 'PLINE', PLINE: 'PLINE', REC: 'RECT', RECTANG: 'RECT', RECT: 'RECT', C: 'CIRCLE', CIRCLE: 'CIRCLE', A: 'ARC', ARC: 'ARC',
  T: 'TEXT', DT: 'TEXT', TEXT: 'TEXT', MT: 'TEXT', DLI: 'DIM', DAL: 'DIM', DIM: 'DIM', DI: 'DIST', DIST: 'DIST', AA: 'AREA', AREA: 'AREA',
  M: 'MOVE', MOVE: 'MOVE', CO: 'COPY', CP: 'COPY', COPY: 'COPY', RO: 'ROTATE', ROTATE: 'ROTATE', MI: 'MIRROR', MIRROR: 'MIRROR', SC: 'SCALE', SCALE: 'SCALE',
  O: 'OFFSET', OFFSET: 'OFFSET', TR: 'TRIM', TRIM: 'TRIM', EX: 'EXTEND', EXTEND: 'EXTEND', F: 'FILLET', FILLET: 'FILLET', E: 'ERASE', ERASE: 'ERASE', X: 'EXPLODE', EXPLODE: 'EXPLODE',
  Z: 'ZOOM', ZOOM: 'ZOOM', ZE: 'ZOOMEXT', U: 'UNDO', UNDO: 'UNDO', REDO: 'REDO', BASE: 'BASE', LA: 'LAYER', LAYER: 'LAYER', ID: 'IDPT',
  WA: 'WALL', WALL: 'WALL', COL: 'COLUMN', COLUMN: 'COLUMN', BM: 'BEAM', BEAM: 'BEAM', SL: 'SLAB', SLAB: 'SLAB', FT: 'FOOTING', FOOTING: 'FOOTING',
  DR: 'DOOR', DOOR: 'DOOR', WN: 'WINDOW', WINDOW: 'WINDOW', DU: 'DUCT', DUCT: 'DUCT', PI: 'PIPE', PIPE: 'PIPE', CT: 'TRAY', TRAY: 'TRAY', GL: 'GRID', GRID: 'GRID',
  CV: 'CONVERT', CONVERT: 'CONVERT', AR: 'ARRAY', ARRAY: 'ARRAY', SELECTALL: 'SELALL',
  H: 'HATCH', BH: 'HATCH', HATCH: 'HATCH', B: 'BLOCK', BLOCK: 'BLOCK', I: 'INSERT', INSERT: 'INSERT', LE: 'LEADER', LEADER: 'LEADER', QLEADER: 'LEADER',
  DCO: 'DIMCONT', DIMCONTINUE: 'DIMCONT', DRA: 'DIMRAD', DIMRADIUS: 'DIMRAD', DAN: 'DIMANG', DIMANGULAR: 'DIMANG', S: 'STRETCH', STRETCH: 'STRETCH',
  BR: 'BREAK', BREAK: 'BREAK', J: 'JOIN', JOIN: 'JOIN', MA: 'MATCHPROP', MATCHPROP: 'MATCHPROP', QSELECT: 'QSELECT', QS: 'QSELECT', ED: 'TEXTEDIT', DDEDIT: 'TEXTEDIT', PASTECLIP: 'PASTECLIP', SEC: 'SECTIONCUT', SECTION: 'SECTIONCUT', ELEV: 'ELEV4', ELEVATION: 'ELEV4', FU: 'FURNPICK', FURN: 'FURNPICK', UCAL: 'UCAL', UMOVE: 'UMOVE', TO: 'TAKEOFFMENU', TAKEOFFMENU: 'TAKEOFFMENU', PLOT: 'PLOTDLG', LAYOUT: 'LAYOUTTOG', OS: 'OSNAPSET', OSNAP: 'OSNAPSET', REVCLOUD: 'REVCLOUD', RC: 'REVCLOUD', REV: 'REVISION', REVISION: 'REVISION', PROG: 'PROGMARK', PM: 'PROGMARK',
};
const CMD_NAMES = { LINE: '선', PLINE: '폴리선', RECT: '사각형', CIRCLE: '원', ARC: '호', TEXT: '문자', DIM: '치수', DIST: '거리 측정', AREA: '면적 측정', MOVE: '이동', COPY: '복사', ROTATE: '회전', MIRROR: '대칭', SCALE: '축척', OFFSET: '간격띄우기', TRIM: '자르기', EXTEND: '연장', FILLET: '모깎기(R0)', ERASE: '지우기', EXPLODE: '분해', WALL: '벽체', COLUMN: '기둥', BEAM: '보', SLAB: '슬래브', FOOTING: '기초', DOOR: '문', WINDOW: '창', DUCT: '덕트', PIPE: '배관', TRAY: '케이블트레이', GRID: '그리드', CONVERT: '객체 변환', ARRAY: '배열', BASE: '기준점', IDPT: '좌표 확인', GRIP: '그립 편집', HATCH: '해치', BLOCK: '블록 정의', INSERT: '블록 삽입', LEADER: '지시선', DIMCONT: '연속 치수', DIMRAD: '반지름 치수', DIMANG: '각도 치수', STRETCH: '신축', BREAK: '끊기', JOIN: '결합', MATCHPROP: '특성 일치', QSELECT: '빠른 선택', TEXTEDIT: '문자 편집', REVISION: '리비전', PROGMARK: '기성 영역 마킹', REVCLOUD: '리비전 구름', SECTIONCUT: '단면 생성', ELEV4: '입면도 4면 생성', FURNPLACE: '가구·조경 배치', FURNPICK: '가구·조경 배치', WAND: '클릭 영역 산출', PASTECLIP: '붙여넣기', UCAL: 'PDF 축척 보정', UMOVE: 'PDF 이동', TAKEOFF: '물량 산출', TAKEOFFMENU: '물량 산출', PLOTDLG: '플롯', LAYOUTTOG: '배치', OSNAPSET: '객체 스냅 설정' };

export function mount(root, ctx) {
  const P = ctx.P, S = ctx.state;
  P.view ||= {}; P.view.defaults = Object.assign(deep(DEF_DEFAULTS), P.view.defaults || {});
  for (const k of Object.keys(DEF_DEFAULTS)) P.view.defaults[k] = Object.assign(deep(DEF_DEFAULTS[k]), P.view.defaults[k] || {});
  const D = P.view.defaults;
  P.layers ||= []; P.blocks ||= {}; G.setBlocks(P.blocks); D.fillet ||= { r: 0 }; D.hatch ||= { pat: 'ANSI31', sc: 1 };
  let sid = (S.sheet && P.sheets.some(s => s.id === S.sheet)) ? S.sheet : P.sheets[0].id;
  let under = null; // 참조 도면
  const V = { cx: 12000, cy: 8000, s: 0.04 };
  const sel = new Set(); let hover = null; let cur = [0, 0], curRaw = [0, 0]; let snap = null;
  const opt = { dyn: P.view.dyn ?? true, osnap: true, ortho: false, grid: true, box: false, polar: true, polarInc: 15, lwt: false, snaps: Object.assign({ end: true, mid: true, cen: true, int: true, per: true, nea: true, qua: true, ins: true }, P.view.snaps || {}) }; let space = 'model'; let clip = null; let cmp = null; let lastDim = null; let progView = S.progView ?? null;
  let cmd = null, lastPt = null, lastCmd = null; let curLayer = '0'; let polarHit = null;
  const undo = {}, redo = {};
  let W = 0, H = 0, dpr = 1, dirty = true, raf = 0;
  const sheet = () => P.sheets.find(s => s.id === sid);
  const C = () => P.content[sid];
  const lv = () => levelOf(P, sheet()?.level);
  const hostOf = (c) => (id) => c.els.find(e => e.id === id);

  // ---------- DOM ----------
  const cv = h('canvas', { style: { display: 'block', width: '100%', height: '100%', touchAction: 'none', cursor: 'none' } });
  const tip = h('div', { style: { position: 'absolute', pointerEvents: 'none', background: '#000c', border: '1px solid #364152', padding: '2px 6px', borderRadius: '4px', fontSize: '11.5px', fontFamily: 'var(--mono)', display: 'none', whiteSpace: 'nowrap' } });
  const wrapC = h('div', { style: { position: 'relative', flex: 1, minWidth: 0, minHeight: 0, background: '#0b0e13' } }, cv, tip);
  const hist = h('div', { class: 'mono', style: { maxHeight: '64px', overflow: 'auto', fontSize: '11.5px', color: 'var(--fg3)', padding: '2px 8px' } });
  const promptEl = h('span', { class: 'mono', style: { color: 'var(--acc)', fontSize: '12px', whiteSpace: 'nowrap' } }, '명령:');
  const inp = h('input', { class: 'mono', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', style: { flex: 1, minWidth: '80px', background: 'transparent', border: 0, padding: '6px 4px', fontSize: '13px' }, placeholder: '명령 또는 좌표 입력 (예: L, WA, 0,0, @3000<90)' });
  const statusEl = h('span', { class: 'mono', style: { fontSize: '11.5px', color: 'var(--fg3)', whiteSpace: 'nowrap', marginRight: 'auto', paddingLeft: '6px' } });
  const acBox = h('div', { class: 'ac', style: { display: 'none' } });
  const stbar = h('div', { class: 'stbar' });
  const cmdBar = h('div', { style: { borderTop: '1px solid var(--line)', background: 'var(--bg2)', flex: 'none' } }, hist,
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '0 8px', position: 'relative' } }, acBox, promptEl, inp,
      h('button', { class: 'btn sm show-m', onclick: () => submit('') }, '↵'), h('button', { class: 'btn sm show-m', onclick: () => cancel() }, 'Esc')),
    stbar);
  const side = h('div', { class: 'side' });
  const tb = h('div', { class: 'ribbon' });
  const pb = h('div', { class: 'side l', style: { width: '220px' } });
  const body = h('div', { style: { display: 'flex', flex: 1, minHeight: 0, position: 'relative' } }, pb, wrapC, side);
  root.append(h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } }, tb, body, cmdBar));

  const log = (s, cls) => { hist.append(h('div', { style: cls ? { color: cls } : null }, s)); while (hist.childNodes.length > 80) hist.firstChild.remove(); hist.scrollTop = 1e9; };
  const setPrompt = (s) => { promptEl.textContent = s; };

  // ---------- 툴바 ----------
  // ---------- 리본 ----------
  const CMD_ICON = (n) => IC[n] || IC.LINE;
  function buildToolbar() {
    tb.innerHTML = '';
    const tabs = [['home', '홈'], ['annot', '주석'], ['bim', 'BIM 객체'], ['mep', '설비'], ['modify', '수정'], ['measure', '측정·기성'], ['view', '보기'], ['collab', '리비전·협업'], ['output', '출력']];
    const cur = P.view.rbTab || 'home';
    const tabRow = h('div', { class: 'rb-tabs' });
    for (const [k, l] of tabs) tabRow.append(h('button', { class: 'rb-tab' + (cur === k ? ' on' : ''), onclick: () => { P.view.rbTab = k; buildToolbar(); } }, l));
    const sheetSel = h('select', { title: '현재 도면' }); for (const s of P.sheets) sheetSel.append(h('option', { value: s.id, selected: s.id === sid }, `[${s.disc}] ${s.name}`)); sheetSel.onchange = () => switchSheet(sheetSel.value);
    const underSel = h('select', { title: '참조 도면(겹쳐 보기)' }, h('option', { value: '' }, '참조 없음')); for (const s of P.sheets) if (s.id !== sid) underSel.append(h('option', { value: s.id, selected: s.id === under }, `참조: [${s.disc}] ${s.name}`)); underSel.onchange = () => { under = underSel.value || null; dirty = true; };
    tabRow.append(h('span', { class: 'fill' }), sheetSel, underSel, h('button', { class: 'rb-sm show-m', onclick: () => side.classList.toggle('open') }, '속성'));
    const body = h('div', { class: 'rb-body' });
    const big = (cmdName, label, fn, on) => h('button', { class: 'rb-big' + (on ? ' on' : ''), title: `${label} (${Object.keys(ALIASES).filter(k => ALIASES[k] === cmdName && k.length <= 4).join(', ') || cmdName})`, onclick: fn || (() => startCmd(cmdName)), html: CMD_ICON(cmdName) + `<span>${label}</span>` });
    const sm = (cmdName, label, fn, on) => h('button', { class: 'rb-sm' + (on ? ' on' : ''), title: label, onclick: fn || (() => startCmd(cmdName)), html: CMD_ICON(cmdName) + `<span>${label}</span>` });
    const col = (...xs) => h('div', { class: 'rb-col' }, ...xs);
    const group = (title, ...items) => h('div', { class: 'rb-group' }, h('div', { class: 'rb-items' }, ...items), h('div', { class: 'rb-title' }, title));
    const layerBox = () => {
      const ls = h('select', { style: { fontSize: '12px', maxWidth: '150px' }, title: '현재 레이어' }); for (const n of allLayers()) ls.append(h('option', { value: n, selected: n === curLayer }, n)); ls.onchange = () => { curLayer = ls.value; renderSide(); dirty = true; };
      return col(h('div', { class: 'row', style: { gap: '4px' } }, h('span', { style: { width: '12px', height: '12px', borderRadius: '2px', background: layerColor(curLayer), display: 'inline-block' } }), ls),
        h('div', { class: 'row', style: { gap: '2px' } }, sm('LAYER', '레이어 관리자', layerManager), sm('LAYER', '선택 → 현재', () => { const e = C().ents.find(x => sel.has(x.id)); if (e) { curLayer = e.layer || '0'; buildToolbar(); } })));
    };
    const progSel = () => { const ps = h('select', { title: '기성 진척 표시', style: { fontSize: '12px' } }, h('option', { value: '' }, '기성 표시 끔')); P.bill.periods.forEach((p, i) => ps.append(h('option', { value: i, selected: progView === i }, `기성: ${p.name}`))); ps.onchange = () => { progView = ps.value === '' ? null : +ps.value; S.progView = progView; dirty = true; }; return ps; };
    const panels = {
      home: [group('그리기', big('LINE', '선'), big('PLINE', '폴리선'), col(sm('CIRCLE', '원'), sm('ARC', '호'), sm('RECT', '사각형')), col(sm('HATCH', '해치'), sm('TEXT', '문자'), sm('INSERT', '블록 삽입'))),
        group('수정', col(sm('MOVE', '이동'), sm('COPY', '복사'), sm('ROTATE', '회전')), col(sm('MIRROR', '대칭'), sm('OFFSET', '간격띄우기'), sm('TRIM', '자르기')), col(sm('EXTEND', '연장'), sm('FILLET', '모깎기'), sm('ERASE', '지우기'))),
        group('주석', big('DIM', '치수'), col(sm('DIMCONT', '연속 치수'), sm('LEADER', '지시선'), sm('TEXT', '문자'))),
        group('레이어', layerBox()),
        group('객체', big('WALL', '벽'), big('COLUMN', '기둥'), col(sm('BEAM', '보'), sm('SLAB', '슬래브'), sm('DOOR', '문'))),
        group('유틸리티', col(sm('DIST', '거리'), sm('AREA', '면적'), sm('QSELECT', '빠른 선택')), col(sm('UNDO', '실행 취소', doUndo), sm('REDO', '다시 실행', doRedo), sm('ZOOMEXT', '전체 보기', zoomExt)))],
      annot: [group('문자', big('TEXT', '단일 행 문자'), big('LEADER', '지시선')), group('치수', big('DIM', '선형·정렬'), big('DIMCONT', '연속'), big('DIMRAD', '반지름'), big('DIMANG', '각도')), group('표시', big('HATCH', '해치'), big('REVCLOUD', '리비전 구름'), big('GRID', '그리드')), group('블록', big('INSERT', '삽입'), big('BLOCK', '정의'))],
      bim: [group('구조', big('COLUMN', '기둥'), big('BEAM', '보'), big('SLAB', '슬래브'), big('FOOTING', '기초'), big('WALL', 'RC벽')), group('건축', big('WALL', '벽체'), big('DOOR', '문'), big('WINDOW', '창')), group('가구·조경', big('FURN', '가구 배치', () => startCmd('FURNPICK'))), group('변환·AI', big('CONVERT', '선→객체'), big('AI', 'AI 작도', aiDraw)), group('기준', big('GRID', '그리드'), big('BASE', '3D 기준점'))],
      mep: [group('기계·배관·전기', big('DUCT', '덕트'), big('PIPE', '배관'), big('TRAY', '트레이')), group('정보', col(h('span', { class: 'note', style: { maxWidth: '260px', whiteSpace: 'normal' } }, '명령 중 Z숫자로 설치 높이, 600x400처럼 크기 입력. 높이는 층 바닥 기준 중심 높이입니다.')))],
      modify: [group('이동·복제', big('MOVE', '이동'), big('COPY', '복사'), big('ROTATE', '회전'), big('MIRROR', '대칭'), big('SCALE', '축척'), big('ARRAY', '배열')),
        group('형상', big('OFFSET', '간격띄우기'), big('TRIM', '자르기'), big('EXTEND', '연장'), big('FILLET', '모깎기'), col(sm('STRETCH', '신축'), sm('BREAK', '끊기'), sm('JOIN', '결합')), col(sm('EXPLODE', '분해'), sm('MATCHPROP', '특성 일치'), sm('ERASE', '지우기'))),
        group('선택', big('QSELECT', '빠른 선택'), big('MATCHPROP', '특성 일치'))],
      measure: [group('측정', big('DIST', '거리'), big('AREA', '면적'), big('BASE', '좌표', () => startCmd('IDPT'))), group('PDF 물량', big('UNDERLAY', 'PDF 도면', pdfUnderlay), big('TAKEOFF', '물량 산출', () => takeoffMenu())), group('기성', big('PROGMARK', '영역 마킹'), col(progSel()))],
      view: [group('단면·입면', big('SECTION', '단면 생성', () => startCmd('SECTIONCUT')), big('ELEV', '입면 4면', makeElevations), ...(sheet().kind === 'section' ? [big('REV', '다시 생성', () => { snapshot(); const r = fillSection(sheet()); ctx.touch(sid); dirty = true; log(`모델 기준으로 다시 생성: 절단 ${r.nCut} · 투영 ${r.nBeyond}`); })] : [])), group('창', big('BROWSER', '프로젝트 탐색기', () => { pbOpen = !pbOpen; P.view.pb = pbOpen; renderPB(); buildToolbar(); }, pbOpen), big('PROPS', '속성 팔레트', () => side.classList.toggle('open'))), group('화면', big('ZOOMEXT', '전체 보기', zoomExt), big('VIEW3D', '3D 보기', () => ctx.go('view3d'))), group('표시', col(sm('LAYER', '레이어 관리자', layerManager), sm('UNDERLAY', 'PDF 언더레이', pdfUnderlay), sm('BASE', '객체 스냅 설정', snapSettings))), group('기준', big('BASE', '3D 기준점'))],
      collab: [group('리비전', big('REVISION', cmp ? '비교 끄기' : 'Rev 관리', null, !!cmp), big('REVCLOUD', '리비전 구름'), big('VIEW3D', '3D Rev 비교', () => ctx.go('view3d'))), group('이슈', big('PROGMARK', '선택→이슈', issueFromSel))],
      output: [group('플롯', big('PLOT', '플롯(PDF)', () => plotDialog()), big('PLOT', '일괄 플롯', () => batchPlot()), big('PDF', space === 'layout' ? '모형으로' : '배치 보기', () => setSpace(space === 'layout' ? 'model' : 'layout'), space === 'layout')), group('파일', big('DXFIN', 'DXF 가져오기', importDXF), big('DXFOUT', 'DXF 내보내기', () => saveFile(sheet().name.replace(/[\\/:*?"<>|]/g, '_') + '.dxf', toDXF(P, [sid]))), col(sm('DXFOUT', '같은 층 합본 DXF', () => saveFile(`${P.name}_${lv().name}_합본.dxf`.replace(/[\\/:*?"<>|]/g, '_'), toDXF(P, P.sheets.filter(s => s.level === sheet().level).map(s => s.id)))), sm('PDF', 'PNG 이미지', exportPNG), sm('PDF', '벡터 PDF(영문)', exportPDF)))],
    };
    for (const p of panels[cur] || panels.home) body.append(p);
    tb.append(tabRow, body);
    renderStatus();
  }
  function renderStatus() {
    stbar.innerHTML = '';
    stbar.append(h('span', { class: 'st-tab' + (space === 'model' ? ' on' : ''), onclick: () => setSpace('model') }, '모형'), h('span', { class: 'st-tab' + (space === 'layout' ? ' on' : ''), onclick: () => setSpace('layout') }, '배치'), statusEl);
    const T = (k, label, title) => h('button', { class: 'st-t' + (opt[k] ? ' on' : ''), title, onclick: () => toggle(k) }, label);
    stbar.append(T('dyn', 'DYN', 'F12 동적 입력 — 커서 옆에 명령 안내·입력값 표시'), T('grid', '격자', 'F7'), T('osnap', '객체스냅', 'F3 — 오른쪽 ▾에서 모드 선택'), h('button', { class: 'st-t', title: '객체 스냅 모드', onclick: snapSettings }, '▾'), T('ortho', '직교', 'F8'), T('polar', `극좌표 ${opt.polarInc}°`, 'F10'), h('button', { class: 'st-t', onclick: async () => { const v = await dialog({ title: '극좌표 추적 각도', fields: [{ key: 'a', label: '증분 각도', type: 'select', options: [5, 10, 15, 22.5, 30, 45, 90].map(x => [x, x + '°']), value: opt.polarInc }] }); if (v) { opt.polarInc = +v.a; renderStatus(); } } }, '▾'), T('lwt', '선굵기', '선굵기 표시'), T('box', '범위선택', '터치 드래그로 범위 선택'));
  }
  const toggle = (k) => { opt[k] = !opt[k]; if (k === 'dyn') P.view.dyn = opt.dyn; if (k === 'ortho' && opt.ortho) opt.polar = false; if (k === 'polar' && opt.polar) opt.ortho = false; log(`${{ dyn: '동적 입력', osnap: '객체 스냅', ortho: '직교', grid: '격자', box: '범위선택', polar: '극좌표 추적', lwt: '선굵기 표시' }[k]} ${opt[k] ? '켬' : '끔'}`); renderStatus(); dirty = true; };

  // ---------- 좌표 변환 ----------
  const w2s = (p) => [(p[0] - V.cx) * V.s + (V.ox ?? W / 2), (V.oy ?? H / 2) - (p[1] - V.cy) * V.s];
  const s2w = (x, y) => [(x - (V.ox ?? W / 2)) / V.s + V.cx, ((V.oy ?? H / 2) - y) / V.s + V.cy];
  function resize() { const r = wrapC.getBoundingClientRect(); dpr = window.devicePixelRatio || 1; W = r.width; H = r.height; cv.width = Math.max(1, W * dpr); cv.height = Math.max(1, H * dpr); dirty = true; }
  const ro = new ResizeObserver(resize); ro.observe(wrapC);

  function sheetBBox(ids) {
    const c = C(); const pts = [];
    for (const e of c.ents) { if (ids && !ids.has(e.id)) continue; const b = G.entBBox(e); if (b) pts.push([b.x0, b.y0], [b.x1, b.y1]); }
    for (const e of c.els) { if (ids && !ids.has(e.id)) continue; const b = G.elBBox(e, hostOf(c)); if (b) pts.push([b.x0, b.y0], [b.x1, b.y1]); }
    return pts.length ? bboxOf(pts) : null;
  }
  function zoomTo(b, pad = 0.12) { if (!b || !W) return; const w = Math.max(b.x1 - b.x0, 1000), hh = Math.max(b.y1 - b.y0, 1000); V.cx = (b.x0 + b.x1) / 2; V.cy = (b.y0 + b.y1) / 2; V.s = Math.min(W / (w * (1 + pad * 2)), H / (hh * (1 + pad * 2))); dirty = true; }
  function zoomExt() { zoomTo(sheetBBox() || { x0: -2000, y0: -2000, x1: 20000, y1: 12000 }); }

  // ---------- 렌더 ----------
  let g = cv.getContext('2d'); let BG = '#0b0e13';
  const layerColor = (name) => P.layers.find(l => l.name === name)?.color || (name === 'GRID' ? '#5d6b80' : name === 'DIM' ? '#7dcfff' : '#d0d5dd');
  const layerOf = (name) => P.layers.find(l => l.name === name);
  const layerVisible = (name) => { const L = layerOf(name); return L?.visible !== false && !L?.frozen; };
  const layerLocked = (name) => !!layerOf(name)?.locked;
  const LT = { CONTINUOUS: [], DASHED: [10, 6], HIDDEN: [5, 4], CENTER: [18, 4, 4, 4], PHANTOM: [20, 4, 4, 4, 4, 4], DOT: [2, 4] };
  const lwPx = (name) => opt.lwt ? Math.max(1, (layerOf(name)?.lw ?? 0.25) * 4) : 1;
  function path(pts, close) { g.beginPath(); pts.forEach((p, i) => { const q = w2s(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); if (close) g.closePath(); }
  function drawText(p, hgt, s, rotDeg, color, align = 'left', base = 'alphabetic') {
    const px = hgt * V.s; if (px < 2.5) return; const q = w2s(p);
    g.save(); g.translate(q[0], q[1]); g.rotate(-(rotDeg || 0) * Math.PI / 180); g.fillStyle = color; g.font = `${px}px "Noto Sans KR", sans-serif`; g.textAlign = align; g.textBaseline = base; g.fillText(s, 0, 0); g.restore();
  }
  function drawEnt(e, color, lw = 1, ghost = false) {
    g.strokeStyle = color; g.lineWidth = e.lw && e.lw >= 0.5 && lw < 2 ? lw * 2 : lw; g.setLineDash(!ghost && e.t !== 'grid' ? (LT[e.lt || layerOf(e.layer)?.lt] || []) : []);
    switch (e.t) {
      case 'line': path([e.a, e.b]); g.stroke(); break;
      case 'pline': path(e.pts, e.closed); g.stroke(); break;
      case 'circle': { const q = w2s(e.c); g.beginPath(); g.arc(q[0], q[1], e.r * V.s, 0, Math.PI * 2); g.stroke(); break; }
      case 'arc': { const q = w2s(e.c); g.beginPath(); g.arc(q[0], q[1], e.r * V.s, -e.a0, -e.a1, true); g.stroke(); break; }
      case 'text': drawText(e.p, e.h, e.s, e.rot, color); break;
      case 'grid': {
        g.setLineDash([12, 4, 2, 4]); path([e.a, e.b]); g.stroke(); g.setLineDash([]);
        const r = 450, d = norm(sub(e.a, e.b)); const c = add(e.a, mul(d, r)); const q = w2s(c);
        g.beginPath(); g.arc(q[0], q[1], r * V.s, 0, Math.PI * 2); g.stroke();
        if (e.label) drawText(c, 420, e.label, 0, ghost ? color : '#cfd6e2', 'center', 'middle');
        break;
      }
      case 'dim': {
        const d = dimGeom(e); path([d.p1, d.p2]); g.stroke(); path([e.a, d.p1]); g.stroke(); path([e.b, d.p2]); g.stroke();
        for (const p of [d.p1, d.p2]) { const q = w2s(p); g.beginPath(); g.moveTo(q[0] - 4, q[1] + 4); g.lineTo(q[0] + 4, q[1] - 4); g.stroke(); }
        const txt = e.ovr || fmt0(d.len); drawText(d.tp, D.text.h * 0.85, txt, d.ang * 180 / Math.PI, e.ovr && !ghost ? '#ffb86b' : color, 'center', 'bottom');
        break;
      }
      case 'hatch': {
        if (e.fill && !ghost) { path(e.pts, true); g.fillStyle = e.fill === 'bg' ? BG : e.fill; g.fill(); }
        if (e.pat === 'SOLID') { if (!e.fill) { path(e.pts, true); g.fillStyle = color + (ghost ? '22' : '66'); g.fill(); } }
        else { g.lineWidth = Math.max(0.5, lw * 0.6); g.beginPath(); for (const [a, b] of G.hatchLines(e, 1500)) { const p = w2s(a), q = w2s(b); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); } g.stroke(); g.lineWidth = lw; }
        path(e.pts, true); g.stroke(); break;
      }
      case 'insert': for (const c of expandInsert(e, P.blocks)) drawEnt(c, color, lw, ghost); break;
      case 'cloud': {
        const col = ghost ? color : '#ff9f43'; g.strokeStyle = col; const ccw = polyArea(e.pts) > 0; const arc = Math.max(300, (e.arc || 600));
        g.beginPath();
        for (let i = 0; i < e.pts.length; i++) { const a = e.pts[i], b = e.pts[(i + 1) % e.pts.length]; const L = dist(a, b), n = Math.max(1, Math.round(L / arc)); for (let k = 0; k < n; k++) { const p0 = G.lerpPt(a, b, k / n), p1 = G.lerpPt(a, b, (k + 1) / n); const c = w2s(mid(p0, p1)), r = dist(p0, p1) / 2 * V.s; const s0 = w2s(p0), s1 = w2s(p1); const a0 = Math.atan2(s0[1] - c[1], s0[0] - c[0]), a1 = Math.atan2(s1[1] - c[1], s1[0] - c[0]); g.moveTo(s0[0], s0[1]); g.arc(c[0], c[1], r, a0, a1, !ccw); } }
        g.stroke();
        if (e.label) { const p = e.pts[2] || e.pts[0]; const t = 450; const tri = [[p[0], p[1] + t * 0.6], [p[0] - t * 0.6, p[1] - t * 0.45], [p[0] + t * 0.6, p[1] - t * 0.45]]; path(tri, true); g.fillStyle = BG; g.fill(); g.stroke(); drawText([p[0], p[1] - t * 0.05], 260, e.label, 0, col, 'center', 'middle'); }
        break;
      }
      case 'leader': {
        path(e.pts, false); g.stroke(); const a = w2s(e.pts[0]), b = w2s(e.pts[1] || e.pts[0]); const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(a[0] + 10 * Math.cos(ang + 0.35), a[1] + 10 * Math.sin(ang + 0.35)); g.lineTo(a[0] + 10 * Math.cos(ang - 0.35), a[1] + 10 * Math.sin(ang - 0.35)); g.closePath(); g.fillStyle = color; g.fill();
        const end = e.pts[e.pts.length - 1], prev = e.pts[e.pts.length - 2] || end; const right = end[0] >= prev[0];
        if (e.s) drawText([end[0] + (right ? 80 : -80), end[1] + 40], e.h || D.text.h, e.s, 0, color, right ? 'left' : 'right', 'bottom'); break;
      }
      case 'rdim': {
        const d = [Math.cos(e.ang), Math.sin(e.ang)], p = [e.c[0] + d[0] * e.r, e.c[1] + d[1] * e.r]; path([e.c, p]); g.stroke();
        const q = w2s(p), ang = Math.atan2(-d[1], d[0]); g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(q[0] - 10 * Math.cos(ang + 0.35), q[1] - 10 * Math.sin(ang + 0.35)); g.lineTo(q[0] - 10 * Math.cos(ang - 0.35), q[1] - 10 * Math.sin(ang - 0.35)); g.closePath(); g.fillStyle = color; g.fill();
        let a = e.ang * 180 / Math.PI; if (a > 90 || a < -90) a += 180; drawText(mid(e.c, p), D.text.h * 0.85, 'R' + fmt0(e.r), a, color, 'center', 'bottom'); break;
      }
      case 'adim': {
        const a0 = angOf(e.c, e.a), a1 = angOf(e.c, e.b); const q = w2s(e.c); g.beginPath(); g.arc(q[0], q[1], e.r * V.s, -a0, -a1, true); g.stroke();
        let deg = ((a1 - a0) * 180 / Math.PI + 360) % 360; const am = a0 + (deg / 2) * Math.PI / 180; drawText([e.c[0] + (e.r + 150) * Math.cos(am), e.c[1] + (e.r + 150) * Math.sin(am)], D.text.h * 0.85, fmt(deg, 1) + '°', 0, color, 'center', 'middle'); break;
      }
    }
  }
  function drawEl(el, c, mode) { // mode: normal | ghost | sel | hi | hover
    const host = hostOf(c); const o = elOutline(el, host); if (!o) return;
    const ghost = mode === 'ghost'; const st = mode === 'sel' ? '#4ea1ff' : mode === 'hi' ? '#ff5555' : mode === 'hover' ? '#9cc7ff' : null;
    g.setLineDash([]); g.lineWidth = mode === 'sel' || mode === 'hi' ? 2 : 1;
    const k = el.k;
    if (k === 'slab') { path(o, true); g.strokeStyle = st || (ghost ? '#2c3442' : '#55657a'); g.setLineDash([2, 3]); g.stroke(); g.setLineDash([]); if (!ghost && mode !== 'sel') { const b = bboxOf(o); drawText([b.x0 + 300, b.y1 - 600], 300, el.tag || `슬래브 t${el.t}`, 0, '#55657a'); } return; }
    if (k === 'footing') { path(o, true); g.strokeStyle = st || (ghost ? '#2c3442' : '#8a7356'); g.setLineDash([8, 5]); g.stroke(); g.setLineDash([]); return; }
    if (k === 'beam') {
      path(o, true); g.strokeStyle = st || (ghost ? '#2c3442' : el.mat === 'STEEL' ? '#8fb4dc' : '#c79a52'); g.setLineDash(el.mat === 'STEEL' ? [] : [10, 5]); g.stroke(); g.setLineDash([]);
      if (el.mat === 'STEEL' && !ghost) { path([el.a, el.b]); g.lineWidth = 2.5; g.stroke(); }
      if (!ghost && V.s > 0.03) { const m = mid(el.a, el.b), a = angOf(el.a, el.b) * 180 / Math.PI; drawText(add(m, mul(perp(norm(sub(el.b, el.a))), 60)), 220, el.tag || elName(el), (a > 90 || a < -90) ? a + 180 : a, '#9c8460', 'center', 'bottom'); }
      return;
    }
    if (k === 'wall') {
      const [fill, line] = (EL_STYLE.wall[el.mat] || EL_STYLE.wall.RC);
      path(o, true); if (!ghost) { g.fillStyle = mode === 'sel' ? '#1f4a7a' : fill; g.fill(); } g.strokeStyle = st || (ghost ? '#2c3442' : line); g.stroke();
      // 개구부 표시
      if (!ghost) for (const op of c.els) if (op.k === 'opening' && op.host === el.id) drawOpening(op, el, mode === 'sel' && false);
      return;
    }
    if (k === 'opening') { const host = c.els.find(e => e.id === el.host); if (host) drawOpening(el, host, mode); return; }
    if (k === 'column') {
      const [fill, line] = EL_STYLE.column[el.mat] || EL_STYLE.column.RC;
      if (el.mat === 'STEEL' && SECTIONS[el.sec] && !ghost) { // H형 단면
        const s = SECTIONS[el.sec], b = s.b / 2, hh = s.h / 2, tw = 10, tf = 16, a = (el.rot || 0) * Math.PI / 180;
        const shape = [[-b, -hh], [b, -hh], [b, -hh + tf], [tw, -hh + tf], [tw, hh - tf], [b, hh - tf], [b, hh], [-b, hh], [-b, hh - tf], [-tw, hh - tf], [-tw, -hh + tf], [-b, -hh + tf]].map(p => add(el.p, rot(p, a)));
        path(shape, true); g.fillStyle = st || fill; g.fill(); g.strokeStyle = st || line; g.stroke();
      } else { path(o, true); if (!ghost) { g.fillStyle = mode === 'sel' ? '#1f4a7a' : fill; g.fill(); } g.strokeStyle = st || (ghost ? '#2c3442' : line); g.stroke(); if (!ghost) { path([o[0], o[2]]); g.stroke(); path([o[1], o[3]]); g.stroke(); } }
      return;
    }
    if (k === 'riser') { const r2 = el.form === 'pipe' ? el.w / 2 : null; const col = st || (ghost ? '#2c3442' : (sysColorC(el.sys) || '#9ece6a')); g.strokeStyle = col; g.lineWidth = 1.5;
      if (r2) { const q = w2s(el.p); g.beginPath(); g.arc(q[0], q[1], Math.max(2, r2 * V.s), 0, Math.PI * 2); g.stroke(); } else { path(o, true); g.stroke(); path([o[0], o[2]]); g.stroke(); path([o[1], o[3]]); g.stroke(); }
      if (!ghost && V.s > 0.03) drawText([el.p[0] + (el.w / 2 + 80), el.p[1]], 160, el.sys || '', 0, col, 'left', 'middle'); return; }
    if (k === 'fin') { path(o, true); if (!ghost) { g.fillStyle = mode === 'sel' ? '#1f4a7a' : '#8a7a5c'; g.fill(); } g.strokeStyle = st || (ghost ? '#2c3442' : '#cbb998'); g.lineWidth = 1; g.stroke(); return; }
    if (k === 'furn') {
      const xf = furnXf(el), col = st || (ghost ? '#2c3442' : ['tree', 'shrub'].includes(el.type) ? '#6fbf73' : ['deck', 'paving', 'fence'].includes(el.type) ? '#b59a77' : ['car'].includes(el.type) ? '#8fb4dc' : '#a9b4c2');
      g.strokeStyle = col; g.lineWidth = mode === 'sel' || mode === 'hi' ? 2 : 1;
      for (const pr of furnPlan(el)) {
        g.beginPath();
        if (pr.poly) { pr.poly.forEach((q, i) => { const s2 = w2s(xf(q)); i ? g.lineTo(s2[0], s2[1]) : g.moveTo(s2[0], s2[1]); }); if (pr.closed) g.closePath(); }
        else if (pr.circle) { const s2 = w2s(xf([pr.circle[0], pr.circle[1]])); g.arc(s2[0], s2[1], pr.circle[2] * V.s, 0, Math.PI * 2); }
        else if (pr.ellipse) { const [cx, cy, rx, ry] = pr.ellipse; for (let i = 0; i <= 28; i++) { const a = i / 28 * Math.PI * 2, s2 = w2s(xf([cx + rx * Math.cos(a), cy + ry * Math.sin(a)])); i ? g.lineTo(s2[0], s2[1]) : g.moveTo(s2[0], s2[1]); } }
        else if (pr.rrect) { const [x0, y0, x1, y1, r] = pr.rrect; const pts = []; for (const [cx, cy, a0] of [[x1 - r, y0 + r, -Math.PI / 2], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, Math.PI / 2], [x0 + r, y0 + r, Math.PI]]) for (let i = 0; i <= 4; i++) { const a = a0 + i / 4 * Math.PI / 2; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } pts.forEach((q, i) => { const s2 = w2s(xf(q)); i ? g.lineTo(s2[0], s2[1]) : g.moveTo(s2[0], s2[1]); }); g.closePath(); }
        g.stroke();
      }
      return;
    }
    if (k === 'room' || k === 'ceiling' || k === 'light' || k === 'sprinkler' || k === 'panel') return drawCoreEl(el, o, mode, st, ghost);
    if (k === 'duct' || k === 'pipe' || k === 'tray') {
      const col = sysColorC(el.sys) || { duct: '#9ece6a', pipe: '#7dcfff', tray: '#f7768e' }[k];
      path(o, true); g.strokeStyle = st || (ghost ? '#2c3442' : col); if (!ghost) { g.fillStyle = col + '22'; g.fill(); } g.stroke();
      if (!ghost) { g.setLineDash([14, 4, 3, 4]); path([el.a, el.b]); g.strokeStyle = st || col + 'aa'; g.stroke(); g.setLineDash([]);
        if (V.s > 0.025) { const m = mid(el.a, el.b), a = angOf(el.a, el.b) * 180 / Math.PI; drawText(add(m, mul(perp(norm(sub(el.b, el.a))), el.w / 2 + 80)), 200, `${el.sys || ''} ${k === 'pipe' ? 'Ø' + el.w : el.w + '×' + el.hh} FL+${el.z}`, (a > 90 || a < -90) ? a + 180 : a, col, 'center', 'bottom'); } }
      return;
    }
  }
  // Core 1.1.0 객체(실·천장·조명·스프링클러·분전반) 평면 기호
  function roomInfo(el) { const A = Math.abs(polyArea(el.pts)) / 1e6; const lux = el.lux || LUX_BY_USE[el.use] || 300; return { A, lux, c: polyCenter(el.pts) }; }
  function roomLabelBox(el) { const { c } = roomInfo(el); const th = Math.max(250, 11 / V.s); return { x0: c[0] - th * 3, x1: c[0] + th * 3, y0: c[1] - th * 1.6, y1: c[1] + th * 1.3 }; }
  function drawCoreEl(el, o, mode, st, ghost) {
    const k = el.k, sel = mode === 'sel';
    if (k === 'room') {
      const col = st || (ghost ? '#2c3442' : '#b98ce0');
      path(o, true); if (!ghost) { g.fillStyle = sel ? '#4ea1ff14' : '#d4a5ff0d'; g.fill(); }
      g.strokeStyle = col; g.lineWidth = sel || mode === 'hi' ? 2 : 1; g.setLineDash([12, 4, 2, 4]); g.stroke(); g.setLineDash([]);
      if (!ghost && V.s > 0.008) { const { A, lux, c } = roomInfo(el); const th = Math.max(250, 11 / V.s);
        drawText([c[0], c[1] + th * 0.2], th, el.name || '실', 0, st || '#e2c8ff', 'center', 'bottom');
        drawText([c[0], c[1] - th * 0.2], th * 0.7, `${el.use || ''} · ${fmt(A, 1)}㎡ · ${lux}lx`, 0, st || '#a88fc4', 'center', 'top'); }
      return;
    }
    if (k === 'ceiling') {
      const col = st || (ghost ? '#2c3442' : '#8f78b0');
      path(o, true); g.strokeStyle = col; g.lineWidth = sel || mode === 'hi' ? 2 : 1; g.setLineDash([3, 4]); g.stroke(); g.setLineDash([]);
      if (!ghost && V.s > 0.015) { const b = bboxOf(o); drawText([b.x0 + 200, b.y0 + 200], 200, `CH ${fmt0(el.z ?? 2700)} ${el.fin || ''}`, 0, st || '#8f78b0', 'left', 'bottom'); }
      return;
    }
    const q = w2s(el.p);
    if (k === 'sprinkler') {
      const col = st || (ghost ? '#2c3442' : DISC.F.color); const r = Math.max(4, (el.w || 80) / 2 * V.s);
      g.strokeStyle = col; g.lineWidth = sel || mode === 'hi' ? 2 : 1.2; g.beginPath(); g.arc(q[0], q[1], r, 0, Math.PI * 2); g.stroke();
      if (!ghost) { g.fillStyle = col + (el.type === 'upright' ? '00' : '55'); g.fill(); g.beginPath(); g.moveTo(q[0] - r * 1.5, q[1]); g.lineTo(q[0] + r * 1.5, q[1]); g.moveTo(q[0], q[1] - r * 1.5); g.lineTo(q[0], q[1] + r * 1.5); g.stroke(); }
      if (!ghost && el.type === 'sidewall') { g.beginPath(); g.moveTo(q[0] - r, q[1] + r * 1.6); g.lineTo(q[0] + r, q[1] + r * 1.6); g.stroke(); }
      return;
    }
    if (k === 'light') {
      const col = st || (ghost ? '#2c3442' : '#ffd866');
      path(o, true); if (!ghost) { g.fillStyle = sel ? '#1f4a7a' : '#ffd86622'; g.fill(); } g.strokeStyle = col; g.lineWidth = sel || mode === 'hi' ? 2 : 1; g.stroke();
      if (!ghost) { path([o[0], o[2]]); g.stroke(); path([o[1], o[3]]); g.stroke();
        if (el.circuit && V.s > 0.03) drawText([el.p[0], el.p[1] - el.d / 2 - 60], 150, el.circuit, 0, '#c9b35c', 'center', 'top'); }
      return;
    }
    if (k === 'panel') {
      const col = st || (ghost ? '#2c3442' : DISC.E.color);
      path(o, true); if (!ghost) { g.fillStyle = sel ? '#1f4a7a' : col + '66'; g.fill(); } g.strokeStyle = col; g.lineWidth = sel || mode === 'hi' ? 2 : 1.2; g.stroke();
      if (!ghost) { path([o[0], o[2]]); g.stroke();
        if (V.s > 0.02) drawText([el.p[0] + Math.max(el.w, el.d) / 2 + 80, el.p[1]], 180, el.tag || `${el.sys || ''} 분전반${el.kw ? ' ' + fmt(el.kw, 1) + 'kW' : ''}`, 0, col, 'left', 'middle'); }
    }
  }
  function drawOpening(op, host, mode) {
    const dir = norm(sub(host.b, host.a)), n = perp(dir), t = host.t / 2;
    const a = add(host.a, mul(dir, op.s)), b = add(a, mul(dir, op.w));
    const quad = [add(a, mul(n, t)), add(b, mul(n, t)), add(b, mul(n, -t)), add(a, mul(n, -t))];
    path(quad, true); g.fillStyle = BG; g.fill();
    const col = mode === 'sel' ? '#4ea1ff' : mode === 'hi' ? '#ff5555' : '#d8dee9'; g.strokeStyle = col; g.lineWidth = mode === 'sel' ? 2 : 1;
    path([quad[0], quad[3]]); g.stroke(); path([quad[1], quad[2]]); g.stroke();
    if (op.kind === 'sleeve') { g.strokeStyle = '#ffb454'; path([quad[0], quad[2]]); g.stroke(); path([quad[1], quad[3]]); g.stroke(); path(quad, true); g.stroke(); return; }
    if (op.kind === 'window') { path([a, b]); g.stroke(); path([add(a, mul(n, t / 3)), add(b, mul(n, t / 3))]); g.stroke(); path([add(a, mul(n, -t / 3)), add(b, mul(n, -t / 3))]); g.stroke(); }
    else { const p0 = add(a, mul(n, t)), leaf = add(p0, mul(n, op.w)); path([p0, leaf]); g.stroke(); const q = w2s(p0); const r = op.w * V.s; const a0 = Math.atan2(-n[1], n[0]), a1 = Math.atan2(-dir[1], dir[0]); g.beginPath(); g.arc(q[0], q[1], r, a0, a1, Math.sin(a1 - a0) < 0); g.setLineDash([3, 3]); g.stroke(); g.setLineDash([]); }
  }
  function drawBgGrid() {
    if (!opt.grid) return;
    let step = 1000; while (step * V.s < 14) step *= 5; while (step * V.s > 120) step /= 5;
    const [x0, y1] = s2w(0, 0), [x1, y0] = s2w(W, H);
    g.fillStyle = '#1d2531';
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) { const q = w2s([x, y]); g.fillRect(q[0] - 0.75, q[1] - 0.75, 1.5, 1.5); }
    // 원점 / 기준점
    const o = w2s([P.base.x, P.base.y]); g.strokeStyle = '#c94f4f'; g.lineWidth = 1; g.beginPath(); g.moveTo(o[0], o[1]); g.lineTo(o[0] + 30, o[1]); g.stroke(); g.strokeStyle = '#4fbf6f'; g.beginPath(); g.moveTo(o[0], o[1]); g.lineTo(o[0], o[1] - 30); g.stroke();
    g.fillStyle = '#6f7a8d'; g.font = '10px sans-serif'; g.fillText('기준점', o[0] + 4, o[1] + 12);
  }
  function render() {
    raf = requestAnimationFrame(render);
    if (!dirty) return; dirty = false;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    if (space === 'layout') { drawLayout(); statusEl.textContent = `배치 — ${plotCfg().paper} ${plotCfg().scale ? '1:' + plotCfg().scale : '맞춤'} · 휠: 확대 · 드래그: 이동`; return; }
    drawBgGrid();
    drawUnderlay();
    const c = C(); if (!c) return;
    if (under && P.content[under]) { const u = P.content[under]; for (const e of u.ents) if (e.t !== 'text') drawEnt(e, '#2c3442', 1, true); for (const el of u.els) drawEl(el, u, 'ghost'); }
    const order = { room: -2, ceiling: -1, slab: 0, footing: 1, beam: 2, wall: 3, opening: 4, column: 5, duct: 6, pipe: 6, tray: 6, panel: 7, light: 7, sprinkler: 8 };
    const els = [...c.els].sort((a, b) => (order[a.k] ?? 9) - (order[b.k] ?? 9));
    const hiIds = new Set(S.hi?.ids || []);
    for (const el of els) if (el.k !== 'opening') drawEl(el, c, sel.has(el.id) ? 'sel' : hiIds.has(el.id) ? 'hi' : hover === el.id ? 'hover' : 'normal');
    for (const el of els) if (el.k === 'opening' && (sel.has(el.id) || hiIds.has(el.id))) drawEl(el, c, sel.has(el.id) ? 'sel' : 'hi');
    if (progView != null && P.bill.periods[progView]) {
      const cp = cumProgress(P, progView); const host = hostOf(c);
      for (const el of c.els) { if (el.k === 'opening' || el.k === 'room') continue; const o = elOutline(el, host); if (!o) continue; const p = cp[el.id] || 0; path(o, true); g.fillStyle = p >= 100 ? '#3fbf7f88' : p > 0 ? '#e6b45088' : '#9aa0a822'; g.fill(); if (p > 0 && p < 100 && V.s > 0.02) { const b = bboxOf(o); drawText([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2], 250, p + '%', 0, '#ffe7a8', 'center', 'middle'); } }
      for (const z of (P.bill.periods[progView].zones || []).filter(z => z.sheet === sid)) { path(z.pts, true); g.setLineDash([8, 4]); g.strokeStyle = '#e6b450'; g.lineWidth = 1.5; g.stroke(); g.setLineDash([]); const b = bboxOf(z.pts); drawText([b.x0 + 200, b.y1 - 500], 350, `${z.pct}%${z.name ? ' ' + z.name : ''}`, 0, '#e6b450'); }
      g.fillStyle = '#000a'; g.fillRect(8, H - 34, 300, 24); g.fillStyle = '#e6e9ef'; g.font = '12px sans-serif'; g.fillText(`기성 표시: ${P.bill.periods[progView].name}  ■완료 ■진행 ■미착수`, 14, H - 18);
    }
    for (const e of c.ents) { if (!layerVisible(e.layer)) continue; drawEnt(e, sel.has(e.id) ? '#4ea1ff' : hiIds.has(e.id) ? '#ff5555' : hover === e.id ? '#9cc7ff' : (e.color || layerColor(e.layer)), sel.has(e.id) ? Math.max(2, lwPx(e.layer)) : lwPx(e.layer)); }
    drawTakeoffs();
    // 그립
    if (!cmd && sel.size && sel.size < 60) { g.fillStyle = '#4ea1ff'; for (const gr of grips()) { const q = w2s(gr.p); g.fillRect(q[0] - 4, q[1] - 4, 8, 8); } }
    // 외부 툴 강조
    if (S.hi?.pts && (!S.hi.sheet || S.hi.sheet === sid || S.hi.level === sheet().level)) {
      const t = (performance.now() / 400) % 1; g.strokeStyle = '#ff5555'; g.lineWidth = 2;
      for (const p of S.hi.pts) { const q = w2s(p); g.beginPath(); g.arc(q[0], q[1], 14 + t * 10, 0, Math.PI * 2); g.globalAlpha = 1 - t; g.stroke(); g.globalAlpha = 1; g.beginPath(); g.arc(q[0], q[1], 8, 0, Math.PI * 2); g.stroke(); }
      dirty = true;
    }
    // 극좌표 추적선
    if (polarHit != null && lastPt && cmd) { const r = polarHit * Math.PI / 180, far = [lastPt[0] + Math.cos(r) * 1e6, lastPt[1] + Math.sin(r) * 1e6]; g.save(); g.strokeStyle = '#3fdf8f66'; g.setLineDash([4, 6]); path([lastPt, far]); g.stroke(); g.restore(); }
    // 리비전 비교
    if (cmp) {
      g.save(); g.lineWidth = 2;
      const drawAny = (o, col) => { if (o.k) { const oc = { els: [o, ...C().els] }; const ol = elOutline(o, (id) => oc.els.find(x => x.id === id)); if (ol) { path(ol, true); g.strokeStyle = col; g.stroke(); g.fillStyle = col + '33'; g.fill(); } } else drawEnt(o, col, 2); };
      for (const o of cmp.diff.removed) { g.setLineDash([6, 4]); drawAny(o, '#ff5555'); }
      g.setLineDash([]); for (const o of cmp.diff.added) drawAny(o, '#3fdf8f');
      for (const c of cmp.diff.changed) { g.setLineDash([6, 4]); drawAny(c.old, '#ff9f43'); g.setLineDash([]); drawAny(c.now, '#ffd866'); }
      g.restore();
      g.fillStyle = '#000a'; g.fillRect(8, 8, 330, 24); g.fillStyle = '#e6e9ef'; g.font = '12px sans-serif'; g.fillText(`비교: ${cmp.name}  추가 ${cmp.diff.added.length} · 삭제 ${cmp.diff.removed.length} · 변경 ${cmp.diff.changed.length}`, 14, 24);
    }
    // 명령 미리보기
    tipUsed = false;
    if (cmd?.preview) { g.save(); g.strokeStyle = '#ffd866'; g.fillStyle = '#ffd86633'; g.lineWidth = 1; cmd.preview(cur); g.restore(); }
    if (cmd && opt.dyn && !tipUsed && cur) showTip('');
    // 범위선택 상자
    if (drag?.box) { const [a, b] = [drag.p0s, drag.p1s]; const crossing = b[0] < a[0]; g.strokeStyle = crossing ? '#3fbf7f' : '#4ea1ff'; g.fillStyle = crossing ? '#3fbf7f22' : '#4ea1ff22'; g.setLineDash(crossing ? [5, 4] : []); g.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); g.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); g.setLineDash([]); }
    // 스냅 마커
    if (snap) { const q = w2s(snap.p); g.strokeStyle = '#3fdf8f'; g.lineWidth = 2; g.beginPath(); if (snap.k === 'mid') { g.moveTo(q[0], q[1] - 7); g.lineTo(q[0] + 7, q[1] + 5); g.lineTo(q[0] - 7, q[1] + 5); g.closePath(); } else if (snap.k === 'cen') g.arc(q[0], q[1], 7, 0, Math.PI * 2); else if (snap.k === 'int') { g.moveTo(q[0] - 6, q[1] - 6); g.lineTo(q[0] + 6, q[1] + 6); g.moveTo(q[0] + 6, q[1] - 6); g.lineTo(q[0] - 6, q[1] + 6); } else if (snap.k === 'per') { g.moveTo(q[0] - 6, q[1] + 6); g.lineTo(q[0] + 6, q[1] + 6); g.moveTo(q[0] - 6, q[1] + 6); g.lineTo(q[0] - 6, q[1] - 6); } else g.rect(q[0] - 6, q[1] - 6, 12, 12); g.stroke(); }
    // 십자 커서
    const q = w2s(cur); g.strokeStyle = '#e6e9ef'; g.lineWidth = 1; g.beginPath(); g.moveTo(q[0] - 18, q[1]); g.lineTo(q[0] + 18, q[1]); g.moveTo(q[0], q[1] - 18); g.lineTo(q[0], q[1] + 18); g.stroke(); if (!cmd || cmd.selecting) g.strokeRect(q[0] - 4, q[1] - 4, 8, 8);
    statusEl.textContent = `X ${fmt0(cur[0])}  Y ${fmt0(cur[1])}  |  [${sheet().disc}] ${sheet().name} · ${lv().name} (FL ${fmt0(lv().elev)}, 층고 ${fmt0(lv().height)})  |  레이어 ${curLayer}  |  선택 ${sel.size}`;
  }

  // ---------- 스냅 ----------
  function computeSnap(p) {
    snap = null; if (!opt.osnap) return p;
    const c = C(), tol = 12 / V.s; let best = null, bd = tol;
    const consider = (k, q) => { if (opt.snaps[k] === false) return; const d = dist(q, p); if (d < bd) { bd = d; best = { k, p: q }; } };
    const lists = [c]; if (under && P.content[under]) lists.push(P.content[under]);
    const segs = [];
    for (const cc of lists) {
      for (const e of cc.ents) { if (!layerVisible(e.layer)) continue; const b = G.entBBox(e); if (b && (p[0] < b.x0 - tol || p[0] > b.x1 + tol || p[1] < b.y0 - tol || p[1] > b.y1 + tol)) continue; for (const [k, q] of G.entSnaps(e)) consider(k, q); if (e.t !== 'text') segs.push(...G.entSegs(e)); }
      for (const el of cc.els) { const b = G.elBBox(el, hostOf(cc)); if (b && (p[0] < b.x0 - tol || p[0] > b.x1 + tol || p[1] < b.y0 - tol || p[1] > b.y1 + tol)) continue; for (const [k, q] of G.elSnaps(el, hostOf(cc))) consider(k, q); segs.push(...G.elSegs(el, hostOf(cc))); if (el.a && el.b) segs.push([el.a, el.b]); }
    }
    if (!best) for (const q of G.nearIntersections(segs, p, tol)) consider('int', q);
    if (!best && lastPt) { for (const [a, b] of segs) { const cl = closestOnSeg(lastPt, a, b); if (cl.t > 0.001 && cl.t < 0.999 && dist(cl.p, p) < tol) consider('per', cl.p); } }
    if (!best) { for (const [a, b] of segs) { const cl = closestOnSeg(p, a, b); if (cl.d < tol * 0.5) consider('nea', cl.p); } }
    if (best) { snap = best; return best.p; }
    return p;
  }
  function applyOrtho(p) {
    if (!lastPt || snap) return p;
    if (!opt.ortho) {
      if (!opt.polar) return p; const d = sub(p, lastPt), L = Math.hypot(d[0], d[1]); if (L < 1) return p;
      const a = Math.atan2(d[1], d[0]) * 180 / Math.PI, k = Math.round(a / opt.polarInc) * opt.polarInc;
      if (Math.abs(a - k) < 2.5) { const r = k * Math.PI / 180; polarHit = k; return [lastPt[0] + L * Math.cos(r), lastPt[1] + L * Math.sin(r)]; } return p;
    }
    const d = sub(p, lastPt); return Math.abs(d[0]) > Math.abs(d[1]) ? [p[0], lastPt[1]] : [lastPt[0], p[1]];
  }

  // ---------- 선택 ----------
  function pickAt(p) {
    const c = C(), tol = 6 / V.s;
    for (let i = c.ents.length - 1; i >= 0; i--) { const e = c.ents[i]; if (layerVisible(e.layer) && !layerLocked(e.layer) && G.hitEnt(e, p, tol)) return e.id; }
    // 작은 객체 우선(개구부>기둥>나머지)
    const pri = { sprinkler: -1, light: 0, panel: 0, opening: 0, column: 1, duct: 2, pipe: 2, tray: 2, beam: 3, wall: 4, footing: 5, slab: 6, ceiling: 7, room: 8 };
    const hits = c.els.filter(el => G.hitEl(el, p, tol, hostOf(c))).sort((a, b) => (pri[a.k] ?? 9) - (pri[b.k] ?? 9));
    if (hits[0]) return hits[0].id;
    // 실은 테두리 외에 실명 라벨로도 선택
    const rm = c.els.find(el => el.k === 'room' && el.pts?.length > 2 && G.bbIn({ x0: p[0], y0: p[1], x1: p[0], y1: p[1] }, roomLabelBox(el)));
    return rm?.id || null;
  }
  function selectBox(a, b, add) {
    const c = C(); const w = { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
    const crossing = b[0] < a[0]; if (!add) sel.clear();
    for (const e of c.ents) { if (!layerVisible(e.layer) || layerLocked(e.layer)) continue; const bb = G.entBBox(e); if (crossing ? (G.bbIn(bb, w) || (G.bbHit(bb, w) && G.segsCrossBox(G.entSegs(e), w))) : G.bbIn(bb, w)) sel.add(e.id); }
    for (const el of c.els) { const bb = G.elBBox(el, hostOf(c)); if (crossing ? (G.bbIn(bb, w) || (G.bbHit(bb, w) && G.segsCrossBox(G.elSegs(el, hostOf(c)), w))) : G.bbIn(bb, w)) sel.add(el.id); }
    selChanged();
  }
  function selChanged() { S.sel = new Set(sel); renderSide(); dirty = true; }
  const selected = () => { const c = C(); return { ents: c.ents.filter(e => sel.has(e.id)), els: c.els.filter(e => sel.has(e.id)) }; };

  // 그립
  function grips() {
    const out = []; const c = C();
    for (const e of c.ents) if (sel.has(e.id)) {
      if (e.a) out.push({ id: e.id, key: 'a', p: e.a }); if (e.b) out.push({ id: e.id, key: 'b', p: e.b });
      if (e.pts) e.pts.forEach((p, i) => out.push({ id: e.id, key: 'pts', i, p })); if (e.c) out.push({ id: e.id, key: 'c', p: e.c }); if (e.p) out.push({ id: e.id, key: 'p', p: e.p }); if (e.off) out.push({ id: e.id, key: 'off', p: e.off });
    }
    for (const el of c.els) if (sel.has(el.id)) {
      if (el.a) out.push({ id: el.id, key: 'a', p: el.a, el: 1 }); if (el.b) out.push({ id: el.id, key: 'b', p: el.b, el: 1 }); if (el.p) out.push({ id: el.id, key: 'p', p: el.p, el: 1 }); if (el.pts) el.pts.forEach((p, i) => out.push({ id: el.id, key: 'pts', i, p, el: 1 }));
    }
    return out;
  }

  // ---------- 편집 기록 ----------
  function snapshot() { (undo[sid] ||= []).push(JSON.stringify(C())); if (undo[sid].length > 60) undo[sid].shift(); redo[sid] = []; }
  function changed() { ctx.touch(sid); ctx.bus.emit('model', { sheet: sid }); dirty = true; renderSide(); }
  function doUndo() { const u = undo[sid]; if (!u?.length) return log('되돌릴 작업이 없습니다'); (redo[sid] ||= []).push(JSON.stringify(C())); P.content[sid] = JSON.parse(u.pop()); sel.clear(); changed(); log('실행 취소'); }
  function doRedo() { const r = redo[sid]; if (!r?.length) return log('다시 실행할 작업이 없습니다'); (undo[sid] ||= []).push(JSON.stringify(C())); P.content[sid] = JSON.parse(r.pop()); sel.clear(); changed(); log('다시 실행'); }
  const addEnt = (e) => { e.id ||= uid('d'); e.layer ||= curLayer; C().ents.push(e); return e; };
  const addEl = (e) => { e.id ||= uid('e'); C().els.push(e); return e; };
  function removeIds(ids) { const c = C(); c.ents = c.ents.filter(e => !ids.has(e.id)); const gone = new Set(c.els.filter(e => ids.has(e.id)).map(e => e.id)); c.els = c.els.filter(e => !ids.has(e.id) && !(e.k === 'opening' && gone.has(e.host))); }

  // ---------- 입력 해석 ----------
  function parsePoint(s) {
    s = s.trim(); let m;
    if ((m = s.match(/^@\s*(-?[\d.]+)\s*<\s*(-?[\d.]+)$/))) { const b = lastPt || [0, 0]; const a = +m[2] * Math.PI / 180; return [b[0] + +m[1] * Math.cos(a), b[1] + +m[1] * Math.sin(a)]; }
    if ((m = s.match(/^(-?[\d.]+)\s*<\s*(-?[\d.]+)$/))) { const a = +m[2] * Math.PI / 180; return [+m[1] * Math.cos(a), +m[1] * Math.sin(a)]; }
    if ((m = s.match(/^@\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)$/))) { const b = lastPt || [0, 0]; return [b[0] + +m[1], b[1] + +m[2]]; }
    if ((m = s.match(/^(-?[\d.]+)\s*,\s*(-?[\d.]+)$/))) return [+m[1], +m[2]];
    if ((m = s.match(/^(-?[\d.]+)$/)) && lastPt) { const d = +m[1]; let dir = sub(applyOrtho(curRaw), lastPt); if (len2(dir) < 1e-6) dir = [1, 0]; return add(lastPt, mul(norm(dir), d)); }
    return null;
  }
  const len2 = (v) => v[0] * v[0] + v[1] * v[1];
  const num = (s) => { const v = parseFloat(String(s).replace(/,/g, '')); return isNaN(v) ? null : v; };

  // ---------- 명령 실행 ----------
  function startCmd(name, arg) {
    name = ALIASES[name] || name;
    if (cmd) cancel(true);
    const f = CMDS[name]; if (!f) { log(`알 수 없는 명령: ${name}`, '#ef5f5f'); return; }
    lastCmd = name;
    cmd = f(arg) || null; if (!cmd) { setPrompt('명령:'); dirty = true; return; }
    cmd.name = name;
    log(`명령: ${name}  — ${CMD_NAMES[name] || ''}`, '#a9b1c1');
    if (cmd.needSel && !sel.size) { cmd.selecting = true; setPrompt(`${CMD_NAMES[name]}: 객체 선택 후 Enter`); }
    else { cmd.selecting = false; cmd.begin?.(); }
    if (cmd) setPrompt(cmd.selecting ? `${CMD_NAMES[name]}: 객체 선택 후 Enter` : cmd.prompt()); dirty = true;
  }
  function endCmd(msg) { if (msg) log(msg); cmd = null; lastPt = null; setPrompt('명령:'); dirty = true; tip.style.display = 'none'; }
  function cancel(silent) { if (cmd) { cmd.cancel?.(); if (!silent) log('*취소*'); } cmd = null; lastPt = null; setPrompt('명령:'); dirty = true; tip.style.display = 'none'; }
  function feedPoint(p) {
    if (!cmd) return;
    if (cmd.selecting) { const id = pickAt(p); if (id) { sel.has(id) ? sel.delete(id) : sel.add(id); selChanged(); } return; }
    cmd.point(p); if (cmd) setPrompt(cmd.prompt());
  }
  function submit(raw) {
    const s = raw.trim(); inp.value = '';
    if (!cmd) {
      if (!s) { if (lastCmd) startCmd(lastCmd); return; }
      if (s.startsWith('?')) return aiDraw(s.slice(1));
      const [name, ...rest] = s.split(/\s+/); const up = name.toUpperCase();
      if (ALIASES[up]) { startCmd(up); if (rest.length && cmd) for (const r of rest) submit(r); return; }
      log(`알 수 없는 명령: ${s}  (예: L, PL, C, WA, COL, M, CO, O, TR)`, '#ef5f5f'); return;
    }
    if (cmd.selecting) { if (!s) { if (!sel.size) return log('선택된 객체가 없습니다'); cmd.selecting = false; cmd.begin?.(); if (cmd) setPrompt(cmd.prompt()); dirty = true; return; } if (s.toUpperCase() === 'ALL') { const c = C(); c.ents.forEach(e => sel.add(e.id)); c.els.forEach(e => sel.add(e.id)); selChanged(); } return; }
    if (!s) { cmd.enter ? cmd.enter() : endCmd(); if (cmd) setPrompt(cmd.prompt()); return; }
    if (cmd.text && cmd.text(s)) { if (cmd) setPrompt(cmd.prompt()); return; }
    const p = parsePoint(s);
    if (p) { log(`  ${s}`); cmd.point(p); if (cmd) setPrompt(cmd.prompt()); return; }
    log(`잘못된 입력: ${s}`, '#ef5f5f');
  }

  // 미리보기 도우미
  const pv = {
    line: (a, b) => { path([a, b]); g.stroke(); },
    poly: (pts, close) => { path(pts, close); g.stroke(); },
    circle: (c, r) => { const q = w2s(c); g.beginPath(); g.arc(q[0], q[1], r * V.s, 0, Math.PI * 2); g.stroke(); },
    el: (el) => { const c = { els: [el, ...C().els.filter(e => e.k === 'wall')] }; drawEl(el, c, 'hover'); },
  };
  let tipUsed = false;
  const showTip = (txt) => { tipUsed = true; const q = w2s(cur); tip.innerHTML = '';
    if (opt.dyn && cmd) { const pr = promptEl.textContent.replace(/:$/, ''); tip.append(h('div', { style: { color: '#9fb3cc' } }, pr.length > 46 ? pr.slice(0, 46) + '…' : pr)); tip.append(h('div', {}, inp.value ? h('b', { style: { color: '#ffd866', background: '#2c4f78', padding: '0 4px', borderRadius: '2px' } }, inp.value) : null, txt ? h('span', { style: { marginLeft: inp.value ? '8px' : 0 } }, txt) : null)); if (!txt && !inp.value) tip.lastChild.textContent = `${fmt0(cur[0])}, ${fmt0(cur[1])}`; }
    else { if (!txt) { tip.style.display = 'none'; return; } tip.textContent = txt; }
    tip.style.display = 'block'; tip.style.left = Math.min(W - 160, q[0] + 18) + 'px'; tip.style.top = Math.min(H - 44, q[1] + 18) + 'px'; };
  inp.addEventListener('input', () => { if (cmd) dirty = true; });
  const lenTip = (a, b) => showTip(`${fmt0(dist(a, b))}  <${fmt(((angOf(a, b) * 180 / Math.PI) + 360) % 360, 1)}°`);

  // 연속 선분형 명령 (선, 벽, 보, 덕트…)
  function chain(label, make, opts = {}) {
    let first = null, segs = [];
    return {
      prompt: () => first == null ? `${label} 시작점${opts.optText ? ' ' + opts.optText() : ''}:` : `다음 점 [닫기(C)/명령취소(U)]${opts.optText ? ' ' + opts.optText() : ''}:`,
      point(p) {
        if (first == null) { first = p; lastPt = p; return; }
        if (dist(lastPt, p) < 1) return;
        snapshot(); const made = make(lastPt, p); segs.push(made); lastPt = p; changed();
        if (opts.single) { first = null; lastPt = null; }
      },
      text(s) {
        const u = s.toUpperCase();
        if (u === 'C' && first && segs.length > 1) { snapshot(); make(lastPt, first); changed(); endCmd(); return true; }
        if (u === 'U' && segs.length) { doUndo(); segs.pop(); const prev = segs[segs.length - 1]; lastPt = prev ? (prev.b || prev.p) : first; return true; }
        return opts.text?.(s) || false;
      },
      enter() { endCmd(segs.length ? `${segs.length}개 작성` : ''); },
      preview(c) { if (lastPt) { const b = applyOrtho(c); if (opts.previewEl) pv.el(opts.previewEl(lastPt, b)); else pv.line(lastPt, b); lenTip(lastPt, b); } },
    };
  }
  // 점 배치형 (기둥, 기초)
  function place(label, make, opts = {}) {
    let n = 0;
    return {
      prompt: () => `${label} 위치${opts.optText ? ' ' + opts.optText() : ''}:`,
      point(p) { snapshot(); make(p); n++; changed(); },
      text: (s) => opts.text?.(s) || false,
      enter() { endCmd(n ? `${n}개 배치` : ''); },
      preview(c) { if (opts.previewEl) pv.el(opts.previewEl(c)); },
    };
  }
  // 선택 후 기준점→대상점 (이동/복사/회전/대칭/축척)
  function xform(kind) {
    let base = null, copies = 0;
    const apply = (f, ang = 0, mirror = false, keep = false) => {
      snapshot(); const c = C(); const idsMap = new Map();
      const { ents, els } = selected();
      if (keep) {
        for (const e of ents) { const n = G.transformEnt(e, f, ang, mirror); n.id = uid('d'); c.ents.push(n); }
        for (const el of els) if (el.k !== 'opening') { const n = G.transformEl(el, f, ang, mirror); const nid = uid('e'); idsMap.set(el.id, nid); n.id = nid; c.els.push(n); }
        for (const el of els) if (el.k === 'opening' && idsMap.has(el.host)) { const n = deep(el); n.id = uid('e'); n.host = idsMap.get(el.host); c.els.push(n); }
      } else {
        c.ents = c.ents.map(e => sel.has(e.id) ? G.transformEnt(e, f, ang, mirror) : e);
        c.els = c.els.map(e => sel.has(e.id) && e.k !== 'opening' ? G.transformEl(e, f, ang, mirror) : e);
      }
      changed();
    };
    return {
      needSel: true,
      prompt: () => base == null ? (kind === 'MIRROR' ? '대칭선 첫 점:' : '기준점:') : kind === 'ROTATE' ? '회전 각도(°) 또는 점:' : kind === 'SCALE' ? '축척 비율 또는 점:' : kind === 'MIRROR' ? '대칭선 둘째 점 [원본 유지(K)]:' : kind === 'COPY' ? '대상점 [끝내려면 Enter]:' : '대상점:',
      keep: false,
      point(p) {
        if (base == null) { base = p; lastPt = p; return; }
        if (kind === 'MOVE') { apply(G.fMove(sub(p, base))); endCmd('이동 완료'); }
        else if (kind === 'COPY') { apply(G.fMove(sub(p, base)), 0, false, true); copies++; }
        else if (kind === 'ROTATE') { const a = angOf(base, p); apply(G.fRot(base, a), a); endCmd(`회전 ${fmt(a * 180 / Math.PI, 1)}°`); }
        else if (kind === 'SCALE') { const s = dist(base, p) / 1000; apply(G.fScale(base, s)); endCmd(`축척 ${fmt(s, 3)} (기준 1000mm)`); }
        else if (kind === 'MIRROR') { apply(G.fMirror(base, p), 0, true, this.keep !== false); endCmd('대칭 완료'); }
      },
      text(s) {
        const v = num(s); const u = s.toUpperCase();
        if (kind === 'MIRROR' && u === 'K') { this.keep = !this.keep; log(`원본 ${this.keep ? '유지' : '삭제'}`); return true; }
        if (base != null && v != null && kind === 'ROTATE') { const a = v * Math.PI / 180; apply(G.fRot(base, a), a); endCmd(`회전 ${v}°`); return true; }
        if (base != null && v != null && kind === 'SCALE') { apply(G.fScale(base, v)); endCmd(`축척 ${v}`); return true; }
        return false;
      },
      begin() { if (kind === 'MIRROR') this.keep = true; },
      enter() { endCmd(copies ? `${copies}회 복사` : ''); },
      preview(c) {
        if (base == null) return; const b = applyOrtho(c); pv.line(base, b); lenTip(base, b);
        const f = kind === 'MOVE' || kind === 'COPY' ? G.fMove(sub(b, base)) : kind === 'ROTATE' ? G.fRot(base, angOf(base, b)) : kind === 'MIRROR' ? G.fMirror(base, b) : null;
        if (!f) return; const { ents, els } = selected(); g.globalAlpha = 0.6;
        for (const e of ents.slice(0, 300)) drawEnt(G.transformEnt(e, f, kind === 'ROTATE' ? angOf(base, b) : 0, kind === 'MIRROR'), '#ffd866');
        for (const el of els.slice(0, 300)) if (el.k !== 'opening') { const n = G.transformEl(el, f, kind === 'ROTATE' ? angOf(base, b) : 0); const o = elOutline(n, () => null); if (o) pv.poly(o, true); }
        g.globalAlpha = 1;
      },
    };
  }
  const elWithDefaults = (k, extra) => {
    const d = D[k] || {}; const el = { k, ...deep(d), ...extra };
    if ((k === 'column' || k === 'beam') && el.mat !== 'STEEL') delete el.sec;
    return el;
  };
  const allSegs = (except) => { const c = C(), out = []; for (const e of c.ents) if (!except?.has(e.id) && e.t !== 'text' && layerVisible(e.layer)) out.push(...G.entSegs(e)); for (const el of c.els) out.push(...G.elSegs(el, hostOf(c))); return out; };

  const CMDS = {
    LINE: () => chain('선', (a, b) => addEnt({ t: 'line', a, b })),
    WALL: () => chain(`벽(${MATS[D.wall.mat]?.name} ${D.wall.t})`, (a, b) => addEl(elWithDefaults('wall', { a, b })), { optText: () => '[두께(T)/재료(M)]', text: (s) => { const u = s.toUpperCase(); if (u === 'T') { askNum('벽 두께(mm)', D.wall.t).then(v => { if (v) { D.wall.t = v; ctx.touch('meta'); setPrompt(cmd?.prompt() || '명령:'); } }); return true; } if (u === 'M') { const ks = Object.keys(MATS); D.wall.mat = ks[(ks.indexOf(D.wall.mat) + 1) % ks.length]; log('재료: ' + MATS[D.wall.mat].name); ctx.touch('meta'); return true; } const v = num(s); if (v && /^t/i.test(s)) { D.wall.t = v; return true; } return false; }, previewEl: (a, b) => elWithDefaults('wall', { a, b }) }),
    BEAM: () => chain(`보(${D.beam.mat === 'STEEL' ? D.beam.sec : D.beam.w + '×' + D.beam.d})`, (a, b) => addEl(elWithDefaults('beam', { a, b })), { single: false, optText: () => '[크기 400x700 / 철골(S)]', text: (s) => { const m = s.match(/^(\d+)\s*[x×*]\s*(\d+)$/i); if (m) { D.beam.w = +m[1]; D.beam.d = +m[2]; D.beam.mat = 'RC'; return true; } if (s.toUpperCase() === 'S') { D.beam.mat = D.beam.mat === 'STEEL' ? 'RC' : 'STEEL'; log(D.beam.mat === 'STEEL' ? '철골보 ' + D.beam.sec : 'RC보'); return true; } return false; }, previewEl: (a, b) => elWithDefaults('beam', { a, b }) }),
    DUCT: () => chain(`덕트(${D.duct.w}×${D.duct.hh}, FL+${D.duct.z})`, (a, b) => addEl(elWithDefaults('duct', { a, b })), { optText: () => '[크기 800x400 / 높이(Z)]', text: (s) => mepText('duct', s), previewEl: (a, b) => elWithDefaults('duct', { a, b }) }),
    PIPE: () => chain(`배관(Ø${D.pipe.w}, FL+${D.pipe.z})`, (a, b) => addEl(elWithDefaults('pipe', { a, b, hh: D.pipe.w })), { optText: () => '[관경 숫자 / 높이(Z)]', text: (s) => mepText('pipe', s), previewEl: (a, b) => elWithDefaults('pipe', { a, b, hh: D.pipe.w }) }),
    TRAY: () => chain(`트레이(${D.tray.w}×${D.tray.hh}, FL+${D.tray.z})`, (a, b) => addEl(elWithDefaults('tray', { a, b })), { optText: () => '[크기 600x100 / 높이(Z)]', text: (s) => mepText('tray', s), previewEl: (a, b) => elWithDefaults('tray', { a, b }) }),
    GRID: () => {
      let a = null;
      return {
        prompt: () => a ? `그리드 끝점 (라벨 ${D.grid.next}) [라벨 변경: 문자 입력]:` : `그리드 시작점 (라벨 ${D.grid.next}):`,
        point(p) { if (!a) { a = p; lastPt = p; return; } snapshot(); addEnt({ t: 'grid', a, b: p, label: D.grid.next, layer: 'GRID' }); D.grid.next = nextLabel(D.grid.next); changed(); a = null; lastPt = null; },
        text(s) { if (!parsePoint(s)) { D.grid.next = s; return true; } return false; },
        enter() { endCmd(); },
        preview(c) { if (a) { const b = applyOrtho(c); pv.line(a, b); lenTip(a, b); } },
      };
    },
    PLINE: () => polyCollect('폴리선', (pts, closed) => addEnt({ t: 'pline', pts, closed })),
    SLAB: () => polyCollect(`슬래브(t${D.slab.t}) 외곽`, (pts) => addEl(elWithDefaults('slab', { pts })), true),
    AREA: () => polyCollect('면적 점', (pts) => { const A = Math.abs(polyArea(pts)); log(`면적 = ${fmt(A / 1e6, 3)} m²   둘레 = ${fmt(polyPerim(pts) / 1000, 3)} m`, '#3fdf8f'); toast(`면적 ${fmt(A / 1e6, 3)} m²`); }, true, true),
    RECT: () => {
      let a = null;
      return { prompt: () => a ? '반대쪽 모서리 [@가로,세로]:' : '첫 모서리:', point(p) { if (!a) { a = p; lastPt = p; return; } snapshot(); addEnt({ t: 'pline', pts: [a, [p[0], a[1]], p, [a[0], p[1]]], closed: true }); changed(); endCmd(`사각형 ${fmt0(Math.abs(p[0] - a[0]))}×${fmt0(Math.abs(p[1] - a[1]))}`); }, preview(c) { if (a) { pv.poly([a, [c[0], a[1]], c, [a[0], c[1]]], true); showTip(`${fmt0(Math.abs(c[0] - a[0]))} × ${fmt0(Math.abs(c[1] - a[1]))}`); } } };
    },
    CIRCLE: () => {
      let c0 = null;
      return { prompt: () => c0 ? '반지름 [지름: D숫자]:' : '중심점:', point(p) { if (!c0) { c0 = p; lastPt = p; return; } snapshot(); addEnt({ t: 'circle', c: c0, r: dist(c0, p) }); changed(); endCmd(); }, text(s) { const m = s.match(/^d\s*([\d.]+)$/i); const v = m ? +m[1] / 2 : num(s); if (c0 && v) { snapshot(); addEnt({ t: 'circle', c: c0, r: v }); changed(); endCmd(); return true; } return false; }, preview(c) { if (c0) { pv.circle(c0, dist(c0, c)); showTip('R ' + fmt0(dist(c0, c))); } } };
    },
    ARC: () => {
      const pts = [];
      const arc3 = (a, b, c) => { const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])); if (Math.abs(d) < 1e-9) return null; const ux = ((a[0] ** 2 + a[1] ** 2) * (b[1] - c[1]) + (b[0] ** 2 + b[1] ** 2) * (c[1] - a[1]) + (c[0] ** 2 + c[1] ** 2) * (a[1] - b[1])) / d, uy = ((a[0] ** 2 + a[1] ** 2) * (c[0] - b[0]) + (b[0] ** 2 + b[1] ** 2) * (a[0] - c[0]) + (c[0] ** 2 + c[1] ** 2) * (b[0] - a[0])) / d; const ctr = [ux, uy], r = dist(ctr, a); let a0 = angOf(ctr, a), a1 = angOf(ctr, c); const ccw = ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) > 0; if (!ccw) [a0, a1] = [a1, a0]; return { t: 'arc', c: ctr, r, a0, a1 }; };
      return { prompt: () => ['호 시작점:', '호 두번째 점:', '호 끝점:'][pts.length], point(p) { pts.push(p); lastPt = p; if (pts.length === 3) { const a = arc3(...pts); if (a) { snapshot(); addEnt(a); changed(); } endCmd(); } }, preview(c) { if (pts.length === 1) pv.line(pts[0], c); if (pts.length === 2) { const a = arc3(pts[0], pts[1], c); if (a) drawEnt(a, '#ffd866'); } } };
    },
    TEXT: () => {
      let p0 = null;
      return { prompt: () => p0 ? `문자 내용 입력 (높이 ${D.text.h}):` : `문자 위치 [높이: H숫자] (높이 ${D.text.h}):`, point(p) { if (!p0) { p0 = p; return; } }, text(s) { const m = s.match(/^h\s*([\d.]+)$/i); if (m && !p0) { D.text.h = +m[1]; return true; } if (p0) { snapshot(); addEnt({ t: 'text', p: p0, h: D.text.h, s, rot: 0, layer: curLayer === '0' ? 'TEXT' : curLayer }); changed(); endCmd(); return true; } return false; }, preview(c) { if (!p0) drawText(c, D.text.h, 'ABC 가나다', 0, '#ffd866'); } };
    },
    DIM: () => {
      const pts = [];
      return { prompt: () => ['첫 치수 보조선 원점:', '둘째 치수 보조선 원점:', '치수선 위치:'][pts.length], point(p) { pts.push(p); lastPt = p; if (pts.length === 3) { snapshot(); lastDim = addEnt({ t: 'dim', a: pts[0], b: pts[1], off: p, layer: 'DIM' }); changed(); endCmd(`치수 = ${fmt0(dist(pts[0], pts[1]))}`); } }, preview(c) { if (pts.length === 1) { pv.line(pts[0], c); lenTip(pts[0], c); } if (pts.length === 2) drawEnt({ t: 'dim', a: pts[0], b: pts[1], off: c }, '#ffd866'); } };
    },
    DIST: () => {
      let a = null;
      return { prompt: () => a ? '두번째 점:' : '첫 점:', point(p) { if (!a) { a = p; lastPt = p; return; } const d = dist(a, p), dx = p[0] - a[0], dy = p[1] - a[1]; log(`거리 = ${fmt(d, 1)}   ΔX = ${fmt(dx, 1)}   ΔY = ${fmt(dy, 1)}   각도 = ${fmt(((angOf(a, p) * 180 / Math.PI) + 360) % 360, 2)}°`, '#3fdf8f'); toast(`거리 ${fmt(d, 1)} mm`); endCmd(); }, preview(c) { if (a) { pv.line(a, c); lenTip(a, c); } } };
    },
    IDPT: () => ({ prompt: () => '점 지정:', point(p) { log(`X = ${fmt(p[0], 1)}   Y = ${fmt(p[1], 1)}`, '#3fdf8f'); endCmd(); } }),
    BASE: () => ({ prompt: () => `3D 기준점 지정 (현재 ${fmt0(P.base.x)},${fmt0(P.base.y)}):`, point(p) { P.base = { x: Math.round(p[0]), y: Math.round(p[1]) }; ctx.touch('meta'); endCmd(`기준점 = ${P.base.x}, ${P.base.y}  (3D 원점·회전 중심)`); } }),
    COLUMN: () => place(`기둥(${D.column.mat === 'STEEL' ? D.column.sec : D.column.w + '×' + D.column.d})`, (p) => addEl(elWithDefaults('column', { p })), { optText: () => '[크기 600x600 / 각도 R숫자 / 철골(S)]', text: (s) => { const m = s.match(/^(\d+)\s*[x×*]\s*(\d+)$/i); if (m) { D.column.w = +m[1]; D.column.d = +m[2]; D.column.mat = 'RC'; return true; } const r = s.match(/^r\s*(-?[\d.]+)$/i); if (r) { D.column.rot = +r[1]; return true; } if (s.toUpperCase() === 'S') { D.column.mat = D.column.mat === 'STEEL' ? 'RC' : 'STEEL'; log(D.column.mat === 'STEEL' ? '철골기둥 ' + D.column.sec : 'RC기둥'); return true; } return false; }, previewEl: (p) => elWithDefaults('column', { p }) }),
    FOOTING: () => place(`기초(${D.footing.w}×${D.footing.d}×${D.footing.t})`, (p) => addEl(elWithDefaults('footing', { p })), { optText: () => '[크기 2400x2400]', text: (s) => { const m = s.match(/^(\d+)\s*[x×*]\s*(\d+)(?:\s*[x×*]\s*(\d+))?$/i); if (m) { D.footing.w = +m[1]; D.footing.d = +m[2]; if (m[3]) D.footing.t = +m[3]; return true; } return false; }, previewEl: (p) => elWithDefaults('footing', { p }) }),
    DOOR: () => openingCmd('door'),
    WINDOW: () => openingCmd('window'),
    ERASE: () => ({ needSel: true, begin() { snapshot(); const n = sel.size; removeIds(sel); sel.clear(); selChanged(); changed(); endCmd(`${n}개 삭제`); }, prompt: () => '' }),
    MOVE: () => xform('MOVE'), COPY: () => xform('COPY'), ROTATE: () => xform('ROTATE'), MIRROR: () => xform('MIRROR'), SCALE: () => xform('SCALE'),
    ARRAY: () => {
      let step = 0, nx = 3, ny = 1, dx = 8000, dy = 8000;
      return { needSel: true, prompt: () => ['열 수(X 방향 개수):', '행 수(Y 방향 개수):', 'X 간격(mm):', 'Y 간격(mm):'][step], point() { }, text(s) { const v = num(s); if (v == null) return false; if (step === 0) nx = Math.max(1, Math.round(v)); else if (step === 1) ny = Math.max(1, Math.round(v)); else if (step === 2) dx = v; else { dy = v; doArr(); return true; } step++; if (step === 3 && ny === 1) doArr(); return true; } };
      function doArr() { snapshot(); const c = C(); const { ents, els } = selected(); let n = 0; for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { if (!i && !j) continue; const f = G.fMove([i * dx, j * dy]); for (const e of ents) { const k = G.transformEnt(e, f); k.id = uid('d'); c.ents.push(k); n++; } for (const el of els) if (el.k !== 'opening') { const k = G.transformEl(el, f); k.id = uid('e'); c.els.push(k); n++; } } changed(); endCmd(`배열 ${nx}×${ny}, ${n}개 생성`); }
    },
    OFFSET: () => {
      let d = null, target = null;
      return { prompt: () => d == null ? `간격띄우기 거리 (예: 200):` : target ? '띄울 방향 쪽 점:' : '간격띄울 객체 선택 [Enter 종료]:', point(p) { if (d == null) return; if (!target) { const id = pickAt(p); const e = C().ents.find(x => x.id === id); if (!e) return log('선·폴리선·원·호를 선택하세요'); target = e; sel.clear(); sel.add(id); selChanged(); return; } const n = G.offsetEnt(target, d, p); if (n) { snapshot(); addEnt(n); changed(); } target = null; sel.clear(); selChanged(); }, text(s) { const v = num(s); if (v != null && d == null) { d = Math.abs(v); return true; } return false; }, enter() { endCmd(); } };
    },
    TRIM: () => ({ prompt: () => '자를 부분 선택 (경계: 모든 객체) [Enter 종료]:', point(p) { const id = pickAt(p); const c = C(); const e = c.ents.find(x => x.id === id); if (!e) return; if (e.t !== 'line') return log('현재 TRIM은 선(LINE)만 지원합니다. 폴리선은 분해(X) 후 사용하세요.'); const r = G.trimLine(e, p, allSegs(new Set([e.id]))); if (!r) return; snapshot(); if (r.remove) c.ents = c.ents.filter(x => x.id !== e.id); else { const i = c.ents.indexOf(e); c.ents.splice(i, 1, ...r.replace); } changed(); }, enter() { endCmd(); } }),
    EXTEND: () => ({ prompt: () => '연장할 선의 끝 쪽 선택 [Enter 종료]:', point(p) { const id = pickAt(p); const c = C(); const e = c.ents.find(x => x.id === id); if (!e || e.t !== 'line') return log('선(LINE)을 선택하세요'); const r = G.extendLine(e, p, allSegs(new Set([e.id]))); if (!r) return log('연장할 경계가 없습니다'); snapshot(); c.ents[c.ents.indexOf(e)] = r; changed(); }, enter() { endCmd(); } }),
    FILLET: () => {
      let e1 = null, p1 = null;
      return { prompt: () => e1 ? '두번째 선 선택:' : `첫번째 선 선택 [반지름(R)] (R=${D.fillet.r}):`, text(s) { if (/^r$/i.test(s)) { askNum('모깎기 반지름(mm)', D.fillet.r).then(v => { if (v != null) { D.fillet.r = v; ctx.touch('meta'); setPrompt(cmd?.prompt() || '명령:'); } }); return true; } const m = s.match(/^r\s*([\d.]+)$/i); if (m) { D.fillet.r = +m[1]; return true; } return false; },
        point(p) { const id = pickAt(p); const c = C(); const e = c.ents.find(x => x.id === id && x.t === 'line'); if (!e) return log('선을 선택하세요'); if (!e1) { e1 = e; p1 = p; sel.clear(); sel.add(e.id); selChanged(); return; }
          const r = D.fillet.r > 0 ? G.filletR(e1, p1, e, p, D.fillet.r) : G.filletZero(e1, p1, e, p); if (!r) { log('모깎기 불가 (평행선 또는 반지름 과대)'); return endCmd(); }
          snapshot(); c.ents[c.ents.indexOf(e1)] = r[0]; c.ents[c.ents.indexOf(e)] = r[1]; if (r[2]) c.ents.push(r[2]); sel.clear(); selChanged(); changed(); endCmd(); } };
    },
    EXPLODE: () => ({ needSel: true, prompt: () => '', begin() { snapshot(); const c = C(); let n = 0; const keep = []; for (const e of c.ents) { if (sel.has(e.id) && (e.t === 'pline' || e.t === 'dim')) { for (const [a, b] of G.entSegs(e)) { keep.push({ id: uid('d'), t: 'line', a, b, layer: e.layer }); n++; } } else keep.push(e); } for (const el of c.els) if (sel.has(el.id) && el.k !== 'opening') { for (const [a, b] of G.elSegs(el, hostOf(c))) { keep.push({ id: uid('d'), t: 'line', a, b, layer: `${el.k.toUpperCase()}` }); n++; } } c.els = c.els.filter(el => !sel.has(el.id)); c.ents = keep; sel.clear(); selChanged(); changed(); endCmd(`${n}개 선으로 분해`); } }),
    CONVERT: () => ({ prompt: () => '', begin() { convertLines(); } }),
    ZOOM: () => ({ prompt: () => '줌 [전체(E)/창(W): 두 점]:', pts: [], text(s) { if (/^e/i.test(s)) { zoomExt(); endCmd(); return true; } if (/^w/i.test(s)) { this.win = true; return true; } return false; }, point(p) { this.pts.push(p); if (this.pts.length === 2) { const [a, b] = this.pts; zoomTo({ x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) }, 0.02); endCmd(); } }, preview(c) { if (this.pts.length === 1) { const a = this.pts[0]; pv.poly([a, [c[0], a[1]], c, [a[0], c[1]]], true); } } }),
    ZOOMEXT: () => { zoomExt(); return null; },
    UNDO: () => { doUndo(); return null; }, REDO: () => { doRedo(); return null; },
    LAYER: () => { layerManager(); return null; },
    SELALL: () => { const c = C(); c.ents.forEach(e => sel.add(e.id)); c.els.forEach(e => sel.add(e.id)); selChanged(); return null; },
    HATCH: () => {
      let a = null;
      return { prompt: () => a ? '반대 모서리 (사각 영역):' : `해치할 닫힌 영역 안을 클릭 [패턴(P)/축척(S)] (${G.HATCH_NAMES[D.hatch.pat]}, ×${D.hatch.sc}) 또는 사각형 첫 점은 A 입력 후:`,
        point(p) {
          if (a === true) { a = p; return; }
          if (Array.isArray(a)) { snapshot(); addEnt({ t: 'hatch', pts: [a, [p[0], a[1]], p, [a[0], p[1]]], pat: D.hatch.pat, sc: D.hatch.sc }); changed(); a = null; return; }
          const c = C(); const host = hostOf(c);
          const cand = [...c.ents.filter(e => (e.t === 'pline' && e.closed) || e.t === 'circle').map(e => e.t === 'circle' ? G.arcPts(e.c, e.r, 0, Math.PI * 2 - 1e-6, 48) : e.pts), ...c.els.filter(e => e.k !== 'opening').map(e => elOutline(e, host)).filter(Boolean)]
            .filter(pts => pointInPolyLocal(p, pts)).sort((x, y) => Math.abs(polyArea(x)) - Math.abs(polyArea(y)))[0];
          if (!cand) return log('닫힌 폴리선·원·객체 안을 클릭하세요 (사각 영역은 A)', '#ef5f5f');
          snapshot(); addEnt({ t: 'hatch', pts: deep(cand), pat: D.hatch.pat, sc: D.hatch.sc }); changed(); log(`해치 면적 ${fmt(Math.abs(polyArea(cand)) / 1e6, 2)} m²`);
        },
        text(s) { const u = s.toUpperCase(); if (u === 'A') { a = true; return true; } if (u === 'P') { dialog({ title: '해치 패턴', fields: [{ key: 'p', label: '패턴', type: 'select', options: Object.entries(G.HATCH_NAMES), value: D.hatch.pat }, { key: 's', label: '축척', type: 'number', value: D.hatch.sc }] }).then(v => { if (v) { D.hatch.pat = v.p; D.hatch.sc = v.s || 1; ctx.touch('meta'); setPrompt(cmd?.prompt() || '명령:'); } }); return true; } const m = s.match(/^s\s*([\d.]+)$/i); if (m) { D.hatch.sc = +m[1]; return true; } return false; },
        enter() { endCmd(); }, preview(c) { if (Array.isArray(a)) pv.poly([a, [c[0], a[1]], c, [a[0], c[1]]], true); } };
    },
    INSERT: () => {
      let name = null, rotD = 0, sc = 1;
      return { begin() { const names = blockNames(P.blocks); dialog({ title: '블록 삽입', fields: [{ key: 'n', label: '블록', type: 'select', options: names.map(n => [n, (P.blocks[n] ? '[사용자] ' : '') + n]), value: names[0] }, { key: 'r', label: '회전(°)', type: 'number', value: 0 }, { key: 's', label: '축척', type: 'number', value: 1 }], ok: '배치' }).then(v => { if (!v) return cancel(true); name = v.n; rotD = v.r || 0; sc = v.s || 1; setPrompt(cmd?.prompt() || '명령:'); }); },
        prompt: () => name ? `${name} 삽입점 [회전 R숫자] (Enter 종료):` : '블록 선택…',
        point(p) { if (!name) return; snapshot(); addEnt({ t: 'insert', name, p, rot: rotD, sc }); changed(); },
        text(s) { const m = s.match(/^r\s*(-?[\d.]+)$/i); if (m) { rotD = +m[1]; return true; } return false; },
        enter() { endCmd(); }, preview(c) { if (name) drawEnt({ t: 'insert', name, p: c, rot: rotD, sc }, '#ffd866'); } };
    },
    BLOCK: () => ({ needSel: true, base: null, prompt() { return '블록 기준점:'; },
      point(p) { const { ents } = selected(); if (!ents.length) { log('선·문자 등 요소를 선택하세요 (객체는 블록 불가)'); return endCmd(); }
        dialog({ title: '블록 정의', fields: [{ key: 'n', label: '블록 이름', value: '블록' + (Object.keys(P.blocks).length + 1) }] }).then(v => { if (!v?.n) return endCmd();
          P.blocks[v.n] = ents.flatMap(e => e.t === 'insert' ? expandInsert(e, P.blocks) : [e]).map(e => { const n = G.transformEnt(e, G.fMove([-p[0], -p[1]])); delete n.id; delete n.layer; return n; });
          snapshot(); removeIds(new Set(ents.map(e => e.id))); addEnt({ t: 'insert', name: v.n, p, rot: 0, sc: 1 }); ctx.touch('meta'); sel.clear(); selChanged(); changed(); endCmd(`블록 "${v.n}" 정의 (${ents.length}개 요소)`); }); } }),
    LEADER: () => {
      const pts = [];
      return { prompt: () => pts.length ? '다음 점 [Enter: 문자 입력]:' : '지시선 화살표 위치:', point(p) { pts.push(p); lastPt = p; },
        enter() { if (pts.length < 2) return endCmd(); dialog({ title: '지시선 문자', fields: [{ key: 's', label: '내용', value: '' }] }).then(v => { snapshot(); addEnt({ t: 'leader', pts: pts.slice(), s: v?.s || '', h: D.text.h, layer: curLayer === '0' ? 'TEXT' : curLayer }); changed(); endCmd(); }); },
        preview(c) { if (pts.length) pv.poly([...pts, applyOrtho(c)], false); } };
    },
    DIMCONT: () => {
      const base = lastDim || [...C().ents].reverse().find(e => e.t === 'dim'); if (!base) { log('먼저 치수(DLI)를 하나 작성하세요'); return null; }
      let prev = base;
      return { prompt: () => '다음 치수 보조선 원점 [Enter 종료]:', point(p) { const d = dimGeom(prev); const nrm = perp(norm(sub(prev.b, prev.a))); const off = add(p, mul(nrm, d.o)); snapshot(); const e = addEnt({ t: 'dim', a: prev.b, b: p, off, layer: 'DIM' }); changed(); prev = e; lastDim = e; lastPt = p; log(`치수 = ${fmt0(dist(e.a, e.b))}`); },
        begin() { lastPt = prev.b; }, enter() { endCmd(); }, preview(c) { const d = dimGeom(prev); const nrm = perp(norm(sub(prev.b, prev.a))); drawEnt({ t: 'dim', a: prev.b, b: c, off: add(c, mul(nrm, d.o)) }, '#ffd866'); } };
    },
    DIMRAD: () => ({ prompt: () => '원 또는 호 선택:', point(p) { const id = pickAt(p); const e = C().ents.find(x => x.id === id && (x.t === 'circle' || x.t === 'arc')); if (!e) return log('원·호를 선택하세요'); snapshot(); addEnt({ t: 'rdim', c: e.c, r: e.r, ang: angOf(e.c, p), layer: 'DIM' }); changed(); endCmd(`R = ${fmt(e.r, 1)}`); } }),
    DIMANG: () => {
      const pts = [];
      return { prompt: () => ['각도 꼭짓점:', '첫번째 변 위의 점:', '두번째 변 위의 점:', '호 위치:'][pts.length], point(p) { pts.push(p); lastPt = pts[0]; if (pts.length === 4) { snapshot(); addEnt({ t: 'adim', c: pts[0], a: pts[1], b: pts[2], r: dist(pts[0], p), layer: 'DIM' }); changed(); endCmd(); } },
        preview(c) { if (pts.length === 1 || pts.length === 2) pv.line(pts[0], c); if (pts.length === 3) drawEnt({ t: 'adim', c: pts[0], a: pts[1], b: pts[2], r: dist(pts[0], c) }, '#ffd866'); } };
    },
    STRETCH: () => {
      let w0 = null, win = null, base = null;
      return { prompt: () => !win ? (w0 ? '걸침 창 반대 모서리:' : '신축할 부분을 걸침 창으로 지정 — 첫 모서리:') : base ? '대상점:' : '기준점:',
        point(p) { if (!w0) { w0 = p; return; } if (!win) { win = { x0: Math.min(w0[0], p[0]), y0: Math.min(w0[1], p[1]), x1: Math.max(w0[0], p[0]), y1: Math.max(w0[1], p[1]) }; return; } if (!base) { base = p; lastPt = p; return; }
          const d = sub(p, base); snapshot(); const c = C(); c.ents = c.ents.map(e => G.stretchObj(e, win, d)); c.els = c.els.map(e => e.k === 'opening' ? e : G.stretchObj(e, win, d)); changed(); endCmd('신축 완료'); },
        preview(c) { if (w0 && !win) { g.setLineDash([5, 4]); pv.poly([w0, [c[0], w0[1]], c, [w0[0], c[1]]], true); g.setLineDash([]); } if (base) { pv.line(base, c); lenTip(base, c); const d = sub(c, base); g.globalAlpha = 0.6; for (const e of C().ents) { const n = G.stretchObj(e, win, d); if (JSON.stringify(n) !== JSON.stringify(e)) drawEnt(n, '#ffd866'); } for (const el of C().els) { if (el.k === 'opening') continue; const n = G.stretchObj(el, win, d); if (JSON.stringify(n) !== JSON.stringify(el)) { const o = elOutline(n, () => null); if (o) pv.poly(o, true); } } g.globalAlpha = 1; } } };
    },
    BREAK: () => {
      let e = null, p1 = null;
      return { prompt: () => !e ? '끊을 선 선택(선택점이 첫 끊기점):' : '두번째 끊기점:', point(p) { if (!e) { const id = pickAt(p); e = C().ents.find(x => x.id === id && x.t === 'line'); if (!e) return log('선을 선택하세요'); p1 = p; return; } const r = G.breakLine(e, p1, p); snapshot(); const c = C(); c.ents.splice(c.ents.indexOf(e), 1, ...r); changed(); endCmd('끊기 완료'); } };
    },
    JOIN: () => ({ needSel: true, prompt: () => '', begin() { const { ents } = selected(); const r = G.joinChain(ents.filter(e => e.t === 'line' || e.t === 'pline')); if (!r) { log('끝점이 이어진 선·폴리선만 결합할 수 있습니다', '#ef5f5f'); return endCmd(); } snapshot(); removeIds(new Set(ents.filter(e => e.t === 'line' || e.t === 'pline').map(e => e.id))); const n = addEnt({ ...r, layer: ents[0].layer }); sel.clear(); sel.add(n.id); selChanged(); changed(); endCmd(`결합: ${r.closed ? '닫힌 ' : ''}폴리선 ${r.pts.length}점`); } }),
    MATCHPROP: () => {
      let src = null; const ELK = ['t', 'mat', 'h', 'w', 'd', 'sec', 'z', 'hh', 'sys', 'zone', 'rr', 'dz', 'z0', 'rebar'];
      return { prompt: () => src ? '대상 객체 선택 [Enter 종료]:' : '원본 객체 선택:', point(p) { const id = pickAt(p); const c = C(); const o = c.ents.find(x => x.id === id) || c.els.find(x => x.id === id); if (!o) return; if (!src) { src = o; sel.clear(); sel.add(id); selChanged(); return; }
          snapshot(); if (src.k && o.k === src.k) for (const k of ELK) { if (src[k] !== undefined) o[k] = deep(src[k]); } else if (!src.k && !o.k) { o.layer = src.layer; if (o.t === 'text' && src.t === 'text') o.h = src.h; if (o.t === 'hatch' && src.t === 'hatch') { o.pat = src.pat; o.sc = src.sc; } } else { log('같은 종류끼리만 적용됩니다'); return; } changed(); }, enter() { endCmd(); } };
    },
    QSELECT: () => { quickSelect(); return null; },
    TAKEOFFMENU: () => { takeoffMenu(); return null; }, ELEV4: () => { makeElevations(); return null; }, FURNPICK: () => { pickFurn().then(t => { if (t) { P.view.lastFurn = t; startCmd('FURNPLACE'); } }); return null; }, PLOTDLG: () => { plotDialog(); return null; }, LAYOUTTOG: () => { setSpace(space === 'layout' ? 'model' : 'layout'); return null; }, OSNAPSET: () => { snapSettings(); return null; },
    TEXTEDIT: () => ({ prompt: () => '편집할 문자·치수·지시선 선택:', point(p) { const id = pickAt(p); const e = C().ents.find(x => x.id === id); if (e) { editText(e); endCmd(); } } }),
    REVISION: () => { revisionMenu(); return null; },
    PASTECLIP: () => { if (!clip) { log('클립보드가 비어 있습니다 (Ctrl+C로 복사)'); return null; } return { prompt: () => '붙여넣을 위치(기준점 기준):', point(p) { snapshot(); const d = sub(p, clip.base); const f = G.fMove(d); const idm = new Map(); for (const e of clip.ents) { const n = G.transformEnt(e, f); n.id = uid('d'); C().ents.push(n); } for (const el of clip.els.filter(x => x.k !== 'opening')) { const n = G.transformEl(el, f); const nid = uid('e'); idm.set(el.id, nid); n.id = nid; C().els.push(n); } for (const el of clip.els.filter(x => x.k === 'opening' && idm.has(x.host))) C().els.push({ ...deep(el), id: uid('e'), host: idm.get(el.host) }); changed(); endCmd(`붙여넣기 ${clip.ents.length + clip.els.length}개`); }, preview(c) { const f = G.fMove(sub(c, clip.base)); g.globalAlpha = 0.6; for (const e of clip.ents.slice(0, 300)) drawEnt(G.transformEnt(e, f), '#ffd866'); for (const el of clip.els.slice(0, 300)) { if (el.k === 'opening') continue; const o = elOutline(G.transformEl(el, f), () => null); if (o) pv.poly(o, true); } g.globalAlpha = 1; } }; },
    UCAL: () => {
      const u = ulOf(); if (!u) { log('PDF 언더레이가 없습니다'); return null; } const pts = [];
      return { prompt: () => pts.length ? '두번째 점 (치수를 아는 거리의 끝):' : 'PDF 축척 보정 — 길이를 아는 선분의 첫 점:', point(p) { pts.push(p); lastPt = p; if (pts.length === 2) { askNum('두 점 사이 실제 거리(mm)', Math.round(dist(pts[0], pts[1]))).then(v => { if (!v) return endCmd(); const k = v / dist(pts[0], pts[1]); const o = pts[0]; u.x = o[0] + (u.x - o[0]) * k; u.y = o[1] + (u.y - o[1]) * k; u.w *= k; u.h *= k; u.cal = true; ctx.touch('meta'); dirty = true; endCmd(`축척 보정 완료 (배율 ${fmt(k, 4)})`); }); } }, preview(c) { if (pts.length) { pv.line(pts[0], c); lenTip(pts[0], c); } } };
    },
    UMOVE: () => { const u = ulOf(); if (!u) return null; let b = null; return { prompt: () => b ? '대상점:' : 'PDF 이동 기준점:', point(p) { if (!b) { b = p; lastPt = p; return; } u.x += p[0] - b[0]; u.y += p[1] - b[1]; ctx.touch('meta'); dirty = true; endCmd(); }, preview(c) { if (b) pv.line(b, c); } }; },
    TAKEOFF: (cfg) => {
      const pts = []; const isCount = cfg.type === 'count';
      return { prompt: () => isCount ? `${cfg.name}: 개수 위치 클릭 (${pts.length}개) [Enter 완료]:` : `${cfg.name}: ${cfg.type === 'area' ? '영역' : '경로'} 점 (${pts.length}) [U 되돌리기 / Enter 완료]:`,
        point(p) { pts.push(p); lastPt = isCount ? null : p; dirty = true; }, text(s) { if (s.toUpperCase() === 'U') { pts.pop(); lastPt = pts[pts.length - 1] || null; return true; } return false; },
        enter() { if ((isCount && !pts.length) || (!isCount && pts.length < (cfg.type === 'area' ? 3 : 2))) return endCmd(); P.takeoffs ||= []; const t = { id: uid('t'), sheet: sid, type: cfg.type, pts: pts.slice(), code: cfg.code, mult: cfg.mult || 1, name: cfg.name, color: cfg.color, at: Date.now() }; P.takeoffs.push(t); ctx.touch('meta'); ctx.bus.emit('model', {}); const q = toQty(t); endCmd(`${cfg.name}: ${fmt(q.qty, 3)} ${q.unit} → ${cfg.code || '(내역 미지정)'}`); },
        preview(c) { g.save(); g.strokeStyle = cfg.color; g.fillStyle = cfg.color + '33'; if (isCount) { for (const p of pts) { const q = w2s(p); g.beginPath(); g.arc(q[0], q[1], 7, 0, Math.PI * 2); g.fill(); g.stroke(); } } else { const all = [...pts, applyOrtho(c)]; path(all, cfg.type === 'area'); if (cfg.type === 'area') g.fill(); g.lineWidth = 2; g.stroke(); const q = toQty({ type: cfg.type, pts: all, mult: cfg.mult }); showTip(`${fmt(q.raw, 2)} ${cfg.type === 'area' ? 'm²' : 'm'}${cfg.mult !== 1 ? ` ×${cfg.mult} = ${fmt(q.qty, 2)}` : ''}`); } g.restore(); } };
    },
    SECTIONCUT: () => {
      const pts = [];
      return { prompt: () => pts.length === 0 ? '단면 절단선 시작점:' : pts.length === 1 ? '절단선 끝점:' : '보는 방향 쪽 아무 점 클릭:',
        point(p) { if (pts.length < 2) { pts.push(pts.length ? applyOrtho(p) : p); lastPt = pts.length === 1 ? p : null; return; } const a = pts[0], b = pts[1], d = norm(sub(b, a)), side = dot(sub(p, a), [-d[1], d[0]]) >= 0 ? 1 : -1; endCmd(); makeSection({ a, b, side, mode: 'section' }); },
        preview(c) { if (pts.length === 1) { pv.line(pts[0], applyOrtho(c)); lenTip(pts[0], applyOrtho(c)); } else if (pts.length === 2) { pv.line(pts[0], pts[1]); const d = norm(sub(pts[1], pts[0])), side = dot(sub(c, pts[0]), [-d[1], d[0]]) >= 0 ? 1 : -1, m = mid(pts[0], pts[1]), n = mul([-d[1], d[0]], side * 1500); pv.line(m, add(m, n)); pv.line(pts[0], add(pts[0], n)); pv.line(pts[1], add(pts[1], n)); } } };
    },
    FURNPLACE: () => {
      const v = P.view.lastFurn || { type: 'sofa', rot: 0 }; let ty = v.type, rot = v.rot || 0;
      const make = (p) => { const F = FURN[ty]; return { k: 'furn', type: ty, p, w: F.w, d: F.d, h: F.h, rot, zone: sheet().name }; };
      return { prompt: () => `${FURN[ty].name} 배치점 [T 종류 · R 90° 회전 · 각도 숫자 입력(현재 ${rot}°) · Enter 종료]:`,
        point(p) { snapshot(); const e = make(p); e.id = uid('e'); C().els.push(e); changed(); P.view.lastFurn = { type: ty, rot }; },
        text(s) { const u = s.toUpperCase(); if (u === 'R') { rot = (rot + 90) % 360; return true; } if (/^-?\d+(\.\d+)?$/.test(s)) { rot = +s; return true; } if (u === 'T') { pickFurn().then(t => { if (t) { ty = t.type; rot = t.rot; } dirty = true; }); return true; } return false; },
        enter() { endCmd(); }, preview(c) { const e = make(c); g.globalAlpha = 0.7; drawEl(e, C(), 'hover'); g.globalAlpha = 1; } };
    },
    WAND: (cfg) => {
      let n = 0;
      return { prompt: () => `${cfg.name}: 방(닫힌 영역) 안쪽을 클릭 (${n}개) [Enter 완료]:`,
        point(p) { const r = wandAt(p); if (r.err) { log(r.err, '#ff8888'); return; } if (Math.abs(polyArea(r.pts)) < 1e4) { log('영역이 너무 작습니다', '#ff8888'); return; } P.takeoffs ||= []; const t = { id: uid('t'), sheet: sid, type: 'area', pts: r.pts, code: cfg.code, mult: cfg.mult || 1, name: cfg.name, color: cfg.color, at: Date.now(), auto: true }; P.takeoffs.push(t); n++; ctx.touch('meta'); ctx.bus.emit('model', {}); const q = toQty(t); log(`${cfg.name} #${n}: ${fmt(q.qty, 2)} ${q.unit} (꼭짓점 ${r.pts.length})`, '#3fdf8f'); dirty = true; },
        enter() { endCmd(n ? `영역 ${n}개 산출 완료` : null); } };
    },
    REVCLOUD: () => {
      let a = null;
      return { prompt: () => a ? '반대쪽 모서리:' : `리비전 구름 첫 모서리 (△${(nextRev(P, 'minor').major)}.${nextRev(P, 'minor').minor}):`, point(p) { if (!a) { a = p; return; } const v = nextRev(P, (P.prevs || []).length ? 'minor' : 'major'); snapshot(); addEnt({ t: 'cloud', pts: [a, [p[0], a[1]], p, [a[0], p[1]]], label: revName(v.major, v.minor).replace('Rev', ''), layer: 'REV' }); changed(); endCmd(); }, preview(c) { if (a) drawEnt({ t: 'cloud', pts: [a, [c[0], a[1]], c, [a[0], c[1]]] }, '#ffd866'); } };
    },
    PROGMARK: () => {
      if (!P.bill.periods.length) { toast('기성 툴에서 회차를 먼저 만드세요', 'err'); return null; }
      const pts = [];
      return { prompt: () => pts.length ? '다음 점 [Enter: 완료]:' : '기성 영역 첫 점 (다각형):', point(p) { pts.push(p); lastPt = p; },
        text(s) { if (s.toUpperCase() === 'U') { pts.pop(); return true; } return false; },
        async enter() {
          if (pts.length < 3) return endCmd();
          const v = await dialog({ title: '기성 영역 진척률', fields: [{ key: 'pi', label: '회차', type: 'select', options: P.bill.periods.map((p, i) => [i, p.name]), value: progView ?? P.bill.periods.length - 1 }, { key: 'pct', label: '누계 진척률(%)', type: 'number', value: 100 }, { key: 'name', label: '영역 메모 (예: 1공구 기둥)', value: '' }, { key: 'scope', label: '적용 범위', type: 'select', options: [['sheet', '현재 도면 객체만'], ['level', '같은 층 모든 도면 객체']], value: 'level' }, { key: 'kind', label: '객체 종류', type: 'select', options: [['', '전체'], ...Object.entries(KINDS).filter(([k]) => k !== 'opening').map(([k, d]) => [k, d.name])], value: '' }], ok: '적용' });
          if (!v) return endCmd();
          const per = P.bill.periods[+v.pi]; per.prog ||= {}; per.zones ||= [];
          const inside = (p) => pointInPolyLocal(p, pts); let n = 0;
          for (const sh of P.sheets.filter(x => v.scope === 'sheet' ? x.id === sid : x.level === sheet().level)) {
            const cc = P.content[sh.id]; const host = hostOf(cc);
            for (const el of cc.els) { if (el.k === 'opening' || (v.kind && el.k !== v.kind) || isRefElement(el, sh, P)) continue; const o = elOutline(el, host); if (!o) continue; const ctr = [o.reduce((a, q) => a + q[0], 0) / o.length, o.reduce((a, q) => a + q[1], 0) / o.length]; if (inside(ctr)) { per.prog[el.id] = Math.max(0, Math.min(100, v.pct)); n++; } }
          }
          per.zones.push({ sheet: sid, pts: pts.slice(), pct: v.pct, name: v.name, kind: v.kind, at: Date.now() });
          progView = +v.pi; S.progView = progView; ctx.touch('meta'); ctx.bus.emit('model', {}); buildToolbar(); dirty = true; endCmd(`${per.name}: 영역 내 ${n}개 객체 누계 ${v.pct}% 적용`);
        },
        preview(c) { if (pts.length) { g.fillStyle = '#e6b45033'; path([...pts, c], true); g.fill(); g.stroke(); } } };
    },
    GRIP: (gr) => ({ prompt: () => '새 위치 지정:', begin() { lastPt = gr.p; }, point(p) { snapshot(); const c = C(); const arr = gr.el ? c.els : c.ents; const o = arr.find(x => x.id === gr.id); if (o) { if (gr.key === 'pts') o.pts[gr.i] = p; else o[gr.key] = p; } changed(); endCmd(); }, preview(c) { pv.line(gr.p, c); lenTip(gr.p, c); } }),
  };
  function mepText(k, s) {
    const m = s.match(/^(\d+)\s*[x×*]\s*(\d+)$/i); if (m) { D[k].w = +m[1]; D[k].hh = +m[2]; return true; }
    const z = s.match(/^z\s*(-?[\d.]+)$/i); if (z) { D[k].z = +z[1]; log(`설치 높이 FL+${D[k].z}`); return true; }
    if (k === 'pipe' && /^\d+$/.test(s) && !lastPt) { D.pipe.w = D.pipe.hh = +s; return true; }
    return false;
  }
  function polyCollect(label, done, closeAuto = false, measure = false) {
    const pts = [];
    return {
      prompt: () => pts.length ? `다음 점 [닫기(C)/되돌리기(U)/완료: Enter]:` : `${label} 첫 점:`,
      point(p) { pts.push(p); lastPt = p; },
      text(s) { const u = s.toUpperCase(); if (u === 'C' && pts.length > 2) { finish(true); return true; } if (u === 'U') { pts.pop(); lastPt = pts[pts.length - 1] || null; return true; } return false; },
      enter() { finish(closeAuto); },
      preview(c) { if (pts.length) { const b = applyOrtho(c); pv.poly([...pts, b], closeAuto && pts.length > 1); lenTip(pts[pts.length - 1], b); } },
    };
    function finish(closed) { if (pts.length < (closed ? 3 : 2)) return endCmd(); if (!measure) snapshot(); done(pts.slice(), closed); if (!measure) changed(); endCmd(); }
  }
  function openingCmd(kind) {
    const d = D[kind]; let n = 0;
    return {
      prompt: () => `${kind === 'door' ? '문' : '창'}(${d.w}×${d.h}${kind === 'window' ? ', 창대 ' + d.sill : ''}) 놓을 벽 위치 [크기 900x2100]:`,
      point(p) {
        const c = C(); const wall = c.els.filter(e => e.k === 'wall').map(w => ({ w, cl: closestOnSeg(p, w.a, w.b) })).filter(x => x.cl.d < x.w.t / 2 + 8 / V.s).sort((a, b) => a.cl.d - b.cl.d)[0];
        if (!wall) return log('벽 위를 지정하세요', '#ef5f5f');
        const L = dist(wall.w.a, wall.w.b); const s = clamp(wall.cl.t * L - d.w / 2, 0, Math.max(0, L - d.w));
        snapshot(); addEl({ k: 'opening', host: wall.w.id, s: Math.round(s), w: d.w, h: d.h, sill: d.sill, kind }); n++; changed();
      },
      text(s) { const m = s.match(/^(\d+)\s*[x×*]\s*(\d+)$/i); if (m) { d.w = +m[1]; d.h = +m[2]; return true; } return false; },
      enter() { endCmd(n ? `${n}개 배치` : ''); },
      preview(c) { const w = C().els.filter(e => e.k === 'wall').map(w => ({ w, cl: closestOnSeg(c, w.a, w.b) })).sort((a, b) => a.cl.d - b.cl.d)[0]; if (w && w.cl.d < w.w.t / 2 + 8 / V.s) { const L = dist(w.w.a, w.w.b); const s = clamp(w.cl.t * L - d.w / 2, 0, Math.max(0, L - d.w)); drawOpening({ kind, w: d.w, s }, w.w, 'hover'); } },
    };
  }
  const nextLabel = (l) => /^\d+$/.test(l) ? String(+l + 1) : /^[A-Y]$/i.test(l) ? String.fromCharCode(l.charCodeAt(0) + 1) : l + "'";
  async function askNum(label, v) { const r = await dialog({ title: label, fields: [{ key: 'v', label, type: 'number', value: v }] }); return r?.v ?? null; }

  function pointInPolyLocal(p, pts) { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if (((a[1] > p[1]) !== (b[1] > p[1])) && (p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0])) c = !c; } return c; }
  async function editText(e) {
    const key = e.t === 'dim' ? 'ovr' : 's'; if (!['text', 'dim', 'leader', 'grid'].includes(e.t)) return;
    const k = e.t === 'grid' ? 'label' : key;
    const v = await dialog({ title: e.t === 'dim' ? '치수 문자 수정 (비우면 실제 길이)' : '문자 편집', fields: [{ key: 'v', label: '내용', value: e[k] || '' }, ...(e.t === 'text' || e.t === 'leader' ? [{ key: 'h', label: '높이', type: 'number', value: e.h || D.text.h }] : [])] });
    if (!v) return; snapshot(); if (e.t === 'dim' && !v.v) delete e.ovr; else e[k] = v.v; if (v.h) e.h = v.h; changed();
  }
  async function quickSelect() {
    const c = C(); const types = [...new Set([...c.ents.map(e => 'e:' + e.t), ...c.els.map(e => 'k:' + e.k)])];
    const label = (t) => t.startsWith('k:') ? '[객체] ' + (KINDS[t.slice(2)]?.name || t) : '[요소] ' + ({ line: '선', pline: '폴리선', circle: '원', arc: '호', text: '문자', dim: '치수', grid: '그리드', hatch: '해치', insert: '블록', leader: '지시선', rdim: '반지름치수', adim: '각도치수' }[t.slice(2)] || t);
    const v = await dialog({ title: '빠른 선택', fields: [{ key: 'ty', label: '종류', type: 'select', options: [['', '전체'], ...types.map(t => [t, label(t)])], value: '' }, { key: 'la', label: '레이어(요소)', type: 'select', options: [['', '전체'], ...allLayers().map(l => [l, l])], value: '' }, { key: 'pk', label: '속성 이름 (예: mat, t, zone, tag)', value: '' }, { key: 'pv', label: '속성 값 (같음)', value: '' }, { key: 'add', label: '현재 선택에 추가', type: 'checkbox', value: false }], ok: '선택' });
    if (!v) return; if (!v.add) sel.clear(); let n = 0;
    const ok = (o) => (!v.ty || (v.ty.startsWith('k:') ? o.k === v.ty.slice(2) : o.t === v.ty.slice(2) && !o.k)) && (!v.la || o.layer === v.la) && (!v.pk || String(o[v.pk] ?? '') === v.pv);
    for (const e of c.ents) if (ok(e)) { sel.add(e.id); n++; } for (const e of c.els) if (ok(e) && (!v.la)) { sel.add(e.id); n++; }
    selChanged(); log(`빠른 선택: ${n}개`);
  }
  async function revisionMenu() {
    if (cmp) { cmp = null; buildToolbar(); dirty = true; return; }
    const list = P.prevs || []; const old = revisions(P, sid);
    const nx = (k) => { const v = nextRev(P, k); return revName(v.major, v.minor); };
    const v = await dialog({ title: `리비전 관리 — ${sheet().name}`, body: `<div class="note">Rev는 프로젝트 전체(모든 도면) 스냅샷입니다. 비교하면 이 도면의 추가(초록)·삭제(빨강 점선)·변경(주황→노랑)이 표시되고, 3D 상단 Rev 버튼으로 같은 변경을 입체로 확인합니다.</div>`, fields: [{ key: 'a', label: '작업', type: 'select', value: 'minor', options: [
      ['minor', list.length ? `현재 상태 저장 → ${nx('minor')} (부분 수정)` : '현재 상태 저장 → Rev1'], ...(list.length ? [['major', `현재 상태 저장 → ${nx('major')} (주요 개정)`]] : []),
      ...[...list].reverse().map(r => ['cmp:' + r.id, `비교: ${r.name}${r.approval?.status === '승인' ? '✓' : ''} → 현재 (${new Date(r.at).toLocaleDateString('ko-KR')}${r.note ? ' · ' + r.note.slice(0, 20) : ''})`]),
      ...[...list].reverse().map(r => ['cloud:' + r.id, `리비전 구름 자동 생성: ${r.name} 이후 변경 부위`]),
      ...[...list].reverse().map(r => ['rs:' + r.id, `이 도면만 ${r.name}로 되돌리기`]),
      ...[...list].reverse().map(r => ['rp:' + r.id, `프로젝트 전체를 ${r.name}로 되돌리기`]),
      ...old.map((r, i) => ['ocmp:' + i, `(이전 방식) 비교: ${r.name}`])] }, { key: 'n', label: '변경 내용 메모 (저장 시)', type: 'textarea', rows: 2, value: '' }], ok: '실행' });
    if (!v) return;
    if (v.a === 'minor' || v.a === 'major') { const r = await createRev(ctx, { kind: list.length ? v.a : 'major', note: v.n }); log(`리비전 저장: ${r.name}${r.stats ? ` (직전 대비 추가 ${r.stats.added}·변경 ${r.stats.changed}·삭제 ${r.stats.removed})` : ''}`, '#3fdf8f'); toast(r.name + ' 저장', 'ok'); return; }
    const [op, id] = v.a.split(':');
    if (op === 'ocmp') { const r = old[+id]; cmp = { name: r.name, diff: diffContent(JSON.parse(r.data), C()) }; buildToolbar(); dirty = true; return; }
    const r = list.find(x => x.id === id); const snap = await loadRev(ctx, id); if (!snap) return toast('리비전 데이터를 불러오지 못했습니다', 'err');
    if (op === 'cmp') { cmp = { name: `${r.name} → 현재`, diff: diffContent(snap.content[sid], C()), oldC: snap.content[sid] }; buildToolbar(); dirty = true; log(`비교 ${r.name}: 추가 ${cmp.diff.added.length}, 삭제 ${cmp.diff.removed.length}, 변경 ${cmp.diff.changed.length}`, '#ffd866'); }
    if (op === 'cloud') {
      const d = diffContent(snap.content[sid], C()); const oc = snap.content[sid] || { els: [] };
      const bbOf = (o, cc) => o.k ? G.elBBox(o, (hid) => cc.els.find(x => x.id === hid)) : G.entBBox(o);
      const boxes = [...d.added.map(o => bbOf(o, C())), ...d.changed.flatMap(c => [bbOf(c.now, C()), bbOf(c.old, oc)]), ...d.removed.map(o => bbOf(o, oc))].filter(Boolean).filter(b => isFinite(b.x0)).map(b => ({ x0: b.x0 - 500, y0: b.y0 - 500, x1: b.x1 + 500, y1: b.y1 + 500 }));
      if (!boxes.length) return toast('변경된 부위가 없습니다');
      const label = nx('minor'); snapshot(); for (const b of clusterBoxes(boxes, 1500)) addEnt({ t: 'cloud', pts: [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]], label: label.replace('Rev', ''), layer: 'REV' }); changed(); log(`리비전 구름 ${clusterBoxes(boxes, 1500).length}개 생성 (△${label.replace('Rev', '')})`, '#ff9f43');
    }
    if (op === 'rs') { if (!await confirmBox('도면 되돌리기', `이 도면을 ${esc(r.name)} 상태로 되돌립니다. (Ctrl+Z로 취소 가능)`)) return; snapshot(); await restoreRev(ctx, id, sid); sel.clear(); changed(); }
    if (op === 'rp') { if (!await confirmBox('프로젝트 되돌리기', `모든 도면·층을 ${esc(r.name)} 상태로 되돌립니다. 현재 상태가 필요하면 먼저 Rev로 저장하세요.`, '되돌리기', true)) return; await restoreRev(ctx, id); sid = P.sheets.some(x => x.id === sid) ? sid : P.sheets[0].id; sel.clear(); buildToolbar(); changed(); zoomExt(); }
  }

  // 선 → 객체 변환 / 자동 인식
  async function convertLines() {
    const c = C(); const src = sel.size ? c.ents.filter(e => sel.has(e.id)) : c.ents;
    const r = G.recognize(src);
    const total = r.walls.length + r.cols.length + r.slabs.length;
    if (!total) { endCmd('인식된 객체가 없습니다 (평행선 쌍 80~450mm → 벽, 닫힌 사각형 ≤1500 → 기둥, 큰 닫힌 폴리선 → 슬래브)'); return; }
    const v = await dialog({ title: '선 → 객체 자동 인식', body: `${sel.size ? '선택한 ' : '도면 전체 '}선에서 <b>벽 ${r.walls.length}</b>개, <b>기둥 ${r.cols.length}</b>개, <b>슬래브 ${r.slabs.length}</b>개를 찾았습니다.`, fields: [{ key: 'mat', label: '벽 재료', type: 'select', options: Object.entries(MATS).map(([k, m]) => [k, m.name]), value: 'RC' }, { key: 'del', label: '원본 선 삭제', type: 'checkbox', value: true }], ok: '변환' });
    if (!v) return endCmd();
    snapshot(); const used = new Set();
    for (const w of r.walls) { addEl({ ...w, mat: v.mat, src: undefined }); w.src.forEach(i => used.add(i)); }
    for (const x of [...r.cols, ...r.slabs]) { addEl({ ...x, src: undefined }); x.src.forEach(i => used.add(i)); }
    if (v.del) c.ents = c.ents.filter(e => !used.has(e.id));
    sel.clear(); selChanged(); changed(); endCmd(`변환 완료: 벽 ${r.walls.length}, 기둥 ${r.cols.length}, 슬래브 ${r.slabs.length}`);
  }

  // ---------- AI 작도 ----------
  async function aiDraw(preset) {
    const sample = await getSample();
    if (!sample) { toast('이 화면에서는 Claude 호출을 쓸 수 없습니다', 'err'); return; }
    const v = typeof preset === 'string' && preset.trim() ? { q: preset } : await dialog({ title: 'AI 작도 (Claude)', fields: [{ key: 'q', label: '무엇을 그릴까요? (단위 mm)', type: 'textarea', value: '', rows: 4 }], body: '<div class="note">예: "원점에서 7.2m 간격 4×3 그리드와 각 교점에 600각 기둥, 외곽에 200 RC벽" / "선택한 벽 가운데에 900 문"</div>', ok: '작도' });
    if (!v?.q) return;
    const c = C(); const bb = sheetBBox();
    const context = { units: 'mm', sheet: { disc: sheet().disc, name: sheet().name, level: lv() }, bbox: bb, defaults: D, grids: c.ents.filter(e => e.t === 'grid').map(e => ({ label: e.label, a: e.a, b: e.b })).slice(0, 60),
      selection: [...c.els.filter(e => sel.has(e.id)).map(e => ({ id: e.id, k: e.k, a: e.a, b: e.b, p: e.p, t: e.t, w: e.w })), ...c.ents.filter(e => sel.has(e.id)).map(e => ({ id: e.id, t: e.t, a: e.a, b: e.b }))].slice(0, 80),
      counts: { ents: c.ents.length, els: c.els.length } };
    const instr = `You are the drafting engine of a Korean BIM-CAD web app. Convert the user's Korean drawing request into JSON actions. Coordinates in mm, plan view, X right, Y up.
Return ONLY JSON: {"message":"한국어 한 줄 요약","actions":[...]} (max 400 actions). Action types:
- {"type":"entity","t":"line","a":[x,y],"b":[x,y]} | {"type":"entity","t":"pline","pts":[[x,y],...],"closed":true} | {"type":"entity","t":"circle","c":[x,y],"r":n} | {"type":"entity","t":"text","p":[x,y],"h":300,"s":"..."} | {"type":"entity","t":"dim","a":[x,y],"b":[x,y],"off":[x,y]} | {"type":"entity","t":"grid","a":[x,y],"b":[x,y],"label":"1"}
- {"type":"element","k":"wall","a":[x,y],"b":[x,y],"t":200,"mat":"RC|CMU|DRY|GLASS"} (centerline) | {"type":"element","k":"column","p":[x,y],"w":600,"d":600,"mat":"RC|STEEL","sec":"H-300x300x10x15"} | {"type":"element","k":"beam","a":..,"b":..,"w":400,"d":700,"mat":"RC|STEEL","sec":".."} | {"type":"element","k":"slab","pts":[...],"t":200} | {"type":"element","k":"footing","p":..,"w":2400,"d":2400,"t":800} | {"type":"element","k":"duct|pipe|tray","a":..,"b":..,"w":800,"hh":400,"z":3000,"sys":"급기"} | {"type":"element","k":"opening","host":"<wall id from selection>","s":distance_from_wall_start,"w":900,"h":2100,"sill":0,"kind":"door|window"}
- {"type":"delete","ids":["..."]}
Steel sections available: ${Object.keys(SECTIONS).join(', ')}. Use defaults when sizes are not given.`;
    toast('Claude에게 요청 중…');
    try {
      const res = await sample([{ role: 'user', content: instr + '\n\nContext: ' + JSON.stringify(context) + '\n\nRequest: ' + v.q }], { modelTier: 'default' });
      const txt = res.text || ''; const m = txt.match(/\{[\s\S]*\}/); if (!m) throw new Error('응답에서 JSON을 찾지 못했습니다');
      const out = JSON.parse(m[0]); const acts = (out.actions || []).slice(0, 400);
      snapshot(); let ne = 0, nl = 0, nd = 0;
      const okPt = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
      for (const a of acts) {
        if (a.type === 'delete') { const ids = new Set(a.ids || []); nd += ids.size; removeIds(ids); continue; }
        if (a.type === 'entity' && ['line', 'pline', 'circle', 'text', 'dim', 'grid', 'arc'].includes(a.t)) { const { type, ...e } = a; if ((e.a && !okPt(e.a)) || (e.b && !okPt(e.b))) continue; if (e.t === 'text') e.h ||= D.text.h; if (e.t === 'grid') e.layer = 'GRID'; if (e.t === 'dim') e.layer = 'DIM'; addEnt(e); nl++; continue; }
        if (a.type === 'element' && KINDS[a.k]) { const { type, ...e } = a; const base = a.k === 'opening' ? { ...D[a.kind === 'window' ? 'window' : 'door'], kind: a.kind || 'door' } : D[a.k] || {}; const el = { ...deep(base), ...e }; if ((el.k === 'column' || el.k === 'beam') && el.mat !== 'STEEL') delete el.sec; if (el.k === 'pipe') el.hh ??= el.w; if (el.k === 'opening' && !C().els.some(w => w.id === el.host)) continue; addEl(el); ne++; }
      }
      changed(); zoomExt(); log(`AI: ${out.message || ''} (객체 ${ne}, 선 ${nl}, 삭제 ${nd})`, '#a78bfa'); toast('AI 작도 완료 — 되돌리려면 Ctrl+Z', 'ok');
    } catch (e) { console.error(e); if (e?.code === 'not_granted') toast('Claude 호출 권한이 없습니다', 'err'); else toast('AI 작도 실패: ' + (e.message || e.code), 'err'); }
  }

  // ---------- 파일 ----------
  async function fileMenu() {
    const v = await dialog({ title: '파일', fields: [{ key: 'a', label: '작업', type: 'select', options: [['dxfin', 'DXF 가져오기 (현재 도면에 추가)'], ['dxfout', 'DXF 내보내기 (현재 도면)'], ['dxfall', 'DXF 내보내기 (같은 층 전 공종 합본)'], ['png', 'PNG 이미지 (흰 바탕)'], ['pdf', 'PDF 벡터 (색상별 선굵기)']], value: 'dxfin' }], ok: '실행' });
    if (!v) return;
    const fname = (s) => s.replace(/[\\/:*?"<>|]/g, '_');
    if (v.a === 'dxfin') return importDXF();
    if (v.a === 'dxfout') return saveFile(fname(sheet().name) + '.dxf', toDXF(P, [sid]));
    if (v.a === 'dxfall') return saveFile(fname(`${P.name}_${lv().name}_합본`) + '.dxf', toDXF(P, P.sheets.filter(s => s.level === sheet().level).map(s => s.id)));
    if (v.a === 'png') return exportPNG();
    if (v.a === 'pdf') return exportPDF();
  }
  async function importDXF() {
    const f = await pickFile('.dxf'); if (!f) return;
    const v = await dialog({ title: 'DXF 가져오기', body: `<div class="note">${esc(f.name)} (${fmt(f.size / 1024, 0)} KB). DWG는 AutoCAD에서 DXF로 저장 후 가져오세요.</div>`, fields: [{ key: 'unit', label: '도면 단위', type: 'select', options: [['1', 'mm'], ['10', 'cm'], ['1000', 'm']], value: '1' }, { key: 'dx', label: '이동 X(mm)', type: 'number', value: 0 }, { key: 'dy', label: '이동 Y(mm)', type: 'number', value: 0 }, { key: 'rec', label: '가져온 뒤 벽·기둥 자동 인식', type: 'checkbox', value: false }], ok: '가져오기' });
    if (!v) return;
    try {
      const t = await readText(f); const r = parseDXF(t); const k = +v.unit;
      const fx = (p) => [p[0] * k + (v.dx || 0), p[1] * k + (v.dy || 0)];
      snapshot();
      for (const e of r.ents) { const n = G.transformEnt(e, fx); if (n.t === 'text') n.h = e.h * k; if (n.t === 'circle' || n.t === 'arc') n.r = e.r * k; n.id = uid('d'); C().ents.push(n); }
      for (const l of r.layers) if (!P.layers.some(x => x.name === l.name)) P.layers.push({ ...l, visible: true });
      ctx.touch('meta'); changed(); zoomExt();
      log(`DXF: ${Object.entries(r.stats).map(([a, b]) => `${a} ${b}`).join(', ')}`, '#3fdf8f');
      if (JSON.stringify(C()).length > 4_000_000) toast('도면 용량이 큽니다. 저장에 시간이 걸릴 수 있습니다', 'info', 4000);
      if (v.rec) { sel.clear(); convertLines(); }
    } catch (e) { console.error(e); toast('DXF 읽기 실패: ' + e.message, 'err'); }
  }
  function exportPNG() {
    const bb = sheetBBox(); if (!bb) return toast('내보낼 내용이 없습니다');
    const scale = Math.min(4000 / (bb.x1 - bb.x0), 4000 / (bb.y1 - bb.y0)) * 0.9;
    const off = h('canvas'); off.width = Math.ceil((bb.x1 - bb.x0) * scale / 0.9); off.height = Math.ceil((bb.y1 - bb.y0) * scale / 0.9);
    const save = { g: null, V: { ...V }, W, H, dpr };
    const og = off.getContext('2d'); og.fillStyle = '#ffffff'; og.fillRect(0, 0, off.width, off.height);
    // 임시로 렌더러를 오프스크린에 연결
    V.cx = (bb.x0 + bb.x1) / 2; V.cy = (bb.y0 + bb.y1) / 2; V.s = scale; W = off.width; H = off.height;
    const c = C(); const bw = (col) => (col === '#d0d5dd' || col === '#ffffff' || col === '#cfd6e2') ? '#000000' : col;
    withCtx(og, () => {
      for (const el of c.els) drawEl(el, c, 'normal');
      for (const e of c.ents) if (layerVisible(e.layer)) drawEnt(e, bw(e.color || layerColor(e.layer)), 1.2);
    });
    Object.assign(V, save.V); W = save.W; H = save.H; dirty = true;
    off.toBlob((b) => saveFile(sheet().name.replace(/[\\/:*?"<>|]/g, '_') + '.png', b), 'image/png');
  }
  function withCtx(ctx2, fn) { const keep = g, kb = BG; g = ctx2; BG = '#ffffff'; try { fn(); } finally { g = keep; BG = kb; } }
  async function exportPDF() {
    const c = C(); const items = [];
    const colorOf = (e) => e.color || layerColor(e.layer);
    for (const e of c.ents) if (layerVisible(e.layer)) items.push({ color: colorOf(e), segs: e.t === 'text' ? [] : e.t === 'hatch' && e.pat !== 'SOLID' ? [...G.entSegs(e), ...G.hatchLines(e)] : G.entSegs(e), text: e.t === 'text' ? e : e.t === 'grid' ? { p: e.a, h: 400, s: e.label || '' } : e.t === 'dim' ? (() => { const d = dimGeom(e); return { p: d.tp, h: D.text.h * 0.85, s: e.ovr || String(Math.round(d.len)), rot: d.ang * 180 / Math.PI, center: true }; })() : null });
    for (const el of c.els) { const col = el.k === 'wall' ? '#ffffff' : el.k === 'column' ? '#ffff00' : el.k === 'beam' ? '#e0af68' : ['duct', 'pipe', 'tray'].includes(el.k) ? '#00ffff' : el.k === 'sprinkler' ? '#ff0000' : el.k === 'panel' ? '#ff00ff' : el.k === 'light' ? '#ffff80' : ['room', 'ceiling'].includes(el.k) ? '#c080ff' : '#808080'; items.push({ color: col, segs: G.elSegs(el, hostOf(c)), el: true }); }
    const colors = [...new Set(items.map(i => i.color))];
    const defLw = (col) => col === '#ffffff' || col === '#d0d5dd' ? 0.5 : col === '#ffff00' ? 0.4 : col === '#808080' || col === '#5d6b80' ? 0.13 : 0.25;
    const v = await dialog({ title: 'PDF 내보내기 — 색상별 선굵기(mm)', body: '<div class="note">A3 가로에 맞춤. 문자는 영문·숫자만 PDF에 들어가며, 한글 문자는 PNG 내보내기를 쓰세요.</div>', fields: [{ key: 'paper', label: '용지', type: 'select', options: [['A3', 'A3 가로'], ['A1', 'A1 가로'], ['A4', 'A4 가로']], value: 'A3' }, ...colors.map((col, i) => ({ key: 'c' + i, label: `■ ${col}`, type: 'number', value: defLw(col) }))], ok: '내보내기' });
    if (!v) return;
    const lw = {}; colors.forEach((col, i) => lw[col] = v['c' + i] ?? 0.25);
    const size = { A4: [297, 210], A3: [420, 297], A1: [841, 594] }[v.paper];
    const pdf = pdfDoc(items, { pageW: size[0], pageH: size[1], lw, title: `${P.name} - ${sheet().name}` });
    saveFile(sheet().name.replace(/[\\/:*?"<>|]/g, '_') + '.pdf', pdf);
  }

  // ---------- 레이어 관리자 ----------
  async function layerManager() {
    const names = allLayers(); for (const n of names) if (!layerOf(n)) P.layers.push({ name: n, color: layerColor(n), visible: true });
    const list = P.layers.map(l => ({ ...l })); const body = h('div');
    const count = (n) => P.sheets.reduce((s, x) => s + (P.content[x.id]?.ents.filter(e => (e.layer || '0') === n).length || 0), 0);
    const draw = () => {
      body.innerHTML = '';
      body.append(h('div', { class: 'tbl', style: { maxHeight: '55vh' } }, table([
        { label: '현재', render: l => h('input', { type: 'radio', name: 'curL', checked: l.name === curLayer, onchange: () => { curLayer = l.name; } }) },
        { label: '이름', render: l => { const i = h('input', { value: l.name, style: { width: '120px' } }); i.onchange = () => { l._rename = i.value; }; return i; } },
        { label: '켜기', render: l => { const i = h('input', { type: 'checkbox', checked: l.visible !== false }); i.onchange = () => l.visible = i.checked; return i; } },
        { label: '동결', render: l => { const i = h('input', { type: 'checkbox', checked: !!l.frozen }); i.onchange = () => l.frozen = i.checked; return i; } },
        { label: '잠금', render: l => { const i = h('input', { type: 'checkbox', checked: !!l.locked }); i.onchange = () => l.locked = i.checked; return i; } },
        { label: '색', render: l => { const i = h('input', { type: 'color', value: l.color || '#d0d5dd', style: { width: '34px', height: '22px', padding: 0 } }); i.oninput = () => l.color = i.value; return i; } },
        { label: '선종류', render: l => { const s2 = h('select'); for (const t of Object.keys(LT)) s2.append(h('option', { selected: (l.lt || 'CONTINUOUS') === t }, t)); s2.onchange = () => l.lt = s2.value; return s2; } },
        { label: '선굵기', render: l => { const s2 = h('select'); for (const w of [0.09, 0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1.0]) s2.append(h('option', { value: w, selected: (l.lw ?? 0.25) === w }, w.toFixed(2))); s2.onchange = () => l.lw = +s2.value; return s2; } },
        { label: '요소', num: true, render: l => count(l.name) },
        { label: '', render: l => h('button', { type: 'button', class: 'btn sm', onclick: () => { if (count(l.name) || l.name === '0') return toast('요소가 있는 레이어와 0 레이어는 삭제할 수 없습니다', 'err'); list.splice(list.indexOf(l), 1); draw(); } }, '삭제') },
      ], list)));
      body.append(h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { type: 'button', class: 'btn sm', onclick: () => { list.push({ name: '레이어' + (list.length + 1), color: '#d0d5dd', visible: true, lt: 'CONTINUOUS', lw: 0.25 }); draw(); } }, '+ 새 레이어'),
        h('button', { type: 'button', class: 'btn sm', onclick: () => { for (const l of list) { l.visible = true; l.frozen = false; } draw(); } }, '모두 켜기·해동'), h('span', { class: 'note' }, '동결: 숨김+선택 불가 · 잠금: 보이지만 선택·편집 불가')));
    };
    draw();
    const ok = await dialog({ title: '레이어 특성 관리자', body, wide: true, ok: '적용' }); if (!ok) return;
    for (const l of list) if (l._rename && l._rename !== l.name) { for (const x of P.sheets) for (const e of P.content[x.id]?.ents || []) if ((e.layer || '0') === l.name) e.layer = l._rename; if (curLayer === l.name) curLayer = l._rename; l.name = l._rename; }
    P.layers = list.map(({ _rename, ...l }) => l); ctx.touch(['meta', ...P.sheets.map(x => x.id)]); buildToolbar(); renderSide(); dirty = true;
  }
  async function snapSettings() {
    const names = { end: '끝점', mid: '중간점', cen: '중심', int: '교차점', per: '직교(수직)', nea: '근처점', qua: '사분점', ins: '삽입점' };
    const v = await dialog({ title: '객체 스냅 설정', fields: Object.entries(names).map(([k, l]) => ({ key: k, label: l, type: 'checkbox', value: opt.snaps[k] !== false })), ok: '적용' });
    if (!v) return; Object.assign(opt.snaps, v); P.view.snaps = { ...opt.snaps }; ctx.touch('meta'); opt.osnap = true; renderStatus();
  }
  // ---------- 우클릭 메뉴 ----------
  function showCtx(x, y) {
    document.querySelector('.ctx')?.remove();
    const items = [];
    if (cmd) items.push(['Enter (확인)', () => submit('')], ['취소', () => cancel()]);
    else if (sel.size) items.push(['이동', () => startCmd('MOVE'), 'M'], ['복사', () => startCmd('COPY'), 'CO'], ['회전', () => startCmd('ROTATE'), 'RO'], ['대칭', () => startCmd('MIRROR'), 'MI'], ['축척', () => startCmd('SCALE'), 'SC'], null, ['클립보드로 복사', copyClip, 'Ctrl+C'], ['특성 일치', () => startCmd('MATCHPROP'), 'MA'], ['선→객체 변환', () => startCmd('CONVERT'), 'CV'], ['이슈 등록', issueFromSel], ['3D에서 보기', () => { S.hi = { ids: [...sel], sheet: sid }; ctx.go('view3d'); }], null, ['지우기', () => startCmd('ERASE'), 'Del'], ['선택 해제', () => { sel.clear(); selChanged(); }, 'Esc']);
    else items.push(lastCmd ? [`반복: ${CMD_NAMES[lastCmd] || lastCmd}`, () => startCmd(lastCmd), 'Enter'] : null, ['붙여넣기', () => startCmd('PASTECLIP'), 'Ctrl+V'], ['전체 선택', () => startCmd('SELALL'), 'Ctrl+A'], ['빠른 선택', quickSelect], null, ['전체 보기', zoomExt, 'ZE'], ['실행 취소', doUndo, 'Ctrl+Z'], ['다시 실행', doRedo, 'Ctrl+Y']);
    const m = h('div', { class: 'ctx', style: { left: Math.min(x, window.innerWidth - 200) + 'px', top: Math.min(y, window.innerHeight - 30 * items.length) + 'px' } });
    for (const it of items) { if (!it) { m.append(h('hr')); continue; } m.append(h('div', { onclick: () => { m.remove(); it[1](); } }, it[0], it[2] ? h('span', {}, it[2]) : null)); }
    document.body.append(m); setTimeout(() => window.addEventListener('pointerdown', function off(ev) { if (!m.contains(ev.target)) { m.remove(); window.removeEventListener('pointerdown', off, true); } }, true), 0);
  }
  function copyClip() { const { ents, els } = selected(); if (!ents.length && !els.length) return log('복사할 객체를 선택하세요'); const b = sheetBBox(new Set(sel)); clip = { ents: deep(ents), els: deep(els), base: b ? [b.x0, b.y0] : [0, 0] }; log(`클립보드에 ${ents.length + els.length}개 복사 (Ctrl+V로 붙여넣기)`); }
  async function issueFromSel() {
    const { els, ents } = selected(); if (!els.length && !ents.length) return toast('객체를 선택하세요');
    const v = await dialog({ title: '이슈 등록', fields: [{ key: 'type', label: '유형', type: 'select', options: ['RFI', '품질', '안전', '설계변경', '일반'], value: 'RFI' }, { key: 'title', label: '제목', value: els[0] ? `${els[0].tag || elName(els[0])} 확인 요청` : '' }, { key: 'desc', label: '내용', type: 'textarea' }, { key: 'assignee', label: '담당' }, { key: 'due', label: '기한', type: 'date' }] });
    if (!v?.title) return; const { addIssue } = await import('./issue.js'); const b = sheetBBox(new Set(sel)); const pt = b ? [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] : cur;
    const it = addIssue(P, { ...v, refs: { ids: [...sel], pts: [pt], sheet: sid, level: sheet().level, where: sheet().name } }); ctx.touch('meta'); toast(`이슈 #${it.no} 등록`, 'ok');
  }
  // ---------- 명령 자동완성 ----------
  let acList = [], acI = 0;
  const KO = Object.fromEntries(Object.entries(CMD_NAMES).map(([k, v]) => [k, v]));
  inp.addEventListener('input', () => {
    const q = inp.value.trim(); if (cmd || !q || /^[-\d@.,<]/.test(q) || q.startsWith('?')) return acHide();
    const up = q.toUpperCase(); const seen = new Set(); acList = [];
    for (const [a, c] of Object.entries(ALIASES)) if (a.startsWith(up) && !seen.has(a)) { seen.add(a); acList.push({ a, c }); }
    for (const [c, ko] of Object.entries(KO)) if (ko.includes(q) && !acList.some(x => x.c === c)) { const a = Object.keys(ALIASES).filter(k => ALIASES[k] === c).sort((x, y) => x.length - y.length)[0] || c; acList.push({ a, c }); }
    acList.sort((x, y) => x.a.length - y.a.length); acList = acList.slice(0, 10); acI = 0; acDraw();
  });
  function acDraw() { if (!acList.length) return acHide(); acBox.innerHTML = ''; acList.forEach((x, i) => acBox.append(h('div', { class: i === acI ? 'on' : '', onmousedown: (e) => { e.preventDefault(); inp.value = x.a; acHide(); submit(x.a); } }, h('b', {}, x.a), CMD_NAMES[x.c] || x.c))); acBox.style.display = 'block'; }
  function acHide() { acBox.style.display = 'none'; acList = []; }
  function acMove(k) { if (!acList.length) return; acI = (acI + (k === 'ArrowUp' ? -1 : 1) + acList.length) % acList.length; if (k === 'Tab') { inp.value = acList[acI].a; } acDraw(); }
  function acPick() { if (acBox.style.display === 'none' || !acList.length) return null; const q = inp.value.trim().toUpperCase(); if (ALIASES[q]) return null; return acList[acI].a; }

  // ---------- 배치·플롯 ----------
  const PAPER = { A0: [1189, 841], A1: [841, 594], A2: [594, 420], A3: [420, 297], A4: [297, 210] };
  const LV = { s: 1, x: 20, y: 20 };
  function plotCfg() { P.view.plot ||= {}; return (P.view.plot[sid] ||= { paper: 'A3', scale: 0, center: null, title: { project: P.name, drawing: sheet().name, no: sheet().name.split(' ')[0], date: new Date().toISOString().slice(0, 10), by: '', chk: '', app: '', rev: (P.prevs || [])[P.prevs?.length - 1]?.name || '' } }); }
  const paperOf = (pl) => PAPER[pl.paper] || PAPER.A3;
  const VPM = { l: 15, t: 10, r: 80, b: 10 };
  function fitScaleOf(pl) { const [pw, ph] = paperOf(pl); const b = sheetBBox() || { x0: 0, y0: 0, x1: 10000, y1: 10000 }; const vw = pw - VPM.l - VPM.r, vh = ph - VPM.t - VPM.b; return Math.max((b.x1 - b.x0) / vw, (b.y1 - b.y0) / vh) * 1.05; }
  function setSpace(sp) { cancel(true); space = sp; if (sp === 'layout') { const pl = plotCfg(); const [pw, ph] = paperOf(pl); LV.s = Math.min((W - 40) / pw, (H - 40) / ph); LV.x = (W - pw * LV.s) / 2; LV.y = (H - ph * LV.s) / 2; } buildToolbar(); dirty = true; }
  function drawLayout(target) {
    const pl = plotCfg(); const [pw, ph] = paperOf(pl); const k = LV.s; const P2 = (x, y) => [LV.x + x * k, LV.y + y * k];
    if (!target) { g.fillStyle = '#3a3f47'; g.fillRect(0, 0, W, H); g.fillStyle = '#0006'; g.fillRect(LV.x + 6, LV.y + 6, pw * k, ph * k); }
    g.fillStyle = '#ffffff'; g.fillRect(LV.x, LV.y, pw * k, ph * k);
    const vx0 = VPM.l, vy0 = VPM.t, vx1 = pw - VPM.r, vy1 = ph - VPM.b; const N = pl.scale || fitScaleOf(pl);
    const b = sheetBBox() || { x0: 0, y0: 0, x1: 10000, y1: 10000 }; const ctr = pl.center || [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
    const keep = { ...V }, kb = BG, kh = S.hi; V.cx = ctr[0]; V.cy = ctr[1]; V.s = k / N; V.ox = LV.x + (vx0 + vx1) / 2 * k; V.oy = LV.y + (vy0 + vy1) / 2 * k; BG = '#ffffff'; S.hi = null;
    g.save(); g.beginPath(); const a = P2(vx0, vy0); g.rect(a[0], a[1], (vx1 - vx0) * k, (vy1 - vy0) * k); g.clip();
    const c = C(); const order = { room: -2, ceiling: -1, slab: 0, footing: 1, beam: 2, wall: 3, opening: 4, column: 5, duct: 6, pipe: 6, tray: 6, panel: 7, light: 7, sprinkler: 8 };
    for (const el of [...c.els].sort((x, y) => (order[x.k] ?? 9) - (order[y.k] ?? 9))) if (el.k !== 'opening') drawEl(el, c, 'normal');
    const ink = (col) => { const n = parseInt((col || '#ffffff').slice(1), 16); const l = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); return l > 200 ? '#111111' : col; };
    for (const e of c.ents) if (layerVisible(e.layer)) drawEnt(e, ink(e.color || layerColor(e.layer)), Math.max(0.6, (e.lw ?? layerOf(e.layer)?.lw ?? 0.25) * k * 0.9));
    drawTakeoffs();
    g.restore(); Object.assign(V, keep); if (!('ox' in keep)) { delete V.ox; delete V.oy; } BG = kb; S.hi = kh;
    // 테두리·표제란
    g.strokeStyle = '#111'; g.lineWidth = Math.max(1, 0.5 * k); const R = (x0, y0, x1, y1) => { const p = P2(x0, y0); g.strokeRect(p[0], p[1], (x1 - x0) * k, (y1 - y0) * k); };
    R(VPM.l - 5, 5, pw - 5, ph - 5); g.lineWidth = Math.max(0.6, 0.25 * k); R(vx0, vy0, vx1, vy1);
    const tx0 = pw - VPM.r + 2, tx1 = pw - 5; const T = pl.title; const rows = [['공사명', T.project], ['도면명', T.drawing], ['도면번호', T.no], ['축척', pl.scale ? `1:${pl.scale}` : `1:${Math.round(N)} (맞춤)`], ['일자', T.date], ['REV', T.rev], ['작성', T.by], ['검토', T.chk], ['승인', T.app]];
    const rh = (ph - 10 - 40) / rows.length; let y = 5;
    const txt = (s0, x, yy, sz, bold, al = 'left') => { const q = P2(x, yy); g.fillStyle = '#111'; g.font = `${bold ? '600 ' : ''}${Math.max(6, sz * k)}px "Noto Sans KR", sans-serif`; g.textAlign = al; g.textBaseline = 'middle'; g.fillText(String(s0 ?? ''), q[0], q[1]); };
    R(tx0, 5, tx1, 45); txt('빌더', (tx0 + tx1) / 2, 18, 6, true, 'center'); txt('BUILDER', (tx0 + tx1) / 2, 28, 3.2, false, 'center'); txt(P.site.address || '', (tx0 + tx1) / 2, 37, 2.6, false, 'center');
    y = 45; for (const [l2, v2] of rows) { R(tx0, y, tx1, y + rh); g.beginPath(); const a2 = P2(tx0 + 18, y), b2 = P2(tx0 + 18, y + rh); g.moveTo(a2[0], a2[1]); g.lineTo(b2[0], b2[1]); g.stroke(); txt(l2, tx0 + 9, y + rh / 2, 2.6, false, 'center'); txt(v2, tx0 + 20, y + rh / 2, l2 === '도면명' || l2 === '공사명' ? 3 : 3.2, l2 === '도면번호', 'left'); y += rh; }
    // 북측 표시
    const nc = P2(vx1 - 15, vy0 + 15), nr = 7 * k, na = -(P.site.north || 0) * Math.PI / 180; g.beginPath(); g.arc(nc[0], nc[1], nr, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(nc[0] + Math.sin(na) * nr, nc[1] - Math.cos(na) * nr); g.lineTo(nc[0] - Math.cos(na) * nr * 0.4, nc[1] - Math.sin(na) * nr * 0.4); g.lineTo(nc[0] + Math.cos(na) * nr * 0.4, nc[1] + Math.sin(na) * nr * 0.4); g.closePath(); g.fillStyle = '#111'; g.fill(); txt('N', (vx1 - 15) + Math.sin(na) * 10, vy0 + 15 - Math.cos(na) * 10, 3, true, 'center');
  }
  async function plotDialog() {
    const pl = plotCfg(); const T = pl.title;
    const v = await dialog({ title: `플롯 — ${sheet().name}`, wide: true, body: '<div class="note">배치(용지·표제란)를 설정하고 PDF/PNG로 출력합니다. "고해상 PDF"는 한글이 그대로 나오고, "벡터 PDF"는 선이 확대해도 선명하지만 문자는 영문만 나옵니다.</div>', fields: [
      { key: 'paper', label: '용지', type: 'select', options: Object.keys(PAPER).map(k => [k, `${k} 가로 (${PAPER[k][0]}×${PAPER[k][1]})`]), value: pl.paper },
      { key: 'scale', label: '축척', type: 'select', options: [[0, '용지에 맞춤'], ...[20, 30, 50, 100, 150, 200, 300, 500, 1000].map(n => [n, `1:${n}`])], value: pl.scale },
      { key: 'center', label: '출력 중심', type: 'select', options: [['ext', '도면 전체 중심'], ['view', '현재 모형 화면 중심']], value: pl.center ? 'view' : 'ext' },
      { key: 'project', label: '공사명', value: T.project }, { key: 'drawing', label: '도면명', value: T.drawing }, { key: 'no', label: '도면번호', value: T.no }, { key: 'date', label: '일자', type: 'date', value: T.date }, { key: 'rev', label: 'REV', value: T.rev }, { key: 'by', label: '작성', value: T.by }, { key: 'chk', label: '검토', value: T.chk }, { key: 'app', label: '승인', value: T.app },
      { key: 'out', label: '출력', type: 'select', options: [['raster', '고해상 PDF (한글 포함, 200dpi)'], ['vector', '벡터 PDF (영문 문자)'], ['png', 'PNG 이미지 (200dpi)'], ['none', '설정만 저장 (배치 보기)']], value: 'raster' }], ok: '출력' });
    if (!v) return;
    pl.paper = v.paper; pl.scale = +v.scale; pl.center = v.center === 'view' ? (space === 'model' ? [V.cx, V.cy] : pl.center) : null; Object.assign(T, { project: v.project, drawing: v.drawing, no: v.no, date: v.date, rev: v.rev, by: v.by, chk: v.chk, app: v.app }); ctx.touch('meta');
    if (v.out === 'none') return setSpace('layout');
    if (v.out === 'vector') return exportPDF();
    const [pw, ph] = paperOf(pl); const dpi = 200, k = dpi / 25.4; const cw = Math.round(pw * k), chh = Math.round(ph * k);
    const off = document.createElement('canvas'); off.width = cw; off.height = chh; const og = off.getContext('2d');
    const keepG = g, keepLV = { ...LV }, kW = W, kH = H; g = og; LV.s = k; LV.x = 0; LV.y = 0; W = cw; H = chh;
    try { drawLayout(true); } finally { g = keepG; Object.assign(LV, keepLV); W = kW; H = kH; dirty = true; }
    const fn = `${T.no || sheet().name}`.replace(/[\\/:*?"<>|]/g, '_');
    if (v.out === 'png') return off.toBlob(b => saveFile(fn + '.png', b), 'image/png');
    off.toBlob(async (b) => { const bytes = new Uint8Array(await b.arrayBuffer()); saveFile(fn + '.pdf', pdfFromJpeg(bytes, cw, chh, pw, ph, `${P.name} ${T.drawing}`)); }, 'image/jpeg', 0.9);
  }

  // ---------- 일괄 플롯 + 도면 목록 ----------
  function renderSheetJpeg(id, dpi, paperOverride) {
    const keepSid = sid; sid = id; const pl = plotCfg(); const keepPaper = pl.paper; if (paperOverride) pl.paper = paperOverride;
    const [pw, ph] = paperOf(pl); const k = dpi / 25.4; const cw = Math.round(pw * k), chh = Math.round(ph * k);
    const off = document.createElement('canvas'); off.width = cw; off.height = chh;
    const keepG = g, keepLV = { ...LV }, kW = W, kH = H; g = off.getContext('2d'); LV.s = k; LV.x = 0; LV.y = 0; W = cw; H = chh;
    try { drawLayout(true); } finally { g = keepG; Object.assign(LV, keepLV); W = kW; H = kH; pl.paper = keepPaper; sid = keepSid; dirty = true; }
    return new Promise(res => off.toBlob(async b => res({ jpg: new Uint8Array(await b.arrayBuffer()), pxW: cw, pxH: chh, pageW: pw, pageH: ph }), 'image/jpeg', 0.88));
  }
  function sheetRow(s, i) {
    P.view.plot ||= {}; const pl = P.view.plot[s.id]; const T = pl?.title || {}; const L = levelOf(P, s.level);
    const no = T.no || s.name.split(' ')[0]; let nm = T.drawing || s.name; if (nm.startsWith(no + ' ')) nm = nm.slice(no.length + 1);
    return { i: i + 1, no, name: nm, disc: DISC[s.disc]?.name || '', level: s.kind === 'section' ? '-' : L?.name || '', scale: pl?.scale ? `1:${pl.scale}` : '맞춤', paper: pl?.paper || 'A3', rev: T.rev || '', date: T.date || '', app: T.app || '' };
  }
  function drawingListPage(rows, dpi) {
    const [pw, ph] = PAPER.A3; const k = dpi / 25.4; const c = document.createElement('canvas'); c.width = Math.round(pw * k); c.height = Math.round(ph * k); const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.strokeStyle = '#111'; x.fillStyle = '#111'; x.lineWidth = Math.max(1, 0.5 * k); x.strokeRect(10 * k, 5 * k, (pw - 15) * k, (ph - 10) * k);
    const T = (s, X, Y, sz, b, al = 'left') => { x.font = `${b ? '600 ' : ''}${sz * k}px "Noto Sans KR", sans-serif`; x.textAlign = al; x.textBaseline = 'middle'; x.fillText(String(s ?? ''), X * k, Y * k); };
    T('도 면 목 록', pw / 2, 18, 7, true, 'center'); T(`${P.name}  ·  ${new Date().toLocaleDateString('ko-KR')}  ·  총 ${rows.length}매`, pw / 2, 27, 3.2, false, 'center');
    const cols = [['No', 12], ['도면번호', 34], ['도면명', 120], ['공종', 26], ['층', 22], ['축척', 22], ['용지', 18], ['REV', 34], ['일자', 30], ['승인', 30]]; const keys = ['i', 'no', 'name', 'disc', 'level', 'scale', 'paper', 'rev', 'date', 'app'];
    const tot = cols.reduce((a, c2) => a + c2[1], 0); const x0 = 15 + (pw - 20 - tot) / 2; const rh = Math.min(8, (ph - 50) / (rows.length + 1)); let y = 35; x.lineWidth = Math.max(0.6, 0.2 * k);
    const line = (vals, bold) => { let X = x0; vals.forEach((v, j) => { x.strokeRect(X * k, y * k, cols[j][1] * k, rh * k); const al = j === 2 ? 'left' : 'center'; T(v, al === 'left' ? X + 2 : X + cols[j][1] / 2, y + rh / 2, Math.min(3.2, rh * 0.5), bold, al); X += cols[j][1]; }); y += rh; };
    x.fillStyle = '#eef0f3'; x.fillRect(x0 * k, y * k, tot * k, rh * k); x.fillStyle = '#111'; line(cols.map(c2 => c2[0]), true); for (const r of rows) line(keys.map(kk => r[kk]));
    return new Promise(res => c.toBlob(async b => res({ jpg: new Uint8Array(await b.arrayBuffer()), pxW: c.width, pxH: c.height, pageW: pw, pageH: ph }), 'image/jpeg', 0.9));
  }
  async function batchPlot() {
    const order = [...P.sheets].sort((a, b) => (a.kind === 'section') - (b.kind === 'section') || (levelOf(P, a.level)?.elev ?? 0) - (levelOf(P, b.level)?.elev ?? 0) || a.name.localeCompare(b.name, 'ko'));
    const body = h('div', {}, h('div', { class: 'note', style: { marginBottom: '6px' } }, '선택한 도면을 각 도면의 플롯 설정(용지·축척·표제란)대로 한 PDF로 묶습니다. 첫 장에 도면 목록을 넣을 수 있습니다.'));
    const list = h('div', { style: { maxHeight: '300px', overflow: 'auto', border: '1px solid var(--line)', borderRadius: '6px', padding: '6px' } }); const cbs = [];
    const all = h('input', { type: 'checkbox', checked: true, onchange: e => cbs.forEach(c => c.checked = e.target.checked) });
    list.append(h('label', { class: 'row', style: { gap: '6px', fontWeight: 600 } }, all, `전체 (${order.length})`));
    for (const s of order) { const nEnt = (P.content[s.id]?.ents.length || 0) + (P.content[s.id]?.els.length || 0); const cb = h('input', { type: 'checkbox', checked: nEnt > 0 }); cb.dataset.id = s.id; cbs.push(cb); list.append(h('label', { class: 'row', style: { gap: '6px' } }, cb, s.name, h('span', { class: 'note' }, ` · ${nEnt}개${P.view.plot?.[s.id] ? ' · ' + (P.view.plot[s.id].paper || 'A3') : ''}`))); }
    body.append(list);
    const v = await dialog({ title: '일괄 플롯 · 도면 목록', wide: true, body, fields: [
      { key: 'paper', label: '용지', type: 'select', options: [['', '도면별 설정대로'], ...Object.keys(PAPER).map(k2 => [k2, `모두 ${k2}`])], value: '' },
      { key: 'dpi', label: '해상도', type: 'select', options: [[120, '120dpi (빠름·가벼움)'], [150, '150dpi'], [200, '200dpi (선명)']], value: 150 },
      { key: 'cover', label: '첫 장에 도면 목록', type: 'checkbox', value: true },
      { key: 'out', label: '출력', type: 'select', options: [['pdf', 'PDF 묶음'], ['xlsx', '도면 목록 Excel만']], value: 'pdf' }], ok: '출력' });
    if (!v) return; const ids = cbs.filter(c => c.checked).map(c => c.dataset.id); if (!ids.length) return toast('도면을 선택하세요');
    const sheets = ids.map(id => P.sheets.find(s => s.id === id)); const rows = sheets.map(sheetRow);
    if (v.out === 'xlsx') { const { writeBook } = await import('../js/excel.js'); return saveFile(`${P.name}_도면목록.xlsx`.replace(/[\\/:*?"<>|]/g, '_'), await writeBook([{ name: '도면목록', rows: [['No', '도면번호', '도면명', '공종', '층', '축척', '용지', 'REV', '일자', '승인'], ...rows.map(r => [r.i, r.no, r.name, r.disc, r.level, r.scale, r.paper, r.rev, r.date, r.app])], widths: [5, 14, 36, 10, 8, 8, 6, 14, 12, 10] }])); }
    const dpi = +v.dpi; const pages = []; const t0 = performance.now();
    try {
      if (v.cover) for (let i = 0; i < rows.length; i += 30) pages.push(await drawingListPage(rows.slice(i, i + 30), dpi));
      for (let i = 0; i < ids.length; i++) { log(`일괄 플롯 ${i + 1}/${ids.length}: ${sheets[i].name}`); pages.push(await renderSheetJpeg(ids[i], dpi, v.paper || null)); await new Promise(r => setTimeout(r, 0)); }
    } catch (e) { console.error(e); return toast('일괄 플롯 실패: ' + (e.message || e), 'err'); }
    const blob = pdfPagesFromJpeg(pages, `${P.name} drawings`);
    log(`일괄 플롯 완료: ${pages.length}쪽, ${(blob.size / 1e6).toFixed(1)}MB, ${((performance.now() - t0) / 1000).toFixed(1)}초`); ctx.state.lastBatch = { pages: pages.length, size: blob.size };
    saveFile(`${P.name}_도면일괄.pdf`.replace(/[\\/:*?"<>|]/g, '_'), blob);
  }
  // ---------- PDF 언더레이 ----------
  const ulImg = new Map();
  const ulOf = () => (P.underlays || {})[sid];
  async function pdfUnderlay() {
    const u = ulOf();
    if (u) { const v = await dialog({ title: 'PDF 언더레이', fields: [{ key: 'a', label: '작업', type: 'select', options: [['cal', '축척 보정 (두 점 + 실제 거리)'], ['move', '이동'], ['op', '투명도 변경'], ['hide', u.hidden ? '다시 표시' : '숨기기'], ['new', '다른 PDF로 교체'], ['del', '제거']], value: u.cal ? 'op' : 'cal' }, { key: 'op', label: '투명도(0.1~1)', type: 'number', value: u.op ?? 0.6 }] }); if (!v) return; if (v.a === 'cal') return startCmd('UCAL'); if (v.a === 'move') return startCmd('UMOVE'); if (v.a === 'op') { u.op = clamp(v.op || 0.6, 0.1, 1); } if (v.a === 'hide') u.hidden = !u.hidden; if (v.a === 'del') { delete P.underlays[sid]; await ctx.store.dropBlob(u.key); } if (v.a !== 'new') { ctx.touch('meta'); dirty = true; return; } }
    const f = await pickFile('.pdf,application/pdf,image/*'); if (!f) return;
    try {
      let dataURL, pages = 1, pageNo = 1;
      if (/pdf$/i.test(f.name) || f.type === 'application/pdf') {
        toast('PDF 읽는 중…'); if (!window.pdfjsLib) await loadScript(new URL('../lib/pdf.min.js', import.meta.url).href); const pj = window.pdfjsLib; pj.GlobalWorkerOptions.workerSrc = new URL('../lib/pdf.worker.min.js', import.meta.url).href;
        const doc = await pj.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise; pages = doc.numPages;
        if (pages > 1) { const v = await dialog({ title: 'PDF 페이지', fields: [{ key: 'p', label: `페이지 (1~${pages})`, type: 'number', value: 1 }] }); if (!v) return; pageNo = clamp(Math.round(v.p || 1), 1, pages); }
        const page = await doc.getPage(pageNo); const vp0 = page.getViewport({ scale: 1 }); const sc = Math.min(4, 3200 / Math.max(vp0.width, vp0.height)); const vp = page.getViewport({ scale: sc });
        const c2 = document.createElement('canvas'); c2.width = vp.width; c2.height = vp.height; await page.render({ canvasContext: c2.getContext('2d'), viewport: vp }).promise; dataURL = c2.toDataURL('image/jpeg', 0.82);
        var mmW = vp0.width / 72 * 25.4, mmH = vp0.height / 72 * 25.4; // 용지 크기(mm)
      } else { dataURL = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); }); const im = new Image(); im.src = dataURL; await im.decode(); var mmW = im.width, mmH = im.height; }
      const v = await dialog({ title: 'PDF 언더레이 배치', body: `<div class="note">${esc(f.name)} p.${pageNo}/${pages}. 용지 크기 ${fmt0(mmW)}×${fmt0(mmH)}mm. 도면 축척을 알면 입력하고, 모르면 배치 후 "축척 보정"으로 맞추세요.</div>`, fields: [{ key: 'sc', label: '도면 축척 1:', type: 'number', value: 100 }, { key: 'op', label: '투명도', type: 'number', value: 0.6 }] }); if (!v) return;
      const key = `ul_${P.id}_${sid}`; await ctx.store.putBlob(key, { d: dataURL }); ulImg.delete(key);
      const s0 = v.sc || 100; const b = sheetBBox(); P.underlays ||= {}; P.underlays[sid] = { key, name: f.name, page: pageNo, x: b ? b.x0 : 0, y: b ? b.y0 : 0, w: mmW * s0, h: mmH * s0, op: v.op || 0.6, cal: false };
      ctx.touch('meta'); zoomTo({ x0: P.underlays[sid].x, y0: P.underlays[sid].y, x1: P.underlays[sid].x + P.underlays[sid].w, y1: P.underlays[sid].y + P.underlays[sid].h }); log(`PDF 언더레이: ${f.name} — 리본 측정·기성 탭 "PDF 도면"에서 축척 보정, "물량 산출"로 길이·면적·개수 측정`, '#3fdf8f');
    } catch (e) { console.error(e); toast('PDF를 불러오지 못했습니다: ' + e.message, 'err'); }
  }
  function drawUnderlay() {
    const u = ulOf(); if (!u || u.hidden) return; let im = ulImg.get(u.key);
    if (!im) { im = new Image(); ulImg.set(u.key, im); ctx.store.getBlob(u.key).then(b => { if (b?.d) { im.src = b.d; im.onload = () => { dirty = true; }; } }); return; }
    if (!im.complete || !im.naturalWidth) return; const a = w2s([u.x, u.y + u.h]); g.save(); g.globalAlpha = u.op ?? 0.6; g.filter = 'invert(1) hue-rotate(180deg)'; g.drawImage(im, a[0], a[1], u.w * V.s, u.h * V.s); g.restore();
  }
  // ---------- 물량 산출(수동) ----------
  function toQty(t) { const m = 1000; let raw = 0; if (t.type === 'len') for (let i = 1; i < t.pts.length; i++) raw += dist(t.pts[i - 1], t.pts[i]) / m; else if (t.type === 'area') raw = Math.abs(polyArea(t.pts)) / 1e6; else raw = t.pts.length; return { raw, qty: raw * (t.mult || 1), unit: t.type === 'count' ? 'EA' : t.type === 'area' ? 'm²' : 'm' }; }
  function drawTakeoffs() {
    for (const t of (P.takeoffs || []).filter(x => x.sheet === sid)) {
      g.save(); g.strokeStyle = t.color || '#ff9f43'; g.fillStyle = (t.color || '#ff9f43') + '30'; g.lineWidth = 2;
      if (t.type === 'count') for (const p of t.pts) { const q = w2s(p); g.beginPath(); g.arc(q[0], q[1], 6, 0, Math.PI * 2); g.fill(); g.stroke(); }
      else { path(t.pts, t.type === 'area'); if (t.type === 'area') g.fill(); g.stroke(); }
      const q = toQty(t); const b = bboxOf(t.pts); drawText([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2], 300, `${t.name} ${fmt(q.qty, 2)}${q.unit}`, 0, t.color || '#ff9f43', 'center', 'middle'); g.restore();
    }
  }
  // 화면을 선 그림으로 다시 그려 래스터에서 닫힌 영역 인식 (그리드·치수·문자 제외)
  function wandAt(p) {
    const w = Math.round(W), hh = Math.round(H); const off = document.createElement('canvas'); off.width = w; off.height = hh; const og = off.getContext('2d', { willReadFrequently: true });
    const keep = g, kb = BG; g = og; BG = '#000000';
    try { g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, w, hh); drawUnderlay(); const c = C(); for (const el of c.els) if (el.k !== 'opening') drawEl(el, c, 'normal'); for (const e of c.ents) if (layerVisible(e.layer) && !['grid', 'dim', 'text', 'rdim', 'adim', 'leader', 'hatch', 'cloud'].includes(e.t)) drawEnt(e, '#ffffff', 1.5); }
    finally { g = keep; BG = kb; dirty = true; }
    const d = og.getImageData(0, 0, w, hh).data; const lum = new Uint8Array(w * hh); for (let i = 0; i < lum.length; i++) lum[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) | 0;
    const q = w2s(p); const r = wandRegion(lum, w, hh, Math.round(q[0]), Math.round(q[1]), { thr: 70, gap: 2 }); if (r.err) return r;
    return { pts: r.poly.map(([x, y]) => s2w(x, y)) };
  }
  // ---------- 단면·입면 자동 생성 ----------
  const SEC_LAYERS = ['SEC-CUT', 'SEC-BEYOND', 'SEC-ANNO'];
  function ensureSecLayers() { for (const [n, c] of [['SEC-CUT', '#f2f2f2'], ['SEC-BEYOND', '#9aa5b1'], ['SEC-ANNO', '#9cc3e8'], ['SEC-MARK', '#ff9f43']]) if (!layerOf(n)) P.layers.push({ name: n, color: c, visible: true }); }
  function secSheetName(kind, title) { const n = P.sheets.filter(x => x.kind === 'section').length + 1; return `A-${(kind === 'elevation' ? 200 : 300) + n} ${title}`; }
  function fillSection(sh) {
    const r = buildSection(P, sh.sec); const c = P.content[sh.id]; c.ents = c.ents.filter(e => !e.auto); // 사용자가 추가한 요소는 유지
    for (const e of r.ents) { e.id = uid('x'); e.auto = true; c.ents.push(e); } sh.sec.at = Date.now(); return r;
  }
  async function makeSection(sec) {
    const used = new Set(P.sheets.filter(x => x.sec?.mark).map(x => x.sec.mark)); const mark = 'ABCDEFGHJKLMNPQRSTUVWXYZ'.split('').find(ch => !used.has(ch)) || String(used.size + 1);
    const v = await dialog({ title: `단면 ${mark}-${mark}' 생성`, fields: [{ key: 'title', label: '도면명', value: `단면도 ${mark}-${mark}'` }, { key: 'depth', label: '보이는 깊이(mm, 절단면 뒤로 그릴 범위)', type: 'number', value: 30000 }], ok: '생성' }); if (!v) return;
    ensureSecLayers(); const src = sid;
    const sh = { id: uid('s'), name: secSheetName('section', v.title), disc: 'A', level: [...P.levels].sort((x, y) => x.elev - y.elev)[0].id, kind: 'section', sec: { ...sec, depth: +v.depth || 30000, title: v.title, mark, src } };
    P.sheets.push(sh); P.content[sh.id] = { ents: [], els: [] }; const r = fillSection(sh);
    // 원본 평면에 절단선 표시
    const d = norm(sub(sec.b, sec.a)), n = mul([-d[1], d[0]], sec.side * 900), ex = mul(d, 600); const hh = 450;
    const sc = P.content[src]; for (const e of [{ t: 'line', a: sub(sec.a, ex), b: add(sec.b, ex), layer: 'SEC-MARK', lt: 'PHANTOM' }, { t: 'line', a: sec.a, b: add(sec.a, n), layer: 'SEC-MARK' }, { t: 'line', a: sec.b, b: add(sec.b, n), layer: 'SEC-MARK' }, { t: 'text', p: add(add(sec.a, n), [-hh / 2, 100]), h: hh, s: mark, rot: 0, layer: 'SEC-MARK' }, { t: 'text', p: add(add(sec.b, n), [-hh / 2, 100]), h: hh, s: mark + "'", rot: 0, layer: 'SEC-MARK' }]) { e.id = uid('m'); e.secOf = sh.id; sc.ents.push(e); }
    ctx.touch(['meta', sh.id, src]); log(`${sh.name}: 절단 ${r.nCut} · 투영 ${r.nBeyond}개 객체`, '#3fdf8f'); switchSheet(sh.id); renderPB();
  }
  async function makeElevations() {
    const lines = elevationLines(P); if (!lines.length) return toast('모델 객체가 없습니다');
    const v = await dialog({ title: '입면도 생성', body: '<div class="note">모델 전체를 동·서·남·북에서 바라본 입면도를 새 도면으로 만듭니다. 가까운 면이 뒤쪽 객체를 가리며, 창호·커튼월 줄눈이 표시됩니다.</div>', fields: lines.map(l => ({ key: l.key, label: l.title, type: 'checkbox', value: true })), ok: '생성' }); if (!v) return;
    ensureSecLayers(); let first = null; const L1 = [...P.levels].sort((x, y) => x.elev - y.elev)[0].id;
    for (const l of lines) { if (!v[l.key]) continue; let sh = P.sheets.find(x => x.kind === 'section' && x.sec?.elev === l.key); if (!sh) { sh = { id: uid('s'), name: secSheetName('elevation', l.title), disc: 'A', level: L1, kind: 'section', sec: { a: l.a, b: l.b, side: 1, mode: 'elevation', title: l.title, elev: l.key } }; P.sheets.push(sh); P.content[sh.id] = { ents: [], els: [] }; } else { sh.sec.a = l.a; sh.sec.b = l.b; } fillSection(sh); ctx.touch(sh.id); first ||= sh.id; }
    ctx.touch('meta'); if (first) { switchSheet(first); renderPB(); toast('입면도를 만들었습니다 — 프로젝트 탐색기 "단면·입면"', 'ok'); }
  }
  async function pickFurn() {
    const cur = P.view.lastFurn || { type: 'sofa', rot: 0 };
    const v = await dialog({ title: '가구·조경 배치', body: '<div class="note">클릭할 때마다 하나씩 놓입니다. 배치 중 R=90° 회전, 숫자=각도, T=종류 변경. 등받이·머리판 쪽이 회전 0°에서 위(북)쪽입니다.</div>', fields: [{ key: 'type', label: '종류', type: 'select', options: FURN_CATS.flatMap(c => Object.entries(FURN).filter(([, f]) => f.cat === c).map(([k, f]) => [k, `${c} · ${f.name} (${f.w}×${f.d})`])), value: cur.type }, { key: 'rot', label: '회전(°)', type: 'number', value: cur.rot || 0 }], ok: '배치' });
    return v ? { type: v.type, rot: +v.rot || 0 } : null;
  }
  async function takeoffMenu() {
    const items = (P.takeoffs || []).filter(t => t.sheet === sid);
    const v = await dialog({ title: '물량 산출 (도면·PDF 위 측정)', body: `<div class="note">PDF 언더레이나 도면 위에서 길이·면적·개수를 재고 내역 코드에 연결합니다. 결과는 물량산출 툴에 "수동 산출"로 합산됩니다. 이 도면 측정 ${items.length}건.</div>`, fields: [
      { key: 'type', label: '측정 종류', type: 'select', options: [['wand', '면적 — 클릭 한 번 자동 인식 (방 안쪽 클릭)'], ['area', '면적 — 꼭짓점 직접 클릭 (m²)'], ['len', '길이 (m)'], ['count', '개수 (EA)']], value: 'wand' },
      { key: 'name', label: '항목명 (예: 바닥 타일, 칸막이 벽)', value: '' },
      { key: 'code', label: '내역 코드', type: 'select', options: [['', '(미지정)'], ...P.boq.map(b => [b.code, `${b.code} ${b.name} (${b.unit})`])], value: '' },
      { key: 'mult', label: '곱할 값 (길이×높이로 벽면적 등, 기본 1)', type: 'number', value: 1 },
      { key: 'color', label: '표시 색', type: 'color', value: '#ff9f43' },
      { key: 'clear', label: '이 도면 측정 결과 모두 삭제', type: 'checkbox', value: false }], ok: '측정 시작' });
    if (!v) return; if (v.clear) { P.takeoffs = (P.takeoffs || []).filter(t => t.sheet !== sid); ctx.touch('meta'); ctx.bus.emit('model', {}); dirty = true; return; }
    if (v.type === 'wand') return startCmd('WAND', { name: v.name || '면적', code: v.code, mult: v.mult || 1, color: v.color });
    startCmd('TAKEOFF', { type: v.type, name: v.name || { area: '면적', len: '길이', count: '개수' }[v.type], code: v.code, mult: v.mult || 1, color: v.color });
  }

  // Core 1.1.0 객체 속성 — 사용자 입력(용도·현장 수치·기구 사양)만 편집, 설계값은 자동 산정·근거 표시
  function coreFields(k, els, fld, kv, sec) {
    const ro = (label, val) => kv.append(h('label', {}, label), h('span', { class: 'mono' }, val));
    const note = (s) => sec.append(h('div', { class: 'note', style: { marginTop: '6px' } }, s));
    const one = els.length === 1 ? els[0] : null;
    const setAll = (fn) => { snapshot(); els.forEach(fn); changed(); };
    if (k === 'room') {
      fld('실명', 'name', 'text');
      kv.append(h('label', {}, '용도')); const u = h('select'); u.append(h('option', { value: '' }, '—'));
      const uses = new Set(els.map(e => e.use)); for (const n of Object.keys(LUX_BY_USE)) u.append(h('option', { value: n, selected: uses.size === 1 && uses.has(n) }, `${n} (${LUX_BY_USE[n]}lx)`));
      u.onchange = () => { if (!u.value) return; setAll(e => { e.use = u.value; e.lux = LUX_BY_USE[u.value]; }); }; kv.append(u);
      fld('천장고(실 높이)', 'h');
      const lx = new Set(els.map(e => e.lux || LUX_BY_USE[e.use] || 300)); ro('목표 조도', lx.size === 1 ? `${[...lx][0]} lx` : '(여러 값)');
      note('목표 조도는 용도에 따라 자동 지정 (KS A 3011 조도기준 대표값). 평균 조도 판정·조명 배치는 인테리어 툴.');
      if (one) {
        const { A } = roomInfo(one); note(`면적 ${fmt(A, 2)} m² · 둘레 ${fmt(polyPerim(one.pts, true) / 1000, 2)} m`);
        const ins = C().els.filter(e => e.k === 'light' && e.p && pointInPolyLocal(e.p, one.pts));
        if (ins.length) note(`실 안 조명 ${ins.length}개 · ${fmt0(ins.reduce((s, e) => s + (e.watt || 0), 0))} W`);
      }
    }
    if (k === 'ceiling') {
      fld('천장고 FL+', 'z'); fld('두께', 't'); fld('마감', 'fin', 'text');
      if (one) note(`면적 ${fmt(Math.abs(polyArea(one.pts)) / 1e6, 2)} m² (내역 CLG)`);
    }
    if (k === 'light') {
      fld('기구 종류', 'type', 'text'); fld('폭 W', 'w'); fld('깊이 D', 'd'); fld('설치 FL+', 'z'); fld('회전(°)', 'rot'); fld('소비전력 W', 'watt'); fld('광속 lm', 'lm'); fld('회로', 'circuit', 'text');
      const w = els.reduce((s, e) => s + (e.watt || 0), 0); if (w) note(`소비전력 합계 ${fmt0(w)} W — MEP 툴이 회로별 부하에 반영`);
    }
    if (k === 'sprinkler') {
      kv.append(h('label', {}, '헤드 유형')); const t = h('select'); t.append(h('option', { value: '' }, '—'));
      const ts = new Set(els.map(e => e.type)); for (const [v, [n, kf]] of Object.entries(SPK_TYPES)) t.append(h('option', { value: v, selected: ts.size === 1 && ts.has(v) }, `${n} K${kf}`));
      t.onchange = () => { if (!t.value) return; setAll(e => { e.type = t.value; e.kf = SPK_TYPES[t.value][1]; }); }; kv.append(t);
      fld('설치 FL+', 'z');
      const kf = new Set(els.map(e => e.kf ?? 80)); ro('K-factor', kf.size === 1 ? String([...kf][0]) : '(여러 값)');
      note('K-factor는 헤드 유형에 따라 자동 지정 (NFTC 103 표준형 K=80). 배치 간격·수원 검토는 MEP 툴.');
    }
    if (k === 'panel') {
      fld('계통', 'sys', 'select', [['전등', '전등'], ['전열', '전열'], ['동력', '동력'], ['비상', '비상']]); fld('폭 W', 'w'); fld('깊이 D', 'd'); fld('높이', 'h'); fld('하단 FL+', 'z0'); fld('회전(°)', 'rot');
      const kw = new Set(els.map(e => e.kw ?? 0)); ro('연결 부하', kw.size === 1 ? `${fmt([...kw][0], 2)} kW` : '(여러 값)');
      note('연결 부하(kW)는 MEP 툴이 조명·설비 부하를 합산해 산정합니다.');
    }
  }
  // ---------- 속성 패널 ----------
  function renderSide() {
    side.innerHTML = '';
    const c = C(); const { ents, els } = selected();
    side.append(h('h4', {}, sel.size ? `선택 ${sel.size}` : '속성', h('button', { class: 'btn sm show-m', onclick: () => side.classList.remove('open') }, '닫기')));
    const sec = h('div', { class: 'sec' }); side.append(sec);
    if (!sel.size) {
      sec.append(h('div', { class: 'kv' },
        h('label', {}, '도면'), h('span', {}, sheet().name), h('label', {}, '공종'), h('span', {}, `${sheet().disc} ${DISC[sheet().disc]?.name}`),
        h('label', {}, '층'), h('span', {}, `${lv().name} (FL ${fmt0(lv().elev)})`), h('label', {}, '객체/요소'), h('span', {}, `${c.els.length} / ${c.ents.length}`)));
      sec.append(h('div', { class: 'note', style: { marginTop: '8px' } }, '클릭: 선택 · 드래그: 범위선택(왼→오 포함, 오→왼 걸침) · 휠: 줌 · 가운데 버튼/두 손가락: 이동 · 명령은 아래 입력창에 입력'));
      // 기본값
      const dsec = h('div', { class: 'sec' }); side.append(h('h4', {}, '작도 기본값'), dsec);
      const kv = h('div', { class: 'kv' }); dsec.append(kv);
      const fld = (label, obj, key, type = 'number', opts) => { kv.append(h('label', {}, label)); let i; if (type === 'select') { i = h('select'); for (const [v, l] of opts) i.append(h('option', { value: v, selected: String(obj[key]) === String(v) }, l)); } else { i = h('input', { type, value: obj[key] ?? '' }); } i.onchange = () => { obj[key] = type === 'number' ? (i.value === '' ? null : +i.value) : i.value; ctx.touch('meta'); }; kv.append(i); };
      fld('벽 두께', D.wall, 't'); fld('벽 재료', D.wall, 'mat', 'select', Object.entries(MATS).map(([k, m]) => [k, m.name])); fld('기둥 W', D.column, 'w'); fld('기둥 D', D.column, 'd');
      fld('기둥 재료', D.column, 'mat', 'select', [['RC', 'RC'], ['STEEL', '철골']]); fld('철골기둥', D.column, 'sec', 'select', Object.keys(SECTIONS).map(k => [k, k]));
      fld('보 W', D.beam, 'w'); fld('보 D', D.beam, 'd'); fld('보 재료', D.beam, 'mat', 'select', [['RC', 'RC'], ['STEEL', '철골']]); fld('철골보', D.beam, 'sec', 'select', Object.keys(SECTIONS).map(k => [k, k]));
      fld('슬래브 t', D.slab, 't'); fld('덕트 W×H', D.duct, 'w'); fld('덕트 높이', D.duct, 'hh'); fld('덕트 FL+', D.duct, 'z'); fld('배관 관경', D.pipe, 'w'); fld('배관 FL+', D.pipe, 'z'); fld('트레이 FL+', D.tray, 'z'); fld('문자 높이', D.text, 'h');
    } else {
      // 공통 편집
      const kinds = [...new Set(els.map(e => e.k))];
      if (els.length) {
        sec.append(h('div', { class: 'note' }, `객체: ${kinds.map(k => `${KINDS[k]?.name} ${els.filter(e => e.k === k).length}`).join(', ')}`));
        if (kinds.length === 1) {
          const k = kinds[0], kv = h('div', { class: 'kv', style: { marginTop: '8px' } }); sec.append(kv);
          const common = (key) => { const vs = new Set(els.map(e => e[key] ?? '')); return vs.size === 1 ? [...vs][0] : ''; };
          const fld = (label, key, type = 'number', opts) => {
            kv.append(h('label', {}, label)); let i;
            if (type === 'select') { i = h('select'); i.append(h('option', { value: '' }, '—')); for (const [v, l] of opts) i.append(h('option', { value: v, selected: String(common(key)) === String(v) }, l)); }
            else i = h('input', { type, value: common(key), placeholder: els.length > 1 ? '(여러 값)' : '' });
            i.onchange = () => { if (i.value === '' && type !== 'number') return; snapshot(); for (const e of els) { e[key] = type === 'number' ? (i.value === '' ? null : +i.value) : i.value; if (key === 'mat' && e.mat === 'STEEL' && (e.k === 'column' || e.k === 'beam') && !e.sec) e.sec = D[e.k].sec; if (key === 'sec' && SECTIONS[e.sec]) { e.w = SECTIONS[e.sec].b; e.d = SECTIONS[e.sec].h; } } changed(); };
            kv.append(i);
          };
          fld('태그', 'tag', 'text'); fld('구역', 'zone', 'text');
          if (k === 'wall') { fld('재료', 'mat', 'select', Object.entries(MATS).map(([a, m]) => [a, m.name])); fld('두께', 't'); fld('높이(빈칸=층고)', 'h'); fld('하단 오프셋', 'z0'); fld('철근비 kg/m³', 'rr'); }
          if (k === 'column') { fld('재료', 'mat', 'select', [['RC', 'RC'], ['STEEL', '철골']]); fld('W', 'w'); fld('D', 'd'); fld('철골 규격', 'sec', 'select', Object.keys(SECTIONS).map(a => [a, a])); fld('회전(°)', 'rot'); fld('높이(빈칸=층고)', 'h'); fld('철근비 kg/m³', 'rr'); }
          if (k === 'beam') { fld('재료', 'mat', 'select', [['RC', 'RC'], ['STEEL', '철골']]); fld('W', 'w'); fld('D(춤)', 'd'); fld('철골 규격', 'sec', 'select', Object.keys(SECTIONS).map(a => [a, a])); fld('상단 오프셋', 'dz'); fld('철근비 kg/m³', 'rr'); }
          if (k === 'slab') { fld('두께', 't'); fld('상단 오프셋', 'dz'); fld('철근비 kg/m³', 'rr'); }
          if (k === 'furn') { fld('종류', 'type', 'select', Object.entries(FURN).map(([a, f]) => [a, `${f.cat} · ${f.name}`])); fld('폭 W', 'w'); fld('깊이 D', 'd'); fld('높이', 'h'); fld('회전(°)', 'rot'); fld('바닥에서 띄움', 'z0'); fld('색', 'color', 'text'); fld('실명', 'room', 'text'); }
          if (k === 'footing') { fld('W', 'w'); fld('D', 'd'); fld('두께', 't'); fld('철근비 kg/m³', 'rr'); }
          if (k === 'opening') { fld('종류', 'kind', 'select', [['door', '문'], ['window', '창']]); fld('폭', 'w'); fld('높이', 'h'); fld('창대 높이', 'sill'); fld('벽 시작점부터', 's'); }
          if (['duct', 'pipe', 'tray'].includes(k)) { fld('계통', 'sys', 'text'); fld(k === 'pipe' ? '관경' : '폭', 'w'); fld(k === 'pipe' ? '외경 높이' : '높이', 'hh'); fld('중심 FL+', 'z'); }
          coreFields(k, els, fld, kv, sec);
          if (els.length === 1 && RB_FIELDS[k] && els[0].mat !== 'STEEL') {
            const e = els[0], sch = P.rebarSchedule?.[specKey(e)];
            const rb = h('div', { class: 'kv', style: { marginTop: '10px' } }); sec.append(h('div', { class: 'note', style: { marginTop: '10px' } }, `배근 ${e.rebar ? '(개별 지정)' : sch ? `(부재 리스트 ${e.tag || ''})` : '(미지정 → 철근비)'}`), rb);
            for (const [key, label, type] of RB_FIELDS[k]) {
              const i = h('input', { value: e.rebar?.[key] ?? '', placeholder: String(sch?.[key] ?? '') });
              i.onchange = () => { const ok = !i.value || (type === 'num' ? !isNaN(+i.value) : type === 'n' ? !!parseN(i.value) : !!parseS(i.value)); if (!ok) return toast('형식: 12-D22 또는 D10@150', 'err'); snapshot(); e.rebar = { ...(e.rebar || sch || defaultSpec(k, e)) }; if (i.value) e.rebar[key] = type === 'num' ? +i.value : i.value.toUpperCase(); changed(); };
              rb.append(h('label', {}, label.split(' (')[0]), i);
            }
            const sp = e.rebar || sch; if (sp) { const kg = bbs(e, lv(), sp, { openings: C().els.filter(o => o.k === 'opening') }).reduce((a, b) => a + b.kg, 0); sec.append(h('div', { class: 'note' }, `철근 ${fmt(kg, 1)} kg`)); }
            if (e.rebar) sec.append(h('button', { class: 'btn sm', onclick: () => { snapshot(); delete e.rebar; changed(); } }, '개별 배근 해제'));
          }
          if (els.length === 1 && els[0].a) { const e = els[0]; sec.append(h('div', { class: 'note', style: { marginTop: '6px' } }, `길이 ${fmt0(dist(e.a, e.b))} mm`)); }
          if (els.length === 1 && k === 'slab') { const e = els[0]; sec.append(h('div', { class: 'note', style: { marginTop: '6px' } }, `면적 ${fmt(Math.abs(polyArea(e.pts)) / 1e6, 2)} m²`)); }
        }
      }
      if (ents.length) {
        const types = [...new Set(ents.map(e => e.t))];
        sec.append(h('div', { class: 'note', style: { marginTop: '8px' } }, `요소: ${types.map(t => `${{ line: '선', pline: '폴리선', circle: '원', arc: '호', text: '문자', dim: '치수', grid: '그리드' }[t] || t} ${ents.filter(e => e.t === t).length}`).join(', ')}`));
        const kv = h('div', { class: 'kv', style: { marginTop: '8px' } }); sec.append(kv);
        const layerSel = h('select'); layerSel.append(h('option', { value: '' }, '—')); for (const l of allLayers()) layerSel.append(h('option', { value: l, selected: ents.every(e => e.layer === l) }, l));
        layerSel.onchange = () => { if (!layerSel.value) return; snapshot(); ents.forEach(e => e.layer = layerSel.value); changed(); };
        kv.append(h('label', {}, '레이어'), layerSel);
        if (ents.length === 1) {
          const e = ents[0];
          const tf = (label, key, type = 'text') => { const i = h('input', { type, value: e[key] ?? '' }); i.onchange = () => { snapshot(); e[key] = type === 'number' ? +i.value : i.value; changed(); }; kv.append(h('label', {}, label), i); };
          if (e.t === 'text') { tf('내용', 's'); tf('높이', 'h', 'number'); tf('회전', 'rot', 'number'); }
          if (e.t === 'dim') { tf('치수 문자 수정', 'ovr'); kv.append(h('label', {}, '실제 길이'), h('span', { class: 'mono' }, fmt0(dist(e.a, e.b)))); }
          if (e.t === 'grid') tf('라벨', 'label');
          if (e.t === 'line') kv.append(h('label', {}, '길이'), h('span', { class: 'mono' }, fmt(dist(e.a, e.b), 1)), h('label', {}, '각도'), h('span', { class: 'mono' }, fmt(((angOf(e.a, e.b) * 180 / Math.PI) + 360) % 360, 2) + '°'));
          if (e.t === 'circle') { tf('반지름', 'r', 'number'); }
          if (e.t === 'pline') kv.append(h('label', {}, '길이'), h('span', { class: 'mono' }, fmt(polyPerim(e.pts, e.closed), 1)), ...(e.closed ? [h('label', {}, '면적'), h('span', { class: 'mono' }, fmt(Math.abs(polyArea(e.pts)) / 1e6, 3) + ' m²')] : []));
        }
      }
      sec.append(h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { class: 'btn sm', onclick: () => startCmd('MOVE') }, '이동'), h('button', { class: 'btn sm', onclick: () => startCmd('COPY') }, '복사'), h('button', { class: 'btn sm', onclick: () => startCmd('ERASE') }, '삭제'),
        els.length ? h('button', { class: 'btn sm', onclick: () => { ctx.state.hi = { ids: els.map(e => e.id), sheet: sid }; ctx.go('view3d'); } }, '3D에서 보기') : null,
        ents.some(e => e.t === 'line' || e.t === 'pline') ? h('button', { class: 'btn sm', onclick: () => startCmd('CONVERT') }, '객체로 변환') : null));
    }
    // 레이어
    const ls = h('div', { class: 'sec', id: 'cadLayers' });
    side.append(h('h4', {}, '레이어', h('button', { class: 'btn sm', onclick: async () => { const v = await dialog({ title: '레이어 추가', fields: [{ key: 'n', label: '이름' }, { key: 'c', label: '색', type: 'color', value: '#d0d5dd' }] }); if (v?.n) { P.layers.push({ name: v.n, color: v.c, visible: true }); curLayer = v.n; ctx.touch('meta'); renderSide(); } } }, '+')), ls);
    for (const name of allLayers()) {
      let L = P.layers.find(l => l.name === name);
      const vis = h('input', { type: 'checkbox', checked: L?.visible !== false }); vis.onchange = () => { if (!L) { L = { name, color: layerColor(name), visible: true }; P.layers.push(L); } L.visible = vis.checked; ctx.touch('meta'); dirty = true; };
      const col = h('input', { type: 'color', value: layerColor(name), style: { width: '28px', height: '22px', padding: 0, border: 0, background: 'none' } }); col.onchange = () => { if (!L) { L = { name, color: col.value, visible: true }; P.layers.push(L); } L.color = col.value; ctx.touch('meta'); dirty = true; };
      const cur = h('button', { class: 'btn sm' + (curLayer === name ? ' on' : ''), onclick: () => { curLayer = name; renderSide(); dirty = true; } }, curLayer === name ? '현재' : '사용');
      ls.append(h('div', { class: 'row', style: { justifyContent: 'space-between', margin: '3px 0' } }, h('label', { class: 'row', style: { gap: '6px' } }, vis, col, h('span', { style: { fontSize: '12.5px' } }, name)), cur));
    }
    // 명령 도움말
    side.append(h('h4', {}, '주요 명령'), h('div', { class: 'sec note mono', style: { lineHeight: 1.7 } },
      'L 선 · PL 폴리선 · REC 사각 · C 원 · A 호 · T 문자', h('br'), 'DLI 치수 · DI 거리 · AA 면적 · ID 좌표', h('br'), 'M 이동 · CO 복사 · RO 회전 · MI 대칭 · SC 축척', h('br'), 'AR 배열 · O 간격 · TR 자르기 · EX 연장 · F 모서리 · X 분해 · E 지우기', h('br'),
      'WA 벽 · COL 기둥 · BM 보 · SL 슬래브 · FT 기초', h('br'), 'DR 문 · WN 창 · DU 덕트 · PI 배관 · CT 트레이 · GL 그리드', h('br'), 'H 해치 · I 블록삽입 · B 블록정의 · LE 지시선 · DCO 연속치수 · DRA R치수 · DAN 각도치수', h('br'), 'S 신축 · BR 끊기 · J 결합 · MA 특성일치 · QS 빠른선택 · ED 문자편집 · REV 리비전', h('br'), 'CV 선→객체 · BASE 3D 기준점 · ZE 전체보기 · U 취소 · F10 극좌표', h('br'),
      '좌표: x,y · @dx,dy · @거리<각도 · 숫자(커서 방향 거리)', h('br'), '? 로 시작하면 AI 작도 (예: ?4x3 그리드에 기둥)'));
  }
  const allLayers = () => { const s = new Set(['0', ...P.layers.map(l => l.name)]); for (const e of C().ents) s.add(e.layer || '0'); return [...s]; };

  function switchSheet(id) { cancel(true); sid = id; S.sheet = id; sel.clear(); if (under === id) under = null; buildToolbar(); renderSide(); renderPB(); zoomExt(); }
  // ---------- 프로젝트 탐색기 (Revit Project Browser) ----------
  let pbOpen = P.view.pb ?? (window.innerWidth > 1200);
  function renderPB() {
    pb.innerHTML = ''; pb.style.display = pbOpen ? '' : 'none'; pb.classList.toggle('open', pbOpen); if (!pbOpen) return;
    pb.append(h('h4', {}, '프로젝트 탐색기', h('button', { class: 'btn sm', onclick: () => { pbOpen = false; P.view.pb = false; renderPB(); buildToolbar(); } }, '닫기')));
    const tr = h('div', { class: 'tr3' }); pb.append(tr);
    const det = (title, key, open, ...kids) => { const d = h('details', { open: (P.view.pbOpen ||= {})[key] ?? open }); d.ontoggle = () => { P.view.pbOpen[key] = d.open; }; d.append(h('summary', { class: 'tn', style: { fontWeight: 600 } }, title)); d.append(...kids.flat().filter(Boolean)); return d; };
    const row = (s, extra) => h('div', { class: 'pbrow' + (s.id === sid ? ' on' : ''), title: `${s.name} — 클릭: 열기 · 참조 버튼: 겹쳐 보기`, onclick: () => { if (s.id !== sid) switchSheet(s.id); if (extra === 'layout') setSpace('layout'); else if (space === 'layout') setSpace('model'); } },
      h('span', { class: 'tag' }, s.disc), h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' } }, s.name), extra === 'layout' ? null : h('span', { class: 'tag', style: { cursor: 'pointer', borderColor: under === s.id ? '#2c4f78' : '', color: under === s.id ? '#7cc4ff' : '' }, title: '참조(겹쳐 보기)', onclick: (e) => { e.stopPropagation(); if (s.id === sid) return; under = under === s.id ? null : s.id; buildToolbar(); renderPB(); dirty = true; } }, '참조'));
    const lv = [...P.levels].sort((a, b) => b.elev - a.elev);
    const secs = P.sheets.filter(x => x.kind === 'section');
    if (secs.length) tr.append(det(`단면·입면 ${secs.length}`, 'secs', true, secs.map(x => row(x))));
    tr.append(det('평면도 (층별)', 'plans', true, lv.map(L => { const ss = P.sheets.filter(x => x.level === L.id && x.kind !== 'section').sort((a, b) => a.disc.localeCompare(b.disc)); if (!ss.length) return null; return det(`${L.name}  FL ${fmt0(L.elev)}`, 'L' + L.id, true, ss.map(x => row(x))); })));
    tr.append(det('공종별', 'disc', false, Object.keys(DISC).map(d => { const ss = P.sheets.filter(x => x.disc === d); if (!ss.length) return null; return det(`${d} ${DISC[d].name} (${ss.length})`, 'D' + d, false, ss.map(x => row(x))); })));
    const plots = Object.keys(P.view.plot || {}).map(id => P.sheets.find(x => x.id === id)).filter(Boolean);
    tr.append(det(`시트 (배치) ${plots.length}`, 'sheets', true, plots.length ? plots.map(x => row(x, 'layout')) : h('div', { class: 'note', style: { padding: '4px 20px' } }, '출력 탭 "플롯"에서 배치를 저장하면 여기에 나옵니다.')));
    const ul = Object.entries(P.underlays || {}).map(([id, u]) => ({ s: P.sheets.find(x => x.id === id), u })).filter(x => x.s);
    if (ul.length) tr.append(det('PDF 언더레이', 'ul', false, ul.map(({ s: x, u }) => h('div', { class: 'pbrow', onclick: () => switchSheet(x.id) }, h('span', { class: 'tag' }, 'PDF'), `${u.name} → ${x.name}`))));
    const tk = (P.takeoffs || []).length; if (tk) tr.append(det(`수동 산출 ${tk}`, 'tk', false, P.sheets.map(x => { const n = P.takeoffs.filter(t => t.sheet === x.id); return n.length ? h('div', { class: 'pbrow', onclick: () => switchSheet(x.id) }, h('span', { class: 'tag' }, n.length), x.name) : null; })));
    tr.append(h('div', { style: { padding: '8px' } }, h('button', { class: 'btn sm', onclick: addSheet }, '+ 도면 추가')));
  }
  async function addSheet() {
    const v = await dialog({ title: '도면 추가', fields: [{ key: 'name', label: '도면명', value: '' }, { key: 'disc', label: '공종', type: 'select', options: Object.entries(DISC).map(([k, d]) => [k, `${k} ${d.name}`]), value: sheet().disc }, { key: 'level', label: '층', type: 'select', options: P.levels.map(l => [l.id, l.name]), value: sheet().level }, { key: 'copy', label: '그리드 복사(같은 층 도면에서)', type: 'checkbox', value: true }] });
    if (!v) return; const s2 = { id: uid('s'), name: v.name || `${v.disc}-${P.sheets.length + 101}`, disc: v.disc, level: v.level }; P.sheets.push(s2); P.content[s2.id] = { ents: [], els: [] };
    if (v.copy) { const src = P.sheets.find(x => x.id !== s2.id && x.level === v.level && P.content[x.id]?.ents.some(e => e.t === 'grid')) || P.sheets.find(x => x.id !== s2.id && P.content[x.id]?.ents.some(e => e.t === 'grid')); if (src) P.content[s2.id].ents = deep(P.content[src.id].ents.filter(e => e.t === 'grid')).map(e => ({ ...e, id: uid('g') })); }
    ctx.touch(['meta', s2.id]); switchSheet(s2.id);
  }

  // ---------- 포인터 ----------
  let drag = null; const ptrs = new Map(); let pinch = null; let lpan = null;
  const evPt = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function updateCursor(sx, sy) {
    curRaw = s2w(sx, sy); const sp = computeSnap(curRaw); polarHit = null; cur = applyOrtho(sp);
    if (!cmd) { const id = pickAt(curRaw); if (id !== hover) { hover = id; } }
    dirty = true;
  }
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, evPt(e));
    if (space === 'layout') { const [x, y] = evPt(e); lpan = { x, y, lx: LV.x, ly: LV.y }; return; }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: dist(a, b), m: mid(a, b), V: { ...V } }; drag = null; return; }
    const [x, y] = evPt(e); updateCursor(x, y);
    drag = { btn: e.button, p0s: [x, y], p1s: [x, y], w0: s2w(x, y), moved: false, touch: e.pointerType === 'touch', V0: { ...V }, shift: e.shiftKey };
    if (e.button === 1 || (e.button === 0 && e.altKey)) drag.pan = true;
  });
  cv.addEventListener('pointermove', (e) => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, evPt(e));
    if (space === 'layout') { if (lpan) { const [x, y] = evPt(e); LV.x = lpan.lx + x - lpan.x; LV.y = lpan.ly + y - lpan.y; dirty = true; } return; }
    if (pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()]; const d = dist(a, b), m = mid(a, b);
      V.s = clamp(pinch.V.s * d / pinch.d, 1e-4, 50);
      const wm = [(pinch.m[0] - W / 2) / pinch.V.s + pinch.V.cx, (H / 2 - pinch.m[1]) / pinch.V.s + pinch.V.cy];
      V.cx = wm[0] - (m[0] - W / 2) / V.s; V.cy = wm[1] - (H / 2 - m[1]) / V.s; dirty = true; return;
    }
    const [x, y] = evPt(e);
    if (drag) {
      drag.p1s = [x, y]; if (dist(drag.p0s, drag.p1s) > 6) drag.moved = true;
      const panMode = drag.pan || (drag.touch && !cmd && !opt.box && drag.moved) || (drag.touch && cmd?.selecting === false && false);
      if (panMode && drag.moved) { V.cx = drag.V0.cx - (x - drag.p0s[0]) / V.s; V.cy = drag.V0.cy + (y - drag.p0s[1]) / V.s; dirty = true; return; }
      if (drag.moved && drag.btn === 0 && (!cmd || cmd.selecting) && (!drag.touch || opt.box || cmd?.selecting)) { drag.box = true; }
    }
    updateCursor(x, y);
    if (cmd?.preview) dirty = true;
  });
  const endPtr = (e) => {
    ptrs.delete(e.pointerId);
    if (space === 'layout') { lpan = null; return; }
    if (pinch) { if (ptrs.size < 2) pinch = null; drag = null; return; }
    if (!drag) return; const d = drag; drag = null;
    if (d.pan || (d.touch && !cmd && !opt.box && d.moved)) { dirty = true; return; }
    if (d.box) { selectBox(d.w0, s2w(d.p1s[0], d.p1s[1]), d.shift || !!cmd); dirty = true; return; }
    if (d.btn !== 0) return;
    // 클릭
    if (cmd) { feedPoint(cur); return; }
    // 그립 클릭 → 편집
    const gr = sel.size && sel.size < 60 ? grips().find(q => dist(w2s(q.p), d.p0s) < 9) : null;
    if (gr) { startCmd('GRIP', gr); return; }
    const id = pickAt(curRaw);
    if (id) { if (d.shift) { sel.has(id) ? sel.delete(id) : sel.add(id); } else if (!sel.has(id) || sel.size > 1) { sel.clear(); sel.add(id); } else sel.delete(id); }
    else if (!d.shift) sel.clear();
    selChanged();
  };
  cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', (e) => { ptrs.delete(e.pointerId); drag = null; pinch = null; });
  cv.addEventListener('pointerleave', () => { snap = null; dirty = true; });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); const [x, y] = evPt(e); if (space === 'layout') { const k0 = LV.s; LV.s = clamp(LV.s * Math.pow(1.0015, -e.deltaY), 0.2, 30); LV.x = x - (x - LV.x) * LV.s / k0; LV.y = y - (y - LV.y) * LV.s / k0; dirty = true; return; } const w0 = s2w(x, y); V.s = clamp(V.s * Math.pow(1.0015, -e.deltaY), 1e-4, 50); const w1 = s2w(x, y); V.cx += w0[0] - w1[0]; V.cy += w0[1] - w1[1]; updateCursor(x, y); }, { passive: false });
  cv.addEventListener('dblclick', (e) => { if (e.button === 1) return zoomExt(); if (cmd) return; const id = pickAt(curRaw); const o = C().ents.find(x => x.id === id); if (o) editText(o); });
  cv.addEventListener('contextmenu', (e) => { e.preventDefault(); showCtx(e.clientX, e.clientY); });

  // ---------- 키보드 ----------
  const onKey = (e) => {
    const t = e.target; const inOther = t !== inp && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (inOther || document.querySelector('.modal-bg')) return;
    if (e.key === 'F3') { e.preventDefault(); toggle('osnap'); return; }
    if (e.key === 'F8') { e.preventDefault(); toggle('ortho'); return; }
    if (e.key === 'F7') { e.preventDefault(); toggle('grid'); return; }
    if (e.key === 'F12') { e.preventDefault(); toggle('dyn'); P.view.dyn = opt.dyn; ctx.touch('meta'); return; }
    if (e.key === 'F10') { e.preventDefault(); toggle('polar'); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); cancel(true); doUndo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); startCmd('SELALL'); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && t !== inp) { e.preventDefault(); copyClip(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && t !== inp) { e.preventDefault(); startCmd('PASTECLIP'); return; }
    if (acBox.style.display !== 'none' && t === inp && (e.key === 'Tab' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); acMove(e.key); return; }
    if (e.key === 'Escape') { e.preventDefault(); if (cmd) cancel(); else { sel.clear(); selChanged(); } inp.value = ''; return; }
    if (e.key === 'Delete' && t !== inp) { if (sel.size) startCmd('ERASE'); return; }
    if (e.key === 'Enter' || (e.key === ' ' && !inp.value.startsWith('?') && !(cmd?.name === 'TEXT' && inp.value))) { e.preventDefault(); const pick = acPick(); acHide(); submit(pick || inp.value); return; }
    if (t !== inp && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { inp.focus(); }
  };
  window.addEventListener('keydown', onKey);

  // ---------- 시작 ----------
  buildToolbar(); renderSide(); renderPB(); resize();
  const hi = S.hi;
  requestAnimationFrame(() => {
    resize();
    if (hi?.sheet && P.sheets.some(s => s.id === hi.sheet)) { sid = hi.sheet; }
    else if (hi?.level) { const s = P.sheets.find(x => x.level === hi.level && P.content[x.id]?.els.some(e => hi.ids?.includes(e.id))); if (s) sid = s.id; }
    if (hi?.ids?.length) { const o = P.sheets.find(x => x.id !== sid && P.content[x.id]?.els.some(e => hi.ids.includes(e.id)) || x.id !== sid && P.content[x.id]?.ents.some(e => hi.ids.includes(e.id))); if (o) under = o.id; }
    buildToolbar(); renderSide();
    if (hi?.pts?.length) { const b = bboxOf(hi.pts); zoomTo({ x0: b.x0 - 3000, y0: b.y0 - 3000, x1: b.x1 + 3000, y1: b.y1 + 3000 }, 0.05); if (hi.label) log('강조: ' + hi.label, '#ff7777'); }
    else zoomExt();
    render();
  });
  log('빌더 CAD 준비 완료. 명령을 입력하거나 위 도구를 누르세요. (예: L → 0,0 → @6000,0)');
  // 강조 해제 타이머
  const hiTimer = setTimeout(() => { if (S.hi === hi) { S.hi = null; dirty = true; } }, 20000);

  return {
    unmount() { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('keydown', onKey); clearTimeout(hiTimer); S.sheet = sid; },
  };
}
