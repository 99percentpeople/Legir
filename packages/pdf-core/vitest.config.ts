import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    name: "pdf-core",
    environment: "node",
    server: { deps: { external: [/\/packages\/pdfium\/dist\//] } },
    include: ["tests/**/*.test.ts"],
    setupFiles: ["../pdfium/tests/helpers/authoringLifecycle.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});
