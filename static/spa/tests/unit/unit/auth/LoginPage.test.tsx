import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderAt } from "../helpers/renderAt";
import { flushPromises } from "../helpers/flushPromises";

import {
  resetAuthMocks,
  setCurrentUser,
  mockSignInWithEmailPassword,
  mockLoginWithGoogle,
} from "./mocks";

// Must be imported before the component under test
import "./mockModules";
import { mockPostJSON } from "./mockModules";

// We want LoginPage to think the user is logged out.
import { vi as _vi } from "vitest";
_vi.doMock("@/features/auth/AuthProvider", async () => {
  return {
    AuthProvider: ({ children }: any) => children,
    useAuthContext: () => ({ user: null, loading: false, refresh: async () => {}, clear: () => {} }),
  };
});

import LoginPage from "@/features/auth/LoginPage";

describe("LoginPage", () => {
  beforeEach(() => {
    resetAuthMocks();
    mockPostJSON.mockReset();
  });

  it("submits email/password and exchanges session when email is verified", async () => {
    const user = userEvent.setup();

    // Firebase sign-in success; mark currentUser as verified with idToken
    setCurrentUser({
      emailVerified: true,
      getIdToken: vi.fn().mockResolvedValue("ID_TOKEN"),
    });
    mockSignInWithEmailPassword.mockResolvedValue({});
    mockPostJSON.mockResolvedValue({ ok: true });

    // Prevent jsdom navigation errors
    vi.spyOn(window.location, "replace").mockImplementation(() => {});

    renderAt(<LoginPage />, "/login?returnTo=%2Ffiles");

    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.type(screen.getByLabelText(/password/i), "secret123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await flushPromises();

    expect(mockSignInWithEmailPassword).toHaveBeenCalledWith("test@example.com", "secret123");
    expect(mockPostJSON).toHaveBeenCalledWith("/auth/session", { id_token: "ID_TOKEN" });
    expect(window.location.replace).toHaveBeenCalledWith("/files");
  });

  it("shows email verification gate if user is not verified", async () => {
    const user = userEvent.setup();

    setCurrentUser({
      emailVerified: false,
      getIdToken: vi.fn().mockResolvedValue("ID_TOKEN"),
    });
    mockSignInWithEmailPassword.mockResolvedValue({});

    renderAt(<LoginPage />, "/login?returnTo=%2Ffiles");

    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.type(screen.getByLabelText(/password/i), "secret123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText(/Please verify your email/i)).toBeInTheDocument();
    expect(mockPostJSON).not.toHaveBeenCalled();
  });

  it("renders friendly error message on login failure", async () => {
    const user = userEvent.setup();

    mockSignInWithEmailPassword.mockRejectedValue({ code: "auth/invalid-credential" });

    renderAt(<LoginPage />, "/login");

    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.type(screen.getByLabelText(/password/i), "wrong");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText(/Email or password is incorrect/i)).toBeInTheDocument();
  });

  it("calls Google sign-in when clicking Continue with Google", async () => {
    const user = userEvent.setup();
    mockLoginWithGoogle.mockResolvedValue({});

    renderAt(<LoginPage />, "/login");

    await user.click(screen.getByRole("button", { name: /Continue with Google/i }));
    expect(mockLoginWithGoogle).toHaveBeenCalledTimes(1);
  });
});
