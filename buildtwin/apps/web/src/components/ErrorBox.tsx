import { ApiError } from "../api/client";

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return "권한이 없습니다 (403). 이 작업은 허용된 역할만 수행할 수 있습니다.";
    if (e.status === 401) return "로그인이 필요합니다 (401).";
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
