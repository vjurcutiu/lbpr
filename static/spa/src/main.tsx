import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { AuthProvider } from "@/features/auth/AuthProvider";
import "./index.legal.css";
import { Toaster } from "sonner";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      {/* Global toast portal */}
      <Toaster richColors closeButton position="top-right" />
      <App />
    </AuthProvider>
  </StrictMode>
);
