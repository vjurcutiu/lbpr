// src/App.tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Suspense } from "react";
import AppShell from "@/AppShell";
import { routes, buildNavItems } from "@/routes";

export default function App() {
  const navItems = [
    ...buildNavItems("top"),
    ...buildNavItems("mobile"),
  ].filter((v, i, a) => a.findIndex(x => x.to === v.to) === i);

  return (
    <BrowserRouter>
      <AppShell appName="LBP React" navItems={navItems}>
        <Suspense fallback={<div className="p-4">Loading…</div>}>
          <Routes>
            {routes.map((r, i) =>
              r.children ? (
                <Route key={`grp-${i}`} element={r.element}>
                  {r.children.map((c) => (
                    <Route key={c.path} path={c.path} element={c.element} />
                  ))}
                </Route>
              ) : (
                <Route key={r.path ?? `leaf-${i}`} path={r.path} element={r.element} />
              )
            )}
          </Routes>
        </Suspense>
      </AppShell>
    </BrowserRouter>
  );
}
