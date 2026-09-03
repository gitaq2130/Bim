import { ApiError, type ApiErrorCode } from "../api/client";

/**
 * 서버 에러 코드 → 한국어 안내 문구. 각 문구는 "무엇이 잘못됐는지" + "다음에 뭘 해야 하는지"를 담는다.
 * status 코드만 보고 원인을 추측하지 않는다 — 같은 409 라도 code 에 따라 원인이 다르다.
 */
const CODE_MESSAGES: Record<ApiErrorCode, string> = {
  // ADR 0005: 같은 GlobalId 객체가 여러 프로젝트에 존재해 서버가 어느 프로젝트인지 특정할 수 없을 때.
  ambiguous_global_id: "이 객체(GlobalId)는 여러 프로젝트에 존재합니다. 프로젝트를 다시 선택한 뒤 시도하세요.",
  // 상태기계 상 허용되지 않는 전이를 시도했을 때.
  invalid_transition: "현재 상태에서는 이 작업을 수행할 수 없습니다. 화면을 새로고침해 최신 상태를 확인하세요.",
  // 열린 검토요청이 있어 다른 전이가 막혔을 때.
  transition_blocked_by_review: "이 객체에 처리되지 않은 검토요청이 있어 전이할 수 없습니다. 먼저 검토요청 페이지에서 처리하세요.",
  // 다른 CM 이 이미 같은 검토요청을 처리했을 때.
  review_already_resolved: "다른 담당자가 이미 이 검토요청을 처리했습니다. 목록을 새로고침해 최신 상태를 확인하세요.",
  // 검측 확정(CONFIRMED) 처리 중 서버 검증에 실패했을 때.
  inspection_confirm_failed: "검측 확정 처리에 실패했습니다. 입력한 근거(evidence)를 확인한 뒤 다시 시도하세요.",
  // 동일 식별자의 프로젝트가 이미 존재할 때.
  duplicate_project: "이미 같은 이름/식별자의 프로젝트가 존재합니다. 다른 이름을 사용하거나 기존 프로젝트를 확인하세요.",
  // 대상 객체를 찾을 수 없을 때.
  object_not_found: "대상 객체를 찾을 수 없습니다. 삭제되었거나 아직 반영되지 않았을 수 있습니다.",
  // 역할 기반 접근 제어에 의해 거부되었을 때(404 forbidden 과 별개로 code 로 명확히 올 때).
  forbidden_role: "권한이 없습니다. 이 작업은 허용된 역할만 수행할 수 있습니다.",
};

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    // 1) code 가 있으면 원인별 한국어 문구로 분기한다 (status 코드만으로는 원인을 고르지 않는다).
    if (e.code && e.code in CODE_MESSAGES) return CODE_MESSAGES[e.code];
    // 2) code 가 없는(구버전/알 수 없는) 에러: 로그인/권한처럼 흔한 두 상태만 문구를 보정하고,
    if (e.status === 401) return "로그인이 필요합니다 (401).";
    if (e.status === 403) return "권한이 없습니다 (403). 이 작업은 허용된 역할만 수행할 수 있습니다.";
    // 3) 그 외에는 서버가 준 detail(e.message)을 상태코드와 함께 그대로 보여준다 — 원인을 지어내지 않는다.
    return `${e.message} (${e.status})`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="error" role="alert">
      {errorText(error)}
    </div>
  );
}
