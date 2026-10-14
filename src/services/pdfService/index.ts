import {
  pdfWorkerService,
  getPdfWorkerForBytes,
  createPdfWorkerService,
} from "./pdfWorkerService";
import type {
  LoadedPdfDocument,
  ReadablePdfDocument,
  LoadPDFInternalOptions,
} from "./documentPipeline";
import type { ExportPdfOptions, ExportPdfRequest } from "./engine/sessionTypes";
import type { FormField, Annotation, PDFMetadata } from "@/types";
import { getPdfPermissionPolicy } from "@/lib/pdfPermissions";
import { appEventBus } from "@/lib/eventBus";
import { getSystemFontCatalog } from "@/lib/system-fonts";
import { exportPreviews } from "./engine/exportPreviews";
export type {
  LoadedPdfDocument,
  ReadablePdfDocument,
} from "./documentPipeline";

const isNode = () => typeof process !== "undefined" && !!process.versions?.node;
type PdfLoadSession = {
  id: string;
  requestPassword: (
    reason: "need_password" | "incorrect_password",
  ) => Promise<string>;
  getLastPassword: () => string | undefined;
  markProgress: (loaded: number, total?: number) => void;
  finish: (ok: boolean) => void;
};

const createPdfLoadSession = (
  label?: string,
  signal?: AbortSignal,
): PdfLoadSession => {
  const id = `pdf_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  let lastPassword: string | undefined = undefined;

  const markProgress = (loaded: number, total?: number) => {
    appEventBus.emit("pdf:loadProgress", {
      id,
      loaded,
      total,
    });
  };

  appEventBus.emit("pdf:loadStart", { id, label });
  markProgress(0, 1);

  const requestPassword = (reason: "need_password" | "incorrect_password") =>
    new Promise<string>((resolve, reject) => {
      let settled = false;
      const submit = (password: string) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", cancel);
        lastPassword = password;
        resolve(password);
      };
      const cancel = () => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", cancel);
        reject(new DOMException("Password prompt cancelled", "AbortError"));
      };

      if (signal?.aborted) {
        cancel();
        return;
      }
      signal?.addEventListener("abort", cancel, { once: true });
      appEventBus.emit("pdf:passwordRequired", {
        id,
        reason,
        submit,
        cancel,
      });
    });

  const finish = (ok: boolean) => {
    appEventBus.emit("pdf:loadEnd", { id, ok });
  };

  return {
    id,
    requestPassword,
    getLastPassword: () => lastPassword,
    markProgress,
    finish,
  };
};

const getPdfPasswordReason = (
  error: unknown,
  hadPassword: boolean,
): "need_password" | "incorrect_password" | null => {
  if (error instanceof Error && error.name === "EncryptedPDFError") {
    return hadPassword ? "incorrect_password" : "need_password";
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("password")) {
      return hadPassword ? "incorrect_password" : "need_password";
    }
  }

  return null;
};

const loadPDFInternal = async (
  input: File | Uint8Array,
  options?: LoadPDFInternalOptions,
): Promise<LoadedPdfDocument> => {
  const worker = options?.workerService ?? pdfWorkerService;
  options?.signal?.throwIfAborted();
  // Only an explicit open initializes the owner. Compile WASM while the host
  // reads the file instead of placing both operations on the critical path.
  const warming = isNode()
    ? undefined
    : worker.documentCommand("warmup", {}, options?.signal);
  void warming?.catch(() => {});
  const bytes =
    input instanceof Uint8Array
      ? input
      : new Uint8Array(await input.arrayBuffer());
  options?.signal?.throwIfAborted();
  if (isNode())
    return (await import("./documentPipeline")).loadPDFInternal(bytes, {
      ...options,
      workerService: worker,
    });
  await warming;
  const session = createPdfLoadSession("loadPDF", options?.signal);
  let password = options?.password ?? undefined;
  let prompted = !!password;
  let ok = false;
  const faces = new Set<FontFace>();
  const dispose = () => {
    for (const face of faces) document.fonts.delete(face);
    faces.clear();
  };
  try {
    while (true) {
      try {
        await worker.loadDocument(bytes, {
          docId: options?.importId,
          preview: !!options?.importId,
          password,
          signal: options?.signal,
          onProgress: (p) => session.markProgress(p.loaded, p.total),
        });
        break;
      } catch (error) {
        const reason = getPdfPasswordReason(error, prompted);
        if (!reason) throw error;
        password = await session.requestPassword(reason);
        prompted = true;
      }
    }
    const basic = await worker.documentCommand(
      "inspectDocument",
      { docId: options?.importId },
      options?.signal,
    );
    const readable: ReadablePdfDocument = {
      ...basic,
      pdfBytes: bytes,
      fields: [],
      annotations: [],
      preservedSourceAnnotations: [],
      outline: [],
      documentPermissions: null,
      openPassword: password,
      dispose,
    };
    options?.onReadable?.(readable);
    await options?.waitForHydrationStart?.();
    options?.signal?.throwIfAborted();
    const details = await worker.documentCommand(
      "parseDocument",
      {
        docId: options?.importId,
        pageIndexes: options?.getImportPageIndexes?.(),
        fontCatalog: await getSystemFontCatalog(),
      },
      options?.signal,
    );
    const { fonts, ...models } = details;
    for (const font of fonts) {
      try {
        const face = new FontFace(font.family, font.bytes.slice().buffer);
        await face.load();
        options?.signal?.throwIfAborted();
        document.fonts.add(face);
        faces.add(face);
      } catch (error) {
        if (options?.signal?.aborted) throw error;
      }
    }
    ok = true;
    return { ...readable, ...models, dispose };
  } catch (error) {
    dispose();
    throw error;
  } finally {
    session.finish(ok);
  }
};

export const loadPDF = async (
  input: File | Uint8Array,
  options?: Pick<
    LoadPDFInternalOptions,
    "password" | "workerService" | "importId"
  >,
) => loadPDFInternal(input, options);
export type PdfOpenSession = {
  readable: Promise<ReadablePdfDocument>;
  hydrate: (pageIndexes?: number[]) => Promise<LoadedPdfDocument>;
  retryHydration: () => Promise<LoadedPdfDocument>;
  abort: () => void;
  dispose: () => void;
};

export const startPdfOpenSession = (
  input: File | Uint8Array,
  options?: Pick<
    LoadPDFInternalOptions,
    "password" | "workerService" | "importId"
  >,
): PdfOpenSession => {
  let hydrationReleased = false;
  let selectedImportPages: number[] | undefined;
  let releaseHydration: (() => void) | null = null;
  let readableResolved = false;
  let readableDispose: (() => void) | null = null;
  let currentAbortController = new AbortController();
  let currentRun: Promise<LoadedPdfDocument>;

  let resolveReadable!: (document: ReadablePdfDocument) => void;
  let rejectReadable!: (error: unknown) => void;
  const readable = new Promise<ReadablePdfDocument>((resolve, reject) => {
    resolveReadable = resolve;
    rejectReadable = reject;
  });

  const hydrationGate = new Promise<void>((resolve) => {
    releaseHydration = resolve;
  });

  const run = (waitForHydrationStart?: () => Promise<void>) => {
    const abortController = currentAbortController;
    return loadPDFInternal(input, {
      ...options,
      getImportPageIndexes: () => selectedImportPages,
      signal: abortController.signal,
      waitForHydrationStart,
      onReadable: (document) => {
        readableDispose = document.dispose;
        if (!readableResolved) {
          readableResolved = true;
          resolveReadable(document);
        }
      },
    }).then((document) => {
      readableDispose = document.dispose;
      return document;
    });
  };

  currentRun = run(() => hydrationGate);
  void currentRun.catch((error) => {
    if (!readableResolved) rejectReadable(error);
  });

  const hydrate = (pageIndexes?: number[]) => {
    const changed = pageIndexes?.join(",") !== selectedImportPages?.join(",");
    selectedImportPages = pageIndexes;
    if (hydrationReleased && changed) {
      // A failed insert may be retried with a different selection. Reopening
      // this transient donor is an error-recovery path, never a normal insert.
      currentAbortController.abort();
      readableDispose?.();
      currentAbortController = new AbortController();
      currentRun = run();
    }
    if (!hydrationReleased) {
      hydrationReleased = true;
      releaseHydration?.();
      releaseHydration = null;
    }
    return currentRun;
  };

  return {
    readable,
    hydrate,
    retryHydration: () => {
      currentAbortController.abort();
      readableDispose?.();
      currentAbortController = new AbortController();
      hydrationReleased = true;
      currentRun = run();
      return currentRun;
    },
    abort: () => currentAbortController.abort(),
    dispose: () => {
      currentAbortController.abort();
      releaseHydration?.();
      releaseHydration = null;
      readableDispose?.();
      readableDispose = null;
    },
  };
};

export async function exportPDF(
  originalBytes: Uint8Array,
  fields: FormField[],
  metadata?: PDFMetadata,
  annotations: Annotation[] = [],
  customFont?: { bytes?: Uint8Array; name?: string },
  options?: ExportPdfOptions & { signal?: AbortSignal },
): Promise<Uint8Array> {
  if (isNode())
    return (await import("./documentPipeline")).exportPDF(
      originalBytes,
      fields,
      metadata,
      annotations,
      customFont,
      options,
    );
  let worker = getPdfWorkerForBytes(originalBytes);
  const owned = !worker;
  worker ??= createPdfWorkerService();
  try {
    if (owned)
      await worker.loadDocument(originalBytes, {
        password: options?.openPassword ?? undefined,
        signal: options?.signal,
      });
    const request: ExportPdfRequest = {
      fields,
      metadata,
      annotations,
      customFont,
      options: {
        ...options,
        signal: undefined,
        permissionPolicy: getPdfPermissionPolicy(),
      } as ExportPdfOptions,
    };
    return await worker.documentCommand(
      "exportDocument",
      request,
      options?.signal,
    );
  } finally {
    if (owned) worker.destroy();
  }
}

/** File/print output avoids a second file-sized JS array. Byte-array callers
 * retain exportPDF; both use the same native writer and transaction. */
export async function exportPDFBlob(
  originalBytes: Uint8Array,
  fields: FormField[],
  metadata?: PDFMetadata,
  annotations: Annotation[] = [],
  customFont?: { bytes?: Uint8Array; name?: string },
  options?: ExportPdfOptions & { signal?: AbortSignal },
): Promise<Blob> {
  const { signal, ...settings } = options ?? {};
  if (isNode()) {
    const parts: Blob[] = [];
    await (
      await import("./documentPipeline")
    ).exportPDF(originalBytes, fields, metadata, annotations, customFont, {
      ...settings,
      signal,
      writeBlob: (blob) => {
        parts.push(blob);
      },
    });
    return new Blob(parts, { type: "application/pdf" });
  }
  let worker = getPdfWorkerForBytes(originalBytes);
  const owned = !worker;
  worker ??= createPdfWorkerService();
  try {
    if (owned)
      await worker.loadDocument(originalBytes, {
        password: settings.openPassword ?? undefined,
        signal,
      });
    const output = await worker.documentCommand(
      "exportDocumentBlob",
      {
        fields,
        metadata,
        annotations,
        customFont,
        options: { ...settings, permissionPolicy: getPdfPermissionPolicy() },
      },
      signal,
    );
    exportPreviews.set(output.blob, output.preview ?? null);
    return output.blob;
  } finally {
    if (owned) worker.destroy();
  }
}

export { renderPage, renderPageBytes } from "./pdfRenderer";
