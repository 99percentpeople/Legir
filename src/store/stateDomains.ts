import type {
  DocumentState,
  EditorPreferencesState,
  EditorState,
} from "@/types";

export const preferenceKeys = [
  "options",
  "llmModelCache",
  "penStyle",
  "highlightStyle",
  "commentStyle",
  "freetextStyle",
  "shapeStyle",
  "stampStyle",
  "translateOption",
  "translateTargetLanguage",
  "pageTranslateOptions",
] as const satisfies readonly (keyof EditorPreferencesState)[];

export function pickState<T, K extends keyof T>(
  state: T,
  keys: readonly K[],
): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, state[key]])) as Pick<T, K>;
}

export const documentKeys = [
  "pdfFile",
  "pdfBytes",
  "pdfOpenPassword",
  "exportPassword",
  "metadata",
  "documentPermissions",
  "sourceDocumentPermissions",
  "pdfOwnerUnlocked",
  "pdfOwnerPassword",
  "preservePdfOwnerRestrictionsOnSave",
  "dirtyPermissionScopes",
  "filename",
  "saveTarget",
  "pages",
  "fields",
  "annotations",
  "preservedSourceAnnotations",
  "outline",
  "documentLoadState",
  "documentLoadError",
  "mode",
  "tool",
  "selectedId",
  "scale",
  "viewRotation",
  "isProcessing",
  "past",
  "future",
  "clipboard",
  "pageTranslateParagraphCandidates",
  "pageTranslateSelectedParagraphIds",
  "lastSavedAt",
  "processingStatus",
  "isSaving",
  "isDirty",
  "currentPageIndex",
  "pendingViewStateRestore",
  "fitTrigger",
  "keys",
  "actionSignal",
] as const satisfies readonly (keyof DocumentState)[];

export const pickDocumentState = (state: EditorState): DocumentState =>
  pickState(state, documentKeys);
