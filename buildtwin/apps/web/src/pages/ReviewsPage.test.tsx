import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import type { ReviewRequest } from "../api/types";
import { loginAs, mockFetch, renderWithProviders, resetStore } from "../test/utils";
import { ReviewsPage } from "./ReviewsPage";

const MAPPING_REVIEW: ReviewRequest = {
  review_request_id: "rr-doc-1",
  project_id: "p1",
  kind: "document_mapping",
  activity_id: "ACT-100",
  title: "문서↔Activity 매핑 검토: 1F 기둥 배근도 승인요청",
  conflicting_sources: {},
  confidence: 0.62,
  evidence: {
    source_type: "document",
    source_id: "doc-aaa",
    method: "document_title_match",
    note: "1F 기둥 배근도 승인요청",
    extra: { title_similarity: 0.42, matched_rules: ["title_similarity", "level_match"], excluded_by: [] },
  },
  assignee_role: "cm",
  status: "open",
  created_at: "2026-09-01T00:00:00Z",
};

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:id/reviews" element={<ReviewsPage />} />
    </Routes>,
    { route: "/projects/p1/reviews" },
  );
}

describe("ReviewsPage — document_mapping (ADR 0007)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetStore();
  });

  it("매핑 근거(제목유사도·일치 규칙)를 팝오버 뒤에 숨기지 않고 바로 보여주고, 문서 상세로 링크한다", async () => {
    resetStore();
    loginAs("cm");
    mockFetch((url) => {
      if (url.includes("/api/projects/p1/review-requests")) return { body: [MAPPING_REVIEW] };
      if (url.endsWith("/api/projects/p1")) return { body: { project_id: "p1", name: "P", my_role: "cm" } };
      return undefined;
    });
    renderPage();

    const card = await screen.findByTestId("document-mapping-card");
    expect(within(card).getByText(/제목 유사도: 42%/)).toBeInTheDocument();
    expect(within(card).getByText(/title_similarity, level_match/)).toBeInTheDocument();
    const link = within(card).getByRole("link", { name: /1F 기둥 배근도 승인요청/ });
    expect(link).toHaveAttribute("href", "/projects/p1/documents/doc-aaa");
  });

  it("cm 프로젝트 역할만 확정(승인)할 수 있다 — contractor 는 결정 버튼이 없다", async () => {
    resetStore();
    loginAs("contractor");
    mockFetch((url) => {
      if (url.includes("/api/projects/p1/review-requests")) return { body: [MAPPING_REVIEW] };
      if (url.endsWith("/api/projects/p1")) return { body: { project_id: "p1", name: "P", my_role: "contractor" } };
      return undefined;
    });
    renderPage();

    await screen.findByTestId("document-mapping-card");
    expect(screen.queryByRole("button", { name: "승인" })).not.toBeInTheDocument();
  });

  it("cm 이 '승인'을 누르면 확인 다이얼로그를 거쳐 POST resolve 를 호출한다 — 자동 확정 버튼은 없다", async () => {
    resetStore();
    loginAs("cm");
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith("/api/review-requests/rr-doc-1/resolve") && init?.method === "POST") return { body: { ...MAPPING_REVIEW, status: "approved" } };
      if (url.includes("/api/projects/p1/review-requests")) return { body: [MAPPING_REVIEW] };
      if (url.endsWith("/api/projects/p1")) return { body: { project_id: "p1", name: "P", my_role: "cm" } };
      return undefined;
    });
    renderPage();
    const user = userEvent.setup();

    await screen.findByTestId("document-mapping-card");
    // 자동 확정("일괄 확정" 등) 버튼이 없어야 한다 — ADR 0007 안전 규칙을 UI로 우회하지 않는다.
    expect(screen.queryByRole("button", { name: /일괄/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "승인" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "승인" }));

    const post = calls.find((c) => c.init?.method === "POST");
    expect(post?.url).toContain("/api/review-requests/rr-doc-1/resolve");
    const body = JSON.parse(String(post?.init?.body));
    expect(body.decision).toBe("approved");
  });
});
