/**
 * fetch 래퍼. base `/api`, auth 슬라이스의 JWT 를 Authorization: Bearer 로 붙인다.
 */
import { useStore } from "../store";

export const API_BASE = "/api";

/**
 * 서버가 오늘 알고 있는 안정적 원인 코드 목록. UI 가 이 값에 대해 exhaustive 하게(빠짐없이)
 * 분기하고 싶을 때(예: ErrorBox 의 CODE_MESSAGES) 이 타입을 쓴다.
 *
 * TODO(round-6+): 이 목록은 서버의 에러 코드 테이블과 수작업으로 동기화된다. services/api 쪽에
 * 코드 카탈로그가 단일 소스로 정리되면(예: OpenAPI enum, 또는 rules/ 의 YAML) 이 유니온은 그
 * 소스에서 생성 스크립트로 뽑아내는 편이 낫다 — 지금은 그런 단일 소스가 없어 수동으로 유지한다.
 */
export type KnownApiErrorCode =
  | "ambiguous_global_id"
  | "invalid_transition"
  // ADR 0011: `invalid_transition` 에서 갈라 나온 409. 전이 자체는 허용 표에 있고 빠진 것은 사유뿐이라
  // 안내가 달라야 한다(glossary "오류 응답 code 어휘" 정본 참조).
  | "revocation_reason_required"
  // ADR 0012: 검토요청을 `rejected` 로 닫는 두 문(큐 `POST /review-requests/{id}/resolve`,
  // 객체 전이 `POST /objects/{gid}/transitions`)이 사유 없이 오면 내는 409. `revocation_reason_required`
  // 와 갈라 둔 이유는 그 문구가 "확정을 되돌리려면"이라 5 kind 중 넷에서 거짓이기 때문이다
  // (ADR 0012 규칙 4 의 후보 표). 부가 필드는 `review_kind`·`review_request_ids` 둘뿐이다 —
  // 큐 경로에는 전이가 없어 `from_state`/`to_state`/`actor` 가 존재하지 않는다.
  | "rejection_reason_required"
  | "transition_blocked_by_review"
  | "review_already_resolved"
  | "inspection_confirm_failed"
  | "duplicate_project"
  | "duplicate_user_email"
  | "object_not_found"
  | "review_object_not_found"
  | "mapping_target_not_found"
  | "review_request_not_found"
  | "drawing_not_found"
  | "model_not_found"
  | "mesh_not_found"
  | "model_obj_not_found"
  | "job_not_found"
  | "file_not_found"
  | "file_content_not_found"
  | "scan_not_found"
  | "project_not_found"
  | "activity_not_found"
  | "plan_section_not_found"
  | "forbidden_role"
  | "unsupported_file_kind"
  | "daily_report_missing_field"
  | "daily_report_invalid"
  | "alignment_input_insufficient"
  | "unauthorized"
  | "not_found"
  | "bad_request"
  | "conflict"
  | "unprocessable_entity"
  | "unsupported_media_type"
  | "mapping_review_data_corrupt"
  | "user_not_found"
  | "duplicate_member"
  | "member_not_found"
  | "admin_cannot_be_member"
  // ADR 0007 §8: 문서관리대장 연동.
  | "document_not_found"
  | "document_register_invalid"
  | "document_mapping_target_not_found";

/**
 * 서버 에러 바디의 안정적 원인 식별자. `detail` 은 사람이 읽는 문구(오늘의 동작 유지),
 * `code` 는 UI 가 원인별로 분기하기 위한 값이며 구버전/알 수 없는 에러에는 없을 수 있다.
 *
 * `KnownApiErrorCode` 에 `(string & {})` 를 더해, 알려진 코드는 자동완성/리터럴 타입 검사를
 * 그대로 받으면서도 서버가 아직 유니온에 없는 새 코드를 내려줘도 타입 에러 없이 표현할 수 있게
 * 한다(런타임에서 온 문자열을 안전하지 않게 알려진 유니온으로 캐스팅하지 않는다). 원인별로
 * exhaustive 하게 분기해야 하는 곳(ErrorBox)은 `KnownApiErrorCode` 를 따로 써서 컴파일 타임에
 * 새 코드 추가를 강제한다.
 */
export type ApiErrorCode = KnownApiErrorCode | (string & {});

function parseErrorCode(body: unknown): ApiErrorCode | undefined {
  if (body && typeof body === "object") {
    const b = body as { code?: unknown };
    if (typeof b.code === "string") return b.code;
  }
  return undefined;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  /** 서버가 내려준 안정적 원인 코드. 없으면 undefined (구버전/알 수 없는 에러). */
  code?: ApiErrorCode;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.code = parseErrorCode(body);
  }
}

export const isForbidden = (e: unknown): e is ApiError => e instanceof ApiError && e.status === 403;
export const isUnauthorized = (e: unknown): e is ApiError => e instanceof ApiError && e.status === 401;

export type Query = Record<string, string | number | boolean | null | undefined>;

export function buildUrl(path: string, query?: Query): string {
  const url = path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  if (!query) return url;
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return qs ? `${url}?${qs}` : url;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Query;
  body?: unknown; // JSON 직렬화. FormData 면 그대로.
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** 토큰 미첨부 (login 등) */
  anonymous?: boolean;
}

async function parseBody(res: Response): Promise<unknown> {
  const ct = res.headers.get("content-type") ?? "";
  if (res.status === 204) return null;
  if (ct.includes("application/json")) return res.json().catch(() => null);
  const text = await res.text().catch(() => "");
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

function errorMessage(status: number, body: unknown): string {
  if (body && typeof body === "object") {
    const b = body as { detail?: unknown; message?: unknown };
    if (typeof b.detail === "string") return b.detail;
    if (typeof b.message === "string") return b.message;
    if (Array.isArray(b.detail)) return b.detail.map((d) => (d as { msg?: string }).msg ?? JSON.stringify(d)).join("; ");
  }
  if (typeof body === "string" && body) return body;
  return `HTTP ${status}`;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", query, body, headers = {}, signal, anonymous } = opts;
  const token = useStore.getState().auth.token;
  const h: Record<string, string> = { Accept: "application/json", ...headers };
  if (token && !anonymous) h.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(buildUrl(path, query), { method, headers: h, body: payload, signal });
  const data = await parseBody(res);
  if (!res.ok) {
    if (res.status === 401) useStore.getState().auth.logout();
    throw new ApiError(res.status, errorMessage(res.status, data), data);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Query, opts?: RequestOptions) => request<T>(path, { ...opts, method: "GET", query }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>(path, { ...opts, method: "POST", body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>(path, { ...opts, method: "PUT", body }),
  del: <T>(path: string, opts?: RequestOptions) => request<T>(path, { ...opts, method: "DELETE" }),
};
