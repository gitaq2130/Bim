# Artifact bundle

Packages the whole app (every screen) into a single self-contained `dist/index.html` — no server, no external requests — so it can run as a Claude Artifact or be opened directly as a local file.

Next.js's router (`next/link`, `next/navigation`) is swapped for an in-memory shim (`router-context.tsx`, `next-link-shim.tsx`, `next-navigation-shim.tsx`) via esbuild's `alias`, since a single HTML file has no real routes. Everything else — all `app/**/page.tsx` screens, `components/`, `lib/` — is reused unmodified.

## Build

```bash
npm run artifact:build
```

This runs, in order:
1. `next build` — produces the compiled Tailwind CSS this script reads from `out/_next/static/chunks/*.css`
2. `artifact/build.mjs` — bundles `entry.tsx` (React + all screens + the router shim) into `dist/bundle.js` with esbuild
3. `artifact/assemble.mjs` — inlines the CSS, the JS bundle, and the three Pretendard weights actually used (SemiBold/Bold/ExtraBold, as base64 `@font-face` data URIs — CDN fonts don't load under the Artifact CSP) into `dist/index.html`

`dist/` is gitignored; regenerate it whenever `app/`, `components/`, or `lib/` change.
