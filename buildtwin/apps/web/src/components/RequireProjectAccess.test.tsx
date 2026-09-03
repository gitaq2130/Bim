import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
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
