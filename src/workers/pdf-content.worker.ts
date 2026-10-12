/// <reference lib="webworker" />
import {
  executePdfEngineRequest,
  loadPDFium,
} from "@/services/pdfService/engine/pdfium";
import type {
  PdfEngineRequest,
  PdfEngineResponse,
  PdfObjectValue,
} from "@/services/pdfService/engine/types";

const graphStreamTransfers = (
  value: PdfObjectValue,
  buffers: Set<ArrayBuffer>,
) => {
  if (!value || typeof value !== "object") return;
  if ("dict" in value) {
    if (value.stream) buffers.add(value.stream.buffer as ArrayBuffer);
    for (const [, child] of value.dict) graphStreamTransfers(child, buffers);
  } else if ("array" in value) {
    for (const child of value.array) graphStreamTransfers(child, buffers);
  }
};

self.onmessage = async ({
  data,
}: MessageEvent<{ request: PdfEngineRequest; moduleUrl: string }>) => {
  try {
    const pdfium = await loadPDFium(data.moduleUrl);
    const result = executePdfEngineRequest(pdfium, data.request);
    const bytes =
      result instanceof Uint8Array
        ? result
        : "bytes" in result
          ? result.bytes
          : undefined;
    const transfer = new Set<ArrayBuffer>();
    if (bytes) transfer.add(bytes.buffer as ArrayBuffer);
    if ("objects" in result) {
      // Parsed stream buffers are owned by this disposable worker. Transfer
      // them rather than doubling large PDF image/font payloads during cloning.
      for (const { value } of result.objects)
        graphStreamTransfers(value, transfer);
    }
    self.postMessage({ ok: true, result } satisfies PdfEngineResponse, {
      transfer: [...transfer],
    });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies PdfEngineResponse);
  }
};
