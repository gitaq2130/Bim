/**
 * 검토요청 목록. kind 필터, 상충 근거(신고/스캔/논리) 나란히, CM 승인/반려/보류.
 */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useProjectRole, useResolveReview, useReviewRequests } from "../api/hooks";
import type { ConflictingSource, ReviewDecision, ReviewKind, ReviewRequest, ReviewStatus } from "../api/types";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorBox } from "../components/ErrorBox";
import { REVIEW_KIND_LABELS, REVIEW_STATUS_LABELS, SOURCE_AXIS_LABELS, labelForAnyState } from "../domain/labels";
import { fmtDate } from "../lib/format";
import { useStore } from "../store";

const DECISION_LABELS: Record<ReviewDecision, string> = { approved: "승인", rejected: "반려", on_hold: "보류" };
const AXES = ["daily_report", "scan", "system_logic"] as const;

export function ReviewsPage() {
  const { id: projectId = "" } = useParams();
  const [kind, setKind] = useState<ReviewKind | "">("");
  const [status, setStatus] = useState<ReviewStatus | "">("open");
  // ADR 0006: 승인/반려/보류는 이 프로젝트에서의 역할(project role)로 가른다 — 전역 auth.role 이 아니다.
  const { role } = useProjectRole(projectId);
  const list = useReviewRequests(projectId, kind, status);
  const resolve = useResolveReview(projectId);
  const [pending, setPending] = useState<{ r: ReviewRequest; decision: ReviewDecision } | null>(null);

  return (
    <div className="page">
      <h1>검토요청</h1>
      <div className="row gap">
        <label>
          종류
          <select value={kind} onChange={(e) => setKind(e.target.value as ReviewKind | "")} data-testid="kind-filter">
            <option value="">전체</option>
            {(Object.keys(REVIEW_KIND_LABELS) as ReviewKind[]).map((k) => (
              <option key={k} value={k}>
                {REVIEW_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          상태
          <select value={status} onChange={(e) => setStatus(e.target.value as ReviewStatus | "")}>
            <option value="">전체</option>
            {(Object.keys(REVIEW_STATUS_LABELS) as ReviewStatus[]).map((k) => (
              <option key={k} value={k}>
                {REVIEW_STATUS_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ErrorBox error={list.error} />
      <ErrorBox error={resolve.error} />
      {list.isPending && <p>불러오는 중…</p>}
      {list.data && list.data.length === 0 && <p className="muted">검토요청이 없습니다.</p>}
      <ul className="list">
        {list.data?.map((r) => (
          <li key={r.review_request_id} className="card col gap" data-testid="review-row">
            <div className="row gap">
              <span className="badge neutral">{REVIEW_KIND_LABELS[r.kind]}</span>
              <span className={`badge status-${r.status}`}>{REVIEW_STATUS_LABELS[r.status]}</span>
              <strong>{r.title}</strong>
              <div className="spacer" />
              <ConfidenceBadge confidence={r.confidence} evidence={r.evidence} />
            </div>
            <div className="muted small">
              {fmtDate(r.created_at)}
              {r.global_id && (
                <>
                  {" · 객체 "}
                  <Link to={`/projects/${projectId}/viewer`} onClick={() => useStore.getState().selection.set("panel", [r.global_id!], [])}>
                    {r.global_id}
                  </Link>
                </>
              )}
              {r.activity_id && ` · Activity ${r.activity_id}`}
              {r.rule_id && ` · 규칙 ${r.rule_id}`}
            </div>
            {/* ADR 0007 §4 규칙 6: document_mapping 은 신고/스캔/논리 3축 충돌이 아니라 문서↔Activity 매핑
                제안 하나다 — 축 카드 대신 매핑 근거(제목유사도·일치 규칙)와 문서 링크를 보여준다. */}
            {r.kind === "document_mapping" ? (
              <DocumentMappingCard review={r} projectId={projectId} />
            ) : (
              <div className="sources">
                {AXES.map((axis) => (
                  <SourceCard key={axis} axis={axis} src={r.conflicting_sources?.[axis] ?? null} />
                ))}
              </div>
            )}
            {r.resolution_note && (
              <p className="small">
                처리 메모: {r.resolution_note} {r.resolved_by && `(${r.resolved_by})`}
              </p>
            )}
            {role === "cm" && r.status === "open" && (
              <div className="row gap">
                {(Object.keys(DECISION_LABELS) as ReviewDecision[]).map((d) => (
                  <button key={d} type="button" className={d === "approved" ? "primary" : ""} onClick={() => setPending({ r, decision: d })} disabled={resolve.isPending}>
                    {DECISION_LABELS[d]}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={pending !== null}
        title={pending ? `${DECISION_LABELS[pending.decision]} — ${pending.r.title}` : ""}
        message={pending?.decision === "approved" ? "승인하면 해당 객체/매핑이 CM 확인으로 기록됩니다." : undefined}
        confirmLabel={pending ? DECISION_LABELS[pending.decision] : "확인"}
        requireNote={pending?.decision === "rejected"}
        busy={resolve.isPending}
        onCancel={() => setPending(null)}
        onConfirm={(note) => {
          if (!pending) return;
          resolve.mutate({ reviewRequestId: pending.r.review_request_id, decision: pending.decision, note: note || undefined }, { onSettled: () => setPending(null) });
        }}
      />
    </div>
  );
}

/**
 * 문서↔Activity 매핑 검토요청(ADR 0007 §4). 시스템이 만든 매핑은 confidence 와 무관하게 항상
 * needs_review=True 이므로(§4 규칙 5), CM 이 "왜 이 매핑이 제안됐는가"를 보고 판단해야 한다 —
 * evidence.extra.title_similarity/matched_rules 를 팝오버 뒤에 숨기지 않고 바로 드러낸다.
 * 문서 링크는 evidence.source_id(= doc_id, §4 규칙 7)로 문서 상세로 이동한다.
 */
function DocumentMappingCard({ review, projectId }: { review: ReviewRequest; projectId: string }) {
  const ev = review.evidence;
  const extra = (ev?.extra ?? {}) as { title_similarity?: number; matched_rules?: string[]; excluded_by?: string[] };
  const docId = ev?.source_type === "document" ? ev.source_id : undefined;
  return (
    <div className="source-card" data-testid="document-mapping-card">
      <div className="source-title">매핑 근거</div>
      <div>
        문서:{" "}
        {docId ? (
          <Link to={`/projects/${projectId}/documents/${encodeURIComponent(docId)}`}>{ev?.note ?? docId}</Link>
        ) : (
          <span className="muted">알 수 없음</span>
        )}
      </div>
      {review.activity_id && <div className="small">Activity: {review.activity_id}</div>}
      {typeof extra.title_similarity === "number" && (
        <div className="small">제목 유사도: {Math.round(extra.title_similarity * 100)}%</div>
      )}
      {extra.matched_rules && extra.matched_rules.length > 0 && (
        <div className="small">일치 규칙: {extra.matched_rules.join(", ")}</div>
      )}
    </div>
  );
}

function SourceCard({ axis, src }: { axis: string; src: ConflictingSource | null }) {
  return (
    <div className="source-card" data-axis={axis}>
      <div className="source-title">{SOURCE_AXIS_LABELS[axis] ?? axis}</div>
      {!src ? (
        <div className="muted">근거 없음</div>
      ) : (
        <>
          <div>
            <strong>{labelForAnyState(src.state ?? src.claimed_state)}</strong>
          </div>
          {src.summary && <div className="small">{src.summary}</div>}
          <ConfidenceBadge confidence={src.confidence ?? null} evidence={src.evidence ?? null} />
        </>
      )}
    </div>
  );
}
