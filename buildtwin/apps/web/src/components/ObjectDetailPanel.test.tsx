import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ObjectDetailPanel } from "./ObjectDetailPanel";
import { objectDetailFixture } from "../test/fixtures";
import type { ProjectRole } from "../api/types";
import { loginAs, mockFetch, renderWithProviders, resetStore } from "../test/utils";

const GID = objectDetailFixture.basic.global_id;

/**
 * ADR 0006: 확정 버튼 등의 게이팅은 이제 이 프로젝트에서의 역할(GET /projects/{id}.my_role)로 정해진다 —
 * 전역 auth.role 이 아니다. `loginAs`는 여전히 토큰/userId 를 채우는 데 쓰지만, 여기 `projectRole` 이
 * ObjectDetailPanel 이 실제로 읽는 값이다. admin 은 항상 my_role=null.
 */
function setup(
  projectRole: ProjectRole | null,
  { transitionStatus = 200, userId, projectId = "p1" }: { transitionStatus?: number; userId?: string; projectId?: string } = {},
) {
  resetStore();
  loginAs(projectRole ?? "admin", userId);
  const m = mockFetch((url, init) => {
    if (url.includes(`/api/objects/${encodeURIComponent(GID)}/transitions`) && init?.method === "POST")
      return transitionStatus === 200
        ? { body: { ...objectDetailFixture.history[0], to_state: "CONFIRMED", actor: "cm" } }
        : { status: transitionStatus, body: { detail: "cm only" } };
    if (url.includes(`/api/objects/${encodeURIComponent(GID)}`)) return { body: objectDetailFixture };
    if (url.endsWith(`/api/projects/${projectId}`)) return { body: { project_id: projectId, name: "P", my_role: projectRole } };
    return undefined;
  });
  const r = renderWithProviders(<ObjectDetailPanel globalId={GID} projectId={projectId} />);
  return { ...r, ...m };
}

describe("ObjectDetailPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetStore();
  });

  it("ObjectDetail 응답 하나로 4탭(기본정보/상태/이력/다음행동)을 채운다", async () => {
    const { calls } = setup("cm");
    const user = userEvent.setup();

    expect(await screen.findByText("C-12", { selector: "strong" })).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["기본정보", "상태", "이력", "다음행동"]);

    // 기본정보
    expect(screen.getByText("IfcColumn")).toBeInTheDocument();
    expect(screen.getByText("1A3F")).toBeInTheDocument();

    // 상태: 스캔 판정은 "완료추정" (절대 "완료" 아님)
    await user.click(screen.getByRole("tab", { name: "상태" }));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("완료추정")).toBeInTheDocument();
    expect(within(panel).queryByText(/^완료$/)).not.toBeInTheDocument();
    expect(within(panel).getAllByText("86%").length).toBeGreaterThan(0);
    // 근거 팝오버
    await user.click(within(panel).getAllByRole("button", { name: "근거" })[0]);
    expect(screen.getByRole("dialog", { name: "근거" })).toHaveTextContent("dr-77");

    // 이력: actor 표시, 최신순 3건
    await user.click(screen.getByRole("tab", { name: "이력" }));
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("시공사");
    expect(items[1]).toHaveTextContent("시스템");
    expect(items[1]).toHaveTextContent("완료추정");

    // 다음행동
    await user.click(screen.getByRole("tab", { name: "다음행동" }));
    expect(await screen.findByRole("button", { name: "확정" })).toBeInTheDocument();

    // GET /objects/{gid} 는 한 번만
    expect(calls.filter((c) => c.url.includes("/api/objects/") && (c.init?.method ?? "GET") === "GET")).toHaveLength(1);
  });

  it("contractor 프로젝트 역할: 확정 버튼이 DOM 에 없고, 자기 역할의 행동만 보인다", async () => {
    setup("contractor");
    const user = userEvent.setup();
    await screen.findByText("C-12", { selector: "strong" });
    await user.click(screen.getByRole("tab", { name: "다음행동" }));
    expect(await screen.findByRole("button", { name: "검측 재요청" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "확정" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "반려(재작업)" })).not.toBeInTheDocument();
  });

  it("admin(my_role=null) 역할: 확정·CM 전용 행동이 렌더되지 않는다 — 어떤 프로젝트에서도 행위 버튼이 없다", async () => {
    setup(null);
    const user = userEvent.setup();
    await screen.findByText("C-12", { selector: "strong" });
    await user.click(screen.getByRole("tab", { name: "다음행동" }));
    expect(await screen.findByText(/수행 가능한 행동이 없습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "확정" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "반려(재작업)" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "검측 재요청" })).not.toBeInTheDocument();
  });

  it("같은 사용자가 A현장에서는 cm, B현장에서는 client — 확정 버튼은 A(cm)에서만 보인다", async () => {
    resetStore();
    loginAs("cm", "user-cross"); // 전역 role 은 이제 확정 버튼 게이팅에 관여하지 않는다 — 프로젝트별 my_role 만 본다
    mockFetch((url, init) => {
      if (url.includes(`/api/objects/${encodeURIComponent(GID)}/transitions`) && init?.method === "POST")
        return { body: { ...objectDetailFixture.history[0], to_state: "CONFIRMED", actor: "cm" } };
      if (url.includes(`/api/objects/${encodeURIComponent(GID)}`)) return { body: objectDetailFixture };
      if (url.endsWith("/api/projects/pA")) return { body: { project_id: "pA", name: "A현장", my_role: "cm" } };
      if (url.endsWith("/api/projects/pB")) return { body: { project_id: "pB", name: "B현장", my_role: "client" } };
      return undefined;
    });
    const user = userEvent.setup();

    const a = renderWithProviders(<ObjectDetailPanel globalId={GID} projectId="pA" />);
    await within(a.container).findByText("C-12", { selector: "strong" });
    await user.click(within(a.container).getByRole("tab", { name: "다음행동" }));
    expect(await within(a.container).findByRole("button", { name: "확정" })).toBeInTheDocument();

    const b = renderWithProviders(<ObjectDetailPanel globalId={GID} projectId="pB" />);
    await within(b.container).findByText("C-12", { selector: "strong" });
    await user.click(within(b.container).getByRole("tab", { name: "다음행동" }));
    await within(b.container).findByText(/수행 가능한 행동이 없습니다/);
    expect(within(b.container).queryByRole("button", { name: "확정" })).not.toBeInTheDocument();
  });

  it("userId 가 없으면 행동 버튼이 비활성화되고 'unknown' 으로 전송하지 않는다", async () => {
    const { calls } = setup("cm", { userId: "" });
    const user = userEvent.setup();
    await screen.findByText("C-12", { selector: "strong" });
    await user.click(screen.getByRole("tab", { name: "다음행동" }));
    const btn = await screen.findByRole("button", { name: "확정" });
    expect(btn).toBeDisabled();
    expect(calls.some((c) => c.init?.method === "POST")).toBe(false);
  });

  it("cm 프로젝트 역할: 확정 버튼 → 확인 다이얼로그 → POST /objects/{gid}/transitions (to_state=CONFIRMED, evidence 포함)", async () => {
    const { calls } = setup("cm");
    const user = userEvent.setup();
    await screen.findByText("C-12", { selector: "strong" });
    await user.click(screen.getByRole("tab", { name: "다음행동" }));
    await user.click(await screen.findByRole("button", { name: "확정" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("CONFIRMED");
    await user.type(within(dialog).getByRole("textbox"), "현장 검측 완료");
    await user.click(within(dialog).getByRole("button", { name: "확정" }));

    expect(await screen.findByRole("status")).toHaveTextContent("확정 전이 요청 완료");
    const post = calls.find((c) => c.init?.method === "POST");
    expect(post?.url).toContain(`/api/objects/${encodeURIComponent(GID)}/transitions`);
    const body = JSON.parse(String(post?.init?.body));
    expect(body.to_state).toBe("CONFIRMED");
    expect(body.evidence).toMatchObject({ source_type: "cm_action", source_id: "user-cm", note: "현장 검측 완료" });
    expect(body.evidence.source_type).not.toBe("daily_report");
    expect((post?.init?.headers as Record<string, string>).Authorization).toBe("Bearer tok-cm");
  });

  it("서버 403 을 화면에 표시한다", async () => {
    setup("cm", { transitionStatus: 403 });
    const user = userEvent.setup();
    await screen.findByText("C-12", { selector: "strong" });
    await user.click(screen.getByRole("tab", { name: "다음행동" }));
    await user.click(await screen.findByRole("button", { name: "확정" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "확정" }));
    expect(await screen.findByRole("status")).toHaveTextContent("403");
  });

  it("GET /objects/{gid} 요청에 project_id 쿼리 파라미터를 함께 보낸다 (ADR 0005)", async () => {
    const { calls } = setup("cm");
    await screen.findByText("C-12", { selector: "strong" });
    const getCall = calls.find((c) => c.url.includes(`/api/objects/${encodeURIComponent(GID)}`) && (c.init?.method ?? "GET") === "GET");
    const u = new URL(getCall!.url, "http://x");
    expect(u.searchParams.get("project_id")).toBe("p1");
  });

  it("서버 409(같은 GlobalId 가 여러 프로젝트에 있음)를 바로 에러로 보여주지 않고 안내 문구로 표시한다", async () => {
    resetStore();
    loginAs("cm");
    // api 에이전트가 병행 구현 중인 계약: 에러 바디에 detail(사람이 읽는 문구) + code(안정 식별자) 가 함께 온다.
    // 아직 반영 전이라면 여기서 code 를 목으로 채워 프런트 분기를 검증한다.
    mockFetch((url) => {
      if (url.includes(`/api/objects/${encodeURIComponent(GID)}`))
        return { status: 409, body: { detail: "ambiguous", code: "ambiguous_global_id" } };
      return undefined;
    });
    renderWithProviders(<ObjectDetailPanel globalId={GID} projectId="p1" />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("여러 프로젝트");
    // 원본 서버 문구("ambiguous") 를 그대로 노출하지 않는다
    expect(alert).not.toHaveTextContent("ambiguous");
  });
});
