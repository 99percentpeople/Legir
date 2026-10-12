import { loadPDFium, type PDFiumModule } from "./pdfium";
declare const __PDFIUM_VERSION__: string;
let pending: Promise<PDFiumModule> | undefined;
export const getPDFiumModuleUrl = () =>
  typeof process !== "undefined" && process.versions?.node
    ? undefined
    : new URL(
        `${import.meta.env.BASE_URL}pdfium/${__PDFIUM_VERSION__}/pdfium.js`,
        location.href,
      ).href;
/** The engine and native memory belong to the document worker. */
export function getPDFium() {
  return (pending ??= loadPDFium(getPDFiumModuleUrl()).catch((error) => {
    pending = undefined;
    throw error;
  }));
}
