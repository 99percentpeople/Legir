import React from "react";
import { useShallow } from "zustand/react/shallow";

import { EditorPdfSearchProviders } from "@/app/editorShellContext";
import { useEditorDocumentIdentityRuntime } from "@/app/editorRuntime";
import { useLanguage } from "@/components/language-provider";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { selectPdfSearchControllerState } from "@/store/selectors";
import { useEditorStore } from "@/store/useEditorStore";
import type { PDFSearchResult, Tool } from "@/types";
import { useEditorPageKeyboardShortcuts } from "./hooks/useEditorPageKeyboardShortcuts";
import { usePdfSearchController } from "./hooks/usePdfSearchController";

interface EditorControllerProvidersProps {
  highlightedSearchResultsByPage: Map<number, PDFSearchResult[]>;
  defaultTool: Tool;
  runPrimarySaveAction: () => Promise<boolean>;
  onPrint: () => void;
  onToggleFullscreen: () => void;
  children: React.ReactNode;
}

function EditorPdfSearchControllerProvider({
  highlightedSearchResultsByPage,
  defaultTool,
  runPrimarySaveAction,
  onPrint,
  onToggleFullscreen,
  children,
}: EditorControllerProvidersProps) {
  const { t } = useLanguage();
  const { workerService } = useEditorDocumentIdentityRuntime();
  const { pages, isSidebarOpen, setUiState } = useEditorStore(
    useShallow(selectPdfSearchControllerState),
  );
  const pdfSearch = usePdfSearchController({
    pages,
    workerService,
    sidebarOpen: isSidebarOpen,
    setUiState,
    highlightedSearchResultsByPage,
    t,
  });

  useEditorPageKeyboardShortcuts({
    defaultTool,
    isPdfSearchOpen: pdfSearch.isPdfSearchOpen,
    openPdfSearch: pdfSearch.openPdfSearch,
    closePdfSearch: pdfSearch.closePdfSearch,
    runPrimarySaveAction,
    onPrint,
    onToggleFullscreen,
  });

  useAppEvent("sidebar:focusAnnotation", () => {
    pdfSearch.dismissPdfSearch();
    setUiState((prev) => ({
      isSidebarOpen: true,
      sidebarTab: "annotations",
      ...(prev.isPanelFloating ? { isRightPanelOpen: false } : {}),
    }));
  });

  return (
    <EditorPdfSearchProviders controller={pdfSearch}>
      {children}
    </EditorPdfSearchProviders>
  );
}

export function EditorControllerProviders({
  highlightedSearchResultsByPage,
  defaultTool,
  runPrimarySaveAction,
  onPrint,
  onToggleFullscreen,
  children,
}: EditorControllerProvidersProps) {
  return (
    <EditorPdfSearchControllerProvider
      highlightedSearchResultsByPage={highlightedSearchResultsByPage}
      defaultTool={defaultTool}
      runPrimarySaveAction={runPrimarySaveAction}
      onPrint={onPrint}
      onToggleFullscreen={onToggleFullscreen}
    >
      {children}
    </EditorPdfSearchControllerProvider>
  );
}
