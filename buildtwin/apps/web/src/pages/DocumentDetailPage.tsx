/**
 * 문서 상세(ADR 0007). 대장 `처리결과` 원문(result_raw)을 공백까지 그대로 보여준다 — 사람이 "왜 이렇게
 * 판정했나"를 원문과 대조할 수 있어야 한다(§2-3). 승인 상태는 정규화 결과일 뿐이고 원문이 정본이다.
 *
 * 이 문서에 걸린 Activity 매핑(§4)도 함께 보여주고 확정 UI를 제공한다 — 시스템이 만든 매핑은 confidence 와
 * 무관하게 항상 needs_review=True 이므로(§4 규칙 5), 여기가 사람이 최종 판단하는 자리다. 확정은 cm만
 * (useProjectRole 기준) — 자동/일괄 확정 버튼은 만들지 않는다.
 */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useConfirmDocumentMapping, useDocument, useGenerateDocumentMappings, useProjectRole, useReviewRequests } from "../api/hooks";
import type { ActivityDocumentMapping, ProjectRole } from "../api/types";
import { ApprovalStatusBadge, ApprovalStatusNote } from "../components/ApprovalStatusBadge";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorBox } from "../components/ErrorBox";
import { DOC_TYPE_LABELS } from "../domain/labels";
import {
  MAPPING_REVIEW_STATE_LABELS,
  type MappingReviewState,
  mappingRejection,
  mappingReviewState,
} from "../domain/mappingReview";
import { fmtDate } from "../lib/format";

export function DocumentDetailPage() {
  const { id: projectId = "", docId = "" } = useParams();
  const q = useDocument(projectId, docId);
  const { role } = useProjectRole(projectId);

  if (q.isPending) return <div className="page">불러오는 중…</div>;
  if (q.isError || !q.data)
    return (
      <div className="page">
        <ErrorBox error={q.error ?? new Error("문서 정보를 불러올 수 없습니다")} />
      </div>
    );
  const d = q.data.document;
  const mappings = q.data.mappings;

  return (
    <div className="page">
      <p>
        <Link to={`/projects/${projectId}/documents`}>← 문서관리대장 목록</Link>
      </p>
      <h1>{d.title}</h1>
      <div className="row gap wrap">
        <span className="badge neutral">{DOC_TYPE_LABELS[d.doc_type]}</span>
        <ApprovalStatusBadge status={d.approval_status} />
        <ConfidenceBadge confidence={d.approval_confidence} evidence={d.approval_evidence} />
        {d.is_orphaned && (
          <span className="badge" style={{ background: "#fecaca" }}>
            고아 문서(orphaned)
          </span>
        )}
        {d.needs_review && (
          <span className="badge" style={{ background: "#fde68a" }}>
            처리결과 해석 실패
          </span>
        )}
      </div>
      <ApprovalStatusNote status={d.approval_status} />
      {d.is_orphaned && (
        <p className="notice">
          이 문서는 가장 최근 대장 업로드에 없었습니다. 삭제되지는 않았지만 착수 가능(readiness) 계산에서는 제외됩니다(ADR
          0007 §2-2).
        </p>
      )}

      <h2>대장 원문</h2>
      <table className="kv">
        <tbody>
          <tr>
            <th>문서번호</th>
            <td>{d.doc_number || "-"}</td>
          </tr>
          <tr>
            <th>발신</th>
            <td>
              {d.sender} <span className="muted small">(정규화: {d.sender_normalized})</span>
            </td>
          </tr>
          <tr>
            <th>공종(원문)</th>
            <td>
              {d.discipline_raw || "-"}
              <div className="muted small">
                신뢰할 수 없는 필드입니다 — 협력사가 원본과 다르게 입력하는 경우가 흔해 매핑에서 가점으로만 씁니다(ADR 0007 §4
                규칙 2). 정규화: {d.discipline_normalized || "-"}
              </div>
            </td>
          </tr>
          <tr>
            <th>번호(원문)</th>
            <td>{d.seq_raw || "-"}</td>
          </tr>
          <tr>
            <th>문서발생일</th>
            <td>{d.issued_on ?? "-"}</td>
          </tr>
          <tr>
            <th>처리완료일</th>
            <td>{d.completed_on ?? "-"}</td>
          </tr>
        </tbody>
      </table>

      <h2>처리결과 원문 (result_raw)</h2>
      <p className="muted small">대장 `처리결과` 컬럼의 원문 그대로입니다(공백 포함) — 해석하거나 덮어쓰지 않습니다.</p>
      <pre className="doc-result-raw" data-testid="result-raw">
        {d.result_raw ?? "(공란)"}
      </pre>

      <h2>출처</h2>
      <table className="kv">
        <tbody>
          <tr>
            <th>파일</th>
            <td>{d.file_id}</td>
          </tr>
          <tr>
            <th>시트</th>
            <td>{d.sheet_name}</td>
          </tr>
          <tr>
            <th>행</th>
            <td>{d.source_row}</td>
          </tr>
          {d.imported_at && (
            <tr>
              <th>마지막 적재</th>
              <td>{fmtDate(d.imported_at)}</td>
            </tr>
          )}
        </tbody>
      </table>

      <MappingSection docId={docId} projectId={projectId} mappings={mappings} role={role} />
    </div>
  );
}

/**
 * 문서 ↔ Activity 매핑 검토(ADR 0007 §4). 후보마다 confidence 와 근거(제목유사도·일치 규칙)를 바로 드러내고,
 * cm 만 확정할 수 있다. "확정된" 매핑과 "검토 대기" 매핑을 구분해 보여준다 — 확정 전에는 readiness 에
 * 반영되지 않는다(§5-2 규칙 3).
 */
function MappingSection({
  docId,
  projectId,
  mappings,
  role,
}: {
  docId: string;
  projectId: string;
  mappings: ActivityDocumentMapping[];
  role: ProjectRole | null;
}) {
  const confirm = useConfirmDocumentMapping(projectId, docId);
  const generate = useGenerateDocumentMappings(projectId);
  const [pending, setPending] = useState<ActivityDocumentMapping | null>(null);
  // ADR 0007 §4-2 규칙 6 ⑤: 확정된 매핑도 나중에 재계산으로 무효화되면 검토요청이 다시 open 된다 — 매핑
  // 행(reviewed_by/needs_review) 자체는 그대로다(§4-2 규칙 6). 이 화면만 보면 "확정됨"만 보이고 큐에 다시
  // 뜬 재확인 요청이 안 보이는 어긋남이 있었다(과제 2) — ReviewsPage 와 같은 신호(evidence.extra.
  // invalidated_activity_signature)로 맞춘다.
  const reopenReviews = useReviewRequests(projectId, "document_mapping", "open");
  const reopenedActivityIds = new Set(
    (reopenReviews.data ?? [])
      .filter((r) => r.evidence?.source_type === "document" && r.evidence.source_id === docId
        && typeof r.evidence.extra?.invalidated_activity_signature === "string")
      .map((r) => r.activity_id)
      .filter((id): id is string => !!id),
  );

  return (
    <>
      <h2>문서 ↔ Activity 매핑</h2>
      <p className="muted small">
        시스템이 만든 매핑은 confidence 와 무관하게 항상 사람 확인(cm)을 요구합니다(ADR 0007 §4 규칙 5) — 확정 전까지는
        도면 승인 근거로 쓰이지 않습니다.
      </p>
      {role === "cm" && (
        <div className="row gap">
          <button type="button" disabled={generate.isPending} onClick={() => generate.mutate()}>
            매핑 후보 다시 생성
          </button>
          <ErrorBox error={generate.error} />
        </div>
      )}
      <ErrorBox error={confirm.error} />
      {mappings.length === 0 ? (
        <p className="muted">이 문서에 제안된 매핑이 없습니다.</p>
      ) : (
        <ul className="list">
          {mappings.map((m) => (
            <MappingRow
              key={m.activity_id}
              mapping={m}
              canConfirm={role === "cm"}
              onConfirm={() => setPending(m)}
              reopened={reopenedActivityIds.has(m.activity_id)}
            />
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={pending !== null}
        title={pending ? `매핑 확정 — Activity ${pending.activity_id}` : ""}
        message="이 문서가 해당 Activity의 도면 승인 근거로 확정됩니다(needs_review=False). 확정 이후에는 시스템이 이 매핑을 되돌리지 않습니다 — 나중에 이 Activity 정보가 바뀌어 매핑이 더는 맞지 않게 되면, 매핑은 확정 상태로 남긴 채 검토요청만 다시 열려 재확인을 요청합니다(ADR 0007 §4-2 규칙 6 ⑤)."
        confirmLabel="확정"
        busy={confirm.isPending}
        onCancel={() => setPending(null)}
        onConfirm={(note) => {
          if (!pending) return;
          confirm.mutate({ activityId: pending.activity_id, note }, { onSettled: () => setPending(null) });
        }}
      />
    </>
  );
}

/** 검토 결과별 배지 스타일. 반려는 확정(초록)과 **반드시** 달라야 한다 — 10차 리뷰가 잡은 결함이
    정확히 반려를 초록 "확정됨"으로 그리던 것이다. */
const REVIEW_STATE_CLASS: Record<MappingReviewState, string> = {
  pending: "badge status-open",
  confirmed: "badge status-approved",
  rejected: "badge status-rejected",
};

function MappingRow({
  mapping: m,
  canConfirm,
  onConfirm,
  reopened,
}: {
  mapping: ActivityDocumentMapping;
  canConfirm: boolean;
  onConfirm: () => void;
  /** ADR 0007 §4-2 규칙 6 ⑤: 확정된 이 매핑을 무효화한 재계산이 검토 큐에 재확인 요청을 다시 열어 두었다 —
   * 매핑 자체(needs_review=False)는 그대로다. "확정됨"만 보고 "왜 큐에 또 있지"를 묻지 않도록 표시한다. */
  reopened: boolean;
}) {
  const extra = (m.evidence.extra ?? {}) as { title_similarity?: number; matched_rules?: string[] };
  // needs_review/reviewed_by 만으로 확정을 판별하면 반려를 확정으로 읽는다(ADR 0007 §4-2 규칙 6 ⑥) —
  // 판정은 domain/mappingReview 한 곳이 소유한다.
  const reviewState = mappingReviewState(m);
  const rejection = mappingRejection(m);
  return (
    <li className="card col gap" data-testid="mapping-row" data-activity-id={m.activity_id}>
      <div className="row gap">
        <strong>Activity {m.activity_id}</strong>
        <ConfidenceBadge confidence={m.confidence} evidence={m.evidence} />
        <span className={REVIEW_STATE_CLASS[reviewState]} data-testid="mapping-review-state">
          {MAPPING_REVIEW_STATE_LABELS[reviewState]}
        </span>
        {reopened && (
          <span className="badge" style={{ background: "#fde68a" }} data-testid="reopened-badge">
            재확인 필요
          </span>
        )}
        <div className="spacer" />
        {canConfirm && reviewState === "pending" && (
          <button type="button" className="primary" onClick={onConfirm}>
            확정
          </button>
        )}
      </div>
      {reopened && (
        <p className="notice strong small">
          확정 후 Activity 정보가 바뀌어 이 매핑을 더는 지지하지 않습니다. 매핑은 확정 상태로 남아 있습니다 — 검토요청
          목록에서 재확인해 주세요.
        </p>
      )}
      <div className="small">
        {typeof extra.title_similarity === "number" && <span>제목 유사도: {Math.round(extra.title_similarity * 100)}% · </span>}
        {extra.matched_rules && extra.matched_rules.length > 0 && <span>일치 규칙: {extra.matched_rules.join(", ")}</span>}
      </div>
      {reviewState === "confirmed" && m.reviewed_by && <div className="muted small">확정: {m.reviewed_by}</div>}
      {reviewState === "rejected" && (
        /* 반려는 (activity_id, doc_id) 쌍에 대해 영구하다(ADR 0007 §4-2 규칙 6 ⑥) — 재계산이 이 후보를
           다시 만들지 않고, 도면 승인 근거로도 쓰이지 않는다. 사유·반려자를 반드시 함께 보여준다:
           이 화면이 매핑 반려를 볼 수 있는 유일한 자리다. */
        <div className="muted small" data-testid="mapping-rejection">
          반려: {rejection.rejectedBy ?? "-"}
          {rejection.note ? ` — ${rejection.note}` : ""}
          <br />이 매핑은 도면 승인 근거로 쓰이지 않으며, 대장을 재업로드해도 후보로 다시 제안되지 않습니다.
        </div>
      )}
    </li>
  );
}
