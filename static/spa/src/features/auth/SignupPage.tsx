import type { FormEvent } from "react";
import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import AuthLayout from "./AuthLayout";
import { useAuthContext } from "./AuthProvider";
import { auth, signUpWithEmailPassword, sendVerificationEmail, loginWithGoogle } from "./firebase";
import { friendlyAuthMessage } from "./errorMessages";

function GoogleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path fill="#EA4335" d="M12 10.2v3.6h5.1c-.22 1.32-1.54 3.86-5.1 3.86-3.08 0-5.6-2.55-5.6-5.66S8.92 6.34 12 6.34c1.76 0 2.95.75 3.62 1.4l2.46-2.37C16.7 3.41 14.52 2.5 12 2.5 6.98 2.5 2.9 6.58 2.9 11.6S6.98 20.7 12 20.7c6.14 0 8.1-4.29 8.1-6.41 0-.43-.05-.71-.12-1.02H12z"/>
    </svg>
  );
}

export default function SignupPage() {
  const { user } = useAuthContext();
  const [params] = useSearchParams();
  const returnTo = params.get("returnTo") || "/files";

  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [resendErr, setResendErr] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);

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
      const cred = await signUpWithEmailPassword(email.trim(), pw);
      await sendVerificationEmail(cred.user);
      setSent(true);
    } catch (e: any) {
      console.warn("[auth:signup] Firebase error:", e);
      setErr(friendlyAuthMessage(e, "signup"));
    } finally {
      setLoading(false);
    }
  }

  async function onGoogle() {
    setErr(null);
    setGoogleLoading(true);
    try {
      await loginWithGoogle();
      // For Google, email is verified; user will be signed in immediately
    } catch (e: any) {
      console.warn("[auth:signup:google] Firebase error:", e);
      setErr(friendlyAuthMessage(e, "signup"));
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <AuthLayout title="Create account" subtitle="Free forever: 50 messages & ~75 page uploads. Verify your email to continue.">
      {sent ? (
        <div className="space-y-4 max-w-sm mx-auto">
          <div className="rounded-xl border p-4 bg-accent/40">
            <div className="font-medium">Check your inbox</div>
            <p className="text-sm text-gray-600">
              We sent a verification link to <strong>{email}</strong>. Check your inbox and spam folder.
              Click the link, then return to the app and sign in.
            </p>
          </div>

          {resendMsg ? (
            <div className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-xl p-2">
              {resendMsg}
            </div>
          ) : null}
          {resendErr ? (
            <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl p-2">
              {resendErr}
            </div>
          ) : null}

          <button
            type="button"
            onClick={async () => {
              setResendMsg(null);
              setResendErr(null);
              if (auth.currentUser) {
                try {
                  await sendVerificationEmail(auth.currentUser);
                  setResendMsg("Verification email sent again.");
                } catch (e: any) {
                  setResendErr(friendlyAuthMessage(e, "verify"));
                }
              } else {
                setResendErr("You need to be signed in to resend the verification email.");
              }
            }}
            className="w-full rounded-xl bg-black text-white py-2"
          >
            Resend verification email
          </button>
          <div className="text-sm text-center text-gray-600">
            Already verified?{" "}
            <Link to={`/login?returnTo=${encodeURIComponent(returnTo)}`} className="text-black underline underline-offset-4">
              Sign in
            </Link>
          </div>
        </div>
      ) : (
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
                value={pw}
                onChange={(e) => setPw(e.target.value)}
              />
            </label>

            <label className="block space-y-1">
              <span className="text-sm text-gray-700">Confirm password</span>
              <input
                required
                type="password"
                autoComplete="off"
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

            <button type="submit" disabled={loading} className="w-full rounded-xl bg-black text-white py-2 disabled:opacity-60">
              {loading ? "Creating…" : "Create account"}
            </button>

            <div className="text-sm text-center text-gray-600">
              Already have an account?{" "}
              <Link to={`/login?returnTo=${encodeURIComponent(returnTo)}`} className="text-black underline underline-offset-4">
                Sign in
              </Link>
            </div>
          </form>

          <div className="text-xs text-gray-500 text-center">
            Free forever plan • 50 messages • ~75&nbsp;pages of uploads • No credit card required
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
