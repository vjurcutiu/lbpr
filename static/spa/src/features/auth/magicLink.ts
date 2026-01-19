// src/features/auth/magicLink.ts
import type { ActionCodeSettings } from "firebase/auth";

// Stored so the callback page can complete sign-in without re-prompting
// (works only when the link is opened on the same device/browser).
const STORAGE_KEY = "__lbpr_email_for_signin_v1";

export function storeEmailForMagicLink(email: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, email);
  } catch {
    // ignore (private mode / storage disabled)
  }
}

export function getStoredEmailForMagicLink(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearStoredEmailForMagicLink(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function safeOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  const env = (import.meta.env as any)?.VITE_PUBLIC_APP_URL;
  if (typeof env === "string" && env) return env;
  return "http://localhost";
}

function normalizeReturnTo(returnTo?: string): string | undefined {
  if (!returnTo) return undefined;
  // Prevent open redirects.
  if (returnTo.startsWith("http://") || returnTo.startsWith("https://")) return undefined;
  if (!returnTo.startsWith("/")) return `/${returnTo}`;
  return returnTo;
}

/**
 * Build ActionCodeSettings for Firebase email-link auth.
 *
 * - `handleCodeInApp` must be `true` for web email-link flows.
 * - `url` should point back to the SPA route that will complete sign-in.
 */
export function buildMagicLinkActionCodeSettings(opts?: {
  /** Full continue URL. If provided, takes precedence over callbackPath/returnTo. */
  url?: string;
  /** SPA path that completes sign-in (default: /auth/email-link). */
  callbackPath?: string;
  /** Optional relative path (e.g. /files) to carry through in a query string. */
  returnTo?: string;
}): ActionCodeSettings {
  const callbackPath = opts?.callbackPath || "/auth/email-link";
  const origin = safeOrigin();

  let url = opts?.url;
  if (!url) {
    const rt = normalizeReturnTo(opts?.returnTo);
    const qs = rt ? `?returnTo=${encodeURIComponent(rt)}` : "";
    url = `${origin}${callbackPath}${qs}`;
  }

  return {
    url,
    handleCodeInApp: true,
  };
}
