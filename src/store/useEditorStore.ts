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
} from "../types";
import { ANNOTATION_STYLES, DEFAULT_EDITOR_UI_STATE } from "../constants";
import { shouldSwitchToSelectAfterUse } from "../lib/tool-behavior";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

// Define the Actions interface
interface EditorActions {
  // Generic Setter (for gradual migration)
  setState: (
    updates:
      | Partial<EditorState>
      | ((prev: EditorState) => Partial<EditorState>),
  ) => void;

  setUiState: (
    updates:
      | Partial<EditorUiState>
      | ((prev: EditorState) => Partial<EditorUiState>),
  ) => void;

  resetUiState: () => void;

  getPageCached: (pageIndex: number) => Promise<PDFPageProxy>;

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
}

function pickEditorUiState(state: EditorState): EditorUiState {
  return {
    isSidebarOpen: state.isSidebarOpen,
    isRightPanelOpen: state.isRightPanelOpen,
    rightPanelTab: state.rightPanelTab,
    sidebarTab: state.sidebarTab,
    sidebarWidth: state.sidebarWidth,
    rightPanelWidth: state.rightPanelWidth,
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
  snappingOptions: {
    enabled: true,
    snapToBorders: true,
    snapToCenter: true,
    snapToEqualDistances: false,
    threshold: 8,
  },
  lastSavedAt: null,
  processingStatus: null,
  isPanelFloating: false,
  isSaving: false,
  ...DEFAULT_EDITOR_UI_STATE,
  hasSavedSession: false,
  isDirty: false,
  currentPageIndex: 0,
  fitTrigger: 0,
  keys: {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    space: false,
  },
  activeDialog: null,
  actionSignal: null, // Deprecated, but kept for interface compatibility
};

export const useEditorStore = create<EditorState & EditorActions>()(
  persist(
    (set, get) => ({
      ...initialState,

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

      loadDocument: (data) =>
        set({
          ...data,
          pageCache: new Map(),
          past: [],
          future: [],
          isProcessing: false,
          selectedId: null,
          isDirty: false,
        }),

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

      openDialog: (name) => set({ activeDialog: name }),
      closeDialog: () => set({ activeDialog: null }),

      setKeys: (keys) => set((state) => ({ keys: { ...state.keys, ...keys } })),

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
      name: "ff-editor-ui",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => pickEditorUiState(state),
    },
  ),
);
