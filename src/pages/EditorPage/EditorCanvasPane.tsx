import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import FloatingBar from "@/components/toolbar/FloatingBar";
import MobileFloatingToolbar from "@/components/toolbar/MobileFloatingToolbar";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { useEventListener } from "@/hooks/useEventListener";
import { useIsMobile } from "@/hooks/useIsMobile";
import { calculateWorkspaceInitialScale } from "@/components/workspace/lib/calculateWorkspaceFitScale";
import { appEventBus } from "@/lib/eventBus";
import { useEditorStore } from "@/store/useEditorStore";
import {
  selectEditorCanvasActions,
  selectEditorCanvasState,
} from "@/store/selectors";
import { useShallow } from "zustand/react/shallow";
import {
  useEditorDocumentIdentityRuntime,
  useEditorFileDragRuntime,
} from "@/app/editorRuntime";
import {
  useEditorPdfSearchWorkspace,
  useEditorShellCommands,
} from "@/app/editorShellContext";

const Workspace = React.lazy(() => import("@/components/workspace/Workspace"));
const MOBILE_FLOATING_TOOLBAR_OVERLAY_INSET_PX = 96;
const BLOCK_MODIFIER_WHEEL_ZOOM_SELECTOR =
  "[data-app-block-modifier-wheel-zoom='1']";

export const EditorCanvasPane: React.FC = () => {
  const isMobile = useIsMobile();
  const { sessionRenderKey, workerService } =
    useEditorDocumentIdentityRuntime();
  const { isFileDragActive } = useEditorFileDragRuntime();
  const {
    editAnnotation: onEditAnnotation,
    toggleFullscreen: onToggleFullscreen,
    changeMode: onModeChange,
    changePenStyle: onPenStyleChange,
    changeHighlightStyle: onHighlightStyleChange,
    changeCommentStyle: onCommentStyleChange,
    changeFreetextStyle: onFreetextStyleChange,
    changeShapeStyle: onShapeStyleChange,
    changeStampStyle: onStampStyleChange,
  } = useEditorShellCommands();
  const pdfSearch = useEditorPdfSearchWorkspace();
  const state = useEditorStore(useShallow(selectEditorCanvasState));
  const {
    addField,
    addAnnotation,
    updateField,
    resetFieldToDefault,
    updateAnnotation,
    deleteAnnotation,
    reorderControlLayer,
    selectControl,
    setTool,
    saveCheckpoint,
    fitToScale,
    setPageFlow,
    setPageLayout,
    setScale,
    setState,
    selectPageTranslateParagraphId,
    setSelectedPageTranslateParagraphIds,
  } = useEditorStore(useShallow(selectEditorCanvasActions));
  const workspaceState = useMemo(
    () => ({
      annotations: state.annotations,
      commentStyle: state.commentStyle,
      documentLoadState: state.documentLoadState,
      documentPermissions: state.documentPermissions,
      fields: state.fields,
      freetextStyle: state.freetextStyle,
      highlightStyle: state.highlightStyle,
      keys: state.keys,
      mode: state.mode,
      options: state.options,
      pageFlow: state.pageFlow,
      pageLayout: state.pageLayout,
      pages: state.pages,
      pageTranslateOptions: state.pageTranslateOptions,
      pageTranslateParagraphCandidates: state.pageTranslateParagraphCandidates,
      pageTranslateSelectedParagraphIds:
        state.pageTranslateSelectedParagraphIds,
      penStyle: state.penStyle,
      pendingViewStateRestore: state.pendingViewStateRestore,
      shapeStyle: state.shapeStyle,
      stampStyle: state.stampStyle,
      scale: state.scale,
      selectedId: state.selectedId,
      tool: state.tool,
    }),
    [
      state.annotations,
      state.commentStyle,
      state.documentLoadState,
      state.documentPermissions,
      state.fields,
      state.freetextStyle,
      state.highlightStyle,
      state.keys,
      state.mode,
      state.options,
      state.pageFlow,
      state.pageLayout,
      state.pages,
      state.pageTranslateOptions,
      state.pageTranslateParagraphCandidates,
      state.pageTranslateSelectedParagraphIds,
      state.penStyle,
      state.pendingViewStateRestore,
      state.shapeStyle,
      state.stampStyle,
      state.scale,
      state.selectedId,
      state.tool,
    ],
  );

  const workspaceScrollContainerRef = useRef<HTMLElement | null>(null);
  const lastFitKeyRef = useRef<string | null>(null);

  useAppEvent(
    "workspace:scrollContainerReady",
    ({ element }) => {
      workspaceScrollContainerRef.current = element;
    },
    { replayLast: true },
  );

  useEventListener<WheelEvent>(
    typeof document !== "undefined" ? document : null,
    "wheel",
    (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;

      const rawTarget = event.target;
      if (!(rawTarget instanceof Node)) return;

      const target =
        rawTarget instanceof Element ? rawTarget : rawTarget.parentElement;
      if (!target?.closest?.(BLOCK_MODIFIER_WHEEL_ZOOM_SELECTOR)) return;

      event.preventDefault();
      event.stopPropagation();
    },
    {
      capture: true,
      passive: false,
    },
  );

  const handleInitialScrollApplied = useCallback(() => {
    setState({ pendingViewStateRestore: null });
  }, [setState]);

  const handlePageIndexChange = useCallback(
    (idx: number) => {
      setState({ currentPageIndex: idx });
    },
    [setState],
  );

  const handleToolChange = useCallback(
    (tool: typeof state.tool) => {
      setTool(tool);
    },
    [setTool],
  );

  const handleNavigatePage = useCallback(
    (pageIndex: number) => {
      setState({ currentPageIndex: pageIndex });
      appEventBus.emit("workspace:navigatePage", {
        pageIndex,
        behavior: "smooth",
      });
    },
    [setState],
  );

  const handleClearPageTranslateParagraphSelection = useCallback(() => {
    setSelectedPageTranslateParagraphIds([]);
  }, [setSelectedPageTranslateParagraphIds]);

  const getWorkspaceViewport = useCallback(() => {
    const el = workspaceScrollContainerRef.current;
    if (el) return { width: el.clientWidth, height: el.clientHeight };
    if (typeof window !== "undefined") {
      return { width: window.innerWidth, height: window.innerHeight };
    }
    return { width: 0, height: 0 };
  }, []);

  const calculateInitialScale = useCallback(
    (pageIndex: number = 0) => {
      return calculateWorkspaceInitialScale({
        pages: state.pages,
        pageIndex,
        pageLayout: state.pageLayout,
        pageFlow: state.pageFlow,
        viewport: getWorkspaceViewport(),
      });
    },
    [getWorkspaceViewport, state.pageFlow, state.pageLayout, state.pages],
  );

  const updateScale = useCallback(
    (newScale: number) => {
      setScale(newScale);
    },
    [setScale],
  );

  useEffect(() => {
    if (!state.pages || state.pages.length === 0) return;
    const bytesLen =
      typeof state.pdfBytes?.byteLength === "number"
        ? state.pdfBytes.byteLength
        : state.pdfBytes?.length;
    const fitKey = `${state.filename || ""}:${state.pages.length}:${bytesLen || 0}`;
    if (lastFitKeyRef.current === fitKey) return;
    lastFitKeyRef.current = fitKey;

    if (state.pendingViewStateRestore) {
      updateScale(state.pendingViewStateRestore.scale);
      return;
    }

    fitToScale(calculateInitialScale(state.currentPageIndex));
  }, [
    calculateInitialScale,
    fitToScale,
    setState,
    state.currentPageIndex,
    state.filename,
    state.pages,
    state.pdfBytes,
    state.pendingViewStateRestore,
    updateScale,
  ]);

  const initialScrollPosition = useMemo(
    () =>
      state.pendingViewStateRestore
        ? {
            left: state.pendingViewStateRestore.scrollLeft,
            top: state.pendingViewStateRestore.scrollTop,
          }
        : null,
    [state.pendingViewStateRestore],
  );

  return (
    <div className="relative z-0 flex min-w-0 flex-1 flex-col overflow-hidden">
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center p-4">
            <div className="flex gap-6">
              <Skeleton className="h-[70vh] w-[48vh]" />
            </div>
          </div>
        }
      >
        <Workspace
          sessionRenderKey={sessionRenderKey}
          workerService={workerService}
          isFileDragActive={isFileDragActive}
          editorState={workspaceState}
          onAddField={addField}
          onAddAnnotation={addAnnotation}
          onSelectControl={selectControl}
          onUpdateField={updateField}
          onResetFieldToDefault={resetFieldToDefault}
          onUpdateAnnotation={updateAnnotation}
          onDeleteAnnotation={deleteAnnotation}
          onReorderControlLayer={reorderControlLayer}
          onEditAnnotation={onEditAnnotation}
          onScaleChange={updateScale}
          onTriggerHistorySave={saveCheckpoint}
          onPageIndexChange={handlePageIndexChange}
          onToolChange={handleToolChange}
          onSelectPageTranslateParagraphId={selectPageTranslateParagraphId}
          onClearPageTranslateParagraphSelection={
            handleClearPageTranslateParagraphSelection
          }
          fitTrigger={state.fitTrigger}
          initialScrollPosition={initialScrollPosition}
          onInitialScrollApplied={handleInitialScrollApplied}
          pdfSearchResultsByPage={pdfSearch.workspaceTextHighlightsByPage}
          activePdfSearchResultId={
            pdfSearch.isPdfSearchOpen ? pdfSearch.activePdfSearchResultId : null
          }
          bottomOverlayInsetPx={
            isMobile ? MOBILE_FLOATING_TOOLBAR_OVERLAY_INSET_PX : undefined
          }
        />
      </Suspense>
      {isMobile ? (
        <MobileFloatingToolbar
          currentPageIndex={state.currentPageIndex}
          editorState={state}
          onNavigatePage={handleNavigatePage}
          onToolChange={handleToolChange}
          onModeChange={onModeChange}
          onPenStyleChange={onPenStyleChange}
          onHighlightStyleChange={onHighlightStyleChange}
          onCommentStyleChange={onCommentStyleChange}
          onFreetextStyleChange={onFreetextStyleChange}
          onShapeStyleChange={onShapeStyleChange}
          onStampStyleChange={onStampStyleChange}
        />
      ) : (
        <FloatingBar
          currentPageIndex={state.currentPageIndex}
          pageCount={state.pages.length}
          pageLayout={state.pageLayout}
          pageFlow={state.pageFlow}
          isFullscreen={state.isFullscreen}
          onNavigatePage={handleNavigatePage}
          onPageLayoutChange={(layout) => {
            setPageLayout(layout);
          }}
          onPageFlowChange={(flow) => {
            setPageFlow(flow);
          }}
          onToggleFullscreen={onToggleFullscreen}
        />
      )}
    </div>
  );
};
