import type { FormEvent } from "react";
import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import AuthLayout from "./AuthLayout";
import { useAuthContext } from "./AuthProvider";
import { auth, signInWithEmailPassword } from "./firebase";
import { postJSON } from "@/shared/api";

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
      // 1) Firebase sign-in
      await signInWithEmailPassword(email.trim(), password);
      // 2) Exchange Firebase ID token for backend session cookie
      const idToken = await auth.currentUser!.getIdToken();
      await postJSON("/auth/session", { id_token: idToken });
      // 3) Now we have the cookie; go to the app
      window.location.replace(returnTo);
    } catch (e: any) {
      setErr(e?.message || "Unable to sign in.");
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
            className="w-full rounded-xl border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-black"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
          No account?{" "}
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
