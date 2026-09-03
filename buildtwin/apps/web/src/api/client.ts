/**
 * fetch 래퍼. base `/api`, auth 슬라이스의 JWT 를 Authorization: Bearer 로 붙인다.
 */
import { useStore } from "../store";

export const API_BASE = "/api";

/**
 * 서버 에러 바디의 안정적 원인 식별자. `detail` 은 사람이 읽는 문구(오늘의 동작 유지),
 * `code` 는 UI 가 원인별로 분기하기 위한 값이며 구버전/알 수 없는 에러에는 없을 수 있다.
 */
export type ApiErrorCode =
  | "ambiguous_global_id"
  | "invalid_transition"
  | "transition_blocked_by_review"
  | "review_already_resolved"
  | "inspection_confirm_failed"
  | "duplicate_project"
  | "object_not_found"
  | "forbidden_role";

function parseErrorCode(body: unknown): ApiErrorCode | undefined {
  if (body && typeof body === "object") {
    const b = body as { code?: unknown };
    if (typeof b.code === "string") return b.code as ApiErrorCode;
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
