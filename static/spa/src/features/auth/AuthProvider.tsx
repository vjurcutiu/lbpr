/* eslint react-refresh/only-export-components: ["error", { "allowConstantExport": true }] */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getJSON, postJSON } from "@/shared/api";
import { onAuth, auth, logoutFirebase, type FbUser } from "./firebase";

type User = {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
};

type SessionResponse = {
  user: User | null;
};

type SyncFromFirebaseOptions = {
  force?: boolean;
  forceRefreshToken?: boolean;
  fbUser?: FbUser;
};

type AuthContextType = {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  clear: () => void;
  syncFromFirebase: (options?: SyncFromFirebaseOptions) => Promise<boolean>;
};

const AuthContext = createContext<AuthContextType | null>(null);

// Module-scoped dedupe so React StrictMode remounts in dev don't immediately double-post
// /auth/session for the exact same Firebase token.
let sharedSessionExchangeInFlight: Promise<boolean> | null = null;
let sharedLastSessionExchange: { uid: string | null; idToken: string | null } = {
  uid: null,
  idToken: null,
};

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

  const serverUserRef = useRef<User | null>(null);
  const initialSessionLoadRef = useRef<Promise<User | null> | null>(null);

  const load = useCallback(async (): Promise<User | null> => {
    try {
      const data = await getJSON<SessionResponse>("/session");
      const nextUser = data?.user ?? null;
      serverUserRef.current = nextUser;
      setUser(nextUser);
      return nextUser;
    } catch {
      serverUserRef.current = null;
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const syncFromFirebase = useCallback(
    async (options: SyncFromFirebaseOptions = {}): Promise<boolean> => {
      const fbUser = options.fbUser ?? auth.currentUser;
      if (!fbUser) {
        serverUserRef.current = null;
        setUser(null);
        setLoading(false);
        return false;
      }

      if (shouldRequireVerifiedEmail(fbUser) && !fbUser.emailVerified) {
        serverUserRef.current = null;
        sharedLastSessionExchange = { uid: null, idToken: null };
        setUser(null);
        setLoading(false);
        try {
          await logoutFirebase();
        } catch {
          // no-op
        }
        return false;
      }

      const currentServerUser = serverUserRef.current;
      if (!options.force && currentServerUser?.uid === fbUser.uid) {
        setUser(currentServerUser);
        setLoading(false);
        return true;
      }

      if (sharedSessionExchangeInFlight) {
        return sharedSessionExchangeInFlight;
      }

      const exchangePromise = (async () => {
        try {
          const tokenSource = auth.currentUser ?? fbUser;
          const idToken = await tokenSource.getIdToken(options.forceRefreshToken ?? false);

          if (
            !options.force &&
            sharedLastSessionExchange.uid === tokenSource.uid &&
            sharedLastSessionExchange.idToken === idToken &&
            serverUserRef.current?.uid === tokenSource.uid
          ) {
            setLoading(false);
            return true;
          }

          await postJSON("/auth/session", { id_token: idToken });
          sharedLastSessionExchange = { uid: tokenSource.uid, idToken };
          await load();
          return true;
        } catch {
          serverUserRef.current = null;
          setUser(null);
          return false;
        } finally {
          setLoading(false);
        }
      })();

      sharedSessionExchangeInFlight = exchangePromise;
      return exchangePromise.finally(() => {
        sharedSessionExchangeInFlight = null;
      });
    },
    [load]
  );

  useEffect(() => {
    let active = true;

    const initialLoad = load();
    initialSessionLoadRef.current = initialLoad;

    const unsub = onAuth(async (fbUser) => {
      try {
        await (initialSessionLoadRef.current ?? Promise.resolve(null));
      } catch {
        // ignore initial session load failures; sync decision falls back to Firebase state.
      }

      if (!active) return;

      if (!fbUser) {
        serverUserRef.current = null;
        sharedLastSessionExchange = { uid: null, idToken: null };
        setUser(null);
        setLoading(false);
        return;
      }

      await syncFromFirebase({ fbUser });
    });

    return () => {
      active = false;
      unsub();
    };
  }, [load, syncFromFirebase]);

  const value: AuthContextType = {
    user,
    loading,
    refresh: async () => {
      await load();
    },
    clear: () => {
      serverUserRef.current = null;
      sharedLastSessionExchange = { uid: null, idToken: null };
      setUser(null);
    },
    syncFromFirebase,
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
      syncFromFirebase: async () => false,
    };
  }

  throw new Error("useAuthContext must be used within AuthProvider");
}
