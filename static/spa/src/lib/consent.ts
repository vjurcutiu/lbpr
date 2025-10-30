// src/lib/consent.ts
// Cookiebot → Google Consent Mode bridge.
// Maps Cookiebot categories to Consent Mode signals for Google Ads/Analytics.
// - marketing   → ad_storage, ad_user_data, ad_personalization
// - statistics  → analytics_storage
//
// Requires Cookiebot script tag in index.html and gtag bootstrap (src/lib/gtag.ts).

declare global {
  interface Window {
    Cookiebot?: {
      consent?: {
        necessary?: boolean;
        preferences?: boolean;
        statistics?: boolean;
        marketing?: boolean;
      };
    };
    dataLayer: any[];
    gtag?: (...args: any[]) => void;
  }
}

function updateFromCookiebot() {
  const c = window.Cookiebot?.consent;
  if (!c) return;

  const marketing = !!c.marketing;
  const statistics = !!c.statistics;

  const payload: Record<string, string> = {
    ad_storage: marketing ? "granted" : "denied",
    ad_user_data: marketing ? "granted" : "denied",
    ad_personalization: marketing ? "granted" : "denied",
    analytics_storage: statistics ? "granted" : "denied",
  };

  if (typeof window.gtag === "function") {
    window.gtag("consent", "update", payload);
  } else {
    // Ensure dataLayer exists; gtag bootstrap will consume this later.
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(["consent", "update", payload]);
  }
}

export function initCookiebotConsentBridge() {
  if (typeof window === "undefined") return;

  // Run once now if Cookiebot has already initialized
  try {
    if (window.Cookiebot?.consent) updateFromCookiebot();
  } catch {}

  // Listen for Cookiebot lifecycle events
  try {
    document.addEventListener("CookiebotOnConsentReady", updateFromCookiebot);
    document.addEventListener("CookiebotOnAccept", updateFromCookiebot);
    document.addEventListener("CookiebotOnDecline", updateFromCookiebot);
  } catch {
    // Non-fatal
  }
}
