import type { ObjectState, ScanState } from "../api/types";
import { SCAN_STATE_LABELS, STATE_COLORS, STATE_LABELS_KO } from "../domain/labels";
import { textColorFor } from "../lib/color";

export function StateBadge({ state }: { state: ObjectState | null | undefined }) {
  if (!state) return <span className="badge">-</span>;
  return (
    <span className="badge" style={{ background: STATE_COLORS[state], color: textColorFor(STATE_COLORS[state]) }} data-state={state}>
      {STATE_LABELS_KO[state] ?? state}
    </span>
  );
}

/** 스캔 판정 — CONFIRMED 는 존재하지 않으며 "완료추정"까지만 표시 */
export function ScanStateBadge({ state }: { state: ScanState | null | undefined }) {
  if (!state) return <span className="badge">-</span>;
  const objectColorKey: Record<ScanState, ObjectState> = {
    NOT_BUILT: "PLANNED",
    IN_PROGRESS: "IN_PROGRESS",
    ESTIMATED_DONE: "ESTIMATED_DONE",
    MISMATCH: "MISMATCH",
    UNVERIFIABLE: "UNVERIFIABLE",
  };
  const color = STATE_COLORS[objectColorKey[state]];
  return (
    <span className="badge" style={{ background: color, color: textColorFor(color) }} data-scan-state={state}>
      {SCAN_STATE_LABELS[state]}
    </span>
  );
}
