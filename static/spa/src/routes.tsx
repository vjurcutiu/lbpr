import { lazy } from "react"
import type { ReactNode } from "react"
import { Navigate } from "react-router-dom"

const AuthPage    = lazy(() => import("@/features/auth/AuthPage"))
const BillingPage = lazy(() => import("@/features/billing/BillingPage"))
const ChatPage    = lazy(() => import("@/features/chat/ChatPage"))
const FilesPage   = lazy(() => import("@/features/files/FilesPage"))
const SupportPage = lazy(() => import("@/features/support/SupportPage"))
const NotFound    = lazy(() => import("@/pages/NotFound"))

export type NavPlacement = "top" | "mobile" | "both" | "none"

export type AppRoute = {
  path: string
  element: ReactNode
  label?: string
  nav?: NavPlacement
  roles?: string[]
  hidden?: boolean
}

export const appRoutes: AppRoute[] = [
  // Landing / auth
  { path: "/",         element: <AuthPage />,    label: "Home",     nav: "both" },

  // Core
  { path: "/files",    element: <FilesPage />,   label: "Files",    nav: "both" },
  { path: "/chat",     element: <ChatPage />,    label: "Chat",     nav: "both" },
  { path: "/settings", element: <BillingPage />, label: "Billing", nav: "both" },

  // Secondary
  { path: "/support",  element: <SupportPage />, label: "Support",  nav: "mobile" },

  // Alias/redirects
  { path: "/dashboard", element: <Navigate to="/files" replace />, nav: "none" },

  // 404
  { path: "*", element: <NotFound />, nav: "none" },
]

/** Build nav items for a given placement while narrowing types for AppShell */
export function buildNavItems(where: "top" | "mobile") {
  return appRoutes
    .filter(r => (r.nav === where || r.nav === "both") && !r.hidden && r.label)
    .map(r => ({
      to: r.path,
      label: r.label!,
      // ensure 'where' is narrowed to the AppShell-accepted union
      where: (r.nav === "both" ? "both" : where) as "top" | "mobile" | "both",
    }))
}
