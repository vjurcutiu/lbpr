import { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

export function withRouter(ui: ReactNode, initialEntries: string[] = ["/"]) {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="*" element={ui} />
      </Routes>
    </MemoryRouter>
  );
}
