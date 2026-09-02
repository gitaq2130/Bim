import { Routes, Route, Navigate } from "react-router-dom";

// 라우트는 pages/ 가 채워지면서 확장된다. (frontend 담당)
export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/projects" replace />} />
      <Route path="*" element={<div>BuildTwin</div>} />
    </Routes>
  );
}
