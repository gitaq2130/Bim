import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { ReviewsPage } from "../pages/ReviewsPage";
import { DailyReportPage } from "../pages/DailyReportPage";
import { loginAs, mockFetch, renderWithProviders, resetStore } from "../test/utils";
import { RequireRole } from "./RequireRole";

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

  it("contractor 가 cm 전용 검토요청 라우트에 접근하면 '권한 없음' 패널을 보고 검토요청 목록은 렌더되지 않는다", () => {
    loginAs("contractor");
    renderReviewsRoute();

    expect(screen.getByTestId("require-role-denied")).toBeInTheDocument();
    expect(screen.getByText("권한 없음")).toBeInTheDocument();
    expect(screen.getByText(/CM/)).toBeInTheDocument();
    expect(screen.queryByText("검토요청")).not.toBeInTheDocument();
    expect(screen.queryByTestId("review-row")).not.toBeInTheDocument();
    // 뷰어(모두 접근 가능)로 돌아가는 링크를 제공한다
    expect(screen.getByRole("link")).toHaveAttribute("href", "/projects/p1/viewer");
  });

  it("cm 이 검토요청 라우트에 접근하면 목록이 정상 렌더된다", async () => {
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
      return undefined;
    });
    loginAs("cm");
    renderReviewsRoute();

    expect(screen.queryByTestId("require-role-denied")).not.toBeInTheDocument();
    expect(await screen.findByTestId("review-row")).toBeInTheDocument();
    expect(screen.getByText("검토요청")).toBeInTheDocument();
  });

  it("cm 이 시공사 전용 작업일보 라우트에 접근하면 '권한 없음' 패널을 본다", () => {
    loginAs("cm");
    renderDailyReportRoute();

    expect(screen.getByTestId("require-role-denied")).toBeInTheDocument();
    expect(screen.getByText(/시공사/)).toBeInTheDocument();
    expect(screen.queryByText("작업일보")).not.toBeInTheDocument();
  });

  it("contractor 는 작업일보 라우트에 정상 접근한다", () => {
    mockFetch(() => ({ body: { items: [], total: 0 } }));
    loginAs("contractor");
    renderDailyReportRoute();

    expect(screen.queryByTestId("require-role-denied")).not.toBeInTheDocument();
    expect(screen.getByText("작업일보")).toBeInTheDocument();
  });
});
