import { useCallback, useMemo, useState } from "react";

import { useDesktopCloseRequestHandler } from "./useDesktopCloseRequestHandler";
import type { EditorTabSession } from "@/app/editorTabs/types";

export type CloseRequestScope = "close-tab" | "close-window" | "exit-editor";

export type PendingCloseRequest = {
  scope: CloseRequestScope;
  targetTabIds: string[];
  currentTabId: string;
};

interface UseEditorCloseFlowOptions {
  activeTabId: string | null;
  activateTab: (
    tabId: string,
    options?: {
      skipCaptureCurrent?: boolean;
    },
  ) => boolean;
  captureCurrentTabIntoState: () => void;
  closeAllTabsAndWindow: () => Promise<void>;
  closeAllTabsToLanding: () => void;
  closeTabImmediately: (tabId: string) => { isLastTab: boolean };
  getTabById: (tabId: string | null | undefined) => EditorTabSession | null;
  getTabsSnapshot: () => EditorTabSession[];
  navigateToHome: () => void;
  runPrimarySaveAction: () => Promise<boolean>;
}

export const useEditorCloseFlow = ({
  activeTabId,
  activateTab,
  captureCurrentTabIntoState,
  closeAllTabsAndWindow,
  closeAllTabsToLanding,
  closeTabImmediately,
  getTabById,
  getTabsSnapshot,
  navigateToHome,
  runPrimarySaveAction,
}: UseEditorCloseFlowOptions) => {
  const [pendingCloseRequest, setPendingCloseRequest] =
    useState<PendingCloseRequest | null>(null);

  const startCloseFlow = useCallback(
    async (scope: CloseRequestScope, targetTabIds: string[]) => {
      const uniqueTargetIds = [...new Set(targetTabIds)];
      if (uniqueTargetIds.length === 0) {
        if (scope === "close-window") {
          await closeAllTabsAndWindow();
        } else if (scope === "exit-editor") {
          closeAllTabsToLanding();
        }
        return;
      }

      if (activeTabId) {
        captureCurrentTabIntoState();
      }

      const liveTabs = getTabsSnapshot().filter((tab) =>
        uniqueTargetIds.includes(tab.id),
      );
      if (liveTabs.length === 0) {
        if (scope === "close-window") {
          await closeAllTabsAndWindow();
        } else if (scope === "exit-editor") {
          closeAllTabsToLanding();
        }
        return;
      }

      const dirtyTargetIds = liveTabs
        .filter((tab) => tab.isDirty)
        .map((tab) => tab.id);

      if (dirtyTargetIds.length === 0) {
        if (scope === "close-window") {
          await closeAllTabsAndWindow();
          return;
        }

        for (const tabId of uniqueTargetIds) {
          if (!getTabById(tabId)) continue;
          closeTabImmediately(tabId);
        }

        if (scope === "exit-editor") {
          closeAllTabsToLanding();
        } else if (getTabsSnapshot().length === 0) {
          navigateToHome();
        }
        return;
      }

      const firstDirtyTabId = dirtyTargetIds[0]!;
      if (activeTabId !== firstDirtyTabId) {
        activateTab(firstDirtyTabId, {
          skipCaptureCurrent: true,
        });
      }

      setPendingCloseRequest({
        scope,
        targetTabIds: uniqueTargetIds,
        currentTabId: firstDirtyTabId,
      });
    },
    [
      activeTabId,
      activateTab,
      captureCurrentTabIntoState,
      closeAllTabsAndWindow,
      closeAllTabsToLanding,
      closeTabImmediately,
      getTabById,
      getTabsSnapshot,
      navigateToHome,
    ],
  );

  const onDesktopCloseRequested = useDesktopCloseRequestHandler({
    getTabsSnapshot,
    startCloseFlow,
  });

  const requestCloseTab = useCallback(
    async (tabId: string) => {
      if (!getTabById(tabId)) return;
      await startCloseFlow("close-tab", [tabId]);
    },
    [getTabById, startCloseFlow],
  );

  const closeActiveTabImmediately = useCallback(() => {
    if (!activeTabId) {
      navigateToHome();
      return;
    }

    const result = closeTabImmediately(activeTabId);
    if (result.isLastTab) {
      navigateToHome();
    }
  }, [activeTabId, closeTabImmediately, navigateToHome]);

  const resolveCloseRequest = useCallback(
    async (saveBeforeClose: boolean) => {
      const request = pendingCloseRequest;
      if (!request) return;

      if (activeTabId !== request.currentTabId) {
        activateTab(request.currentTabId, {
          skipCaptureCurrent: true,
        });
      }

      if (saveBeforeClose) {
        const ok = await runPrimarySaveAction();
        if (!ok) return;
      }

      setPendingCloseRequest(null);

      if (request.scope === "close-window") {
        const remainingTargetIds = request.targetTabIds.filter(
          (tabId) => tabId !== request.currentTabId,
        );

        if (remainingTargetIds.length === 0) {
          await closeAllTabsAndWindow();
          return;
        }
      }

      const { isLastTab } = closeTabImmediately(request.currentTabId);
      const remainingTargetIds = request.targetTabIds.filter(
        (tabId) => tabId !== request.currentTabId,
      );

      if (request.scope === "close-tab") {
        if (isLastTab) {
          navigateToHome();
        }
        return;
      }

      if (request.scope === "close-window") {
        const remainingLiveTabs = getTabsSnapshot().filter((tab) =>
          remainingTargetIds.includes(tab.id),
        );

        if (
          remainingLiveTabs.length === 0 ||
          remainingLiveTabs.every((tab) => !tab.isDirty)
        ) {
          await closeAllTabsAndWindow();
          return;
        }
      }

      await startCloseFlow(request.scope, remainingTargetIds);
    },
    [
      activeTabId,
      activateTab,
      closeAllTabsAndWindow,
      closeTabImmediately,
      getTabsSnapshot,
      navigateToHome,
      pendingCloseRequest,
      runPrimarySaveAction,
      startCloseFlow,
    ],
  );

  const dismissCloseRequest = useCallback(() => {
    setPendingCloseRequest(null);
  }, []);

  const pendingCloseDocumentTitle = useMemo(() => {
    return pendingCloseRequest
      ? (getTabById(pendingCloseRequest.currentTabId)?.title ?? null)
      : null;
  }, [getTabById, pendingCloseRequest]);

  return {
    pendingCloseRequest,
    pendingCloseDocumentTitle,
    requestCloseTab,
    closeActiveTabImmediately,
    resolveCloseRequest,
    dismissCloseRequest,
    onDesktopCloseRequested,
  };
};
