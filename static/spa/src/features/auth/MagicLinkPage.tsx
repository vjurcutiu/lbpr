import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import AuthLayout from "./AuthLayout";
import { postJSON } from "@/shared/api";
import { signInWithCustomToken } from "./firebase";
import { useAuthContext } from "./AuthProvider";

type ExchangeResp = { custom_token: string };

export default function MagicLinkPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, loading: authLoading, syncFromFirebase } = useAuthContext();

  const code = (params.get("code") || "").trim();
  const returnTo = (params.get("returnTo") || "/files").trim() || "/files";

  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const safeReturnTo = useMemo(() => {
    // Only allow same-origin paths by default (prevents open-redirect issues).
    // If you want full URLs, relax this to a whitelist.
    if (returnTo.startsWith("/")) return returnTo;
    return "/files";
  }, [returnTo]);

  useEffect(() => {
    // If already signed in, bounce to app.
    if (!authLoading && user) {
      navigate(safeReturnTo, { replace: true });
    }
  }, [authLoading, user, navigate, safeReturnTo]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!code) {
        setErr("This sign-in link is missing a code.");
        setBusy(false);
        return;
      }

      setBusy(true);
      setErr(null);

      try {
        // 1) Exchange one-time code -> Firebase custom token
        const ex = await postJSON<ExchangeResp>("/auth/magic/exchange", { code });

        // 2) Firebase sign-in (creates a Firebase session in the browser)
        await signInWithCustomToken(ex.custom_token);

        // 3) Establish/refresh the backend session cookie
        const synced = await syncFromFirebase({ force: true, forceRefreshToken: true });
        if (!synced) {
          throw new Error("We could not finish signing you in. Please try the link again.");
        }

        // 4) Redirect after AuthProvider has hydrated the user
        if (!cancelled) navigate(safeReturnTo, { replace: true });
      } catch (e: any) {
        console.warn("[auth:magic] sign-in failed", e);
        if (!cancelled) {
          setErr(e?.message || "Sign-in failed. Please request a new link.");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    // Avoid double-run if AuthProvider is still loading a user.
    if (!authLoading && !user) run();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, code, syncFromFirebase, navigate, safeReturnTo]);

  return (
    <AuthLayout
      title={busy ? "Signing you in…" : err ? "Couldn’t sign you in" : "Signed in"}
      subtitle={
        busy
          ? "One sec — we’re opening your account."
          : err
          ? "This link may have expired or already been used."
          : "Redirecting…"
      }
    >
      <div className="space-y-4">
        {err ? (
          <div className="rounded-xl border bg-red-50 p-3 text-sm text-red-700">
            {err}
          </div>
        ) : null}

        {busy ? (
          <div className="text-sm text-gray-600">Please keep this tab open.</div>
        ) : err ? (
          <div className="flex items-center gap-3">
            <Link
              to="/login"
              className="inline-flex items-center justify-center rounded-xl bg-black px-4 py-2 text-sm font-medium text-white shadow hover:bg-black/90"
            >
              Go to login
            </Link>
            <Link
              to="/phone"
              className="inline-flex items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Use phone verification
            </Link>
          </div>
        ) : (
          <div className="text-sm text-gray-600">Redirecting…</div>
        )}
      </div>
    </AuthLayout>
  );
}
