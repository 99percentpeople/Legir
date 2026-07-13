import React from "react";
import { useShallow } from "zustand/react/shallow";

import {
  EditorPdfSearchProvider,
  EditorShellCommandsProvider,
  type EditorShellCommands,
} from "@/app/editorShellContext";
import {
  useEditorDocumentRuntime,
  useEditorTabsRuntime,
} from "@/app/editorRuntime";
import { useLanguage } from "@/components/language-provider";
import { RightPanelTabDock } from "@/components/properties-panel/RightPanelTabDock";
import Sidebar from "@/components/sidebar/Sidebar";
import Toolbar from "@/components/toolbar/Toolbar";
import {
  calculateWorkspaceFitScreenScale,
  calculateWorkspaceFitWidthScale,
} from "@/components/workspace/lib/calculateWorkspaceFitScale";
import { TranslationFloatingWindow } from "@/components/workspace/widgets/TranslationFloatingWindow";
import { ANNOTATION_STYLES } from "@/constants";
import { useAiChatController } from "@/hooks/useAiChatController";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { useIsMobile } from "@/hooks/useIsMobile";
import { usePdfPermissionUi } from "@/hooks/usePdfPermissionUi";
import { appEventBus } from "@/lib/eventBus";
import { canUseModeWithPdfPermissions } from "@/lib/pdfPermissions";
import {
  exitPlatformFullscreen,
  setPlatformFullscreen,
  subscribePlatformFullscreenChange,
} from "@/services/platform";
import {
  selectAiChatEditorState,
  selectEditorPageState,
} from "@/store/selectors";
import { useEditorStore } from "@/store/useEditorStore";
import type { EditorState, EditorUiState, Tool } from "@/types";
import { EditorCanvasPane } from "./EditorCanvasPane";
import { EditorRightPanel } from "./EditorRightPanel";
import { EditorTabStrip } from "./components/EditorTabStrip";
import { useEditorPageKeyboardShortcuts } from "./hooks/useEditorPageKeyboardShortcuts";
import { useEditorPageLifecycle } from "./hooks/useEditorPageLifecycle";
import { usePdfSearchController } from "./hooks/usePdfSearchController";

const EditorPage: React.FC = () => {
  const state = useEditorStore(useShallow(selectEditorPageState));
  const aiEditorState = useEditorStore(useShallow(selectAiChatEditorState));
  const { tabs, activeTabId } = useEditorTabsRuntime();
  const documentRuntime = useEditorDocumentRuntime();
  const { t } = useLanguage();
  const permissionUi = usePdfPermissionUi(state.documentPermissions);
  const isMobile = useIsMobile();
  const defaultTool: Tool = isMobile ? "pan" : "select";
  const prevSelectedIdRef = React.useRef<string | null>(null);

  const [isTranslateOpen, setIsTranslateOpen] = React.useState(false);
  const [translateSourceText, setTranslateSourceText] = React.useState("");
  const [translateAutoToken, setTranslateAutoToken] = React.useState(0);

  React.useEffect(() => {
    if (!isMobile) return;
    const currentState = useEditorStore.getState();
    if (currentState.tool !== "select" || currentState.selectedId) return;
    currentState.setTool("pan");
  }, [isMobile]);

  const aiChat = useAiChatController(
    aiEditorState,
    activeTabId ?? undefined,
    documentRuntime.workerService ?? undefined,
  );

  const openAiChatPanel = React.useCallback(() => {
    state.setUiState((prev) => {
      const updates: Partial<EditorUiState> = {
        rightPanelTab: "ai_chat",
        isRightPanelOpen: true,
      };
      if (prev.isPanelFloating) updates.isSidebarOpen = false;
      return updates;
    });
  }, [state.setUiState]);

  const setEditorFullscreen = React.useCallback(
    async (next: boolean) => {
      state.setState({ isFullscreen: next });
      try {
        await setPlatformFullscreen(next);
      } catch (error) {
        console.error("Failed to toggle fullscreen", error);
        state.setState({ isFullscreen: !next });
      }
    },
    [state.setState],
  );

  const exitEditorFullscreen = React.useCallback(async () => {
    try {
      await exitPlatformFullscreen();
    } catch (error) {
      console.error("Failed to exit fullscreen", error);
    } finally {
      state.setState({ isFullscreen: false });
    }
  }, [state.setState]);

  const toggleFullscreen = React.useCallback(() => {
    const next = !useEditorStore.getState().isFullscreen;
    void setEditorFullscreen(next);
  }, [setEditorFullscreen]);

  const handleExitEditorPage = React.useCallback(() => {
    void (async () => {
      await exitEditorFullscreen();
      documentRuntime.exit();
    })();
  }, [documentRuntime, exitEditorFullscreen]);

  React.useEffect(() => {
    return () => {
      void exitEditorFullscreen();
    };
  }, [exitEditorFullscreen]);

  React.useEffect(
    () =>
      subscribePlatformFullscreenChange((isFullscreen) => {
        state.setState({ isFullscreen });
      }),
    [state.setState],
  );

  const runPrimarySaveAction = React.useCallback(async () => {
    if (!useEditorStore.getState().isDirty) return true;
    return await documentRuntime.save();
  }, [documentRuntime]);

  const { workspaceScrollContainerRef } = useEditorPageLifecycle({
    filename: state.filename,
    pagesLength: state.pages.length,
    hasDirtyTabs: tabs.some((tab) => tab.isDirty),
  });

  const pdfSearch = usePdfSearchController({
    pages: state.pages,
    workerService: documentRuntime.workerService,
    sidebarOpen: state.isSidebarOpen,
    setUiState: state.setUiState,
    highlightedSearchResultsByPage: aiChat.highlightedSearchResultsByPage,
    t,
  });

  const handleModeChange = React.useCallback(
    (mode: EditorState["mode"]) => {
      if (!canUseModeWithPdfPermissions(mode, state.documentPermissions)) {
        state.setTool("select");
        return;
      }
      state.setState({ mode, tool: defaultTool });
    },
    [defaultTool, state.documentPermissions, state.setState, state.setTool],
  );

  useEditorPageKeyboardShortcuts({
    defaultTool,
    isPdfSearchOpen: pdfSearch.isPdfSearchOpen,
    openPdfSearch: pdfSearch.openPdfSearch,
    closePdfSearch: pdfSearch.closePdfSearch,
    runPrimarySaveAction,
    onPrint: documentRuntime.print,
    onToggleFullscreen: toggleFullscreen,
  });

  useAppEvent("sidebar:focusAnnotation", () => {
    pdfSearch.dismissPdfSearch();
    state.setUiState((prev) => ({
      isSidebarOpen: true,
      sidebarTab: "annotations",
      ...(prev.isPanelFloating ? { isRightPanelOpen: false } : {}),
    }));
  });

  useAppEvent("workspace:openTranslate", ({ sourceText, autoTranslate }) => {
    const trimmed = typeof sourceText === "string" ? sourceText.trim() : "";
    if (isTranslateOpen) {
      if (trimmed) setTranslateSourceText(trimmed);
    } else {
      setTranslateSourceText(trimmed);
      setIsTranslateOpen(true);
    }
    if (autoTranslate) setTranslateAutoToken((value) => value + 1);
  });

  useAppEvent("workspace:askAi", openAiChatPanel);

  React.useEffect(() => {
    state.setUiState((prev) => {
      const hasTranslateDock = prev.rightPanelDockTab?.includes("translate");
      if (isTranslateOpen === hasTranslateDock) return {};
      return {
        rightPanelDockTab: isTranslateOpen
          ? [...(prev.rightPanelDockTab ?? []), "translate"]
          : (prev.rightPanelDockTab ?? []).filter((tab) => tab !== "translate"),
      };
    });
  }, [isTranslateOpen, state.setUiState]);

  React.useEffect(() => {
    state.setState({ isPanelFloating: isMobile });
    if (!isMobile) return;
    state.setUiState((prev) => {
      if (!prev.isSidebarOpen || !prev.isRightPanelOpen) return prev;
      return { isSidebarOpen: true, isRightPanelOpen: false };
    });
  }, [isMobile, state.setState, state.setUiState]);

  React.useEffect(() => {
    if (
      state.isPanelFloating &&
      state.isSidebarOpen &&
      state.isRightPanelOpen
    ) {
      state.setUiState({ isRightPanelOpen: false });
    }
  }, [
    state.isPanelFloating,
    state.isRightPanelOpen,
    state.isSidebarOpen,
    state.setUiState,
  ]);

  React.useEffect(() => {
    const previousId = prevSelectedIdRef.current;
    if (!previousId && state.selectedId) {
      state.setUiState({ rightPanelTab: "properties" });
    }
    prevSelectedIdRef.current = state.selectedId;
  }, [state.selectedId, state.setUiState]);

  React.useEffect(() => {
    if (!state.selectedId && state.rightPanelTab === "properties") {
      state.setUiState({ rightPanelTab: "document" });
    }
  }, [state.rightPanelTab, state.selectedId, state.setUiState]);

  React.useEffect(() => {
    appEventBus.clearSticky("workspace:focusTextRange");
  }, [state.filename, state.pages.length, state.pdfBytes]);

  React.useEffect(() => {
    setIsTranslateOpen(false);
    setTranslateSourceText("");
    setTranslateAutoToken(0);
  }, [activeTabId]);

  const handlePenStyleChange = React.useCallback(
    (style: Partial<EditorState["penStyle"]>) => {
      state.setState((prev) => ({
        penStyle: { ...prev.penStyle, ...style },
      }));
    },
    [state.setState],
  );

  const handleHighlightStyleChange = React.useCallback(
    (style: Partial<EditorState["penStyle"]>) => {
      state.setState((prev) => ({
        highlightStyle: {
          ...(prev.highlightStyle ?? ANNOTATION_STYLES.highlight),
          ...style,
        },
      }));
    },
    [state.setState],
  );

  const handleCommentStyleChange = React.useCallback(
    (style: { color: string }) => {
      state.setState((prev) => ({
        commentStyle: {
          ...(prev.commentStyle ?? ANNOTATION_STYLES.comment),
          ...style,
        },
      }));
    },
    [state.setState],
  );

  const handleFreetextStyleChange = React.useCallback(
    (style: { color: string }) => {
      state.setState((prev) => ({
        freetextStyle: { ...prev.freetextStyle!, ...style },
      }));
    },
    [state.setState],
  );

  const handleShapeStyleChange = React.useCallback(
    (style: Partial<NonNullable<EditorState["shapeStyle"]>>) => {
      state.setState((prev) => ({
        shapeStyle: { ...prev.shapeStyle!, ...style },
      }));
    },
    [state.setState],
  );

  const handleStampStyleChange = React.useCallback(
    (style: Partial<NonNullable<EditorState["stampStyle"]>>) => {
      state.setState((prev) => ({
        stampStyle: { ...prev.stampStyle!, ...style },
      }));
    },
    [state.setState],
  );

  const handleEditAnnotation = React.useCallback(
    (id: string) => {
      state.selectControl(id);
      appEventBus.emit("sidebar:focusAnnotation", { id }, { sticky: true });
    },
    [state.selectControl],
  );

  const getWorkspaceViewport = React.useCallback(() => {
    const element = workspaceScrollContainerRef.current;
    if (element) {
      return { width: element.clientWidth, height: element.clientHeight };
    }
    if (typeof window !== "undefined") {
      return { width: window.innerWidth, height: window.innerHeight };
    }
    return { width: 0, height: 0 };
  }, [workspaceScrollContainerRef]);

  const handleZoomIn = React.useCallback(() => {
    const currentScale = useEditorStore.getState().scale;
    state.setState({ scale: Math.min(5, currentScale * 1.25) });
  }, [state.setState]);

  const handleZoomOut = React.useCallback(() => {
    const currentScale = useEditorStore.getState().scale;
    state.setState({ scale: Math.max(0.25, currentScale / 1.25) });
  }, [state.setState]);

  const handleFitWidth = React.useCallback(() => {
    const liveState = useEditorStore.getState();
    state.setState({
      scale: calculateWorkspaceFitWidthScale({
        pages: liveState.pages,
        pageIndex: liveState.currentPageIndex,
        pageLayout: liveState.pageLayout,
        pageFlow: liveState.pageFlow,
        viewport: getWorkspaceViewport(),
      }),
      fitTrigger: Date.now(),
    });
  }, [getWorkspaceViewport, state.setState]);

  const handleFitScreen = React.useCallback(() => {
    const liveState = useEditorStore.getState();
    state.setState({
      scale: calculateWorkspaceFitScreenScale({
        pages: liveState.pages,
        pageIndex: liveState.currentPageIndex,
        pageLayout: liveState.pageLayout,
        pageFlow: liveState.pageFlow,
        viewport: getWorkspaceViewport(),
      }),
      fitTrigger: Date.now(),
    });
  }, [getWorkspaceViewport, state.setState]);

  const openSidebar = React.useCallback(() => {
    state.setUiState((prev) =>
      prev.isPanelFloating
        ? { isSidebarOpen: true, isRightPanelOpen: false }
        : { isSidebarOpen: true },
    );
  }, [state.setUiState]);

  const toggleSidebar = React.useCallback(() => {
    state.setUiState((prev) => {
      const isOpen = !prev.isSidebarOpen;
      return prev.isPanelFloating && isOpen
        ? { isSidebarOpen: true, isRightPanelOpen: false }
        : { isSidebarOpen: isOpen };
    });
  }, [state.setUiState]);

  const toggleRightPanel = React.useCallback(() => {
    state.setUiState((prev) => {
      const isOpen = !prev.isRightPanelOpen;
      return prev.isPanelFloating && isOpen
        ? { isRightPanelOpen: true, isSidebarOpen: false }
        : { isRightPanelOpen: isOpen };
    });
  }, [state.setUiState]);

  const shellCommands = React.useMemo<EditorShellCommands>(
    () => ({
      zoomIn: handleZoomIn,
      zoomOut: handleZoomOut,
      fitWidth: handleFitWidth,
      fitScreen: handleFitScreen,
      toggleFullscreen,
      exitEditor: handleExitEditorPage,
      changeMode: handleModeChange,
      changePenStyle: handlePenStyleChange,
      changeHighlightStyle: handleHighlightStyleChange,
      changeCommentStyle: handleCommentStyleChange,
      changeFreetextStyle: handleFreetextStyleChange,
      changeShapeStyle: handleShapeStyleChange,
      changeStampStyle: handleStampStyleChange,
      editAnnotation: handleEditAnnotation,
      openSidebar,
      toggleSidebar,
      toggleRightPanel,
    }),
    [
      handleCommentStyleChange,
      handleEditAnnotation,
      handleExitEditorPage,
      handleFitScreen,
      handleFitWidth,
      handleFreetextStyleChange,
      handleHighlightStyleChange,
      handleModeChange,
      handlePenStyleChange,
      handleShapeStyleChange,
      handleStampStyleChange,
      handleZoomIn,
      handleZoomOut,
      openSidebar,
      toggleFullscreen,
      toggleRightPanel,
      toggleSidebar,
    ],
  );

  return (
    <EditorShellCommandsProvider value={shellCommands}>
      <EditorPdfSearchProvider value={pdfSearch}>
        <EditorTabStrip />
        <Toolbar />

        <div className="relative flex flex-1 overflow-hidden">
          {state.isPanelFloating &&
            (state.isSidebarOpen || state.isRightPanelOpen) && (
              <div
                className="absolute inset-0 z-30 bg-black/20"
                onMouseDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  state.setUiState({
                    isSidebarOpen: false,
                    isRightPanelOpen: false,
                  });
                }}
              />
            )}

          <Sidebar />
          <EditorCanvasPane />

          <RightPanelTabDock
            activeTabs={
              state.isRightPanelOpen
                ? [state.rightPanelTab, ...state.rightPanelDockTab]
                : [...state.rightPanelDockTab]
            }
            isFloating={state.isPanelFloating}
            rightOffsetPx={state.isRightPanelOpen ? state.rightPanelWidth : 0}
            canOpenProperties={state.hasSelectedControl}
            canOpenPageTranslate={permissionUi.canAll([
              "extract_text",
              "create_annotation",
            ])}
            onSelectTab={(tab) => {
              if (tab === "properties" && !state.hasSelectedControl) return;
              state.setUiState((prev) => ({
                rightPanelTab: tab,
                isRightPanelOpen: true,
                ...(prev.isPanelFloating ? { isSidebarOpen: false } : {}),
              }));
            }}
          />

          <EditorRightPanel aiChat={aiChat} />

          <TranslationFloatingWindow
            isOpen={isTranslateOpen}
            sourceText={translateSourceText}
            autoTranslateToken={translateAutoToken}
            onClose={() => setIsTranslateOpen(false)}
          />
        </div>
      </EditorPdfSearchProvider>
    </EditorShellCommandsProvider>
  );
};

export default React.memo(EditorPage);
