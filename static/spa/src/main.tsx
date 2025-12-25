import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { AuthProvider } from "@/features/auth/AuthProvider";
import "./index.legal.css";
import { Toaster } from "sonner";
import { initGtag } from "@/lib/gtag";
import { PostHogProvider } from "posthog-js/react";

// Initialize Google tag (GA4 + Ads).
// Consent is handled by your CMP (e.g. Clickio) via Google Consent Mode / TCF.
// Make sure the Clickio CMP script is installed according to their docs.
initGtag();

const posthogOptions = {
  api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
  defaults: "2025-11-30",
  // You can add PostHog options here later (masking, autocapture tweaks, etc.)
} as const;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PostHogProvider
      apiKey={import.meta.env.VITE_PUBLIC_POSTHOG_KEY}
      options={posthogOptions}
    >
      <AuthProvider>
        {/* Global toast portal */}
        <Toaster richColors closeButton position="top-right" />
        <App />
      </AuthProvider>
    </PostHogProvider>
  </StrictMode>,
);
