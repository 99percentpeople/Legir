import type { EditorState, EditorSaveTarget } from "@/types";
import type { EditorViewApi } from "@/store/useEditorView";
import { EMPTY_PDF_PERMISSION_DIRTY_SCOPES } from "@legir/pdf-model/pdfPermissions";
import { captureDocumentRevision } from "@/store/documentRevision";

/** Compare the exported revision, not the active tab or a boolean dirty flag. */
export const isSavedDocumentRevision = (
  current: EditorState,
  saved: EditorState,
) =>
  current.pdfBytes === saved.pdfBytes &&
  current.pages === saved.pages &&
  current.pageSources === saved.pageSources &&
  current.fields === saved.fields &&
  current.annotations === saved.annotations &&
  current.outline === saved.outline &&
  current.preservedSourceAnnotations === saved.preservedSourceAnnotations &&
  current.metadata === saved.metadata &&
  current.exportPassword === saved.exportPassword &&
  current.pdfOwnerPassword === saved.pdfOwnerPassword &&
  current.preservePdfOwnerRestrictionsOnSave ===
    saved.preservePdfOwnerRestrictionsOnSave &&
  current.options.removeTextUnderFlattenedFreetext ===
    saved.options.removeTextUnderFlattenedFreetext;

export const commitDocumentSaveState = (
  store: EditorViewApi,
  saved: EditorState,
  target: EditorSaveTarget,
  filename: string,
) => {
  const unchanged = isSavedDocumentRevision(store.getState(), saved);
  store.setState({
    saveTarget: target,
    filename,
    lastSavedAt: new Date(),
    // A concurrent edit stays dirty, but undo can still return to this save.
    savedDocumentRevision: captureDocumentRevision(saved),
    ...(unchanged
      ? {
          isDirty: false,
          dirtyPermissionScopes: { ...EMPTY_PDF_PERMISSION_DIRTY_SCOPES },
        }
      : {}),
  });
  return unchanged;
};
