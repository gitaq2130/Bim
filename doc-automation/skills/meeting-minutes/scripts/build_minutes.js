#!/usr/bin/env node
/*
 * 회의록 DOCX 생성기 (업종 무관)
 *
 * Usage: node build_minutes.js <data.json> [output.docx] [--profile <profile.json>]
 *
 * 회의 주체 이름과 강조 규칙은 프로파일에서 읽는다. 건설(발주처–PM단),
 * 정비사업조합 총회, 입주자대표회의, 산업안전보건위원회가 같은 코드로 처리된다.
 *
 * data.json:
 * {
 *   "title": "총 회 의 사 록",            // 선택. 미지정 시 프로파일의 docTitle
 *   "quorum": {                          // 선택. 프로파일이 quorum.enabled 일 때만 출력
 *     "총 조합원 수": 486,
 *     "출석(서면 포함)": 351,
 *     "직접 출석": 62
 *   },
 *   "items": [
 *     {
 *       "title": "안건명",
 *       "core":  "핵심 내용 (2줄 내외)",
 *       "conclusions": [ { "who": "조합", "text": "..." } ],
 *       "resolution": { "찬성": 312, "반대": 24, "기권": 8, "결과": "가결" }   // 선택
 *     }
 *   ]
 * }
 *
 * 의존성: npm install docx
 */
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType, AlignmentType, VerticalAlign,
} = require("docx");
const fs = require("fs");
const path = require("path");

/* ---------------- 인자 ---------------- */
const argv = process.argv.slice(2);
const positional = [];
let profilePath = null;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--profile") { profilePath = argv[i + 1]; i += 1; }
  else positional.push(argv[i]);
}

const dataPath = positional[0] || "data.json";
const outPath = positional[1] || "회의록.docx";

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));

const DEFAULT_PROFILE = {
  docTitle: "회 의 록",
  roles: { emphasis: null, colors: { emphasis: "C00000", other: "1F4E79" } },
  quorum: { enabled: false },
  resolution: { enabled: false },
};

function loadProfile() {
  const p = profilePath || data.profile;
  if (!p) return DEFAULT_PROFILE;
  const resolved = path.isAbsolute(p)
    ? p
    : [path.resolve(p), path.resolve(__dirname, "..", "profiles", p)].find(fs.existsSync);
  if (!resolved) throw new Error(`프로파일을 찾을 수 없습니다: ${p}`);
  const loaded = JSON.parse(fs.readFileSync(resolved, "utf8"));
  return {
    ...DEFAULT_PROFILE,
    ...loaded,
    roles: { ...DEFAULT_PROFILE.roles, ...(loaded.roles || {}),
             colors: { ...DEFAULT_PROFILE.roles.colors, ...((loaded.roles || {}).colors || {}) } },
    quorum: { ...DEFAULT_PROFILE.quorum, ...(loaded.quorum || {}) },
    resolution: { ...DEFAULT_PROFILE.resolution, ...(loaded.resolution || {}) },
  };
}

const profile = loadProfile();
const items = data.items || [];
const docTitle = data.title || profile.docTitle;

const EMPHASIS = profile.roles.emphasis;          // 강조할 주체(예: 발주처, 조합)
const EMPHASIS_COLOR = profile.roles.colors.emphasis;
const OTHER_COLOR = profile.roles.colors.other;

const FONT = "맑은 고딕";

/* ---------------- 표 서식 ---------------- */
const COLS = [640, 2060, 3200, 3100];
const TABLE_W = COLS.reduce((a, b) => a + b, 0);

const thin = { style: BorderStyle.SINGLE, size: 4, color: "9AA0A6" };
const cellBorders = { top: thin, bottom: thin, left: thin, right: thin };

function headCell(text, w) {
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: "1F3864", color: "auto" },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    borders: cellBorders,
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, bold: true, color: "FFFFFF", font: FONT, size: 20 })],
    })],
  });
}

function textCell(text, w, opts = {}) {
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 70, bottom: 70, left: 100, right: 100 },
    borders: cellBorders,
    children: [new Paragraph({
      alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
      children: [new TextRun({ text: String(text), bold: !!opts.bold, font: FONT, size: opts.size || 19 })],
    })],
  });
}

/** 결론 문단 + (프로파일이 켜져 있으면) 의결 결과 한 줄 */
function conclusionCell(item, w) {
  const list = (item.conclusions && item.conclusions.length)
    ? item.conclusions : [{ who: "", text: "" }];

  // 문단을 바로 만들지 않고 run 묶음으로 모은 뒤, 마지막 것만 아래 여백을 0으로 준다.
  const runGroups = list.map((c) => {
    const isEmphasis = !!EMPHASIS && c.who === EMPHASIS;
    const markerColor = isEmphasis ? EMPHASIS_COLOR : OTHER_COLOR;
    const runs = [];
    if (c.who) {
      runs.push(new TextRun({ text: `${c.who} → `, bold: true, color: markerColor, font: FONT, size: 19 }));
    }
    runs.push(new TextRun({ text: c.text || "", bold: isEmphasis, color: "000000", font: FONT, size: 19 }));
    return runs;
  });

  const r = item.resolution;
  if (profile.resolution.enabled && r) {
    const counts = ["찬성", "반대", "기권"]
      .filter((k) => r[k] !== undefined && r[k] !== null)
      .map((k) => `${k} ${r[k]}`)
      .join(" / ");
    const tail = [counts, r["결과"]].filter(Boolean).join(" · ");
    runGroups.push([
      new TextRun({ text: "의결 → ", bold: true, color: EMPHASIS_COLOR, font: FONT, size: 19 }),
      new TextRun({ text: tail, bold: true, color: "000000", font: FONT, size: 19 }),
    ]);
  }

  const paras = runGroups.map((runs, idx) => new Paragraph({
    spacing: { after: idx === runGroups.length - 1 ? 0 : 80 },
    children: runs,
  }));

  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 70, bottom: 70, left: 100, right: 100 },
    borders: cellBorders,
    children: paras,
  });
}

/* ---------------- 정족수 블록 ---------------- */
function quorumParagraphs() {
  if (!profile.quorum.enabled || !data.quorum) return [];

  const entries = Object.entries(data.quorum);
  const line = entries.map(([k, v]) => `${k} ${v}`).join("  ·  ");

  const out = [new Paragraph({
    spacing: { after: 60 },
    children: [
      new TextRun({ text: "성원 ", bold: true, color: EMPHASIS_COLOR, font: FONT, size: 19 }),
      new TextRun({ text: line, font: FONT, size: 19 }),
    ],
  })];

  // 직접출석 비율은 결의 효력과 직결되므로 값이 있으면 계산해 함께 적는다.
  const total = Number(data.quorum["총 조합원 수"] ?? data.quorum["총원"]);
  const direct = Number(data.quorum["직접 출석"] ?? data.quorum["직접출석"]);
  if (Number.isFinite(total) && total > 0 && Number.isFinite(direct)) {
    const pct = ((direct / total) * 100).toFixed(1);
    out.push(new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({
        text: `직접 출석 비율 ${pct}% (${direct}/${total})`,
        bold: true, font: FONT, size: 19,
      })],
    }));
  }

  if (profile.quorum.note) {
    out.push(new Paragraph({
      spacing: { after: 200 },
      children: [new TextRun({ text: profile.quorum.note, font: FONT, size: 16, color: "595959" })],
    }));
  }
  return out;
}

/* ---------------- 조립 ---------------- */
const header = new TableRow({
  tableHeader: true,
  children: [
    headCell("No.", COLS[0]),
    headCell("안 건", COLS[1]),
    headCell("핵심 내용", COLS[2]),
    headCell("결론 및 조치사항", COLS[3]),
  ],
});

const rows = items.map((it, i) => new TableRow({
  children: [
    textCell(i + 1, COLS[0], { center: true, bold: true }),
    textCell(it.title || "", COLS[1], { bold: true }),
    textCell(it.core || "", COLS[2]),
    conclusionCell(it, COLS[3]),
  ],
}));

const table = new Table({
  columnWidths: COLS,
  width: { size: TABLE_W, type: WidthType.DXA },
  rows: [header, ...rows],
});

const title = new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 240 },
  children: [new TextRun({ text: docTitle, bold: true, font: FONT, size: 34, color: "1F3864" })],
});

const doc = new Document({
  styles: { default: { document: { run: { font: FONT, size: 19 } } } },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 }, // A4
        margin: { top: 1200, bottom: 1200, left: 1200, right: 1200 },
      },
    },
    children: [title, ...quorumParagraphs(), table],
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  console.log(`written ${outPath} (${buf.length} bytes, ${items.length} agenda items, profile=${profile.id || "default"})`);
});
