import path from "path";
import { readFileSync } from "fs";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { viteDevApiProxyPlugin } from "./config/vite/devApiProxy";
import { createPwaPlugin } from "./config/vite/pwa";
import { createStaticCopyPlugin } from "./config/vite/staticCopy";

const host = process.env.TAURI_DEV_HOST;
const packageJson = JSON.parse(readFileSync("./package.json", "utf-8"));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
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
      "process.env.GEMINI_API_KEY": JSON.stringify(env.GEMINI_API_KEY),
      "process.env.OPENAI_API_KEY": JSON.stringify(env.OPENAI_API_KEY),
      "process.env.OPENAI_API_URL": JSON.stringify(env.OPENAI_API_URL),
      "process.env.GOOGLE_TRANSLATE_API_KEY": JSON.stringify(
        env.GOOGLE_TRANSLATE_API_KEY,
      ),
      // Add package.json displayName to global scope
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
    },
  };
});
