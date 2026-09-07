#!/usr/bin/env node
/**
 * 빌드된 페이지를 실제 브라우저에서 열어 결과 영역을 읽는다.
 *
 *   node build.mjs && node browsercheck.mjs
 *
 * verify.mjs 와 역할이 다르다. 저쪽은 계산식을 **다시 구현해서** 대조하므로
 * 식이 맞아도 페이지 안 스크립트의 오타나 곱하는 순서 차이는 잡지 못한다.
 * 실제로 일용직 소득세가 verify.mjs 에서는 1,350원으로 통과했는데 페이지에서는
 * 1,349원이 나왔다. (1 - 0.55) 가 0.44999999999999996 이었기 때문이다.
 *
 * 출력은 사람이 읽고 판단한다. 금액과 분기(is-warn / is-ok)가 의도대로인지 본다.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { globSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "dist");

/** 동봉된 크로미움을 찾는다. 버전 디렉터리 이름이 바뀌므로 글롭으로 찾는다. */
function findChromium() {
  const env = process.env.CHROMIUM_BIN;
  if (env && existsSync(env)) return env;
  const candidates = [
    ...globSync("/opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell"),
    ...globSync("/opt/pw-browsers/chromium-*/chrome-linux/chrome"),
    "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
  ];
  return candidates.find((p) => existsSync(p));
}

/** 슬러그, 라벨, {입력 id: 값} — 확인하고 싶은 분기마다 한 줄. */
const CASES = [
  ["일용직-소득세-계산기", "일당 20만 × 20일",        { pay: 200000, days: 20 }],
  ["일용직-소득세-계산기", "일당 18만 (소액부징수)",   { pay: 180000, days: 20 }],
  ["일용직-소득세-계산기", "일당 187,038 (경계 위)",   { pay: 187038, days: 1 }],
  ["주휴수당-계산기",     "주 40시간",                { hours: 40, wage: 10320 }],
  ["주휴수당-계산기",     "주 14시간 (미발생)",        { hours: 14, wage: 10320 }],
  ["주휴수당-계산기",     "최저임금 미달",             { hours: 40, wage: 9000 }],
  ["연장근로수당-계산기", "휴일 10h (8h 초과분 2배)",  { wage: 10000, ot: 0, night: 0, hol: 10 }],
  ["연장근로수당-계산기", "야간 겹친 연장 10h",        { wage: 10000, ot: 10, night: 10, hol: 0 }],
  ["연장근로수당-계산기", "5인 미만",                  { wage: 10000, ot: 10, night: 10, hol: 10, scale: "4" }],
  ["퇴직금-계산기", "상여·연차 포함",       { join: "2023-03-02", quit: "2026-09-01", wage3: 10500000, bonus: 4000000, annual: 600000, ordinary: 0 }],
  ["퇴직금-계산기", "1년 미만",             { join: "2026-01-01", quit: "2026-06-01", wage3: 6000000, bonus: 0, annual: 0, ordinary: 0 }],
  ["퇴직금-계산기", "통상임금이 큰 경우",   { join: "2023-03-02", quit: "2026-09-01", wage3: 10500000, bonus: 0, annual: 0, ordinary: 200000 }],
  ["퇴직금-계산기", "퇴직일 5/31 (말일 보정)", { join: "2020-01-01", quit: "2026-05-31", wage3: 9000000, bonus: 0, annual: 0, ordinary: 0 }],
  ["부가세-계산기", "합계 110만에서 역산",  { mode: "total", amt: 1100000, rate: 10 }],
];

const CH = findChromium();
if (!CH) {
  console.error("크로미움을 찾지 못했습니다. CHROMIUM_BIN 에 경로를 지정하세요.");
  process.exit(1);
}
const TMP = join(mkdtempSync(join(tmpdir(), "browsercheck-")), "page.html");

/** 입력값을 채우고 input·change 를 발생시키는 스크립트를 페이지 끝에 끼워 넣는다. */
function injection(sets) {
  const lines = Object.entries(sets).map(([id, v]) =>
    `var e=document.getElementById(${JSON.stringify(id)});if(!e)throw new Error("no #"+${JSON.stringify(id)});` +
    `e.value=${JSON.stringify(String(v))};` +
    `["input","change"].forEach(function(t){e.dispatchEvent(new Event(t,{bubbles:true}))});`
  );
  return `<script>(function(){${lines.join("")}})()</script>`;
}

let shown = 0;
for (const [slug, label, sets] of CASES) {
  const src = join(DIST, slug, "index.html");
  if (!existsSync(src)) { console.error(`  없음  ${slug} — 먼저 node build.mjs`); process.exitCode = 1; continue; }
  writeFileSync(TMP, readFileSync(src, "utf8").replace("</body>", injection(sets) + "</body>"));
  const dom = execFileSync(CH, ["--no-sandbox", "--disable-gpu", "--virtual-time-budget=3000", "--dump-dom", `file://${TMP}`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  /* 결과 영역에 id="out" 을 안 붙인 도구도 있다(분기별로 배경색을 바꿀 일이 없는 것들).
     그런 페이지는 첫 .out 블록을 읽는다. */
  const m = dom.match(/<div class="(out[^"]*)"[^>]*>([\s\S]*?)<div class="basis"/);
  const cls = m && m[1];
  const seg = m && [null, m[2]];
  if (!cls || !seg) { console.error(`  실패  ${slug} / ${label} — 결과 영역을 읽지 못했습니다`); process.exitCode = 1; continue; }
  const text = seg[1].replace(/<[^>]+>/g, "|").split("|").map((x) => x.trim()).filter(Boolean);
  if (text.some((t) => t === "—")) { console.error(`  실패  ${slug} / ${label} — 결과가 계산되지 않았습니다`); process.exitCode = 1; }
  console.log(`\n[${label}]  ${slug}  (${cls})`);
  text.forEach((t) => console.log("   " + t));
  shown++;
}
console.log(`\n${shown}건 렌더 — 금액과 분기가 의도대로인지 눈으로 확인할 것.`);
