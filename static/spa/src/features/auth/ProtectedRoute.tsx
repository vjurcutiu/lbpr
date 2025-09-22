import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useSession } from "./useSession";

export default function ProtectedRoute() {
  const { user, loading } = useSession();
  const location = useLocation();

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;

  if (!user) {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?returnTo=${returnTo}`} replace />;
  }

  return <Outlet />;
}
