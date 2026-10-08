import { useCallback, useRef } from "react";
import { useLocation } from "wouter";
import type { useEditorTabsController } from "../editorTabs/useEditorTabsController";
import type { WorkspaceNavigationOptions, WorkspacePage } from "./types";

export const documentTabPath = (tabId: string) =>
  `/editor/${encodeURIComponent(tabId)}`;

export function parseWorkspacePage(path: string): WorkspacePage | null {
  if (path === "/") return { kind: "home" };
  const match = /^\/editor\/([^/]+)$/.exec(path);
  if (!match) return null;
  try {
    return { kind: "document", tabId: decodeURIComponent(match[1]) };
  } catch {
    return null;
  }
}

type TabsController = Pick<
  ReturnType<typeof useEditorTabsController>,
  | "activateTab"
  | "deactivateTab"
  | "getTabById"
  | "getTabsSnapshot"
  | "removeTab"
  | "getAdjacentTabId"
  | "persistActiveTabView"
>;

/** All navigation commands update the URL and its runtime projection together.
 * History navigation uses reconcile(), never a second navigation effect that
 * writes the active document back into the URL.
 */
export function useWorkspaceNavigation({
  windowId,
  activateTab,
  deactivateTab,
  getTabById,
  getTabsSnapshot,
  removeTab,
  getAdjacentTabId,
  persistActiveTabView,
}: TabsController & { windowId: string }) {
  const [location, navigate] = useLocation();
  const locationRef = useRef(location);
  locationRef.current = location;

  const getPage = useCallback((): WorkspacePage | null => {
    const page = parseWorkspacePage(locationRef.current);
    if (page?.kind === "document") {
      const session = getTabById(page.tabId);
      if (!session || session.windowId !== windowId) return null;
    }
    return page;
  }, [getTabById, windowId]);

  const setPath = useCallback(
    (path: string, replace = false) => {
      if (locationRef.current === path) return;
      locationRef.current = path;
      navigate(path, { replace });
    },
    [navigate],
  );

  const openTab = useCallback(
    (tabId: string, options?: WorkspaceNavigationOptions) => {
      const session = getTabById(tabId);
      if (!session || session.windowId !== windowId) return false;
      setPath(
        documentTabPath(tabId),
        options?.replace ?? locationRef.current === "/editor",
      );
      return activateTab(tabId, options);
    },
    [activateTab, getTabById, setPath, windowId],
  );

  const showHome = useCallback(
    (options?: WorkspaceNavigationOptions) => {
      setPath("/", options?.replace);
      deactivateTab();
    },
    [deactivateTab, setPath],
  );

  const showPendingEditor = useCallback(() => {
    setPath("/editor");
    deactivateTab();
  }, [deactivateTab, setPath]);

  const closeTabImmediately = useCallback(
    (tabId: string) => {
      const page = getPage();
      const wasActive = page?.kind === "document" && page.tabId === tabId;
      const adjacent = getAdjacentTabId(tabId);
      if (wasActive) persistActiveTabView();
      removeTab(tabId);
      const remaining = getTabsSnapshot();
      if (wasActive) {
        const next =
          remaining.find((tab) => tab.id === adjacent) ?? remaining[0];
        if (next) openTab(next.id, { replace: true, skipCaptureCurrent: true });
        else showHome({ replace: true });
      }
      return { isLastTab: remaining.length === 0 };
    },
    [
      getPage,
      getAdjacentTabId,
      persistActiveTabView,
      removeTab,
      getTabsSnapshot,
      openTab,
      showHome,
    ],
  );

  const reconcile = useCallback(
    (isLoading: boolean) => {
      const page = getPage();
      if (page?.kind === "document") {
        activateTab(page.tabId);
        return;
      }
      if (page?.kind === "home") {
        deactivateTab();
        return;
      }
      // Bootstrap/transfer may not have registered its session yet.
      if (isLoading) return;
      if (locationRef.current === "/editor") {
        const recent = getTabsSnapshot().reduce<ReturnType<typeof getTabById>>(
          (latest, tab) =>
            !latest || tab.lastActiveAt > latest.lastActiveAt ? tab : latest,
          null,
        );
        if (recent) {
          openTab(recent.id, { replace: true });
          return;
        }
      }
      showHome({ replace: true });
    },
    [activateTab, deactivateTab, getPage, getTabsSnapshot, openTab, showHome],
  );

  return {
    location,
    page: getPage(),
    getPage,
    openTab,
    showHome,
    showPendingEditor,
    closeTabImmediately,
    reconcile,
  };
}
