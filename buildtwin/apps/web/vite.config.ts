/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolveApiProxyTarget } from "./vite.proxy-target";

// **`defineConfig` 에 객체를 준다(콜백이 아니다).** tests/e2e/conftest.py 의 preview 설정이
// `import base from "./vite.config"` 뒤 `mergeConfig(base, …)` 를 부르는데, vite 의 mergeConfig 는
// 콜백 형태를 병합하지 못한다. 그래서 `loadEnv` 를 쓰는 콜백 형태로 바꾸지 않고 환경은
// 모듈 평가 시점에 읽는다(`vite.proxy-target.ts`).
export default defineConfig({
  plugins: [react()],
  // 저장소 루트의 postcss.config.mjs 를 타지 않도록 격리
  css: { postcss: { plugins: [] } },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        // 기본값은 오늘과 같은 http://localhost:8000 이다 — 갈래별 값과 이름의 근거는
        // vite.proxy-target.ts 의 머리 주석에 있다(계획 0015 문 4).
        target: resolveApiProxyTarget(),
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    globals: true,
    css: false,
  },
});
