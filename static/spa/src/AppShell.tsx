// src/AppShell.tsx
import type { ReactNode } from "react"
import { useEffect, useMemo, useState } from "react"
import { Link, NavLink, useLocation } from "react-router-dom"
import { Menu, Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import PhoneLoginInfoModal from "@/features/auth/PhoneLoginInfoModal"
import { useAuthContext } from "@/features/auth/AuthProvider"
import { auth } from "@/features/auth/firebase"
import ProfileMenu from "@/features/profile/ProfileMenu"
import { cn } from "@/lib/utils"

type NavItem = { to: string; label: string; where?: "top" | "mobile" | "both" }

type AppShellProps = {
  children: ReactNode
  appName?: string
  navItems?: NavItem[]
  /** When true, content fills the full width/height under the top nav (no container padding). */
  fullBleed?: boolean
}

const PRIMARY_NAV_PATHS = new Set(["/files", "/chat", "/workflows"])

export default function AppShell({
  children,
  appName = "LexBot PRO",
  navItems = [],
  fullBleed = false,
}: AppShellProps) {
  const { user, loading } = useAuthContext()
  const location = useLocation()
  const [phoneModalOpen, setPhoneModalOpen] = useState(false)

  const phoneModalStorageKey = useMemo(() => {
    const fb = auth.currentUser
    const uid = fb?.uid
    return uid ? `lexbot:onboarding:phone-login:v1:dismissed:${uid}` : null
  }, [user?.uid])

  const shouldShowPhoneModal = useMemo(() => {
    if (loading || !user) return false
    const fb = auth.currentUser
    if (!fb) return false

    const phone = fb.phoneNumber
    if (!phone) return false

    const providerIds = new Set(fb.providerData?.map((p) => p.providerId) ?? [])
    // Some custom-token logins don't include "phone" in providerData even if the user has a phoneNumber.
    if (fb.phoneNumber) providerIds.add("phone")

    const hasOtherProvider = providerIds.has("google.com") || providerIds.has("password")
    const hasEmail = !!fb.email

    // Only show for phone-only accounts (the ones provisioned via SMS magic link).
    const isPhoneOnly = !!phone && !hasEmail && !hasOtherProvider
    if (!isPhoneOnly) return false

    // Avoid auto-opening while already on the Profile page (where the CTA would be redundant).
    if (location.pathname.startsWith("/profile")) return false

    // One-time per user per device.
    if (!phoneModalStorageKey) return false
    try {
      return !localStorage.getItem(phoneModalStorageKey)
    } catch {
      return true
    }
  }, [loading, user, location.pathname, phoneModalStorageKey])

  useEffect(() => {
    if (shouldShowPhoneModal) setPhoneModalOpen(true)
  }, [shouldShowPhoneModal])

  const onPhoneModalOpenChange = (open: boolean) => {
    setPhoneModalOpen(open)
    if (!open && phoneModalStorageKey) {
      try {
        localStorage.setItem(phoneModalStorageKey, "1")
      } catch {
        // ignore
      }
    }
  }

  return (
    // Use dynamic viewport height and prevent outer-page scrolling.
    <div className="h-dvh min-h-0 flex flex-col bg-background text-foreground overflow-hidden">
      <TopNav appName={appName} navItems={navItems} />

      {/* Phone sign-in onboarding (for SMS magic-link provisioned users) */}
      <PhoneLoginInfoModal
        open={phoneModalOpen}
        onOpenChange={onPhoneModalOpenChange}
        phoneNumber={auth.currentUser?.phoneNumber}
        hideProfileCta={location.pathname.startsWith("/profile")}
      />

      {fullBleed ? (
        // Full-bleed: content manages its own padding; keep it height-constrained
        <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
      ) : (
        // Non-full-bleed pages may still need page scroll, so keep overflow-auto here.
        <main className="flex-1 overflow-auto">
          <div className="container mx-auto px-4 py-6">{children}</div>
        </main>
      )}
    </div>
  )
}

/* ----------------------------- Top Navigation ----------------------------- */

function TopNav({ appName, navItems }: { appName: string; navItems: NavItem[] }) {
  const topNav = navItems.filter(
    (item) =>
      (item.where === "top" || item.where === "both") && PRIMARY_NAV_PATHS.has(item.to)
  )

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/70 bg-background/90 shadow-sm shadow-primary/5 backdrop-blur-xl supports-[backdrop-filter]:bg-background/75">
      <div className="grid h-16 w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-4 sm:px-5 lg:px-6">
        <div className="flex min-w-0 items-center">
          {/* Mobile: Drawer Trigger */}
          <div className="mr-2 flex lg:hidden">
            <MobileNav appName={appName} navItems={navItems} />
          </div>

          <BrandLockup appName={appName} />
        </div>

        {/* Primary Nav (Desktop) */}
        <nav className="hidden h-full items-center justify-center gap-9 lg:flex" aria-label="Primary">
          {topNav.map((item) => (
            <TopLink key={item.to} to={item.to} label={item.label} />
          ))}
        </nav>

        {/* Actions */}
        <div className="flex min-w-0 justify-end">
          <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card/50 p-1 shadow-sm shadow-primary/5">
            <ThemeToggle />
            <div className="h-6 w-px bg-border/80" />
            <ProfileMenu />
          </div>
        </div>
      </div>
    </header>
  )
}

function BrandLockup({ appName }: { appName: string }) {
  const tierMatch = appName.match(/\s+(PRO|TEAM|ENTERPRISE)$/i)
  const tier = tierMatch?.[1]
  const productName = tier ? appName.replace(/\s+(PRO|TEAM|ENTERPRISE)$/i, "") : appName
  const normalizedProductName = productName.replace(/LexBot/i, "Lexbot")
  const displayTier = tier
    ? tier.charAt(0).toUpperCase() + tier.slice(1).toLowerCase()
    : null

  return (
    <Link
      to="/files"
      className="group inline-flex min-w-0 items-baseline gap-1.5 rounded-xl transition-opacity hover:opacity-90"
      aria-label={`${appName} home`}
    >
      <span className="truncate text-[20px] font-extrabold leading-none tracking-[-0.04em] text-slate-950 dark:text-white sm:text-[21px]">
        {normalizedProductName}
      </span>
      {displayTier ? (
        <span className="text-[20px] font-extrabold leading-none tracking-[-0.04em] text-primary sm:text-[21px]">
          {displayTier}
        </span>
      ) : null}
    </Link>
  )
}

/* --------------------------------- Links --------------------------------- */

function TopLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "relative inline-flex h-full items-center px-1 text-[15px] font-semibold transition-colors duration-200",
          "after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:rounded-full after:bg-primary after:opacity-0 after:transition-opacity after:duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-0",
          isActive
            ? "text-foreground after:opacity-100"
            : "text-muted-foreground hover:text-foreground"
        )
      }
    >
      {label}
    </NavLink>
  )
}

/* ------------------------------- Mobile Nav ------------------------------- */

function MobileNav({
  appName,
  navItems,
}: {
  appName: string
  navItems: NavItem[]
}) {
  const mobileNav = navItems.filter((i) => i.where === "mobile" || i.where === "both")

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-80 border-r bg-background/95 backdrop-blur-xl">
        <SheetHeader className="text-left">
          <SheetTitle className="text-left">
            <BrandLockup appName={appName} />
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 flex flex-col gap-4">
          <Separator />

          <div className="flex flex-col gap-1">
            {mobileNav.map((item) => (
              <MobileLink key={item.to} to={item.to} label={item.label} />
            ))}
          </div>

          <Separator />

          <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-card/60 p-3">
            <span className="text-sm font-medium text-foreground">Theme</span>
            <ThemeToggle compact />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function MobileLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
          isActive
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-accent/70 hover:text-foreground"
        )
      }
    >
      {label}
    </NavLink>
  )
}

/* ------------------------------ Theme Toggle ------------------------------ */

function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [isDark, setIsDark] = useState(false)

  // initialize from DOM and persisted preference
  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme")
      if (saved === "dark") document.documentElement.classList.add("dark")
      if (saved === "light") document.documentElement.classList.remove("dark")
      setIsDark(saved ? saved === "dark" : document.documentElement.classList.contains("dark"))
    } catch {
      setIsDark(document.documentElement.classList.contains("dark"))
    }
  }, [])

  const toggle = () => {
    const next = !isDark
    setIsDark(next)
    const root = document.documentElement
    if (next) root.classList.add("dark")
    else root.classList.remove("dark")
    try {
      localStorage.setItem("theme", next ? "dark" : "light")
    } catch {
      // ignore
    }
  }

  if (compact) {
    return (
      <Button variant="outline" size="sm" className="rounded-full" onClick={toggle}>
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>
    )
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 rounded-full text-muted-foreground hover:bg-primary/10 hover:text-foreground"
      onClick={toggle}
      aria-label="Toggle theme"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  )
}
