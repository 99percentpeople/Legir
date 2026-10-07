import type { EditorState, EditorSaveTarget } from "@/types";
import type { EditorViewApi } from "@/store/useEditorView";
import { EMPTY_PDF_PERMISSION_DIRTY_SCOPES } from "@/lib/pdfPermissions";

/** Compare the exported revision, not the active tab or a boolean dirty flag. */
export const isSavedDocumentRevision = (
  current: EditorState,
  saved: EditorState,
) =>
  current.pdfBytes === saved.pdfBytes &&
  current.fields === saved.fields &&
  current.annotations === saved.annotations &&
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
    ...(unchanged
      ? {
          isDirty: false,
          dirtyPermissionScopes: { ...EMPTY_PDF_PERMISSION_DIRTY_SCOPES },
        }
      : {}),
  });
  return unchanged;
};
