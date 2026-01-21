import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PageData } from "@/types";
import { cn } from "@/lib/cn";
import { useEditorStore } from "@/store/useEditorStore";
import { appEventBus } from "@/lib/eventBus";
import { pdfWorkerService } from "@/services/pdfService/pdfWorkerService";
import { createViewportFromPageInfo } from "@/services/pdfService/lib/coords";
import { buildTextLayer } from "../lib/pdfTextLayer";

interface PDFTextLayerProps {
  page: PageData;
  scale: number;
  isInView: boolean;
  isSelectMode?: boolean;
  cursor?: React.CSSProperties["cursor"];
  isHighlighting?: boolean;
  highlightColor?: string;
  highlightOpacity?: number;
}

const PDFTextLayer: React.FC<PDFTextLayerProps> = ({
  page,
  scale,
  isInView,
  isSelectMode = true,
  cursor,
  isHighlighting = false,
  highlightColor,
  highlightOpacity,
}) => {
  const pageIndex = page.pageIndex;
  const textLayerRef = useRef<HTMLDivElement>(null);

  // Store options for debugging (optional)
  const pdfTextLayerDebug = useEditorStore(
    (s) => s.options.debugOptions.pdfTextLayer,
  );
  const [renderedScale, setRenderedScale] = useState<number | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const endOfContentRef = useRef<HTMLDivElement | null>(null);
  const prevRangeRef = useRef<Range | null>(null);
  const manualSelectionRef = useRef<{
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
  } | null>(null);

  const userUnit = useMemo(() => page.userUnit ?? 1, [page.userUnit]);
  const pageInfo = useMemo(
    () => ({
      viewBox: page.viewBox,
      userUnit: page.userUnit,
      rotation: page.rotation,
    }),
    [page.viewBox, page.userUnit, page.rotation],
  );

  const setLayerVars = useCallback(
    (el: HTMLElement, scaleFactor: number) => {
      el.style.setProperty("--scale-factor", String(scaleFactor));
      el.style.setProperty("--user-unit", String(userUnit));
    },
    [userUnit],
  );

  const syncTextLayerContainerStyles = useCallback(
    (from: HTMLElement, to: HTMLElement) => {
      const minFontSize = from.style.getPropertyValue("--min-font-size");
      if (minFontSize) {
        to.style.setProperty("--min-font-size", minFontSize);
      }
      if (from.style.width) to.style.width = from.style.width;
      if (from.style.height) to.style.height = from.style.height;
      const rotation = from.getAttribute("data-main-rotation");
      if (rotation) to.setAttribute("data-main-rotation", rotation);
    },
    [],
  );

  // Used to manage render sequence and cancellation
  const renderSeqRef = useRef(0);
  // Used to pause rendering during text selection
  const pendingScaleRef = useRef<number | null>(null);

  // Helper: Adds an element to mark the end of content for accessibility/layout
  const ensureEndOfContent = useCallback((container: HTMLDivElement) => {
    const existing = container.querySelector(":scope > .endOfContent");
    if (existing instanceof HTMLDivElement) {
      endOfContentRef.current = existing;
      return;
    }
    const end = document.createElement("div");
    end.className = "endOfContent";
    container.appendChild(end);
    endOfContentRef.current = end;
  }, []);

  type RenderTextInnerArgs = {
    container: HTMLDivElement;
    targetScale: number;
    isCancelled: () => boolean;
    signal?: AbortSignal;
  };
  type RenderTextInnerFn = (args: RenderTextInnerArgs) => Promise<void>;
  type RenderTextDecoratedArgs = RenderTextInnerArgs & {
    seq: number;
  };

  const decorateRenderText = useCallback((fn: RenderTextInnerFn) => {
    return async (args: RenderTextDecoratedArgs) => {
      let didHide = false;

      const hideDuringRebuild = () => {
        const shouldHide = args.container.childElementCount === 0;
        if (!didHide && shouldHide) {
          setIsRendering(true);
          didHide = true;
        }
      };
      const showAfterStabilize = () => {
        if (didHide) {
          requestAnimationFrame(() => {
            if (renderSeqRef.current === args.seq) setIsRendering(false);
          });
        }
      };

      try {
        hideDuringRebuild();
        await fn({
          container: args.container,
          targetScale: args.targetScale,
          isCancelled: args.isCancelled,
          signal: args.signal,
        });
      } catch (error) {
        if (error?.name !== "AbortError") {
          console.error(`Page ${pageIndex} Text Layer Error:`, error);
        }
      } finally {
        showAfterStabilize();
      }
    };
  }, []);

  const renderText = useMemo(
    () =>
      decorateRenderText(
        async ({
          container,
          targetScale,
          isCancelled,
          signal,
        }: RenderTextInnerArgs) => {
          if (isCancelled()) return;

          const viewport = createViewportFromPageInfo(pageInfo, {
            scale: targetScale,
            rotation: pageInfo.rotation,
          });

          const textContentPromise = pdfWorkerService.getTextContent({
            pageIndex,
            signal,
          });

          const textContent = await textContentPromise;
          if (isCancelled()) return;
          if (!textContent) return;

          const staging = document.createElement("div");
          setLayerVars(staging, targetScale);
          buildTextLayer(staging, textContent, viewport);

          if (isCancelled()) return;

          syncTextLayerContainerStyles(staging, container);

          container.replaceChildren(...Array.from(staging.childNodes));

          ensureEndOfContent(container);
          setRenderedScale(targetScale);
        },
      ),
    [
      decorateRenderText,
      ensureEndOfContent,
      pageIndex,
      pageInfo,
      setLayerVars,
      syncTextLayerContainerStyles,
    ],
  );

  // 1. Reset state when the PDF page object changes
  useEffect(() => {
    setRenderedScale(null);
    setIsSelecting(false);
    setIsRendering(false);
    endOfContentRef.current = null;
    prevRangeRef.current = null;

    if (textLayerRef.current) {
      textLayerRef.current.innerHTML = "";
    }
  }, [pageIndex, pageInfo]);

  // 2. Handle Selection Logic (Web Select API)
  // Replaces the old 'pointerdown' logic with native 'selectionchange'
  useEffect(() => {
    if (!isSelectMode) {
      setIsSelecting(false);
      prevRangeRef.current = null;
      const container = textLayerRef.current;
      const endDiv = endOfContentRef.current;
      if (container && endDiv) {
        container.append(endDiv);
        endDiv.style.width = "";
        endDiv.style.height = "";
        endDiv.style.userSelect = "";
      }
      return;
    }

    const handleSelectionChange = () => {
      const el = textLayerRef.current;
      const sel = window.getSelection();
      if (!el) return;

      if (!endOfContentRef.current) {
        ensureEndOfContent(el);
      }
      const endDiv = endOfContentRef.current;

      const resetEndOfContent = () => {
        if (!endDiv) return;
        el.append(endDiv);
        endDiv.style.width = "";
        endDiv.style.height = "";
        endDiv.style.userSelect = "";
      };

      // Check if selection exists and is actually selecting text (not collapsed)
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setIsSelecting(false);
        prevRangeRef.current = null;
        resetEndOfContent();
        return;
      }

      // Check if the current selection intersects with this specific text layer
      const range = sel.getRangeAt(0);
      const intersects = range.intersectsNode(el);
      setIsSelecting(intersects);
      if (!intersects) {
        prevRangeRef.current = null;
        resetEndOfContent();
        return;
      }

      if (!endDiv) {
        prevRangeRef.current = range.cloneRange();
        return;
      }

      const prevRange = prevRangeRef.current;
      const modifyStart =
        !!prevRange &&
        (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 ||
          range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);

      let anchor: Node | null = modifyStart
        ? range.startContainer
        : range.endContainer;

      if (anchor.nodeType === Node.TEXT_NODE) {
        anchor = anchor.parentNode;
      }

      if (!modifyStart && range.endOffset === 0) {
        let current: Node | null = anchor;
        do {
          while (current && !current.previousSibling) {
            current = current.parentNode;
          }
          current = current?.previousSibling ?? null;
        } while (current && !current.childNodes.length);
        if (current) anchor = current;
      }

      const anchorEl =
        anchor instanceof Element ? anchor : anchor?.parentElement;
      const parentTextLayer = anchorEl?.closest(".textLayer");
      if (!anchorEl || parentTextLayer !== el) {
        resetEndOfContent();
        prevRangeRef.current = range.cloneRange();
        return;
      }

      endDiv.style.width = el.style.width;
      endDiv.style.height = el.style.height;
      endDiv.style.userSelect = "text";
      anchorEl.parentElement?.insertBefore(
        endDiv,
        modifyStart ? anchorEl : anchorEl.nextSibling,
      );
      prevRangeRef.current = range.cloneRange();
    };

    document.addEventListener("selectionchange", handleSelectionChange);

    // Initial check
    handleSelectionChange();

    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [ensureEndOfContent, isSelectMode]);

  // 3. Handle Click Outside (Background Click)
  // Manually clear selection when user clicks on the canvas/background OR empty space in text layer
  useEffect(() => {
    if (!isSelectMode) return;

    const doc = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null;
    };

    const getCaretRangeFromPoint = (x: number, y: number) => {
      if (typeof doc.caretRangeFromPoint === "function") {
        return doc.caretRangeFromPoint(x, y);
      }
      if (typeof doc.caretPositionFromPoint === "function") {
        const position = doc.caretPositionFromPoint(x, y);
        if (!position) return null;
        const range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.collapse(true);
        return range;
      }
      return null;
    };

    const findNearestTextSpan = (
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
    };

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

    const getNearestTextTarget = (
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

    const getTextLayerFromPoint = (x: number, y: number) => {
      const elements = document.elementsFromPoint(x, y);
      for (const element of elements) {
        if (!(element instanceof HTMLElement)) continue;
        const layer = element.closest(".textLayer");
        if (layer instanceof HTMLDivElement) return layer;
      }
      return null;
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
      if (state && !state.didDrag && sel) {
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

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      const activeLayer = textLayerRef.current;
      if (!activeLayer) return;

      // Determine if we clicked on text.
      // We look for 'span' or 'br' which are the text containers in PDF.js text layer.
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
      if (anchorTarget) {
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
          startX: e.clientX,
          startY: e.clientY,
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
        document.addEventListener(
          "pointercancel",
          handleManualPointerEnd,
          true,
        );
        e.preventDefault();
        return;
      }
      if (sel && !sel.isCollapsed) {
        sel.removeAllRanges(); // This triggers 'selectionchange', setting isSelecting to false
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
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
  }, [isSelectMode]);

  // 4. Propagate state change (via global event bus)
  useEffect(() => {
    appEventBus.emit("workspace:textSelectingChange", {
      pageIndex,
      isSelecting,
    });
  }, [isSelecting, pageIndex]);

  // 5. Cleanup on unmount
  useEffect(() => {
    return () => {
      appEventBus.emit("workspace:textSelectingChange", {
        pageIndex,
        isSelecting: false,
      });
    };
  }, [pageIndex]);

  // 6. Rendering Loop & Zoom Handling
  useEffect(() => {
    if (!isInView || !textLayerRef.current) return;

    // If we already rendered for the current scale + rotation, avoid triggering an extra
    // render after `setRenderedScale` / `setPageRotation` updates state.
    if (renderedScale !== null && renderedScale === scale) {
      return;
    }

    // Pause re-rendering if user is currently selecting text to avoid UI jitter
    if (isSelectMode && isSelecting) {
      pendingScaleRef.current = scale;
      return;
    }
    pendingScaleRef.current = null;

    let isCancelled = false;
    const containerAtSchedule = textLayerRef.current;
    const seq = ++renderSeqRef.current;
    const abortController = new AbortController();

    // Debounce rendering to improve performance during rapid zoom
    const isFirstRender = renderedScale === null;
    const debounceMs = isFirstRender ? 0 : 200;

    const timer = setTimeout(() => {
      if (containerAtSchedule) {
        void renderText({
          container: containerAtSchedule,
          targetScale: scale,
          isCancelled: () => isCancelled,
          signal: abortController.signal,
          seq,
        });
      }
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      isCancelled = true;
      abortController.abort();
      if (renderSeqRef.current === seq) setIsRendering(false);
    };
  }, [isInView, isSelectMode, renderedScale, scale, renderText, isSelecting]);

  // 7. Handle Zoom-while-Selecting Recovery
  // If a zoom happened while selecting, we skipped render. Retrigger it now that selection ended.
  useEffect(() => {
    if (!isSelectMode || pendingScaleRef.current === null || isSelecting)
      return;

    // Force a re-render by incrementing sequence or just relying on dependency change.
    // Since 'isSelecting' changed to false, Effect #6 will naturally re-run.
  }, [isSelecting, isSelectMode]);

  // Temporary CSS transform for smooth zooming before re-render
  const textLayerSmoothScale = useMemo(() => {
    if (renderedScale && scale !== renderedScale) {
      return String(scale / renderedScale);
    }
    return undefined;
  }, [scale, renderedScale]);

  const shouldDisplay = isInView || isSelecting;
  const shouldHideByVisibility = !isInView && isSelecting;

  return (
    <div
      ref={textLayerRef}
      className={cn(
        "textLayer",
        isHighlighting && "highlighting",
        isSelecting && "selecting", // Helps CSS hide native selection background if needed
        isRendering && "textLayer-rendering",
        pdfTextLayerDebug && "textLayer-debug",
      )}
      tabIndex={0}
      data-main-rotation={page.rotation ?? 0}
      data-selectable={isSelectMode}
      style={{
        display: shouldDisplay ? "block" : "none",
        visibility: shouldHideByVisibility ? "hidden" : "visible",
        pointerEvents: shouldHideByVisibility ? "none" : undefined,
        cursor,
        "--scale-factor": String(renderedScale ?? scale),
        "--user-unit": String(userUnit),
        ...(textLayerSmoothScale && {
          "--ff-smooth-scale": textLayerSmoothScale,
        }),
        ...(isHighlighting && {
          "--highlight-color": highlightColor,
          "--highlight-opacity": highlightOpacity,
        }),
      }}
    />
  );
};

export default PDFTextLayer;
