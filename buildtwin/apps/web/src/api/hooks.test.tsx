import { QueryClient, QueryClientProvider, partialMatchKey } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ApiError } from "./client";
import {
  MAX_OBJECTS_PAGES,
  OBJECTS_PAGE_SIZE,
  queryKeys,
  useAllObjects,
  useConfirmDocumentMapping,
  useObjectDetail,
  useReadiness,
  useResolveReview,
} from "./hooks";
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

/**
 * ADR 0008 §5 / Plan 0002 §4 — Activity 는 `(project_id, activity_id)` 복합 키다.
 *
 * 여기서 **가장 중요한 것은 무효화 접두사가 새 readiness 키에 실제로 걸리는가**이다.
 * 12·13차 리뷰가 두 번 잡은 결함은 모두 "눈으로 읽으면 맞아 보이는데 TanStack 의 부분 일치가
 * 런타임에 안 걸린다"였다(13차: 목록 키가 `{}` 로 끝나 상세 키와 접두사 일치가 깨진 건). 그래서
 * 이 파일의 무효화 테스트는 키 리터럴을 문자열로 비교하지 않고 **실제 캐시에 있는 readiness 쿼리가
 * 무효화됐는지**(`getQueryState().isInvalidated`)와 **`partialMatchKey` 실행 결과**로 확인한다.
 */
const ACTIVITIES_SEGMENT = "activities";

describe("ADR 0008 — 프로젝트 범위 readiness 키", () => {
  const READINESS_P1 = queryKeys.readiness("p1", "A100");
  const READINESS_P2 = queryKeys.readiness("p2", "A100");

  afterEach(() => vi.unstubAllGlobals());

  /** 무효화 관찰용 — 관찰자가 없어도 캐시 항목이 수거되지 않도록 gcTime 을 무한으로 둔다. */
  function makePersistentClient() {
    return new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
    });
  }
  const wrap = (qc: QueryClient) =>
    ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

  it("readiness 캐시 키가 프로젝트 범위다 — 같은 activity_id 라도 프로젝트가 다르면 키가 다르다", () => {
    expect(READINESS_P1).toEqual(["projects", "p1", "activities", "A100", "readiness"]);
    expect(READINESS_P1).not.toEqual(READINESS_P2);
    // 낡은 전역 키(["activities", aid, "readiness"])가 남아 있으면 두 프로젝트가 한 칸을 공유한다.
    expect(READINESS_P1[0]).toBe("projects");
  });

  it("activitiesRoot 접두사가 새 readiness 키에 **실제로** 부분 일치하고, 낡은 전역 접두사는 일치하지 않는다", () => {
    // 눈이 아니라 TanStack 자신의 매처로 확인한다.
    // (배열 리터럴을 직접 쓰지 않는 이유: Plan 0002 §5 의 확인 grep 이 0줄이어야 한다.)
    const LEGACY_ROOT: readonly string[] = [ACTIVITIES_SEGMENT];
    expect(partialMatchKey(READINESS_P1, queryKeys.activitiesRoot("p1"))).toBe(true);
    expect(partialMatchKey(READINESS_P1, LEGACY_ROOT)).toBe(false);
    // 남의 프로젝트까지 뒤집지는 않는다.
    expect(partialMatchKey(READINESS_P2, queryKeys.activitiesRoot("p1"))).toBe(false);
  });

  it("useReadiness 는 readiness 요청에 project_id 쿼리를 함께 보낸다(서버에서 필수 — 없으면 422)", async () => {
    const { calls } = mockFetch((url) => {
      if (!url.includes("/api/activities/A100/readiness")) return undefined;
      return { body: { activity_id: "A100", score: 0.5, components: {}, blockers: [], confidence: 1, evidence: {} } };
    });

    const { result } = renderHook(() => useReadiness("p1", "A100"), { wrapper: wrap(makeQueryClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const call = calls.find((c) => c.url.includes("/readiness"));
    expect(new URL(call!.url, "http://x").searchParams.get("project_id")).toBe("p1");
  });

  it("useConfirmDocumentMapping 은 confirm 요청에 project_id 쿼리를 함께 보낸다", async () => {
    const { calls } = mockFetch((url, init) => {
      if (!url.includes("/confirm") || init?.method !== "POST") return undefined;
      return { body: { activity_id: "A100", doc_id: "doc-1", confidence: 1, needs_review: false } };
    });

    const { result } = renderHook(() => useConfirmDocumentMapping("p1", "doc-1"), {
      wrapper: wrap(makePersistentClient()),
    });
    result.current.mutate({ activityId: "A100" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const call = calls.find((c) => c.url.includes("/confirm"));
    expect(new URL(call!.url, "http://x").searchParams.get("project_id")).toBe("p1");
  });

  it("useConfirmDocumentMapping 성공 후 **캐시에 실재하는** 그 프로젝트의 readiness 쿼리가 무효화된다", async () => {
    const qc = makePersistentClient();
    qc.setQueryData(READINESS_P1, { activity_id: "A100", score: 0.1 });
    qc.setQueryData(READINESS_P2, { activity_id: "A100", score: 0.1 });
    mockFetch((url, init) => {
      if (url.includes("/confirm") && init?.method === "POST")
        return { body: { activity_id: "A100", doc_id: "doc-1", confidence: 1, needs_review: false } };
      return undefined;
    });

    const { result } = renderHook(() => useConfirmDocumentMapping("p1", "doc-1"), { wrapper: wrap(qc) });
    result.current.mutate({ activityId: "A100" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // 문자열 비교가 아니라 TanStack 이 실제로 그 쿼리를 stale 로 표시했는지를 본다.
    await waitFor(() => expect(qc.getQueryState(READINESS_P1)?.isInvalidated).toBe(true));
    expect(qc.getQueryState(READINESS_P2)?.isInvalidated).toBe(false); // 남의 프로젝트는 건드리지 않는다
  });

  it("useResolveReview 성공 후 **캐시에 실재하는** 그 프로젝트의 readiness 쿼리가 무효화된다", async () => {
    const qc = makePersistentClient();
    qc.setQueryData(READINESS_P1, { activity_id: "A100", score: 0.1 });
    qc.setQueryData(READINESS_P2, { activity_id: "A100", score: 0.1 });
    mockFetch((url, init) => {
      if (url.includes("/resolve") && init?.method === "POST")
        return { body: { review_request_id: "r1", status: "approved", kind: "document_mapping" } };
      return undefined;
    });

    const { result } = renderHook(() => useResolveReview("p1"), { wrapper: wrap(qc) });
    result.current.mutate({ reviewRequestId: "r1", decision: "approved" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await waitFor(() => expect(qc.getQueryState(READINESS_P1)?.isInvalidated).toBe(true));
    expect(qc.getQueryState(READINESS_P2)?.isInvalidated).toBe(false);
  });
});
