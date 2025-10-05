import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SignupPage from "@/features/auth/SignupPage";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { withRouter } from "./testUtils";

vi.mock("@/features/auth/firebase", async () => {
  const mock = await import("./__mocks__/firebase");
  return {
    ...mock,
    auth: { currentUser: { email: "new@example.com" } },
    signUpWithEmailPassword: (email: string, pw: string) => mock.createUserWithEmailAndPassword({}, email, pw),
  };
});

function renderPage() {
  return render(withRouter(
    <AuthProvider>
      <SignupPage />
    </AuthProvider>
  ));
}

describe("SignupPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it('includes a "Sign in" link (return to login page)', () => {
    renderPage();
    expect(screen.getByRole("link", { name: /sign in/i })).toBeInTheDocument();
  });

  it("has correct autocomplete attributes", () => {
    renderPage();
    const email = screen.getByLabelText(/email/i) as HTMLInputElement;
    const pw = screen.getByLabelText(/^password$/i) as HTMLInputElement;
    const pw2 = screen.getByLabelText(/confirm password/i) as HTMLInputElement;
    expect(email.autocomplete).toBe("email");
    expect(pw.autocomplete).toBe("off");
    expect(pw2.autocomplete).toBe("off");
  });

  it("sends verification email after successful signup and shows confirmation UI", async () => {
    const mod = await import("@/features/auth/firebase");
    renderPage();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "password123" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "password123" } });
    fireEvent.submit(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(mod.sendVerificationEmail).toHaveBeenCalled();
      expect(screen.getByText(/Verify your email/i)).toBeInTheDocument();
    });
  });

  it("shows friendly signup error for weak password", async () => {
    const mod = await import("@/features/auth/firebase");
    (mod.createUserWithEmailAndPassword as any).mockRejectedValueOnce({ code: "auth/weak-password" });

    renderPage();

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "123" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "123" } });
    fireEvent.submit(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText(/Password is too weak/i)).toBeInTheDocument();
    });
  });
});
