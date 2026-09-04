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
  useCreateDailyReport,
  useObjectDetail,
  useObjects,
  useReadiness,
  useResolveReview,
  useReviewRequests,
  useStartable,
  useWeeklySummary,
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

/**
 * ADR 0010 규칙 1 — 프로젝트 범위 캐시 키는 모두 `["projects", pid, …]` 로 시작한다.
 *
 * **여기 있는 단언은 vitest 전량 초록으로는 대체할 수 없다.** ADR 0010 §5 가 실측한 대로 현행(결함) ·
 * 옳은 고침 · 반쪽 고침(`["objects"]` 를 남겨 무효화가 **완전 무동작**이 되는, 오늘보다 나쁜 상태)
 * 세 상태가 모두 26 files / 233 passed 였다. 그래서 이 절의 테스트는 세 상태를 **구별하도록** 세운다:
 *   - 상세 키만 옮기고 `useResolveReview` 의 리터럴을 남기면 → 목록도 상세도 무효화되지 않는다.
 *   - 리터럴만 바꾸고 상세 키를 남기면 → 목록만 무효화되고 상세는 남는다(오늘의 증상 그대로).
 * 그리고 CLAUDE.md §6-2 / 계획 0004 반증 3: `invalidateQueries` 호출을 스파이로 세지 않는다.
 * 결함 코드도 **호출은 한다** — 세는 것은 그 결과 해당 쿼리가 무효화됐는가(`isInvalidated`)와
 * 실제 재요청이 갔는가다.
 */
describe("ADR 0010 규칙 1 — 객체 캐시 키의 뿌리", () => {
  const GID = "GID-1";
  /**
   * 재루팅 전의 키 모양. 팩토리에서 만들 수 없으므로 여기 고정한다 — 대조군이 없으면
   * "옛 접두사가 아무것에도 안 걸린다"를 셀 수 없다. 배열 리터럴을 문자 그대로 쓰지 않는 이유는
   * 위 ADR 0008 절과 같다(계획 0004 작업 4 의 확인 grep `\["objects"` 이 0줄이어야 한다).
   */
  const OBJECTS_SEGMENT = "objects";
  const LEGACY_DETAIL: readonly string[] = [OBJECTS_SEGMENT, "p1", GID];
  const LEGACY_OBJECTS_ROOT: readonly string[] = [OBJECTS_SEGMENT];

  afterEach(() => vi.unstubAllGlobals());

  function makePersistentClient() {
    return new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
    });
  }
  const wrap = (qc: QueryClient) =>
    ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

  it("상세 키가 프로젝트 접두사 아래로 들어가고, objectsRoot 가 목록·all 변종·상세를 **실제로** 덮는다", () => {
    const detail = queryKeys.objectDetail("p1", GID);
    const list = queryKeys.objects("p1", {});
    const all = [...queryKeys.objects("p1", {}), "all"] as const; // useAllObjects 가 쓰는 키
    const root = queryKeys.objectsRoot("p1");

    expect(detail[0]).toBe("projects");
    // 눈이 아니라 TanStack 자신의 매처로 확인한다(12·13차 리뷰가 두 번 잡은 결함의 모양).
    expect(partialMatchKey(detail, root)).toBe(true);
    expect(partialMatchKey(list, root)).toBe(true);
    expect(partialMatchKey(all, root)).toBe(true);
    // 프로젝트를 뒤집는 무효화 하나가 상세까지 덮는다(옛 키에서는 이 줄이 false 였다).
    expect(partialMatchKey(detail, queryKeys.project("p1"))).toBe(true);
    // 남의 프로젝트는 건드리지 않는다 — ADR 0005 의 복합 키 성질은 그대로다.
    expect(partialMatchKey(queryKeys.objectDetail("p2", GID), root)).toBe(false);
    // 낡은 전역 접두사는 이제 아무것에도 걸리지 않는다 — 남겨 두면 무효화가 조용히 무동작이 된다.
    expect(partialMatchKey(detail, LEGACY_OBJECTS_ROOT)).toBe(false);
    expect(partialMatchKey(list, LEGACY_OBJECTS_ROOT)).toBe(false);
    // 옛 상세 키 모양이 되살아나면(재루팅 되돌림) objectsRoot 가 그것을 못 덮는다.
    expect(partialMatchKey(LEGACY_DETAIL, root)).toBe(false);
  });

  it("useResolveReview(inspection 승인) 후 그 프로젝트의 목록과 상세가 **둘 다** 무효화된다", async () => {
    const qc = makePersistentClient();
    const detail = queryKeys.objectDetail("p1", GID);
    const list = queryKeys.objects("p1", {});
    const otherProjectDetail = queryKeys.objectDetail("p2", GID);
    qc.setQueryData(detail, { basic: { global_id: GID, state: "INSPECTION_REQUESTED" } });
    qc.setQueryData(list, { items: [{ global_id: GID, state: "INSPECTION_REQUESTED" }], total: 1 });
    qc.setQueryData(otherProjectDetail, { basic: { global_id: GID, state: "PLANNED" } });
    mockFetch((url, init) => {
      if (url.includes("/resolve") && init?.method === "POST")
        return { body: { review_request_id: "r1", status: "approved", kind: "inspection", global_id: GID } };
      return undefined;
    });

    const { result } = renderHook(() => useResolveReview("p1"), { wrapper: wrap(qc) });
    result.current.mutate({ reviewRequestId: "r1", decision: "approved" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // 두 사실을 함께 단언한다(§6-2 4): 한쪽만 고정하면 다른 쪽이 사라져도 초록이다.
    await waitFor(() => expect(qc.getQueryState(list)?.isInvalidated).toBe(true));
    expect(qc.getQueryState(detail)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(otherProjectDetail)?.isInvalidated).toBe(false);
  });

  it("검토요청 해소 후 화면에 **마운트된** 목록·상세가 둘 다 재요청된다(요청 누계로 센다)", async () => {
    const qc = makePersistentClient();
    const { calls } = mockFetch((url, init) => {
      if (url.includes("/resolve") && init?.method === "POST")
        return { body: { review_request_id: "r1", status: "approved", kind: "inspection", global_id: GID } };
      if (url.includes(`/api/objects/${GID}`)) return { body: objectDetailFixture };
      if (url.includes("/api/projects/p1/objects")) return { body: { items: [], total: 0 } };
      return undefined;
    });
    const countDetail = () => calls.filter((c) => c.url.includes(`/api/objects/${GID}`)).length;
    const countList = () => calls.filter((c) => c.url.includes("/api/projects/p1/objects")).length;

    // ViewerPage 처럼 목록(3D 색칠)과 상세(패널)를 같은 화면에 띄운 상태를 만든다.
    const { result } = renderHook(
      () => ({ detail: useObjectDetail("p1", GID), list: useObjects("p1"), resolve: useResolveReview("p1") }),
      { wrapper: wrap(qc) },
    );
    await waitFor(() => expect(result.current.detail.isSuccess && result.current.list.isSuccess).toBe(true));
    expect(countDetail()).toBe(1);
    expect(countList()).toBe(1);

    result.current.resolve.mutate({ reviewRequestId: "r1", decision: "approved" });
    await waitFor(() => expect(result.current.resolve.isSuccess).toBe(true));

    // 계획 0004 반증 4: "기다리면 낫는다"로 세우면 안 된다 — 마운트된 쿼리는 stale 만으로 재요청하지
    // 않는다. 여기서 재요청이 오는 유일한 이유는 무효화가 이 두 키에 실제로 걸렸기 때문이다.
    await waitFor(() => expect(countDetail()).toBe(2));
    await waitFor(() => expect(countList()).toBe(2));
  });

  it("작업일보 제출(반대 방향)의 `['projects', pid]` 무효화가 상세까지 덮는다", async () => {
    const qc = makePersistentClient();
    const detail = queryKeys.objectDetail("p1", GID);
    qc.setQueryData(detail, { basic: { global_id: GID, state: "PLANNED" } });
    qc.setQueryData(queryKeys.objectDetail("p2", GID), { basic: { global_id: GID, state: "PLANNED" } });
    mockFetch((url, init) => {
      if (url.includes("/daily-reports") && init?.method === "POST") return { body: { report_id: "dr-1" } };
      return undefined;
    });

    const { result } = renderHook(() => useCreateDailyReport("p1"), { wrapper: wrap(qc) });
    result.current.mutate({ report: { project_id: "p1", work_date: "2026-09-04", items: [] } as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // ADR 0010 §3 실측: 옛 키에서는 목록만 REPORTED 로 바뀌고 상세는 PLANNED 로 남았다.
    await waitFor(() => expect(qc.getQueryState(detail)?.isInvalidated).toBe(true));
    expect(qc.getQueryState(queryKeys.objectDetail("p2", GID))?.isInvalidated).toBe(false);
  });
});

/**
 * ADR 0010 규칙 4 — 대리키(`["drawings", did, …]`)는 프로젝트 접두사를 가질 수 없으므로
 * (ADR 0006 규칙 6) 뮤테이션마다의 **명시적** 무효화가 유일한 수단이다. `drawingMappings` 는
 * 저장소 전체에서 무효화하는 곳이 0곳이었는데, `useResolveReview` 의 `kind=="mapping"` 해소가
 * 서버에서 바로 그 매핑 행을 바꾼다 — CM 이 매핑 검토를 처리한 직후 뷰어의 2D↔3D 연결이 낡은 채 남았다.
 */
describe("ADR 0010 규칙 4 — 매핑 검토 해소와 drawingMappings", () => {
  afterEach(() => vi.unstubAllGlobals());

  function makePersistentClient() {
    return new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
    });
  }
  const wrap = (qc: QueryClient) =>
    ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

  /** 해소 응답 한 건을 흉내낸다. drawing_id 는 sync 가 review_request_for 에서 싣는 값이다. */
  const resolvedReview = (kind: string, drawingId?: string) => ({
    review_request_id: "r1",
    project_id: "p1",
    kind,
    status: "approved",
    conflicting_sources: drawingId
      ? { drawing_id: drawingId, entity_handle: "1A3F", candidate_global_id: "GID-1" }
      : { doc_id: "DOC-1" },
    evidence: { source_type: "cm_action", source_id: "user-cm" },
  });

  async function resolveAndGetState(kind: string, drawingId: string | undefined) {
    const qc = makePersistentClient();
    qc.setQueryData(queryKeys.drawingMappings("D-1"), []);
    qc.setQueryData(queryKeys.drawingMappings("D-2"), []);
    mockFetch((url, init) => {
      if (url.includes("/resolve") && init?.method === "POST") return { body: resolvedReview(kind, drawingId) };
      return undefined;
    });
    const { result } = renderHook(() => useResolveReview("p1"), { wrapper: wrap(qc) });
    result.current.mutate({ reviewRequestId: "r1", decision: "approved" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    return qc;
  }

  it("kind=='mapping' 해소 후 그 도면의 매핑 캐시가 무효화된다", async () => {
    const qc = await resolveAndGetState("mapping", "D-1");
    await waitFor(() => expect(qc.getQueryState(queryKeys.drawingMappings("D-1"))?.isInvalidated).toBe(true));
    // 다른 도면까지 뒤집지는 않는다 — "전부 지운다"로 통과하는 구현을 배제한다.
    expect(qc.getQueryState(queryKeys.drawingMappings("D-2"))?.isInvalidated).toBe(false);
  });

  it("음성 대조군: mapping 이 아닌 해소(document_mapping)는 도면 매핑 캐시를 건드리지 않는다", async () => {
    const qc = await resolveAndGetState("document_mapping", undefined);
    expect(qc.getQueryState(queryKeys.drawingMappings("D-1"))?.isInvalidated).toBe(false);
    expect(qc.getQueryState(queryKeys.drawingMappings("D-2"))?.isInvalidated).toBe(false);
  });
});

/**
 * 작업일보 제출의 **무효화 범위** — 계획 0004 minor 2.
 *
 * 앞 절의 작업일보 테스트는 "`['projects', pid]` 가 **상세**까지 덮는가" 하나만 물었다. 그 축은
 * "내가 떠올린 뮤테이션(상세 키를 놓치는 구현)이 죽는가"였고, 못 묻는 방향은 **떠올리지 않은 뮤테이션**
 * 이었다: 실측으로 무효화를 `objectsRoot(pid)` 로 좁히면 vitest 256건이 **전부 통과**했다. 즉 작업일보
 * 제출 뒤 검토요청·readiness·착수가능·주간요약이 낡은 채 남는 구현이 그물에 걸리지 않았다.
 *
 * 그래서 이 절의 목록은 **내가 떠올린 결함**이 아니라 **곱**으로 만든다(CLAUDE.md §6-1):
 * `POST /projects/{pid}/daily-reports` 가 서버에서 바꾸는 것 × 그 값을 읽는 화면 쿼리 키 전부.
 *
 * 서버 효과(services/api/usecases.py::submit_daily_report → services/progress/state_machine.py::apply_daily_report):
 *   E1 `save_daily_report` — DailyReportRow 저장
 *   E2 `transition_with_effects` — 객체 상태 전이(contractor: → REPORTED / IN_PROGRESS / INSPECTION_REQUESTED)
 *   E3 `run_verification` — 3중 검증 불일치 시 verification ReviewRequest 생성
 *   E4 전이 부수효과 — inspection ReviewRequest 생성(`created_review_ids`)
 *
 * | 캐시 키 | E1 | E2 | E3 | E4 | 그 값을 읽는 자리(실행·인용으로 채운 칸) |
 * |---|---|---|---|---|---|
 * | `objects(pid,q)`        | · | ✓ | · | · | `BimObjectView.state` — 목록이 그리는 상태 |
 * | `objectDetail(pid,gid)` | · | ✓ | ✓ | ✓ | `object_detail()`: `current.state` + `history` + `has_open_review`/`open_review_ids` |
 * | `reviews(pid,·,·)`      | · | · | ✓ | ✓ | `db.open_reviews` — 검토 큐 자체 |
 * | `readiness(pid,aid)`    | · | ✓ | ✓ | ✓ | `predecessor_completion`·`inspection`(객체 상태·미결 inspection), `open_clashes`(미결 verification) |
 * | `startable(pid)`        | · | ✓ | ✓ | ✓ | `compute_startable` → `compute_readiness`(같은 구성요소) |
 * | `weeklySummary(pid)`    | · | ✓ | ✓ | ✓ | `weekly_summary()`: `state_distribution`·`estimated_done_count` + `open_reviews(_by_kind)` + `startable` |
 * | `projects` / `project(pid)` | · | · | · | · | `Project` 는 id·name·my_role 뿐 — 이 뮤테이션이 바꾸는 값이 없다 |
 * | `models`/`drawings`/`scans`/`planSection`/`scanVerdicts`/`members`/`documents*`/`drawing*`/`job` | · | · | · | · | 작업일보가 쓰지 않는 자원 |
 *
 * **이 곱이 놓치는 것(§6-1 ②).** ① E1 을 읽는 화면 쿼리 키가 **하나도 없다** — `GET
 * /projects/{pid}/daily-reports` 는 서버에 있는데 `queryKeys` 에 대응 항목도 훅도 없다(확인:
 * `grep -rn "daily" apps/web/src/api/hooks.ts` → 뮤테이션 한 곳뿐). 그래서 이 표는 "제출한 일보가 목록에
 * 보이는가"를 **영원히 묻지 못한다**. 훅이 생기는 날 이 표에 행을 추가해야 한다. ② 곱의 오른쪽 축은
 * `queryKeys` 팩토리 전수이므로, 팩토리를 거치지 않고 손으로 적은 배열 리터럴 키가 생기면 그 키는 축
 * 밖이다(현재 저장소에는 `["projects", pid, ...]` 형태의 인라인 리터럴만 있고, 전부 위 접두사 아래다).
 *
 * §6-2 를 각 단언에 물었다: 무효화를 `objectsRoot(pid)` 로 좁히면 → reviews·readiness·startable·
 * weeklySummary 네 줄이 죽는다. 반대로 `qc.invalidateQueries()`(전부 무효화)로 만들면 → **음성 대조군**
 * (p2 의 같은 키들)이 죽는다. 어느 한쪽만으로는 두 결함이 구별되지 않는다(§6-2 3).
 */
describe("작업일보 제출의 무효화 범위 — 서버가 바꾸는 것 × 그것을 읽는 키", () => {
  const GID = "GID-1";

  afterEach(() => vi.unstubAllGlobals());

  function makePersistentClient() {
    return new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
    });
  }
  const wrap = (qc: QueryClient) =>
    ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

  /** 위 표에서 ✓ 가 하나라도 있는 키 전부. 이름을 달아 두어 실패 메시지가 어느 칸인지 말하게 한다. */
  const affectedKeys = (pid: string) => ({
    objects: queryKeys.objects(pid, {}),
    objectDetail: queryKeys.objectDetail(pid, GID),
    reviews: queryKeys.reviews(pid),
    readiness: queryKeys.readiness(pid, "A100"),
    startable: queryKeys.startable(pid),
    weeklySummary: queryKeys.weeklySummary(pid),
  });

  it("제출 후 그 프로젝트의 **여섯 키가 모두** 무효화되고, 남의 프로젝트의 같은 여섯 키는 그대로다", async () => {
    const qc = makePersistentClient();
    const p1 = affectedKeys("p1");
    const p2 = affectedKeys("p2");
    for (const key of [...Object.values(p1), ...Object.values(p2)]) qc.setQueryData(key, { seeded: true });
    mockFetch((url, init) => {
      if (url.includes("/daily-reports") && init?.method === "POST") return { body: { report_id: "dr-1" } };
      return undefined;
    });

    const { result } = renderHook(() => useCreateDailyReport("p1"), { wrapper: wrap(qc) });
    result.current.mutate({ report: { project_id: "p1", work_date: "2026-09-04", items: [] } as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // 양성: 표의 ✓ 한 칸마다 한 줄. `invalidateQueries` 호출 횟수가 아니라 **그 쿼리가 stale 로 표시됐는가**를 센다.
    await waitFor(() => expect(qc.getQueryState(p1.objects)?.isInvalidated).toBe(true));
    for (const [name, key] of Object.entries(p1))
      expect(qc.getQueryState(key)?.isInvalidated, `p1.${name} 이 무효화되지 않았다`).toBe(true);
    // 음성 대조군: ADR 0005 의 복합 키 성질 — "전부 지운다"로 통과하는 구현을 배제한다.
    for (const [name, key] of Object.entries(p2))
      expect(qc.getQueryState(key)?.isInvalidated, `p2.${name} 까지 무효화됐다`).toBe(false);
  });

  it("화면에 **마운트된** 검토요청·주간요약·착수가능이 제출 직후 실제로 재요청된다(요청 누계로 센다)", async () => {
    const qc = makePersistentClient();
    const { calls } = mockFetch((url, init) => {
      if (url.includes("/daily-reports") && init?.method === "POST") return { body: { report_id: "dr-1" } };
      if (url.includes("/api/projects/p1/review-requests")) return { body: [] };
      if (url.includes("/api/projects/p1/weekly-summary")) return { body: { project_id: "p1" } };
      if (url.includes("/api/projects/p1/startable")) return { body: { project_id: "p1", startable: [], blocked: [] } };
      return undefined;
    });
    const count = (fragment: string) => calls.filter((c) => c.url.includes(fragment)).length;

    const { result } = renderHook(
      () => ({
        reviews: useReviewRequests("p1"),
        summary: useWeeklySummary("p1"),
        startable: useStartable("p1"),
        create: useCreateDailyReport("p1"),
      }),
      { wrapper: wrap(qc) },
    );
    await waitFor(() =>
      expect(result.current.reviews.isSuccess && result.current.summary.isSuccess && result.current.startable.isSuccess).toBe(true),
    );
    expect([count("review-requests"), count("weekly-summary"), count("startable")]).toEqual([1, 1, 1]);

    result.current.create.mutate({ report: { project_id: "p1", work_date: "2026-09-04", items: [] } as never });
    await waitFor(() => expect(result.current.create.isSuccess).toBe(true));

    // 계획 0004 반증 4 와 같은 이유로 "기다리면 낫는다"에 기대지 않는다 — 마운트된 쿼리는 stale 만으로는
    // 재요청하지 않는다. 여기서 요청이 오는 유일한 이유는 무효화가 이 세 키에 실제로 걸렸기 때문이다.
    await waitFor(() => expect(count("review-requests")).toBe(2));
    await waitFor(() => expect(count("weekly-summary")).toBe(2));
    await waitFor(() => expect(count("startable")).toBe(2));
  });
});
