import type { FormEvent } from "react";
import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import AuthLayout from "./AuthLayout";
import { useAuthContext } from "./AuthProvider";
import { auth, signInWithEmailPassword, loginWithGoogle } from "./firebase";
import { friendlyAuthMessage } from "./errorMessages";
import GoogleIcon from "./GoogleIcon";


const fieldClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100";
const primaryButtonClass =
  "inline-flex w-full items-center justify-center rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClass =
  "inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";

export default function LoginPage() {
  const { user, syncFromFirebase } = useAuthContext();
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
      if (!auth.currentUser?.emailVerified) {
        setNeedsVerify(true);
        return;
      }
      const synced = await syncFromFirebase({ force: true });
      if (!synced) {
        throw new Error("Could not establish your server session. Please try again.");
      }
      window.location.replace(returnTo);
    } catch (e: any) {
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
    } catch (e: any) {
      console.warn("[auth:login:google] Firebase error:", e);
      setErr(friendlyAuthMessage(e, "login"));
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to get back to your files, chats, and answers.">
      <div className="mx-auto max-w-sm space-y-5">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-4 text-sm text-slate-600">
          Your files, chats, and answers stay in one place. Sign in to pick up where you left off.
        </div>

        <form className="space-y-4" onSubmit={onSubmit}>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Email</span>
            <input
              autoFocus
              required
              type="email"
              autoComplete="email"
              className={fieldClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Password</span>
            <input
              required
              type="password"
              autoComplete="off"
              className={fieldClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
            />
          </label>

          {needsVerify ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Please verify your email first. Check your inbox and spam folder, then come back and sign in again.
            </div>
          ) : null}

          {err ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {err}
            </div>
          ) : null}

          <button type="submit" disabled={loading} className={primaryButtonClass}>
            {loading ? "Signing you in…" : "Sign in"}
          </button>

          <div className="space-y-3">
            <button
              type="button"
              onClick={onGoogle}
              disabled={googleLoading}
              className={secondaryButtonClass}
            >
              <GoogleIcon className="h-5 w-5" />
              {googleLoading ? "Opening Google…" : "Continue with Google"}
            </button>

            <Link
              to={`/phone?returnTo=${encodeURIComponent(returnTo)}`}
              className={secondaryButtonClass}
            >
              Continue with phone
            </Link>
          </div>

          <div className="text-center text-sm leading-6 text-slate-600">
            New here?{" "}
            <Link
              to={`/signup?returnTo=${encodeURIComponent(returnTo)}`}
              className="font-medium text-slate-950 underline decoration-slate-300 underline-offset-4 transition hover:decoration-slate-950"
            >
              Create your free workspace
            </Link>
            .
          </div>
        </form>

        <div className="grid gap-2 rounded-2xl border border-slate-200/80 bg-white/70 p-4 text-xs text-slate-500 sm:grid-cols-3 sm:gap-3 sm:text-center">
          <div>Search across your files</div>
          <div>Answers with sources</div>
          <div>Private by default</div>
        </div>
      </div>
    </AuthLayout>
  );
}
