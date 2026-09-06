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
import {
  useCancelDocumentMappingReview,
  useConfirmDocumentMapping,
  useDocument,
  useGenerateDocumentMappings,
  useProjectRole,
  useReviewRequests,
} from "../api/hooks";
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

      {/* ADR 0009 Consequences + 계획 0003 §3-g: "이 문서가 어떤 문자열로 해시됐는가"가 화면에 보여야
          식별 드리프트를 사람이 눈으로 확인할 수 있다. 다만 사용자 언어가 아니므로 목록·카드에는 넣지
          않고 여기 접힌 영역에만 둔다. */}
      <details data-testid="identity-info">
        <summary>식별 정보 (doc_id 계산 근거)</summary>
        <table className="kv">
          <tbody>
            <tr>
              <th>doc_id</th>
              <td>
                <code>{d.doc_id}</code>
              </td>
            </tr>
            <tr>
              <th>식별용 제목 (title_identity)</th>
              <td>
                <code data-testid="title-identity">{d.title_identity ?? "-"}</code>
                <div className="muted small">
                  doc_id 해시에 실제로 들어간 문자열입니다. 코드에 동결돼 있어(ADR 0009 §2) 매칭 설정
                  (title_matching)을 어떻게 바꿔도 이 값과 doc_id 는 움직이지 않습니다.
                </div>
              </td>
            </tr>
            <tr>
              <th>대조용 제목 (title_normalized)</th>
              <td>
                <code>{d.title_normalized}</code>
                <div className="muted small">
                  제목 ↔ Activity 유사도 대조에만 쓰입니다 — doc_id 재료가 아닙니다(ADR 0009 §1).
                </div>
              </td>
            </tr>
            <tr>
              <th>식별 표면 지문</th>
              <td>
                <code data-testid="identity-fingerprint">{d.identity_fingerprint ?? "-"}</code>
                <div className="muted small">
                  이 행을 적재할 때 쓰인 식별 규칙(sender_aliases·sheet_doc_types·column_aliases)의 지문입니다.
                  한 프로젝트의 문서에 서로 다른 지문이 섞여 있으면 그 사이에 식별 규칙이 바뀐 것입니다(ADR 0009 §5-2).
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </details>

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
  const cancel = useCancelDocumentMappingReview(projectId);
  const generate = useGenerateDocumentMappings(projectId);
  const [pending, setPending] = useState<{ mapping: ActivityDocumentMapping; action: MappingAction } | null>(null);
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
      <ErrorBox error={cancel.error} />
      {mappings.length === 0 ? (
        <p className="muted">이 문서에 제안된 매핑이 없습니다.</p>
      ) : (
        <ul className="list">
          {mappings.map((m) => (
            <MappingRow
              key={m.activity_id}
              mapping={m}
              canDecide={role === "cm"}
              onConfirm={() => setPending({ mapping: m, action: "confirm" })}
              onCancel={() => setPending({ mapping: m, action: "cancel" })}
              reopened={reopenedActivityIds.has(m.activity_id)}
            />
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={pending !== null}
        title={pending ? `${MAPPING_ACTION_LABELS[pending.action](pending.mapping)} — Activity ${pending.mapping.activity_id}` : ""}
        message={pending ? mappingDialogMessage(pending.mapping, pending.action) : undefined}
        confirmLabel={pending ? MAPPING_ACTION_LABELS[pending.action](pending.mapping) : "확인"}
        // ADR 0013 규칙 4: 취소는 사유가 비어 있으면 서버가 409 `cancel_reason_required` 로 막는다.
        // 화면이 그 409 보다 먼저 잠근다 — `ObjectDetailPanel` 의 REVOCATION_KINDS·REVIEW_REJECTING_KINDS
        // 가 `requireNote` 를 넘기는 것과 같은 층이다. 확정은 사유가 선택이므로 잠그지 않는다.
        requireNote={pending?.action === "cancel"}
        busy={confirm.isPending || cancel.isPending}
        onCancel={() => setPending(null)}
        onConfirm={(note) => {
          if (!pending) return;
          const activityId = pending.mapping.activity_id;
          if (pending.action === "cancel")
            cancel.mutate({ activityId, docId, note }, { onSettled: () => setPending(null) });
          else confirm.mutate({ activityId, note }, { onSettled: () => setPending(null) });
        }}
      />
    </>
  );
}

/** 이 화면에서 CM 이 매핑 한 행에 할 수 있는 행위. 취소는 확정·반려 **양쪽**에서 같은 라우트로 간다. */
type MappingAction = "confirm" | "cancel";

/**
 * 버튼·다이얼로그 라벨. 취소는 어느 결정을 되돌리는지에 따라 말이 달라야 한다 — "취소"만 적으면
 * 다이얼로그의 닫기 버튼("취소")과 구별되지 않고, CM 이 지금 무엇을 되돌리는지도 보이지 않는다.
 */
const MAPPING_ACTION_LABELS: Record<MappingAction, (m: ActivityDocumentMapping) => string> = {
  confirm: () => "확정",
  cancel: (m) => (mappingReviewState(m) === "rejected" ? "반려 취소" : "확정 취소"),
};

/**
 * ConfirmDialog 본문 — "이 결정이 실제로 무엇을 바꾸는가"(ObjectDetailPanel 의 `dialogMessage` 와 같은 규칙).
 * 지키지 못할 약속을 하지 않는다.
 *
 * **취소 문구가 반드시 말해야 하는 것**(ADR 0013 규칙 1·2, CLAUDE.md §6-4): 취소는 확정·반려 기록을
 * "지우는" 것이 아니라 그 쌍을 **미확정(검토 대기)으로 되돌리고 검토 큐에 다시 올리는** 것이다.
 * 그래서 ① 확정 취소는 이 문서를 도면 승인 근거에서 내려 착수 가능(readiness) 점수를 떨어뜨릴 수 있고
 * (ADR 0013 §Context 3: `drawing_approval` 1.0 → 판단 없음), ② 반려 취소는 **확정으로 바뀌지 않는다**
 * — 확정을 원하면 CM 이 확정 액션을 다시 해야 한다(CLAUDE.md §0: 확정은 사람의 승인 액션으로만).
 * ③ 새 검토요청은 재계산을 기다리지 않고 그 자리에서 열린다(ADR 0013 규칙 2).
 * 옛 검토요청 행은 손대지 않으므로 "누가 왜 그렇게 판단했는지"는 큐에 그대로 남는다(규칙 2·3).
 */
function mappingDialogMessage(m: ActivityDocumentMapping, action: MappingAction): string {
  if (action === "confirm")
    // "확정 이후에는 시스템이 이 매핑을 되돌리지 않습니다"는 그대로 참이다 — 취소는 시스템이 아니라
    // **사람(CM)** 이 한다. ADR 0013 이 그 사람 경로를 만들었으므로 그 사실을 지우지 않고 **더한다**.
    return (
      "이 문서가 해당 Activity의 도면 승인 근거로 확정됩니다(needs_review=False). 확정 이후에도 시스템이 이 매핑을 " +
      "되돌리지 않습니다 — 나중에 이 Activity 정보가 바뀌어 매핑이 더는 맞지 않게 되면, 매핑은 확정 상태로 남긴 채 " +
      "검토요청만 다시 열려 재확인을 요청합니다(ADR 0007 §4-2 규칙 6 ⑤). 되돌리는 것은 CM 뿐이며, 이 행의 " +
      "'확정 취소'로 사유를 남기고 미확정으로 되돌릴 수 있습니다."
    );
  if (mappingReviewState(m) === "rejected")
    return (
      "이 매핑의 반려를 취소해 미확정(검토 대기)으로 되돌립니다 — 확정으로 바뀌는 것이 아닙니다. 확정이 필요하면 " +
      "그 뒤에 확정을 따로 눌러야 합니다. 화면의 반려자·반려 사유 표시는 내려가고 취소 이력에 보존되며, 이 쌍의 " +
      "재검토 요청이 검토 큐에 그 자리에서 새로 열립니다. 지금까지의 검토요청 처리 기록(누가 왜 반려했는지)은 " +
      "그대로 남습니다. 사유는 필수이며 취소 이력에 남습니다."
    );
  return (
    "이 매핑의 확정을 취소해 미확정(검토 대기)으로 되돌립니다 — 확정 기록을 지우는 것이 아니라 아직 판단하지 않은 " +
    "상태로 되돌리는 것입니다. 이 문서는 더 이상 해당 Activity의 도면 승인 근거로 세지 않으므로 착수 가능(readiness)의 " +
    "도면 승인 점수가 내려갈 수 있습니다. 이 쌍의 재검토 요청이 검토 큐에 그 자리에서 새로 열립니다. 다시 확정하려면 " +
    "확정을 한 번 더 눌러야 합니다. 사유는 필수이며 취소 이력에 남습니다."
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
  canDecide,
  onConfirm,
  onCancel,
  reopened,
}: {
  mapping: ActivityDocumentMapping;
  /** cm 인가(ADR 0006 의 project role). 확정도 취소도 같은 역할만 할 수 있다(ADR 0013 불변식 5). */
  canDecide: boolean;
  onConfirm: () => void;
  onCancel: () => void;
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
        {canDecide && reviewState === "pending" && (
          <button type="button" className="primary" onClick={onConfirm}>
            확정
          </button>
        )}
        {/* ADR 0013: 취소는 그 쌍에 **서 있는 결정**을 되돌린다 — 결정이 없는 "검토 대기"에는 되돌릴 것이
            없고 서버가 409 `mapping_decision_not_cancellable` 로 막는다. 그래서 버튼도 그때는 내지 않는다.
            확정·반려 **양쪽**에 낸다: 취소는 두 방향에서 같은 라우트로 가고 같은 미확정에 착지한다. */}
        {canDecide && reviewState !== "pending" && (
          <button type="button" data-testid="cancel-decision" onClick={onCancel}>
            {MAPPING_ACTION_LABELS.cancel(m)}
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
        /* 반려는 **재계산에 대해서만** 영구하다(ADR 0013 규칙 8 이 ADR 0007 §4-2 규칙 6 ⑥ 의 "영구"를
           대체하지 않고 주어를 좁혔다) — 재계산·재업로드는 이 후보를 다시 만들지 않고 도면 승인 근거로도
           쓰이지 않지만, **CM 의 명시적 취소**로는 풀린다(같은 행의 '반려 취소'). 사유·반려자를 반드시
           함께 보여준다: 이 화면이 매핑 반려를 볼 수 있는 유일한 자리다. */
        <div className="muted small" data-testid="mapping-rejection">
          반려: {rejection.rejectedBy ?? "-"}
          {rejection.note ? ` — ${rejection.note}` : ""}
          <br />이 매핑은 도면 승인 근거로 쓰이지 않으며, 대장을 재업로드해도 후보로 다시 제안되지 않습니다. 되돌리려면 CM이
          이 행의 '반려 취소'로 사유를 남기고 검토 대기로 되돌립니다.
        </div>
      )}
    </li>
  );
}
