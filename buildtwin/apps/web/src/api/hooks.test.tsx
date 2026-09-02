import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MAX_OBJECTS_PAGES, OBJECTS_PAGE_SIZE, useAllObjects } from "./hooks";
import type { BimObjectView } from "./types";
import { makeQueryClient, mockFetch } from "../test/utils";

/** QueryClient 를 한 번만 만들어 재사용하는 안정적인 wrapper (renderHook 리렌더마다 새 클라이언트가 생기지 않도록) */
function makeHookWrapper() {
  const qc = makeQueryClient();
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const makeObjects = (n: number, offset = 0): BimObjectView[] =>
  Array.from({ length: n }, (_, i) => ({ global_id: `G${offset + i}`, ifc_type: "IfcWall" }));

describe("useAllObjects", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("total 을 채울 때까지 페이지를 이어 붙이고, 정확히 필요한 요청 수만 보낸다", async () => {
    const total = OBJECTS_PAGE_SIZE + 500; // 2500 → 2페이지 (2000 + 500)
    const { calls } = mockFetch((url) => {
      const u = new URL(url, "http://x");
      if (!u.pathname.endsWith("/projects/p1/objects")) return undefined;
      const page = Number(u.searchParams.get("page") ?? "1");
      const pageSize = Number(u.searchParams.get("page_size") ?? "0");
      expect(pageSize).toBe(OBJECTS_PAGE_SIZE);
      if (page === 1) return { body: { items: makeObjects(OBJECTS_PAGE_SIZE, 0), total, page: 1, page_size: pageSize } };
      if (page === 2) return { body: { items: makeObjects(500, OBJECTS_PAGE_SIZE), total, page: 2, page_size: pageSize } };
      return { body: { items: [], total, page, page_size: pageSize } };
    });

    const { result } = renderHook(() => useAllObjects("p1"), { wrapper: makeHookWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items).toHaveLength(total);
    expect(result.current.data?.total).toBe(total);
    expect(result.current.data?.truncated).toBe(false);

    const objectCalls = calls.filter((c) => c.url.includes("/projects/p1/objects"));
    expect(objectCalls).toHaveLength(2);
  });

  it("응답이 배열 하나(비페이지네이션)면 요청 한 번으로 끝난다", async () => {
    const { calls } = mockFetch((url) => {
      if (!url.includes("/projects/p2/objects")) return undefined;
      return { body: makeObjects(3) };
    });

    const { result } = renderHook(() => useAllObjects("p2"), { wrapper: makeHookWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items).toHaveLength(3);
    expect(result.current.data?.total).toBe(3);
    expect(calls.filter((c) => c.url.includes("/projects/p2/objects"))).toHaveLength(1);
  });

  it("total 이 방어적 상한(page_size*MAX_OBJECTS_PAGES)을 넘으면 truncated=true 로 멈추고 상한만큼만 요청한다", async () => {
    const hugeTotal = OBJECTS_PAGE_SIZE * (MAX_OBJECTS_PAGES + 10);
    mockFetch((url) => {
      const u = new URL(url, "http://x");
      if (!u.pathname.endsWith("/projects/p3/objects")) return undefined;
      const pageSize = Number(u.searchParams.get("page_size") ?? "0");
      return { body: { items: makeObjects(pageSize), total: hugeTotal, page_size: pageSize } };
    });

    const { result } = renderHook(() => useAllObjects("p3"), { wrapper: makeHookWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.truncated).toBe(true);
    expect(result.current.data?.items).toHaveLength(OBJECTS_PAGE_SIZE * MAX_OBJECTS_PAGES);
  });
});
