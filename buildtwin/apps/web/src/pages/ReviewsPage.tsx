/**
 * 검토요청 목록. kind 필터, 상충 근거(신고/스캔/논리) 나란히, CM 승인/반려/보류.
 */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useDocument, useProjectRole, useResolveReview, useReviewRequests } from "../api/hooks";
import type { ConflictingSource, ReviewDecision, ReviewKind, ReviewRequest, ReviewStatus } from "../api/types";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorBox } from "../components/ErrorBox";
import { DOC_TYPE_LABELS, REVIEW_KIND_LABELS, REVIEW_STATUS_LABELS, SOURCE_AXIS_LABELS, labelForAnyState } from "../domain/labels";
import { mappingRejection, mappingReviewState } from "../domain/mappingReview";
import { fmtDate } from "../lib/format";
import { useStore } from "../store";

const DECISION_LABELS: Record<ReviewDecision, string> = { approved: "승인", rejected: "반려", on_hold: "보류" };
const AXES = ["daily_report", "scan", "system_logic"] as const;

/**
 * kind 마다 승인/반려/보류가 실제로 무엇을 바꾸는지가 다르다(9차 리뷰 지적 — 한 문장으로 뭉뚱그리면 반드시
 * 하나는 거짓이 된다). 여기 문구는 각 kind 의 해소 로직(services/api/usecases.resolve_review,
 * services/sync/review_queue.resolve_mapping_review)이 실제로 하는 일과 정확히 대응해야 한다 — 화면이
 * 다시 지키지 못할 약속을 하지 않도록.
 */
function reviewDecisionMessage(kind: ReviewKind, decision: ReviewDecision): string {
  if (decision === "on_hold") {
    // 세 kind 모두 on_hold 는 검토요청 상태만 바꾼다(usecases.resolve_review 공통 폴백) — 객체 상태·매핑 어느 것도 건드리지 않는다.
    return "보류하면 검토요청 상태만 '보류'로 기록됩니다. 객체 상태·매핑은 바뀌지 않습니다.";
  }
  switch (kind) {
    case "inspection":
      return decision === "approved"
        ? "승인하면 이 객체 상태가 확정(CONFIRMED)으로 전이됩니다."
        : "반려하면 객체를 재작업 상태로 되돌리려 시도합니다 — 현재 상태에서 그 전이가 불가능하면 객체 상태는 바뀌지 않고 검토요청만 처리됩니다.";
    case "mapping":
      return decision === "approved"
        ? "승인하면 이 2D 엔티티 ↔ 3D 객체 매핑이 확정됩니다(needs_review=False)."
        : "반려하면 검토요청만 닫히고 매핑은 확정되지 않습니다.";
    case "document_mapping":
      return decision === "approved"
        ? "승인하면 이 문서 ↔ Activity 매핑이 확정됩니다(needs_review=False) — 도면 승인 근거(readiness)로 반영됩니다. 확정 이후에는 사람만 되돌릴 수 있습니다."
        // ADR 0007 §4-2 규칙 6 ⑥: 반려는 (activity_id, doc_id) 쌍에 대해 영구하다. 되돌리는 경로가 없으므로
        // 문구가 그 사실을 정확히 말해야 한다 — 10차 리뷰가 잡은 결함은 이 자리가 정반대("아무것도 바뀌지
        // 않습니다")를 말하는데 실제로는 되돌릴 수 없는 반려가 실행되던 것이다.
        : "반려하면 이 문서 ↔ Activity 매핑에 반려 표시가 남고 검토 큐에서 내려갑니다 — 도면 승인 근거로 쓰이지 않으며, 대장을 재업로드해도 후보로 다시 제안되지 않습니다. 되돌릴 수 없으니 확인 후 진행하세요.";
    case "verification":
    default:
      // verification 은 신고/스캔/논리 3축 불일치를 사람이 확인했다는 기록일 뿐, 어떤 상태 전이도 일으키지 않는다(ADR 0001 §6).
      return "이 종류(검증)는 상태 전이를 일으키지 않습니다 — 검토요청 상태만 기록됩니다.";
  }
}

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
        message={pending ? reviewDecisionMessage(pending.r.kind, pending.decision) : undefined}
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
 * evidence.extra.title_similarity/matched_rules/excluded_by 를 팝오버 뒤에 숨기지 않고 바로 드러낸다.
 * 문서 링크는 evidence.source_id(= doc_id, §4 규칙 7)로 문서 상세로 이동한다. 문서번호·제목·종류는
 * `useDocument`(DocumentDetailPage 와 같은 훅)로 문서 행 자체를 읽어 보여준다 — evidence.note(문서 제목
 * 원문)만으로는 문서번호가 없고, 검토요청 title 산문에서 파싱하는 것은 ADR 0007 §5-3 개정 1이 이미 걷어낸
 * 패턴(기계 판독을 문구 부분일치에 의존)을 반복하는 것이라 피한다.
 */
function DocumentMappingCard({ review, projectId }: { review: ReviewRequest; projectId: string }) {
  const ev = review.evidence;
  const extra = (ev?.extra ?? {}) as {
    title_similarity?: number;
    matched_rules?: string[];
    excluded_by?: string[];
    invalidated_activity_signature?: string;
    invalidation_reason?: string;
  };
  const docId = ev?.source_type === "document" ? ev.source_id : undefined;
  const doc = useDocument(projectId, docId);
  const docRow = doc.data?.document;
  // ADR 0007 §4-2 규칙 6 ⑥: 매핑이 확정인지 반려인지는 **매핑 행**이 정하고, 판정은 domain/mappingReview
  // 한 곳이 소유한다(11차 리뷰). 검토요청 evidence 의 재오픈 표식만 보고 "확정 상태"를 단언하면, 그 뒤
  // CM 이 재확인 요청을 **반려**했을 때 자기가 반려한 매핑을 "여전히 확정 상태"로 읽게 된다 — 10차 blocker 2
  // 와 같은 결함이 화면만 바꿔 재현되는 자리였다. 이 카드는 이미 useDocument 로 매핑까지 들고 있으므로
  // 그 행을 직접 판정한다.
  const mapping = doc.data?.mappings?.find((m) => m.activity_id === review.activity_id);
  const mappingState = mapping ? mappingReviewState(mapping) : undefined;
  const rejection = mapping ? mappingRejection(mapping) : {};
  // ADR 0007 §4-2 규칙 6 ⑤(개정 2): 확정된 매핑이 재계산으로 더는 후보가 아니게 되면 검토요청이 다시
  // open 된다 — 매핑 자체는 확정 상태로 남는다. 이 evidence.extra 필드가 서버가 남기는 유일한 구조적
  // 표식이다(과제 3). title 산문으로 분류하지 않는 이유는 위 참고.
  //
  // 세 조건을 **모두** 만족할 때만 이 안내를 띄운다: 재오픈 표식이 있고, 요청이 아직 열려 있고,
  // 매핑이 실제로 확정 상태여야 한다. 문서 조회가 끝나기 전(mappingState === undefined)에는 띄우지
  // 않는다 — 확정을 단언하는 문구라 모르는 동안 침묵하는 쪽이 안전하다.
  const reopened =
    typeof extra.invalidated_activity_signature === "string" &&
    review.status === "open" &&
    mappingState === "confirmed";
  return (
    <div className="source-card" data-testid="document-mapping-card">
      {reopened && (
        <div className="notice strong" data-testid="reopened-notice">
          <strong>재확인 필요</strong> — CM이 이미 확정한 매핑입니다. 확정 이후 이 Activity 정보가 바뀌어(층·구역·차수
          등) 지금 다시 계산하면 더는 이 매핑을 지지하지 않습니다. <strong>매핑 자체는 여전히 확정 상태입니다</strong>
          — 시스템은 사람의 확정을 되돌리지 않으며, 지금 필요한 것은 이 매핑이 여전히 맞는지 재확인하는 것입니다.
        </div>
      )}
      {mappingState === "rejected" && (
        <div className="notice strong" data-testid="rejected-notice">
          <strong>반려된 매핑입니다</strong> — 도면 승인 근거로 쓰이지 않으며, 대장을 재업로드해도 후보로 다시
          제안되지 않습니다(되돌릴 수 없습니다).
          {rejection.rejectedBy ? ` 반려: ${rejection.rejectedBy}` : ""}
          {rejection.note ? ` — ${rejection.note}` : ""}
        </div>
      )}
      <div className="source-title">매핑 근거</div>
      <div>
        문서:{" "}
        {docId ? (
          <Link to={`/projects/${projectId}/documents/${encodeURIComponent(docId)}`}>{docRow?.title ?? ev?.note ?? docId}</Link>
        ) : (
          <span className="muted">알 수 없음</span>
        )}
        {docRow?.doc_number && <span className="muted small"> · 문서번호 {docRow.doc_number}</span>}
        {docRow?.doc_type && <span className="badge neutral small">{DOC_TYPE_LABELS[docRow.doc_type]}</span>}
        {docRow?.is_orphaned && (
          <span className="badge" style={{ background: "#fecaca" }}>
            고아 문서
          </span>
        )}
      </div>
      {review.activity_id && <div className="small">Activity: {review.activity_id}</div>}
      {typeof extra.title_similarity === "number" && (
        <div className="small">제목 유사도: {Math.round(extra.title_similarity * 100)}%</div>
      )}
      {extra.matched_rules && extra.matched_rules.length > 0 && (
        <div className="small">일치 규칙: {extra.matched_rules.join(", ")}</div>
      )}
      {extra.excluded_by && extra.excluded_by.length > 0 && (
        <div className="small">감점 요인(불일치): {extra.excluded_by.join(", ")}</div>
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
