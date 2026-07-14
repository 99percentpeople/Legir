import type { EditorCanvasState, EditorState } from "@/types";
import type { EditorStore } from "@/store/store.types";

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

export const selectEditorPageState = (state: EditorStore) => ({
  filename: state.filename,
  pages: state.pages,
  pdfBytes: state.pdfBytes,
  documentPermissions: state.documentPermissions,
  selectedId: state.selectedId,
  hasSelectedControl: state.selectedId
    ? state.fields.some((field) => field.id === state.selectedId) ||
      state.annotations.some((annotation) => annotation.id === state.selectedId)
    : false,
  isPanelFloating: state.isPanelFloating,
  isSidebarOpen: state.isSidebarOpen,
  isRightPanelOpen: state.isRightPanelOpen,
  rightPanelTab: state.rightPanelTab,
  rightPanelDockTab: state.rightPanelDockTab,
  rightPanelWidth: state.rightPanelWidth,
  setState: state.setState,
  setUiState: state.setUiState,
  setTool: state.setTool,
  selectControl: state.selectControl,
});

export type AiChatEditorState = Pick<
  EditorState,
  | "currentPageIndex"
  | "documentPermissions"
  | "filename"
  | "llmModelCache"
  | "metadata"
  | "options"
  | "outline"
  | "pageFlow"
  | "pageLayout"
  | "pages"
  | "pdfBytes"
  | "pdfOpenPassword"
  | "pdfOwnerUnlocked"
  | "preservePdfOwnerRestrictionsOnSave"
  | "scale"
  | "sourceDocumentPermissions"
>;

export const selectAiChatEditorState = (
  state: EditorStore,
): AiChatEditorState => ({
  currentPageIndex: state.currentPageIndex,
  documentPermissions: state.documentPermissions,
  filename: state.filename,
  llmModelCache: state.llmModelCache,
  metadata: state.metadata,
  options: state.options,
  outline: state.outline,
  pageFlow: state.pageFlow,
  pageLayout: state.pageLayout,
  pages: state.pages,
  pdfBytes: state.pdfBytes,
  pdfOpenPassword: state.pdfOpenPassword,
  pdfOwnerUnlocked: state.pdfOwnerUnlocked,
  preservePdfOwnerRestrictionsOnSave: state.preservePdfOwnerRestrictionsOnSave,
  scale: state.scale,
  sourceDocumentPermissions: state.sourceDocumentPermissions,
});

export const selectPdfSearchControllerState = (state: EditorStore) => ({
  pages: state.pages,
  isSidebarOpen: state.isSidebarOpen,
  setUiState: state.setUiState,
});

// Canvas rendering and zoom controls should only observe workspace-hot fields.
// This keeps AI/session/sidebar churn from invalidating the PDF viewport.
export const selectEditorCanvasState = (
  state: EditorStore,
): EditorCanvasState => ({
  annotations: state.annotations,
  commentStyle: state.commentStyle,
  currentPageIndex: state.currentPageIndex,
  documentPermissions: state.documentPermissions,
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
  stampStyle: state.stampStyle,
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

export const selectToolbarState = (state: EditorStore) => ({
  mode: state.mode,
  tool: state.tool,
  isDirty: state.isDirty,
  canUndo: state.past.length > 0,
  canRedo: state.future.length > 0,
  hasPages: state.pages.length > 0,
  documentPermissions: state.documentPermissions,
  sourceDocumentPermissions: state.sourceDocumentPermissions,
  pdfOwnerUnlocked: state.pdfOwnerUnlocked,
  penStyle: state.penStyle,
  highlightStyle: state.highlightStyle,
  commentStyle: state.commentStyle,
  freetextStyle: state.freetextStyle,
  shapeStyle: state.shapeStyle,
  stampStyle: state.stampStyle,
  isSidebarOpen: state.isSidebarOpen,
  isRightPanelOpen: state.isRightPanelOpen,
  isPanelFloating: state.isPanelFloating,
  scale: state.scale,
  pageLayout: state.pageLayout,
  pageFlow: state.pageFlow,
  isFullscreen: state.isFullscreen,
  setState: state.setState,
  setTool: state.setTool,
  undo: state.undo,
  redo: state.redo,
  openDialog: state.openDialog,
});

export const selectSidebarState = (state: EditorStore) => ({
  isOpen: state.isSidebarOpen,
  isFloating: state.isPanelFloating,
  pages: state.pages,
  fields: state.fields,
  annotations: state.annotations,
  documentPermissions: state.documentPermissions,
  outline: state.outline,
  selectedId: state.selectedId,
  currentPageIndex: state.currentPageIndex,
  thumbnailsLayout: state.options.thumbnailsLayout,
  sidebarTab: state.sidebarTab,
  width: state.sidebarWidth,
  setUiState: state.setUiState,
  selectControl: state.selectControl,
  deleteAnnotation: state.deleteAnnotation,
  updateAnnotation: state.updateAnnotation,
  addAnnotationReply: state.addAnnotationReply,
  updateAnnotationReply: state.updateAnnotationReply,
  deleteAnnotationReply: state.deleteAnnotationReply,
});

export const selectEditorRightPanelState = (state: EditorStore) => ({
  mode: state.mode,
  rightPanelTab: state.rightPanelTab,
  isPanelFloating: state.isPanelFloating,
  isRightPanelOpen: state.isRightPanelOpen,
  rightPanelWidth: state.rightPanelWidth,
  selectedId: state.selectedId,
  fields: state.fields,
  annotations: state.annotations,
  metadata: state.metadata,
  filename: state.filename,
  pagesLength: state.pages.length,
  pageTranslateOptions: state.pageTranslateOptions,
  pageTranslateParagraphCandidates: state.pageTranslateParagraphCandidates,
  pageTranslateSelectedParagraphIds: state.pageTranslateSelectedParagraphIds,
  translateOption: state.translateOption,
  translateTargetLanguage: state.translateTargetLanguage,
  documentPermissions: state.documentPermissions,
  setState: state.setState,
  setUiState: state.setUiState,
  selectControl: state.selectControl,
  deleteSelection: state.deleteSelection,
  saveCheckpoint: state.saveCheckpoint,
  updateField: state.updateField,
  updateAnnotation: state.updateAnnotation,
  updateMetadata: state.updateMetadata,
  clearPageTranslateParagraphCandidates:
    state.clearPageTranslateParagraphCandidates,
  mergeSelectedPageTranslateParagraphs:
    state.mergeSelectedPageTranslateParagraphs,
  toggleExcludeSelectedPageTranslateParagraphs:
    state.toggleExcludeSelectedPageTranslateParagraphs,
  deleteSelectedPageTranslateParagraphs:
    state.deleteSelectedPageTranslateParagraphs,
  setAllFreetextFlatten: state.setAllFreetextFlatten,
});

export const selectPropertiesPanelState = (state: EditorStore) => ({
  exportPassword: state.exportPassword,
  pdfOpenPassword: state.pdfOpenPassword,
  documentPermissions: state.documentPermissions,
  sourceDocumentPermissions: state.sourceDocumentPermissions,
  pdfOwnerUnlocked: state.pdfOwnerUnlocked,
  preservePdfOwnerRestrictionsOnSave: state.preservePdfOwnerRestrictionsOnSave,
  unlockPdfOwnerRestrictions: state.unlockPdfOwnerRestrictions,
  setEditorState: state.setState,
});

export const selectTranslationFloatingWindowState = (state: EditorStore) => ({
  translateOptionRaw: state.translateOption,
  translateTargetLanguage: state.translateTargetLanguage,
  setState: state.setState,
});
