import { screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
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
    expect(keys()).toContain(JSON.stringify(["activities"]));
    spy.mockRestore();
  });
});
