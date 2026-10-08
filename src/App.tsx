import { hasStampImageTransfer } from "@/lib/stampImage";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";

import AppRoutes from "./AppRoutes";
import { useWorkspaceNavigation } from "./app/workspaceNavigation/useWorkspaceNavigation";
import type { WorkspacePage } from "./app/workspaceNavigation/types";
import { GlobalAiProvider } from "./app/ai/GlobalAiContext";
import type { AiWorkspace } from "./services/ai/chat/workspace";
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
import { EditorRuntimeProvider } from "./app/editorRuntime";
import type { HomePageAdapter } from "./pages/HomePage";
import {
  useEditorView,
  activateEditorView,
  getActiveEditorView,
  type EditorViewApi,
} from "./store/useEditorView";
import {
  deactivateEditorTabRuntime,
  type EditorTabRuntime,
} from "./app/editorTabs/runtime";
import {
  commitDocumentSaveState,
  isSavedDocumentRevision,
} from "./app/editorTabs/saveState";
import { selectAppShellState } from "@/store/selectors";
import type { LoadedPdfDocument, PdfOpenSession } from "./services/pdfService";
import { createPdfWorkerService } from "./services/pdfService/pdfWorkerService";
import { recentFilesService } from "./services/recentFilesService";
import {
  canPrintPdf,
  getPdfPermissionSaveBlockReason,
} from "@/lib/pdfPermissions";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { usePlatformFileDrop } from "@/hooks/usePlatformFileDrop";
import { useGlobalProcessingToast } from "./hooks/useGlobalProcessingToast";
import { disposeEditorTabSessionResources } from "@/app/editorTabs/sessionResources";
import {
  hydratedPdfDocumentPatch,
  createEditorTabId,
  createLoadedEditorTabSnapshot,
  getEditorTabDisplayTitle,
  getEditorTabTitle,
  getEditorTabSourceKey,
} from "@/app/editorTabs/storeSnapshot";
import { appEventBus } from "@/lib/eventBus";
import {
  markAppPerformance,
  measureAppPerformance,
} from "@/lib/appPerformance";
import { restoreEditorTabSessionTransfer } from "@/app/editorTabs/transfer";
import {
  consumeEditorTabSessionTransfer,
  deleteEditorTabSessionTransfer,
  saveEditorTabSessionTransfer,
} from "@/app/editorTabs/transferStorage";
import { useEditorTabsController } from "@/app/editorTabs/useEditorTabsController";
import type {
  EditorMergeWindowTarget,
  EditorTabDescriptor,
  EditorTabDropTarget,
  EditorTabSession,
} from "@/app/editorTabs/types";
import {
  buildEditorWindowBootstrapRoute,
  confirmPlatformAction,
  destroyPlatformWindow,
  emitTabWorkspaceEvent,
  canSaveWithPicker,
  getPlatformWindowId,
  listenForPlatformFocusDocumentRequest,
  listenForPlatformEditorWindowsChange,
  listenForTabWorkspaceEvent,
  listPlatformEditorWindows,
  openFiles,
  openFileFromPath,
  openPlatformEditorWindow,
  pickSaveTarget,
  reportPlatformWindowDocuments,
  readPlatformRuntimeSnapshot,
  getDocumentViewState,
  requestPlatformFocusExistingDocument,
  savePdfBytes,
  saveDocumentViewState,
  subscribePlatformRuntimeChange,
  writeToSaveTarget,
  setPlatformWindowTitle,
  type PlatformDroppedPdf,
  type SaveTarget,
} from "@/services/platform";

const KeyboardShortcutsHelp = React.lazy(
  () => import("./components/KeyboardShortcutsHelp"),
);
const SettingsDialog = React.lazy(
  () => import("./components/dialogs/SettingsDialog"),
);
const PdfPasswordDialog = React.lazy(
  () => import("./components/dialogs/PdfPasswordDialog"),
);
const EditorCloseConfirmDialog = React.lazy(() =>
  import("./pages/EditorPage/EditorCloseConfirmDialog").then((module) => ({
    default: module.EditorCloseConfirmDialog,
  })),
);

type ExtractedTransferTab = {
  session: EditorTabSession;
  isLastTab: boolean;
  previousIndex: number;
  previousPage: WorkspacePage | null;
};

type PdfLoadToastState = {
  token: string;
  message: string;
};

const TAB_TRANSFER_ACK_TIMEOUT_MS = 30_000;
const FIRST_PAGE_RENDER_FALLBACK_MS = 1_500;

const waitForFirstPdfPageRender = (sessionRenderKey: string) =>
  new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (rendered: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      unsubscribe();
      resolve(rendered);
    };
    const unsubscribe = appEventBus.on("pdf:firstPageRendered", (payload) => {
      if (payload.sessionRenderKey === sessionRenderKey) finish(true);
    });
    const timeoutId = window.setTimeout(
      () => finish(false),
      FIRST_PAGE_RENDER_FALLBACK_MS,
    );
  });
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
  const [pdfLoadToast, setPdfLoadToast] = useState<PdfLoadToastState | null>(
    null,
  );
  const isDesktop = platformRuntime.isDesktop;
  const supportsMultiWindow = platformRuntime.supportsMultiWindow;
  const platformWindowId = useMemo(() => getPlatformWindowId(), []);
  const homeRecentFilesStore = useMemo(() => {
    return isDesktop
      ? createPlatformRecentFilesStore()
      : createIndexedDbRecentFilesStore();
  }, [isDesktop]);

  const workspaceScrollContainerRef = useRef<HTMLElement | null>(null);
  const activeRuntimeRef = useRef<EditorTabRuntime | null>(null);
  const loadQueueRef = useRef<Promise<void>>(Promise.resolve());
  const incomingTransferIdsRef = useRef<Set<string>>(new Set());

  const getWorkspaceScrollContainer = useCallback(
    () =>
      activeRuntimeRef.current
        ? activeRuntimeRef.current.scrollContainer
        : workspaceScrollContainerRef.current,
    [],
  );

  const resetDocument = useCallback(() => {
    if (!activeRuntimeRef.current && !workspaceScrollContainerRef.current)
      return;
    deactivateEditorTabRuntime(activeRuntimeRef.current);
    activeRuntimeRef.current = null;
    workspaceScrollContainerRef.current = null;
  }, []);

  useEffect(() => {
    markAppPerformance("app:shell-mounted", { once: true });
    measureAppPerformance(
      "app:entry-to-shell",
      "app:entry",
      "app:shell-mounted",
    );
  }, []);

  useAppEvent(
    "workspace:scrollContainerReady",
    ({ element }) => {
      workspaceScrollContainerRef.current = element;
    },
    { replayLast: true },
  );

  const appShell = useEditorView(useShallow(selectAppShellState));
  const {
    setState,
    setOptions,
    withProcessing,
    isProcessing,
    processingStatus,
    activeDialog,
    options,
  } = appShell;

  useGlobalProcessingToast({
    isProcessing: isProcessing || pdfLoadToast !== null,
    processingStatus: pdfLoadToast?.message ?? processingStatus,
    defaultMessage: t("common.processing"),
  });

  const startPdfLoadToast = useCallback((token: string, message: string) => {
    setPdfLoadToast({ token, message });
  }, []);

  const advancePdfLoadToast = useCallback((token: string, message: string) => {
    setPdfLoadToast((current) =>
      current?.token === token ? { token, message } : current,
    );
  }, []);

  const clearPdfLoadToast = useCallback((token: string) => {
    setPdfLoadToast((current) => (current?.token === token ? null : current));
  }, []);

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

  useAppEvent("pdf:passwordRequired", (payload) => {
    setPdfPasswordPrompt(payload);
  });

  useEffect(() => {
    return subscribePlatformRuntimeChange((nextSnapshot) => {
      setPlatformRuntime(nextSnapshot);
    });
  }, []);

  const captureActiveTabState = useCallback(() => {
    const state = useEditorView.getState();
    const scroll = getWorkspaceScrollContainer();
    saveDocumentViewState({
      ...state,
      pendingViewStateRestore: scroll
        ? {
            scale: state.scale,
            scrollLeft: scroll.scrollLeft,
            scrollTop: scroll.scrollTop,
          }
        : state.pendingViewStateRestore,
    });

    if (state.saveTarget?.kind === "web") {
      void rememberWebRecentFile({
        path: state.saveTarget.id,
        handle: state.saveTarget.handle,
        filename: state.filename ?? state.saveTarget.handle.name,
      }).catch((error) => {
        console.error("Failed to persist web recent file state", error);
      });
    }
  }, [getWorkspaceScrollContainer]);

  const activateTabRuntime = useCallback((session: EditorTabSession) => {
    if (activeRuntimeRef.current) activeRuntimeRef.current.active = false;
    activeRuntimeRef.current = session.runtime;
    session.runtime.active = true;
    window.getSelection()?.removeAllRanges();
    activateEditorView(session.runtime.store);
    workspaceScrollContainerRef.current = session.runtime.scrollContainer;
  }, []);

  const tabsController = useEditorTabsController({
    windowId: platformWindowId,
    persistDocumentView: captureActiveTabState,
    activateSession: activateTabRuntime,
    deactivateSession: resetDocument,
  });
  const {
    backend: tabsBackend,
    addTab,
    persistActiveTabView,
    disposeAllTabs,
    findTabBySourceKey,
    getTabById,
    getTabsSnapshot,
    moveTabToWindow,
    tabs,
    tabDescriptors,
    windowLayout,
  } = tabsController;

  const {
    location,
    page: workspacePage,
    getPage: getWorkspacePage,
    openTab: activateTab,
    showHome,
    showPendingEditor,
    closeTabImmediately,
    reconcile: reconcileWorkspaceRoute,
  } = useWorkspaceNavigation({ ...tabsController, windowId: platformWindowId });
  const activeTabId =
    workspacePage?.kind === "document" ? workspacePage.tabId : null;
  const activeTab = getTabById(activeTabId);
  const navigateToHome = useCallback(
    () => showHome({ replace: true }),
    [showHome],
  );
  const windowTitle =
    activeTab?.runtime.store.getState().filename ||
    process.env.APP_NAME ||
    "Legir";
  useEffect(() => {
    void setPlatformWindowTitle(windowTitle).catch(() => {});
  }, [windowTitle]);

  const aiWorkspace = useMemo<AiWorkspace>(
    () => ({
      getActiveDocumentId: () =>
        tabsBackend.getWindowSnapshot(platformWindowId).layout.activeTabId,
      listDocuments: () => {
        const snapshot = tabsBackend.getWindowSnapshot(platformWindowId);
        return snapshot.sessions.map((session) => {
          const state = session.runtime.store.getState();
          return {
            documentId: session.id,
            filename: state.filename,
            pageCount: state.pages.length,
            isDirty: state.isDirty,
            isActive: session.id === snapshot.layout.activeTabId,
            loadState: state.documentLoadState,
          };
        });
      },
      getDocument: (documentId) => {
        const session = tabsBackend.getSession(documentId);
        if (
          !session?.runtime ||
          session.runtime.disposed ||
          session.windowId !== platformWindowId
        )
          return null;
        const runtime = session.runtime;
        return {
          id: documentId,
          store: runtime.store,
          events: runtime.events,
          signal: runtime.signal,
          workerService: session.workerService,
          getRoot: () => runtime.root,
        };
      },
      activateDocument: (documentId) => {
        if (tabsBackend.getSession(documentId)?.windowId !== platformWindowId)
          return false;
        return activateTab(documentId);
      },
    }),
    [tabsBackend, platformWindowId, activateTab],
  );

  const applyHydratedDocumentToTab = useCallback(
    (tabId: string, document: LoadedPdfDocument) => {
      const session = tabsBackend.getSession(tabId);
      if (!session) return false;

      tabsBackend.updateSession(tabId, {
        document: hydratedPdfDocumentPatch(document),
      });

      return true;
    },
    [getWorkspaceScrollContainer, platformWindowId, tabsBackend],
  );

  const markTabHydrationError = useCallback(
    (tabId: string, error: unknown) => {
      const session = tabsBackend.getSession(tabId);
      if (!session) return false;
      const message = error instanceof Error ? error.message : String(error);
      tabsBackend.updateSession(tabId, {
        document: {
          documentLoadState: "error",
          documentLoadError: message,
        },
      });

      return true;
    },
    [platformWindowId, tabsBackend],
  );

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
            activate: false,
          });
          activateTab(restored.id);
        }

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
    [activateTab, findTabBySourceKey, supportsMultiWindow],
  );

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
          showPendingEditor();
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
    showPendingEditor,
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
  }, [activateTab, findTabBySourceKey, supportsMultiWindow]);

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
    navigateToHome();
  }, [disposeAllTabs, navigateToHome, resetDocument]);

  const closeAllTabsAndWindow = useCallback(async () => {
    recentFilesService.cancelPreviewTasks();
    await destroyPlatformWindow();
  }, [destroyPlatformWindow]);

  const extractTransferSourceTab = useCallback(
    (tabId: string): ExtractedTransferTab | null => {
      const tabsBeforeRemoval = getTabsSnapshot();
      const previousIndex = tabsBeforeRemoval.findIndex(
        (tab) => tab.id === tabId,
      );
      if (previousIndex < 0) return null;

      const previousPage = getWorkspacePage();
      const wasActive =
        previousPage?.kind === "document" && previousPage.tabId === tabId;
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
            replace: true,
          });
        } else {
          resetDocument();
          navigateToHome();
        }
      }

      return {
        session: extracted,
        isLastTab: remainingTabs.length === 0,
        previousIndex,
        previousPage,
      };
    },
    [
      getWorkspacePage,
      activateTab,
      getTabsSnapshot,
      platformWindowId,
      resetDocument,
      navigateToHome,
      tabsBackend,
    ],
  );

  const restoreTransferredSourceTab = useCallback(
    (extractedTab: ExtractedTransferTab) => {
      tabsBackend.addSession(platformWindowId, extractedTab.session, {
        activate: false,
        targetIndex: extractedTab.previousIndex,
      });

      if (extractedTab.previousPage?.kind === "home") {
        navigateToHome();
      } else if (extractedTab.previousPage?.kind === "document") {
        activateTab(extractedTab.previousPage.tabId, {
          skipCaptureCurrent: true,
          replace: true,
        });
      }
    },
    [activateTab, navigateToHome, platformWindowId, tabsBackend],
  );

  const commitTransferredSourceTab = useCallback(
    async (extractedTab: ExtractedTransferTab) => {
      disposeEditorTabSessionResources(extractedTab.session);

      if (!extractedTab.isLastTab) return;

      if (!supportsMultiWindow) {
        navigateToHome();
        return;
      }

      await destroyPlatformWindow();
    },
    [destroyPlatformWindow, navigateToHome, supportsMultiWindow],
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
      markAppPerformance("pdf:open-requested", { once: true });
      void import("./pages/EditorPage");
      void import("./components/workspace/Workspace");
      const pdfServiceModulePromise = import("./services/pdfService");

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
          workerService.destroy();
          return;
        }

        recentFilesService.cancelPreviewTasks();
        const loadToastToken = `pdf-load-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}`;
        startPdfLoadToast(loadToastToken, t("app.loading_pdf"));
        let disposeOpenSession: (() => void) | null = null;

        try {
          const { startPdfOpenSession } = await pdfServiceModulePromise;
          const openSession: PdfOpenSession = startPdfOpenSession(
            options.input,
            {
              workerService,
            },
          );
          disposeOpenSession = openSession.dispose;

          await withProcessing(t("app.loading_pdf"), async () => {
            const {
              pdfBytes,
              pages,
              fields,
              annotations,
              preservedSourceAnnotations,
              metadata,
              documentPermissions,
              outline,
              openPassword,
            } = await openSession.readable;
            markAppPerformance("pdf:readable", { once: true });
            measureAppPerformance(
              "pdf:request-to-readable",
              "pdf:open-requested",
              "pdf:readable",
            );
            measureAppPerformance(
              "pdf:bootstrap-to-readable",
              "app:bootstrap-script",
              "pdf:readable",
            );

            const { currentPageIndex, pendingViewStateRestore } =
              getDocumentViewState({
                sourceKey,
                pageCount: pages.length,
              });

            const snapshot = createLoadedEditorTabSnapshot({
              pdfFile: options.pdfFile,
              pdfBytes,
              pdfOpenPassword: openPassword ?? null,
              metadata,
              documentPermissions,
              filename: options.filename,
              saveTarget: options.saveTarget,
              pages,
              fields,
              annotations,
              preservedSourceAnnotations,
              outline,
              documentLoadState: "hydrating",
              documentLoadError: null,
              currentPageIndex,
              pendingViewStateRestore,
            });

            const postLoadLocalMatch = sourceKey
              ? findTabBySourceKey(sourceKey)
              : null;
            if (postLoadLocalMatch) {
              activateTab(postLoadLocalMatch.id);
              return;
            }

            if (
              await focusExistingTabBySourceKey(sourceKey, {
                skipLocalCheck: true,
              })
            ) {
              return;
            }

            const tabId = createEditorTabId();
            addTab({
              id: tabId,
              title: getEditorTabDisplayTitle(options.filename),
              sourceKey,
              snapshot,
              thumbnailImages: {},
              workerService,
              disposePdfResources: openSession.dispose,
              activate: false,
            });
            keepWorker = true;
            activateTab(tabId);
            advancePdfLoadToast(loadToastToken, t("app.rendering_pdf"));

            const hydrateDocument = async (retry = false) => {
              if (retry) {
                startPdfLoadToast(loadToastToken, t("app.parsing"));
              }
              try {
                if (!retry) {
                  const firstPageRendered =
                    await waitForFirstPdfPageRender(tabId);
                  if (firstPageRendered) {
                    markAppPerformance("pdf:first-page-rendered", {
                      once: true,
                    });
                    measureAppPerformance(
                      "pdf:request-to-first-page",
                      "pdf:open-requested",
                      "pdf:first-page-rendered",
                    );
                    measureAppPerformance(
                      "pdf:bootstrap-to-first-page",
                      "app:bootstrap-script",
                      "pdf:first-page-rendered",
                    );
                  }
                }
                advancePdfLoadToast(loadToastToken, t("app.parsing"));
                const hydratedDocument = retry
                  ? await openSession.retryHydration()
                  : await openSession.hydrate();
                if (!applyHydratedDocumentToTab(tabId, hydratedDocument)) {
                  return;
                }
                markAppPerformance("pdf:hydrated", { once: true });
                measureAppPerformance(
                  "pdf:request-to-hydrated",
                  "pdf:open-requested",
                  "pdf:hydrated",
                );
                measureAppPerformance(
                  "pdf:bootstrap-to-hydrated",
                  "app:bootstrap-script",
                  "pdf:hydrated",
                );

                if (options.saveTarget?.kind === "tauri") {
                  recentFilesService.upsertWithBytesPreview({
                    path: options.saveTarget.path,
                    filename: options.filename,
                    pdfBytes: hydratedDocument.pdfBytes,
                    targetWidth: 240,
                  });
                }

                const liveWindow =
                  tabsBackend.getWindowSnapshot(platformWindowId);
                if (liveWindow.layout.activeTabId === tabId) {
                  useEditorView.getState().warmupThumbnails(workerService);
                }
              } catch (error) {
                if (
                  error instanceof DOMException &&
                  error.name === "AbortError"
                ) {
                  return;
                }
                console.error("Error hydrating PDF:", error);
                if (!markTabHydrationError(tabId, error)) return;
                toast.error(t("app.load_error"), {
                  action: {
                    label: t("common.actions.retry"),
                    onClick: () => {
                      void hydrateDocument(true);
                    },
                  },
                });
              } finally {
                clearPdfLoadToast(loadToastToken);
              }
            };

            // Hydration updates its own tab snapshot, so later selections can
            // create their tabs as soon as this document becomes readable.
            void hydrateDocument();
          });
        } catch (error) {
          console.error("Error loading PDF:", error);
          toast.error(t("app.load_error"));
        } finally {
          if (!keepWorker) {
            clearPdfLoadToast(loadToastToken);
            disposeOpenSession?.();
            workerService.destroy();
          }
        }
      });
    },
    [
      activateTab,
      addTab,
      advancePdfLoadToast,
      applyHydratedDocumentToTab,
      clearPdfLoadToast,
      enqueueLoadTask,
      findTabBySourceKey,
      focusExistingTabBySourceKey,
      markTabHydrationError,
      platformWindowId,
      startPdfLoadToast,
      t,
      tabsBackend,
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
    const selections = await openFiles({
      filters: [{ name: "PDF Document", extensions: ["pdf"] }],
    });
    for (const selection of selections) {
      try {
        if (selection.kind === "tauri") {
          await openTauriFilePathInCurrentWindow(selection.filePath);
          continue;
        }

        const file = await selection.handle.getFile();
        await openWebHandleFile({
          handle: selection.handle,
          filename: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        });
      } catch (error) {
        console.error(`Failed to open PDF: ${selection.filename}`, error);
        toast.error(t("app.load_error"));
      }
    }
  }, [openTauriFilePathInCurrentWindow, openWebHandleFile, t]);

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

  const openDroppedPdfs = useCallback(
    async (payloads: PlatformDroppedPdf[]) => {
      const { isProcessing } = useEditorView.getState();
      if (isProcessing) return;

      for (const payload of payloads) {
        try {
          await openDroppedPdf(payload);
        } catch (error) {
          console.error("Failed to open dropped PDF", error);
          toast.error(t("app.load_error"));
        }
      }
    },
    [openDroppedPdf, t],
  );

  const isFileDragActive = usePlatformFileDrop({
    enabled: activeTabId !== null && location.startsWith("/editor"),
    getTargetElement: getWorkspaceScrollContainer,
    showOverlayFor: (event) => !hasStampImageTransfer(event.dataTransfer),
    onDrop: openDroppedPdfs,
  });

  const homePageAdapter = useMemo<HomePageAdapter>(
    () => ({
      store: homeRecentFilesStore,
      open: handleOpen,
      openRecent: handleOpenRecent,
      openDroppedPdfs,
      confirmClearAll: confirmPlatformAction,
    }),
    [handleOpen, handleOpenRecent, homeRecentFilesStore, openDroppedPdfs],
  );

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

  const isWorkspaceLoading =
    isProcessing ||
    hasPendingWindowBootstrap ||
    hasPendingLaunchQueueFiles ||
    pendingIncomingTabs.length > 0;
  useLayoutEffect(() => {
    reconcileWorkspaceRoute(isWorkspaceLoading);
  }, [location, tabs, isWorkspaceLoading, reconcileWorkspaceRoute]);

  useAppInitialization();

  const handleDetachTabToNewWindow = useCallback(
    async (tabId: string) => {
      if (!supportsMultiWindow) return;

      persistActiveTabView();
      const session = getTabById(tabId);
      if (!session) return;
      if (
        session.runtime.store.document.getState().documentLoadState !== "ready"
      ) {
        toast.error(t("common.processing"));
        return;
      }

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
          title: getEditorTabTitle(session),
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
      persistActiveTabView,
      commitTransferredSourceTab,
      createTransferAckWaiter,
      extractTransferSourceTab,
      getTabById,
      restoreTransferredSourceTab,
      supportsMultiWindow,
      t,
    ],
  );

  const handleMergeTabToWindow = useCallback(
    async (tabId: string, targetWindowId: string) => {
      if (!supportsMultiWindow || targetWindowId === platformWindowId) {
        return;
      }

      persistActiveTabView();
      const session = getTabById(tabId);
      if (!session) return;
      if (
        session.runtime.store.document.getState().documentLoadState !== "ready"
      ) {
        toast.error(t("common.processing"));
        return;
      }

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
            title: getEditorTabTitle(session),
            isDirty: session.runtime.store.document.getState().isDirty,
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
      persistActiveTabView,
      commitTransferredSourceTab,
      createTransferAckWaiter,
      extractTransferSourceTab,
      getTabById,
      platformWindowId,
      refreshMergeWindowTargets,
      restoreTransferredSourceTab,
      supportsMultiWindow,
      t,
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

      persistActiveTabView();
      moveTabToWindow(tabId, target.windowId, target.targetIndex);
    },
    [persistActiveTabView, moveTabToWindow, platformWindowId],
  );

  const generatePDF = useCallback(
    async (
      snapshot: ReturnType<EditorViewApi["getState"]>,
      options?: {
        flattenFormFields?: boolean;
        preserveOwnerRestrictions?: boolean;
      },
    ) => {
      if (!snapshot.pdfBytes) return null;
      if (snapshot.documentLoadState !== "ready") return null;

      const { exportPDF } = await import("./services/pdfService");
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
          imageCompression: snapshot.options.imageCompression,
          preservedSourceAnnotations: snapshot.preservedSourceAnnotations,
          flattenFormFields: options?.flattenFormFields,
          syncFormFields: true,
          sourceDocumentPermissions:
            snapshot.sourceDocumentPermissions ?? snapshot.documentPermissions,
          preserveOwnerRestrictions:
            options?.preserveOwnerRestrictions ??
            snapshot.preservePdfOwnerRestrictionsOnSave,
          ownerPassword: snapshot.pdfOwnerPassword,
        },
      );
    },
    [],
  );

  const commitSavedPdf = useCallback(
    async (options: {
      store: EditorViewApi;
      snapshot: ReturnType<EditorViewApi["getState"]>;
      target: SaveTarget;
      pdfBytes: Uint8Array;
      fallbackFilename?: string;
    }) => {
      const { target, pdfBytes } = options;
      const nextFilename = (() => {
        if (target.kind === "tauri") {
          const normalized = target.path.replace(/\\/g, "/");
          const parts = normalized.split("/").filter(Boolean);
          return (
            parts[parts.length - 1] ||
            options.fallbackFilename ||
            "document.pdf"
          );
        }
        return (
          target.handle?.name || options.fallbackFilename || "document.pdf"
        );
      })();

      let nextSaveTarget = target;

      if (target.kind === "web") {
        const remembered = await rememberWebRecentFile({
          path: target.id,
          handle: target.handle,
          filename: nextFilename,
          pdfBytes,
          forcePreviewRender: true,
        });

        nextSaveTarget = {
          ...target,
          ...(remembered.path ? { id: remembered.path } : {}),
        };
      }

      commitDocumentSaveState(
        options.store,
        options.snapshot,
        nextSaveTarget,
        nextFilename,
      );

      if (target.kind === "tauri") {
        recentFilesService.upsertWithBytesPreview({
          path: target.path,
          filename: nextFilename,
          pdfBytes,
          targetWidth: 240,
          renderAnnotations: true,
          forcePreviewRender: true,
        });
      }
    },
    [],
  );

  const handleSaveAs = useCallback(async (): Promise<boolean> => {
    const store = getActiveEditorView();
    const initialSnapshot = store.getState();
    if (!initialSnapshot.pdfBytes) return false;
    if (initialSnapshot.documentLoadState !== "ready") {
      toast.error(t("common.processing"));
      return false;
    }
    const permissionBlockReason = getPdfPermissionSaveBlockReason(
      initialSnapshot.documentPermissions,
      initialSnapshot.dirtyPermissionScopes,
    );
    if (permissionBlockReason) {
      toast.error(t(`app.save_permission_denied.${permissionBlockReason}`));
      return false;
    }

    let target: SaveTarget | null = null;
    try {
      target = await pickSaveTarget({
        suggestedName: initialSnapshot.filename || "document.pdf",
        filters: [{ name: "PDF Document", extensions: ["pdf"] }],
      });
    } catch (err) {
      if (err instanceof Error && err?.name === "AbortError") return false;
      console.error("Save As failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`${t("app.save_fail")}${msg ? `: ${msg}` : ""}`);
      return false;
    }
    if (!target) return false;

    return await initialSnapshot
      .withProcessing(t("app.generating"), async () => {
        const snapshot = store.getState();
        const modifiedBytes = await generatePDF(snapshot);
        if (!modifiedBytes) return false;

        await writeToSaveTarget(target, modifiedBytes);
        await commitSavedPdf({
          store,
          snapshot,
          target,
          pdfBytes: modifiedBytes,
          fallbackFilename: snapshot.filename,
        });

        toast.success(t("app.save_success"));
        return true;
      })
      .catch((err) => {
        if (err?.name === "AbortError") return false;
        console.error("Save As failed:", err);
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`${t("app.save_fail")}${msg ? `: ${msg}` : ""}`);
        return false;
      });
  }, [commitSavedPdf, generatePDF, t, withProcessing]);

  const handleSave = useCallback(async (): Promise<boolean> => {
    const store = getActiveEditorView();
    const initialSnapshot = store.getState();
    if (!initialSnapshot.pdfBytes) return false;
    if (initialSnapshot.documentLoadState !== "ready") {
      toast.error(t("common.processing"));
      return false;
    }
    const permissionBlockReason = getPdfPermissionSaveBlockReason(
      initialSnapshot.documentPermissions,
      initialSnapshot.dirtyPermissionScopes,
    );
    if (permissionBlockReason) {
      toast.error(t(`app.save_permission_denied.${permissionBlockReason}`));
      return false;
    }

    let preselectedTarget: SaveTarget | null = null;

    if (!initialSnapshot.saveTarget && canSaveWithPicker()) {
      try {
        preselectedTarget = await pickSaveTarget({
          suggestedName: initialSnapshot.filename || "document.pdf",
          filters: [{ name: "PDF Document", extensions: ["pdf"] }],
        });
      } catch (error) {
        if (error instanceof Error && error?.name === "AbortError")
          return false;

        console.error("Save failed:", error);
        const msg = error instanceof Error ? error.message : String(error);
        toast.error(`${t("app.save_fail")}${msg ? `: ${msg}` : ""}`);
        return false;
      }
      if (!preselectedTarget) return false;
    }

    return await initialSnapshot
      .withProcessing(t("app.generating"), async () => {
        const snapshot = store.getState();
        const modifiedBytes = await generatePDF(snapshot);
        if (!modifiedBytes) return false;

        let result: Awaited<ReturnType<typeof savePdfBytes>>;
        if (preselectedTarget) {
          await writeToSaveTarget(preselectedTarget, modifiedBytes);
          result = {
            ok: true,
            kind: "saved",
            target: preselectedTarget,
          };
        } else {
          result = await savePdfBytes({
            bytes: modifiedBytes,
            filename: snapshot.filename || "document.pdf",
            existingTarget: snapshot.saveTarget,
          });
        }

        if (!result.ok) return false;

        if (result.kind === "saved") {
          await commitSavedPdf({
            store,
            snapshot,
            target: result.target,
            pdfBytes: modifiedBytes,
            fallbackFilename: snapshot.filename,
          });
          toast.success(t("app.save_success"));
        }

        return true;
      })
      .catch((error) => {
        console.error("Save failed:", error);
        const msg = error instanceof Error ? error.message : String(error);
        toast.error(`${t("app.save_fail")}${msg ? `: ${msg}` : ""}`);
        return false;
      });
  }, [commitSavedPdf, generatePDF, t, withProcessing]);

  const handlePrint = useCallback(async () => {
    const snapshot = useEditorView.getState();
    if (snapshot.documentLoadState !== "ready") {
      toast.error(t("common.processing"));
      return;
    }
    if (!canPrintPdf(snapshot.documentPermissions)) {
      toast.error(t("app.print_permission_denied"));
      return;
    }

    await withProcessing(t("app.generating"), async () => {
      const modifiedBytes = await generatePDF(snapshot, {
        flattenFormFields: true,
        preserveOwnerRestrictions: false,
      });
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
    const snapshot = useEditorView.getState();
    if (!snapshot.isDirty) return true;
    const store = getActiveEditorView();
    const saved = await handleSave();
    const current = store.getState();
    // Download-only browsers have no persistent save target; a successful
    // download still permits closing, but never discard concurrent edits.
    return (
      saved && (!current.isDirty || isSavedDocumentRevision(current, snapshot))
    );
  }, [handleSave]);

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
    persistActiveTabView,
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
    hasDirtyTabs: tabs.some(
      (tab) => tab.runtime.store.document.getState().isDirty,
    ),
    persistCurrentTabState: persistActiveTabView,
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

  const selectEditorTab = useCallback(
    (tabId: string) => {
      activateTab(tabId);
    },
    [activateTab],
  );

  const closeEditorTab = useCallback(
    (tabId: string) => {
      void requestCloseTab(tabId);
    },
    [requestCloseTab],
  );

  const editorTabsRuntime = useMemo(
    () => ({
      windowId: platformWindowId,
      sessions: tabs,
      tabs: editorTabDescriptors,
      activeTabId,
      mergeWindowTargets,
      refreshMergeWindowTargets,
      selectTab: selectEditorTab,
      closeTab: closeEditorTab,
      moveTab: handleMoveTab,
      detachTab: handleDetachTabToNewWindow,
      mergeTabToWindow: handleMergeTabToWindow,
      canDetachTabs: supportsMultiWindow && windowLayout.tabIds.length > 1,
      canMergeTabs: supportsMultiWindow && mergeWindowTargets.length > 0,
    }),
    [
      activeTabId,
      closeEditorTab,
      editorTabDescriptors,
      tabs,
      handleDetachTabToNewWindow,
      handleMergeTabToWindow,
      handleMoveTab,
      mergeWindowTargets,
      platformWindowId,
      refreshMergeWindowTargets,
      selectEditorTab,
      supportsMultiWindow,
      windowLayout.tabIds.length,
    ],
  );

  const editorDocumentRuntime = useMemo(
    () => ({
      sessionRenderKey: activeTabId,
      workerService: activeTab?.workerService ?? null,
      isFileDragActive,
      save: handleSave,
      saveAs: handleSaveAs,
      exit: onEditorCloseCurrentTabAfterSave,
      print: onEditorPrint,
      requestCloseCurrentTab: onEditorCloseCurrentTab,
    }),
    [
      activeTab?.workerService,
      activeTabId,
      handleSave,
      handleSaveAs,
      isFileDragActive,
      onEditorCloseCurrentTab,
      onEditorCloseCurrentTabAfterSave,
      onEditorPrint,
    ],
  );

  return (
    <GlobalAiProvider workspace={aiWorkspace}>
      <div className="flex h-full w-full flex-col">
        <EditorRuntimeProvider
          tabs={editorTabsRuntime}
          document={editorDocumentRuntime}
        >
          <AppRoutes
            page={workspacePage}
            showHome={showHome}
            homeProps={{
              adapter: homePageAdapter,
            }}
          />
        </EditorRuntimeProvider>

        {activeDialog === "shortcuts" && (
          <React.Suspense fallback={null}>
            <KeyboardShortcutsHelp
              isOpen
              onClose={() => setState({ activeDialog: null })}
            />
          </React.Suspense>
        )}
        {activeDialog === "settings" && (
          <React.Suspense fallback={null}>
            <SettingsDialog
              isOpen
              onClose={() => setState({ activeDialog: null })}
              options={options}
              onChange={(updates) => setOptions(updates)}
            />
          </React.Suspense>
        )}

        {pendingCloseRequest !== null && (
          <React.Suspense fallback={null}>
            <EditorCloseConfirmDialog
              open
              isDirty={true}
              documentTitle={pendingCloseDocumentTitle}
              onCloseDialog={dismissCloseRequest}
              onSaveAndClose={async () => {
                await resolveCloseRequest(true);
              }}
              onCloseWithoutSaving={async () => {
                await resolveCloseRequest(false);
              }}
            />
          </React.Suspense>
        )}

        {pdfPasswordPrompt && (
          <React.Suspense fallback={null}>
            <PdfPasswordDialog
              prompt={{
                id: pdfPasswordPrompt.id,
                reason: pdfPasswordPrompt.reason,
              }}
              onCancel={() => {
                const currentPrompt = pdfPasswordPrompt;
                setPdfPasswordPrompt(null);
                currentPrompt.cancel();
              }}
              onSubmit={(password) => {
                const currentPrompt = pdfPasswordPrompt;
                setPdfPasswordPrompt(null);
                currentPrompt.submit(password);
              }}
            />
          </React.Suspense>
        )}
      </div>
    </GlobalAiProvider>
  );
};

export default App;
