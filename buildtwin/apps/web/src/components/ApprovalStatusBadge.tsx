/**
 * 문서 승인 상태(ADR 0007 §3) 배지. 6개 상태를 절대 뭉뚱그리지 않는다 —
 * 특히 UNKNOWN("모름")과 REJECTED("반려")는 색·문구 모두 다르게 그린다.
 */
import type { DocumentApprovalStatus } from "../api/types";
import { APPROVAL_STATUS_COLORS, APPROVAL_STATUS_LABELS } from "../domain/labels";
import { textColorFor } from "../lib/color";

export function ApprovalStatusBadge({ status }: { status: DocumentApprovalStatus }) {
  const bg = APPROVAL_STATUS_COLORS[status];
  return (
    <span className="badge" style={{ background: bg, color: textColorFor(bg) }} data-approval-status={status}>
      {APPROVAL_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * 상태 옆에 붙이는 설명 캡션. UNKNOWN과 APPROVED_WITH_COMMENTS는 배지 문구만으로는 오해하기 쉬워
 * "왜 승인이 아닌지"를 한 줄로 덧붙인다(ADR 0007 §3-2 규칙 1, §3-3). 그 외 상태는 배지로 충분해 null.
 */
export function ApprovalStatusNote({ status }: { status: DocumentApprovalStatus }) {
  if (status === "UNKNOWN")
    return <span className="muted small">대장 처리결과가 공란이거나 해석할 수 없습니다 — 반려가 아니라 "모름"입니다.</span>;
  if (status === "APPROVED_WITH_COMMENTS")
    return <span className="warn small">조건 충족 여부가 대장에 없어 착수 가능 여부를 알 수 없습니다. 승인으로 간주하지 않습니다.</span>;
  return null;
}
