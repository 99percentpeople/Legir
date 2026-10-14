import {
  createPdfWorkerService,
  getPdfWorkerForBytes,
} from "./pdfService/pdfWorkerService";
import {
  exportPreviews,
  type PdfFileData,
} from "./pdfService/engine/exportPreviews";

const bytesToDataUrl = async (bytes: Uint8Array, mimeType: string) => {
  const safeBytes = new Uint8Array(bytes);
  const blob = new Blob([safeBytes as unknown as BlobPart], {
    type: mimeType,
  });
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
};

export const renderPdfPreviewDataUrl = async (options: {
  pdfBytes: PdfFileData;
  targetWidth?: number;
  renderAnnotations?: boolean;
  signal?: AbortSignal;
}) => {
  options.signal?.throwIfAborted();
  if (exportPreviews.has(options.pdfBytes)) {
    const preview = exportPreviews.get(options.pdfBytes);
    return preview ? bytesToDataUrl(preview.bytes, preview.mimeType) : null;
  }
  const pdfBytes =
    options.pdfBytes instanceof Blob
      ? new Uint8Array(await options.pdfBytes.arrayBuffer())
      : options.pdfBytes;
  const existing = getPdfWorkerForBytes(pdfBytes);
  const worker = existing ?? createPdfWorkerService();
  try {
    if (!existing)
      await worker.loadDocument(pdfBytes, { signal: options.signal });
    const { bytes, mimeType } = await worker.renderPageImage({
      docId: "default",
      pageIndex: 0,
      targetWidth: options.targetWidth ?? 240,
      renderAnnotations: options.renderAnnotations ?? true,
      mimeType: "image/jpeg",
      quality: 0.8,
      priority: 0,
      signal: options.signal,
    });

    if (!bytes || bytes.length === 0) return null;
    return await bytesToDataUrl(bytes, mimeType || "image/jpeg");
  } finally {
    if (!existing) worker.destroy();
  }
};
