import React, { createContext, useContext } from "react";

import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import type {
  EditorMergeWindowTarget,
  EditorTabDescriptor,
  EditorTabDropTarget,
  EditorWindowId,
} from "@/app/editorTabs/types";

export interface EditorTabsRuntime {
  windowId: EditorWindowId;
  tabs: EditorTabDescriptor[];
  activeTabId: string | null;
  mergeWindowTargets: EditorMergeWindowTarget[];
  canDetachTabs: boolean;
  canMergeTabs: boolean;
  openDocument: () => Promise<void>;
  refreshMergeWindowTargets: () => Promise<void>;
  selectTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  moveTab: (tabId: string, target: EditorTabDropTarget) => void;
  detachTab: (tabId: string) => Promise<void>;
  mergeTabToWindow: (
    tabId: string,
    targetWindowId: EditorWindowId,
  ) => Promise<void>;
}

export interface EditorDocumentRuntime {
  sessionRenderKey: string | null;
  workerService: PDFWorkerService | null;
  isFileDragActive: boolean;
  save: () => Promise<boolean>;
  saveAs: () => Promise<boolean>;
  exit: () => void;
  print: () => void;
  requestCloseCurrentTab: () => void;
}

const EditorTabsRuntimeContext = createContext<EditorTabsRuntime | null>(null);
const EditorDocumentRuntimeContext =
  createContext<EditorDocumentRuntime | null>(null);

function useRequiredContext<T>(
  context: React.Context<T | null>,
  contextName: string,
) {
  const value = useContext(context);
  if (!value) {
    throw new Error(`${contextName} must be used within EditorRuntimeProvider`);
  }
  return value;
}

export function useEditorTabsRuntime() {
  return useRequiredContext(EditorTabsRuntimeContext, "useEditorTabsRuntime");
}

export function useEditorDocumentRuntime() {
  return useRequiredContext(
    EditorDocumentRuntimeContext,
    "useEditorDocumentRuntime",
  );
}

export function EditorRuntimeProvider({
  tabs,
  document,
  children,
}: {
  tabs: EditorTabsRuntime;
  document: EditorDocumentRuntime;
  children: React.ReactNode;
}) {
  return (
    <EditorTabsRuntimeContext.Provider value={tabs}>
      <EditorDocumentRuntimeContext.Provider value={document}>
        {children}
      </EditorDocumentRuntimeContext.Provider>
    </EditorTabsRuntimeContext.Provider>
  );
}
