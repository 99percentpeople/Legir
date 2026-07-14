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

export type EditorPdfSearchToolbarController = Pick<
  EditorPdfSearchController,
  "isPdfSearchOpen" | "openPdfSearch"
>;

export type EditorPdfSearchSidebarController = Omit<
  EditorPdfSearchController,
  "workspaceTextHighlightsByPage"
>;

export type EditorPdfSearchWorkspaceController = Pick<
  EditorPdfSearchController,
  | "isPdfSearchOpen"
  | "activePdfSearchResultId"
  | "workspaceTextHighlightsByPage"
>;

export type EditorAiChatController = ReturnType<
  typeof import("@/hooks/useAiChatController").useAiChatController
>;

export type EditorAiSearchHighlights = Map<number, PDFSearchResult[]>;

const EditorShellCommandsContext = createContext<EditorShellCommands | null>(
  null,
);
const EditorPdfSearchToolbarContext =
  createContext<EditorPdfSearchToolbarController | null>(null);
const EditorPdfSearchSidebarContext =
  createContext<EditorPdfSearchSidebarController | null>(null);
const EditorPdfSearchWorkspaceContext =
  createContext<EditorPdfSearchWorkspaceController | null>(null);
const EditorAiChatControllerContext =
  createContext<EditorAiChatController | null>(null);
const EditorAiSearchHighlightsContext =
  createContext<EditorAiSearchHighlights | null>(null);

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

export function useEditorPdfSearchToolbar() {
  return useRequiredContext(
    EditorPdfSearchToolbarContext,
    "useEditorPdfSearchToolbar",
  );
}

export function useEditorPdfSearchSidebar() {
  return useRequiredContext(
    EditorPdfSearchSidebarContext,
    "useEditorPdfSearchSidebar",
  );
}

export function useEditorPdfSearchWorkspace() {
  return useRequiredContext(
    EditorPdfSearchWorkspaceContext,
    "useEditorPdfSearchWorkspace",
  );
}

export function useEditorAiChatController() {
  return useRequiredContext(
    EditorAiChatControllerContext,
    "useEditorAiChatController",
  );
}

export function useEditorAiSearchHighlights() {
  return useRequiredContext(
    EditorAiSearchHighlightsContext,
    "useEditorAiSearchHighlights",
  );
}

export function EditorPdfSearchProviders({
  controller,
  children,
}: {
  controller: EditorPdfSearchController;
  children: React.ReactNode;
}) {
  const toolbarController = React.useMemo<EditorPdfSearchToolbarController>(
    () => ({
      isPdfSearchOpen: controller.isPdfSearchOpen,
      openPdfSearch: controller.openPdfSearch,
    }),
    [controller.isPdfSearchOpen, controller.openPdfSearch],
  );
  const sidebarController = React.useMemo<EditorPdfSearchSidebarController>(
    () => ({
      isPdfSearchOpen: controller.isPdfSearchOpen,
      pdfSearchQuery: controller.pdfSearchQuery,
      setPdfSearchQuery: controller.setPdfSearchQuery,
      pdfSearchResults: controller.pdfSearchResults,
      activePdfSearchResultId: controller.activePdfSearchResultId,
      isPdfSearchLoading: controller.isPdfSearchLoading,
      pdfSearchFocusToken: controller.pdfSearchFocusToken,
      isPdfSearchCaseSensitive: controller.isPdfSearchCaseSensitive,
      togglePdfSearchCaseSensitive: controller.togglePdfSearchCaseSensitive,
      pdfSearchMode: controller.pdfSearchMode,
      togglePdfSearchMode: controller.togglePdfSearchMode,
      pdfSearchError: controller.pdfSearchError,
      activePdfSearchResultIndex: controller.activePdfSearchResultIndex,
      openPdfSearch: controller.openPdfSearch,
      closePdfSearch: controller.closePdfSearch,
      dismissPdfSearch: controller.dismissPdfSearch,
      handleSelectPdfSearchResult: controller.handleSelectPdfSearchResult,
      handleSelectPreviousPdfSearchResult:
        controller.handleSelectPreviousPdfSearchResult,
      handleSelectNextPdfSearchResult:
        controller.handleSelectNextPdfSearchResult,
    }),
    [
      controller.activePdfSearchResultId,
      controller.activePdfSearchResultIndex,
      controller.closePdfSearch,
      controller.dismissPdfSearch,
      controller.handleSelectNextPdfSearchResult,
      controller.handleSelectPdfSearchResult,
      controller.handleSelectPreviousPdfSearchResult,
      controller.isPdfSearchCaseSensitive,
      controller.isPdfSearchLoading,
      controller.isPdfSearchOpen,
      controller.openPdfSearch,
      controller.pdfSearchError,
      controller.pdfSearchFocusToken,
      controller.pdfSearchMode,
      controller.pdfSearchQuery,
      controller.pdfSearchResults,
      controller.setPdfSearchQuery,
      controller.togglePdfSearchCaseSensitive,
      controller.togglePdfSearchMode,
    ],
  );
  const workspaceController = React.useMemo<EditorPdfSearchWorkspaceController>(
    () => ({
      isPdfSearchOpen: controller.isPdfSearchOpen,
      activePdfSearchResultId: controller.activePdfSearchResultId,
      workspaceTextHighlightsByPage: controller.workspaceTextHighlightsByPage,
    }),
    [
      controller.activePdfSearchResultId,
      controller.isPdfSearchOpen,
      controller.workspaceTextHighlightsByPage,
    ],
  );

  return (
    <EditorPdfSearchToolbarContext.Provider value={toolbarController}>
      <EditorPdfSearchSidebarContext.Provider value={sidebarController}>
        <EditorPdfSearchWorkspaceContext.Provider value={workspaceController}>
          {children}
        </EditorPdfSearchWorkspaceContext.Provider>
      </EditorPdfSearchSidebarContext.Provider>
    </EditorPdfSearchToolbarContext.Provider>
  );
}

export const EditorShellCommandsProvider = EditorShellCommandsContext.Provider;
export const EditorAiChatControllerProvider =
  EditorAiChatControllerContext.Provider;
export const EditorAiSearchHighlightsProvider =
  EditorAiSearchHighlightsContext.Provider;
