import type {
  AxisPoint,
  Entry,
  Floor,
  ParsedBlock,
  ParsedTask,
  WorkforceRecord,
  ZoneRect,
} from "./types";

/* ---------------- Palette & work-type colors ---------------- */
const PALETTE = [
  "#f2b33d", "#9fe04a", "#4f8bff", "#a566f5", "#26d6e6", "#f2453d",
  "#E4572E", "#17BEBB", "#2E86AB", "#A23B72", "#6A994E", "#BC4B51",
  "#4059AD", "#F2A93B", "#7A6F9B", "#3F7D7A", "#D1495B", "#00798C",
  "#6F2DBD", "#2A9D8F",
];
const workTypeColorMap: Record<string, string> = {};

export function stripCompanyForLabel(workType: string): string {
  return String(workType).replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+/g, " ").trim();
}
export function shortWorkTypeLabel(workType: string): string {
  return stripCompanyForLabel(workType).replace(/\s*공사$/, "").trim();
}
function colorKeyForWorkType(wt: string): string {
  return stripCompanyForLabel(wt).replace(/\s+/g, "").replace(/공사$/, "") || String(wt);
}
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return "#" + toHex(r) + toHex(g) + toHex(b);
}
export function colorForWorkType(wt: string): string {
  const key = colorKeyForWorkType(wt);
  if (!workTypeColorMap[key]) {
    const idx = Object.keys(workTypeColorMap).length;
    workTypeColorMap[key] = idx < PALETTE.length ? PALETTE[idx] : hslToHex((idx * 137.508) % 360, 58, 48);
  }
  return workTypeColorMap[key];
}
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ---------------- Date helpers ---------------- */
export function pad(n: number): string {
  return n < 10 ? "0" + n : "" + n;
}
export function fmtDate(d: Date): string {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
export function parseDate(s: string): Date {
  return new Date(s + "T00:00:00");
}
export function addDays(s: string, delta: number): string {
  const d = parseDate(s);
  d.setDate(d.getDate() + delta);
  return fmtDate(d);
}
export function uid(): string {
  return "id" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/* ---------------- Entry helpers ---------------- */
export function isCoordinateEntry(e: Entry): boolean {
  return e.sourceType !== "manual" && e.x1 != null;
}
export function isManualEntry(e: Entry): boolean {
  return !isCoordinateEntry(e);
}
export function equipmentCountOf(w: WorkforceRecord): number {
  return Number.isFinite(w.equipmentCount) ? w.equipmentCount : (w.equipment || []).length;
}
export function entryCompareKey(e: Entry): string {
  if (e.sourceType === "manual" || (e.x1 == null && e.y1 == null)) {
    return ["manual", e.workType || "", e.roomName || "", e.desc || ""].join("|");
  }
  return ["coord", e.x1, e.x2, e.y1, e.y2, e.workType || "", e.roomName || ""].join("|");
}
function axisRangeText(axis: string, a: string, b: string): string {
  return String(a) === String(b) ? `${axis}${a}` : `${axis}${a}~${axis}${b}`;
}
export function entryLocationText(e: Entry): string {
  if (e.x1 != null && e.x2 != null && e.y1 != null && e.y2 != null) {
    return `${axisRangeText("X", e.x1, e.x2)}, ${axisRangeText("Y", e.y1, e.y2)}`;
  }
  return e.manualRect ? "수동 지정 영역" : "좌표 없음";
}

export function floorNumberFromFloor(floor: Floor | undefined | null): number | null {
  if (!floor) return null;
  const m = String(floor.name || "").match(/([1-9]\d*)\s*층/);
  return m ? parseInt(m[1], 10) : null;
}
export function detectFloorNumber(text: string): number | null {
  const s = String(text || "");
  let m = s.match(/(?:^|[^0-9])([1-9]\d*)\s*[Ff](?=$|[^A-Za-z0-9])/);
  if (m) return parseInt(m[1], 10);
  m = s.match(/(?:지상\s*)?([1-9]\d*)\s*층/);
  return m ? parseInt(m[1], 10) : null;
}
export function findFloorByNumber(floors: Floor[], num: number | null): Floor | null {
  const n = Number(num);
  if (!Number.isFinite(n)) return null;
  return floors.find((f) => floorNumberFromFloor(f) === n) || null;
}
export function effectiveEntryFloorId(floors: Floor[], e: Entry): string {
  const explicitFloor = e.explicitFloor || detectFloorNumber(`${e.roomName || ""} ${e.desc || ""}`);
  const matched = explicitFloor ? findFloorByNumber(floors, explicitFloor) : null;
  return matched ? matched.id : e.floorId;
}
export function entriesFor(
  entries: Entry[],
  floors: Floor[],
  date: string,
  floorId: string | null = null
): Entry[] {
  return entries.filter((e) => e.date === date && (floorId == null || effectiveEntryFloorId(floors, e) === floorId));
}
export function workforceFor(workforce: WorkforceRecord[], date: string): WorkforceRecord[] {
  return workforce.filter((w) => w.date === date);
}

/* ---------------- Axis / zone resolution ---------------- */
export function resolveAxis(floor: Floor, axis: "X" | "Y", rawLabel: string): AxisPoint | null {
  const cal = floor.calibration[axis];
  const label = String(rawLabel).trim().replace(/^[XxYy]/, "");
  if (cal[label]) return cal[label];
  const num = parseFloat(label);
  if (!isNaN(num)) {
    const pts = Object.entries(cal)
      .map(([k, v]) => ({ num: parseFloat(k), v }))
      .filter((p) => !isNaN(p.num));
    if (pts.length >= 2) {
      pts.sort((a, b) => a.num - b.num);
      let lower: { num: number; v: AxisPoint } | null = null;
      let upper: { num: number; v: AxisPoint } | null = null;
      for (const p of pts) {
        if (p.num <= num) lower = p;
        if (p.num >= num && !upper) upper = p;
      }
      if (lower && upper && lower.num !== upper.num) {
        const t = (num - lower.num) / (upper.num - lower.num);
        return { px: lower.v.px + t * (upper.v.px - lower.v.px), py: lower.v.py + t * (upper.v.py - lower.v.py) };
      } else if (lower) return lower.v;
      else if (upper) return upper.v;
    }
  }
  return null;
}
export function resolveZoneRect(floor: Floor, x1: string, x2: string, y1: string, y2: string): ZoneRect | null {
  const ax1 = resolveAxis(floor, "X", x1);
  const ax2 = resolveAxis(floor, "X", x2);
  const ay1 = resolveAxis(floor, "Y", y1);
  const ay2 = resolveAxis(floor, "Y", y2);
  if (!ax1 || !ax2 || !ay1 || !ay2) return null;
  return {
    x0: Math.min(ax1.px, ax2.px), x1: Math.max(ax1.px, ax2.px),
    y0: Math.min(ay1.py, ay2.py), y1: Math.max(ay1.py, ay2.py),
  };
}
export function averageAxisSpacing(floor: Floor, axis: "X" | "Y"): number {
  const vals = Object.values(floor.calibration[axis] || {})
    .map((p) => (axis === "X" ? p.px : p.py))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (vals.length < 2) return 80;
  const gaps: number[] = [];
  for (let i = 1; i < vals.length; i++) if (vals[i] - vals[i - 1] > 1) gaps.push(vals[i] - vals[i - 1]);
  return gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 80;
}
export function expandSingleAxisRect(floor: Floor, rect: ZoneRect): ZoneRect {
  const out = { ...rect };
  const xThin = Math.abs(out.x1 - out.x0) < 1;
  const yThin = Math.abs(out.y1 - out.y0) < 1;
  if (xThin) {
    const half = Math.max(7, Math.min(12, averageAxisSpacing(floor, "X") * 0.08));
    out.x0 -= half; out.x1 += half;
  }
  if (yThin) {
    const half = Math.max(7, Math.min(12, averageAxisSpacing(floor, "Y") * 0.08));
    out.y0 -= half; out.y1 += half;
  }
  return out;
}
export function getEntryRect(floor: Floor, e: Entry): ZoneRect | null {
  if (e.manualRect) {
    return {
      x0: Math.min(e.manualRect.x0, e.manualRect.x1), x1: Math.max(e.manualRect.x0, e.manualRect.x1),
      y0: Math.min(e.manualRect.y0, e.manualRect.y1), y1: Math.max(e.manualRect.y0, e.manualRect.y1),
    };
  }
  if (e.x1 != null && e.x2 != null && e.y1 != null && e.y2 != null) {
    const rect = resolveZoneRect(floor, e.x1, e.x2, e.y1, e.y2);
    return rect ? expandSingleAxisRect(floor, rect) : null;
  }
  return null;
}

/* ---------------- Parsing engine ----------------
   입력 규칙 (원본 reference-original-functional-app.html 그대로 이식):
   - 총원/인원/장비/작업내용 앞 '-'는 선택사항
   - 공종 제목 뒤 "138명 ..."도 인원으로 인식
   - 좌표 범위는 ~ 또는 - 모두 지원
   - 작업 문장 안 1F/2F/3F 또는 1층/2층/3층 표기는 해당 층 도면으로 자동 배정
*/
export function normalizeLine(s: string): string {
  return s
    .replace(/ /g, " ").replace(/：/g, ":").replace(/，/g, ",")
    .replace(/～/g, "~").replace(/∼/g, "~").replace(/~+/g, "~")
    .replace(/[－–—−]/g, "-")
    .replace(/[（［【]/g, "(").replace(/[）］】]/g, ")");
}

const RE_BLOCK_HEADER = /^(\d+)\.\s*(.+)$/;
const RE_HEADCOUNT = /^-?\s*(?:총\s*원|인\s*원)\s*:?\s*(.+)$/;
const RE_BARE_HEADCOUNT = /^-?\s*(\d+)\s*명\s*(?:[_:]\s*)?(.*)$/;
const RE_EQUIPMENT = /^-?\s*장\s*비\s*:?\s*(.+)$/;
const RE_ZONES_HEADER = /^-?\s*작업\s*내용\s*:?\s*(.*)$/;
const RE_MISC_META = /^-?\s*(특이사항|안전사항|주의사항|전달사항|협의사항|공지|비고|이슈|기타현황|현황)\s*:\s*(.+)$/i;
const RE_TOTAL_OUTPUT = /^(?:▣\s*)?총\s*(?:출력\s*)?인원\s*:?\s*(\d+)\s*명/i;
const RE_REPORT_PERSON = /^(?:▣\s*)?([^:]+?)\s*:?\s*(?:총\s*)?(\d+)\s*명\s*$/i;
const RE_REPORT_PERSON_DETAIL = /^-?\s*([^:]+?)\s*:\s*(\d+)\s*명\s*$/;
const RE_EQUIPMENT_ITEM = /^-?\s*([^:]+?)\s*:\s*(\d+)\s*대\s*$/;

function cleanReportLabel(raw: string): string {
  return String(raw || "").replace(/\s+/g, " ").trim();
}
function createParsedBlock(label: string): ParsedBlock {
  return {
    label: cleanReportLabel(label), headcount: null, headcountDetail: null,
    equipment: [], equipmentCount: 0, equipmentDetail: null,
    mode: null, tasks: [], miscLines: [], _personParts: [], _personTop: [],
  };
}
function reportInfoFromBoundary(line: string): { kind: "main" | "report"; label: string | null } | null {
  const s = String(line || "").replace(/[[\]]/g, " ").replace(/\s+/g, " ").trim();
  if (!/고창\s*CDC/i.test(s) || !/착수보고/.test(s)) return null;
  let title = s.replace(/.*?고창\s*CDC\s*/i, "").replace(/착수보고.*$/, "").trim();
  title = title.replace(/현장\s*작업/g, "").replace(/작업/g, "").trim();
  if (!title) return { kind: "main", label: null };
  if (!/(?:공사|설비|시스템)$/.test(title)) title += "공사";
  return { kind: "report", label: cleanReportLabel(title) };
}
function isHardSeparator(line: string): boolean {
  return /^-{3,}$/.test(String(line || "").trim());
}
function isIgnorableStatusLine(line: string): boolean {
  const s = String(line || "").trim();
  const plain = s.replace(/^(?:[■▣▷*•◦▪‧ㆍ-]+|[oO](?=\s))\s*/, "").trim();
  if (!plain) return true;
  if (/^(?:일\s*시|날\s*씨|날씨|강우량)\s*[:：]/i.test(plain)) return true;
  if (/^26년\s*\d{1,2}월\s*\d{1,2}일/.test(plain)) return true;
  if (/^(?:공정율|공정률)\s*[:：]/.test(plain)) return true;
  if (/(?:진척|진척률)/.test(plain) && /(?:%|\d+\s*\/\s*\d+)/.test(plain)) return true;
  if (/\(\s*[\d,]+\s*\/\s*[\d,]+[^)]*%[^)]*\)/.test(plain)) return true;
  if (/^계\s*\([^)]*%/.test(plain)) return true;
  if (/^(?:특이사항|안전사항|주의사항|전달사항|협의사항|공지|비고|이슈|기타현황|현황)(?:\s*:|\s|$)/.test(plain)) return true;
  if (/^없음$/.test(plain)) return true;
  return false;
}
function appendReportPerson(block: ParsedBlock | null, label: string, count: string, opts: { topLevel?: boolean } = {}) {
  if (!block) return;
  const { topLevel = false } = opts;
  const name = cleanReportLabel(label);
  const n = parseInt(count, 10) || 0;
  if (!name || /^(?:총\s*(?:출력\s*)?인원|장비|강우량|휴\s*무)$/i.test(name)) return;
  const text = `${name} ${n}명`;
  if (!block._personParts.includes(text)) block._personParts.push(text);
  if (topLevel && !block._personTop.some((x) => x.name === name)) block._personTop.push({ name, count: n });
  if (block.headcount != null && block._personParts.length) {
    block.headcountDetail = block._personParts.join(", ");
  }
}
function finalizeReportHeadcount(block: ParsedBlock | null) {
  if (!block || block.headcount != null) return;
  if (block._personTop.length) {
    block.headcount = block._personTop.reduce((sum, x) => sum + (x.count || 0), 0);
    block.headcountDetail = block._personParts.length ? block._personParts.join(", ") : null;
  }
}
function isReportTaskSubheading(line: string): boolean {
  const s = cleanReportLabel(line).replace(/^[-■▣▷]\s*/, "");
  if (!s || s.length > 28 || /[:()]/.test(s) || hasCoordinateGroup(s) || looksLikeWorkDescription(s)) return false;
  return /(?:공사|기계|전기|통신|자동화|제어|설비|배관|덕트|소방|건축|토목|철골|방수|PC)$/i.test(s);
}
function appendEquipmentItem(block: ParsedBlock | null, name: string, count: string) {
  if (!block) return;
  const n = parseInt(count, 10) || 0;
  if (n <= 0) return;
  const item = `${cleanReportLabel(name)}-${n}대`;
  block.equipment.push(item);
  block.equipmentCount = (block.equipmentCount || 0) + n;
  block.equipmentDetail = block.equipment.join(", ");
}
function applyHeadcountValue(block: ParsedBlock, value: string) {
  const val = String(value || "").trim();
  const m = val.match(/^(\d+)\s*명\s*(?:[_:]\s*)?(.*)$/);
  if (m) {
    block.headcount = parseInt(m[1], 10);
    block.headcountDetail = (m[2] || "").trim() || null;
  } else {
    block.headcount = null;
    block.headcountDetail = val || null;
  }
}
function isNoEquipmentValue(value: string): boolean {
  const compact = String(value || "").trim().replace(/\s+/g, "").toLowerCase();
  return /^(?:무|없음|없슴|해당없음|미사용|없다|0|0대|none|n\/a|na|-)$/.test(compact);
}
function applyEquipmentValue(block: ParsedBlock, value: string) {
  const val = String(value || "").trim();
  if (isNoEquipmentValue(val)) {
    block.equipment = [];
    block.equipmentCount = 0;
    block.equipmentDetail = val || "무";
    return;
  }
  const countMatch = val.match(/^(\d+)\s*대\s*(.*)$/i);
  if (countMatch) {
    block.equipmentCount = parseInt(countMatch[1], 10);
    let detail = countMatch[2].trim();
    if (detail.startsWith("(") && detail.endsWith(")")) detail = detail.slice(1, -1).trim();
    block.equipmentDetail = detail || null;
    block.equipment = detail ? detail.split(",").map((s) => s.trim()).filter(Boolean) : [];
    return;
  }
  const items = val.split(",").map((s) => s.trim()).filter(Boolean).filter((x) => !isNoEquipmentValue(x));
  let explicitCount = 0, hasExplicitCount = false;
  items.forEach((item) => {
    const matches = [...item.matchAll(/(\d+)\s*대/g)];
    if (matches.length) {
      hasExplicitCount = true;
      explicitCount += matches.reduce((sum, m) => sum + (parseInt(m[1], 10) || 0), 0);
    }
  });
  block.equipment = items;
  block.equipmentCount = hasExplicitCount ? explicitCount : items.length;
  block.equipmentDetail = val || null;
}
function extractInlineHeadcount(titleText: string): { title: string; headcountValue: string | null } {
  const m = String(titleText || "").match(/^(.*?)(\d+)\s*명\s*(?:[_:]\s*)?(.*)$/);
  if (!m || !m[1].trim()) return { title: String(titleText || "").trim(), headcountValue: null };
  return {
    title: m[1].trim().replace(/[_:-]+$/, "").trim(),
    headcountValue: `${m[2]}명${m[3] ? "_" + m[3].trim() : ""}`,
  };
}
function resolveTaskFloorId(floors: Floor[], task: ParsedTask, fallbackFloorId: string): string {
  const hint = task.floorHint || detectFloorNumber(`${task.roomName || ""} ${task.desc || ""}`);
  const matched = hint ? findFloorByNumber(floors, hint) : null;
  return matched ? matched.id : fallbackFloorId;
}

function parseCoordinateBody(coordText: string): { x1: string; x2: string; y1: string; y2: string } | null {
  const clean = normalizeLine(String(coordText || "")).trim();
  const compact = clean.match(
    /^\s*[Xx]\s*([A-Za-z0-9.]+)\s*-\s*[Yy]\s*([A-Za-z0-9.]+)\s*(?:~|-)\s*(?:[Yy]\s*)?([A-Za-z0-9.]+)\s*(?:열|축)?\s*$/
  );
  if (compact) {
    return { x1: compact[1], x2: compact[1], y1: compact[2], y2: compact[3] };
  }
  const parts = clean.split(/[,/]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  const out: { x1?: string; x2?: string; y1?: string; y2?: string } = {};
  for (const part of parts) {
    const m = part.match(
      /^([XxYy])\s*([A-Za-z0-9.]+)\s*(?:열|축)?(?:\s*(?:~|-)\s*(?:[XxYy]\s*)?([A-Za-z0-9.]+)\s*(?:열|축)?)?$/
    );
    if (!m) return null;
    const axis = m[1].toUpperCase();
    const a = m[2], b = m[3] || m[2];
    if (axis === "X") { out.x1 = a; out.x2 = b; } else { out.y1 = a; out.y2 = b; }
  }
  return out.x1 != null && out.y1 != null ? { x1: out.x1, x2: out.x2!, y1: out.y1, y2: out.y2! } : null;
}
function hasCoordinateGroup(text: string): boolean {
  const re = /\(([^()]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text || "")))) {
    if (parseCoordinateBody(m[1])) return true;
  }
  return false;
}
function findCoordinateGroup(text: string): { start: number; end: number; raw: string; coord: { x1: string; x2: string; y1: string; y2: string } } | null {
  const re = /\(([^()]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text || "")))) {
    const coord = parseCoordinateBody(m[1]);
    if (coord) return { start: m.index, end: re.lastIndex, raw: m[1], coord };
  }
  return null;
}
function splitTaskLine(line: string): string[] {
  const text = line.replace(/^-\s*/, "").trim();
  if (!text) return [];
  const pieces: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      const piece = text.slice(start, i).trim();
      const rest = text.slice(i + 1).trim();
      const explicitNext = /^-\s*\S+/.test(rest);
      const coordinateNext =
        hasCoordinateGroup(piece) && hasCoordinateGroup(rest) &&
        /^(?:-\s*)?(?:[^,()]*)\([^()]*[XxYy][^()]*\)/.test(rest);
      if (explicitNext || coordinateNext) {
        if (piece) pieces.push(piece);
        start = i + 1;
      }
    }
  }
  const last = text.slice(start).trim().replace(/^-\s*/, "");
  if (last) pieces.push(last);
  return pieces;
}
function stripLeadingFloorMarker(text: string): string {
  return String(text || "").trim()
    .replace(/^(?:지상\s*)?[1-9]\d*\s*[Ff](?:\s+|(?=[가-힣]))/, "")
    .replace(/^(?:지상\s*)?[1-9]\d*\s*층\s*/, "")
    .trim();
}
function normalizeCoordinateDescription(desc: string): string {
  const parts = String(desc || "").split(",").map((s) => stripLeadingFloorMarker(s)).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return parts[0] || "";
  return parts.join(" 및 ");
}
function looksLikeWorkDescription(text: string): boolean {
  return /(작업|설치|시공|배근|타설|해체|정리|조립|타공|견출|배관|먹매김|레벨|보강|반입|양중|검측|청소|마감|철근|거푸집|폼|비계|슬라브|수평재)/.test(String(text || ""));
}
function parseTaskUnit(line: string): ParsedTask | null {
  const body = line.replace(/^-\s*/, "").trim();
  if (!body) return null;
  const floorHint = detectFloorNumber(body);
  const group = findCoordinateGroup(body);
  if (group) {
    const before = body.slice(0, group.start).trim().replace(/[,;:-]+$/, "").trim();
    const after = body.slice(group.end).trim().replace(/^[,;:]\s*/, "").trim();
    let roomName = before || "";
    let desc = after;
    if (before && !after && looksLikeWorkDescription(before)) {
      roomName = "";
      desc = before;
    }
    desc = normalizeCoordinateDescription(desc);
    return { roomName, desc, sourceType: "coord", floorHint, ...group.coord };
  }
  const withParen = body.match(/^(.+?)\s*\(([^()]*)\)\s*(.*)$/);
  if (withParen) {
    const roomName = withParen[1].trim() || "기타작업";
    const desc = withParen[3].trim();
    if (!desc) return { roomName: "기타작업", desc: body, sourceType: "manual", floorHint };
    return { roomName, desc, sourceType: "manual", floorHint };
  }
  const colon = body.match(/^(.+?)\s*:\s*(.+)$/);
  if (colon) {
    return { roomName: colon[1].trim(), desc: colon[2].trim(), sourceType: "manual", floorHint };
  }
  return { roomName: "기타작업", desc: body, sourceType: "manual", floorHint };
}
function parseTaskLine(line: string): ParsedTask[] {
  const parsed = splitTaskLine(line).map(parseTaskUnit).filter((t): t is ParsedTask => !!t);
  if (parsed.length < 2) return parsed;
  const last = parsed[parsed.length - 1];
  if (last.sourceType === "coord" && last.desc) {
    for (let i = parsed.length - 2; i >= 0; i--) {
      const task = parsed[i];
      if (task.sourceType !== "coord" || task.desc) break;
      task.desc = last.desc;
      if (!task.floorHint && last.floorHint) task.floorHint = last.floorHint;
    }
  }
  return parsed;
}

export function parseBlockInput(text: string): { blocks: ParsedBlock[]; errors: string[] } {
  // 보고서를 복사-붙여넣기 하면 "▣ 관리자 : 3명 ▣ 총 출력인원 : 8명"처럼 여러 ▣ 항목이
  // 한 줄로 뭉쳐지는 경우가 많다. 각 ▣ 항목을 별도 줄로 다시 분리해 아래 필드 인식이
  // 항목 단위로 정확히 동작하게 한다.
  const lines = text.split("\n").flatMap((raw) => {
    const segments = raw.split("▣");
    if (segments.length <= 1) return [raw];
    return segments.map((seg, i) => (i === 0 ? seg : "▣" + seg)).filter((seg) => seg.trim() !== "");
  });
  const blocks: ParsedBlock[] = [];
  const errors: string[] = [];
  let current: ParsedBlock | null = null;
  let reportBlock: ParsedBlock | null = null;
  let reportPersonMode = false;

  function pushBlock(label: string): ParsedBlock {
    const b = createParsedBlock(label);
    blocks.push(b);
    return b;
  }

  lines.forEach((raw) => {
    const line = normalizeLine(raw.trim());
    if (!line) return;

    const boundary = reportInfoFromBoundary(line);
    if (boundary) {
      if (reportBlock) finalizeReportHeadcount(reportBlock);
      current = null;
      reportBlock = null;
      reportPersonMode = false;
      if (boundary.kind === "report" && boundary.label) {
        reportBlock = pushBlock(boundary.label);
        current = reportBlock;
      }
      return;
    }
    if (isHardSeparator(line)) {
      if (reportBlock) finalizeReportHeadcount(reportBlock);
      current = null;
      reportBlock = null;
      reportPersonMode = false;
      return;
    }

    // "-" 외에 "*", "•", "o" 같은 다른 글머리표로 붙여넣는 경우도 흔해서
    // 총원/장비/작업내용 등 필드 인식이 실패하지 않도록 함께 걷어낸다.
    const fieldLine = line.replace(/^(?:[■▣▷*•◦▪‧ㆍ]+|[oO](?=\s))\s*/, "").trim();

    if (/^금일\s*인원\s*,?\s*장비\s*총현황/.test(fieldLine)) {
      current = null;
      reportPersonMode = false;
      return;
    }

    const headerMatch = line.match(RE_BLOCK_HEADER);
    if (headerMatch) {
      if (reportBlock) finalizeReportHeadcount(reportBlock);
      reportBlock = null;
      reportPersonMode = false;
      const inline = extractInlineHeadcount(headerMatch[2].trim());
      const titleText = inline.title.replace(/\s*:\s*관리자\s*:??\s*$/, "").trim();
      const nameMatch = titleText.match(/^(.+?)\((.+?)\)\s*$/);
      const workTypeRaw = nameMatch ? nameMatch[1].trim() : titleText;
      const company = nameMatch ? nameMatch[2].trim() : null;
      const label = company ? `${workTypeRaw}(${company})` : workTypeRaw;
      current = pushBlock(label);
      if (inline.headcountValue) applyHeadcountValue(current, inline.headcountValue);
      return;
    }

    if (reportBlock && isReportTaskSubheading(fieldLine)) {
      current = pushBlock(fieldLine);
      current.mode = "tasks";
      reportPersonMode = false;
      return;
    }

    const totalOutput = fieldLine.match(RE_TOTAL_OUTPUT);
    if (totalOutput && reportBlock) {
      reportBlock.headcount = parseInt(totalOutput[1], 10) || 0;
      reportBlock.headcountDetail = reportBlock._personParts.length ? reportBlock._personParts.join(", ") : null;
      reportPersonMode = false;
      current = reportBlock;
      current.mode = null;
      return;
    }

    const reportPerson = fieldLine.match(RE_REPORT_PERSON);
    if (reportPerson && reportBlock && !RE_HEADCOUNT.test(fieldLine) && !/^-\s*/.test(line)) {
      appendReportPerson(reportBlock, reportPerson[1], reportPerson[2], { topLevel: true });
      reportPersonMode = true;
      current = reportBlock;
      return;
    }
    if (reportPersonMode && reportBlock) {
      const detail = fieldLine.match(RE_REPORT_PERSON_DETAIL);
      if (detail) {
        appendReportPerson(reportBlock, detail[1], detail[2], { topLevel: false });
        return;
      }
    }

    const zonesMatch = fieldLine.match(RE_ZONES_HEADER);
    if (zonesMatch) {
      if (reportBlock) current = reportBlock;
      if (!current) return;
      current.mode = "tasks";
      reportPersonMode = false;
      const inlineTasks = zonesMatch[1].trim();
      if (inlineTasks && !isIgnorableStatusLine(inlineTasks)) {
        parseTaskLine(inlineTasks).forEach((task) => current!.tasks.push(task));
      }
      return;
    }

    if (/^장비\s*사용\s*현황/.test(fieldLine)) {
      if (reportBlock) {
        current = reportBlock;
        current.mode = "equipment-list";
        current.equipment = [];
        current.equipmentCount = 0;
        current.equipmentDetail = null;
      }
      reportPersonMode = false;
      return;
    }
    if (current && current.mode === "equipment-list") {
      const item = fieldLine.match(RE_EQUIPMENT_ITEM);
      if (item) {
        appendEquipmentItem(current, item[1], item[2]);
        return;
      }
    }

    if (isIgnorableStatusLine(line) || isIgnorableStatusLine(fieldLine)) {
      if (/특이사항/.test(fieldLine) && current) current.mode = "ignore";
      return;
    }
    if (current && current.mode === "ignore") return;

    if (!current) return;

    const hcMatch = fieldLine.match(RE_HEADCOUNT);
    if (hcMatch) {
      applyHeadcountValue(current, hcMatch[1]);
      current.mode = null;
      return;
    }

    if (current.mode !== "tasks") {
      const bareHc = fieldLine.match(RE_BARE_HEADCOUNT);
      if (bareHc) {
        applyHeadcountValue(current, `${bareHc[1]}명${bareHc[2] ? "_" + bareHc[2] : ""}`);
        current.mode = null;
        return;
      }
    }

    const eqMatch = fieldLine.match(RE_EQUIPMENT);
    if (eqMatch) {
      applyEquipmentValue(current, eqMatch[1]);
      current.mode = null;
      return;
    }

    if (fieldLine.match(RE_MISC_META)) return;

    if (current.mode === "tasks") {
      const tasks = parseTaskLine(fieldLine);
      if (tasks.length) {
        tasks.forEach((task) => current!.tasks.push(task));
        return;
      }
    }
  });

  if (reportBlock) finalizeReportHeadcount(reportBlock);
  blocks.forEach((b) => {
    // @ts-expect-error internal parser scratch fields are dropped before returning to callers
    delete b._personParts;
    // @ts-expect-error internal parser scratch fields are dropped before returning to callers
    delete b._personTop;
  });
  return { blocks, errors };
}

export { resolveTaskFloorId };

/* ---------------- Overview detail (per-stat drill-down) ---------------- */
export interface OverviewDetailItem {
  main: string;
  sub: string;
}
export interface OverviewDetailData {
  title: string;
  context: string;
  items: OverviewDetailItem[];
}

export function overviewDetailData(
  key: string,
  ctx: { entries: Entry[]; floors: Floor[]; workforce: WorkforceRecord[]; selectedDate: string; currentFloor: Floor }
): OverviewDetailData {
  const { entries, floors, workforce, selectedDate, currentFloor } = ctx;
  const dayEntries = entriesFor(entries, floors, selectedDate);
  const floorEntries = entriesFor(entries, floors, selectedDate, currentFloor.id);
  const wf = workforceFor(workforce, selectedDate);
  const coord = floorEntries.filter(isCoordinateEntry);
  const other = floorEntries.filter(isManualEntry);
  const unassigned = other.filter((e) => !e.manualRect);
  const context = `${selectedDate} · ${currentFloor.name}`;

  if (key === "workTypes") {
    const names = [...new Set([...dayEntries.map((e) => e.workType), ...wf.map((w) => w.workType)].filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "ko")
    );
    return {
      title: "투입 공종 상세",
      context: `${selectedDate} · 전체 층`,
      items: names.map((name) => {
        const w = wf.find((x) => x.workType === name);
        const tasks = dayEntries.filter((e) => e.workType === name).length;
        return { main: stripCompanyForLabel(name), sub: `인원 ${w?.headcount || 0}명 · 장비 ${w ? equipmentCountOf(w) : 0}대 · 작업 ${tasks}건` };
      }),
    };
  }
  if (key === "headcount") {
    return {
      title: "총 인원 상세",
      context: `${selectedDate} · 전체 공종`,
      items: wf.map((w) => ({ main: `${stripCompanyForLabel(w.workType)} · ${w.headcount || 0}명`, sub: w.headcountDetail || "세부 인원 입력 없음" })),
    };
  }
  if (key === "equipment") {
    const rows = wf.filter((w) => equipmentCountOf(w) > 0 || w.equipmentDetail);
    return {
      title: "장비 상세",
      context: `${selectedDate} · 전체 공종`,
      items: rows.map((w) => ({
        main: `${stripCompanyForLabel(w.workType)} · ${equipmentCountOf(w)}대`,
        sub: w.equipmentDetail || (w.equipment || []).join(", ") || "사용 장비 없음",
      })),
    };
  }
  if (key === "coord") {
    return {
      title: "좌표 작업 상세",
      context,
      items: coord.map((e) => ({ main: `${stripCompanyForLabel(e.workType)} · ${entryLocationText(e)}`, sub: [e.roomName, e.desc].filter(Boolean).join(" · ") })),
    };
  }
  if (key === "other") {
    return {
      title: "기타 작업 상세",
      context,
      items: other.map((e) => ({
        main: stripCompanyForLabel(e.workType),
        sub: [e.roomName, e.desc].filter(Boolean).join(" · ") + (e.manualRect ? " · 도면 지정됨" : ""),
      })),
    };
  }
  if (key === "unassigned") {
    return {
      title: "영역 미지정 작업",
      context,
      items: unassigned.map((e) => ({ main: stripCompanyForLabel(e.workType), sub: [e.roomName, e.desc].filter(Boolean).join(" · ") })),
    };
  }
  return { title: "상세 현황", context, items: [] };
}
