import { VitePWA, type VitePWAOptions } from "vite-plugin-pwa";

type ExperimentalWebManifest = NonNullable<VitePWAOptions["manifest"]> & {
  file_handlers?: Array<{
    action: string;
    name?: string;
    accept: Record<string, string[]>;
    icons?: Array<{
      src: string;
      sizes?: string;
      type?: string;
    }>;
  }>;
  launch_handler?: {
    client_mode: "focus-existing" | "navigate-existing" | "auto";
  };
};

const createPwaManifest = (displayName: string): ExperimentalWebManifest => ({
  id: "/",
  name: displayName,
  short_name: displayName,
  description:
    "Legir is a local-first PDF workspace for reading, annotating, and editing PDF files.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  theme_color: "#ffa2a2",
  background_color: "#ffa2a2",
  icons: [
    {
      src: "pwa/app/128x128@2x.png",
      sizes: "256x256",
      type: "image/png",
    },
    {
      src: "pwa/app/icon.png",
      sizes: "512x512",
      type: "image/png",
    },
  ],
  file_handlers: [
    {
      action: "/#/editor",
      name: "PDF Document",
      accept: {
        "application/pdf": [".pdf"],
      },
      icons: [
        {
          src: "pwa/pdf/128x128.png",
          sizes: "128x128",
          type: "image/png",
        },
        {
          src: "pwa/pdf/128x128@2x.png",
          sizes: "256x256",
          type: "image/png",
        },
      ],
    },
  ],
  launch_handler: {
    client_mode: "focus-existing",
  },
});

export const createPwaPlugin = (displayName: string) =>
  VitePWA({
    strategies: "injectManifest",
    srcDir: "src",
    filename: "sw.ts",
    injectRegister: "auto",
    registerType: "autoUpdate",
    manifestFilename: "manifest.webmanifest",
    includeAssets: ["icons/app-icon.svg", "icons/pdf-icon.svg"],
    manifest: createPwaManifest(displayName),
    injectManifest: {
      globIgnores: ["fonts/*.ttf"],
      maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,ttf,json}"],
    },
  });
