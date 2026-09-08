/**
 * 프로젝트 범위 라우트별 필요 프로젝트 역할. 서버 `require_project_role(...)`(ADR 0006)와 맞춘 값이며,
 * `App.tsx`의 `RequireRole` 가드와 `AppLayout`의 nav 링크 필터가 이 값 하나를 공유한다 — 두 곳에 같은
 * 역할 목록을 따로 하드코딩하면 어긋날 수 있다(리뷰 6차 지적 3).
 *
 * - upload → `POST /projects/{pid}/files`: contractor, cm (services/api/routers/files.py). 다만 파일 종류가
 *   문서관리대장(xlsx)이면 cm만 가능하다(ADR 0007 §7 규칙 1) — 이 페이지 내부 세부 제한은 아래
 *   `FILE_KIND_UPLOAD_ROLES`로 별도로 좁힌다(라우트 자체는 두 역할 모두 들어올 수 있어야 다른 파일 종류를
 *   올릴 수 있다).
 * - daily-report → `POST /projects/{pid}/daily-reports`: contractor만 (services/api/routers/daily_reports.py)
 * - reviews → `GET /projects/{pid}/review-requests`: cm (admin은 서버가 read=True로 더 넓게 열어두지만,
 *   서버가 더 넓은 쪽이라 UI를 cm만으로 좁혀도 보안 문제가 아니다 — 현행 유지). `document_mapping` kind도
 *   이 화면에서 같이 다룬다(ADR 0007 §4 규칙 6) — 확정은 여전히 cm만.
 *
 * 여기 없는 라우트(viewer, summary, documents, documents/:docId)는 멤버 누구나 —
 * `RequireProjectAccess` 통과만으로 충분하다(ADR 0007 §7: 문서 조회는 모든 프로젝트 멤버).
 */
import type { FileKind, ProjectRole } from "../api/types";

export const PROJECT_ROUTE_ROLES = {
  upload: ["contractor", "cm"],
  "daily-report": ["contractor"],
  reviews: ["cm"],
} satisfies Record<string, ProjectRole[]>;

/**
 * 업로드 페이지 내부에서 파일 종류별로 다시 좁히는 허용 역할(ADR 0007 §7 규칙 1). `PROJECT_ROUTE_ROLES.upload`가
 * "업로드 화면 접근"을 가르는 값이라면, 이건 "이 파일 종류를 실제로 올릴 수 있는가"를 가른다.
 * 대장(xlsx)만 cm 전용 — 다른 파일 종류가 시공사도 올릴 수 있는 것과 다르다. 근거: 대장의 처리결과는
 * 발주처·CM 측 판단의 기록이고 착수 가능 판단을 움직이므로, 시공사가 올리면 "피검자가 자기 승인 상태를
 * 스스로 기록"하는 구조가 되어 ADR 0001 불변식 1("확정은 cm만")을 데이터 입력 경로로 우회한다.
 * UploadPage 는 이 값으로 서버가 403을 내기 전에 업로드 자체를 막는다 — UI가 보여주는 것과 서버가
 * 허용하는 것을 일치시키기 위함이다.
 */
export const FILE_KIND_UPLOAD_ROLES: Record<FileKind, ProjectRole[]> = {
  ifc: ["contractor", "cm"],
  dxf: ["contractor", "cm"],
  dwg: ["contractor", "cm"],
  rvt: ["contractor", "cm"],
  e57: ["contractor", "cm"],
  las: ["contractor", "cm"],
  ply: ["contractor", "cm"],
  csv: ["contractor", "cm"],
  xml: ["contractor", "cm"],
  xer: ["contractor", "cm"],
  xlsx: ["cm"],
  unknown: ["contractor", "cm"],
};
