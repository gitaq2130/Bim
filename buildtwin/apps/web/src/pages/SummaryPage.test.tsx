import { screen, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import type { WeeklySummary } from "../api/types";
import { loginAs, mockFetch, renderWithProviders, resetStore } from "../test/utils";
import { SummaryPage } from "./SummaryPage";

const SUMMARY: WeeklySummary = {
  project_id: "p1",
  week_start: "2026-08-24",
  week_end: "2026-08-30",
  state_distribution: [],
  confirmed_this_week: 3,
  open_reviews: 5,
  startable: [
    {
      activity_id: "ACT-1",
      name: "1F 기둥 철근",
      readiness: 0.6,
      confidence: 0.8,
      blockers: [
        {
          component: "drawing_approval",
          reason: '1건의 필수 문서가 미승인: 동부-HG-TFA-전기-26-049 «1F 기둥 배근도 승인요청» (REJECTED)',
          related_ids: ["doc-aaa"],
          severity: "high",
        },
      ],
    },
    {
      activity_id: "ACT-2",
      name: "2F 슬래브 배근",
      readiness: 0.7,
      confidence: 0.5,
      blockers: [
        {
          component: "drawing_approval",
          reason: "문서 매핑 2건이 CM 검토 대기 — 확정 전까지 도면 승인 근거로 쓰지 않음",
          related_ids: ["doc-bbb", "doc-ccc"],
          severity: "medium",
        },
      ],
    },
    {
      activity_id: "ACT-3",
      name: "3F 슬래브 배근",
      readiness: 0.5,
      confidence: 0.5,
      blockers: [
        {
          component: "drawing_approval",
          reason: '동부-HG-TFA-전기-26-051 «3F 슬래브 배근도 승인요청» 처리결과 미기재(UNKNOWN)',
          related_ids: ["doc-ddd"],
          severity: "high",
        },
      ],
    },
    {
      activity_id: "ACT-4",
      name: "선행 콘크리트 타설",
      readiness: 0.4,
      confidence: 0.9,
      blockers: [{ component: "predecessor_completion", reason: "1/2 predecessor activities not CONFIRMED", related_ids: ["ACT-0"], severity: "high" }],
    },
  ],
};

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:id/summary" element={<SummaryPage />} />
    </Routes>,
    { route: "/projects/p1/summary" },
  );
}

describe("SummaryPage — drawing_approval blocker (ADR 0007 §5-3)", () => {
  beforeEach(() => {
    resetStore();
    loginAs("cm");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("세 갈래(미승인 문서 / 매핑 검토대기 / 처리결과 미기재)를 서로 다른 갈래 이름으로 구분한다", async () => {
    mockFetch((url) => {
      if (url.includes("/api/projects/p1/weekly-summary")) return { body: SUMMARY };
      return undefined;
    });
    renderPage();

    expect(await screen.findByText("미승인 문서")).toBeInTheDocument();
    expect(screen.getByText("매핑 검토 대기")).toBeInTheDocument();
    expect(screen.getByText("처리결과 미기재")).toBeInTheDocument();
  });

  it("drawing_approval 의 related_ids(doc_id)는 문서 상세로 이동하는 링크다", async () => {
    mockFetch((url) => {
      if (url.includes("/api/projects/p1/weekly-summary")) return { body: SUMMARY };
      return undefined;
    });
    renderPage();

    await screen.findByText("미승인 문서");
    const link = screen.getByRole("link", { name: "doc-aaa" });
    expect(link).toHaveAttribute("href", "/projects/p1/documents/doc-aaa");
    expect(screen.getByRole("link", { name: "doc-bbb" })).toHaveAttribute("href", "/projects/p1/documents/doc-bbb");
  });

  it("drawing_approval 이 아닌 구성요소(predecessor_completion)의 related_ids는 문서 링크로 만들지 않는다", async () => {
    mockFetch((url) => {
      if (url.includes("/api/projects/p1/weekly-summary")) return { body: SUMMARY };
      return undefined;
    });
    renderPage();

    await screen.findByText(/predecessor activities not CONFIRMED/);
    const row = screen.getByText(/predecessor activities not CONFIRMED/).closest("li")!;
    expect(within(row).queryByRole("link")).not.toBeInTheDocument();
  });
});
