import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  EditorState,
  EditorUiState,
  FormField,
  Annotation,
  PageData,
  PDFMetadata,
  PDFOutlineItem,
  Tool,
  HistorySnapshot,
  DialogName,
  FieldType,
  EditorOptions,
} from "../types";
import {
  ANNOTATION_STYLES,
  DEFAULT_EDITOR_UI_STATE,
  THUMBNAIL_JPEG_QUALITY,
  THUMBNAIL_MIME_TYPE,
  THUMBNAIL_TARGET_WIDTH,
  THUMBNAIL_WARMUP_PRIORITY,
} from "../constants";
import { shouldSwitchToSelectAfterUse } from "../lib/tool-behavior";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { pdfWorkerService } from "../services/pdfService/pdfWorkerService";

let thumbnailWarmupEpoch = 0;
let thumbnailWarmupAbort: AbortController | null = null;

const revokeObjectUrlIfNeeded = (url: string | undefined | null) => {
  if (!url) return;
  if (!url.startsWith("blob:")) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // ignore
  }
};

const revokeThumbnailObjectUrls = (pages: PageData[]) => {
  for (const p of pages) {
    revokeObjectUrlIfNeeded(p.imageData);
  }
};

// Editor store = single source of truth (SSOT) for the editor.
//
// This store intentionally contains BOTH:
// - Document state: `pdfBytes/pages/fields/annotations/metadata/...`
// - UI state: sidebar/panels, tool selection, dialogs, etc.
//
// Persistence policy:
// - Only UI-related state is persisted to localStorage (see `partialize()` below).
// - Large/binary document data must NOT be persisted here.
//   Web drafts are handled by `services/storageService.ts` (IndexedDB).
//
// Extension guidance:
// - Adding a new Tool/FieldType usually means updating `types.ts` AND the reducers here
//   (e.g. selection rules, history snapshot scope).
// - If you add new editor UI state, decide whether it should be persisted in `pickEditorUiState()`.

// Define the Actions interface
export interface EditorActions {
  // Generic Setter (for gradual migration)
  setState: (
    updates:
      | Partial<EditorState>
      | ((prev: EditorState) => Partial<EditorState>),
  ) => void;

  withProcessing: <T>(
    status: string | null | undefined,
    fn: () => Promise<T>,
  ) => Promise<T>;
  setProcessingStatus: (status: string | null) => void;

  setUiState: (
    updates:
      | Partial<EditorUiState>
      | ((prev: EditorState) => Partial<EditorUiState>),
  ) => void;

  resetUiState: () => void;

  setOptions: (
    updates:
      | Partial<EditorOptions>
      | ((prev: EditorOptions) => Partial<EditorOptions>),
  ) => void;

  getPageCached: (pageIndex: number) => Promise<PDFPageProxy>;

  warmupThumbnails: () => void;

  // Complex Actions
  loadDocument: (data: {
    pdfFile: File | null;
    pdfBytes: Uint8Array;
    pdfDocument: PDFDocumentProxy;
    pages: PageData[];
    fields: FormField[];
    annotations: Annotation[];
    outline: PDFOutlineItem[];
    metadata: PDFMetadata;
    filename: string;
    scale: number;
    saveTarget: EditorState["saveTarget"] | null;
  }) => void;

  addField: (field: FormField) => void;
  updateField: (id: string, updates: Partial<FormField>) => void;
  moveField: (
    direction: "UP" | "DOWN" | "LEFT" | "RIGHT",
    isFast?: boolean,
  ) => void;

  addAnnotation: (annotation: Annotation) => void;
  updateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  deleteAnnotation: (id: string) => void;

  deleteSelection: () => void;

  selectControl: (id: string | null) => void;
  setTool: (tool: Tool) => void;

  saveCheckpoint: () => void;
  undo: () => void;
  redo: () => void;

  openDialog: (name: DialogName) => void;
  closeDialog: () => void;

  setKeys: (keys: Partial<EditorState["keys"]>) => void;

  resetDocument: () => void;
}

export type EditorStore = EditorState & EditorActions;

function pickEditorUiState(state: EditorState): EditorUiState {
  return {
    isSidebarOpen: state.isSidebarOpen,
    isRightPanelOpen: state.isRightPanelOpen,
    rightPanelTab: state.rightPanelTab,
    sidebarTab: state.sidebarTab,
    pageLayout: state.pageLayout,
    pageFlow: state.pageFlow,
    sidebarWidth: state.sidebarWidth,
    rightPanelWidth: state.rightPanelWidth,
    translateOption: state.translateOption,
  };
}

// Initial State
const initialState: EditorState = {
  pdfFile: null,
  pdfBytes: null,
  pdfDocument: null,
  pageCache: new Map(),
  metadata: {},
  filename: "document.pdf",
  saveTarget: null,
  pages: [],
  fields: [],
  annotations: [],
  outline: [],
  selectedId: null,
  scale: 1.0,
  mode: "annotation",
  tool: "select",
  penStyle: {
    color: ANNOTATION_STYLES.ink.color,
    thickness: ANNOTATION_STYLES.ink.thickness,
    opacity: ANNOTATION_STYLES.ink.opacity,
  },
  highlightStyle: {
    color: ANNOTATION_STYLES.highlight.color,
    thickness: ANNOTATION_STYLES.highlight.thickness,
    opacity: ANNOTATION_STYLES.highlight.opacity,
  },
  commentStyle: {
    color: ANNOTATION_STYLES.comment.color,
    opacity: ANNOTATION_STYLES.comment.opacity,
  },
  freetextStyle: {
    color: ANNOTATION_STYLES.freetext.color,
    size: ANNOTATION_STYLES.freetext.size,
  },
  isProcessing: false,
  past: [],
  future: [],
  clipboard: null,
  options: {
    snappingOptions: {
      enabled: true,
      snapToBorders: true,
      snapToCenter: true,
      snapToEqualDistances: false,
      threshold: 8,
    },
    debugOptions: {
      pdfTextLayer: false,
    },
  },
  translateOption: "gemini:gemini-2.5-flash",
  lastSavedAt: null,
  processingStatus: null,
  isPanelFloating: false,
  isSaving: false,
  ...DEFAULT_EDITOR_UI_STATE,
  pageLayout: "single",
  pageFlow: "vertical",
  isFullscreen: false,
  hasSavedSession: false,
  isDirty: false,
  currentPageIndex: 0,
  pendingViewStateRestore: null,
  fitTrigger: 0,
  keys: {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    space: false,
  },
  activeDialog: null,
  closeConfirmSource: null,
  actionSignal: null, // Deprecated, but kept for interface compatibility
};

let processingDepth = 0;
const processingStatusStack: Array<string | null> = [];

export const useEditorStore = create<EditorState & EditorActions>()(
  persist(
    (set, get) => ({
      ...initialState,

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

      getPageCached: async (pageIndex) => {
        const { pdfDocument, pageCache } = get();
        if (!pdfDocument) {
          throw new Error("PDF document not loaded");
        }

        let pagePromise = pageCache.get(pageIndex);
        if (!pagePromise) {
          pagePromise = pdfDocument.getPage(pageIndex + 1);
          pageCache.set(pageIndex, pagePromise);
        }
        return await pagePromise;
      },

      warmupThumbnails: () => {
        const { pdfBytes } = get();
        if (!pdfBytes || pdfBytes.byteLength === 0) return;

        thumbnailWarmupEpoch += 1;
        const epoch = thumbnailWarmupEpoch;
        thumbnailWarmupAbort?.abort();
        thumbnailWarmupAbort = new AbortController();
        const { signal } = thumbnailWarmupAbort;

        void (async () => {
          try {
            await pdfWorkerService.loadDocument(pdfBytes, { signal });
          } catch {
            return;
          }

          for (let pageIndex = 0; ; pageIndex++) {
            if (signal.aborted) return;
            if (thumbnailWarmupEpoch !== epoch) return;

            const state = get();
            if (pageIndex >= state.pages.length) return;
            const page = state.pages[pageIndex];
            if (!page || page.imageData) continue;

            try {
              const { bytes, mimeType } =
                await pdfWorkerService.renderPageImage({
                  pageIndex,
                  targetWidth: THUMBNAIL_TARGET_WIDTH,
                  mimeType: THUMBNAIL_MIME_TYPE,
                  quality: THUMBNAIL_JPEG_QUALITY,
                  priority: THUMBNAIL_WARMUP_PRIORITY,
                  signal,
                });

              if (signal.aborted) return;
              if (!bytes || bytes.byteLength === 0) continue;

              const blobBytes = new Uint8Array(bytes);
              const objectUrl = URL.createObjectURL(
                new Blob([blobBytes], { type: mimeType }),
              );

              if (signal.aborted) {
                revokeObjectUrlIfNeeded(objectUrl);
                return;
              }
              if (thumbnailWarmupEpoch !== epoch) {
                revokeObjectUrlIfNeeded(objectUrl);
                return;
              }

              let didSet = false;

              set((s) => {
                const p = s.pages[pageIndex];
                if (!p || p.imageData) return {};
                const nextPages = s.pages.slice();
                didSet = true;
                nextPages[pageIndex] = { ...p, imageData: objectUrl };
                return { pages: nextPages };
              });

              if (!didSet) {
                revokeObjectUrlIfNeeded(objectUrl);
              }
            } catch {
              // ignore
            }

            await new Promise<void>((r) => setTimeout(r, 0));
          }
        })();
      },

      setState: (updates) =>
        set((state) => {
          const newValues =
            typeof updates === "function" ? updates(state) : updates;
          return { ...state, ...newValues };
        }),

      setUiState: (updates) =>
        set((state) => {
          const newValues =
            typeof updates === "function" ? updates(state) : updates;
          return { ...state, ...newValues };
        }),

      resetUiState: () => set({ ...DEFAULT_EDITOR_UI_STATE }),

      setOptions: (updates) =>
        set((state) => {
          const patch =
            typeof updates === "function" ? updates(state.options) : updates;
          return {
            ...state,
            options: {
              ...state.options,
              ...patch,
              ...(patch.snappingOptions
                ? {
                    snappingOptions: {
                      ...state.options.snappingOptions,
                      ...patch.snappingOptions,
                    },
                  }
                : null),
              ...(patch.debugOptions
                ? {
                    debugOptions: {
                      ...state.options.debugOptions,
                      ...patch.debugOptions,
                    },
                  }
                : null),
            },
          };
        }),
      loadDocument: (data) => {
        revokeThumbnailObjectUrls(get().pages);
        set({
          ...data,
          pageCache: new Map(),
          past: [],
          future: [],
          selectedId: null,
          isDirty: false,
        });
        get().warmupThumbnails();
      },

      saveCheckpoint: () => {
        set((state) => {
          const snapshot: HistorySnapshot = {
            fields: state.fields,
            annotations: state.annotations,
            metadata: state.metadata,
          };
          const newPast = [...state.past, snapshot].slice(-50);
          return { ...state, past: newPast, future: [] };
        });
      },

      undo: () => {
        set((state) => {
          if (state.past.length === 0) return state;
          const previous = state.past[state.past.length - 1];
          const newPast = state.past.slice(0, -1);
          const currentSnapshot: HistorySnapshot = {
            fields: state.fields,
            annotations: state.annotations,
            metadata: state.metadata,
          };
          return {
            ...state,
            fields: previous.fields,
            annotations: previous.annotations,
            metadata: previous.metadata,
            past: newPast,
            future: [currentSnapshot, ...state.future],
            selectedId: null,
            isDirty: true,
          };
        });
      },

      redo: () => {
        set((state) => {
          if (state.future.length === 0) return state;
          const next = state.future[0];
          const newFuture = state.future.slice(1);
          const currentSnapshot: HistorySnapshot = {
            fields: state.fields,
            annotations: state.annotations,
            metadata: state.metadata,
          };
          return {
            ...state,
            fields: next.fields,
            annotations: next.annotations,
            metadata: next.metadata,
            past: [...state.past, currentSnapshot],
            future: newFuture,
            selectedId: null,
            isDirty: true,
          };
        });
      },

      addField: (field) => {
        const { saveCheckpoint } = get();
        saveCheckpoint();
        set((state) => {
          const shouldSwitch = shouldSwitchToSelectAfterUse(state.tool);
          const isForcedContinuous = state.keys.ctrl || state.keys.meta;
          return {
            fields: [...state.fields, field],
            selectedId: field.id,
            tool: shouldSwitch && !isForcedContinuous ? "select" : state.tool,
            isDirty: true,
          };
        });
      },

      addAnnotation: (annotation) => {
        const { saveCheckpoint } = get();
        saveCheckpoint();
        const now = new Date().toISOString();
        set((state) => {
          const author = annotation.author || state.metadata?.author || "User";
          const annotationWithDetails = {
            ...annotation,
            updatedAt: now,
            author: author,
          };
          const shouldSwitch = shouldSwitchToSelectAfterUse(state.tool);
          const isForcedContinuous = state.keys.ctrl || state.keys.meta;
          return {
            annotations: [...state.annotations, annotationWithDetails],
            selectedId: annotationWithDetails.id,
            tool: shouldSwitch && !isForcedContinuous ? "select" : state.tool,
            isDirty: true,
          };
        });
      },

      updateField: (id, updates) => {
        set((state) => {
          let newFields = state.fields;
          const targetField = state.fields.find((f) => f.id === id);

          if (!targetField) return state;

          // Handle Radio Exclusivity
          if (
            updates.isChecked === true &&
            targetField.type === FieldType.RADIO
          ) {
            newFields = newFields.map((f) =>
              f.name === targetField.name &&
              f.id !== id &&
              f.type === FieldType.RADIO
                ? { ...f, isChecked: false }
                : f,
            );
          }

          // Sync same-name fields
          const propsToSync = [
            "value",
            "defaultValue",
            "options",
            "required",
            "readOnly",
            "toolTip",
            "multiline",
            "maxLength",
            "alignment",
          ];

          if (targetField.type !== FieldType.RADIO) {
            propsToSync.push("isChecked");
            propsToSync.push("isDefaultChecked");
          }

          const syncUpdates: Partial<FormField> = {};
          propsToSync.forEach((key) => {
            const k = key as keyof FormField;
            if (updates[k] !== undefined) {
              // @ts-ignore
              syncUpdates[k] = updates[k];
            }
          });

          if (Object.keys(syncUpdates).length > 0) {
            newFields = newFields.map((f) =>
              f.name === targetField.name &&
              f.id !== id &&
              f.type === targetField.type
                ? { ...f, ...syncUpdates }
                : f,
            );
          }

          newFields = newFields.map((f) =>
            f.id === id ? { ...f, ...updates } : f,
          );
          return { ...state, fields: newFields, isDirty: true };
        });
      },

      updateAnnotation: (id, updates) => {
        set((state) => {
          const current = state.annotations.find((a) => a.id === id);

          const shouldMarkEdited =
            !!current?.sourcePdfRef && current?.isEdited !== true;

          const shouldResetFontOnFirstEdit =
            shouldMarkEdited &&
            !!current?.sourcePdfFontMissing &&
            updates.fontFamily === undefined;

          const updatesWithTime = {
            ...updates,
            updatedAt: new Date().toISOString(),
            ...(shouldMarkEdited ? { isEdited: true } : null),
            ...(shouldResetFontOnFirstEdit
              ? { fontFamily: "Helvetica" }
              : null),
          };
          return {
            annotations: state.annotations.map((a) =>
              a.id === id ? { ...a, ...updatesWithTime } : a,
            ),
            isDirty: true,
          };
        });
      },

      deleteAnnotation: (id) => {
        const { saveCheckpoint } = get();
        saveCheckpoint();
        set((state) => ({
          annotations: state.annotations.filter((a) => a.id !== id),
          selectedId: state.selectedId === id ? null : state.selectedId,
          isDirty: true,
        }));
      },

      deleteSelection: () => {
        const { saveCheckpoint } = get();
        saveCheckpoint();
        set((state) => {
          if (state.selectedId) {
            const isField = state.fields.some((f) => f.id === state.selectedId);
            if (isField) {
              return {
                fields: state.fields.filter((f) => f.id !== state.selectedId),
                selectedId: null,
                isDirty: true,
              };
            }
            const isAnnotation = state.annotations.some(
              (a) => a.id === state.selectedId,
            );
            if (isAnnotation) {
              return {
                annotations: state.annotations.filter(
                  (a) => a.id !== state.selectedId,
                ),
                selectedId: null,
                isDirty: true,
              };
            }
          }
          return state;
        });
      },

      selectControl: (id) => set({ selectedId: id }),

      setTool: (tool) =>
        set((state) => {
          if (tool === "draw_highlight") {
            return {
              tool,
              selectedId: null,
              highlightStyle: {
                color:
                  state.highlightStyle?.color ||
                  ANNOTATION_STYLES.highlight.color,
                thickness: Math.max(
                  state.highlightStyle?.thickness ||
                    ANNOTATION_STYLES.highlight.thickness,
                  ANNOTATION_STYLES.highlight.thickness,
                ),
                opacity:
                  state.highlightStyle?.opacity ??
                  ANNOTATION_STYLES.highlight.opacity,
              },
            };
          }
          return {
            tool,
            selectedId: tool === "select" ? state.selectedId : null,
          };
        }),

      openDialog: (name) =>
        set({
          activeDialog: name,
          closeConfirmSource: null,
        }),
      closeDialog: () =>
        set({
          activeDialog: null,
          closeConfirmSource: null,
        }),

      setKeys: (keys) => set((state) => ({ keys: { ...state.keys, ...keys } })),

      resetDocument: () => {
        thumbnailWarmupEpoch += 1;
        thumbnailWarmupAbort?.abort();
        thumbnailWarmupAbort = null;

        revokeThumbnailObjectUrls(get().pages);

        set(() => ({
          pdfFile: initialState.pdfFile,
          pdfBytes: initialState.pdfBytes,
          pdfDocument: initialState.pdfDocument,
          pageCache: new Map(),
          metadata: initialState.metadata,
          filename: initialState.filename,
          saveTarget: initialState.saveTarget,
          pages: initialState.pages,
          fields: initialState.fields,
          annotations: initialState.annotations,
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
          hasSavedSession: initialState.hasSavedSession,
          lastSavedAt: initialState.lastSavedAt,
          isDirty: initialState.isDirty,
          currentPageIndex: initialState.currentPageIndex,
          pendingViewStateRestore: initialState.pendingViewStateRestore,
          fitTrigger: initialState.fitTrigger,
          keys: { ...initialState.keys },
          activeDialog: initialState.activeDialog,
          closeConfirmSource: initialState.closeConfirmSource,
        }));
      },

      moveField: (direction, isFast) => {
        set((state) => {
          if (!state.selectedId) return state;
          const fieldIndex = state.fields.findIndex(
            (f) => f.id === state.selectedId,
          );
          if (fieldIndex === -1) return state;

          const field = state.fields[fieldIndex];
          let { x, y } = field.rect;
          const step = isFast ? 10 : 1;

          if (direction === "UP") y -= step;
          else if (direction === "DOWN") y += step;
          else if (direction === "LEFT") x -= step;
          else if (direction === "RIGHT") x += step;

          const newFields = [...state.fields];
          newFields[fieldIndex] = { ...field, rect: { ...field.rect, x, y } };

          return { ...state, fields: newFields, isDirty: true };
        });
      },
    }),
    {
      name: "ff-editor-ui-dev",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => pickEditorUiState(state),
    },
  ),
);
