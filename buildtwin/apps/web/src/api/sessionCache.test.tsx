import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { queryKeys, useProjects } from "./hooks";
import { installSessionCacheGuard } from "./sessionCache";
import { useStore } from "../store";
import { mockFetch, renderWithProviders, resetStore } from "../test/utils";

/**
 * ADR 0010 규칙 2·3 — 세션 경계에서 캐시를 폐기한다. **트리거는 호출 지점이 아니라 `auth.userId` 의 변화다.**
 *
 * 실측된 결함(ADR 0010 §2): 로그아웃해도 QueryClient 는 그대로라 다른 계정으로 로그인하면 이전
 * 사용자의 프로젝트가 화면에 뜨고, `RequireProjectAccess` 가 그 캐시로 멤버십을 판정해 가드까지 통과했다.
 * 서버가 404 로 존재조차 숨기는 동안(ADR 0006 규칙 2) 화면이 프로젝트 id·이름·역할을 보여 준 것이다.
 *
 * 각 단언마다 §6-2 를 물었다: "이 기대값을 결함 있는 코드가 그대로 만족하는가?"
 *  - 가드가 없으면 → 1·2·3·6 이 죽는다.
 *  - 트리거를 `token` 으로 잡으면 → **음성 대조군 4** 가 죽는다(양성만으로는 구별되지 않는다).
 *  - `clear()` 대신 아무것도 안 하면 → 1 이 죽고, `resetQueries()` 로 바꾸면 → 5 가 죽는다.
 */
const PROJECTS = queryKeys.projects;
const PROJECT_PA = queryKeys.project("PA");

function seed(qc: QueryClient) {
  qc.setQueryData(PROJECTS, [{ project_id: "PA", name: "A사 물류센터", created_at: "2026-01-01" }]);
  qc.setQueryData(PROJECT_PA, { project_id: "PA", name: "A사 물류센터", my_role: "cm" });
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

/** 앱과 같은 방식으로 A 세션을 만든다 — 스토어의 진짜 login() 을 쓴다(가짜 setState 아님). */
function ProjectsProbe() {
  const q = useProjects();
  return <p>{q.data?.[0]?.name ?? "none"}</p>;
}

function loginUser(userId: string, token = `tok-${userId}`) {
  useStore.getState().auth.login({ token, role: "cm", userId });
}

describe("ADR 0010 규칙 2 — 세션 캐시 가드", () => {
  beforeEach(() => resetStore());
  afterEach(() => {
    resetStore();
    vi.unstubAllGlobals();
  });

  it("1. 로그아웃하면(userId → null) 서버 상태가 남지 않는다", () => {
    const qc = makeClient();
    loginUser("userA");
    const off = installSessionCacheGuard(qc);
    seed(qc);
    expect(qc.getQueryData(PROJECTS)).toBeDefined();

    useStore.getState().auth.logout();

    expect(qc.getQueryCache().getAll()).toHaveLength(0);
    expect(qc.getQueryData(PROJECTS)).toBeUndefined();
    expect(qc.getQueryData(PROJECT_PA)).toBeUndefined(); // my_role:"cm" — 인가 가드가 읽던 값
    off();
  });

  it("2. 로그아웃을 거치지 않는 계정 전환(A→B)도 같은 가드가 덮는다", () => {
    const qc = makeClient();
    loginUser("userA");
    const off = installSessionCacheGuard(qc);
    seed(qc);

    loginUser("userB"); // LoginPage 의 setAuth 만 부르는 경로 — logout() 을 거치지 않는다

    expect(qc.getQueryCache().getAll()).toHaveLength(0);
    off();
  });

  it("3. 사용자에 매인 클라이언트 상태(selection · ui 의 현재 자원 id)도 함께 지우고, 화면 취향은 남긴다", () => {
    const qc = makeClient();
    loginUser("userA");
    const off = installSessionCacheGuard(qc);
    const s = useStore.getState();
    s.selection.set("3d", ["GID-A-1"], ["h-A-1"]);
    s.ui.setCurrentProjectId("PA");
    s.ui.setCurrentModelId("M-A");
    s.ui.setCurrentDrawingId("D-A");
    s.ui.setCurrentScanId("S-A");
    s.ui.setCurrentLevel("3F");
    s.ui.setSplitRatio(0.3);
    s.ui.setOverlayOpacity(0.2);

    useStore.getState().auth.logout();

    const after = useStore.getState();
    expect(after.selection.globalIds).toEqual([]);
    expect(after.selection.entityHandles).toEqual([]);
    expect(after.selection.source).toBeNull();
    expect(after.ui.currentProjectId).toBeNull();
    expect(after.ui.currentModelId).toBeNull();
    expect(after.ui.currentDrawingId).toBeNull();
    expect(after.ui.currentScanId).toBeNull();
    expect(after.ui.currentLevel).toBeNull();
    // 의도적으로 남기는 것: 사람의 화면 취향은 사용자가 아니라 브라우저에 매인 값이다(ADR 0010 규칙 3).
    expect(after.ui.splitRatio).toBe(0.3);
    expect(after.ui.overlayOpacity).toBe(0.2);
    off();
  });

  it("4. **음성 대조군** — 같은 사용자가 토큰만 갱신하면(userId 동일) 캐시는 유지된다", () => {
    const qc = makeClient();
    loginUser("userA", "tok-old");
    const off = installSessionCacheGuard(qc);
    seed(qc);
    useStore.getState().selection.set("3d", ["GID-A-1"], ["h-A-1"]);
    useStore.getState().ui.setCurrentProjectId("PA");

    loginUser("userA", "tok-new"); // 토큰 갱신·재로그인 — 신원은 그대로다

    expect(useStore.getState().auth.token).toBe("tok-new");
    // 조건을 token 변화로 잡으면 여기서 캐시가 0 이 된다. 이 줄이 없으면 무조건 clear() 하는 코드도 통과한다.
    expect(qc.getQueryData(PROJECTS)).toBeDefined();
    expect(qc.getQueryData(PROJECT_PA)).toBeDefined();
    expect(qc.getQueryCache().getAll()).toHaveLength(2);
    expect(useStore.getState().selection.globalIds).toEqual(["GID-A-1"]);
    expect(useStore.getState().ui.currentProjectId).toBe("PA");
    off();
  });

  it("5. 로그아웃 순간, **마운트된 쿼리**가 있어도 추가 네트워크 호출이 없다(resetQueries 였다면 401 폭주)", async () => {
    const { calls } = mockFetch((url) => (url.includes("/api/projects") ? { body: [] } : undefined));
    loginUser("userA");
    const qc = makeClient();
    const off = installSessionCacheGuard(qc);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    // 활성 관찰자가 붙어 있는 상태 — resetQueries() 는 바로 이 관찰자를 즉시 재요청시킨다(토큰은 이미 없다).
    const { result } = renderHook(() => useProjects(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const before = calls.length;
    expect(before).toBe(1);

    await act(async () => {
      useStore.getState().auth.logout();
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(calls).toHaveLength(before);
    off();
  });

  it("6. `renderWithProviders` 도 가드를 설치한다 — 웹 테스트가 진짜 경로를 탄다", async () => {
    // 주의(§6-2): `getQueryCache().getAll()` 이 비었다는 단언은 여기서 **결함 코드도 만족한다** —
    // 테스트용 QueryClient 는 gcTime:0 이라 관찰자 없는 항목이 즉시 수거된다. 그래서 실제로 화면이
    // 보고 있는(=관찰자가 붙은) 쿼리의 데이터가 사라졌는지를 센다.
    const { calls } = mockFetch((url) =>
      url.includes("/api/projects") ? { body: [{ project_id: "PA", name: "A사 물류센터" }] } : undefined,
    );
    loginUser("userA");
    const { qc, unsubscribeSessionGuard } = renderWithProviders(<ProjectsProbe />);
    expect(await screen.findByText("A사 물류센터")).toBeInTheDocument();
    expect(qc.getQueryData(PROJECTS)).toBeDefined();
    expect(calls).toHaveLength(1);

    await act(async () => {
      useStore.getState().auth.logout();
      await Promise.resolve();
    });

    // 이 단언이 죽으면 가드가 앱에서만 도는 코드라는 뜻이고, 그때 모든 화면 회귀는 가드 없는 경로를 태운다.
    expect(qc.getQueryData(PROJECTS)).toBeUndefined();
    unsubscribeSessionGuard();
  });

  it("7. `logout()` 은 여전히 QueryClient 를 모른다 — 스토어는 React Query 에 의존하지 않는다", () => {
    // 가드를 설치하지 않은 QueryClient 는 logout() 으로 비워지지 않는다.
    // (스토어가 직접 지우는 안을 택했다면 앱 싱글턴과 테스트 클라이언트가 어긋난다 — ADR 0010 Alternatives 1)
    const orphan = makeClient();
    loginUser("userA");
    seed(orphan);

    useStore.getState().auth.logout();

    expect(orphan.getQueryData(PROJECTS)).toBeDefined();
  });
});
