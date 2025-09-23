import type { FormEvent } from "react";
import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import AuthLayout from "./AuthLayout";
import { useAuthContext } from "./AuthProvider";
import { signInWithEmailPassword } from "./firebase";

export default function LoginPage() {
  const { user } = useAuthContext();
  const [params] = useSearchParams();
  const returnTo = params.get("returnTo") || "/files";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (user) return <Navigate to={returnTo} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      await signInWithEmailPassword(email.trim(), password);
      window.location.replace(returnTo);
    } catch (e: any) {
      setErr(e?.message || "Unable to sign in.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in with your email">
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="text-sm text-gray-700">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-xl border px-4 py-2 outline-none focus:ring-2 ring-gray-200"
            placeholder="you@company.com"
          />
        </label>

        <label className="block">
          <span className="text-sm text-gray-700">Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-xl border px-4 py-2 outline-none focus:ring-2 ring-gray-200"
            placeholder="••••••••"
          />
        </label>

        {err ? (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl p-2">
            {err}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-black text-white py-2 disabled:opacity-60"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>

        <div className="text-sm text-center text-gray-600">
          No account?as{" "}
          <Link
            to={`/signup?returnTo=${encodeURIComponent(returnTo)}`}
            className="text-black underline underline-offset-4"
          >
            Create one
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
}
