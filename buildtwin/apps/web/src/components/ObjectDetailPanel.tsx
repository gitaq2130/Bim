/**
 * 객체 상세 패널 — GET /objects/{global_id} 한 번으로 4탭을 채운다.
 * 기본정보 / 상태 / 이력 / 다음행동. "확정" 버튼은 role === "cm" 일 때만 렌더하고 확인 다이얼로그를 거친다.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useObjectDetail, useTransition } from "../api/hooks";
import type { Evidence, NextAction, ObjectDetail, ObjectState, StateTransition, UserRole } from "../api/types";
import { ACTOR_LABELS, STATE_LABELS_KO } from "../domain/labels";
import { fmtDate, fmtNum } from "../lib/format";
import { useStore } from "../store";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { ConfirmDialog } from "./ConfirmDialog";
import { ErrorBox, errorText } from "./ErrorBox";
import { ScanStateBadge, StateBadge } from "./StateBadge";

type Tab = "basic" | "state" | "history" | "actions";
const TABS: [Tab, string][] = [
  ["basic", "기본정보"],
  ["state", "상태"],
  ["history", "이력"],
  ["actions", "다음행동"],
];

export function ObjectDetailPanel({
  globalId,
  projectId,
  onSelectHandle,
}: {
  globalId: string | null;
  projectId?: string;
  onSelectHandle?: (handle: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("basic");
  const q = useObjectDetail(globalId);

  if (!globalId) return <aside className="detail-panel muted">3D 또는 2D 뷰에서 객체를 선택하세요.</aside>;
  if (q.isPending) return <aside className="detail-panel">불러오는 중…</aside>;
  if (q.isError || !q.data)
    return (
      <aside className="detail-panel">
        <ErrorBox error={q.error ?? new Error("객체 정보를 불러올 수 없습니다")} />
      </aside>
    );
  const d = q.data;

  return (
    <aside className="detail-panel" data-testid="object-detail-panel">
      <header className="detail-head">
        <strong title={d.basic.global_id}>{d.basic.name || d.basic.global_id}</strong>
        <StateBadge state={d.current_state.state} />
      </header>
      <div className="tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            className={tab === key ? "tab active" : "tab"}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="tab-body" role="tabpanel">
        {tab === "basic" && <BasicTab d={d} onSelectHandle={onSelectHandle} />}
        {tab === "state" && <StateTab d={d} />}
        {tab === "history" && <HistoryTab history={d.history} />}
        {tab === "actions" && <ActionsTab d={d} projectId={projectId} />}
      </div>
    </aside>
  );
}

function BasicTab({ d, onSelectHandle }: { d: ObjectDetail; onSelectHandle?: (h: string) => void }) {
  const b = d.basic;
  return (
    <div>
      <table className="kv">
        <tbody>
          <tr>
            <th>GlobalId</th>
            <td>
              <code>{b.global_id}</code>
            </td>
          </tr>
          <tr>
            <th>IFC 타입</th>
            <td>{b.ifc_type}</td>
          </tr>
          <tr>
            <th>이름</th>
            <td>{b.name ?? "-"}</td>
          </tr>
          <tr>
            <th>층</th>
            <td>{b.level ?? "-"}</td>
          </tr>
          <tr>
            <th>구역</th>
            <td>{b.zone ?? "-"}</td>
          </tr>
          {b.material && (
            <tr>
              <th>재료</th>
              <td>{b.material}</td>
            </tr>
          )}
          {b.bbox && (
            <tr>
              <th>bbox</th>
              <td>
                {b.bbox.min.map((v) => fmtNum(v)).join(", ")} ~ {b.bbox.max.map((v) => fmtNum(v)).join(", ")}
              </td>
            </tr>
          )}
          {b.quantity && Object.keys(b.quantity).length > 0 && (
            <tr>
              <th>수량</th>
              <td>
                {Object.entries(b.quantity)
                  .map(([k, v]) => `${k}: ${fmtNum(v)}`)
                  .join(" / ")}
              </td>
            </tr>
          )}
          {b.is_orphaned && (
            <tr>
              <th>비고</th>
              <td className="warn">최신 모델에 없는 객체(orphaned)</td>
            </tr>
          )}
        </tbody>
      </table>
      {b.psets && Object.keys(b.psets).length > 0 && (
        <details>
          <summary>속성 세트 (Psets)</summary>
          {Object.entries(b.psets).map(([pset, props]) => (
            <table className="kv" key={pset}>
              <caption>{pset}</caption>
              <tbody>
                {Object.entries(props).map(([k, v]) => (
                  <tr key={k}>
                    <th>{k}</th>
                    <td>{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </details>
      )}
      <h4>연결</h4>
      <table className="kv">
        <tbody>
          <tr>
            <th>2D 엔티티</th>
            <td>
              {d.linked.entity_handles.length === 0
                ? "-"
                : d.linked.entity_handles.map((h) => (
                    <button key={h} type="button" className="chip" onClick={() => onSelectHandle?.(h)}>
                      {h}
                    </button>
                  ))}
            </td>
          </tr>
          <tr>
            <th>공정 Activity</th>
            <td>{d.linked.activity_ids.join(", ") || "-"}</td>
          </tr>
          <tr>
            <th>자재</th>
            <td>{d.linked.material_ids.join(", ") || "-"}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function StateTab({ d }: { d: ObjectDetail }) {
  const s = d.current_state;
  const v = d.linked.latest_scan_verdict;
  return (
    <div>
      <table className="kv">
        <tbody>
          <tr>
            <th>현재 상태</th>
            <td>
              <StateBadge state={s.state} />
            </td>
          </tr>
          <tr>
            <th>confidence</th>
            <td>
              <ConfidenceBadge confidence={s.confidence} evidence={s.evidence} />
            </td>
          </tr>
          <tr>
            <th>전이 시각</th>
            <td>{fmtDate(s.since)}</td>
          </tr>
          <tr>
            <th>행위자</th>
            <td>{s.actor ? `${ACTOR_LABELS[s.actor]}${s.actor_id ? ` (${s.actor_id})` : ""}` : "-"}</td>
          </tr>
          {s.has_open_review && (
            <tr>
              <th>검토</th>
              <td className="warn">미결 검토요청 있음 — 시스템 자동 전이 차단</td>
            </tr>
          )}
        </tbody>
      </table>
      <h4>최근 스캔 판정</h4>
      {v ? (
        <table className="kv">
          <tbody>
            <tr>
              <th>판정</th>
              <td>
                <ScanStateBadge state={v.state} /> <span className="muted">(스캔은 완료추정까지만 판정)</span>
              </td>
            </tr>
            <tr>
              <th>confidence</th>
              <td>
                <ConfidenceBadge confidence={v.confidence} evidence={v.evidence} />
              </td>
            </tr>
            <tr>
              <th>스캔</th>
              <td>{v.scan_id}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="muted">스캔 판정 없음</p>
      )}
    </div>
  );
}

function HistoryTab({ history }: { history: StateTransition[] }) {
  if (history.length === 0) return <p className="muted">이력 없음</p>;
  return (
    <ol className="timeline">
      {history.map((t) => (
        <li key={t.transition_id}>
          <div className="row gap">
            <span className={`actor actor-${t.actor}`}>{ACTOR_LABELS[t.actor]}</span>
            <span>
              {STATE_LABELS_KO[t.from_state]} → <strong>{STATE_LABELS_KO[t.to_state]}</strong>
            </span>
          </div>
          <div className="row gap muted small">
            <span>{fmtDate(t.occurred_at)}</span>
            {t.actor_id && <span>{t.actor_id}</span>}
            <ConfidenceBadge confidence={t.confidence} evidence={t.evidence} />
            {t.review_request_id && <span>검토 {t.review_request_id}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}

const TRANSITION_KINDS: Record<string, ObjectState> = {
  confirm: "CONFIRMED",
  inspect: "INSPECTION_REQUESTED",
  reject: "IN_PROGRESS",
  report: "REPORTED",
};

function evidenceFor(role: UserRole | null, userId: string | null, note: string): Evidence {
  return {
    source_type: role === "cm" ? "cm_action" : role === "contractor" ? "daily_report" : "user_input",
    source_id: userId ?? "unknown",
    note: note || null,
  };
}

function ActionsTab({ d, projectId }: { d: ObjectDetail; projectId?: string }) {
  const role = useStore((s) => s.auth.role);
  const userId = useStore((s) => s.auth.userId);
  const transition = useTransition(d.basic.global_id);
  const [pending, setPending] = useState<NextAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const visible = d.next_actions.filter((a) => {
    if (role && a.allowed_roles.length > 0 && !a.allowed_roles.includes(role)) return false;
    if (a.kind === "confirm" || a.to_state === "CONFIRMED") return role === "cm"; // 확정은 CM 전용 (이중 가드)
    return true;
  });

  const run = (a: NextAction, note: string) => {
    const to = a.to_state ?? TRANSITION_KINDS[a.kind];
    if (!to) return;
    setMessage(null);
    transition.mutate(
      { to_state: to, evidence: evidenceFor(role, userId, note), review_request_id: a.review_request_id ?? null },
      {
        onSuccess: () => {
          setPending(null);
          setMessage(`${STATE_LABELS_KO[to]} 전이 요청 완료`);
        },
        onError: (e) => {
          setPending(null);
          setMessage(errorText(e));
        },
      },
    );
  };

  if (visible.length === 0)
    return (
      <div>
        <p className="muted">현재 역할({role ?? "-"})로 수행 가능한 행동이 없습니다.</p>
        {message && <p role="status">{message}</p>}
      </div>
    );

  return (
    <div>
      <div className="col gap">
        {visible.map((a, i) => {
          const isConfirm = a.kind === "confirm" || a.to_state === "CONFIRMED";
          if (a.kind === "resolve_review" && projectId)
            return (
              <Link key={i} className="btn" to={`/projects/${projectId}/reviews`}>
                {a.label}
              </Link>
            );
          if (a.kind === "align_scan" && projectId)
            return (
              <Link key={i} className="btn" to={`/projects/${projectId}/upload`}>
                {a.label}
              </Link>
            );
          return (
            <button
              key={i}
              type="button"
              className={isConfirm ? "primary" : ""}
              data-action={a.kind}
              disabled={transition.isPending}
              onClick={() => setPending(a)}
            >
              {a.label}
            </button>
          );
        })}
      </div>
      {message && (
        <p role="status" className={message.includes("403") ? "error" : ""}>
          {message}
        </p>
      )}
      <ConfirmDialog
        open={pending !== null}
        title={pending?.label ?? ""}
        message={
          pending && (pending.kind === "confirm" || pending.to_state === "CONFIRMED")
            ? "이 객체를 '확정(CONFIRMED)' 상태로 전이합니다. CM 승인 행위로 기록되며 되돌리려면 사유가 필요합니다."
            : pending
              ? `'${STATE_LABELS_KO[pending.to_state ?? TRANSITION_KINDS[pending.kind]] ?? pending.kind}' 상태로 전이를 요청합니다.`
              : undefined
        }
        confirmLabel={pending?.label ?? "확인"}
        busy={transition.isPending}
        onCancel={() => setPending(null)}
        onConfirm={(note) => pending && run(pending, note)}
      />
    </div>
  );
}
