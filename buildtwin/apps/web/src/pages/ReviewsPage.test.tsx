import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import type { ReviewRequest } from "../api/types";
import { loginAs, mockFetch, renderWithProviders, resetStore } from "../test/utils";
import { ReviewsPage } from "./ReviewsPage";
import { partialMatchKey } from "@tanstack/react-query";
import { queryKeys } from "../api/hooks";

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

/** 이 카드는 useDocument 로 문서 상세(= mappings 포함)를 읽어 매핑 상태를 직접 판정한다(11차 리뷰). */
function docDetail(mapping: Record<string, unknown>) {
  return {
    document: {
      project_id: "p1", doc_id: "doc-aaa", doc_type: "TFA", sender: "동부건설",
      sender_normalized: "동부건설", title: "1F 기둥 배근도 승인요청", title_normalized: "1f 기둥 배근도 승인요청",
      doc_number: "TFA-26-049", approval_status: "APPROVED", approval_confidence: 0.95,
      approval_evidence: { source_type: "document", source_id: "doc-aaa", method: "register_status_rule" },
      file_id: "file-1", sheet_name: "TFA", source_row: 4, needs_review: false, is_orphaned: false,
      imported_at: "2026-08-30T00:00:00Z",
    },
    mappings: [mapping],
  };
}

const baseMapping = {
  activity_id: "ACT-100", doc_id: "doc-aaa", confidence: 0.62,
  evidence: { source_type: "document", source_id: "doc-aaa", method: "document_title_match", note: "t", extra: {} },
};

/** 확정: reviewed_by 가 있고 반려 표시가 없다. */
function confirmedMapping() {
  return { ...baseMapping, needs_review: false, reviewed_by: "user-cm" };
}

/** 반려: needs_review/reviewed_by 는 확정과 **똑같고** evidence 의 표식만 다르다 — 결함의 핵심. */
function rejectedMapping() {
  return {
    ...baseMapping,
    needs_review: false,
    reviewed_by: "user-cm",
    evidence: {
      ...baseMapping.evidence,
      extra: { mapping_review_decision: "rejected", rejected_by: "user-cm", rejection_note: "재확인 결과 무관" },
    },
  };
}

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
      if (url.includes("/api/documents/doc-aaa")) return { body: docDetail(confirmedMapping()) };
      if (url.includes("/api/projects/p1/review-requests")) return { body: [MAPPING_REVIEW] };
      if (url.endsWith("/api/projects/p1")) return { body: { project_id: "p1", name: "P", my_role: "cm" } };
      return undefined;
    });
    renderPage();

    const card = await screen.findByTestId("document-mapping-card");
    expect(within(card).getByText(/제목 유사도: 42%/)).toBeInTheDocument();
    expect(within(card).getByText(/title_similarity, level_match/)).toBeInTheDocument();
    // 링크 라벨은 **문서 행의 제목**이다. evidence.note 는 폴백으로 쓰지 않는다(12차 리뷰) —
    // 확정 시 그 필드가 CM 확정 메모로 덮여 문서 제목 자리에 메모가 뜬다.
    const link = await within(card).findByRole("link", { name: /1F 기둥 배근도 승인요청/ });
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
    const text = within(dialog).getByText(/이 문서 ↔ Activity 매핑이 확정됩니다/).textContent ?? "";
    expect(text).toMatch(/needs_review=False/);
    // 13차 리뷰: 이 자리는 "확정 이후에는 사람만 되돌릴 수 있습니다"라고 약속했는데 **되돌리는 API 가
    // 없다**(문서 매핑 쓰기 경로는 generate 와 confirm 둘뿐). 그 거짓 절을 되돌려도 178건이 전부
    // 통과했으므로(14차 뮤테이션 확인) 문구가 아니라 **약속의 내용**을 고정한다 — 없는 기능을 약속하지
    // 않고, 시스템이 무엇을 하는지만 말해야 한다.
    expect(text).toMatch(/확정을 취소하는 기능은 없습니다/);
    expect(text).not.toMatch(/되돌릴 수 있습니다/);
  });

  // 10차 리뷰: 이 테스트는 원래 "매핑 행은 아직 바뀌지 않습니다"라는 **거짓 문구를 계약으로 고정**하고
  // 있었다. reject_document_mapping 이 매핑 행을 실제로 바꾸고 그 반려가 영구적인데도 화면은 정반대를
  // 말했고, 이 기대값 때문에 웹 테스트 169개가 전부 통과했다. 문구가 아니라 **실제 동작**을 고정한다.
  it("document_mapping 반려 다이얼로그는 반려가 영구적이고 되돌릴 수 없다고 경고한다", async () => {
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
    const text = within(dialog).getByText(/반려하면 이 문서/).textContent ?? "";
    // 되돌릴 수 없다는 경고와, 재업로드해도 다시 제안되지 않는다는 사실이 반드시 있어야 한다.
    expect(text).toMatch(/되돌릴 수 없/);
    expect(text).toMatch(/다시 제안되지 않습니다/);
    // 반대로 "아무것도 바뀌지 않는다"는 취지의 문구가 다시 들어오면 안 된다(원래 결함의 회귀 방지).
    expect(text).not.toMatch(/아직 바뀌지 않습니다/);
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
    // 11차 리뷰: 이 배너는 "매핑 자체는 여전히 확정 상태입니다"를 단언하므로, 재오픈 표식만이 아니라
    // **매핑 행이 실제로 확정인지**까지 확인해야 뜬다. 그래서 문서 조회를 함께 목한다.
    mockFetch((url) => {
      if (url.includes("/api/documents/doc-aaa")) return { body: docDetail(confirmedMapping()) };
      if (url.includes("/api/projects/p1/review-requests")) return { body: [REOPENED] };
      if (url.endsWith("/api/projects/p1")) return { body: { project_id: "p1", name: "P", my_role: "cm" } };
      return undefined;
    });
    renderPage();

    const card = await screen.findByTestId("document-mapping-card");
    expect(await within(card).findByTestId("reopened-notice")).toBeInTheDocument();
    expect(within(card).getByText(/재확인 필요/)).toBeInTheDocument();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 11차 리뷰 — 이 카드가 **반려된** 매핑을 "여전히 확정 상태"라고 단언하던 결함.
  // 10차에서 세운 "판정은 domain/mappingReview 한 곳" 규칙을 화면 세 자리 중 이 자리가 안 따랐다:
  // 검토요청 evidence 의 재오픈 표식 하나만 보고 요청 status 도 매핑 상태도 확인하지 않았다.
  // 도달 경로: CM 이 확정 -> Activity 변경으로 재오픈 -> 그 재확인 요청을 반려 -> 큐에서 상태 필터를
  // "반려"로 바꾸면 그 요청이 그대로 보인다.
  // ══════════════════════════════════════════════════════════════════════════
  it("반려된 매핑의 재오픈 요청에는 '여전히 확정 상태' 배너를 띄우지 않고 반려로 표시한다", async () => {
    resetStore();
    loginAs("cm");
    const REJECTED_REVIEW: ReviewRequest = {
      ...MAPPING_REVIEW,
      status: "rejected",
      evidence: {
        ...MAPPING_REVIEW.evidence,
        extra: {
          ...MAPPING_REVIEW.evidence.extra,
          invalidated_activity_signature: "sig-old",
          invalidation_reason: "confirmed_mapping_no_longer_a_recompute_candidate",
        },
      },
    };
    mockFetch((url) => {
      if (url.includes("/api/documents/doc-aaa")) return { body: docDetail(rejectedMapping()) };
      if (url.includes("/api/projects/p1/review-requests")) return { body: [REJECTED_REVIEW] };
      if (url.endsWith("/api/projects/p1")) return { body: { project_id: "p1", name: "P", my_role: "cm" } };
      return undefined;
    });
    renderPage();

    const card = await screen.findByTestId("document-mapping-card");
    await within(card).findByText(/문서번호/);          // 문서 조회 완료 후에 판정한다(12차 리뷰)
    expect(await within(card).findByTestId("rejected-notice")).toBeInTheDocument();
    expect(within(card).queryByTestId("reopened-notice")).not.toBeInTheDocument();
    expect(within(card).queryByText(/매핑 자체는 여전히 확정 상태입니다/)).not.toBeInTheDocument();
  });

  it("요청이 열려 있어도 매핑이 반려 상태면 재확인 배너를 띄우지 않는다", async () => {
    // 두 게이트(`review.status === "open"`, `mappingState === "confirmed"`)를 **각각** 고정하기 위한
    // 테스트다(12차 리뷰). 앞선 두 테스트는 요청 status 로 이미 걸러지므로 mappingState 게이트를
    // 지워도 통과했다 — 방어를 넣고 그 방어를 고정하지 못하는 것도 이 사이클이 반복한 "통과하는데
    // 죽어 있다"이다. 여기서는 status 게이트를 통과시킨 채(open) 매핑만 반려로 두어 그 게이트만 남긴다.
    //
    // 오늘 서버는 이 조합을 만들지 않는다(_reopen_reviews_for_invalidated_confirmations 가 반려된 행을
    // 건너뛴다). 그래도 고정하는 이유는 서버의 공유 본체 가드와 같다 — 이 배너는 "확정 상태입니다"를
    // 단언하므로, 어떤 경로로 이 조합이 오더라도 단언하지 않아야 한다.
    resetStore();
    loginAs("cm");
    const OPEN_BUT_REJECTED: ReviewRequest = {
      ...MAPPING_REVIEW,
      status: "open",
      evidence: {
        ...MAPPING_REVIEW.evidence,
        extra: { ...MAPPING_REVIEW.evidence.extra, invalidated_activity_signature: "sig-old" },
      },
    };
    mockFetch((url) => {
      if (url.includes("/api/documents/doc-aaa")) return { body: docDetail(rejectedMapping()) };
      if (url.includes("/api/projects/p1/review-requests")) return { body: [OPEN_BUT_REJECTED] };
      if (url.endsWith("/api/projects/p1")) return { body: { project_id: "p1", name: "P", my_role: "cm" } };
      return undefined;
    });
    renderPage();

    const card = await screen.findByTestId("document-mapping-card");
    await within(card).findByText(/문서번호/);
    expect(within(card).queryByTestId("reopened-notice")).not.toBeInTheDocument();
    expect(within(card).getByTestId("rejected-notice")).toBeInTheDocument();
  });

  it("반려 직후 문서 쿼리가 무효화돼 카드가 곧바로 반려 상태로 갱신된다", async () => {
    // 12차 리뷰: 이 카드를 useDocument 에 의존시켰는데 useResolveReview 가 그 쿼리를 무효화하지 않아,
    // CM 이 반려한 **바로 그 순간·그 화면**에서 새 반려 안내가 뜨지 않았다(매핑 상태가 낡은 "확정"으로
    // 남아 reopened 도 rejected 도 아닌 침묵 상태). 되돌릴 수 없는 행위의 결과가 안 보이는 것이므로
    // 실제로 재조회가 일어나는지 요청 수로 고정한다.
    resetStore();
    loginAs("cm");
    let resolved = false;
    let docFetches = 0;
    mockFetch((url) => {
      if (url.includes("/api/documents/doc-aaa")) {
        docFetches += 1;
        return { body: docDetail(resolved ? rejectedMapping() : confirmedMapping()) };
      }
      if (url.includes("/resolve")) {
        resolved = true;
        return { body: { ...MAPPING_REVIEW, status: "rejected" } };
      }
      if (url.includes("/api/projects/p1/review-requests"))
        return { body: [resolved ? { ...MAPPING_REVIEW, status: "rejected" } : MAPPING_REVIEW] };
      if (url.endsWith("/api/projects/p1")) return { body: { project_id: "p1", name: "P", my_role: "cm" } };
      return undefined;
    });
    renderPage();
    const user = userEvent.setup();

    const card = await screen.findByTestId("document-mapping-card");
    await within(card).findByText(/문서번호/);          // 첫 문서 조회 완료
    const before = docFetches;

    await user.click(screen.getByRole("button", { name: "반려" }));
    const dialog = screen.getByRole("dialog");
    // 반려는 사유가 필수다(ConfirmDialog requireNote) — 입력해야 확정 버튼이 활성화된다.
    await user.type(within(dialog).getByRole("textbox"), "재확인 결과 무관");
    await user.click(within(dialog).getByRole("button", { name: "반려" }));

    // 문서 쿼리가 실제로 재조회돼야 하고, 그 결과 반려 안내가 뜬다
    await waitFor(() => expect(docFetches).toBeGreaterThan(before));
    expect(await screen.findByTestId("rejected-notice")).toBeInTheDocument();
  });

  it("요청이 닫혀 있으면(승인 완료) 재오픈 배너를 띄우지 않는다 — 이미 처리된 재확인이다", async () => {
    resetStore();
    loginAs("cm");
    const RESOLVED: ReviewRequest = {
      ...MAPPING_REVIEW,
      status: "approved",
      evidence: {
        ...MAPPING_REVIEW.evidence,
        extra: { ...MAPPING_REVIEW.evidence.extra, invalidated_activity_signature: "sig-old" },
      },
    };
    mockFetch((url) => {
      if (url.includes("/api/documents/doc-aaa")) return { body: docDetail(confirmedMapping()) };
      if (url.includes("/api/projects/p1/review-requests")) return { body: [RESOLVED] };
      if (url.endsWith("/api/projects/p1")) return { body: { project_id: "p1", name: "P", my_role: "cm" } };
      return undefined;
    });
    renderPage();

    const card = await screen.findByTestId("document-mapping-card");
    // **문서 조회 완료를 기다린 뒤에** 검사한다(12차 리뷰). 그 전에는 mappingState 가 undefined 라
    // 배너가 어차피 없어서, `review.status === "open"` 게이트를 지워도 이 테스트가 통과했다 —
    // 방어를 넣고 그 방어를 고정하지 못하는 것도 이 사이클이 반복한 "통과하는데 죽어 있다"이다.
    await within(card).findByText(/문서번호/);
    expect(within(card).queryByTestId("reopened-notice")).not.toBeInTheDocument();
  });

  it("재오픈 표식이 없는 보통의 신규 검토요청에는 재확인 배너를 보여주지 않는다", async () => {
    resetStore();
    loginAs("cm");
    // 확정된 매핑을 목한다 — 매핑이 확정이어도 **재오픈 표식이 없으면** 배너가 없어야 한다는 것이
    // 이 테스트의 주장이다. 문서를 목하지 않으면 mappingState 가 undefined 라 그 주장이 공허해진다.
    mockFetch((url) => {
      if (url.includes("/api/documents/doc-aaa")) return { body: docDetail(confirmedMapping()) };
      if (url.includes("/api/projects/p1/review-requests")) return { body: [MAPPING_REVIEW] };
      if (url.endsWith("/api/projects/p1")) return { body: { project_id: "p1", name: "P", my_role: "cm" } };
      return undefined;
    });
    renderPage();

    const card = await screen.findByTestId("document-mapping-card");
    await within(card).findByText(/문서번호/);          // 문서 조회 완료 후에 판정한다(12차 리뷰)
    expect(within(card).queryByTestId("reopened-notice")).not.toBeInTheDocument();
  });

  it("큐에서 해소하면 주간요약·착수가능·readiness 도 함께 무효화한다 — 전용 확정 훅과 같은 범위", async () => {
    // 12차가 "무효화 범위는 useConfirmDocumentMapping 과 같아야 한다"고 선언했는데, 14차 뮤테이션에서
    // 이 세 줄을 지워도 178건이 전부 통과했다. 두 확정 경로의 범위가 같다는 것은 이 사이클이 서버에서
    // 공유 본체로 강제한 불변식이므로, 화면 쪽도 고정한다.
    resetStore();
    loginAs("cm");
    mockFetch((url, init) => {
      if (url.endsWith("/resolve") && init?.method === "POST") return { body: { ...MAPPING_REVIEW, status: "approved" } };
      if (url.includes("/api/documents/doc-aaa")) return { body: docDetail(confirmedMapping()) };
      if (url.includes("/api/projects/p1/review-requests")) return { body: [MAPPING_REVIEW] };
      if (url.endsWith("/api/projects/p1")) return { body: { project_id: "p1", name: "P", my_role: "cm" } };
      return undefined;
    });
    const { qc } = renderPage();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const user = userEvent.setup();

    await screen.findByTestId("document-mapping-card");
    await user.click(screen.getByRole("button", { name: "승인" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "승인" }));

    const keys = () => spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    await waitFor(() => expect(keys()).toContain(JSON.stringify(["projects", "p1", "weekly-summary"])));
    expect(keys()).toContain(JSON.stringify(["projects", "p1", "startable"]));
    // ADR 0008: 새 readiness 키는 ["projects", pid, "activities", aid, "readiness"] 다.
    // 키 리터럴을 문자열로 비교하면 "눈으로는 맞아 보이는데 런타임 부분 일치가 안 걸리는" 결함
    // (12·13차 리뷰)을 그대로 통과시킨다. TanStack 자신의 매처로 **실행해서** 확인한다.
    const readinessKey = queryKeys.readiness("p1", "A100");
    const invalidated = spy.mock.calls
      .map((c) => c[0]?.queryKey)
      .filter((k): k is readonly unknown[] => Array.isArray(k));
    expect(invalidated.some((k) => partialMatchKey(readinessKey, k))).toBe(true);
    spy.mockRestore();
  });
});
// ════════════════════════════════════════════════════════════════════════════
// ADR 0009 §5-2·§5-3 — `document_identity_drift`(확인 전용 kind).
//
// 이 kind 는 `services/api/usecases.resolve_review` 에 **분기가 없다**(계획 0003 §4 규칙 5가 추가를
// 금지한다). 승인이든 반려든 공통 폴백이 검토요청 status/resolution_note/resolved_by 만 기록하고
// activity_document_mappings 는 한 행도 바뀌지 않는다. 그러므로 화면이 "해소하면 복구된다"는 취지를
// 적으면 그 순간 없는 기능을 약속하는 것이 된다 — 이 저장소가 세 번 겪은 결함이고, 그 중 하나는
// 존재한 적 없는 "되돌리기" 엔드포인트를 약속한 승인 다이얼로그였다.
//
// **경위(`lost_decisions[].cause`)** 는 셋이고 사람이 해야 할 일이 서로 다르다(ADR 0009 §5-2 (마)):
// `row_replaced` 는 그 `doc_id` 가 담고 있던 **대장 행 자체**가 바뀐 것이라 행도 `reviewed_by` 도 살아
// 있고 고아 표시조차 없으며 **다시 판단할 새 doc_id 가 없다**. `row_moved`/`row_absorbed` 는 그 행이
// 다른 `doc_id` 아래에 있으므로 그쪽에서 다시 판단할 수 있다. 셋을 한 목록으로 뭉뚱그리면 CM 은
// `row_replaced` 항목을 "옮겨갔으니 새 doc_id 에서 다시 확정하면 되겠네"로 읽고, 문서 상세를 열기 전까지
// 승인 상태가 뒤집힌 것을 알 수 없다.
//
// **개정 2 — 이 절의 픽스처가 옛 `cause` 이름 셋을 계약으로 고정하고 있었다.** 그 이름들이 관측과
// 어긋난다는 것이 개명의 이유였는데(실측 P3 `is_orphaned=False` 인데 이름은 `orphaned`, R1 `merged=0`
// 인데 이름은 `merge_*`), 옛 이름을 픽스처에 박아 둔 탓에 서버가 이름을 고쳐도 웹 테스트는 전원 초록이고
// 화면만 조용히 어긋난다. 이 저장소는 같은 실패를 이미 겪었다(존재한 적 없는 되돌리기 엔드포인트를
// 약속한 다이얼로그 문구를 169건이 계약으로 고정한 채 전원 통과).
//
// 아래 테스트는 **문구 문자열을 통째로 고정하지 않는다**(그렇게 하면 거짓 문구도 계약이 된다 — 10차
// 리뷰). 대신 약속의 **내용**을 하나씩 따로 고정한다. 각 방어를 **하나씩** 지우면 정확히 그 테스트
// 하나만 실패한다(뮤테이션으로 개별 확인함).
//
// 픽스처의 `title` 은 서버 `document_mapper._identity_drift_review_title` 을 같은 payload 로 **실행해서**
// 받아 적은 실제 출력이다(문구를 상상해 적으면 화면이 서버와 어긋나도 테스트가 통과한다).
// ════════════════════════════════════════════════════════════════════════════

/**
 * 경위가 섞인 적재: 담고 있던 대장 행이 바뀐 판단 1건(`row_replaced`) + 행이 새 doc_id 로 옮겨간 판단
 * 2건(`row_moved`). 식별 표면 config 가 바뀐 경로라 지문이 다르다.
 */
const DRIFT_REVIEW: ReviewRequest = {
  review_request_id: "rr-drift-1",
  project_id: "p1",
  kind: "document_identity_drift",
  title:
    "문서 식별 드리프트: 도면 승인 근거가 뒤집혔습니다 — 문서 1건의 승인 상태가 이번 적재에 달라졌습니다. " +
    "CM 이 판단한 문서 1건이 담고 있던 대장 행이 바뀌었습니다(발신·문서번호가 달라졌습니다). " +
    "CM 판단 1건(확정 1 · 반려 0)이 그 문서에 걸려 있고, 화면의 승인 상태는 CM 이 보고 판단한 그 대장 " +
    "행의 것이 아닙니다. 다시 판단할 새 doc_id 는 없습니다. 또한 대장 행은 그대로인데 우리 식별 규칙이 " +
    "그 행을 새 doc_id 로 옮겼습니다(이번 적재의 이동 2건). CM 판단 2건(확정 1 · 반려 1)이 옛 doc_id 에 " +
    "남아 있습니다 — 옮겨간 새 doc_id 위에서 같은 판단을 다시 확정·반려하십시오 — 확인용 요청입니다" +
    "(매핑은 복구되지 않습니다). 식별 표면 config 가 바뀌었습니다 — 되돌리고 대장을 다시 올리십시오",
  // ADR 0009 §5-2 의 실제 모양(services/progress/document_mapper.open_identity_drift_review).
  // 3축(신고/스캔/논리)은 **아예 없다**.
  conflicting_sources: {
    previous_fingerprint: "aaaaaaaaaaaaaaaa",
    current_fingerprint: "bbbbbbbbbbbbbbbb",
    moved: [
      { previous_doc_id: "doc-v1-old1", new_doc_id: "doc-v1-new1", title: "1F 기둥 배근도 승인요청" },
      { previous_doc_id: "doc-v1-old2", new_doc_id: "doc-v1-new2", title: "2F 기둥 배근도 승인요청" },
    ],
    merged: [],
    // `cause` 는 services/ingest/persistence._CAUSE_ROW_* 값이다. 목록 순서를 일부러 "위험한 것이 뒤"로
    // 둔다 — 화면이 스스로 위험 순으로 다시 세우는지 확인하기 위해서다.
    lost_decisions: [
      {
        activity_id: "A100", doc_id: "doc-v1-old1", decision: "confirmed", cause: "row_moved",
        new_doc_id: "doc-v1-new1", changed_fields: [], approval_flipped: false,
      },
      {
        activity_id: "A400", doc_id: "doc-v1-old2", decision: "rejected", cause: "row_moved",
        new_doc_id: "doc-v1-new2", changed_fields: [], approval_flipped: false,
      },
      {
        activity_id: "A300", doc_id: "doc-v1-live1", decision: "confirmed", cause: "row_replaced",
        new_doc_id: null, changed_fields: ["sender", "doc_number"], approval_flipped: true,
      },
    ],
  },
  confidence: 1.0,
  evidence: {
    source_type: "document",
    source_id: "file-register-2",
    method: "identity_surface_drift",
    note: "DOCUMENT_IDENTITY_DRIFT",
    extra: { moved_count: 2, merged_count: 0, lost_decision_count: 3 },
  },
  assignee_role: "cm",
  status: "open",
  created_at: "2026-09-04T00:00:00Z",
};

/**
 * ADR 0009 §5-2 (바) R1 + P11 의 모양(사명 변경 주: 별칭표 통합 한 줄 + 대장에서 옛 법인명 행이 빠짐).
 * **`moved` 도 `merged` 도 비어 있다** — 개정 1 이 이 적재에서 통째로 침묵했던 그 자리다.
 * 여기서 화면이 "고아가 됐다"거나 "병합됐다"고 적으면 그 문장이 곧 거짓이다(실측 `merged=0`).
 */
const REPLACED_ONLY_DRIFT_REVIEW: ReviewRequest = {
  ...DRIFT_REVIEW,
  review_request_id: "rr-drift-2",
  title:
    "문서 식별 드리프트: 도면 승인 근거가 뒤집혔습니다 — 문서 1건의 승인 상태가 이번 적재에 달라졌습니다. " +
    "CM 이 판단한 문서 1건이 담고 있던 대장 행이 바뀌었습니다(발신가 달라졌습니다). CM 판단 1건" +
    "(확정 1 · 반려 0)이 그 문서에 걸려 있고, 화면의 승인 상태는 CM 이 보고 판단한 그 대장 행의 것이 " +
    "아닙니다. 다시 판단할 새 doc_id 는 없습니다. 또한 CM 판단 1건(확정 0 · 반려 1)이 가리키던 대장 행 " +
    "1건이 지금은 다른 문서(doc_id 1건) 아래에 있고, 이 doc_id 에는 대장 행이 남지 않았습니다. " +
    "그 doc_id 위에서 다시 판단하십시오 — 확인용 요청입니다(매핑은 복구되지 않습니다). " +
    "식별 표면 config 가 바뀌었습니다 — 되돌리고 대장을 다시 올리십시오",
  conflicting_sources: {
    previous_fingerprint: "cccccccccccccccc",
    current_fingerprint: "dddddddddddddddd",
    moved: [],
    merged: [],
    lost_decisions: [
      {
        activity_id: "A300", doc_id: "doc-v1-live1", decision: "confirmed", cause: "row_replaced",
        new_doc_id: null, changed_fields: ["sender"], approval_flipped: true,
      },
      {
        activity_id: "A500", doc_id: "doc-v1-gone1", decision: "rejected", cause: "row_absorbed",
        new_doc_id: "doc-v1-live1", changed_fields: [], approval_flipped: false,
      },
    ],
  },
};

/**
 * ADR 0009 §5-2 (바) P3 — 워크북 **시트명**을 바꾼 적재. config 는 한 글자도 바뀌지 않았으므로
 * **지문이 같다**(`fingerprint_changed=False`). 여기서 화면이 "config 를 되돌리십시오"라고 적으면
 * CM 은 바뀐 적 없는 config 를 뒤진다.
 */
const SHEET_RENAME_DRIFT_REVIEW: ReviewRequest = {
  ...DRIFT_REVIEW,
  review_request_id: "rr-drift-4",
  title:
    "문서 식별 드리프트: 대장 행은 그대로인데 우리 식별 규칙이 그 행을 새 doc_id 로 옮겼습니다" +
    "(이번 적재의 이동 1건). CM 판단 1건(확정 1 · 반려 0)이 옛 doc_id 에 남아 있습니다 — 옮겨간 새 " +
    "doc_id 위에서 같은 판단을 다시 확정하십시오 — 확인용 요청입니다(매핑은 복구되지 않습니다). " +
    "식별 표면 config 는 그대로입니다(지문 동일) — 대장 파일 쪽 입력(워크북 시트명 등)이 바뀌지 " +
    "않았는지 확인하십시오",
  conflicting_sources: {
    previous_fingerprint: "eeeeeeeeeeeeeeee",
    current_fingerprint: "eeeeeeeeeeeeeeee",
    moved: [{ previous_doc_id: "doc-v1-old9", new_doc_id: "doc-v1-new9", title: "3F 슬래브 배근도 승인요청" }],
    merged: [],
    lost_decisions: [
      {
        activity_id: "A900", doc_id: "doc-v1-old9", decision: "confirmed", cause: "row_moved",
        new_doc_id: "doc-v1-new9", changed_fields: [], approval_flipped: false,
      },
    ],
  },
};

/**
 * ADR 0009 §5-2 (바) P6·P7·FP1·P8b — 대장이 **같은 행**의 표기를 스스로 고친 적재(발신 정정 등).
 * `approval_flipped=False`, `drawing_approval` 0.0 → 0.0, `is_orphaned=False`. `row_replaced` 판정은
 * 그대로 서지만(§5-2 (바)가 오탐을 남기기로 한 그 자리다), **승인 상태 값은 CM 이 판단할 때와 같다** —
 * 여기서 화면이 "네가 본 승인 상태는 그 대장 행의 것이 아니다"라고 적으면 거짓이고, "승인 상태부터
 * 확인하십시오"라고 적으면 오탐의 대가가 "부수효과 없는 확인 요청 1건"에서 "CM 의 도면 재확인 1회"로
 * 커져 그 결정의 전제가 무너진다. `title` 은 서버가 이 입력에 실제로 만든 문장이다(`132d116`).
 */
const SELF_CORRECTED_DRIFT_REVIEW: ReviewRequest = {
  ...DRIFT_REVIEW,
  review_request_id: "rr-drift-6",
  title:
    "문서 식별 드리프트: CM 이 판단한 문서 1건이 담고 있던 대장 행이 바뀌었습니다(발신이 달라졌습니다). " +
    "CM 판단 1건(확정 1 · 반려 0)이 그 문서에 걸려 있고, 승인 상태 값 자체는 CM 이 판단할 때와 같습니다 — " +
    "달라진 것은 이 doc_id 가 담고 있는 대장 원문이고, 대장이 같은 행을 고쳐 적은 것인지 다른 행으로 " +
    "바뀐 것인지는 이번 적재의 값으로 가릴 수 없습니다. 다시 판단할 새 doc_id 는 없습니다 — 확인용 " +
    "요청입니다(매핑은 복구되지 않습니다). 식별 표면 config 가 바뀌었습니다 — 되돌리고 대장을 다시 올리십시오",
  conflicting_sources: {
    previous_fingerprint: "7777777777777777",
    current_fingerprint: "8888888888888888",
    moved: [],
    merged: [],
    lost_decisions: [
      {
        activity_id: "A310", doc_id: "doc-v1-live2", decision: "confirmed", cause: "row_replaced",
        new_doc_id: null, changed_fields: ["sender"], approval_flipped: false,
      },
    ],
  },
};

/**
 * ADR 0009 §5-2 (바) P13b — 행-정체가 같은 두 행의 처리결과가 `반려`/`부적합` 이라 **둘 다 `REJECTED`**.
 * (나-ii)로만 걸려 `changed_fields=[]` 이고 `approval_flipped=False` 다. 즉 달라진 것은 **처리결과 표기
 * 하나뿐**이고 승인 상태는 한 글자도 움직이지 않았다 — 여기서 "처리결과·승인 상태가 달라졌습니다"라고
 * 적으면 CM 은 자기 승인 근거가 움직였다고 읽는다. `title` 은 서버 실제 출력(`132d116`).
 */
const RESULT_ONLY_DRIFT_REVIEW: ReviewRequest = {
  ...DRIFT_REVIEW,
  review_request_id: "rr-drift-7",
  title:
    "문서 식별 드리프트: CM 이 판단한 문서 1건은 대장 원문(발신·문서번호·번호·제목)이 그대로인데, 그 " +
    "doc_id 가 담은 처리결과 표기가 달라졌습니다. CM 판단 1건(확정 0 · 반려 1)이 그 문서에 걸려 있고, " +
    "승인 상태 값은 CM 이 판단할 때와 같습니다. 다시 판단할 새 doc_id 는 없습니다 — 확인용 요청입니다" +
    "(매핑은 복구되지 않습니다). 식별 표면 config 는 그대로입니다(지문 동일) — 대장 파일 쪽 입력" +
    "(워크북 시트명 등)이 바뀌지 않았는지 확인하십시오",
  conflicting_sources: {
    previous_fingerprint: "9999999999999999",
    current_fingerprint: "9999999999999999",
    moved: [],
    merged: [],
    lost_decisions: [
      {
        activity_id: "A320", doc_id: "doc-v1-live3", decision: "rejected", cause: "row_replaced",
        new_doc_id: null, changed_fields: [], approval_flipped: false,
      },
    ],
  },
};

/**
 * 이 화면이 **모르는** 경위. 서버가 새 경위를 추가했는데 화면이 따라오지 못한 경우다. 서버도 이 경우를
 * 아는 경위로 떨어뜨리지 않고 "이 문구가 설명할 수 없는 경위"라고 적는다(`_CAUSE_UNSPECIFIED`) —
 * 화면도 같아야 한다.
 */
const UNKNOWN_CAUSE_DRIFT_REVIEW: ReviewRequest = {
  ...DRIFT_REVIEW,
  review_request_id: "rr-drift-3",
  title:
    "문서 식별 드리프트: CM 판단 1건(확정 1 · 반려 0)이 이번 적재의 식별 드리프트에 걸렸습니다" +
    "(경위 'row_split_v3' — 이 문구가 설명할 수 없는 경위입니다. lost_decisions 를 직접 보십시오) — " +
    "확인용 요청입니다(매핑은 복구되지 않습니다). 이전 지문이 없어 식별 표면 config 와 대장 파일" +
    "(시트명 등) 중 어느 쪽이 움직였는지 알 수 없습니다",
  conflicting_sources: {
    previous_fingerprint: null,
    current_fingerprint: "ffffffffffffffff",
    moved: [],
    merged: [],
    lost_decisions: [
      {
        activity_id: "A700", doc_id: "doc-v1-x", decision: "confirmed", cause: "row_split_v3",
        new_doc_id: null, changed_fields: [], approval_flipped: false,
      },
    ],
  },
};

/**
 * **개정 2 이전에 만들어져 저장된 요청.** DB 에 남은 `conflicting_sources` 는 그대로 실려 오므로
 * `cause` 가 옛 이름이고 새 필드 셋이 아예 없다. 옛 이름을 새 갈래로 조용히 번역하면 개명이 걷어낸
 * 거짓("고아"·"병합")이 화면에서 되살아나고, 없는 필드를 "없다"로 읽으면 관측하지 못한 사실을 말하게
 * 된다 — 둘 다 하지 않는다. `title` 은 그 시절 서버가 쓴 문장 그대로다(화면은 이것을 되읽지 않는다).
 */
const LEGACY_DRIFT_REVIEW: ReviewRequest = {
  ...DRIFT_REVIEW,
  review_request_id: "rr-drift-5",
  title:
    "문서 식별 드리프트: 서로 다른 대장 행이 한 doc_id 로 병합돼, CM 이 판단한 문서 1건의 내용이 다른 " +
    "대장 행으로 바뀌었습니다(CM 판단 1건 · 확정 1 · 반려 0) — 확인용 요청입니다(매핑은 복구되지 않습니다). " +
    "식별 규칙 config 를 되돌리고 대장을 다시 올리십시오",
  conflicting_sources: {
    previous_fingerprint: "1111111111111111",
    current_fingerprint: "2222222222222222",
    moved: [],
    merged: [{ doc_id: "doc-v1-live1", titles: ["1F 슬래브 배근도 승인요청 1차", "1F 슬래브 배근도 승인요청 2차"] }],
    lost_decisions: [
      { activity_id: "A300", doc_id: "doc-v1-live1", decision: "confirmed", cause: "merge_overwritten" },
    ],
  },
};

function mockDriftQueue(review: ReviewRequest = DRIFT_REVIEW) {
  return mockFetch((url) => {
    if (url.includes("/api/projects/p1/review-requests")) return { body: [review] };
    if (url.endsWith("/api/projects/p1")) return { body: { project_id: "p1", name: "P", my_role: "cm" } };
    return undefined;
  });
}

/** 다이얼로그 본문(`ConfirmDialog` 의 `message` 단락)을 통째로 읽는다. 특정 절에 걸어 찾으면
 *  그 절을 지웠을 때 "요소를 못 찾음"으로 실패해 어느 절이 사라졌는지가 흐려진다. */
async function openDecisionDialog(decision: "승인" | "반려"): Promise<string> {
  const user = userEvent.setup();
  // 근거 카드(IdentityDriftCard)가 아니라 **행**이 뜨기를 기다린다 — 카드를 지웠을 때 문구 테스트까지
  // 함께 무너지면 두 방어가 한 덩어리가 되어, 어느 쪽이 죽었는지 뮤테이션으로 구분할 수 없다.
  await screen.findByTestId("review-row");
  await user.click(screen.getByRole("button", { name: decision }));
  const dialog = screen.getByRole("dialog");
  return within(dialog).getByTestId("confirm-message").textContent ?? "";
}

/** 근거 카드가 CM 에게 실제로 보여주는 글자 전부. 절 단위로 걸지 않고 통째로 읽는 이유는 위와 같다. */
async function driftCardText(): Promise<string> {
  const card = await screen.findByTestId("identity-drift-card");
  return card.textContent ?? "";
}

function setupDrift(review: ReviewRequest = DRIFT_REVIEW) {
  resetStore();
  loginAs("cm");
  mockDriftQueue(review);
  renderPage();
}

describe("ReviewsPage — document_identity_drift (ADR 0009 §5-3)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetStore();
  });

  it("새 kind 에 한국어 라벨이 있다 — 배지와 종류 필터가 undefined 로 뜨지 않는다", async () => {
    setupDrift();

    const row = await screen.findByTestId("review-row");
    // REVIEW_KIND_LABELS 에서 값을 빼면 라벨이 undefined 가 되어 배지가 비고 이 단언이 깨진다.
    expect(within(row).getByText("문서 식별 드리프트")).toBeInTheDocument();
    // 필터 드롭다운도 같은 표를 돌기 때문에 새 kind 로 거를 수 있어야 한다.
    expect(
      within(screen.getByTestId("kind-filter")).getByRole("option", { name: "문서 식별 드리프트" }),
    ).toBeInTheDocument();
  });

  it("해소해도 오염된 확정·반려가 복구되지 않는다고 말한다 — 복구를 약속하지 않는다", async () => {
    setupDrift();

    const text = await openDecisionDialog("승인");
    expect(text).toMatch(/복구되지 않으며|복구되지 않습니다/);
    // 복구를 약속하는 어떤 표현도 있으면 안 된다(이 kind 에는 resolve_review 분기가 없다).
    expect(text).not.toMatch(/복구됩니다|복구된다|복원됩니다|되살아납니다|자동으로 복구/);
  });

  it("승인·반려 어느 쪽을 눌러도 매핑 행이 바뀌지 않는다고 말한다", async () => {
    setupDrift();

    // 반려 쪽에서 확인한다 — 두 결정이 같은 폴백으로 떨어진다는 사실 자체가 계약이다.
    const text = await openDecisionDialog("반려");
    expect(text).toMatch(/매핑은 한 행도 바뀌지 않습니다/);
    expect(text).toMatch(/상태만 기록됩니다/);
  });

  // ── 되돌릴 곳은 **지문**이 답한다(ADR 0009 §5-2 서두) ──────────────────────
  it("지문이 달라진 적재에서만 config 를 되돌리라고 안내한다", async () => {
    setupDrift();

    const text = await openDecisionDialog("승인");
    expect(text).toMatch(/config.*되돌린 뒤 대장을 다시 올리십시오/);
  });

  it("지문이 같은 적재(워크북 시트명 변경)에서는 config 를 되돌리라고 하지 않는다", async () => {
    // 실측 P3: 시트명 변경은 config 를 한 글자도 바꾸지 않는다(`fingerprint_changed=False`, moved=8).
    // 그때 "config 를 되돌리십시오"라고 적으면 CM 은 바뀐 적 없는 config 를 뒤지고, 진짜 입력(대장 파일
    // 쪽)은 아무도 보지 않는다. 서버 제목도 이 적재에서는 대장 파일 쪽을 가리킨다.
    setupDrift(SHEET_RENAME_DRIFT_REVIEW);

    const text = await openDecisionDialog("승인");
    expect(text).not.toMatch(/되돌린 뒤 대장을 다시 올리십시오/);
    expect(text).toMatch(/대장 파일 쪽 입력|워크북 시트명/);
    // 카드 꼬리말도 같은 값을 쓴다(둘이 갈리면 CM 이 서로 다른 두 안내를 본다).
    expect((await driftCardText())).toMatch(/대장 파일 쪽 입력|워크북 시트명/);
  });

  it("이전 지문이 없으면 어느 쪽이 움직였는지 단정하지 않는다", async () => {
    setupDrift(UNKNOWN_CAUSE_DRIFT_REVIEW);

    const text = await openDecisionDialog("승인");
    expect(text).toMatch(/알 수 없습니다/);
    expect(text).not.toMatch(/되돌린 뒤 대장을 다시 올리십시오/);
  });

  it("오염된 CM 판단이 어느 Activity·문서인지 보여준다 — 3축 '근거 없음' 카드를 그리지 않는다", async () => {
    setupDrift();

    const card = await screen.findByTestId("identity-drift-card");
    // 무엇을 확인해야 하는지가 이 목록에만 있다. 없으면 안내가 실행 불가능해진다.
    expect(within(card).getByRole("link", { name: "doc-v1-old1" })).toHaveAttribute(
      "href",
      "/projects/p1/documents/doc-v1-old1",
    );
    expect(within(card).getByText(/A100/)).toBeInTheDocument();
    expect(within(card).getAllByText("확정").length).toBeGreaterThan(0);
    expect(within(card).getAllByText("반려").length).toBeGreaterThan(0);
    // 이 kind 의 conflicting_sources 에는 3축이 없다 — 축 카드를 그리면 "근거 없음"만 세 장 뜬다.
    expect(screen.queryByText("신고(작업일보)")).not.toBeInTheDocument();
    // 카드 자체도 복구를 약속하지 않는다.
    expect(within(card).getByText(/복구되지 않습니다/)).toBeInTheDocument();
  });

  // ── 방어 1: 항목마다 경위가 보인다 ─────────────────────────────────────────
  it("오염된 판단 항목마다 경위가 붙는다 — 경위 없이 나열하지 않는다", async () => {
    setupDrift();

    await screen.findByTestId("identity-drift-card");
    const rows = screen.getAllByTestId("lost-decision-row");
    expect(rows).toHaveLength(3);
    // 항목 하나만 떼어 읽어도 그 판단이 어느 경위로 오염됐는지 알 수 있어야 한다. 세 항목 전부.
    const replaced = rows.filter((r) => (r.textContent ?? "").includes("A300"));
    const moved = rows.filter((r) => /A100|A400/.test(r.textContent ?? ""));
    expect(replaced).toHaveLength(1);
    expect(moved).toHaveLength(2);
    expect(replaced[0].textContent).toMatch(/담고 있던 대장 행이 바뀜/);
    for (const r of moved) expect(r.textContent).toMatch(/새 doc_id 로 옮김/);
  });

  // ── 방어 2: row_replaced 가 무슨 일인지 말한다 ─────────────────────────────
  it("row_replaced 는 '승인 상태가 그 대장 행의 것이 아니다'를 문서 상세를 열기 전에 말한다", async () => {
    setupDrift();

    await screen.findByTestId("identity-drift-card");
    const group = screen
      .getAllByTestId("drift-cause-group")
      .find((g) => g.dataset.cause === "row_replaced");
    expect(group).toBeDefined();
    const text = group?.textContent ?? "";
    // 약속의 내용: ① 지금 보이는 승인 상태가 그 대장 행의 것이 아니다 ② 도면 승인 근거가 뒤집혔다
    // (`approval_flipped=true` 일 때만) ③ 무엇이 달라졌는지(`changed_fields`).
    expect(text).toMatch(/승인 상태/);
    expect(text).toMatch(/대장 행/);
    expect(text).toMatch(/도면 승인 근거|drawing_approval/);
    expect(text).toMatch(/발신·문서번호/);
  });

  // ── 방어 3: 가장 위험한 경위가 맨 위 ──────────────────────────────────────
  it("가장 위험한 경위(row_replaced)가 목록 맨 위에 온다 — 서버가 준 순서와 무관하게", async () => {
    // 픽스처의 lost_decisions 는 row_moved 두 건이 **먼저** 온다. 화면이 다시 세우지 않으면 되돌릴 수
    // 없는 경위가 아래로 밀린다. (정렬 자체는 domain/identityDrift.test.ts 가 단위로도 고정한다.)
    setupDrift();

    await screen.findByTestId("identity-drift-card");
    const causes = screen.getAllByTestId("drift-cause-group").map((g) => g.dataset.cause);
    expect(causes).toEqual(["row_replaced", "row_moved"]);
  });

  // ── 방어 3-b: 되돌릴 수 없는 경위만 강조된다 ───────────────────────────────
  it("row_replaced 묶음만 강조 표시된다 — 자리가 아니라 경위로 고른다", async () => {
    setupDrift();

    await screen.findByTestId("identity-drift-card");
    const groups = screen.getAllByTestId("drift-cause-group");
    const replaced = groups.find((g) => g.dataset.cause === "row_replaced");
    const moved = groups.find((g) => g.dataset.cause === "row_moved");
    expect(replaced?.className).toContain("strong");
    expect(replaced?.textContent).toMatch(/가장 먼저 확인/);
    // 나머지 경위는 강조하지 않는다 — 전부 강조하면 아무것도 강조되지 않는다.
    expect(moved?.className).not.toContain("strong");
    expect(moved?.textContent).not.toMatch(/가장 먼저 확인/);
  });

  // ── 방어 4: 이동도 병합도 없는 적재(R1)에 고아·병합·이동을 적지 않는다 ─────
  it("moved·merged 가 둘 다 0인 적재에서 카드가 '고아'·'병합'·'이동'을 말하지 않는다", async () => {
    // ADR 0009 §5-2 (바) R1: 사명 변경 주의 정상 운영이라 `merged=0` 이고 옛 행은 고아가 되지도 않는다.
    // 여기서 "병합"이라고 적으면 CM 은 있지도 않은 충돌 묶음을 찾는다(개정 1 제목이 정확히 그랬다).
    setupDrift(REPLACED_ONLY_DRIFT_REVIEW);

    const text = await driftCardText();
    expect(text).not.toMatch(/고아/);
    expect(text).not.toMatch(/병합/);
    expect(text).toMatch(/doc_id 이동 없음/);
  });

  // ── 방어 4-b: 다시 판단할 곳은 값에서 읽는다 ──────────────────────────────
  it("row_replaced 에는 '다시 판단할 새 doc_id 가 없다'고, row_absorbed 에는 그 doc_id 를 적는다", async () => {
    setupDrift(REPLACED_ONLY_DRIFT_REVIEW);

    await screen.findByTestId("identity-drift-card");
    const groups = screen.getAllByTestId("drift-cause-group");
    const replaced = groups.find((g) => g.dataset.cause === "row_replaced");
    const absorbed = groups.find((g) => g.dataset.cause === "row_absorbed");
    // `new_doc_id=null` 은 "다시 판단할 곳이 **없다**"는 사실이다(ADR 0009 §5-2 (마)).
    expect(replaced?.textContent).toMatch(/다시 판단할 새 doc_id 는 없습니다/);
    expect(replaced?.textContent).not.toMatch(/다시 판단할 곳:/);
    // 반대로 흡수된 행은 그 행이 지금 있는 doc_id 에서 다시 판단할 수 있다 — 서버 문구도 같다.
    expect(absorbed?.textContent).toMatch(/다시 판단할 곳: doc-v1-live1/);
  });

  // ── 방어 5: 모르는 경위를 아는 경위로 떨어뜨리지 않는다 ────────────────────
  it("모르는 cause 는 '경위 미상'으로 두고 무슨 일이 일어났는지 가정하지 않는다", async () => {
    setupDrift(UNKNOWN_CAUSE_DRIFT_REVIEW);

    await screen.findByTestId("identity-drift-card");
    // 카드 전체가 아니라 **그 묶음**만 읽는다 — 카드 꼬리말까지 함께 읽으면 꼬리말 방어(위)와 한
    // 덩어리가 되어, 뮤테이션으로 어느 쪽이 죽었는지 구분할 수 없다.
    const group = screen.getAllByTestId("drift-cause-group")[0];
    const text = group.textContent ?? "";
    expect(text).toMatch(/경위 미상/);
    expect(text).toMatch(/row_split_v3/);   // 서버가 보낸 원문을 그대로 드러낸다
    // 모르는 것을 아는 경위로 적으면, 화면이 고치려는 바로 그 거짓이 된다(서버 _CAUSE_UNSPECIFIED 주석).
    expect(text).not.toMatch(/고아|병합|옮겼습니다|대장 행이 바뀌었습니다/);
  });

  // ── 방어 5-b: 옛 이름을 새 갈래로 조용히 번역하지 않는다 ──────────────────
  it("개정 2 이전에 저장된 요청(옛 cause·새 필드 없음)도 '경위 미상'으로 둔다", async () => {
    setupDrift(LEGACY_DRIFT_REVIEW);

    await screen.findByTestId("identity-drift-card");
    const group = screen.getAllByTestId("drift-cause-group")[0];
    const text = group.textContent ?? "";
    // 옛 이름은 관측과 어긋나서 개명됐다 — 새 갈래로 옮겨 주면 그 거짓 문구가 화면에서 되살아난다.
    expect(text).toMatch(/경위 미상/);
    expect(text).toMatch(/merge_overwritten/);
    // 새 필드가 **없는** 것은 "없다"가 아니라 "모른다"다 — 어느 쪽도 단정하지 않는다.
    expect(text).not.toMatch(/다시 판단할/);
    expect(text).not.toMatch(/뒤집/);
  });

  // ── 방어 6: 다이얼로그도 경위를 반영한다 ──────────────────────────────────
  it("해소 다이얼로그가 경위를 반영한다 — 다시 판단할 곳이 없으면 없다고, 있으면 그 doc_id 를 적는다", async () => {
    setupDrift(REPLACED_ONLY_DRIFT_REVIEW);
    const replacedOnly = await openDecisionDialog("승인");
    // 옛 문구는 경위와 무관하게 "고아 문서에 남은 …을 새 doc_id 쪽에서 다시 확인해 판단을 다시 내리"라고
    // 적었다. `row_replaced` 에는 그럴 새 doc_id 가 없다 — 없는 행동을 시키지 않는다.
    expect(replacedOnly).not.toMatch(/고아/);
    expect(replacedOnly).toMatch(/다시 판단할 새 doc_id 는 없습니다/);
    // 같은 적재의 `row_absorbed` 는 반대로 갈 곳이 있다 — 절이 갈려 있어야 둘 다 참이다.
    expect(replacedOnly).toMatch(/다시 판단할 곳: doc-v1-live1/);

    vi.unstubAllGlobals();
    cleanup();   // 같은 테스트 안에서 두 적재를 비교한다 — 앞 화면을 걷어내야 두 번째 렌더가 겹치지 않는다.
    setupDrift(DRIFT_REVIEW);
    const mixed = await openDecisionDialog("승인");
    // 행이 옮겨간 적재에서는 "그 새 doc_id 위에서 다시 판단"이 실제로 할 수 있는 일이다.
    expect(mixed).toMatch(/다시 판단할 곳: doc-v1-new1, doc-v1-new2/);
  });

  // ── 방어 7: 승인 상태 문장은 **경위 이름이 아니라 값**이 가른다 ────────────
  //
  // 서버는 `132d116` 에서 같은 문장을 `approval_flipped` 값 기준 세 갈래로 갈랐다(ADR 0009 §5-3-b).
  // 화면에는 그 거짓이 그대로 남아 있었다 — `IDENTITY_DRIFT_CAUSE_NOTES.row_replaced` 가 **경위 이름만
  // 보고** "지금 보이는 승인 상태는 CM 이 보고 판단한 그 대장 행의 것이 아닙니다 — 대장 원본과 대조해
  // 승인 상태부터 확인하십시오"라고 적었다. ADR 0007 이 여덟 번 겪은 계열 (A)(서버는 불변식을 지키는데
  // 화면이 차례로 어긴다)가 정확히 이것이다.
  //
  // 세 갈래를 **양쪽으로** 건다: 그 갈래에 그 표지가 있다 + 다른 갈래의 표지가 없다. 한쪽만 걸면
  // "그 문장을 아예 안 적는" 구현도 통과한다(CLAUDE.md §6-2).
  const FLIPPED_MARK = /다른 값 위에서 내려졌습니다/;
  const CANNOT_TELL_MARK = /이번 적재의 값으로 가릴 수 없습니다/;
  const ONLY_SAME_MARK = /승인 상태 값은 CM 이 판단할 때와 같습니다/;   // "값 자체는" 갈래에는 안 걸린다

  /** row_replaced 묶음이 CM 에게 실제로 보여주는 글자. 카드 전체를 읽으면 꼬리말·다른 묶음이 섞여
   *  "이 묶음이 그 말을 하지 않는다"는 단언이 무뎌진다. */
  async function replacedGroupText(): Promise<string> {
    await screen.findByTestId("identity-drift-card");
    const group = screen.getAllByTestId("drift-cause-group").find((g) => g.dataset.cause === "row_replaced");
    expect(group).toBeDefined();
    return group?.textContent ?? "";
  }

  it("뒤집힌 적재에서만 '다른 값 위에서 내려졌다'고 적는다", async () => {
    setupDrift();   // DRIFT_REVIEW: row_replaced 1건이 approval_flipped=true

    const text = await replacedGroupText();
    expect(text).toMatch(FLIPPED_MARK);
    // 뒤집힌 적재에 "값은 같습니다"가 붙으면 그것이 곧 거짓이다.
    expect(text).not.toMatch(/CM 이 판단할 때와 같습니다/);
  });

  it("대장이 **같은 행**의 표기를 고친 적재(P6·FP1)에서는 승인 상태를 뒤집혔다고 하지 않는다", async () => {
    // approval_flipped=False · changed_fields=['sender'] · drawing_approval 0.0 → 0.0.
    setupDrift(SELF_CORRECTED_DRIFT_REVIEW);

    const text = await replacedGroupText();
    // 값에서 참인 것: 승인 상태 값은 같다 + 같은 행을 고친 것인지 다른 행인지는 가릴 수 없다.
    expect(text).toMatch(/승인 상태 값 자체는 CM 이 판단할 때와 같습니다/);
    expect(text).toMatch(CANNOT_TELL_MARK);
    expect(text).not.toMatch(FLIPPED_MARK);
    // 이 적재에서 **참일 수 없는 말**이 하나도 없어야 한다(CLAUDE.md §6-4 규칙 3).
    expect(text).not.toMatch(/그 대장 행의 것이 아닙니다/);
    expect(text).not.toMatch(/뒤집/);
    // 그리고 ADR 0009 §5-2 (바)의 비용 전제 — 오탐의 대가는 "부수효과 없는 확인 요청 1건"이다.
    // 화면이 도면을 다시 열라고 시키면 대가가 CM 의 도면 재확인 1회가 되어 그 결정이 무너진다.
    expect(text).not.toMatch(/승인 상태부터 확인|대장 원본과 대조/);

    // 다이얼로그도 같은 값을 쓴다 — 둘이 갈리면 CM 이 서로 다른 두 안내를 본다.
    const dialog = await openDecisionDialog("승인");
    expect(dialog).toMatch(CANNOT_TELL_MARK);
    expect(dialog).not.toMatch(/그 대장 행의 것이 아닙니다/);
    expect(dialog).not.toMatch(/승인 상태부터 확인|대장 원본과 대조/);
  });

  it("처리결과 표기만 달라진 적재(P13b)에서는 승인 상태가 달라졌다고 적지 않는다", async () => {
    // 행-정체가 같은 두 행의 처리결과가 `반려`/`부적합` — 둘 다 REJECTED 라 승인 상태는 그대로다.
    setupDrift(RESULT_ONLY_DRIFT_REVIEW);

    const text = await replacedGroupText();
    expect(text).toMatch(ONLY_SAME_MARK);
    expect(text).not.toMatch(FLIPPED_MARK);
    // (나-ii) 문장이 무엇이 달라졌는지도 값에서 읽는다 — 처리결과 표기 하나뿐이다.
    expect(text).toMatch(/그 doc_id 가 담은 내용이 달라졌습니다 — 처리결과 표기\./);
    expect(text).not.toMatch(/처리결과 표기·승인 상태/);
    expect(text).not.toMatch(/승인 상태가 이번 적재에 달라졌습니다/);
    // 원문 네 필드는 그대로다 — "달라진 대장 원문"을 적으면 changed_fields===[] 를 뒤집는 거짓이 된다.
    expect(text).not.toMatch(/달라진 대장 원문/);
  });

  it("경위 이름이 같아도 값이 다르면 화면 문장이 다르다 — 이름으로 단정하지 않는다", async () => {
    // 세 적재 모두 cause 는 `row_replaced` 하나다. 문장이 값에서 갈리지 않으면 셋이 같은 글자를 낸다.
    setupDrift(SELF_CORRECTED_DRIFT_REVIEW);
    const selfCorrected = await replacedGroupText();
    vi.unstubAllGlobals();
    cleanup();

    setupDrift(RESULT_ONLY_DRIFT_REVIEW);
    const resultOnly = await replacedGroupText();
    vi.unstubAllGlobals();
    cleanup();

    setupDrift();
    const flipped = await replacedGroupText();

    for (const [a, b] of [
      [selfCorrected, resultOnly],
      [resultOnly, flipped],
      [flipped, selfCorrected],
    ]) {
      expect(a).not.toBe(b);
    }
  });
});
