import React from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

export function renderAt(ui: React.ReactElement, route: string = "/") {
  return render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>);
}
