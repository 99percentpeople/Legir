import { pdfWorkerService } from "./pdfWorkerService";

export const renderPage = async (options: {
  pageIndex: number;
  scale?: number;
  renderAnnotations?: boolean;
  signal?: AbortSignal;
  pdfBytes?: Uint8Array;
  password?: string | null;
}): Promise<string | null> => {
  try {
    if (typeof window === "undefined") return null;

    const {
      pageIndex,
      scale = 1.0,
      renderAnnotations = false,
      signal,
      pdfBytes,
      password,
    } = options;

    const { bytes, mimeType } = await pdfWorkerService.renderPageImage({
      pageIndex,
      scale,
      renderAnnotations,
      mimeType: "image/jpeg",
      quality: 0.8,
      signal,
    });

    if (!bytes || bytes.length === 0) return null;
    return await bytesToDataUrl(bytes, mimeType || "image/jpeg");
  } catch (e) {
    const msg = typeof e?.message === "string" ? e.message : String(e);
    if (msg.includes("PDF Document not loaded") && options.pdfBytes) {
      try {
        const { bytes, mimeType } = await pdfWorkerService.renderPageImage({
          pageIndex: options.pageIndex,
          scale: options.scale ?? 1.0,
          renderAnnotations: options.renderAnnotations ?? false,
          mimeType: "image/jpeg",
          quality: 0.8,
          signal: options.signal,
          isNewDoc: true,
          data: options.pdfBytes,
          password:
            typeof options.password === "string" ? options.password : undefined,
        });
        if (!bytes || bytes.length === 0) return null;
        return await bytesToDataUrl(bytes, mimeType || "image/jpeg");
      } catch (err) {
        console.error("Failed to render page to DataURL", err);
        return null;
      }
    }

    console.error("Failed to render page to DataURL", e);
    return null;
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
