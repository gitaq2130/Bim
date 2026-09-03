import { NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { ROLE_LABELS } from "../domain/labels";
import { useStore } from "../store";

const PROJECT_LINKS: [string, string][] = [
  ["upload", "업로드"],
  ["viewer", "2D|3D 뷰"],
  ["daily-report", "작업일보"],
  ["reviews", "검토요청"],
  ["summary", "주간요약"],
];

export function AppLayout() {
  const { id } = useParams();
  const auth = useStore((s) => s.auth);
  const nav = useNavigate();
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/projects" className="brand">
          BuildTwin
        </NavLink>
        {id && (
          <nav className="project-nav">
            {PROJECT_LINKS.map(([seg, label]) => (
              <NavLink key={seg} to={`/projects/${id}/${seg}`}>
                {label}
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
