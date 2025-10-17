import type { FormEvent } from "react";
import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import AuthLayout from "./AuthLayout";
import { useAuthContext } from "./AuthProvider";
import { auth, signInWithEmailPassword, loginWithGoogle } from "./firebase";
import { postJSON } from "@/shared/api";
import { friendlyAuthMessage } from "./errorMessages";

function GoogleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path fill="#EA4335" d="M12 10.2v3.6h5.1c-.22 1.32-1.54 3.86-5.1 3.86-3.08 0-5.6-2.55-5.6-5.66S8.92 6.34 12 6.34c1.76 0 2.95.75 3.62 1.4l2.46-2.37C16.7 3.41 14.52 2.5 12 2.5 6.98 2.5 2.9 6.58 2.9 11.6S6.98 20.7 12 20.7c6.14 0 8.1-4.29 8.1-6.41 0-.43-.05-.71-.12-1.02H12z"/>
    </svg>
  );
}

export default function LoginPage() {
  const { user } = useAuthContext();
  const [params] = useSearchParams();
  const returnTo = params.get("returnTo") || "/files";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [needsVerify, setNeedsVerify] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  if (user) return <Navigate to={returnTo} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setNeedsVerify(false);
    setLoading(true);
    try {
      await signInWithEmailPassword(email.trim(), password);
      // Gate on email verification
      if (!auth.currentUser?.emailVerified) {
        setNeedsVerify(true);
        return;
      }
      const idToken = await auth.currentUser!.getIdToken();
      await postJSON("/auth/session", { id_token: idToken });
      window.location.replace(returnTo);
    } catch (e: any) {
      // Friendlier messaging while keeping real error visible in console
      console.warn("[auth:login] Firebase error:", e);
      setErr(friendlyAuthMessage(e, "login"));
    } finally {
      setLoading(false);
    }
  }

  async function onGoogle() {
    setErr(null);
    setGoogleLoading(true);
    try {
      await loginWithGoogle();
      // AuthProvider will exchange the cookie; Navigate will kick in as user becomes non-null
    } catch (e: any) {
      console.warn("[auth:login:google] Firebase error:", e);
      setErr(friendlyAuthMessage(e, "login"));
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to continue">
      <div className="space-y-4 max-w-sm mx-auto">
        
        <form className="space-y-4" onSubmit={onSubmit}>
          <label className="block space-y-1">
            <span className="text-sm text-gray-700">Email</span>
            <input
              autoFocus
              required
              type="email"
              autoComplete="email"
              className="w-full rounded-xl border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-black"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-gray-700">Password</span>
            <input
              required
              type="password"
              autoComplete="off"
              className="w-full rounded-xl border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-black"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {needsVerify ? (
            <div className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-2">
              Please verify your email. Check your inbox (and spam folder) for a link, then sign in again.
            </div>
          ) : null}

          {err ? (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl p-2">
              {err}
            </div>
          ) : null}

          <button type="submit" disabled={loading} className="w-full rounded-xl bg-black text-white py-2 disabled:opacity-60">
            {loading ? "Signing in..." : "Sign in"}
          </button>

          <div className="text-sm text-center text-gray-600">
            New here?{" "}
            <Link to={`/signup?returnTo=${encodeURIComponent(returnTo)}`} className="text-black underline underline-offset-4">
              Start free
            </Link>{" "}
            — 50 messages & ~75&nbsp;pages of uploads.
          </div>
        </form>

        <div className="text-xs text-gray-500 text-center">
          Private by default • Source-cited answers • Multi-lingual, Multi-domain
        </div>
      </div>
    </AuthLayout>
  );
}
