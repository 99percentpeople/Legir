export type PdfFileData = Uint8Array | Blob;
export type SavedPdfPreview = { bytes: Uint8Array; mimeType: string };

// The image is rendered before export rollback, so it belongs to this exact
// saved revision. A failed preview must not reopen a large/encrypted PDF.
export const exportPreviews = new WeakMap<
  PdfFileData,
  SavedPdfPreview | null
>();
