import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
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
 * 반환값의 `unsubscribeSessionGuard` 로 개별 테스트가 해제할 수 있다.
 */
export function renderWithProviders(ui: ReactElement, opts: RenderOptions & { route?: string; path?: string } = {}) {
  const qc = makeQueryClient();
  const unsubscribeSessionGuard = installSessionCacheGuard(qc);
  const { route = "/", ...rest } = opts;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
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
