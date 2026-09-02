/**
 * 화면 라벨. 상태 라벨·색상은 viewer3d 배럴(colors.ts = docs/glossary.md)에서 import 한다 — 중복 정의 금지.
 * ESTIMATED_DONE 은 절대 "완료"로 표시하지 않는다 ("완료추정").
 */
import type { Actor, ClaimedState, JobKind, ReviewKind, ReviewStatus, ScanState, UserRole } from "../api/types";

import { STATE_LABELS_KO } from "../viewer3d";

export { STATE_COLORS, STATE_LABELS_KO, colorForState } from "../viewer3d";

export const SCAN_STATE_LABELS: Record<ScanState, string> = {
  NOT_BUILT: "미시공",
  IN_PROGRESS: "시공중",
  ESTIMATED_DONE: "완료추정",
  MISMATCH: "위치불일치",
  UNVERIFIABLE: "확인불가(가림)",
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
