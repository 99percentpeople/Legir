import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFObject,
  PDFRef,
  PDFStream,
  PDFString,
} from "@cantoo/pdf-lib";
import { pdfEngine } from "./index";
import type { PdfEncryption, PdfObjectGraph, PdfObjectValue } from "./types";

import { getPDFium } from "./runtime";
import { NativeEditingContext } from "./nativeEditingContext";
import type { PDFiumModule } from "./pdfium";
import type { PDFDocument as NativeDocument } from "@legir/pdfium";
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
  views.get(document)?.view;

export function disposeEditingDocument(document: PDFDocument) {
  const entry = views.get(document);
  if (!entry) return;
  entry.view.dispose();
  if (entry.owned) entry.view.native.destroy();
  views.delete(document);
}

const toNativeName = (name: PDFName) => name.asString().slice(1);

function toValue(object: PDFObject): PdfObjectValue {
  if (object === PDFNull) return null;
  if (object instanceof PDFBool) return object.asBoolean();
  if (object instanceof PDFNumber) return object.asNumber();
  if (object instanceof PDFName) return { name: toNativeName(object) };
  if (object instanceof PDFRef)
    return { ref: object.objectNumber, generation: object.generationNumber };
  if (object instanceof PDFString || object instanceof PDFHexString)
    return { string: object.asBytes() };
  if (object instanceof PDFArray)
    return { array: object.asArray().map(toValue) };
  if (object instanceof PDFStream) {
    // getContents also resolves deferred compression on authored appearances.
    const stream = object.getContents();
    return {
      dict: object.dict
        .entries()
        .map(([key, value]) => [toNativeName(key), toValue(value)]),
      stream,
    };
  }
  if (object instanceof PDFDict)
    return {
      dict: object
        .entries()
        .map(([key, value]) => [toNativeName(key), toValue(value)]),
    };
  throw new Error(`Unsupported editing object: ${object.constructor.name}`);
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
  },
): Promise<Uint8Array> {
  const view = getEditingView(document);
  if (view) {
    options?.signal?.throwIfAborted();
    await view.flush();
    const security = options?.security;
    options?.signal?.throwIfAborted();
    const task = view.native.startSave({
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
  await document.flush();
  const graph: PdfObjectGraph = {
    version: Math.round(
      Number(document.context.header.getVersionString()) * 10,
    ),
    objects: document.context
      .enumerateIndirectObjects()
      .map(([ref, object]) => ({
        number: ref.objectNumber,
        generation: ref.generationNumber,
        value: toValue(object),
      })),
    trailer: Object.entries(document.context.trailerInfo)
      .filter(([key, value]) => key !== "Encrypt" && value !== undefined)
      .map(([key, value]) => [key, toValue(value!)]),
  };
  const output = await pdfEngine.writeDocument(
    { graph, security: options?.security },
    options?.signal,
  );
  if (options?.writeChunk) {
    await options.writeChunk(output);
    return new Uint8Array();
  }
  if (options?.writeBlob) {
    options.writeBlob(new Blob([output as BlobPart]));
    return new Uint8Array();
  }
  return output;
}
