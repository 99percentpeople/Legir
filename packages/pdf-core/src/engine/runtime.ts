import { loadPDFium, type PDFiumModule } from "./pdfium.js";
import { getPdfHost } from "../host.js";
let pending: Promise<PDFiumModule> | undefined;
export const getPDFiumModuleUrl = () => getPdfHost().moduleUrl?.();
/** One runtime per realm; document lifetime remains explicit. */
export function getPDFium() {
  return (pending ??= loadPDFium(getPDFiumModuleUrl()).catch((error) => {
    pending = undefined;
    throw error;
  }));
}
