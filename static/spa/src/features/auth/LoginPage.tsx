import { useEffect, useState } from "react";
import { auth, loginWithGoogle } from "./firebase";
import { postForm } from "../../shared/api";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthContext } from "./AuthProvider";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuthContext();

  const returnTo = sp.get("returnTo") || "/";

  const signIn = async () => {
    setErr(null);
    setLoading(true);
    try {
      const cred = await loginWithGoogle();
      const idToken = await cred.user.getIdToken();
      await postForm("/auth/session", { id_token: idToken });
      await refresh();
      navigate(returnTo, { replace: true });
    } catch (e: any) {
      setErr(e?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const run = async () => {
      if (auth.currentUser) {
        try {
          const idToken = await auth.currentUser.getIdToken();
          await postForm("/auth/session", { id_token: idToken });
          await refresh();
          navigate(returnTo, { replace: true });
        } catch {}
      }
    };
    run();
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <h1>Sign in</h1>
      <p>Authenticate to continue.</p>
      <button onClick={signIn} disabled={loading}>
        {loading ? "Signing in..." : "Sign in with Google"}
      </button>
      {err && <p style={{ color: "red" }}>{err}</p>}
    </div>
  );
}
