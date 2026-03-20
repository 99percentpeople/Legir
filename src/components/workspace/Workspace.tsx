import React, {
  Suspense,
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import {
  FormField,
  FieldType,
  Annotation,
  Tool,
  PageTranslateParagraphCandidate,
  PDFSearchResult,
  WorkspaceEditorState,
} from "@/types";
import {
  DEFAULT_FIELD_STYLE,
  ANNOTATION_STYLES,
  WORKSPACE_BASE_PAGE_GAP_PX,
  WORKSPACE_BOTTOM_PADDING_PX,
  WORKSPACE_VIRTUALIZATION_OVERSCAN_PAGES,
  WORKSPACE_VIRTUALIZATION_THRESHOLD_PAGES,
} from "@/constants";
import { cn } from "@/utils/cn";
import { setGlobalCursor, resetGlobalCursor } from "@/lib/cursor";
import { usePointerCapture } from "@/hooks/usePointerCapture";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { useCanvasPanning } from "@/hooks/useCanvasPanning";
import { useInkSession } from "./hooks/useInkSession";
import { getCursor, shouldSwitchToSelectAfterUse } from "@/lib/tool-behavior";
import { WorkspaceTextSelectionPopover } from "./widgets/WorkspaceTextSelectionPopover";
import PDFPage from "./layers/PDFPage";
import { ControlRenderer, preloadControls, registerControls } from "./controls";
import { useWorkspaceDerivedPages } from "./hooks/useWorkspaceDerivedPages";
import {
  useWorkspaceTextSelection,
  type TextSelectionToolbarState,
} from "./hooks/useWorkspaceTextSelection";
import { useWorkspaceViewport } from "./hooks/useWorkspaceViewport";
import { useWorkspaceTouchPinch } from "./hooks/useWorkspaceTouchPinch";
import { useWorkspacePointerCoords } from "./hooks/useWorkspacePointerCoords";
import { useWorkspaceEraser } from "./hooks/useWorkspaceEraser";
import { useWorkspaceInitialScroll } from "./hooks/useWorkspaceInitialScroll";
import {
  useWorkspaceSnapping,
  type SnapLine,
} from "./hooks/useWorkspaceSnapping";
import { getPageIndexFromPoint as getPageIndexFromPointLib } from "./lib/getPageIndexFromPoint";
import { pointsToPath as pointsToPathLib } from "./lib/pointsToPath";
import { getFocusRect } from "./lib/getFocusRect";
import { VirtualizedPages } from "./VirtualizedPages";
import { computeWorkspacePageRects } from "./lib/computeWorkspacePageRects";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { appEventBus } from "@/lib/eventBus";
import { useAppEvent } from "@/hooks/useAppEventBus";
import { getPdfSearchRangeGeometry } from "@/lib/pdfSearch";
import { pdfWorkerService } from "@/services/pdfService/pdfWorkerService";
import type { AiChatMessageAttachment } from "@/services/ai/chat/types";

const WorkspaceZoomJankOverlay = React.lazy(
  () => import("./debug/WorkspaceZoomJankOverlay"),
);

// Workspace = the editor canvas.
//
// Responsibilities:
// - Render PDF pages (via `PDFPage` which uses worker rendering)
// - Overlay controls/annotations on top of pages (via `ControlRenderer`)
// - Handle pointer/keyboard driven interactions: selection, draw-to-create, drag/resize, panning
//
// Coordinate system note:
// - Source of truth for control geometry is `FormField.rect` / `Annotation.rect` in *PDF space*.
// - Rendering converts to screen coordinates by multiplying by `editorState.scale`.
// - When adding new tools/controls, keep this separation (data in PDF space, render in screen space).

registerControls();
preloadControls();

interface WorkspaceProps {
  editorState: WorkspaceEditorState;
  onAddField: (field: FormField) => void;
  onAddAnnotation: (
    annotation: Annotation,
    opts?: { select?: boolean },
  ) => void;
  onSelectControl: (id: string | null) => void;
  onUpdateField: (id: string, updates: Partial<FormField>) => void;
  onUpdateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  onDeleteAnnotation: (id: string) => void;
  onEditAnnotation: (id: string) => void;
  onScaleChange: (newScale: number) => void;
  onTriggerHistorySave: () => void;
  onPageIndexChange?: (index: number) => void;
  onToolChange: (tool: Tool) => void;
  onSelectPageTranslateParagraphId?: (
    id: string,
    opts?: { additive?: boolean },
  ) => void;
  onClearPageTranslateParagraphSelection?: () => void;
  fitTrigger?: number;
  initialScrollPosition?: { left: number; top: number } | null;
  onInitialScrollApplied?: () => void;
  pdfSearchResultsByPage?: Map<number, PDFSearchResult[]>;
  activePdfSearchResultId?: string | null;
  bottomOverlayInsetPx?: number;
}

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type TextSelectionPayload = NonNullable<TextSelectionToolbarState["selection"]>;

const normalizeRotationDeg = (deg: number) => {
  if (!Number.isFinite(deg)) return 0;
  let d = deg % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
};

const Workspace: React.FC<WorkspaceProps> = ({
  editorState,
  onAddField,
  onAddAnnotation,
  onSelectControl,
  onUpdateField,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onEditAnnotation,
  onScaleChange,
  onTriggerHistorySave,
  onPageIndexChange,
  onToolChange,
  onSelectPageTranslateParagraphId,
  onClearPageTranslateParagraphSelection,
  fitTrigger,
  initialScrollPosition,
  onInitialScrollApplied,
  pdfSearchResultsByPage,
  activePdfSearchResultId,
  bottomOverlayInsetPx = 0,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinchGestureActiveRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;
    appEventBus.emit(
      "workspace:scrollContainerReady",
      { element: containerRef.current },
      { sticky: true },
    );
  }, []);

  useWorkspaceInitialScroll({
    containerRef,
    initialScrollPosition,
    scale: editorState.scale,
    pagesLength: editorState.pages.length,
    onInitialScrollApplied,
  });

  const { capture: capturePointer, release: releasePointer } =
    usePointerCapture(containerRef);

  const { isPanning, startPan, movePan, endPan, isPanModeActive } =
    useCanvasPanning({
      containerRef,
      editorState,
      capturePointer,
      releasePointer,
    });

  // Only allow selection when tool is "select"
  const isSelectable = editorState.tool === "select" && !isPanModeActive;

  const paragraphCandidatesByPage = useMemo(() => {
    const map = new Map<number, PageTranslateParagraphCandidate[]>();
    for (const c of editorState.pageTranslateParagraphCandidates) {
      const arr = map.get(c.pageIndex);
      if (arr) arr.push(c);
      else map.set(c.pageIndex, [c]);
    }
    return map;
  }, [editorState.pageTranslateParagraphCandidates]);

  const selectedParagraphIds = useMemo(() => {
    return new Set(editorState.pageTranslateSelectedParagraphIds);
  }, [editorState.pageTranslateSelectedParagraphIds]);

  // Keep a ref to editorState for stable event handlers
  const editorStateRef = useRef<WorkspaceEditorState>(editorState);
  editorStateRef.current = editorState;

  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [dragCurrent, setDragCurrent] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [activePageIndex, setActivePageIndex] = useState<number | null>(null);
  const [isPinchZooming, setIsPinchZooming] = useState(false);

  // Ink specific state
  const [isDrawing, setIsDrawing] = useState(false);
  const [isErasing, setIsErasing] = useState(false);
  const currentPathRef = useRef<{ x: number; y: number }[]>([]);
  const liveInkPathRef = useRef<SVGPathElement | null>(null);
  const liveInkPathRafRef = useRef<number | null>(null);

  const cancelLiveInkPathSync = useCallback(() => {
    if (typeof window === "undefined") return;
    if (liveInkPathRafRef.current === null) return;
    window.cancelAnimationFrame(liveInkPathRafRef.current);
    liveInkPathRafRef.current = null;
  }, []);

  const syncLiveInkPath = useCallback(() => {
    liveInkPathRafRef.current = null;
    const pathElement = liveInkPathRef.current;
    if (!pathElement) return;
    pathElement.setAttribute("d", pointsToPathLib(currentPathRef.current));
  }, []);

  const scheduleLiveInkPathSync = useCallback(() => {
    if (typeof window === "undefined") return;
    if (liveInkPathRafRef.current !== null) return;
    liveInkPathRafRef.current = window.requestAnimationFrame(syncLiveInkPath);
  }, [syncLiveInkPath]);

  const cancelInProgressInkStroke = useCallback(() => {
    setIsDrawing(false);
    currentPathRef.current = [];
    cancelLiveInkPathSync();
    liveInkPathRef.current?.setAttribute("d", "");
  }, [cancelLiveInkPathSync]);

  const { appendStroke, shouldAppendPoint } = useInkSession({
    editorState,
    editorStateRef,
    onAddAnnotation,
    onUpdateAnnotation,
    onCancelInProgressStroke: cancelInProgressInkStroke,
    onTriggerHistorySave,
  });

  useEffect(() => {
    return () => {
      cancelLiveInkPathSync();
    };
  }, [cancelLiveInkPathSync]);

  useEffect(() => {
    if (!isDrawing) return;
    scheduleLiveInkPathSync();
  }, [activePageIndex, isDrawing, scheduleLiveInkPathSync]);

  const {
    createTextHighlightFromSelection,
    textSelectionToolbar,
    setTextSelectionToolbar,
    textSelectionVirtualRef,
    textSelectingPages,
    textPointerSelectingPages,
    isTextSelectionHandleDragging,
    updateTextSelectionToolbar,
  } = useWorkspaceTextSelection({
    editorState,
    editorStateRef,
    onAddAnnotation,
    onSelectControl,
  });

  const closeTextSelectionPopover = useCallback(() => {
    window.getSelection?.()?.removeAllRanges?.();
    setTextSelectionToolbar((prev) =>
      prev.isVisible ? { ...prev, isVisible: false } : prev,
    );
  }, [setTextSelectionToolbar]);

  const updatePinchGestureActive = useCallback((active: boolean) => {
    pinchGestureActiveRef.current = active;
    setIsPinchZooming(active);
  }, []);

  const resolveSelectionAttachmentRect = useCallback(
    async (selection: TextSelectionPayload) => {
      const page = editorState.pages[selection.pageIndex];
      if (!page) return null;

      const textContent = await pdfWorkerService.getTextContent({
        pageIndex: selection.pageIndex,
      });
      const geometry = getPdfSearchRangeGeometry(
        textContent,
        page,
        selection.startOffset,
        selection.endOffset,
      );
      return geometry?.rect ?? null;
    },
    [editorState.pages],
  );

  const handleAskAiFromSelection = useCallback(() => {
    const text = textSelectionToolbar.text.trim();
    const selection = textSelectionToolbar.selection;
    if (!text || !selection) return;

    closeTextSelectionPopover();

    void (async () => {
      const rect = await resolveSelectionAttachmentRect(selection).catch(
        () => null,
      );
      if (!rect) return;
      appEventBus.emit(
        "workspace:askAi",
        {
          kind: "workspace_selection",
          text: selection.exactText,
          pageIndex: selection.pageIndex,
          startOffset: selection.startOffset,
          endOffset: selection.endOffset,
          rect,
        },
        { sticky: true },
      );
    })();
  }, [
    closeTextSelectionPopover,
    resolveSelectionAttachmentRect,
    textSelectionToolbar.selection,
    textSelectionToolbar.text,
  ]);

  const handleAskAiFromAnnotation = useCallback((annotation: Annotation) => {
    const attachment: AiChatMessageAttachment = {
      kind: "annotation_reference",
      annotationId: annotation.id,
      annotationType: annotation.type,
      pageIndex: annotation.pageIndex,
      ...(annotation.text?.trim() ? { text: annotation.text.trim() } : null),
      ...(annotation.highlightedText?.trim()
        ? { highlightedText: annotation.highlightedText.trim() }
        : null),
      ...(annotation.linkUrl?.trim()
        ? { linkUrl: annotation.linkUrl.trim() }
        : null),
      ...(typeof annotation.linkDestPageIndex === "number"
        ? { linkDestPageIndex: annotation.linkDestPageIndex }
        : null),
    };

    appEventBus.emit("workspace:askAi", attachment, { sticky: true });
  }, []);

  useAppEvent(
    "workspace:navigatePage",
    ({ pageIndex, behavior, skipScroll }) => {
      if (skipScroll) return;
      const container = containerRef.current;
      if (!container) return;

      if (shouldVirtualizePages) {
        const rect = getPageRectByPageIndex(pageIndex);
        if (!rect) return;
        if (editorState.pageFlow === "vertical") {
          container.scrollTo({ top: rect.top, behavior: behavior ?? "auto" });
        } else {
          container.scrollTo({ left: rect.left, behavior: behavior ?? "auto" });
        }
        return;
      }

      document.getElementById(`page-${pageIndex}`)?.scrollIntoView({
        behavior: behavior ?? "auto",
        block: "start",
      });
    },
  );

  useAppEvent("workspace:focusControl", ({ id, behavior, skipScroll }) => {
    if (skipScroll) return;
    const container = containerRef.current;
    if (!container) return;

    const state = editorStateRef.current;
    const field = state.fields.find((item) => item.id === id);
    const annotation = field
      ? null
      : state.annotations.find((item) => item.id === id);

    const pageIndex = field?.pageIndex ?? annotation?.pageIndex;
    if (typeof pageIndex !== "number") return;

    const rect =
      field?.rect ?? (annotation ? getFocusRect(annotation) : undefined);
    const pageRect = getPageRectByPageIndex(pageIndex);
    if (!pageRect) return;

    const containerRect = container.getBoundingClientRect();
    let targetLeft = pageRect.left;
    let targetTop = pageRect.top;

    if (rect) {
      const rectCenterX = rect.x + rect.width / 2;
      const rectCenterY = rect.y + rect.height / 2;
      targetLeft =
        pageRect.left +
        rectCenterX * editorState.scale -
        containerRect.width / 2;
      targetTop =
        pageRect.top +
        rectCenterY * editorState.scale -
        containerRect.height / 2;
    }

    container.scrollTo({
      left: Math.max(0, targetLeft),
      top: Math.max(0, targetTop),
      behavior: behavior ?? "smooth",
    });
  });

  useAppEvent(
    "workspace:focusSearchResult",
    ({ pageIndex, rect, behavior, skipScroll }) =>
      scrollWorkspaceToPageRect({
        pageIndex,
        rect,
        behavior: behavior ?? "smooth",
        skipScroll,
      }),
  );

  useAppEvent(
    "workspace:focusTextRange",
    ({ pageIndex, rect, behavior, skipScroll }) =>
      scrollWorkspaceToPageRect({
        pageIndex,
        rect,
        behavior: behavior ?? "auto",
        skipScroll,
      }),
  );

  const [movingFieldId, setMovingFieldId] = useState<string | null>(null);
  const [movingAnnotationId, setMovingAnnotationId] = useState<string | null>(
    null,
  );
  const [resizingFieldId, setResizingFieldId] = useState<string | null>(null);
  const [resizingAnnotationId, setResizingAnnotationId] = useState<
    string | null
  >(null);
  const [moveOffset, setMoveOffset] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [moveStartRaw, setMoveStartRaw] = useState<{
    x: number;
    y: number;
    originalRect: Rect;
  } | null>(null);

  const [resizeStart, setResizeStart] = useState<{
    originalRect: Rect;
    mouseX: number;
    mouseY: number;
    originalRotationDeg?: number;
    rotateStartAngleRad?: number;
    rotatePivot?: { x: number; y: number };
  } | null>(null);

  const [resizeHandle, setResizeHandle] = useState<string | null>(null);

  useEffect(() => {
    const isTransforming =
      !!movingFieldId ||
      !!movingAnnotationId ||
      !!resizingFieldId ||
      !!resizingAnnotationId;

    // Allow floating toolbars (Popover-based) to hide while dragging/resizing.
    if (typeof document !== "undefined") {
      document.body.dataset.ffControlTransforming = isTransforming ? "1" : "0";
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("ff-control-transforming", {
          detail: { active: isTransforming },
        }),
      );
    }
  }, [
    movingFieldId,
    movingAnnotationId,
    resizingFieldId,
    resizingAnnotationId,
  ]);

  // Auto-scroll when interacting near edges
  const isInteracting = !!(
    dragStart ||
    isErasing ||
    movingFieldId ||
    movingAnnotationId ||
    resizingFieldId ||
    resizingAnnotationId
  );
  const isTextSelectionAutoScrolling =
    isTextSelectionHandleDragging ||
    Object.keys(textPointerSelectingPages).length > 0;
  useAutoScroll(containerRef, {
    enabled: isInteracting || isTextSelectionAutoScrolling,
  });

  const [snapLines, setSnapLines] = useState<SnapLine[]>([]);
  const lastMousePosRef = useRef({ x: 0, y: 0 });

  const clearActiveInteractionState = useCallback(() => {
    setDragStart(null);
    setDragCurrent(null);
    setActivePageIndex(null);
    setMovingFieldId(null);
    setMoveOffset(null);
    setMoveStartRaw(null);
    setMovingAnnotationId(null);
    setResizingFieldId(null);
    setResizingAnnotationId(null);
    setResizeStart(null);
    setResizeHandle(null);
    setSnapLines([]);
    setIsDrawing(false);
    setIsErasing(false);
  }, []);

  const abortActiveInteractions = useCallback(() => {
    endPan();
    resetGlobalCursor();
    cancelInProgressInkStroke();
    closeTextSelectionPopover();
    clearActiveInteractionState();
  }, [
    cancelInProgressInkStroke,
    clearActiveInteractionState,
    closeTextSelectionPopover,
    endPan,
  ]);

  // Track if any interactive operation is in progress
  // NOTE: Definition moved up to be used by useAutoScroll hook
  // const isInteracting = !!(dragStart || isDrawing || isErasing || movingFieldId || movingAnnotationId || resizingFieldId);

  // --- Register Controls ---
  // Controls are now registered in index.tsx, so we don't need to do it here.
  // But we keep this comment for reference.

  // --- Optimization: Pre-calculate grouped controls ---
  const { pagesWithControls } = useWorkspaceDerivedPages({
    pages: editorState.pages,
    fields: editorState.fields,
    annotations: editorState.annotations,
    pageLayout: editorState.pageLayout,
  });

  const pageRowsForLayout = useMemo(() => {
    if (editorState.pageLayout === "single") {
      return [] as Array<Array<(typeof editorState.pages)[number]>>;
    }

    const pages = editorState.pages;
    const rows: Array<Array<(typeof editorState.pages)[number]>> = [];
    if (pages.length === 0) return rows;

    const startIndex = editorState.pageLayout === "double_even" ? 1 : 0;
    if (editorState.pageLayout === "double_even") {
      if (pages[0]) rows.push([pages[0]]);
    }

    for (let i = startIndex; i < pages.length; i += 2) {
      const left = pages[i];
      if (!left) continue;
      const right = pages[i + 1];
      if (right) rows.push([left, right]);
      else rows.push([left]);
    }

    return rows;
  }, [editorState.pageLayout, editorState.pages]);

  const pagePlacementByIndex = useMemo(() => {
    const map = new Map<
      number,
      {
        spreadIndex: number;
        posInSpread: number;
        isSingleInSpread: boolean;
      }
    >();

    if (editorState.pageLayout === "single") {
      editorState.pages.forEach((p, idx) => {
        map.set(p.pageIndex, {
          spreadIndex: idx,
          posInSpread: 0,
          isSingleInSpread: true,
        });
      });
      return map;
    }

    pageRowsForLayout.forEach((row, spreadIndex) => {
      row.forEach((p, posInSpread) => {
        map.set(p.pageIndex, {
          spreadIndex,
          posInSpread,
          isSingleInSpread: row.length === 1,
        });
      });
    });

    return map;
  }, [editorState.pageLayout, editorState.pages, pageRowsForLayout]);

  const contentLayoutStyle = useMemo(() => {
    const gapPx = `${WORKSPACE_BASE_PAGE_GAP_PX * editorState.scale}px`;
    const isDoubleLayout = editorState.pageLayout !== "single";

    if (editorState.pageFlow === "horizontal") {
      return {
        columnGap: gapPx,
        rowGap: gapPx,
        gridAutoFlow: "column" as const,
        gridTemplateRows: isDoubleLayout
          ? ("repeat(2, max-content)" as const)
          : ("max-content" as const),
      };
    }

    return {
      columnGap: gapPx,
      rowGap: gapPx,
      gridAutoFlow: "row" as const,
      gridTemplateColumns: isDoubleLayout
        ? ("repeat(2, max-content)" as const)
        : ("max-content" as const),
    };
  }, [editorState.pageFlow, editorState.pageLayout, editorState.scale]);

  const workspaceBottomPaddingPx = useMemo(() => {
    return Math.max(
      WORKSPACE_BOTTOM_PADDING_PX,
      Math.ceil(bottomOverlayInsetPx) + 16,
    );
  }, [bottomOverlayInsetPx]);

  // Large PDFs can overwhelm layout/paint when rendering all pages at once.
  // Virtualization keeps the DOM small by only mounting pages near the viewport.
  const shouldVirtualizePages =
    pagesWithControls.length > WORKSPACE_VIRTUALIZATION_THRESHOLD_PAGES;

  const virtualAxis =
    editorState.pageFlow === "vertical" ? "vertical" : "horizontal";

  const pageLayoutRects = useMemo(() => {
    return computeWorkspacePageRects({
      pages: editorState.pages,
      pageRows: pageRowsForLayout,
      pageLayout: editorState.pageLayout,
      pageFlow: editorState.pageFlow,
      scale: editorState.scale,
      bottomPaddingPx: workspaceBottomPaddingPx,
    });
  }, [
    editorState.pageFlow,
    editorState.pageLayout,
    editorState.pages,
    editorState.scale,
    pageRowsForLayout,
    workspaceBottomPaddingPx,
  ]);

  const pageIndexToItemIndex = useMemo(() => {
    const map = new Map<number, number>();
    pagesWithControls.forEach((p, i) => {
      map.set(p.pageIndex, i);
    });
    return map;
  }, [pagesWithControls]);

  const getPageRectByPageIndex = useCallback(
    (pageIndex: number) => {
      const idx = pageIndexToItemIndex.get(pageIndex);
      if (typeof idx !== "number") return null;
      return pageLayoutRects.virtualRects[idx] ?? null;
    },
    [pageIndexToItemIndex, pageLayoutRects.virtualRects],
  );

  const scrollWorkspaceToPageRect = useCallback(
    ({
      pageIndex,
      rect,
      behavior,
      skipScroll,
    }: {
      pageIndex: number;
      rect: Rect;
      behavior?: "auto" | "smooth";
      skipScroll?: boolean;
    }) => {
      if (skipScroll) return;
      const container = containerRef.current;
      if (!container) return;

      const pageRect = getPageRectByPageIndex(pageIndex);
      if (!pageRect) return;

      const containerRect = container.getBoundingClientRect();
      const rectCenterX = rect.x + rect.width / 2;
      const rectCenterY = rect.y + rect.height / 2;
      const targetLeft =
        pageRect.left +
        rectCenterX * editorState.scale -
        containerRect.width / 2;
      const targetTop =
        pageRect.top +
        rectCenterY * editorState.scale -
        containerRect.height / 2;

      container.scrollTo({
        left: Math.max(0, targetLeft),
        top: Math.max(0, targetTop),
        behavior: behavior ?? "auto",
      });
    },
    [editorState.scale, getPageRectByPageIndex],
  );

  const allowPageIndexChange = !editorState.pendingViewStateRestore;
  const { handleViewportScroll, panViewportBy, zoomAtClientPoint } =
    useWorkspaceViewport({
      containerRef,
      contentRef,
      editorState,
      onScaleChange,
      isPanning,
      fitTrigger,
      onPageIndexChange: allowPageIndexChange ? onPageIndexChange : undefined,
      textSelectionToolbarVisible: textSelectionToolbar.isVisible,
      updateTextSelectionToolbar,
    });

  useWorkspaceTouchPinch({
    containerRef,
    enabled: editorState.pages.length > 0,
    scale: editorState.scale,
    tool: editorState.tool,
    onPinchStart: abortActiveInteractions,
    onPinchStateChange: updatePinchGestureActive,
    onPinchZoom: ({ clientX, clientY, newScale }) => {
      void zoomAtClientPoint({
        clientX,
        clientY,
        newScale,
        source: "pinch",
      });
    },
    onPinchPan: panViewportBy,
  });
  const workspaceZoomJankDebugEnabled =
    editorState.options.debugOptions.workspaceZoomJank;

  const wasRestoringRef = useRef(false);
  useEffect(() => {
    const isRestoring = !!editorState.pendingViewStateRestore;
    if (wasRestoringRef.current && !isRestoring) {
      handleViewportScroll();
    }
    wasRestoringRef.current = isRestoring;
  }, [editorState.pendingViewStateRestore, handleViewportScroll]);

  const { getRelativeCoordsFromPoint, getRelativeCoords } =
    useWorkspacePointerCoords({
      editorStateRef,
      contentRef,
      getPageRectByPageIndex,
    });

  const { checkEraserCollision } = useWorkspaceEraser({
    editorState,
    onDeleteAnnotation,
  });

  const { applySnapping } = useWorkspaceSnapping({ editorState });

  // --- Helper to find page index from mouse coordinates ---
  const getPageIndexFromPoint = (x: number, y: number) => {
    return getPageIndexFromPointLib(
      x,
      y,
      activePageIndex,
      editorState.pages.length,
      {
        contentEl: contentRef.current,
        axis: editorState.pageFlow === "vertical" ? "vertical" : "horizontal",
        getPageRectByPageIndex,
      },
    );
  };

  const getRotatedFreetextOuterRect = React.useCallback(
    (rect: Rect, rotationDeg: number) => {
      const theta = (rotationDeg * Math.PI) / 180;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const absCos = Math.abs(cos);
      const absSin = Math.abs(sin);

      const outerW = absCos * rect.width + absSin * rect.height;
      const outerH = absSin * rect.width + absCos * rect.height;
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;

      return {
        x: cx - outerW / 2,
        y: cy - outerH / 2,
        width: outerW,
        height: outerH,
      };
    },
    [],
  );

  const getInnerSizeFromOuterAabb = React.useCallback(
    (outer: Rect, rotationDeg: number) => {
      if (!Number.isFinite(rotationDeg) || rotationDeg === 0) {
        return { width: outer.width, height: outer.height };
      }

      const theta = (rotationDeg * Math.PI) / 180;
      const absCos = Math.abs(Math.cos(theta));
      const absSin = Math.abs(Math.sin(theta));
      const det = absCos * absCos - absSin * absSin;
      if (!Number.isFinite(det) || Math.abs(det) < 1e-6) {
        return { width: outer.width, height: outer.height };
      }

      const width = (outer.width * absCos - outer.height * absSin) / det;
      const height = (outer.height * absCos - outer.width * absSin) / det;
      if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0
      ) {
        return { width: outer.width, height: outer.height };
      }

      return { width, height };
    },
    [],
  );

  const updateMovingAnnotation = (clientX: number, clientY: number) => {
    if (!movingAnnotationId || !moveOffset) return;

    const annot = editorState.annotations.find(
      (a) => a.id === movingAnnotationId,
    );
    // Allow moving any annotation with a rect (comment, freetext, ink)
    if (annot && annot.rect) {
      let currentTargetPageIndex = activePageIndex;
      const hoveredPageIndex = getPageIndexFromPoint(clientX, clientY);

      if (hoveredPageIndex !== null && hoveredPageIndex !== activePageIndex) {
        currentTargetPageIndex = hoveredPageIndex;
        setActivePageIndex(hoveredPageIndex);
      }

      const pageIndex = currentTargetPageIndex ?? 0;
      const currentCoords = getRelativeCoordsFromPoint(
        clientX,
        clientY,
        pageIndex,
      );

      const newOuterX = currentCoords.x - moveOffset.x;
      const newOuterY = currentCoords.y - moveOffset.y;

      if (
        annot.type === "freetext" &&
        typeof annot.rotationDeg === "number" &&
        Number.isFinite(annot.rotationDeg) &&
        annot.rotationDeg !== 0
      ) {
        const outer = getRotatedFreetextOuterRect(
          annot.rect,
          annot.rotationDeg,
        );
        const dx = (outer.width - annot.rect.width) / 2;
        const dy = (outer.height - annot.rect.height) / 2;
        onUpdateAnnotation(movingAnnotationId, {
          rect: { ...annot.rect, x: newOuterX + dx, y: newOuterY + dy },
          pageIndex: pageIndex,
        });
        return;
      }

      onUpdateAnnotation(movingAnnotationId, {
        rect: { ...annot.rect, x: newOuterX, y: newOuterY },
        pageIndex: pageIndex,
      });
    }
  };

  const updateResizingAnnotation = (clientX: number, clientY: number) => {
    if (!resizingAnnotationId || !resizeStart || !resizeHandle) return;

    const annot = editorState.annotations.find(
      (a) => a.id === resizingAnnotationId,
    );
    if (annot && annot.rect) {
      const pageIndex = annot.pageIndex;
      const currentCoords = getRelativeCoordsFromPoint(
        clientX,
        clientY,
        pageIndex,
      );

      if (resizeHandle === "rotate" && annot.type === "freetext") {
        const pivot =
          resizeStart.rotatePivot ??
          ({
            x: resizeStart.originalRect.x + resizeStart.originalRect.width / 2,
            y: resizeStart.originalRect.y + resizeStart.originalRect.height / 2,
          } satisfies { x: number; y: number });

        const startAngle = resizeStart.rotateStartAngleRad ?? 0;
        const currentAngle = Math.atan2(
          currentCoords.y - pivot.y,
          currentCoords.x - pivot.x,
        );
        const deltaDeg = ((currentAngle - startAngle) * 180) / Math.PI;
        const baseDeg =
          typeof resizeStart.originalRotationDeg === "number"
            ? resizeStart.originalRotationDeg
            : typeof annot.rotationDeg === "number"
              ? annot.rotationDeg
              : 0;

        let next = normalizeRotationDeg(baseDeg + deltaDeg);
        if (editorState.keys.shift) {
          next = Math.round(next / 15) * 15;
        }

        onUpdateAnnotation(resizingAnnotationId, { rotationDeg: next });
        return;
      }

      let newX = resizeStart.originalRect.x;
      let newY = resizeStart.originalRect.y;
      let newW = resizeStart.originalRect.width;
      let newH = resizeStart.originalRect.height;

      const deltaX = currentCoords.x - resizeStart.mouseX;
      const deltaY = currentCoords.y - resizeStart.mouseY;

      if (resizeHandle.includes("e")) newW += deltaX;
      if (resizeHandle.includes("w")) {
        newX += deltaX;
        newW -= deltaX;
      }
      if (resizeHandle.includes("s")) newH += deltaY;
      if (resizeHandle.includes("n")) {
        newY += deltaY;
        newH -= deltaY;
      }

      // Minimum size check
      if (newW < 5) {
        if (resizeHandle.includes("w"))
          newX =
            resizeStart.originalRect.x + resizeStart.originalRect.width - 5;
        newW = 5;
      }
      if (newH < 5) {
        if (resizeHandle.includes("n"))
          newY =
            resizeStart.originalRect.y + resizeStart.originalRect.height - 5;
        newH = 5;
      }

      onUpdateAnnotation(resizingAnnotationId, {
        rect: { ...annot.rect, x: newX, y: newY, width: newW, height: newH },
      });
    }
  };

  const updateMovingField = (clientX: number, clientY: number) => {
    if (!movingFieldId || !moveOffset || !moveStartRaw) return;

    const field = editorState.fields.find((f) => f.id === movingFieldId);
    if (field) {
      let currentTargetPageIndex = activePageIndex;
      const hoveredPageIndex = getPageIndexFromPoint(clientX, clientY);

      if (hoveredPageIndex !== null && hoveredPageIndex !== activePageIndex) {
        currentTargetPageIndex = hoveredPageIndex;
        setActivePageIndex(hoveredPageIndex);
      }

      const pageIndex = currentTargetPageIndex ?? 0;
      const currentCoords = getRelativeCoordsFromPoint(
        clientX,
        clientY,
        pageIndex,
      );

      let newX = currentCoords.x - moveOffset.x;
      let newY = currentCoords.y - moveOffset.y;

      if (editorState.keys.shift) {
        const totalDx = currentCoords.x - moveStartRaw.x;
        const totalDy = currentCoords.y - moveStartRaw.y;
        if (Math.abs(totalDx) > Math.abs(totalDy)) {
          newY = moveStartRaw.originalRect.y;
        } else {
          newX = moveStartRaw.originalRect.x;
        }
      }

      const { enabled, threshold: baseThreshold } =
        editorState.options.snappingOptions;
      const threshold = baseThreshold / editorState.scale;
      const shouldSnap =
        enabled && !editorState.keys.alt && editorState.mode === "form";

      if (shouldSnap) {
        const snapResult = applySnapping(
          {
            x: newX,
            y: newY,
            width: field.rect.width,
            height: field.rect.height,
          },
          pageIndex,
          movingFieldId,
          threshold,
        );
        newX = snapResult.x;
        newY = snapResult.y;
        setSnapLines(snapResult.guides);
      } else {
        setSnapLines([]);
      }

      onUpdateField(movingFieldId, {
        rect: { ...field.rect, x: newX, y: newY },
        pageIndex: pageIndex,
      });
    }
  };

  const updateResizingField = (clientX: number, clientY: number) => {
    if (
      !resizingFieldId ||
      !resizeStart ||
      !resizeHandle ||
      activePageIndex === null
    )
      return;

    const coords = getRelativeCoordsFromPoint(
      clientX,
      clientY,
      activePageIndex,
    );
    const { enabled, threshold: baseThreshold } =
      editorState.options.snappingOptions;
    const threshold = baseThreshold / editorState.scale;
    const shouldSnap =
      enabled && !editorState.keys.alt && editorState.mode === "form";

    const dx = coords.x - resizeStart.mouseX;
    const dy = coords.y - resizeStart.mouseY;
    let newX = resizeStart.originalRect.x;
    let newY = resizeStart.originalRect.y;
    let newW = resizeStart.originalRect.width;
    let newH = resizeStart.originalRect.height;

    // 1. Calculate rough dimensions
    if (resizeHandle.includes("e"))
      newW = Math.max(10, resizeStart.originalRect.width + dx);
    if (resizeHandle.includes("w")) {
      const effDx = Math.min(dx, resizeStart.originalRect.width - 10);
      newX += effDx;
      newW -= effDx;
    }
    if (resizeHandle.includes("s"))
      newH = Math.max(10, resizeStart.originalRect.height + dy);
    if (resizeHandle.includes("n")) {
      const effDy = Math.min(dy, resizeStart.originalRect.height - 10);
      newY += effDy;
      newH -= effDy;
    }

    // 2. Aspect Ratio (Shift) - Only for corner resizing
    if (editorState.keys.shift && resizeHandle.length === 2) {
      const aspect =
        resizeStart.originalRect.width / resizeStart.originalRect.height;
      const absDx = Math.abs(newW - resizeStart.originalRect.width);
      const absDy = Math.abs(newH - resizeStart.originalRect.height);

      // Use the larger delta to drive the size
      if (absDx > absDy * aspect) {
        // Width changed more (relative to aspect), adjust Height
        const targetH = newW / aspect;
        if (resizeHandle.includes("n")) {
          newY += newH - targetH;
        }
        newH = targetH;
      } else {
        // Height changed more, adjust Width
        const targetW = newH * aspect;
        if (resizeHandle.includes("w")) {
          newX += newW - targetW;
        }
        newW = targetW;
      }
    }

    // 3. Snapping
    const guides: SnapLine[] = [];
    if (shouldSnap) {
      const otherFields = editorState.fields.filter(
        (f) => f.pageIndex === activePageIndex && f.id !== resizingFieldId,
      );

      // Helper to find snap
      const findSnap = (val: number, type: "vertical" | "horizontal") => {
        let best = Infinity;
        let snapTo = null;
        let guide = null;

        otherFields.forEach((f) => {
          const targets =
            type === "vertical"
              ? [f.rect.x, f.rect.x + f.rect.width]
              : [f.rect.y, f.rect.y + f.rect.height];

          targets.forEach((t) => {
            const dist = t - val;
            if (Math.abs(dist) < threshold && Math.abs(dist) < Math.abs(best)) {
              best = dist;
              snapTo = t;
              guide = t;
            }
          });
        });
        return { snapTo, guide };
      };

      if (editorState.keys.shift && resizeHandle.length === 2) {
        // Aspect Ratio Preserving Snapping Logic
        // If Shift is held, we prioritize keeping aspect ratio.
        // We find the BEST snap (if any) and then recalculate the other dimension to match the aspect ratio.
        const aspect =
          resizeStart.originalRect.width / resizeStart.originalRect.height;
        let bestSnapDist = Infinity;
        let bestSnapType: "w" | "e" | "n" | "s" | null = null;
        let bestSnapVal = null;
        let bestGuide = null;

        // Check all relevant sides for nearest snap
        if (resizeHandle.includes("w")) {
          const { snapTo, guide } = findSnap(newX, "vertical");
          if (snapTo !== null) {
            const dist = Math.abs(snapTo - newX);
            if (dist < bestSnapDist) {
              bestSnapDist = dist;
              bestSnapType = "w";
              bestSnapVal = snapTo;
              bestGuide = guide;
            }
          }
        }
        if (resizeHandle.includes("e")) {
          const { snapTo, guide } = findSnap(newX + newW, "vertical");
          if (snapTo !== null) {
            const dist = Math.abs(snapTo - (newX + newW));
            if (dist < bestSnapDist) {
              bestSnapDist = dist;
              bestSnapType = "e";
              bestSnapVal = snapTo;
              bestGuide = guide;
            }
          }
        }
        if (resizeHandle.includes("n")) {
          const { snapTo, guide } = findSnap(newY, "horizontal");
          if (snapTo !== null) {
            const dist = Math.abs(snapTo - newY);
            if (dist < bestSnapDist) {
              bestSnapDist = dist;
              bestSnapType = "n";
              bestSnapVal = snapTo;
              bestGuide = guide;
            }
          }
        }
        if (resizeHandle.includes("s")) {
          const { snapTo, guide } = findSnap(newY + newH, "horizontal");
          if (snapTo !== null) {
            const dist = Math.abs(snapTo - (newY + newH));
            if (dist < bestSnapDist) {
              bestSnapDist = dist;
              bestSnapType = "s";
              bestSnapVal = snapTo;
              bestGuide = guide;
            }
          }
        }

        // Apply only the BEST snap to preserve aspect ratio
        if (bestSnapType && bestSnapVal !== null) {
          if (bestSnapType === "w") {
            const diff = bestSnapVal - newX;
            newX = bestSnapVal;
            newW -= diff;
            // Recalc Height
            const targetH = newW / aspect;
            if (resizeHandle.includes("n")) newY += newH - targetH;
            newH = targetH;
            guides.push({
              type: "vertical",
              pos: bestGuide as number,
              start: 0,
              end: 2000,
            });
          } else if (bestSnapType === "e") {
            newW = bestSnapVal - newX;
            // Recalc Height
            const targetH = newW / aspect;
            if (resizeHandle.includes("n")) newY += newH - targetH;
            newH = targetH;
            guides.push({
              type: "vertical",
              pos: bestGuide as number,
              start: 0,
              end: 2000,
            });
          } else if (bestSnapType === "n") {
            const diff = bestSnapVal - newY;
            newY = bestSnapVal;
            newH -= diff;
            // Recalc Width
            const targetW = newH * aspect;
            if (resizeHandle.includes("w")) newX += newW - targetW;
            newW = targetW;
            guides.push({
              type: "horizontal",
              pos: bestGuide as number,
              start: 0,
              end: 2000,
            });
          } else if (bestSnapType === "s") {
            newH = bestSnapVal - newY;
            // Recalc Width
            const targetW = newH * aspect;
            if (resizeHandle.includes("w")) newX += newW - targetW;
            newW = targetW;
            guides.push({
              type: "horizontal",
              pos: bestGuide as number,
              start: 0,
              end: 2000,
            });
          }
        }
      } else {
        // Standard Independent Snapping (No Shift or Side Handle)
        // Snap Left
        if (resizeHandle.includes("w")) {
          const { snapTo, guide } = findSnap(newX, "vertical");
          if (snapTo !== null) {
            const diff = snapTo - newX;
            newX = snapTo;
            newW -= diff;
            guides.push({
              type: "vertical",
              pos: guide as number,
              start: 0,
              end: 2000,
            });
          }
        }
        // Snap Right
        if (resizeHandle.includes("e")) {
          const { snapTo, guide } = findSnap(newX + newW, "vertical");
          if (snapTo !== null) {
            newW = snapTo - newX;
            guides.push({
              type: "vertical",
              pos: guide as number,
              start: 0,
              end: 2000,
            });
          }
        }
        // Snap Top
        if (resizeHandle.includes("n")) {
          const { snapTo, guide } = findSnap(newY, "horizontal");
          if (snapTo !== null) {
            const diff = snapTo - newY;
            newY = snapTo;
            newH -= diff;
            guides.push({
              type: "horizontal",
              pos: guide as number,
              start: 0,
              end: 2000,
            });
          }
        }
        // Snap Bottom
        if (resizeHandle.includes("s")) {
          const { snapTo, guide } = findSnap(newY + newH, "horizontal");
          if (snapTo !== null) {
            newH = snapTo - newY;
            guides.push({
              type: "horizontal",
              pos: guide as number,
              start: 0,
              end: 2000,
            });
          }
        }
      }
    }
    setSnapLines(guides);
    onUpdateField(resizingFieldId, {
      rect: { x: newX, y: newY, width: newW, height: newH },
    });
  };

  const handleScroll = () => {
    if (isInteracting) {
      if (movingFieldId) {
        updateMovingField(lastMousePosRef.current.x, lastMousePosRef.current.y);
      } else if (movingAnnotationId) {
        updateMovingAnnotation(
          lastMousePosRef.current.x,
          lastMousePosRef.current.y,
        );
      } else if (resizingFieldId) {
        updateResizingField(
          lastMousePosRef.current.x,
          lastMousePosRef.current.y,
        );
      } else if (resizingAnnotationId) {
        updateResizingAnnotation(
          lastMousePosRef.current.x,
          lastMousePosRef.current.y,
        );
      }
    }

    handleViewportScroll();
  };

  // --- Handlers ---
  const handleContainerPointerDown = (e: React.PointerEvent) => {
    if (pinchGestureActiveRef.current) return;
    if (startPan(e)) return;
  };

  const handlePointerDown = (e: React.PointerEvent, pageIndex: number) => {
    if (pinchGestureActiveRef.current) return;
    if (e.button === 1) return;
    if (isPanModeActive) return;

    const isTextLayerHit = (() => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.(".textLayer")) return true;
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      return els.some((el) =>
        (el as HTMLElement | null)?.closest?.(".textLayer span"),
      );
    })();

    if (editorState.tool === "select" && isTextLayerHit) {
      onSelectControl(null);
      return;
    }

    // Unified highlight:
    // - On text spans: allow native selection.
    // - Otherwise: draw as an ink highlight (intent=InkHighlight).
    if (
      editorState.tool === "draw_highlight" &&
      editorState.mode === "annotation"
    ) {
      const isTextHit = (() => {
        const target = e.target as HTMLElement | null;
        if (target?.closest?.(".textLayer span")) return true;

        // Some PDF.js text layers may dispatch pointer events from the layer container
        // instead of the underlying spans. Detect spans under the pointer.
        const els = document.elementsFromPoint(e.clientX, e.clientY);
        return els.some((el) =>
          (el as HTMLElement | null)?.closest?.(".textLayer span"),
        );
      })();
      if (isTextHit) {
        e.stopPropagation();
        return;
      }
    }

    e.stopPropagation();

    // Ensure mouse position is tracked immediately
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };

    // Capture pointer for all interactions initiated here
    capturePointer(e);

    if (editorState.tool === "select") {
      onSelectControl(null);
      return;
    }

    // Prevent default behavior (like text selection) for drawing tools
    e.preventDefault();

    // Ink Drawing Start (including ink-highlight via draw_highlight)
    if (
      editorState.tool === "draw_ink" ||
      (editorState.tool === "draw_highlight" &&
        editorState.mode === "annotation")
    ) {
      setGlobalCursor("crosshair");
      setActivePageIndex(pageIndex);
      const coords = getRelativeCoords(e, pageIndex);
      setIsDrawing(true);
      currentPathRef.current = [coords];
      return;
    }

    // Eraser Start
    if (editorState.tool === "eraser") {
      setGlobalCursor("cell");
      setActivePageIndex(pageIndex);
      setIsErasing(true);
      const coords = getRelativeCoords(e, pageIndex);
      checkEraserCollision(coords.x, coords.y, pageIndex);
      return;
    }

    // Drag Drawing Start (Form Fields & Highlights)
    if (editorState.tool === "draw_comment") {
      const coords = getRelativeCoords(e, pageIndex);
      const iconSize = 24;
      // Center the icon on the click
      const x = coords.x - iconSize / 2;
      const y = coords.y - iconSize / 2;

      const newId = `comment_${Date.now()}`;
      onAddAnnotation({
        id: newId,
        pageIndex: pageIndex,
        type: "comment",
        rect: { x, y, width: iconSize, height: iconSize },
        text: "New Comment",
        color:
          editorState.commentStyle?.color || ANNOTATION_STYLES.comment.color,
        opacity:
          editorState.commentStyle?.opacity ||
          ANNOTATION_STYLES.comment.opacity,
      });

      // Select the newly created comment
      onSelectControl(newId);

      if (
        !editorState.keys.shift &&
        !editorState.keys.ctrl &&
        shouldSwitchToSelectAfterUse("draw_comment")
      ) {
        onToolChange("select");
      }
      return;
    }

    setGlobalCursor("crosshair");
    setActivePageIndex(pageIndex);
    const coords = getRelativeCoords(e, pageIndex);
    setDragStart(coords);
    setDragCurrent(coords);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (pinchGestureActiveRef.current) return;
    // Panning Logic
    if (movePan(e)) return;

    if (activePageIndex === null) return;

    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    setSnapLines([]);

    const coords = getRelativeCoords(e, activePageIndex);

    // --- INK DRAWING ---
    if (
      isDrawing &&
      (editorState.tool === "draw_ink" || editorState.tool === "draw_highlight")
    ) {
      const lastPoint =
        currentPathRef.current[currentPathRef.current.length - 1];
      if (lastPoint) {
        // Ignore points that are too close to reduce noise and improve performance
        if (!shouldAppendPoint(lastPoint, coords)) return;
      }

      currentPathRef.current.push(coords);
      scheduleLiveInkPathSync();
      return;
    }

    // --- ERASER ---
    if (isErasing && editorState.tool === "eraser") {
      checkEraserCollision(coords.x, coords.y, activePageIndex);
      return;
    }

    // --- DRAG CREATING ---
    if (dragStart) {
      let newX = coords.x;
      let newY = coords.y;

      if (editorState.keys.shift) {
        const dx = coords.x - dragStart.x;
        const dy = coords.y - dragStart.y;
        const maxDim = Math.max(Math.abs(dx), Math.abs(dy));
        newX = dragStart.x + (dx < 0 ? -maxDim : maxDim);
        newY = dragStart.y + (dy < 0 ? -maxDim : maxDim);
      }

      setDragCurrent({ x: newX, y: newY });
    }
    // --- MOVING FIELD ---
    else if (movingFieldId && moveOffset && moveStartRaw) {
      updateMovingField(e.clientX, e.clientY);
    }
    // --- MOVING ANNOTATION ---
    else if (movingAnnotationId && moveOffset) {
      updateMovingAnnotation(e.clientX, e.clientY);
    }
    // --- RESIZING ---
    else if (resizingFieldId && resizeStart && resizeHandle) {
      updateResizingField(e.clientX, e.clientY);
    } else if (resizingAnnotationId && resizeStart && resizeHandle) {
      updateResizingAnnotation(e.clientX, e.clientY);
    }
  };

  const handlePointerUp = (e?: React.PointerEvent | React.MouseEvent) => {
    if (pinchGestureActiveRef.current) return;
    if (endPan(e)) return;

    const shouldCreateTextHighlight =
      editorStateRef.current.mode === "annotation" &&
      editorStateRef.current.tool === "draw_highlight" &&
      !isDrawing;

    // Release capture if held
    releasePointer(e);

    // Reset Global Cursor
    resetGlobalCursor();

    // Finish Ink Drawing
    if (
      isDrawing &&
      (editorState.tool === "draw_ink" ||
        editorState.tool === "draw_highlight") &&
      activePageIndex !== null
    ) {
      if (e) {
        const coords = getRelativeCoords(e, activePageIndex);
        const lastPoint =
          currentPathRef.current[currentPathRef.current.length - 1];
        if (lastPoint) {
          if (shouldAppendPoint(lastPoint, coords)) {
            currentPathRef.current.push(coords);
          }
        }
      }

      setIsDrawing(false);
      cancelLiveInkPathSync();
      if (currentPathRef.current.length > 1) {
        appendStroke(activePageIndex, currentPathRef.current);
      }
      currentPathRef.current = [];
      liveInkPathRef.current?.setAttribute("d", "");
    }

    if (shouldCreateTextHighlight) {
      createTextHighlightFromSelection();
    }

    // Finish Eraser
    if (isErasing) {
      setIsErasing(false);
    }

    // Finish Drag Creation
    if (dragStart && dragCurrent && activePageIndex !== null) {
      const width = Math.abs(dragCurrent.x - dragStart.x);
      const height = Math.abs(dragCurrent.y - dragStart.y);
      const x = Math.min(dragStart.x, dragCurrent.x);
      const y = Math.min(dragStart.y, dragCurrent.y);

      if (width > 5 && height > 5) {
        if (editorState.mode === "form") {
          let type = FieldType.TEXT;
          if (editorState.tool === "draw_checkbox") type = FieldType.CHECKBOX;
          else if (editorState.tool === "draw_radio") type = FieldType.RADIO;
          else if (editorState.tool === "draw_dropdown")
            type = FieldType.DROPDOWN;
          else if (editorState.tool === "draw_signature")
            type = FieldType.SIGNATURE;
          else if (editorState.tool === "draw_text") type = FieldType.TEXT;

          if (editorState.tool !== "select") {
            const newId = `field_${Date.now()}`;
            const newField: FormField = {
              id: newId,
              pageIndex: activePageIndex,
              type,
              name: `${type}_${editorState.fields.length + 1}`,
              rect: { x, y, width, height },
              style: { ...DEFAULT_FIELD_STYLE },
              options:
                type === FieldType.DROPDOWN
                  ? ["Option 1", "Option 2"]
                  : undefined,
              radioValue: type === FieldType.RADIO ? "Choice1" : undefined,
            };
            onAddField(newField);

            // Select new field
            onSelectControl(newId);

            if (
              !editorState.keys.shift &&
              !editorState.keys.ctrl &&
              shouldSwitchToSelectAfterUse(editorState.tool)
            ) {
              onToolChange("select");
            }
          }
        } else if (editorState.mode === "annotation") {
          if (editorState.tool === "draw_freetext") {
            onAddAnnotation({
              id: `freetext_${Date.now()}`,
              pageIndex: activePageIndex,
              type: "freetext",
              rect: { x, y, width, height },
              color:
                editorState.freetextStyle?.color ||
                ANNOTATION_STYLES.freetext.color,
              size:
                editorState.freetextStyle?.size ||
                ANNOTATION_STYLES.freetext.size,
              text: "New Freetext",
            });

            if (
              !editorState.keys.shift &&
              !editorState.keys.ctrl &&
              shouldSwitchToSelectAfterUse("draw_freetext")
            ) {
              onToolChange("select");
            }
          } else if (editorState.tool === "draw_comment") {
            // Handled in handlePointerDown now for immediate click-to-place
          }
        }
      } else if (
        editorState.tool === "draw_freetext" &&
        editorState.mode === "annotation"
      ) {
        // Single click creation for FreeText
        onAddAnnotation({
          id: `freetext_${Date.now()}`,
          pageIndex: activePageIndex,
          type: "freetext",
          rect: { x: dragStart.x, y: dragStart.y, width: 150, height: 30 },
          color:
            editorState.freetextStyle?.color ||
            ANNOTATION_STYLES.freetext.color,
          size:
            editorState.freetextStyle?.size || ANNOTATION_STYLES.freetext.size,
          text: "New Freetext",
        });

        if (
          !editorState.keys.shift &&
          !editorState.keys.ctrl &&
          shouldSwitchToSelectAfterUse("draw_freetext")
        ) {
          onToolChange("select");
        }
      }
    }

    clearActiveInteractionState();
  };

  const handleFieldPointerDown = useCallback(
    (e: React.PointerEvent, field: FormField) => {
      const state = editorStateRef.current;
      if (pinchGestureActiveRef.current) return;
      if (e.button === 1) return;
      if (isPanModeActive) return;

      // If we are in Annotation mode, we allow selection but prevent drag logic.
      // Instead we likely want to fill them out.
      if (state.mode === "annotation") {
        e.stopPropagation();
        onSelectControl(field.id); // Sync selection with sidebar
        return;
      }

      // If not using Select tool, we might be trying to draw a new field ON TOP of this one.
      // In that case, we want the event to bubble up to the workspace to trigger 'handleMouseDown'.
      if (state.tool !== "select") return;

      e.stopPropagation();
      e.preventDefault();

      // Ensure mouse position is tracked immediately
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };

      // Capture pointer
      capturePointer(e);

      onTriggerHistorySave();

      // Set Global Cursor
      setGlobalCursor("move");

      let targetFieldId = field.id;
      const targetFieldRect = field.rect;
      const targetPageIndex = field.pageIndex;

      // Check for Duplicate shortcut (Ctrl/Meta + Drag)
      if (e.ctrlKey || e.metaKey) {
        const newId = `field_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        // If Radio, keep name to maintain group. For others, increment suffix number or append _1
        let newName = field.name;
        if (field.type !== FieldType.RADIO) {
          const match = field.name.match(/^(.*)_(\d+)$/);
          if (match) {
            const prefix = match[1];
            const num = parseInt(match[2], 10);
            newName = `${prefix}_${num + 1}`;
          } else {
            newName = `${field.name}_1`;
          }
        }

        const newField: FormField = {
          ...field,
          id: newId,
          name: newName,
          // Fix: If duplicating a Radio button in the same group, ensure it starts unchecked
          // and not default checked to preserve single-selection logic.
          isChecked: field.type === FieldType.RADIO ? false : field.isChecked,
          isDefaultChecked:
            field.type === FieldType.RADIO ? false : field.isDefaultChecked,
        };

        // Add the new field
        onAddField(newField);

        // Target the new field for the drag operation
        targetFieldId = newId;
        // Rect and Page are same as original
      }

      onSelectControl(targetFieldId);
      setActivePageIndex(targetPageIndex);
      const coords = getRelativeCoords(e, targetPageIndex);

      setMovingFieldId(targetFieldId);
      setMoveOffset({
        x: coords.x - targetFieldRect.x,
        y: coords.y - targetFieldRect.y,
      });
      setMoveStartRaw({
        x: coords.x,
        y: coords.y,
        originalRect: { ...targetFieldRect },
      });
    },
    [
      capturePointer,
      onTriggerHistorySave,
      onSelectControl,
      onAddField,
      getRelativeCoords,
      isPanModeActive,
    ],
  );

  const handleAnnotationPointerDown = useCallback(
    (e: React.PointerEvent, annotation: Annotation) => {
      const state = editorStateRef.current;
      if (pinchGestureActiveRef.current) return;
      if (e.button === 1) return;
      if (isPanModeActive) return;

      // Don't swallow event if erasing
      if (state.tool === "eraser") return;
      e.stopPropagation();
      e.preventDefault();
      if (state.tool !== "select") return;

      // Ensure mouse position is tracked immediately
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };

      // Capture pointer
      capturePointer(e);

      onTriggerHistorySave();
      onSelectControl(annotation.id);
      // App handles clearing the selectedId when needed.

      setActivePageIndex(annotation.pageIndex);
      const coords = getRelativeCoords(e, annotation.pageIndex);

      // Setup Move (Disable for Highlight to match Pen behavior)
      if (annotation.rect && annotation.type !== "highlight") {
        setGlobalCursor("move");
        setMovingAnnotationId(annotation.id);
        const rotationDeg =
          annotation.type === "freetext" &&
          typeof annotation.rotationDeg === "number" &&
          Number.isFinite(annotation.rotationDeg)
            ? annotation.rotationDeg
            : 0;
        const outerRect =
          annotation.type === "freetext" && rotationDeg !== 0
            ? getRotatedFreetextOuterRect(annotation.rect, rotationDeg)
            : annotation.rect;
        setMoveOffset({ x: coords.x - outerRect.x, y: coords.y - outerRect.y });
      }
    },
    [
      capturePointer,
      onTriggerHistorySave,
      onSelectControl,
      getRelativeCoords,
      isPanModeActive,
      getRotatedFreetextOuterRect,
    ],
  );

  const handleResizePointerDown = useCallback(
    (handle: string, e: React.PointerEvent, data: FormField | Annotation) => {
      const state = editorStateRef.current;
      if (pinchGestureActiveRef.current) return;
      if (e.button === 1) return;
      if (isPanModeActive) return;
      e.stopPropagation();

      // Ensure mouse position is tracked immediately
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };

      // Capture pointer to ensure events track even over scrollbars/outside window
      capturePointer(e);

      if (state.tool !== "select") return;

      onTriggerHistorySave();
      setActivePageIndex(data.pageIndex);
      const coords = getRelativeCoords(e, data.pageIndex);

      if (
        ["freetext", "ink", "highlight", "comment", "link"].includes(data.type)
      ) {
        setResizingAnnotationId(data.id);
      } else {
        setResizingFieldId(data.id);
      }

      setResizeHandle(handle);
      if (data.rect) {
        const base = {
          originalRect: { ...data.rect },
          mouseX: coords.x,
          mouseY: coords.y,
        };

        if (handle === "rotate" && data.type === "freetext") {
          const pivot = {
            x: data.rect.x + data.rect.width / 2,
            y: data.rect.y + data.rect.height / 2,
          };
          const startAngleRad = Math.atan2(
            coords.y - pivot.y,
            coords.x - pivot.x,
          );
          setResizeStart({
            ...base,
            originalRotationDeg:
              typeof data.rotationDeg === "number" ? data.rotationDeg : 0,
            rotateStartAngleRad: startAngleRad,
            rotatePivot: pivot,
          });
        } else {
          setResizeStart(base);
        }
      }

      // Set Global Cursor based on handle
      let cursor = "default";
      if (["nw", "se"].includes(handle)) cursor = "nwse-resize";
      else if (["ne", "sw"].includes(handle)) cursor = "nesw-resize";
      else if (["n", "s"].includes(handle)) cursor = "ns-resize";
      else if (["e", "w"].includes(handle)) cursor = "ew-resize";
      else if (handle === "rotate") cursor = "grab";

      setGlobalCursor(cursor);
    },
    [capturePointer, onTriggerHistorySave, getRelativeCoords, isPanModeActive],
  );

  // --- Render Helpers ---

  const renderPage = (page: (typeof pagesWithControls)[number]) => (
    <div
      id={`page-${page.pageIndex}`}
      className="relative w-fit flex-none origin-top bg-white shadow-lg transition-shadow hover:shadow-xl"
      data-ff-text-selecting={
        textSelectingPages[page.pageIndex] ? "1" : undefined
      }
      style={{
        cursor: editorState.tool === "draw_highlight" ? "crosshair" : undefined,
      }}
      onPointerDown={(e) => handlePointerDown(e, page.pageIndex)}
    >
      <PDFPage
        page={page}
        scale={editorState.scale}
        isSelectMode={
          editorState.tool === "select" || editorState.tool === "draw_highlight"
        }
        isHighlighting={editorState.tool === "draw_highlight"}
        highlightColor={
          editorState.highlightStyle?.color || ANNOTATION_STYLES.highlight.color
        }
        highlightOpacity={
          editorState.highlightStyle?.opacity ??
          ANNOTATION_STYLES.highlight.opacity
        }
        textLayerCursor={
          editorState.tool === "draw_highlight" ? "crosshair" : undefined
        }
        searchResults={pdfSearchResultsByPage?.get(page.pageIndex) ?? []}
        activeSearchResultId={activePdfSearchResultId}
      />

      {editorState.pageTranslateOptions.useParagraphs &&
        (paragraphCandidatesByPage.get(page.pageIndex)?.length ?? 0) > 0 && (
          <svg
            className="absolute inset-0 z-10"
            viewBox={`0 0 ${page.width} ${page.height}`}
            preserveAspectRatio="none"
            style={{ pointerEvents: isSelectable ? "auto" : "none" }}
            onPointerDown={(e) => {
              if (!isSelectable) return;
              if (e.target !== e.currentTarget) return;
              e.stopPropagation();
              onSelectControl(null);
              onClearPageTranslateParagraphSelection?.();
            }}
          >
            {(paragraphCandidatesByPage.get(page.pageIndex) ?? []).map((c) => {
              const isSelected = selectedParagraphIds.has(c.id);
              const stroke = c.isExcluded ? "#9ca3af" : "#a855f7";
              const fill = isSelected
                ? c.isExcluded
                  ? "rgba(156, 163, 175, 0.18)"
                  : "rgba(168, 85, 247, 0.18)"
                : "transparent";

              const rotationDeg =
                typeof c.rotationDeg === "number" &&
                Number.isFinite(c.rotationDeg)
                  ? c.rotationDeg
                  : 0;

              if (rotationDeg !== 0) {
                const ir = c.innerRect;
                const inner =
                  ir && Number.isFinite(ir.width) && Number.isFinite(ir.height)
                    ? { width: ir.width, height: ir.height }
                    : getInnerSizeFromOuterAabb(c.rect, rotationDeg);
                const cx =
                  ir && Number.isFinite(ir.x) && Number.isFinite(ir.width)
                    ? ir.x + ir.width / 2
                    : c.rect.x + c.rect.width / 2;
                const cy =
                  ir && Number.isFinite(ir.y) && Number.isFinite(ir.height)
                    ? ir.y + ir.height / 2
                    : c.rect.y + c.rect.height / 2;

                return (
                  <g key={c.id}>
                    <rect
                      x={c.rect.x}
                      y={c.rect.y}
                      width={c.rect.width}
                      height={c.rect.height}
                      fill="transparent"
                      stroke="transparent"
                      vectorEffect="non-scaling-stroke"
                      onPointerDown={(e) => {
                        if (!isSelectable) return;
                        e.stopPropagation();
                        e.preventDefault();
                        onSelectControl(null);
                        onSelectPageTranslateParagraphId?.(c.id, {
                          additive: e.ctrlKey || e.metaKey || e.shiftKey,
                        });
                      }}
                    />
                    <rect
                      x={cx - inner.width / 2}
                      y={cy - inner.height / 2}
                      width={inner.width}
                      height={inner.height}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={isSelected ? 2 : 1}
                      strokeDasharray={c.isExcluded ? "4 2" : undefined}
                      vectorEffect="non-scaling-stroke"
                      transform={`rotate(${rotationDeg}, ${cx}, ${cy})`}
                      style={{ pointerEvents: "none" }}
                    />
                  </g>
                );
              }

              return (
                <rect
                  key={c.id}
                  x={c.rect.x}
                  y={c.rect.y}
                  width={c.rect.width}
                  height={c.rect.height}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={isSelected ? 2 : 1}
                  strokeDasharray={c.isExcluded ? "4 2" : undefined}
                  vectorEffect="non-scaling-stroke"
                  onPointerDown={(e) => {
                    if (!isSelectable) return;
                    e.stopPropagation();
                    e.preventDefault();
                    onSelectControl(null);
                    onSelectPageTranslateParagraphId?.(c.id, {
                      additive: e.ctrlKey || e.metaKey || e.shiftKey,
                    });
                  }}
                />
              );
            })}
          </svg>
        )}

      <div
        className={cn("absolute inset-0 scheme-light")}
        style={{
          cursor: isPanModeActive ? "grab" : getCursor(editorState.tool),
          pointerEvents: isPanModeActive
            ? "auto"
            : editorState.tool === "select" ||
                editorState.tool === "draw_highlight"
              ? "none"
              : undefined,
        }}
        onPointerDown={(e) => handlePointerDown(e, page.pageIndex)}
      >
        {page.pageFields.map((field) => (
          <ControlRenderer
            key={field.id}
            data={field}
            id={field.id}
            isSelected={editorState.selectedId === field.id}
            isAnnotationMode={editorState.mode === "annotation"}
            isFormMode={editorState.mode === "form"}
            isSelectable={isSelectable}
            onControlPointerDown={handleFieldPointerDown}
            onSelect={onSelectControl}
            onUpdate={onUpdateField}
            onControlResizeStart={handleResizePointerDown}
          />
        ))}
        {page.pageAnnotations.map((annot) => {
          const allowSelect = annot.type !== "link";

          return (
            <ControlRenderer
              key={annot.id}
              data={annot}
              id={annot.id}
              isSelected={editorState.selectedId === annot.id}
              isAnnotationMode={editorState.mode === "annotation"}
              isFormMode={editorState.mode === "form"}
              isSelectable={isSelectable}
              onControlPointerDown={
                allowSelect ? handleAnnotationPointerDown : undefined
              }
              onSelect={onSelectControl}
              onUpdate={onUpdateAnnotation}
              onDelete={onDeleteAnnotation}
              onEdit={onEditAnnotation}
              onAskAi={() => {
                handleAskAiFromAnnotation(annot);
              }}
              onControlResizeStart={handleResizePointerDown}
            />
          );
        })}

        {dragStart && dragCurrent && activePageIndex === page.pageIndex && (
          <div
            className={cn(
              "pointer-events-none absolute border-2",
              editorState.mode === "form"
                ? "border-blue-500 bg-blue-500/20"
                : "border-yellow-500 bg-yellow-500/20",
            )}
            style={{
              left: Math.min(dragStart.x, dragCurrent.x) * editorState.scale,
              top: Math.min(dragStart.y, dragCurrent.y) * editorState.scale,
              width: Math.abs(dragCurrent.x - dragStart.x) * editorState.scale,
              height: Math.abs(dragCurrent.y - dragStart.y) * editorState.scale,
            }}
          />
        )}
      </div>

      <svg
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        viewBox={`0 0 ${page.width} ${page.height}`}
        preserveAspectRatio="none"
      >
        {isDrawing && activePageIndex === page.pageIndex && (
          <path
            ref={liveInkPathRef}
            d={pointsToPathLib(currentPathRef.current)}
            stroke={
              editorState.tool === "draw_highlight"
                ? editorState.highlightStyle?.color ||
                  ANNOTATION_STYLES.highlight.color
                : editorState.penStyle.color
            }
            strokeWidth={
              editorState.tool === "draw_highlight"
                ? editorState.highlightStyle?.thickness ||
                  ANNOTATION_STYLES.highlight.thickness
                : editorState.penStyle.thickness
            }
            fill="none"
            strokeLinecap={
              editorState.tool === "draw_highlight" ? "butt" : "round"
            }
            strokeLinejoin="round"
            opacity={
              editorState.tool === "draw_highlight"
                ? (editorState.highlightStyle?.opacity ??
                  ANNOTATION_STYLES.highlight.opacity)
                : editorState.penStyle.opacity
            }
          />
        )}
      </svg>

      {activePageIndex === page.pageIndex && snapLines.length > 0 && (
        <div className="pointer-events-none absolute inset-0 z-50">
          {snapLines.map((line, idx) => (
            <div
              key={idx}
              className="absolute border-dashed border-red-500 opacity-70"
              style={{
                borderWidth: 0,
                [line.type === "vertical"
                  ? "borderLeftWidth"
                  : "borderTopWidth"]: "1px",
                left:
                  line.type === "vertical" ? line.pos * editorState.scale : 0,
                top:
                  line.type === "horizontal" ? line.pos * editorState.scale : 0,
                width: line.type === "vertical" ? "1px" : "100%",
                height: line.type === "horizontal" ? "1px" : "100%",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div
      ref={containerRef}
      data-workspace-scroll-container="true"
      className="relative flex-1 overflow-auto bg-gray-100 transition-colors duration-200 dark:bg-gray-900"
      style={{
        cursor: isPanModeActive ? "grab" : undefined,
        touchAction: "none",
        scrollPaddingBottom: workspaceBottomPaddingPx,
        "--scale": editorState.scale,
      }}
      onPointerDown={handleContainerPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerUp}
      data-ff-pinch-zooming={isPinchZooming ? "1" : undefined}
      onScroll={handleScroll}
    >
      <WorkspaceTextSelectionPopover
        toolbar={textSelectionToolbar}
        virtualRef={textSelectionVirtualRef}
        onClose={closeTextSelectionPopover}
        onHighlight={() => {
          createTextHighlightFromSelection({ force: true });
          closeTextSelectionPopover();
        }}
        onTranslate={() => {
          const text = textSelectionToolbar.text.trim();
          if (!text) return;
          appEventBus.emit("workspace:openTranslate", {
            sourceText: text,
            autoTranslate: true,
          });
          closeTextSelectionPopover();
        }}
        onAskAi={handleAskAiFromSelection}
        onSearchWeb={() => {
          const q = textSelectionToolbar.text.trim();
          if (q) {
            const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
            if (isTauri()) {
              openUrl(url);
            } else {
              window.open(url, "_blank", "noopener,noreferrer");
            }
          }
          closeTextSelectionPopover();
        }}
      />
      {workspaceZoomJankDebugEnabled && (
        <Suspense fallback={null}>
          <WorkspaceZoomJankOverlay scale={editorState.scale} />
        </Suspense>
      )}

      {shouldVirtualizePages ? (
        <div className="flex min-h-full min-w-full">
          <div
            ref={contentRef}
            // IMPORTANT: `shrink-0` ensures scrollWidth/scrollHeight reflect the
            // computed content size (otherwise flex can shrink the content and the
            // scrollbar cannot reach the end).
            className="relative m-auto shrink-0"
            style={{
              width: `${pageLayoutRects.contentWidthPx}px`,
              height: `${pageLayoutRects.contentHeightPx}px`,
            }}
          >
            <VirtualizedPages
              enabled={shouldVirtualizePages}
              containerRef={containerRef}
              axis={virtualAxis}
              overscan={WORKSPACE_VIRTUALIZATION_OVERSCAN_PAGES}
              pinIndex={
                typeof activePageIndex === "number"
                  ? (pageIndexToItemIndex.get(activePageIndex) ?? null)
                  : null
              }
              items={pagesWithControls}
              rects={pageLayoutRects.virtualRects}
              getKey={(p) => p.pageIndex}
              renderItem={(page) => renderPage(page)}
              layoutEpoch={Math.round(editorState.scale * 1000)}
            />
          </div>
        </div>
      ) : (
        <div
          ref={contentRef}
          className={cn(
            "mx-auto grid min-h-full w-fit place-content-center p-8",
            editorState.pageFlow === "horizontal"
              ? "content-center items-center justify-items-center"
              : "items-start justify-items-center",
          )}
          style={{
            ...contentLayoutStyle,
            paddingBottom: workspaceBottomPaddingPx,
          }}
        >
          {pagesWithControls.map((page) => {
            const placement = pagePlacementByIndex.get(page.pageIndex);
            const isDoubleLayout = editorState.pageLayout !== "single";

            if (!placement || !isDoubleLayout) {
              const fallbackIdx = pagesWithControls.findIndex(
                (p) => p.pageIndex === page.pageIndex,
              );
              const spreadIndex = Math.max(0, fallbackIdx);
              return (
                <div
                  key={page.pageIndex}
                  style={
                    editorState.pageFlow === "horizontal"
                      ? {
                          gridColumnStart: spreadIndex + 1,
                          gridRowStart: 1,
                        }
                      : {
                          gridRowStart: spreadIndex + 1,
                          gridColumnStart: 1,
                        }
                  }
                >
                  {renderPage(page)}
                </div>
              );
            }

            if (editorState.pageFlow === "horizontal") {
              return (
                <div
                  key={page.pageIndex}
                  style={
                    placement.isSingleInSpread
                      ? {
                          gridColumnStart: placement.spreadIndex + 1,
                          gridRow: "1 / span 2",
                          alignSelf: "center",
                          justifySelf: "center",
                        }
                      : {
                          gridColumnStart: placement.spreadIndex + 1,
                          gridRowStart: placement.posInSpread + 1,
                          justifySelf: "start",
                          alignSelf:
                            placement.posInSpread === 0 ? "end" : "start",
                        }
                  }
                >
                  {renderPage(page)}
                </div>
              );
            }

            return (
              <div
                key={page.pageIndex}
                style={
                  placement.isSingleInSpread
                    ? {
                        gridRowStart: placement.spreadIndex + 1,
                        gridColumn: "1 / span 2",
                        justifySelf: "center",
                        alignSelf: "start",
                      }
                    : {
                        gridRowStart: placement.spreadIndex + 1,
                        gridColumnStart: placement.posInSpread + 1,
                        justifySelf:
                          placement.posInSpread === 0 ? "end" : "start",
                        alignSelf: "start",
                      }
                }
              >
                {renderPage(page)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default React.memo(Workspace);
