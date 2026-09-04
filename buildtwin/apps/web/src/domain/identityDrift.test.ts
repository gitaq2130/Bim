import {
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
});

describe("identityDriftGroupFacts — 값이 없으면 문장도 없다", () => {
  function factsFor(items: Parameters<typeof groupLostDecisionsByCause>[0]): string {
    return identityDriftGroupFacts(groupLostDecisionsByCause(items)[0]).join(" ");
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
    const text = factsFor([{ doc_id: "d1", cause: "row_replaced", changed_fields: [], new_doc_id: null }]);
    expect(text).toMatch(/대장 원문\(발신·문서번호·번호·제목\)은 그대로인데/);
    expect(text).toMatch(/처리결과·승인 상태/);
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

describe("identityDriftRemedyNote — 되돌릴 곳은 지문이 답한다", () => {
  it("지문이 달라졌으면 config 를 가리킨다", () => {
    const text = identityDriftRemedyNote("aaaa", "bbbb");
    expect(text).toMatch(/config/);
    expect(text).toMatch(/되돌린 뒤 대장을 다시 올리십시오/);
  });

  it("지문이 같으면 **config 를 되돌리라고 하지 않는다** — 시트명 변경 경로에서 거짓이다", () => {
    // 실측: 워크북 시트명 변경은 config 를 한 글자도 바꾸지 않는다(`fingerprint_changed=False`, moved=9).
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
