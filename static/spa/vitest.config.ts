// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/unit/setupTests.ts"],
    globals: true,
    include: ["./tests/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "**/*.playwright.spec.{ts,tsx,js,jsx}",
      "**/tests/e2e/**",
      "**/tests/**/e2e/**",
    ],
    reporters: [
      "default",
      ["json", { outputFile: "vitest-results.json" }],
    ],
  },
});
