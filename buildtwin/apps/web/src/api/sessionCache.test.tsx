import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { queryKeys, useLogin, useProjects } from "./hooks";
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
 *  - `removeQueries()` 로 바꾸면 → **8** 이 죽는다. 1·2·6 은 `getQueryCache()` 길이 0 과
 *    `getQueryData(...)` `undefined` 만 보는데 `removeQueries()` 도 그것을 그대로 만족한다(§6-2). ADR 0010
 *    규칙 3 과 `sessionCache.ts` 주석이 **둘 다** "`clear()` 는 뮤테이션 캐시까지 비운다"를 채택 근거로
 *    드는데, 그 근거의 절반이 무보호였다 — 규칙과 그 위반이 같은 커밋에서 함께 태어난 자리다(§6-3 ②).
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

/**
 * 가드 구독은 **모듈 싱글턴 스토어**에 달리므로 해제를 잊으면 뒤 테스트의 `selection`·`ui` 가 조용히
 * 지워진다. 각 테스트 끝의 `off()` 는 **단언이 실패하면 실행되지 않아** 그 순간 파일 전체가 오염된다
 * (실측: MUT-11 을 태웠을 때 8 이 실패하며 그 가드가 살아남아 10 까지 같이 죽였다). 그래서 설치는
 * 여기서만 하고 해제는 afterEach 가 **구조적으로** 보장한다 — `renderWithProviders` 가 언마운트에
 * 해제를 묶는 것과 같은 이유다(§6-2: 실패해도 다음 시나리오의 기대값이 흔들리지 않아야 한다).
 */
const installedGuards: Array<() => void> = [];
function installGuard(qc: QueryClient) {
  const off = installSessionCacheGuard(qc);
  installedGuards.push(off);
  return off;
}

describe("ADR 0010 규칙 2 — 세션 캐시 가드", () => {
  beforeEach(() => resetStore());
  afterEach(() => {
    installedGuards.splice(0).forEach((off) => off());   // resetStore() 보다 먼저 — 남은 가드가 발화하지 않도록
    resetStore();
    vi.unstubAllGlobals();
  });

  it("1. 로그아웃하면(userId → null) 서버 상태가 남지 않는다", () => {
    const qc = makeClient();
    loginUser("userA");
    const off = installGuard(qc);
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
    const off = installGuard(qc);
    seed(qc);

    loginUser("userB"); // LoginPage 의 setAuth 만 부르는 경로 — logout() 을 거치지 않는다

    expect(qc.getQueryCache().getAll()).toHaveLength(0);
    off();
  });

  it("3. 사용자에 매인 클라이언트 상태(selection · ui 의 현재 자원 id)도 함께 지우고, 화면 취향은 남긴다", () => {
    const qc = makeClient();
    loginUser("userA");
    const off = installGuard(qc);
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
    const off = installGuard(qc);
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
    const off = installGuard(qc);
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

  /**
   * 로그인 뮤테이션 한 건을 실제로 태워 뮤테이션 캐시에 남긴다. `useLogin` 을 고른 이유는 그 뮤테이션의
   * `variables` 가 **이전 사용자의 비밀번호**이고 `data` 가 **그 사용자의 access_token** 이라, 세션이
   * 끝난 뒤에도 남아 있으면 안 되는 것이 무엇인지가 값 자체로 드러나기 때문이다(기본 gcTime 5분).
   */
  async function loginMutationInCache(qc: QueryClient) {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useLogin(), { wrapper });
    await act(async () => {
      result.current.mutate({ username: "userA@example.com", password: "pw-of-userA" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    return result;
  }

  const loginMutationFetch = () =>
    mockFetch((url) =>
      url.includes("/auth/login") ? { body: { access_token: "tok-of-userA", role: "cm", user_id: "userA" } } : undefined,
    );

  it("8. 세션 경계에서 **뮤테이션 캐시**도 비운다 — 이전 사용자의 자격 증명·토큰이 남지 않는다", async () => {
    loginMutationFetch();
    loginUser("userA");
    const qc = makeClient();
    const off = installGuard(qc);
    seed(qc);
    await loginMutationInCache(qc);

    // 로그아웃 전 — 이 두 값이 실제로 캐시에 있다는 것부터 고정한다. 없으면 아래 단언은 장식이다(§6-2 1).
    const before = qc.getMutationCache().getAll();
    expect(before).toHaveLength(1);
    expect(before[0].state.variables).toMatchObject({ password: "pw-of-userA" });
    expect(before[0].state.data).toMatchObject({ access_token: "tok-of-userA" });

    await act(async () => {
      useStore.getState().auth.logout();
    });

    // 이 줄이 `clear()` 와 `removeQueries()` 를 가른다. removeQueries() 는 쿼리만 지우고 위 두 값을 남긴다 —
    // 그러면 1·2·6 은 전부 초록인 채 이전 사용자의 비밀번호가 메모리에 계속 있다.
    expect(qc.getMutationCache().getAll()).toHaveLength(0);
    expect(qc.getQueryCache().getAll()).toHaveLength(0); // 쿼리 쪽도 함께여야 의미가 있다(§6-2 4)
    off();
  });

  it("9. **음성 대조군(뮤테이션 축)** — 같은 사용자의 토큰 갱신은 뮤테이션 캐시를 비우지 않는다", async () => {
    loginMutationFetch();
    loginUser("userA", "tok-old");
    const qc = makeClient();
    const off = installGuard(qc);
    await loginMutationInCache(qc);
    expect(qc.getMutationCache().getAll()).toHaveLength(1);

    loginUser("userA", "tok-new"); // 신원은 그대로 — 경계가 아니다

    // 8 만 있으면 "언제나 뮤테이션 캐시를 비운다"도 통과한다. 두 축의 양성·음성을 각각 세운다(§6-2 3).
    expect(qc.getMutationCache().getAll()).toHaveLength(1);
    off();
  });

  it("10. `renderWithProviders` 의 가드는 **언마운트와 함께 해제**된다 — 남은 가드가 공유 스토어를 비우지 않는다", async () => {
    mockFetch((url) => (url.includes("/api/projects") ? { body: [] } : undefined));
    loginUser("userA");
    const { unmount } = renderWithProviders(<ProjectsProbe />);
    expect(await screen.findByText("none")).toBeInTheDocument();

    unmount(); // RTL 자동 cleanup 이 매 테스트 끝에 하는 바로 그 일

    // 해제되지 않으면 아래 세션 전환에서 남은 가드가 **모듈 싱글턴 스토어**를 지운다.
    // (QueryClient 만 보면 무해해 보인다 — 그쪽은 이미 버려진 클라이언트다. 실해는 스토어 쪽에 있다.)
    useStore.getState().selection.set("3d", ["GID-X-1"], ["h-X-1"]);
    useStore.getState().ui.setCurrentProjectId("PX");

    loginUser("userB");

    expect(useStore.getState().selection.globalIds).toEqual(["GID-X-1"]);
    expect(useStore.getState().selection.entityHandles).toEqual(["h-X-1"]);
    expect(useStore.getState().ui.currentProjectId).toBe("PX");
  });

  it("11. **순서 계약** — 렌더 뒤에 로그인하면 그 렌더의 캐시는 가드가 비운다(테스트는 loginAs 를 먼저 부른다)", async () => {
    mockFetch((url) =>
      url.includes("/api/projects") ? { body: [{ project_id: "PA", name: "A사 물류센터" }] } : undefined,
    );
    // 로그인하지 않은 채 렌더 — 가드는 신원 null 을 기준으로 설치된다.
    const { qc } = renderWithProviders(<ProjectsProbe />);
    expect(await screen.findByText("A사 물류센터")).toBeInTheDocument();
    expect(qc.getQueryData(PROJECTS)).toBeDefined();

    await act(async () => {
      loginUser("userA");
      await Promise.resolve();
    });

    // `null → "userA"` 도 세션 경계다. 이 줄은 두 가지를 동시에 막는다:
    //  ① 가드를 "첫 로그인은 건너뛴다"로 약화시켜 위 순서 함정을 없애는 고침(그러면 테스트가 진짜
    //     경로를 타지 않는다 — ADR 0010 Consequences 가 막으려던 바로 그것),
    //  ② 그 함정이 문서화 없이 다음 사람에게 넘어가는 것(utils.tsx 의 호출 순서 주석이 이 줄을 가리킨다).
    expect(qc.getQueryData(PROJECTS)).toBeUndefined();
  });
});
