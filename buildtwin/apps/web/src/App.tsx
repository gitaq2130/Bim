import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { RequireAdmin } from "./components/RequireAdmin";
import { RequireAuth } from "./components/RequireAuth";
import { RequireProjectAccess } from "./components/RequireProjectAccess";
import { RequireRole } from "./components/RequireRole";
import { PROJECT_ROUTE_ROLES } from "./domain/projectRoutes";
import { DailyReportPage } from "./pages/DailyReportPage";
import { DocumentDetailPage } from "./pages/DocumentDetailPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { LoginPage } from "./pages/LoginPage";
import { ProjectMembersPage } from "./pages/ProjectMembersPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ReviewsPage } from "./pages/ReviewsPage";
import { SummaryPage } from "./pages/SummaryPage";
import { UploadPage } from "./pages/UploadPage";
import { ViewerPage } from "./pages/ViewerPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<ProjectsPage />} />
          {/* ADR 0006 §3 규칙 2: 비멤버는 404(project_not_found) — RequireProjectAccess 가 이 아래 전부를 감싼다. */}
          <Route path="/projects/:id" element={<RequireProjectAccess />}>
            <Route index element={<Navigate to="viewer" replace />} />
            <Route path="upload" element={<RequireRole roles={PROJECT_ROUTE_ROLES.upload} />}>
              <Route index element={<UploadPage />} />
            </Route>
            <Route path="viewer" element={<ViewerPage />} />
            {/* ADR 0007 §7: 문서 조회는 모든 프로젝트 멤버(+admin) — RequireProjectAccess 통과만으로 충분하다. */}
            <Route path="documents" element={<DocumentsPage />} />
            <Route path="documents/:docId" element={<DocumentDetailPage />} />
            <Route path="daily-report" element={<RequireRole roles={PROJECT_ROUTE_ROLES["daily-report"]} />}>
              <Route index element={<DailyReportPage />} />
            </Route>
            <Route path="reviews" element={<RequireRole roles={PROJECT_ROUTE_ROLES.reviews} />}>
              <Route index element={<ReviewsPage />} />
            </Route>
            <Route path="summary" element={<SummaryPage />} />
            {/* 멤버십 관리는 프로젝트 역할이 아니라 전역 admin 역할로 가른다(ADR 0006 §4). */}
            <Route path="members" element={<RequireAdmin />}>
              <Route index element={<ProjectMembersPage />} />
            </Route>
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
