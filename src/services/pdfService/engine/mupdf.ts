import type * as MuPdf from "mupdf";
import { readObjectGraph, writeObjectGraph } from "./objectGraph";
import type {
  PdfEngineRequest,
  PdfEngineResponse,
  PdfMatrix,
  PdfPageText,
  PdfPoint,
  PdfQuad,
} from "./types";

export type MuPdfModule = typeof MuPdf;

export const loadMuPdf = (moduleUrl: string): Promise<MuPdfModule> => {
  // Keep the configured Emscripten module available for measured WASM capacity.
  globalThis.$libmupdf_wasm_Module ??= {};
  return import(/* @vite-ignore */ moduleUrl);
};

const transformPoint = (point: PdfPoint, matrix: PdfMatrix): PdfPoint => [
  point[0] * matrix[0] + point[1] * matrix[2] + matrix[4],
  point[0] * matrix[1] + point[1] * matrix[3] + matrix[5],
];

const transformQuad = (quad: PdfQuad, matrix: PdfMatrix): PdfQuad =>
  [0, 2, 4, 6].flatMap((i) =>
    transformPoint([quad[i], quad[i + 1]], matrix),
  ) as PdfQuad;

const assertPageIndex = (doc: MuPdf.PDFDocument, pageIndex: number) => {
  if (
    !Number.isInteger(pageIndex) ||
    pageIndex < 0 ||
    pageIndex >= doc.countPages()
  )
    throw new Error("PDF page index is out of range.");
};

export const extractPageText = (
  mupdf: MuPdfModule,
  page: MuPdf.PDFPage,
  pageIndex: number,
): PdfPageText => {
  const pdfToPage = page.getTransform();
  const pageToPdf = mupdf.Matrix.invert(pdfToPage);
  const fontScale = Math.sqrt(
    Math.abs(pageToPdf[0] * pageToPdf[3] - pageToPdf[1] * pageToPdf[2]),
  );
  const structured = page.toStructuredText(
    "preserve-whitespace,preserve-spans",
  );
  try {
    // MuPDF 1.28.1's JS walker uses fromCharCode. JSON retains supplementary
    // Unicode characters, so use its corresponding line strings for glyph text.
    const json = JSON.parse(structured.asJSON()) as {
      blocks: { type: string; lines?: { text: string }[] }[];
    };
    const lineText = json.blocks
      .filter((block) => block.type === "text")
      .flatMap((block) =>
        (block.lines ?? []).map((line) => Array.from(line.text)),
      );
    const lines: PdfPageText["lines"] = [];
    let glyphIndex = 0;
    structured.walk({
      beginLine(_bbox, writingMode) {
        lines.push({ writingMode, glyphs: [] });
        glyphIndex = 0;
      },
      onChar(text, origin, font, size, quad, color) {
        try {
          lines.at(-1)!.glyphs.push({
            text: lineText[lines.length - 1]?.[glyphIndex++] ?? text,
            origin: transformPoint(origin, pageToPdf),
            quad: transformQuad(quad, pageToPdf),
            fontName: font.getName(),
            fontSize: size * fontScale,
            color,
          });
        } finally {
          font.destroy();
        }
      },
    });
    return { pageIndex, text: structured.asText(), pdfToPage, lines };
  } finally {
    structured.destroy();
  }
};

/** All MuPDF handles stay inside this call and are explicitly released. */
export const executePdfEngineRequest = (
  mupdf: MuPdfModule,
  request: PdfEngineRequest,
  sharedDocument?: MuPdf.PDFDocument,
): Extract<PdfEngineResponse, { ok: true }>["result"] => {
  if (request.operation === "writeDocument")
    return writeObjectGraph(mupdf, request.graph, request.security);
  if (!sharedDocument && !request.bytes.byteLength)
    throw new Error("PDF buffer is empty.");
  const doc = sharedDocument ?? new mupdf.PDFDocument(request.bytes);
  try {
    if (request.operation === "verifyOwnerPassword") {
      const trailer = doc.getTrailer();
      const encrypt = trailer.get("Encrypt");
      try {
        return {
          encrypted: !encrypt.isNull(),
          owner: (doc.authenticatePassword(request.password) & 4) !== 0,
        };
      } finally {
        encrypt.destroy();
        trailer.destroy();
      }
    }
    if (
      !sharedDocument &&
      doc.needsPassword() &&
      !doc.authenticatePassword(request.password ?? "")
    )
      throw new Error("The PDF password is missing or incorrect.");

    if (request.operation === "readDocument")
      return readObjectGraph(mupdf, doc);

    if (request.operation === "redactText") {
      const byPage = new Map<number, PdfQuad[]>();
      for (const region of request.regions) {
        assertPageIndex(doc, region.pageIndex);
        if (region.quad.length !== 8 || !region.quad.every(Number.isFinite))
          throw new Error("Invalid PDF text region.");
        const quads = byPage.get(region.pageIndex) ?? [];
        quads.push(region.quad);
        byPage.set(region.pageIndex, quads);
      }
      if (!byPage.size && !sharedDocument) return request.bytes.slice();
      for (const [pageIndex, quads] of byPage) {
        const page = doc.loadPage(pageIndex);
        try {
          const annotation = page.createAnnotation("Redact");
          try {
            annotation.setQuadPoints(
              quads.map((quad) => transformQuad(quad, page.getTransform())),
            );
            // Apply only this temporary annotation. Existing redaction marks
            // must not be committed as a side effect of replacing other text.
            annotation.applyRedaction(
              0,
              mupdf.PDFPage.REDACT_IMAGE_NONE,
              mupdf.PDFPage.REDACT_LINE_ART_NONE,
              mupdf.PDFPage.REDACT_TEXT_REMOVE,
            );
          } finally {
            annotation.destroy();
          }
        } finally {
          page.destroy();
        }
      }
      const buffer = doc.saveToBuffer("garbage=1,compress");
      try {
        return buffer.asUint8Array().slice();
      } finally {
        buffer.destroy();
      }
    }

    assertPageIndex(doc, request.pageIndex);
    const page = doc.loadPage(request.pageIndex);
    try {
      if (request.operation === "extractText")
        return extractPageText(mupdf, page, request.pageIndex);

      const dpi = request.dpi ?? 200;
      const maxPixels = request.maxPixels ?? 12_000_000;
      if (
        !Number.isFinite(dpi) ||
        dpi <= 0 ||
        dpi > 600 ||
        !Number.isFinite(maxPixels) ||
        maxPixels < 1 ||
        maxPixels > 32_000_000
      )
        throw new Error("Invalid OCR rendering resolution.");
      const bounds = page.getBounds();
      const width = bounds[2] - bounds[0];
      const height = bounds[3] - bounds[1];
      if (!(width > 0 && height > 0 && Number.isFinite(width * height)))
        throw new Error("Invalid PDF page dimensions.");
      let scale = Math.min(dpi / 72, Math.sqrt(maxPixels / (width * height)));
      // Account for the rasterizer rounding each edge to an integer pixel.
      while (Math.ceil(width * scale) * Math.ceil(height * scale) > maxPixels)
        scale *= 0.99;
      const matrix = mupdf.Matrix.scale(scale, scale);
      const pixmap = page.toPixmap(
        matrix,
        mupdf.ColorSpace.DeviceRGB,
        false,
        false,
      );
      try {
        const pdfToPixel = mupdf.Matrix.concat(page.getTransform(), matrix);
        pdfToPixel[4] -= pixmap.getX();
        pdfToPixel[5] -= pixmap.getY();
        return {
          pageIndex: request.pageIndex,
          bytes: pixmap.asPNG().slice(),
          mimeType: "image/png",
          width: pixmap.getWidth(),
          height: pixmap.getHeight(),
          pixelToPdf: mupdf.Matrix.invert(pdfToPixel),
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
