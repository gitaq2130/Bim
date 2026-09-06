import {
  IDENTITY_DRIFT_CAUSE_NOTES,
  classifyIdentityDriftCause,
  groupLostDecisionsByCause,
  identityDriftGroupFacts,
  identityDriftRemedyNote,
} from "./identityDrift";

/**
 * 경위(`lost_decisions[].cause`) 분류·정렬·값 유래 문장(ADR 0009 §3·§5-2 (마)·§5-3). 셋은 CM 이 해야 할
 * 일이 다르므로 뭉개지 않는지, 되돌릴 수 없는 경위가 맨 앞에 서는지, 그리고 **문구가 아는 것만 말하는지**를
 * 여기서 직접 확인한다.
 *
 * **옛 이름 셋(`orphaned`·`merge_overwritten`·`merge_absorbed`)을 계약으로 고정하지 않는다.** 이 파일은
 * 개정 2 직전까지 그 셋을 계약으로 고정하고 있었고, 그래서 서버가 이름을 사실에 맞게 고쳐도(그 이름들이
 * 관측과 어긋난다는 것이 개명의 이유였다 — 실측 P3 `is_orphaned=False`, R1 `merged=0`) 웹 테스트는
 * **전원 초록**이었다. 거짓을 계약으로 고정한 테스트는 방어가 아니다(CLAUDE.md §6-4 규칙 3).
 */
describe("classifyIdentityDriftCause", () => {
  it("서버 `cause` 세 값을 그대로 갈래로 받는다", () => {
    expect(classifyIdentityDriftCause("row_moved")).toBe("row_moved");
    expect(classifyIdentityDriftCause("row_replaced")).toBe("row_replaced");
    expect(classifyIdentityDriftCause("row_absorbed")).toBe("row_absorbed");
  });

  it("cause 가 없거나 모르는 값이면 unspecified — **row_moved 로 떨어뜨리지 않는다**", () => {
    // 모르는 것을 가장 흔한 경위로 적으면 화면이 고치려는 바로 그 거짓이 된다(서버 _CAUSE_UNSPECIFIED 주석과 같은 규칙).
    for (const v of [undefined, null, "", "unspecified", "some_new_cause_v2"]) {
      expect(classifyIdentityDriftCause(v)).toBe("unspecified");
      expect(classifyIdentityDriftCause(v)).not.toBe("row_moved");
    }
  });

  it("옛 이름 셋도 모르는 값이다 — 새 갈래로 조용히 번역하지 않는다", () => {
    // 옛 이름은 관측과 어긋나 있어서 개명됐다(ADR 0009 §5-2 (마)). 그것을 새 갈래로 옮겨 주면 개명이
    // 걷어낸 거짓 문구("고아"·"병합")를 화면이 그 값에 다시 붙이게 된다.
    for (const v of ["orphaned", "merge_overwritten", "merge_absorbed"]) {
      expect(classifyIdentityDriftCause(v)).toBe("unspecified");
    }
  });
});

describe("groupLostDecisionsByCause", () => {
  it("가장 위험한 경위(row_replaced)를 맨 앞에 세운다 — 입력 순서와 무관하게", () => {
    // ADR 0009 §3: row_replaced 만이 "미승인 도면 위에서 착수 가능을 띄우는" 되돌릴 수 없는 실패다.
    const groups = groupLostDecisionsByCause([
      { activity_id: "A1", doc_id: "d1", decision: "confirmed", cause: "row_moved" },
      { activity_id: "A2", doc_id: "d2", decision: "rejected", cause: "row_absorbed" },
      { activity_id: "A3", doc_id: "d3", decision: "confirmed", cause: "row_replaced" },
      { activity_id: "A4", doc_id: "d4", decision: "confirmed", cause: "wat" },
    ]);
    expect(groups.map((g) => g.cause)).toEqual([
      "row_replaced",
      "row_absorbed",
      "row_moved",
      "unspecified",
    ]);
  });

  it("경위별 건수를 그 경위의 몫만 센다 — 확정/반려/문서 수를 합쳐 세지 않는다", () => {
    const groups = groupLostDecisionsByCause([
      { activity_id: "A1", doc_id: "d1", decision: "confirmed", cause: "row_moved" },
      { activity_id: "A2", doc_id: "d1", decision: "rejected", cause: "row_moved" },
      { activity_id: "A3", doc_id: "d9", decision: "confirmed", cause: "row_replaced" },
    ]);
    const moved = groups.find((g) => g.cause === "row_moved");
    expect(moved?.items).toHaveLength(2);
    expect(moved?.confirmed).toBe(1);
    expect(moved?.rejected).toBe(1);
    // 한 문서에 여러 Activity 매핑이 걸릴 수 있다 — 판단 2건이지만 문서는 1건이다.
    expect(moved?.documents).toBe(1);
  });

  it("decision 이 없으면 확정으로 센다 — 서버 `_decision_counts`(반려 표시만 반려)와 같은 규칙", () => {
    const [g] = groupLostDecisionsByCause([{ activity_id: "A1", doc_id: "d1", cause: "row_moved" }]);
    expect(g.confirmed).toBe(1);
    expect(g.rejected).toBe(0);
  });

  it("모르는 값은 원문을 rawCause 로 남긴다 — 화면이 그 값을 그대로 드러낼 수 있도록", () => {
    const [g] = groupLostDecisionsByCause([{ activity_id: "A1", doc_id: "d1", cause: "some_new_cause_v2" }]);
    expect(g.cause).toBe("unspecified");
    expect(g.rawCause).toBe("some_new_cause_v2");
  });

  it("`new_doc_id` 가 **명시적 null** 일 때만 '다시 판단할 곳 없음'이다 — 필드 부재는 '모른다'다", () => {
    // ADR 0009 §5-2 (마): null 은 "없다"는 사실이고, 구버전 응답의 필드 부재는 그 사실이 아니다.
    const [explicitNull] = groupLostDecisionsByCause([
      { activity_id: "A1", doc_id: "d1", cause: "row_replaced", new_doc_id: null },
    ]);
    expect(explicitNull.noNewDocId).toBe(true);
    const [missing] = groupLostDecisionsByCause([{ activity_id: "A1", doc_id: "d1", cause: "row_replaced" }]);
    expect(missing.noNewDocId).toBe(false);
    expect(missing.newDocIds).toEqual([]);
  });

  it("승인 뒤집힘은 문서 단위로 센다 — 같은 문서에 매핑이 둘이어도 1건이다", () => {
    const [g] = groupLostDecisionsByCause([
      { activity_id: "A1", doc_id: "d1", cause: "row_replaced", approval_flipped: true },
      { activity_id: "A2", doc_id: "d1", cause: "row_replaced", approval_flipped: true },
      { activity_id: "A3", doc_id: "d2", cause: "row_replaced", approval_flipped: false },
    ]);
    expect(g.approvalFlippedDocuments).toBe(1);
  });

  it("`changed_fields` **부재**는 '원문 네 필드는 그대로'가 아니라 '모른다'다", () => {
    // `?? []` 로 뭉개면 빈 배열이 되는데, 빈 배열은 이 화면에서 **관측된 사실**로 문장이 된다
    // ("대장 원문(…)은 그대로인데…"). 그래서 `approval_flipped`·`new_doc_id` 와 같은 규칙을 이 필드에도
    // 적용한다(ADR 0009 §5-3-b — 저장된 기록을 읽는 소비자는 **언제나** '값이 없다' 갈래를 더 가진다).
    const [missing] = groupLostDecisionsByCause([{ doc_id: "d1", cause: "row_replaced" }]);
    expect(missing.changedFields).toEqual([]);
    expect(missing.changedFieldsUnknown).toBe(true);

    // 빈 배열은 관측이다 — 부재와 같은 값으로 뭉개지 않는다.
    const [observedEmpty] = groupLostDecisionsByCause([
      { doc_id: "d1", cause: "row_replaced", changed_fields: [] },
    ]);
    expect(observedEmpty.changedFieldsUnknown).toBe(false);

    // 목록이 아닌 값(`null`)도 관측이 아니다 — 서버는 이 경위에 언제나 목록을 싣는다.
    const [nulled] = groupLostDecisionsByCause([
      { doc_id: "d1", cause: "row_replaced", changed_fields: null },
    ]);
    expect(nulled.changedFieldsUnknown).toBe(true);

    // 한 항목이라도 목록을 실었으면 '모른다'가 아니다.
    const [partial] = groupLostDecisionsByCause([
      { doc_id: "d1", cause: "row_replaced" },
      { doc_id: "d2", cause: "row_replaced", changed_fields: ["sender"] },
    ]);
    expect(partial.changedFieldsUnknown).toBe(false);
  });

  it("`approval_flipped` **부재**는 '뒤집히지 않았다'가 아니라 '모른다'다", () => {
    // approvalFlippedDocuments === 0 은 두 사실을 뭉갠다 — false(관측)와 부재(미상). 뭉개면 화면이
    // 구버전 응답에 대고 "승인 상태 값은 CM 이 판단할 때와 같습니다"라고 단정하게 된다(`noNewDocId` 와
    // 같은 이유, ADR 0009 §5-2 (마)).
    const [missing] = groupLostDecisionsByCause([{ doc_id: "d1", cause: "row_replaced" }]);
    expect(missing.approvalFlippedDocuments).toBe(0);
    expect(missing.approvalFlippedUnknown).toBe(true);

    const [observedFalse] = groupLostDecisionsByCause([
      { doc_id: "d1", cause: "row_replaced", approval_flipped: false },
    ]);
    expect(observedFalse.approvalFlippedDocuments).toBe(0);
    expect(observedFalse.approvalFlippedUnknown).toBe(false);
  });
});

describe("identityDriftGroupFacts — 값이 없으면 문장도 없다", () => {
  function factsFor(items: Parameters<typeof groupLostDecisionsByCause>[0]): string {
    return identityDriftGroupFacts(groupLostDecisionsByCause(items)[0]).join(" ");
  }

  /** (나-ii) 문장 **하나만** 떼어 읽는다. 묶어 읽으면 뒤따르는 승인 상태 문장의 "승인 상태"가 함께
   *  걸려, "이 문장이 승인 상태를 말하지 않는다"는 단언이 아무것도 가르지 못한다. */
  function contentFact(items: Parameters<typeof groupLostDecisionsByCause>[0]): string {
    const facts = identityDriftGroupFacts(groupLostDecisionsByCause(items)[0]);
    const hit = facts.filter((f) => f.startsWith("대장 원문(발신·문서번호·번호·제목)은 그대로인데"));
    expect(hit).toHaveLength(1);   // 문장이 사라지면 "없어서 통과"가 아니라 여기서 죽는다
    return hit[0];
  }

  it("승인 뒤집힘은 approval_flipped 가 참일 때만 말한다", () => {
    expect(factsFor([{ doc_id: "d1", cause: "row_replaced", approval_flipped: true, new_doc_id: null }]))
      .toMatch(/도면 승인 근거가 뒤집혔습니다/);
    // 뒤집히지 않은 적재에 그 문장을 붙이면 그것이 곧 거짓이다. 발화 자체는 뒤집힘과 무관하게 유지된다
    // (ADR 0009 §5-2 (바) P6·P7 — 승인 상태가 우연히 같은 다른 행으로 바뀐 경우를 밀어내지 않는다).
    const notFlipped = factsFor([
      { doc_id: "d1", cause: "row_replaced", approval_flipped: false, new_doc_id: null, changed_fields: ["sender"] },
    ]);
    expect(notFlipped).not.toMatch(/뒤집/);
    expect(notFlipped).toMatch(/발신/);
  });

  it("달라진 대장 원문은 changed_fields 를 라벨로 나열한다 — 서버 `_ROW_IDENTITY_FIELD_LABELS` 와 같은 표", () => {
    const text = factsFor([
      { doc_id: "d1", cause: "row_replaced", changed_fields: ["sender", "doc_number"], new_doc_id: null },
    ]);
    expect(text).toMatch(/발신·문서번호/);
  });

  it("changed_fields 가 비면 '다른 대장 행으로 바뀌었다'고 단정하지 않는다(ADR 0009 §5-2 (나-ii))", () => {
    const text = factsFor([
      { doc_id: "d1", cause: "row_replaced", changed_fields: [], new_doc_id: null, approval_flipped: false },
    ]);
    expect(text).toMatch(/대장 원문\(발신·문서번호·번호·제목\)은 그대로인데/);
  });

  it("(나-ii) 에서 **무엇이** 달라졌는지도 값에서 읽는다 — 승인 상태가 그대로면 그렇게 적지 않는다", () => {
    // (나-ii)는 result_raw / approval_status **중 한쪽만** 달라져도 발화한다. 실측 P13b: 행-정체가 같은
    // 두 행의 처리결과가 `반려`/`부적합` 이라 둘 다 REJECTED — 승인 상태는 한 글자도 달라지지 않았다.
    // 늘 "처리결과·승인 상태"라고 적으면 CM 은 자기 승인 근거가 움직였다고 읽는다(서버 132d116 과 같은 정정).
    const unchanged = contentFact([
      { doc_id: "d1", cause: "row_replaced", changed_fields: [], new_doc_id: null, approval_flipped: false },
    ]);
    expect(unchanged).toMatch(/처리결과 표기/);
    expect(unchanged).not.toMatch(/승인 상태/);

    // 반대쪽도 건다 — 뒤집힌 적재에서 그 말을 빼면 그것대로 관측한 사실을 숨기는 것이다.
    const flipped = contentFact([
      { doc_id: "d1", cause: "row_replaced", changed_fields: [], new_doc_id: null, approval_flipped: true },
    ]);
    expect(flipped).toMatch(/승인 상태/);
    expect(flipped).not.toMatch(/처리결과 표기/);

    // 한 묶음에 둘이 섞이면 둘 다 적는다(서버 `contents` 두 줄과 같은 규칙).
    const mixed = contentFact([
      { doc_id: "d1", cause: "row_replaced", changed_fields: [], new_doc_id: null, approval_flipped: true },
      { doc_id: "d2", cause: "row_replaced", changed_fields: [], new_doc_id: null, approval_flipped: false },
    ]);
    expect(mixed).toMatch(/처리결과 표기·승인 상태/);

    // `approval_flipped` 를 아예 모르면 어느 쪽도 적지 않는다 — 부재는 관측이 아니다.
    const unknown = contentFact([{ doc_id: "d1", cause: "row_replaced", changed_fields: [], new_doc_id: null }]);
    expect(unknown).toMatch(/내용이 달라졌습니다\.$/);
    expect(unknown).not.toMatch(/처리결과 표기|승인 상태/);
  });

  it("`changed_fields` 를 모르면 대장 원문에 대해 **어느 쪽으로도** 말하지 않는다", () => {
    // 부재를 `[]` 로 읽으면 화면은 "원문 네 필드는 그대로"라고 관측한 적 없는 사실을 단정한다.
    // 문장을 통째로 베끼지 않고 "그 상황에서 참일 수 없는 말이 없다"를 건다(CLAUDE.md §6-4 규칙 3).
    const unknown = factsFor([
      { doc_id: "d1", cause: "row_replaced", approval_flipped: false, new_doc_id: null },
    ]);
    // 원문 네 필드를 관측했다는 말은 어느 형태로도 있을 수 없다 — "그대로"(부재를 관측으로 읽음)도,
    // "달라진 대장 원문: …"(무엇이 달라졌는지 안다)도.
    expect(unknown).not.toMatch(/대장 원문/);
    // 꼬리 목록도 같은 관측 위에 서 있다 — "달라진 것은 처리결과 표기뿐"은 행-정체가 그대로라는 사실
    // ((나-ii))이 있어야 참이고, 부재는 그 사실이 아니다.
    expect(unknown).not.toMatch(/처리결과 표기/);
    // 그렇다고 승인 상태까지 함께 삼키지는 않는다 — `approval_flipped=false` 는 **관측한 값**이다.
    expect(unknown).toMatch(/승인 상태 값은 CM 이 판단할 때와 같습니다/);

    // 반대쪽 — 빈 배열은 관측이므로 그 절이 살아 있어야 한다. 한쪽만 걸면 그 문장을 아예 안 적는
    // 구현도 통과한다(CLAUDE.md §6-2).
    const observed = factsFor([
      { doc_id: "d1", cause: "row_replaced", approval_flipped: false, new_doc_id: null, changed_fields: [] },
    ]);
    expect(observed).toMatch(/대장 원문\(발신·문서번호·번호·제목\)은 그대로인데/);
  });

  it("다시 판단할 곳은 new_doc_id **값**에서 읽는다 — 없으면 없다고, 모르면 아무 말도 하지 않는다", () => {
    expect(factsFor([{ doc_id: "d1", cause: "row_absorbed", new_doc_id: "doc-new" }]))
      .toMatch(/다시 판단할 곳: doc-new/);
    expect(factsFor([{ doc_id: "d1", cause: "row_replaced", new_doc_id: null }]))
      .toMatch(/다시 판단할 새 doc_id 는 없습니다/);
    // 구버전 응답(필드 없음)에서는 어느 쪽도 말하지 않는다.
    const unknown = factsFor([{ doc_id: "d1", cause: "some_new_cause_v2" }]);
    expect(unknown).not.toMatch(/다시 판단할/);
  });
});

/**
 * **승인 상태 문장은 경위 이름이 아니라 `approval_flipped` 값이 가른다**(서버 `_identity_drift_clause`
 * 세 갈래 = ADR 0009 §5-3-b, 커밋 `132d116`).
 *
 * 이 화면은 개정 2 까지 `IDENTITY_DRIFT_CAUSE_NOTES.row_replaced` 안에서 **한정어 없이** "지금 보이는
 * 승인 상태는 CM 이 보고 판단한 그 대장 행의 것이 아닙니다 — 대장 원본과 대조해 승인 상태부터
 * 확인하십시오"라고 적었다. 그 문장은 `approval_flipped=False` 인 다섯 경로(V8a·V8b·P8b·FP1·P13b)에서
 * **거짓**이고(승인 상태 값이 CM 이 판단할 때와 같다), 뒷문장은 ADR 0009 §5-2 (바)가 오탐을 남기기로 한
 * 근거("대가는 부수효과 없는 확인 요청 1건")를 깬다 — 화면이 도면을 다시 열라고 시키면 대가가 CM 의
 * 도면 재확인 1회가 된다.
 *
 * 그래서 **세 갈래를 양쪽으로 건다**: 그 갈래에 표지가 있다 + 다른 갈래의 표지가 없다. 한쪽만 걸면
 * "그 문장을 아예 안 적는" 구현도 통과한다(CLAUDE.md §6-2).
 */
describe("identityDriftGroupFacts — 승인 상태는 approval_flipped 값이 가른다", () => {
  function factsFor(items: Parameters<typeof groupLostDecisionsByCause>[0]): string {
    return identityDriftGroupFacts(groupLostDecisionsByCause(items)[0]).join(" ");
  }

  // 표지는 **그 자리에서만 참인 최소 단위**로 고른다. `없습니다` 같은 조각은 "…가릴 수 없습니다"와
  // "다시 판단할 새 doc_id 는 없습니다"에 함께 걸려 아무것도 가르지 못한다(서버 쪽에서 실제로 난 사고).
  const FLIPPED_MARK = /다른 값 위에서 내려졌습니다/;
  const SAME_MARK = /CM 이 판단할 때와 같습니다/;
  const CANNOT_TELL_MARK = /이번 적재의 값으로 가릴 수 없습니다/;
  const ONLY_SAME_MARK = /승인 상태 값은 CM 이 판단할 때와 같습니다/;   // "값 자체는" 갈래에는 걸리지 않는다

  it("뒤집힘 — 그 판단이 다른 값 위에서 내려졌다고 적고, '같다'고는 적지 않는다", () => {
    const text = factsFor([
      { doc_id: "d1", cause: "row_replaced", approval_flipped: true, changed_fields: ["sender"], new_doc_id: null },
    ]);
    expect(text).toMatch(FLIPPED_MARK);
    expect(text).not.toMatch(SAME_MARK);
  });

  it("안 뒤집힘 + 달라진 원문 있음 — 값은 같고, 같은 행을 고쳐 적은 것인지 **가릴 수 없다**고 적는다", () => {
    // 실측 P6(발신 정정)·P7·FP1(번호 표기)·P8b(제목 공백): approval_flipped=False, drawing_approval 0.0 → 0.0.
    const text = factsFor([
      { doc_id: "d1", cause: "row_replaced", approval_flipped: false, changed_fields: ["sender"], new_doc_id: null },
    ]);
    expect(text).toMatch(SAME_MARK);
    expect(text).toMatch(CANNOT_TELL_MARK);
    // 뒤집힘 갈래의 표지가 여기 있으면 갈래가 서지 않은 것이다.
    expect(text).not.toMatch(FLIPPED_MARK);
    // 그리고 이 적재에서 참일 수 없는 말이 하나도 없어야 한다(CLAUDE.md §6-4 규칙 3).
    expect(text).not.toMatch(/그 대장 행의 것이 아닙니다/);
    expect(text).not.toMatch(/뒤집/);
  });

  it("안 뒤집힘 + 달라진 원문 없음 — 승인 상태만 말하고 '대장 원문이 달라졌다'고는 하지 않는다", () => {
    // 실측 P13b. changed_fields === [] 가 말하는 사실(원문 네 필드는 그대로)을 뒤집으면 안 된다.
    const text = factsFor([
      { doc_id: "d1", cause: "row_replaced", approval_flipped: false, changed_fields: [], new_doc_id: null },
    ]);
    expect(text).toMatch(ONLY_SAME_MARK);
    expect(text).not.toMatch(FLIPPED_MARK);
    expect(text).not.toMatch(CANNOT_TELL_MARK);
    expect(text).not.toMatch(/달라진 대장 원문/);
  });

  it("`approval_flipped` 를 모르면 승인 상태를 **어느 쪽으로도** 말하지 않는다", () => {
    const text = factsFor([{ doc_id: "d1", cause: "row_replaced", changed_fields: ["sender"], new_doc_id: null }]);
    expect(text).not.toMatch(SAME_MARK);
    expect(text).not.toMatch(FLIPPED_MARK);
    expect(text).not.toMatch(CANNOT_TELL_MARK);
    // 아는 것(무엇이 달라졌는지)은 그대로 적는다 — 침묵이 목적이 아니다.
    expect(text).toMatch(/달라진 대장 원문: 발신/);
  });

  it("다른 경위에는 승인 상태 문장을 붙이지 않는다 — 서버도 그 절에서 승인 상태를 말하지 않는다", () => {
    // 음성 대조군을 `row_replaced` 축에만 몰지 않는다(CLAUDE.md §6-2 3). 생산자 계약상
    // row_moved/row_absorbed 는 approval_flipped 가 언제나 false 라, 붙이면 "같습니다"가 무한 반복된다.
    for (const cause of ["row_moved", "row_absorbed", "some_new_cause_v2"]) {
      const text = factsFor([
        { doc_id: "d1", cause, approval_flipped: false, changed_fields: [], new_doc_id: "doc-new" },
      ]);
      expect(text).not.toMatch(SAME_MARK);
      expect(text).not.toMatch(FLIPPED_MARK);
      expect(text).not.toMatch(CANNOT_TELL_MARK);
    }
  });
});

describe("IDENTITY_DRIFT_CAUSE_NOTES — 경위 이름만 보고 값을 단정하지 않는다", () => {
  it("row_replaced 상수가 승인 상태를 단정하지도, 도면을 다시 열라고 시키지도 않는다", () => {
    const note = IDENTITY_DRIFT_CAUSE_NOTES.row_replaced;
    // ① 상수는 approval_flipped 를 볼 수 없다 — 그 자리에서 승인 상태를 단정하면 다섯 경로에서 거짓이다.
    expect(note).not.toMatch(/그 대장 행의 것이 아닙니다/);
    expect(note).not.toMatch(/뒤집/);
    // ② "승인 상태부터 확인하십시오"는 ADR 0009 §5-2 (바)의 비용 전제(부수효과 없는 확인 요청 1건)를 깬다.
    expect(note).not.toMatch(/확인하십시오|대조해|다시 여|열어/);
    // 그래도 이 경위가 무엇인지는 말해야 한다 — 지우고 끝내는 구현을 막는다.
    expect(note).toMatch(/내용이 CM 이 판단한 뒤 달라졌습니다/);
    expect(note).toMatch(/화면에는 이상이 보이지 않습니다/);
  });
});

describe("identityDriftRemedyNote — 되돌릴 곳은 지문이 답한다", () => {
  it("지문이 달라졌으면 config 를 가리킨다", () => {
    const text = identityDriftRemedyNote("aaaa", "bbbb");
    expect(text).toMatch(/config/);
    expect(text).toMatch(/되돌린 뒤 대장을 다시 올리십시오/);
  });

  it("지문이 같으면 **config 를 되돌리라고 하지 않는다** — 시트명 변경 경로에서 거짓이다", () => {
    // 실측: 워크북 시트명 변경은 config 를 한 글자도 바꾸지 않는다(`fingerprint_changed=False`, moved=8).
    // 그때 "config 를 되돌리십시오"라고 적으면 CM 은 바뀐 적 없는 config 를 뒤진다(ADR 0009 §5-2 서두).
    const text = identityDriftRemedyNote("aaaa", "aaaa");
    expect(text).not.toMatch(/되돌린 뒤|되돌리십시오/);
    expect(text).toMatch(/대장 파일 쪽 입력|시트명/);
  });

  it("이전 지문이 없으면(첫 적재) 어느 쪽도 단정하지 않는다", () => {
    for (const previous of [null, undefined, ""]) {
      const text = identityDriftRemedyNote(previous, "bbbb");
      expect(text).toMatch(/알 수 없습니다/);
      expect(text).not.toMatch(/되돌린 뒤|되돌리십시오/);
    }
  });
});
