import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthContext } from "./AuthProvider";

export default function ProtectedRoute() {
  const { user, loading } = useAuthContext();
  const location = useLocation();

  if (loading) {
    return <div className="p-6">Loading…</div>;
  }

  if (!user) {
    const returnTo = encodeURIComponent(location.pathname + location.search + location.hash);
    return <Navigate to={`/auth?returnTo=${returnTo}`} replace />;
  }

  return <Outlet />;
}
