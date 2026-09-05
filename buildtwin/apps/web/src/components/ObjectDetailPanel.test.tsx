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

/**
 * ADR 0011 규칙 3 / CLAUDE.md §6-4 — 확정 다이얼로그 문구는 "CM 이 다음 행동을 고르는 유일한 입력"이다.
 *
 * 옛 문구는 "되돌리려면 **사유가 필요합니다**"라고 말했는데, 실측(ADR 0011 §2)에서 `CONFIRMED→MISMATCH`
 * 가 note 없이 201 로 통과하고 감사 이력에 `note: None` 이 남았다. 되돌리기 **경로**는 실재하므로
 * 거짓인 것은 사유 요건 쪽이다.
 *
 * §6-4 3 대로 **문장을 통째로 베끼지 않는다** — 베끼면 거짓 문구가 계약이 된다. 대신 "그 상황에서
 * 참일 수 없는 말이 없다"를 단언한다: 확정 다이얼로그가 사유 요건을 말한다면, 같은 화면의 되돌리기
 * 다이얼로그가 **실제로** 그것을 강제해야 한다. 두 사실을 함께 단언하므로(§6-2 4) 1단계(문구만 정정)와
 * 3단계(requireNote 도입 후 문구 갱신) 양쪽에서 참이고, 지금의 결함 상태에서만 죽는다.
 */
const NOTE_REQUIRED_CLAIM = /사유(가 필요|가 있어야|를 남겨|를 입력|를 적어| 필수)/;

const confirmedDetail = {
  ...objectDetailFixture,
  basic: { ...objectDetailFixture.basic, state: "CONFIRMED" },
  current_state: { ...objectDetailFixture.current_state, state: "CONFIRMED", actor: "cm", actor_id: "user-cm" },
  next_actions: [
    { kind: "revoke_confirmation", label: "확정 취소", allowed_roles: ["cm"], to_state: "MISMATCH" },
    { kind: "order_rework", label: "재시공 지시", allowed_roles: ["cm"], to_state: "IN_PROGRESS" },
  ],
};

describe("확정 다이얼로그 문구 ↔ 되돌리기의 사유 요건 (ADR 0011)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetStore();
  });

  /** 두 프로젝트를 한 목 안에서 가른다 — 상세 URL 은 같고 project_id 쿼리만 다르다(ADR 0005). */
  function mountBoth() {
    mockFetch((url) => {
      if (url.includes(`/api/objects/${encodeURIComponent(GID)}`)) {
        const pid = new URL(url, "http://x").searchParams.get("project_id");
        return { body: pid === "pRevert" ? confirmedDetail : objectDetailFixture };
      }
      if (url.endsWith("/api/projects/pConfirm")) return { body: { project_id: "pConfirm", name: "P", my_role: "cm" } };
      if (url.endsWith("/api/projects/pRevert")) return { body: { project_id: "pRevert", name: "P", my_role: "cm" } };
      return undefined;
    });
    return {
      confirmPanel: renderWithProviders(<ObjectDetailPanel globalId={GID} projectId="pConfirm" />),
      revertPanel: renderWithProviders(<ObjectDetailPanel globalId={GID} projectId="pRevert" />),
    };
  }

  it("정규식 자기 점검 — 옛 거짓 문장을 실제로 잡는다(안 잡으면 아래 단언이 장식이 된다)", () => {
    expect(NOTE_REQUIRED_CLAIM.test("CM 승인 행위로 기록되며 되돌리려면 사유가 필요합니다.")).toBe(true);
    expect(NOTE_REQUIRED_CLAIM.test("CM 승인 행위로 기록되며, 이 확정은 CM 만 되돌릴 수 있습니다.")).toBe(false);
  });

  it("확정 문구가 사유 요건을 말한다면, 같은 화면의 되돌리기 다이얼로그가 그것을 강제해야 한다", async () => {
    resetStore();
    loginAs("cm");
    const user = userEvent.setup();
    const { confirmPanel, revertPanel } = mountBoth();

    // (1) 확정 다이얼로그의 문구
    const a = confirmPanel.container;
    await within(a).findByText("C-12", { selector: "strong" });
    await user.click(within(a).getByRole("tab", { name: "다음행동" }));
    await user.click(await within(a).findByRole("button", { name: "확정" }));
    const confirmMessage = (await within(a).findByTestId("confirm-message")).textContent ?? "";
    expect(confirmMessage).toContain("CONFIRMED");

    // (2) 같은 화면의 되돌리기 다이얼로그가 사유를 강제하는가
    const b = revertPanel.container;
    await within(b).findByText("C-12", { selector: "strong" });
    await user.click(within(b).getByRole("tab", { name: "다음행동" }));
    await user.click(await within(b).findByRole("button", { name: "확정 취소" }));
    const revertDialog = within(b).getByRole("dialog");
    const revertRequiresNote =
      (within(revertDialog).getByRole("button", { name: "확정 취소" }) as HTMLButtonElement).disabled &&
      /필수/.test(within(revertDialog).getByText(/사유 \/ 메모/).textContent ?? "");

    // 함의: 문구가 요건을 약속하면 화면이 그 요건을 실제로 갖고 있어야 한다.
    expect({ 확정문구가_사유요건을_말한다: NOTE_REQUIRED_CLAIM.test(confirmMessage), 되돌리기가_사유를_강제한다: revertRequiresNote })
      .not.toEqual({ 확정문구가_사유요건을_말한다: true, 되돌리기가_사유를_강제한다: false });
  });
});

/**
 * 계획 0004 작업 3 / ADR 0011 규칙 2 — 되돌리기 다이얼로그의 사유 요건은 **`kind`** 로 갈린다.
 *
 * 왜 이 표 모양인가(§6-2 1: "이 단언의 기대값을, 결함 있는 코드가 그대로 만족하는가?"). CONFIRMED
 * 이탈 두 개만 단언하면 **`to_state` 기준으로 가른 구현도 그대로 통과한다** — 그 둘의 목적지는
 * `MISMATCH`·`IN_PROGRESS` 이고 `to_state` 기준도 그 둘을 잡기 때문이다. 갈리게 하려면 **같은 목적지를
 * 가진 다른 `kind`** 가 표 안에 있어야 한다. 아래 5행은 서버가 CM 에게 실제로 주는 전이 행동 전수이며
 * (`allowed_targets` × `services/progress/state_machine.py::_action_kind`, 2026-09-04 실행), 그중
 * 목적지가 `MISMATCH`/`IN_PROGRESS` 인 것이 5개, 사유가 실제로 필요한 것은 4개다:
 *
 *   revoke_confirmation  CONFIRMED            -> MISMATCH      서버: note 없으면 거부 (ADR 0011)
 *   order_rework         CONFIRMED            -> IN_PROGRESS   서버: note 없으면 거부 (ADR 0011)
 *   reject_inspection    INSPECTION_REQUESTED -> IN_PROGRESS   서버: note 없으면 거부 (ADR 0012)
 *   flag_mismatch        INSPECTION_REQUESTED -> MISMATCH      서버: note 없으면 거부 (ADR 0012)
 *   accept_rework        MISMATCH             -> IN_PROGRESS   서버: note 없어도 통과
 *
 * **뒤 두 행은 ADR 0012 로 뒤집혔다** — 이 표는 2026-09-04 에 "서버: note 없어도 통과"로 그 둘을
 * 고정하고 있었고, 서버 가드가 선 뒤에도 그 문장이 그대로 남아 있었다(계열 (A)). 실측(2026-09-05,
 * `POST /api/objects/{gid}/transitions`): `reject_inspection`·`flag_mismatch` 를 사유 없이 보내면
 * **409 `rejection_reason_required`** 이고 객체 상태·검토요청 모두 그대로다.
 *
 * 즉 아래 표는 화면의 게이트를 **서버 불변식과 나란히** 고정한다. **표가 여전히 `kind` 축과 `to_state`
 * 축을 가르는가 — 그것이 이 표의 존재 이유다.** 가른다: `to_state` 로 가른 구현은 `accept_rework`
 * (MISMATCH→IN_PROGRESS)가 `true` 로 뒤집혀 죽고(→IN_PROGRESS 인 다른 두 행은 `true` 이므로 목적지만
 * 보면 구별되지 않는다), `requireNote` 를 아예 빼면 앞 4행이 `false` 로 뒤집혀 죽는다.
 */
const CM_ACTION_MATRIX = [
  { pid: "pConfirmed", state: "CONFIRMED", kind: "revoke_confirmation", label: "확정 취소", to_state: "MISMATCH", 사유필수: true },
  { pid: "pConfirmed", state: "CONFIRMED", kind: "order_rework", label: "재시공 지시", to_state: "IN_PROGRESS", 사유필수: true },
  { pid: "pInsp", state: "INSPECTION_REQUESTED", kind: "reject_inspection", label: "검측 반려(재작업)", to_state: "IN_PROGRESS", 사유필수: true },
  { pid: "pInsp", state: "INSPECTION_REQUESTED", kind: "flag_mismatch", label: "불일치 판정", to_state: "MISMATCH", 사유필수: true },
  { pid: "pMismatch", state: "MISMATCH", kind: "accept_rework", label: "재작업 인정", to_state: "IN_PROGRESS", 사유필수: false },
] as const;

describe("사유 요건은 to_state 가 아니라 kind 로 갈린다 (ADR 0011 규칙 2 · ADR 0012 규칙 2)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetStore();
  });

  /** 한 목 안에서 project_id 쿼리로 세 패널을 가른다(상세 URL 은 같다 — ADR 0005). */
  function mountMatrix(extraPids: string[] = []) {
    const byPid = new Map<string, (typeof CM_ACTION_MATRIX)[number][]>();
    for (const r of CM_ACTION_MATRIX) byPid.set(r.pid, [...(byPid.get(r.pid) ?? []), r]);
    mockFetch((url) => {
      if (url.includes(`/api/objects/${encodeURIComponent(GID)}`)) {
        const pid = new URL(url, "http://x").searchParams.get("project_id") ?? "";
        const rows = byPid.get(pid) ?? [];
        // 표에 없는 pid 는 픽스처 그대로 — 확정(CONFIRMED 진입) 다이얼로그를 여는 대조군 패널이다.
        if (rows.length === 0) return { body: objectDetailFixture };
        return {
          body: {
            ...objectDetailFixture,
            basic: { ...objectDetailFixture.basic, state: rows[0]?.state },
            current_state: { ...objectDetailFixture.current_state, state: rows[0]?.state, actor: "cm" },
            next_actions: rows.map((r) => ({ kind: r.kind, label: r.label, allowed_roles: ["cm"], to_state: r.to_state })),
          },
        };
      }
      const m = /\/api\/projects\/([^/?]+)$/.exec(url);
      if (m) return { body: { project_id: m[1], name: "P", my_role: "cm" } };
      return undefined;
    });
    const panels = new Map<string, HTMLElement>();
    for (const pid of [...byPid.keys(), ...extraPids])
      panels.set(pid, renderWithProviders(<ObjectDetailPanel globalId={GID} projectId={pid} />).container);
    return panels;
  }

  /** 다이얼로그를 열고 "사유가 강제되는가"를 읽는다 — 라벨의 (필수) 표기와 확인 버튼 잠김을 **함께** 본다. */
  async function opensRequiringNote(root: HTMLElement, label: string, user: ReturnType<typeof userEvent.setup>) {
    await within(root).findByText("C-12", { selector: "strong" });
    await user.click(within(root).getByRole("tab", { name: "다음행동" }));
    await user.click(await within(root).findByRole("button", { name: label }));
    const dialog = within(root).getByRole("dialog");
    const marked = /필수/.test(within(dialog).getByText(/사유 \/ 메모/).textContent ?? "");
    const locked = (within(dialog).getByRole("button", { name: label }) as HTMLButtonElement).disabled;
    expect(marked).toBe(locked); // 표기와 잠김이 어긋나면 어느 쪽도 신뢰할 수 없다
    await user.click(within(dialog).getByRole("button", { name: "취소" }));
    return marked && locked;
  }

  it("CM 이 받는 전이 행동 전수에서, 사유가 강제되는 것은 CONFIRMED 이탈 둘 + 검측 반려 둘이다", async () => {
    resetStore();
    loginAs("cm");
    const user = userEvent.setup();
    const panels = mountMatrix();

    const observed: Record<string, boolean> = {};
    for (const row of CM_ACTION_MATRIX)
      observed[`${row.kind} (${row.state}→${row.to_state})`] = await opensRequiringNote(panels.get(row.pid)!, row.label, user);

    const expected: Record<string, boolean> = {};
    for (const row of CM_ACTION_MATRIX) expected[`${row.kind} (${row.state}→${row.to_state})`] = row.사유필수;
    expect(observed).toEqual(expected);
  });

  it("사유를 채우면 되돌리기 확인 버튼이 열린다 — 요건은 잠금이지 차단이 아니다", async () => {
    resetStore();
    loginAs("cm");
    const user = userEvent.setup();
    const root = mountMatrix().get("pConfirmed")!;

    await within(root).findByText("C-12", { selector: "strong" });
    await user.click(within(root).getByRole("tab", { name: "다음행동" }));
    await user.click(await within(root).findByRole("button", { name: "확정 취소" }));
    const dialog = within(root).getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "확정 취소" }) as HTMLButtonElement;

    expect(confirm.disabled).toBe(true);
    await user.type(within(dialog).getByRole("textbox"), "   "); // 공백만 — 서버 `.strip()` 과 같은 판정
    expect(confirm.disabled).toBe(true);
    await user.type(within(dialog).getByRole("textbox"), "도면 개정으로 재시공 필요");
    expect(confirm.disabled).toBe(false);
  });

  it("확정 다이얼로그 문구는 이제 사유 요건을 말하고, 같은 화면이 실제로 그것을 강제한다", async () => {
    // §6-4 3: 문장을 통째로 베끼지 않는다. "그 상황에서 참일 수 없는 말이 없다"를 단언한다 —
    // 1단계(00f87cd)에서는 이 문구가 사유 요건을 말하면 **거짓**이었고, 3단계인 지금은 말하지 않으면
    // 화면이 실제로 하는 일을 숨기는 것이 된다. 그래서 이 자리에서는 두 값이 **함께 참**이어야 한다(§6-2 4).
    resetStore();
    loginAs("cm");
    const user = userEvent.setup();
    const panels = mountMatrix(["pPlain"]);

    const confirmRoot = panels.get("pPlain")!;
    await within(confirmRoot).findByText("C-12", { selector: "strong" });
    await user.click(within(confirmRoot).getByRole("tab", { name: "다음행동" }));
    await user.click(await within(confirmRoot).findByRole("button", { name: "확정" }));
    const confirmMessage = (await within(confirmRoot).findByTestId("confirm-message")).textContent ?? "";

    expect({
      확정문구가_사유요건을_말한다: NOTE_REQUIRED_CLAIM.test(confirmMessage),
      되돌리기가_사유를_강제한다: await opensRequiringNote(panels.get("pConfirmed")!, "확정 취소", user),
    }).toEqual({ 확정문구가_사유요건을_말한다: true, 되돌리기가_사유를_강제한다: true });
  });
});
