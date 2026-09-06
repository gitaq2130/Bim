/**
 * 프로젝트 범위 라우트 공통 가드(ADR 0006 §3 규칙 2). `GET /projects/{id}` 로 멤버십을 확인한다.
 * - 로딩 중: "권한 없음" 대신 중립적인 로딩 상태를 보여준다(있는 권한을 잠깐 없다고 보여주는 게 더 나쁘다).
 * - 404 project_not_found (비멤버 — 존재하는 프로젝트인지 여부와 무관하게 같은 응답): 전용 안내 패널 + 목록 링크.
 * - 그 외 에러: 일반 ErrorBox.
 * - 통과: 이 아래의 `RequireRole`/각 페이지가 `useProjectRole`로 세부 역할을 다시 읽는다 — 같은 쿼리 캐시를
 *   공유하므로 이 컴포넌트가 이미 받아온 응답을 재사용하고 별도 요청을 만들지 않는다.
 */
import { Link, Outlet, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { useProject } from "../api/hooks";
import { ErrorBox } from "./ErrorBox";

function isProjectNotFound(error: unknown): boolean {
  return error instanceof ApiError && (error.code === "project_not_found" || error.status === 404);
}

export function RequireProjectAccess() {
  const { id = "" } = useParams();
  const q = useProject(id);

  if (q.isPending) {
    return (
      <div className="page" data-testid="project-access-loading">
        <p>불러오는 중…</p>
      </div>
    );
  }

  if (q.isError) {
    if (isProjectNotFound(q.error)) {
      return (
        <div className="page" data-testid="project-access-denied">
          <h1>접근 권한 없음</h1>
          <p>이 프로젝트에 접근 권한이 없습니다.</p>
          <Link to="/projects">프로젝트 목록으로 돌아가기</Link>
        </div>
      );
    }
    return (
      <div className="page">
        <ErrorBox error={q.error} />
      </div>
    );
  }

  return <Outlet />;
}
