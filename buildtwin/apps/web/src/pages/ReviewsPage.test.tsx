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

  // 과제 1: 서버가 고쳐진 지금(resolve_review 의 document_mapping 분기), 승인 확인 다이얼로그는
  // 실제로 일어나는 일(매핑 확정)을 약속해야 하고, 반려는 아직 매핑을 건드리지 않는다는 사실을 거짓 없이 알려야 한다.
  it("document_mapping 승인 다이얼로그는 '매핑이 확정된다'고 정확히 말한다 — kind 를 뭉뚱그리지 않는다", async () => {
    resetStore();
    loginAs("cm");
    mockFetch((url) => {
      if (url.includes("/api/projects/p1/review-requests")) return { body: [MAPPING_REVIEW] };
      if (url.endsWith("/api/projects/p1")) return { body: { project_id: "p1", name: "P", my_role: "cm" } };
      return undefined;
    });
    renderPage();
    const user = userEvent.setup();

    await screen.findByTestId("document-mapping-card");
    await user.click(screen.getByRole("button", { name: "승인" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/이 문서 ↔ Activity 매핑이 확정됩니다/)).toBeInTheDocument();
    expect(within(dialog).getByText(/needs_review=False/)).toBeInTheDocument();
  });

  it("document_mapping 반려 다이얼로그는 '매핑은 아직 바뀌지 않는다'고 말한다 — 승인과 같은 문구를 쓰지 않는다", async () => {
    resetStore();
    loginAs("cm");
    mockFetch((url) => {
      if (url.includes("/api/projects/p1/review-requests")) return { body: [MAPPING_REVIEW] };
      if (url.endsWith("/api/projects/p1")) return { body: { project_id: "p1", name: "P", my_role: "cm" } };
      return undefined;
    });
    renderPage();
    const user = userEvent.setup();

    await screen.findByTestId("document-mapping-card");
    await user.click(screen.getByRole("button", { name: "반려" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/매핑 행은 아직 바뀌지 않습니다/)).toBeInTheDocument();
  });

  // 과제 2: DocumentMappingCard 는 문서번호를 보여줘야 CM 이 어느 문서인지 정확히 판단할 수 있다.
  it("문서 행을 조회해 문서번호·종류를 카드에 보여준다", async () => {
    resetStore();
    loginAs("cm");
    mockFetch((url) => {
      if (url.includes("/api/documents/doc-aaa")) {
        return {
          body: {
            document: {
              project_id: "p1", doc_id: "doc-aaa", doc_type: "TFA", sender: "동부건설", sender_normalized: "동부건설",
              title: "1F 기둥 배근도 승인요청", title_normalized: "1f 기둥 배근도 승인요청",
              doc_number: "동부-HG-TFA-전기-26-049", approval_status: "UNKNOWN", approval_confidence: 1.0,
              approval_evidence: { source_type: "document", source_id: "file-1", method: "register_status_blank" },
              file_id: "file-1", sheet_name: "TFA", source_row: 4, needs_review: false, is_orphaned: false,
            },
            mappings: [],
          },
        };
      }
      if (url.includes("/api/projects/p1/review-requests")) return { body: [MAPPING_REVIEW] };
      if (url.endsWith("/api/projects/p1")) return { body: { project_id: "p1", name: "P", my_role: "cm" } };
      return undefined;
    });
    renderPage();

    const card = await screen.findByTestId("document-mapping-card");
    expect(await within(card).findByText(/문서번호 동부-HG-TFA-전기-26-049/)).toBeInTheDocument();
    expect(within(card).getByText(/승인\/검토\/참조 요청서/)).toBeInTheDocument();
  });

  // 과제 3: 확정된 매핑이 재계산으로 무효화되어 재오픈된 요청은 CM 이 "왜 다시 보이는지" 알 수 있어야 한다.
  // 서버는 evidence.extra.invalidated_activity_signature 로 이 상태를 구조적으로 표시한다
  // (services/progress/document_mapper.py `_reopen_reviews_for_invalidated_confirmations`).
  it("재오픈된 검토요청(evidence.extra.invalidated_activity_signature)을 재확인 필요로 구분해 보여준다", async () => {
    resetStore();
    loginAs("cm");
    const REOPENED: ReviewRequest = {
      ...MAPPING_REVIEW,
      review_request_id: "rr-doc-2",
      title: "문서 매핑 재확인 필요: Activity ACT-100 → 동부-HG-TFA-전기-26-049 «1F 기둥 배근도 승인요청» — 확정 이후 Activity 정보가 바뀌어 재계산이 더 이상 이 매핑을 지지하지 않습니다(판별 토큰 불일치 등). 재계산이 매핑을 되돌리지는 않았지만 CM 재확인이 필요합니다.",
      evidence: {
        ...MAPPING_REVIEW.evidence,
        extra: {
          ...MAPPING_REVIEW.evidence.extra,
          invalidated_activity_signature: "9F 기둥 배근|9F||전기|2026-09-01",
          invalidation_reason: "confirmed_mapping_no_longer_a_recompute_candidate",
        },
      },
    };
    mockFetch((url) => {
      if (url.includes("/api/projects/p1/review-requests")) return { body: [REOPENED] };
      if (url.endsWith("/api/projects/p1")) return { body: { project_id: "p1", name: "P", my_role: "cm" } };
      return undefined;
    });
    renderPage();

    const card = await screen.findByTestId("document-mapping-card");
    expect(within(card).getByTestId("reopened-notice")).toBeInTheDocument();
    expect(within(card).getByText(/재확인 필요/)).toBeInTheDocument();
  });

  it("재오픈 표식이 없는 보통의 신규 검토요청에는 재확인 배너를 보여주지 않는다", async () => {
    resetStore();
    loginAs("cm");
    mockFetch((url) => {
      if (url.includes("/api/projects/p1/review-requests")) return { body: [MAPPING_REVIEW] };
      if (url.endsWith("/api/projects/p1")) return { body: { project_id: "p1", name: "P", my_role: "cm" } };
      return undefined;
    });
    renderPage();

    const card = await screen.findByTestId("document-mapping-card");
    expect(within(card).queryByTestId("reopened-notice")).not.toBeInTheDocument();
  });
});
