/**
 * 문서↔Activity 매핑의 **검토 결과** 판정 (ADR 0007 §4-2 규칙 6 ⑥, 10차 리뷰 후속).
 *
 * `ActivityDocumentMappingRow.reviewed_by`는 확정과 반려가 **공유**하는 필드다 — "누가 이 쌍을
 * 판단했는가"만 담고, 어느 쪽으로 판단했는지는 담지 않는다. 그래서 `needs_review`는 확정이든 반려든
 * 똑같이 `False`가 된다(`needs_review = (reviewed_by is None)` 불변식, packages/core/models/document.py).
 *
 * **`needs_review`/`reviewed_by`만으로 "확정됐다"를 판별하면 반려를 확정으로 읽는다.** ADR 이 이것을
 * 저장소 불변식으로 못박았고 서버는 두 곳(`confirmed_required_documents`,
 * `_reopen_reviews_for_invalidated_confirmations`)에서 지킨다. 10차 리뷰가 잡은 것은 **화면이 그 불변식을
 * 지키지 않아** CM 이 자기가 반려한 매핑을 "확정됨 / 확정: 나"로 보게 되던 결함이다 — 판정을 이 한 곳으로
 * 모아 각 화면이 따로 분기하다 빠뜨리는 일을 막는다.
 *
 * 서버 쪽 대응은 `services/progress/document_mapper.py`의 `is_rejected_mapping`(공개 함수)이며 같은 키를 본다.
 */
import type { ActivityDocumentMapping } from "../api/types";

/** `services/progress/document_mapper.py`의 `_MAPPING_REVIEW_DECISION_REJECTED`와 같은 값이어야 한다. */
const REJECTED = "rejected";

export type MappingReviewState = "pending" | "confirmed" | "rejected";

/**
 * 매핑의 검토 결과. `reviewed_by`가 채워져 있어도 `evidence.extra.mapping_review_decision`이
 * `"rejected"`면 **반려**이지 확정이 아니다.
 */
export function mappingReviewState(mapping: ActivityDocumentMapping): MappingReviewState {
  if (mapping.needs_review) return "pending";
  const decision = (mapping.evidence.extra ?? {})["mapping_review_decision"];
  return decision === REJECTED ? "rejected" : "confirmed";
}

/** 반려 감사 정보(`reject_document_mapping`이 evidence 에 남긴 것). 없으면 각 필드가 undefined. */
export function mappingRejection(mapping: ActivityDocumentMapping): {
  rejectedBy?: string;
  rejectedAt?: string;
  note?: string;
} {
  const extra = (mapping.evidence.extra ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return { rejectedBy: str(extra.rejected_by), rejectedAt: str(extra.rejected_at), note: str(extra.rejection_note) };
}

export const MAPPING_REVIEW_STATE_LABELS: Record<MappingReviewState, string> = {
  pending: "검토 대기",
  confirmed: "확정됨",
  rejected: "반려됨",
};
