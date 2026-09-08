import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { loginAs, mockFetch, renderWithProviders, resetStore } from "../test/utils";
import { AppLayout } from "./AppLayout";

/**
 * ADR 0006 + 리뷰 6차 지적 3: nav 링크는 프로젝트 역할(my_role) 로 걸러야 하고,
 * App.tsx 의 RequireRole 가드가 막는 라우트로는 링크 자체를 보여주면 안 된다.
 */
function mockProject(myRole: "contractor" | "cm" | "client" | null) {
  return mockFetch((url) => {
    if (url.endsWith("/api/projects/p1")) return { body: { project_id: "p1", name: "P1", my_role: myRole } };
    return undefined;
  });
}

function renderLayout() {
  return renderWithProviders(
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/projects/:id/viewer" element={<div>VIEWER</div>} />
      </Route>
    </Routes>,
    { route: "/projects/p1/viewer" },
  );
}

describe("AppLayout nav", () => {
  beforeEach(() => resetStore());
  afterEach(() => vi.unstubAllGlobals());

  it("contractor: 업로드·작업일보는 보이고 검토요청은 안 보인다", async () => {
    mockProject("contractor");
    loginAs("contractor");
    renderLayout();

    expect(await screen.findByRole("link", { name: "업로드" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "작업일보" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "2D|3D 뷰" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "주간요약" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "검토요청" })).not.toBeInTheDocument();
  });

  it("cm: 업로드·검토요청은 보이고 작업일보는 안 보인다", async () => {
    mockProject("cm");
    loginAs("cm");
    renderLayout();

    expect(await screen.findByRole("link", { name: "업로드" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "검토요청" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "작업일보" })).not.toBeInTheDocument();
  });

  it("client: 서버가 거부할 업로드/작업일보/검토요청 링크를 하나도 보여주지 않는다", async () => {
    mockProject("client");
    loginAs("client");
    renderLayout();

    await screen.findByRole("link", { name: "2D|3D 뷰" });
    expect(screen.queryByRole("link", { name: "업로드" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "작업일보" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "검토요청" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "주간요약" })).toBeInTheDocument();
  });

  it("admin(my_role=null): 행위 링크는 안 보이고 멤버 관리 링크(전역 role 기준)는 보인다", async () => {
    mockProject(null);
    loginAs("admin");
    renderLayout();

    await screen.findByRole("link", { name: "2D|3D 뷰" });
    expect(screen.queryByRole("link", { name: "업로드" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "작업일보" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "검토요청" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "멤버" })).toBeInTheDocument();
  });

  it("프로젝트 역할 로딩 중에는 역할 제한 링크가 하나도 보이지 않는다(깜빡임 방지) — 무제한 링크는 바로 보인다", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    loginAs("contractor");
    renderLayout();

    expect(screen.getByRole("link", { name: "2D|3D 뷰" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "주간요약" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "업로드" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "작업일보" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "검토요청" })).not.toBeInTheDocument();
  });
});
