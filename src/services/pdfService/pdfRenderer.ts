import {
  pdfWorkerService,
  createPdfWorkerService,
  getPdfWorkerForBytes,
} from "./pdfWorkerService";

export const renderPage = async (options: {
  pageIndex: number;
  scale?: number;
  renderAnnotations?: boolean;
  signal?: AbortSignal;
  pdfBytes?: Uint8Array;
  password?: string | null;
}): Promise<string | null> => {
  if (typeof window === "undefined") return null;
  const existing = options.pdfBytes
    ? getPdfWorkerForBytes(options.pdfBytes)
    : pdfWorkerService;
  const worker = existing ?? createPdfWorkerService();
  try {
    if (!existing && options.pdfBytes)
      await worker.loadDocument(options.pdfBytes, {
        signal: options.signal,
        password: options.password ?? undefined,
      });
    const { bytes, mimeType } = await worker.renderPageImage({
      docId: "default",
      pageIndex: options.pageIndex,
      scale: options.scale ?? 1,
      renderAnnotations: options.renderAnnotations ?? false,
      mimeType: "image/jpeg",
      quality: 0.8,
      signal: options.signal,
    });
    return bytes?.length
      ? bytesToDataUrl(bytes, mimeType || "image/jpeg")
      : null;
  } catch (error) {
    console.error("Failed to render page to DataURL", error);
    return null;
  } finally {
    if (!existing) worker.destroy();
  }
};

export const renderPageBytes = async (
  pdfBytes: Uint8Array,
  scale: number = 1.0,
  range: number | [number, number],
  options?: {
    renderAnnotations?: boolean;
    signal?: AbortSignal;
  },
): Promise<string[] | null> => {
  if (typeof window === "undefined") return null;

  const start = Array.isArray(range) ? range[0] : range;
  const end = Array.isArray(range) ? range[1] : range;

  const from = Math.max(0, Math.min(Math.floor(start), Math.floor(end)));
  const to = Math.max(0, Math.max(Math.floor(start), Math.floor(end)));

  const signal = options?.signal;
  if (signal?.aborted) return null;

  const existing = getPdfWorkerForBytes(pdfBytes);
  const worker = existing ?? createPdfWorkerService();
  try {
    if (!existing) await worker.loadDocument(pdfBytes, { signal });

    const out: string[] = [];
    for (let pageIndex = from; pageIndex <= to; pageIndex++) {
      if (signal?.aborted) return null;

      const { bytes, mimeType } = await worker.renderPageImage({
        docId: "default",
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
    if (!existing) worker.destroy();
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
