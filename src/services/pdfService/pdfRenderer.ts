import * as pdfjsLib from "pdfjs-dist";
import { pdfWorkerService } from "./pdfWorkerService";

const BASE_URL = import.meta.env.BASE_URL || "/";
export const PDFJS_CMAP_URL = `${BASE_URL}pdfjs/cmaps/`;
export const PDFJS_STANDARD_FONT_URL = `${BASE_URL}pdfjs/standard_fonts/`;

export const renderPage = async (
  page: pdfjsLib.PDFPageProxy,
  scale: number = 1.0,
  options?: {
    renderAnnotations?: boolean;
    signal?: AbortSignal;
  },
): Promise<string | null> => {
  try {
    if (typeof window === "undefined") return null;

    const pageIndex = Math.max(0, (page as any).pageNumber - 1);
    const { bytes, mimeType } = await pdfWorkerService.renderPageImage({
      pageIndex,
      scale,
      renderAnnotations: options?.renderAnnotations ?? false,
      mimeType: "image/jpeg",
      quality: 0.8,
      signal: options?.signal,
    });

    if (!bytes || bytes.length === 0) return null;
    return await bytesToDataUrl(bytes, mimeType || "image/jpeg");
  } catch (e) {
    console.error("Failed to render page to DataURL", e);
    return null;
  }
};

export const renderPageBytes = async (
  pdfBytes: Uint8Array,
  scale: number = 1.0,
  range: Number | [Number, Number],
  options?: {
    renderAnnotations?: boolean;
    signal?: AbortSignal;
  },
): Promise<string[] | null> => {
  if (typeof window === "undefined") return null;

  const isNumberObject = (x: unknown): x is Number => x instanceof Number;
  const toNum = (x: Number) => (isNumberObject(x) ? x.valueOf() : (x as any));

  const start = Array.isArray(range) ? toNum(range[0]) : toNum(range);
  const end = Array.isArray(range) ? toNum(range[1]) : toNum(range);

  const from = Math.max(0, Math.min(Math.floor(start), Math.floor(end)));
  const to = Math.max(0, Math.max(Math.floor(start), Math.floor(end)));

  const signal = options?.signal;
  if (signal?.aborted) return null;

  const docId = `bytes_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  try {
    await pdfWorkerService.loadDocument(pdfBytes, { docId, signal });

    const out: string[] = [];
    for (let pageIndex = from; pageIndex <= to; pageIndex++) {
      if (signal?.aborted) return null;

      const { bytes, mimeType } = await pdfWorkerService.renderPageImage({
        docId,
        pageIndex,
        scale,
        renderAnnotations: options?.renderAnnotations ?? false,
        mimeType: "image/jpeg",
        quality: 0.8,
        priority: 0,
        signal,
      });

      if (!bytes || bytes.length === 0) return null;
      const dataUrl = await bytesToDataUrl(bytes, mimeType || "image/jpeg");
      out.push(dataUrl);
    }

    return out;
  } catch (e) {
    console.warn("Failed to render PDF pages from bytes", e);
    return null;
  } finally {
    pdfWorkerService.unloadDocument(docId);
  }
};

const bytesToDataUrl = async (bytes: Uint8Array, mimeType: string) => {
  const safeBytes = new Uint8Array(bytes);
  const blob = new Blob([safeBytes as unknown as BlobPart], { type: mimeType });
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
};
