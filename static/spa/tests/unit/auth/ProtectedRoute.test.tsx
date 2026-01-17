import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

// Mock react-router-dom parts so we can assert redirects without needing a full router.
vi.mock("react-router-dom", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    Navigate: (props: any) => (
      <div data-testid="navigate" data-to={props.to} data-replace={String(!!props.replace)} />
    ),
    Outlet: () => <div data-testid="outlet" />,
    useLocation: () => ({ pathname: "/chat", search: "?x=1", hash: "#h" }),
  };
});

// Default: logged out
vi.mock("@/features/auth/AuthProvider", async () => {
  return {
    useAuthContext: () => ({ user: null, loading: false, refresh: async () => {}, clear: () => {} }),
  };
});

import ProtectedRoute from "@/features/auth/ProtectedRoute";

describe("ProtectedRoute", () => {
  it("redirects to /login with returnTo when logged out", () => {
    const { getByTestId } = render(<ProtectedRoute />);
    const nav = getByTestId("navigate");
    const to = nav.getAttribute("data-to") || "";

    // returnTo should include pathname+search+hash
    expect(to).toMatch(/^\/login\?returnTo=/);
    expect(decodeURIComponent(to.split("returnTo=")[1] || "")).toBe("/chat?x=1#h");
  });

  it("shows loading state", async () => {
    vi.resetModules();
    vi.doMock("@/features/auth/AuthProvider", async () => ({
      useAuthContext: () => ({ user: null, loading: true, refresh: async () => {}, clear: () => {} }),
    }));

    const { default: ProtectedRoute2 } = await import("@/features/auth/ProtectedRoute");
    const { getByText } = render(<ProtectedRoute2 />);
    expect(getByText(/Loading/i)).toBeInTheDocument();
  });

  it("renders outlet when user is present", async () => {
    vi.resetModules();
    vi.doMock("@/features/auth/AuthProvider", async () => ({
      useAuthContext: () => ({ user: { uid: "u1" }, loading: false, refresh: async () => {}, clear: () => {} }),
    }));

    const { default: ProtectedRoute2 } = await import("@/features/auth/ProtectedRoute");
    const { getByTestId } = render(<ProtectedRoute2 />);
    expect(getByTestId("outlet")).toBeInTheDocument();
  });
});
