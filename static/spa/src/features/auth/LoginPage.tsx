import type { FormEvent } from "react";
import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import AuthLayout from "./AuthLayout";
import { useAuthContext } from "./AuthProvider";
import { auth, signInWithEmailPassword } from "./firebase";
import { postJSON } from "@/shared/api";
import { friendlyAuthMessage } from "./errorMessages";

export default function LoginPage() {
  const { user } = useAuthContext();
  const [params] = useSearchParams();
  const returnTo = params.get("returnTo") || "/files";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [needsVerify, setNeedsVerify] = useState(false);

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

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to continue">
      <form className="space-y-4 max-w-sm mx-auto" onSubmit={onSubmit}>
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
          No account?{" "}
          <Link to={`/signup?returnTo=${encodeURIComponent(returnTo)}`} className="text-black underline underline-offset-4">
            Create one
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
}