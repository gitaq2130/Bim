import { classifyIdentityDriftCause, groupLostDecisionsByCause } from "./identityDrift";

/**
 * 경위(`lost_decisions[].cause`) 분류·정렬(ADR 0009 §3·§5-2). 셋은 CM 이 해야 할 일이 다르므로
 * 뭉개지 않는지, 그리고 되돌릴 수 없는 경위가 맨 앞에 서는지 여기서 직접 확인한다.
 */
describe("classifyIdentityDriftCause", () => {
  it("서버 `cause` 세 값을 그대로 갈래로 받는다", () => {
    expect(classifyIdentityDriftCause("orphaned")).toBe("orphaned");
    expect(classifyIdentityDriftCause("merge_overwritten")).toBe("merge_overwritten");
    expect(classifyIdentityDriftCause("merge_absorbed")).toBe("merge_absorbed");
  });

  it("cause 가 없거나 모르는 값이면 unspecified — **orphaned 로 떨어뜨리지 않는다**", () => {
    // 모르는 것을 고아라고 적으면 화면이 고치려는 바로 그 거짓이 된다(서버 _CAUSE_UNSPECIFIED 주석과 같은 규칙).
    for (const v of [undefined, null, "", "unspecified", "some_new_cause_v2"]) {
      expect(classifyIdentityDriftCause(v)).toBe("unspecified");
      expect(classifyIdentityDriftCause(v)).not.toBe("orphaned");
    }
  });
});

describe("groupLostDecisionsByCause", () => {
  it("가장 위험한 경위(merge_overwritten)를 맨 앞에 세운다 — 입력 순서와 무관하게", () => {
    // ADR 0009 §3: 병합만이 "미승인 도면 위에서 착수 가능을 띄우는" 되돌릴 수 없는 실패다.
    const groups = groupLostDecisionsByCause([
      { activity_id: "A1", doc_id: "d1", decision: "confirmed", cause: "orphaned" },
      { activity_id: "A2", doc_id: "d2", decision: "rejected", cause: "merge_absorbed" },
      { activity_id: "A3", doc_id: "d3", decision: "confirmed", cause: "merge_overwritten" },
      { activity_id: "A4", doc_id: "d4", decision: "confirmed", cause: "wat" },
    ]);
    expect(groups.map((g) => g.cause)).toEqual([
      "merge_overwritten",
      "merge_absorbed",
      "orphaned",
      "unspecified",
    ]);
  });

  it("경위별 건수를 그 경위의 몫만 센다 — 확정/반려/문서 수를 합쳐 세지 않는다", () => {
    const groups = groupLostDecisionsByCause([
      { activity_id: "A1", doc_id: "d1", decision: "confirmed", cause: "orphaned" },
      { activity_id: "A2", doc_id: "d1", decision: "rejected", cause: "orphaned" },
      { activity_id: "A3", doc_id: "d9", decision: "confirmed", cause: "merge_overwritten" },
    ]);
    const orphaned = groups.find((g) => g.cause === "orphaned");
    expect(orphaned?.items).toHaveLength(2);
    expect(orphaned?.confirmed).toBe(1);
    expect(orphaned?.rejected).toBe(1);
    // 한 문서에 여러 Activity 매핑이 걸릴 수 있다 — 판단 2건이지만 문서는 1건이다.
    expect(orphaned?.documents).toBe(1);
  });

  it("decision 이 없으면 확정으로 센다 — 서버 `_decision_counts`(반려 표시만 반려)와 같은 규칙", () => {
    const [g] = groupLostDecisionsByCause([{ activity_id: "A1", doc_id: "d1", cause: "orphaned" }]);
    expect(g.confirmed).toBe(1);
    expect(g.rejected).toBe(0);
  });

  it("모르는 값은 원문을 rawCause 로 남긴다 — 화면이 그 값을 그대로 드러낼 수 있도록", () => {
    const [g] = groupLostDecisionsByCause([{ activity_id: "A1", doc_id: "d1", cause: "some_new_cause_v2" }]);
    expect(g.cause).toBe("unspecified");
    expect(g.rawCause).toBe("some_new_cause_v2");
  });
});
