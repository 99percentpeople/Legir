import React from "react";
import { useShallow } from "zustand/react/shallow";

import {
  EditorShellCommandsProvider,
  type EditorShellCommands,
} from "@/app/editorShellContext";
import {
  useEditorDocumentCommandsRuntime,
  useEditorPageTabsRuntime,
} from "@/app/editorRuntime";
import { RightPanelTabDock } from "@/components/properties-panel/RightPanelTabDock";
import Sidebar from "@/components/sidebar/Sidebar";
import Toolbar from "@/components/toolbar/Toolbar";
import {
  calculateWorkspaceFitScreenScale,
  calculateWorkspaceFitWidthScale,
} from "@/components/workspace/lib/calculateWorkspaceFitScale";
import { TranslationFloatingWindow } from "@/components/workspace/widgets/TranslationFloatingWindow";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { useIsMobile } from "@/hooks/useIsMobile";
import { usePdfPermissionUi } from "@/hooks/usePdfPermissionUi";
import { appEventBus } from "@/lib/eventBus";
import {
  exitPlatformFullscreen,
  setPlatformFullscreen,
  subscribePlatformFullscreenChange,
} from "@/services/platform";
import {
  selectEditorPageState,
  selectHasSelectedControl,
} from "@/store/selectors";
import { useEditorStore } from "@/store/useEditorStore";
import type { EditorState, PDFSearchResult, Tool } from "@/types";
import { EditorCanvasPane } from "./EditorCanvasPane";
import { EditorControllerProviders } from "./EditorControllerProviders";
import { EditorRightPanelSkeleton } from "./components/EditorRightPanelSkeleton";
import { EditorTabStrip } from "./components/EditorTabStrip";
import { useEditorPageLifecycle } from "./hooks/useEditorPageLifecycle";
import {
  EditorRightPanel,
  scheduleEditorRightPanelBranchPreload,
} from "./rightPanelModules";

const EditorPage: React.FC = () => {
  const state = useEditorStore(useShallow(selectEditorPageState));
  const hasSelectedControl = useEditorStore(selectHasSelectedControl);
  const { activeTabId, hasDirtyTabs } = useEditorPageTabsRuntime();
  const documentCommands = useEditorDocumentCommandsRuntime();
  const permissionUi = usePdfPermissionUi(state.documentPermissions);
  const isMobile = useIsMobile();
  // Keep the responsive default for explicit mode changes and resets, but do
  // not synchronize it to the active tool when the viewport width changes.
  const defaultTool: Tool = isMobile ? "pan" : "select";
  const prevSelectedIdRef = React.useRef<string | null>(null);

  const [isTranslateOpen, setIsTranslateOpen] = React.useState(false);
  const [translateSourceText, setTranslateSourceText] = React.useState("");
  const [translateAutoToken, setTranslateAutoToken] = React.useState(0);
  const [aiSearchHighlights, setAiSearchHighlights] = React.useState<
    Map<number, PDFSearchResult[]>
  >(() => new Map());
  const [hasInitializedRightPanel, setHasInitializedRightPanel] =
    React.useState(false);

  React.useEffect(() => {
    if (state.pages.length === 0) return;
    void EditorRightPanel.preload();
    setHasInitializedRightPanel(true);
    return scheduleEditorRightPanelBranchPreload();
  }, [state.pages.length]);

  const openAiChatPanel = React.useCallback(() => {
    state.openRightPanel("ai_chat");
  }, [state.openRightPanel]);

  const setEditorFullscreen = React.useCallback(
    async (next: boolean) => {
      state.setEditorFullscreen(next);
      try {
        await setPlatformFullscreen(next);
      } catch (error) {
        console.error("Failed to toggle fullscreen", error);
        state.setEditorFullscreen(!next);
      }
    },
    [state.setEditorFullscreen],
  );

  const exitEditorFullscreen = React.useCallback(async () => {
    try {
      await exitPlatformFullscreen();
    } catch (error) {
      console.error("Failed to exit fullscreen", error);
    } finally {
      state.setEditorFullscreen(false);
    }
  }, [state.setEditorFullscreen]);

  const toggleFullscreen = React.useCallback(() => {
    const next = !useEditorStore.getState().isFullscreen;
    void setEditorFullscreen(next);
  }, [setEditorFullscreen]);

  const handleExitEditorPage = React.useCallback(() => {
    void (async () => {
      await exitEditorFullscreen();
      documentCommands.exit();
    })();
  }, [documentCommands.exit, exitEditorFullscreen]);

  React.useEffect(() => {
    return () => {
      void exitEditorFullscreen();
    };
  }, [exitEditorFullscreen]);

  React.useEffect(
    () =>
      subscribePlatformFullscreenChange((isFullscreen) => {
        state.setEditorFullscreen(isFullscreen);
      }),
    [state.setEditorFullscreen],
  );

  const runPrimarySaveAction = React.useCallback(async () => {
    if (!useEditorStore.getState().isDirty) return true;
    return await documentCommands.save();
  }, [documentCommands.save]);

  const { workspaceScrollContainerRef } = useEditorPageLifecycle({
    filename: state.filename,
    pagesLength: state.pages.length,
    hasDirtyTabs,
  });

  const handleModeChange = React.useCallback(
    (mode: EditorState["mode"]) => {
      state.setEditorMode(mode, defaultTool);
    },
    [defaultTool, state.setEditorMode],
  );

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
      if (isTranslateOpen === hasTranslateDock) return prev;
      return {
        rightPanelDockTab: isTranslateOpen
          ? [...(prev.rightPanelDockTab ?? []), "translate"]
          : (prev.rightPanelDockTab ?? []).filter((tab) => tab !== "translate"),
      };
    });
  }, [isTranslateOpen, state.setUiState]);

  React.useEffect(() => {
    state.setPanelFloating(isMobile);
  }, [
    isMobile,
    state.isSidebarOpen,
    state.isRightPanelOpen,
    state.setPanelFloating,
  ]);

  React.useEffect(() => {
    state.syncPanelSelection(prevSelectedIdRef.current);
    prevSelectedIdRef.current = state.selectedId;
  }, [
    state.selectedId,
    hasSelectedControl,
    state.rightPanelTab,
    state.syncPanelSelection,
  ]);

  React.useEffect(() => {
    appEventBus.clearSticky("workspace:focusTextRange");
  }, [state.filename, state.pages.length, state.pdfBytes]);

  React.useEffect(() => {
    setIsTranslateOpen(false);
    setTranslateSourceText("");
    setTranslateAutoToken(0);
    setAiSearchHighlights(new Map());
  }, [activeTabId]);

  const handlePenStyleChange = React.useCallback(
    (style: Partial<EditorState["penStyle"]>) =>
      state.updateToolStyle("penStyle", style),
    [state.updateToolStyle],
  );
  const handleHighlightStyleChange = React.useCallback(
    (style: Partial<EditorState["penStyle"]>) =>
      state.updateToolStyle("highlightStyle", style),
    [state.updateToolStyle],
  );
  const handleCommentStyleChange = React.useCallback(
    (style: { color: string }) => state.updateToolStyle("commentStyle", style),
    [state.updateToolStyle],
  );
  const handleFreetextStyleChange = React.useCallback(
    (style: { color: string }) => state.updateToolStyle("freetextStyle", style),
    [state.updateToolStyle],
  );
  const handleShapeStyleChange = React.useCallback(
    (style: Partial<NonNullable<EditorState["shapeStyle"]>>) =>
      state.updateToolStyle("shapeStyle", style),
    [state.updateToolStyle],
  );
  const handleStampStyleChange = React.useCallback(
    (style: Partial<NonNullable<EditorState["stampStyle"]>>) =>
      state.updateToolStyle("stampStyle", style),
    [state.updateToolStyle],
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
    state.zoomBy(1.25);
  }, [state.zoomBy]);

  const handleZoomOut = React.useCallback(() => {
    state.zoomBy(1 / 1.25);
  }, [state.zoomBy]);

  const handleFitWidth = React.useCallback(() => {
    const liveState = useEditorStore.getState();
    state.fitToScale(
      calculateWorkspaceFitWidthScale({
        pages: liveState.pages,
        pageIndex: liveState.currentPageIndex,
        pageLayout: liveState.pageLayout,
        pageFlow: liveState.pageFlow,
        viewport: getWorkspaceViewport(),
      }),
    );
  }, [getWorkspaceViewport, state.fitToScale]);

  const handleFitScreen = React.useCallback(() => {
    const liveState = useEditorStore.getState();
    state.fitToScale(
      calculateWorkspaceFitScreenScale({
        pages: liveState.pages,
        pageIndex: liveState.currentPageIndex,
        pageLayout: liveState.pageLayout,
        pageFlow: liveState.pageFlow,
        viewport: getWorkspaceViewport(),
      }),
    );
  }, [getWorkspaceViewport, state.fitToScale]);

  const openSidebar = React.useCallback(
    () => state.openSidebar(),
    [state.openSidebar],
  );
  const toggleSidebar = state.toggleSidebar;
  const toggleRightPanel = state.toggleRightPanel;

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
    <EditorControllerProviders
      highlightedSearchResultsByPage={aiSearchHighlights}
      defaultTool={defaultTool}
      runPrimarySaveAction={runPrimarySaveAction}
      onPrint={documentCommands.print}
      onToggleFullscreen={toggleFullscreen}
    >
      <EditorShellCommandsProvider value={shellCommands}>
        <EditorTabStrip />
        <Toolbar />

        <div className="relative flex flex-1 overflow-hidden">
          {state.isPanelFloating &&
            (state.isSidebarOpen || state.isRightPanelOpen) && (
              <div
                className="absolute inset-0 z-30 bg-black/20"
                onMouseDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  state.closeFloatingPanels();
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
            canOpenProperties={hasSelectedControl}
            canOpenPageTranslate={permissionUi.canAll([
              "extract_text",
              "create_annotation",
            ])}
            onSelectTab={(tab) => {
              state.openRightPanel(tab);
            }}
          />

          {state.isRightPanelOpen && !hasInitializedRightPanel && (
            <EditorRightPanelSkeleton
              isFloating={state.isPanelFloating}
              width={state.rightPanelWidth}
            />
          )}

          {hasInitializedRightPanel && (
            <React.Suspense
              fallback={
                state.isRightPanelOpen ? (
                  <EditorRightPanelSkeleton
                    isFloating={state.isPanelFloating}
                    width={state.rightPanelWidth}
                  />
                ) : null
              }
            >
              <EditorRightPanel
                aiScopeId={activeTabId ?? undefined}
                onAiSearchHighlightsChange={setAiSearchHighlights}
              />
            </React.Suspense>
          )}

          <TranslationFloatingWindow
            isOpen={isTranslateOpen}
            sourceText={translateSourceText}
            autoTranslateToken={translateAutoToken}
            onClose={() => setIsTranslateOpen(false)}
          />
        </div>
      </EditorShellCommandsProvider>
    </EditorControllerProviders>
  );
};

export default React.memo(EditorPage);
