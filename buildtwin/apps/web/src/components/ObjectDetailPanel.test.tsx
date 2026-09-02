import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ObjectDetailPanel } from "./ObjectDetailPanel";
import { objectDetailFixture } from "../test/fixtures";
import { loginAs, mockFetch, renderWithProviders, resetStore } from "../test/utils";

const GID = objectDetailFixture.basic.global_id;

function setup(role: "cm" | "contractor", transitionStatus = 200) {
  resetStore();
  loginAs(role);
  const m = mockFetch((url, init) => {
    if (url.includes(`/api/objects/${encodeURIComponent(GID)}/transitions`) && init?.method === "POST")
      return transitionStatus === 200
        ? { body: { ...objectDetailFixture.history[0], to_state: "CONFIRMED", actor: "cm" } }
        : { status: transitionStatus, body: { detail: "cm only" } };
    if (url.includes(`/api/objects/${encodeURIComponent(GID)}`)) return { body: objectDetailFixture };
    return undefined;
  });
  const r = renderWithProviders(<ObjectDetailPanel globalId={GID} projectId="p1" />);
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
    expect(screen.getByRole("button", { name: "확정" })).toBeInTheDocument();

    // GET /objects/{gid} 는 한 번만
    expect(calls.filter((c) => c.url.includes("/api/objects/") && (c.init?.method ?? "GET") === "GET")).toHaveLength(1);
  });

  it("contractor 역할: 확정 버튼이 DOM 에 없고, 자기 역할의 행동만 보인다", async () => {
    setup("contractor");
    const user = userEvent.setup();
    await screen.findByText("C-12", { selector: "strong" });
    await user.click(screen.getByRole("tab", { name: "다음행동" }));
    expect(screen.queryByRole("button", { name: "확정" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "반려(재작업)" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "검측 재요청" })).toBeInTheDocument();
  });

  it("cm 역할: 확정 버튼 → 확인 다이얼로그 → POST /objects/{gid}/transitions (to_state=CONFIRMED, evidence 포함)", async () => {
    const { calls } = setup("cm");
    const user = userEvent.setup();
    await screen.findByText("C-12", { selector: "strong" });
    await user.click(screen.getByRole("tab", { name: "다음행동" }));
    await user.click(screen.getByRole("button", { name: "확정" }));

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
    expect((post?.init?.headers as Record<string, string>).Authorization).toBe("Bearer tok-cm");
  });

  it("서버 403 을 화면에 표시한다", async () => {
    setup("cm", 403);
    const user = userEvent.setup();
    await screen.findByText("C-12", { selector: "strong" });
    await user.click(screen.getByRole("tab", { name: "다음행동" }));
    await user.click(screen.getByRole("button", { name: "확정" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "확정" }));
    expect(await screen.findByRole("status")).toHaveTextContent("403");
  });
});
