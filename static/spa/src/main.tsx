import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { AuthProvider } from "@/features/auth/AuthProvider";
import "./index.legal.css";
import { Toaster } from "sonner";
import { initGtag } from "@/lib/gtag";

// Initialize Google tag (GA4 + Ads).
// Consent is handled by your CMP (e.g. Clickio) via Google Consent Mode / TCF.
// Make sure the Clickio CMP script is installed according to their docs.
initGtag();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      {/* Global toast portal */}
      <Toaster richColors closeButton position="top-right" />
      <App />
    </AuthProvider>
  </StrictMode>,
);
