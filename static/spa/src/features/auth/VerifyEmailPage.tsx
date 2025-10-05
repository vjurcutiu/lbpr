import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import AuthLayout from "./AuthLayout";
import { applyActionCode } from "./firebase";

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<"working" | "ok" | "error">("working");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    const mode = params.get("mode");
    const oobCode = params.get("oobCode");

    if (mode !== "verifyEmail" || !oobCode) {
      setStatus("error");
      setMessage("Invalid or missing verification link parameters.");
      return;
    }

    (async () => {
      try {
        await applyActionCode(oobCode);
        setStatus("ok");
      } catch (e: any) {
        // keep a generic but helpful error for UX
        console.warn("[verify-email] error", e);
        setStatus("error");
        setMessage("This verification link is invalid or expired.");
      }
    })();
  }, [params]);

  if (status === "working") {
    return (
      <AuthLayout title="Verifying email…">
        <div className="max-w-sm mx-auto text-sm text-gray-600">Please wait while we confirm your email.</div>
      </AuthLayout>
    );
  }

  if (status === "ok") {
    return (
      <AuthLayout title="Email verified 🎉" subtitle="You're all set.">
        <div className="space-y-4 max-w-sm mx-auto">
          <div className="rounded-xl border p-4 bg-accent/40">
            <p className="text-sm text-gray-700">
              Your email has been verified. You can now sign in.
            </p>
          </div>
          <Link to="/login" className="w-full inline-flex justify-center rounded-xl bg-black text-white py-2">
            Continue to sign in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Verification problem">
      <div className="space-y-4 max-w-sm mx-auto">
        <div className="rounded-xl border p-4 bg-red-50 border-red-100">
          <p className="text-sm text-red-700">{message}</p>
        </div>
        <Link to="/signup" className="w-full inline-flex justify-center rounded-xl bg-black text-white py-2">
          Create account
        </Link>
      </div>
    </AuthLayout>
  );
}
