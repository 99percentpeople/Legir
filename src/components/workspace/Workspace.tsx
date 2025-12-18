import React, {
  useRef,
  useState,
  useLayoutEffect,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { EditorState, FormField, FieldType, Annotation, Tool } from "@/types";
import { DEFAULT_FIELD_STYLE, ANNOTATION_STYLES, ZOOM_BASE } from "@/constants";
import { cn, setGlobalCursor, resetGlobalCursor } from "@/lib/utils";
import { usePointerCapture } from "@/hooks/usePointerCapture";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { useCanvasPanning } from "@/hooks/useCanvasPanning";
import { useInkSession } from "@/hooks/useInkSession";
import { useLanguage } from "../language-provider";
import { getCursor, shouldSwitchToSelectAfterUse } from "@/lib/tool-behavior";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Highlighter, Search } from "lucide-react";
import PDFPageWithProxy from "./PDFPageWithProxy";
import { ControlRenderer } from "./controls";

interface WorkspaceProps {
  editorState: EditorState;
  onAddField: (field: FormField) => void;
  onAddAnnotation: (annotation: Annotation) => void;
  onSelectControl: (id: string | null) => void;
  onUpdateField: (id: string, updates: Partial<FormField>) => void;
  onUpdateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  onDeleteAnnotation: (id: string) => void;
  onEditAnnotation: (id: string) => void;
  onScaleChange: (newScale: number) => void;
  onTriggerHistorySave: () => void;
  onPageIndexChange?: (index: number) => void;
  onToolChange: (tool: Tool) => void;
  fitTrigger?: number;
}

interface SnapLine {
  type: "vertical" | "horizontal";
  pos: number; // x or y coordinate
  start: number;
  end: number;
}

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
  fitTrigger,
}) => {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

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

  // Keep a ref to editorState for stable event handlers
  const editorStateRef = useRef(editorState);
  editorStateRef.current = editorState;

  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [dragCurrent, setDragCurrent] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [activePageIndex, setActivePageIndex] = useState<number | null>(null);

  // Ink specific state
  const [isDrawing, setIsDrawing] = useState(false);
  const [isErasing, setIsErasing] = useState(false);
  const currentPathRef = useRef<{ x: number; y: number }[]>([]);
  const [currentPathState, setCurrentPathState] = useState<
    { x: number; y: number }[]
  >([]); // For forcing re-render of current line

  const cancelInProgressInkStroke = useCallback(() => {
    setIsDrawing(false);
    currentPathRef.current = [];
    setCurrentPathState([]);
  }, []);

  const { appendStroke: appendInkStroke } = useInkSession({
    editorState,
    editorStateRef,
    onAddAnnotation,
    onUpdateAnnotation,
    onSelectControl,
    onCancelInProgressStroke: cancelInProgressInkStroke,
    onTriggerHistorySave,
  });

  const createTextHighlightFromSelection = useCallback(
    (opts?: { force?: boolean }) => {
      const state = editorStateRef.current;
      if (state.mode !== "annotation") return;
      if (!opts?.force && state.tool !== "draw_highlight") return;

      const sel = window.getSelection?.();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;

      const selectedText = sel.toString().trim();
      if (!selectedText) {
        sel.removeAllRanges();
        return;
      }

      const range = sel.getRangeAt(0);
      const commonNode = range.commonAncestorContainer;
      const commonEl =
        commonNode instanceof Element
          ? commonNode
          : commonNode.parentElement || null;

      const pageEl = commonEl?.closest?.("[id^='page-']") as HTMLElement | null;
      const textLayerEl = commonEl?.closest?.(
        ".textLayer",
      ) as HTMLElement | null;

      // Only create highlights from the actual PDF text layer.
      if (!pageEl || !textLayerEl) return;

      textLayerEl.classList.remove("selecting");

      const rects = Array.from(range.getClientRects()).filter(
        (r) => r.width > 1 && r.height > 1,
      );
      if (rects.length === 0) {
        sel.removeAllRanges();
        return;
      }

      const pageId = pageEl.id;
      const pageIndexStr = pageId.replace(/^page-/, "");
      const pageIndex = Number.parseInt(pageIndexStr, 10);
      if (!Number.isFinite(pageIndex)) return;

      const scale = state.scale;
      const pageRect = pageEl.getBoundingClientRect();

      const uiRects = rects
        .map((r) => ({
          x: (r.left - pageRect.left) / scale,
          y: (r.top - pageRect.top) / scale,
          width: r.width / scale,
          height: r.height / scale,
        }))
        .filter((r) => r.width > 0.5 && r.height > 0.5);

      if (uiRects.length === 0) {
        sel.removeAllRanges();
        return;
      }

      const sorted = [...uiRects].sort((a, b) =>
        Math.abs(a.y - b.y) < 2 ? a.x - b.x : a.y - b.y,
      );

      const deduped: { x: number; y: number; width: number; height: number }[] =
        [];
      const isNearSame = (
        a: { x: number; y: number; width: number; height: number },
        b: { x: number; y: number; width: number; height: number },
      ) =>
        Math.abs(a.x - b.x) < 1 &&
        Math.abs(a.y - b.y) < 1 &&
        Math.abs(a.width - b.width) < 1 &&
        Math.abs(a.height - b.height) < 1;

      for (const r of sorted) {
        const exists = deduped.some((d) => isNearSame(d, r));
        if (!exists) deduped.push(r);
      }

      const merged: { x: number; y: number; width: number; height: number }[] =
        [];
      for (const r of deduped) {
        const last = merged[merged.length - 1];
        if (
          last &&
          Math.abs(last.y - r.y) < 2 &&
          Math.abs(last.height - r.height) < 2 &&
          r.x <= last.x + last.width + 2
        ) {
          const newX = Math.min(last.x, r.x);
          const newRight = Math.max(last.x + last.width, r.x + r.width);
          last.x = newX;
          last.width = newRight - newX;
          last.y = Math.min(last.y, r.y);
          last.height = Math.max(last.height, r.height);
        } else {
          merged.push({ ...r });
        }
      }

      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;

      for (const r of merged) {
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.width);
        maxY = Math.max(maxY, r.y + r.height);
      }

      if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
        sel.removeAllRanges();
        return;
      }

      onAddAnnotation({
        id: `highlight_${Date.now()}`,
        pageIndex,
        type: "highlight",
        rect: {
          x: minX,
          y: minY,
          width: Math.max(1, maxX - minX),
          height: Math.max(1, maxY - minY),
        },
        rects: merged,
        color: state.highlightStyle?.color || ANNOTATION_STYLES.highlight.color,
        opacity:
          state.highlightStyle?.opacity ?? ANNOTATION_STYLES.highlight.opacity,
      });

      // Text highlight should not be auto-selected; keep the tool ready for continuous highlighting.
      onSelectControl(null);

      sel.removeAllRanges();
    },
    [editorStateRef, onAddAnnotation, onSelectControl],
  );

  const [textSelectionToolbar, setTextSelectionToolbar] = useState<{
    isVisible: boolean;
    left: number;
    top: number;
    text: string;
  }>({ isVisible: false, left: 0, top: 0, text: "" });

  const textSelectionVirtualRef = useRef<any>({
    getBoundingClientRect: () => new DOMRect(),
    contextElement: document.body,
  });

  const isTextSelectingRef = useRef(false);

  const updateTextSelectionToolbar = useCallback(() => {
    if (editorState.tool !== "select" || editorState.mode !== "annotation") {
      setTextSelectionToolbar((prev) =>
        prev.isVisible ? { ...prev, isVisible: false } : prev,
      );
      return;
    }

    // Only show after selection ends (mouse/pointer released)
    if (isTextSelectingRef.current) {
      setTextSelectionToolbar((prev) =>
        prev.isVisible ? { ...prev, isVisible: false } : prev,
      );
      return;
    }

    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setTextSelectionToolbar((prev) =>
        prev.isVisible ? { ...prev, isVisible: false } : prev,
      );
      return;
    }

    const selectedText = sel.toString().trim();
    if (!selectedText) {
      setTextSelectionToolbar((prev) =>
        prev.isVisible ? { ...prev, isVisible: false } : prev,
      );
      return;
    }

    const range = sel.getRangeAt(0);
    const getClosestTextLayer = (node: Node | null) => {
      if (!node) return null;
      const el = node instanceof Element ? node : node.parentElement;
      return el?.closest?.(".textLayer") ?? null;
    };

    const startTextLayer = getClosestTextLayer(range.startContainer);
    const endTextLayer = getClosestTextLayer(range.endContainer);
    const isFromTextLayer = !!startTextLayer || !!endTextLayer;
    if (!isFromTextLayer) {
      setTextSelectionToolbar((prev) =>
        prev.isVisible ? { ...prev, isVisible: false } : prev,
      );
      return;
    }

    const clientRects = Array.from(range.getClientRects()).filter(
      (r) => r.width >= 2 && r.height >= 2,
    );
    const isBackward = (() => {
      const anchorNode = sel.anchorNode;
      const focusNode = sel.focusNode;
      if (!anchorNode || !focusNode) return false;
      const a = document.createRange();
      a.setStart(anchorNode, sel.anchorOffset);
      a.collapse(true);
      const f = document.createRange();
      f.setStart(focusNode, sel.focusOffset);
      f.collapse(true);
      return a.compareBoundaryPoints(Range.START_TO_START, f) === 1;
    })();

    const rect =
      (clientRects.length > 0
        ? isBackward
          ? clientRects[0]
          : clientRects[clientRects.length - 1]
        : null) ?? range.getBoundingClientRect();
    if (!rect || rect.width < 2 || rect.height < 2) {
      setTextSelectionToolbar((prev) =>
        prev.isVisible ? { ...prev, isVisible: false } : prev,
      );
      return;
    }

    let left = rect.left + rect.width / 2;
    let top = rect.top;

    // Clamp to viewport so it doesn't render off-screen.
    const pad = 12;
    left = Math.max(pad, Math.min(window.innerWidth - pad, left));
    top = Math.max(pad, top);

    textSelectionVirtualRef.current = {
      getBoundingClientRect: () => new DOMRect(left, top, 1, 1),
      contextElement: document.body,
    };

    setTextSelectionToolbar({ isVisible: true, left, top, text: selectedText });
  }, [editorState.mode, editorState.tool]);

  useEffect(() => {
    if (!textSelectionToolbar.isVisible) return;
    requestAnimationFrame(() => {
      updateTextSelectionToolbar();
    });
  }, [editorState.scale]);

  useEffect(() => {
    updateTextSelectionToolbar();

    const handleSelectionChange = () => updateTextSelectionToolbar();
    document.addEventListener("selectionchange", handleSelectionChange);
    window.addEventListener("resize", handleSelectionChange);

    const handlePointerDown = (e: PointerEvent) => {
      if (editorStateRef.current.tool !== "select") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.(".textLayer")) {
        isTextSelectingRef.current = true;
        setTextSelectionToolbar((prev) =>
          prev.isVisible ? { ...prev, isVisible: false } : prev,
        );
      }
    };

    const handlePointerUp = () => {
      if (!isTextSelectingRef.current) return;
      // Defer one frame so the browser has time to finalize the selection range.
      // Keep isTextSelectingRef=true during this frame to prevent selectionchange from
      // prematurely showing a toolbar with a transient (0,0) bounding rect.
      requestAnimationFrame(() => {
        isTextSelectingRef.current = false;
        updateTextSelectionToolbar();
      });
    };

    const handlePointerCancel = () => {
      if (!isTextSelectingRef.current) return;
      isTextSelectingRef.current = false;
      setTextSelectionToolbar((prev) =>
        prev.isVisible ? { ...prev, isVisible: false } : prev,
      );
    };

    // Use capture phase so we still detect selection start/end even if some layer stops propagation.
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointerup", handlePointerUp, true);
    document.addEventListener("pointercancel", handlePointerCancel, true);

    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      window.removeEventListener("resize", handleSelectionChange);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("pointerup", handlePointerUp, true);
      document.removeEventListener("pointercancel", handlePointerCancel, true);
    };
  }, [updateTextSelectionToolbar]);

  useEffect(() => {
    if (
      editorState.mode !== "annotation" ||
      editorState.tool !== "draw_highlight"
    ) {
      return;
    }

    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;

    // Only auto-convert selections that come from the PDF.js text layer.
    const range = sel.getRangeAt(0);
    const commonNode = range.commonAncestorContainer;
    const commonEl =
      commonNode instanceof Element
        ? commonNode
        : commonNode.parentElement || null;
    const isFromTextLayer = !!commonEl?.closest?.(".textLayer");
    if (!isFromTextLayer) return;

    createTextHighlightFromSelection();
  }, [editorState.mode, editorState.tool, createTextHighlightFromSelection]);

  const [movingFieldId, setMovingFieldId] = useState<string | null>(null);
  const [movingAnnotationId, setMovingAnnotationId] = useState<string | null>(
    null,
  );
  const [moveOffset, setMoveOffset] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [moveStartRaw, setMoveStartRaw] = useState<{
    x: number;
    y: number;
    originalRect: { x: number; y: number };
  } | null>(null);

  const [resizingFieldId, setResizingFieldId] = useState<string | null>(null);
  const [resizingAnnotationId, setResizingAnnotationId] = useState<
    string | null
  >(null);
  const [resizeStart, setResizeStart] = useState<{
    originalRect: { x: number; y: number; width: number; height: number };
    mouseX: number;
    mouseY: number;
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
    isDrawing ||
    isErasing ||
    movingFieldId ||
    movingAnnotationId ||
    resizingFieldId ||
    resizingAnnotationId
  );
  useAutoScroll(containerRef, { enabled: isInteracting });

  const [snapLines, setSnapLines] = useState<SnapLine[]>([]);

  const zoomAnchorRef = useRef<{
    targetX: number;
    targetY: number;
    mouseX: number;
    mouseY: number;
  } | null>(null);
  const prevScaleRef = useRef(editorState.scale);
  const scrollPosRef = useRef({ x: 0, y: 0 });
  const lastMousePosRef = useRef({ x: 0, y: 0 });

  // Track if any interactive operation is in progress
  // NOTE: Definition moved up to be used by useAutoScroll hook
  // const isInteracting = !!(dragStart || isDrawing || isErasing || movingFieldId || movingAnnotationId || resizingFieldId);

  // --- Register Controls ---
  // Controls are now registered in index.tsx, so we don't need to do it here.
  // But we keep this comment for reference.

  // --- Optimization: Pre-calculate grouped controls ---
  const pagesWithControls = useMemo(() => {
    return editorState.pages.map((page) => ({
      ...page,
      pageAnnotations: editorState.annotations.filter(
        (a) => a.pageIndex === page.pageIndex,
      ),
      pageFields: editorState.fields.filter(
        (f) => f.pageIndex === page.pageIndex,
      ),
    }));
  }, [editorState.pages, editorState.annotations, editorState.fields]);

  // --- Zoom Effect (Same as before) ---
  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    if (zoomAnchorRef.current) {
      const { targetX, targetY, mouseX, mouseY } = zoomAnchorRef.current;
      container.scrollLeft = targetX - mouseX;
      container.scrollTop = targetY - mouseY;
      zoomAnchorRef.current = null;
    } else if (prevScaleRef.current !== editorState.scale) {
      const oldScale = prevScaleRef.current;
      const newScale = editorState.scale;
      const scaleRatio = newScale / oldScale;
      const rect = container.getBoundingClientRect();
      const viewportW = rect.width;
      const viewportH = rect.height;
      const oldScrollLeft = scrollPosRef.current.x;
      const oldScrollTop = scrollPosRef.current.y;
      const centerX_old = oldScrollLeft + viewportW / 2;
      const centerY_old = oldScrollTop + viewportH / 2;
      const centerX_new = centerX_old * scaleRatio;
      const centerY_new = centerY_old * scaleRatio;
      container.scrollLeft = centerX_new - viewportW / 2;
      container.scrollTop = centerY_new - viewportH / 2;
    }
    prevScaleRef.current = editorState.scale;
    scrollPosRef.current = { x: container.scrollLeft, y: container.scrollTop };
  }, [editorState.scale]);

  // --- Wheel Zoom ---
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (isPanning) {
        e.preventDefault();
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const content = contentRef.current;
        if (!content) return;

        const currentScale = editorState.scale;
        const steps = -e.deltaY / 100;
        let newScale = currentScale * Math.pow(ZOOM_BASE, steps);
        newScale = Math.max(0.25, Math.min(5.0, newScale));
        newScale = Number(newScale.toFixed(3));

        if (Math.abs(newScale - currentScale) < 0.001) return;

        const containerRect = container.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();

        // Relative mouse position to the content box
        const relX = e.clientX - contentRect.left;
        const relY = e.clientY - contentRect.top;

        // Decompose Y coordinate into Fixed (padding/gap) and Scaled (pages) parts
        let accumulatedH = 32; // Top padding (p-8 = 32px)
        let fixedY = 32;
        let scaledY = 0;

        if (relY < 32) {
          // Mouse in top padding
          fixedY = relY;
          scaledY = 0;
        } else {
          let found = false;
          for (let i = 0; i < editorState.pages.length; i++) {
            const page = editorState.pages[i];
            const pageH = page.height * currentScale;

            // Check if mouse is on this page
            if (relY < accumulatedH + pageH) {
              scaledY += relY - accumulatedH;
              found = true;
              break;
            }
            accumulatedH += pageH;
            scaledY += pageH;

            // Check if mouse is in gap (only if not last page)
            if (i < editorState.pages.length - 1) {
              const gap = 32; // gap-8 = 32px
              if (relY < accumulatedH + gap) {
                fixedY += relY - accumulatedH;
                found = true;
                break;
              }
              accumulatedH += gap;
              fixedY += gap;
            }
          }
          if (!found) {
            // Mouse is below last page (bottom padding)
            fixedY += relY - accumulatedH;
          }
        }

        // Decompose X coordinate (Simple assumption of fixed side padding)
        let fixedX = 32; // p-8 = 32px
        let scaledX = 0;
        if (relX < 32) {
          fixedX = relX;
          scaledX = 0;
        } else {
          fixedX = 32;
          scaledX = relX - 32;
        }

        // Calculate predicted position at new scale
        const targetX = scaledX * (newScale / currentScale) + fixedX;
        const targetY = scaledY * (newScale / currentScale) + fixedY;

        const mouseX = e.clientX - containerRect.left;
        const mouseY = e.clientY - containerRect.top;

        zoomAnchorRef.current = { targetX, targetY, mouseX, mouseY };
        onScaleChange(newScale);
      }
    };
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [editorState.scale, onScaleChange, editorState.pages, isPanning]);

  const getRelativeCoordsFromPoint = useCallback(
    (clientX: number, clientY: number, pageIndex: number) => {
      const pageEl = document.getElementById(`page-${pageIndex}`);
      if (!pageEl) return { x: 0, y: 0 };
      const rect = pageEl.getBoundingClientRect();
      const scale = editorStateRef.current.scale;
      return {
        x: (clientX - rect.left) / scale,
        y: (clientY - rect.top) / scale,
      };
    },
    [],
  );

  const getRelativeCoords = useCallback(
    (e: React.MouseEvent | MouseEvent, pageIndex: number) => {
      // IMPORTANT: Get coords relative to the container wrapper using stable ID
      return getRelativeCoordsFromPoint(e.clientX, e.clientY, pageIndex);
    },
    [getRelativeCoordsFromPoint],
  );

  const dist2 = (p: { x: number; y: number }, v: { x: number; y: number }) => {
    return (p.x - v.x) * (p.x - v.x) + (p.y - v.y) * (p.y - v.y);
  };

  const distToSegmentSquared = (
    p: { x: number; y: number },
    v: { x: number; y: number },
    w: { x: number; y: number },
  ) => {
    const l2 = dist2(v, w);
    if (l2 === 0) return dist2(p, v);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return dist2(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
  };

  const checkEraserCollision = (x: number, y: number, pageIndex: number) => {
    // Threshold in unscaled units.
    // If we want 10px visual radius on screen, in unscaled coords it's 10 / scale.
    const VISUAL_RADIUS = 10;
    const threshold = VISUAL_RADIUS / editorState.scale;
    const thresholdSq = threshold * threshold;

    // Check annotations on this page
    const pageAnnotations = editorState.annotations.filter(
      (a) => a.pageIndex === pageIndex,
    );

    for (const annot of pageAnnotations) {
      // Ink Detection
      if (annot.type === "ink") {
        const strokes =
          annot.strokes && annot.strokes.length > 0
            ? annot.strokes
            : annot.points
              ? [annot.points]
              : [];

        for (const stroke of strokes) {
          for (let i = 0; i < stroke.length - 1; i++) {
            const p1 = stroke[i];
            const p2 = stroke[i + 1];
            const distSq = distToSegmentSquared({ x, y }, p1, p2);
            if (distSq < thresholdSq) {
              onDeleteAnnotation(annot.id);
              return; // Delete one at a time per move event to avoid conflicts
            }
          }
        }
      }
      // Box Detection (Highlight/Comment)
      else if (annot.rect) {
        const { x: rx, y: ry, width: rw, height: rh } = annot.rect;
        // Simple box overlap check with eraser point (expanded by radius)
        if (
          x >= rx - threshold &&
          x <= rx + rw + threshold &&
          y >= ry - threshold &&
          y <= ry + rh + threshold
        ) {
          onDeleteAnnotation(annot.id);
          return;
        }
      }
    }
  };

  // --- Snapping Helper (Form Mode Only) ---
  const applySnapping = (
    rect: any,
    pageIndex: number,
    excludeId: string | null,
    threshold: number,
  ) => {
    // (Snapping logic reuse from original - simplified for brevity here as it is unchanged logic)
    // Only run in form mode
    if (editorState.mode !== "form")
      return { x: rect.x, y: rect.y, guides: [] };

    const { snapToBorders, snapToCenter, snapToEqualDistances } =
      editorState.snappingOptions;
    const guides: SnapLine[] = [];
    let { x, y } = rect;
    const otherFields = editorState.fields.filter(
      (f) => f.pageIndex === pageIndex && f.id !== excludeId,
    );

    let bestDx = Infinity;
    let snapX = null;
    let guideX = null;
    const checkSnap = (diff: number, newPos: number, guidePos: number) => {
      if (Math.abs(diff) < Math.abs(bestDx) && Math.abs(diff) < threshold) {
        bestDx = diff;
        snapX = newPos;
        guideX = guidePos;
      }
    };

    otherFields.forEach((f) => {
      if (snapToBorders) {
        checkSnap(f.rect.x - x, f.rect.x, f.rect.x);
        checkSnap(
          f.rect.x + f.rect.width - x,
          f.rect.x + f.rect.width,
          f.rect.x + f.rect.width,
        );
        checkSnap(f.rect.x - (x + rect.width), f.rect.x - rect.width, f.rect.x);
        checkSnap(
          f.rect.x + f.rect.width - (x + rect.width),
          f.rect.x + f.rect.width - rect.width,
          f.rect.x + f.rect.width,
        );
      }
      if (snapToCenter) {
        const theirCenter = f.rect.x + f.rect.width / 2;
        const myCenter = x + rect.width / 2;
        checkSnap(
          theirCenter - myCenter,
          theirCenter - rect.width / 2,
          theirCenter,
        );
      }
    });

    // Equal Distances (Horizontal)
    if (snapToEqualDistances) {
      const sameRow = otherFields
        .filter(
          (f) =>
            Math.max(rect.y, f.rect.y) <
            Math.min(rect.y + rect.height, f.rect.y + f.rect.height),
        )
        .sort((a, b) => a.rect.x - b.rect.x);

      for (let i = 0; i < sameRow.length - 1; i++) {
        const A = sameRow[i].rect;
        const B = sameRow[i + 1].rect;
        const gap = B.x - (A.x + A.width);

        // 1. Snap to Right: A ... B ... [Me]
        const targetRight = B.x + B.width + gap;
        checkSnap(targetRight - x, targetRight, targetRight);

        // 2. Snap to Left: [Me] ... A ... B
        const targetLeft = A.x - gap - rect.width;
        checkSnap(targetLeft - x, targetLeft, targetLeft);

        // 3. Snap Between: A ... [Me] ... B
        const targetMid = (A.x + A.width + B.x - rect.width) / 2;
        checkSnap(targetMid - x, targetMid, targetMid);
      }
    }

    if (snapX !== null && guideX !== null) {
      x = snapX;
      guides.push({
        type: "vertical",
        pos: guideX as number,
        start: 0,
        end: 2000,
      });
    }

    let bestDy = Infinity;
    let snapY = null;
    let guideY = null;
    const checkSnapY = (diff: number, newPos: number, guidePos: number) => {
      if (Math.abs(diff) < Math.abs(bestDy) && Math.abs(diff) < threshold) {
        bestDy = diff;
        snapY = newPos;
        guideY = guidePos;
      }
    };
    otherFields.forEach((f) => {
      if (snapToBorders) {
        checkSnapY(f.rect.y - y, f.rect.y, f.rect.y);
        checkSnapY(
          f.rect.y + f.rect.height - y,
          f.rect.y + f.rect.height,
          f.rect.y + f.rect.height,
        );
        checkSnapY(
          f.rect.y - (y + rect.height),
          f.rect.y - rect.height,
          f.rect.y,
        );
        checkSnapY(
          f.rect.y + f.rect.height - (y + rect.height),
          f.rect.y + f.rect.height - rect.height,
          f.rect.y + f.rect.height,
        );
      }
      if (snapToCenter) {
        const theirCenter = f.rect.y + f.rect.height / 2;
        const myCenter = y + rect.height / 2;
        checkSnapY(
          theirCenter - myCenter,
          theirCenter - rect.height / 2,
          theirCenter,
        );
      }
    });

    // Equal Distances (Vertical)
    if (snapToEqualDistances) {
      const sameCol = otherFields
        .filter(
          (f) =>
            Math.max(rect.x, f.rect.x) <
            Math.min(rect.x + rect.width, f.rect.x + f.rect.width),
        )
        .sort((a, b) => a.rect.y - b.rect.y);

      for (let i = 0; i < sameCol.length - 1; i++) {
        const A = sameCol[i].rect;
        const B = sameCol[i + 1].rect;
        const gap = B.y - (A.y + A.height);

        // 1. Snap to Bottom: A
        //                    B
        //                   [Me]
        const targetBottom = B.y + B.height + gap;
        checkSnapY(targetBottom - y, targetBottom, targetBottom);

        // 2. Snap to Top:   [Me]
        //                    A
        //                    B
        const targetTop = A.y - gap - rect.height;
        checkSnapY(targetTop - y, targetTop, targetTop);

        // 3. Snap Between:   A
        //                   [Me]
        //                    B
        const targetMid = (A.y + A.height + B.y - rect.height) / 2;
        checkSnapY(targetMid - y, targetMid, targetMid);
      }
    }

    if (snapY !== null && guideY !== null) {
      y = snapY;
      guides.push({
        type: "horizontal",
        pos: guideY as number,
        start: 0,
        end: 2000,
      });
    }

    return { x, y, guides };
  };

  // --- Helper to find page index from mouse coordinates ---
  const getPageIndexFromPoint = (x: number, y: number) => {
    // Check current active page first for performance
    if (activePageIndex !== null) {
      const pageEl = document.getElementById(`page-${activePageIndex}`);
      if (pageEl) {
        const rect = pageEl.getBoundingClientRect();
        if (
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom
        ) {
          return activePageIndex;
        }
      }
    }

    // Check other pages
    for (let i = 0; i < editorState.pages.length; i++) {
      if (i === activePageIndex) continue;
      const pageEl = document.getElementById(`page-${i}`);
      if (pageEl) {
        const rect = pageEl.getBoundingClientRect();
        if (
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom
        ) {
          return i;
        }
      }
    }
    return null;
  };

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

      let newX = currentCoords.x - moveOffset.x;
      let newY = currentCoords.y - moveOffset.y;

      onUpdateAnnotation(movingAnnotationId, {
        rect: { ...annot.rect, x: newX, y: newY },
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
        if (Math.abs(totalDx) > Math.abs(totalDy))
          newY = moveStartRaw.originalRect.y;
        else newX = moveStartRaw.originalRect.x;
      }

      const { enabled, threshold: baseThreshold } = editorState.snappingOptions;
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
    const { enabled, threshold: baseThreshold } = editorState.snappingOptions;
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
    const container = containerRef.current;
    if (container) {
      scrollPosRef.current = {
        x: container.scrollLeft,
        y: container.scrollTop,
      };

      if (textSelectionToolbar.isVisible) {
        updateTextSelectionToolbar();
      }

      if (onPageIndexChange) {
        const scrollTop = container.scrollTop;
        const viewportHeight = container.clientHeight;
        const middleY = scrollTop + viewportHeight / 2;

        let currentY = 32;
        const gap = 32;
        const scale = editorState.scale;
        let found = false;

        for (let i = 0; i < editorState.pages.length; i++) {
          const page = editorState.pages[i];
          const pageHeight = page.height * scale;

          if (middleY >= currentY && middleY <= currentY + pageHeight) {
            onPageIndexChange(i);
            found = true;
            break;
          }

          if (
            middleY > currentY + pageHeight &&
            middleY < currentY + pageHeight + gap
          ) {
            if (middleY < currentY + pageHeight + gap / 2) {
              onPageIndexChange(i);
              found = true;
              break;
            }
          }

          currentY += pageHeight + gap;
        }

        if (!found && editorState.pages.length > 0 && middleY >= currentY) {
          onPageIndexChange(editorState.pages.length - 1);
        }
      }

      if (isInteracting) {
        if (movingFieldId) {
          updateMovingField(
            lastMousePosRef.current.x,
            lastMousePosRef.current.y,
          );
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
    }
  };

  // --- Handlers ---
  const handleContainerPointerDown = (e: React.PointerEvent) => {
    if (startPan(e)) return;
  };

  const handlePointerDown = (e: React.PointerEvent, pageIndex: number) => {
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
      setCurrentPathState([coords]);
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
        const dist = Math.hypot(coords.x - lastPoint.x, coords.y - lastPoint.y);
        // Ignore points that are too close to reduce noise and improve performance
        if (dist < 4) return;
      }

      currentPathRef.current.push(coords);
      // Optimization: Throttle state updates? For now, raw update
      setCurrentPathState([...currentPathRef.current]);
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
          const dist = Math.hypot(
            coords.x - lastPoint.x,
            coords.y - lastPoint.y,
          );
          if (dist > 1) {
            currentPathRef.current.push(coords);
          }
        }
      }

      setIsDrawing(false);
      if (currentPathRef.current.length > 1) {
        appendInkStroke(activePageIndex, currentPathRef.current);
      }
      currentPathRef.current = [];
      setCurrentPathState([]);
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

    setDragStart(null);
    setDragCurrent(null);
    setActivePageIndex(null);
    setMovingFieldId(null);
    setMoveStartRaw(null);
    setMovingAnnotationId(null);
    setResizingFieldId(null);
    setResizingAnnotationId(null);
    setResizeStart(null);
    setResizeHandle(null);
    setSnapLines([]);
    setIsDrawing(false);
    setIsErasing(false);
  };

  const handleFieldPointerDown = useCallback(
    (e: React.PointerEvent, field: FormField) => {
      const state = editorStateRef.current;
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
      let targetFieldRect = field.rect;
      let targetPageIndex = field.pageIndex;

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
        setMoveOffset({
          x: coords.x - annotation.rect.x,
          y: coords.y - annotation.rect.y,
        });
      }
    },
    [
      capturePointer,
      onTriggerHistorySave,
      onSelectControl,
      getRelativeCoords,
      isPanModeActive,
    ],
  );

  const handleResizePointerDown = useCallback(
    (handle: string, e: React.PointerEvent, data: FormField | Annotation) => {
      const state = editorStateRef.current;
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

      if (["freetext", "ink", "highlight", "comment"].includes(data.type)) {
        setResizingAnnotationId(data.id);
      } else {
        setResizingFieldId(data.id);
      }

      setResizeHandle(handle);
      if (data.rect) {
        setResizeStart({
          originalRect: { ...data.rect },
          mouseX: coords.x,
          mouseY: coords.y,
        });
      }

      // Set Global Cursor based on handle
      let cursor = "default";
      if (["nw", "se"].includes(handle)) cursor = "nwse-resize";
      else if (["ne", "sw"].includes(handle)) cursor = "nesw-resize";
      else if (["n", "s"].includes(handle)) cursor = "ns-resize";
      else if (["e", "w"].includes(handle)) cursor = "ew-resize";

      setGlobalCursor(cursor);
    },
    [capturePointer, onTriggerHistorySave, getRelativeCoords, isPanModeActive],
  );

  // --- Scroll to Center on Document Load, Page Count Change, or Fit Trigger ---
  useEffect(() => {
    if (
      containerRef.current &&
      contentRef.current &&
      editorState.pages.length > 0
    ) {
      const container = containerRef.current;
      const content = contentRef.current;

      // Wait for layout to settle (especially for different page widths)
      // We use requestAnimationFrame to ensure we calculate after render
      // Adding a small timeout to ensure all child components have updated their dimensions
      requestAnimationFrame(() => {
        const scrollLeft = (content.scrollWidth - container.clientWidth) / 2;
        if (scrollLeft > 0) {
          container.scrollLeft = scrollLeft;
        }
      });
    }
  }, [editorState.pdfDocument, editorState.pages.length, fitTrigger]);

  // --- Render Helpers ---

  // Convert points array to SVG path
  const pointsToPath = (points: { x: number; y: number }[]) => {
    if (points.length === 0) return "";
    if (points.length < 2) return `M ${points[0].x} ${points[0].y}`;

    let d = `M ${points[0].x} ${points[0].y}`;

    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i];
      const nextP = points[i + 1];
      const midX = (p.x + nextP.x) / 2;
      const midY = (p.y + nextP.y) / 2;
      d += ` Q ${p.x} ${p.y}, ${midX} ${midY}`;
    }

    const lastP = points[points.length - 1];
    d += ` L ${lastP.x} ${lastP.y}`;

    return d;
  };

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-auto bg-gray-100 transition-colors duration-200 dark:bg-gray-900"
      style={{
        cursor: isPanModeActive ? "grab" : undefined,
      }}
      onPointerDown={handleContainerPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onScroll={handleScroll}
    >
      <Popover
        open={textSelectionToolbar.isVisible}
        onOpenChange={(open) => {
          if (open) return;
          window.getSelection?.()?.removeAllRanges?.();
          setTextSelectionToolbar((prev) =>
            prev.isVisible ? { ...prev, isVisible: false } : prev,
          );
        }}
      >
        <PopoverAnchor virtualRef={textSelectionVirtualRef} />

        <PopoverTrigger asChild>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="pointer-events-none fixed z-60 h-px w-px opacity-0"
            style={{
              left: textSelectionToolbar.left,
              top: textSelectionToolbar.top,
            }}
          />
        </PopoverTrigger>

        <PopoverContent
          side="top"
          align="center"
          sideOffset={8}
          className="z-60 w-auto rounded-md border p-1 shadow-md"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
        >
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title={t("toolbar.highlight")}
              onClick={() => {
                createTextHighlightFromSelection({ force: true });
                setTextSelectionToolbar((prev) =>
                  prev.isVisible ? { ...prev, isVisible: false } : prev,
                );
              }}
            >
              <Highlighter size={16} />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title={t("toolbar.search_web", {
                text: textSelectionToolbar.text.trim(),
              })}
              onClick={() => {
                const q = textSelectionToolbar.text.trim();
                if (q) {
                  window.open(
                    `https://www.google.com/search?q=${encodeURIComponent(q)}`,
                    "_blank",
                    "noopener,noreferrer",
                  );
                }
                window.getSelection?.()?.removeAllRanges?.();
                setTextSelectionToolbar((prev) =>
                  prev.isVisible ? { ...prev, isVisible: false } : prev,
                );
              }}
            >
              <Search size={16} />
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <div
        ref={contentRef}
        className="mx-auto flex min-h-full w-fit flex-col items-center gap-8 p-8 pb-20"
      >
        {pagesWithControls.map((page) => (
          <div
            id={`page-${page.pageIndex}`}
            key={page.pageIndex}
            className="relative origin-top bg-white shadow-lg transition-shadow hover:shadow-xl"
            style={{
              cursor:
                editorState.tool === "draw_highlight" ? "crosshair" : undefined,
            }}
            onPointerDown={(e) => handlePointerDown(e, page.pageIndex)}
          >
            {/* 
                Lazy Loaded PDF Page Rendering 
                Note: Container size is now controlled by PDFPage but we wrap it here for annotations layer relative positioning
            */}
            <PDFPageWithProxy
              pageIndex={page.pageIndex}
              scale={editorState.scale}
              width={page.width}
              height={page.height}
              placeholderImage={page.imageData}
              isSelectMode={
                editorState.tool === "select" ||
                editorState.tool === "draw_highlight"
              }
              isHighlighting={editorState.tool === "draw_highlight"}
              highlightColor={
                editorState.highlightStyle?.color ||
                ANNOTATION_STYLES.highlight.color
              }
              highlightOpacity={
                editorState.highlightStyle?.opacity ??
                ANNOTATION_STYLES.highlight.opacity
              }
              textLayerCursor={
                editorState.tool === "draw_highlight" ? "crosshair" : undefined
              }
            />

            {/* DOM Layer for Highlights, Notes, Form Fields */}
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
              {/* Form Fields */}
              {page.pageFields.map((field) => (
                <ControlRenderer
                  key={field.id}
                  data={field}
                  id={field.id}
                  isSelected={editorState.selectedId === field.id}
                  scale={editorState.scale}
                  isAnnotationMode={editorState.mode === "annotation"}
                  isFormMode={editorState.mode === "form"}
                  isSelectable={isSelectable}
                  onControlPointerDown={handleFieldPointerDown}
                  onSelect={onSelectControl}
                  onUpdate={onUpdateField}
                  onControlResizeStart={handleResizePointerDown}
                />
              ))}
              {/* Annotations: Highlight & Note */}
              {page.pageAnnotations.map((annot) => (
                <ControlRenderer
                  key={annot.id}
                  data={annot}
                  id={annot.id}
                  isSelected={editorState.selectedId === annot.id}
                  scale={editorState.scale}
                  isAnnotationMode={editorState.mode === "annotation"}
                  isFormMode={editorState.mode === "form"}
                  isSelectable={isSelectable}
                  onControlPointerDown={handleAnnotationPointerDown}
                  onSelect={onSelectControl}
                  onUpdate={onUpdateAnnotation}
                  onDelete={onDeleteAnnotation}
                  onEdit={onEditAnnotation}
                  onControlResizeStart={handleResizePointerDown}
                />
              ))}

              {/* Drag Guide */}
              {dragStart &&
                dragCurrent &&
                activePageIndex === page.pageIndex && (
                  <div
                    className={cn(
                      "pointer-events-none absolute border-2",
                      editorState.mode === "form"
                        ? "border-blue-500 bg-blue-500/20"
                        : "border-yellow-500 bg-yellow-500/20",
                    )}
                    style={{
                      left:
                        Math.min(dragStart.x, dragCurrent.x) *
                        editorState.scale,
                      top:
                        Math.min(dragStart.y, dragCurrent.y) *
                        editorState.scale,
                      width:
                        Math.abs(dragCurrent.x - dragStart.x) *
                        editorState.scale,
                      height:
                        Math.abs(dragCurrent.y - dragStart.y) *
                        editorState.scale,
                    }}
                  />
                )}
            </div>

            {/* SVG Layer for Ink Annotations */}
            {/* Added viewBox to match unscaled page dimensions, ensuring proper scaling behavior for ink paths */}
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
              viewBox={`0 0 ${page.width} ${page.height}`}
              preserveAspectRatio="none"
            >
              {
                /* Current Drawing Path */
                isDrawing && activePageIndex === page.pageIndex && (
                  <path
                    d={pointsToPath(currentPathState)}
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
                )
              }
            </svg>

            {/* Snap Guides Layer */}
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
                        line.type === "vertical"
                          ? line.pos * editorState.scale
                          : 0,
                      top:
                        line.type === "horizontal"
                          ? line.pos * editorState.scale
                          : 0,
                      width: line.type === "vertical" ? "1px" : "100%",
                      height: line.type === "horizontal" ? "1px" : "100%",
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default Workspace;
