import type { EditorCanvasState } from "@/types";
import type { EditorStore } from "@/store/store.types";

const EMPTY_THUMBNAIL_IMAGES: EditorStore["thumbnailImages"] = {};
const EMPTY_PENDING_VIEW_STATE_RESTORE: EditorStore["pendingViewStateRestore"] =
  null;
const EMPTY_KEYS: EditorStore["keys"] = {
  ctrl: false,
  shift: false,
  alt: false,
  meta: false,
  space: false,
};

// App shell should only observe the broad lifecycle state it actually renders.
export const selectAppShellState = (state: EditorStore) => ({
  setState: state.setState,
  setOptions: state.setOptions,
  resetDocument: state.resetDocument,
  withProcessing: state.withProcessing,
  isProcessing: state.isProcessing,
  processingStatus: state.processingStatus,
  activeDialog: state.activeDialog,
  options: state.options,
});

// EditorPage shell does not need viewport-scale hot state. Masking these fields
// keeps zoom/pan updates scoped to the workspace subtree instead of rerendering
// the full page chrome.
export const selectEditorPageShellState = (
  state: EditorStore,
): EditorStore => ({
  ...state,
  keys: EMPTY_KEYS,
  thumbnailImages: EMPTY_THUMBNAIL_IMAGES,
  scale: 1,
  pageLayout: "single",
  pageFlow: "vertical",
  fitTrigger: 0,
  pendingViewStateRestore: EMPTY_PENDING_VIEW_STATE_RESTORE,
  isFullscreen: false,
});

// Canvas rendering and zoom controls should only observe workspace-hot fields.
// This keeps AI/session/sidebar churn from invalidating the PDF viewport.
export const selectEditorCanvasState = (
  state: EditorStore,
): EditorCanvasState => ({
  annotations: state.annotations,
  commentStyle: state.commentStyle,
  currentPageIndex: state.currentPageIndex,
  fields: state.fields,
  filename: state.filename,
  fitTrigger: state.fitTrigger,
  freetextStyle: state.freetextStyle,
  highlightStyle: state.highlightStyle,
  isFullscreen: state.isFullscreen,
  keys: state.keys,
  mode: state.mode,
  options: state.options,
  pageFlow: state.pageFlow,
  pageLayout: state.pageLayout,
  pages: state.pages,
  pageTranslateOptions: state.pageTranslateOptions,
  pageTranslateParagraphCandidates: state.pageTranslateParagraphCandidates,
  pageTranslateSelectedParagraphIds: state.pageTranslateSelectedParagraphIds,
  pdfBytes: state.pdfBytes,
  penStyle: state.penStyle,
  pendingViewStateRestore: state.pendingViewStateRestore,
  shapeStyle: state.shapeStyle,
  scale: state.scale,
  selectedId: state.selectedId,
  tool: state.tool,
});

export const selectEditorCanvasActions = (state: EditorStore) => ({
  addAnnotation: state.addAnnotation,
  addField: state.addField,
  deleteAnnotation: state.deleteAnnotation,
  reorderControlLayer: state.reorderControlLayer,
  resetFieldToDefault: state.resetFieldToDefault,
  saveCheckpoint: state.saveCheckpoint,
  selectControl: state.selectControl,
  selectPageTranslateParagraphId: state.selectPageTranslateParagraphId,
  setSelectedPageTranslateParagraphIds:
    state.setSelectedPageTranslateParagraphIds,
  setState: state.setState,
  setTool: state.setTool,
  updateAnnotation: state.updateAnnotation,
  updateField: state.updateField,
});

export const selectPropertiesPanelState = (state: EditorStore) => ({
  exportPassword: state.exportPassword,
  pdfOpenPassword: state.pdfOpenPassword,
  setEditorState: state.setState,
});

export const selectTranslationFloatingWindowState = (state: EditorStore) => ({
  translateOptionRaw: state.translateOption,
  translateTargetLanguage: state.translateTargetLanguage,
  setState: state.setState,
});
