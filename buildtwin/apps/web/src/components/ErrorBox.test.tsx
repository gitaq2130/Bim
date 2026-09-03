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
