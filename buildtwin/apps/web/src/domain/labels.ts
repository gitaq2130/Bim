/**
 * 화면 라벨. 상태 라벨·색상은 viewer3d 배럴(colors.ts = docs/glossary.md)에서 import 한다 — 중복 정의 금지.
 * ESTIMATED_DONE 은 절대 "완료"로 표시하지 않는다 ("완료추정").
 */
import type {
  Actor,
  ClaimedState,
  DocumentApprovalStatus,
  DocumentType,
  JobKind,
  ReviewKind,
  ReviewStatus,
  ScanState,
  UserRole,
} from "../api/types";

import { STATE_LABELS_KO } from "../viewer3d";

export { STATE_COLORS, STATE_LABELS_KO, colorForState } from "../viewer3d";

export const SCAN_STATE_LABELS: Record<ScanState, string> = {
  NOT_BUILT: "미시공",
  IN_PROGRESS: "시공중",
  ESTIMATED_DONE: "완료추정",
  MISMATCH: "위치불일치",
  UNVERIFIABLE: "확인불가(가림)",
};

// ---- ADR 0007: 문서관리대장 ----
export const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  TFA: "TFA(승인/검토/참조 요청서)",
  TFR: "TFR(자료제출서)",
  FI: "FI(현장지시)",
  SCAR: "SCAR(시정조치요구)",
  NCR: "NCR(부적합보고)",
  DN: "DN(통보)",
  VE: "VE(설계변경/가치공학)",
  RFI: "RFI(질의회신)",
  other: "기타",
};

/**
 * 승인 상태 6개는 반드시 시각적으로 구분한다 — 뭉뚱그리면 화면이 거짓말을 한다(ADR 0007 §3).
 * 특히 UNKNOWN 은 "승인 아님"이되 REJECTED("확실한 부정")와는 다른 값이다: 대장 처리결과가 공란이거나
 * 해석 불가라는 뜻이지 반려됐다는 뜻이 아니다. APPROVED_WITH_COMMENTS(조건부승인)도 APPROVED 와 다르게
 * 보여준다 — 조건 충족 여부가 대장에 없어 착수 가능 여부를 알 수 없다(§3-3).
 */
export const APPROVAL_STATUS_LABELS: Record<DocumentApprovalStatus, string> = {
  APPROVED: "승인",
  APPROVED_WITH_COMMENTS: "조건부승인",
  REJECTED: "반려",
  RESUBMIT_REQUIRED: "재제출요청",
  IN_REVIEW: "검토중",
  UNKNOWN: "미기재(모름)",
};

/** 승인=녹색, 조건부승인=주황(승인 아님을 알리는 경고색), 반려/재제출=빨강 계열(확실한 부정),
 * 검토중=파랑(중립·진행중), UNKNOWN=회색(모름 — 반려의 빨강과 겹치지 않게 중립색을 쓴다). */
export const APPROVAL_STATUS_COLORS: Record<DocumentApprovalStatus, string> = {
  APPROVED: "#bbf7d0",
  APPROVED_WITH_COMMENTS: "#fdba74",
  REJECTED: "#fecaca",
  RESUBMIT_REQUIRED: "#fbb6b6",
  IN_REVIEW: "#e0e7ff",
  UNKNOWN: "#e2e8f0",
};

export const ACTOR_LABELS: Record<Actor, string> = {
  system: "시스템",
  contractor: "시공사",
  cm: "CM",
};

export const ROLE_LABELS: Record<UserRole, string> = {
  contractor: "시공사",
  cm: "CM",
  client: "발주처",
  admin: "관리자",
};

export const REVIEW_KIND_LABELS: Record<ReviewKind, string> = {
  mapping: "매핑",
  verification: "검증",
  inspection: "검측",
  // ADR 0007 §4 규칙 6: 문서↔Activity 매핑 검토(해소는 services/progress 소유)
  document_mapping: "문서매핑",
};

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  open: "미결",
  approved: "승인",
  rejected: "반려",
  on_hold: "보류",
};

export const CLAIMED_STATE_LABELS: Record<ClaimedState, string> = {
  started: "착수",
  in_progress: "진행중",
  completed: "완료 신고",
};

export const JOB_KIND_LABELS: Record<JobKind, string> = {
  ingest: "파싱",
  scan_upload: "스캔 등록",
  schedule: "공정표",
  mapping: "매핑",
  verdict: "정합·판정",
  // ADR 0007 §8 규칙 2: 문서관리대장(xlsx) 적재 + 문서↔Activity 매핑 후보 생성
  document_register: "문서관리대장 적재",
};

export const SOURCE_AXIS_LABELS: Record<string, string> = {
  daily_report: "신고(작업일보)",
  scan: "스캔(물리 증거)",
  system_logic: "논리(BIM·선후행·자재)",
};

/** 임의 상태 문자열을 안전하게 라벨링 (ObjectState/ScanState/claimed 모두 허용) */
export function labelForAnyState(s: string | null | undefined): string {
  if (!s) return "-";
  const tables: Record<string, string>[] = [SCAN_STATE_LABELS, CLAIMED_STATE_LABELS];
  // ObjectState 우선
  const os = (STATE_LABELS_KO as Record<string, string>)[s];
  if (os) return os;
  for (const t of tables) if (t[s]) return t[s];
  return s;
}
