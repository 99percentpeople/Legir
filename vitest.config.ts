import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: { "@": path.resolve(__dirname, "src") } },
        test: {
          name: "app",
          server: { deps: { external: [/\/packages\/pdfium\/dist\//] } },
          environment: "jsdom",
          globals: false,
          setupFiles: ["./packages/pdfium/tests/helpers/authoringLifecycle.ts"],
          include: [
            "src/**/*.{test,spec}.{ts,tsx}",
            "tests/**/*.{test,spec}.{ts,tsx}",
          ],
          exclude: ["node_modules", "dist", "dev-dist", "src-tauri", "www"],
          clearMocks: true,
          restoreMocks: true,
        },
      },
      "packages/pdf-model/vitest.config.ts",
      "packages/pdfium/vitest.config.ts",
      "packages/pdf-core/vitest.config.ts",
      "packages/pdf-renderer/vitest.config.ts",
    ],
  },
});
