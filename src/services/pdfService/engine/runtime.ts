import { loadMuPdf, type MuPdfModule } from "./mupdf";

declare const __MUPDF_VERSION__: string;
let pending: Promise<MuPdfModule> | undefined;

export const getMuPdfModuleUrl = () =>
  typeof process !== "undefined" && process.versions?.node
    ? "mupdf"
    : new URL(
        `${import.meta.env.BASE_URL}mupdf/${__MUPDF_VERSION__}/mupdf.js`,
        location.href,
      ).href;

/** Rendering workers share one native instance for their lifetime. */
export function getMuPdf() {
  return (pending ??= loadMuPdf(getMuPdfModuleUrl()).catch((error) => {
    pending = undefined;
    throw error;
  }));
}
