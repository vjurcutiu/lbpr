import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import AuthLayout from "./AuthLayout";
import { useAuthContext } from "./AuthProvider";
import { createRecaptchaVerifier, signInWithPhone, type ConfirmationResult } from "./firebase";
import { friendlyAuthMessage } from "./errorMessages";

function normalizePhone(raw: string) {
  // Keep it simple: Firebase expects E.164 (e.g. "+40712345678")
  return raw.trim().replace(/[\s()-]/g, "");
}

export default function PhoneLoginPage() {
  const { user } = useAuthContext();
  const [params] = useSearchParams();
  const returnTo = params.get("returnTo") || "/files";

  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("+");
  const [code, setCode] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);

  const verifierRef = useRef<ReturnType<typeof createRecaptchaVerifier> | null>(null);

  const phoneHint = useMemo(() => {
    return "Use international format, e.g. +40 712 345 678.";
  }, []);

  useEffect(() => {
    // Lazy init verifier on first send, but make sure container exists
    return () => {
      try {
        verifierRef.current?.clear();
      } catch {
        // ignore
      }
      verifierRef.current = null;
    };
  }, []);

  if (user) return <Navigate to={returnTo} replace />;

  async function onSendCode(e: FormEvent) {
    e.preventDefault();
    setErr(null);

    const p = normalizePhone(phone);
    if (!p || p === "+") {
      setErr("Please enter your phone number.");
      return;
    }
    if (!p.startsWith("+")) {
      setErr("Phone number must start with + and a country code (E.164 format).");
      return;
    }

    setLoading(true);
    try {
      // (Re)create verifier each time we send to avoid stale state.
      try {
        verifierRef.current?.clear();
      } catch {
        // ignore
      }
      verifierRef.current = createRecaptchaVerifier("recaptcha-container", { size: "invisible" });

      const res = await signInWithPhone(p, verifierRef.current);
      setConfirmation(res);
      setStep("code");
    } catch (e: any) {
      console.warn("[auth:phone] Firebase error:", e);
      setErr(friendlyAuthMessage(e, "phone"));
    } finally {
      setLoading(false);
    }
  }

  async function onVerifyCode(e: FormEvent) {
    e.preventDefault();
    setErr(null);

    const c = code.trim();
    if (!c) {
      setErr("Please enter the SMS code.");
      return;
    }
    if (!confirmation) {
      setErr("Please request a code first.");
      setStep("phone");
      return;
    }

    setLoading(true);
    try {
      await confirmation.confirm(c);
      // AuthProvider will exchange cookie + redirect will happen as user becomes non-null.
    } catch (e: any) {
      console.warn("[auth:phone:verify] Firebase error:", e);
      setErr(friendlyAuthMessage(e, "phone-verify"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Sign in with phone" subtitle="We'll text you a one-time code.">
      <div className="space-y-4 max-w-sm mx-auto">
        {/* Required by Firebase phone auth */}
        <div id="recaptcha-container" className="hidden" />

        {step === "phone" ? (
          <form className="space-y-4" onSubmit={onSendCode}>
            <label className="block space-y-1">
              <span className="text-sm text-gray-700">Phone number</span>
              <input
                autoFocus
                required
                inputMode="tel"
                autoComplete="tel"
                className="w-full rounded-xl border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-black"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+40 712 345 678"
              />
              <div className="text-xs text-gray-500 mt-1">{phoneHint}</div>
            </label>

            {err ? (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl p-2">
                {err}
              </div>
            ) : null}

            <button type="submit" disabled={loading} className="w-full rounded-xl bg-black text-white py-2 disabled:opacity-60">
              {loading ? "Sending…" : "Send code"}
            </button>

            <div className="text-sm text-center text-gray-600">
              Prefer email?{" "}
              <Link to={`/login?returnTo=${encodeURIComponent(returnTo)}`} className="text-black underline underline-offset-4">
                Sign in with email
              </Link>
            </div>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={onVerifyCode}>
            <div className="text-sm text-gray-600">
              We sent a code to <span className="font-medium">{normalizePhone(phone)}</span>.
            </div>

            <label className="block space-y-1">
              <span className="text-sm text-gray-700">SMS code</span>
              <input
                autoFocus
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                className="w-full rounded-xl border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-black"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
              />
            </label>

            {err ? (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl p-2">
                {err}
              </div>
            ) : null}

            <button type="submit" disabled={loading} className="w-full rounded-xl bg-black text-white py-2 disabled:opacity-60">
              {loading ? "Verifying…" : "Verify & sign in"}
            </button>

            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => {
                  setErr(null);
                  setCode("");
                  setStep("phone");
                }}
                className="text-gray-700 underline underline-offset-4"
              >
                Change number
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  // Resend: go back to phone step so onSendCode runs again.
                  setErr(null);
                  setCode("");
                  setStep("phone");
                }}
                className="text-gray-700 underline underline-offset-4 disabled:opacity-60"
              >
                Resend code
              </button>
            </div>
          </form>
        )}

        <div className="text-xs text-gray-500 text-center">
          Standard SMS rates may apply.
        </div>
      </div>
    </AuthLayout>
  );
}