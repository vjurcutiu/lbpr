import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import AuthLayout from "./AuthLayout";
import { useAuthContext } from "./AuthProvider";
import { auth, signUpWithEmailPassword, sendVerificationEmail, loginWithGoogle } from "./firebase";
import { friendlyAuthMessage } from "./errorMessages";
import GoogleIcon from "./GoogleIcon";
import { trackSignupConversion } from "@/lib/gtag";


const fieldClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100";
const primaryButtonClass =
  "inline-flex w-full items-center justify-center rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClass =
  "inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";

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

  const emailRef = useRef<HTMLInputElement | null>(null);
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    const shouldHighlight = (params.get("highlight") || "").toLowerCase() === "email";
    if (shouldHighlight) {
      setTimeout(() => {
        emailRef.current?.focus();
        setShowHint(true);
      }, 0);

      const t = setTimeout(() => setShowHint(false), 4000);
      return () => clearTimeout(t);
    }
  }, [params]);

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
      try {
        trackSignupConversion({ user_id: cred.user?.uid });
      } catch {
        // no-op
      }
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
      const cred = await loginWithGoogle();
      const isNew = Boolean((cred as any)?.additionalUserInfo?.isNewUser);
      if (isNew) {
        try {
          trackSignupConversion({ user_id: cred?.user?.uid });
        } catch {
          // no-op
        }
      }
    } catch (e: any) {
      console.warn("[auth:signup:google] Firebase error:", e);
      setErr(friendlyAuthMessage(e, "signup"));
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <AuthLayout title="Create account" subtitle="Set up your sign-in details.">
      {sent ? (
        <div className="mx-auto max-w-sm space-y-4">
          <div className="rounded-2xl border border-sky-200 bg-sky-50/90 p-4">
            <div className="font-medium text-slate-900">Check your inbox</div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              We sent a verification link to <strong>{email}</strong>. Open it, verify your email, then come back and sign in.
            </p>
          </div>

          {resendMsg ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {resendMsg}
            </div>
          ) : null}
          {resendErr ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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
            className={primaryButtonClass}
          >
            Resend verification email
          </button>

          <div className="text-center text-sm leading-6 text-slate-600">
            Already verified?{" "}
            <Link
              to={`/login?returnTo=${encodeURIComponent(returnTo)}`}
              className="font-medium text-slate-950 underline decoration-slate-300 underline-offset-4 transition hover:decoration-slate-950"
            >
              Sign in
            </Link>
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-sm space-y-5">
          <form className="space-y-4" onSubmit={onSubmit}>
            <label className="relative block space-y-2">
              <span className="text-sm font-medium text-slate-700">Email</span>
              <input
                ref={emailRef}
                autoFocus
                required
                type="email"
                autoComplete="email"
                aria-describedby={showHint ? "email-hint" : undefined}
                className={[
                  fieldClass,
                  showHint ? "border-emerald-400 ring-4 ring-emerald-100" : "",
                ].join(" ")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setShowHint(false)}
                placeholder="you@company.com"
              />
              {showHint ? (
                <div
                  id="email-hint"
                  role="tooltip"
                  className="absolute -top-2 right-0 max-w-[240px] -translate-y-full rounded-2xl border border-emerald-200 bg-white px-3 py-2 text-xs leading-5 text-slate-600 shadow-lg"
                >
                  Start here — enter your email to create your account.
                  <span className="absolute -bottom-2 right-6 inline-block h-0 w-0 border-x-8 border-x-transparent border-t-8 border-t-white" />
                </div>
              ) : null}
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">Password</span>
              <input
                required
                type="password"
                autoComplete="off"
                className={fieldClass}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="Create a password"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">Confirm password</span>
              <input
                required
                type="password"
                autoComplete="off"
                className={fieldClass}
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                placeholder="Repeat your password"
              />
            </label>

            {err ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {err}
              </div>
            ) : null}

            <button type="submit" disabled={loading} className={primaryButtonClass}>
              {loading ? "Creating account…" : "Create account"}
            </button>

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

            <div className="text-center text-sm leading-6 text-slate-600">
              Already have an account?{" "}
              <Link
                to={`/login?returnTo=${encodeURIComponent(returnTo)}`}
                className="font-medium text-slate-950 underline decoration-slate-300 underline-offset-4 transition hover:decoration-slate-950"
              >
                Sign in
              </Link>
            </div>
          </form>
        </div>
      )}
    </AuthLayout>
  );
}
