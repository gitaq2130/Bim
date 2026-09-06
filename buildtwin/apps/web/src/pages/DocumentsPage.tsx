/**
 * 문서관리대장 목록(ADR 0007). 대장에서 온 문서를 목록으로 보여주고 종류·승인 상태·고아 여부로 거른다.
 *
 * 승인 상태 6개는 절대 뭉뚱그리지 않는다 — ApprovalStatusBadge/ApprovalStatusNote 가 UNKNOWN을 REJECTED와
 * 다르게, APPROVED_WITH_COMMENTS 를 APPROVED 와 다르게 그린다(§3). 고아 문서(is_orphaned)는 최근 대장에
 * 없던 문서라는 뜻이며 readiness 계산에서 빠진다(§2-2) — 기본은 숨기고(서버 기본값과 동일), 필요하면
 * "고아 문서 포함" 으로 함께 본다(GET /projects/{pid}/documents 의 include_orphaned, objects 목록과 같은 관례).
 */
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useDocuments } from "../api/hooks";
import { DOCUMENT_APPROVAL_STATUSES, DOCUMENT_TYPES, type Document, type DocumentApprovalStatus, type DocumentType } from "../api/types";
import { ApprovalStatusBadge, ApprovalStatusNote } from "../components/ApprovalStatusBadge";
import { ErrorBox } from "../components/ErrorBox";
import { APPROVAL_STATUS_LABELS, DOC_TYPE_LABELS } from "../domain/labels";
import { fmtDate } from "../lib/format";

const PAGE_SIZE = 50;

export function DocumentsPage() {
  const { id: projectId = "" } = useParams();
  const [docType, setDocType] = useState<DocumentType | "">("");
  const [approvalStatus, setApprovalStatus] = useState<DocumentApprovalStatus | "">("");
  const [includeOrphaned, setIncludeOrphaned] = useState(false);
  const [page, setPage] = useState(1);

  const q = useDocuments(projectId, {
    doc_type: docType || undefined,
    approval_status: approvalStatus || undefined,
    include_orphaned: includeOrphaned,
    page,
    page_size: PAGE_SIZE,
  });

  const lastImportedAt = useMemo(() => {
    const dates = (q.data?.items ?? []).map((d) => d.imported_at).filter((v): v is string => !!v);
    return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
  }, [q.data]);

  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  return (
    <div className="page">
      <h1>문서관리대장</h1>
      <p className="muted small">
        문서관리대장(xlsx)이 정본이며 BuildTwin은 읽기만 합니다 — 이 화면은 마지막 업로드 시점의 사본입니다.
        {lastImportedAt && ` 마지막 적재: ${fmtDate(lastImportedAt)}`}
      </p>
      <div className="row gap wrap">
        <label>
          종류
          <select value={docType} onChange={(e) => resetPage(setDocType)(e.target.value as DocumentType | "")} data-testid="doc-type-filter">
            <option value="">전체</option>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {DOC_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          승인 상태
          <select
            value={approvalStatus}
            onChange={(e) => resetPage(setApprovalStatus)(e.target.value as DocumentApprovalStatus | "")}
            data-testid="approval-status-filter"
          >
            <option value="">전체</option>
            {DOCUMENT_APPROVAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {APPROVAL_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={includeOrphaned}
            onChange={(e) => resetPage(setIncludeOrphaned)(e.target.checked)}
            data-testid="include-orphaned-filter"
          />
          고아 문서 포함(최근 대장에 없음 — readiness 계산 제외)
        </label>
      </div>
      <ErrorBox error={q.error} />
      {q.isPending && <p>불러오는 중…</p>}
      {q.data && q.data.items.length === 0 && <p className="muted">조건에 맞는 문서가 없습니다.</p>}
      {q.data && q.data.items.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>문서번호</th>
                <th>종류</th>
                <th>제목</th>
                <th>발신</th>
                <th>공종(원문)</th>
                <th>발생일</th>
                <th>승인 상태</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((d) => (
                <DocumentRow key={d.doc_id} doc={d} projectId={projectId} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.data && q.data.total > PAGE_SIZE && (
        <div className="row gap">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            이전
          </button>
          <span className="muted small">
            {page} / {Math.ceil(q.data.total / PAGE_SIZE)} 페이지 (총 {q.data.total}건)
          </span>
          <button type="button" disabled={page * PAGE_SIZE >= q.data.total} onClick={() => setPage((p) => p + 1)}>
            다음
          </button>
        </div>
      )}
    </div>
  );
}

function DocumentRow({ doc, projectId }: { doc: Document; projectId: string }) {
  return (
    <tr data-testid="document-row" data-doc-id={doc.doc_id} className={doc.is_orphaned ? "blocked" : undefined}>
      <td>
        <code>{doc.doc_number || "-"}</code>
      </td>
      <td>{DOC_TYPE_LABELS[doc.doc_type]}</td>
      <td>
        <Link to={`/projects/${projectId}/documents/${encodeURIComponent(doc.doc_id)}`}>{doc.title}</Link>
      </td>
      <td>{doc.sender}</td>
      <td title="공종은 신뢰할 수 없는 필드입니다(협력사가 원본과 다르게 입력하는 경우가 흔함) — 표시 전용">
        {doc.discipline_raw || "-"}
      </td>
      <td>{doc.issued_on ?? "-"}</td>
      <td>
        <div className="col gap">
          <ApprovalStatusBadge status={doc.approval_status} />
          <ApprovalStatusNote status={doc.approval_status} />
        </div>
      </td>
      <td className="small">
        {doc.is_orphaned && <div className="warn">최근 대장에 없음(orphaned) — readiness 계산 제외</div>}
        {doc.needs_review && <div className="warn">처리결과 해석 실패 — 규칙표 보강 필요</div>}
      </td>
    </tr>
  );
}
