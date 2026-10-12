import { PDFDocument } from "./document.js";
import { Matrix } from "./matrix.js";
import { loadRuntime } from "./runtime.js";
import type { LoadOptions } from "./types.js";

export { PDFDocument, PDFGraftMap } from "./document.js";
export { PDFObject, decodeName } from "./object.js";
export { PDFPage, PDFPixmap, PDFAnnotation } from "./page.js";
export { PDFBuffer } from "./runtime.js";
export { Matrix } from "./matrix.js";
export type * from "./types.js";

export interface PDFium {
  PDFDocument: new (bytes?: Uint8Array, password?: string) => PDFDocument;
  Matrix: typeof Matrix;
  memory(): number;
  liveDocuments(): number;
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
  };
}
