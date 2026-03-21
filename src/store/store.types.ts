import type { StateCreator } from "zustand";

import type {
  Annotation,
  AppOptions,
  DialogName,
  EditorState,
  EditorUiState,
  FormField,
  MoveDirection,
  PageData,
  PDFMetadata,
  PDFOutlineItem,
  Tool,
} from "@/types";

export interface EditorActions {
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
    updates: Partial<AppOptions> | ((prev: AppOptions) => Partial<AppOptions>),
  ) => void;
  warmupThumbnails: () => void;
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
  moveSelectedControl: (direction: MoveDirection, isFast?: boolean) => void;
  addAnnotation: (annotation: Annotation, opts?: { select?: boolean }) => void;
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

export type EditorStoreStateCreator = StateCreator<
  EditorStore,
  [],
  [],
  EditorStore
>;
export type EditorStoreSet = Parameters<EditorStoreStateCreator>[0];
export type EditorStoreGet = Parameters<EditorStoreStateCreator>[1];
export type EditorStoreSlice<T> = (
  set: EditorStoreSet,
  get: EditorStoreGet,
) => T;
