import React from "react";
import Toolbar from "@/components/toolbar/Toolbar";
import Sidebar from "@/components/sidebar/Sidebar";
import PDFSearchHeader from "@/components/sidebar/PDFSearchHeader";
import PDFSearchPanel from "@/components/sidebar/PDFSearchPanel";
import { RightPanelTabDock } from "@/components/properties-panel/RightPanelTabDock";
import { TranslationFloatingWindow } from "@/components/workspace/widgets/TranslationFloatingWindow";
import { useLanguage } from "@/components/language-provider";
import { useIsMobile } from "@/hooks/useIsMobile";
import { usePageTranslation } from "@/hooks/usePageTranslation";
import { useAiChatController } from "@/hooks/useAiChatController";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { appEventBus } from "@/lib/eventBus";
import { getMovedAnnotationUpdates } from "@/lib/controlMovement";
import { ANNOTATION_STYLES } from "@/constants";
import {
  calculateWorkspaceFitScreenScale,
  calculateWorkspaceFitWidthScale,
} from "@/components/workspace/lib/calculateWorkspaceFitScale";
import { useEditorStore } from "@/store/useEditorStore";
import { selectEditorPageShellState } from "@/store/selectors";
import type {
  Annotation,
  EditorState,
  EditorUiState,
  FormField,
  PDFMetadata,
  Tool,
} from "@/types";
import { useShallow } from "zustand/react/shallow";
import {
  exitPlatformFullscreen,
  setPlatformFullscreen,
  subscribePlatformFullscreenChange,
} from "@/services/platform";
import { EditorCanvasPane } from "./EditorCanvasPane";
import { EditorRightPanel } from "./EditorRightPanel";
import { EditorTabStrip } from "./components/EditorTabStrip";
import { useEditorPageKeyboardShortcuts } from "./hooks/useEditorPageKeyboardShortcuts";
import { useEditorPageLifecycle } from "./hooks/useEditorPageLifecycle";
import { usePdfSearchController } from "./hooks/usePdfSearchController";
import type { EditorPageProps } from "./types";

export type { EditorPageProps } from "./types";

const EditorPage: React.FC<EditorPageProps> = ({
  windowId,
  tabs,
  activeTabId,
  workerService,
  isFileDragActive,
  mergeWindowTargets,
  onOpenDocument,
  onRefreshMergeWindowTargets,
  onSelectTab,
  onCloseTab,
  onMoveTab,
  onDetachTab,
  onMergeTabToWindow,
  canDetachTabs,
  canMergeTabs,
  onExport,
  onSaveAs,
  onExit,
  onPrint,
  onRequestCloseCurrentTab,
}) => {
  const editorStore = useEditorStore(useShallow(selectEditorPageShellState));
  const state = editorStore;
  const { t, effectiveLanguage } = useLanguage();
  const {
    setState,
    setUiState,
    addAnnotations,
    updateAnnotation,
    addAnnotationReply,
    updateAnnotationReply,
    deleteAnnotationReply,
    deleteSelection,
    selectControl,
    setTool,
    saveCheckpoint,
    setProcessingStatus,
    withProcessing,
    undo,
    redo,
    deleteAnnotation,
    openDialog,
    setPageTranslateParagraphCandidates,
    clearPageTranslateParagraphCandidates,
    setSelectedPageTranslateParagraphIds,
    mergeSelectedPageTranslateParagraphs,
    toggleExcludeSelectedPageTranslateParagraphs,
    deleteSelectedPageTranslateParagraphs,
    removePageTranslateParagraphCandidatesByPageIndex,
    setAllFreetextFlatten,
  } = editorStore;

  const isMobile = useIsMobile();
  const defaultTool: Tool = isMobile ? "pan" : "select";
  const prevSelectedIdRef = React.useRef<string | null>(null);

  const [isTranslateOpen, setIsTranslateOpen] = React.useState(false);
  const [translateSourceText, setTranslateSourceText] = React.useState("");
  const [translateAutoToken, setTranslateAutoToken] = React.useState(0);

  React.useEffect(() => {
    if (!isMobile) return;
    const currentState = useEditorStore.getState();
    if (currentState.tool !== "select") return;
    if (currentState.selectedId) return;
    currentState.setTool("pan");
  }, [isMobile]);

  const {
    isPageTranslating,
    pageTranslateStatus,
    cancelPageTranslate,
    handleStartPageTranslate,
    handlePreviewParagraphs,
    handleUnmergeSelectedParagraphs,
  } = usePageTranslation({
    state,
    workerService,
    t,
    addAnnotations,
    setState,
    setUiState,
    setProcessingStatus,
    withProcessing,
    setPageTranslateParagraphCandidates,
    setSelectedPageTranslateParagraphIds,
    removePageTranslateParagraphCandidatesByPageIndex,
  });

  const aiChat = useAiChatController(
    state,
    activeTabId ?? undefined,
    workerService ?? undefined,
  );

  const openAiChatPanel = React.useCallback(() => {
    setUiState((prev) => {
      const updates: Partial<EditorUiState> = {
        rightPanelTab: "ai_chat",
        isRightPanelOpen: true,
      };
      if (prev.isPanelFloating) {
        updates.isSidebarOpen = false;
      }
      return updates;
    });
  }, [setUiState]);

  const setEditorFullscreen = React.useCallback(
    async (next: boolean) => {
      setState({ isFullscreen: next });
      try {
        await setPlatformFullscreen(next);
      } catch (error) {
        console.error("Failed to toggle fullscreen", error);
        setState({ isFullscreen: !next });
      }
    },
    [setState],
  );

  const exitEditorFullscreen = React.useCallback(async () => {
    try {
      await exitPlatformFullscreen();
    } catch (error) {
      console.error("Failed to exit fullscreen", error);
    } finally {
      setState({ isFullscreen: false });
    }
  }, [setState]);

  const toggleFullscreen = React.useCallback(() => {
    const next = !useEditorStore.getState().isFullscreen;
    void setEditorFullscreen(next);
  }, [setEditorFullscreen]);

  const handleExitEditorPage = React.useCallback(() => {
    void (async () => {
      await exitEditorFullscreen();
      onExit();
    })();
  }, [exitEditorFullscreen, onExit]);

  React.useEffect(() => {
    return () => {
      void exitEditorFullscreen();
    };
  }, [exitEditorFullscreen]);

  React.useEffect(() => {
    return subscribePlatformFullscreenChange((isFullscreen) => {
      setState({ isFullscreen });
    });
  }, [setState]);

  const runPrimarySaveAction = React.useCallback(async () => {
    const snapshot = useEditorStore.getState();
    if (!snapshot.isDirty) return true;
    return await onExport();
  }, [onExport]);

  const { workspaceScrollContainerRef } = useEditorPageLifecycle({
    filename: state.filename,
    pagesLength: state.pages.length,
    hasDirtyTabs: tabs.some((tab) => tab.isDirty),
  });

  const pdfSearch = usePdfSearchController({
    pages: state.pages,
    workerService,
    sidebarOpen: state.isSidebarOpen,
    setUiState,
    workspaceScrollContainerRef,
    highlightedSearchResultsByPage: aiChat.highlightedSearchResultsByPage,
    t,
  });

  const handleModeChange = React.useCallback(
    (mode: EditorState["mode"]) => {
      setState({ mode, tool: defaultTool });
    },
    [defaultTool, setState],
  );

  useEditorPageKeyboardShortcuts({
    defaultTool,
    isPdfSearchOpen: pdfSearch.isPdfSearchOpen,
    openPdfSearch: pdfSearch.openPdfSearch,
    closePdfSearch: pdfSearch.closePdfSearch,
    runPrimarySaveAction,
    onPrint,
    onToggleFullscreen: toggleFullscreen,
  });

  useAppEvent("sidebar:focusAnnotation", () => {
    pdfSearch.dismissPdfSearch();
    setUiState((prev) => ({
      isSidebarOpen: true,
      sidebarTab: "annotations",
      ...(prev.isPanelFloating ? { isRightPanelOpen: false } : {}),
    }));
  });

  useAppEvent("workspace:openTranslate", ({ sourceText, autoTranslate }) => {
    const trimmed = typeof sourceText === "string" ? sourceText.trim() : "";

    if (isTranslateOpen) {
      if (trimmed !== "") setTranslateSourceText(trimmed);
    } else {
      setTranslateSourceText(trimmed);
      setIsTranslateOpen(true);
    }

    if (autoTranslate) setTranslateAutoToken((value) => value + 1);
  });

  useAppEvent("workspace:askAi", () => {
    openAiChatPanel();
  });

  React.useEffect(() => {
    if (isTranslateOpen) {
      setUiState((prev) => {
        if (prev.rightPanelDockTab?.includes("translate")) return {};
        return {
          rightPanelDockTab: [...(prev.rightPanelDockTab ?? []), "translate"],
        };
      });
      return;
    }

    setUiState((prev) => {
      if (!prev.rightPanelDockTab?.includes("translate")) return {};
      return {
        rightPanelDockTab: (prev.rightPanelDockTab ?? []).filter(
          (tab) => tab !== "translate",
        ),
      };
    });
  }, [isTranslateOpen, setUiState]);

  const selectedField =
    state.selectedId &&
    state.fields.find((field) => field.id === state.selectedId)
      ? state.fields.find((field) => field.id === state.selectedId) || null
      : null;
  const selectedAnnotation =
    state.selectedId &&
    state.annotations.find((annotation) => annotation.id === state.selectedId)
      ? state.annotations.find(
          (annotation) => annotation.id === state.selectedId,
        ) || null
      : null;
  const selectedControl = selectedField || selectedAnnotation;

  React.useEffect(() => {
    setState({ isPanelFloating: isMobile });

    if (isMobile) {
      setUiState((prev) => {
        if (!prev.isSidebarOpen || !prev.isRightPanelOpen) return prev;
        return { isSidebarOpen: true, isRightPanelOpen: false };
      });
    }
  }, [isMobile, setState, setUiState]);

  React.useEffect(() => {
    if (!state.isPanelFloating) return;
    if (state.isSidebarOpen && state.isRightPanelOpen) {
      setUiState({ isRightPanelOpen: false });
    }
  }, [
    setUiState,
    state.isPanelFloating,
    state.isRightPanelOpen,
    state.isSidebarOpen,
  ]);

  React.useEffect(() => {
    const prev = prevSelectedIdRef.current;
    const next = state.selectedId;
    if (!prev && next) {
      setUiState({ rightPanelTab: "properties" });
    }
    prevSelectedIdRef.current = next;
  }, [setUiState, state.selectedId]);

  React.useEffect(() => {
    if (!state.selectedId && state.rightPanelTab === "properties") {
      setUiState({ rightPanelTab: "document" });
    }
  }, [setUiState, state.rightPanelTab, state.selectedId]);

  React.useEffect(() => {
    appEventBus.clearSticky("workspace:focusTextRange");
  }, [state.filename, state.pages.length, state.pdfBytes]);

  React.useEffect(() => {
    cancelPageTranslate();
    setIsTranslateOpen(false);
    setTranslateSourceText("");
    setTranslateAutoToken(0);
  }, [activeTabId, cancelPageTranslate]);

  const handlePenStyleChange = React.useCallback(
    (style: Partial<EditorState["penStyle"]>) => {
      setState((prev) => ({
        ...prev,
        penStyle: { ...prev.penStyle, ...style },
      }));
    },
    [setState],
  );

  const handleHighlightStyleChange = React.useCallback(
    (style: Partial<EditorState["penStyle"]>) => {
      setState((prev) => ({
        ...prev,
        highlightStyle: {
          ...(prev.highlightStyle || {
            color: ANNOTATION_STYLES.highlight.color,
            thickness: ANNOTATION_STYLES.highlight.thickness,
            opacity: ANNOTATION_STYLES.highlight.opacity,
          }),
          ...style,
        },
      }));
    },
    [setState],
  );

  const handleCommentStyleChange = React.useCallback(
    (style: { color: string }) => {
      setState((prev) => ({
        ...prev,
        commentStyle: { ...prev.commentStyle, ...style },
      }));
    },
    [setState],
  );

  const handleFreetextStyleChange = React.useCallback(
    (style: { color: string }) => {
      setState((prev) => ({
        ...prev,
        freetextStyle: { ...prev.freetextStyle!, ...style },
      }));
    },
    [setState],
  );

  const handleShapeStyleChange = React.useCallback(
    (style: Partial<NonNullable<EditorState["shapeStyle"]>>) => {
      setState((prev) => ({
        ...prev,
        shapeStyle: { ...prev.shapeStyle!, ...style },
      }));
    },
    [setState],
  );

  const handleEditAnnotation = React.useCallback(
    (id: string) => {
      selectControl(id);
      appEventBus.emit(
        "sidebar:focusAnnotation",
        { id },
        {
          sticky: true,
        },
      );
    },
    [selectControl],
  );

  const handlePropertiesChange = React.useCallback(
    (updates: Partial<FormField | Annotation>) => {
      const currentSelectedId = editorStore.selectedId;
      if (!currentSelectedId) return;

      const isField = editorStore.fields.some(
        (field) => field.id === currentSelectedId,
      );
      if (isField) {
        editorStore.updateField(
          currentSelectedId,
          updates as Partial<FormField>,
        );
        return;
      }

      const isAnnotation = editorStore.annotations.some(
        (annotation) => annotation.id === currentSelectedId,
      );
      if (!isAnnotation) return;

      const currentAnnotation = editorStore.annotations.find(
        (annotation) => annotation.id === currentSelectedId,
      );
      const nextRect = updates.rect;
      const currentRect = currentAnnotation?.rect;

      if (
        currentAnnotation &&
        currentRect &&
        nextRect &&
        nextRect.width === currentRect.width &&
        nextRect.height === currentRect.height &&
        (nextRect.x !== currentRect.x || nextRect.y !== currentRect.y)
      ) {
        editorStore.updateAnnotation(currentSelectedId, {
          ...updates,
          ...getMovedAnnotationUpdates(
            currentAnnotation,
            nextRect.x - currentRect.x,
            nextRect.y - currentRect.y,
          ),
        } as Partial<Annotation>);
        return;
      }

      editorStore.updateAnnotation(
        currentSelectedId,
        updates as Partial<Annotation>,
      );
    },
    [editorStore],
  );

  const handleMetadataChange = React.useCallback(
    (updates: Partial<PDFMetadata>) => {
      setState((prev) => ({
        ...prev,
        metadata: { ...prev.metadata, ...updates },
        isDirty: true,
      }));
    },
    [setState],
  );

  const handleFilenameChange = React.useCallback(
    (name: string) => {
      setState({ filename: name, isDirty: true });
    },
    [setState],
  );

  const getWorkspaceViewport = React.useCallback(() => {
    const element = workspaceScrollContainerRef.current;
    if (element)
      return { width: element.clientWidth, height: element.clientHeight };
    if (typeof window !== "undefined") {
      return { width: window.innerWidth, height: window.innerHeight };
    }
    return { width: 0, height: 0 };
  }, [workspaceScrollContainerRef]);

  const handleZoomIn = React.useCallback(() => {
    const currentScale = useEditorStore.getState().scale;
    setState({ scale: Math.min(5.0, currentScale * 1.25) });
  }, [setState]);

  const handleZoomOut = React.useCallback(() => {
    const currentScale = useEditorStore.getState().scale;
    setState({ scale: Math.max(0.25, currentScale / 1.25) });
  }, [setState]);

  const handleFitWidth = React.useCallback(() => {
    const liveState = useEditorStore.getState();
    setState({
      scale: calculateWorkspaceFitWidthScale({
        pages: liveState.pages,
        pageIndex: liveState.currentPageIndex,
        pageLayout: liveState.pageLayout,
        pageFlow: liveState.pageFlow,
        viewport: getWorkspaceViewport(),
      }),
      fitTrigger: Date.now(),
    });
  }, [getWorkspaceViewport, setState]);

  const handleFitScreen = React.useCallback(() => {
    const liveState = useEditorStore.getState();
    setState({
      scale: calculateWorkspaceFitScreenScale({
        pages: liveState.pages,
        pageIndex: liveState.currentPageIndex,
        pageLayout: liveState.pageLayout,
        pageFlow: liveState.pageFlow,
        viewport: getWorkspaceViewport(),
      }),
      fitTrigger: Date.now(),
    });
  }, [getWorkspaceViewport, setState]);

  const openSidebar = React.useCallback(() => {
    setUiState((prev) => {
      if (prev.isPanelFloating) {
        return { isSidebarOpen: true, isRightPanelOpen: false };
      }
      return { isSidebarOpen: true };
    });
  }, [setUiState]);

  const toggleSidebar = React.useCallback(() => {
    setUiState((prev) => {
      const next = !prev.isSidebarOpen;
      if (prev.isPanelFloating && next) {
        return { isSidebarOpen: true, isRightPanelOpen: false };
      }
      return { isSidebarOpen: next };
    });
  }, [setUiState]);

  const toggleRightPanel = React.useCallback(() => {
    setUiState((prev) => {
      const next = !prev.isRightPanelOpen;
      if (prev.isPanelFloating && next) {
        return { isRightPanelOpen: true, isSidebarOpen: false };
      }
      return { isRightPanelOpen: next };
    });
  }, [setUiState]);

  const handleRequestCloseFromUi = React.useCallback(() => {
    onRequestCloseCurrentTab();
  }, [onRequestCloseCurrentTab]);

  const canRenderRightPanel =
    state.mode === "form" || state.mode === "annotation" || !!selectedControl;
  const normalizedSidebarTab =
    state.sidebarTab === "search" ? "thumbnails" : state.sidebarTab;
  const activeSidebarTab = pdfSearch.isPdfSearchOpen
    ? "search"
    : normalizedSidebarTab;

  return (
    <>
      <EditorTabStrip
        windowId={windowId}
        tabs={tabs}
        activeTabId={activeTabId}
        mergeWindowTargets={mergeWindowTargets}
        onOpenDocument={onOpenDocument}
        onRefreshMergeWindowTargets={onRefreshMergeWindowTargets}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onMoveTab={onMoveTab}
        onDetachTab={onDetachTab}
        onMergeTabToWindow={onMergeTabToWindow}
        canDetachTabs={canDetachTabs}
        canMergeTabs={canMergeTabs}
      />

      <Toolbar
        editorState={state}
        isDirty={state.isDirty}
        hideModeSelector={isMobile}
        hideToolSection={isMobile}
        compactZoomControl={isMobile}
        showPageSettingsControl={isMobile}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitWidth={handleFitWidth}
        onFitScreen={handleFitScreen}
        onPageLayoutChange={(layout) => {
          setState({ pageLayout: layout, fitTrigger: Date.now() });
        }}
        onPageFlowChange={(flow) => {
          setState({ pageFlow: flow, fitTrigger: Date.now() });
        }}
        onToggleFullscreen={toggleFullscreen}
        onToolChange={(tool: Tool) => setTool(tool)}
        onModeChange={handleModeChange}
        onPenStyleChange={handlePenStyleChange}
        onHighlightStyleChange={handleHighlightStyleChange}
        onCommentStyleChange={handleCommentStyleChange}
        onFreetextStyleChange={handleFreetextStyleChange}
        onShapeStyleChange={handleShapeStyleChange}
        onExport={onExport}
        onSaveAs={onSaveAs}
        onExit={handleExitEditorPage}
        onClose={handleRequestCloseFromUi}
        onPrint={onPrint}
        onUndo={undo}
        onRedo={redo}
        canUndo={state.past.length > 0}
        canRedo={state.future.length > 0}
        onOpenShortcuts={() => openDialog("shortcuts")}
        onOpenSearch={pdfSearch.openPdfSearch}
        isFieldListOpen={state.isSidebarOpen}
        onToggleFieldList={toggleSidebar}
        isPropertiesPanelOpen={state.isRightPanelOpen}
        onTogglePropertiesPanel={toggleRightPanel}
        onOpenSettings={() => openDialog("settings")}
        isSearchOpen={pdfSearch.isPdfSearchOpen}
      />

      <div className="relative flex flex-1 overflow-hidden">
        {state.isPanelFloating &&
          (state.isSidebarOpen || state.isRightPanelOpen) && (
            <div
              className="absolute inset-0 z-30 bg-black/20"
              onMouseDown={(event) => {
                if (event.target !== event.currentTarget) return;
                setUiState({
                  isSidebarOpen: false,
                  isRightPanelOpen: false,
                });
              }}
            />
          )}

        <Sidebar
          isOpen={state.isSidebarOpen}
          onOpen={openSidebar}
          onClose={() => setUiState({ isSidebarOpen: false })}
          onExitSearch={pdfSearch.closePdfSearch}
          isFloating={state.isPanelFloating}
          pages={state.pages}
          fields={state.fields}
          annotations={state.annotations}
          outline={state.outline}
          selectedId={state.selectedId}
          thumbnailsLayout={state.options.thumbnailsLayout}
          onSelectControl={(id, options) => {
            selectControl(id);
            if (id) {
              appEventBus.emit(
                "workspace:focusControl",
                {
                  id,
                  behavior: options?.behavior,
                  skipScroll: options?.skipScroll,
                },
                { sticky: true },
              );
            }
          }}
          onDeleteAnnotation={deleteAnnotation}
          onUpdateAnnotation={updateAnnotation}
          onAddAnnotationReply={addAnnotationReply}
          onUpdateAnnotationReply={updateAnnotationReply}
          onDeleteAnnotationReply={deleteAnnotationReply}
          onNavigatePage={(index) => {
            appEventBus.emit("workspace:navigatePage", {
              pageIndex: index,
              behavior: "smooth",
            });
          }}
          currentPageIndex={state.currentPageIndex}
          width={state.sidebarWidth}
          onResize={(width) => setUiState({ sidebarWidth: width })}
          activeTab={activeSidebarTab}
          isSearchActive={pdfSearch.isPdfSearchOpen}
          onTabChange={(tab) => {
            pdfSearch.dismissPdfSearch();
            setUiState({ sidebarTab: tab });
          }}
          searchHeaderContent={
            <PDFSearchHeader
              query={pdfSearch.pdfSearchQuery}
              focusToken={pdfSearch.pdfSearchFocusToken}
              canGoPrevious={pdfSearch.pdfSearchResults.length > 0}
              canGoNext={pdfSearch.pdfSearchResults.length > 0}
              onQueryChange={pdfSearch.setPdfSearchQuery}
              onPrevious={pdfSearch.handleSelectPreviousPdfSearchResult}
              onNext={pdfSearch.handleSelectNextPdfSearchResult}
            />
          }
          searchContent={
            <PDFSearchPanel
              query={pdfSearch.pdfSearchQuery}
              mode={pdfSearch.pdfSearchMode}
              caseSensitive={pdfSearch.isPdfSearchCaseSensitive}
              results={pdfSearch.pdfSearchResults}
              activeResultId={pdfSearch.activePdfSearchResultId}
              activeResultIndex={pdfSearch.activePdfSearchResultIndex}
              isSearching={pdfSearch.isPdfSearchLoading}
              errorMessage={pdfSearch.pdfSearchError}
              onToggleCaseSensitive={pdfSearch.togglePdfSearchCaseSensitive}
              onToggleRegex={pdfSearch.togglePdfSearchMode}
              onSelectResult={pdfSearch.handleSelectPdfSearchResult}
            />
          }
        />

        <EditorCanvasPane
          sessionRenderKey={activeTabId}
          workerService={workerService}
          isFileDragActive={isFileDragActive}
          onEditAnnotation={handleEditAnnotation}
          onToggleFullscreen={toggleFullscreen}
          pdfSearchResultsByPage={pdfSearch.workspaceTextHighlightsByPage}
          activePdfSearchResultId={
            pdfSearch.isPdfSearchOpen ? pdfSearch.activePdfSearchResultId : null
          }
          mobileToolbar={{
            isDirty: state.isDirty,
            canUndo: state.past.length > 0,
            canRedo: state.future.length > 0,
            onModeChange: handleModeChange,
            onPenStyleChange: handlePenStyleChange,
            onHighlightStyleChange: handleHighlightStyleChange,
            onCommentStyleChange: handleCommentStyleChange,
            onFreetextStyleChange: handleFreetextStyleChange,
            onShapeStyleChange: handleShapeStyleChange,
            onUndo: undo,
            onRedo: redo,
            onOpenShortcuts: () => openDialog("shortcuts"),
            onOpenSearch: pdfSearch.openPdfSearch,
            isFieldListOpen: state.isSidebarOpen,
            onToggleFieldList: toggleSidebar,
            isPropertiesPanelOpen: state.isRightPanelOpen,
            onTogglePropertiesPanel: toggleRightPanel,
            onOpenSettings: () => openDialog("settings"),
            isSearchOpen: pdfSearch.isPdfSearchOpen,
            onExport,
            onSaveAs,
            onPrint,
            onExit: handleExitEditorPage,
            onClose: handleRequestCloseFromUi,
          }}
        />

        <RightPanelTabDock
          activeTabs={
            state.isRightPanelOpen
              ? [state.rightPanelTab, ...state.rightPanelDockTab]
              : [...state.rightPanelDockTab]
          }
          isRightPanelOpen={state.isRightPanelOpen}
          isFloating={state.isPanelFloating}
          rightOffsetPx={state.isRightPanelOpen ? state.rightPanelWidth : 0}
          canOpenProperties={!!selectedControl}
          onSelectTab={(tab) => {
            if (tab === "properties" && !selectedControl) return;
            setUiState((prev) => {
              const updates: Partial<EditorUiState> = {
                rightPanelTab: tab,
                isRightPanelOpen: true,
              };
              if (prev.isPanelFloating) {
                updates.isSidebarOpen = false;
              }
              return updates;
            });
          }}
        />

        <EditorRightPanel
          canRenderRightPanel={canRenderRightPanel}
          rightPanelTab={state.rightPanelTab}
          isPanelFloating={state.isPanelFloating}
          isRightPanelOpen={state.isRightPanelOpen}
          rightPanelWidth={state.rightPanelWidth}
          selectedControl={selectedControl}
          metadata={state.metadata}
          filename={state.filename}
          pagesLength={state.pages.length}
          pageTranslateOptions={state.pageTranslateOptions}
          pageTranslateParagraphCandidates={
            state.pageTranslateParagraphCandidates
          }
          pageTranslateSelectedParagraphIds={
            state.pageTranslateSelectedParagraphIds
          }
          translateOption={state.translateOption}
          translateTargetLanguage={state.translateTargetLanguage}
          effectiveLanguage={effectiveLanguage}
          isPageTranslating={isPageTranslating}
          pageTranslateStatus={pageTranslateStatus}
          aiChat={aiChat}
          onSetUiState={setUiState}
          onSelectControl={selectControl}
          onDeleteSelection={deleteSelection}
          onSaveCheckpoint={saveCheckpoint}
          onPropertiesChange={handlePropertiesChange}
          onMetadataChange={handleMetadataChange}
          onFilenameChange={handleFilenameChange}
          onStartPageTranslate={(options) => {
            void handleStartPageTranslate(options as never);
          }}
          onPreviewParagraphs={(options) => {
            void handlePreviewParagraphs(options as never);
          }}
          onUnmergeSelectedParagraphs={() => {
            void handleUnmergeSelectedParagraphs();
          }}
          onCancelPageTranslate={cancelPageTranslate}
          onClearPageTranslateParagraphCandidates={
            clearPageTranslateParagraphCandidates
          }
          onMergeSelectedPageTranslateParagraphs={
            mergeSelectedPageTranslateParagraphs
          }
          onToggleExcludeSelectedPageTranslateParagraphs={
            toggleExcludeSelectedPageTranslateParagraphs
          }
          onDeleteSelectedPageTranslateParagraphs={
            deleteSelectedPageTranslateParagraphs
          }
          onSetAllFreetextFlatten={setAllFreetextFlatten}
        />

        <TranslationFloatingWindow
          isOpen={isTranslateOpen}
          sourceText={translateSourceText}
          autoTranslateToken={translateAutoToken}
          onClose={() => setIsTranslateOpen(false)}
        />
      </div>
    </>
  );
};

export default React.memo(EditorPage);
