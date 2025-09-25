// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Suspense, lazy } from "react";
import type { ReactNode } from "react";

import AppShell from "@/AppShell";
import { AuthProvider } from "@/features/auth/AuthProvider";
import ProtectedRoute from "@/features/auth/ProtectedRoute";

// ---- Types kept local so we don't need routes.tsx ----
type NavPlacement = "top" | "mobile" | "both" | "none";
type AppRoute = {
  path?: string;
  element: ReactNode;
  label?: string;
  nav?: NavPlacement;
  roles?: string[];
  hidden?: boolean;
  children?: AppRoute[];
};

// ---- Lazy pages ----
// Public/auth
const LoginPage = lazy(() => import("@/features/auth/LoginPage"));
const SignupPage = lazy(() => import("@/features/auth/SignupPage"));
const ForbiddenPage = lazy(() => import("@/features/auth/ForbiddenPage"));
// App
const FilesPage = lazy(() => import("@/features/files/FilesPage"));
const ChatPage = lazy(() => import("@/features/chat/ChatPage"));
const BillingPage = lazy(() => import("@/features/billing/BillingPage"));
const SupportPage = lazy(() => import("@/features/support/SupportPage"));
const NotFound = lazy(() => import("@/pages/NotFound"));

// ---- Route table (public + protected) ----
const ROUTES: AppRoute[] = [
  // Public
  { path: "/", element: <Navigate to="/login" replace />, nav: "none", hidden: true },
  { path: "/login", element: <LoginPage />, nav: "none", hidden: true },
  { path: "/signup", element: <SignupPage />, nav: "none", hidden: true },
  { path: "/forbidden", element: <ForbiddenPage />, nav: "none", hidden: true },

  // Protected group
  {
    element: <ProtectedRoute />,
    children: [
      { path: "/files", element: <FilesPage />, label: "Files", nav: "both" },
      { path: "/chat", element: <ChatPage />, label: "Chat", nav: "both" },
      { path: "/billing", element: <BillingPage />, label: "Billing", nav: "both" },
      { path: "/support", element: <SupportPage />, label: "Support", nav: "mobile" },
      { path: "/dashboard", element: <Navigate to="/files" replace />, nav: "none", hidden: true },
    ],
  },

  // 404
  { path: "*", element: <NotFound />, nav: "none" },
];

// ---- Build nav items for AppShell ----
function buildNavItems(where: "top" | "mobile") {
  const flat: AppRoute[] = [];
  for (const r of ROUTES) {
    if (r.children) flat.push(...r.children);
    else flat.push(r);
  }
  return flat
    .filter((r) => (r.nav === where || r.nav === "both") && !r.hidden && r.label)
    .map((r) => ({
      to: r.path!, // paths exist for items in nav
      label: r.label!,
      where: (r.nav === "both" ? "both" : where) as "top" | "mobile" | "both",
    }));
}

// ---- App ----
export default function App() {
  // Merge and de-dupe in case a route appears in multiple nav placements
  const navItems = [...buildNavItems("top"), ...buildNavItems("mobile")].filter(
    (v, i, a) => a.findIndex((x) => x.to === v.to) === i
  );

  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<div className="p-4">Loading…</div>}>
          <Routes>
            {/* Public routes */}
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/forbidden" element={<ForbiddenPage />} />
            {/* Legacy: keep /auth working by redirecting to /login */}
            <Route path="/auth" element={<Navigate to="/login" replace />} />

            {/* Protected app shell wrapper (guards "/" and all app pages) */}
            <Route element={<ProtectedRoute />}>
              <Route
                path="/*"
                element={
                  <AppShell appName="LBP React" navItems={navItems}>
                    <Routes>
                      {/* Protected child routes rendered inside AppShell */}
                      {ROUTES.filter((r) => r.children)
                        .flatMap((r) => r.children!)
                        .map((c, i) => (
                          <Route key={c.path ?? `p-${i}`} path={c.path} element={c.element} />
                        ))}
                      {/* 404 inside shell, if you want the chrome on not-found */}
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </AppShell>
                }
              />
            </Route>

            {/* 404 outside shell for completely unknown paths */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
