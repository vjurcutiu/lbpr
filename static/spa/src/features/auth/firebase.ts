// src/features/auth/firebase.ts
import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  verifyBeforeUpdateEmail,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  reload,
  type User,
  GoogleAuthProvider,
  signInWithPopup,
  reauthenticateWithPopup,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signInWithCustomToken as _signInWithCustomToken,
  type ConfirmationResult,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

// 🔍 Debug: what does the SPA actually see at runtime?
declare global {
  interface Window {
    __LEXBOT_SPA_ENV__?: {
      mode: string;
      firebase: {
        apiKeyLength?: number;
        apiKeyTail?: string;
        projectId?: string;
        authDomain?: string;
        appIdLength?: number;
        appIdTail?: string;
        messagingSenderId?: string;
        messagingSenderIdLength?: number;
      };
    };
  }
}

try {
  const debugPayload = {
    mode: import.meta.env.MODE,
    firebase: {
      apiKeyLength: firebaseConfig.apiKey?.length,
      apiKeyTail: firebaseConfig.apiKey ? firebaseConfig.apiKey.slice(-6) : undefined,
      projectId: firebaseConfig.projectId,
      authDomain: firebaseConfig.authDomain,
      appIdLength: firebaseConfig.appId?.length,
      appIdTail: firebaseConfig.appId ? firebaseConfig.appId.slice(-6) : undefined,
      messagingSenderId: firebaseConfig.messagingSenderId,
      messagingSenderIdLength: firebaseConfig.messagingSenderId?.length,
    },
  };

  // Assigning to window is an observable side-effect,
  // so bundlers won't tree-shake this even if console.* is stripped.
  window.__LEXBOT_SPA_ENV__ = debugPayload;

  // Keep console logging for dev builds; it will be dropped in prod by drop_console.
  if (import.meta.env.DEV) {
    console.log("[SPA DEBUG] Firebase config (auth/firebase.ts)", debugPayload);
    if (!firebaseConfig.apiKey) {
      console.error("[SPA DEBUG] Missing Firebase apiKey at runtime (auth/firebase.ts)");
    }
  }
} catch {
  // never break auth init because of logging/debug
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// ---- Dev-only phone auth escape hatch ----
// When developing locally you can optionally bypass reCAPTCHA / app verification.
// This is useful if reCAPTCHA is blocked by extensions/CSP, or if you only want to
// validate the rest of the flow.
//
// NEVER enable this in production.
//
// Enable by setting:
//   VITE_FIREBASE_DISABLE_PHONE_APP_VERIFICATION=1
if (import.meta.env.DEV && import.meta.env.VITE_FIREBASE_DISABLE_PHONE_APP_VERIFICATION === "1") {
  try {
    auth.settings.appVerificationDisabledForTesting = true;
    console.warn(
      "[auth] Phone app verification disabled for testing (VITE_FIREBASE_DISABLE_PHONE_APP_VERIFICATION=1). DO NOT use in production."
    );
  } catch (e) {
    console.warn("[auth] Failed to disable app verification for testing.", e);
  }
}

// Keep Google provider exported (other parts of the app import it)
export const provider = new GoogleAuthProvider();

export type FbUser = User | null;

/** Core auth state */
export function onAuth(cb: (user: FbUser) => void) {
  return onAuthStateChanged(auth, cb);
}

export function loginWithGoogle() {
  return signInWithPopup(auth, provider);
}

export function logoutFirebase() {
  return signOut(auth);
}

/** Email/password helpers */
export function signUpWithEmailPassword(email: string, password: string) {
  return createUserWithEmailAndPassword(auth, email, password);
}

export function signInWithEmailPassword(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function sendVerificationEmail(user: User) {
  await sendEmailVerification(user);
}

export async function startEmailChangeVerification(user: User, newEmail: string) {
  await verifyBeforeUpdateEmail(user, newEmail);
}

export async function changePassword(user: User, newPassword: string) {
  await updatePassword(user, newPassword);
}

export async function reauthWithPassword(currentEmail: string, currentPassword: string) {
  const user = auth.currentUser;
  if (!user) throw new Error("No signed-in user");
  const cred = EmailAuthProvider.credential(currentEmail, currentPassword);
  await reauthenticateWithCredential(user, cred);
  await reload(user);
}

export async function reauthWithGoogle() {
  const user = auth.currentUser;
  if (!user) throw new Error("No signed-in user");
  await reauthenticateWithPopup(user, new GoogleAuthProvider());
  await reload(user);
}

// ---- Phone auth helpers ----
// Firebase docs show (auth, containerOrId, params) for RecaptchaVerifier, but some SDK builds expose
// (containerOrId, params, auth). We support both to avoid version-specific breakage.
export function createRecaptchaVerifier(
  containerOrId: string | HTMLElement,
  params: Record<string, unknown> = {}
): RecaptchaVerifier {
  const cfg: Record<string, unknown> = { ...params };
  if (!("size" in cfg)) cfg.size = "invisible";

  try {
    // Preferred (per Firebase Web docs)
    return new (RecaptchaVerifier as any)(auth, containerOrId as any, cfg);
  } catch {
    // Legacy/alternate constructor shape
    return new (RecaptchaVerifier as any)(containerOrId as any, cfg, auth);
  }
}

export function signInWithPhone(phoneNumber: string, verifier: RecaptchaVerifier): Promise<ConfirmationResult> {
  return signInWithPhoneNumber(auth, phoneNumber, verifier);
}

// ---- Custom-token helper (used by SMS magic-link flow) ----
export function signInWithCustomToken(customToken: string) {
  return _signInWithCustomToken(auth, customToken);
}

export type { ConfirmationResult };
