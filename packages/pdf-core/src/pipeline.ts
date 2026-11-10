/** Advanced host-managed loading. Prefer DocumentSession for headless jobs. */
export { loadPDFInternal as loadPdf, exportPDF } from "./documentPipeline.js";
export type {
  LoadedPdfDocument,
  ReadablePdfDocument,
  LoadPDFInternalOptions,
} from "./documentPipeline.js";
export {
  createPdfLoadSession,
  getPdfPasswordReason,
} from "./pipeline/loadSession.js";
export type { PdfLoadSession } from "./pipeline/loadSession.js";
export { yieldPdfTask } from "./engine/yieldTask.js";
