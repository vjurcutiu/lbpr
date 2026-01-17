import React from "react";
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";

import { renderAt } from "../helpers/renderAt";

import VerifyEmailPage from "@/features/auth/VerifyEmailPage";

describe("VerifyEmailPage", () => {
  it("shows error when params missing", async () => {
    renderAt(<VerifyEmailPage />, "/verify-email");

    expect(await screen.findByText(/Invalid or missing verification link parameters/i)).toBeInTheDocument();
  });

  it("shows success when params present", async () => {
    renderAt(<VerifyEmailPage />, "/verify-email?mode=verifyEmail&oobCode=abc");

    expect(await screen.findByText(/Email verified/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Continue to sign in/i })).toHaveAttribute("href", "/login");
  });
});
