// src/features/auth/AuthPage.tsx
import { useSearchParams, Navigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";

export default function AuthPage() {
  const { user, loginWithGoogle } = useAuth();
  const [params] = useSearchParams();
  const next = params.get("next") || "/";

  if (user) return <Navigate to={next} replace />;

  return (
    <main className="min-h-dvh grid place-items-center p-6">
      <div className="max-w-sm w-full space-y-4">
        <h1 className="text-2xl font-semibold">Welcome</h1>
        <p className="text-sm text-gray-500">
          Log in or sign up to continue.
        </p>
        <button
          className="w-full rounded-xl border px-4 py-2"
          onClick={loginWithGoogle}
        >
          Continue with Google
        </button>
        {/* Add email/password fields if you want classic signup later */}
      </div>
    </main>
  );
}
