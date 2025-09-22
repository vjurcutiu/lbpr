import { useAuthContext } from "./AuthProvider";

export function useSession() {
  const { user, loading, refresh } = useAuthContext();
  return { user, loading, isAuthenticated: !!user, refresh };
}
