import React from "react";
import {
  createLocalSingleWindowTabBackend,
  type EditorTabWorkspaceBackend,
} from "./backend";
import {
  cloneEditorTabThumbnailImages,
  disposeEditorTabSessionResources,
} from "./sessionResources";
import {
  CURRENT_EDITOR_WINDOW_ID,
  type EditorTabDescriptor,
  type EditorTabSession,
  type EditorWindowLayout,
  type EditorWindowId,
} from "./types";

interface UseEditorTabsControllerOptions {
  backend?: EditorTabWorkspaceBackend;
  windowId?: EditorWindowId;
  captureSessionState: () => {
    snapshot: EditorTabSession["editorSnapshot"];
    thumbnailImages: EditorTabSession["thumbnailImages"];
  };
  restoreSnapshot: (session: EditorTabSession) => void;
}

interface AddEditorTabOptions {
  id?: string;
  title: string;
  sourceKey: string | null;
  snapshot: EditorTabSession["editorSnapshot"];
  workerService: EditorTabSession["workerService"];
  thumbnailImages?: EditorTabSession["thumbnailImages"];
  disposePdfResources?: (() => void) | null;
  activate?: boolean;
}

type TabMetaPatch = Partial<
  Pick<
    EditorTabSession,
    | "disposePdfResources"
    | "isDirty"
    | "sourceKey"
    | "thumbnailImages"
    | "title"
  >
> & {
  editorSnapshot?: EditorTabSession["editorSnapshot"];
};

const nowIso = () => new Date().toISOString();

const patchSession = (
  session: EditorTabSession,
  patch: TabMetaPatch,
): EditorTabSession => ({
  ...session,
  ...patch,
  editorSnapshot: patch.editorSnapshot ?? session.editorSnapshot,
});

export function useEditorTabsController({
  backend,
  windowId = CURRENT_EDITOR_WINDOW_ID,
  captureSessionState,
  restoreSnapshot,
}: UseEditorTabsControllerOptions) {
  const [workspaceBackend] = React.useState<EditorTabWorkspaceBackend>(
    () => backend ?? createLocalSingleWindowTabBackend(),
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

  const captureCurrentTabIntoState = React.useCallback(() => {
    const currentTabId = activeTabIdRef.current;
    if (!currentTabId) return;

    const currentSession = workspaceBackend.getSession(currentTabId);
    if (!currentSession) return;

    const { snapshot, thumbnailImages } = captureSessionState();
    workspaceBackend.updateSession(
      currentTabId,
      patchSession(currentSession, {
        editorSnapshot: snapshot,
        isDirty: snapshot.isDirty,
        thumbnailImages,
        title: snapshot.filename?.trim() || currentSession.title,
      }),
    );
  }, [captureSessionState, workspaceBackend]);

  const syncActiveTabMeta = React.useCallback(
    (patch: TabMetaPatch) => {
      const currentTabId = activeTabIdRef.current;
      if (!currentTabId) return;
      const currentSession = workspaceBackend.getSession(currentTabId);
      if (!currentSession) return;
      workspaceBackend.updateSession(
        currentTabId,
        patchSession(currentSession, patch),
      );
    },
    [workspaceBackend],
  );

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
      if (currentTabId === tabId) {
        return true;
      }

      if (
        currentTabId &&
        currentTabId !== tabId &&
        !options?.skipCaptureCurrent
      ) {
        const currentSession = workspaceBackend.getSession(currentTabId);
        if (currentSession) {
          const { snapshot: currentSnapshot, thumbnailImages } =
            captureSessionState();
          workspaceBackend.updateSession(
            currentTabId,
            patchSession(currentSession, {
              editorSnapshot: currentSnapshot,
              isDirty: currentSnapshot.isDirty,
              thumbnailImages,
              title: currentSnapshot.filename?.trim() || currentSession.title,
            }),
          );
        }
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
      restoreSnapshot(nextTab);
      return true;
    },
    [
      captureSessionState,
      getTabById,
      restoreSnapshot,
      windowId,
      workspaceBackend,
    ],
  );

  const addTab = React.useCallback(
    (options: AddEditorTabOptions) => {
      const session: EditorTabSession = {
        id:
          options.id ??
          `${windowId}_${Date.now()}_${tabsRef.current.length + 1}`,
        windowId,
        title: options.title,
        sourceKey: options.sourceKey,
        lastActiveAt: nowIso(),
        isDirty: options.snapshot.isDirty,
        editorSnapshot: options.snapshot,
        thumbnailImages: cloneEditorTabThumbnailImages(
          options.thumbnailImages ?? {},
        ),
        workerService: options.workerService,
        disposePdfResources: options.disposePdfResources ?? null,
      };

      const currentTabId = activeTabIdRef.current;
      if (options.activate && currentTabId) {
        const currentSession = workspaceBackend.getSession(currentTabId);
        if (currentSession) {
          const { snapshot: currentSnapshot, thumbnailImages } =
            captureSessionState();
          workspaceBackend.updateSession(
            currentTabId,
            patchSession(currentSession, {
              editorSnapshot: currentSnapshot,
              isDirty: currentSnapshot.isDirty,
              thumbnailImages,
              title: currentSnapshot.filename?.trim() || currentSession.title,
            }),
          );
        }
      }

      workspaceBackend.addSession(windowId, session, {
        activate: options.activate,
      });
      if (options.activate) {
        // Mirror the activated tab ref synchronously for the same reason as
        // `activateTab`: follow-up capture/persist work may run before the
        // subscription/effect cycle updates `activeTabId`.
        activeTabIdRef.current = session.id;
        restoreSnapshot(session);
      }
      return session;
    },
    [captureSessionState, restoreSnapshot, windowId, workspaceBackend],
  );

  const removeTab = React.useCallback(
    (tabId: string) => {
      const target = workspaceBackend.removeSession(windowId, tabId);
      disposeEditorTabSessionResources(target);
      return target;
    },
    [windowId, workspaceBackend],
  );

  const disposeAllTabs = React.useCallback(() => {
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
        title: tab.title,
        isDirty: tab.isDirty,
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
      captureCurrentTabIntoState,
      detachTabToNewWindow,
      disposeAllTabs,
      findTabBySourceKey,
      getTabsSnapshot,
      getAdjacentTabId,
      getTabById,
      moveTabToWindow,
      removeTab,
      syncActiveTabMeta,
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
      captureCurrentTabIntoState,
      detachTabToNewWindow,
      disposeAllTabs,
      findTabBySourceKey,
      getTabsSnapshot,
      getAdjacentTabId,
      moveTabToWindow,
      removeTab,
      syncActiveTabMeta,
    ],
  );
}
