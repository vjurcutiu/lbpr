import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthContext } from "./AuthProvider";

export default function ProtectedRoute() {
  const { user, loading } = useAuthContext();
  const location = useLocation();

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;

  if (!user) {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/auth?returnTo=${returnTo}`} replace />;
  }

  return <Outlet />;
}
