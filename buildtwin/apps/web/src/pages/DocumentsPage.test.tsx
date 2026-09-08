import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import type { Document } from "../api/types";
import { loginAs, mockFetch, renderWithProviders, resetStore } from "../test/utils";
import { DocumentsPage } from "./DocumentsPage";

const DOC_APPROVED: Document = {
  project_id: "p1",
  doc_id: "doc-aaa",
  doc_type: "TFA",
  sender: "동부건설",
  sender_normalized: "동부건설",
  discipline_raw: "전기",
  title: "1F 기둥 배근도 승인요청",
  title_normalized: "1f 기둥 배근도 승인요청",
  doc_number: "동부-HG-TFA-전기-26-049",
  issued_on: "2026-08-01",
  result_raw: "승인",
  approval_status: "APPROVED",
  approval_confidence: 0.95,
  approval_evidence: { source_type: "document", source_id: "file-1", method: "register_status_rule", rule_id: "DOCST-005" },
  file_id: "file-1",
  sheet_name: "TFA",
  source_row: 4,
  needs_review: false,
  is_orphaned: false,
  imported_at: "2026-08-30T00:00:00Z",
};

const DOC_UNKNOWN: Document = {
  ...DOC_APPROVED,
  doc_id: "doc-bbb",
  title: "2F 슬래브 배근도 승인요청",
  doc_number: "동부-HG-TFA-전기-26-050",
  result_raw: "",
  approval_status: "UNKNOWN",
  approval_confidence: 1.0,
  approval_evidence: { source_type: "document", source_id: "file-1", method: "register_status_blank" },
  is_orphaned: true,
};

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:id/documents" element={<DocumentsPage />} />
    </Routes>,
    { route: "/projects/p1/documents" },
  );
}

describe("DocumentsPage", () => {
  beforeEach(() => {
    resetStore();
    loginAs("cm");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("문서 목록을 보여주고 승인/UNKNOWN을 다른 배지로, 고아 문서를 별도 표시한다", async () => {
    mockFetch((url) => {
      if (url.includes("/api/projects/p1/documents")) return { body: { items: [DOC_APPROVED, DOC_UNKNOWN], total: 2 } };
      return undefined;
    });
    renderPage();

    const rows = await screen.findAllByTestId("document-row");
    expect(rows).toHaveLength(2);

    const approvedRow = rows.find((r) => r.getAttribute("data-doc-id") === "doc-aaa")!;
    expect(within(approvedRow).getByText("승인")).toBeInTheDocument();

    const unknownRow = rows.find((r) => r.getAttribute("data-doc-id") === "doc-bbb")!;
    expect(within(unknownRow).getByText("미기재(모름)")).toBeInTheDocument();
    expect(within(unknownRow).queryByText("반려")).not.toBeInTheDocument();
    expect(within(unknownRow).getByText(/orphaned/)).toBeInTheDocument();
  });

  it("종류 필터를 바꾸면 doc_type 쿼리 파라미터로 다시 조회한다", async () => {
    const { calls } = mockFetch((url) => {
      if (url.includes("/api/projects/p1/documents")) return { body: { items: [DOC_APPROVED], total: 1 } };
      return undefined;
    });
    renderPage();
    const user = userEvent.setup();
    await screen.findAllByTestId("document-row");

    await user.selectOptions(screen.getByTestId("doc-type-filter"), "TFA");

    const last = calls[calls.length - 1];
    const u = new URL(last.url, "http://x");
    expect(u.searchParams.get("doc_type")).toBe("TFA");
  });

  it("문서가 없으면 안내 문구를 보여준다", async () => {
    mockFetch((url) => {
      if (url.includes("/api/projects/p1/documents")) return { body: { items: [], total: 0 } };
      return undefined;
    });
    renderPage();
    expect(await screen.findByText("조건에 맞는 문서가 없습니다.")).toBeInTheDocument();
  });
});
