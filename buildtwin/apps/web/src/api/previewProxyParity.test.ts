// @vitest-environment node
//
// `vite.config.ts` 와 생성된 preview 설정을 **둘 다 평가**하므로 esbuild 가 필요하다 — jsdom 에서는
// 수집 단계에서 죽는다(같은 근거를 `apiProxyFailure.test.ts` 머리가 값과 함께 적는다).
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { ProxyOptions } from "vite";
import base from "../../vite.config";

/**
 * **`make e2e` 의 preview 갈래가 dev 갈래와 같은 `/api` 옵션을 지나는가** — 담당: qa
 * (계획 0016 작업 4, ADR 0020 §7 Deferred 5 가 「그 배선의 소유는 qa 다」라고 이름한 자리).
 *
 * ## 왜 있는가 — 이 사이클이 찾아낸 제일 사나운 자리이고, 그것을 붙드는 단언이 없었다
 *
 * **vite 는 `preview.proxy` 가 있으면 `server.proxy` 를 보지 않는다**(frontend 실측). 그래서
 * `tests/e2e/conftest.py` 의 `PREVIEW_CONFIG` 가 `/api` 옵션을 **키 단위로 다시 적으면**, base 에만
 * 있는 키는 그 갈래에 **오지 않는다**. 손해는 두 번 다 「조용히 다른 것을 잰다」였다(그 파일 머리 주석의
 * 실측, **저장소 밖의 값이 아니라 그 자리에 적힌 값**): `6ac7a19` 트리에서 대상을 닫힌 포트로 두고
 * `/api/health` 를 치면 dev 갈래는 **502 · 본문 404바이트**인데 preview 갈래는 **500 · 본문 0바이트**였고,
 * `make e2e` 는 그때도 **12 passed** 였다 — 새 502 핸들러를 **구조적으로 못 본다**.
 * `65ac781` 이 그 배선을 「객체를 펼쳐 물려받기」로 고쳤지만 **그 참을 붙드는 단언은 없었다.**
 *
 * ## 무엇을 보는가 — 설정 **객체**를 대조한다(서버를 띄우지 않는다)
 *
 * `PREVIEW_CONFIG` 를 그 파일에서 읽어 **실제로 평가**하고(임시 설정 파일 → 동적 import), 나온 객체의
 * `preview.proxy["/api"]` 를 `vite.config.ts` 의 `server.proxy["/api"]` 와 맞댄다. 보는 것 셋:
 *
 * 1. **base 가 대상 말고도 무언가를 싣는다**(`configure` = 502 핸들러). 이것이 없으면 아래 2 가
 *    **공허하게 참**이 되고, 그러면 결함 코드에서도 초록이다(CLAUDE.md §6-2 1).
 * 2. **preview 가 base 의 키를 하나도 잃지 않는다.**
 * 3. **`target` 말고는 값이 같은 것 그대로다**(`Object.is`) — 다시 선언한 사본이 아니라 물려받은 그것.
 *    `target` 만 갈리는 이유는 그 갈래가 자기 포트를 가리켜야 하기 때문이다(문 4).
 *
 * ## 이 파일이 **보지 못하는** 것 (CLAUDE.md §6-1 ②)
 *
 * - **실제 응답.** 설정 객체가 같다는 것과 preview 프로세스가 502 를 낸다는 것은 다른 사실이다.
 *   후자는 서버를 띄워야 하고(그 값은 `tests/e2e/conftest.py` 머리 표에 있다), 이 파일은 띄우지 않는다.
 * - **`mergeConfig` 의 나머지.** 보는 것은 `/api` 옵션 하나다.
 * - **conftest 가 그 설정을 실제로 쓰는지.** 문자열을 읽을 뿐, `web_server` 가 그 파일을 어떻게 쓰는지는
 *   `make e2e` 가 본다.
 * - **같은 값으로 다시 적은 원시값.** 3 은 `Object.is` 로 보므로 `changeOrigin: true` 를 그대로 다시
 *   선언한 사본은 물려받은 것과 **구별되지 않는다**(아래 P2 의 값). 오늘 손해는 없고 내일 base 가
 *   바뀌면 갈리는 자리라, 잡히는 것은 그때의 P3 다.
 *
 * ## 결함 있는 코드에서 값이 갈리는가 (CLAUDE.md §6-2 1 — 변이 실측, N=1)
 *
 * 변이는 한 자리 + 심기 직전의 작업 트리 사본과 `diff`, 그 사본으로 원복, 루트 `git status --porcelain`.
 * 명령은 `npx vitest run`(apps/web).
 *
 * | 변이 | 무엇을 심었나 | 실행값 |
 * |---|---|---|
 * | 음성 대조군 | 없음(이 커밋의 트리) | **303 passed** (31 files) |
 * | P1 | `PREVIEW_CONFIG` 의 `/api` 를 `6ac7a19` 의 모양(`{ target, changeOrigin }` 두 키)으로 되돌린다 | **2 failed, 301 passed** — 2 가 *"preview 갈래가 잃는 키: configure"* 로, 3 이 `changeOrigin` 이 사본이라 죽는다 |
 * | P2 | 펼침은 두고 `changeOrigin: true` 를 **같은 값으로** 다시 선언한다 | **303 passed 그대로** — 아래 「보지 못하는 것」의 값 |
 * | P3 | 펼침은 두고 `changeOrigin: false` 로 다시 선언한다 | **1 failed, 302 passed** — 3 |
 * | W1 | `vite.config.ts` 의 `configure` 를 지운다(= base 에 실을 것이 없어진다) | **3 failed, 300 passed** — 그중 1 이 이 파일의 것이다: 공허한 참을 막는 자리 |
 *
 * **P2 는 예측과 갈렸다**(예측 「1 failed」 ↔ 실측 **초록**): 3 은 `Object.is` 로 보므로 **원시값을 같은
 * 값으로 다시 적은 사본**은 물려받은 것과 구별되지 않는다. 그래서 위 「보지 못하는 것」에 그 칸을 적고,
 * P3 가 **값이 갈리는 사본**은 잡힌다는 것을 따로 태운다 — 잡는 것은 「사본인가」가 아니라
 * **「두 갈래가 같은 것을 지나는가」** 다.
 */

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONFTEST = path.resolve(WEB, "..", "..", "tests", "e2e", "conftest.py");

/**
 * 생성 설정을 임시 디렉터리가 아니라 `apps/web` 안에 두는 이유는 기전이다: vite 는 설정 파일의
 * **위치** 기준으로 `vite` 패키지를 해석하므로 그 밖에 두면 import 가 풀리지 않는다(`conftest.py` 와
 * 같은 제약, 그 파일 `PREVIEW_CONFIG` 머리 주석). 이름은 `.gitignore` 의 `apps/web/.e2e-preview*.config.mts`
 * 에 걸리고, 위 `afterAll` 이 지운다.
 */
const GENERATED = path.join(WEB, `.e2e-preview.parity-${process.pid}.config.mts`);

afterAll(() => rmSync(GENERATED, { force: true }));

function previewConfigSource(): string {
  const matched = readFileSync(CONFTEST, "utf8").match(/^PREVIEW_CONFIG = """([\s\S]*?)"""/m);
  if (!matched) {
    throw new Error(`${CONFTEST} 에서 PREVIEW_CONFIG 를 찾지 못했다 — 이름이 바뀌었으면 이 단언도 함께 고쳐라.`);
  }
  return matched[1];
}

function optionsOf(container: { proxy?: Record<string, string | ProxyOptions> } | undefined, where: string): ProxyOptions {
  const options = container?.proxy?.["/api"];
  if (!options || typeof options === "string") throw new Error(`${where} 의 /api 가 옵션 객체가 아니다.`);
  return options;
}

async function previewApiOptions(): Promise<ProxyOptions> {
  writeFileSync(GENERATED, previewConfigSource(), "utf8");
  const loaded = (await import(/* @vite-ignore */ GENERATED)) as { default: { preview?: { proxy?: Record<string, string | ProxyOptions> } } };
  return optionsOf(loaded.default.preview, "생성된 preview 설정");
}

describe("preview 갈래가 dev 갈래의 /api 옵션을 그대로 물려받는다", () => {
  it("base 가 대상 말고도 싣는 것이 있다 — 없으면 아래 대조가 공허하게 참이 된다", () => {
    expect(Object.keys(optionsOf(base.server, "vite.config.ts"))).toContain("configure");
  });

  it("preview 가 base 의 키를 하나도 잃지 않는다 — 잃으면 그 설정은 e2e 에서 조용히 다른 것을 잰다", async () => {
    const dev = Object.keys(optionsOf(base.server, "vite.config.ts"));
    const preview = Object.keys(await previewApiOptions());
    const lost = dev.filter((key) => !preview.includes(key));
    expect(lost, `preview 갈래가 잃는 키: ${lost.join(", ")} — vite 는 preview.proxy 가 있으면 server.proxy 를 보지 않는다`).toEqual([]);
  });

  it("target 말고는 base 의 값 그대로다 — 다시 선언한 사본이 아니라 물려받은 그것이다", async () => {
    const dev = optionsOf(base.server, "vite.config.ts") as Record<string, unknown>;
    const preview = (await previewApiOptions()) as Record<string, unknown>;
    const differing = Object.keys(dev).filter((key) => key !== "target" && !Object.is(dev[key], preview[key]));
    expect(differing, `preview 가 다시 선언한 키: ${differing.join(", ")} — 사본은 base 가 바뀌어도 따라오지 않는다`).toEqual([]);
    expect(typeof preview.target).toBe("string");
    expect(preview.target).not.toBe("");
  });
});
