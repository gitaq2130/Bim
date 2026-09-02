/**
 * 주간 진도 요약: 층·공종별 상태 분포, 이번 주 확정 수, 미결 검토요청 수, 착수 가능 작업 + 차단 원인.
 */
import { Link, useParams } from "react-router-dom";
import { useWeeklySummary } from "../api/hooks";
import { OBJECT_STATES } from "../api/types";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { ErrorBox } from "../components/ErrorBox";
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
                      <li key={i} className={`sev-${b.severity ?? "medium"}`}>
                        [{b.component}] {b.reason}
                        {b.related_ids?.length ? <span className="muted small"> ({b.related_ids.join(", ")})</span> : null}
                      </li>
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
