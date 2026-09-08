// @vitest-environment node
//
// **node 환경이어야 한다.** 이 파일은 `vite.config.ts` 를 실제로 import 해서 그 설정이 싣는 값을
// 보는데(아래 「붙드는 것」 ②), vite 는 esbuild 를 끌고 오고 esbuild 는 jsdom 의 `TextEncoder`
// 에서 죽는다(실측: *"Invariant violation: new TextEncoder().encode(\"\") instanceof Uint8Array is
// incorrectly false"*). 이 파일의 단언 어디에도 DOM 이 필요하지 않다.
import type { UserConfig } from "vite";

import baseConfig from "./vite.config";
import {
  API_PROXY_TARGET_ENV,
  DEFAULT_API_PROXY_TARGET,
  resolveApiProxyTarget,
} from "./vite.proxy-target";

/**
 * 문 4(계획 0015)의 프론트 절반을 붙든다 — 담당: `frontend`.
 *
 * ## 이 파일이 붙드는 것과 붙들지 **못하는** 것
 *
 * 붙드는 것 셋: ① 환경이 말하지 않을 때의 대상이 **오늘과 같다**(호스트 `make web` 갈래가 그 값에
 * 매여 있다) ② 환경이 말하면 그 값이 **실제로 `vite.config.ts` 의 프록시 대상까지 간다**
 * ③ 그 **이름**이 갈리지 않는다.
 *
 * ③ 이 여기 있는 이유가 이 파일의 요점이다. 이름의 반대편은 `docker-compose.yml` 의 `web` 서비스이고
 * (계획 0015 작업 5, 소유가 다르다 — CLAUDE.md §2), 이름이 한쪽에서만 바뀌면 프록시는 **말없이
 * 기본값으로 돌아가 web 컨테이너 안에서 자기 자신을 가리킨다**. 그 손해는 데몬이 있는 자리에서만
 * 보이는데 이 환경에는 데몬이 없다(계획 0015 §0). 그래서 문자열을 여기서 계약으로 못박는다.
 *
 * **붙들지 못하는 것**: 「compose 가 실제로 그 이름을 준다」. 그 단언은 두 파일을 함께 읽어야 하고
 * (qa 의 `tests/invariants/test_demo_stack_can_stand.py` ⑤ 가 `seed-compose` 에 대해 쓰는 모양),
 * 이 커밋의 트리에는 반대편이 아직 없다. 여기서 「compose 에 그 이름이 없다」를 단언하면 그것은
 * **같은 사이클의 작업 5 가 거짓으로 만드는 부재 단정**이다(CLAUDE.md §6-1 — *"부재를 적을 때
 * 그것을 메우는 작업이 같은 사이클에 있는지 본다"*). 그래서 적지 않고 넘긴다.
 * 그 단언을 지는 것은 같은 파일의 `test_the_compose_web_service_spells_the_proxy_env_name_the_web_app_reads`
 * 다(qa 소유 — 이름이 갈리면 그 자리에서 죽는다).
 *
 * **`make e2e` 는 이 이름을 본다 — 실측이다.** Playwright 갈래는 `vite preview` 로 서빙하고
 * `tests/e2e/conftest.py` 가 `preview.proxy` 를 박는데, vite 는 `preview.proxy` 가 있으면
 * `server.proxy` 를 보지 않는다(그래서 대상을 **상수로** 적던 배선에서는 `resolveApiProxyTarget` 이
 * E2E 에서 한 번도 불리지 않았다). 지금 그 픽스처는 대상을 그 함수에서 받고 이 파일 옆의 이름 상수를
 * 읽어 자기가 주는 이름과 맞대 보므로, `API_PROXY_TARGET_ENV` 를 갈고 `make e2e` 를 돌리면
 * **9 passed, 3 errors** 다(N=1, 잰 트리 `5bc8d5c`) — 그 값의 정본은 그 픽스처의 표다(qa 소유).
 *
 * **그래도 참인 것 하나**: `BUILDTWIN_API_PROXY_TARGET=http://nonexistent-host-for-gate4-probe:9999
 * make e2e` 는 **12 passed** 다(N=1, 같은 트리). 그 픽스처가 주변 환경의 값을 **일부러 덮기**
 * 때문이고 — 프록시는 그 실행이 띄운 포트를 가리켜야 한다 — 사각이 아니라 설계다. 즉 「환경으로
 * 주는 값」축은 여기서 재지지 않고, 재지는 것은 **이름**축이다.
 *
 * **브라우저에서의 손해는 여전히 재지 않았다**(계획 0015 §확인하지 않은 것 63) — 이 환경에 docker
 * 데몬이 없어(`docker info` 가 소켓 부재를 낸다) 컨테이너 안에서 프록시가 무엇을 내는지(연결 거부인지
 * 5173 자신의 응답인지)는 이 커밋도 답하지 못한다.
 *
 * ## 변이 실측 (§6-2 1 — 각 N=1, `npx vitest run vite.proxy-target.test.ts`)
 *
 * **값의 정본은 여기다**(§후속 62 ⓑ — 근거 값은 커밋 본문을 정본으로 삼지 않는다). 변이는 한
 * 자리씩 심고 **심기 직전의 작업 트리 사본과 `diff`** 로 적용을 확인한 뒤 재고, 사본으로 원복하고
 * 루트 `git status --porcelain` 을 확인했다(§6-2 규칙 5 — 이 커밋이 처음 넣는 파일들이라 대-HEAD
 * `git diff` 축은 여기서 침묵한다). 음성 대조군(변이 없음) **6 passed**.
 *
 * | 변이 | 무엇을 심었나 | 실행값 |
 * |---|---|---|
 * | M1 | `DEFAULT_API_PROXY_TARGET` 을 `http://api:8000` 으로(= 호스트 `make web` 갈래를 깬다) | **2 failed, 4 passed** — 「기본값」 단언 둘이 함께 죽는다 |
 * | M2 | `API_PROXY_TARGET_ENV` 를 `API_PROXY_TARGET` 으로(= compose 와 이름이 갈린다) | **1 failed, 5 passed** — 이름 계약만 죽는다 |
 * | M3 | `vite.config.ts` 가 결정자를 부르지 않고 `http://localhost:8000` 을 다시 상수로 박는다 | **1 failed, 5 passed** — 「환경이 설정까지 간다」만 죽는다(*expected 'http://localhost:8000' to be 'http://api:8000'*) |
 * | M4 | 빈 값에서 던지지 않고 `DEFAULT_API_PROXY_TARGET` 을 돌려준다(= 문 4 가 조용히 다시 열린다) | **1 failed, 5 passed** — *expected [Function] to throw an error* |
 *
 * **M2 가 이 표의 값이다.** 이름이 갈렸을 때 나는 것은 **예외가 아니라 침묵**이다 — 탐침(N=1,
 * `vite-node`): 읽는 이름이 `BUILDTWIN_API_PROXY_TARGET` 인데 환경이 `API_PROXY_TARGET` 으로 주면
 * `resolveApiProxyTarget` 이 **`http://localhost:8000` 을 돌려준다**(맞는 이름으로 주면
 * `http://api:8000`). 즉 이름 하나가 갈리면 web 컨테이너는 조용히 다시 자기 자신을 가리킨다.
 */
function targetOf(config: UserConfig): unknown {
  const entry = config.server?.proxy?.["/api"];
  return typeof entry === "object" ? entry.target : entry;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("resolveApiProxyTarget", () => {
  it("환경이 말하지 않으면 호스트 `make web` 갈래의 값을 그대로 쓴다", () => {
    expect(resolveApiProxyTarget({})).toBe("http://localhost:8000");
    expect(DEFAULT_API_PROXY_TARGET).toBe("http://localhost:8000");
  });

  it("환경이 말하면 그 값을 쓴다 — compose 의 web 컨테이너가 api 에 닿는 자리", () => {
    expect(resolveApiProxyTarget({ [API_PROXY_TARGET_ENV]: "http://api:8000" })).toBe("http://api:8000");
  });

  it("선언됐는데 비어 있으면 기본값으로 떨어뜨리지 않고 던진다(문 4 가 조용히 다시 열린다)", () => {
    for (const blank of ["", "   "]) {
      expect(() => resolveApiProxyTarget({ [API_PROXY_TARGET_ENV]: blank })).toThrowError(
        new RegExp(API_PROXY_TARGET_ENV),
      );
    }
  });

  it("이름은 compose 와의 계약이다 — 갈리면 vite 는 예외 없이 기본값으로 떨어진다", () => {
    expect(API_PROXY_TARGET_ENV).toBe("BUILDTWIN_API_PROXY_TARGET");
  });
});

describe("vite.config.ts 의 /api 프록시", () => {
  it("환경이 말하지 않으면 오늘과 같은 대상을 싣는다", () => {
    // 상수가 아니라 **문자열**과 견준다 — 상수와 견주면 기본값을 바꾸는 변이에서 이 단언이
    // 함께 움직여 죽지 않는다(§6-2 1: 결함 있는 코드가 그대로 만족하는 기대값을 쓰지 않는다).
    expect(targetOf(baseConfig)).toBe("http://localhost:8000");
    expect(targetOf(baseConfig)).toBe(DEFAULT_API_PROXY_TARGET);
  });

  it("환경이 말하면 그 값이 설정까지 간다 — 결정자를 실제로 부른다는 뜻", async () => {
    vi.stubEnv(API_PROXY_TARGET_ENV, "http://api:8000");
    vi.resetModules();
    const { default: fresh } = (await import("./vite.config")) as { default: UserConfig };
    expect(targetOf(fresh)).toBe("http://api:8000");
  });
});
