/**
 * confidence(%) + "근거" 팝오버. 모든 판정·매핑·readiness 표시에 붙인다 (CLAUDE.md 공통 규칙 3).
 */
import { useEffect, useRef, useState } from "react";
import type { Evidence } from "../api/types";
import { pct } from "../lib/format";

export function EvidencePopover({ evidence, label = "근거" }: { evidence: Evidence | null | undefined; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!evidence) return <span className="muted">근거 없음</span>;

  const rows: [string, string][] = [];
  rows.push(["source_type", evidence.source_type]);
  rows.push(["source_id", evidence.source_id]);
  if (evidence.method) rows.push(["method", evidence.method]);
  if (evidence.rule_id) rows.push(["rule_id", evidence.rule_id]);
  if (evidence.bbox) rows.push(["bbox", `min ${evidence.bbox.min.join(", ")} / max ${evidence.bbox.max.join(", ")}`]);
  if (evidence.coordinates && evidence.coordinates.length) rows.push(["coordinates", evidence.coordinates.map((c) => `(${c.join(", ")})`).join(" ")]);
  if (evidence.note) rows.push(["note", evidence.note]);
  if (evidence.extra && Object.keys(evidence.extra).length) rows.push(["extra", JSON.stringify(evidence.extra)]);

  return (
    <span className="popover-anchor" ref={ref}>
      <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="근거">
          <table className="kv">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}>
                  <th>{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
              {evidence.file_uri && (
                <tr>
                  <th>file_uri</th>
                  <td>
                    <a href={evidence.file_uri} target="_blank" rel="noreferrer">
                      {evidence.file_uri}
                    </a>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </span>
  );
}

export function ConfidenceBadge({
  confidence,
  evidence,
  showEvidence = true,
}: {
  confidence: number | null | undefined;
  evidence?: Evidence | null;
  showEvidence?: boolean;
}) {
  const c = confidence ?? null;
  const cls = c === null ? "conf conf-na" : c >= 0.9 ? "conf conf-high" : c >= 0.7 ? "conf conf-mid" : "conf conf-low";
  return (
    <span className="conf-wrap">
      <span className={cls} title="confidence">
        {pct(c)}
      </span>
      {showEvidence && <EvidencePopover evidence={evidence} />}
    </span>
  );
}
