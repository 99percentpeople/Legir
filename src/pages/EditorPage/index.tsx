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
import { useEditorToolActions } from "@/hooks/useEditorToolActions";
import { usePdfPermissionUi } from "@/hooks/usePdfPermissionUi";
import {
  useEditorEventBus,
  useEditorTabIsActive,
} from "@/app/editorTabs/context";
import {
  exitPlatformFullscreen,
  setPlatformFullscreen,
  subscribePlatformFullscreenChange,
} from "@/services/platform";
import {
  selectEditorPageState,
  selectHasSelectedControl,
} from "@/store/selectors";
import {
  useEditorView as useDocumentState,
  useEditorViewApi,
} from "@/store/useEditorView";
import type { EditorState, PDFSearchResult, Tool } from "@/types";
import { EditorCanvasPane } from "./EditorCanvasPane";
import { EditorControllerProviders } from "./EditorControllerProviders";
import { EditorRightPanelSkeleton } from "./components/EditorRightPanelSkeleton";
import { useEditorPageLifecycle } from "./hooks/useEditorPageLifecycle";
import {
  EditorRightPanel,
  scheduleEditorRightPanelBranchPreload,
} from "./rightPanelModules";

const EditorPage: React.FC = () => {
  const appEventBus = useEditorEventBus();
  const isActive = useEditorTabIsActive();
  const useEditorView = useEditorViewApi();
  const state = useDocumentState(useShallow(selectEditorPageState));
  const hasSelectedControl = useDocumentState(selectHasSelectedControl);
  const { activeTabId } = useEditorPageTabsRuntime();
  const documentCommands = useEditorDocumentCommandsRuntime();
  const permissionUi = usePdfPermissionUi(state.documentPermissions);
  const isMobile = useIsMobile();
  // Keep the responsive default for explicit mode changes and resets, but do
  // not synchronize it to the active tool when the viewport width changes.
  const defaultTool: Tool = isMobile ? "pan" : "select";
  const { changeTool, exitTool } = useEditorToolActions(defaultTool);
  const previousSelectionRef = React.useRef({
    selectedId: state.selectedId,
    hasSelectedControl,
  });

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
    const next = !useEditorView.getState().isFullscreen;
    void setEditorFullscreen(next);
  }, [setEditorFullscreen]);

  const handleExitEditorPage = React.useCallback(() => {
    void (async () => {
      await exitEditorFullscreen();
      documentCommands.exit();
    })();
  }, [documentCommands.exit, exitEditorFullscreen]);

  React.useEffect(
    () =>
      subscribePlatformFullscreenChange((isFullscreen) => {
        state.setEditorFullscreen(isFullscreen);
      }),
    [state.setEditorFullscreen],
  );

  const runPrimarySaveAction = React.useCallback(async () => {
    if (!useEditorView.getState().isDirty) return true;
    return await documentCommands.save();
  }, [documentCommands.save]);

  const { workspaceScrollContainerRef } = useEditorPageLifecycle();

  const handleModeChange = React.useCallback(
    (mode: EditorState["mode"]) => {
      appEventBus.emit("workspace:cancelToolInteraction", {
        draftsOnly: false,
        handled: false,
      });
      state.setEditorMode(mode, defaultTool);
    },
    [appEventBus, defaultTool, state.setEditorMode],
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
    if (isActive) state.setPanelFloating(isMobile);
  }, [
    isActive,
    isMobile,
    state.isSidebarOpen,
    state.isRightPanelOpen,
    state.setPanelFloating,
  ]);

  React.useEffect(() => {
    const previous = previousSelectionRef.current;
    previousSelectionRef.current = {
      selectedId: state.selectedId,
      hasSelectedControl,
    };
    // Only a selection change in the foreground document may change the
    // shared panel. Mounting/activating a tab must preserve the chosen panel.
    if (
      isActive &&
      (previous.selectedId !== state.selectedId ||
        previous.hasSelectedControl !== hasSelectedControl)
    ) {
      state.syncPanelSelection(previous.selectedId);
    }
  }, [
    isActive,
    state.selectedId,
    hasSelectedControl,
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
    const liveState = useEditorView.getState();
    state.fitToScale(
      calculateWorkspaceFitWidthScale({
        pages: liveState.pages,
        viewRotation: liveState.viewRotation,
        pageIndex: liveState.currentPageIndex,
        pageLayout: liveState.pageLayout,
        pageFlow: liveState.pageFlow,
        viewport: getWorkspaceViewport(),
      }),
    );
  }, [getWorkspaceViewport, state.fitToScale]);

  const handleFitScreen = React.useCallback(() => {
    const liveState = useEditorView.getState();
    state.fitToScale(
      calculateWorkspaceFitScreenScale({
        pages: liveState.pages,
        viewRotation: liveState.viewRotation,
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
      changeTool,
      exitTool,
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
      changeTool,
      exitTool,
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
                ? [
                    state.rightPanelTab,
                    ...(isTranslateOpen ? ["translate" as const] : []),
                  ]
                : isTranslateOpen
                  ? ["translate"]
                  : []
            }
            isFloating={state.isPanelFloating}
            rightOffsetPx={state.isRightPanelOpen ? state.rightPanelWidth : 0}
            canOpenProperties={hasSelectedControl}
            canOpenPageTranslate={permissionUi.canAll([
              "extract_text",
              "create_annotation",
            ])}
            onSelectTab={(tab) => {
              if (tab !== "translate") state.openRightPanel(tab);
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
