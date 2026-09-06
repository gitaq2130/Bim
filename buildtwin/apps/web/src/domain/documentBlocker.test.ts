import { classifyDrawingApprovalBlocker } from "./documentBlocker";

/**
 * ADR 0007 §5-3의 세 가지 고정 문구(services/progress/readiness.py 가 커밋한 표현)를 분류한다.
 * 세 갈래는 CM이 해야 할 행동이 다르다 — 뭉개지 않는지 여기서 직접 확인한다.
 */
describe("classifyDrawingApprovalBlocker", () => {
  it("'n건의 필수 문서가 미승인' 문구는 unapproved로 분류한다", () => {
    const reason = "2건의 필수 문서가 미승인: 동부-HG-TFA-전기-26-049 «1F 기둥 배근도 승인요청» (REJECTED); 외 1건";
    expect(classifyDrawingApprovalBlocker(reason)).toBe("unapproved");
  });

  it("'CM 검토 대기' 문구는 pending_mapping으로 분류한다", () => {
    const reason = "문서 매핑 3건이 CM 검토 대기 — 확정 전까지 도면 승인 근거로 쓰지 않음";
    expect(classifyDrawingApprovalBlocker(reason)).toBe("pending_mapping");
  });

  it("UNKNOWN만 있을 때(처리결과 미기재)는 unknown_only로 분류하고 unapproved와 구분한다", () => {
    const reason = "동부-HG-TFA-전기-26-049 «1F 기둥 배근도 승인요청» 처리결과 미기재(UNKNOWN)";
    expect(classifyDrawingApprovalBlocker(reason)).toBe("unknown_only");
    expect(classifyDrawingApprovalBlocker(reason)).not.toBe("unapproved");
  });

  it("알 수 없는 문구는 other로 분류한다(다른 구성요소의 reason과 섞이지 않도록 방어)", () => {
    expect(classifyDrawingApprovalBlocker("1/2 predecessor activities not CONFIRMED")).toBe("other");
  });
});
