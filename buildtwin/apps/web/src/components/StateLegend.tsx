import { OBJECT_STATES } from "../api/types";
import { STATE_COLORS, STATE_LABELS_KO } from "../domain/labels";

/** 상태 색상 범례 — viewer3d/colors.ts 값을 그대로 쓴다 */
export function StateLegend() {
  return (
    <ul className="legend" aria-label="상태 범례">
      {OBJECT_STATES.map((s) => (
        <li key={s}>
          <span className="swatch" style={{ background: STATE_COLORS[s] }} />
          {STATE_LABELS_KO[s]}
        </li>
      ))}
    </ul>
  );
}
