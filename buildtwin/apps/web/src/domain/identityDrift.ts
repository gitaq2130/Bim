/**
 * 식별 드리프트가 사람의 판단을 오염시킨 **경위**(`LostDecision.cause`, ADR 0009 §5-2 (마)·§5-3) 분류와,
 * 그 경위에서 **참인 문장만** 만들어 내는 자리.
 *
 * 정본은 서버가 보내는 기계 판독 값(`services/ingest/persistence.py` 의 `_CAUSE_ROW_*`)이다. 검토요청
 * `title` 산문은 이미 경위별로 갈려 쓰이지만(`document_mapper._identity_drift_review_title`), 화면이
 * 그 산문을 부분 문자열로 되읽어 분류하는 것은 이 저장소가 `Blocker.kind` 도입으로 걷어낸 패턴이므로
 * 하지 않는다(`domain/documentBlocker` 머리말과 같은 이유).
 *
 * **개정 2 — 경위 이름 셋이 전부 바뀌었다**(ADR 0009 §5-2 (마)). 옛 이름은 관측과 어긋나 있었다:
 * `orphaned` 가 붙던 경로에서 그 행들은 **고아가 아니었고**(실측 P3 `moved=8`, `is_orphaned=False`),
 * `merge_overwritten`/`merge_absorbed` 가 잡는 주 경로에는 **병합이 없다**(실측 R1 `merged=0`).
 * 이름이 거짓이면 그 이름으로 갈린 라벨·안내도 함께 거짓이 된다 — 그래서 이 모듈은 **경위 이름이 아니라
 * 관측한 값**으로 문장을 만든다(CLAUDE.md §6-4, 서버 `_identity_drift_clause` 와 같은 규칙).
 *
 * **셋을 하나로 뭉뚱그리면 반드시 거짓이 된다.** 오염된 판단이 지금 무엇을 가리키고 있는지가 다르다:
 *
 * | cause | 데이터 | CM 이 해야 할 일 |
 * |---|---|---|
 * | `row_replaced` | 이 `doc_id` 가 담고 있던 **대장 행의 내용**이 달라졌다. 행도 `reviewed_by` 도 살아 있고 고아 표시조차 없다 | 승인 상태가 지금 어떤지는 `approval_flipped` **값**이 답한다(뒤집혔다 / 같다 / 모른다 — 경위 이름은 답하지 못한다). **다시 판단할 새 `doc_id` 가 없다**(`new_doc_id=null`) |
 * | `row_absorbed` | 판단이 가리키던 대장 행이 지금은 다른 `doc_id` 아래에 있고, 이 `doc_id` 에는 대장 행이 남지 않았다 | 그 `new_doc_id` 위에서 다시 판단 |
 * | `row_moved` | 대장 행은 그대로인데 우리 식별 규칙이 그 행을 다른 `doc_id` 로 옮겼다 | `new_doc_id` 위에서 같은 판단을 다시 |
 *
 * `row_replaced` 가 가장 위험하다 — ADR 0009 §3 이 스스로 최악이라 적은 경로("미승인 도면 위에서
 * 착수 가능을 띄운다")가 이것뿐이다. 나머지 둘은 근거가 사라져 점수가 내려가는 보수적 실패다. 그래서
 * 화면 배치 순서도 이 위험 순서를 따른다(`IDENTITY_DRIFT_CAUSE_ORDER` = 서버 `_CAUSE_ORDER`).
 */
import type { LostDecision } from "../api/types";

/** 화면이 문구를 고르는 갈래. 서버가 보내는 세 값 + 모르는 값(`unspecified`). */
export type IdentityDriftCauseKind = "row_replaced" | "row_absorbed" | "row_moved" | "unspecified";

/** 서버 `cause` 값(`services/ingest/persistence._CAUSE_ROW_*`) → 화면 갈래. */
const SERVER_CAUSE_TO_LOCAL: Record<string, IdentityDriftCauseKind> = {
  row_replaced: "row_replaced",
  row_absorbed: "row_absorbed",
  row_moved: "row_moved",
};

/**
 * 경위 분류. **모르는 값을 `row_moved` 로 떨어뜨리지 않는다.**
 *
 * 서버도 같은 규칙을 명시해 두었다(`document_mapper._CAUSE_UNSPECIFIED` 주석 — "모르는 경위를 가장 흔한
 * 경위로 적으면 이 함수가 고치려는 바로 그 거짓이 된다"). 구버전 응답에는 `cause` 자체가 없고, 옛 이름
 * 셋(`orphaned`·`merge_overwritten`·`merge_absorbed`)도 지금은 **모르는 값**이다 — 옛 이름을 새 갈래로
 * 조용히 번역하면, 이름이 거짓이라 개명한 그 문구를 화면이 되살리게 된다(ADR 0009 §5-2 (마)).
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
  "row_replaced",
  "row_absorbed",
  "row_moved",
  "unspecified",
];

/**
 * 목록에서 경위를 가리키는 짧은 이름. **관측한 사실만 적는다** — "고아"·"병합"은 판정이 보지 않는 값이라
 * 라벨이 알 수 없는 말이다(서버 `_identity_drift_clause` 머리말과 같은 이유).
 */
export const IDENTITY_DRIFT_CAUSE_LABELS: Record<IdentityDriftCauseKind, string> = {
  row_replaced: "담고 있던 대장 행이 바뀜",
  row_absorbed: "대장 행이 다른 doc_id 아래로 감",
  row_moved: "식별 규칙이 행을 새 doc_id 로 옮김",
  unspecified: "경위 미상",
};

/**
 * 그 경위에서만 참인 사실 + CM 이 해야 할 일. **경위마다 다른 문장**이어야 한다.
 *
 * 여기 있는 것은 그 경위의 **모든 항목에서 참인 문장**뿐이다. 항목마다 갈리는 사실(승인 상태가 뒤집혔는가,
 * 무엇이 달라졌는가, 다시 판단할 곳이 있는가)은 값에서 유도한다 — `identityDriftGroupFacts`.
 *
 * **`row_replaced` 상수에서 승인 상태 단정을 걷어냈다**(한정어 역방향 확인 — 서버가 `132d116` 에서
 * 같은 문장을 값 기준 세 갈래로 가른 것과 같은 정정, ADR 0009 §5-3-b). 이 상수는 개정 2 까지 경위
 * 이름만 보고 **한정어 없이** "지금 보이는 승인 상태는 CM 이 보고 판단한 그 대장 행의 것이 아닙니다 —
 * 대장 원본과 대조해 승인 상태부터 확인하십시오"라고 적었고, 그 두 문장은 둘 다 잘못이었다:
 *
 * 1. **거짓인 적재가 있다.** 대장이 **같은 행의** 표기를 스스로 고친 경로(V8a·V8b·P8b·FP1)와 행-정체가
 *    같은 두 행의 처리결과가 `반려`/`부적합` 이라 둘 다 `REJECTED` 인 경로(P13b)에서는
 *    `approval_flipped=False`·`drawing_approval` 0.0 → 0.0 — 승인 상태 **값**이 CM 이 판단할 때와
 *    한 글자도 다르지 않다.
 * 2. **비용 전제를 깬다.** ADR 0009 §5-2 (바)가 P6·P7·P8b·FP1 오탐을 남기기로 한 근거가 "대가는
 *    부수효과 없는 확인 요청 1건"인데, 화면이 "승인 상태부터 확인하십시오"라고 지시하면 대가가
 *    **CM 의 도면 재확인 1회**가 되어 그 결정의 전제가 무너진다.
 *
 * 그래서 상수에는 **모든 `row_replaced` 항목에서 참인 것**(담긴 내용이 달라졌다 / 행도 판단도 살아 있어
 * 화면에는 이상이 보이지 않는다)만 남기고, 승인 상태가 지금 어떤지는 `identityDriftGroupFacts` 가
 * `approval_flipped` **값**에서 세 갈래로 적는다.
 */
export const IDENTITY_DRIFT_CAUSE_NOTES: Record<IdentityDriftCauseKind, string> = {
  row_replaced:
    "이 doc_id 가 담고 있던 대장 행의 내용이 CM 이 판단한 뒤 달라졌습니다. 문서 행도 CM 의 판단도 " +
    "그대로 살아 있어 화면에는 이상이 보이지 않습니다.",
  row_absorbed:
    "이 판단이 가리키던 대장 행이 지금은 다른 doc_id 아래에 있고, 이 doc_id 에는 대장 행이 남지 않았습니다.",
  row_moved:
    "대장 행은 그대로인데 우리 식별 규칙이 그 행을 새 doc_id 로 옮겼습니다. CM 의 판단은 옛 doc_id 에 " +
    "남아 있습니다.",
  unspecified:
    "서버가 보낸 경위를 이 화면이 해석하지 못했습니다. 무슨 일이 일어났는지 어느 쪽으로도 가정하지 말고, " +
    "아래 Activity·문서를 직접 열어 확인하십시오.",
};

/**
 * `changed_fields` 가 싣는 대장 **원문** 필드 이름(`services/ingest/persistence._ROW_IDENTITY_FIELDS`)
 * → CM 이 읽을 라벨. 서버 `document_mapper._ROW_IDENTITY_FIELD_LABELS` 와 같은 표다.
 * 여기 없는 이름은 그대로 적는다 — 모르는 필드를 아는 척 번역하지 않는다.
 */
export const IDENTITY_DRIFT_FIELD_LABELS: Record<string, string> = {
  sender: "발신",
  doc_number: "문서번호",
  seq_raw: "번호",
  title: "제목",
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
  /** `approval_flipped === true` 인 문서 수. 서버가 값을 싣지 않았으면 0(= 모르므로 말하지 않는다). */
  approvalFlippedDocuments: number;
  /**
   * **어느 항목도 `approval_flipped` 를 boolean 으로 싣지 않았다** = 승인 상태가 이번 적재에 움직였는지
   * **모른다**.
   *
   * 한정어 역방향 확인 — 이 값을 "`approvalFlippedDocuments === 0`"으로 갈음하면 안 된다. 0 은
   * "뒤집히지 않았다"(사실)와 "필드가 없어 모른다"(미상)를 같은 값으로 뭉갠다. 뭉개면 화면이 구버전
   * 응답에 대고 "승인 상태 값은 CM 이 판단할 때와 같습니다"라고 **관측하지 못한 사실**을 단정하게 된다.
   * `noNewDocId` 가 부재와 `null` 을 가르는 것과 같은 이유다(ADR 0009 §5-2 (마)).
   *
   * 서버(`_identity_drift_clause`)에는 이 갈래가 없다 — `LostDecision` TypedDict 가 `approval_flipped`
   * 를 **필수**로 요구하므로 생산 시점에는 부재가 존재할 수 없다. 화면은 DB 에 남은 개정 2 이전 요청을
   * 그대로 받아 그리므로 여기서만 필요하다(웹 `LostDecision.approval_flipped?: boolean | null`).
   */
  approvalFlippedUnknown: boolean;
  /** 이 묶음에서 실제로 달라진 행-정체 필드(서버가 실은 순서 그대로, 중복 제거). */
  changedFields: string[];
  /** 다시 판단할 수 있는 `doc_id` 들(중복 제거). 비어 있다고 "없다"는 뜻은 아니다 — `noNewDocId` 참고. */
  newDocIds: string[];
  /**
   * **모든 항목이 `new_doc_id` 를 명시적으로 `null` 로 실었다** = 다시 판단할 곳이 없다는 *사실*.
   *
   * 한정어 역방향 확인 — 이 값을 "`newDocIds` 가 비었다"로 계산하면 안 된다. 구버전 응답은 필드 자체가
   * 없고(`undefined`), 그것은 "없다"가 아니라 **"모른다"** 다. 없는 것을 없다고 단정하면 화면이 관측하지
   * 못한 사실을 말하게 된다(ADR 0009 §5-2 (마): `null` 은 사실이고 부재는 미상).
   */
  noNewDocId: boolean;
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
  const groups: LostDecisionGroup[] = [...byRaw.entries()].map(([rawCause, items]) => {
    const changedFields: string[] = [];
    for (const item of items) {
      for (const name of item.changed_fields ?? []) {
        if (!changedFields.includes(name)) changedFields.push(name);
      }
    }
    const newDocIds: string[] = [];
    for (const item of items) {
      const id = item.new_doc_id;
      if (typeof id === "string" && id.length > 0 && !newDocIds.includes(id)) newDocIds.push(id);
    }
    return {
      cause: classifyIdentityDriftCause(rawCause),
      rawCause,
      items,
      confirmed: items.filter((d) => d.decision !== DECISION_REJECTED).length,
      rejected: items.filter((d) => d.decision === DECISION_REJECTED).length,
      documents: new Set(items.map((d) => d.doc_id ?? "")).size,
      approvalFlippedDocuments: new Set(
        items.filter((d) => d.approval_flipped === true).map((d) => d.doc_id ?? ""),
      ).size,
      approvalFlippedUnknown:
        items.length > 0 && items.every((d) => typeof d.approval_flipped !== "boolean"),
      changedFields,
      newDocIds,
      noNewDocId: items.length > 0 && items.every((d) => d.new_doc_id === null),
    };
  });
  return groups.sort((a, b) => {
    const rank = IDENTITY_DRIFT_CAUSE_ORDER.indexOf(a.cause) - IDENTITY_DRIFT_CAUSE_ORDER.indexOf(b.cause);
    if (rank !== 0) return rank;
    return (a.rawCause ?? "").localeCompare(b.rawCause ?? "");
  });
}

/**
 * 그 묶음이 **실제로 싣고 온 값**에서만 유도한 문장들. 서버 `_identity_drift_clause` 가 값으로 문장을
 * 가르는 것과 같은 규칙이고, 이유도 같다: 경위 이름만 보고 단정하면 생산자가 값을 바꿨을 때 문구만
 * 거짓으로 남는다.
 *
 * 세 문장 모두 **한정어 역방향 확인**을 거쳤다(CLAUDE.md §6-3, 결과 표는 보고서에 있다):
 *
 * 1. 승인 뒤집힘 — `approval_flipped === true` 인 항목이 있을 때**만**. 늘 붙이면 뒤집히지 않은 적재에
 *    거짓이 되고, 반대로 이것을 묶음 표시의 게이트로 쓰면 승인 상태가 **우연히 같은** 다른 행으로 바뀐
 *    경우(ADR 0009 §5-2 (바) P6·P7)가 화면 밖으로 나간다. 그래서 **맨 앞에 세우기만** 한다.
 * 2. 달라진 필드 — `changed_fields` 가 있을 때만 나열한다. 비어 있으면 대장 원문 네 필드는 그대로이므로
 *    (ADR 0009 §5-2 (나-ii)) "다른 대장 행으로 바뀌었다"고 적을 수 없다. 그 경우 `row_replaced` 는
 *    관측한 것(내용이 달라졌다)만 적되, **무엇이 달라졌는지도 값에서 읽는다** — (나-ii)는 행-내용
 *    `(result_raw, approval_status)` 중 **어느 한쪽만** 달라져도 발화하므로, 늘 "처리결과·승인 상태"라고
 *    적으면 승인 상태가 그대로인 적재(실측 P13b: 행-정체가 같은 두 행의 처리결과가 `반려`/`부적합` —
 *    둘 다 `REJECTED` 라 `approval_flipped=False`)에서 CM 은 자기 승인 근거가 움직였다고 읽는다.
 *    서버 `_identity_drift_clause` 가 `132d116` 에서 같은 정정을 했다("담은 처리결과 표기가" /
 *    "담은 승인 상태가"). `approval_flipped` 를 아예 모르면(구버전 응답) 목록 자체를 적지 않는다.
 * 3. 지금 승인 상태는 어떤가 — `approval_flipped` **값**으로 세 갈래(아래 `row_replaced` 블록,
 *    서버 §5-3-b 결정표와 같은 규칙). 이 문장은 개정 2 까지 `IDENTITY_DRIFT_CAUSE_NOTES` 안에서
 *    **경위 이름만 보고 한정어 없이** "지금 보이는 승인 상태는 CM 이 보고 판단한 그 대장 행의 것이
 *    아닙니다"라고 붙었고, `approval_flipped=False` 인 다섯 경로(V8a·V8b·P8b·FP1·P13b)에서 거짓이었다.
 *    `row_replaced` 에만 붙인다 — 서버도 다른 두 경위의 절에서는 승인 상태를 말하지 않고, 생산자 계약상
 *    `row_moved`/`row_absorbed` 는 `approval_flipped` 가 언제나 `false` 라 말할 것이 없다.
 * 4. 다시 판단할 곳 — `new_doc_id` **값**에서 읽는다. 값이 있으면 그 doc_id 를 가리키고, 모든 항목이
 *    명시적 `null` 이면 "없다"고 적고, 필드 자체가 없으면(구버전 응답) **아무 말도 하지 않는다.**
 */
export function identityDriftGroupFacts(group: LostDecisionGroup): string[] {
  const facts: string[] = [];
  const flipped = group.approvalFlippedDocuments > 0;
  if (flipped) {
    facts.push(
      `도면 승인 근거가 뒤집혔습니다 — 문서 ${group.approvalFlippedDocuments}건의 승인 상태가 이번 적재에 달라졌습니다.`,
    );
  }
  if (group.changedFields.length > 0) {
    const labels = group.changedFields.map((name) => IDENTITY_DRIFT_FIELD_LABELS[name] ?? name);
    facts.push(`달라진 대장 원문: ${labels.join("·")}.`);
  } else if (group.cause === "row_replaced") {
    // 값에서 유도한 목록은 **꼬리에 붙인다**(`달라진 대장 원문: …` 과 같은 형태). 문장 가운데 넣으면
    // 뒤에 조사가 붙는데, 라벨의 받침이 런타임에 갈려 절반이 틀린다(서버가 `_particle` 을 태우는 이유).
    const head = "대장 원문(발신·문서번호·번호·제목)은 그대로인데, 그 doc_id 가 담은 내용이 달라졌습니다";
    if (group.approvalFlippedUnknown) {
      // 무엇이 달라졌는지는 `approval_flipped` 없이는 가릴 수 없다 — 아는 것(내용이 달라졌다)만 적는다.
      facts.push(`${head}.`);
    } else {
      const contents: string[] = [];
      if (group.items.some((d) => d.approval_flipped !== true)) contents.push("처리결과 표기");
      if (flipped) contents.push("승인 상태");
      facts.push(`${head} — ${contents.join("·")}.`);
    }
  }
  if (group.cause === "row_replaced" && !group.approvalFlippedUnknown) {
    if (flipped) {
      facts.push("그 판단은 지금 화면에 떠 있는 승인 상태와 다른 값 위에서 내려졌습니다.");
    } else if (group.changedFields.length > 0) {
      // 역방향 확인 — 여기서 "그 대장 행의 것이 아닙니다"라고 단정하면 대장이 **같은 행**의 표기를
      // 고쳐 적은 경우(V8a·V8b·P8b·FP1)에서 거짓이다. 시스템은 둘을 가를 수 없으므로 가를 수 없다고
      // 적고 판단은 CM 에게 넘긴다(ADR 0009 §5-2 (바)가 오탐을 남기기로 한 근거와 같은 자리).
      facts.push(
        "승인 상태 값 자체는 CM 이 판단할 때와 같습니다 — 달라진 것은 이 doc_id 가 담고 있는 대장 " +
          "원문이고, 대장이 같은 행을 고쳐 적은 것인지 다른 행으로 바뀐 것인지는 이번 적재의 값으로 " +
          "가릴 수 없습니다.",
      );
    } else {
      // 역방향 확인 — 이 갈래에서 "달라진 것은 대장 원문"이라고 적으면 `changed_fields === []` 가 말하는
      // 바로 그 사실(원문 네 필드는 그대로)을 뒤집는 거짓이 된다. 무엇이 달라졌는지는 위 문장이 이미
      // 적었으므로 여기서는 승인 상태만 말한다(서버 §5-3-b 결정표 셋째 줄).
      facts.push("승인 상태 값은 CM 이 판단할 때와 같습니다.");
    }
  }
  if (group.newDocIds.length > 0) {
    facts.push(`다시 판단할 곳: ${group.newDocIds.join(", ")}.`);
  } else if (group.noNewDocId) {
    facts.push("다시 판단할 새 doc_id 는 없습니다.");
  }
  return facts;
}

/**
 * **어디를 되돌려야 하는가** — 지문이 답한다(ADR 0009 §5-2 서두: 지문은 판정 조건이 아니라 이 하나를
 * 답하는 보고 값이다). 서버 `_identity_drift_review_title` 의 꼬리와 같은 갈래를 쓴다.
 *
 * 한정어 역방향 확인 — 늘 "config 를 되돌리십시오"라고 적으면 config 를 한 글자도 바꾸지 않은 경로
 * (워크북 시트명 변경: `fingerprint_changed=False`)에서 **거짓**이 되고, CM 은 바뀐 적 없는 config 를
 * 뒤지게 된다. 반대로 지문이 달라졌는데 "대장 파일을 보라"고 적으면 진짜 원인(우리 config)을 가린다.
 * 이전 지문을 모르면(첫 적재) 어느 쪽도 단정하지 않는다.
 */
export function identityDriftRemedyNote(
  previousFingerprint: string | null | undefined,
  currentFingerprint: string | null | undefined,
): string {
  if (!previousFingerprint) {
    return "이전 적재의 지문이 없어 식별 표면 config 와 대장 파일(시트명 등) 중 어느 쪽이 움직였는지 알 수 없습니다.";
  }
  if (previousFingerprint !== currentFingerprint) {
    return (
      "식별 표면 config(sender_aliases·sheet_doc_types·column_aliases)가 바뀌었습니다 — " +
      "되돌린 뒤 대장을 다시 올리십시오."
    );
  }
  return (
    "식별 표면 config 는 그대로입니다(지문 동일) — 대장 파일 쪽 입력(워크북 시트명 등)이 바뀌지 않았는지 " +
    "확인하십시오."
  );
}
