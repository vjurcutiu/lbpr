import { vi } from "vitest";
import {
  mockAuth,
  mockCreateRecaptchaVerifier,
  mockLoginWithGoogle,
  mockLogoutFirebase,
  mockSendVerificationEmail,
  mockSignInWithEmailPassword,
  mockSignInWithPhone,
  mockSignUpWithEmailPassword,
} from "./mocks";

// Mock Firebase wrapper used by our app code.
vi.mock("@/features/auth/firebase", async () => {
  return {
    auth: mockAuth,
    signInWithEmailPassword: mockSignInWithEmailPassword,
    signUpWithEmailPassword: mockSignUpWithEmailPassword,
    loginWithGoogle: mockLoginWithGoogle,
    sendVerificationEmail: mockSendVerificationEmail,
    logoutFirebase: mockLogoutFirebase,
    createRecaptchaVerifier: mockCreateRecaptchaVerifier,
    signInWithPhone: mockSignInWithPhone,
  };
});

// Mock API helpers used by AuthProvider + LoginPage.
export const mockGetJSON = vi.fn();
export const mockPostJSON = vi.fn();
vi.mock("@/shared/api", async () => {
  return {
    getJSON: mockGetJSON,
    postJSON: mockPostJSON,
  };
});

// Mock Ads conversion tracking so tests don't touch gtag
export const mockTrackSignupConversion = vi.fn();
vi.mock("@/lib/gtag", async () => {
  return {
    trackSignupConversion: mockTrackSignupConversion,
  };
});

// For most page tests, we don't want to run the real AuthProvider effect logic.
export function mockUseAuthContext(user: any = null) {
  vi.doMock("@/features/auth/AuthProvider", async () => {
    return {
      AuthProvider: ({ children }: any) => children,
      useAuthContext: () => ({
        user,
        loading: false,
        refresh: async () => {},
        clear: () => {},
        syncFromFirebase: async () => true,
      }),
    };
  });
}
