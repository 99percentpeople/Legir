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
import {
  createIndexedDbRecentFilesStore,
  createPlatformRecentFilesStore,
  readWebRecentFile,
  readWebRecentFileByPath,
  rememberWebRecentFile,
  type RecentFileEntry,
} from "@/services/recentFiles";
import { useLanguage } from "./components/language-provider";
import { useAppInitialization } from "./app/useAppInitialization";
import { useEditorCloseFlow } from "./app/useEditorCloseFlow";
import { useEditorWindowBootstrap } from "./app/useEditorWindowBootstrap";
import { usePlatformWindowSessionPersistence } from "./app/usePlatformWindowSessionPersistence";
import { usePwaLaunchBootstrap } from "./app/usePwaLaunchBootstrap";
import type { HomePageAdapter } from "./pages/HomePage";
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
import type {
  EditorTabDescriptor,
  EditorTabSession,
} from "@/app/editorTabs/types";
import {
  applyGlobalEditorUiSession,
  buildEditorWindowBootstrapRoute,
  confirmPlatformAction,
  destroyPlatformWindow,
  emitTabWorkspaceEvent,
  exportPdfBytes,
  getPlatformWindowId,
  listenForPlatformFileDrop,
  listenForPlatformFileDragState,
  listenForPlatformFocusDocumentRequest,
  listenForPlatformEditorWindowsChange,
  listenForTabWorkspaceEvent,
  listPlatformEditorWindows,
  openFile,
  openFileFromPath,
  openPlatformEditorWindow,
  pickSaveTarget,
  reportPlatformWindowDocuments,
  readPlatformRuntimeSnapshot,
  resolveGlobalEditorUiSessionForDocument,
  requestPlatformFocusExistingDocument,
  saveGlobalEditorUiSession,
  subscribePlatformRuntimeChange,
  writeToSaveTarget,
  type PlatformDroppedPdf,
  type SaveTarget,
} from "@/services/platform";
import type { EditorState } from "@/types";

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
  const [platformRuntime, setPlatformRuntime] = useState(() =>
    readPlatformRuntimeSnapshot(),
  );
  const isDesktop = platformRuntime.isDesktop;
  const supportsMultiWindow = platformRuntime.supportsMultiWindow;
  const platformWindowId = useMemo(() => getPlatformWindowId(), []);
  const [, navigate] = useLocation();
  const homeRecentFilesStore = useMemo(() => {
    return isDesktop
      ? createPlatformRecentFilesStore()
      : createIndexedDbRecentFilesStore();
  }, [isDesktop]);

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

  useEffect(() => {
    return subscribePlatformRuntimeChange((nextSnapshot) => {
      setPlatformRuntime(nextSnapshot);
    });
  }, []);

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

    saveGlobalEditorUiSession(snapshot);

    if (snapshot.saveTarget?.kind === "web") {
      void rememberWebRecentFile({
        path: snapshot.saveTarget.id,
        handle: snapshot.saveTarget.handle,
        filename: snapshot.filename ?? snapshot.saveTarget.handle.name,
      }).catch((error) => {
        console.error("Failed to persist web recent file state", error);
      });
    }

    return {
      snapshot,
      thumbnailImages: cloneEditorTabThumbnailImages(state.thumbnailImages),
    };
  }, []);

  const restoreActiveTabSnapshot = useCallback((session: EditorTabSession) => {
    restoreEditorTabSnapshot(session.editorSnapshot, {
      isFullscreen: useEditorStore.getState().isFullscreen,
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
    if (!supportsMultiWindow) {
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
  }, [platformWindowId, supportsMultiWindow, t]);

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
          supportsMultiWindow &&
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
      supportsMultiWindow,
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

      if (!supportsMultiWindow) {
        return false;
      }

      try {
        return await requestPlatformFocusExistingDocument(sourceKey);
      } catch (error) {
        console.error("Failed to focus existing platform document:", error);
        return false;
      }
    },
    [activateTab, findTabBySourceKey, navigate, supportsMultiWindow],
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
    if (!supportsMultiWindow) return;

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
    supportsMultiWindow,
  ]);

  useEffect(() => {
    if (!supportsMultiWindow) return;

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
  }, [activateTab, findTabBySourceKey, navigate, supportsMultiWindow]);

  useEffect(() => {
    if (!supportsMultiWindow) return;

    const sourceKeys = tabs
      .map((tab) => tab.sourceKey)
      .filter((sourceKey): sourceKey is string => !!sourceKey);

    void reportPlatformWindowDocuments(sourceKeys).catch((error) => {
      console.error("Failed to report platform window documents:", error);
    });
  }, [supportsMultiWindow, tabs]);

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
    if (!supportsMultiWindow) return;

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
  }, [refreshMergeWindowTargets, supportsMultiWindow]);

  useEffect(() => {
    if (!supportsMultiWindow) return;

    let cancelled = false;
    let unlisten: null | (() => void) = null;

    void (async () => {
      unlisten = await listenForPlatformEditorWindowsChange(() => {
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
  }, [refreshMergeWindowTargets, supportsMultiWindow]);

  useEffect(() => {
    return () => {
      disposeAllTabs();
    };
  }, [disposeAllTabs]);

  const closeAllTabsToLanding = useCallback(() => {
    recentFilesService.cancelPreviewTasks();
    disposeAllTabs();
    resetDocument();
    navigate("/");
  }, [disposeAllTabs, navigate, resetDocument]);

  const closeAllTabsAndWindow = useCallback(async () => {
    recentFilesService.cancelPreviewTasks();
    await destroyPlatformWindow();
  }, [destroyPlatformWindow]);

  const closeTabImmediately = useCallback(
    (tabId: string) => {
      const nextTabId = getAdjacentTabId(tabId);
      const removingActiveTab = activeTabId === tabId;

      if (removingActiveTab) {
        captureActiveTabState();
      }

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
        }
      }

      return {
        isLastTab: remainingTabs.length === 0,
      };
    },
    [
      activateTab,
      activeTabId,
      captureActiveTabState,
      getAdjacentTabId,
      getTabsSnapshot,
      removeTab,
      resetDocument,
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

      if (!supportsMultiWindow) {
        navigate("/");
        return;
      }

      await destroyPlatformWindow();
    },
    [destroyPlatformWindow, navigate, supportsMultiWindow],
  );

  const enqueueLoadTask = useCallback((task: () => Promise<void>) => {
    loadQueueRef.current = loadQueueRef.current
      .catch(() => {
        // keep queue alive
      })
      .then(task);
    return loadQueueRef.current;
  }, []);

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

            const {
              session: persistedUiSession,
              restoreDocumentViewport,
              currentPageIndex,
              pendingViewStateRestore,
            } = resolveGlobalEditorUiSessionForDocument({
              sourceKey,
              pageCount: pages.length,
            });

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
              pendingViewStateRestore,
            });
            const hydratedSnapshot =
              persistedUiSession !== null
                ? applyGlobalEditorUiSession(
                    snapshot,
                    {
                      ...persistedUiSession,
                      currentPageIndex,
                      pendingViewStateRestore,
                    },
                    {
                      restoreDocumentViewport,
                    },
                  )
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
      t,
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

  const openWebHandleFile = useCallback(
    async (options: {
      handle: FileSystemFileHandle;
      filename: string;
      bytes: Uint8Array;
      path?: string;
    }) => {
      let rememberedPath = options.path ?? null;

      try {
        const remembered = await rememberWebRecentFile({
          path: options.path,
          handle: options.handle,
          filename: options.filename,
          pdfBytes: options.bytes,
        });
        rememberedPath = remembered.path;
      } catch (error) {
        console.error("Failed to remember web recent file", error);
      }

      const normalizedHandleName = options.handle.name.trim();
      const sourceKey = rememberedPath
        ? `web-file:${rememberedPath}`
        : normalizedHandleName
          ? `web-handle:${normalizedHandleName}`
          : null;

      if (await focusExistingTabBySourceKey(sourceKey)) {
        return;
      }

      await openLoadedDocumentInTab({
        input: options.bytes,
        pdfFile: null,
        filename: options.filename,
        saveTarget: {
          kind: "web",
          handle: options.handle,
          ...(rememberedPath ? { id: rememberedPath } : {}),
        },
        skipInitialSourceKeyLookup: true,
      });
    },
    [focusExistingTabBySourceKey, openLoadedDocumentInTab],
  );

  const openTauriFilePathInCurrentWindow = useCallback(
    async (
      filePath: string,
      options?: { skipInitialSourceKeyLookup?: boolean },
    ) => {
      const picked = await openFileFromPath(filePath);
      await openLoadedDocumentInTab({
        input: picked.bytes,
        pdfFile: null,
        filename: picked.filename,
        saveTarget: { kind: "tauri", path: filePath },
        skipInitialSourceKeyLookup:
          options?.skipInitialSourceKeyLookup ?? false,
      });
    },
    [openLoadedDocumentInTab],
  );

  const handleOpen = useCallback(async () => {
    const picked = await openFile({
      filters: [{ name: "PDF Document", extensions: ["pdf"] }],
    });
    if (!picked) return;

    if (picked.handle) {
      await openWebHandleFile({
        handle: picked.handle,
        filename: picked.filename,
        bytes: picked.bytes,
      });
      return;
    }

    if (picked.filePath) {
      await openLoadedDocumentInTab({
        input: picked.bytes,
        pdfFile: null,
        filename: picked.filename,
        saveTarget: { kind: "tauri", path: picked.filePath },
      });
      return;
    }
  }, [openLoadedDocumentInTab, openWebHandleFile]);

  const openRecentFileByPath = useCallback(
    async (filePath: string) => {
      if (await focusExistingTabBySourceKey(`tauri:${filePath}`)) {
        return;
      }

      await openTauriFilePathInCurrentWindow(filePath, {
        skipInitialSourceKeyLookup: true,
      });
    },
    [focusExistingTabBySourceKey, openTauriFilePathInCurrentWindow],
  );

  const openRecentWebFile = useCallback(
    async (entry: RecentFileEntry) => {
      const { handle, file, bytes } = await readWebRecentFile(entry);
      await openWebHandleFile({
        path: entry.path,
        handle,
        filename: file.name,
        bytes,
      });
    },
    [openWebHandleFile],
  );

  const handleOpenRecent = useCallback(
    async (entry: RecentFileEntry) => {
      if (isDesktop) {
        await openRecentFileByPath(entry.path);
        return;
      }

      await openRecentWebFile(entry);
    },
    [isDesktop, openRecentFileByPath, openRecentWebFile],
  );

  const homePageAdapter = useMemo<HomePageAdapter>(
    () => ({
      store: homeRecentFilesStore,
      open: handleOpen,
      openRecent: handleOpenRecent,
      confirmClearAll: confirmPlatformAction,
    }),
    [handleOpen, handleOpenRecent, homeRecentFilesStore],
  );

  const openDroppedPdfPath = useCallback(
    async (filePath: string) => {
      if (!filePath.toLowerCase().endsWith(".pdf")) {
        toast.error("Only PDF files are supported.");
        return;
      }

      await openTauriFilePathInCurrentWindow(filePath, {
        skipInitialSourceKeyLookup: false,
      });
    },
    [openTauriFilePathInCurrentWindow],
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

      if (payload.handle) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await openWebHandleFile({
          handle: payload.handle,
          filename: file.name,
          bytes,
        });
        return;
      }

      await handleUpload(file);
    },
    [handleUpload, openDroppedPdfPath, openWebHandleFile],
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

      await openTauriFilePathInCurrentWindow(filePath, {
        skipInitialSourceKeyLookup: true,
      });
    },
    [focusExistingTabBySourceKey, openTauriFilePathInCurrentWindow],
  );

  const importStartupOpenWebDocument = useCallback(
    async (recentFilePath: string) => {
      if (await focusExistingTabBySourceKey(`web-file:${recentFilePath}`)) {
        return;
      }

      const { handle, file, bytes } =
        await readWebRecentFileByPath(recentFilePath);
      await openWebHandleFile({
        path: recentFilePath,
        handle,
        filename: file.name,
        bytes,
      });
    },
    [focusExistingTabBySourceKey, openWebHandleFile],
  );

  const hasPendingWindowBootstrap = useEditorWindowBootstrap({
    onStartupOpenDocument: importStartupOpenDocument,
    onStartupOpenWebDocument: importStartupOpenWebDocument,
    onTabTransfer: importTransferredTab,
    loadErrorMessage: t("app.load_error"),
  });

  const hasPendingLaunchQueueFiles = usePwaLaunchBootstrap({
    openWebHandleFile,
    loadErrorMessage: t("app.load_error"),
  });

  useAppInitialization();

  const handleDetachTabToNewWindow = useCallback(
    async (tabId: string) => {
      if (!supportsMultiWindow) return;

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
      supportsMultiWindow,
    ],
  );

  const handleMergeTabToWindow = useCallback(
    async (tabId: string, targetWindowId: string) => {
      if (!supportsMultiWindow || targetWindowId === platformWindowId) {
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

        if (extractedTab.isLastTab) {
          ackWaiter.cancel();
          await commitTransferredSourceTab(extractedTab);
          return;
        }

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
      supportsMultiWindow,
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

      let nextSaveTarget = target;

      if (target.kind === "web") {
        const remembered = await rememberWebRecentFile({
          path: target.id,
          handle: target.handle,
          filename: nextFilename || target.handle.name || "document.pdf",
          pdfBytes: modifiedBytes,
          forcePreviewRender: true,
        });

        nextSaveTarget = {
          ...target,
          ...(remembered.path ? { id: remembered.path } : {}),
        };
      }

      setState({
        saveTarget: nextSaveTarget as unknown as EditorState["saveTarget"],
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
        let nextExportTarget = result.target;

        if (result.target.kind === "web") {
          const remembered = await rememberWebRecentFile({
            path: result.target.id,
            handle: result.target.handle,
            filename:
              result.target.handle.name || snapshot.filename || "document.pdf",
            pdfBytes: modifiedBytes,
            forcePreviewRender: true,
          });

          nextExportTarget = {
            ...result.target,
            ...(remembered.path ? { id: remembered.path } : {}),
          };
        }

        setState({
          saveTarget: nextExportTarget as unknown as EditorState["saveTarget"],
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

  const runPrimarySaveAction = useCallback(async () => {
    const snapshot = useEditorStore.getState();
    if (!snapshot.isDirty) return true;
    return await handleExport();
  }, [handleExport]);
  const navigateToHome = useCallback(() => {
    navigate("/");
  }, [navigate]);

  const {
    pendingCloseRequest,
    pendingCloseDocumentTitle,
    requestCloseTab,
    closeActiveTabImmediately,
    resolveCloseRequest,
    dismissCloseRequest,
    onDesktopCloseRequested,
  } = useEditorCloseFlow({
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
  });

  usePlatformWindowSessionPersistence({
    enabled: true,
    isDesktop,
    hasActiveTab: activeTabId !== null,
    persistCurrentTabState: captureCurrentTabIntoState,
    onDesktopCloseRequested,
  });

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

  return (
    <div className="flex h-full w-full flex-col">
      <AppRoutes
        canAccessEditor={windowLayout.tabIds.length > 0}
        isLoading={
          isProcessing ||
          hasPendingWindowBootstrap ||
          hasPendingLaunchQueueFiles ||
          pendingIncomingTabs.length > 0
        }
        homeProps={{
          adapter: homePageAdapter,
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
          canDetachTabs: supportsMultiWindow && windowLayout.tabIds.length > 1,
          canMergeTabs: supportsMultiWindow && mergeWindowTargets.length > 0,
          onExport: handleExport,
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
        onCloseDialog={dismissCloseRequest}
        onSaveAndClose={async () => {
          await resolveCloseRequest(true);
        }}
        onCloseWithoutSaving={async () => {
          await resolveCloseRequest(false);
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
