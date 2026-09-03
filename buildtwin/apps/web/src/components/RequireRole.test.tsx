import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { ReviewsPage } from "../pages/ReviewsPage";
import { DailyReportPage } from "../pages/DailyReportPage";
import { loginAs, mockFetch, renderWithProviders, resetStore } from "../test/utils";
import { RequireRole } from "./RequireRole";

/** GET /api/projects/p1 목 — ADR 0006: RequireRole 이 이 응답의 my_role 로 라우트를 가른다. */
function mockProject(myRole: "contractor" | "cm" | "client" | null) {
  return mockFetch((url) => {
    if (url.includes("/api/projects/p1/review-requests")) return { body: { items: [], total: 0 } };
    if (url.endsWith("/api/projects/p1")) return { body: { project_id: "p1", name: "P1", my_role: myRole } };
    return undefined;
  });
}

function renderReviewsRoute() {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:id/reviews" element={<RequireRole roles={["cm"]} />}>
        <Route index element={<ReviewsPage />} />
      </Route>
    </Routes>,
    { route: "/projects/p1/reviews" },
  );
}

function renderDailyReportRoute() {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:id/daily-report" element={<RequireRole roles={["contractor"]} />}>
        <Route index element={<DailyReportPage />} />
      </Route>
    </Routes>,
    { route: "/projects/p1/daily-report" },
  );
}

describe("RequireRole", () => {
  beforeEach(() => resetStore());
  afterEach(() => vi.unstubAllGlobals());

  it("contractor 프로젝트 역할이 cm 전용 검토요청 라우트에 접근하면 '권한 없음' 패널을 보고 검토요청 목록은 렌더되지 않는다", async () => {
    mockProject("contractor");
    loginAs("contractor"); // 전역 role 은 더 이상 이 판단에 쓰이지 않는다 — project role 목만으로 충분히 가려짐을 확인
    renderReviewsRoute();

    expect(await screen.findByTestId("require-role-denied")).toBeInTheDocument();
    expect(screen.getByText("권한 없음")).toBeInTheDocument();
    expect(screen.getByText(/CM/)).toBeInTheDocument();
    expect(screen.queryByText("검토요청")).not.toBeInTheDocument();
    expect(screen.queryByTestId("review-row")).not.toBeInTheDocument();
    // 뷰어(모두 접근 가능)로 돌아가는 링크를 제공한다
    expect(screen.getByRole("link")).toHaveAttribute("href", "/projects/p1/viewer");
  });

  it("프로젝트 역할 쿼리가 로딩 중일 때는 '권한 없음' 대신 중립적인 로딩 상태를 보여준다", () => {
    // 절대 resolve 되지 않는 fetch — pending 상태를 안정적으로 고정한다(act 경고 없이).
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    loginAs("cm");
    renderReviewsRoute();

    expect(screen.queryByTestId("require-role-denied")).not.toBeInTheDocument();
    expect(screen.getByTestId("require-role-loading")).toBeInTheDocument();
  });

  it("cm 프로젝트 역할이 검토요청 라우트에 접근하면 목록이 정상 렌더된다", async () => {
    mockFetch((url) => {
      if (url.includes("/api/projects/p1/review-requests")) {
        return {
          body: {
            items: [
              {
                review_request_id: "r1",
                project_id: "p1",
                kind: "verification",
                title: "3중 검증 불일치",
                conflicting_sources: {},
                confidence: 0.4,
                evidence: { source_type: "system_logic", source_id: "s1" },
                assignee_role: "cm",
                status: "open",
                created_at: "2026-09-01T00:00:00Z",
              },
            ],
            total: 1,
          },
        };
      }
      if (url.endsWith("/api/projects/p1")) return { body: { project_id: "p1", name: "P1", my_role: "cm" } };
      return undefined;
    });
    loginAs("cm");
    renderReviewsRoute();

    expect(screen.queryByTestId("require-role-denied")).not.toBeInTheDocument();
    expect(await screen.findByTestId("review-row")).toBeInTheDocument();
    expect(screen.getByText("검토요청")).toBeInTheDocument();
  });

  it("client 프로젝트 역할이 시공사 전용 작업일보 라우트에 접근하면 '권한 없음' 패널을 본다", async () => {
    mockProject("client");
    loginAs("client");
    renderDailyReportRoute();

    expect(await screen.findByTestId("require-role-denied")).toBeInTheDocument();
    expect(screen.getByText(/시공사/)).toBeInTheDocument();
    expect(screen.queryByText("작업일보")).not.toBeInTheDocument();
  });

  it("contractor 프로젝트 역할은 작업일보 라우트에 정상 접근한다", async () => {
    mockFetch((url) => {
      if (url.endsWith("/api/projects/p1")) return { body: { project_id: "p1", name: "P1", my_role: "contractor" } };
      return { body: { items: [], total: 0 } };
    });
    loginAs("contractor");
    renderDailyReportRoute();

    await screen.findByText("작업일보");
    expect(screen.queryByTestId("require-role-denied")).not.toBeInTheDocument();
  });

  it("admin(전역 role) 은 프로젝트 역할이 없어(my_role=null) 작업일보/검토요청 어느 쪽도 접근할 수 없다", async () => {
    mockProject(null);
    loginAs("admin");
    renderDailyReportRoute();

    expect(await screen.findByTestId("require-role-denied")).toBeInTheDocument();
    expect(screen.queryByText("작업일보")).not.toBeInTheDocument();
  });
});
