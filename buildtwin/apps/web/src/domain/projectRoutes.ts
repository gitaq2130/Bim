/**
 * 프로젝트 범위 라우트별 필요 프로젝트 역할. 서버 `require_project_role(...)`(ADR 0006)와 맞춘 값이며,
 * `App.tsx`의 `RequireRole` 가드와 `AppLayout`의 nav 링크 필터가 이 값 하나를 공유한다 — 두 곳에 같은
 * 역할 목록을 따로 하드코딩하면 어긋날 수 있다(리뷰 6차 지적 3).
 *
 * - upload → `POST /projects/{pid}/files`: contractor, cm (services/api/routers/files.py)
 * - daily-report → `POST /projects/{pid}/daily-reports`: contractor만 (services/api/routers/daily_reports.py)
 * - reviews → `GET /projects/{pid}/review-requests`: cm (admin은 서버가 read=True로 더 넓게 열어두지만,
 *   서버가 더 넓은 쪽이라 UI를 cm만으로 좁혀도 보안 문제가 아니다 — 현행 유지)
 *
 * 여기 없는 라우트(viewer, summary)는 멤버 누구나 — `RequireProjectAccess` 통과만으로 충분하다.
 */
import type { ProjectRole } from "../api/types";

export const PROJECT_ROUTE_ROLES = {
  upload: ["contractor", "cm"],
  "daily-report": ["contractor"],
  reviews: ["cm"],
} satisfies Record<string, ProjectRole[]>;
