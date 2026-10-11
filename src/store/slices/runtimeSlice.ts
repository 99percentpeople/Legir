import { pdfWorkerService } from "@/services/pdfService/pdfWorkerService";
import { createDocumentThumbnails } from "@/store/documentThumbnails";
import type { EditorStoreSlice } from "@/store/store.types";

export const createRuntimeSlice: EditorStoreSlice<
  Pick<
    import("@/store/store.types").EditorActions,
    | "withProcessing"
    | "setProcessingStatus"
    | "warmupThumbnails"
    | "cancelThumbnailWarmup"
    | "deferThumbnailWarmup"
    | "refreshThumbnails"
    | "setThumbnailViewport"
    | "removeThumbnailViewport"
    | "holdThumbnailImages"
  >
> = (set, get) => {
  const thumbnails = createDocumentThumbnails(set, get);
  const processingTasks = new Map<symbol, string | null>();
  return {
    cancelThumbnailWarmup: thumbnails.cancel,
    deferThumbnailWarmup: thumbnails.defer,
    refreshThumbnails: thumbnails.changed,
    setThumbnailViewport: thumbnails.setViewport,
    removeThumbnailViewport: thumbnails.removeViewport,
    holdThumbnailImages: thumbnails.holdImages,
    warmupThumbnails: (worker) => thumbnails.warmup(worker ?? pdfWorkerService),
    withProcessing: async (status, fn) => {
      const token = Symbol();
      processingTasks.set(token, status ?? null);

      set({
        isProcessing: true,
        processingStatus: status ?? null,
      });

      try {
        return await fn();
      } finally {
        processingTasks.delete(token);
        set({
          isProcessing: processingTasks.size > 0,
          processingStatus: Array.from(processingTasks.values()).at(-1) ?? null,
        });
      }
    },

    setProcessingStatus: (status) => set({ processingStatus: status }),
  };
};
