import React, { createContext, useContext } from "react";

import type { EditorState, PDFSearchResult, PenStyle } from "@/types";
import type { PDFSearchMode } from "@/lib/pdfSearch";

export interface EditorShellCommands {
  zoomIn: () => void;
  zoomOut: () => void;
  fitWidth: () => void;
  fitScreen: () => void;
  toggleFullscreen: () => void;
  exitEditor: () => void;
  changeMode: (mode: EditorState["mode"]) => void;
  changePenStyle: (style: Partial<PenStyle>) => void;
  changeHighlightStyle: (style: Partial<PenStyle>) => void;
  changeCommentStyle: (style: { color: string }) => void;
  changeFreetextStyle: (style: { color: string }) => void;
  changeShapeStyle: (
    style: Partial<NonNullable<EditorState["shapeStyle"]>>,
  ) => void;
  changeStampStyle: (
    style: Partial<NonNullable<EditorState["stampStyle"]>>,
  ) => void;
  editAnnotation: (id: string) => void;
  openSidebar: () => void;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
}

export interface EditorPdfSearchController {
  isPdfSearchOpen: boolean;
  pdfSearchQuery: string;
  setPdfSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  pdfSearchResults: PDFSearchResult[];
  activePdfSearchResultId: string | null;
  isPdfSearchLoading: boolean;
  pdfSearchFocusToken: number;
  isPdfSearchCaseSensitive: boolean;
  togglePdfSearchCaseSensitive: () => void;
  pdfSearchMode: PDFSearchMode;
  togglePdfSearchMode: () => void;
  pdfSearchError: string | null;
  workspaceTextHighlightsByPage: Map<number, PDFSearchResult[]> | undefined;
  activePdfSearchResultIndex: number;
  openPdfSearch: () => void;
  closePdfSearch: () => void;
  dismissPdfSearch: () => void;
  handleSelectPdfSearchResult: (result: PDFSearchResult) => void;
  handleSelectPreviousPdfSearchResult: () => void;
  handleSelectNextPdfSearchResult: () => void;
}

const EditorShellCommandsContext = createContext<EditorShellCommands | null>(
  null,
);
const EditorPdfSearchContext = createContext<EditorPdfSearchController | null>(
  null,
);

function useRequiredContext<T>(context: React.Context<T | null>, name: string) {
  const value = useContext(context);
  if (!value) throw new Error(`${name} must be used within its provider`);
  return value;
}

export function useEditorShellCommands() {
  return useRequiredContext(
    EditorShellCommandsContext,
    "useEditorShellCommands",
  );
}

export function useEditorPdfSearch() {
  return useRequiredContext(EditorPdfSearchContext, "useEditorPdfSearch");
}

export const EditorShellCommandsProvider = EditorShellCommandsContext.Provider;
export const EditorPdfSearchProvider = EditorPdfSearchContext.Provider;
