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
  lineBandTop: number;
  lineBandBottom: number;
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
    ) => {
      const spans = Array.from(
        layer.querySelectorAll<HTMLSpanElement>("span[role='presentation']"),
      );
      const lineSpans: HTMLSpanElement[] = [];
      let bandTop = anchorRect.top;
      let bandBottom = anchorRect.bottom;
      const anchorCenter = anchorRect.top + anchorRect.height / 2;
      const maxCenterDiff = Math.max(2, anchorRect.height * 0.6);

      spans.forEach((span) => {
        if (!span.textContent) return;
        const rect = span.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const overlap =
          Math.min(rect.bottom, anchorRect.bottom) -
          Math.max(rect.top, anchorRect.top);
        const minHeight = Math.min(rect.height, anchorRect.height);
        const centerDiff =
          Math.abs(rect.top + rect.height / 2 - anchorCenter) ??
          Number.POSITIVE_INFINITY;
        const isSameLine =
          overlap >= Math.max(1, minHeight * 0.3) ||
          centerDiff <= maxCenterDiff;
        if (!isSameLine) return;
        lineSpans.push(span);
        bandTop = Math.min(bandTop, rect.top);
        bandBottom = Math.max(bandBottom, rect.bottom);
      });

      if (lineSpans.length === 0 && anchorSpan) {
        lineSpans.push(anchorSpan);
      }

      return {
        lineSpans,
        lineBandTop: bandTop,
        lineBandBottom: bandBottom,
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
      const linePad = lineRect ? Math.max(8, lineRect.height * 0.8) : 10;
      const bandTop = state.lineBandTop;
      const bandBottom = state.lineBandBottom;
      const isInLineBand =
        useLineBand &&
        e.clientY >= bandTop - linePad &&
        e.clientY <= bandBottom + linePad;
      const distanceToBand =
        e.clientY < bandTop
          ? bandTop - e.clientY
          : e.clientY > bandBottom
            ? e.clientY - bandBottom
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
          e.clientY < globalTarget.rect.top
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
        const lineInfo = getLineInfoForRect(
          focusLayer,
          focusTarget.rect,
          focusTarget.span,
        );
        if (lineInfo.lineSpans.length > 0) {
          state.lineSpans = lineInfo.lineSpans;
          state.lineBandTop = lineInfo.lineBandTop;
          state.lineBandBottom = lineInfo.lineBandBottom;
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
        lineBandTop: lineInfo.lineBandTop,
        lineBandBottom: lineInfo.lineBandBottom,
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
    getNearestTextTarget,
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
