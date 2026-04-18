import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Suspense } from "react";

import AppShell from "@/AppShell";
import { buildNavItems, routes, type AppRoute } from "@/routes";

function renderRoutes(items: AppRoute[], navItems: ReturnType<typeof buildNavItems>) {
  return items.map((route, index) => {
    const element = route.withAppShell ? (
      <AppShell navItems={navItems} fullBleed={route.fullBleed}>
        {route.element}
      </AppShell>
    ) : (
      route.element
    );

    return (
      <Route key={route.path ?? `group-${index}`} path={route.path} element={element}>
        {route.children?.length ? renderRoutes(route.children, navItems) : null}
      </Route>
    );
  });
}

export default function App() {
  const navItems = [...buildNavItems("top"), ...buildNavItems("mobile")].filter(
    (value, index, array) => array.findIndex((item) => item.to === value.to) === index
  );

  return (
    <BrowserRouter>
      <Suspense fallback={<div className="p-4">Loading…</div>}>
        <Routes>{renderRoutes(routes, navItems)}</Routes>
      </Suspense>
    </BrowserRouter>
  );
}
