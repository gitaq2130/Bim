import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { RequireAdmin } from "../components/RequireAdmin";
import { loginAs, mockFetch, renderWithProviders, resetStore } from "../test/utils";
import { ProjectMembersPage } from "./ProjectMembersPage";

/** 실제 App.tsx 라우팅과 동일하게 RequireAdmin 으로 감싼 상태로 렌더한다 — 가드 자체를 검증한다. */
function renderMembersRoute() {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:id/members" element={<RequireAdmin />}>
        <Route index element={<ProjectMembersPage />} />
      </Route>
    </Routes>,
    { route: "/projects/p1/members" },
  );
}

describe("ProjectMembersPage / RequireAdmin", () => {
  beforeEach(() => resetStore());
  afterEach(() => vi.unstubAllGlobals());

  it.each(["cm", "contractor", "client"] as const)(
    "전역 역할이 %s 이면 멤버 화면은 숨겨지고(권한 없음 패널) 멤버 목록/폼은 렌더되지 않는다",
    (role) => {
      mockFetch(() => ({ body: { items: [], total: 0 } }));
      loginAs(role);
      renderMembersRoute();

      expect(screen.getByTestId("require-admin-denied")).toBeInTheDocument();
      expect(screen.queryByTestId("members-table")).not.toBeInTheDocument();
      expect(screen.queryByText("프로젝트 멤버")).not.toBeInTheDocument();
    },
  );

  it("admin 은 멤버 화면에 접근해 목록을 본다", async () => {
    mockFetch((url) => {
      if (url.endsWith("/api/projects/p1/members")) {
        return {
          body: [
            { project_id: "p1", user_id: "user-cm-1", email: "cm1@buildtwin.test", role: "cm", added_by: "admin-1", added_at: "2026-09-01T00:00:00Z" },
          ],
        };
      }
      return undefined;
    });
    loginAs("admin");
    renderMembersRoute();

    expect(screen.queryByTestId("require-admin-denied")).not.toBeInTheDocument();
    const row = await screen.findByTestId("member-row");
    expect(within(row).getByText("user-cm-1")).toBeInTheDocument();
    expect(within(row).getByText("CM")).toBeInTheDocument();
  });

  it("admin 이 사용자 id + 역할로 멤버를 추가하면 POST /projects/{id}/members 를 보낸다", async () => {
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith("/api/projects/p1/members") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        return { status: 201, body: { project_id: "p1", ...body } };
      }
      if (url.endsWith("/api/projects/p1/members")) return { body: [] };
      return undefined;
    });
    loginAs("admin");
    renderMembersRoute();
    const user = userEvent.setup();

    await screen.findByText("멤버가 없습니다.");
    await user.type(screen.getByPlaceholderText("user-xxxx"), "user-new-1");
    await user.selectOptions(screen.getByRole("combobox"), "client");
    await user.click(screen.getByRole("button", { name: "추가" }));

    const post = await vi.waitFor(() => {
      const c = calls.find((c) => c.url.endsWith("/api/projects/p1/members") && c.init?.method === "POST");
      if (!c) throw new Error("no POST yet");
      return c;
    });
    const body = JSON.parse(String(post.init?.body));
    expect(body).toEqual({ user_id: "user-new-1", role: "client" });
  });

  it("admin 이 멤버 행의 '제거' 버튼을 누르면 DELETE /projects/{id}/members/{user_id} 를 보낸다", async () => {
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith("/api/projects/p1/members/user-cm-1") && init?.method === "DELETE") return { status: 204, body: null };
      if (url.endsWith("/api/projects/p1/members"))
        return { body: [{ project_id: "p1", user_id: "user-cm-1", email: null, role: "cm", added_at: "2026-09-01T00:00:00Z" }] };
      return undefined;
    });
    loginAs("admin");
    renderMembersRoute();
    const user = userEvent.setup();

    await screen.findByTestId("members-table");
    await user.click(screen.getByRole("button", { name: "제거" }));

    await vi.waitFor(() => {
      expect(calls.some((c) => c.url.endsWith("/api/projects/p1/members/user-cm-1") && c.init?.method === "DELETE")).toBe(true);
    });
  });
});
