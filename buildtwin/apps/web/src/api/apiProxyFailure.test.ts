// @vitest-environment node
//
// `vite.config.ts` 를 import 하면 `vite` → `esbuild` 가 딸려 오고, esbuild 는 jsdom 의 `TextEncoder`
// 에서 *"Invariant violation: new TextEncoder().encode("") instanceof Uint8Array is incorrectly false"*
// 로 **수집 단계에서 죽는다**(실측 N=1). 그래서 이 파일만 node 환경으로 돈다 — **skip 이 아니다**:
// 아래 단언은 전부 실행되고, 환경이 바뀌어도 값이 갈리지 않는 순수 함수·설정 객체만 본다.
import { describe, expect, it, vi } from "vitest";
import type { ProxyOptions } from "vite";
import config, { apiProxyFailureBody } from "../../vite.config";
import { ApiError, request } from "./client";

/**
 * **㉡ 프록시가 죽을 때 사용자가 보는 문자열** — 담당: qa (계획 0016 작업 4-3, ADR 0020 §2-2).
 *
 * ## 무엇을 붙드는가
 *
 * 계약의 정본은 ADR 0020 §2-2 **(가)**(프록시 실패 본문)와 **(나)**(`client.ts` 의 마지막 폴백)이고,
 * 슬롯은 셋이다 — **ⓘ 문의 이름**(대상 주소) · **ⓙ 원인**(하위 오류의 값 그대로) · **ⓚ 다음에 칠 명령**.
 *
 * ## **문장을 통째로 베끼지 않는다** (CLAUDE.md §6-4 3)
 *
 * 그 자리에서 도는 참조: `grep -n "참일 수 없는 말이 없다" ../../../../CLAUDE.md`.
 * 문장을 베끼면 **거짓 문구가 계약이 된다** — 이 저장소는 그 실패를 이미 한 번 겪었다(존재한 적 없는
 * 되돌리기 엔드포인트를 약속한 다이얼로그 문구를 웹 테스트가 계약으로 고정한 채 전원 통과했다).
 * 그래서 아래는 **문장이 아니라 「그 상황에서 참일 수 없는 말이 없다」** 를 본다:
 *
 * - **ⓘ**: 본문이 싣는 주소가 **인자로 준 대상 하나뿐**이다(다른 `http(s)://` 가 없다). 상수로 박힌
 *   예시 주소는 그 순간 **참일 수 없는 말**이고, 대상을 바꿔 두 번 부르면 그것이 값으로 갈린다.
 * - **ⓙ**: 하위 오류의 `code`·`message` 가 **그대로** 실린다. 값이 있는데 *"코드 없음"* 이라 적으면
 *   거짓이고(문자열이 아닌 errno 가 그 자리다), 없는데 흔한 값으로 떨어뜨려도 거짓이다
 *   (CLAUDE.md §6-4 2 — `grep -n "떨어뜨리는 폴백을 두지 않는다" ../../../../CLAUDE.md`).
 * - **ⓚ**: **두 갈래를 다 적는다.** 하나만 적으면 다른 갈래를 친 사용자에게 그 문장이 거짓이다
 *   (ADR 0020 §2-2 (가) *"왜 갈래를 하나로 고르지 않고 둘 다 적는가"*).
 * - **(나)**: `:164` 폴백은 **본문이 비었다고 말하지 않고**(`{"foo":1}`·빈 문자열에서 거짓이다),
 *   **자기가 알지 못하는 것**(대상 주소·다음 명령)을 이름하지 않는다(ADR 0020 §2-3 넷째 행).
 *
 * ## 결함 있는 코드에서 값이 갈리는가 (CLAUDE.md §6-2 1 — 변이 실측, 각 N=1)
 *
 * 변이는 **한 자리씩** 심고 **심기 직전의 작업 트리 사본과 `diff`** 로 적용을 확인한 뒤 재고, 그 사본으로
 * 원복하고 루트 `git status --porcelain` 을 확인했다. 명령은 매번 `npx vitest run`(apps/web).
 *
 * | 변이 | 무엇을 심었나 | 실행값 |
 * |---|---|---|
 * | 음성 대조군 | 없음(이 커밋의 트리) | **303 passed** (31 files) |
 * | W1 | `vite.config.ts` 의 `configure`(에러 핸들러)를 통째로 지운다 = `6ac7a19` 이전의 두 키 | **3 failed, 300 passed** — 배선 둘과, 다른 파일(`previewProxyParity.test.ts`)의 「공허한 참을 막는」 단언 |
 * | W2 | `502` 를 `500` 으로 되돌린다 | **1 failed, 302 passed** — 배선의 status |
 * | W3 | `대상:` 줄을 상수 주소로 바꾼다 | **2 failed, 301 passed** — ⓘ 와 「지어내지 않는다」 |
 * | W4 | `코드 없음` 갈래를 흔한 값(`ECONNREFUSED`)으로 떨어뜨린다 | **2 failed, 301 passed** — ⓙ 와 「지어내지 않는다」 |
 * | W5 | `다음:` 의 호스트 갈래 줄을 지운다(갈래를 하나로 고른다) | **1 failed, 302 passed** — ⓚ |
 * | W6 | `client.ts` 의 폴백을 *"응답 본문이 비어 있다"* 로 되돌린다 | **1 failed, 302 passed** — (나) |
 *
 * **W3 ↔ W4 가 두 칸씩인 것이 이 표의 값이다**: 슬롯 하나를 겨눈 단언과 「지어내지 않는다」가 **서로를
 * 가려 주지 않는다**(CLAUDE.md §6-2 3 — 축마다 양성을 따로 세운다).
 * **W1 이 세 칸인 것**은 배선과 preview 대조가 **같은 키 하나**(`configure`)에 걸려 있기 때문이고,
 * 그 셋이 다 죽어야 「에러 핸들러가 없다」가 한 자리에서 보인다.
 */

/** 배선을 태울 때 쓰는 가짜 응답 — 무엇이 쓰였는지만 기록한다. */
function fakeResponse() {
  return {
    headersSent: false,
    status: 0,
    headers: {} as Record<string, string>,
    body: "",
    writeHead(status: number, headers: Record<string, string>) {
      this.status = status;
      this.headers = headers;
    },
    end(body: string) {
      this.body = body;
    },
  };
}

/** `configure` 가 등록한 `error` 핸들러를 꺼낸다 — 프록시를 띄우지 않는다. */
function proxyErrorHandler(options: ProxyOptions): (err: unknown, req: unknown, res: unknown) => void {
  let handler: ((err: unknown, req: unknown, res: unknown) => void) | undefined;
  const proxy = {
    on(event: string, cb: (err: unknown, req: unknown, res: unknown) => void) {
      if (event === "error") handler = cb;
    },
  };
  type Configure = NonNullable<ProxyOptions["configure"]>;
  (options.configure as Configure)(proxy as unknown as Parameters<Configure>[0], options);
  if (!handler) throw new Error("`/api` 프록시가 error 핸들러를 등록하지 않는다 — 실패가 본문 없이 나간다.");
  return handler;
}

function apiProxyOptions(): ProxyOptions {
  const options = config.server?.proxy?.["/api"];
  if (!options || typeof options === "string") {
    throw new Error("vite.config.ts 의 server.proxy['/api'] 가 옵션 객체가 아니다.");
  }
  return options;
}

/** 본문이 싣는 모든 절대 주소. ⓘ 가 참인지는 「대상이 있다」가 아니라 「다른 것이 없다」로 갈린다. */
const urlsIn = (body: string): string[] => body.match(/https?:\/\/[^\s`'")]+/g) ?? [];

const CONNECTION_REFUSED = { code: "ECONNREFUSED", message: "connect ECONNREFUSED 127.0.0.1:8000" };

describe("(가) /api 프록시 실패 본문 — 슬롯 셋", () => {
  it("ⓘ 본문이 싣는 주소는 인자로 준 대상 하나뿐이고, 대상이 바뀌면 값이 갈린다", () => {
    const a = apiProxyFailureBody("http://api:8000", CONNECTION_REFUSED);
    const b = apiProxyFailureBody("http://localhost:8000", CONNECTION_REFUSED);
    expect(urlsIn(a)).toEqual(["http://api:8000"]);
    expect(urlsIn(b)).toEqual(["http://localhost:8000"]);
    expect(a).not.toBe(b);
  });

  it("ⓙ 하위 오류의 code·message 를 그대로 싣는다 — 다듬지도 번역하지도 않는다", () => {
    const body = apiProxyFailureBody("http://api:8000", CONNECTION_REFUSED);
    expect(body).toContain(CONNECTION_REFUSED.code);
    expect(body).toContain(CONNECTION_REFUSED.message);
    expect(body).not.toContain("코드 없음");
  });

  it("ⓙ code 가 없으면 없다고 적는다 — 흔한 값으로 떨어뜨리지 않는다", () => {
    const body = apiProxyFailureBody("http://api:8000", { message: "socket hang up" });
    expect(body).toContain("코드 없음");
    expect(body).toContain("socket hang up");
    expect(body).not.toContain("ECONNREFUSED");
  });

  it("ⓙ code 가 문자열이 아니어도 그것이 있다 — 있는데 「코드 없음」이라 적으면 거짓이다", () => {
    const body = apiProxyFailureBody("http://api:8000", { code: -111, message: "connect" });
    expect(body).toContain("-111");
    expect(body).not.toContain("코드 없음");
  });

  it("ⓚ 두 갈래의 명령을 다 적는다 — 하나만 적으면 다른 갈래를 친 사용자에게 거짓이다", () => {
    const body = apiProxyFailureBody("http://api:8000", CONNECTION_REFUSED);
    for (const named of ["make dev", "docker compose", "make web", "make api"]) {
      expect(body).toContain(named);
    }
  });

  it("본문은 자기가 알지 못하는 것을 이름하지 않는다 — 오류 객체가 비어도 지어내지 않는다", () => {
    const body = apiProxyFailureBody("http://api:8000", {});
    expect(urlsIn(body)).toEqual(["http://api:8000"]);
    expect(body).toContain("코드 없음");
  });
});

describe("(가) 배선 — dev 서버가 실제로 그 본문을 돌려준다", () => {
  it("대상이 답하지 않으면 502 · text/plain · 본문 있는 응답이다", () => {
    const options = apiProxyOptions();
    const res = fakeResponse();
    proxyErrorHandler(options)(CONNECTION_REFUSED, {}, res);
    expect(res.status).toBe(502);
    expect(res.headers["Content-Type"]).toMatch(/^text\/plain/);
    expect(res.body).toBe(apiProxyFailureBody(String(options.target), CONNECTION_REFUSED));
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("응답을 쓸 수 없는 자리(ws 업그레이드)에서는 소켓을 닫을 뿐 status 를 지어내지 않는다", () => {
    const socket = { destroy: vi.fn() };
    proxyErrorHandler(apiProxyOptions())(CONNECTION_REFUSED, {}, socket);
    expect(socket.destroy).toHaveBeenCalled();
  });
});

describe("(나) client.ts 의 마지막 폴백 — 참일 수 없는 말을 담지 않는다", () => {
  const respond = (status: number, body: string, contentType: string) => {
    vi.stubGlobal("fetch", async () => new Response(body, { status, headers: { "content-type": contentType } }));
  };

  it("(가) 의 본문은 폴백에 닿지 않고 그대로 화면 문자열이 된다 — 슬롯 셋이 살아서 도착한다", async () => {
    const body = apiProxyFailureBody("http://api:8000", CONNECTION_REFUSED);
    respond(502, body, "text/plain; charset=utf-8");
    const error = await request("/health").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe(body);
  });

  it("읽을 수 있는 메시지가 없는 **객체** 본문에서 「비어 있다」고 말하지 않는다", async () => {
    respond(500, JSON.stringify({ foo: 1 }), "application/json");
    const error = (await request("/health").catch((e) => e)) as ApiError;
    expect(error.message).not.toMatch(/비어|비었/);
    expect(error.message).toContain("500");
  });

  it("본문이 정말 비었을 때에도 자기가 모르는 대상·명령을 이름하지 않는다", async () => {
    respond(500, "", "text/plain");
    const error = (await request("/health").catch((e) => e)) as ApiError;
    expect(error.message).toContain("500");
    expect(urlsIn(error.message)).toEqual([]);
    expect(error.message).not.toMatch(/make |docker compose/);
  });
});
