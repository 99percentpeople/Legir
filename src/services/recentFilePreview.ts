import { pdfWorkerService } from "./pdfService/pdfWorkerService";

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
  pdfBytes: Uint8Array;
  targetWidth?: number;
  renderAnnotations?: boolean;
  signal?: AbortSignal;
}) => {
  const docId = `recent_preview_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  try {
    const { bytes, mimeType } = await pdfWorkerService.renderPageImage({
      docId,
      data: options.pdfBytes,
      isNewDoc: true,
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
    pdfWorkerService.unloadDocument(docId);
  }
};
