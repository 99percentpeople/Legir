import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { appEventBus } from "@/lib/eventBus";

export type TextSelectionHandleRect = {
  left: number;
  top: number;
  height: number;
};

export type TextSelectionHandlesState = {
  start: TextSelectionHandleRect | null;
  end: TextSelectionHandleRect | null;
};

export const useTextLayerSelection = (opts: {
  pageIndex: number;
  textLayerRef: RefObject<HTMLDivElement>;
  isSelectMode: boolean;
  scale: number;
  renderedScale: number | null;
  isInView: boolean;
}) => {
  const {
    pageIndex,
    textLayerRef,
    isSelectMode,
    scale,
    renderedScale,
    isInView,
  } = opts;

  const [pagePortalEl, setPagePortalEl] = useState<HTMLElement | null>(null);
  const dragSelectionHandleRef = useRef<{
    kind: "start" | "end";
    fixedNode: Node;
    fixedOffset: number;
    activeHandleKind: "start" | "end";
  } | null>(null);
  const [isDraggingSelectionHandle, setIsDraggingSelectionHandle] =
    useState(false);
  const isPointerSelectingTextRef = useRef(false);
  const [isPointerSelectingText, setIsPointerSelectingText] = useState(false);
  const [selectionHandles, setSelectionHandles] =
    useState<TextSelectionHandlesState>({ start: null, end: null });

  useEffect(() => {
    setPagePortalEl(
      (typeof document !== "undefined"
        ? (document.getElementById(`page-${pageIndex}`) as HTMLElement | null)
        : null) ?? null,
    );
  }, [pageIndex]);

  const doc =
    typeof document !== "undefined"
      ? (document as Document & {
          caretRangeFromPoint?: (x: number, y: number) => Range | null;
          caretPositionFromPoint?: (
            x: number,
            y: number,
          ) => { offsetNode: Node; offset: number } | null;
        })
      : null;

  const getCaretRangeFromPoint = useCallback(
    (x: number, y: number) => {
      if (!doc) return null;
      if (typeof doc.caretRangeFromPoint === "function")
        return doc.caretRangeFromPoint(x, y);

      if (typeof doc.caretPositionFromPoint === "function") {
        const position = doc.caretPositionFromPoint(x, y);
        if (!position) return null;
        const range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.collapse(true);
        return range;
      }
      return null;
    },
    [doc],
  );

  const findNearestTextSpan = useCallback(
    (
      layer: HTMLDivElement,
      x: number,
      y: number,
      candidates?: HTMLSpanElement[],
    ) => {
      const spans =
        candidates ??
        Array.from(
          layer.querySelectorAll<HTMLSpanElement>("span[role='presentation']"),
        );
      let bestSpan: HTMLSpanElement | null = null;
      let bestRect: DOMRect | null = null;
      let bestScore = Number.POSITIVE_INFINITY;
      spans.forEach((span) => {
        if (!span.textContent) return;
        const rect = span.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const dx =
          x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
        const dy =
          y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
        const score = dy * dy * 4 + dx * dx;
        if (score < bestScore) {
          bestScore = score;
          bestSpan = span;
          bestRect = rect;
        }
      });
      if (!bestSpan || !bestRect) return null;
      return { span: bestSpan, rect: bestRect };
    },
    [],
  );

  const getNearestTextTarget = useCallback(
    (layer: HTMLDivElement, x: number, y: number) => {
      const nearest = findNearestTextSpan(layer, x, y);
      if (!nearest) return null;
      const { span, rect } = nearest;
      const clampedX = Math.min(Math.max(x, rect.left + 1), rect.right - 1);
      const clampedY = Math.min(Math.max(y, rect.top + 1), rect.bottom - 1);
      const rangeFromPoint = getCaretRangeFromPoint(clampedX, clampedY);
      if (rangeFromPoint && span.contains(rangeFromPoint.startContainer)) {
        rangeFromPoint.collapse(true);
        return { range: rangeFromPoint, rect, span };
      }
      const range = document.createRange();
      const textNode = span.firstChild;
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        const textLength = textNode.textContent?.length ?? 0;
        const useEnd = clampedX > rect.left + rect.width / 2;
        range.setStart(textNode, useEnd ? textLength : 0);
      } else {
        range.setStart(span, 0);
      }
      range.collapse(true);
      return { range, rect, span };
    },
    [findNearestTextSpan, getCaretRangeFromPoint],
  );

  const getTextLayerFromPoint = useCallback((x: number, y: number) => {
    if (typeof document === "undefined") return null;
    const elements = document.elementsFromPoint(x, y);
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue;
      const layer = element.closest(".textLayer");
      if (layer instanceof HTMLDivElement) return layer;
    }
    return null;
  }, []);

  const getCaretClientRect = useCallback((node: Node, offset: number) => {
    try {
      const r = document.createRange();
      r.setStart(node, offset);
      r.collapse(true);
      const rect = r.getClientRects()[0] ?? r.getBoundingClientRect();
      if (rect && rect.height > 0) return rect;
    } catch {}

    const el = node instanceof Element ? node : node.parentElement;
    const span = el?.closest?.("span[role='presentation']") as
      | HTMLSpanElement
      | null
      | undefined;
    if (!span) return null;
    const rect = span.getBoundingClientRect();
    if (rect.width + rect.height === 0) return null;
    return rect;
  }, []);

  const updateSelectionHandles = useCallback(() => {
    if (!isSelectMode) {
      setSelectionHandles({ start: null, end: null });
      return;
    }

    const layerEl = textLayerRef.current;
    const pageEl = pagePortalEl;
    const sel = window.getSelection?.();
    if (!layerEl || !pageEl || !sel || sel.rangeCount === 0) {
      setSelectionHandles({ start: null, end: null });
      return;
    }
    if (sel.isCollapsed && !isDraggingSelectionHandle) {
      setSelectionHandles({ start: null, end: null });
      return;
    }

    const range = sel.getRangeAt(0);
    const getClosestLayer = (node: Node | null) => {
      if (!node) return null;
      const el = node instanceof Element ? node : node.parentElement;
      return el?.closest?.(".textLayer") ?? null;
    };

    const startLayer = getClosestLayer(range.startContainer);
    const endLayer = getClosestLayer(range.endContainer);

    const pageRect = pageEl.getBoundingClientRect();
    const handleWidth = 14;
    const dotRadius = 5;

    const startRect =
      startLayer === layerEl
        ? getCaretClientRect(range.startContainer, range.startOffset)
        : null;
    const endRect =
      endLayer === layerEl
        ? getCaretClientRect(range.endContainer, range.endOffset)
        : null;

    const start = startRect
      ? {
          left: startRect.left - pageRect.left - handleWidth / 2,
          top: startRect.top - pageRect.top - dotRadius,
          height: Math.max(8, startRect.height + dotRadius),
        }
      : null;

    const end = endRect
      ? {
          left: endRect.left - pageRect.left - handleWidth / 2,
          top: endRect.top - pageRect.top,
          height: Math.max(8, endRect.height + dotRadius),
        }
      : null;

    setSelectionHandles({ start, end });
  }, [
    getCaretClientRect,
    isDraggingSelectionHandle,
    isSelectMode,
    pagePortalEl,
    textLayerRef,
  ]);

  useEffect(() => {
    updateSelectionHandles();
  }, [updateSelectionHandles, scale, renderedScale, isInView]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onSelection = () => updateSelectionHandles();
    const onScroll = () => updateSelectionHandles();
    const onResize = () => updateSelectionHandles();
    document.addEventListener("selectionchange", onSelection);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("selectionchange", onSelection);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [updateSelectionHandles]);

  useEffect(() => {
    if (!isSelectMode) {
      if (isPointerSelectingTextRef.current) {
        isPointerSelectingTextRef.current = false;
        setIsPointerSelectingText(false);
      }
      return;
    }
    if (typeof document === "undefined") return;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("[data-ff-selection-handle='1']")) return;

      const layer = target?.closest?.(".textLayer") as HTMLDivElement | null;
      if (!layer || layer !== textLayerRef.current) return;

      isPointerSelectingTextRef.current = true;
      setIsPointerSelectingText(true);
    };

    const onPointerEnd = () => {
      if (!isPointerSelectingTextRef.current) return;
      requestAnimationFrame(() => {
        isPointerSelectingTextRef.current = false;
        setIsPointerSelectingText(false);
      });
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerEnd, true);
    document.addEventListener("pointercancel", onPointerEnd, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerEnd, true);
      document.removeEventListener("pointercancel", onPointerEnd, true);
    };
  }, [isSelectMode, textLayerRef]);

  const startSelectionHandleDrag = useCallback(
    (kind: "start" | "end", e: ReactPointerEvent) => {
      if (!isSelectMode) return;
      const sel = window.getSelection?.();
      if (!sel || sel.rangeCount === 0) return;
      if (sel.isCollapsed && !(selectionHandles.start || selectionHandles.end))
        return;
      const range = sel.getRangeAt(0);

      e.preventDefault();
      e.stopPropagation();

      const fixedNode =
        kind === "start" ? range.endContainer : range.startContainer;
      const fixedOffset =
        kind === "start" ? range.endOffset : range.startOffset;
      dragSelectionHandleRef.current = {
        kind,
        fixedNode,
        fixedOffset,
        activeHandleKind: kind,
      };
      setIsDraggingSelectionHandle(true);
      appEventBus.emit(
        "workspace:textSelectionHandleDraggingChange",
        { dragging: true, handleKind: kind },
        { sticky: true },
      );

      const handleMove = (ev: PointerEvent) => {
        const drag = dragSelectionHandleRef.current;
        if (!drag) return;
        const activeLayer =
          getTextLayerFromPoint(ev.clientX, ev.clientY) ?? textLayerRef.current;
        if (!activeLayer) return;
        const target = getNearestTextTarget(
          activeLayer,
          ev.clientX,
          ev.clientY,
        );
        if (!target) return;
        const s = window.getSelection?.();
        if (!s) return;

        const normalizeOrder = (
          startNode: Node,
          startOffset: number,
          endNode: Node,
          endOffset: number,
        ) => {
          const a = document.createRange();
          a.setStart(startNode, startOffset);
          a.collapse(true);
          const b = document.createRange();
          b.setStart(endNode, endOffset);
          b.collapse(true);
          const isAfter =
            a.compareBoundaryPoints(Range.START_TO_START, b) === 1;
          return {
            swapped: isAfter,
            ...(isAfter
              ? {
                  startNode: endNode,
                  startOffset: endOffset,
                  endNode: startNode,
                  endOffset: startOffset,
                }
              : { startNode, startOffset, endNode, endOffset }),
          };
        };

        const next =
          drag.kind === "start"
            ? normalizeOrder(
                target.range.startContainer,
                target.range.startOffset,
                drag.fixedNode,
                drag.fixedOffset,
              )
            : normalizeOrder(
                drag.fixedNode,
                drag.fixedOffset,
                target.range.startContainer,
                target.range.startOffset,
              );

        const pointerKind = next.swapped
          ? drag.kind === "start"
            ? "end"
            : "start"
          : drag.kind;
        if (drag.activeHandleKind !== pointerKind) {
          dragSelectionHandleRef.current = {
            ...drag,
            activeHandleKind: pointerKind,
          };
        }

        if (typeof s.setBaseAndExtent === "function") {
          s.setBaseAndExtent(
            next.startNode,
            next.startOffset,
            next.endNode,
            next.endOffset,
          );
        } else {
          const range = document.createRange();
          range.setStart(next.startNode, next.startOffset);
          range.setEnd(next.endNode, next.endOffset);
          s.removeAllRanges();
          s.addRange(range);
        }
        updateSelectionHandles();
      };

      const handleEnd = () => {
        const activeKind = dragSelectionHandleRef.current?.activeHandleKind;
        dragSelectionHandleRef.current = null;
        setIsDraggingSelectionHandle(false);
        appEventBus.emit(
          "workspace:textSelectionHandleDraggingChange",
          { dragging: false, handleKind: activeKind ?? kind },
          { sticky: true },
        );
        document.removeEventListener("pointermove", handleMove, true);
        document.removeEventListener("pointerup", handleEnd, true);
        document.removeEventListener("pointercancel", handleEnd, true);
        updateSelectionHandles();
      };

      document.addEventListener("pointermove", handleMove, true);
      document.addEventListener("pointerup", handleEnd, true);
      document.addEventListener("pointercancel", handleEnd, true);
    },
    [
      getNearestTextTarget,
      getTextLayerFromPoint,
      isSelectMode,
      selectionHandles.end,
      selectionHandles.start,
      textLayerRef,
      updateSelectionHandles,
    ],
  );

  useEffect(() => {
    return () => {
      if (isDraggingSelectionHandle) {
        appEventBus.emit(
          "workspace:textSelectionHandleDraggingChange",
          { dragging: false, handleKind: undefined },
          { sticky: true },
        );
      }
    };
  }, [isDraggingSelectionHandle]);

  return {
    pagePortalEl,
    isDraggingSelectionHandle,
    isPointerSelectingText,
    selectionHandles,
    startSelectionHandleDrag,
  };
};
