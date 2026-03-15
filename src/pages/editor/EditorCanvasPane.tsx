import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";

import FloatingBar from "@/components/toolbar/FloatingBar";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { useEditorStore } from "@/store/useEditorStore";
import {
  selectEditorCanvasActions,
  selectEditorCanvasState,
} from "@/store/selectors";
import type { PDFSearchResult } from "@/types";
import {
  FIT_SCREEN_PADDING_X,
  FIT_SCREEN_PADDING_Y,
  FIT_WIDTH_PADDING_X,
  WORKSPACE_BASE_PAGE_GAP_PX,
} from "@/constants";
import { useShallow } from "zustand/react/shallow";

const Workspace = React.lazy(() => import("@/components/workspace/Workspace"));

type EditorCanvasPaneProps = {
  onEditAnnotation: (id: string) => void;
  onToggleFullscreen: () => void;
  pdfSearchResultsByPage: Map<number, PDFSearchResult[]>;
  activePdfSearchResultId: string | null;
};

export const EditorCanvasPane: React.FC<EditorCanvasPaneProps> = ({
  onEditAnnotation,
  onToggleFullscreen,
  pdfSearchResultsByPage,
  activePdfSearchResultId,
}) => {
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

  const calculateFitWidthScale = useCallback(
    (pageIndex: number = 0) => {
      if (!state.pages || state.pages.length === 0) return 1.0;
      const targetIndex = Math.max(
        0,
        Math.min(pageIndex, state.pages.length - 1),
      );
      const page = state.pages[targetIndex];
      if (!page.width) return 1.0;

      const { width } = getWorkspaceViewport();
      const availableWidth = width - FIT_WIDTH_PADDING_X;
      if (state.pageLayout !== "single") {
        if (state.pageFlow === "horizontal") {
          const scale = availableWidth / page.width;
          return Math.max(0.25, Math.min(5.0, Number(scale.toFixed(2))));
        }
        const denom = page.width * 2 + WORKSPACE_BASE_PAGE_GAP_PX;
        const scale = denom > 0 ? availableWidth / denom : 1.0;
        return Math.max(0.25, Math.min(5.0, Number(scale.toFixed(2))));
      }

      const scale = availableWidth / page.width;
      return Math.max(0.25, Math.min(5.0, Number(scale.toFixed(2))));
    },
    [getWorkspaceViewport, state.pageFlow, state.pageLayout, state.pages],
  );

  const calculateFitScreenScale = useCallback(
    (pageIndex: number = 0) => {
      if (!state.pages || state.pages.length === 0) return 1.0;
      const targetIndex = Math.max(
        0,
        Math.min(pageIndex, state.pages.length - 1),
      );
      const page = state.pages[targetIndex];
      if (!page.width || !page.height) return 1.0;

      const { width, height } = getWorkspaceViewport();
      const availableWidth = width - FIT_SCREEN_PADDING_X;
      const availableHeight = height - FIT_SCREEN_PADDING_Y;

      const widthScale =
        state.pageLayout !== "single"
          ? (() => {
              if (state.pageFlow === "horizontal") {
                return availableWidth / page.width;
              }
              const denom = page.width * 2 + WORKSPACE_BASE_PAGE_GAP_PX;
              return denom > 0 ? availableWidth / denom : 1.0;
            })()
          : availableWidth / page.width;
      const heightScale =
        state.pageLayout !== "single" && state.pageFlow === "horizontal"
          ? availableHeight / (page.height * 2 + WORKSPACE_BASE_PAGE_GAP_PX)
          : availableHeight / page.height;
      const scale = Math.min(widthScale, heightScale);
      return Math.max(0.25, Math.min(5.0, Number(scale.toFixed(2))));
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
        />
      </Suspense>
      <FloatingBar
        scale={state.scale}
        pageLayout={state.pageLayout}
        pageFlow={state.pageFlow}
        isFullscreen={state.isFullscreen}
        onPageLayoutChange={(layout) => {
          setState({ pageLayout: layout, fitTrigger: Date.now() });
        }}
        onPageFlowChange={(flow) => {
          setState({ pageFlow: flow, fitTrigger: Date.now() });
        }}
        onToggleFullscreen={onToggleFullscreen}
        onZoomIn={() => updateScale(state.scale * 1.25)}
        onZoomOut={() => updateScale(state.scale / 1.25)}
        onFitWidth={() => {
          updateScale(calculateFitWidthScale(state.currentPageIndex));
          setState({ fitTrigger: Date.now() });
        }}
        onFitScreen={() => {
          updateScale(calculateFitScreenScale(state.currentPageIndex));
          setState({ fitTrigger: Date.now() });
        }}
      />
    </div>
  );
};
