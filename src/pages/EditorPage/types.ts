import type { EditorState, EditorUiState, PDFSearchResult } from "@/types";
export type TranslateFn = (
  key: string,
  params?: Record<string, string | number>,
) => string;

export type EditorUiStateSetter = (
  next:
    | Partial<EditorUiState>
    | ((prev: EditorState) => Partial<EditorUiState>),
) => void;

export type WorkspaceTextHighlightsByPage =
  | Map<number, PDFSearchResult[]>
  | undefined;
