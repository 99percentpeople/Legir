import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA, type VitePWAOptions } from "vite-plugin-pwa";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { readFileSync } from "fs";

const host = process.env.TAURI_DEV_HOST;

const packageJson = JSON.parse(readFileSync("./package.json", "utf-8"));

type ExperimentalWebManifest = NonNullable<VitePWAOptions["manifest"]> & {
  file_handlers?: Array<{
    action: string;
    accept: Record<string, string[]>;
  }>;
  launch_handler?: {
    client_mode: "focus-existing" | "navigate-existing" | "auto";
  };
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const isTauriEnv = mode === "tauri" || !!process.env.TAURI_ENV_PLATFORM;
  const pwaManifest: ExperimentalWebManifest = {
    id: "/",
    name: packageJson.displayName,
    short_name: packageJson.displayName,
    description:
      "Legir is a local-first PDF workspace for reading, annotating, and editing PDF files.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: "#ffa2a2",
    background_color: "#ffa2a2",
    icons: [
      {
        src: "pwa/icon-256.png",
        sizes: "256x256",
        type: "image/png",
      },
      {
        src: "pwa/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    file_handlers: [
      {
        action: "/#/editor",
        accept: {
          "application/pdf": [".pdf"],
        },
      },
    ],
    launch_handler: {
      client_mode: "focus-existing",
    },
  };

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
      react(),
      tailwindcss(),
      viteStaticCopy({
        targets: [
          {
            src: "node_modules/pdfjs-dist/cmaps/*",
            dest: "pdfjs/cmaps",
          },
          {
            src: "node_modules/pdfjs-dist/standard_fonts/*",
            dest: "pdfjs/standard_fonts",
          },
        ],
      }),
      ...(!isTauriEnv
        ? [
            VitePWA({
              strategies: "injectManifest",
              srcDir: "src",
              filename: "sw.ts",
              injectRegister: "auto",
              registerType: "autoUpdate",
              manifestFilename: "manifest.webmanifest",
              includeAssets: ["icons/app-icon.svg", "icons/pdf-icon.svg"],
              manifest: pwaManifest as NonNullable<VitePWAOptions["manifest"]>,
              injectManifest: {
                globIgnores: ["fonts/*.ttf"],
                maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
                globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,ttf,json}"],
              },
              devOptions: {
                enabled: true,
                type: "module",
                navigateFallback: "index.html",
              },
            }),
          ]
        : []),
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
