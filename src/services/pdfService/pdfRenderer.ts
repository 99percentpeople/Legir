import * as pdfjsLib from "pdfjs-dist";

const BASE_URL = import.meta.env.BASE_URL || "/";
export const PDFJS_CMAP_URL = `${BASE_URL}pdfjs/cmaps/`;
export const PDFJS_STANDARD_FONT_URL = `${BASE_URL}pdfjs/standard_fonts/`;

export const renderPage = async (
  page: pdfjsLib.PDFPageProxy,
  scale: number = 1.0,
  options?: {
    renderAnnotations?: boolean;
  },
): Promise<string | null> => {
  try {
    const viewport: pdfjsLib.PageViewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    if (context) {
      const annotationMode = options?.renderAnnotations
        ? pdfjsLib.AnnotationMode.ENABLE
        : pdfjsLib.AnnotationMode.DISABLE;

      await page.render({
        canvas,
        canvasContext: context,
        viewport,
        annotationMode,
      }).promise;
      return canvas.toDataURL("image/jpeg", 0.8);
    }
    return null;
  } catch (e) {
    console.error("Failed to render page to DataURL", e);
    return null;
  }
};

export const renderPdfThumbnailFromPdfBytes = async (options: {
  pdfBytes: Uint8Array;
  targetWidth?: number;
  renderAnnotations?: boolean;
}): Promise<string | null> => {
  let doc: pdfjsLib.PDFDocumentProxy | null = null;
  try {
    const renderBuffer = new Uint8Array(options.pdfBytes.slice(0));
    doc = await pdfjsLib.getDocument({
      data: renderBuffer,
      password: "",
      cMapUrl: PDFJS_CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: PDFJS_STANDARD_FONT_URL,
      useSystemFonts: false,
      disableFontFace: false,
    }).promise;

    const page = await doc.getPage(1);
    const baseViewport = page.getViewport({
      scale: 1.0,
      rotation: page.rotate,
    });
    const targetWidth = options.targetWidth ?? 240;
    const scale = Math.min(
      1.0,
      Math.max(0.05, targetWidth / baseViewport.width),
    );
    return await renderPage(page, scale, {
      renderAnnotations: options.renderAnnotations ?? true,
    });
  } catch (e) {
    console.warn("Failed to render PDF thumbnail", e);
    return null;
  } finally {
    try {
      await doc?.destroy();
    } catch {
      // ignore
    }
  }
};

export const renderPdfThumbnailFromPage = async (options: {
  page: pdfjsLib.PDFPageProxy;
  targetWidth?: number;
}): Promise<string | null> => {
  try {
    const baseViewport = options.page.getViewport({
      scale: 1.0,
      rotation: options.page.rotate,
    });
    const targetWidth = options.targetWidth ?? 240;
    const scale = Math.min(
      1.0,
      Math.max(0.05, targetWidth / baseViewport.width),
    );
    return await renderPage(options.page, scale, {
      renderAnnotations: true,
    });
  } catch (e) {
    console.warn("Failed to render PDF thumbnail", e);
    return null;
  }
};
