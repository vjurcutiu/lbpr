// features/auth/appcheck.ts
// Optional App Check initialization. Enable by setting VITE_ENABLE_APPCHECK=1 and providing VITE_FIREBASE_APPCHECK_SITE_KEY.
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { app } from "./firebase";

export function initAppCheckIfEnabled() {
  if (import.meta.env.VITE_ENABLE_APPCHECK !== "1") return;
  const siteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY;
  if (!siteKey) {
    console.warn("[appcheck] VITE_FIREBASE_APPCHECK_SITE_KEY missing; skipping App Check init.");
    return;
  }
  // NOTE: token auto-refresh is true by default in modular SDK
  initializeAppCheck(app, { provider: new ReCaptchaV3Provider(siteKey) });
  console.info("[appcheck] initialized");
}
