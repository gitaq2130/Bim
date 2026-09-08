import { NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { useProjectRole } from "../api/hooks";
import type { ProjectRole } from "../api/types";
import { ROLE_LABELS } from "../domain/labels";
import { PROJECT_ROUTE_ROLES } from "../domain/projectRoutes";
import { useStore } from "../store";

interface ProjectLink {
  seg: string;
  label: string;
  /** 없으면 프로젝트 멤버 누구나(RequireProjectAccess 통과만으로 충분) — App.tsx 의 RequireRole 과 같은 값을 공유한다. */
  roles?: ProjectRole[];
}

const PROJECT_LINKS: ProjectLink[] = [
  { seg: "upload", label: "업로드", roles: PROJECT_ROUTE_ROLES.upload },
  { seg: "viewer", label: "2D|3D 뷰" },
  { seg: "documents", label: "문서관리대장" },
  { seg: "daily-report", label: "작업일보", roles: PROJECT_ROUTE_ROLES["daily-report"] },
  { seg: "reviews", label: "검토요청", roles: PROJECT_ROUTE_ROLES.reviews },
  { seg: "summary", label: "주간요약" },
];

export function AppLayout() {
  const { id } = useParams();
  const auth = useStore((s) => s.auth);
  const nav = useNavigate();
  // ADR 0006: 프로젝트 역할은 전역 auth.role 이 아니라 useProjectRole(프로젝트별) 에서 읽는다.
  // 로딩 중이거나 역할이 아직 없을 때는 역할 제한 링크를 그리지 않는다 — 잠깐 보였다 사라지는 깜빡임을 피한다
  // (RequireRole 이 라우트 진입 시 취하는 것과 같은 원칙: 로딩 중엔 "권한 없음"을 먼저 그리지 않는다).
  const { role: projectRole, isLoading: roleLoading } = useProjectRole(id);
  const visibleLinks = PROJECT_LINKS.filter(
    (link) => !link.roles || (!roleLoading && !!projectRole && link.roles.includes(projectRole)),
  );
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/projects" className="brand">
          BuildTwin
        </NavLink>
        {id && (
          <nav className="project-nav">
            {visibleLinks.map((link) => (
              <NavLink key={link.seg} to={`/projects/${id}/${link.seg}`}>
                {link.label}
              </NavLink>
            ))}
            {/* ADR 0006 §4: 멤버십 관리는 전역 admin 만 — 프로젝트 역할과 무관하다. */}
            {auth.role === "admin" && <NavLink to={`/projects/${id}/members`}>멤버</NavLink>}
          </nav>
        )}
        <div className="spacer" />
        <span className="muted" data-testid="current-role">
          {auth.userId ?? ""} {auth.role ? `(${ROLE_LABELS[auth.role]})` : ""}
        </span>
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            auth.logout();
            nav("/login");
          }}
        >
          로그아웃
        </button>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
