import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function resolveWithExt(base) {
  for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return base;
}

/** @type {import('esbuild').Plugin} */
const aliasAtPlugin = {
  name: "alias-at",
  setup(b) {
    b.onResolve({ filter: /^@\// }, (args) => ({
      path: resolveWithExt(path.join(root, args.path.slice(2))),
    }));
  },
};

const IMAGE_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp" };

// Next.js's static image import yields an object ({ src, width, height, ... }),
// not a bare string. Mirror that shape here so component code written against
// the Next loader (`img.src`) works unchanged in this esbuild bundle.
/** @type {import('esbuild').Plugin} */
const inlineImagePlugin = {
  name: "inline-image-as-object",
  setup(b) {
    b.onLoad({ filter: /\.(png|jpe?g|svg|webp)$/i }, (args) => {
      const ext = path.extname(args.path).toLowerCase();
      const b64 = fs.readFileSync(args.path).toString("base64");
      const dataUrl = `data:${IMAGE_MIME[ext]};base64,${b64}`;
      return { contents: `export default ${JSON.stringify({ src: dataUrl })};`, loader: "js" };
    });
  },
};

await build({
  entryPoints: [path.join(__dirname, "entry.tsx")],
  outfile: path.join(__dirname, "dist", "bundle.js"),
  bundle: true,
  format: "iife",
  jsx: "automatic",
  minify: true,
  target: "es2020",
  loader: {
    ".tsx": "tsx",
    ".ts": "ts",
  },
  define: { "process.env.NODE_ENV": '"production"' },
  alias: {
    "next/link": path.join(__dirname, "next-link-shim.tsx"),
    "next/navigation": path.join(__dirname, "next-navigation-shim.tsx"),
  },
  plugins: [aliasAtPlugin, inlineImagePlugin],
  logLevel: "info",
});

console.log("Artifact bundle built.");
