import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import { useEffect, type ReactElement, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { useStore } from "../store";
import { installSessionCacheGuard } from "../api/sessionCache";
import type { UserRole } from "../api/types";

export function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
}

/**
 * ADR 0010 Consequences: 세션 캐시 가드는 **테스트 유틸에서도 설치**해야 웹 테스트가 진짜 경로를 탄다.
 * 안 하면 앱에서만 도는 코드가 되어, 가드가 통째로 사라져도 회귀가 초록으로 통과한다(CLAUDE.md §6-2).
 *
 * **해제는 렌더 수명에 묶여 있다.** 가드 구독은 모듈 싱글턴인 Zustand 스토어에 달리고, 발화하면
 * `selection`·`ui` 를 **공유 스토어에서** 지운다. 그래서 해제를 개별 테스트의 기억에 맡기면(예전 모양)
 * 한 번 잊은 순간부터 남은 가드가 **뒤 테스트의 스토어**를 조용히 비운다 — 예외도 경고도 없고 단언
 * 한 줄이 이유 없이 어긋날 뿐이다. `unsubscribeSessionGuard` 는 남기되(수동 해제도 가능, 두 번 불러도
 * 안전), 언마운트 시 자동 해제가 **구조적 보장**이다: RTL 의 자동 cleanup 이 매 테스트 끝에 언마운트한다.
 * 회귀는 `api/sessionCache.test.tsx` 10.
 *
 * **호출 순서: `loginAs()` 를 이 함수보다 먼저 부른다.** 가드는 `auth.userId` 변화를 세션 경계로 보므로
 * `null → "user-cm"`(렌더 뒤 로그인)도 경계다 — 그 렌더가 이미 받아 둔 캐시가 그 자리에서 비워지고,
 * 마운트된 쿼리는 로딩 상태에 그대로 멈춘다. 이것은 가드의 **진짜 동작**이지 테스트 유틸의 결함이 아니다
 * (앱에서는 로그인 전에 인증 화면이 아무것도 받아 두지 않아 clear() 가 무동작이다). 순서를 뒤집으면
 * 무엇이 일어나는지는 `api/sessionCache.test.tsx` 11 이 계약으로 고정한다.
 */
export function renderWithProviders(ui: ReactElement, opts: RenderOptions & { route?: string; path?: string } = {}) {
  const qc = makeQueryClient();
  let release: (() => void) | null = installSessionCacheGuard(qc);
  const unsubscribeSessionGuard = () => {
    release?.();
    release = null;
  };
  /** 렌더 트리 안에서만 살아 있는 해제기. 언마운트 = 해제 — 개별 테스트가 잊을 수 있는 자리가 없다. */
  const GuardLifetime = () => {
    useEffect(() => unsubscribeSessionGuard, []);
    return null;
  };
  const { route = "/", ...rest } = opts;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <GuardLifetime />
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return { qc, unsubscribeSessionGuard, ...render(ui, { wrapper: Wrapper, ...rest }) };
}

export function loginAs(role: UserRole, userId: string = `user-${role}`) {
  useStore.getState().auth.login({ token: `tok-${role}`, role, userId });
}

export function resetStore() {
  useStore.getState().auth.logout();
  useStore.getState().selection.clear();
}

type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown } | undefined;

/** 경로 매칭 기반 fetch 모킹. 마지막에 등록된 핸들러가 우선. */
export function mockFetch(handler: Handler) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    const r = handler(url, init) ?? { status: 404, body: { detail: `no mock for ${url}` } };
    const status = r.status ?? 200;
    return new Response(JSON.stringify(r.body ?? null), { status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}
