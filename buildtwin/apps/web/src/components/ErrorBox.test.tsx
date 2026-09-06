import { render, screen } from "@testing-library/react";
import { ApiError, type ApiErrorCode } from "../api/client";
import { ErrorBox, errorText } from "./ErrorBox";

/** code 를 실어 나르는 ApiError. `code` 가 body 에 있어야 client.ts 가 파싱하므로 body 로 넣는다. */
function apiError(status: number, detail: string, code?: ApiErrorCode): ApiError {
  return new ApiError(status, detail, code ? { detail, code } : { detail });
}

describe("errorText", () => {
  it("401 은 (code 가 없을 때) 로그인 필요 문구를 반환한다", () => {
    expect(errorText(apiError(401, "unauthorized"))).toContain("로그인이 필요합니다");
  });

  it("403 은 (code 가 없을 때) 권한 문구를 반환한다", () => {
    expect(errorText(apiError(403, "forbidden"))).toContain("권한이 없습니다");
  });

  // 리뷰어 라운드4 관찰1: 5가지 이상의 서로 다른 409 원인을 하나의 "여러 프로젝트에 존재" 문구로
  // 뭉개면 안 된다. code 별로 실제 원인과 다음 행동을 알리는 별도 문구여야 한다.
  it("ambiguous_global_id 는 '여러 프로젝트에 존재' 문구를 반환한다", () => {
    const msg = errorText(apiError(409, "ambiguous global_id across projects", "ambiguous_global_id"));
    expect(msg).toContain("여러 프로젝트");
  });

  it("invalid_transition 은 상태 전이 불가 문구를 반환하고 '여러 프로젝트'를 언급하지 않는다", () => {
    const msg = errorText(apiError(409, "invalid transition", "invalid_transition"));
    expect(msg).toContain("수행할 수 없습니다");
    expect(msg).not.toContain("여러 프로젝트");
  });

  /**
   * ADR 0011 — `revocation_reason_required`(409)는 `invalid_transition` 에서 **갈라 나온** code 다.
   * 갈라 놓은 이유가 문구이므로, 이 자리에서 검증할 것은 "문구가 존재한다"가 아니라 **"그 상황에서
   * 참일 수 없는 말이 없다"**(CLAUDE.md §6-4 3 — 문장을 통째로 베끼면 거짓 문구가 계약이 된다).
   *
   * 참일 수 없는 말 둘:
   *  ① "새로고침" — 서버 상태는 최신이고 새로고침해도 달라지지 않는다.
   *  ② "수행할 수 없습니다"류 불가 선언 — 전이는 허용 표에 있다. 지금 없는 것은 사유뿐이다.
   *
   * **왜 부재 단언만으로는 부족한가(§6-2 1).** `KnownApiErrorCode` 유니온에 이 code 를 넣지 않으면
   * `errorText` 는 서버 `detail` 폴백(3번 분기)으로 조용히 떨어지는데, 그 영어 detail 에도 "새로고침"
   * 은 없다 — 즉 ①②만 있으면 **유니온 누락이라는 정확히 그 결함이 통과한다**(이 파일이 아니라
   * ErrorBox.tsx 주석이 `admin_cannot_be_member` 때 그 경로를 기록해 뒀다). 그래서 "다음 행동을
   * 말한다(사유)"와 "detail 폴백이 아니다"를 함께 단언한다.
   */
  it("revocation_reason_required 는 다음 행동(사유 입력)을 말하고, 이 자리에서 참일 수 없는 말을 하지 않는다", () => {
    const detail = "CONFIRMED -> MISMATCH by cm not allowed. leaving CONFIRMED requires evidence.note (revocation reason)";
    const msg = errorText(apiError(409, detail, "revocation_reason_required"));

    // 다음 행동이 문장 안에 있다 + detail 폴백이 아니다(유니온 누락이면 여기서 죽는다)
    expect(msg).toContain("사유");
    expect(msg).not.toContain(detail);
    expect(msg).not.toContain("(409)");

    // 이 상황에서 참일 수 없는 말
    expect(msg).not.toContain("새로고침");
    expect(msg).not.toContain("수행할 수 없습니다");

    // invalid_transition 과 같은 문구로 뭉개지 않았다 — 갈라 놓은 code 의 존재 이유가 그것이다
    expect(msg).not.toBe(errorText(apiError(409, detail, "invalid_transition")));
  });

  it("대조군: invalid_transition 은 여전히 새로고침을 안내한다(위 부재 단언이 문구 전반의 성질이 아님을 고정)", () => {
    expect(errorText(apiError(409, "invalid transition", "invalid_transition"))).toContain("새로고침");
  });

  /**
   * ADR 0012 규칙 4·5 (다) / 계획 0005 V9 — `rejection_reason_required`(409)는 **새로 가른** code 다.
   * 가른 근거가 문구이므로(ADR 0012 규칙 4 의 후보 표: 세 후보를 그 code 의 **지금 화면 문구**를 읽고
   * 기각했다), 여기서 볼 것은 "문구가 있다"가 아니라 **"그 상황에서 참일 수 없는 말이 없다"**
   * (CLAUDE.md §6-4 3 — 문장을 통째로 베끼면 거짓 문구가 계약이 된다).
   *
   * 참일 수 없는 말 셋(ADR 0012 규칙 5 (다) + `ErrorBox.tsx` 의 ①②③ 주석):
   *  ① "새로고침" — 서버 상태는 최신이고, 실측상 검토요청은 `open`·객체 상태도 그대로라 다시 읽어도 같다.
   *  ② "수행할 수 없습니다"류 불가 선언 — 반려는 허용된 행위이고 빠진 것은 사유뿐이다.
   *  ③ "확정을 되돌리려면" — 이 code 는 5 kind 전부에서 나고, 그중 넷(mapping·verification·
   *     document_mapping·document_identity_drift) 반려는 확정 무효화가 **아니다**.
   *
   * **부재 단언만으로는 부족하다**(§6-2 1). `KnownApiErrorCode` 유니온과 `CODE_MESSAGES` 행을 **함께**
   * 지우면(= frontend 작업을 통째로 되돌리면) `tsc` 도 통과하고 `errorText` 는 서버 `detail` 폴백으로
   * 조용히 떨어지는데, 그 영어 detail 에는 ①②③ 중 어느 것도 없다 — 즉 부재 단언만 있으면 그 회귀가
   * 그대로 통과한다(실측: 그 조합에서 `tsc` 0 · vitest 262 전원 통과). 그래서 "다음 행동(사유)을
   * 말한다"와 "detail 폴백이 아니다"를 함께 단언한다.
   */
  it("rejection_reason_required 는 다음 행동(사유 입력)을 말하고, 이 자리에서 참일 수 없는 말을 하지 않는다", () => {
    const detail = 'rejecting review request rr-1 (kind=mapping) requires a non-empty reason';
    const msg = errorText(apiError(409, detail, "rejection_reason_required"));

    // 다음 행동이 문장 안에 있다 + detail 폴백이 아니다(유니온/표를 함께 지운 회귀가 여기서 죽는다)
    expect(msg).toContain("사유");
    expect(msg).not.toContain(detail);
    expect(msg).not.toContain("(409)");

    // ①②③ — 이 상황에서 참일 수 없는 말
    expect(msg).not.toContain("새로고침");
    expect(msg).not.toContain("수행할 수 없습니다");
    expect(msg).not.toContain("확정을 되돌리");

    // 두 이웃 code 의 문구를 그대로 빌려 쓰지 않았다 — 갈라 놓은 code 의 존재 이유가 그것이다.
    expect(msg).not.toBe(errorText(apiError(409, detail, "invalid_transition")));
    expect(msg).not.toBe(errorText(apiError(409, detail, "revocation_reason_required")));
  });

  it("대조군: revocation_reason_required 는 여전히 '확정을 되돌리'는 일을 말한다", () => {
    // 위 ③(부재)이 문구 전반의 성질이 아님을 고정한다 — 이 문장이 없으면 "확정" 이야기를 어디서도
    // 하지 않는 구현(= ADR 0011 의 문구를 통째로 지우는 회귀)이 초록이다(§6-2 3).
    expect(errorText(apiError(409, "x", "revocation_reason_required"))).toContain("확정을 되돌리");
  });

  it("transition_blocked_by_review 는 열린 검토요청 문구를 반환한다", () => {
    const msg = errorText(apiError(409, "blocked by open review", "transition_blocked_by_review"));
    expect(msg).toContain("검토요청");
    expect(msg).not.toContain("여러 프로젝트");
  });

  it("review_already_resolved 는 다른 담당자가 이미 처리했다는 문구를 반환한다", () => {
    const msg = errorText(apiError(409, "already resolved", "review_already_resolved"));
    expect(msg).toContain("이미 이 검토요청을 처리");
    expect(msg).not.toContain("여러 프로젝트");
  });

  it("inspection_confirm_failed 는 검측 확정 실패 문구를 반환한다", () => {
    const msg = errorText(apiError(409, "confirm failed", "inspection_confirm_failed"));
    expect(msg).toContain("검측 확정");
    expect(msg).not.toContain("여러 프로젝트");
  });

  it("duplicate_project 는 프로젝트 중복 문구를 반환한다", () => {
    const msg = errorText(apiError(409, "duplicate project", "duplicate_project"));
    expect(msg).toContain("이미 같은 이름/식별자의 프로젝트");
  });

  it("object_not_found 는 객체를 찾을 수 없다는 문구를 반환한다", () => {
    const msg = errorText(apiError(404, "not found", "object_not_found"));
    expect(msg).toContain("대상 객체를 찾을 수 없습니다");
  });

  it("forbidden_role 은 역할 권한 문구를 반환한다", () => {
    const msg = errorText(apiError(403, "forbidden", "forbidden_role"));
    expect(msg).toContain("권한이 없습니다");
  });

  // ADR 0007 §8: 문서관리대장 연동 오류 code.
  it("document_not_found 는 문서를 찾을 수 없다는 문구를 반환한다", () => {
    const msg = errorText(apiError(404, "not found", "document_not_found"));
    expect(msg).toContain("문서를 찾을 수 없습니다");
  });

  it("document_register_invalid 는 사용자가 고칠 수 있게 무엇을 확인해야 하는지 안내한다", () => {
    const msg = errorText(apiError(422, "no valid sheet", "document_register_invalid"));
    expect(msg).toContain("헤더 행");
    expect(msg).toContain("제목");
  });

  it("document_mapping_target_not_found 는 매핑 대상을 찾을 수 없다는 문구를 반환한다", () => {
    const msg = errorText(apiError(404, "not found", "document_mapping_target_not_found"));
    expect(msg).toContain("매핑 대상");
  });

  // code 가 없거나(구버전 서버) 알 수 없는 값이면 원인을 지어내지 않고 서버가 준 detail 을 그대로 보여준다.
  it("code 가 없는 409 는 detail 을 그대로 보여주며 '여러 프로젝트' 를 지어내지 않는다", () => {
    const msg = errorText(apiError(409, "ambiguous global_id across projects"));
    expect(msg).not.toContain("여러 프로젝트");
    expect(msg).toBe("ambiguous global_id across projects (409)");
  });

  it("알 수 없는 code 값도 detail 로 폴백한다", () => {
    const e = new ApiError(409, "some new condition", { detail: "some new condition", code: "not_a_real_code" });
    expect(errorText(e)).toBe("some new condition (409)");
  });

  it("code 도 detail 도 없는 그 외 상태는 메시지와 상태코드를 함께 보여준다", () => {
    expect(errorText(new ApiError(500, "boom"))).toBe("boom (500)");
  });
});

describe("ErrorBox", () => {
  it("code 가 있는 409 에러를 role=alert 로 렌더한다", () => {
    render(<ErrorBox error={apiError(409, "ambiguous", "ambiguous_global_id")} />);
    expect(screen.getByRole("alert")).toHaveTextContent("여러 프로젝트");
  });

  it("error 가 없으면 아무것도 렌더하지 않는다", () => {
    const { container } = render(<ErrorBox error={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
