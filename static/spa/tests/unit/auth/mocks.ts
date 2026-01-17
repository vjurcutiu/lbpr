import { vi } from "vitest";

/**
 * Shared mocks used across auth component tests.
 * Each test file can import and call `resetAuthMocks()`.
 */

export const mockSignInWithEmailPassword = vi.fn();
export const mockSignUpWithEmailPassword = vi.fn();
export const mockLoginWithGoogle = vi.fn();
export const mockSendVerificationEmail = vi.fn();
export const mockLogoutFirebase = vi.fn();
export const mockCreateRecaptchaVerifier = vi.fn();
export const mockSignInWithPhone = vi.fn();

export const mockAuth = {
  currentUser: null as any,
};

export function setCurrentUser(user: any) {
  mockAuth.currentUser = user;
}

export function resetAuthMocks() {
  mockSignInWithEmailPassword.mockReset();
  mockSignUpWithEmailPassword.mockReset();
  mockLoginWithGoogle.mockReset();
  mockSendVerificationEmail.mockReset();
  mockLogoutFirebase.mockReset();
  mockCreateRecaptchaVerifier.mockReset();
  mockSignInWithPhone.mockReset();
  mockAuth.currentUser = null;
}
