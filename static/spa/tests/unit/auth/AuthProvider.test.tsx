import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Mock deps used by AuthProvider
const mockGetJSON = vi.fn();
const mockPostJSON = vi.fn();
vi.mock("@/shared/api", async () => ({ getJSON: mockGetJSON, postJSON: mockPostJSON }));

let authCb: ((u: any) => Promise<void>) | null = null;

const mockLogoutFirebase = vi.fn();
const mockAuth: any = { currentUser: null };
const mockOnAuth = vi.fn((cb: any) => {
  authCb = cb;
  return () => {
    authCb = null;
  };
});

vi.mock("@/features/auth/firebase", async () => ({
  onAuth: (cb: any) => mockOnAuth(cb),
  auth: mockAuth,
  logoutFirebase: mockLogoutFirebase,
}));

import { AuthProvider, useAuthContext } from "@/features/auth/AuthProvider";

function Consumer() {
  const { user, loading } = useAuthContext();
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="uid">{user?.uid || ""}</div>
    </div>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Consumer />
    </AuthProvider>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    mockGetJSON.mockReset();
    mockPostJSON.mockReset();
    mockLogoutFirebase.mockReset();
    mockAuth.currentUser = null;
    authCb = null;
  });

  it("loads server session on mount", async () => {
    mockGetJSON.mockResolvedValueOnce({ user: { uid: "server-user" } });

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId("uid")).toHaveTextContent("server-user");
    });
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(mockOnAuth).toHaveBeenCalledTimes(1);
  });

  it("keeps user null if server session fetch fails", async () => {
    mockGetJSON.mockRejectedValueOnce(new Error("nope"));

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });
    expect(screen.getByTestId("uid")).toHaveTextContent("");
  });

  it("does not exchange cookie for unverified email/password users", async () => {
    mockGetJSON.mockResolvedValue({ user: null });

    renderProvider();
    expect(authCb).toBeTypeOf("function");

    const fbUser = {
      email: "x@example.com",
      emailVerified: false,
      providerData: [{ providerId: "password" }],
    };

    await authCb!(fbUser);

    expect(mockLogoutFirebase).toHaveBeenCalled();
    expect(mockPostJSON).not.toHaveBeenCalled();
    expect(screen.getByTestId("uid")).toHaveTextContent("");
  });

  it("exchanges cookie for phone users even if emailVerified is false", async () => {
    mockGetJSON.mockResolvedValueOnce({ user: null });
    // After cookie exchange, AuthProvider calls load() again
    mockGetJSON.mockResolvedValueOnce({ user: { uid: "server-after" } });

    const getIdToken = vi.fn().mockResolvedValue("ID_TOKEN");
    mockAuth.currentUser = { getIdToken };

    renderProvider();

    const fbUser = {
      email: null,
      emailVerified: false,
      providerData: [{ providerId: "phone" }],
    };

    await authCb!(fbUser);

    await waitFor(() => {
      expect(screen.getByTestId("uid")).toHaveTextContent("server-after");
    });

    expect(getIdToken).toHaveBeenCalled();
    expect(mockPostJSON).toHaveBeenCalledWith("/auth/session", { id_token: "ID_TOKEN" });
  });

  it("sets user null when cookie exchange fails", async () => {
    mockGetJSON.mockResolvedValue({ user: null });

    const getIdToken = vi.fn().mockResolvedValue("ID_TOKEN");
    mockAuth.currentUser = { getIdToken };

    mockPostJSON.mockRejectedValueOnce(new Error("bad"));

    renderProvider();

    const fbUser = {
      email: "ok@example.com",
      emailVerified: true,
      providerData: [{ providerId: "password" }],
    };

    await authCb!(fbUser);

    await waitFor(() => {
      expect(mockPostJSON).toHaveBeenCalled();
    });
    expect(screen.getByTestId("uid")).toHaveTextContent("");
  });
});
