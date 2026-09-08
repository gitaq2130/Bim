import { render, screen, within } from "@testing-library/react";
import type { DocumentApprovalStatus } from "../api/types";
import { ApprovalStatusBadge, ApprovalStatusNote } from "./ApprovalStatusBadge";

/**
 * ADR 0007 §3: 승인 상태 6개는 반드시 시각적으로 구분해야 한다. 특히 UNKNOWN 은 "모름"이지 REJECTED
 * ("확실한 부정")가 아니다 — 라벨과 색이 겹치면 화면이 거짓말을 한다.
 */
describe("ApprovalStatusBadge", () => {
  it("6개 상태 모두 서로 다른 라벨을 그린다", () => {
    const statuses: DocumentApprovalStatus[] = ["APPROVED", "APPROVED_WITH_COMMENTS", "REJECTED", "RESUBMIT_REQUIRED", "IN_REVIEW", "UNKNOWN"];
    const labels = statuses.map((s) => {
      const { unmount } = render(<ApprovalStatusBadge status={s} />);
      const text = screen.getByText((_, el) => el?.tagName === "SPAN" && el.getAttribute("data-approval-status") === s)?.textContent;
      unmount();
      return text;
    });
    expect(new Set(labels).size).toBe(statuses.length);
  });

  it("UNKNOWN은 '모름'을 표시하고 REJECTED와 다른 라벨/문구를 쓴다 — 승인 아님이지 반려가 아니다", () => {
    const badge = render(<ApprovalStatusBadge status="UNKNOWN" />);
    expect(within(badge.container).getByText(/모름/)).toBeInTheDocument();
    expect(within(badge.container).queryByText("반려")).not.toBeInTheDocument();
    badge.unmount();

    render(<ApprovalStatusNote status="UNKNOWN" />);
    expect(screen.getByText(/반려가 아니라/)).toBeInTheDocument();
  });

  it("APPROVED_WITH_COMMENTS는 APPROVED와 다른 배지 색/문구를 쓰고, 승인으로 간주하지 않는다는 설명을 붙인다", () => {
    const approved = render(<ApprovalStatusBadge status="APPROVED" />);
    const approvedBg = approved.getByText("승인").style.background;
    approved.unmount();

    const withComments = render(<ApprovalStatusBadge status="APPROVED_WITH_COMMENTS" />);
    const withCommentsEl = withComments.getByText("조건부승인");
    expect(withCommentsEl.style.background).not.toBe(approvedBg);

    render(<ApprovalStatusNote status="APPROVED_WITH_COMMENTS" />);
    expect(screen.getByText(/승인으로 간주하지 않습니다/)).toBeInTheDocument();
  });

  it("REJECTED / RESUBMIT_REQUIRED / IN_REVIEW / APPROVED 는 부가 설명(Note)이 없다 — 배지만으로 충분하다", () => {
    for (const s of ["REJECTED", "RESUBMIT_REQUIRED", "IN_REVIEW", "APPROVED"] as DocumentApprovalStatus[]) {
      const { container, unmount } = render(<ApprovalStatusNote status={s} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});
