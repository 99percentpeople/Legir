import { PDFDocument } from "./document.js";
import { Matrix } from "./matrix.js";
import { loadRuntime } from "./runtime.js";
import type { LoadOptions } from "./types.js";

export { PDFDocument, PDFGraftMap } from "./document.js";
export { PDFObject, decodeName } from "./object.js";
export { PDFPage, PDFPixmap, PDFAnnotation } from "./page.js";
export { PDFBuffer } from "./runtime.js";
export { Matrix } from "./matrix.js";
export { ObjectType } from "./types.js";
export type * from "./types.js";

export interface PDFium {
  PDFDocument: new (bytes?: Uint8Array, password?: string) => PDFDocument;
  Matrix: typeof Matrix;
  memory(): number;
  liveDocuments(): number;
  /** Decoded pixels of huge images only; excludes the WASM arena and small images. */
  largeImageCache(): {
    bytes: number;
    limit: number;
    entries: number;
    decodes: number;
    evictions: number;
  };
  /** Module-wide LRU budget, default 256 MiB. Zero evicts and disables it. */
  setLargeImageCacheLimit(bytes: number): void;
}

export async function createPDFium(options: LoadOptions = {}): Promise<PDFium> {
  const runtime = await loadRuntime(options);
  return {
    PDFDocument: class extends PDFDocument {
      constructor(bytes?: Uint8Array, password?: string) {
        super(runtime, bytes, password);
      }
    },
    Matrix,
    memory: () => runtime.native.HEAPU8.buffer.byteLength,
    liveDocuments: () => runtime.call("LPDF_LiveDocuments"),
    largeImageCache: () => ({
      bytes: runtime.call("LPDF_LargeImageCache", 0),
      limit: runtime.call("LPDF_LargeImageCache", 1),
      entries: runtime.call("LPDF_LargeImageCache", 2),
      decodes: runtime.call("LPDF_LargeImageCache", 3),
      evictions: runtime.call("LPDF_LargeImageCache", 4),
    }),
    setLargeImageCacheLimit: (bytes) => {
      if (
        !Number.isSafeInteger(bytes) ||
        bytes < 0 ||
        bytes > 512 * 1024 * 1024
      )
        throw new Error("Image cache limit must be between 0 and 512 MiB.");
      runtime.call("LPDF_SetLargeImageCacheLimit", bytes);
    },
  };
}
