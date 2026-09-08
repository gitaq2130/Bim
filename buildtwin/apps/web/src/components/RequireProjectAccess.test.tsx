import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { queryKeys, useProject } from "../api/hooks";
import { installSessionCacheGuard } from "../api/sessionCache";
import { useStore } from "../store";
import { loginAs, mockFetch, renderWithProviders, resetStore } from "../test/utils";
import { RequireProjectAccess } from "./RequireProjectAccess";

function renderRoute() {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:id" element={<RequireProjectAccess />}>
        <Route index element={<div data-testid="project-content">뷰</div>} />
      </Route>
      <Route path="/projects" element={<div>프로젝트 목록</div>} />
    </Routes>,
    { route: "/projects/p1" },
  );
}

describe("RequireProjectAccess", () => {
  beforeEach(() => resetStore());
  afterEach(() => vi.unstubAllGlobals());

  it("멤버인 프로젝트는 안쪽 라우트를 그대로 렌더한다", async () => {
    mockFetch((url) => {
      if (url.endsWith("/api/projects/p1")) return { body: { project_id: "p1", name: "P1", my_role: "cm" } };
      return undefined;
    });
    loginAs("cm");
    renderRoute();

    expect(await screen.findByTestId("project-content")).toBeInTheDocument();
    expect(screen.queryByTestId("project-access-denied")).not.toBeInTheDocument();
  });

  it("비멤버(404 project_not_found)는 '접근 권한이 없습니다' 패널과 목록 링크를 본다 — 원본 에러 상자가 아니다", async () => {
    mockFetch((url) => {
      if (url.endsWith("/api/projects/p1")) return { status: 404, body: { detail: "not found", code: "project_not_found" } };
      return undefined;
    });
    loginAs("client");
    renderRoute();

    expect(await screen.findByTestId("project-access-denied")).toBeInTheDocument();
    expect(screen.getByText("이 프로젝트에 접근 권한이 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "프로젝트 목록으로 돌아가기" })).toHaveAttribute("href", "/projects");
    expect(screen.queryByTestId("project-content")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("로딩 중에는 접근거부 패널도 콘텐츠도 아닌 중립적인 로딩 상태를 보여준다", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    loginAs("cm");
    renderRoute();

    expect(screen.getByTestId("project-access-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("project-access-denied")).not.toBeInTheDocument();
    expect(screen.queryByTestId("project-content")).not.toBeInTheDocument();
  });

  it("404 가 아닌 다른 에러는 일반 에러 상자로 보여준다(접근거부 패널이 아니다)", async () => {
    mockFetch((url) => {
      if (url.endsWith("/api/projects/p1")) return { status: 500, body: { detail: "server error" } };
      return undefined;
    });
    loginAs("cm");
    renderRoute();

    expect(await screen.findByRole("alert")).toHaveTextContent("server error");
    expect(screen.queryByTestId("project-access-denied")).not.toBeInTheDocument();
  });
});

/**
 * ADR 0010 §2 — **세션 경계를 넘은 인가 가드 우회.** 실측(2026-09-04)에서 가장 무거운 결함이었다.
 *
 * ```
 * [로그아웃 후] projects/PA 캐시: {"project_id":"PA","my_role":"cm"}
 * [B 로그인]  RequireProjectAccess 가 막았는가: false   (1.6초 뒤에도 false)
 *             헤더: … userB (CM)   ← 비멤버 B 가 A 의 역할로 취급된다
 * ```
 *
 * 서버는 후속 요청을 전부 404 로 막으므로 **쓰기는 없다.** 새는 것은 **존재와 역할이라는 사실**이고,
 * ADR 0006 §3 규칙 2 가 403 이 아니라 404 `project_not_found` 를 주기로 한 이유가 정확히 그것이다.
 * 그래서 이 절의 단언은 "요청이 막혔는가"가 아니라 **"B 의 화면이 PA 의 존재와 A 의 역할을 말하는가"** 다.
 *
 * **§6-2 를 이 절 자신에게 물었다.**
 * - *결함 코드가 이 기대값을 그대로 만족하는가?* 아니다. 가드가 없으면 시드된 캐시가 `staleTime` 안이라
 *   **fresh** 이고, 마운트된 `useProject` 는 fresh 한 항목을 다시 받아오지 않는다 → 요청 0건 · Outlet 렌더.
 * - *"조금 기다리면 denied 가 뜬다"로 세우지 않는다*(계획 0004 반증 4). 마운트된 쿼리는 stale 만으로
 *   재요청하지 않고(ADR 0010 §2-1: staleTime 40배를 기다려도 요청 누계 2→2), 가드는 **마운트 시점
 *   1회 판정**이다. 그래서 판정은 **캐시가 fresh 한 그 순간**에 갈려야 한다.
 * - *`clear()` 를 무조건 부르는 코드도 통과하는가?* 아래 음성 대조군이 그것을 막는다. 그 대조군은
 *   **이 절의 양성 단언이 옳은 이유로 통과하는지**도 함께 고정한다: `useProject` 가 마운트마다 무조건
 *   재요청하게 되면 양성은 **가드 없이도** 초록이 되고(그때는 재요청이 판정을 만든 것이다) 대조군만
 *   빨개진다. 둘을 함께 봐야 "가드가 판정을 만들었다"가 성립한다(§6-2 4).
 *
 * 테스트용 `makeQueryClient()`(`gcTime: 0`)를 쓰지 않는 이유도 §6-2 다 — 거기서는 관찰자 없는 항목이
 * 즉시 수거돼 "캐시가 비었다"가 **가드 없이도 참**이 된다(sessionCache 6 이 같은 함정을 적어 두었다).
 * 아래는 운영 진입점과 같은 설정(`main.tsx`: `staleTime: 10_000`)에 `gcTime: Infinity` 를 준다.
 */
describe("세션 경계 — 이전 사용자의 캐시로 인가 가드가 뚫리지 않는다 (ADR 0010 §2)", () => {
  const PA = "PA";
  const A_PROJECT = { project_id: PA, name: "A사 물류센터", my_role: "cm" };
  const guards: (() => void)[] = [];

  beforeEach(() => resetStore()); // 앞 테스트의 세션이 남으면 첫 loginAs 가 이미 세션 전이가 된다
  afterEach(() => {
    guards.splice(0).forEach((off) => off());
    vi.unstubAllGlobals();
    resetStore();
  });

  function makeAppClient() {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 10_000, gcTime: Infinity } },
    });
    guards.push(installSessionCacheGuard(qc));
    return qc;
  }

  /** 가드 아래에서 실제로 새는 값을 화면에 올린다 — 프로젝트 **이름**(존재)과 **my_role**(역할). */
  function AccessProbe() {
    const { id = "" } = useParams();
    const q = useProject(id);
    return (
      <div data-testid="project-content">
        {q.data?.name} · {q.data?.my_role}
      </div>
    );
  }

  function renderGuarded(qc: QueryClient) {
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/projects/${PA}`]}>
          <Routes>
            <Route path={`/projects/:id`} element={<RequireProjectAccess />}>
              <Route index element={<AccessProbe />} />
            </Route>
            <Route path="/projects" element={<div>프로젝트 목록</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  /** 비멤버에게 서버가 주는 유일한 응답(ADR 0006 §3 규칙 2). 요청이 실제로 가야만 이 값이 쓰인다. */
  function mock404() {
    return mockFetch((url) =>
      url.endsWith(`/api/projects/${PA}`)
        ? { status: 404, body: { detail: "not found", code: "project_not_found" } }
        : undefined,
    );
  }

  it("A 가 남긴 fresh 한 멤버십 캐시가 있어도 B 는 막힌다 — PA 의 존재도 A 의 역할도 화면에 새지 않는다", async () => {
    const qc = makeAppClient();
    loginAs("cm", "userA");
    qc.setQueryData(queryKeys.project(PA), A_PROJECT); // A 세션이 채운 그 항목(실측값 그대로)
    expect(qc.getQueryData(queryKeys.project(PA))).toBeDefined();
    const { calls } = mock404();

    useStore.getState().auth.logout();
    loginAs("client", "userB"); // B 는 PA 의 멤버가 아니다
    renderGuarded(qc);

    expect(await screen.findByTestId("project-access-denied")).toBeInTheDocument();
    // 함께 단언한다(§6-2 4): 가드가 막았다 **그리고** A 의 사실이 화면에 남지 않았다.
    expect(screen.queryByTestId("project-content")).not.toBeInTheDocument();
    expect(screen.queryByText(/A사 물류센터/)).not.toBeInTheDocument();
    // 판정의 근거가 캐시가 아니라 서버 응답이라는 것 — 결함 코드에서는 이 요청이 **0건**이었다.
    expect(calls.filter((c) => c.url.endsWith(`/api/projects/${PA}`))).toHaveLength(1);
  });

  it("**음성 대조군** — 같은 사용자가 토큰만 갱신하면 멤버십 캐시가 살아 가드가 요청 없이 통과한다", async () => {
    const qc = makeAppClient();
    loginAs("cm", "userA");
    qc.setQueryData(queryKeys.project(PA), A_PROJECT);
    const { calls } = mock404(); // 재요청이 가면 404 → denied 가 되므로 두 축이 값으로 갈린다

    useStore.getState().auth.login({ token: "tok-new", role: "cm", userId: "userA" }); // 신원은 그대로

    renderGuarded(qc);

    expect(await screen.findByTestId("project-content")).toHaveTextContent("A사 물류센터 · cm");
    expect(screen.queryByTestId("project-access-denied")).not.toBeInTheDocument();
    // 요청 0건 — `clear()` 를 무조건 부르는 구현(계획 0004 반증 5)도, `useProject` 가 마운트마다
    // 무조건 재요청하는 구현(그러면 위 양성이 가드 없이도 통과한다)도 여기서 죽는다.
    expect(calls.filter((c) => c.url.endsWith(`/api/projects/${PA}`))).toHaveLength(0);
  });
});
