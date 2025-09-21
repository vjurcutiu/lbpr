import { BrowserRouter, Routes, Route } from "react-router-dom"
import { Suspense } from "react"
import AppShell from "@/AppShell"
import { appRoutes, buildNavItems } from "@/routes"

export default function App() {
  // Use the helper to build per-placement and then de-dupe
  const navItems = [
    ...buildNavItems("top"),
    ...buildNavItems("mobile"),
  ].filter((v, i, a) => a.findIndex(x => x.to === v.to) === i)

  return (
    <BrowserRouter>
      <AppShell appName="LBP React" navItems={navItems}>
        <Suspense fallback={<div className="p-4">Loading…</div>}>
          <Routes>
            {appRoutes.map(r => (
              <Route key={r.path} path={r.path} element={r.element} />
            ))}
          </Routes>
        </Suspense>
      </AppShell>
    </BrowserRouter>
  )
}
