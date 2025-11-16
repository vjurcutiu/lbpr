// src/lib/firebase.ts
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";

// Keep this tiny, only init the app here. Other packages (auth, firestore) import their own modules.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

// One-time debug to verify what the SPA actually sees at runtime.
// We only log lengths / tails, never the full secret.
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

  // This will show up in the browser console (DevTools).
  console.log("[SPA DEBUG] Firebase config", debugPayload);

  if (!firebaseConfig.apiKey) {
    console.error("[SPA DEBUG] Missing Firebase apiKey at runtime");
  }
} catch {
  // Never break app init for logging issues
}

export function getFirebaseApp(): FirebaseApp {
  const apps = getApps();
  if (apps.length) return getApp();
  return initializeApp(firebaseConfig);
}
