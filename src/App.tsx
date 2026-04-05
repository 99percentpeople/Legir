import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";

import KeyboardShortcutsHelp from "./components/KeyboardShortcutsHelp";
import SettingsDialog from "./components/dialogs/SettingsDialog";
import PdfPasswordDialog from "./components/dialogs/PdfPasswordDialog";
import AppRoutes from "./AppRoutes";
import { useLanguage } from "./components/language-provider";
import { useAppInitialization } from "./app/useAppInitialization";
import { useEditorStore } from "./store/useEditorStore";
import { selectAppShellState } from "@/store/selectors";
import { loadPDF, exportPDF } from "./services/pdfService";
import { createPdfWorkerService } from "./services/pdfService/pdfWorkerService";
import { recentFilesService } from "./services/recentFilesService";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { useGlobalProcessingToast } from "./hooks/useGlobalProcessingToast";
import { EditorCloseConfirmDialog } from "./pages/EditorPage/EditorCloseConfirmDialog";
import type {
  EditorMergeWindowTarget,
  EditorTabDropTarget,
} from "./pages/EditorPage/types";
import {
  restorePersistedEditorTabSession,
  type PersistedEditorWorkspaceDraft,
} from "@/app/editorTabs/persistence";
import {
  cloneEditorTabThumbnailImages,
  disposeEditorTabSessionResources,
} from "@/app/editorTabs/sessionResources";
import {
  createEditorTabId,
  createEditorTabSnapshotFromState,
  createLoadedEditorTabSnapshot,
  getEditorTabDisplayTitle,
  getEditorTabSourceKey,
  restoreEditorTabSnapshot,
} from "@/app/editorTabs/storeSnapshot";
import { restoreEditorTabSessionTransfer } from "@/app/editorTabs/transfer";
import {
  consumeEditorTabSessionTransfer,
  deleteEditorTabSessionTransfer,
  saveEditorTabSessionTransfer,
} from "@/app/editorTabs/transferStorage";
import { useEditorTabsController } from "@/app/editorTabs/useEditorTabsController";
import { useWebWorkspacePersistence } from "@/app/editorTabs/useWebWorkspacePersistence";
import type {
  EditorTabDescriptor,
  EditorTabSession,
} from "@/app/editorTabs/types";
import {
  acquirePendingEditorWindowBootstrap,
  applyTauriDocumentUiSession,
  buildEditorWindowBootstrapRoute,
  clearSavedDraftSession,
  destroyPlatformWindow,
  emitTabWorkspaceEvent,
  exportPdfBytes,
  finishPendingEditorWindowBootstrap,
  getPlatformDocumentSaveMode,
  getSavedDraftWorkspace,
  getSavedTauriDocumentUiSession,
  getPlatformWindowId,
  getSavedViewStateForSaveTarget,
  hasPendingEditorWindowBootstrap,
  hasSavedDraftSession,
  isDesktopApp,
  listenForPlatformFileDrop,
  listenForPlatformFileDragState,
  listenForPlatformFocusDocumentRequest,
  listenForTabWorkspaceEvent,
  listenForPlatformCloseRequested,
  listPlatformEditorWindows,
  openFile,
  openFileFromPath,
  openPlatformEditorWindow,
  pickSaveTarget,
  reportPlatformWindowDocuments,
  requestPlatformFocusExistingDocument,
  saveTauriDocumentUiSession,
  saveEditorViewState,
  writeToSaveTarget,
  type PlatformDroppedPdf,
  type SaveTarget,
} from "@/services/platform";
import type { EditorState } from "@/types";

type CloseRequestScope = "close-tab" | "close-window" | "exit-editor";

type PendingCloseRequest = {
  scope: CloseRequestScope;
  targetTabIds: string[];
  currentTabId: string;
};

type ExtractedTransferTab = {
  session: EditorTabSession;
  isLastTab: boolean;
  previousIndex: number;
  wasActive: boolean;
};

const TAB_TRANSFER_ACK_TIMEOUT_MS = 30_000;
const normalizePlatformWindowTitle = (title: string | null | undefined) => {
  const normalizedTitle = title?.trim();
  if (!normalizedTitle) return null;

  const appName = process.env.APP_NAME?.trim();
  if (!appName) return normalizedTitle;
  if (normalizedTitle === appName) return null;

  const suffix = ` - ${appName}`;
  if (!normalizedTitle.endsWith(suffix)) return normalizedTitle;

  const strippedTitle = normalizedTitle.slice(0, -suffix.length).trim();
  return strippedTitle || null;
};

const App: React.FC = () => {
  const { t } = useLanguage();
  const platformDocumentSaveMode = getPlatformDocumentSaveMode();
  const platformWindowId = useMemo(() => getPlatformWindowId(), []);
  const [, navigate] = useLocation();

  const workspaceScrollContainerRef = useRef<HTMLElement | null>(null);
  const loadQueueRef = useRef<Promise<void>>(Promise.resolve());
  const incomingTransferIdsRef = useRef<Set<string>>(new Set());

  useAppEvent(
    "workspace:scrollContainerReady",
    ({ element }) => {
      workspaceScrollContainerRef.current = element;
    },
    { replayLast: true },
  );

  const appShell = useEditorStore(useShallow(selectAppShellState));
  const {
    setState,
    setOptions,
    resetDocument,
    withProcessing,
    isProcessing,
    processingStatus,
    hasSavedSession,
    activeDialog,
    options,
  } = appShell;

  const activeDocumentMeta = useEditorStore(
    useShallow((state) => ({
      filename: state.filename,
      isDirty: state.isDirty,
      pdfBytes: state.pdfBytes,
      pdfFile: state.pdfFile,
      saveTarget: state.saveTarget,
    })),
  );

  useGlobalProcessingToast({
    isProcessing,
    processingStatus,
    defaultMessage: t("common.processing"),
  });

  const [pdfPasswordPrompt, setPdfPasswordPrompt] = useState<{
    id: string;
    reason: "need_password" | "incorrect_password";
    submit: (password: string) => void;
    cancel: () => void;
  } | null>(null);
  const [hasPendingWindowBootstrap, setHasPendingWindowBootstrap] = useState(
    () => hasPendingEditorWindowBootstrap(),
  );
  const [pendingCloseRequest, setPendingCloseRequest] =
    useState<PendingCloseRequest | null>(null);
  const [mergeWindowTargets, setMergeWindowTargets] = useState<
    EditorMergeWindowTarget[]
  >([]);
  const [pendingIncomingTabs, setPendingIncomingTabs] = useState<
    EditorTabDescriptor[]
  >([]);
  const [isFileDragActive, setIsFileDragActive] = useState(false);

  useAppEvent("pdf:passwordRequired", (payload) => {
    setPdfPasswordPrompt(payload);
  });

  const isTauriSaveTarget = (
    target: SaveTarget,
  ): target is { kind: "tauri"; path: string } => {
    return target?.kind === "tauri" && typeof target?.path === "string";
  };

  const captureActiveTabState = useCallback(() => {
    const state = useEditorStore.getState();
    const snapshot = createEditorTabSnapshotFromState({
      state,
      scrollContainer: workspaceScrollContainerRef.current,
    });

    saveEditorViewState({
      saveTarget: snapshot.saveTarget,
      pagesLength: snapshot.pages.length,
      scale: snapshot.scale,
      currentPageIndex: snapshot.currentPageIndex,
      scrollContainer: workspaceScrollContainerRef.current,
    });

    if (snapshot.saveTarget?.kind === "tauri") {
      saveTauriDocumentUiSession(snapshot.saveTarget.path, snapshot);
    }

    return {
      snapshot,
      thumbnailImages: cloneEditorTabThumbnailImages(state.thumbnailImages),
    };
  }, []);

  const restoreActiveTabSnapshot = useCallback((session: EditorTabSession) => {
    const store = useEditorStore.getState();
    restoreEditorTabSnapshot(session.editorSnapshot, {
      hasSavedSession: store.hasSavedSession,
      isFullscreen: store.isFullscreen,
      thumbnailImages: session.thumbnailImages,
      workerService: session.workerService,
    });
  }, []);

  const tabsController = useEditorTabsController({
    windowId: platformWindowId,
    captureSessionState: captureActiveTabState,
    restoreSnapshot: restoreActiveTabSnapshot,
  });
  const {
    backend: tabsBackend,
    activeTab,
    activeTabId,
    addTab,
    activateTab,
    captureCurrentTabIntoState,
    disposeAllTabs,
    findTabBySourceKey,
    getAdjacentTabId,
    getTabById,
    getTabsSnapshot,
    moveTabToWindow,
    removeTab,
    syncActiveTabMeta,
    tabs,
    tabDescriptors,
    windowLayout,
  } = tabsController;

  const registerPendingIncomingTab = useCallback(
    (options: { sessionId: string; title: string; isDirty: boolean }) => {
      setPendingIncomingTabs((prev) => {
        if (
          prev.some((tab) => tab.pendingTransferSessionId === options.sessionId)
        ) {
          return prev;
        }

        return [
          ...prev,
          {
            id: `pending-transfer:${options.sessionId}`,
            pendingTransferSessionId: options.sessionId,
            title: options.title,
            isDirty: options.isDirty,
            isActive: false,
            isPendingTransfer: true,
          },
        ];
      });
    },
    [],
  );

  const clearPendingIncomingTab = useCallback((sessionId: string) => {
    setPendingIncomingTabs((prev) =>
      prev.filter((tab) => tab.pendingTransferSessionId !== sessionId),
    );
  }, []);

  const editorTabDescriptors = useMemo(() => {
    const liveTabIds = new Set(tabDescriptors.map((tab) => tab.id));
    const visiblePendingTabs = pendingIncomingTabs.filter((tab) => {
      const sessionId = tab.pendingTransferSessionId;
      return !sessionId || !liveTabIds.has(sessionId);
    });

    return [...tabDescriptors, ...visiblePendingTabs];
  }, [pendingIncomingTabs, tabDescriptors]);

  const {
    cancelScheduledWebWorkspacePersist,
    flushWebWorkspaceSessionPersist,
    requestWebWorkspaceSessionPersist,
  } = useWebWorkspacePersistence({
    platformDocumentSaveMode,
    activeTabId,
    windowTabIds: windowLayout.tabIds,
    isProcessing,
    hasPendingWindowBootstrap,
    pendingIncomingTabsCount: pendingIncomingTabs.length,
    captureCurrentTabIntoState,
    getTabsSnapshot,
    updateTabSession: tabsBackend.updateSession,
    setState,
  });

  const createTransferAckWaiter = useCallback(
    (options: { transferId: string; sessionId: string }) => {
      let settled = false;
      let timeoutId: number | null = null;
      let unlisten: (() => void) | null = null;
      let resolvePromise: ((acknowledged: boolean) => void) | null = null;

      const settle = (acknowledged: boolean) => {
        if (settled) return;
        settled = true;

        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }

        try {
          unlisten?.();
        } catch {
          // ignore
        }

        resolvePromise?.(acknowledged);
      };

      const promise = new Promise<boolean>((resolve) => {
        resolvePromise = resolve;
        timeoutId = window.setTimeout(() => {
          settle(false);
        }, TAB_TRANSFER_ACK_TIMEOUT_MS);

        void listenForTabWorkspaceEvent((payload) => {
          if (payload.kind !== "session-transfer-ack") return;
          if (payload.targetWindowId !== platformWindowId) return;
          if (payload.transferId !== options.transferId) return;
          if (payload.sessionId !== options.sessionId) return;
          settle(true);
        }, platformWindowId).then((nextUnlisten) => {
          unlisten = nextUnlisten;
          if (settled) {
            try {
              nextUnlisten();
            } catch {
              // ignore
            }
          }
        });
      });

      return {
        promise,
        cancel: () => {
          settle(false);
        },
      };
    },
    [platformWindowId],
  );

  const refreshMergeWindowTargets = useCallback(async () => {
    if (!isDesktopApp()) {
      setMergeWindowTargets([]);
      return;
    }

    try {
      const windows = await listPlatformEditorWindows();
      const nextTargets = windows
        .map((windowInfo, index) => {
          const normalizedTitle = normalizePlatformWindowTitle(
            windowInfo.title,
          );
          const windowLabel = t("tabs.window_n", {
            index: index + 1,
          });

          return {
            windowId: windowInfo.windowId,
            label: normalizedTitle
              ? `${windowLabel} · ${normalizedTitle}`
              : windowLabel,
          };
        })
        .filter((target) => target.windowId !== platformWindowId);

      setMergeWindowTargets(nextTargets);
    } catch (error) {
      console.error("Failed to refresh merge window targets:", error);
    }
  }, [platformWindowId, t]);

  const importTransferredTab = useCallback(
    async (
      transferId: string,
      options?: {
        pendingSessionId?: string;
      },
    ) => {
      if (incomingTransferIdsRef.current.has(transferId)) {
        return false;
      }

      incomingTransferIdsRef.current.add(transferId);

      try {
        const transfer = await consumeEditorTabSessionTransfer(transferId);
        if (!transfer) {
          return false;
        }

        const existingTab = getTabById(transfer.sessionId);
        if (existingTab) {
          clearPendingIncomingTab(existingTab.id);
          activateTab(existingTab.id, {
            skipCaptureCurrent: true,
          });
        } else {
          const restored = await restoreEditorTabSessionTransfer(transfer);
          clearPendingIncomingTab(restored.id);
          addTab({
            id: restored.id,
            title: restored.title,
            sourceKey: restored.sourceKey,
            snapshot: restored.snapshot,
            thumbnailImages: {},
            workerService: restored.workerService,
            disposePdfResources: restored.disposePdfResources,
            activate: true,
          });
        }

        navigate("/editor");

        if (
          isDesktopApp() &&
          transfer.sourceWindowId &&
          transfer.sourceWindowId !== platformWindowId
        ) {
          await emitTabWorkspaceEvent(
            {
              kind: "session-transfer-ack",
              sourceWindowId: platformWindowId,
              targetWindowId: transfer.sourceWindowId,
              sessionId: transfer.sessionId,
              transferId,
            },
            transfer.sourceWindowId,
          );
        }

        return true;
      } catch (error) {
        console.error("Failed to import transferred tab:", error);
        toast.error("Failed to open transferred tab.");
        return false;
      } finally {
        if (options?.pendingSessionId) {
          clearPendingIncomingTab(options.pendingSessionId);
        }
        incomingTransferIdsRef.current.delete(transferId);
      }
    },
    [
      activateTab,
      addTab,
      clearPendingIncomingTab,
      getTabById,
      navigate,
      platformWindowId,
    ],
  );

  const focusExistingTabBySourceKey = useCallback(
    async (
      sourceKey: string | null,
      options?: {
        skipLocalCheck?: boolean;
      },
    ) => {
      if (!sourceKey) return false;

      if (!options?.skipLocalCheck) {
        const localMatch = findTabBySourceKey(sourceKey);
        if (localMatch) {
          activateTab(localMatch.id);
          navigate("/editor");
          return true;
        }
      }

      if (!isDesktopApp()) {
        return false;
      }

      try {
        return await requestPlatformFocusExistingDocument(sourceKey);
      } catch (error) {
        console.error("Failed to focus existing platform document:", error);
        return false;
      }
    },
    [activateTab, findTabBySourceKey, navigate],
  );

  useEffect(() => {
    if (!activeTabId) return;

    syncActiveTabMeta({
      title: getEditorTabDisplayTitle(activeDocumentMeta.filename),
      isDirty: activeDocumentMeta.isDirty,
      sourceKey: getEditorTabSourceKey({
        saveTarget: activeDocumentMeta.saveTarget,
        pdfFile: activeDocumentMeta.pdfFile,
      }),
    });
  }, [
    activeDocumentMeta.filename,
    activeDocumentMeta.isDirty,
    activeDocumentMeta.pdfFile,
    activeDocumentMeta.saveTarget,
    activeTabId,
    syncActiveTabMeta,
  ]);

  useEffect(() => {
    if (windowLayout.tabIds.length === 0) return;
    void emitTabWorkspaceEvent({
      kind: "layout-changed",
      sourceWindowId: windowLayout.windowId,
      activeTabId,
      tabIds: windowLayout.tabIds,
    });
  }, [activeTabId, windowLayout.tabIds, windowLayout.windowId]);

  useEffect(() => {
    void refreshMergeWindowTargets();
  }, [refreshMergeWindowTargets]);

  useEffect(() => {
    if (!isDesktopApp()) return;

    let cancelled = false;
    let unlisten: null | (() => void) = null;

    void (async () => {
      unlisten = await listenForTabWorkspaceEvent((payload) => {
        if (payload.kind !== "session-moved") return;
        if (payload.targetWindowId !== platformWindowId) return;
        if (getTabsSnapshot().length === 0) {
          navigate("/editor");
        }
        registerPendingIncomingTab({
          sessionId: payload.sessionId,
          title: payload.title,
          isDirty: payload.isDirty,
        });
        void importTransferredTab(payload.transferId, {
          pendingSessionId: payload.sessionId,
        });
      }, platformWindowId);

      if (cancelled) {
        try {
          unlisten?.();
        } catch {
          // ignore
        }
        unlisten = null;
      }
    })();

    return () => {
      cancelled = true;
      try {
        unlisten?.();
      } catch {
        // ignore
      }
    };
  }, [
    getTabsSnapshot,
    importTransferredTab,
    navigate,
    platformWindowId,
    registerPendingIncomingTab,
  ]);

  useEffect(() => {
    if (!isDesktopApp()) return;

    let cancelled = false;
    let unlisten: null | (() => void) = null;

    void (async () => {
      unlisten = await listenForPlatformFocusDocumentRequest((payload) => {
        const existingTab = findTabBySourceKey(payload.sourceKey);
        if (!existingTab) return;

        activateTab(existingTab.id);
        navigate("/editor");
      });

      if (cancelled) {
        try {
          unlisten?.();
        } catch {
          // ignore
        }
        unlisten = null;
      }
    })();

    return () => {
      cancelled = true;
      try {
        unlisten?.();
      } catch {
        // ignore
      }
    };
  }, [activateTab, findTabBySourceKey, navigate]);

  useEffect(() => {
    if (!isDesktopApp()) return;

    const sourceKeys = tabs
      .map((tab) => tab.sourceKey)
      .filter((sourceKey): sourceKey is string => !!sourceKey);

    void reportPlatformWindowDocuments(sourceKeys).catch((error) => {
      console.error("Failed to report platform window documents:", error);
    });
  }, [tabs]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: null | (() => void) = null;

    void (async () => {
      unlisten = await listenForPlatformFileDragState(
        (nextActive) => {
          setIsFileDragActive(nextActive);
        },
        {
          getTargetElement: () => workspaceScrollContainerRef.current,
        },
      );

      if (cancelled) {
        try {
          unlisten?.();
        } catch {
          // ignore
        }
        unlisten = null;
      }
    })();

    return () => {
      cancelled = true;
      setIsFileDragActive(false);
      try {
        unlisten?.();
      } catch {
        // ignore
      }
    };
  }, []);

  useEffect(() => {
    if (!isDesktopApp()) return;

    let cancelled = false;
    let unlisten: null | (() => void) = null;

    void (async () => {
      unlisten = await listenForTabWorkspaceEvent(() => {
        void refreshMergeWindowTargets();
      });

      if (cancelled) {
        try {
          unlisten?.();
        } catch {
          // ignore
        }
        unlisten = null;
      }
    })();

    return () => {
      cancelled = true;
      try {
        unlisten?.();
      } catch {
        // ignore
      }
    };
  }, [refreshMergeWindowTargets]);

  useEffect(() => {
    return () => {
      disposeAllTabs();
    };
  }, [disposeAllTabs]);

  const closeAllTabsToLanding = useCallback(() => {
    recentFilesService.cancelPreviewTasks();
    cancelScheduledWebWorkspacePersist();
    disposeAllTabs();
    resetDocument();
    if (platformDocumentSaveMode === "draft") {
      void clearSavedDraftSession();
    }
    setState({ hasSavedSession: false });
    navigate("/");
  }, [
    cancelScheduledWebWorkspacePersist,
    clearSavedDraftSession,
    disposeAllTabs,
    navigate,
    platformDocumentSaveMode,
    resetDocument,
    setState,
  ]);

  const closeAllTabsAndWindow = useCallback(async () => {
    recentFilesService.cancelPreviewTasks();
    cancelScheduledWebWorkspacePersist();
    await destroyPlatformWindow();
  }, [cancelScheduledWebWorkspacePersist, destroyPlatformWindow]);

  const closeTabImmediately = useCallback(
    (tabId: string) => {
      const nextTabId = getAdjacentTabId(tabId);
      const removingActiveTab = activeTabId === tabId;

      removeTab(tabId);

      const remainingTabs = getTabsSnapshot();
      if (removingActiveTab) {
        const nextActiveTabId =
          (nextTabId &&
            remainingTabs.some((tab) => tab.id === nextTabId) &&
            nextTabId) ||
          remainingTabs[0]?.id ||
          null;

        if (nextActiveTabId) {
          activateTab(nextActiveTabId, {
            skipCaptureCurrent: true,
          });
        } else {
          resetDocument();
          setState({ hasSavedSession: false });
        }
      }

      if (platformDocumentSaveMode === "draft") {
        if (remainingTabs.length === 0) {
          cancelScheduledWebWorkspacePersist();
          void clearSavedDraftSession();
          setState({ hasSavedSession: false });
        } else {
          requestWebWorkspaceSessionPersist({
            immediate: true,
            silent: true,
          });
        }
      }

      return {
        isLastTab: remainingTabs.length === 0,
      };
    },
    [
      activateTab,
      activeTabId,
      cancelScheduledWebWorkspacePersist,
      clearSavedDraftSession,
      getAdjacentTabId,
      getTabsSnapshot,
      platformDocumentSaveMode,
      requestWebWorkspaceSessionPersist,
      removeTab,
      resetDocument,
      setState,
    ],
  );

  const extractTransferSourceTab = useCallback(
    (tabId: string): ExtractedTransferTab | null => {
      const tabsBeforeRemoval = getTabsSnapshot();
      const previousIndex = tabsBeforeRemoval.findIndex(
        (tab) => tab.id === tabId,
      );
      if (previousIndex < 0) return null;

      const wasActive = activeTabId === tabId;
      const nextTabId =
        tabsBeforeRemoval[previousIndex + 1]?.id ??
        tabsBeforeRemoval[previousIndex - 1]?.id ??
        null;

      const extracted = tabsBackend.removeSession(platformWindowId, tabId);
      if (!extracted) return null;

      const remainingTabs = getTabsSnapshot();
      if (wasActive) {
        if (nextTabId && remainingTabs.some((tab) => tab.id === nextTabId)) {
          activateTab(nextTabId, {
            skipCaptureCurrent: true,
          });
        } else {
          resetDocument();
          setState({ hasSavedSession: hasSavedDraftSession() });
        }
      }

      return {
        session: extracted,
        isLastTab: remainingTabs.length === 0,
        previousIndex,
        wasActive,
      };
    },
    [
      activeTabId,
      activateTab,
      getTabsSnapshot,
      platformWindowId,
      resetDocument,
      setState,
      tabsBackend,
    ],
  );

  const restoreTransferredSourceTab = useCallback(
    (extractedTab: ExtractedTransferTab) => {
      tabsBackend.addSession(platformWindowId, extractedTab.session, {
        activate: false,
        targetIndex: extractedTab.previousIndex,
      });

      if (extractedTab.wasActive || activeTabId === null) {
        activateTab(extractedTab.session.id, {
          skipCaptureCurrent: true,
        });
        navigate("/editor");
      }
    },
    [activeTabId, activateTab, navigate, platformWindowId, tabsBackend],
  );

  const commitTransferredSourceTab = useCallback(
    async (extractedTab: ExtractedTransferTab) => {
      disposeEditorTabSessionResources(extractedTab.session);

      if (!extractedTab.isLastTab) return;

      if (!isDesktopApp()) {
        navigate("/");
        return;
      }

      await destroyPlatformWindow();
    },
    [destroyPlatformWindow, navigate],
  );

  const enqueueLoadTask = useCallback((task: () => Promise<void>) => {
    loadQueueRef.current = loadQueueRef.current
      .catch(() => {
        // keep queue alive
      })
      .then(task);
    return loadQueueRef.current;
  }, []);

  const restoreWorkspaceDraft = useCallback(
    async (workspaceDraft: PersistedEditorWorkspaceDraft) => {
      if (workspaceDraft.tabs.length === 0) {
        await clearSavedDraftSession();
        setState({ hasSavedSession: false });
        return false;
      }

      const desiredActiveTabId =
        workspaceDraft.activeTabId &&
        workspaceDraft.tabs.some((tab) => tab.id === workspaceDraft.activeTabId)
          ? workspaceDraft.activeTabId
          : (workspaceDraft.tabs[0]?.id ?? null);

      let restoredAnyTab = false;

      await enqueueLoadTask(async () => {
        const addedTabIds: string[] = [];

        try {
          await withProcessing(t("app.loading_draft"), async () => {
            for (const [index, persistedTab] of workspaceDraft.tabs.entries()) {
              const restoredTab =
                await restorePersistedEditorTabSession(persistedTab);

              addTab({
                id: restoredTab.id,
                title: restoredTab.title,
                sourceKey: restoredTab.sourceKey,
                snapshot: restoredTab.snapshot,
                thumbnailImages: {},
                workerService: restoredTab.workerService,
                disposePdfResources: restoredTab.disposePdfResources,
                activate: index === 0 || restoredTab.id === desiredActiveTabId,
              });
              addedTabIds.push(restoredTab.id);
            }

            if (
              desiredActiveTabId &&
              desiredActiveTabId !== addedTabIds[addedTabIds.length - 1]
            ) {
              activateTab(desiredActiveTabId, {
                skipCaptureCurrent: true,
              });
            }

            restoredAnyTab = addedTabIds.length > 0;
            navigate("/editor");
          });
        } catch (error) {
          addedTabIds
            .slice()
            .reverse()
            .forEach((tabId) => {
              removeTab(tabId);
            });
          throw error;
        }
      });

      return restoredAnyTab;
    },
    [
      activateTab,
      addTab,
      enqueueLoadTask,
      navigate,
      removeTab,
      setState,
      t,
      withProcessing,
    ],
  );

  const openLoadedDocumentInTab = useCallback(
    async (options: {
      input: File | Uint8Array;
      pdfFile: File | null;
      filename: string;
      saveTarget: SaveTarget | null;
      skipInitialSourceKeyLookup?: boolean;
    }) => {
      const sourceKey = getEditorTabSourceKey({
        saveTarget: options.saveTarget,
        pdfFile: options.pdfFile,
      });

      if (
        !options.skipInitialSourceKeyLookup &&
        (await focusExistingTabBySourceKey(sourceKey))
      ) {
        return;
      }

      await enqueueLoadTask(async () => {
        const workerService = createPdfWorkerService();
        let keepWorker = false;

        const queuedLocalMatch = sourceKey
          ? findTabBySourceKey(sourceKey)
          : null;
        if (queuedLocalMatch) {
          activateTab(queuedLocalMatch.id);
          navigate("/editor");
          workerService.destroy();
          return;
        }

        recentFilesService.cancelPreviewTasks();

        try {
          await withProcessing(t("app.parsing"), async () => {
            const {
              pdfBytes,
              pages,
              fields,
              annotations,
              preservedSourceAnnotations,
              metadata,
              outline,
              openPassword,
              dispose,
            } = await loadPDF(options.input, { workerService });

            const persistedViewState =
              options.saveTarget?.kind === "tauri"
                ? getSavedViewStateForSaveTarget(options.saveTarget)
                : null;
            const persistedDocumentUiSession =
              options.saveTarget?.kind === "tauri"
                ? getSavedTauriDocumentUiSession(options.saveTarget.path)
                : null;
            const persistedPendingViewState =
              persistedDocumentUiSession?.pendingViewStateRestore ??
              (persistedViewState
                ? {
                    scale: persistedViewState.scale,
                    scrollLeft: persistedViewState.scrollLeft,
                    scrollTop: persistedViewState.scrollTop,
                  }
                : null);

            const currentPageIndex =
              typeof persistedDocumentUiSession?.currentPageIndex === "number"
                ? Math.max(
                    0,
                    Math.min(
                      pages.length - 1,
                      Math.floor(persistedDocumentUiSession.currentPageIndex),
                    ),
                  )
                : typeof persistedViewState?.pageIndex === "number"
                  ? Math.max(
                      0,
                      Math.min(
                        pages.length - 1,
                        Math.floor(persistedViewState.pageIndex),
                      ),
                    )
                  : 0;

            const snapshot = createLoadedEditorTabSnapshot({
              pdfFile: options.pdfFile,
              pdfBytes,
              pdfOpenPassword: openPassword ?? null,
              metadata,
              filename: options.filename,
              saveTarget: options.saveTarget,
              pages,
              fields,
              annotations,
              preservedSourceAnnotations,
              outline,
              currentPageIndex,
              pendingViewStateRestore: persistedPendingViewState,
            });
            const hydratedSnapshot =
              persistedDocumentUiSession !== null
                ? applyTauriDocumentUiSession(snapshot, {
                    ...persistedDocumentUiSession,
                    currentPageIndex,
                    pendingViewStateRestore: persistedPendingViewState,
                  })
                : snapshot;

            const postLoadLocalMatch = sourceKey
              ? findTabBySourceKey(sourceKey)
              : null;
            if (postLoadLocalMatch) {
              activateTab(postLoadLocalMatch.id);
              navigate("/editor");
              dispose();
              workerService.destroy();
              return;
            }

            if (
              await focusExistingTabBySourceKey(sourceKey, {
                skipLocalCheck: true,
              })
            ) {
              dispose();
              workerService.destroy();
              return;
            }

            addTab({
              id: createEditorTabId(),
              title: getEditorTabDisplayTitle(options.filename),
              sourceKey,
              snapshot: hydratedSnapshot,
              thumbnailImages: {},
              workerService,
              disposePdfResources: dispose,
              activate: true,
            });
            keepWorker = true;

            if (options.saveTarget?.kind === "tauri") {
              recentFilesService.upsertWithBytesPreview({
                path: options.saveTarget.path,
                filename: options.filename,
                pdfBytes,
                targetWidth: 240,
              });
            }

            requestWebWorkspaceSessionPersist({
              immediate: true,
              silent: true,
            });

            navigate("/editor");
          });
        } catch (error) {
          console.error("Error loading PDF:", error);
          toast.error(t("app.load_error"));
        } finally {
          if (!keepWorker) {
            workerService.destroy();
          }
        }
      });
    },
    [
      activateTab,
      addTab,
      enqueueLoadTask,
      findTabBySourceKey,
      focusExistingTabBySourceKey,
      navigate,
      setState,
      t,
      requestWebWorkspaceSessionPersist,
      withProcessing,
    ],
  );

  const handleUpload = useCallback(
    async (file: File) => {
      await openLoadedDocumentInTab({
        input: file,
        pdfFile: file,
        filename: file.name,
        saveTarget: null,
      });
    },
    [openLoadedDocumentInTab],
  );

  const handleOpen = useCallback(async () => {
    const picked = await openFile({
      filters: [{ name: "PDF Document", extensions: ["pdf"] }],
    });
    if (!picked) return;

    await openLoadedDocumentInTab({
      input: picked.bytes,
      pdfFile: null,
      filename: picked.filename,
      saveTarget: picked.filePath
        ? { kind: "tauri", path: picked.filePath }
        : picked.handle
          ? { kind: "web", handle: picked.handle }
          : null,
    });
  }, [openLoadedDocumentInTab]);

  const handleOpenRecent = useCallback(
    async (filePath: string) => {
      if (await focusExistingTabBySourceKey(`tauri:${filePath}`)) {
        return;
      }

      const picked = await openFileFromPath(filePath);
      await openLoadedDocumentInTab({
        input: picked.bytes,
        pdfFile: null,
        filename: picked.filename,
        saveTarget: { kind: "tauri", path: filePath },
        skipInitialSourceKeyLookup: true,
      });
    },
    [focusExistingTabBySourceKey, openLoadedDocumentInTab],
  );

  const openDroppedPdfPath = useCallback(
    async (filePath: string) => {
      if (!filePath.toLowerCase().endsWith(".pdf")) {
        toast.error("Only PDF files are supported.");
        return;
      }

      await handleOpenRecent(filePath);
    },
    [handleOpenRecent],
  );

  const openDroppedPdf = useCallback(
    async (payload: PlatformDroppedPdf) => {
      if (payload.kind === "path") {
        await openDroppedPdfPath(payload.filePath);
        return;
      }

      const file = payload.file;
      if (
        file.type !== "application/pdf" &&
        !file.name.trim().toLowerCase().endsWith(".pdf")
      ) {
        toast.error("Only PDF files are supported.");
        return;
      }

      await handleUpload(file);
    },
    [handleUpload, openDroppedPdfPath],
  );

  useEffect(() => {
    let cancelled = false;
    let unlisten: null | (() => void) = null;

    void (async () => {
      unlisten = await listenForPlatformFileDrop(
        (payload) => {
          const { isProcessing } = useEditorStore.getState();
          if (isProcessing) return;
          void openDroppedPdf(payload);
        },
        {
          getTargetElement: () => workspaceScrollContainerRef.current,
        },
      );

      if (cancelled) {
        try {
          unlisten?.();
        } catch {
          // ignore
        }
        unlisten = null;
      }
    })();

    return () => {
      cancelled = true;
      try {
        unlisten?.();
      } catch {
        // ignore
      }
    };
  }, [openDroppedPdf]);

  const importStartupOpenDocument = useCallback(
    async (filePath: string) => {
      if (await focusExistingTabBySourceKey(`tauri:${filePath}`)) {
        return;
      }

      const picked = await openFileFromPath(filePath);
      await openLoadedDocumentInTab({
        input: picked.bytes,
        pdfFile: null,
        filename: picked.filename,
        saveTarget: { kind: "tauri", path: filePath },
        skipInitialSourceKeyLookup: true,
      });
    },
    [focusExistingTabBySourceKey, openLoadedDocumentInTab],
  );

  useEffect(() => {
    if (!hasPendingWindowBootstrap) return;

    let cancelled = false;

    void (async () => {
      const { bootstrap, completion } = acquirePendingEditorWindowBootstrap();
      if (!bootstrap) {
        await completion;
        if (!cancelled) {
          setHasPendingWindowBootstrap(false);
        }
        return;
      }

      try {
        if (bootstrap.kind === "startup-open") {
          await importStartupOpenDocument(bootstrap.filePath);
        } else if (bootstrap.kind === "tab-transfer") {
          await importTransferredTab(bootstrap.transferId);
        }
      } catch (error) {
        console.error("Failed to consume window bootstrap:", error);
        toast.error(t("app.load_error"));
      } finally {
        finishPendingEditorWindowBootstrap();
        if (!cancelled) {
          setHasPendingWindowBootstrap(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    hasPendingWindowBootstrap,
    importStartupOpenDocument,
    importTransferredTab,
    t,
  ]);

  useAppInitialization({
    setState,
  });

  const handleResumeSession = useCallback(async () => {
    const workspaceDraft = await getSavedDraftWorkspace();
    if (!workspaceDraft?.tabs.length) {
      await clearSavedDraftSession();
      setState({ hasSavedSession: false });
      return;
    }

    try {
      const restored = await restoreWorkspaceDraft(workspaceDraft);
      if (restored) {
        return;
      }
      await clearSavedDraftSession();
      setState({ hasSavedSession: false });
    } catch (error) {
      console.error("Failed to resume workspace session:", error);
      toast.error(t("app.load_error"));
    }
  }, [clearSavedDraftSession, restoreWorkspaceDraft, setState, t]);

  const handleDetachTabToNewWindow = useCallback(
    async (tabId: string) => {
      if (!isDesktopApp()) return;

      captureCurrentTabIntoState();
      const session = getTabById(tabId);
      if (!session) return;

      const transfer = await saveEditorTabSessionTransfer(session);
      const ackWaiter = createTransferAckWaiter({
        transferId: transfer.transferId,
        sessionId: session.id,
      });
      let extractedTab: ExtractedTransferTab | null = null;

      try {
        const route = buildEditorWindowBootstrapRoute({
          kind: "tab-transfer",
          transferId: transfer.transferId,
        });

        const opened = await openPlatformEditorWindow({
          route,
          title: session.title,
          focus: true,
          inheritCurrentWindowState: true,
        });

        if (!opened.ok) {
          ackWaiter.cancel();
          await deleteEditorTabSessionTransfer(transfer.transferId);
          toast.error("Failed to open a new editor window.");
          return;
        }

        extractedTab = extractTransferSourceTab(session.id);
        if (!extractedTab) {
          ackWaiter.cancel();
          await deleteEditorTabSessionTransfer(transfer.transferId);
          toast.error("Failed to detach the selected tab.");
          return;
        }

        const acknowledged = await ackWaiter.promise;
        if (!acknowledged) {
          restoreTransferredSourceTab(extractedTab);
          await deleteEditorTabSessionTransfer(transfer.transferId);
          toast.error("Timed out while moving the tab into a new window.");
          return;
        }

        await commitTransferredSourceTab(extractedTab);
      } catch (error) {
        ackWaiter.cancel();
        if (extractedTab) {
          restoreTransferredSourceTab(extractedTab);
        }
        await deleteEditorTabSessionTransfer(transfer.transferId);
        console.error("Failed to detach tab:", error);
        toast.error("Failed to detach the selected tab.");
      }
    },
    [
      captureCurrentTabIntoState,
      commitTransferredSourceTab,
      createTransferAckWaiter,
      extractTransferSourceTab,
      getTabById,
      restoreTransferredSourceTab,
    ],
  );

  const handleMergeTabToWindow = useCallback(
    async (tabId: string, targetWindowId: string) => {
      if (!isDesktopApp() || targetWindowId === platformWindowId) {
        return;
      }

      captureCurrentTabIntoState();
      const session = getTabById(tabId);
      if (!session) return;

      const availableWindows = await listPlatformEditorWindows();
      if (
        !availableWindows.some((window) => window.windowId === targetWindowId)
      ) {
        await refreshMergeWindowTargets();
        toast.error("The selected target window is no longer available.");
        return;
      }

      const transfer = await saveEditorTabSessionTransfer(session);
      const ackWaiter = createTransferAckWaiter({
        transferId: transfer.transferId,
        sessionId: session.id,
      });
      let extractedTab: ExtractedTransferTab | null = null;

      try {
        const opened = await openPlatformEditorWindow({
          windowId: targetWindowId,
          route: "/",
          focus: true,
        });

        if (!opened.ok) {
          ackWaiter.cancel();
          await deleteEditorTabSessionTransfer(transfer.transferId);
          toast.error("Failed to focus the target editor window.");
          return;
        }

        extractedTab = extractTransferSourceTab(session.id);
        if (!extractedTab) {
          ackWaiter.cancel();
          await deleteEditorTabSessionTransfer(transfer.transferId);
          toast.error("Failed to merge the selected tab.");
          return;
        }

        await emitTabWorkspaceEvent(
          {
            kind: "session-moved",
            sourceWindowId: platformWindowId,
            targetWindowId,
            sessionId: session.id,
            transferId: transfer.transferId,
            title: session.title,
            isDirty: session.isDirty,
          },
          targetWindowId,
        );

        const acknowledged = await ackWaiter.promise;
        if (!acknowledged) {
          restoreTransferredSourceTab(extractedTab);
          await deleteEditorTabSessionTransfer(transfer.transferId);
          toast.error(
            "Timed out while merging the tab into the selected window.",
          );
          return;
        }

        await commitTransferredSourceTab(extractedTab);
      } catch (error) {
        ackWaiter.cancel();
        if (extractedTab) {
          restoreTransferredSourceTab(extractedTab);
        }
        await deleteEditorTabSessionTransfer(transfer.transferId);
        console.error("Failed to merge tab:", error);
        toast.error("Failed to merge the selected tab.");
      }
    },
    [
      captureCurrentTabIntoState,
      commitTransferredSourceTab,
      createTransferAckWaiter,
      extractTransferSourceTab,
      getTabById,
      platformWindowId,
      refreshMergeWindowTargets,
      restoreTransferredSourceTab,
    ],
  );

  const handleMoveTab = useCallback(
    (tabId: string, target: EditorTabDropTarget) => {
      if (target.intent !== "reorder") {
        return;
      }

      if (target.windowId !== platformWindowId) {
        return;
      }

      captureCurrentTabIntoState();
      moveTabToWindow(tabId, target.windowId, target.targetIndex);
    },
    [captureCurrentTabIntoState, moveTabToWindow, platformWindowId],
  );

  const generatePDF = useCallback(async () => {
    const snapshot = useEditorStore.getState();
    if (!snapshot.pdfBytes) return null;

    return await exportPDF(
      snapshot.pdfBytes,
      snapshot.fields,
      snapshot.metadata,
      snapshot.annotations,
      undefined,
      {
        openPassword: snapshot.pdfOpenPassword,
        exportPassword: snapshot.exportPassword,
        removeTextUnderFlattenedFreetext:
          snapshot.options.removeTextUnderFlattenedFreetext,
        preservedSourceAnnotations: snapshot.preservedSourceAnnotations,
      },
    );
  }, []);

  const handleSaveAs = useCallback(async (): Promise<boolean> => {
    const snapshot = useEditorStore.getState();
    if (!snapshot.pdfBytes) return false;

    return await withProcessing(t("app.generating"), async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const modifiedBytes = await generatePDF();
      if (!modifiedBytes) return false;

      const target = await pickSaveTarget({
        suggestedName: snapshot.filename || "document.pdf",
        filters: [{ name: "PDF Document", extensions: ["pdf"] }],
      });
      if (!target) return false;

      await writeToSaveTarget(target, modifiedBytes);

      const nextFilename = (() => {
        if (isTauriSaveTarget(target)) {
          const normalized = target.path.replace(/\\/g, "/");
          const parts = normalized.split("/").filter(Boolean);
          return parts.length > 0 ? parts[parts.length - 1] : snapshot.filename;
        }
        if (target.kind === "web") {
          return target.handle?.name || snapshot.filename;
        }
        return snapshot.filename;
      })();

      setState({
        saveTarget: target as unknown as EditorState["saveTarget"],
        filename: nextFilename,
        lastSavedAt: new Date(),
        isDirty: false,
      });

      if (isTauriSaveTarget(target)) {
        recentFilesService.upsertWithBytesPreview({
          path: target.path,
          filename: nextFilename || "document.pdf",
          pdfBytes: modifiedBytes,
          targetWidth: 240,
          renderAnnotations: true,
          forcePreviewRender: true,
        });

        const liveSnapshot = useEditorStore.getState();
        saveEditorViewState({
          saveTarget: target as EditorState["saveTarget"],
          pagesLength: liveSnapshot.pages.length,
          scale: liveSnapshot.scale,
          currentPageIndex: liveSnapshot.currentPageIndex,
          scrollContainer: workspaceScrollContainerRef.current,
        });
      }

      toast.success(t("app.save_success"));
      return true;
    }).catch((err) => {
      if (err?.name === "AbortError") return false;
      console.error("Save As failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`${t("app.save_fail")}${msg ? `: ${msg}` : ""}`);
      return false;
    });
  }, [generatePDF, setState, t, withProcessing]);

  const handleExport = useCallback(async (): Promise<boolean> => {
    return await withProcessing(t("app.generating"), async () => {
      const snapshot = useEditorStore.getState();
      const modifiedBytes = await generatePDF();
      if (!modifiedBytes) return false;

      const result = await exportPdfBytes({
        bytes: modifiedBytes,
        filename: snapshot.filename || "document.pdf",
        existingTarget: snapshot.saveTarget,
        filters: [{ name: "PDF Document", extensions: ["pdf"] }],
      });

      if (!result.ok) return false;

      if (result.kind === "saved") {
        setState({
          saveTarget: result.target as unknown as EditorState["saveTarget"],
          lastSavedAt: new Date(),
          isDirty: false,
        });

        if (isTauriSaveTarget(result.target)) {
          recentFilesService.upsertWithBytesPreview({
            path: result.target.path,
            filename: snapshot.filename || "document.pdf",
            pdfBytes: modifiedBytes,
            targetWidth: 240,
            renderAnnotations: true,
            forcePreviewRender: true,
          });
        }

        toast.success(t("app.save_success"));
      }

      return true;
    }).catch((error) => {
      console.error("Export failed:", error);
      const msg = error instanceof Error ? error.message : String(error);
      toast.error(`${t("app.export_fail")}${msg ? `: ${msg}` : ""}`);
      return false;
    });
  }, [generatePDF, setState, t, withProcessing]);

  const handlePrint = useCallback(async () => {
    await withProcessing(t("app.generating"), async () => {
      const modifiedBytes = await generatePDF();
      if (!modifiedBytes) return;

      const blob = new Blob([new Uint8Array(modifiedBytes)], {
        type: "application/pdf",
      });
      const url = URL.createObjectURL(blob);

      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.src = url;

      document.body.appendChild(iframe);

      iframe.onload = () => {
        const win = iframe.contentWindow;
        if (!win) return;

        const cleanup = () => {
          try {
            if (document.body.contains(iframe)) {
              document.body.removeChild(iframe);
            }
            URL.revokeObjectURL(url);
          } catch (e) {
            console.warn("Print cleanup error:", e);
          }
        };

        win.addEventListener("afterprint", cleanup);
        win.print();
      };
    }).catch((error) => {
      console.error("Print failed:", error);
      const msg = error instanceof Error ? error.message : String(error);
      toast.error(`${t("app.export_fail")}${msg ? `: ${msg}` : ""}`);
    });
  }, [generatePDF, t, withProcessing]);

  const handleSaveDraft = useCallback(
    async (silent = false) => {
      setState({ isSaving: true });

      try {
        return await flushWebWorkspaceSessionPersist({
          silent,
        });
      } finally {
        setState({ isSaving: false });
      }
    },
    [flushWebWorkspaceSessionPersist, setState],
  );

  const runPrimarySaveAction = useCallback(async () => {
    if (platformDocumentSaveMode === "draft") {
      return await handleSaveDraft(false);
    }

    const snapshot = useEditorStore.getState();
    if (!snapshot.isDirty) return true;
    return await handleExport();
  }, [handleExport, handleSaveDraft, platformDocumentSaveMode]);

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
          navigate("/");
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
      closeAllTabsAndWindow,
      closeAllTabsToLanding,
      closeTabImmediately,
      captureCurrentTabIntoState,
      activeTabId,
      activateTab,
      getTabById,
      getTabsSnapshot,
      navigate,
    ],
  );

  const requestCloseTab = useCallback(
    async (tabId: string) => {
      if (!getTabById(tabId)) return;
      await startCloseFlow("close-tab", [tabId]);
    },
    [getTabById, startCloseFlow],
  );

  const closeActiveTabImmediately = useCallback(() => {
    if (!activeTabId) {
      navigate("/");
      return;
    }

    captureActiveTabState();
    const result = closeTabImmediately(activeTabId);
    if (result.isLastTab) {
      navigate("/");
    }
  }, [activeTabId, captureActiveTabState, closeTabImmediately, navigate]);

  const handleResolveCloseRequest = useCallback(
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
          navigate("/");
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
      closeAllTabsAndWindow,
      closeTabImmediately,
      getTabsSnapshot,
      navigate,
      pendingCloseRequest,
      runPrimarySaveAction,
      startCloseFlow,
      activeTabId,
      activateTab,
    ],
  );

  useEffect(() => {
    let unlisten: null | (() => void) = null;
    let cancelled = false;

    void (async () => {
      unlisten = await listenForPlatformCloseRequested((event) => {
        if (activeTabId) {
          captureCurrentTabIntoState();
        }

        const liveTabs = getTabsSnapshot();
        if (liveTabs.length === 0) return;

        const dirtyTabs = liveTabs.filter((tab) => tab.isDirty);
        if (dirtyTabs.length === 0) return;

        event.preventDefault();
        void startCloseFlow(
          "close-window",
          liveTabs.map((tab) => tab.id),
        );
      });

      if (cancelled) {
        try {
          unlisten?.();
        } catch {
          // ignore
        }
        unlisten = null;
      }
    })();

    return () => {
      cancelled = true;
      try {
        unlisten?.();
      } catch {
        // ignore
      }
    };
  }, [
    activeTabId,
    captureCurrentTabIntoState,
    getTabsSnapshot,
    startCloseFlow,
  ]);

  const onEditorSaveDraft = useCallback(
    async (silent?: boolean) => {
      return await handleSaveDraft(silent ?? false);
    },
    [handleSaveDraft],
  );

  const onEditorCloseCurrentTab = useCallback(() => {
    if (!activeTabId) return;
    void requestCloseTab(activeTabId);
  }, [activeTabId, requestCloseTab]);

  const onEditorCloseCurrentTabAfterSave = useCallback(() => {
    closeActiveTabImmediately();
  }, [closeActiveTabImmediately]);

  const onEditorPrint = useCallback(() => {
    void handlePrint();
  }, [handlePrint]);

  const pendingCloseDocumentTitle = pendingCloseRequest
    ? (getTabById(pendingCloseRequest.currentTabId)?.title ?? null)
    : null;

  return (
    <div className="flex h-full w-full flex-col">
      <AppRoutes
        canAccessEditor={windowLayout.tabIds.length > 0}
        isLoading={
          isProcessing ||
          hasPendingWindowBootstrap ||
          pendingIncomingTabs.length > 0
        }
        landingProps={{
          onUpload: handleUpload,
          onOpen: handleOpen,
          onOpenRecent: handleOpenRecent,
          hasSavedSession,
          onResume: handleResumeSession,
        }}
        editorProps={{
          windowId: platformWindowId,
          tabs: editorTabDescriptors,
          activeTabId,
          workerService: activeTab?.workerService ?? null,
          isFileDragActive,
          mergeWindowTargets,
          onOpenDocument: handleOpen,
          onRefreshMergeWindowTargets: refreshMergeWindowTargets,
          onSelectTab: (tabId) => {
            activateTab(tabId);
          },
          onCloseTab: (tabId) => {
            void requestCloseTab(tabId);
          },
          onMoveTab: handleMoveTab,
          onDetachTab: handleDetachTabToNewWindow,
          onMergeTabToWindow: handleMergeTabToWindow,
          canDetachTabs: isDesktopApp() && windowLayout.tabIds.length > 1,
          canMergeTabs: isDesktopApp() && mergeWindowTargets.length > 0,
          onExport: handleExport,
          onSaveDraft: onEditorSaveDraft,
          onSaveAs: handleSaveAs,
          onExit: onEditorCloseCurrentTabAfterSave,
          onPrint: onEditorPrint,
          onRequestCloseCurrentTab: onEditorCloseCurrentTab,
        }}
      />

      <KeyboardShortcutsHelp
        isOpen={activeDialog === "shortcuts"}
        onClose={() => setState({ activeDialog: null })}
      />
      <SettingsDialog
        isOpen={activeDialog === "settings"}
        onClose={() => setState({ activeDialog: null })}
        options={options}
        onChange={(updates) => setOptions(updates)}
      />

      <EditorCloseConfirmDialog
        open={pendingCloseRequest !== null}
        isDirty={true}
        documentTitle={pendingCloseDocumentTitle}
        platformDocumentSaveMode={platformDocumentSaveMode}
        onCloseDialog={() => setPendingCloseRequest(null)}
        onSaveAndClose={async () => {
          await handleResolveCloseRequest(true);
        }}
        onCloseWithoutSaving={async () => {
          await handleResolveCloseRequest(false);
        }}
        t={t}
      />

      <PdfPasswordDialog
        prompt={
          pdfPasswordPrompt
            ? { id: pdfPasswordPrompt.id, reason: pdfPasswordPrompt.reason }
            : null
        }
        onCancel={() => {
          const currentPrompt = pdfPasswordPrompt;
          setPdfPasswordPrompt(null);
          currentPrompt?.cancel();
        }}
        onSubmit={(password) => {
          const currentPrompt = pdfPasswordPrompt;
          setPdfPasswordPrompt(null);
          currentPrompt?.submit(password);
        }}
      />
    </div>
  );
};

export default App;
