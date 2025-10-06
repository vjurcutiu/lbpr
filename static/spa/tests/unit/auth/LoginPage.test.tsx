import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LoginPage from "@/features/auth/LoginPage";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { withRouter } from "./testUtils";

vi.mock("@/features/auth/firebase", async () => {
  const mock = await import("../__mocks__/firebase");
  return {
    ...mock,
    auth: { currentUser: null },
  };
});

function renderPage() {
  return render(withRouter(
    <AuthProvider>
      <LoginPage />
    </AuthProvider>
  ));
}

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct autocomplete attributes", () => {
    renderPage();
    const email = screen.getByLabelText(/email/i) as HTMLInputElement;
    const password = screen.getByLabelText(/password/i) as HTMLInputElement;
    expect(email.autocomplete).toBe("email");
    expect(password.autocomplete).toBe("off");
  });

  it("shows friendly error when Firebase throws invalid-credential", async () => {
    const { signInWithEmailPassword } = await import("@/features/auth/firebase");
    (signInWithEmailPassword as any).mockRejectedValueOnce({ code: "auth/invalid-credential" });

    renderPage();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "x@example.com" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "password" } });
    fireEvent.submit(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/Email or password is incorrect/i)).toBeInTheDocument();
    });
  });

  it("shows verify banner when email not verified", async () => {
    const mod = await import("@/features/auth/firebase");
    (mod.signInWithEmailPassword as any).mockResolvedValueOnce({});
    (mod as any).auth.currentUser = { emailVerified: false };

    renderPage();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "x@example.com" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "password" } });
    fireEvent.submit(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/Please verify your email/i)).toBeInTheDocument();
    });
  });
});
