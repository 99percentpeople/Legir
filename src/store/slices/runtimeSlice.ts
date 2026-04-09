import {
  THUMBNAIL_JPEG_QUALITY,
  THUMBNAIL_MIME_TYPE,
  THUMBNAIL_TARGET_WIDTH,
  THUMBNAIL_WARMUP_PRIORITY,
} from "@/constants";
import { pdfWorkerService } from "@/services/pdfService/pdfWorkerService";
import { revokeObjectUrlIfNeeded } from "@/store/helpers";
import type { EditorStoreSlice } from "@/store/store.types";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";

// Thumbnail warmup lives outside the store state on purpose: it is ephemeral
// runtime control, not app state we want to persist or diff.
let thumbnailWarmupEpoch = 0;
let thumbnailWarmupAbort: AbortController | null = null;
let processingDepth = 0;
const processingStatusStack: Array<string | null> = [];

export const cancelThumbnailWarmup = () => {
  thumbnailWarmupEpoch += 1;
  thumbnailWarmupAbort?.abort();
  thumbnailWarmupAbort = null;
};

export const createRuntimeSlice: EditorStoreSlice<
  Pick<
    import("@/store/store.types").EditorActions,
    "withProcessing" | "setProcessingStatus" | "warmupThumbnails"
  >
> = (set, get) => ({
  withProcessing: async (status, fn) => {
    const prevStatus = get().processingStatus;
    processingDepth += 1;
    processingStatusStack.push(prevStatus);

    set({
      isProcessing: true,
      processingStatus: status ?? null,
    });

    try {
      return await fn();
    } finally {
      processingDepth = Math.max(0, processingDepth - 1);
      const restore = processingStatusStack.pop() ?? null;
      if (processingDepth === 0) {
        set({ isProcessing: false, processingStatus: null });
      } else {
        set({ isProcessing: true, processingStatus: restore });
      }
    }
  },

  setProcessingStatus: (status) => set({ processingStatus: status }),

  warmupThumbnails: (workerService?: PDFWorkerService) => {
    const { pdfBytes, pdfOpenPassword } = get();
    if (!pdfBytes || pdfBytes.byteLength === 0) return;
    const runtimeWorkerService = workerService ?? pdfWorkerService;

    cancelThumbnailWarmup();
    const epoch = thumbnailWarmupEpoch;
    thumbnailWarmupAbort = new AbortController();
    const { signal } = thumbnailWarmupAbort;

    void (async () => {
      let workerLoaded = false;
      const ensureWorkerLoaded = async () => {
        if (workerLoaded) return;
        await runtimeWorkerService.loadDocument(pdfBytes, {
          signal,
          password:
            typeof pdfOpenPassword === "string" ? pdfOpenPassword : undefined,
        });
        workerLoaded = true;
      };

      for (let pageIndex = 0; ; pageIndex++) {
        if (signal.aborted) return;
        if (thumbnailWarmupEpoch !== epoch) return;

        const state = get();
        if (pageIndex >= state.pages.length) return;
        const page = state.pages[pageIndex];
        if (!page || state.thumbnailImages[pageIndex]) continue;

        try {
          let bytes: Uint8Array;
          let mimeType: string;
          try {
            ({ bytes, mimeType } = await runtimeWorkerService.renderPageImage({
              pageIndex,
              targetWidth: THUMBNAIL_TARGET_WIDTH,
              mimeType: THUMBNAIL_MIME_TYPE,
              quality: THUMBNAIL_JPEG_QUALITY,
              renderAnnotations: true,
              priority: THUMBNAIL_WARMUP_PRIORITY,
              signal,
            }));
          } catch (error: unknown) {
            const message =
              typeof (error as { message?: unknown })?.message === "string"
                ? String((error as { message: string }).message)
                : String(error);
            if (message.includes("PDF Document not loaded")) {
              await ensureWorkerLoaded();
              ({ bytes, mimeType } = await runtimeWorkerService.renderPageImage(
                {
                  pageIndex,
                  targetWidth: THUMBNAIL_TARGET_WIDTH,
                  mimeType: THUMBNAIL_MIME_TYPE,
                  quality: THUMBNAIL_JPEG_QUALITY,
                  priority: THUMBNAIL_WARMUP_PRIORITY,
                  signal,
                },
              ));
            } else {
              throw error;
            }
          }

          if (signal.aborted) return;
          if (!bytes || bytes.byteLength === 0) continue;

          const objectUrl = URL.createObjectURL(
            new Blob([new Uint8Array(bytes)], { type: mimeType }),
          );

          if (signal.aborted || thumbnailWarmupEpoch !== epoch) {
            revokeObjectUrlIfNeeded(objectUrl);
            return;
          }

          let didSet = false;

          set((store) => {
            if (!store.pages[pageIndex] || store.thumbnailImages[pageIndex]) {
              return {};
            }
            didSet = true;
            return {
              thumbnailImages: {
                ...store.thumbnailImages,
                [pageIndex]: objectUrl,
              },
            };
          });

          if (!didSet) {
            revokeObjectUrlIfNeeded(objectUrl);
          }
        } catch {
          // Thumbnail warmup is opportunistic; a failed page should not block the editor.
        }

        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    })();
  },
});
