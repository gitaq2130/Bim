import { ApiError } from "../api/client";

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return "권한이 없습니다 (403). 이 작업은 허용된 역할만 수행할 수 있습니다.";
    if (e.status === 401) return "로그인이 필요합니다 (401).";
    // ADR 0005: 같은 GlobalId 객체가 여러 프로젝트에 존재해 어느 프로젝트인지 특정할 수 없을 때 서버가 409 를 준다.
    if (e.status === 409) return "이 객체(GlobalId)는 여러 프로젝트에 존재합니다. 프로젝트를 다시 선택한 뒤 시도하세요.";
    return `${e.message} (${e.status})`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="error" role="alert">
      {errorText(error)}
    </div>
  );
}
