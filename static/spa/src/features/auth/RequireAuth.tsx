import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";

export default function RequireAuth({ children }: { children: JSX.Element }) {
  const { status, user } = useAuth();
  const loc = useLocation();

  if (status === "loading") return <div className="p-6">Checking session…</div>;
  if (!user) {
    const returnTo = encodeURIComponent(loc.pathname + loc.search);
    return <Navigate to={`/login?returnTo=${returnTo}`} replace />;
  }
  return children;
}
