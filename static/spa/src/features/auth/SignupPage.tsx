import type { FormEvent } from "react";
import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import AuthLayout from "./AuthLayout";
import { useAuthContext } from "./AuthProvider";
import { auth, signUpWithEmailPassword } from "./firebase";
import { postJSON } from "@/shared/api";

export default function SignupPage() {
  const { user } = useAuthContext();
  const [params] = useSearchParams();
  const returnTo = params.get("returnTo") || "/files";

  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (user) return <Navigate to={returnTo} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (pw !== pw2) {
      setErr("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await signUpWithEmailPassword(email.trim(), pw);
      const idToken = await auth.currentUser!.getIdToken();
      await postJSON("/auth/session", { id_token: idToken });
      window.location.replace(returnTo);
    } catch (e: any) {
      setErr(e?.message || "Unable to sign up.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Create account" subtitle="Start your trial today">
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
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm text-gray-700">Confirm password</span>
          <input
            required
            type="password"
            className="w-full rounded-xl border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-black"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
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
          {loading ? "Creating…" : "Create account"}
        </button>

        <div className="text-sm text-center text-gray-600">
          Already have an account?{" "}
          <Link
            to={`/login?returnTo=${encodeURIComponent(returnTo)}`}
            className="text-black underline underline-offset-4"
          >
            Sign in
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
}
