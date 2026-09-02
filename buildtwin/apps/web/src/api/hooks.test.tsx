import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ApiError } from "./client";
import { MAX_OBJECTS_PAGES, OBJECTS_PAGE_SIZE, queryKeys, useAllObjects, useObjectDetail } from "./hooks";
import type { BimObjectView } from "./types";
import { objectDetailFixture } from "../test/fixtures";
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

/**
 * ADR 0005: (project_id, global_id) 복합 키. 같은 IFC가 여러 프로젝트에 올라갈 수 있으므로
 * project_id 를 쿼리로 함께 보내고, 프로젝트별로 캐시가 섞이지 않아야 한다.
 */
describe("useObjectDetail", () => {
  const GID = objectDetailFixture.basic.global_id;

  afterEach(() => vi.unstubAllGlobals());

  it("GET /objects/{global_id} 요청에 project_id 쿼리 파라미터를 함께 보낸다", async () => {
    const { calls } = mockFetch((url) => {
      if (!url.includes(`/api/objects/${encodeURIComponent(GID)}`)) return undefined;
      return { body: objectDetailFixture };
    });

    const { result } = renderHook(() => useObjectDetail("p1", GID), { wrapper: makeHookWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const call = calls.find((c) => c.url.includes("/api/objects/"));
    const u = new URL(call!.url, "http://x");
    expect(u.searchParams.get("project_id")).toBe("p1");
  });

  it("같은 global_id 라도 project_id 가 다르면 캐시 키가 분리되어 서로 값이 섞이지 않는다", async () => {
    const qc = makeQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    mockFetch((url) => {
      const u = new URL(url, "http://x");
      if (!u.pathname.endsWith(`/objects/${encodeURIComponent(GID)}`)) return undefined;
      const pid = u.searchParams.get("project_id");
      return { body: { ...objectDetailFixture, basic: { ...objectDetailFixture.basic, name: `name-${pid}` } } };
    });

    // 서로 다른 프로젝트에서 같은 GlobalId 를 조회 — 캐시 키가 다르면 각자 자기 프로젝트 응답을 유지해야 한다.
    const h1 = renderHook(() => useObjectDetail("p1", GID), { wrapper });
    await waitFor(() => expect(h1.result.current.isSuccess).toBe(true));
    const h2 = renderHook(() => useObjectDetail("p2", GID), { wrapper });
    await waitFor(() => expect(h2.result.current.isSuccess).toBe(true));

    expect(h1.result.current.data?.basic.name).toBe("name-p1");
    expect(h2.result.current.data?.basic.name).toBe("name-p2");
    expect(qc.getQueryData(queryKeys.objectDetail("p1", GID))).toMatchObject({ basic: { name: "name-p1" } });
    expect(qc.getQueryData(queryKeys.objectDetail("p2", GID))).toMatchObject({ basic: { name: "name-p2" } });
    // 서로 다른 쿼리 키 자체도 검증
    expect(queryKeys.objectDetail("p1", GID)).not.toEqual(queryKeys.objectDetail("p2", GID));
  });

  it("서버가 409(같은 GlobalId 가 여러 프로젝트에 있어 모호함)를 주면 ApiError.status===409 로 전달된다", async () => {
    mockFetch((url) => {
      if (!url.includes(`/api/objects/${encodeURIComponent(GID)}`)) return undefined;
      return { status: 409, body: { detail: "ambiguous global_id across projects" } };
    });

    const { result } = renderHook(() => useObjectDetail("p1", GID), { wrapper: makeHookWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).status).toBe(409);
  });
});
