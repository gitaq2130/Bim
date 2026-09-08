/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolveApiProxyTarget } from "./vite.proxy-target";

// **`defineConfig` 에 객체를 준다(콜백이 아니다).** tests/e2e/conftest.py 의 preview 설정이
// `import base from "./vite.config"` 뒤 `mergeConfig(base, …)` 를 부르는데, vite 의 mergeConfig 는
// 콜백 형태를 병합하지 못한다. 그래서 `loadEnv` 를 쓰는 콜백 형태로 바꾸지 않고 환경은
// 모듈 평가 시점에 읽는다(`vite.proxy-target.ts`).

/** `/api` 프록시가 갈 곳. 모듈 평가 시점에 한 번 정하고, `server.proxy["/api"].target` 이 이 값이다. */
const apiProxyTarget = resolveApiProxyTarget();

/**
 * `대상:` 줄(**ⓘ**)에 실을 문자열. 인자는 `configure` 의 **둘째 인자 `options.target`** 이다 —
 * 위 모듈 상수가 아니다.
 *
 * ## 왜 모듈 상수를 닫아 싣지 않는가
 *
 * 이 옵션 객체를 **펼쳐 대상만 덮는 호출자**가 있다(`tests/e2e/conftest.py` 의 `PREVIEW_CONFIG` =
 * `{ ...apiProxy, target: … }`). 상수를 닫아 실으면 그 갈래에서 **같은 본문의 두 줄이 서로를
 * 반박한다** — `대상:` 은 상수를, `원인:` 은 프록시가 **실제로 닿지 못한 곳**을 말한다. 실측(잰 트리
 * `06e7368`, preview 갈래, 각각 닫힌 포트 둘을 env 대상·덮은 대상으로 두고 `/api/health` 를 친다,
 * **N=2** · 한 세션 안 · 몇 분 간격 — 두 표본이 같은 모양이었다. 첫 표본):
 *
 * ```
 * 대상: http://127.0.0.1:36995        ← env 가 준 값(모듈 상수)
 * 원인: ECONNREFUSED connect ECONNREFUSED 127.0.0.1:56295   ← 덮은 대상
 * ```
 *
 * 오늘 저장소의 그 호출자는 같은 프로세스에서 같은 환경을 읽어 두 값이 같지만, 그때 참인 근거는
 * **배선이 아니라 우연**이다(CLAUDE.md §6-4 3 — 그 상황에서 참일 수 없는 말을 담지 않는다,
 * 그 자리에서 도는 참조: `grep -n "참일 수 없는 말이 없다" ../../CLAUDE.md`).
 *
 * ## 없을 때 · 문자열이 아닐 때
 *
 * `options.target` 의 타입은 `string | Partial<url.Url> | { host, port, … } | undefined` 다.
 * **없을 때에만** 「대상 없음」이라 적는다 — 없다고 모듈 상수로 대신하면 프록시가 가지 않은 곳을
 * 대상이라 적게 되고 그것이 이 함수가 고치는 바로 그 거짓이다. 있는 값은 지어내지 않고 그대로
 * 적는다: `URL`·`url.Url` 은 `String()` 이 주소를 내고, `[object Object]` 밖에 내지 못하는 평범한
 * 객체는 JSON 으로 적는다(주소인 척 조립하지 않는다). 「있는데 없다고 적는」 함정은 `code` 자리에서
 * 이미 한 번 났다 — 아래 `asText` 의 주석이 그 자리다.
 */
export function apiProxyTargetText(target: unknown): string {
  if (target === undefined || target === null) return "대상 없음";
  if (typeof target === "string") return target;
  try {
    const text = String(target);
    return text === "[object Object]" ? JSON.stringify(target) : text;
  } catch {
    // 문자열로 만들다 던지는 대상(순환 참조·BigInt·던지는 toString)에서 **여기서 다시 던지지 않는다** —
    // 던지면 사용자가 보는 것은 본문 있는 502 가 아니라 아무것도 아니게 된다.
    return "대상을 문자열로 만들지 못했다";
  }
}

/**
 * `/api` 프록시가 **대상에서 응답을 받지 못했을 때** dev 서버가 돌려주는 본문.
 *
 * 문안의 정본은 ADR 0020 §2-2 **(가)** 이고 여기 그대로 옮겼다(인용 · 전체). 슬롯 셋:
 * **ⓘ 문의 이름** = `대상:` 줄 — **그 프록시가 실제로 받은 대상**(`apiProxyTargetText`) · **ⓙ 원인** = 하위 오류의
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
        // 둘째 인자 `options` 를 **받아서** 쓴다 — 이 핸들러가 실을 대상은 그 옵션 객체의 것이지
        // 모듈 상수가 아니다(위 `apiProxyTargetText` 의 머리 주석: 대상만 덮는 호출자가 있다).
        configure: (proxy, options) => {
          proxy.on("error", (err, _req, res) => {
            // ws 업그레이드 실패에서는 여기 오는 것이 ServerResponse 가 아니라 Socket 이다 —
            // 그 자리에는 status 도 본문도 쓸 수 없다.
            if (typeof (res as { writeHead?: unknown }).writeHead !== "function") {
              res.destroy();
              return;
            }
            const body = apiProxyFailureBody(apiProxyTargetText(options.target), err);
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
