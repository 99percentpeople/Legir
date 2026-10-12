import { startPdfOpenSession, loadPDF, exportPDF } from "@/services/pdfService";
import { createPdfWorkerService } from "@/services/pdfService/pdfWorkerService";
import type { PageData } from "@/types";

// This identical entry is compiled against each revision's production services.
// It deliberately does not import, patch, or call an engine directly.
let worker: ReturnType<typeof createPdfWorkerService> | undefined;
let opening: ReturnType<typeof startPdfOpenSession> | undefined;
let loaded: Awaited<ReturnType<typeof loadPDF>> | undefined;
let donor: Awaited<ReturnType<typeof loadPDF>> | undefined;
let bytes: Uint8Array | undefined;
let donorBytes: Uint8Array | undefined;
let output: Uint8Array | undefined;
let pages: PageData[] = [];
let canvas: HTMLCanvasElement | undefined;
let canvasSequence = 0;
let canvasId = "";
let downloadUrl: string | undefined;
const now = () => performance.now();

async function releaseCanvas() {
  if (canvas) {
    await worker?.releaseCanvas({ canvasIds: [canvasId] });
    canvas.remove();
    canvas = undefined;
  }
}

const bench = {
  async prepare(url: string, sourceUrl: string) {
    bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    donorBytes = new Uint8Array(await (await fetch(sourceUrl)).arrayBuffer());
    return { bytes: bytes.length, donorBytes: donorBytes.length };
  },
  async open() {
    const start = now();
    worker = createPdfWorkerService();
    opening = startPdfOpenSession(bytes!, { workerService: worker });
    const readable = await opening.readable;
    pages = readable.pages;
    return {
      ms: now() - start,
      pages: pages.length,
      sizes: pages.map(({ width, height, rotation }) => ({
        width,
        height,
        rotation,
      })),
    };
  },
  async hydrate() {
    const start = now();
    loaded = await opening!.hydrate();
    return {
      ms: now() - start,
      fields: loaded.fields.length,
      annotations: loaded.annotations.length,
      preservedAnnotations: loaded.preservedSourceAnnotations.length,
      outline: loaded.outline.length,
    };
  },
  async render(options: {
    pageIndex: number;
    longEdge: number;
    freshCanvas?: boolean;
    rotation?: number;
    tilePosition?: [number, number];
  }) {
    const { pageIndex, longEdge, rotation = 0, tilePosition } = options;
    if (options.freshCanvas) await releaseCanvas();
    let transfer: OffscreenCanvas | undefined;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvasId = `corpus-${canvasSequence++}`;
      canvas.style.maxWidth = "1200px";
      canvas.style.maxHeight = "900px";
      document.body.append(canvas);
      transfer = canvas.transferControlToOffscreen();
    }
    const page = pages[pageIndex];
    const scale = longEdge / Math.max(page.width, page.height);
    const width = (rotation % 180 ? page.height : page.width) * scale;
    const height = (rotation % 180 ? page.width : page.height) * scale;
    const tile: [number, number, number, number] | undefined = tilePosition
      ? [
          Math.floor((width - 1024) * tilePosition[0]),
          Math.floor((height - 1024) * tilePosition[1]),
          1024,
          1024,
        ]
      : undefined;
    const start = now();
    const rendered = await worker!.renderPage({
      pageIndex,
      scale,
      rotation,
      tile,
      canvasId,
      canvas: transfer,
    });
    if (!rendered) throw new Error("Render was cancelled");
    return { ms: now() - start, pageIndex, scale, longEdge, rotation, tile };
  },
  async png(pageIndex: number) {
    const start = now();
    const page = pages[pageIndex];
    const result = await worker!.renderPageImage({
      pageIndex,
      scale: 1600 / Math.max(page.width, page.height),
      renderAnnotations: true,
      mimeType: "image/png",
    });
    if (!result) throw new Error("No PNG output");
    const ms = now() - start;
    // Correctness work is outside the reported PNG time.
    const bitmap = await createImageBitmap(new Blob([result.bytes.slice()]));
    const target = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = target.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = ctx.getImageData(0, 0, target.width, target.height).data;
    let nonWhite = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] < 245 || pixels[i + 1] < 245 || pixels[i + 2] < 245)
        nonWhite++;
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", pixels)),
    )
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    return {
      ms,
      pageIndex,
      bytes: result.bytes.length,
      width: target.width,
      height: target.height,
      nonWhite,
      hash,
    };
  },
  async importSource() {
    const start = now();
    const preview = createPdfWorkerService();
    try {
      donor = await loadPDF(donorBytes!, { workerService: preview });
    } finally {
      preview.destroy();
    }
    const parseMs = now() - start;
    await worker!.loadDocument(donorBytes!, { docId: "corpus-donor" });
    const ms = now() - start;
    return {
      ms,
      parseMs,
      registerMs: ms - parseMs,
      pages: donor!.pages.length,
    };
  },
  async save(merged = false) {
    const start = now();
    const originalPages = loaded!.pages.map((page, index) => ({
      ...page,
      id: `original-${index}`,
      source: { documentId: "default", pageIndex: index },
    }));
    const importedPages =
      donor?.pages.map((page, index) => ({
        ...page,
        id: `donor-${index}`,
        pageIndex: originalPages.length + index,
        source: { documentId: "corpus-donor", pageIndex: index },
      })) ?? [];
    // Match pageEditingSlice's append semantics: imported controls and link
    // targets move with the pages. Omitting these models requests their deletion.
    const offset = originalPages.length;
    const annotations = merged
      ? [
          ...loaded!.annotations,
          ...donor!.annotations.map((annotation) => ({
            ...annotation,
            id: `donor-${annotation.id}`,
            pageIndex: offset + annotation.pageIndex,
            linkDestPageIndex:
              annotation.linkDestPageIndex === undefined
                ? undefined
                : offset + annotation.linkDestPageIndex,
            replies: annotation.replies?.map((reply) => ({
              ...reply,
              id: `donor-${reply.id}`,
              parentAnnotationId: `donor-${annotation.id}`,
              inReplyToReplyId: reply.inReplyToReplyId
                ? `donor-${reply.inReplyToReplyId}`
                : undefined,
            })),
          })),
        ]
      : loaded!.annotations;
    const fields = merged
      ? [
          ...loaded!.fields,
          ...donor!.fields.map((field) => ({
            ...field,
            id: `donor-${field.id}`,
            pageIndex: offset + field.pageIndex,
          })),
        ]
      : loaded!.fields;
    const preserved = merged
      ? [
          ...loaded!.preservedSourceAnnotations,
          ...donor!.preservedSourceAnnotations.map((annotation) => ({
            ...annotation,
            pageIndex: offset + annotation.pageIndex,
          })),
        ]
      : loaded!.preservedSourceAnnotations;
    output = await exportPDF(
      bytes!,
      fields,
      { ...loaded!.metadata, title: "Legir corpus benchmark" },
      annotations,
      undefined,
      {
        preservedSourceAnnotations: preserved,
        syncFormFields: false,
        ...(merged
          ? {
              pageStructure: {
                pages: [...originalPages, ...importedPages],
                sources: {
                  "corpus-donor": {
                    bytes: donorBytes!,
                    password: null,
                    filename: "donor.pdf",
                  },
                },
              },
            }
          : {}),
      },
    );
    return { ms: now() - start, bytes: output.byteLength };
  },
  download() {
    const link = document.createElement("a");
    downloadUrl = URL.createObjectURL(
      new Blob([output!.slice()], { type: "application/pdf" }),
    );
    link.href = downloadUrl;
    link.download = "corpus.pdf";
    link.click();
  },
  releaseDownload() {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = undefined;
    output = undefined;
  },
  async stats() {
    return worker && "documentCommand" in worker
      ? worker.documentCommand("documentStats", {})
      : null;
  },
  async close() {
    this.releaseDownload();
    await releaseCanvas();
    opening?.dispose();
    loaded?.dispose();
    donor?.dispose();
    worker?.destroy();
    opening = undefined;
    loaded = undefined;
    donor = undefined;
    worker = undefined;
    bytes = undefined;
    donorBytes = undefined;
    pages = [];
  },
};
Object.assign(globalThis, { pdfCorpus: bench });
