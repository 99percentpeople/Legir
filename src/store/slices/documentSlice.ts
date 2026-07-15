import {
  initialState,
  revokeLegacyPageThumbnailObjectUrls,
  revokeThumbnailObjectUrls,
} from "@/store/helpers";
import { prepareAnnotationsForStore } from "@/lib/inkGeometry";
import { normalizeControlLayerOrders } from "@/lib/controlLayerOrder";
import {
  assertPdfPermissionOperation,
  getEffectivePdfPermissions,
  mergePdfPermissionDirtyScopes,
  UNRESTRICTED_PDF_PERMISSIONS,
} from "@/lib/pdfPermissions";
import { cancelThumbnailWarmup } from "@/store/slices/runtimeSlice";
import type { EditorActions, EditorStoreSlice } from "@/store/store.types";
import type { PDFMetadata } from "@/types";

// Document slice owns loading/resetting the active PDF and clearing document-
// scoped runtime caches and history when the source document changes.
export const createDocumentSlice: EditorStoreSlice<
  Pick<
    EditorActions,
    | "loadDocument"
    | "updateMetadata"
    | "unlockPdfOwnerRestrictions"
    | "resetDocument"
  >
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
      metadata: {
        ...data.metadata,
        documentPermissions: data.documentPermissions,
      },
      sourceDocumentPermissions:
        data.sourceDocumentPermissions ?? data.documentPermissions,
      pdfOwnerUnlocked: initialState.pdfOwnerUnlocked,
      pdfOwnerPassword: initialState.pdfOwnerPassword,
      preservePdfOwnerRestrictionsOnSave:
        (data.documentPermissions?.hasOwnerRestrictions ?? false)
          ? true
          : initialState.preservePdfOwnerRestrictionsOnSave,
      fields: normalized.fields,
      annotations: normalized.annotations,
      thumbnailImages: {},
      past: [],
      future: [],
      selectedId: null,
      isDirty: false,
      dirtyPermissionScopes: initialState.dirtyPermissionScopes,
      pageTranslateParagraphCandidates: [],
      pageTranslateSelectedParagraphIds: [],
    });
    get().warmupThumbnails();
  },

  updateMetadata: (updates) => {
    const state = get();
    assertPdfPermissionOperation(
      "edit_document_metadata",
      state.documentPermissions,
    );
    if (Object.keys(updates).length === 0) return;

    const currentMetadata = state.metadata;
    const changed = Object.entries(updates).some(([key, value]) => {
      const typedKey = key as keyof PDFMetadata;
      return currentMetadata[typedKey] !== value;
    });

    if (!changed) return;

    set((state) => ({
      metadata: { ...state.metadata, ...updates },
      isDirty: true,
      dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
        state.dirtyPermissionScopes,
        { modifyContents: true },
      ),
    }));
  },

  unlockPdfOwnerRestrictions: async (password, options) => {
    const store = get();
    const permissions = getEffectivePdfPermissions(store.documentPermissions);
    const sourcePermissions = getEffectivePdfPermissions(
      store.sourceDocumentPermissions ?? store.documentPermissions,
    );
    const preserveOwnerRestrictionsOnSave =
      options?.preserveOwnerRestrictionsOnSave ??
      (store.pdfOwnerUnlocked
        ? store.preservePdfOwnerRestrictionsOnSave
        : true);

    if (!store.pdfBytes) {
      return {
        ok: false,
        status: "no_document",
        unlocked: false,
        permissions,
        sourcePermissions,
        preserveOwnerRestrictionsOnSave,
        reason: "no_document",
      };
    }

    if (store.pdfOwnerUnlocked) {
      if (
        store.preservePdfOwnerRestrictionsOnSave !==
        preserveOwnerRestrictionsOnSave
      ) {
        set((state) => ({
          preservePdfOwnerRestrictionsOnSave: preserveOwnerRestrictionsOnSave,
          isDirty: true,
          dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
            state.dirtyPermissionScopes,
            { modifyContents: true },
          ),
        }));
      }

      return {
        ok: true,
        status: "already_unlocked",
        unlocked: true,
        permissions,
        sourcePermissions,
        preserveOwnerRestrictionsOnSave,
      };
    }

    if (!sourcePermissions.hasOwnerRestrictions) {
      return {
        ok: true,
        status: "not_restricted",
        unlocked: false,
        permissions,
        sourcePermissions,
        preserveOwnerRestrictionsOnSave,
      };
    }

    const { verifyPdfOwnerPassword } =
      await import("@/services/pdfService/lib/owner-password");
    const result = await verifyPdfOwnerPassword(store.pdfBytes, password);
    if (!result.ok) {
      return {
        ok: false,
        status: result.reason,
        unlocked: false,
        permissions,
        sourcePermissions,
        preserveOwnerRestrictionsOnSave,
        reason: result.reason,
      };
    }

    const unlockedPermissions = {
      ...UNRESTRICTED_PDF_PERMISSIONS,
      isEncrypted: permissions.isEncrypted,
    };
    const shouldMarkDirty =
      store.preservePdfOwnerRestrictionsOnSave !==
      preserveOwnerRestrictionsOnSave;

    set((state) => ({
      documentPermissions: unlockedPermissions,
      sourceDocumentPermissions:
        state.sourceDocumentPermissions ?? state.documentPermissions,
      metadata: {
        ...state.metadata,
        documentPermissions: unlockedPermissions,
      },
      pdfOwnerUnlocked: true,
      pdfOwnerPassword: password,
      preservePdfOwnerRestrictionsOnSave: preserveOwnerRestrictionsOnSave,
      ...(shouldMarkDirty
        ? {
            isDirty: true,
            dirtyPermissionScopes: mergePdfPermissionDirtyScopes(
              state.dirtyPermissionScopes,
              { modifyContents: true },
            ),
          }
        : {}),
    }));

    return {
      ok: true,
      status: "unlocked",
      unlocked: true,
      permissions: unlockedPermissions,
      sourcePermissions,
      preserveOwnerRestrictionsOnSave,
    };
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
      documentPermissions: initialState.documentPermissions,
      sourceDocumentPermissions: initialState.sourceDocumentPermissions,
      pdfOwnerUnlocked: initialState.pdfOwnerUnlocked,
      pdfOwnerPassword: initialState.pdfOwnerPassword,
      preservePdfOwnerRestrictionsOnSave:
        initialState.preservePdfOwnerRestrictionsOnSave,
      dirtyPermissionScopes: initialState.dirtyPermissionScopes,
      filename: initialState.filename,
      saveTarget: initialState.saveTarget,
      pages: initialState.pages,
      thumbnailImages: initialState.thumbnailImages,
      fields: initialState.fields,
      annotations: initialState.annotations,
      preservedSourceAnnotations: initialState.preservedSourceAnnotations,
      outline: initialState.outline,
      documentLoadState: initialState.documentLoadState,
      documentLoadError: initialState.documentLoadError,
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
