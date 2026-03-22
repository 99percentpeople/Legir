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
import { useIsMobile } from "@/hooks/useIsMobile";
import { calculateWorkspaceFitScreenScale } from "@/components/workspace/lib/calculateWorkspaceFitScale";
import { appEventBus } from "@/lib/eventBus";
import { useEditorStore } from "@/store/useEditorStore";
import {
  selectEditorCanvasActions,
  selectEditorCanvasState,
} from "@/store/selectors";
import type { EditorState, PDFSearchResult, PenStyle } from "@/types";
import { useShallow } from "zustand/react/shallow";

const Workspace = React.lazy(() => import("@/components/workspace/Workspace"));
const MOBILE_FLOATING_TOOLBAR_OVERLAY_INSET_PX = 96;

type EditorCanvasPaneProps = {
  onEditAnnotation: (id: string) => void;
  onToggleFullscreen: () => void;
  pdfSearchResultsByPage: Map<number, PDFSearchResult[]>;
  activePdfSearchResultId: string | null;
  mobileToolbar: {
    isDirty: boolean;
    canUndo: boolean;
    canRedo: boolean;
    onModeChange: (mode: EditorState["mode"]) => void;
    onPenStyleChange: (style: Partial<PenStyle>) => void;
    onHighlightStyleChange: (style: Partial<PenStyle>) => void;
    onCommentStyleChange: (style: { color: string }) => void;
    onFreetextStyleChange: (style: { color: string }) => void;
    onShapeStyleChange: (
      style: Partial<NonNullable<EditorState["shapeStyle"]>>,
    ) => void;
    onUndo: () => void;
    onRedo: () => void;
    onOpenShortcuts: () => void;
    onOpenSearch: () => void;
    isFieldListOpen: boolean;
    onToggleFieldList: () => void;
    isPropertiesPanelOpen: boolean;
    onTogglePropertiesPanel: () => void;
    onOpenSettings: () => void;
    isSearchOpen: boolean;
    onExport: () => Promise<boolean>;
    onSaveDraft: (silent?: boolean) => Promise<void>;
    onSaveAs: () => Promise<boolean>;
    onPrint: () => void;
    onExit: () => void;
    onClose: () => void;
  };
};

export const EditorCanvasPane: React.FC<EditorCanvasPaneProps> = ({
  onEditAnnotation,
  onToggleFullscreen,
  pdfSearchResultsByPage,
  activePdfSearchResultId,
  mobileToolbar,
}) => {
  const isMobile = useIsMobile();
  const state = useEditorStore(useShallow(selectEditorCanvasState));
  const {
    addField,
    addAnnotation,
    updateField,
    updateAnnotation,
    deleteAnnotation,
    selectControl,
    setTool,
    saveCheckpoint,
    setState,
    selectPageTranslateParagraphId,
    setSelectedPageTranslateParagraphIds,
  } = useEditorStore(useShallow(selectEditorCanvasActions));
  const workspaceState = useMemo(
    () => ({
      annotations: state.annotations,
      commentStyle: state.commentStyle,
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
      scale: state.scale,
      selectedId: state.selectedId,
      tool: state.tool,
    }),
    [
      state.annotations,
      state.commentStyle,
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

  const calculateFitScreenScale = useCallback(
    (pageIndex: number = 0) => {
      return calculateWorkspaceFitScreenScale({
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
      const clamped = Math.max(0.25, Math.min(5.0, newScale));
      setState({ scale: clamped });
    },
    [setState],
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

    updateScale(calculateFitScreenScale(state.currentPageIndex));
    setState({ fitTrigger: Date.now() });
  }, [
    calculateFitScreenScale,
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
          editorState={workspaceState}
          onAddField={addField}
          onAddAnnotation={addAnnotation}
          onSelectControl={selectControl}
          onUpdateField={updateField}
          onUpdateAnnotation={updateAnnotation}
          onDeleteAnnotation={deleteAnnotation}
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
          pdfSearchResultsByPage={pdfSearchResultsByPage}
          activePdfSearchResultId={activePdfSearchResultId}
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
          onModeChange={mobileToolbar.onModeChange}
          onPenStyleChange={mobileToolbar.onPenStyleChange}
          onHighlightStyleChange={mobileToolbar.onHighlightStyleChange}
          onCommentStyleChange={mobileToolbar.onCommentStyleChange}
          onFreetextStyleChange={mobileToolbar.onFreetextStyleChange}
          onShapeStyleChange={mobileToolbar.onShapeStyleChange}
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
            setState({ pageLayout: layout, fitTrigger: Date.now() });
          }}
          onPageFlowChange={(flow) => {
            setState({ pageFlow: flow, fitTrigger: Date.now() });
          }}
          onToggleFullscreen={onToggleFullscreen}
        />
      )}
    </div>
  );
};
