import "./host";
import PDFRenderWorker from "@/workers/pdf-render.worker?worker";
import { PDFWorkerService as PdfWorkerClient } from "@legir/pdf-renderer";
import { getPlatformSystemFontBytes } from "@/services/platform/fonts";

/** Legir's bundler/platform adapter; worker transport lives in the package. */
export class PDFWorkerService extends PdfWorkerClient {
  constructor(options?: { lazy?: boolean }) {
    super({
      ...options,
      createWorker: () => new PDFRenderWorker(),
      getSystemFontBytes: getPlatformSystemFontBytes,
    });
  }
}
export const createPdfWorkerService = () => new PDFWorkerService();
export const pdfWorkerService = new PDFWorkerService({ lazy: true });
export { getPdfWorkerForBytes } from "@legir/pdf-renderer/documentOwners";
