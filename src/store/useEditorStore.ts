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
  PageTranslateUiPreferences,
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

  warmupThumbnails: () => void;

  // Complex Actions
  loadDocument: (data: {
    pdfFile: File | null;
    pdfBytes: Uint8Array;
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
  addAnnotations: (
    annotations: Annotation[],
    opts?: { select?: boolean },
  ) => void;
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

  setPageTranslateParagraphCandidates: (
    candidates: EditorState["pageTranslateParagraphCandidates"],
  ) => void;
  clearPageTranslateParagraphCandidates: () => void;
  removePageTranslateParagraphCandidatesByPageIndex: (
    pageIndex: number,
  ) => void;
  setSelectedPageTranslateParagraphIds: (ids: string[]) => void;
  selectPageTranslateParagraphId: (
    id: string,
    opts?: { additive?: boolean },
  ) => void;
  toggleExcludeSelectedPageTranslateParagraphs: () => void;
  mergeSelectedPageTranslateParagraphs: () => void;
  deleteSelectedPageTranslateParagraphs: () => void;

  setAllFreetextFlatten: (flatten: boolean) => void;
}

export type EditorStore = EditorState & EditorActions;

const pickPageTranslateUiPreferences = (
  state: Partial<PageTranslateUiPreferences>,
): Partial<PageTranslateUiPreferences> => {
  return {
    pageTranslateFontFamily: state.pageTranslateFontFamily,
    pageTranslateUsePositionAwarePrompt:
      state.pageTranslateUsePositionAwarePrompt,
    pageTranslateUseParagraphs: state.pageTranslateUseParagraphs,
    pageTranslateFlattenFreetext: state.pageTranslateFlattenFreetext,
    pageTranslateContextWindow: state.pageTranslateContextWindow,
    pageTranslateParagraphXGap: state.pageTranslateParagraphXGap,
    pageTranslateParagraphYGap: state.pageTranslateParagraphYGap,
  };
};

function pickEditorUiState(
  state: Partial<EditorState>,
): Partial<EditorUiState> {
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
    translateTargetLanguage: state.translateTargetLanguage,
    ...pickPageTranslateUiPreferences(state),
    options: state.options,
    rightPanelDockTab: state.rightPanelDockTab,
  };
}

// Initial State
const initialState: EditorState = {
  pdfFile: null,
  pdfBytes: null,
  pdfOpenPassword: null,
  exportPassword: null,
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
  lastSavedAt: null,
  processingStatus: null,
  isPanelFloating: false,
  isSaving: false,
  pageTranslateParagraphCandidates: [],
  pageTranslateSelectedParagraphIds: [],
  ...DEFAULT_EDITOR_UI_STATE,
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

const medianNumber = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
};

const pickMostCommonString = (values: string[]) => {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: { v: string; n: number } | null = null;
  for (const [v, n] of counts) {
    if (!best || n > best.n) best = { v, n };
  }
  return best?.v;
};

const unionRect = (
  rects: Array<{ x: number; y: number; width: number; height: number }>,
) => {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
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

      warmupThumbnails: () => {
        const { pdfBytes, pdfOpenPassword } = get();
        if (!pdfBytes || pdfBytes.byteLength === 0) return;

        thumbnailWarmupEpoch += 1;
        const epoch = thumbnailWarmupEpoch;
        thumbnailWarmupAbort?.abort();
        thumbnailWarmupAbort = new AbortController();
        const { signal } = thumbnailWarmupAbort;

        void (async () => {
          let workerLoaded = false;
          const ensureWorkerLoaded = async () => {
            if (workerLoaded) return;
            await pdfWorkerService.loadDocument(pdfBytes, {
              signal,
              password:
                typeof pdfOpenPassword === "string"
                  ? pdfOpenPassword
                  : undefined,
            });
            workerLoaded = true;
          };

          for (let pageIndex = 0; ; pageIndex++) {
            if (signal.aborted) return;
            if (thumbnailWarmupEpoch !== epoch) return;

            const state = get();
            if (pageIndex >= state.pages.length) return;
            const page = state.pages[pageIndex];
            if (!page || page.imageData) continue;

            try {
              let bytes: Uint8Array;
              let mimeType: string;
              try {
                ({ bytes, mimeType } = await pdfWorkerService.renderPageImage({
                  pageIndex,
                  targetWidth: THUMBNAIL_TARGET_WIDTH,
                  mimeType: THUMBNAIL_MIME_TYPE,
                  quality: THUMBNAIL_JPEG_QUALITY,
                  priority: THUMBNAIL_WARMUP_PRIORITY,
                  signal,
                }));
              } catch (e: unknown) {
                const msg =
                  typeof (e as { message?: unknown })?.message === "string"
                    ? String((e as { message: string }).message)
                    : String(e);
                if (msg.includes("PDF Document not loaded")) {
                  await ensureWorkerLoaded();
                  ({ bytes, mimeType } = await pdfWorkerService.renderPageImage(
                    {
                      pageIndex,
                      targetWidth: THUMBNAIL_TARGET_WIDTH,
                      mimeType: THUMBNAIL_MIME_TYPE,
                      quality: THUMBNAIL_JPEG_QUALITY,
                      priority: THUMBNAIL_WARMUP_PRIORITY,
                      signal,
                    },
                  ));
                } else {
                  throw e;
                }
              }

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
                : {}),
              ...(patch.debugOptions
                ? {
                    debugOptions: {
                      ...state.options.debugOptions,
                      ...patch.debugOptions,
                    },
                  }
                : {}),
            },
          };
        }),
      loadDocument: (data) => {
        revokeThumbnailObjectUrls(get().pages);
        set({
          ...data,
          past: [],
          future: [],
          selectedId: null,
          isDirty: false,
          pageTranslateParagraphCandidates: [],
          pageTranslateSelectedParagraphIds: [],
        });
        get().warmupThumbnails();
      },

      saveCheckpoint: () => {
        set((state) => {
          const snapshot: HistorySnapshot = {
            fields: state.fields,
            annotations: state.annotations,
            metadata: state.metadata,
            exportPassword: state.exportPassword,
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
            exportPassword: state.exportPassword,
          };
          return {
            ...state,
            fields: previous.fields,
            annotations: previous.annotations,
            metadata: previous.metadata,
            exportPassword: previous.exportPassword,
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
            exportPassword: state.exportPassword,
          };
          return {
            ...state,
            fields: next.fields,
            annotations: next.annotations,
            metadata: next.metadata,
            exportPassword: next.exportPassword,
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
          const author = annotation.author || state.options.userName;
          const annotationWithDetails = {
            ...annotation,
            updatedAt: now,
            author: author,
          } satisfies Annotation;
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

      addAnnotations: (annotations, opts) => {
        if (!Array.isArray(annotations) || annotations.length === 0) return;
        const { saveCheckpoint } = get();
        saveCheckpoint();
        const now = new Date().toISOString();
        set((state) => {
          const authorFallback = state.options.userName;
          const batch = annotations.map(
            (a) =>
              ({
                ...a,
                updatedAt: now,
                author: a.author || authorFallback,
              }) satisfies Annotation,
          );

          const shouldSelect = opts?.select !== false;
          const last = batch[batch.length - 1];
          return {
            annotations: [...state.annotations, ...batch],
            selectedId: shouldSelect
              ? (last?.id ?? state.selectedId)
              : state.selectedId,
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
              // @ts-expect-error index signature mismatch for dynamic keyof assignment
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
          pdfOpenPassword: initialState.pdfOpenPassword,
          exportPassword: initialState.exportPassword,
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
          pageTranslateParagraphCandidates:
            initialState.pageTranslateParagraphCandidates,
          pageTranslateSelectedParagraphIds:
            initialState.pageTranslateSelectedParagraphIds,
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

      setPageTranslateParagraphCandidates: (candidates) =>
        set({
          pageTranslateParagraphCandidates: candidates,
          pageTranslateSelectedParagraphIds: [],
        }),

      clearPageTranslateParagraphCandidates: () =>
        set({
          pageTranslateParagraphCandidates: [],
          pageTranslateSelectedParagraphIds: [],
        }),

      removePageTranslateParagraphCandidatesByPageIndex: (pageIndex) =>
        set((state) => {
          const removedIds = new Set(
            state.pageTranslateParagraphCandidates
              .filter((c) => c.pageIndex === pageIndex)
              .map((c) => c.id),
          );
          if (removedIds.size === 0) return state;
          return {
            ...state,
            pageTranslateParagraphCandidates:
              state.pageTranslateParagraphCandidates.filter(
                (c) => c.pageIndex !== pageIndex,
              ),
            pageTranslateSelectedParagraphIds:
              state.pageTranslateSelectedParagraphIds.filter(
                (id) => !removedIds.has(id),
              ),
          };
        }),

      setSelectedPageTranslateParagraphIds: (ids) =>
        set({ pageTranslateSelectedParagraphIds: ids }),

      selectPageTranslateParagraphId: (id, opts) =>
        set((state) => {
          const additive = Boolean(opts?.additive);
          if (!additive) {
            return { pageTranslateSelectedParagraphIds: [id] };
          }
          const existing = new Set(state.pageTranslateSelectedParagraphIds);
          if (existing.has(id)) existing.delete(id);
          else existing.add(id);
          return { pageTranslateSelectedParagraphIds: Array.from(existing) };
        }),

      toggleExcludeSelectedPageTranslateParagraphs: () =>
        set((state) => {
          const selected = new Set(state.pageTranslateSelectedParagraphIds);
          if (selected.size === 0) return state;
          const next = state.pageTranslateParagraphCandidates.map((c) => {
            if (!selected.has(c.id)) return c;
            return { ...c, isExcluded: !c.isExcluded };
          });
          return { ...state, pageTranslateParagraphCandidates: next };
        }),

      deleteSelectedPageTranslateParagraphs: () =>
        set((state) => {
          const selected = new Set(state.pageTranslateSelectedParagraphIds);
          if (selected.size === 0) return state;
          const next = state.pageTranslateParagraphCandidates.filter(
            (c) => !selected.has(c.id),
          );
          return {
            ...state,
            pageTranslateParagraphCandidates: next,
            pageTranslateSelectedParagraphIds: [],
          };
        }),

      mergeSelectedPageTranslateParagraphs: () =>
        set((state) => {
          const selectedIds = state.pageTranslateSelectedParagraphIds;
          if (selectedIds.length < 2) return state;
          const selected = state.pageTranslateParagraphCandidates.filter((c) =>
            selectedIds.includes(c.id),
          );
          if (selected.length < 2) return state;
          const pageIndex = selected[0]!.pageIndex;
          if (selected.some((c) => c.pageIndex !== pageIndex)) return state;

          const mergedId = `page_translate_para_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
          const rect = unionRect(selected.map((c) => c.rect));
          const fontSize =
            medianNumber(
              selected.map((c) => c.fontSize).filter((n) => n > 0),
            ) ||
            selected[0]!.fontSize ||
            12;
          const fontFamily =
            pickMostCommonString(selected.map((c) => c.fontFamily)) ||
            selected[0]!.fontFamily ||
            "sans-serif";
          const sourceText = selected
            .slice()
            .sort((a, b) => {
              const dy = a.rect.y - b.rect.y;
              if (Math.abs(dy) > 0.001) return dy;
              return a.rect.x - b.rect.x;
            })
            .map((c) => c.sourceText)
            .join("\n")
            .trim();

          const merged = {
            id: mergedId,
            pageIndex,
            rect,
            sourceText,
            fontSize,
            fontFamily,
            isExcluded: false,
          };

          const selectedSet = new Set(selectedIds);
          const remaining = state.pageTranslateParagraphCandidates.filter(
            (c) => !selectedSet.has(c.id),
          );

          return {
            ...state,
            pageTranslateParagraphCandidates: [...remaining, merged].sort(
              (a, b) => {
                if (a.pageIndex !== b.pageIndex)
                  return a.pageIndex - b.pageIndex;
                const dy = a.rect.y - b.rect.y;
                if (Math.abs(dy) > 0.001) return dy;
                return a.rect.x - b.rect.x;
              },
            ),
            pageTranslateSelectedParagraphIds: [mergedId],
          };
        }),

      setAllFreetextFlatten: (flatten) => {
        const { saveCheckpoint } = get();
        saveCheckpoint();
        const now = new Date().toISOString();
        set((state) => {
          let changed = false;
          const next = state.annotations.map((a) => {
            if (a.type !== "freetext") return a;
            if ((a.flatten ?? false) === flatten) return a;
            changed = true;
            const shouldMarkEdited = !!a.sourcePdfRef && a.isEdited !== true;
            return {
              ...a,
              flatten,
              updatedAt: now,
              ...(shouldMarkEdited ? { isEdited: true } : null),
            } satisfies Annotation;
          });
          if (!changed) return state;
          return { ...state, annotations: next, isDirty: true };
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
