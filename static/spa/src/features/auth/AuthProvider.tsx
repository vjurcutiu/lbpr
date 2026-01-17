/* eslint react-refresh/only-export-components: ["error", { "allowConstantExport": true }] */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getJSON, postJSON } from "@/shared/api";
import { onAuth, auth, logoutFirebase } from "./firebase";

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

function shouldRequireVerifiedEmail(fbUser: {
  email?: string | null;
  emailVerified: boolean;
  providerData?: Array<{ providerId: string }>;
}): boolean {
  const providers = fbUser?.providerData?.map((p) => p.providerId) ?? [];
  const hasPasswordProvider = providers.includes("password");
  // Only gate email/password accounts that have an email.
  return hasPasswordProvider && !!fbUser.email;
}


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
      // Require verified email ONLY for email/password accounts.
      // (Phone and Google sign-in shouldn't be blocked by emailVerified.)
      if (shouldRequireVerifiedEmail(fbUser) && !fbUser.emailVerified) {
        // Don't attempt cookie exchange; keep as logged-out in app context
        setUser(null);
        try { await logoutFirebase(); } catch {}
        return;
      }
      try {
        const idToken = await auth.currentUser!.getIdToken();
        await postJSON("/auth/session", { id_token: idToken });
        await load();
      } catch {
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

export function useAuthContext() {
  const ctx = useContext(AuthContext);

  if (ctx) return ctx;

  // Some unit tests render components without wrapping <AuthProvider/>.
  // In test mode, return a safe default context rather than throwing.
  if (import.meta.env.MODE === "test") {
    return {
      user: null,
      loading: false,
      refresh: async () => {},
      clear: () => {},
    };
  }

  throw new Error("useAuthContext must be used within AuthProvider");
}


