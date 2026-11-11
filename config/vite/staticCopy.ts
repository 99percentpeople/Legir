import { viteStaticCopy } from "vite-plugin-static-copy";

export const createStaticCopyPlugin = (pdfiumVersion: string) =>
  viteStaticCopy({
    targets: [
      {
        // Tauri disables publicDir, so retain the catalog license in both builds.
        src: "public/models-dev.LICENSE.txt",
        dest: ".",
        rename: { stripBase: 1 },
      },
      {
        // Keep the ESM loader beside its WASM files. Versioned URLs prevent a
        // PWA update from mixing the JS bindings with a cached older binary.
        src: [
          "packages/pdfium/wasm/*.js",
          "packages/pdfium/wasm/*.wasm",
          "packages/pdfium/wasm/provenance.json",
          "packages/pdfium/wasm/licenses",
        ],
        dest: `pdfium/${pdfiumVersion}`,
        rename: { stripBase: 3 },
      },
      {
        src: "generated-icons/app/128x128@2x.png",
        dest: "pwa/app",
        rename: { stripBase: 2 },
      },
      {
        src: "generated-icons/app/icon.png",
        dest: "pwa/app",
        rename: { stripBase: 2 },
      },
      {
        src: "generated-icons/pdf/128x128.png",
        dest: "pwa/pdf",
        rename: { stripBase: 2 },
      },
      {
        src: "generated-icons/pdf/128x128@2x.png",
        dest: "pwa/pdf",
        rename: { stripBase: 2 },
      },
    ],
  });
