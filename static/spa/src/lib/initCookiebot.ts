// src/lib/initCookiebot.ts
// Dynamically injects the Cookiebot script based on env + hostname.
// This avoids relying on %VITE_*% placeholders in index.html and
// works in both dev and prod as long as VITE_COOKIEBOT_ID is set.

export function initCookiebot() {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const id = import.meta.env.VITE_COOKIEBOT_ID as string | undefined;
  if (!id) {
    if (import.meta.env.DEV) {
      console.warn("[cookiebot] VITE_COOKIEBOT_ID is not set; skipping Cookiebot init.");
    }
    return;
  }

  // Avoid double-injection
  if (document.getElementById("Cookiebot")) return;

  // Allow overriding hosts via env; fallback to a sensible default list.
  const rawHosts =
    (import.meta.env.VITE_COOKIEBOT_HOSTS as string | undefined) ||
    "lexbot.pro,www.lexbot.pro,app.localhost,localhost";

  const allowedHosts = rawHosts
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  if (!allowedHosts.includes(window.location.hostname)) {
    if (import.meta.env.DEV) {
      console.info(
        "[cookiebot] Hostname not in VITE_COOKIEBOT_HOSTS; skipping Cookiebot for",
        window.location.hostname,
        "allowed:",
        allowedHosts,
      );
    }
    return;
  }

  const script = document.createElement("script");
  script.id = "Cookiebot";
  script.src = "https://consent.cookiebot.com/uc.js";
  script.async = true;
  script.type = "text/javascript";
  (script as any).dataset.cbid = id;
  (script as any).dataset.blockingmode = "auto";

  document.head.appendChild(script);

  if (import.meta.env.DEV) {
    console.info("[cookiebot] Injected Cookiebot script for host", window.location.hostname);
  }
}
