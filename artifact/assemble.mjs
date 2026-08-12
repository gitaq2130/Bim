import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const cssDir = path.join(root, "out", "_next", "static", "chunks");
const cssFile = fs.readdirSync(cssDir).find((f) => f.endsWith(".css"));
if (!cssFile) throw new Error("Compiled Tailwind CSS not found — run `npm run build` first.");
const tailwindCss = fs.readFileSync(path.join(cssDir, cssFile), "utf8");

const bundleJs = fs.readFileSync(path.join(__dirname, "dist", "bundle.js"), "utf8");

const moduleCssPath = path.join(__dirname, "dist", "module-styles.css");
const moduleCss = fs.existsSync(moduleCssPath) ? fs.readFileSync(moduleCssPath, "utf8") : "";

const fontDir = path.join(root, "node_modules", "pretendard", "dist", "web", "static", "woff2");
const weights = [
  { file: "Pretendard-SemiBold.woff2", weight: 600 },
  { file: "Pretendard-Bold.woff2", weight: 700 },
  { file: "Pretendard-ExtraBold.woff2", weight: 800 },
];

const fontFaces = weights
  .map(({ file, weight }) => {
    const b64 = fs.readFileSync(path.join(fontDir, file)).toString("base64");
    return `@font-face{font-family:"Pretendard";font-weight:${weight};font-style:normal;font-display:swap;src:url(data:font/woff2;base64,${b64}) format("woff2");}`;
  })
  .join("\n");

const html = `<title>안건톡 — AngeonTalk</title>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
${fontFaces}
html,body{height:100%;margin:0;background:#050506;color-scheme:dark;}
#root{height:100%;}
${tailwindCss}
${moduleCss}
</style>
<div id="root"></div>
<script>
${bundleJs}
</script>
`;

const outPath = path.join(__dirname, "dist", "index.html");
fs.writeFileSync(outPath, html);
console.log("Wrote", outPath, `(${(html.length / 1024).toFixed(0)} KB)`);
