// src/lib/gtag.ts
// Lightweight Google Ads (gtag.js) bootstrap + helpers for conversion tracking.
// Works with the "Install manually" flow in Google Ads (AW-XXXX).
// Environment variables (set in static/spa/.env or your deployment env):
//   VITE_GADS_ID            -> Your Google Ads ID, e.g. AW-123456789
//   VITE_GADS_SIGNUP_LABEL  -> Conversion label from the "Sign up" conversion (e.g. AbCdEfGhijkLmNoP)
// Optional (advanced):
//   VITE_GADS_DEFAULT_DENY  -> "1" to start in consent-denied mode (recommended for EEA).
//
// Use trackSignupConversion() at the moment the account is created (not on normal logins).

declare global {
  interface Window {
    dataLayer: any[];
    gtag?: (...args: any[]) => void;
  }
}

function ensureGtag() {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  // Define (or reuse) the global gtag function
  if (!window.gtag) {
    window.gtag = function gtag(){ window.dataLayer.push(arguments as any); };
  }
}

export function initGtag() {
  if (typeof window === "undefined") return;
  const id = import.meta.env.VITE_GADS_ID as string | undefined;
  if (!id) {
    // Not configured; skip silently.
    return;
  }

  ensureGtag();

  // Optional: start with denied storage (Consent Mode) unless explicitly disabled
  const defaultDeny = (import.meta.env.VITE_GADS_DEFAULT_DENY || "1") === "1";
  if (defaultDeny) {
    window.gtag!("consent", "default", {
      ad_storage: "denied",
      analytics_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
  }

  // Load the gtag.js script for your Ads ID
  const url = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  const s = document.createElement("script");
  s.async = true;
  s.src = url;
  document.head.appendChild(s);

  // Basic init + config
  window.gtag!("js", new Date());
  window.gtag!("config", id);
}

/** Update consent to "granted" (call this after the user accepts marketing cookies). */
export function grantAdsConsent() {
  if (!window.gtag) return;
  window.gtag("consent", "update", {
    ad_storage: "granted",
    analytics_storage: "granted",
    ad_user_data: "granted",
    ad_personalization: "granted",
  });
}

/**
 * Fire the Google Ads conversion for successful signups.
 * This uses the "conversion" event with a send_to of "AW-XXXX/<label>".
 * See: https://support.google.com/google-ads/answer/6095821
 */
export function trackSignupConversion(opts?: { value?: number; currency?: string; user_id?: string }) {
  const id = (import.meta.env.VITE_GADS_ID as string | undefined) || "";
  const label = (import.meta.env.VITE_GADS_SIGNUP_LABEL as string | undefined) || "";
  if (!id || !label || !window.gtag) return;

  const payload: Record<string, any> = {
    send_to: `${id}/${label}`,
  };
  if (typeof opts?.value === "number") payload.value = opts.value;
  if (opts?.currency) payload.currency = opts.currency;
  if (opts?.user_id) payload.user_id = opts.user_id;

  window.gtag("event", "conversion", payload);
}
