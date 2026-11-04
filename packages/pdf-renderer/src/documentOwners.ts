import type { PDFWorkerService } from "./client.js";

// Source bytes identify the live owner without retaining closed documents.
export const documentOwners = new WeakMap<Uint8Array, PDFWorkerService>();
export const getPdfWorkerForBytes = (bytes: Uint8Array) =>
  documentOwners.get(bytes);
