// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Suspense, lazy } from "react";
import type { ReactNode } from "react";

import AppShell from "@/AppShell";
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
const VerifyEmailPage = lazy(() => import("@/features/auth/VerifyEmailPage")); // NEW

// Public landing
const TryLandingPage = lazy(() => import("@/pages/TryLandingPage")); // NEW

// App
const FilesPage = lazy(() => import("@/features/files/FilesPage"));
const ChatPage = lazy(() => import("@/features/chat/ChatPage"));
const BillingPage = lazy(() => import("@/features/billing/BillingPage"));
const SupportPage = lazy(() => import("@/features/support/SupportPage"));
const ProfilePage = lazy(() => import("@/features/profile/ProfilePage"));
const NotFound = lazy(() => import("@/pages/NotFound"));

// Legal pages
const PrivacyPage = lazy(() => import("@/pages/Privacy"));
const TermsPage   = lazy(() => import("@/pages/Terms"));
const DPAPage   = lazy(() => import("@/pages/DPA"));


// ---- Route table (public + protected) ----
const ROUTES: AppRoute[] = [
  // Public
  { path: "/", element: <Navigate to="/login" replace />, nav: "none", hidden: true },
  { path: "/login", element: <LoginPage />, nav: "none", hidden: true },
  { path: "/signup", element: <SignupPage />, nav: "none", hidden: true },
  { path: "/forbidden", element: <ForbiddenPage />, nav: "none", hidden: true },
  { path: "/verify-email", element: <VerifyEmailPage />, nav: "none", hidden: true }, // NEW
  { path: "/try", element: <TryLandingPage />, nav: "none", hidden: true }, // NEW

  // Public Legal
  { path: "/privacy", element: <AppShell children={<PrivacyPage />} />, nav: "none" },
  { path: "/terms",   element: <AppShell children={<TermsPage />} />,   nav: "none" },
  { path: "/dpa",   element: <AppShell children={<DPAPage />} />,   nav: "none" },

  // Protected group
  {
    element: <ProtectedRoute />,
    children: [
      // Make Files full-bleed so it can manage its own internal scroll areas.
      { path: "/files", element: <AppShell fullBleed children={<FilesPage />} />, label: "Files", nav: "both" },
      // Chat is already full-bleed
      { path: "/chat", element: <AppShell fullBleed children={<ChatPage />} />, label: "Chat", nav: "both" },
      { path: "/billing", element: <AppShell children={<BillingPage />} />, label: "Billing", nav: "both" },
      { path: "/support", element: <AppShell children={<SupportPage />} />, label: "Support", nav: "mobile" },
      { path: "/profile", element: <AppShell children={<ProfilePage />} />, nav: "none", hidden: true },
    ],
  },

  // Fallback
  { path: "*", element: <NotFound />, nav: "none", hidden: true },
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
      to: r.path!,
      label: r.label!,
      where: (r.nav === "both" ? "both" : where) as "top" | "mobile" | "both",
    }));
}

// ---- App ----
export default function App() {
  const navItems = [...buildNavItems("top"), ...buildNavItems("mobile")].filter(
    (v, i, a) => a.findIndex((x) => x.to === v.to) === i
  );

  return (
    <BrowserRouter>
      <Suspense fallback={<div className="p-4">Loading…</div>}>
        <Routes>
          {/* Public */}
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/forbidden" element={<ForbiddenPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/try" element={<TryLandingPage />} /> {/* NEW */}

          {/* Public legal pages (wrapped in AppShell for nav/footer) */}
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms"   element={<TermsPage />} />
          <Route path="/dpa"   element={<DPAPage />} />

          {/* Protected */}
          <Route element={<ProtectedRoute />}>
            {/* Full-bleed Chat */}
            <Route
              path="/chat"
              element={<AppShell navItems={navItems} fullBleed children={<ChatPage />} />}
            />

            {/* Full-bleed Files */}
            <Route
              path="/files"
              element={<AppShell navItems={navItems} fullBleed children={<FilesPage />} />}
            />

            {/* Standard pages */}
            <Route path="/billing" element={<AppShell navItems={navItems} children={<BillingPage />} />} />
            <Route path="/support" element={<AppShell navItems={navItems} children={<SupportPage />} />} />
            <Route path="/profile" element={<AppShell navItems={navItems} children={<ProfilePage />} />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
