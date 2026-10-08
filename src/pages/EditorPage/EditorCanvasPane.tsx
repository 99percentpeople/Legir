import { useWorkspaceStore } from "@/store/workspaceStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import FloatingBar from "@/components/toolbar/FloatingBar";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { useEventListener } from "@/hooks/useEventListener";
import { useIsMobile } from "@/hooks/useIsMobile";
import { calculateWorkspaceInitialScale } from "@/components/workspace/lib/calculateWorkspaceFitScale";
import { useEditorEventBus } from "@/app/editorTabs/context";
import { useEditorView } from "@/store/useEditorView";
import {
  selectCanvasPreferences,
  selectCanvasLayout,
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
const BLOCK_MODIFIER_WHEEL_ZOOM_SELECTOR =
  "[data-app-block-modifier-wheel-zoom='1']";

export const EditorCanvasPane: React.FC = () => {
  const appEventBus = useEditorEventBus();
  const isMobile = useIsMobile();
  const [toolbarOverlayInset, setToolbarOverlayInset] = useState(96);
  const { sessionRenderKey, workerService } =
    useEditorDocumentIdentityRuntime();
  const { isFileDragActive } = useEditorFileDragRuntime();
  const commands = useEditorShellCommands();
  const {
    editAnnotation: onEditAnnotation,
    toggleFullscreen: onToggleFullscreen,
    changeTool: handleToolChange,
  } = commands;
  const pdfSearch = useEditorPdfSearchWorkspace();
  const documentState = useEditorView(useShallow(selectEditorCanvasState));
  const preferences = usePreferencesStore(useShallow(selectCanvasPreferences));
  const layout = useWorkspaceStore(useShallow(selectCanvasLayout));
  const state = { ...documentState, ...preferences, ...layout };
  const {
    addField,
    addAnnotation,
    updateField,
    resetFieldToDefault,
    updateAnnotation,
    deleteAnnotation,
    reorderControlLayer,
    selectControl,
    saveCheckpoint,
    fitToScale,
    setPageFlow,
    setPageLayout,
    setScale,
    rotateView,
    resetViewRotation,
    setState,
    selectPageTranslateParagraphId,
    setSelectedPageTranslateParagraphIds,
  } = useEditorView(useShallow(selectEditorCanvasActions));
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
      viewRotation: state.viewRotation,
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
      state.viewRotation,
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

  const handleRotateView = useCallback(
    (direction: "clockwise" | "counterclockwise") => {
      appEventBus.emit("workspace:cancelToolInteraction", {
        draftsOnly: false,
        handled: false,
      });
      window.getSelection()?.removeAllRanges();
      rotateView(direction);
    },
    [appEventBus, rotateView],
  );

  const previousRotationRef = useRef(state.viewRotation);
  const handleResetViewRotation = useCallback(() => {
    appEventBus.emit("workspace:cancelToolInteraction", {
      draftsOnly: false,
      handled: false,
    });
    window.getSelection()?.removeAllRanges();
    resetViewRotation();
  }, [appEventBus, resetViewRotation]);

  useEffect(() => {
    if (previousRotationRef.current === state.viewRotation) return;
    previousRotationRef.current = state.viewRotation;
    appEventBus.emit("workspace:navigatePage", {
      pageIndex: state.currentPageIndex,
      behavior: "auto",
    });
  }, [appEventBus, state.currentPageIndex, state.viewRotation]);

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
        viewRotation: state.viewRotation,
        pageIndex,
        pageLayout: state.pageLayout,
        pageFlow: state.pageFlow,
        viewport: getWorkspaceViewport(),
        isMobile,
      });
    },
    [
      getWorkspaceViewport,
      isMobile,
      state.pageFlow,
      state.pageLayout,
      state.pages,
      state.viewRotation,
    ],
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
          bottomOverlayInsetPx={toolbarOverlayInset}
        />
      </Suspense>
      <FloatingBar
        commands={commands}
        onOverlayInsetChange={setToolbarOverlayInset}
        state={state}
        isMobile={isMobile}
        currentPageIndex={state.currentPageIndex}
        pageCount={state.pages.length}
        pageLayout={state.pageLayout}
        pageFlow={state.pageFlow}
        isFullscreen={state.isFullscreen}
        onNavigatePage={handleNavigatePage}
        onRotateView={handleRotateView}
        viewRotation={state.viewRotation}
        onResetViewRotation={handleResetViewRotation}
        onPageLayoutChange={(layout) => {
          setPageLayout(layout);
        }}
        onPageFlowChange={(flow) => {
          setPageFlow(flow);
        }}
        onToggleFullscreen={onToggleFullscreen}
      />
    </div>
  );
};
