import { vi } from "vitest";

// Minimal mock of our app's firebase wrapper used by AuthProvider/Login/Signup/Verify tests.
export const auth: { currentUser: any } = { currentUser: null };

export const provider = {} as any;

export const onAuth = vi.fn(() => {
  // return unsubscribe noop
  return () => {};
});

export const signInWithEmailPassword = vi.fn(async (_email: string, _pw: string) => {
  // caller will set auth.currentUser before asserting when needed
  return {};
});

export const createUserWithEmailAndPassword = vi.fn(async (_app: any, email: string, _pw: string) => {
  const user = { uid: "u_test", email };
  auth.currentUser = user;
  return { user };
});

export const sendVerificationEmail = vi.fn(async (_user?: any) => {
  return;
});

export const applyActionCode = vi.fn(async (_oobCode: string) => {
  // resolved by default; specific tests override with mockRejectedValueOnce
  return;
});

export const loginWithGoogle = vi.fn(async () => ({}));
export const logoutFirebase = vi.fn(async () => ({}));
