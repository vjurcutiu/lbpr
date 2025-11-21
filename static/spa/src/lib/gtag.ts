// src/lib/gtag.ts
// Unified loader for GA4 + Google Ads conversion helper.
//
// - Reads IDs from VITE_GA4_MEASUREMENT_ID, VITE_GADS_ID, VITE_GADS_SIGNUP_LABEL
//   (or VITE_AW_SIGNUP_CONVERSION_LABEL as a fallback).
// - Handles SPA navigation events (history.pushState / popstate).
// - Leaves consent handling to your CMP (Clickio or any other TCF v2 CMP)
//   via Google Consent Mode / TCF integration.

declare global {
  interface Window {
    dataLayer: any[];
    gtag?: (...args: any[]) => void;
  }
}

const GA4_ID = import.meta.env.VITE_GA4_MEASUREMENT_ID as string | undefined;
const GADS_ID = import.meta.env.VITE_GADS_ID as string | undefined;
const AW_SIGNUP_LABEL =
  (import.meta.env.VITE_GADS_SIGNUP_LABEL as string | undefined) ||
  (import.meta.env.VITE_AW_SIGNUP_CONVERSION_LABEL as string | undefined);
const DEBUG = !!import.meta.env.VITE_GA4_DEBUG;

let loaded = false;
// Track the last page path (including query string) we've sent to GA4.
let currentPath = "";

export function initGtag() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (loaded) return;
  if (!GA4_ID && !GADS_ID) {
    if (DEBUG) console.info("[gtag] No GA4 or GAds IDs configured; skipping.");
    return;
  }

  const w = window as any;
  w.dataLayer = w.dataLayer || [];
  w.gtag =
    w.gtag ||
    function gtag() {
      w.dataLayer.push(arguments);
    };

  // Enable IAB TCF support so Google tags can read TC strings from a CMP
  // like Clickio when present.
  (w as any)["gtag_enable_tcf_support"] = true;

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_ID || GADS_ID}`;
  document.head.appendChild(script);

  w.gtag("js", new Date());
  if (GA4_ID) {
    w.gtag("config", GA4_ID, {
      send_page_view: false,
      debug_mode: DEBUG,
    });
  }
  if (GADS_ID) {
    w.gtag("config", GADS_ID);
  }

  loaded = true;

  patchHistoryForSPA();
  // Fire initial page_view explicitly; GA4 send_page_view is disabled above.
  trackPageView();

  if (DEBUG) {
    console.info("[gtag] init", { GA4_ID, GADS_ID });
  }
}

export function trackPageView() {
  if (!loaded || !GA4_ID) return;
  const path = window.location.pathname + window.location.search;
  if (path === currentPath) return;
  currentPath = path;
  window.gtag?.("event", "page_view", { page_path: path });
}

function patchHistoryForSPA() {
  try {
    const origPushState = history.pushState;
    history.pushState = function (...args: any[]) {
      origPushState.apply(this, args as any);
      setTimeout(trackPageView, 0);
    } as any;
    window.addEventListener("popstate", () => setTimeout(trackPageView, 0));
  } catch (err) {
    if (DEBUG) console.warn("[gtag] history patch failed", err);
  }
}

export function trackSignupConversion() {
  if (!GADS_ID || !AW_SIGNUP_LABEL) {
    if (DEBUG) {
      console.debug("[gtag] signup conversion skipped", {
        GADS_ID,
        AW_SIGNUP_LABEL,
      });
    }
    return;
  }
  window.gtag?.("event", "conversion", {
    send_to: AW_SIGNUP_LABEL,
  });
}
