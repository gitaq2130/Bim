import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import type { ActivityDocumentMapping, Document, DocumentDetail } from "../api/types";
import { loginAs, mockFetch, renderWithProviders, resetStore } from "../test/utils";
import { DocumentDetailPage } from "./DocumentDetailPage";
import { partialMatchKey } from "@tanstack/react-query";
import { queryKeys } from "../api/hooks";

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

  // 과제 2/3: 이 화면(문서 상세)과 검토 큐가 같은 재오픈 사실을 다르게 말하면 안 된다. 확정된 매핑이
  // 재계산으로 무효화돼 검토요청이 다시 open 되면(ADR 0007 §4-2 규칙 6 ⑤), 매핑 행 자체는 "확정됨"으로
  // 남으므로 이 화면만 보면 왜 큐에 다시 떴는지 알 수 없다 — evidence.extra.invalidated_activity_signature
  // 가 있는 open 상태 document_mapping 검토요청과 대조해 "재확인 필요"로 구분해 보여준다.
  it("확정된 매핑이 재계산으로 무효화되어 검토요청이 다시 열리면 '재확인 필요'로 표시한다", async () => {
    const CONFIRMED = { ...PENDING_MAPPING, needs_review: false, reviewed_by: "user-cm" };
    mockFetch((url) => {
      if (url.includes("/api/documents/doc-aaa")) return { body: detail([CONFIRMED]) };
      if (url.includes("/api/projects/p1/review-requests")) {
        return {
          body: [
            {
              review_request_id: "rr-reopen-1", project_id: "p1", kind: "document_mapping", activity_id: "ACT-100",
              title: "문서 매핑 재확인 필요: Activity ACT-100 → doc-aaa", conflicting_sources: {}, confidence: 0.58,
              evidence: {
                source_type: "document", source_id: "doc-aaa", method: "document_title_match", note: DOC.title,
                extra: { invalidated_activity_signature: "9F 기둥|9F||전기|", invalidation_reason: "confirmed_mapping_no_longer_a_recompute_candidate" },
              },
              assignee_role: "cm", status: "open", created_at: "2026-09-02T00:00:00Z",
            },
          ],
        };
      }
      return mockProjectRole("cm")(url);
    });
    renderPage();

    const row = await screen.findByTestId("mapping-row");
    expect(within(row).getByText("확정됨")).toBeInTheDocument();
    expect(await within(row).findByTestId("reopened-badge")).toBeInTheDocument();
  });

  it("무효화 표식이 없는 보통의 확정 매핑에는 '재확인 필요' 배지를 붙이지 않는다", async () => {
    const CONFIRMED = { ...PENDING_MAPPING, needs_review: false, reviewed_by: "user-cm" };
    mockFetch((url) => {
      if (url.includes("/api/documents/doc-aaa")) return { body: detail([CONFIRMED]) };
      if (url.includes("/api/projects/p1/review-requests")) return { body: [] };
      return mockProjectRole("cm")(url);
    });
    renderPage();

    const row = await screen.findByTestId("mapping-row");
    expect(within(row).getByText("확정됨")).toBeInTheDocument();
    expect(within(row).queryByTestId("reopened-badge")).not.toBeInTheDocument();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 10차 리뷰 — 반려된 매핑을 "확정됨"으로 그리던 결함. ADR 0007 §4-2 규칙 6 ⑥이
  // reviewed_by 를 확정·반려가 공유하도록 설계했으므로, needs_review/reviewed_by 만 보는 화면은
  // CM 이 방금 반려한 매핑을 초록 "확정됨 / 확정: 나" 로 보여준다. 서버 두 곳은 이 불변식을
  // 지켰지만 화면은 지키지 않았고, 웹 테스트 169개가 전부 통과했다.
  // ══════════════════════════════════════════════════════════════════════════
  const REJECTED = {
    ...PENDING_MAPPING,
    needs_review: false,          // 반려도 확정과 똑같이 false 가 된다 — 이것만 보면 구분 불가
    reviewed_by: "user-cm",       // 반려자도 같은 필드에 들어간다
    evidence: {
      ...PENDING_MAPPING.evidence,
      extra: {
        ...PENDING_MAPPING.evidence.extra,
        mapping_review_decision: "rejected",
        rejected_by: "user-cm",
        rejected_at: "2026-09-03T00:00:00Z",
        rejection_note: "다른 공종 문서로 확인됨",
      },
    },
  } as ActivityDocumentMapping;

  function renderRejected(role: "cm" | "client" = "cm") {
    mockFetch((url) => {
      if (url.includes("/api/documents/doc-aaa")) return { body: detail([REJECTED]) };
      if (url.includes("/api/projects/p1/review-requests")) return { body: [] };
      return mockProjectRole(role)(url);
    });
    renderPage();
  }

  it("반려된 매핑을 '확정됨'이 아니라 '반려됨'으로 그린다", async () => {
    renderRejected();
    const row = await screen.findByTestId("mapping-row");
    expect(within(row).getByTestId("mapping-review-state")).toHaveTextContent("반려됨");
    expect(within(row).queryByText("확정됨")).not.toBeInTheDocument();
    // 반려자를 "확정: ..." 으로 표기하지 않는다 — 원래 결함이 정확히 이것이었다
    expect(within(row).queryByText(/^확정: /)).not.toBeInTheDocument();
  });

  it("반려된 매핑에 반려자와 사유를 보여준다 — 매핑 반려를 볼 수 있는 유일한 화면이다", async () => {
    renderRejected();
    const row = await screen.findByTestId("mapping-row");
    const rejection = within(row).getByTestId("mapping-rejection");
    expect(rejection).toHaveTextContent("user-cm");
    expect(rejection).toHaveTextContent("다른 공종 문서로 확인됨");
    // 도면 승인 근거로 쓰이지 않는다는 사실을 명시해야 한다(화면의 다른 안내문과 모순되지 않도록)
    expect(rejection).toHaveTextContent(/도면 승인 근거로 쓰이지 않으며/);
  });

  it("반려된 매핑에는 cm 이라도 확정 버튼을 띄우지 않는다 — 서버가 409 로 거절한다", async () => {
    renderRejected("cm");
    const row = await screen.findByTestId("mapping-row");
    expect(within(row).queryByRole("button", { name: "확정" })).not.toBeInTheDocument();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 13차 리뷰 — 뮤테이션이 **자기 화면의 쿼리를 무효화하지 않아** 화면이 조용히 낡던 결함.
  // 12차와 같은 구조다(그때는 검토 큐 반려, 여기는 문서 상세의 매핑 재생성·확정).
  // 운영 staleTime 이 10초라 컴포넌트가 마운트된 채로는 사실상 무기한 낡는다.
  // ══════════════════════════════════════════════════════════════════════════
  it("매핑 재생성 후 문서 상세와 검토요청이 재조회돼 새 매핑이 화면에 나타난다", async () => {
    resetStore();
    loginAs("cm");
    let generated = false;
    let docFetches = 0;
    let reviewFetches = 0;
    const second: ActivityDocumentMapping = { ...PENDING_MAPPING, activity_id: "ACT-200" };
    mockFetch((url, init) => {
      if (url.includes("/documents/mappings") && init?.method === "POST") {
        generated = true;
        return { body: [PENDING_MAPPING, second] };
      }
      if (url.includes("/api/documents/doc-aaa")) {
        docFetches += 1;
        return { body: detail(generated ? [PENDING_MAPPING, second] : [PENDING_MAPPING]) };
      }
      if (url.includes("/api/projects/p1/review-requests")) {
        reviewFetches += 1;
        return { body: [] };
      }
      return mockProjectRole("cm")(url);
    });
    renderPage();
    const user = userEvent.setup();

    await screen.findByTestId("mapping-row");
    expect(screen.getAllByTestId("mapping-row")).toHaveLength(1);
    const docBefore = docFetches;
    const reviewBefore = reviewFetches;

    await user.click(screen.getByRole("button", { name: "매핑 후보 다시 생성" }));

    // 서버가 2건을 돌려줬으면 화면도 2건이어야 한다 — 목록 키(끝이 `{}`)로만 무효화하면
    // 상세 키(`[..., docId]`)가 부분 일치에 걸리지 않아 1건 그대로 남는다.
    await waitFor(() => expect(screen.getAllByTestId("mapping-row")).toHaveLength(2));
    expect(docFetches).toBeGreaterThan(docBefore);
    // 서버 map_project_documents 는 document_mapping 검토요청도 만든다 — 그 목록도 갱신돼야 한다.
    expect(reviewFetches).toBeGreaterThan(reviewBefore);
  });

  it("문서 상세에서 확정하면 검토요청 목록도 재조회된다 — 서버가 그 요청을 닫기 때문", async () => {
    // 확정은 서버에서 close_document_mapping_review 로 해당 검토요청을 approved 로 닫는다.
    // 무효화하지 않으면 staleTime 안에 검토 큐로 갔을 때 이미 닫힌 요청이 열림 + 승인/반려 버튼으로
    // 남고, 누르면 409 review_already_resolved 가 난다.
    resetStore();
    loginAs("cm");
    let confirmed = false;
    let reviewFetches = 0;
    mockFetch((url, init) => {
      if (url.includes("/confirm") && init?.method === "POST") {
        confirmed = true;
        return { body: { ...PENDING_MAPPING, needs_review: false, reviewed_by: "user-cm" } };
      }
      if (url.includes("/api/documents/doc-aaa"))
        return { body: detail([confirmed ? { ...PENDING_MAPPING, needs_review: false, reviewed_by: "user-cm" } : PENDING_MAPPING]) };
      if (url.includes("/api/projects/p1/review-requests")) {
        reviewFetches += 1;
        return { body: [] };
      }
      return mockProjectRole("cm")(url);
    });
    renderPage();
    const user = userEvent.setup();

    await screen.findByTestId("mapping-row");
    const before = reviewFetches;

    await user.click(screen.getByRole("button", { name: "확정" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "확정" }));

    await waitFor(() => expect(reviewFetches).toBeGreaterThan(before));
  });

  it("문서 상세에서 확정하면 주간요약·착수가능·readiness 도 함께 무효화한다", async () => {
    // 14차 리뷰 후속: 이 무효화 줄들(weeklySummary/startable/activities)을 지워도 178건이 전부
    // 통과했다. 코드는 옳은데 방어가 고정돼 있지 않은 상태 — 이 사이클이 세 번 연속 REJECT 당한
    // 실패 유형 그대로다. 확정은 서버에서 drawing_approval 을 바꾸므로 파생 화면이 낡으면 안 된다.
    //
    // 이 화면은 세 쿼리를 직접 구독하지 않으므로(다른 화면 소유) 재조회 요청 수로는 잴 수 없고,
    // 테스트 QueryClient 는 gcTime:0 이라 관찰자 없는 캐시 항목이 즉시 수거돼 상태로도 못 본다.
    // 그래서 무효화 호출 자체를 확인한다.
    resetStore();
    loginAs("cm");
    mockFetch((url, init) => {
      if (url.includes("/confirm") && init?.method === "POST")
        return { body: { ...PENDING_MAPPING, needs_review: false, reviewed_by: "user-cm" } };
      if (url.includes("/api/documents/doc-aaa")) return { body: detail([PENDING_MAPPING]) };
      if (url.includes("/api/projects/p1/review-requests")) return { body: [] };
      return mockProjectRole("cm")(url);
    });
    const { qc } = renderPage();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const user = userEvent.setup();

    await screen.findByTestId("mapping-row");
    await user.click(screen.getByRole("button", { name: "확정" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "확정" }));

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
// ADR 0009 — 식별(identity)과 대조(matching)의 제목 정규화는 다른 값이다.
// `title_identity` 는 코드에 동결돼 `doc_id` 해시에 실제로 들어간 문자열이고, `title_normalized` 는
// config 가 자유롭게 튜닝하는 대조용 텍스트다. 이 둘이 화면에서 나란히 보여야 CM 이 "왜 doc_id 가
// 움직였는가"를 눈으로 확인할 수 있다(ADR 0009 Consequences). 사용자 언어가 아니므로 목록·카드가
// 아니라 문서 상세의 접힌 영역에만 둔다(계획 0003 §3-g).
// ════════════════════════════════════════════════════════════════════════════
describe("DocumentDetailPage — 식별 정보 (ADR 0009)", () => {
  beforeEach(() => {
    resetStore();
    loginAs("cm");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("doc_id 해시에 들어간 title_identity 와 적재 지문을 대조용 정규화와 구분해 보여준다", async () => {
    // 매칭 튜닝(strip_patterns 에 '승인요청' 추가)이 실제로 적용된 모습: 대조용은 짧아졌지만
    // 식별용은 그대로다 — ADR 0009 §5 규칙 2 가 계약으로 고정한 바로 그 분리다.
    const doc: Document = {
      ...DOC,
      title_normalized: "1f 기둥 배근도",
      title_identity: "1f 기둥 배근도 승인요청",
      identity_fingerprint: "bbbbbbbbbbbbbbbb",
    };
    mockFetch((url) => {
      if (url.includes("/api/documents/doc-aaa")) return { body: detail([], doc) };
      return mockProjectRole("cm")(url);
    });
    renderPage();

    const box = await screen.findByTestId("identity-info");
    expect(within(box).getByTestId("title-identity")).toHaveTextContent("1f 기둥 배근도 승인요청");
    expect(within(box).getByTestId("identity-fingerprint")).toHaveTextContent("bbbbbbbbbbbbbbbb");
    // 대조용 정규화가 doc_id 재료가 **아니라는** 사실이 같은 자리에 적혀 있어야 한다.
    expect(within(box).getByText(/doc_id 재료가 아닙니다/)).toBeInTheDocument();
    // 접힌 영역이다 — 목록·카드로 새어 나가지 않는다(계획 0003 §3-g).
    expect(box.tagName).toBe("DETAILS");
    expect((box as HTMLDetailsElement).open).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ADR 0013 — 매핑 결정의 취소(확정 취소·반려 취소). 계획 0006 작업 9 의 화면 회귀.
//
// 이 블록이 붙들고 있는 것(변이를 **하나씩 개별로** 적용해 재현한 무보호 목록. 적용 전 268 passed):
//
// | 변이 | 잡는 자리 |
// |---|---|
// | 취소 버튼 조건 `reviewState !== "pending"` 삭제 | "검토 대기에는 취소 버튼이 없다" |
// | 취소 버튼 조건 `canDecide` 삭제 | "cm 이 아니면 취소 버튼이 없다" |
// | 취소 라우트 URL·`project_id` 파라미터 이름 변경 | "취소가 실제로 가는 곳" |
// | `useCancelDocumentMappingReview` 의 무효화(문서 상세·검토요청·주간요약·착수가능·readiness) 제거 | "취소 뒤 무엇이 다시 조회되는가" |
// | `requireNote` 를 끔 | "사유 없이는 취소 버튼이 눌리지 않는다" |
// | `mappingDialogMessage` 의 취소 분기를 확정 문구로 되돌림 | "취소 다이얼로그가 확정을 약속하지 않는다" |
// | `MAPPING_ACTION_LABELS.cancel` 을 방향과 무관한 "취소"로 | 같은 테스트의 라벨 단언 |
// | `CODE_MESSAGES` 의 새 code 셋 문구 | 세 개의 오류 안내 테스트 |
//
// **문구는 문장을 베끼지 않는다**(CLAUDE.md §6-4 3): 각 상황에서 **참일 수 없는 말이 없다**만
// 단언한다. 예 — `cancel_reason_required` 안내의 "새로고침"은 거짓이다(서버 상태는 최신이고 빠진 것은
// 사유뿐이다). 반대로 `mapping_decision_not_cancellable` 에서는 새로고침이 실제로 답이므로 그 말을
// 금지하지 않는다. 같은 사이클의 두 code 가 서로 다른 요구를 갖는 것이 이 규칙이 문장이 아니라
// **상황**을 보는 이유다.
// ════════════════════════════════════════════════════════════════════════════
describe("DocumentDetailPage — 매핑 결정의 취소 (ADR 0013)", () => {
  const CONFIRMED_MAPPING: ActivityDocumentMapping = {
    ...PENDING_MAPPING,
    needs_review: false,
    reviewed_by: "user-cm",
  };
  const REJECTED_MAPPING: ActivityDocumentMapping = {
    ...PENDING_MAPPING,
    needs_review: false,
    reviewed_by: "user-cm",
    evidence: {
      ...PENDING_MAPPING.evidence,
      extra: {
        ...PENDING_MAPPING.evidence.extra,
        mapping_review_decision: "rejected",
        rejected_by: "user-cm",
        rejected_at: "2026-09-03T00:00:00Z",
        rejection_note: "다른 공종 문서로 확인됨",
      },
    },
  } as ActivityDocumentMapping;
  const CANCELLED_MAPPING: ActivityDocumentMapping = { ...PENDING_MAPPING };

  beforeEach(() => {
    resetStore();
    loginAs("cm");
  });
  afterEach(() => vi.unstubAllGlobals());

  /** 매핑 하나를 그린 문서 상세. `onCancel` 응답과 오류를 칸별로 갈아 끼운다. */
  function mockPage(
    mapping: ActivityDocumentMapping,
    opts: {
      role?: "cm" | "contractor" | "client";
      cancel?: { status?: number; body?: unknown };
      confirm?: { status?: number; body?: unknown };
      after?: ActivityDocumentMapping;
    } = {},
  ) {
    const role = opts.role ?? "cm";
    let cancelled = false;
    return mockFetch((url, init) => {
      if (url.includes("/cancel-review") && init?.method === "POST") {
        cancelled = true;
        return opts.cancel ?? { body: opts.after ?? CANCELLED_MAPPING };
      }
      if (url.includes("/confirm") && init?.method === "POST")
        return opts.confirm ?? { body: CONFIRMED_MAPPING };
      if (url.includes("/api/documents/doc-aaa"))
        return { body: detail([cancelled ? (opts.after ?? CANCELLED_MAPPING) : mapping]) };
      if (url.includes("/api/projects/p1/review-requests")) return { body: [] };
      return mockProjectRole(role)(url);
    });
  }

  // ---- 버튼 노출 조건(두 게이트를 **각각** 고정한다) ----

  it("확정된 매핑에는 '확정 취소', 반려된 매핑에는 '반려 취소' 버튼이 뜬다 — 어느 결정을 되돌리는지가 라벨에 있다", async () => {
    mockPage(CONFIRMED_MAPPING);
    renderPage();
    let row = await screen.findByTestId("mapping-row");
    expect(within(row).getByTestId("cancel-decision")).toHaveTextContent("확정 취소");

    cleanup();
    vi.unstubAllGlobals();
    mockPage(REJECTED_MAPPING);
    renderPage();
    row = await screen.findByTestId("mapping-row");
    // 라벨이 방향과 무관해지면(둘 다 "취소") 다이얼로그의 닫기 버튼과 구별되지 않고 CM 은 자기가
    // 무엇을 되돌리는지 볼 수 없다.
    expect(within(row).getByTestId("cancel-decision")).toHaveTextContent("반려 취소");
  });

  it("검토 대기 매핑에는 취소 버튼이 없다 — 되돌릴 결정이 없고 서버도 409 로 막는다", async () => {
    mockPage(PENDING_MAPPING);
    renderPage();
    const row = await screen.findByTestId("mapping-row");
    expect(within(row).queryByTestId("cancel-decision")).not.toBeInTheDocument();
    // 음성 대조군: 같은 행에 확정 버튼은 **있다**(버튼 자체가 사라진 것이 아니다).
    expect(within(row).getByRole("button", { name: "확정" })).toBeInTheDocument();
  });

  it.each(["contractor", "client"] as const)("cm 이 아니면 취소 버튼이 없다 — %s", async (role) => {
    resetStore();
    loginAs(role);
    mockPage(CONFIRMED_MAPPING, { role });
    renderPage();
    const row = await screen.findByTestId("mapping-row");
    expect(within(row).queryByTestId("cancel-decision")).not.toBeInTheDocument();
    expect(within(row).getByTestId("mapping-review-state")).toHaveTextContent("확정됨");   // 화면 자체는 그린다
  });

  // ---- 사유 요건(화면이 서버 409 보다 먼저 잠근다) ----

  it("취소 다이얼로그는 사유가 비어 있으면 잠기고, 공백만으로도 열리지 않는다", async () => {
    mockPage(CONFIRMED_MAPPING);
    renderPage();
    const user = userEvent.setup();
    await screen.findByTestId("mapping-row");
    await user.click(screen.getByTestId("cancel-decision"));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/사유 \/ 메모/).textContent).toMatch(/필수/);
    const submit = within(dialog).getByRole("button", { name: "확정 취소" });
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox"), "   ");
    expect(submit).toBeDisabled();                       // 공백만은 사유가 아니다(서버 판정과 같은 축)
    await user.type(within(dialog).getByRole("textbox"), "잘못 확정했다");
    expect(submit).toBeEnabled();
  });

  it("확정 다이얼로그는 사유를 강제하지 않는다 — 요건은 취소 쪽에만 걸린다(음성 대조군)", async () => {
    mockPage(PENDING_MAPPING);
    renderPage();
    const user = userEvent.setup();
    await screen.findByTestId("mapping-row");
    await user.click(screen.getByRole("button", { name: "확정" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/사유 \/ 메모/).textContent).not.toMatch(/필수/);
    expect(within(dialog).getByRole("button", { name: "확정" })).toBeEnabled();
  });

  // ---- 다이얼로그 본문(§6-4 3 — 그 상황에서 참일 수 없는 말이 없다) ----

  it("반려 취소 다이얼로그는 확정을 약속하지 않는다 — 착지점은 검토 대기다", async () => {
    mockPage(REJECTED_MAPPING);
    renderPage();
    const user = userEvent.setup();
    await screen.findByTestId("mapping-row");
    await user.click(screen.getByTestId("cancel-decision"));

    const text = screen.getByTestId("confirm-message").textContent ?? "";
    // 확정 다이얼로그의 약속("도면 승인 근거로 확정됩니다")은 이 자리에서 거짓이다 — 취소는 확정을
    // 만드는 경로가 아니고, 확정하려면 CM 이 확정 액션을 다시 해야 한다(CLAUDE.md §0).
    expect(text).not.toMatch(/도면 승인 근거로 확정됩니다/);
    expect(text).not.toMatch(/되돌릴 수 없|영구/);        // 취소 자체가 되돌리기다
    // **확정 취소 쪽 문구를 그대로 쓰면 여기서 거짓이 된다**: 반려된 매핑은 애초에 도면 승인 근거로
    // 세지 않으므로(서버 실측 — 반려 전후 drawing_approval 0.5 → 0.5) 반려를 취소해도 착수 가능
    // 점수가 내려갈 수 없다. 방향별 분기가 사라지면 이 줄이 죽는다.
    expect(text).not.toMatch(/점수가 내려갈|낮아질/);
    expect(text).toMatch(/검토 대기|미확정/);              // 착지점은 말해야 한다
    expect(text).toMatch(/사유/);                          // 사유가 필수라는 사실
  });

  it("확정 취소 다이얼로그는 착수 가능 점수가 내려갈 수 있다는 것을 말한다 — 확정 취소의 실제 결과다", async () => {
    mockPage(CONFIRMED_MAPPING);
    renderPage();
    const user = userEvent.setup();
    await screen.findByTestId("mapping-row");
    await user.click(screen.getByTestId("cancel-decision"));

    const text = screen.getByTestId("confirm-message").textContent ?? "";
    expect(text).not.toMatch(/도면 승인 근거로 확정됩니다/);
    // 서버 실측(tests/integration/test_20_…::test_v1_…): 확정 취소로 drawing_approval 1.0 → 0.5.
    // 그 결과를 말하지 않으면 CM 은 자기 행위가 착수 가능 판단을 바꾼다는 것을 모른 채 누른다.
    expect(text).toMatch(/착수 가능|readiness/);
  });

  // ---- 취소가 실제로 가는 곳 ----

  it("취소는 POST /documents/mappings/{activity_id}/{doc_id}/cancel-review 에 project_id 와 사유를 보낸다", async () => {
    const { calls } = mockPage(CONFIRMED_MAPPING);
    renderPage();
    const user = userEvent.setup();
    await screen.findByTestId("mapping-row");
    await user.click(screen.getByTestId("cancel-decision"));
    await user.type(within(screen.getByRole("dialog")).getByRole("textbox"), "잘못 확정했다");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "확정 취소" }));

    const post = await waitFor(() => {
      const c = calls.find((x) => x.init?.method === "POST");
      expect(c).toBeDefined();
      return c!;
    });
    const u = new URL(post.url, "http://x");
    expect(u.pathname).toMatch(/\/api\/documents\/mappings\/ACT-100\/doc-aaa\/cancel-review$/);
    // ADR 0008 대리키 라우트: 쿼리 이름이 바뀌면 서버가 422 를 낸다(매핑 PK 가 복합키라 필수다).
    expect(u.searchParams.get("project_id")).toBe("p1");
    expect(JSON.parse(String(post.init?.body))).toEqual({ note: "잘못 확정했다" });
    // 그리고 화면은 서버가 돌려준 미확정 상태로 갱신된다 — 되돌린 결과가 그 자리에서 보여야 한다.
    expect(await screen.findByText("검토 대기")).toBeInTheDocument();
  });

  it("취소 뒤 문서 상세·검토요청·주간요약·착수가능·readiness 가 모두 무효화된다", async () => {
    // 취소는 서버에서 **매핑 행과 검토요청 큐를 둘 다** 바꾸고 drawing_approval 을 움직인다.
    // 한 줄만 지워도 화면은 정상이고 값만 낡는다(staleTime 10초라 마운트된 채로는 사실상 무기한).
    mockPage(CONFIRMED_MAPPING);
    const { qc } = renderPage();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const user = userEvent.setup();
    await screen.findByTestId("mapping-row");
    await user.click(screen.getByTestId("cancel-decision"));
    await user.type(within(screen.getByRole("dialog")).getByRole("textbox"), "잘못 확정했다");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "확정 취소" }));

    const keys = () => spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    await waitFor(() => expect(keys()).toContain(JSON.stringify(queryKeys.document("p1", "doc-aaa"))));
    expect(keys()).toContain(JSON.stringify(["projects", "p1", "review-requests"]));
    expect(keys()).toContain(JSON.stringify(["projects", "p1", "weekly-summary"]));
    expect(keys()).toContain(JSON.stringify(["projects", "p1", "startable"]));
    // 키 리터럴을 눈으로 맞추면 런타임 부분 일치가 안 걸리는 결함을 그대로 통과시킨다 — TanStack 자신의
    // 매처로 **실행해서** 확인한다(12·13차 리뷰).
    const invalidated = spy.mock.calls
      .map((c) => c[0]?.queryKey)
      .filter((k): k is readonly unknown[] => Array.isArray(k));
    expect(invalidated.some((k) => partialMatchKey(queryKeys.readiness("p1", "ACT-100"), k))).toBe(true);
    spy.mockRestore();
  });

  // ---- 오류 안내(새 code 셋) ----

  it("사유 없는 취소가 서버에서 막히면 '사유'를 말하고 '새로고침'은 말하지 않는다", async () => {
    // 화면이 먼저 잠그므로 이 응답은 API 직접 호출·잠금 누락 시의 최종 방어다 — 그런 자리일수록
    // 안내가 정확해야 한다. 이 상황에서 새로고침은 아무것도 바꾸지 않는다(서버 상태는 최신이다).
    mockPage(CONFIRMED_MAPPING, {
      cancel: { status: 409, body: { detail: "cancelling the cm decision ... requires a non-empty reason", code: "cancel_reason_required" } },
    });
    renderPage();
    const user = userEvent.setup();
    await screen.findByTestId("mapping-row");
    await user.click(screen.getByTestId("cancel-decision"));
    await user.type(within(screen.getByRole("dialog")).getByRole("textbox"), "사유");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "확정 취소" }));

    const alert = await screen.findByRole("alert");
    const text = alert.textContent ?? "";
    expect(text).toMatch(/사유/);
    expect(text).not.toMatch(/새로고침/);
    expect(text).not.toMatch(/반려하려면/);          // 취소는 반려가 아니라 반려를 되돌리는 일이다
    expect(text).not.toMatch(/확정을 되돌리려면/);   // 취소는 반려 방향에서도 걸린다
    expect(text).not.toMatch(/non-empty reason/);    // 서버 detail 을 그대로 노출하는 폴백이 아니다
  });

  it("취소할 결정이 없다는 409 는 '사유'를 요구하지 않고 원인을 하나로 지어내지도 않는다", async () => {
    mockPage(CONFIRMED_MAPPING, {
      cancel: { status: 409, body: { detail: "no cm decision to cancel ...", code: "mapping_decision_not_cancellable" } },
    });
    renderPage();
    const user = userEvent.setup();
    await screen.findByTestId("mapping-row");
    await user.click(screen.getByTestId("cancel-decision"));
    await user.type(within(screen.getByRole("dialog")).getByRole("textbox"), "사유");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "확정 취소" }));

    const text = (await screen.findByRole("alert")).textContent ?? "";
    expect(text).not.toMatch(/사유를 입력/);                        // 빠진 것은 사유가 아니다
    expect(text).not.toMatch(/다른 담당자가 이미 이 검토요청을 처리했습니다/);  // 취소의 대상은 검토요청이 아니다
    expect(text).not.toMatch(/no cm decision/);                     // 서버 detail 폴백이 아니다
  });

  it("반려된 매핑을 확정하려다 막히면 '먼저 취소하라'고 말한다 — '되돌릴 수 없다'가 아니다", async () => {
    // ADR 0013 이 이 code 의 뜻을 좁혔다(반려는 재계산에 대해서만 영구하다). 화면이 "되돌릴 수 없다"고
    // 말하면 그 순간 서버에 없는 제약을 지어내는 것이 된다.
    // 오늘 이 화면은 반려된 행에 확정 버튼을 내지 않으므로(위 블록의 회귀) 확정 경로는 **검토 대기**
    // 행에서 태우고 서버 응답만 그 409 로 둔다 — 확인하는 것은 code → 문구 매핑이다.
    mockPage(PENDING_MAPPING, {
      confirm: { status: 409, body: { detail: "document mapping already rejected: ...", code: "document_mapping_already_rejected" } },
    });
    renderPage();
    const user = userEvent.setup();
    await screen.findByTestId("mapping-row");
    await user.click(screen.getByRole("button", { name: "확정" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "확정" }));

    const text = (await screen.findByRole("alert")).textContent ?? "";
    expect(text).toMatch(/취소/);
    expect(text).not.toMatch(/되돌릴 수 없|영구/);
    expect(text).not.toMatch(/already rejected/);   // 서버 detail 폴백이면 한국어 안내가 없다는 뜻이다
  });

  // ---- 반려 블록의 취소 안내 ----

  it("반려 안내는 되살릴 길이 있다고 말한다 — 취소 라우트가 생긴 뒤로 '되돌릴 수 없다'는 거짓이다", async () => {
    mockPage(REJECTED_MAPPING);
    renderPage();
    const row = await screen.findByTestId("mapping-row");
    const rejection = within(row).getByTestId("mapping-rejection");
    const text = rejection.textContent ?? "";
    // 그대로 참인 것(재계산 축의 영구성)은 계속 요구한다 — ADR 0013 은 `_drop_already_confirmed` 를
    // 바꾸지 않는다(서버 회귀: tests/integration/test_15_…::test_rejected_pair_is_not_recreated_…).
    expect(text).toMatch(/다시 제안되지 않습니다/);
    // 그 상황에서 참일 수 없는 말: 되돌릴 길이 없다는 선언.
    expect(text).not.toMatch(/되돌릴 수 없|취소할 수 없|영구/);
    expect(text).toMatch(/취소/);
  });
});
