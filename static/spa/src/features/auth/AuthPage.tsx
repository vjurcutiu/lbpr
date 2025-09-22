import { useSearchParams, Navigate } from "react-router-dom";
import { useAuthContext } from "./AuthProvider";

export default function AuthPage() {
  const { user } = useAuthContext();
  const [params] = useSearchParams();
  const returnTo = params.get("returnTo") || "/";

  // Already signed in? Bounce back.
  if (user) return <Navigate to={returnTo} replace />;

  // Example: backend-driven OAuth login (replace with your flow if needed)
  const loginGoogle = () => {
    const url = new URL("/api/auth/google", window.location.origin);
    url.searchParams.set("returnTo", returnTo);
    window.location.href = url.toString();
  };

  return (
    <main className="min-h-dvh grid place-items-center p-6">
      <div className="max-w-sm w-full space-y-4">
        <h1 className="text-2xl font-semibold">Welcome</h1>
        <p className="text-sm text-gray-500">Log in or sign up to continue.</p>

        <button
          className="w-full rounded-xl border px-4 py-2"
          onClick={loginGoogle}
        >
          Continue with Google
        </button>

        {/* If you also support email/password, place the form here.
            After successful login, ensure the backend redirects to ?returnTo=
            or call window.location.replace(returnTo). */}
      </div>
    </main>
  );
}
