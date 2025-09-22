// src/routes.tsx
import { lazy } from "react";
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
// If your ProtectedRoute is a default export:
import ProtectedRoute from "@/features/auth/ProtectedRoute";
// If it's a named export, swap to:
// import { ProtectedRoute } from "@/features/auth/ProtectedRoute";

export type NavPlacement = "top" | "mobile" | "both" | "none";
export type AppRoute = {
  path?: string;
  element: ReactNode;
  label?: string;
  nav?: NavPlacement;
  roles?: string[];
  hidden?: boolean;
  children?: AppRoute[];
};

// Lazy pages
const AuthPage     = lazy(() => import("@/features/auth/AuthPage"));
const BillingPage  = lazy(() => import("@/features/billing/BillingPage"));
const ChatPage     = lazy(() => import("@/features/chat/ChatPage"));
const FilesPage    = lazy(() => import("@/features/files/FilesPage"));
const SupportPage  = lazy(() => import("@/features/support/SupportPage"));
const NotFound     = lazy(() => import("@/pages/NotFound"));

// Auth pages
const LoginPage     = lazy(() => import("@/features/auth/LoginPage"));
const ForbiddenPage = lazy(() => import("@/features/auth/ForbiddenPage"));

export const routes: AppRoute[] = [
  // Public
  { path: "/",          element: <AuthPage />,     label: "Home",     nav: "both" },
  { path: "/login",     element: <LoginPage />,                     nav: "none", hidden: true },
  { path: "/forbidden", element: <ForbiddenPage />,                 nav: "none", hidden: true },

  // Protected group (Outlet pattern)
  {
    element: <ProtectedRoute />,
    children: [
      { path: "/files",    element: <FilesPage />,   label: "Files",   nav: "both" },
      { path: "/chat",     element: <ChatPage />,    label: "Chat",    nav: "both" },
      { path: "/settings", element: <BillingPage />, label: "Billing", nav: "both" },
      { path: "/support",  element: <SupportPage />, label: "Support", nav: "mobile" },
      { path: "/dashboard", element: <Navigate to="/files" replace />, nav: "none", hidden: true },
    ],
  },

  // 404
  { path: "*", element: <NotFound />, nav: "none" },
];

/** Build nav items for your AppShell */
export function buildNavItems(where: "top" | "mobile") {
  const flat: AppRoute[] = [];
  for (const r of routes) {
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
