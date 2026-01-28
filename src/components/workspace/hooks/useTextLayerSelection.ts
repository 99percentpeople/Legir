import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { appEventBus } from "@/lib/eventBus";
import { resetGlobalCursor, setGlobalCursor } from "@/lib/cursor";

export type TextSelectionHandleRect = {
  left: number;
  top: number;
  height: number;
  rotateDeg?: number;
};

export type TextSelectionHandlesState = {
  start: TextSelectionHandleRect | null;
  end: TextSelectionHandleRect | null;
};

type ManualSelectionState = {
  anchorNode: Node;
  anchorOffset: number;
  activeLayer: HTMLDivElement;
  startX: number;
  startY: number;
  didDrag: boolean;
  anchorRect: DOMRect | null;
  lastFocusRect: DOMRect | null;
  lineSpans: HTMLSpanElement[];
  lineBandAxis: "x" | "y";
  lineBandStart: number;
  lineBandEnd: number;
  lineLayer: HTMLDivElement | null;
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
  const manualSelectionRef = useRef<ManualSelectionState | null>(null);
  const [isDraggingSelectionHandle, setIsDraggingSelectionHandle] =
    useState(false);
  const isPointerSelectingTextRef = useRef(false);
  const [isPointerSelectingText, setIsPointerSelectingText] = useState(false);
  const [selectionHandles, setSelectionHandles] =
    useState<TextSelectionHandlesState>({ start: null, end: null });

  useEffect(() => {
    if (!isDraggingSelectionHandle) return;
    setGlobalCursor("grabbing", "text-selection-handle-drag");
    return () => {
      resetGlobalCursor("text-selection-handle-drag");
    };
  }, [isDraggingSelectionHandle]);

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

  const getSpanRotationDeg = useCallback((span: HTMLSpanElement) => {
    if (typeof window === "undefined") return null;

    try {
      const anySpan = span as unknown as {
        getBoxQuads?: (options?: unknown) => DOMQuad[];
      };
      if (typeof anySpan.getBoxQuads === "function") {
        const quad = anySpan.getBoxQuads({ box: "border" })?.[0];
        const p1 = quad?.p1;
        const p2 = quad?.p2;
        if (p1 && p2) {
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          if (dx || dy) return (Math.atan2(dy, dx) * 180) / Math.PI;
        }
      }
    } catch {}

    try {
      const style = window.getComputedStyle(span);
      const transform = style.transform;
      if (transform && transform !== "none") {
        const match = transform.match(/^matrix\((.+)\)$/);
        if (match) {
          const parts = match[1]
            .split(",")
            .map((s) => Number.parseFloat(s.trim()));
          const a = parts[0] ?? 1;
          const b = parts[1] ?? 0;
          const angle = (Math.atan2(b, a) * 180) / Math.PI;
          const layer = span.closest(".textLayer") as HTMLDivElement | null;
          const mainRotation = layer
            ? Number.parseFloat(layer.getAttribute("data-main-rotation") || "0")
            : 0;
          return angle + (Number.isFinite(mainRotation) ? mainRotation : 0);
        }
      }
    } catch {}

    return null;
  }, []);

  const getLineBandAxisForSpan = useCallback(
    (span: HTMLSpanElement | null) => {
      const deg = span ? getSpanRotationDeg(span) : null;
      if (deg === null) return "y";
      const rad = (deg * Math.PI) / 180;
      const absCos = Math.abs(Math.cos(rad));
      const absSin = Math.abs(Math.sin(rad));
      return absCos >= absSin ? "y" : "x";
    },
    [getSpanRotationDeg],
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
    (
      layer: HTMLDivElement,
      x: number,
      y: number,
      candidates?: HTMLSpanElement[],
    ) => {
      const nearest = findNearestTextSpan(layer, x, y, candidates);
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
        const useEnd = (() => {
          const deg = getSpanRotationDeg(span);
          if (deg === null) return clampedX > rect.left + rect.width / 2;
          const rad = (deg * Math.PI) / 180;
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const dx = clampedX - cx;
          const dy = clampedY - cy;
          const proj = dx * Math.cos(rad) + dy * Math.sin(rad);
          return proj > 0;
        })();
        range.setStart(textNode, useEnd ? textLength : 0);
      } else {
        range.setStart(span, 0);
      }
      range.collapse(true);
      return { range, rect, span };
    },
    [findNearestTextSpan, getCaretRangeFromPoint, getSpanRotationDeg],
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
      if (rect && (rect.width > 0.5 || rect.height > 0.5)) return rect;

      const textNode =
        node.nodeType === Node.TEXT_NODE
          ? (node as Text)
          : ((node.firstChild as Text | null) ?? null);
      if (textNode && textNode.data) {
        const len = textNode.data.length;
        if (len > 0) {
          const clamped = Math.max(0, Math.min(len - 1, offset));
          const rr = document.createRange();
          rr.setStart(textNode, clamped);
          rr.setEnd(textNode, Math.min(len, clamped + 1));
          const rect2 = rr.getClientRects()[0] ?? rr.getBoundingClientRect();
          if (rect2 && (rect2.width > 0.5 || rect2.height > 0.5)) return rect2;
        }
      }
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

  const getCaretSpan = useCallback((node: Node) => {
    const el = node instanceof Element ? node : node.parentElement;
    const span = el?.closest?.("span[role='presentation']") as
      | HTMLSpanElement
      | null
      | undefined;
    return span ?? null;
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
    const dotRadius = 6;

    const getHandleVisualLength = (
      rect: DOMRect | null,
      span: HTMLSpanElement | null,
      baselineDeg: number | null,
    ) => {
      if (!rect) return 0;
      const w = rect.width;
      const h = rect.height;
      const hasW = w > 0.5;
      const hasH = h > 0.5;

      const fontSize =
        span && typeof window !== "undefined"
          ? Number.parseFloat(window.getComputedStyle(span).fontSize || "0")
          : 0;

      if (span && typeof window !== "undefined") {
        try {
          const anySpan = span as unknown as {
            getBoxQuads?: (options?: unknown) => DOMQuad[];
          };
          if (typeof anySpan.getBoxQuads === "function") {
            const quad = anySpan.getBoxQuads({ box: "border" })?.[0];
            const p2 = quad?.p2;
            const p3 = quad?.p3;
            if (p2 && p3) {
              const qdx = p3.x - p2.x;
              const qdy = p3.y - p2.y;
              const quadHeight = Math.hypot(qdx, qdy);
              if (Number.isFinite(quadHeight) && quadHeight > 0) {
                if (Number.isFinite(fontSize) && fontSize > 0) {
                  return Math.min(quadHeight, fontSize * 4);
                }
                return quadHeight;
              }
            }
          }
        } catch {}
      }

      if (typeof baselineDeg === "number" && hasW && hasH) {
        const caretRad = ((baselineDeg + 90) * Math.PI) / 180;
        const absCos = Math.abs(Math.cos(caretRad));
        const absSin = Math.abs(Math.sin(caretRad));
        const lenFromW = absCos > 0.1 ? w / absCos : 0;
        const lenFromH = absSin > 0.1 ? h / absSin : 0;
        const rawLen = Math.max(lenFromW, lenFromH);
        if (Number.isFinite(rawLen) && rawLen > 0) {
          if (Number.isFinite(fontSize) && fontSize > 0) {
            return Math.min(rawLen, fontSize * 4);
          }
          return rawLen;
        }
      }

      if (hasH) return h;
      if (hasW) return w;

      if (Number.isFinite(fontSize) && fontSize > 0) return fontSize;

      return 0;
    };

    const startRect =
      startLayer === layerEl
        ? getCaretClientRect(range.startContainer, range.startOffset)
        : null;
    const endRect =
      endLayer === layerEl
        ? getCaretClientRect(range.endContainer, range.endOffset)
        : null;

    const startSpan =
      startLayer === layerEl ? getCaretSpan(range.startContainer) : null;
    const endSpan =
      endLayer === layerEl ? getCaretSpan(range.endContainer) : null;
    const startRotateDeg = startSpan ? getSpanRotationDeg(startSpan) : null;
    const endRotateDeg = endSpan ? getSpanRotationDeg(endSpan) : null;

    const startLen = getHandleVisualLength(
      startRect,
      startSpan,
      startRotateDeg,
    );
    const endLen = getHandleVisualLength(endRect, endSpan, endRotateDeg);

    const getHandleAnchorPoint = (
      rect: DOMRect | null,
      span: HTMLSpanElement | null,
      baselineDeg: number | null,
      kind: "start" | "end",
      visualLen: number,
    ) => {
      if (!rect) return null;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      if (span && typeof window !== "undefined") {
        try {
          const anySpan = span as unknown as {
            getBoxQuads?: (options?: unknown) => DOMQuad[];
          };
          if (typeof anySpan.getBoxQuads === "function") {
            const quad = anySpan.getBoxQuads({ box: "border" })?.[0];
            const p1 = quad?.p1;
            const p2 = quad?.p2;
            const p4 = quad?.p4;
            if (p1 && p2 && p4) {
              const bx = p2.x - p1.x;
              const by = p2.y - p1.y;
              const hx = p4.x - p1.x;
              const hy = p4.y - p1.y;
              const bLen = Math.hypot(bx, by);
              const hLen = Math.hypot(hx, hy);
              if (bLen > 0.5 && hLen > 0.5) {
                const bUx = bx / bLen;
                const bUy = by / bLen;
                const hUx = hx / hLen;
                const hUy = hy / hLen;

                const vx = cx - p1.x;
                const vy = cy - p1.y;
                const s = Math.min(Math.max(vx * bUx + vy * bUy, 0), bLen);

                const topPt = { x: p1.x + bUx * s, y: p1.y + bUy * s };
                const bottomPt = {
                  x: topPt.x + hUx * hLen,
                  y: topPt.y + hUy * hLen,
                };

                const tTop = topPt.x * hUx + topPt.y * hUy;
                const tBottom = bottomPt.x * hUx + bottomPt.y * hUy;
                const topIsMin = tTop <= tBottom;
                const startPt = topIsMin ? topPt : bottomPt;
                const endPt = topIsMin ? bottomPt : topPt;

                const out = kind === "start" ? -dotRadius : dotRadius;
                const base = kind === "start" ? startPt : endPt;
                return { x: base.x + hUx * out, y: base.y + hUy * out };
              }
            }
          }
        } catch {}
      }

      if (typeof baselineDeg === "number") {
        const caretRad = ((baselineDeg + 90) * Math.PI) / 180;
        const dx = Math.cos(caretRad);
        const dy = Math.sin(caretRad);
        const extentFromRect =
          (Math.abs(dx) * rect.width + Math.abs(dy) * rect.height) / 2;
        const extentFromLen = Math.max(1, visualLen / 2);
        const extent = Math.max(extentFromRect, extentFromLen);

        const ax0 = cx - dx * extent;
        const ay0 = cy - dy * extent;
        const ax1 = cx + dx * extent;
        const ay1 = cy + dy * extent;

        const t0 = ax0 * dx + ay0 * dy;
        const t1 = ax1 * dx + ay1 * dy;
        const firstIsMin = t0 <= t1;
        const startPt = firstIsMin ? { x: ax0, y: ay0 } : { x: ax1, y: ay1 };
        const endPt = firstIsMin ? { x: ax1, y: ay1 } : { x: ax0, y: ay0 };

        const out = kind === "start" ? -dotRadius : dotRadius;
        const base = kind === "start" ? startPt : endPt;
        return { x: base.x + dx * out, y: base.y + dy * out };
      }

      return {
        x: cx,
        y: kind === "start" ? rect.top : rect.top + rect.height,
      };
    };

    const startAnchor = getHandleAnchorPoint(
      startRect,
      startSpan,
      startRotateDeg,
      "start",
      startLen,
    );
    const endAnchor = getHandleAnchorPoint(
      endRect,
      endSpan,
      endRotateDeg,
      "end",
      endLen,
    );

    const start = startRect
      ? {
          left:
            (startAnchor?.x ?? startRect.left) -
            pageRect.left -
            handleWidth / 2,
          top: (startAnchor?.y ?? startRect.top) - pageRect.top,
          height: Math.max(8, startLen + dotRadius),
          ...(typeof startRotateDeg === "number"
            ? { rotateDeg: startRotateDeg }
            : {}),
        }
      : null;

    const end = endRect
      ? {
          left:
            (endAnchor?.x ?? endRect.left) - pageRect.left - handleWidth / 2,
          top:
            (endAnchor?.y ?? endRect.top + endRect.height) -
            pageRect.top -
            Math.max(8, endLen + dotRadius),
          height: Math.max(8, endLen + dotRadius),
          ...(typeof endRotateDeg === "number"
            ? { rotateDeg: endRotateDeg }
            : {}),
        }
      : null;

    setSelectionHandles({ start, end });
  }, [
    getCaretSpan,
    getCaretClientRect,
    getSpanRotationDeg,
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

  useEffect(() => {
    if (!isSelectMode) {
      manualSelectionRef.current = null;
      return;
    }
    if (typeof document === "undefined") return;

    const getLineInfoForRect = (
      layer: HTMLDivElement,
      anchorRect: DOMRect,
      anchorSpan?: HTMLSpanElement,
      axis: "x" | "y" = "y",
    ) => {
      const spans = Array.from(
        layer.querySelectorAll<HTMLSpanElement>("span[role='presentation']"),
      );
      const lineSpans: HTMLSpanElement[] = [];
      let bandStart = axis === "x" ? anchorRect.left : anchorRect.top;
      let bandEnd = axis === "x" ? anchorRect.right : anchorRect.bottom;
      const anchorCenter =
        axis === "x"
          ? anchorRect.left + anchorRect.width / 2
          : anchorRect.top + anchorRect.height / 2;
      const maxCenterDiff = Math.max(
        2,
        (axis === "x" ? anchorRect.width : anchorRect.height) * 0.6,
      );

      const anchorDeg = anchorSpan ? getSpanRotationDeg(anchorSpan) : null;
      const angleThreshold = 40;
      const getAngleDelta = (a: number, b: number) => {
        const diff = (((a - b) % 360) + 360) % 360;
        return diff > 180 ? 360 - diff : diff;
      };

      spans.forEach((span) => {
        if (!span.textContent) return;

        if (anchorDeg !== null) {
          const spanDeg = getSpanRotationDeg(span);
          if (spanDeg !== null) {
            if (getAngleDelta(spanDeg, anchorDeg) > angleThreshold) return;
          } else if (getLineBandAxisForSpan(span) !== axis) {
            return;
          }
        } else if (getLineBandAxisForSpan(span) !== axis) {
          return;
        }

        const rect = span.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const overlap =
          axis === "x"
            ? Math.min(rect.right, anchorRect.right) -
              Math.max(rect.left, anchorRect.left)
            : Math.min(rect.bottom, anchorRect.bottom) -
              Math.max(rect.top, anchorRect.top);
        const minSize =
          axis === "x"
            ? Math.min(rect.width, anchorRect.width)
            : Math.min(rect.height, anchorRect.height);
        const centerDiff =
          Math.abs(
            (axis === "x"
              ? rect.left + rect.width / 2
              : rect.top + rect.height / 2) - anchorCenter,
          ) ?? Number.POSITIVE_INFINITY;
        const isSameLine =
          overlap >= Math.max(1, minSize * 0.3) || centerDiff <= maxCenterDiff;
        if (!isSameLine) return;
        lineSpans.push(span);
        bandStart = Math.min(bandStart, axis === "x" ? rect.left : rect.top);
        bandEnd = Math.max(bandEnd, axis === "x" ? rect.right : rect.bottom);
      });

      if (lineSpans.length === 0 && anchorSpan) {
        lineSpans.push(anchorSpan);
      }

      return {
        lineSpans,
        lineBandStart: bandStart,
        lineBandEnd: bandEnd,
      };
    };

    const getTargetFromRange = (
      range: Range | null,
      element: Element | null,
    ) => {
      if (!range || !element) return null;
      const span = element.closest("span[role='presentation']");
      if (!(span instanceof HTMLSpanElement)) return null;
      const rect = span.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return null;
      const collapsed = range.cloneRange();
      collapsed.collapse(true);
      return { range: collapsed, rect, span };
    };

    const clearManualSelection = () => {
      manualSelectionRef.current = null;
    };

    const handleManualPointerMove = (e: PointerEvent) => {
      const state = manualSelectionRef.current;
      if (!state) return;
      const sel = window.getSelection();
      if (!sel) return;
      const dx = Math.abs(e.clientX - state.startX);
      const dy = Math.abs(e.clientY - state.startY);
      if (dx > 2 || dy > 2) {
        state.didDrag = true;
      }

      const focusLayer =
        getTextLayerFromPoint(e.clientX, e.clientY) ??
        state.lineLayer ??
        state.activeLayer;
      const useLineBand = state.lineLayer === focusLayer;
      const lineRect = useLineBand
        ? (state.lastFocusRect ?? state.anchorRect)
        : null;
      const axis = state.lineBandAxis;
      const linePad = lineRect
        ? Math.max(8, (axis === "x" ? lineRect.width : lineRect.height) * 0.8)
        : 10;
      const bandStart = state.lineBandStart;
      const bandEnd = state.lineBandEnd;
      const pointerCoord = axis === "x" ? e.clientX : e.clientY;
      const isInLineBand =
        useLineBand &&
        pointerCoord >= bandStart - linePad &&
        pointerCoord <= bandEnd + linePad;
      const distanceToBand =
        pointerCoord < bandStart
          ? bandStart - pointerCoord
          : pointerCoord > bandEnd
            ? pointerCoord - bandEnd
            : 0;
      const lineTarget =
        useLineBand && state.lineSpans.length
          ? getNearestTextTarget(
              focusLayer,
              e.clientX,
              e.clientY,
              state.lineSpans,
            )
          : null;
      const globalTarget = getNearestTextTarget(
        focusLayer,
        e.clientX,
        e.clientY,
      );
      let focusTarget = globalTarget ?? lineTarget;

      if (isInLineBand && lineTarget) {
        focusTarget = lineTarget;
      } else if (!isInLineBand && lineTarget && globalTarget) {
        const distanceToTarget =
          axis === "x"
            ? e.clientX < globalTarget.rect.left
              ? globalTarget.rect.left - e.clientX
              : e.clientX > globalTarget.rect.right
                ? e.clientX - globalTarget.rect.right
                : 0
            : e.clientY < globalTarget.rect.top
              ? globalTarget.rect.top - e.clientY
              : e.clientY > globalTarget.rect.bottom
                ? e.clientY - globalTarget.rect.bottom
                : 0;
        if (distanceToBand <= distanceToTarget) {
          focusTarget = lineTarget;
        }
      }

      if (!focusTarget) return;
      if (focusTarget === globalTarget && !isInLineBand) {
        const nextAxis = getLineBandAxisForSpan(focusTarget.span);
        const lineInfo = getLineInfoForRect(
          focusLayer,
          focusTarget.rect,
          focusTarget.span,
          nextAxis,
        );
        if (lineInfo.lineSpans.length > 0) {
          state.lineSpans = lineInfo.lineSpans;
          state.lineBandAxis = nextAxis;
          state.lineBandStart = lineInfo.lineBandStart;
          state.lineBandEnd = lineInfo.lineBandEnd;
          state.lineLayer = focusLayer;
        }
      }
      state.lastFocusRect = focusTarget.rect;
      const focusRange = focusTarget.range;

      if (typeof sel.setBaseAndExtent === "function") {
        sel.setBaseAndExtent(
          state.anchorNode,
          state.anchorOffset,
          focusRange.startContainer,
          focusRange.startOffset,
        );
      } else {
        const range = document.createRange();
        range.setStart(state.anchorNode, state.anchorOffset);
        range.setEnd(focusRange.startContainer, focusRange.startOffset);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    };

    const handleManualPointerEnd = () => {
      const state = manualSelectionRef.current;
      const sel = window.getSelection();
      if (state && !state.didDrag && sel?.isCollapsed) {
        // Only clear a collapsed anchor selection (no drag). Avoid wiping
        // word/phrase selections created by double-click or programmatic ranges.
        sel.removeAllRanges();
      }
      clearManualSelection();
      document.removeEventListener(
        "pointermove",
        handleManualPointerMove,
        true,
      );
      document.removeEventListener("pointerup", handleManualPointerEnd, true);
      document.removeEventListener(
        "pointercancel",
        handleManualPointerEnd,
        true,
      );
    };

    const startManualSelection = (
      anchorTarget: { range: Range; rect: DOMRect; span: HTMLSpanElement },
      activeLayer: HTMLDivElement,
      startX: number,
      startY: number,
      sel: Selection,
    ) => {
      // Manual anchor keeps whitespace drags locked to the intended line, instead
      // of letting the browser jump the selection to a later text run.
      sel.removeAllRanges();
      sel.addRange(anchorTarget.range);
      const lineInfo = getLineInfoForRect(
        activeLayer,
        anchorTarget.rect,
        anchorTarget.span,
        getLineBandAxisForSpan(anchorTarget.span),
      );
      manualSelectionRef.current = {
        anchorNode: anchorTarget.range.startContainer,
        anchorOffset: anchorTarget.range.startOffset,
        activeLayer,
        startX,
        startY,
        didDrag: false,
        anchorRect: anchorTarget.rect,
        lastFocusRect: anchorTarget.rect,
        lineSpans: lineInfo.lineSpans,
        lineBandAxis: getLineBandAxisForSpan(anchorTarget.span),
        lineBandStart: lineInfo.lineBandStart,
        lineBandEnd: lineInfo.lineBandEnd,
        lineLayer: activeLayer,
      };
      document.addEventListener("pointermove", handleManualPointerMove, true);
      document.addEventListener("pointerup", handleManualPointerEnd, true);
      document.addEventListener("pointercancel", handleManualPointerEnd, true);
    };

    const selectWordFromRange = (anchorRange: Range, sel: Selection) => {
      const baseRange = anchorRange.cloneRange();
      baseRange.collapse(true);
      const baseNode = baseRange.startContainer;
      const baseOffset = baseRange.startOffset;
      const textNode =
        baseNode.nodeType === Node.TEXT_NODE
          ? (baseNode as Text)
          : (baseNode.firstChild as Text | null);

      const text = textNode?.data ?? "";
      const textLen = text.length;
      if (!textNode || textLen === 0) return false;

      const idx = Math.max(0, Math.min(textLen - 1, baseOffset));
      const findWord = () => {
        if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
          const Seg = Intl.Segmenter;
          if (typeof Seg === "function") {
            const seg = new Seg(undefined, { granularity: "word" });
            for (const part of seg.segment(text)) {
              const start = part.index;
              const end = start + part.segment.length;
              if (idx >= start && idx < end && part.isWordLike) {
                return { start, end };
              }
            }
          }
        }

        const isWordChar = (c: string) => /[A-Za-z0-9_]/.test(c);
        const cur = text[idx] ?? "";
        if (!cur || !cur.trim()) return null;
        const isWord = isWordChar(cur);
        let start = idx;
        let end = idx + 1;
        while (start > 0) {
          const c = text[start - 1] ?? "";
          if (!c || !c.trim()) break;
          if (isWord) {
            if (!isWordChar(c)) break;
          } else {
            if (isWordChar(c)) break;
          }
          start -= 1;
        }
        while (end < textLen) {
          const c = text[end] ?? "";
          if (!c || !c.trim()) break;
          if (isWord) {
            if (!isWordChar(c)) break;
          } else {
            if (isWordChar(c)) break;
          }
          end += 1;
        }
        return { start, end };
      };

      const word = findWord();
      if (!word) return false;

      const wordRange = document.createRange();
      wordRange.setStart(textNode, word.start);
      wordRange.setEnd(textNode, word.end);
      sel.removeAllRanges();
      sel.addRange(wordRange);
      return true;
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target?.closest?.("[data-ff-selection-handle='1']")) return;
      const activeLayer = textLayerRef.current;
      if (!activeLayer) return;

      const textLayer = target.closest(".textLayer");
      const directTextTarget = target.closest("span, br");

      if (!textLayer) {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) {
          sel.removeAllRanges();
        }
        return;
      }

      if (textLayer !== activeLayer) return;

      const directRange = getCaretRangeFromPoint(e.clientX, e.clientY);
      const directContainer = directRange?.startContainer;
      const directElement =
        directContainer instanceof Element
          ? directContainer
          : directContainer?.parentElement;
      const directInLayer =
        !!directRange && !!directElement && activeLayer.contains(directElement);
      const directRect = directRange?.getClientRects()[0];
      const caretRect =
        directRect && directRect.width + directRect.height > 0
          ? directRect
          : directRange?.getBoundingClientRect();
      const caretDx = caretRect
        ? e.clientX < caretRect.left
          ? caretRect.left - e.clientX
          : e.clientX > caretRect.right
            ? e.clientX - caretRect.right
            : 0
        : Number.POSITIVE_INFINITY;
      const caretDy = caretRect
        ? e.clientY < caretRect.top
          ? caretRect.top - e.clientY
          : e.clientY > caretRect.bottom
            ? e.clientY - caretRect.bottom
            : 0
        : Number.POSITIVE_INFINITY;
      const isNearCaret = caretDx <= 6 && caretDy <= 6;
      const isTextTarget =
        !!directTextTarget && activeLayer.contains(directTextTarget);
      const sel = window.getSelection();
      if (!sel) return;
      const directTarget =
        directInLayer && isNearCaret && isTextTarget
          ? getTargetFromRange(directRange ?? null, directElement ?? null)
          : null;
      const anchorTarget =
        directTarget ?? getNearestTextTarget(activeLayer, e.clientX, e.clientY);
      if (anchorTarget && e.detail === 2) {
        if (selectWordFromRange(anchorTarget.range, sel)) {
          e.preventDefault();
          return;
        }
      }
      if (e.detail > 1) return;
      if (anchorTarget) {
        startManualSelection(
          anchorTarget,
          activeLayer,
          e.clientX,
          e.clientY,
          sel,
        );
        e.preventDefault();
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (e.pointerType === "mouse") {
        // Mouse click counts are only reliable on mousedown (e.detail).
        // Keep pointerdown for pen/other pointers to avoid breaking double-click.
        return;
      }
      const target = e.target as HTMLElement;
      if (target?.closest?.("[data-ff-selection-handle='1']")) return;
      const activeLayer = textLayerRef.current;
      if (!activeLayer) return;
      const isTouchPointer = e.pointerType === "touch";

      const textLayer = target.closest(".textLayer");
      const directTextTarget = target.closest("span, br");

      if (!textLayer) {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) {
          sel.removeAllRanges();
        }
        return;
      }

      if (textLayer !== activeLayer) return;

      if (isTouchPointer) return;

      const directRange = getCaretRangeFromPoint(e.clientX, e.clientY);
      const directContainer = directRange?.startContainer;
      const directElement =
        directContainer instanceof Element
          ? directContainer
          : directContainer?.parentElement;
      const directInLayer =
        !!directRange && !!directElement && activeLayer.contains(directElement);
      const directRect = directRange?.getClientRects()[0];
      const caretRect =
        directRect && directRect.width + directRect.height > 0
          ? directRect
          : directRange?.getBoundingClientRect();
      const caretDx = caretRect
        ? e.clientX < caretRect.left
          ? caretRect.left - e.clientX
          : e.clientX > caretRect.right
            ? e.clientX - caretRect.right
            : 0
        : Number.POSITIVE_INFINITY;
      const caretDy = caretRect
        ? e.clientY < caretRect.top
          ? caretRect.top - e.clientY
          : e.clientY > caretRect.bottom
            ? e.clientY - caretRect.bottom
            : 0
        : Number.POSITIVE_INFINITY;
      const isNearCaret = caretDx <= 6 && caretDy <= 6;
      const isTextTarget =
        !!directTextTarget && activeLayer.contains(directTextTarget);
      const sel = window.getSelection();
      if (!sel) return;
      const directTarget =
        directInLayer && isNearCaret && isTextTarget
          ? getTargetFromRange(directRange ?? null, directElement ?? null)
          : null;
      // Always establish a deterministic anchor, even from whitespace, so the
      // drag selection doesn't jump to a later text run chosen by the browser.
      const anchorTarget =
        directTarget ?? getNearestTextTarget(activeLayer, e.clientX, e.clientY);
      if (anchorTarget) {
        startManualSelection(
          anchorTarget,
          activeLayer,
          e.clientX,
          e.clientY,
          sel,
        );
        e.preventDefault();
        return;
      }
      if (sel && !sel.isCollapsed) {
        sel.removeAllRanges();
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener(
        "pointermove",
        handleManualPointerMove,
        true,
      );
      document.removeEventListener("pointerup", handleManualPointerEnd, true);
      document.removeEventListener(
        "pointercancel",
        handleManualPointerEnd,
        true,
      );
      clearManualSelection();
    };
  }, [
    getCaretRangeFromPoint,
    getLineBandAxisForSpan,
    getNearestTextTarget,
    getSpanRotationDeg,
    getTextLayerFromPoint,
    isSelectMode,
    textLayerRef,
  ]);

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
