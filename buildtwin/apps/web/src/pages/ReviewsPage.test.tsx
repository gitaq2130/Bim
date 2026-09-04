import { screen, waitFor, within } from "@testing-library/react";
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
// 아래 테스트는 **문구 문자열을 통째로 고정하지 않는다**(그렇게 하면 거짓 문구도 계약이 된다 — 10차
// 리뷰). 대신 약속의 **내용**을 하나씩 따로 고정한다: ① 복구되지 않는다 ② 매핑이 바뀌지 않는다
// ③ 사람이 재확정해야 한다 ④ 어느 문서를 재확정해야 하는지 보인다. 각 절을 하나씩 지우면
// 정확히 그 테스트 하나만 실패한다(뮤테이션으로 확인함).
// ════════════════════════════════════════════════════════════════════════════
const DRIFT_REVIEW: ReviewRequest = {
  review_request_id: "rr-drift-1",
  project_id: "p1",
  kind: "document_identity_drift",
  title:
    "문서 식별 드리프트: 대장은 그대로인데 doc_id 가 6건 이동했고, CM 판단 2건(확정 1 · 반려 1)이 고아 문서에 남았습니다",
  // ADR 0009 §5-2 의 실제 모양(services/progress/document_mapper.open_identity_drift_review).
  // 3축(신고/스캔/논리)은 **아예 없다**.
  conflicting_sources: {
    previous_fingerprint: "aaaaaaaaaaaaaaaa",
    current_fingerprint: "bbbbbbbbbbbbbbbb",
    moved: [{ previous_doc_id: "doc-v1-old1", new_doc_id: "doc-v1-new1", title: "1F 기둥 배근도 승인요청" }],
    merged: [],
    lost_decisions: [
      { activity_id: "A100", doc_id: "doc-v1-old1", decision: "confirmed" },
      { activity_id: "A400", doc_id: "doc-v1-old2", decision: "rejected" },
    ],
  },
  confidence: 1.0,
  evidence: {
    source_type: "document",
    source_id: "file-register-2",
    method: "identity_surface_drift",
    note: "DOCUMENT_IDENTITY_DRIFT",
    extra: { moved_count: 1, merged_count: 0, lost_decision_count: 2 },
  },
  assignee_role: "cm",
  status: "open",
  created_at: "2026-09-04T00:00:00Z",
};

function mockDriftQueue() {
  return mockFetch((url) => {
    if (url.includes("/api/projects/p1/review-requests")) return { body: [DRIFT_REVIEW] };
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

describe("ReviewsPage — document_identity_drift (ADR 0009 §5-3)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetStore();
  });

  it("새 kind 에 한국어 라벨이 있다 — 배지와 종류 필터가 undefined 로 뜨지 않는다", async () => {
    resetStore();
    loginAs("cm");
    mockDriftQueue();
    renderPage();

    const row = await screen.findByTestId("review-row");
    // REVIEW_KIND_LABELS 에서 값을 빼면 라벨이 undefined 가 되어 배지가 비고 이 단언이 깨진다.
    expect(within(row).getByText("문서 식별 드리프트")).toBeInTheDocument();
    // 필터 드롭다운도 같은 표를 돌기 때문에 새 kind 로 거를 수 있어야 한다.
    expect(
      within(screen.getByTestId("kind-filter")).getByRole("option", { name: "문서 식별 드리프트" }),
    ).toBeInTheDocument();
  });

  it("해소해도 끊어진 확정·반려가 복구되지 않는다고 말한다 — 복구를 약속하지 않는다", async () => {
    resetStore();
    loginAs("cm");
    mockDriftQueue();
    renderPage();

    const text = await openDecisionDialog("승인");
    expect(text).toMatch(/복구되지 않으며|복구되지 않습니다/);
    // 복구를 약속하는 어떤 표현도 있으면 안 된다(이 kind 에는 resolve_review 분기가 없다).
    expect(text).not.toMatch(/복구됩니다|복구된다|복원됩니다|되살아납니다|자동으로 복구/);
  });

  it("승인·반려 어느 쪽을 눌러도 매핑 행이 바뀌지 않는다고 말한다", async () => {
    resetStore();
    loginAs("cm");
    mockDriftQueue();
    renderPage();

    // 반려 쪽에서 확인한다 — 두 결정이 같은 폴백으로 떨어진다는 사실 자체가 계약이다.
    const text = await openDecisionDialog("반려");
    expect(text).toMatch(/매핑은 한 행도 바뀌지 않습니다/);
    expect(text).toMatch(/상태만 기록됩니다/);
  });

  it("CM 이 실제로 해야 할 일(사람이 다시 확정 / config 되돌리기)을 안내한다", async () => {
    resetStore();
    loginAs("cm");
    mockDriftQueue();
    renderPage();

    const text = await openDecisionDialog("승인");
    expect(text).toMatch(/사람이 직접 되살려야 합니다/);
    expect(text).toMatch(/재확정/);
    expect(text).toMatch(/config.*되돌린 뒤 대장을 다시 올리십시오/);
  });

  it("끊어진 CM 판단이 어느 Activity·문서인지 보여준다 — 3축 '근거 없음' 카드를 그리지 않는다", async () => {
    resetStore();
    loginAs("cm");
    mockDriftQueue();
    renderPage();

    const card = await screen.findByTestId("identity-drift-card");
    const lost = within(card).getByTestId("lost-decisions");
    // 재확정 대상이 무엇인지가 이 목록에만 있다. 없으면 "재확정하라"는 안내가 실행 불가능해진다.
    expect(within(lost).getByRole("link", { name: "doc-v1-old1" })).toHaveAttribute(
      "href",
      "/projects/p1/documents/doc-v1-old1",
    );
    expect(within(lost).getByText(/A100/)).toBeInTheDocument();
    expect(within(lost).getByText("확정")).toBeInTheDocument();
    expect(within(lost).getByText("반려")).toBeInTheDocument();
    // 이 kind 의 conflicting_sources 에는 3축이 없다 — 축 카드를 그리면 "근거 없음"만 세 장 뜬다.
    expect(screen.queryByText("신고(작업일보)")).not.toBeInTheDocument();
    // 카드 자체도 복구를 약속하지 않는다.
    expect(within(card).getByText(/복구되지 않습니다/)).toBeInTheDocument();
  });
});
