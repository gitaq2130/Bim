import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useStore } from "../store";

export function RequireAuth() {
  const token = useStore((s) => s.auth.token);
  const loc = useLocation();
  if (!token) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <Outlet />;
}
