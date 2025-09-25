/* eslint react-refresh/only-export-components: ["error", { "allowConstantExport": true }] */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getJSON, postJSON } from "@/shared/api";
import { onAuth, auth } from "./firebase";

type User = {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
};

type SessionResponse = {
  user: User | null;
};

type AuthContextType = {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  clear: () => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const data = await getJSON<SessionResponse>("/session");
      setUser(data?.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch of server session (cookie → user)
    load();

    // Keep server cookie in sync with Firebase auth state
    const unsub = onAuth(async (fbUser) => {
      if (!fbUser) {
        setUser(null);
        return;
      }
      try {
        const idToken = await auth.currentUser!.getIdToken();
        await postJSON("/auth/session", { id_token: idToken });
        await load();
      } catch {
        // If exchange fails, keep user null
        setUser(null);
      }
    });

    return () => unsub();
  }, []);

  const value: AuthContextType = {
    user,
    loading,
    refresh: async () => load(),
    clear: () => setUser(null),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be used within AuthProvider");
  return ctx;
}
