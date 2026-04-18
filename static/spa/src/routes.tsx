import { lazy } from "react";
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import ProtectedRoute from "@/features/auth/ProtectedRoute";

export type NavPlacement = "top" | "mobile" | "both" | "none";
export type AppRoute = {
  path?: string;
  element: ReactNode;
  label?: string;
  nav?: NavPlacement;
  roles?: string[];
  hidden?: boolean;
  fullBleed?: boolean;
  withAppShell?: boolean;
  children?: AppRoute[];
};

const LoginPage = lazy(() => import("@/features/auth/LoginPage"));
const SignupPage = lazy(() => import("@/features/auth/SignupPage"));
const PhoneLoginPage = lazy(() => import("@/features/auth/PhoneLoginPage"));
const MagicLinkPage = lazy(() => import("@/features/auth/MagicLinkPage"));
const ForbiddenPage = lazy(() => import("@/features/auth/ForbiddenPage"));
const VerifyEmailPage = lazy(() => import("@/features/auth/VerifyEmailPage"));

const TryLandingPage = lazy(() => import("@/pages/TryLandingPage"));
const PrivacyPage = lazy(() => import("@/pages/Privacy"));
const TermsPage = lazy(() => import("@/pages/Terms"));
const DPAPage = lazy(() => import("@/pages/DPA"));
const FilesPage = lazy(() => import("@/features/files/FilesPage"));
const ChatPage = lazy(() => import("@/features/chat/ChatPage"));
const BillingPage = lazy(() => import("@/features/billing/BillingPage"));
const SupportPage = lazy(() => import("@/features/support/SupportPage"));
const ProfilePage = lazy(() => import("@/features/profile/ProfilePage"));
const NotFound = lazy(() => import("@/pages/NotFound"));

export const routes: AppRoute[] = [
  { path: "/", element: <Navigate to="/login" replace />, nav: "none", hidden: true },
  { path: "/login", element: <LoginPage />, nav: "none", hidden: true },
  { path: "/phone", element: <PhoneLoginPage />, nav: "none", hidden: true },
  { path: "/magic", element: <MagicLinkPage />, nav: "none", hidden: true },
  { path: "/signup", element: <SignupPage />, nav: "none", hidden: true },
  { path: "/forbidden", element: <ForbiddenPage />, nav: "none", hidden: true },
  { path: "/verify-email", element: <VerifyEmailPage />, nav: "none", hidden: true },
  { path: "/try", element: <TryLandingPage />, nav: "none", hidden: true },
  { path: "/privacy", element: <PrivacyPage />, nav: "none", hidden: true },
  { path: "/terms", element: <TermsPage />, nav: "none", hidden: true },
  { path: "/dpa", element: <DPAPage />, nav: "none", hidden: true },
  {
    element: <ProtectedRoute />,
    children: [
      { path: "/files", element: <FilesPage />, label: "Files", nav: "both", withAppShell: true, fullBleed: true },
      { path: "/chat", element: <ChatPage />, label: "Chat", nav: "both", withAppShell: true, fullBleed: true },
      { path: "/billing", element: <BillingPage />, label: "Billing", nav: "both", withAppShell: true },
      { path: "/profile", element: <ProfilePage />, label: "Profile", nav: "both", withAppShell: true },
      { path: "/support", element: <SupportPage />, label: "Support", nav: "mobile", withAppShell: true },
      { path: "/dashboard", element: <Navigate to="/files" replace />, nav: "none", hidden: true },
    ],
  },
  { path: "*", element: <NotFound />, nav: "none", hidden: true },
];

export function flattenRoutes(items: AppRoute[]): AppRoute[] {
  const flat: AppRoute[] = [];
  for (const route of items) {
    if (route.children?.length) flat.push(...flattenRoutes(route.children));
    else flat.push(route);
  }
  return flat;
}

export function buildNavItems(where: "top" | "mobile") {
  return flattenRoutes(routes)
    .filter((route) => (route.nav === where || route.nav === "both") && !route.hidden && route.label)
    .map((route) => ({
      to: route.path!,
      label: route.label!,
      where: (route.nav === "both" ? "both" : where) as "top" | "mobile" | "both",
    }));
}
