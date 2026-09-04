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
    // 어느 kind 에서도 on_hold 는 검토요청 상태만 바꾼다(usecases.resolve_review 의 어떤 분기도
    // decision === "on_hold" 를 받지 않아 공통 폴백으로 떨어진다) — 객체 상태·매핑 어느 것도 건드리지 않는다.
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
        // "확정 이후에는 사람만 되돌릴 수 있습니다"라고 적혀 있었으나 **되돌리는 API 가 없다**(13차 리뷰).
        // 문서 매핑 쓰기 경로는 generate 와 confirm 둘뿐이고 unconfirm/revoke/DELETE 는 존재하지 않는다.
        // 반려 문구를 사실에 맞추면서 승인 쪽을 그대로 둔 자리다 — 화면이 지키지 못할 약속을 하는 것은
        // 이 사이클이 이미 세 번 겪은 실패다. 시스템이 되돌리지 않는다는 사실만 말한다.
        ? "승인하면 이 문서 ↔ Activity 매핑이 확정됩니다(needs_review=False) — 도면 승인 근거(readiness)로 반영됩니다. 확정을 취소하는 기능은 없습니다. Activity 정보가 바뀌면 매핑은 확정 상태로 두고 재확인 요청만 다시 열립니다."
        // ADR 0007 §4-2 규칙 6 ⑥: 반려는 (activity_id, doc_id) 쌍에 대해 영구하다. 되돌리는 경로가 없으므로
        // 문구가 그 사실을 정확히 말해야 한다 — 10차 리뷰가 잡은 결함은 이 자리가 정반대("아무것도 바뀌지
        // 않습니다")를 말하는데 실제로는 되돌릴 수 없는 반려가 실행되던 것이다.
        : "반려하면 이 문서 ↔ Activity 매핑에 반려 표시가 남고 검토 큐에서 내려갑니다 — 도면 승인 근거로 쓰이지 않으며, 대장을 재업로드해도 후보로 다시 제안되지 않습니다. 되돌릴 수 없으니 확인 후 진행하세요.";
    case "document_identity_drift":
      // ADR 0009 §5-3 + 계획 0003 §4 규칙 5: 이 kind 는 **확인 전용**이고 resolve_review 에 분기가 없다.
      // 승인이든 반려든 공통 폴백이 status/resolution_note/resolved_by 만 기록하고
      // activity_document_mappings 는 한 행도 건드리지 않는다(api 가 실행으로 확인 — 해소 전후 6행 동일).
      // 그래서 여기서 "해소하면 복구된다"는 취지를 한 글자라도 적으면, 그 순간 화면이 서버에 없는 기능을
      // 약속하게 된다 — 이 저장소가 이미 세 번 겪은 (C) 계열 결함이고 가장 최근 것은 존재한 적 없는
      // "되돌리기" 엔드포인트를 약속한 승인 다이얼로그였다.
      // 대신 CM 이 **실제로 해야 할 일**(config 되돌리기 / 새 doc_id 위에서 사람이 다시 확정)을 안내한다.
      return (
        "이 종류(문서 식별 드리프트)는 확인 전용입니다 — 승인·반려 어느 쪽을 눌러도 이 검토요청의 상태만 기록됩니다. " +
        "고아 문서에 남은 CM 확정·반려는 복구되지 않으며, 문서 ↔ Activity 매핑은 한 행도 바뀌지 않습니다. " +
        "끊어진 확정·반려는 사람이 직접 되살려야 합니다: 이 요청에 실린 '끊어진 CM 판단' 목록의 Activity·문서를 " +
        "새 doc_id 쪽에서 다시 확인해 판단을 다시 내리거나(확정이었으면 새 후보를 재확정, 반려였으면 새 후보를 다시 반려), " +
        "식별 규칙 config(sender_aliases·sheet_doc_types·column_aliases)를 되돌린 뒤 대장을 다시 올리십시오."
      );
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
            {r.kind === "document_identity_drift" ? (
              /* ADR 0009 §5-2: 이 kind 의 conflicting_sources 에는 3축(신고/스캔/논리)이 아예 없다 —
                 지문 문자열과 moved/merged/lost_decisions 배열이 들어 있다. 축 카드를 그리면 화면이
                 "근거 없음" 세 장만 보여주고, CM 이 재확정해야 할 Activity·문서가 어디에도 안 보인다. */
              <IdentityDriftCard review={r} projectId={projectId} />
            ) : r.kind === "document_mapping" ? (
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
      {/* 제목 폴백으로 ev.note 를 쓰지 않는다(12차 리뷰): 확정 시 _confirm_document_mapping_row 가
          evidence.note 를 CM 확정 메모로 덮으므로, 문서 조회가 실패하면 문서 제목 자리에 "확정합니다"
          같은 메모가 뜬다. 모르면 doc_id 를 그대로 보여주는 편이 정직하다. */}
      <div>
        문서:{" "}
        {docId ? (
          <Link to={`/projects/${projectId}/documents/${encodeURIComponent(docId)}`}>{docRow?.title ?? docId}</Link>
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

/** `_lost_decisions`(services/ingest/persistence.py)가 싣는 한 항목. `decision` 은 "confirmed" | "rejected". */
interface LostDecision {
  activity_id?: string;
  doc_id?: string;
  decision?: string;
}

const LOST_DECISION_LABELS: Record<string, string> = { confirmed: "확정", rejected: "반려" };

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asText(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * 식별 드리프트 검토요청(ADR 0009 §5-2·§5-3)의 근거 카드.
 *
 * **이 카드가 존재하는 이유**: 요청 title 은 건수만 말한다("CM 판단 2건이 고아 문서에 남았습니다").
 * 어느 Activity 의 어느 문서가 끊어졌는지는 `conflicting_sources.lost_decisions` 에만 있고, 그것을
 * 보여주지 않으면 CM 은 "재확정하라"는 안내를 받고도 **무엇을** 재확정할지 알 수 없다.
 *
 * 이 카드는 관측된 사실만 적는다. 해소가 무엇을 복구한다고 적지 않는다 — 해소에는 부수 효과가 없다
 * (`resolve_review` 에 이 kind 의 분기가 없다).
 */
function IdentityDriftCard({ review, projectId }: { review: ReviewRequest; projectId: string }) {
  const src = review.conflicting_sources ?? {};
  const lost = asArray(src.lost_decisions) as LostDecision[];
  const movedCount = asArray(src.moved).length;
  const mergedCount = asArray(src.merged).length;
  const previous = asText(src.previous_fingerprint);
  const current = asText(src.current_fingerprint);
  return (
    <div className="source-card" data-testid="identity-drift-card">
      <div className="source-title">식별 표면 지문</div>
      <div className="small">
        {previous ?? "(이전 적재 지문 없음)"} → {current ?? "-"}
      </div>
      <div className="small">
        doc_id 이동 {movedCount}건{mergedCount > 0 ? ` · 서로 다른 행이 한 doc_id 로 병합 ${mergedCount}건` : ""}
      </div>
      <div className="source-title">끊어진 CM 판단 — 이 요청을 해소해도 복구되지 않습니다</div>
      {lost.length === 0 ? (
        <div className="muted small">없음</div>
      ) : (
        <ul className="list small" data-testid="lost-decisions">
          {lost.map((d) => (
            <li key={`${d.activity_id ?? ""}|${d.doc_id ?? ""}`}>
              Activity {d.activity_id ?? "-"} ·{" "}
              {d.doc_id ? (
                <Link to={`/projects/${projectId}/documents/${encodeURIComponent(d.doc_id)}`}>{d.doc_id}</Link>
              ) : (
                <span className="muted">알 수 없음</span>
              )}
              {" · "}
              <strong>{LOST_DECISION_LABELS[d.decision ?? ""] ?? d.decision ?? "-"}</strong>
            </li>
          ))}
        </ul>
      )}
      <div className="muted small">
        위 문서는 고아가 됐고 시스템은 사람의 확정·반려를 되살리지 않습니다. 새 doc_id 쪽 후보에 같은 판단을 다시
        내리거나, 식별 규칙 config 를 되돌린 뒤 대장을 다시 올려야 합니다.
      </div>
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
