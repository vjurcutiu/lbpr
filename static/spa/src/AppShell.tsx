// src/AppShell.tsx
import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import { Link, NavLink } from "react-router-dom"
import { Menu, Sun, Moon, Search, Plus, ChevronDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

type NavItem = { to: string; label: string; where?: "top" | "mobile" | "both" }

type AppShellProps = {
  children: ReactNode
  appName?: string
  navItems?: NavItem[]
}

export default function AppShell({
  children,
  appName = "MyApp",
  navItems = [],
}: AppShellProps) {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <TopNav appName={appName} navItems={navItems} />
      <main className="flex-1">
        <div className="container mx-auto px-4 py-6">{children}</div>
      </main>
      <SiteFooter appName={appName} />
    </div>
  )
}

/* ----------------------------- Top Navigation ----------------------------- */

function TopNav({ appName, navItems }: { appName: string; navItems: NavItem[] }) {
  const topNav = navItems.filter(i => i.where === "top" || i.where === "both")

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto h-14 px-4 flex items-center gap-3">
        {/* Mobile: Drawer Trigger */}
        <div className="lg:hidden">
          <MobileNav appName={appName} navItems={navItems} />
        </div>

        {/* Logo */}
        <Link to="/" className="hidden lg:flex items-center gap-2 font-semibold">
          <div className="h-6 w-6 rounded-lg bg-primary/10 grid place-items-center">
            <div className="h-3 w-3 rounded-sm bg-primary" />
          </div>
          <span>{appName}</span>
        </Link>

        {/* Primary Nav (Desktop) */}
        <nav className="hidden lg:flex items-center gap-1 ml-2">
          {topNav.map(item => (
            <TopLink key={item.to} to={item.to} label={item.label} />
          ))}
        </nav>

        {/* Search */}
        <div className="flex-1" />
        <div className="hidden md:flex items-center gap-2 max-w-md w-full">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-60" />
            <Input placeholder="Search files, chats, commands…" className="pl-9" />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button size="sm" className="hidden sm:inline-flex">
            <Plus className="mr-2 h-4 w-4" />
            New Chat
          </Button>
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  )
}

/* --------------------------------- Links --------------------------------- */

function TopLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          "px-3 py-2 text-sm rounded-md transition-colors",
          isActive
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-accent/60",
        ].join(" ")
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
  const mobileNav = navItems.filter(i => i.where === "mobile" || i.where === "both")

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-80">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-lg bg-primary/10 grid place-items-center">
              <div className="h-3 w-3 rounded-sm bg-primary" />
            </div>
            {appName}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 flex flex-col gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-60" />
            <Input placeholder="Search…" className="pl-9" />
          </div>

          <Separator />

          <div className="flex flex-col">
            {mobileNav.map(item => (
              <MobileLink key={item.to} to={item.to} label={item.label} />
            ))}
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Theme</span>
            <ThemeToggle compact />
          </div>

          <Button className="mt-2">
            <Plus className="mr-2 h-4 w-4" />
            New Chat
          </Button>
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
        [
          "px-3 py-2 rounded-md text-sm",
          isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
        ].join(" ")
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
      setIsDark(
        saved ? saved === "dark" : document.documentElement.classList.contains("dark")
      )
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
      <Button variant="outline" size="sm" onClick={toggle}>
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>
    )
  }

  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  )
}

/* -------------------------------- User Menu ------------------------------- */

function UserMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 px-2">
          <Avatar className="h-6 w-6">
            <AvatarImage src="" alt="User" />
            <AvatarFallback>U</AvatarFallback>
          </Avatar>
          <ChevronDown className="ml-2 h-4 w-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Signed in as user@example.com</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/profile">Profile</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/billing">Billing</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/settings">Settings</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => console.log("Sign out")}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* --------------------------------- Footer -------------------------------- */

function SiteFooter({ appName }: { appName: string }) {
  return (
    <footer className="border-t">
      <div className="container mx-auto px-4 py-6 text-sm text-muted-foreground flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>© {new Date().getFullYear()} {appName}. All rights reserved.</div>
        <div className="flex items-center gap-4">
          <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link to="/terms" className="hover:text-foreground">Terms</Link>
          <Link to="/changelog" className="hover:text-foreground">Changelog</Link>
        </div>
      </div>
    </footer>
  )
}
