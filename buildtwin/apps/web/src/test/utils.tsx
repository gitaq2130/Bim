import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { useStore } from "../store";
import type { UserRole } from "../api/types";

export function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
}

export function renderWithProviders(ui: ReactElement, opts: RenderOptions & { route?: string; path?: string } = {}) {
  const qc = makeQueryClient();
  const { route = "/", ...rest } = opts;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return { qc, ...render(ui, { wrapper: Wrapper, ...rest }) };
}

export function loginAs(role: UserRole, userId = `user-${role}`) {
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
