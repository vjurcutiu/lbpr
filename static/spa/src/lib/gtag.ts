// src/lib/gtag.ts
// Unified loader for gtag.js, GA4 (G-XXXX) and Google Ads (AW-XXXX).
// - Manual page_view for SPA with history listeners
// - Respects Cookiebot consent if present (statistics/marketing)
// - Adds UTM/click IDs from first-touch attribution on subsequent navigations

import { parseAttributionFromURL, persistFirstTouchAttribution, getStoredAttribution } from "@/lib/utm";

declare global {
  interface Window {
    dataLayer?: any[];
    gtag?: (...args: any[]) => void;
    Cookiebot?: any;
  }
}

const GA4_ID = import.meta.env.VITE_GA4_MEASUREMENT_ID as string | undefined;
const GADS_ID = import.meta.env.VITE_GTAG_AW_ID as string | undefined; // optional
const AW_SIGNUP_LABEL = import.meta.env.VITE_AW_SIGNUP_CONVERSION_LABEL as string | undefined;
const GA4_DEBUG = String(import.meta.env.VITE_GA4_DEBUG || "0") === "1";

let loaded = false;
let historyPatched = false;

function hasConsent(): boolean {
  // If Cookiebot is present, require at least "statistics" consent.
  try {
    const cb = (window as any).Cookiebot;
    if (cb && typeof cb.consented === "object") {
      const c = cb.consented;
      return !!(c.statistics || c.marketing);
    }
  } catch {}
  // If no consent manager, assume allowed.
  return true;
}

export function initGtag(): void {
  if (loaded) return;

  // Capture first-touch attribution on initial load
  try {
    persistFirstTouchAttribution(parseAttributionFromURL());
  } catch {}

  // Create dataLayer + gtag proxy ASAP
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function(){ window.dataLayer!.push(arguments as any); };
  window.gtag("js", new Date());

  // Load gtag.js only once. Prefer GA4 ID, fallback to Ads ID if GA4 not provided.
  const idForScript = GA4_ID || GADS_ID;
  if (!idForScript) {
    console.warn("[gtag] No GA4 or Ads ID provided. Set VITE_GA4_MEASUREMENT_ID or VITE_GTAG_AW_ID.");
    return;
  }

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(idForScript)}`;
  document.head.appendChild(script);

  // Configure GA4 (manual page_view) and Ads if present
  if (GA4_ID) {
    window.gtag("config", GA4_ID, {
      send_page_view: false,           // SPA: we send our own
      debug_mode: GA4_DEBUG,
    });
  }
  if (GADS_ID) {
    window.gtag("config", GADS_ID);
  }

  loaded = true;

  // Immediately track the first view (after a short tick to let the app render the title)
  setTimeout(() => trackPageView(), 0);

  // Wire SPA navigation listeners
  patchHistoryForSPA();
}

export function trackPageView(): void {
  if (!loaded || !GA4_ID || !hasConsent()) return;

  const page_location = window.location.href;
  const page_referrer = document.referrer || undefined;
  const page_title = document.title || undefined;

  const attrib = getStoredAttribution() || {};
  // GA4 will keep original UTMs from the landing URL. We also attach them to manual hits in SPA flows.
  const campaignParams: Record<string, any> = {};
  if (attrib.utm_source) campaignParams.source = attrib.utm_source;
  if (attrib.utm_medium) campaignParams.medium = attrib.utm_medium;
  if (attrib.utm_campaign) campaignParams.campaign = attrib.utm_campaign;
  if (attrib.utm_term) campaignParams.term = attrib.utm_term;
  if (attrib.utm_content) campaignParams.content = attrib.utm_content;
  if (attrib.gclid) campaignParams.gclid = attrib.gclid;
  if (attrib.wbraid) campaignParams.wbraid = attrib.wbraid;
  if (attrib.gbraid) campaignParams.gbraid = attrib.gbraid;

  window.gtag!("event", "page_view", {
    page_location,
    page_referrer,
    page_title,
    ...campaignParams,
  });
}

// Monkey-patch History API to detect SPA navigations.
function patchHistoryForSPA() {
  if (historyPatched) return;
  historyPatched = true;

  const origPush = history.pushState;
  const origReplace = history.replaceState;

  function onChange() {
    // Give React Router a tick to update title
    setTimeout(() => trackPageView(), 0);
  }

  history.pushState = function (...args: any[]) {
    const ret = origPush.apply(this, args as any);
    onChange();
    return ret;
  } as any;

  history.replaceState = function (...args: any[]) {
    const ret = origReplace.apply(this, args as any);
    onChange();
    return ret;
  } as any;

  window.addEventListener("popstate", onChange);
  window.addEventListener("hashchange", onChange);
}

// Optional: helper for Ads signup conversion (called after successful signup)
export function trackSignupConversion() {
  if (!GADS_ID || !AW_SIGNUP_LABEL || !hasConsent()) return;
  window.gtag!("event", "conversion", {
    send_to: `${GADS_ID}/${AW_SIGNUP_LABEL}`,
  });
}
