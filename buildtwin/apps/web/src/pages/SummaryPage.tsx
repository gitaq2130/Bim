/**
 * 주간 진도 요약: 층·공종별 상태 분포, 이번 주 확정 수, 미결 검토요청 수, 착수 가능 작업 + 차단 원인.
 */
import { Link, useParams } from "react-router-dom";
import { useWeeklySummary } from "../api/hooks";
import { OBJECT_STATES, type Blocker } from "../api/types";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { ErrorBox } from "../components/ErrorBox";
import { DRAWING_APPROVAL_BLOCKER_ACTIONS, DRAWING_APPROVAL_BLOCKER_LABELS, classifyDrawingApprovalBlocker } from "../domain/documentBlocker";
import { REVIEW_KIND_LABELS, STATE_COLORS, STATE_LABELS_KO } from "../domain/labels";
import { pct } from "../lib/format";

export function SummaryPage() {
  const { id: projectId = "" } = useParams();
  const q = useWeeklySummary(projectId);

  if (q.isPending) return <div className="page">불러오는 중…</div>;
  if (q.isError)
    return (
      <div className="page">
        <ErrorBox error={q.error} />
      </div>
    );
  const s = q.data;

  return (
    <div className="page">
      <h1>주간 진도 요약</h1>
      <p className="muted">
        {s.week_start} ~ {s.week_end}
      </p>
      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">이번 주 확정(CONFIRMED)</span>
          <span className="kpi-value">{s.confirmed_this_week}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">미결 검토요청</span>
          <span className="kpi-value">
            <Link to={`/projects/${projectId}/reviews`}>{s.open_reviews}</Link>
          </span>
          {s.open_reviews_by_kind && (
            <span className="small muted">
              {Object.entries(s.open_reviews_by_kind)
                .map(([k, v]) => `${REVIEW_KIND_LABELS[k as keyof typeof REVIEW_KIND_LABELS] ?? k} ${v}`)
                .join(" · ")}
            </span>
          )}
        </div>
        <div className="kpi">
          <span className="kpi-label">착수 가능 작업</span>
          <span className="kpi-value">{s.startable.filter((a) => a.blockers.length === 0).length}</span>
        </div>
      </div>

      <h2>층·부재그룹별 상태 분포</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>층</th>
              <th>부재 그룹</th>
              {OBJECT_STATES.map((st) => (
                <th key={st}>
                  <span className="swatch" style={{ background: STATE_COLORS[st] }} /> {STATE_LABELS_KO[st]}
                </th>
              ))}
              <th>합계</th>
            </tr>
          </thead>
          <tbody>
            {s.state_distribution.map((row, i) => {
              const total = row.total ?? OBJECT_STATES.reduce((acc, st) => acc + (row.counts[st] ?? 0), 0);
              return (
                <tr key={i}>
                  <td>{row.level}</td>
                  <td>{row.group}</td>
                  {OBJECT_STATES.map((st) => (
                    <td key={st} className="num">
                      {row.counts[st] ?? 0}
                    </td>
                  ))}
                  <td className="num">{total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>착수 가능 작업 / 차단 원인</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Activity</th>
            <th>Readiness</th>
            <th>차단 원인</th>
          </tr>
        </thead>
        <tbody>
          {s.startable.map((a) => (
            <tr key={a.activity_id} className={a.blockers.length ? "blocked" : "startable"}>
              <td>
                {a.name ?? a.activity_id} <span className="muted small">{a.activity_id}</span>
              </td>
              <td>
                {a.readiness != null ? pct(a.readiness) : "-"} <ConfidenceBadge confidence={a.confidence ?? null} evidence={a.evidence ?? null} />
              </td>
              <td>
                {a.blockers.length === 0 ? (
                  <span className="ok">착수 가능</span>
                ) : (
                  <ul className="blockers">
                    {a.blockers.map((b, i) => (
                      <BlockerLine key={i} blocker={b} projectId={projectId} />
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 착수 차단 사유 한 줄. `drawing_approval`(ADR 0007)은 `related_ids`가 `doc_id` 목록이므로 문서 상세로
 * 링크한다. 세 갈래(미승인 문서 / 미확정 매핑 / 처리결과 미기재)는 CM이 해야 할 행동이 다르므로 뭉개지
 * 않고 갈래 이름 + 다음 행동을 함께 보여준다(§5-3). 다른 구성요소(predecessor 등)는 기존대로 텍스트만.
 */
function BlockerLine({ blocker: b, projectId }: { blocker: Blocker; projectId: string }) {
  const isDrawingApproval = b.component === "drawing_approval";
  const kind = isDrawingApproval ? classifyDrawingApprovalBlocker(b.reason) : "other";
  const kindLabel = DRAWING_APPROVAL_BLOCKER_LABELS[kind];
  const action = DRAWING_APPROVAL_BLOCKER_ACTIONS[kind];
  return (
    <li className={`sev-${b.severity ?? "medium"}`}>
      [{b.component}]{kindLabel && <span className="badge neutral doc-blocker-kind"> {kindLabel} </span>} {b.reason}
      {action && <div className="muted small">다음 행동: {action}</div>}
      {b.related_ids?.length ? (
        <span className="muted small">
          {" ("}
          {b.related_ids.map((id, i) => (
            <span key={id}>
              {i > 0 && ", "}
              {isDrawingApproval ? <Link to={`/projects/${projectId}/documents/${encodeURIComponent(id)}`}>{id}</Link> : id}
            </span>
          ))}
          {")"}
        </span>
      ) : null}
    </li>
  );
}
