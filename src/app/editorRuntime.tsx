import React, { createContext, useContext, useMemo } from "react";

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

export interface EditorPageTabsRuntime {
  activeTabId: string | null;
  hasDirtyTabs: boolean;
}

export type EditorDocumentIdentityRuntime = Pick<
  EditorDocumentRuntime,
  "sessionRenderKey" | "workerService"
>;

export type EditorDocumentCommandsRuntime = Pick<
  EditorDocumentRuntime,
  "save" | "saveAs" | "exit" | "print" | "requestCloseCurrentTab"
>;

export type EditorFileDragRuntime = Pick<
  EditorDocumentRuntime,
  "isFileDragActive"
>;

const EditorTabsRuntimeContext = createContext<EditorTabsRuntime | null>(null);
const EditorPageTabsRuntimeContext =
  createContext<EditorPageTabsRuntime | null>(null);
const EditorDocumentIdentityRuntimeContext =
  createContext<EditorDocumentIdentityRuntime | null>(null);
const EditorDocumentCommandsRuntimeContext =
  createContext<EditorDocumentCommandsRuntime | null>(null);
const EditorFileDragRuntimeContext =
  createContext<EditorFileDragRuntime | null>(null);

function useRequiredContext<T>(
  context: React.Context<T | null>,
  contextName: string,
) {
  const value = useContext(context);
  if (value === null) {
    throw new Error(`${contextName} must be used within EditorRuntimeProvider`);
  }
  return value;
}

export function useEditorTabsRuntime() {
  return useRequiredContext(EditorTabsRuntimeContext, "useEditorTabsRuntime");
}

export function useEditorPageTabsRuntime() {
  return useRequiredContext(
    EditorPageTabsRuntimeContext,
    "useEditorPageTabsRuntime",
  );
}

export function useEditorDocumentIdentityRuntime() {
  return useRequiredContext(
    EditorDocumentIdentityRuntimeContext,
    "useEditorDocumentIdentityRuntime",
  );
}

export function useEditorDocumentCommandsRuntime() {
  return useRequiredContext(
    EditorDocumentCommandsRuntimeContext,
    "useEditorDocumentCommandsRuntime",
  );
}

export function useEditorFileDragRuntime() {
  return useRequiredContext(
    EditorFileDragRuntimeContext,
    "useEditorFileDragRuntime",
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
  const pageTabs = useMemo<EditorPageTabsRuntime>(
    () => ({
      activeTabId: tabs.activeTabId,
      hasDirtyTabs: tabs.tabs.some((tab) => tab.isDirty),
    }),
    [tabs.activeTabId, tabs.tabs],
  );
  const documentIdentity = useMemo<EditorDocumentIdentityRuntime>(
    () => ({
      sessionRenderKey: document.sessionRenderKey,
      workerService: document.workerService,
    }),
    [document.sessionRenderKey, document.workerService],
  );
  const documentCommands = useMemo<EditorDocumentCommandsRuntime>(
    () => ({
      save: document.save,
      saveAs: document.saveAs,
      exit: document.exit,
      print: document.print,
      requestCloseCurrentTab: document.requestCloseCurrentTab,
    }),
    [
      document.exit,
      document.print,
      document.requestCloseCurrentTab,
      document.save,
      document.saveAs,
    ],
  );
  const fileDrag = useMemo<EditorFileDragRuntime>(
    () => ({ isFileDragActive: document.isFileDragActive }),
    [document.isFileDragActive],
  );

  return (
    <EditorTabsRuntimeContext.Provider value={tabs}>
      <EditorPageTabsRuntimeContext.Provider value={pageTabs}>
        <EditorDocumentIdentityRuntimeContext.Provider value={documentIdentity}>
          <EditorDocumentCommandsRuntimeContext.Provider
            value={documentCommands}
          >
            <EditorFileDragRuntimeContext.Provider value={fileDrag}>
              {children}
            </EditorFileDragRuntimeContext.Provider>
          </EditorDocumentCommandsRuntimeContext.Provider>
        </EditorDocumentIdentityRuntimeContext.Provider>
      </EditorPageTabsRuntimeContext.Provider>
    </EditorTabsRuntimeContext.Provider>
  );
}
