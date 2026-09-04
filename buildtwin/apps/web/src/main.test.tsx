import type { QueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";

/**
 * 계획 0004 작업 5 의 완료 조건 중 **"진입점 설치"** 를 강제한다.
 *
 * ADR 0010 규칙 2 는 세션 캐시 가드를 "앱 진입점에서 한 번 설치한다"로 정한다. 그런데 그 설치가
 * 사라져도 웹 테스트는 **전량 초록으로 남는다**(2026-09-04 실측): `sessionCache.test.tsx` 는 자기
 * QueryClient 에 직접 설치하고, 나머지 화면 회귀는 `renderWithProviders`(= `test/utils.tsx`)가 설치한
 * 클라이언트를 쓴다. 즉 `main.tsx` 의 한 줄만 지우면 **운영에서만 가드가 없고 테스트는 전부 통과한다** —
 * "예외 없음 · 테스트 전원 통과 · 화면 정상"이라는 이 저장소의 지배적 실패 모드 그대로다(CLAUDE.md §6).
 *
 * **§6-2 자기 점검.** "설치 함수가 호출됐다"만 세면 부족하다 — **다른 QueryClient** 에 설치하면
 * 호출은 되지만 앱 싱글턴은 무방비다(ADR 0010 Alternatives 1 이 기각한 실패 모양이 정확히 그것:
 * 앱 싱글턴과 다른 클라이언트가 어긋나면 가드가 진짜 경로를 타지 않는다). 그래서 **렌더 트리에 실제로
 * 들어간 그 클라이언트**와 같은 객체인지를 센다.
 */
const rootRender = vi.fn();
const createRoot = vi.fn(() => ({ render: rootRender, unmount: vi.fn() }));
vi.mock("react-dom/client", () => ({ default: { createRoot }, createRoot }));

const installed: QueryClient[] = [];
vi.mock("./api/sessionCache", () => ({
  installSessionCacheGuard: (qc: QueryClient) => {
    installed.push(qc);
    return () => {};
  },
}));

/** `<StrictMode><QueryClientProvider client={…}>` 에서 실제로 쓰인 클라이언트를 꺼낸다. */
function clientInRenderedTree(tree: ReactElement): unknown {
  const strictChild = (tree.props as { children: ReactElement }).children;
  return (strictChild.props as { client?: unknown }).client;
}

describe("앱 진입점 (main.tsx) — ADR 0010 규칙 2 의 설치 지점", () => {
  it("렌더에 쓰는 바로 그 QueryClient 에 세션 캐시 가드를 설치한다", async () => {
    document.body.innerHTML = '<div id="root"></div>';

    await import("./main");

    expect(createRoot).toHaveBeenCalledTimes(1);
    expect(rootRender).toHaveBeenCalledTimes(1);
    expect(installed).toHaveLength(1);
    // 함께 단언한다(§6-2 4): 설치했다 **그리고** 그 대상이 화면이 쓰는 싱글턴이다.
    expect(clientInRenderedTree(rootRender.mock.calls[0][0])).toBe(installed[0]);
  });
});
