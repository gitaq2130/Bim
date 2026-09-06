/**
 * 객체 상세 패널 — GET /objects/{global_id} 한 번으로 4탭을 채운다.
 * 기본정보 / 상태 / 이력 / 다음행동. "확정" 버튼은 role === "cm" 일 때만 렌더하고 확인 다이얼로그를 거친다.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useObjectDetail, useProjectRole, useTransition } from "../api/hooks";
import type { Evidence, NextAction, NextActionKind, ObjectDetail, ProjectRole, StateTransition } from "../api/types";
import { ACTOR_LABELS, ROLE_LABELS, STATE_LABELS_KO } from "../domain/labels";
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
  const q = useObjectDetail(projectId, globalId);

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

/** 링크로만 처리하는 행동(전이 아님) */
const LINK_KINDS: ReadonlySet<NextActionKind> = new Set(["resolve_review", "align_scan"]);
/** CM 전용 행동 — admin 포함 다른 역할에는 렌더하지 않는다 (백엔드 allowed_roles 와 별개의 클라이언트 이중 가드) */
const CM_ONLY_KINDS: ReadonlySet<NextActionKind> = new Set([
  "confirm",
  "inspect",
  "reject_inspection",
  "accept_rework",
  "order_rework",
  "revoke_confirmation",
  "flag_mismatch",
]);
const isConfirmAction = (a: NextAction) => a.kind === "confirm" || a.to_state === "CONFIRMED";

/**
 * ADR 0011 규칙 2 — CONFIRMED **이탈**(확정 무효화)에는 사유가 필요하다. 서버 불변식
 * (`packages/core/models/state.py::StateTransition._check`)이 최종 방어이고, 이 집합은 CM 이 409 를
 * 보기 전에 화면에서 먼저 막는 층이다.
 *
 * **`to_state` 가 아니라 `kind` 로 가른다.** `to_state` 로 가르면 같은 목적지를 가진 **다른 전이**까지
 * 휩쓴다 — 실측(2026-09-04, `allowed_targets` × `_action_kind` 전수)에서 CM 이 받는 전이 행동 6개 중
 * `MISMATCH`·`IN_PROGRESS` 로 가는 것은 5개이고, 그중 사유가 실제로 필요한 것은 아래 2개뿐이다:
 *
 *   revoke_confirmation  CONFIRMED            -> MISMATCH      사유 필수 (서버가 거부)
 *   order_rework         CONFIRMED            -> IN_PROGRESS   사유 필수 (서버가 거부)
 *   reject_inspection    INSPECTION_REQUESTED -> IN_PROGRESS   사유 필수 (ADR 0012 — 아래 참조)
 *   flag_mismatch        INSPECTION_REQUESTED -> MISMATCH      사유 필수 (ADR 0012 — 아래 참조)
 *   accept_rework        MISMATCH             -> IN_PROGRESS   사유 불필요
 *
 * (뒤의 두 줄은 ADR 0012 로 뒤집혔다. 이 주석이 "사유 불필요"라고 적고 있던 동안 서버는 이미 그 둘을
 * 409 로 거부하고 있었다 — 서버에서 걷어낸 사실이 화면 주석에 남는 계열 (A) 재발을 여기서 닫는다.)
 *
 * `_action_kind`(`grep -n "def _action_kind" services/progress/state_machine.py`)가 이 넷에 고유 이름을
 * 붙여 두었고, 그 값이 `next_actions[].kind` 로 화면에 온다 — 특정할 수 있으면 요건을 걸 수 있다(ADR 0011 §4).
 */
const REVOCATION_KINDS: ReadonlySet<NextActionKind> = new Set(["revoke_confirmation", "order_rework"]);

/**
 * ADR 0012 불변식 4 / 규칙 2 — **검토요청을 `rejected` 로 닫는 두 번째 문**(큐가 아니다). 이 두 전이는
 * `close_inspection_reviews`(`grep -n "def close_inspection_reviews" services/progress/state_machine.py`)
 * 로 내려가 미결 inspection 검토요청을 `rejected` 로 닫으므로, 서버가 사유 없는 요청을
 * 409 `rejection_reason_required` 로 거부한다. 이 집합은 CM 이 그 409 를 보기 전에 화면에서 먼저 막는 층이다.
 *
 * **여기서도 `to_state` 가 아니라 `kind` 로 가른다**(위 REVOCATION_KINDS 와 같은 이유). CM 이 받는 전이
 * 행동 중 목적지가 `IN_PROGRESS`·`MISMATCH` 인 것은 다섯인데 서버가 사유를 요구하는 것은 넷이다 —
 * `to_state` 기준이면 `accept_rework`(MISMATCH→IN_PROGRESS)까지 휩쓸고, 그것은 검토요청을 하나도
 * 닫지 않는 CM 상시 업무다.
 *
 * **화면이 서버보다 넓게 잠근다 — 그 선택과 대가.** 서버 조건에는 한정어가 하나 더 있다:
 * "**미결 inspection 검토요청이 있을 때**"(`grep -n "status == \"rejected\" and open_reviews" ...`).
 * 화면은 그 사실을 알 수 **있다** — `ObjectDetail.next_actions` 안의 `resolve_review` 항목이
 * `review_kind: "inspection"` 을 싣고 오고, `current_state.has_open_review` 도 있다(둘 다 실측).
 * 그래도 여기서는 **kind 만으로** 잠근다:
 *   ① `review_kind` 는 서버가 보내지만 `NextAction`(api/types.ts) 계약에 선언돼 있지 않고,
 *      `has_open_review` 는 kind 를 가리지 않아(mapping·verification 도 true 로 만든다) 서버 조건과
 *      정확히 같지 않다 — 둘 중 어느 것도 지금 계약으로 정확하지 않다.
 *   ② 화면이 보는 것은 **로드 시점의 스냅샷**이다. 로드와 클릭 사이에 다른 CM 이 큐에서 그 검토요청을
 *      열거나 닫으면 "정확한" 검사도 정확하지 않게 된다. 넓게 잠그는 쪽은 그 경합에서 **안전한 방향**으로
 *      틀린다(사유 없는 반려를 통과시키지 않는다).
 * **대가(실측, 2026-09-05).** CM 이 큐에서 inspection 검토요청을 `on_hold` 로 닫으면(200) 객체는
 * `INSPECTION_REQUESTED` 에 남고 미결 inspection 은 0 이 된다(`has_open_review: false`). 그 상태에서
 * 서버는 사유 없는 `reject_inspection` 을 **201** 로 받아 준다. 화면은 그때도 사유 칸을 필수로 잠근다 —
 * CM 이 한 칸을 더 채워야 하고, 막히는 행동은 없다. 아래 다이얼로그 문구가 그 경우에도 거짓이 되지
 * 않도록 "미결 검측 검토요청이 있으면"이라는 조건을 문장에 담는다(CLAUDE.md §6-4).
 */
const REVIEW_REJECTING_KINDS: ReadonlySet<NextActionKind> = new Set(["reject_inspection", "flag_mismatch"]);

const requiresRevocationReason = (a: NextAction | null) => !!a && REVOCATION_KINDS.has(a.kind);
const rejectsReviewRequest = (a: NextAction | null) => !!a && REVIEW_REJECTING_KINDS.has(a.kind);
/** 화면이 사유 칸을 필수로 잠그는 전이 전수 — 서버가 사유 없이 거부하는 두 code 에 각각 대응한다. */
const requiresReason = (a: NextAction | null) => requiresRevocationReason(a) || rejectsReviewRequest(a);

/** ConfirmDialog 본문 — "이 결정이 실제로 무엇을 바꾸는가". kind 마다 다르고, 지키지 못할 약속을 하지 않는다. */
function dialogMessage(a: NextAction | null): string | undefined {
  if (!a) return undefined;
  if (isConfirmAction(a))
    // ADR 0011 규칙 3 **3단계**: 같은 줄을 두 번 고치는 그 두 번째다. 1단계(00f87cd)는 거짓인
    // 사유 요건을 지우고 그때 참이던 것(이탈 actor 가 cm)만 남겼다. 이제 요건이 실제로 섰으므로
    // (a16f434 의 모델 불변식 + 위 REVOCATION_KINDS 의 화면 강제) 새 사실로 갱신했다.
    // 두 절 모두 지금 참이다 — 실측: CONFIRMED 이탈 2개 전이만 note 없이 거부되고,
    // `leaving CONFIRMED requires actor=cm` 도 그대로다(packages/core/models/state.py).
    return "이 객체를 '확정(CONFIRMED)' 상태로 전이합니다. CM 승인 행위로 기록되며, 되돌리는 것도 CM 만 할 수 있고 그때는 사유를 남겨야 합니다.";
  if (!a.to_state) return undefined;
  const to = STATE_LABELS_KO[a.to_state];
  if (rejectsReviewRequest(a))
    // ADR 0012 규칙 5 (나) / 계획 0005 §1-g 나: 이 전이가 **검토요청을 반려로 닫는다**는 사실을 말한다.
    // 마지막 절은 장식이 아니라 정확도다 — 미결 inspection 이 0 인 채로 이 전이를 하는 경로가 실제로
    // 있고(큐에서 `on_hold` 로 닫은 뒤), 그때는 닫히는 요청이 없다(실측 201).
    return `이 객체의 미결 검측 검토요청을 '반려'로 닫고 '${to}' 상태로 전이합니다. 여기 적는 사유가 검토요청 목록의 처리 메모에 남습니다. 미결 검측 검토요청이 없으면 상태만 바뀝니다.`;
  return `'${to}' 상태로 전이를 요청합니다.`;
}

/** 화면에서 직접 누른 전이의 근거. 확정(cm)은 cm_action, 그 외 수동 입력은 user_input. userId 없으면 호출하지 않는다. */
function evidenceFor(role: ProjectRole, userId: string, action: NextAction, note: string): Evidence {
  return {
    source_type: role === "cm" && isConfirmAction(action) ? "cm_action" : "user_input",
    source_id: userId,
    note: note || null,
  };
}

function ActionsTab({ d, projectId }: { d: ObjectDetail; projectId?: string }) {
  // ADR 0006: 행동 가능 여부는 이 프로젝트에서의 역할(project role)로 정한다 — 전역 auth.role 이 아니다.
  // admin 은 my_role=null 이라 어떤 프로젝트에서도 행위 버튼이 뜨지 않는다(서버와 동일).
  const { role, isLoading: roleLoading } = useProjectRole(projectId);
  const userId = useStore((s) => s.auth.userId);
  const transition = useTransition(projectId ?? "", d.basic.global_id);
  const [pending, setPending] = useState<NextAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canAct = !!role && !!userId;
  const visible = d.next_actions.filter((a) => {
    if (!role) return false;
    if (a.allowed_roles.length > 0 && !a.allowed_roles.includes(role)) return false;
    if ((CM_ONLY_KINDS.has(a.kind) || isConfirmAction(a)) && role !== "cm") return false; // admin 포함 불허
    if (!LINK_KINDS.has(a.kind) && !a.to_state) return false; // 전이 행동인데 to_state 가 없으면 표시하지 않음
    return true;
  });

  const run = (a: NextAction, note: string) => {
    const to = a.to_state;
    if (!to || !role || !userId) return;
    setMessage(null);
    transition.mutate(
      { to_state: to, evidence: evidenceFor(role, userId, a, note), review_request_id: a.review_request_id ?? null },
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

  // 프로젝트 역할 로딩 중에는 "행동 없음"을 먼저 그리지 않는다 — cm 인데 잠깐 빈 화면을 보여주는 깜빡임 방지.
  if (roleLoading) return <p className="muted">불러오는 중…</p>;

  if (visible.length === 0)
    return (
      <div>
        <p className="muted">현재 프로젝트 역할({role ? ROLE_LABELS[role] : "-"})로 수행 가능한 행동이 없습니다.</p>
        {message && <p role="status">{message}</p>}
      </div>
    );

  return (
    <div>
      {!userId && <p className="warn small">사용자 정보(userId)가 없어 행동을 수행할 수 없습니다. 다시 로그인하세요.</p>}
      <div className="col gap">
        {visible.map((a, i) => {
          const isConfirm = isConfirmAction(a);
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
              disabled={transition.isPending || !canAct}
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
        message={dialogMessage(pending)}
        confirmLabel={pending?.label ?? "확인"}
        requireNote={requiresReason(pending)}
        busy={transition.isPending}
        onCancel={() => setPending(null)}
        onConfirm={(note) => pending && run(pending, note)}
      />
    </div>
  );
}
