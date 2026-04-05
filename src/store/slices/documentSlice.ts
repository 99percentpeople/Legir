import {
  initialState,
  revokeLegacyPageThumbnailObjectUrls,
  revokeThumbnailObjectUrls,
} from "@/store/helpers";
import { prepareAnnotationsForStore } from "@/lib/inkGeometry";
import { normalizeControlLayerOrders } from "@/lib/controlLayerOrder";
import { cancelThumbnailWarmup } from "@/store/slices/runtimeSlice";
import type { EditorActions, EditorStoreSlice } from "@/store/store.types";

// Document slice owns loading/resetting the active PDF and clearing document-
// scoped runtime caches and history when the source document changes.
export const createDocumentSlice: EditorStoreSlice<
  Pick<EditorActions, "loadDocument" | "resetDocument">
> = (set, get) => ({
  loadDocument: (data) => {
    // Replacing a document invalidates thumbnail caches and edit history.
    revokeThumbnailObjectUrls(get().thumbnailImages);
    revokeLegacyPageThumbnailObjectUrls(get().pages);
    const normalized = normalizeControlLayerOrders(
      data.fields,
      prepareAnnotationsForStore(data.annotations),
    );
    set({
      ...data,
      fields: normalized.fields,
      annotations: normalized.annotations,
      thumbnailImages: {},
      past: [],
      future: [],
      selectedId: null,
      isDirty: false,
      pageTranslateParagraphCandidates: [],
      pageTranslateSelectedParagraphIds: [],
    });
    get().warmupThumbnails();
  },

  resetDocument: () => {
    cancelThumbnailWarmup();
    revokeThumbnailObjectUrls(get().thumbnailImages);
    revokeLegacyPageThumbnailObjectUrls(get().pages);

    set(() => ({
      pdfFile: initialState.pdfFile,
      pdfBytes: initialState.pdfBytes,
      pdfOpenPassword: initialState.pdfOpenPassword,
      exportPassword: initialState.exportPassword,
      metadata: initialState.metadata,
      filename: initialState.filename,
      saveTarget: initialState.saveTarget,
      pages: initialState.pages,
      thumbnailImages: initialState.thumbnailImages,
      fields: initialState.fields,
      annotations: initialState.annotations,
      preservedSourceAnnotations: initialState.preservedSourceAnnotations,
      outline: initialState.outline,
      selectedId: initialState.selectedId,
      scale: initialState.scale,
      mode: initialState.mode,
      tool: initialState.tool,
      past: initialState.past,
      future: initialState.future,
      clipboard: initialState.clipboard,
      isProcessing: initialState.isProcessing,
      processingStatus: initialState.processingStatus,
      isSaving: initialState.isSaving,
      lastSavedAt: initialState.lastSavedAt,
      isDirty: initialState.isDirty,
      currentPageIndex: initialState.currentPageIndex,
      pendingViewStateRestore: initialState.pendingViewStateRestore,
      fitTrigger: initialState.fitTrigger,
      keys: { ...initialState.keys },
      activeDialog: initialState.activeDialog,
      closeConfirmSource: initialState.closeConfirmSource,
      pageTranslateParagraphCandidates:
        initialState.pageTranslateParagraphCandidates,
      pageTranslateSelectedParagraphIds:
        initialState.pageTranslateSelectedParagraphIds,
    }));
  },
});
