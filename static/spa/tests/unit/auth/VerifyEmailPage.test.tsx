import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import VerifyEmailPage from "@/features/auth/VerifyEmailPage";
import { withRouter } from "./testUtils";

vi.mock("@/features/auth/firebase", async () => {
  const mock = await import("../__mocks__/firebase");
  return {
    ...mock,
    auth: {},
    applyActionCode: mock.applyActionCode,
  };
});

describe("VerifyEmailPage", () => {
  it("shows error when params missing", () => {
    render(withRouter(<VerifyEmailPage />, ["/verify-email"]));
    expect(screen.getByText(/Invalid or missing verification link/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Create account/i })).toBeInTheDocument();
  });

  it("shows success when applyActionCode resolves", async () => {
    render(withRouter(<VerifyEmailPage />, ["/verify-email?mode=verifyEmail&oobCode=abc"]));
    await waitFor(() => {
      expect(screen.getByText(/Email verified/i)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Continue to sign in/i })).toBeInTheDocument();
    });
  });

  it("shows failure when applyActionCode rejects", async () => {
    const mod = await import("@/features/auth/firebase");
    (mod.applyActionCode as any).mockRejectedValueOnce(new Error("bad code"));

    render(withRouter(<VerifyEmailPage />, ["/verify-email?mode=verifyEmail&oobCode=bad"]));
    await waitFor(() => {
      expect(screen.getByText(/verification link is invalid or expired/i)).toBeInTheDocument();
    });
  });
});
