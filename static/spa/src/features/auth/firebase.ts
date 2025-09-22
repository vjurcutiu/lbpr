// src/features/auth/firebase.ts
import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
} from "firebase/auth";
import type {User} from  "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,                 // optional but good to include
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID, // optional if you don't use FCM
};

// Fail fast if something is missing
for (const [k, v] of Object.entries(firebaseConfig)) {
  if (!v) console.warn(`[firebase] Missing env: ${k}`);
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();

export function loginWithGoogle() {
  return signInWithPopup(auth, provider);
}

export function onAuth(cb: (user: User | null) => void) {
  return onAuthStateChanged(auth, cb);
}

export function logoutFirebase() {
  return signOut(auth);
}
