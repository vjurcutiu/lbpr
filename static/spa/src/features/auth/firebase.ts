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
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

// 🔍 Debug: what does the SPA actually see at runtime?
try {
  const debugPayload = {
    apiKeyTail: firebaseConfig.apiKey ? firebaseConfig.apiKey.slice(-6) : undefined,
    apiKeyLength: firebaseConfig.apiKey?.length,
    authDomain: firebaseConfig.authDomain,
    projectId: firebaseConfig.projectId,
    appIdTail: firebaseConfig.appId ? firebaseConfig.appId.slice(-6) : undefined,
    appIdLength: firebaseConfig.appId?.length,
    messagingSenderId: firebaseConfig.messagingSenderId,
    messagingSenderIdLength: firebaseConfig.messagingSenderId?.length,
  };

  console.log("[SPA DEBUG] Firebase config (auth/firebase.ts)", debugPayload);

  if (!firebaseConfig.apiKey) {
    console.error("[SPA DEBUG] Missing Firebase apiKey at runtime (auth/firebase.ts)");
  }
} catch {
  // never break auth init because of logging
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

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
