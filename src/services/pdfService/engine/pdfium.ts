import {
  createPDFium,
  type PDFium,
  type PDFDocument,
  type PDFPage,
} from "@legir/pdfium";
import { readObjectGraph, writeObjectGraph } from "./objectGraph";
import type { PdfEngineRequest, PdfEngineResponse, PdfPageText } from "./types";

export type PDFiumModule = PDFium;
export const loadPDFium = (moduleUrl?: string) => createPDFium({ moduleUrl });
export const extractPageText = (
  _engine: PDFiumModule,
  page: PDFPage,
  pageIndex: number,
): PdfPageText => ({
  pageIndex,
  pdfToPage: page.getTransform(),
  ...page.extractText(),
});

export const executePdfEngineRequest = (
  engine: PDFiumModule,
  request: PdfEngineRequest,
  sharedDocument?: PDFDocument,
): Extract<PdfEngineResponse, { ok: true }>["result"] => {
  if (request.operation === "writeDocument")
    return writeObjectGraph(engine, request.graph, request.security);
  if (!sharedDocument && !request.bytes.byteLength)
    throw new Error("PDF buffer is empty.");
  const doc = sharedDocument ?? new engine.PDFDocument(request.bytes);
  try {
    if (request.operation === "verifyOwnerPassword") {
      const locked = doc.needsPassword();
      const credentials = doc.authenticatePassword(request.password);
      if (!credentials && locked) return { encrypted: true, owner: false };
      const trailer = doc.getTrailer(),
        encryption = trailer.get("Encrypt");
      try {
        return { encrypted: !encryption.isNull(), owner: !!(credentials & 4) };
      } finally {
        encryption.destroy();
        trailer.destroy();
      }
    }
    if (
      doc.needsPassword() &&
      !doc.authenticatePassword(request.password ?? "")
    )
      throw new Error("The PDF password is missing or incorrect.");
    if (request.operation === "readDocument")
      return readObjectGraph(engine, doc);
    if (request.operation === "redactText") {
      for (const region of request.regions) {
        if (region.quad.length !== 8 || !region.quad.every(Number.isFinite))
          throw new Error("Invalid PDF text region.");
        const page = doc.loadPage(region.pageIndex);
        try {
          page.redactText([region.quad]);
        } finally {
          page.destroy();
        }
      }
      const buffer = doc.saveToBuffer();
      try {
        return buffer.asUint8Array().slice();
      } finally {
        buffer.destroy();
      }
    }
    const page = doc.loadPage(request.pageIndex);
    try {
      if (request.operation === "extractText")
        return extractPageText(engine, page, request.pageIndex);
      const dpi = request.dpi ?? 200,
        maxPixels = request.maxPixels ?? 12_000_000;
      if (
        !Number.isFinite(dpi) ||
        dpi <= 0 ||
        dpi > 600 ||
        !Number.isFinite(maxPixels) ||
        maxPixels < 1 ||
        maxPixels > 32_000_000
      )
        throw new Error("Invalid OCR rendering resolution.");
      const bounds = page.getBounds(),
        width = bounds[2] - bounds[0],
        height = bounds[3] - bounds[1];
      if (!(width > 0 && height > 0 && Number.isFinite(width * height)))
        throw new Error("Invalid PDF page dimensions.");
      let scale = Math.min(dpi / 72, Math.sqrt(maxPixels / (width * height)));
      while (Math.ceil(width * scale) * Math.ceil(height * scale) > maxPixels)
        scale *= 0.99;
      const matrix = engine.Matrix.scale(scale, scale);
      const pixmap = page.toPixmap(matrix, undefined, false, false);
      try {
        const pdfToPixel = engine.Matrix.concat(page.getTransform(), matrix);
        pdfToPixel[4] -= pixmap.x;
        pdfToPixel[5] -= pixmap.y;
        return {
          pageIndex: request.pageIndex,
          bytes: pixmap.asPNG(),
          mimeType: "image/png",
          width: pixmap.width,
          height: pixmap.height,
          pixelToPdf: engine.Matrix.invert(pdfToPixel),
        };
      } finally {
        pixmap.destroy();
      }
    } finally {
      page.destroy();
    }
  } finally {
    if (!sharedDocument) doc.destroy();
  }
};
