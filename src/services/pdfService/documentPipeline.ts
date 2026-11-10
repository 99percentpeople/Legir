import "./host";
export {
  loadPdf as loadPDFInternal,
  exportPDF,
} from "@legir/pdf-core/pipeline";
export type {
  LoadedPdfDocument,
  ReadablePdfDocument,
  LoadPDFInternalOptions,
} from "@legir/pdf-core/pipeline";
