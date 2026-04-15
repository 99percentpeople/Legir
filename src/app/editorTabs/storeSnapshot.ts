import { normalizeControlLayerOrders } from "@/lib/controlLayerOrder";
import { prepareAnnotationsForStore } from "@/lib/inkGeometry";
import { initialState } from "@/store/helpers";
import { useEditorStore } from "@/store/useEditorStore";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import type {
  Annotation,
  EditorSaveTarget,
  EditorState,
  FormField,
  PDFMetadata,
  PreservedSourceAnnotationRef,
} from "@/types";
import type { EditorTabSnapshot } from "./types";

const WINDOW_ID_FALLBACK = "tab";

const createShallowArrayCopy = <T>(value: T[]) => [...value];

const createPendingViewStateSnapshot = (
  state: EditorState,
  scrollContainer: HTMLElement | null,
) => {
  if (state.pages.length === 0) return null;
  if (!scrollContainer) {
    return state.pendingViewStateRestore
      ? { ...state.pendingViewStateRestore }
      : null;
  }
  return {
    scale: state.scale,
    scrollLeft: scrollContainer.scrollLeft,
    scrollTop: scrollContainer.scrollTop,
  };
};

export const getEditorTabDisplayTitle = (filename: string | null | undefined) =>
  filename?.trim() || "Untitled";

export const getEditorTabSourceKey = (options: {
  saveTarget: EditorSaveTarget | null;
  pdfFile?: File | null;
}) => {
  if (options.saveTarget?.kind === "tauri") {
    return `tauri:${options.saveTarget.path}`;
  }

  if (options.saveTarget?.kind === "web") {
    const saveTargetId = options.saveTarget.id?.trim();
    if (saveTargetId) {
      return `web-file:${saveTargetId}`;
    }

    const handleName = options.saveTarget.handle?.name?.trim();
    return handleName ? `web-handle:${handleName}` : null;
  }

  const file = options.pdfFile;
  if (file) {
    return `web-file:${file.name}:${file.size}:${file.lastModified}`;
  }

  return null;
};

export const createEditorTabId = () =>
  `${WINDOW_ID_FALLBACK}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const createEditorTabSnapshotFromState = (options: {
  state: EditorState;
  scrollContainer: HTMLElement | null;
}): EditorTabSnapshot => {
  const { state } = options;

  return {
    pdfFile: state.pdfFile,
    pdfBytes: state.pdfBytes,
    pdfOpenPassword: state.pdfOpenPassword,
    exportPassword: state.exportPassword,
    metadata: { ...state.metadata },
    filename: state.filename,
    saveTarget: state.saveTarget,
    pages: createShallowArrayCopy(state.pages),
    fields: createShallowArrayCopy(state.fields),
    annotations: createShallowArrayCopy(state.annotations),
    preservedSourceAnnotations: createShallowArrayCopy(
      state.preservedSourceAnnotations,
    ),
    outline: createShallowArrayCopy(state.outline),
    mode: state.mode,
    tool: state.tool,
    penStyle: { ...state.penStyle },
    highlightStyle: state.highlightStyle
      ? { ...state.highlightStyle }
      : undefined,
    commentStyle: state.commentStyle ? { ...state.commentStyle } : undefined,
    freetextStyle: state.freetextStyle ? { ...state.freetextStyle } : undefined,
    shapeStyle: state.shapeStyle ? { ...state.shapeStyle } : undefined,
    selectedId: state.selectedId,
    scale: state.scale,
    past: createShallowArrayCopy(state.past),
    future: createShallowArrayCopy(state.future),
    clipboard: state.clipboard
      ? {
          type: state.clipboard.type,
          data: state.clipboard.data,
        }
      : null,
    translateOption: state.translateOption,
    translateTargetLanguage: state.translateTargetLanguage,
    pageTranslateOptions: { ...state.pageTranslateOptions },
    pageTranslateParagraphCandidates: createShallowArrayCopy(
      state.pageTranslateParagraphCandidates,
    ),
    pageTranslateSelectedParagraphIds: createShallowArrayCopy(
      state.pageTranslateSelectedParagraphIds,
    ),
    lastSavedAt: state.lastSavedAt ? new Date(state.lastSavedAt) : null,
    isPanelFloating: state.isPanelFloating,
    pageLayout: state.pageLayout,
    pageFlow: state.pageFlow,
    isSidebarOpen: state.isSidebarOpen,
    isRightPanelOpen: state.isRightPanelOpen,
    rightPanelTab: state.rightPanelTab,
    rightPanelDockTab: createShallowArrayCopy(state.rightPanelDockTab),
    sidebarTab: state.sidebarTab,
    isDirty: state.isDirty,
    currentPageIndex: state.currentPageIndex,
    pendingViewStateRestore: createPendingViewStateSnapshot(
      state,
      options.scrollContainer,
    ),
    sidebarWidth: state.sidebarWidth,
    rightPanelWidth: state.rightPanelWidth,
    fitTrigger: state.fitTrigger,
  };
};

export const createLoadedEditorTabSnapshot = (options: {
  pdfFile: File | null;
  pdfBytes: Uint8Array;
  pdfOpenPassword: string | null;
  metadata: PDFMetadata;
  filename: string;
  saveTarget: EditorState["saveTarget"] | null;
  pages: EditorState["pages"];
  fields: FormField[];
  annotations: Annotation[];
  preservedSourceAnnotations: PreservedSourceAnnotationRef[];
  outline: EditorState["outline"];
  currentPageIndex?: number;
  pendingViewStateRestore?: EditorState["pendingViewStateRestore"];
}): EditorTabSnapshot => {
  const normalized = normalizeControlLayerOrders(
    options.fields,
    prepareAnnotationsForStore(options.annotations),
  );

  return {
    ...createEditorTabSnapshotFromState({
      state: initialState,
      scrollContainer: null,
    }),
    pdfFile: options.pdfFile,
    pdfBytes: options.pdfBytes,
    pdfOpenPassword: options.pdfOpenPassword,
    exportPassword: options.pdfOpenPassword,
    metadata: { ...options.metadata },
    filename: options.filename,
    saveTarget: options.saveTarget,
    pages: createShallowArrayCopy(options.pages),
    fields: normalized.fields,
    annotations: normalized.annotations,
    preservedSourceAnnotations: createShallowArrayCopy(
      options.preservedSourceAnnotations,
    ),
    outline: createShallowArrayCopy(options.outline),
    currentPageIndex: options.currentPageIndex ?? 0,
    pendingViewStateRestore: options.pendingViewStateRestore
      ? { ...options.pendingViewStateRestore }
      : null,
  };
};

export const restoreEditorTabSnapshot = (
  snapshot: EditorTabSnapshot,
  options?: {
    isFullscreen?: boolean;
    thumbnailImages?: Record<number, string>;
    workerService?: PDFWorkerService;
  },
) => {
  const store = useEditorStore.getState();
  const thumbnailImages = options?.thumbnailImages ?? {};

  store.setState({
    ...snapshot,
    thumbnailImages,
    activeDialog: null,
    actionSignal: null,
    closeConfirmSource: null,
    isFullscreen: options?.isFullscreen ?? store.isFullscreen,
    isProcessing: false,
    isSaving: false,
    keys: { ...initialState.keys },
    llmModelCache: store.llmModelCache,
    options: store.options,
    processingStatus: null,
  });

  if (Object.keys(thumbnailImages).length < snapshot.pages.length) {
    store.warmupThumbnails(options?.workerService);
  }
};
