/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolveApiProxyTarget } from "./vite.proxy-target";

// **`defineConfig` 에 객체를 준다(콜백이 아니다).** tests/e2e/conftest.py 의 preview 설정이
// `import base from "./vite.config"` 뒤 `mergeConfig(base, …)` 를 부르는데, vite 의 mergeConfig 는
// 콜백 형태를 병합하지 못한다. 그래서 `loadEnv` 를 쓰는 콜백 형태로 바꾸지 않고 환경은
// 모듈 평가 시점에 읽는다(`vite.proxy-target.ts`).

/** `/api` 프록시가 갈 곳. 모듈 평가 시점에 한 번 정하고, 아래 실패 본문이 같은 값을 싣는다. */
const apiProxyTarget = resolveApiProxyTarget();

/**
 * `/api` 프록시가 **대상에서 응답을 받지 못했을 때** dev 서버가 돌려주는 본문.
 *
 * 문안의 정본은 ADR 0020 §2-2 **(가)** 이고 여기 그대로 옮겼다(인용 · 전체). 슬롯 셋:
 * **ⓘ 문의 이름** = `대상:` 줄의 `resolveApiProxyTarget()` 값 · **ⓙ 원인** = 하위 오류의
 * `code`·`message` **그대로**(다듬거나 번역하지 않는다) · **ⓚ 다음에 칠 명령** = 두 갈래를
 * 조건과 함께 둘 다.
 *
 * **갈래를 고르지 않고 둘 다 적는 이유**는 고르면 고름이 틀릴 수 있는 자리가 하나 생기기
 * 때문이다(ADR 0020 §2-2 (가) — 사용자는 자기가 `make dev` 를 쳤는지 `make web` 을 쳤는지 안다).
 * **`code` 가 없으면 `코드 없음` 이라고 적는다** — 흔한 값으로 떨어뜨리지 않는다(CLAUDE.md §6-4 2,
 * 그 자리에서 도는 참조: `grep -n "떨어뜨리는 폴백을 두지 않는다" ../../CLAUDE.md`).
 */
export function apiProxyFailureBody(target: string, err: unknown): string {
  const sub = (err ?? {}) as { code?: unknown; message?: unknown };
  // **문자열인지로 거르지 않는다.** 「문자열일 때만 싣는다」로 쓰면 문자열이 아닌 `code`(예: 숫자
  // errno)에서 「코드 없음」이 나오는데, 그때 그 말은 **거짓**이다 — 코드가 있는데 없다고 적는다.
  // 그래서 있는 값은 그대로 문자열로 만들고, **없을 때에만** 「코드 없음」이라 적는다.
  const asText = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
  const code = asText(sub.code) || "코드 없음";
  const message = asText(sub.message);
  return [
    "[BuildTwin] /api 프록시가 대상에서 응답을 받지 못했다 — 이 응답은 api 가 아니라 vite dev 서버가 만들었다.",
    `대상: ${target}`,
    `원인: ${code} ${message}`,
    "다음: compose 갈래(`make dev`)면 다른 셸에서 `docker compose ps api` 와 `docker compose logs api`.",
    "      호스트 갈래(`make web`)면 다른 셸에서 `make api`.",
  ].join("\n");
}

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
        target: apiProxyTarget,
        changeOrigin: true,
        // **대상이 답하지 않을 때 이 응답에 본문이 있다**(ADR 0020 §2-1 항 2·3 → §2-2 (가)).
        // 이 핸들러가 없으면 사용자가 보는 것은 client.ts 의 마지막 폴백 한 줄뿐이고, 그 줄은
        // 대상 주소도 다음 명령도 알지 못한다(ADR 0020 §2-3 넷째 행 · §1-2 ⓒ 히트 0).
        // status 는 **502** 다 — 500 이면 api 자신이 낸 500 과 구별되지 않고, 그 둘은 다음에 칠
        // 명령이 다른 두 사건이다(ADR 0020 §2-2 (가) "왜 502 인가").
        configure: (proxy) => {
          proxy.on("error", (err, _req, res) => {
            // ws 업그레이드 실패에서는 여기 오는 것이 ServerResponse 가 아니라 Socket 이다 —
            // 그 자리에는 status 도 본문도 쓸 수 없다.
            if (typeof (res as { writeHead?: unknown }).writeHead !== "function") {
              res.destroy();
              return;
            }
            const body = apiProxyFailureBody(apiProxyTarget, err);
            if (!res.headersSent) {
              res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
            }
            res.end(body);
          });
        },
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
