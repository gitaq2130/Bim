/**
 * 플랫폼 관리자 전용 라우트 가드. ADR 0006 §4: 멤버십 관리는 프로젝트 역할이 아니라 **전역** `auth.role`로
 * 가른다(그 프로젝트의 멤버가 아니어도 admin은 멤버를 관리할 수 있다) — 유일하게 전역 역할을 쓰는 화면.
 */
import { Outlet } from "react-router-dom";
import { useStore } from "../store";

export function RequireAdmin() {
  const role = useStore((s) => s.auth.role);

  if (role === "admin") return <Outlet />;

  return (
    <div className="page" data-testid="require-admin-denied">
      <h1>권한 없음</h1>
      <p>이 화면은 관리자만 이용할 수 있습니다.</p>
    </div>
  );
}
