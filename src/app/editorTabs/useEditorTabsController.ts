import { workspaceStore } from "@/store/workspaceStore";
import { getEditorTabTitle } from "./storeSnapshot";
import React from "react";
import { createEditorTabRuntime } from "./runtime";
import { activateEditorView, getActiveEditorView } from "@/store/useEditorView";
import {
  createLocalSingleWindowTabBackend,
  type EditorTabWorkspaceBackend,
} from "./backend";
import { disposeEditorTabSessionResources } from "./sessionResources";
import {
  CURRENT_EDITOR_WINDOW_ID,
  type EditorTabDescriptor,
  type EditorTabSession,
  type EditorTabSnapshot,
  type EditorWindowLayout,
  type EditorWindowId,
} from "./types";

interface UseEditorTabsControllerOptions {
  backend?: EditorTabWorkspaceBackend;
  windowId?: EditorWindowId;
  persistDocumentView: () => void;
  activateSession: (session: EditorTabSession) => void;
}

interface AddEditorTabOptions {
  id?: string;
  title: string;
  sourceKey: string | null;
  snapshot: EditorTabSnapshot;
  workerService: EditorTabSession["workerService"];
  thumbnailImages?: Record<number, string>;
  disposePdfResources?: (() => void) | null;
  activate?: boolean;
}

const nowIso = () => new Date().toISOString();

export function useEditorTabsController({
  backend,
  windowId = CURRENT_EDITOR_WINDOW_ID,
  persistDocumentView,
  activateSession,
}: UseEditorTabsControllerOptions) {
  const [workspaceBackend] = React.useState<EditorTabWorkspaceBackend>(
    () => backend ?? createLocalSingleWindowTabBackend(workspaceStore),
  );

  const [workspaceSnapshot, setWorkspaceSnapshot] = React.useState(() =>
    workspaceBackend.getWindowSnapshot(windowId),
  );

  const tabs = workspaceSnapshot.sessions;
  const activeTabId = workspaceSnapshot.layout.activeTabId;

  const tabsRef = React.useRef(tabs);
  const activeTabIdRef = React.useRef(activeTabId);

  React.useEffect(() => {
    return workspaceBackend.subscribe(windowId, setWorkspaceSnapshot);
  }, [windowId, workspaceBackend]);

  React.useEffect(() => {
    const snapshot = workspaceBackend.getWindowSnapshot(windowId);
    setWorkspaceSnapshot(snapshot);
  }, [windowId, workspaceBackend]);

  React.useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  React.useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  const getTabById = React.useCallback(
    (tabId: string | null | undefined) => {
      if (!tabId) return null;
      return workspaceBackend.getSession(tabId);
    },
    [workspaceBackend],
  );

  const findTabBySourceKey = React.useCallback(
    (sourceKey: string | null) =>
      workspaceBackend.findSessionBySourceKey(sourceKey),
    [workspaceBackend],
  );

  const getTabsSnapshot = React.useCallback(() => {
    return workspaceBackend.getWindowSnapshot(windowId).sessions;
  }, [windowId, workspaceBackend]);

  const persistActiveTabView = React.useCallback(() => {
    const currentTabId = activeTabIdRef.current;
    if (!currentTabId) return;

    const currentSession = workspaceBackend.getSession(currentTabId);
    if (!currentSession) return;
    persistDocumentView();
  }, [persistDocumentView, workspaceBackend]);

  const activateTab = React.useCallback(
    (
      tabId: string,
      options?: {
        skipCaptureCurrent?: boolean;
      },
    ) => {
      const nextTab = getTabById(tabId);
      if (!nextTab) return false;

      const currentTabId = activeTabIdRef.current;
      // Clicking the already-active tab must be a no-op.
      // Re-restoring the snapshot rewinds live editor state, which can
      // invalidate follow-page behavior and re-trigger thumbnail warmup.
      // A same-tick transfer rollback can retain the ID after deactivation.
      if (
        currentTabId === tabId &&
        nextTab.runtime.store === getActiveEditorView()
      ) {
        return true;
      }

      if (
        currentTabId &&
        currentTabId !== tabId &&
        !options?.skipCaptureCurrent
      ) {
        const currentSession = workspaceBackend.getSession(currentTabId);
        if (currentSession) persistDocumentView();
      }

      workspaceBackend.updateSession(tabId, {
        lastActiveAt: nowIso(),
      });
      workspaceBackend.activateSession(windowId, tabId);
      // Keep the imperative ref in sync immediately. Some callers activate a tab
      // and then persist the workspace in the same tick, before React effects run.
      // If this ref still points at the previous tab, the new document snapshot can
      // be captured into the wrong session and corrupt that tab's title/render state.
      activeTabIdRef.current = tabId;
      activateSession(nextTab);
      return true;
    },
    [
      persistDocumentView,
      getTabById,
      activateSession,
      windowId,
      workspaceBackend,
    ],
  );

  const addTab = React.useCallback(
    (options: AddEditorTabOptions) => {
      const session: EditorTabSession = {
        runtime: createEditorTabRuntime(
          options.snapshot,
          options.thumbnailImages ?? {},
        ),
        id:
          options.id ??
          `${windowId}_${Date.now()}_${tabsRef.current.length + 1}`,
        windowId,
        sourceKey: options.sourceKey,
        lastActiveAt: nowIso(),
        workerService: options.workerService,
        disposePdfResources: options.disposePdfResources ?? null,
      };

      const currentTabId = activeTabIdRef.current;
      if (options.activate && currentTabId) {
        const currentSession = workspaceBackend.getSession(currentTabId);
        if (currentSession) persistDocumentView();
      }

      workspaceBackend.addSession(windowId, session, {
        activate: options.activate,
      });
      if (options.activate) {
        // Mirror the activated tab ref synchronously for the same reason as
        // `activateTab`: follow-up capture/persist work may run before the
        // subscription/effect cycle updates `activeTabId`.
        activeTabIdRef.current = session.id;
        activateSession(session);
      }
      return session;
    },
    [persistDocumentView, activateSession, windowId, workspaceBackend],
  );

  const removeTab = React.useCallback(
    (tabId: string) => {
      const target = workspaceBackend.removeSession(windowId, tabId);
      if (target?.runtime?.store === getActiveEditorView())
        activateEditorView();
      disposeEditorTabSessionResources(target);
      return target;
    },
    [windowId, workspaceBackend],
  );

  const disposeAllTabs = React.useCallback(() => {
    activateEditorView();
    activeTabIdRef.current = null;
    const removedSessions = workspaceBackend.clearWindow(windowId);
    removedSessions.forEach((session) => {
      disposeEditorTabSessionResources(session);
    });
  }, [windowId, workspaceBackend]);

  const getAdjacentTabId = React.useCallback((tabId: string) => {
    const index = tabsRef.current.findIndex((tab) => tab.id === tabId);
    if (index < 0) return null;
    return (
      tabsRef.current[index + 1]?.id ?? tabsRef.current[index - 1]?.id ?? null
    );
  }, []);

  const moveTabToWindow = React.useCallback(
    (tabId: string, targetWindowId: EditorWindowId, targetIndex?: number) => {
      return workspaceBackend.moveSession({
        sessionId: tabId,
        fromWindowId: windowId,
        toWindowId: targetWindowId,
        targetIndex,
      });
    },
    [windowId, workspaceBackend],
  );

  const detachTabToNewWindow = React.useCallback(
    (tabId: string, targetWindowId?: EditorWindowId) => {
      return workspaceBackend.detachSessionToNewWindow({
        sessionId: tabId,
        fromWindowId: windowId,
        targetWindowId,
      });
    },
    [windowId, workspaceBackend],
  );

  const descriptors = React.useMemo<EditorTabDescriptor[]>(
    () =>
      tabs.map((tab) => ({
        id: tab.id,
        title: getEditorTabTitle(tab),
        isDirty: tab.runtime.store.document.getState().isDirty,
        isActive: tab.id === activeTabId,
      })),
    [activeTabId, tabs],
  );

  const windowLayout = React.useMemo<EditorWindowLayout>(
    () => ({
      windowId,
      tabIds: tabs.map((tab) => tab.id),
      activeTabId,
    }),
    [activeTabId, tabs, windowId],
  );

  return React.useMemo(
    () => ({
      backend: workspaceBackend,
      tabs,
      tabDescriptors: descriptors,
      activeTabId,
      activeTab: getTabById(activeTabId),
      windowLayout,
      addTab,
      activateTab,
      persistActiveTabView,
      detachTabToNewWindow,
      disposeAllTabs,
      findTabBySourceKey,
      getTabsSnapshot,
      getAdjacentTabId,
      getTabById,
      moveTabToWindow,
      removeTab,
    }),
    [
      workspaceBackend,
      tabs,
      descriptors,
      activeTabId,
      getTabById,
      windowLayout,
      addTab,
      activateTab,
      persistActiveTabView,
      detachTabToNewWindow,
      disposeAllTabs,
      findTabBySourceKey,
      getTabsSnapshot,
      getAdjacentTabId,
      moveTabToWindow,
      removeTab,
    ],
  );
}
