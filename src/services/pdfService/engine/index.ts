import type {
  PdfEngineOperations,
  PdfEngineRequest,
  PdfEngineResponse,
} from "./types";
import { getPdfWorkerForBytes } from "./documentOwners";
import { getMuPdf, getMuPdfModuleUrl } from "./runtime";

const run = async <K extends keyof PdfEngineOperations>(
  operation: K,
  input: PdfEngineOperations[K]["input"],
  signal?: AbortSignal,
): Promise<PdfEngineOperations[K]["output"]> => {
  signal?.throwIfAborted();
  const request = { ...input, operation } as PdfEngineRequest;
  if ("bytes" in request) {
    const owner = getPdfWorkerForBytes(request.bytes);
    if (owner)
      return (await owner.documentCommand(
        "contentOperation",
        {
          // The owner already has the bytes; do not clone large inputs per request.
          request: { ...request, bytes: new Uint8Array() },
        },
        signal,
      )) as PdfEngineOperations[K]["output"];
  }
  // Node test/export callers use the identical engine without browser assets.
  if (
    (typeof process !== "undefined" && process.versions?.node) ||
    (typeof WorkerGlobalScope !== "undefined" &&
      globalThis instanceof WorkerGlobalScope)
  ) {
    const { executePdfEngineRequest } = await import("./mupdf");
    const mupdf = await getMuPdf();
    signal?.throwIfAborted();
    return executePdfEngineRequest(
      mupdf,
      request,
    ) as PdfEngineOperations[K]["output"];
  }
  return new Promise((resolve, reject) => {
    // A job owns its worker: canceling or completing it also releases WASM's
    // high-water memory, and cannot interrupt another document's operation.
    const worker = new Worker(
      new URL("../../../workers/pdf-content.worker.ts", import.meta.url),
      {
        type: "module",
        name: "pdf-content",
      },
    );
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      finish();
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    worker.onmessage = ({ data }: MessageEvent<PdfEngineResponse>) => {
      finish();
      if (data.ok) resolve(data.result as PdfEngineOperations[K]["output"]);
      else reject(new Error(data.error));
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "PDF content worker failed."));
    };
    worker.onmessageerror = () => {
      finish();
      reject(new Error("Invalid PDF content worker response."));
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    try {
      // Source pools and undo history retain their bytes; never detach them.
      const bytes = "bytes" in request ? request.bytes.slice() : undefined;
      worker.postMessage(
        {
          request: bytes ? { ...request, bytes } : request,
          moduleUrl: getMuPdfModuleUrl(),
        },
        bytes ? [bytes.buffer] : [],
      );
    } catch (error) {
      finish();
      reject(error);
    }
  });
};

export const pdfEngine = {
  readDocument: (
    input: PdfEngineOperations["readDocument"]["input"],
    signal?: AbortSignal,
  ) => run("readDocument", input, signal),
  writeDocument: (
    input: PdfEngineOperations["writeDocument"]["input"],
    signal?: AbortSignal,
  ) => run("writeDocument", input, signal),
  verifyOwnerPassword: (
    input: PdfEngineOperations["verifyOwnerPassword"]["input"],
    signal?: AbortSignal,
  ) => run("verifyOwnerPassword", input, signal),
  redactText: (
    input: PdfEngineOperations["redactText"]["input"],
    signal?: AbortSignal,
  ) => run("redactText", input, signal),
  extractText: (
    input: PdfEngineOperations["extractText"]["input"],
    signal?: AbortSignal,
  ) => run("extractText", input, signal),
  renderOcrImage: (
    input: PdfEngineOperations["renderOcrImage"]["input"],
    signal?: AbortSignal,
  ) => run("renderOcrImage", input, signal),
};

export const pdfContentEngine = pdfEngine;
