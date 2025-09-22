import { createContext, useContext, useEffect, useState } from "react";
import { getJSON } from "../../shared/api";

type User = {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
};

type AuthContextType = {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  clear: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const data = await getJSON("/session");
      setUser(data.user || null);
    } catch (_) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const value: AuthContextType = {
    user,
    loading,
    refresh: async () => {
      setLoading(true);
      await load();
    },
    clear: () => setUser(null),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be used within AuthProvider");
  return ctx;
}
