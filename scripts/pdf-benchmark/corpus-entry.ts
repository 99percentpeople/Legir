import * as pdfService from "@/services/pdfService";
import { startPdfOpenSession, loadPDF, exportPDF } from "@/services/pdfService";
import { createPdfWorkerService } from "@/services/pdfService/pdfWorkerService";
import type { PageData } from "@/types";
import { renderPdfPreviewDataUrl } from "@/services/recentFilePreview";

// This identical entry is compiled against each revision's production services.
// It deliberately does not import, patch, or call an engine directly.
let worker: ReturnType<typeof createPdfWorkerService> | undefined;
let opening: ReturnType<typeof startPdfOpenSession> | undefined;
let loaded: Awaited<ReturnType<typeof loadPDF>> | undefined;
let donor: Awaited<ReturnType<typeof loadPDF>> | undefined;
let bytes: Uint8Array | undefined;
let donorBytes: Uint8Array | undefined;
let output: Uint8Array | Blob | undefined;
let selectedDonorPages: number[] | undefined;
let compactDonor = false;
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
  async png(pageIndex: number, capture = false) {
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
      url: capture
        ? await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(
              new Blob([result.bytes.slice()], { type: "image/png" }),
            );
          })
        : undefined,
    };
  },
  async importSource(selection?: number[]) {
    const start = now();
    const nativePreview = "supportsImportPreview" in worker!;
    const preview = nativePreview ? worker! : createPdfWorkerService();
    let readableMs = 0;
    if (nativePreview) {
      const opening = startPdfOpenSession(donorBytes!, {
        workerService: preview,
        importId: "corpus-donor",
      });
      const readable = await opening.readable;
      readableMs = now() - start;
      selectedDonorPages = selection ?? readable.pages.map((_, i) => i);
      donor = await opening.hydrate(selectedDonorPages);
    } else {
      try {
        donor = await loadPDF(donorBytes!, { workerService: preview });
      } finally {
        preview.destroy();
      }
      readableMs = now() - start;
      selectedDonorPages = selection ?? donor.pages.map((_, i) => i);
    }
    const parseMs = now() - start;
    if (nativePreview)
      await worker!.documentCommand("commitImport", {
        docId: "corpus-donor",
        pageIndexes: selectedDonorPages,
      });
    else await worker!.loadDocument(donorBytes!, { docId: "corpus-donor" });
    compactDonor = nativePreview;
    const ms = now() - start;
    return {
      ms,
      readableMs,
      parseMs,
      registerMs: ms - parseMs,
      pages: donor!.pages.length,
      selectedPages: selectedDonorPages,
      nativePreview,
    };
  },
  async save(merged = false, includePreview = false, signal?: AbortSignal) {
    const start = now();
    const originalPages = loaded!.pages.map((page, index) => ({
      ...page,
      id: `original-${index}`,
      source: { documentId: "default", pageIndex: index },
    }));
    const importedPages =
      donor?.pages
        .filter((page) => selectedDonorPages?.includes(page.pageIndex))
        .map((page, index) => ({
          ...page,
          id: `donor-${index}`,
          pageIndex: originalPages.length + index,
          source: {
            documentId: "corpus-donor",
            pageIndex: compactDonor ? index : page.pageIndex,
          },
        })) ?? [];
    // Match pageEditingSlice's append semantics: imported controls and link
    // targets move with the pages. Omitting these models requests their deletion.
    const offset = originalPages.length;
    const importedIndex = (index: number) => {
      const selected = selectedDonorPages?.indexOf(index) ?? -1;
      return selected < 0 ? undefined : offset + selected;
    };
    const annotations = merged
      ? [
          ...loaded!.annotations,
          ...donor!.annotations
            .filter((a) => importedIndex(a.pageIndex) !== undefined)
            .map((annotation) => ({
              ...annotation,
              id: `donor-${annotation.id}`,
              pageIndex: importedIndex(annotation.pageIndex)!,
              linkDestPageIndex:
                annotation.linkDestPageIndex === undefined
                  ? undefined
                  : importedIndex(annotation.linkDestPageIndex),
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
          ...donor!.fields
            .filter((f) => importedIndex(f.pageIndex) !== undefined)
            .map((field) => ({
              ...field,
              id: `donor-${field.id}`,
              pageIndex: importedIndex(field.pageIndex)!,
            })),
        ]
      : loaded!.fields;
    const preserved = merged
      ? [
          ...loaded!.preservedSourceAnnotations,
          ...donor!.preservedSourceAnnotations
            .filter((a) => importedIndex(a.pageIndex) !== undefined)
            .map((annotation) => ({
              ...annotation,
              pageIndex: importedIndex(annotation.pageIndex)!,
            })),
        ]
      : loaded!.preservedSourceAnnotations;
    const save =
      "exportPDFBlob" in pdfService ? pdfService.exportPDFBlob : exportPDF;
    output = await save(
      bytes!,
      fields,
      { ...loaded!.metadata, title: "Legir corpus benchmark" },
      annotations,
      undefined,
      {
        includePreview,
        signal,
        preservedSourceAnnotations: preserved,
        syncFormFields: true,
        ...(merged
          ? {
              pageStructure: {
                pages: [...originalPages, ...importedPages],
                sources: {
                  "corpus-donor": {
                    bytes: donorBytes!,
                    password: null,
                    filename: "donor.pdf",
                    pageIndexes: compactDonor ? selectedDonorPages : undefined,
                  },
                },
              },
            }
          : { pageStructure: { pages: originalPages, sources: {} } }),
      },
    );
    return {
      ms: now() - start,
      bytes: output instanceof Blob ? output.size : output.byteLength,
      blob: output instanceof Blob,
    };
  },
  async cancelExport(
    delayMs = 20,
    mode: "full" | "incremental" | "prefix" | "merged" = "full",
  ) {
    if (!("exportPDFBlob" in pdfService)) return { supported: false };
    const controller = new AbortController();
    const start = now();
    let abortedAt = 0;
    const abort = () => {
      abortedAt = now();
      controller.abort();
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const command = worker!.documentCommand;
    let prefixReached = false;
    if (mode === "prefix") {
      // Diagnostic-only checkpoint: abort after the native delta has returned,
      // while the public service constructs its cancellable original Blob.
      worker!.documentCommand = (async (
        ...args: Parameters<typeof command>
      ) => {
        const result = await command.apply(worker, args);
        if (args[0] === "exportDocumentBlob") {
          prefixReached = !!(result as { incremental?: boolean }).incremental;
          timer = setTimeout(abort, delayMs);
        }
        return result;
      }) as typeof command;
    } else timer = setTimeout(abort, delayMs);
    let aborted = false;
    try {
      if (mode === "merged") await this.save(true, false, controller.signal);
      else
        await pdfService.exportPDFBlob(
          bytes!,
          loaded!.fields,
          loaded!.metadata,
          loaded!.annotations,
          undefined,
          {
            preservedSourceAnnotations: loaded!.preservedSourceAnnotations,
            signal: controller.signal,
            incremental: mode !== "full",
          },
        );
    } catch (error) {
      if ((error as Error).name !== "AbortError") throw error;
      aborted = true;
    } finally {
      clearTimeout(timer);
      worker!.documentCommand = command;
    }
    const rejectedAt = now();
    const stats = await worker!.documentCommand("documentStats", {});
    return {
      supported: true,
      mode,
      prefixReached,
      aborted,
      abortAfterMs: abortedAt - start,
      rejectionMs: rejectedAt - abortedAt,
      workerReadyMs: now() - abortedAt,
      stats,
    };
  },
  async previewProbe() {
    if (!("exportPDFBlob" in pdfService))
      throw new Error("Requires Blob export");
    if (!loaded!.fields.some((field) => typeof field.value === "string"))
      throw new Error("Preview probe needs a text-field fixture");
    const settings = {
      pageIndex: 0,
      targetWidth: 240,
      renderAnnotations: true,
      mimeType: "image/jpeg",
      quality: 0.8,
    };
    const original = await worker!.renderPageImage(settings);
    output = await pdfService.exportPDFBlob(
      bytes!,
      loaded!.fields.map((field) =>
        typeof field.value === "string"
          ? { ...field, value: "Saved preview revision" }
          : field,
      ),
      loaded!.metadata,
      loaded!.annotations,
      undefined,
      {
        preservedSourceAnnotations: loaded!.preservedSourceAnnotations,
        includePreview: true,
      },
    );
    const dataUrl = await renderPdfPreviewDataUrl({ pdfBytes: output });
    if (!dataUrl) throw new Error("No saved preview");
    const preview = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
    const verifier = createPdfWorkerService();
    try {
      await verifier.loadDocument(new Uint8Array(await output.arrayBuffer()));
      const reopened = await verifier.renderPageImage(settings);
      const equal = (a: Uint8Array, b: Uint8Array) =>
        a.length === b.length && a.every((x, i) => x === b[i]);
      return {
        matchesReopened: equal(preview, reopened.bytes),
        differsFromOriginal: !equal(preview, original.bytes),
        previewBytes: preview.length,
      };
    } finally {
      verifier.destroy();
    }
  },
  download() {
    const link = document.createElement("a");
    downloadUrl = URL.createObjectURL(
      output instanceof Blob
        ? output
        : new Blob([output! as BlobPart], { type: "application/pdf" }),
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
