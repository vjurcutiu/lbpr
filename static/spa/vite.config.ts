import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "path";

const rootDir = process.cwd();
const isDockerDev = process.env.DOCKER_DEV === "1";

export default defineConfig({
  plugins: [react(), tailwind()],

  resolve: { alias: { "@": path.resolve(rootDir, "src") } },

  server: {
    host: true,          // 0.0.0.0 inside the container
    port: 5173,
    strictPort: true,

    // HMR goes through Nginx at app.localhost:80
    hmr: isDockerDev
      ? {
          host: "app.localhost", // browser-visible host
          protocol: "ws",        // "wss" if Nginx terminates TLS
          clientPort: 80,        // key when reverse-proxying HMR
        }
      : true,

    // Prefer NO polling for speed; only enable if your host FS requires it
    watch: isDockerDev ? { usePolling: true, interval: 150 } : undefined,

    proxy: {}, // keep API on Nginx (/api → FastAPI)
  },

  esbuild: { target: "es2020" },

  // Let Vite keep a stable prebundle cache inside the image/volume
  optimizeDeps: {
    force: false,
  },
});
