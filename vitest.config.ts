import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    server: { deps: { external: [/\/packages\/pdfium\/dist\//] } },
    environment: "jsdom",
    globals: false,
    setupFiles: ["./tests/pdf/authoringLifecycle.ts"],
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "tests/**/*.{test,spec}.{ts,tsx}",
    ],
    exclude: ["node_modules", "dist", "dev-dist", "src-tauri", "www"],
    clearMocks: true,
    restoreMocks: true,
  },
});
