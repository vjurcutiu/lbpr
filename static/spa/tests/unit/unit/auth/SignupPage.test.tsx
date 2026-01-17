import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderAt } from "../helpers/renderAt";

import {
  resetAuthMocks,
  mockSignUpWithEmailPassword,
  mockSendVerificationEmail,
} from "./mocks";

import "./mockModules";
import { mockTrackSignupConversion } from "./mockModules";

// Logged out for this page
import { vi as _vi } from "vitest";
_vi.doMock("@/features/auth/AuthProvider", async () => {
  return {
    AuthProvider: ({ children }: any) => children,
    useAuthContext: () => ({ user: null, loading: false, refresh: async () => {}, clear: () => {} }),
  };
});

import SignupPage from "@/features/auth/SignupPage";

describe("SignupPage", () => {
  beforeEach(() => {
    resetAuthMocks();
    mockTrackSignupConversion.mockReset();
  });

  it("blocks submit when passwords don't match", async () => {
    const user = userEvent.setup();

    renderAt(<SignupPage />, "/signup");

    await user.type(screen.getByLabelText(/^email$/i), "new@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "secret123");
    await user.type(screen.getByLabelText(/confirm password/i), "secret124");
    await user.click(screen.getByRole("button", { name: /Create account/i }));

    expect(await screen.findByText(/Passwords do not match/i)).toBeInTheDocument();
    expect(mockSignUpWithEmailPassword).not.toHaveBeenCalled();
  });

  it("creates account, tracks conversion, and sends verification email", async () => {
    const user = userEvent.setup();

    mockSignUpWithEmailPassword.mockResolvedValue({ user: { uid: "u1" } });
    mockSendVerificationEmail.mockResolvedValue(undefined);

    renderAt(<SignupPage />, "/signup");

    await user.type(screen.getByLabelText(/^email$/i), "new@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "secret123");
    await user.type(screen.getByLabelText(/confirm password/i), "secret123");
    await user.click(screen.getByRole("button", { name: /Create account/i }));

    expect(mockSignUpWithEmailPassword).toHaveBeenCalledWith("new@example.com", "secret123");
    expect(mockTrackSignupConversion).toHaveBeenCalled();
    expect(mockSendVerificationEmail).toHaveBeenCalled();

    expect(await screen.findByText(/Check your inbox/i)).toBeInTheDocument();
    expect(screen.getByText(/We sent a verification link to/i)).toBeInTheDocument();
  });

  it("shows friendly error on signup failure", async () => {
    const user = userEvent.setup();

    mockSignUpWithEmailPassword.mockRejectedValue({ code: "auth/email-already-in-use" });

    renderAt(<SignupPage />, "/signup");

    await user.type(screen.getByLabelText(/^email$/i), "exists@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "secret123");
    await user.type(screen.getByLabelText(/confirm password/i), "secret123");
    await user.click(screen.getByRole("button", { name: /Create account/i }));

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
  });
});
