import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderAt } from "../helpers/renderAt";

import {
  resetAuthMocks,
  mockCreateRecaptchaVerifier,
  mockSignInWithPhone,
} from "./mocks";

import "./mockModules";

// Logged out for this page
import { vi as _vi } from "vitest";
_vi.doMock("@/features/auth/AuthProvider", async () => {
  return {
    AuthProvider: ({ children }: any) => children,
    useAuthContext: () => ({ user: null, loading: false, refresh: async () => {}, clear: () => {} }),
  };
});

import PhoneLoginPage from "@/features/auth/PhoneLoginPage";

describe("PhoneLoginPage", () => {
  beforeEach(() => {
    resetAuthMocks();
  });

  it("validates phone number format", async () => {
    const user = userEvent.setup();

    renderAt(<PhoneLoginPage />, "/phone");

    // default is '+'; attempt submit should show error
    await user.click(screen.getByRole("button", { name: /send code/i }));
    expect(await screen.findByText(/Please enter your phone number/i)).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/phone number/i));
    await user.type(screen.getByLabelText(/phone number/i), "40712345678");
    await user.click(screen.getByRole("button", { name: /send code/i }));
    expect(await screen.findByText(/must start with \+/i)).toBeInTheDocument();
  });

  it("sends SMS code and transitions to code step", async () => {
    const user = userEvent.setup();

    const verifier = { clear: vi.fn() };
    mockCreateRecaptchaVerifier.mockReturnValue(verifier);

    const confirmation = { confirm: vi.fn().mockResolvedValue({}) };
    mockSignInWithPhone.mockResolvedValue(confirmation);

    renderAt(<PhoneLoginPage />, "/phone?returnTo=%2Ffiles");

    await user.clear(screen.getByLabelText(/phone number/i));
    await user.type(screen.getByLabelText(/phone number/i), "+40 712 345 678");
    await user.click(screen.getByRole("button", { name: /send code/i }));

    expect(mockCreateRecaptchaVerifier).toHaveBeenCalledWith("recaptcha-container", { size: "invisible" });
    expect(mockSignInWithPhone).toHaveBeenCalledWith("+40712345678", verifier);

    expect(await screen.findByText(/We sent a code to/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/sms code/i)).toBeInTheDocument();
  });

  it("verifies code via confirmation.confirm", async () => {
    const user = userEvent.setup();

    const verifier = { clear: vi.fn() };
    mockCreateRecaptchaVerifier.mockReturnValue(verifier);

    const confirmation = { confirm: vi.fn().mockResolvedValue({}) };
    mockSignInWithPhone.mockResolvedValue(confirmation);

    renderAt(<PhoneLoginPage />, "/phone");

    await user.clear(screen.getByLabelText(/phone number/i));
    await user.type(screen.getByLabelText(/phone number/i), "+40712345678");
    await user.click(screen.getByRole("button", { name: /send code/i }));

    await user.type(await screen.findByLabelText(/sms code/i), "123456");
    await user.click(screen.getByRole("button", { name: /verify & sign in/i }));

    expect(confirmation.confirm).toHaveBeenCalledWith("123456");
  });

  it("shows friendly message on verify failure", async () => {
    const user = userEvent.setup();

    const verifier = { clear: vi.fn() };
    mockCreateRecaptchaVerifier.mockReturnValue(verifier);

    const confirmation = { confirm: vi.fn().mockRejectedValue({ code: "auth/invalid-verification-code" }) };
    mockSignInWithPhone.mockResolvedValue(confirmation);

    renderAt(<PhoneLoginPage />, "/phone");

    await user.clear(screen.getByLabelText(/phone number/i));
    await user.type(screen.getByLabelText(/phone number/i), "+40712345678");
    await user.click(screen.getByRole("button", { name: /send code/i }));

    await user.type(await screen.findByLabelText(/sms code/i), "000000");
    await user.click(screen.getByRole("button", { name: /verify & sign in/i }));

    expect(await screen.findByText(/code is incorrect/i)).toBeInTheDocument();
  });
});
