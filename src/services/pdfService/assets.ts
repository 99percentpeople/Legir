import { configurePdfHost } from "@legir/pdf-core/host";
declare const __PDFIUM_VERSION__: string;

const assetUrl = (path: string) => {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.endsWith("/") ? base : base + "/"}${path.replace(/^\//, "")}`;
};
configurePdfHost({
  loadFontEngine: async () => (await import("./fontEngine")).fontEngine,
  resolveAssetUrl: assetUrl,
  moduleUrl: () =>
    typeof process !== "undefined" && process.versions?.node
      ? undefined
      : new URL(
          assetUrl(`pdfium/${__PDFIUM_VERSION__}/pdfium.js`),
          location.href,
        ).href,
});
