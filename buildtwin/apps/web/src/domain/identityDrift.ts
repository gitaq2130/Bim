/**
 * 식별 드리프트가 사람의 판단을 오염시킨 **경위**(`LostDecision.cause`, ADR 0009 §5-2·§3) 분류.
 *
 * 정본은 서버가 보내는 기계 판독 값(`services/ingest/persistence.py` 의 `_CAUSE_*`)이다. 검토요청
 * `title` 산문은 이미 경위별로 갈려 쓰이지만(`document_mapper._identity_drift_review_title`), 화면이
 * 그 산문을 부분 문자열로 되읽어 분류하는 것은 이 저장소가 `Blocker.kind` 도입으로 걷어낸 패턴이므로
 * 하지 않는다(`domain/documentBlocker` 머리말과 같은 이유).
 *
 * **셋을 하나로 뭉뚱그리면 반드시 거짓이 된다.** 오염된 판단이 지금 무엇을 가리키고 있는지가 다르다:
 *
 * | cause | 데이터 | CM 이 해야 할 일 |
 * |---|---|---|
 * | `merge_overwritten` | 행도 `reviewed_by` 도 살아 있고, 그 문서의 **내용(승인 상태)** 이 다른 대장 행의 것으로 바뀌었다 | 화면의 승인 상태를 믿지 말 것. 다시 확정할 새 doc_id 가 **없다** |
 * | `merge_absorbed` | 판단이 가리키던 문서가 다른 doc_id 에 흡수돼 사라졌다 | 그 문서는 더 이상 없다. 새 doc_id 가 **없다** |
 * | `orphaned` | 판단이 가리키던 행이 고아가 됐다 | 같은 문서의 **새 doc_id** 위에서 다시 판단 |
 *
 * `merge_overwritten` 이 가장 위험하다 — ADR 0009 §3 이 스스로 최악이라 적은 경로("미승인 도면 위에서
 * 착수 가능을 띄운다")가 이것뿐이다. 나머지 둘은 근거가 사라져 점수가 내려가는 보수적 실패다. 그래서
 * 화면 배치 순서도 이 위험 순서를 따른다(`IDENTITY_DRIFT_CAUSE_ORDER`).
 */
import type { LostDecision } from "../api/types";

/** 화면이 문구를 고르는 갈래. 서버가 보내는 세 값 + 모르는 값(`unspecified`). */
export type IdentityDriftCauseKind = "merge_overwritten" | "merge_absorbed" | "orphaned" | "unspecified";

/** 서버 `cause` 값(`services/ingest/persistence._CAUSE_*`) → 화면 갈래. */
const SERVER_CAUSE_TO_LOCAL: Record<string, IdentityDriftCauseKind> = {
  merge_overwritten: "merge_overwritten",
  merge_absorbed: "merge_absorbed",
  orphaned: "orphaned",
};

/**
 * 경위 분류. **모르는 값을 `orphaned` 로 떨어뜨리지 않는다.**
 *
 * 서버도 같은 규칙을 명시해 두었다(`document_mapper._CAUSE_UNSPECIFIED` 주석 — "모르는 것을 고아라고
 * 적으면 이 함수가 고치려는 바로 그 거짓이 된다"). 구버전 응답에는 `cause` 자체가 없는데, 그 경우를
 * 고아로 가정하면 화면이 병합 사건을 "고아가 됐으니 새 doc_id 에서 다시 확정하면 된다"로 읽게 만든다.
 */
export function classifyIdentityDriftCause(cause: string | null | undefined): IdentityDriftCauseKind {
  if (typeof cause !== "string" || cause.length === 0) return "unspecified";
  return SERVER_CAUSE_TO_LOCAL[cause] ?? "unspecified";
}

/**
 * **위험한 순서.** 화면은 이 순서로 세운다 — 목록 맨 위가 CM 이 가장 먼저 봐야 할 경위다.
 * `document_mapper._CAUSE_ORDER` 와 같은 순서이며, 그 이유도 같다(위 머리말).
 */
export const IDENTITY_DRIFT_CAUSE_ORDER: readonly IdentityDriftCauseKind[] = [
  "merge_overwritten",
  "merge_absorbed",
  "orphaned",
  "unspecified",
];

/** 목록에서 경위를 가리키는 짧은 이름. */
export const IDENTITY_DRIFT_CAUSE_LABELS: Record<IdentityDriftCauseKind, string> = {
  merge_overwritten: "병합 — 문서 내용이 바뀜",
  merge_absorbed: "병합 — 문서가 흡수돼 사라짐",
  orphaned: "고아 — 문서가 고아가 됨",
  unspecified: "경위 미상",
};

/**
 * 그 경위에서만 참인 사실 + CM 이 해야 할 일. **경위마다 다른 문장**이어야 한다.
 *
 * `merge_overwritten` 문구가 이 화면의 핵심이다: 행이 살아 있어 화면에는 아무 이상이 없어 보이지만,
 * 지금 보이는 승인 상태는 CM 이 보고 판단한 그 문서의 것이 아니다. 이것을 말하지 않으면 CM 은 문서
 * 상세를 열기 전까지 승인 상태가 뒤집힌 것을 알 수 없다.
 */
export const IDENTITY_DRIFT_CAUSE_NOTES: Record<IdentityDriftCauseKind, string> = {
  merge_overwritten:
    "서로 다른 대장 행이 한 doc_id 로 병합돼, 이 문서의 승인 상태가 다른 대장 행의 것으로 바뀌었습니다. " +
    "지금 화면에 보이는 승인 상태는 CM 이 보고 판단한 그 문서의 것이 아니며, 도면 승인 근거(drawing_approval)가 " +
    "뒤집혔을 수 있습니다. 문서는 고아가 아니고 다시 확정할 새 doc_id 도 없습니다 — 대장 원본과 대조해 " +
    "승인 상태부터 확인하십시오.",
  merge_absorbed:
    "이 판단이 가리키던 문서가 다른 doc_id 에 흡수돼 사라졌습니다. 다시 확정할 새 doc_id 가 없습니다.",
  orphaned:
    "이 판단이 가리키던 행이 고아가 됐습니다. 같은 문서가 새 doc_id 로 다시 들어와 있으니, 사람이 그쪽 후보에 " +
    "같은 판단(확정이었으면 확정, 반려였으면 반려)을 다시 내려야 합니다.",
  unspecified:
    "서버가 보낸 경위를 이 화면이 해석하지 못했습니다. 고아인지 병합인지 알 수 없으므로 어느 쪽으로도 " +
    "가정하지 말고, 아래 Activity·문서를 직접 열어 확인하십시오.",
};

/** 한 경위에 속한 오염된 판단들. */
export interface LostDecisionGroup {
  /** 화면 갈래. 문구·순서를 이 값으로 고른다. */
  cause: IdentityDriftCauseKind;
  /** 서버가 실제로 보낸 문자열(없으면 `null`). 모르는 값을 그대로 드러내기 위해 남긴다. */
  rawCause: string | null;
  items: LostDecision[];
  confirmed: number;
  rejected: number;
  /** 이 경위에 걸린 문서 수. 한 문서에 여러 Activity 매핑이 걸릴 수 있어 판단 건수와 다르다. */
  documents: number;
}

/** `services/ingest/persistence._DECISION_REJECTED`. */
const DECISION_REJECTED = "rejected";

/**
 * 오염된 판단을 경위별로 묶고 **위험한 순서**로 세운다.
 *
 * 서버가 보낸 원문 `cause` 별로 묶는다(모르는 값이 둘이면 두 묶음). `_identity_drift_review_title` 이
 * 절을 세우는 방식과 같다 — 아는 경위를 위험 순서로, 모르는 경위는 그 뒤에 이름순으로.
 */
export function groupLostDecisionsByCause(lost: readonly LostDecision[]): LostDecisionGroup[] {
  const byRaw = new Map<string | null, LostDecision[]>();
  for (const item of lost) {
    const raw = typeof item.cause === "string" && item.cause.length > 0 ? item.cause : null;
    const bucket = byRaw.get(raw);
    if (bucket) bucket.push(item);
    else byRaw.set(raw, [item]);
  }
  const groups: LostDecisionGroup[] = [...byRaw.entries()].map(([rawCause, items]) => ({
    cause: classifyIdentityDriftCause(rawCause),
    rawCause,
    items,
    confirmed: items.filter((d) => d.decision !== DECISION_REJECTED).length,
    rejected: items.filter((d) => d.decision === DECISION_REJECTED).length,
    documents: new Set(items.map((d) => d.doc_id ?? "")).size,
  }));
  return groups.sort((a, b) => {
    const rank = IDENTITY_DRIFT_CAUSE_ORDER.indexOf(a.cause) - IDENTITY_DRIFT_CAUSE_ORDER.indexOf(b.cause);
    if (rank !== 0) return rank;
    return (a.rawCause ?? "").localeCompare(b.rawCause ?? "");
  });
}
