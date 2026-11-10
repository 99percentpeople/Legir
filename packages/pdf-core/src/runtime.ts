/** Advanced integration surface for worker hosts. Import the package root for
 * ordinary document jobs; implementation file paths are not public API. */
export { getPDFium } from "./engine/runtime.js";
export { loadPDFium, executePdfEngineRequest } from "./engine/pdfium.js";
export type { PDFiumModule } from "./engine/pdfium.js";
export { getEditingView } from "./engine/editingDocument.js";
export { NativePageCache } from "./engine/pageCache.js";
export {
  getNativePageViewport,
  getNativeTextContent,
  resolveNativeDestination,
} from "./engine/pageContent.js";
export {
  drawPageToCanvas,
  drawPageToCanvasCooperatively,
  disposeNativePage,
  yieldRenderTask,
} from "./engine/raster.js";
export {
  setWorkerFontProvider,
  hasWorkerFontProvider,
  requestHostFont,
} from "./engine/fontHost.js";
export type {
  FontRequest,
  FontHostRequest,
  FontHostResponse,
} from "./engine/fontHost.js";
export type { DocumentCommands } from "./engine/sessionTypes.js";
export type {
  PdfEngineRequest,
  PdfEngineResponse,
  PdfObjectValue,
} from "./engine/types.js";
export { getThumbnailSourceAnnotations } from "./lib/thumbnailSourceAnnotations.js";
export {
  drawThumbnailOverlay,
  hasThumbnailOverlay,
} from "./lib/thumbnailOverlay.js";
