// src/features/auth/firebase.ts
import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
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
  applyActionCode as fbApplyActionCode,
  type User,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Keep Google provider exported (even if unused) to avoid breaking imports elsewhere
export const provider = new GoogleAuthProvider();

export type FbUser = User | null;

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
  // Sends verification link to the NEW email; upon clicking, Firebase will apply the change
  await verifyBeforeUpdateEmail(user, newEmail);
}

export async function changePassword(user: User, newPassword: string) {
  await updatePassword(user, newPassword);
}

export async function reauthWithPassword(email: string, password: string) {
  const cred = EmailAuthProvider.credential(email, password);
  await reauthenticateWithCredential(auth.currentUser!, cred);
}

export async function reloadUser(user: User) {
  await reload(user);
}

/**
 * Wrapper so tests can mock from our module rather than firebase/auth directly.
 * In app code we only need the oobCode; the auth instance is captured here.
 */
export async function applyActionCode(oobCode: string) {
  await fbApplyActionCode(auth, oobCode);
}
