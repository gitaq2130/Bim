import { render, screen } from "@testing-library/react";
import { ApiError } from "../api/client";
import { ErrorBox, errorText } from "./ErrorBox";

describe("errorText", () => {
  it("403 은 권한 문구를 반환한다", () => {
    expect(errorText(new ApiError(403, "forbidden"))).toContain("권한이 없습니다");
  });

  it("401 은 로그인 필요 문구를 반환한다", () => {
    expect(errorText(new ApiError(401, "unauthorized"))).toContain("로그인이 필요합니다");
  });

  // ADR 0005: 같은 GlobalId 가 여러 프로젝트에 있으면 서버가 409 를 준다 — 사용자에게 원인과
  // 다음 행동을 알려주는 한국어 문구여야 하고, "HTTP 409" 같은 생 에러 문구만 보여선 안 된다.
  it("409 는 '여러 프로젝트에 존재' 를 알리는 한국어 문구를 반환한다(생 에러 문구 아님)", () => {
    const msg = errorText(new ApiError(409, "ambiguous global_id across projects"));
    expect(msg).toContain("여러 프로젝트");
    expect(msg).not.toBe("ambiguous global_id across projects (409)");
  });

  it("그 외 상태는 메시지와 상태코드를 함께 보여준다", () => {
    expect(errorText(new ApiError(500, "boom"))).toBe("boom (500)");
  });
});

describe("ErrorBox", () => {
  it("409 에러를 role=alert 로 렌더한다", () => {
    render(<ErrorBox error={new ApiError(409, "ambiguous")} />);
    expect(screen.getByRole("alert")).toHaveTextContent("여러 프로젝트");
  });

  it("error 가 없으면 아무것도 렌더하지 않는다", () => {
    const { container } = render(<ErrorBox error={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
