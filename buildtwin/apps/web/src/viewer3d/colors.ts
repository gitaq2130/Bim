/**
 * 상태별 색상 맵. 변경 시 docs/glossary.md 도 갱신한다.
 * 이 모듈은 색만 칠한다 — 상태를 판단하거나 전이시키지 않는다.
 */
import type { ObjectState } from "./types";

export const STATE_COLORS: Record<ObjectState, string> = {
  PLANNED: "#9E9E9E",
  REPORTED: "#FFD600",
  IN_PROGRESS: "#FFD600",
  ESTIMATED_DONE: "#AEEA00",
  INSPECTION_REQUESTED: "#FF6D00",
  CONFIRMED: "#00C853",
  MISMATCH: "#D50000",
  UNVERIFIABLE: "#AA00FF",
};

export const STATE_LABELS_KO: Record<ObjectState, string> = {
  PLANNED: "미시공",
  REPORTED: "신고됨",
  IN_PROGRESS: "시공중",
  ESTIMATED_DONE: "완료추정",
  INSPECTION_REQUESTED: "검측요청",
  CONFIRMED: "확정",
  MISMATCH: "위치불일치",
  UNVERIFIABLE: "확인불가",
};

/** 상태가 지정되지 않은 객체의 기본 색 */
export const DEFAULT_STATE: ObjectState = "PLANNED";

/** 하이라이트(선택) 강조색 — 상태색과 겹치지 않는 파랑 */
export const HIGHLIGHT_EMISSIVE = "#1E88E5";
export const EDGE_COLOR = "#0D47A1";

export function colorForState(state: ObjectState | undefined | null): string {
  return STATE_COLORS[state ?? DEFAULT_STATE] ?? STATE_COLORS[DEFAULT_STATE];
}
