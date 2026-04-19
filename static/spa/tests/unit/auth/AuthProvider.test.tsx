import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Mock deps used by AuthProvider.
// IMPORTANT: vi.mock(...) is hoisted, so keep all state inside the factory.
vi.mock("@/shared/api", () => {
  const mockGetJSON = vi.fn();
  const mockPostJSON = vi.fn();
  return {
    getJSON: mockGetJSON,
    postJSON: mockPostJSON,
    __mock: {
      mockGetJSON,
      mockPostJSON,
    },
  };
});

vi.mock("@/features/auth/firebase", () => {
  let authCb: ((u: any) => Promise<void>) | null = null;

  const mockLogoutFirebase = vi.fn();
  const mockAuth: any = { currentUser: null };
  const mockOnAuth = vi.fn((cb: any) => {
    authCb = cb;
    return () => {
      authCb = null;
    };
  });

  return {
    onAuth: (cb: any) => mockOnAuth(cb),
    auth: mockAuth,
    logoutFirebase: mockLogoutFirebase,
    __mock: {
      mockOnAuth,
      mockAuth,
      mockLogoutFirebase,
      getAuthCb: () => authCb,
      clearAuthCb: () => {
        authCb = null;
      },
    },
  };
});

import { AuthProvider, useAuthContext } from "@/features/auth/AuthProvider";
import { __mock as apiMock } from "@/shared/api";
import { __mock as fbMock } from "@/features/auth/firebase";

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
    apiMock.mockGetJSON.mockReset();
    apiMock.mockPostJSON.mockReset();

    fbMock.mockLogoutFirebase.mockReset();
    fbMock.mockOnAuth.mockReset();
    fbMock.mockAuth.currentUser = null;
    fbMock.clearAuthCb();
  });

  it("loads server session on mount", async () => {
    apiMock.mockGetJSON.mockResolvedValueOnce({ user: { uid: "server-user" } });

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId("uid")).toHaveTextContent("server-user");
    });
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(fbMock.mockOnAuth).toHaveBeenCalledTimes(1);
  });

  it("keeps user null if server session fetch fails", async () => {
    apiMock.mockGetJSON.mockRejectedValueOnce(new Error("nope"));

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });
    expect(screen.getByTestId("uid")).toHaveTextContent("");
  });

  it("does not exchange cookie for unverified email/password users", async () => {
    apiMock.mockGetJSON.mockResolvedValue({ user: null });

    renderProvider();
    expect(typeof fbMock.getAuthCb()).toBe("function");

    const fbUser = {
      email: "x@example.com",
      emailVerified: false,
      providerData: [{ providerId: "password" }],
    };

    await fbMock.getAuthCb()!(fbUser);

    expect(fbMock.mockLogoutFirebase).toHaveBeenCalled();
    expect(apiMock.mockPostJSON).not.toHaveBeenCalled();
    expect(screen.getByTestId("uid")).toHaveTextContent("");
  });

  it("does not exchange cookie when the server session already matches Firebase user", async () => {
    apiMock.mockGetJSON.mockResolvedValueOnce({ user: { uid: "u-phone" } });

    renderProvider();

    const fbUser = {
      uid: "u-phone",
      email: null,
      emailVerified: false,
      providerData: [{ providerId: "phone" }],
    };

    await fbMock.getAuthCb()!(fbUser);

    expect(apiMock.mockPostJSON).not.toHaveBeenCalled();
    expect(screen.getByTestId("uid")).toHaveTextContent("u-phone");
  });

  it("exchanges cookie for phone users even if emailVerified is false", async () => {
    apiMock.mockGetJSON.mockResolvedValueOnce({ user: null });
    // After cookie exchange, AuthProvider calls load() again
    apiMock.mockGetJSON.mockResolvedValueOnce({ user: { uid: "server-after" } });

    const getIdToken = vi.fn().mockResolvedValue("ID_TOKEN");
    fbMock.mockAuth.currentUser = { getIdToken };

    renderProvider();

    const fbUser = {
      uid: "u-phone",
      email: null,
      emailVerified: false,
      providerData: [{ providerId: "phone" }],
    };

    await fbMock.getAuthCb()!(fbUser);

    await waitFor(() => {
      expect(screen.getByTestId("uid")).toHaveTextContent("server-after");
    });

    expect(getIdToken).toHaveBeenCalled();
    expect(apiMock.mockPostJSON).toHaveBeenCalledWith("/auth/session", { id_token: "ID_TOKEN" });
  });

  it("sets user null when cookie exchange fails", async () => {
    apiMock.mockGetJSON.mockResolvedValue({ user: null });

    const getIdToken = vi.fn().mockResolvedValue("ID_TOKEN");
    fbMock.mockAuth.currentUser = { getIdToken };

    apiMock.mockPostJSON.mockRejectedValueOnce(new Error("bad"));

    renderProvider();

    const fbUser = {
      uid: "u-pass",
      email: "ok@example.com",
      emailVerified: true,
      providerData: [{ providerId: "password" }],
    };

    await fbMock.getAuthCb()!(fbUser);

    await waitFor(() => {
      expect(apiMock.mockPostJSON).toHaveBeenCalled();
    });
    expect(screen.getByTestId("uid")).toHaveTextContent("");
  });

  it("allows a second sync attempt after a failed exchange", async () => {
    apiMock.mockGetJSON.mockResolvedValueOnce({ user: null });
    apiMock.mockGetJSON.mockResolvedValueOnce({ user: { uid: "server-after" } });

    const getIdToken = vi.fn().mockResolvedValue("ID_TOKEN");
    fbMock.mockAuth.currentUser = { getIdToken };

    apiMock.mockPostJSON.mockRejectedValueOnce(new Error("timed out"));
    apiMock.mockPostJSON.mockResolvedValueOnce({ ok: true });

    renderProvider();

    const fbUser = {
      uid: "u-pass",
      email: "ok@example.com",
      emailVerified: true,
      providerData: [{ providerId: "password" }],
    };

    await fbMock.getAuthCb()!(fbUser);
    await fbMock.getAuthCb()!(fbUser);

    await waitFor(() => {
      expect(screen.getByTestId("uid")).toHaveTextContent("server-after");
    });
    expect(apiMock.mockPostJSON).toHaveBeenCalledTimes(2);
  });
});
