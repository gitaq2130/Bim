/**
 * `drawing_approval` blocker(ADR 0007 §5-3) 문구 분류. `Blocker` 모델은 바뀌지 않았으므로(component/reason/
 * related_ids/severity 그대로) 화면은 `reason`의 고정 한국어 문구로 세 갈래를 구분한다 — 이 문구들은
 * `services/progress/readiness.py`(_unapproved_reason, drawing_component)가 커밋한 정확한 표현이다.
 *
 * 셋은 CM이 해야 할 행동이 다르다: 미승인 문서는 그 문서를 쫓고, 미확정 매핑은 매핑을 확정하고,
 * 처리결과 미기재(UNKNOWN)는 대장을 갱신해야 한다. related_ids 는 세 경우 모두 doc_id 다(§5-3 — "doc_number가
 * 아니라 doc_id다") 이므로 어느 갈래든 문서 상세로 링크할 수 있다.
 */
export type DrawingApprovalBlockerKind = "unapproved" | "pending_mapping" | "unknown_only" | "other";

/** 서버 `Blocker.kind`(services/progress/readiness.py 의 BLOCKER_KIND_*) → 화면 갈래. */
const SERVER_KIND_TO_LOCAL: Record<string, DrawingApprovalBlockerKind> = {
  document_unapproved: "unapproved",
  document_status_unknown: "unknown_only",
  document_mapping_pending: "pending_mapping",
};

/**
 * 갈래 판정. **`kind` 가 있으면 그것만 믿는다.**
 *
 * 문구 매칭은 `kind` 가 없는 응답(이 필드 도입 이전 서버)만을 위한 폴백이다. 산문을 부분 문자열로
 * 분류하면 서버가 문구를 다듬는 순간 조용히 "other" 로 떨어져 CM 이 다음 행동 안내를 잃는다 —
 * 오류 응답에 기계 판독 code 를 둔 것과 같은 이유로 `kind` 를 우선한다.
 */
export function classifyDrawingApprovalBlocker(reason: string, kind?: string | null): DrawingApprovalBlockerKind {
  if (kind) return SERVER_KIND_TO_LOCAL[kind] ?? "other";
  if (reason.includes("CM 검토 대기")) return "pending_mapping";
  if (reason.includes("건의 필수 문서가 미승인")) return "unapproved";
  if (reason.includes("처리결과 미기재(UNKNOWN)")) return "unknown_only";
  return "other";
}

export const DRAWING_APPROVAL_BLOCKER_LABELS: Record<DrawingApprovalBlockerKind, string> = {
  unapproved: "미승인 문서",
  pending_mapping: "매핑 검토 대기",
  unknown_only: "처리결과 미기재",
  other: "",
};

/** CM이 해야 할 다음 행동 — 세 갈래를 뭉개지 않도록 화면에 그대로 노출한다. */
export const DRAWING_APPROVAL_BLOCKER_ACTIONS: Record<DrawingApprovalBlockerKind, string> = {
  unapproved: "해당 문서의 승인 진행 상황을 확인하세요.",
  pending_mapping: "문서 매핑 검토 큐에서 확정하세요 — 확정 전까지 도면 승인 근거로 쓰이지 않습니다.",
  unknown_only: "대장을 재업로드하거나 처리결과를 확인하세요.",
  other: "",
};
