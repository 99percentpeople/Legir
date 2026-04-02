import React from "react";
import { toast } from "sonner";
import { createPersistedEditorWorkspaceDraft } from "./persistence";
import type { EditorTabSession } from "./types";
import {
  clearSavedDraftSession,
  persistPlatformWorkspaceSession,
} from "@/services/platform";
import type { EditorActions } from "@/store/useEditorStore";

interface UseWebWorkspacePersistenceOptions {
  platformDocumentSaveMode: "draft" | "file";
  activeTabId: string | null;
  windowTabIds: string[];
  isProcessing: boolean;
  hasPendingWindowBootstrap: boolean;
  pendingIncomingTabsCount: number;
  captureCurrentTabIntoState: () => void;
  getTabsSnapshot: () => EditorTabSession[];
  updateTabSession: (
    tabId: string,
    updates: Partial<EditorTabSession>,
  ) => EditorTabSession | null;
  setState: EditorActions["setState"];
}

export function useWebWorkspacePersistence({
  platformDocumentSaveMode,
  activeTabId,
  windowTabIds,
  isProcessing,
  hasPendingWindowBootstrap,
  pendingIncomingTabsCount,
  captureCurrentTabIntoState,
  getTabsSnapshot,
  updateTabSession,
  setState,
}: UseWebWorkspacePersistenceOptions) {
  const persistTimerRef = React.useRef<number | null>(null);

  const markWorkspaceTabsAsPersisted = React.useCallback(
    (savedAt: Date) => {
      const liveTabs = getTabsSnapshot();

      liveTabs.forEach((tab) => {
        updateTabSession(tab.id, {
          isDirty: false,
          editorSnapshot: {
            ...tab.editorSnapshot,
            isDirty: false,
            lastSavedAt: savedAt,
          },
        });
      });

      setState({
        hasSavedSession: liveTabs.length > 0,
        isDirty: false,
        lastSavedAt: savedAt,
      });
    },
    [getTabsSnapshot, setState, updateTabSession],
  );

  const flushWebWorkspaceSessionPersist = React.useCallback(
    async (options?: { silent?: boolean }) => {
      if (platformDocumentSaveMode !== "draft") return false;

      try {
        if (activeTabId) {
          captureCurrentTabIntoState();
        }

        const liveTabs = getTabsSnapshot();
        if (liveTabs.length === 0) {
          await clearSavedDraftSession();
          setState({ hasSavedSession: false });
          return true;
        }

        const workspaceDraft = createPersistedEditorWorkspaceDraft({
          tabs: liveTabs,
          activeTabId: activeTabId ?? liveTabs[0]?.id ?? null,
        });

        await persistPlatformWorkspaceSession(workspaceDraft);
        markWorkspaceTabsAsPersisted(new Date(workspaceDraft.updatedAt));
        return true;
      } catch (error) {
        console.error("Save workspace draft failed:", error);
        if (!options?.silent) {
          toast.error("Failed to save draft.");
        }
        return false;
      }
    },
    [
      activeTabId,
      captureCurrentTabIntoState,
      getTabsSnapshot,
      markWorkspaceTabsAsPersisted,
      platformDocumentSaveMode,
      setState,
    ],
  );

  const cancelScheduledWebWorkspacePersist = React.useCallback(() => {
    if (persistTimerRef.current === null) return;
    window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = null;
  }, []);

  const requestWebWorkspaceSessionPersist = React.useCallback(
    (options?: { immediate?: boolean; silent?: boolean }) => {
      if (platformDocumentSaveMode !== "draft") return;

      const run = () => {
        persistTimerRef.current = null;
        void flushWebWorkspaceSessionPersist({
          silent: options?.silent,
        });
      };

      cancelScheduledWebWorkspacePersist();

      if (options?.immediate) {
        run();
        return;
      }

      if (windowTabIds.length === 0) return;
      if (isProcessing || hasPendingWindowBootstrap) return;
      if (pendingIncomingTabsCount > 0) return;

      persistTimerRef.current = window.setTimeout(run, 150);
    },
    [
      cancelScheduledWebWorkspacePersist,
      flushWebWorkspaceSessionPersist,
      hasPendingWindowBootstrap,
      isProcessing,
      pendingIncomingTabsCount,
      platformDocumentSaveMode,
      windowTabIds.length,
    ],
  );

  React.useEffect(() => {
    requestWebWorkspaceSessionPersist({
      silent: true,
    });
  }, [activeTabId, requestWebWorkspaceSessionPersist, windowTabIds]);

  React.useEffect(() => {
    return () => {
      cancelScheduledWebWorkspacePersist();
    };
  }, [cancelScheduledWebWorkspacePersist]);

  return React.useMemo(
    () => ({
      cancelScheduledWebWorkspacePersist,
      flushWebWorkspaceSessionPersist,
      requestWebWorkspaceSessionPersist,
    }),
    [
      cancelScheduledWebWorkspacePersist,
      flushWebWorkspaceSessionPersist,
      requestWebWorkspaceSessionPersist,
    ],
  );
}
