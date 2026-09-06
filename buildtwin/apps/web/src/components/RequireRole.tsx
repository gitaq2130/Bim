/**
 * 라우트 단위 역할 가드(UX 용). 서버 403 이 실제 강제 수단이며, 이 컴포넌트는 접근 불가 화면을
 * 빈 화면 대신 "권한 없음" 안내로 바꿔주는 역할만 한다. 페이지 내부 역할 체크(예: 확정 버튼 cm 전용)는
 * 그대로 유지한다 — 이 가드는 그것을 대체하지 않는다.
 *
 * ADR 0006: 역할은 전역 `auth.role`이 아니라 **프로젝트별** `useProjectRole`에서 읽는다 — 같은 사용자가
 * A현장에서는 cm, B현장에서는 client일 수 있다. 프로젝트 역할 쿼리가 로딩 중일 때는 "권한 없음"을 먼저
 * 그리지 않는다(가진 권한을 잠깐 없다고 보여주는 깜빡임이 스피너보다 나쁘다) — 로딩이 끝난 뒤에만 판단한다.
 */
import { Link, Outlet, useParams } from "react-router-dom";
import { useProjectRole } from "../api/hooks";
import type { ProjectRole } from "../api/types";
import { ROLE_LABELS } from "../domain/labels";

export function RequireRole({ roles }: { roles: ProjectRole[] }) {
  const { id = "" } = useParams();
  const { role, isLoading } = useProjectRole(id);

  if (isLoading) {
    return (
      <div className="page" data-testid="require-role-loading">
        <p>불러오는 중…</p>
      </div>
    );
  }

  if (role && roles.includes(role)) return <Outlet />;

  const requiredLabel = roles.map((r) => ROLE_LABELS[r]).join(", ");
  const fallbackTo = id ? `/projects/${id}/viewer` : "/projects";
  const fallbackLabel = id ? "2D|3D 뷰로 돌아가기" : "프로젝트 목록으로 돌아가기";

  return (
    <div className="page" data-testid="require-role-denied">
      <h1>권한 없음</h1>
      <p>
        이 화면은 <strong>{requiredLabel}</strong> 권한이 있는 사용자만 이용할 수 있습니다.
        {role && ` (현재 프로젝트 역할: ${ROLE_LABELS[role]})`}
      </p>
      <Link to={fallbackTo}>{fallbackLabel}</Link>
    </div>
  );
}
