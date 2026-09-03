import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import type { ActivityDocumentMapping, Document, DocumentDetail } from "../api/types";
import { loginAs, mockFetch, renderWithProviders, resetStore } from "../test/utils";
import { DocumentDetailPage } from "./DocumentDetailPage";

const DOC: Document = {
  project_id: "p1",
  doc_id: "doc-aaa",
  doc_type: "TFA",
  sender: "동부건설",
  sender_normalized: "동부건설",
  discipline_raw: "전기",
  discipline_normalized: "electrical",
  title: "1F 기둥 배근도 승인요청",
  title_normalized: "1f 기둥 배근도 승인요청",
  doc_number: "동부-HG-TFA-전기-26-049",
  issued_on: "2026-08-01",
  result_raw: "조건부 승인 (도면 일부 수정 요망)\n  - 상세 A구간 재검토",
  approval_status: "APPROVED_WITH_COMMENTS",
  approval_confidence: 0.9,
  approval_evidence: {
    source_type: "document",
    source_id: "file-1",
    method: "register_status_rule",
    rule_id: "DOCST-003",
    note: "조건부 승인 (도면 일부 수정 요망)\n  - 상세 A구간 재검토",
  },
  file_id: "file-1",
  sheet_name: "TFA",
  source_row: 4,
  needs_review: false,
  is_orphaned: false,
  imported_at: "2026-08-30T00:00:00Z",
};

const PENDING_MAPPING: ActivityDocumentMapping = {
  activity_id: "ACT-100",
  doc_id: "doc-aaa",
  confidence: 0.58,
  evidence: {
    source_type: "document",
    source_id: "doc-aaa",
    method: "document_title_match",
    note: DOC.title,
    extra: { title_similarity: 0.4, matched_rules: ["title_similarity", "zone_match"] },
  },
  needs_review: true,
  reviewed_by: null,
};

function detail(mappings: ActivityDocumentMapping[] = [], doc: Document = DOC): DocumentDetail {
  return { document: doc, mappings };
}

function renderPage(docId = "doc-aaa") {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:id/documents/:docId" element={<DocumentDetailPage />} />
    </Routes>,
    { route: `/projects/p1/documents/${docId}` },
  );
}

function mockProjectRole(role: "contractor" | "cm" | "client") {
  return (url: string) => (url.endsWith("/api/projects/p1") ? { body: { project_id: "p1", name: "P", my_role: role } } : undefined);
}

describe("DocumentDetailPage", () => {
  beforeEach(() => {
    resetStore();
    loginAs("cm");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("처리결과 원문(result_raw)을 공백까지 그대로(줄바꿈·들여쓰기 보존) 보여준다", async () => {
    mockFetch((url) => {
      if (url.includes("/api/documents/doc-aaa")) return { body: detail() };
      return mockProjectRole("cm")(url);
    });
    renderPage();

    const pre = await screen.findByTestId("result-raw");
    expect(pre.textContent).toBe("조건부 승인 (도면 일부 수정 요망)\n  - 상세 A구간 재검토");
  });

  it("조건부승인(APPROVED_WITH_COMMENTS)은 승인과 다르게 표시하고 착수 가능 여부를 알 수 없다는 설명을 붙인다", async () => {
    mockFetch((url) => {
      if (url.includes("/api/documents/doc-aaa")) return { body: detail() };
      return mockProjectRole("cm")(url);
    });
    renderPage();

    expect(await screen.findByText("조건부승인")).toBeInTheDocument();
    expect(screen.getByText(/승인으로 간주하지 않습니다/)).toBeInTheDocument();
  });

  it("GET /documents/{doc_id} 에 project_id 쿼리 파라미터를 함께 보낸다 (ADR 0005/0007과 같은 프로젝트 범위 키)", async () => {
    const { calls } = mockFetch((url) => {
      if (url.includes("/api/documents/doc-aaa")) return { body: detail() };
      return mockProjectRole("cm")(url);
    });
    renderPage();
    await screen.findByTestId("result-raw");

    const getCall = calls.find((c) => c.url.includes("/api/documents/doc-aaa"));
    const u = new URL(getCall!.url, "http://x");
    expect(u.searchParams.get("project_id")).toBe("p1");
  });

  it("공란(result_raw=null)이면 '(공란)'을 보여준다 — UNKNOWN을 임의로 다른 텍스트로 지어내지 않는다", async () => {
    mockFetch((url) => {
      if (url.includes("/api/documents/doc-bbb"))
        return { body: detail([], { ...DOC, doc_id: "doc-bbb", result_raw: null, approval_status: "UNKNOWN" }) };
      return mockProjectRole("cm")(url);
    });
    renderPage("doc-bbb");

    const pre = await screen.findByTestId("result-raw");
    expect(pre.textContent).toBe("(공란)");
  });

  // ---- 매핑 검토(ADR 0007 §4) ----

  it("매핑 후보의 confidence·제목유사도·일치 규칙을 팝오버 없이 바로 보여준다", async () => {
    mockFetch((url) => {
      if (url.includes("/api/documents/doc-aaa")) return { body: detail([PENDING_MAPPING]) };
      return mockProjectRole("cm")(url);
    });
    renderPage();

    const row = await screen.findByTestId("mapping-row");
    expect(within(row).getByText("Activity ACT-100")).toBeInTheDocument();
    expect(within(row).getByText(/제목 유사도: 40%/)).toBeInTheDocument();
    expect(within(row).getByText(/title_similarity, zone_match/)).toBeInTheDocument();
    expect(within(row).getByText("검토 대기")).toBeInTheDocument();
  });

  it("cm 만 확정 버튼을 볼 수 있다 — contractor 에게는 확정 버튼이 없다", async () => {
    resetStore();
    loginAs("contractor");
    mockFetch((url) => {
      if (url.includes("/api/documents/doc-aaa")) return { body: detail([PENDING_MAPPING]) };
      return mockProjectRole("contractor")(url);
    });
    renderPage();

    await screen.findByTestId("mapping-row");
    expect(screen.queryByRole("button", { name: "확정" })).not.toBeInTheDocument();
  });

  it("cm 이 확정을 누르면 확인 다이얼로그를 거쳐 POST /documents/mappings/{activity_id}/{doc_id}/confirm 을 호출한다", async () => {
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith("/api/documents/mappings/ACT-100/doc-aaa/confirm") && init?.method === "POST")
        return { body: { ...PENDING_MAPPING, needs_review: false, reviewed_by: "user-cm" } };
      if (url.includes("/api/documents/doc-aaa")) return { body: detail([PENDING_MAPPING]) };
      return mockProjectRole("cm")(url);
    });
    renderPage();
    const user = userEvent.setup();

    await screen.findByTestId("mapping-row");
    await user.click(screen.getByRole("button", { name: "확정" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "확정" }));

    const post = calls.find((c) => c.init?.method === "POST");
    expect(post?.url).toContain("/api/documents/mappings/ACT-100/doc-aaa/confirm");
  });

  it("확정된 매핑은 '확정됨'으로 표시하고 확정 버튼을 다시 보여주지 않는다", async () => {
    mockFetch((url) => {
      if (url.includes("/api/documents/doc-aaa"))
        return { body: detail([{ ...PENDING_MAPPING, needs_review: false, reviewed_by: "user-cm" }]) };
      return mockProjectRole("cm")(url);
    });
    renderPage();

    const row = await screen.findByTestId("mapping-row");
    expect(within(row).getByText("확정됨")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "확정" })).not.toBeInTheDocument();
  });

  it("자동/일괄 확정 버튼은 없다 — '매핑 후보 다시 생성'은 새 제안을 만들 뿐 확정하지 않는다", async () => {
    mockFetch((url) => {
      if (url.includes("/api/documents/doc-aaa")) return { body: detail([PENDING_MAPPING]) };
      return mockProjectRole("cm")(url);
    });
    renderPage();

    await screen.findByTestId("mapping-row");
    expect(screen.queryByRole("button", { name: /일괄/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /자동/ })).not.toBeInTheDocument();
  });
});
