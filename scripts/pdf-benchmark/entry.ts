import { startPdfOpenSession, loadPDF, exportPDF } from "@/services/pdfService";
import { createPdfWorkerService } from "@/services/pdfService/pdfWorkerService";

// Built against each checkout's own sources, with its normal Vite worker config.
let worker: ReturnType<typeof createPdfWorkerService>;
let document: Awaited<ReturnType<typeof loadPDF>>;
let opening: ReturnType<typeof startPdfOpenSession>;
let donor: Awaited<ReturnType<typeof loadPDF>> | undefined;
let exported: Uint8Array | undefined;
let bytes: Uint8Array;
let sourceBytes: Uint8Array;
const now = () => performance.now();
const readBytes = async (url: string) =>
  new Uint8Array(await (await fetch(url)).arrayBuffer());

const bench = {
  async prepare(url: string, donorUrl: string) {
    bytes = await readBytes(url);
    sourceBytes = await readBytes(donorUrl);
  },
  async open() {
    worker = createPdfWorkerService();
    const start = now();
    opening = startPdfOpenSession(bytes, { workerService: worker });
    const readable = await opening.readable;
    return { ms: now() - start, pages: readable.pages.length };
  },
  async hydrate() {
    const start = now();
    document = await opening.hydrate();
    return {
      ms: now() - start,
      fields: document.fields.length,
      annotations: document.annotations.length,
    };
  },
  async render(index = 0) {
    const start = now();
    const image = await worker.renderPageImage({
      pageIndex: index,
      scale: 1.5,
      renderAnnotations: true,
      mimeType: "image/png",
    });
    if (!image) throw new Error("No rendered page");
    const ms = now() - start;
    const blob = new Blob([image.bytes.slice()], { type: image.mimeType });
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonWhite = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] < 245 || pixels[i + 1] < 245 || pixels[i + 2] < 245)
        nonWhite++;
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", pixels)),
    ]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    return { ms, width: canvas.width, height: canvas.height, nonWhite, hash };
  },
  async importSource() {
    const importer = createPdfWorkerService();
    const start = now();
    try {
      donor = await loadPDF(sourceBytes, { workerService: importer });
    } finally {
      importer.destroy();
    }
    const parseMs = now() - start;
    await worker.loadDocument(sourceBytes, { docId: "benchmark-import" });
    return { ms: now() - start, parseMs, pages: donor!.pages.length };
  },
  async save(imported = false) {
    const start = now();
    const fields = document.fields.map((field) => ({
      ...field,
      value: field.type === "Text" ? "BENCHMARK EDIT" : field.value,
    }));
    const annotations = document.annotations;
    const originalPages = document.pages.map((page, index) => ({
      ...page,
      id: `original-${index}`,
      source: { documentId: "default", pageIndex: index },
    }));
    const donorPages =
      donor?.pages.map((page, index) => ({
        ...page,
        id: `imported-${index}`,
        pageIndex: originalPages.length + index,
        source: { documentId: "benchmark-import", pageIndex: index },
      })) ?? [];
    exported = await exportPDF(
      bytes,
      fields,
      document.metadata,
      annotations,
      undefined,
      imported
        ? {
            syncFormFields: false,
            pageStructure: {
              pages: [...originalPages, ...donorPages],
              sources: {
                "benchmark-import": {
                  bytes: sourceBytes,
                  password: null,
                  filename: "donor.pdf",
                },
              },
            },
          }
        : undefined,
    );
    return { ms: now() - start, bytes: exported.byteLength };
  },
  async download() {
    const link = globalThis.document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([exported!.slice()], { type: "application/pdf" }),
    );
    link.download = "benchmark.pdf";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  },
  async stats() {
    return "documentCommand" in worker
      ? worker.documentCommand("documentStats", {})
      : null;
  },
  close() {
    opening.dispose();
    document?.dispose();
    donor?.dispose();
    worker.destroy();
    opening = undefined!;
    worker = undefined!;
    document = undefined!;
    donor = undefined;
    exported = undefined;
    bytes = undefined!;
    sourceBytes = undefined!;
  },
};
Object.assign(globalThis, { pdfBenchmark: bench });
