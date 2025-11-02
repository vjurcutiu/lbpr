/**
 * src/lib/utm.ts
 * Simple UTM + click ID capture for SPA navigation.
 * - Reads UTM and click IDs from the URL.
 * - Persists "first-touch" values in localStorage.
 * - Exposes helpers to read them when sending analytics.
 */

export type Attribution = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  gclid?: string;
  wbraid?: string;
  gbraid?: string;
};

const STORE_KEY = "__lbpr_attribution_v1";

export function parseAttributionFromURL(url?: string): Attribution {
  const src = url ?? (typeof window !== "undefined" ? window.location.href : "");
  const u = new URL(src, "http://dummy");
  const q = u.searchParams;
  const get = (k: string) => (q.get(k) || undefined)?.trim();

  const attrib: Attribution = {
    utm_source: get("utm_source"),
    utm_medium: get("utm_medium"),
    utm_campaign: get("utm_campaign"),
    utm_term: get("utm_term"),
    utm_content: get("utm_content"),
    gclid: get("gclid"),
    wbraid: get("wbraid"),
    gbraid: get("gbraid"),
  };

  // Drop empty keys
  for (const k of Object.keys(attrib) as (keyof Attribution)[]) {
    if (!attrib[k]) delete attrib[k];
  }
  return attrib;
}

export function persistFirstTouchAttribution(from: Attribution): void {
  if (typeof window === "undefined") return;
  try {
    const existingRaw = localStorage.getItem(STORE_KEY);
    if (existingRaw) return; // keep first-touch only
    const clean: Attribution = {};
    for (const [k, v] of Object.entries(from)) {
      if (v) clean[k as keyof Attribution] = v;
    }
    if (Object.keys(clean).length > 0) {
      localStorage.setItem(STORE_KEY, JSON.stringify(clean));
    }
  } catch {
    // ignore
  }
}

export function getStoredAttribution(): Attribution | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Attribution) : undefined;
  } catch {
    return undefined;
  }
}
