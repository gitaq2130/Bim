import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { RequireAuth } from "./components/RequireAuth";
import { DailyReportPage } from "./pages/DailyReportPage";
import { LoginPage } from "./pages/LoginPage";
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
          <Route path="/projects/:id" element={<Navigate to="viewer" replace />} />
          <Route path="/projects/:id/upload" element={<UploadPage />} />
          <Route path="/projects/:id/viewer" element={<ViewerPage />} />
          <Route path="/projects/:id/daily-report" element={<DailyReportPage />} />
          <Route path="/projects/:id/reviews" element={<ReviewsPage />} />
          <Route path="/projects/:id/summary" element={<SummaryPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
