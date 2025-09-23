import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Suspense } from "react";
import AppShell from "@/AppShell";
import { routes, buildNavItems } from "@/routes";
import { AuthProvider } from "@/features/auth/AuthProvider";
import ProtectedRoute from "@/features/auth/ProtectedRoute";
import AuthPage from "@/features/auth/AuthPage";

export default function App() {
  const navItems = [
    ...buildNavItems("top"),
    ...buildNavItems("mobile"),
  ].filter((v, i, a) => a.findIndex((x) => x.to === v.to) === i);

  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<div className="p-4">Loading…</div>}>
          <Routes>
            {/* Public route */}
            <Route path="/auth" element={<AuthPage />} />

            {/* Everything else requires auth — this includes "/" */}
            <Route element={<ProtectedRoute />}>
              <Route
                path="/*"
                element={
                  <AppShell appName="LBP React" navItems={navItems}>
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
                  </AppShell>
                }
              />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
