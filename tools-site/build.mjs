#!/usr/bin/env node
/**
 * 정적 사이트 빌드.
 *
 *   node build.mjs        →  dist/
 *
 * 도구를 추가하려면 src/tools/ 에 모듈 파일 하나를 더 넣고 아래 TOOLS 에 import 하면 된다.
 * 페이지·색인·사이트맵이 자동으로 따라온다.
 */
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SITE, page, toolHeader } from "./src/shell.mjs";
import { HELPERS } from "./src/tools/shared.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "dist");

async function loadTools() {
  const dir = join(HERE, "src", "tools");
  const files = (await readdir(dir))
    .filter((f) => f.endsWith(".mjs") && f !== "shared.mjs")
    .sort();
  const tools = [];
  for (const f of files) {
    const mod = await import(join(dir, f));
    tools.push(mod.default);
  }
  return tools;
}

function toolPage(tool) {
  return page({
    title: tool.title,
    description: tool.description,
    canonical: `/${encodeURI(tool.slug)}/`,
    body: toolHeader(tool) + tool.body,
    script: HELPERS + tool.script,
  });
}

/** 색인에 뜨는 분류 순서. 여기 없는 group 은 뒤에 나온 순서대로 붙는다. */
const GROUP_ORDER = ["건설 공무", "정비사업·공동주택", "노무", "세무·금액"];

function groupTools(tools) {
  const byGroup = new Map();
  for (const t of tools) {
    const g = t.group || "기타";
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(t);
  }
  const rank = (g) => {
    const i = GROUP_ORDER.indexOf(g);
    return i === -1 ? GROUP_ORDER.length : i;
  };
  return [...byGroup.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
}

function indexPage(tools) {
  const sections = groupTools(tools).map(([group, items]) => {
    const list = items.map((t) => `  <li><a href="/${encodeURI(t.slug)}/"><b>${t.indexLabel}</b><span>${t.indexDesc}</span></a></li>`).join("\n");
    return `<h2 class="group">${group}</h2>\n<ul class="index-list">\n${list}\n</ul>`;
  }).join("\n");
  const body = `<header class="top">
<span class="kicker">${SITE.name}</span>
<h1>${SITE.tagline}</h1>
<p>건설 공무·정비사업·노무 실무에서 자주 다시 계산하게 되는 값들. 숫자만 넣으면 바로 나옵니다. 도구마다 근거 조문을 함께 적어 두었습니다.</p>
</header>
${sections}`;
  return page({
    title: `${SITE.name} | 건설 공무·정비사업·노무 실무 계산 도구`,
    description: "건설기술인 배치기준, 하도급률, 조합 총회 직접출석 요건, 퇴직금·주휴수당·일용직 소득세 등 실무에서 자주 쓰는 계산을 근거 조문과 함께 모았습니다.",
    canonical: "/",
    body,
  });
}

function sitemap(tools) {
  const urls = ["/", ...tools.map((t) => `/${encodeURI(t.slug)}/`)];
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE.origin}${u}</loc><lastmod>${today}</lastmod></url>`).join("\n")}
</urlset>`;
}

const robots = () => `User-agent: *
Allow: /

Sitemap: ${SITE.origin}/sitemap.xml
`;

async function main() {
  const tools = await loadTools();
  await mkdir(DIST, { recursive: true });

  for (const t of tools) {
    const dir = join(DIST, t.slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.html"), toolPage(t), "utf8");
  }
  await writeFile(join(DIST, "index.html"), indexPage(tools), "utf8");
  await writeFile(join(DIST, "sitemap.xml"), sitemap(tools), "utf8");
  await writeFile(join(DIST, "robots.txt"), robots(), "utf8");

  console.log(`built ${tools.length} tool pages + index into dist/`);
  tools.forEach((t) => console.log(`  /${t.slug}/`));
}

main().catch((e) => { console.error(e); process.exit(1); });
