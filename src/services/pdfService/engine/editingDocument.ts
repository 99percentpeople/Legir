import type { PDFDocument } from "@legir/pdfium/authoring";
import type { PdfEncryption } from "./types";

import { getPDFium } from "./runtime";
import { NativeEditingContext } from "./nativeEditingContext";
import type { PDFiumModule } from "./pdfium";
import type { PDFDocument as NativeDocument } from "@legir/pdfium";
import { getNativePageViewport } from "./pageContent";
import { yieldPdfTask } from "./yieldTask";

const views = new WeakMap<
  PDFDocument,
  { view: NativeEditingContext; owned: boolean }
>();

export function createEditingView(
  pdfium: PDFiumModule,
  native: NativeDocument,
  options?: ConstructorParameters<typeof NativeEditingContext>[2],
) {
  const view = new NativeEditingContext(pdfium, native, options);
  views.set(view.document, { view, owned: false });
  return view.document;
}

export const getEditingView = (document: PDFDocument) =>
  views.get(document)?.view ?? document.nativeView;

export function disposeEditingDocument(document: PDFDocument) {
  const entry = views.get(document);
  if (!entry) {
    document.destroy();
    return;
  }
  entry.view.dispose();
  if (entry.owned) entry.view.native.destroy();
  views.delete(document);
}

export async function loadEditingDocument(
  bytes: Uint8Array,
  options?: { password?: string; signal?: AbortSignal },
): Promise<PDFDocument> {
  options?.signal?.throwIfAborted();
  const pdfium = await getPDFium();
  options?.signal?.throwIfAborted();
  const native = new pdfium.PDFDocument(bytes);
  try {
    if (
      native.needsPassword() &&
      !native.authenticatePassword(options?.password ?? "")
    )
      throw new Error("The PDF password is missing or incorrect.");
    const document = createEditingView(pdfium, native);
    views.get(document)!.owned = true;
    return document;
  } catch (error) {
    native.destroy();
    throw error;
  }
}

export async function saveEditingDocument(
  document: PDFDocument,
  options?: {
    security?: PdfEncryption;
    signal?: AbortSignal;
    writeChunk?: (bytes: Uint8Array) => void | Promise<void>;
    writeBlob?: (chunk: Blob) => void;
    incremental?: boolean;
    onSaveMode?: (incremental: boolean) => void;
  },
): Promise<Uint8Array> {
  const view = getEditingView(document);
  if (view) {
    options?.signal?.throwIfAborted();
    await view.flush();
    const security = options?.security;
    options?.signal?.throwIfAborted();
    const task = view.native.startSave({
      incremental: options?.incremental,
      encrypt: security ? "aes-256" : "none",
      ...(security
        ? {
            "user-password": security.userPassword,
            "owner-password": security.ownerPassword,
            permissions: security.permissions ?? -4,
          }
        : {}),
    });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      options?.onSaveMode?.(task.incremental);
      for (;;) {
        options?.signal?.throwIfAborted();
        if (options?.writeBlob) {
          const { done, blob } = task.nextBlob();
          if (blob.size) options.writeBlob(blob);
          if (done) break;
          await yieldPdfTask();
          continue;
        }
        const { done, bytes } = task.next();
        if (bytes.length) {
          if (options?.writeChunk) await options.writeChunk(bytes);
          else {
            chunks.push(bytes);
            size += bytes.length;
          }
        }
        if (done) break;
        await yieldPdfTask();
      }
      options?.signal?.throwIfAborted();
      if (chunks.length === 1) return chunks[0];
      const output = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.length;
      }
      return output;
    } finally {
      task.destroy();
    }
  }
  throw new Error("Saving requires a live PDFium editing view.");
}

/** Render annotation-only fallback images from the same native owner. */
export async function renderEditingAnnotations(
  document: PDFDocument,
  pageIndex: number,
  scale: number,
  signal?: AbortSignal,
) {
  const view = getEditingView(document);
  if (!view)
    throw new Error("Annotation rendering requires a live PDFium document.");
  signal?.throwIfAborted();
  await view.flush();
  signal?.throwIfAborted();
  const page = view.native.loadPage(pageIndex);
  try {
    const viewport = getNativePageViewport(page, scale);
    const width = Math.max(1, Math.floor(viewport.width)),
      height = Math.max(1, Math.floor(viewport.height));
    const task = page.startRender(viewport.transform, [0, 0, width, height], {
      contents: false,
      annotations: true,
    });
    try {
      while (!task.continue(8)) {
        await yieldPdfTask();
        signal?.throwIfAborted();
      }
      signal?.throwIfAborted();
      const bitmap = task.finish();
      try {
        return { bytes: bitmap.asPNG(), mimeType: "image/png" };
      } finally {
        bitmap.destroy();
      }
    } finally {
      task.destroy();
    }
  } finally {
    page.destroy();
  }
}
