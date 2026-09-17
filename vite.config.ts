import path from "path";
import { readFileSync } from "fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { viteDevApiProxyPlugin } from "./config/vite/devApiProxy";
import { createPwaPlugin } from "./config/vite/pwa";
import { createStaticCopyPlugin } from "./config/vite/staticCopy";

const host = process.env.TAURI_DEV_HOST;
const packageJson = JSON.parse(readFileSync("./package.json", "utf-8"));

const getManualChunk = (id: string) => {
  const normalized = id.replaceAll("\\", "/");
  if (normalized.includes("/node_modules/pdf-fontkit/")) return "pdf-fontkit";
  if (normalized.includes("/node_modules/@ai-sdk/openai/")) {
    return "ai-provider-openai";
  }
  if (normalized.includes("/node_modules/@ai-sdk/google/")) {
    return "ai-provider-google";
  }
  if (normalized.includes("/node_modules/@ai-sdk/anthropic/")) {
    return "ai-provider-anthropic";
  }
  if (normalized.includes("/node_modules/@ai-sdk/xai/")) {
    return "ai-provider-xai";
  }
  if (normalized.includes("/node_modules/@ai-sdk/groq/")) {
    return "ai-provider-groq";
  }
  if (normalized.includes("/node_modules/@openrouter/ai-sdk-provider/")) {
    return "ai-provider-openrouter";
  }
  if (normalized.includes("/node_modules/zhipu-ai-provider/")) {
    return "ai-provider-zhipu";
  }
  if (normalized.includes("/node_modules/ai/")) return "ai-runtime-core";
  return undefined;
};

export default defineConfig(({ mode }) => {
  const isTauriEnv = mode === "tauri" || !!process.env.TAURI_ENV_PLATFORM;

  return {
    // prevent vite from obscuring rust errors
    clearScreen: false,
    publicDir: isTauriEnv ? false : "public",
    server: {
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        // tell vite to ignore watching `src-tauri`
        ignored: ["**/src-tauri/**"],
      },
    },
    plugins: [
      viteDevApiProxyPlugin(),
      react(),
      tailwindcss(),
      createStaticCopyPlugin(),
      ...(!isTauriEnv ? createPwaPlugin(packageJson.displayName) : []),
    ],
    define: {
      // Add package.json displayName to global scope.
      // API credentials are intentionally configured only inside the app and
      // must never be embedded into browser/Tauri frontend bundles at build time.
      "process.env.APP_NAME": JSON.stringify(packageJson.displayName),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    // Env variables starting with the item of `envPrefix` will be exposed in tauri's source code through `import.meta.env`.
    envPrefix: ["VITE_", "TAURI_ENV_*"],
    build: {
      // Tauri uses Chromium on Windows and WebKit on macOS and Linux
      target:
        process.env.TAURI_ENV_PLATFORM == "windows" ? "chrome105" : "safari13",
      // don't minify for debug builds
      minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
      // produce sourcemaps for debug builds
      sourcemap: !!process.env.TAURI_ENV_DEBUG,
      rollupOptions: {
        output: {
          manualChunks: getManualChunk,
        },
      },
    },
  };
});
