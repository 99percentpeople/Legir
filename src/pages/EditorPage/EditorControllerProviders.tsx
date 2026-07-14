import React from "react";
import { useShallow } from "zustand/react/shallow";

import {
  EditorAiChatControllerProvider,
  EditorAiSearchHighlightsProvider,
  EditorPdfSearchProviders,
  useEditorAiSearchHighlights,
} from "@/app/editorShellContext";
import { useEditorDocumentIdentityRuntime } from "@/app/editorRuntime";
import { useLanguage } from "@/components/language-provider";
import { useAiChatController } from "@/hooks/useAiChatController";
import { useAppEvent } from "@/hooks/useAppEventBus";
import {
  selectAiChatEditorState,
  selectPdfSearchControllerState,
} from "@/store/selectors";
import { useEditorStore } from "@/store/useEditorStore";
import type { Tool } from "@/types";
import { useEditorPageKeyboardShortcuts } from "./hooks/useEditorPageKeyboardShortcuts";
import { usePdfSearchController } from "./hooks/usePdfSearchController";

interface EditorControllerProvidersProps {
  aiScopeId?: string;
  defaultTool: Tool;
  runPrimarySaveAction: () => Promise<boolean>;
  onPrint: () => void;
  onToggleFullscreen: () => void;
  children: React.ReactNode;
}

function EditorAiControllerProvider({
  aiScopeId,
  children,
}: Pick<EditorControllerProvidersProps, "aiScopeId" | "children">) {
  const editorState = useEditorStore(useShallow(selectAiChatEditorState));
  const { workerService } = useEditorDocumentIdentityRuntime();
  const aiChat = useAiChatController(
    editorState,
    aiScopeId,
    workerService ?? undefined,
  );

  return (
    <EditorAiChatControllerProvider value={aiChat}>
      <EditorAiSearchHighlightsProvider
        value={aiChat.highlightedSearchResultsByPage}
      >
        {children}
      </EditorAiSearchHighlightsProvider>
    </EditorAiChatControllerProvider>
  );
}

function EditorPdfSearchControllerProvider({
  defaultTool,
  runPrimarySaveAction,
  onPrint,
  onToggleFullscreen,
  children,
}: Omit<EditorControllerProvidersProps, "aiScopeId">) {
  const { t } = useLanguage();
  const { workerService } = useEditorDocumentIdentityRuntime();
  const highlightedSearchResultsByPage = useEditorAiSearchHighlights();
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
  aiScopeId,
  defaultTool,
  runPrimarySaveAction,
  onPrint,
  onToggleFullscreen,
  children,
}: EditorControllerProvidersProps) {
  return (
    <EditorAiControllerProvider aiScopeId={aiScopeId}>
      <EditorPdfSearchControllerProvider
        defaultTool={defaultTool}
        runPrimarySaveAction={runPrimarySaveAction}
        onPrint={onPrint}
        onToggleFullscreen={onToggleFullscreen}
      >
        {children}
      </EditorPdfSearchControllerProvider>
    </EditorAiControllerProvider>
  );
}
