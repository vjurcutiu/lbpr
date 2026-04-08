import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const isDockerDev = process.env.DOCKER_DEV === '1';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    hmr: isDockerDev
      ? {
          host: 'localhost',
          protocol: 'ws',
          clientPort: 80,
        }
      : true,
    watch: isDockerDev ? { usePolling: true, interval: 150 } : undefined,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
