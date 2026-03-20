import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { PageData, PDFSearchResult } from "@/types";
import { cn } from "@/utils/cn";
import { useEditorStore } from "@/store/useEditorStore";
import { appEventBus } from "@/lib/eventBus";
import { useAppEvent } from "@/hooks/useAppEventBus";
import {
  PDF_TEXT_SELECTION_HANDLE_DOT_SIZE_PX,
  PDF_TEXT_SELECTION_HANDLE_STEM_WIDTH_PX,
  PDF_TEXT_SELECTION_HANDLE_WIDTH_PX,
} from "@/constants";
import { pdfWorkerService } from "@/services/pdfService/pdfWorkerService";
import { createViewportFromPageInfo } from "@/services/pdfService/lib/coords";
import { buildTextLayer } from "../lib/pdfTextLayer";
import { useTextLayerSelection } from "../hooks/useTextLayerSelection";
import { useDeferredRenderScale } from "../hooks/useDeferredRenderScale";
import {
  getPdfSearchHighlightRects,
  selectPdfSearchTextRange,
} from "../lib/pdfSearchHighlights";
import {
  reportPDFPageRenderLayerReady,
  reportPDFPageRenderLayerState,
} from "../debug/pdfPageRenderTelemetry";

interface PDFTextLayerProps {
  page: PageData;
  scale: number;
  isInView: boolean;
  isSelectMode?: boolean;
  cursor?: React.CSSProperties["cursor"];
  isHighlighting?: boolean;
  highlightColor?: string;
  highlightOpacity?: number;
  searchResults?: PDFSearchResult[];
  activeSearchResultId?: string | null;
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
  searchResults = [],
  activeSearchResultId = null,
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
  const [hasSelectableText, setHasSelectableText] = useState(false);
  const [searchHighlightRects, setSearchHighlightRects] = useState<
    Array<{
      key: string;
      left: number;
      top: number;
      width: number;
      height: number;
      isActive: boolean;
    }>
  >([]);
  const pendingTextRangeFocusRef = useRef<{
    pageIndex: number;
    startOffset: number;
    endOffset: number;
    rect: { x: number; y: number; width: number; height: number };
    behavior?: "auto" | "smooth";
    skipScroll?: boolean;
  } | null>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const endOfContentRef = useRef<HTMLDivElement | null>(null);
  const prevRangeRef = useRef<Range | null>(null);

  const userUnit = useMemo(() => page.userUnit ?? 1, [page.userUnit]);
  const pageInfo = useMemo(
    () => ({
      viewBox: page.viewBox,
      userUnit: page.userUnit,
      rotation: page.rotation,
    }),
    [page.viewBox, page.userUnit, page.rotation],
  );
  const pageRenderIdentity = useMemo(
    () =>
      `${pageIndex}:${page.rotation}:${page.userUnit}:${page.viewBox.join(",")}`,
    [page.pageIndex, page.rotation, page.userUnit, page.viewBox],
  );
  // Keep the current text layer visually scaled during zoom and only rebuild the
  // DOM after the zoom input has settled for a short idle window.
  const renderScale = useDeferredRenderScale({
    identity: pageRenderIdentity,
    scale,
    immediate: renderedScale === null,
  });

  const {
    pagePortalEl,
    isDraggingSelectionHandle,
    isPointerSelectingText,
    selectionHandles,
    startSelectionHandleDrag,
  } = useTextLayerSelection({
    pageIndex,
    textLayerRef,
    isSelectMode: isSelectMode && hasSelectableText,
    scale,
    renderedScale,
    isInView,
  });

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

  const applyPendingTextRangeFocus = useCallback(() => {
    const pending = pendingTextRangeFocusRef.current;
    const root = textLayerRef.current;
    if (!pending || pending.pageIndex !== pageIndex || !root) return false;
    if (!isInView || renderedScale === null) return false;

    const didSelect = selectPdfSearchTextRange(
      root,
      pending.startOffset,
      pending.endOffset,
      scrollContainerRef.current
        ? { restoreScrollTarget: { element: scrollContainerRef.current } }
        : undefined,
    );
    if (!didSelect) return false;

    pendingTextRangeFocusRef.current = null;
    appEventBus.clearSticky("workspace:focusTextRange");
    return true;
  }, [isInView, pageIndex, renderedScale]);

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
          if (!textContent) {
            container.replaceChildren();
            endOfContentRef.current = null;
            setHasSelectableText(false);
            setRenderedScale(targetScale);
            reportPDFPageRenderLayerReady({
              pageIndex,
              layer: "text",
              scale: targetScale,
              completedAt: performance.now(),
            });
            return;
          }

          const staging = document.createElement("div");
          setLayerVars(staging, targetScale);
          buildTextLayer(staging, textContent, viewport);

          if (isCancelled()) return;

          syncTextLayerContainerStyles(staging, container);

          container.replaceChildren(...Array.from(staging.childNodes));
          const nextHasSelectableText =
            container.querySelector("span[role='presentation']") !== null;
          if (nextHasSelectableText) {
            ensureEndOfContent(container);
          } else {
            endOfContentRef.current = null;
          }
          setHasSelectableText(nextHasSelectableText);
          setRenderedScale(targetScale);
          reportPDFPageRenderLayerReady({
            pageIndex,
            layer: "text",
            scale: targetScale,
            completedAt: performance.now(),
          });
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
    setHasSelectableText(false);
    setSearchHighlightRects([]);
    pendingTextRangeFocusRef.current = null;
    endOfContentRef.current = null;
    prevRangeRef.current = null;

    if (textLayerRef.current) {
      textLayerRef.current.innerHTML = "";
    }
  }, [pageIndex, pageInfo]);

  // 2. Handle Selection Logic (Web Select API)
  // Replaces the old 'pointerdown' logic with native 'selectionchange'
  useEffect(() => {
    if (!isSelectMode || !hasSelectableText) {
      setIsSelecting(false);
      prevRangeRef.current = null;
      const container = textLayerRef.current;
      const endDiv = endOfContentRef.current;
      if (container && endDiv) {
        endDiv.remove();
      }
      endOfContentRef.current = null;
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
  }, [ensureEndOfContent, hasSelectableText, isSelectMode]);

  // 3. Propagate state change (via global event bus)
  useEffect(() => {
    appEventBus.emit("workspace:textSelectingChange", {
      pageIndex,
      isSelecting,
    });
  }, [isSelecting, pageIndex]);

  // 4. Cleanup on unmount
  useEffect(() => {
    return () => {
      appEventBus.emit("workspace:textSelectingChange", {
        pageIndex,
        isSelecting: false,
      });
    };
  }, [pageIndex]);

  // 5. Rendering Loop & Zoom Handling
  useEffect(() => {
    if (!isInView || !textLayerRef.current) return;

    // If we already rendered for the current scale + rotation, avoid triggering an extra
    // render after `setRenderedScale` / `setPageRotation` updates state.
    if (renderedScale !== null && renderedScale === renderScale) {
      return;
    }

    // Pause re-rendering if user is currently selecting text to avoid UI jitter
    if (isSelectMode && hasSelectableText && isSelecting) {
      pendingScaleRef.current = renderScale;
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
          targetScale: renderScale,
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
  }, [
    isInView,
    hasSelectableText,
    isSelectMode,
    isSelecting,
    renderScale,
    renderText,
    renderedScale,
  ]);

  // 6. Handle Zoom-while-Selecting Recovery
  // If a zoom happened while selecting, we skipped render. Retrigger it now that selection ended.
  useEffect(() => {
    if (
      !isSelectMode ||
      !hasSelectableText ||
      pendingScaleRef.current === null ||
      isSelecting
    )
      return;

    // Force a re-render by incrementing sequence or just relying on dependency change.
    // Since 'isSelecting' changed to false, Effect #6 will naturally re-run.
  }, [hasSelectableText, isSelecting, isSelectMode]);

  useAppEvent(
    "workspace:scrollContainerReady",
    ({ element }) => {
      scrollContainerRef.current = element;
    },
    { replayLast: true },
  );

  useAppEvent(
    "workspace:focusTextRange",
    (payload) => {
      if (payload.pageIndex !== pageIndex) return;
      pendingTextRangeFocusRef.current = payload;
      applyPendingTextRangeFocus();
    },
    { replayLast: true },
  );

  useEffect(() => {
    applyPendingTextRangeFocus();
  }, [applyPendingTextRangeFocus]);

  // Temporary CSS transform for smooth zooming before re-render
  const textLayerSmoothScale = useMemo(() => {
    if (renderedScale && scale !== renderedScale) {
      return String(scale / renderedScale);
    }
    return undefined;
  }, [scale, renderedScale]);

  const shouldDisplay = isInView || isSelecting;
  const shouldHideByVisibility = !isInView && isSelecting;

  useEffect(() => {
    if (!isInView || renderedScale !== renderScale) {
      return;
    }

    reportPDFPageRenderLayerReady({
      pageIndex,
      layer: "text",
      scale: renderScale,
      completedAt: performance.now(),
    });
  }, [isInView, pageIndex, renderScale, renderedScale]);

  useEffect(() => {
    if (!isInView) {
      return;
    }

    reportPDFPageRenderLayerState({
      pageIndex,
      layer: "text",
      ready: renderedScale === renderScale,
      scale: renderScale,
    });
  }, [isInView, pageIndex, renderScale, renderedScale]);

  useEffect(() => {
    if (!textLayerRef.current || !isInView || renderedScale === null) {
      setSearchHighlightRects([]);
      return;
    }

    if (searchResults.length === 0) {
      setSearchHighlightRects([]);
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      if (!textLayerRef.current) return;
      setSearchHighlightRects(
        getPdfSearchHighlightRects(
          textLayerRef.current,
          searchResults,
          activeSearchResultId,
        ),
      );
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activeSearchResultId, isInView, renderedScale, searchResults]);

  return (
    <>
      <div
        ref={textLayerRef}
        className={cn(
          "textLayer",
          isHighlighting && "highlighting",
          isSelecting && "selecting", // Helps CSS hide native selection background if needed
          isRendering && "textLayer-rendering",
          pdfTextLayerDebug && "textLayer-debug",
        )}
        tabIndex={hasSelectableText ? 0 : -1}
        data-main-rotation={page.rotation ?? 0}
        data-selectable={isSelectMode && hasSelectableText}
        style={{
          display: shouldDisplay ? "block" : "none",
          visibility: shouldHideByVisibility ? "hidden" : "visible",
          pointerEvents:
            shouldHideByVisibility || !hasSelectableText ? "none" : undefined,
          cursor: hasSelectableText ? cursor : undefined,
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
      {searchHighlightRects.length > 0 && (
        <div className="ff-pdf-search-hit-rect-layer">
          {searchHighlightRects.map((rect) => (
            <div
              key={rect.key}
              className={cn(
                "ff-pdf-search-hit-rect",
                rect.isActive && "ff-pdf-search-hit-rect--active",
              )}
              style={{
                left: `${rect.left * 100}%`,
                top: `${rect.top * 100}%`,
                width: `${rect.width * 100}%`,
                height: `${rect.height * 100}%`,
              }}
            />
          ))}
        </div>
      )}
      {pagePortalEl &&
        isSelectMode &&
        (isDraggingSelectionHandle ||
          selectionHandles.start ||
          selectionHandles.end) &&
        createPortal(
          <div
            className="ff-text-selection-handles-layer"
            style={{
              "--ff-text-selection-handle-width": `${PDF_TEXT_SELECTION_HANDLE_WIDTH_PX}px`,
              "--ff-text-selection-handle-dot-size": `${PDF_TEXT_SELECTION_HANDLE_DOT_SIZE_PX}px`,
              "--ff-text-selection-handle-stem-width": `${PDF_TEXT_SELECTION_HANDLE_STEM_WIDTH_PX}px`,
            }}
            data-ff-handle-dragging={
              isDraggingSelectionHandle ? "1" : undefined
            }
            data-ff-pointer-selecting={isPointerSelectingText ? "1" : undefined}
          >
            {selectionHandles.start && (
              <div
                data-handle-kind="start"
                className="ff-text-selection-handle"
                style={{
                  left: selectionHandles.start.left,
                  top: selectionHandles.start.top,
                  height: selectionHandles.start.height,
                  ...(typeof selectionHandles.start.rotateDeg === "number" && {
                    transform: `rotate(${selectionHandles.start.rotateDeg}deg)`,
                    transformOrigin: "50% 0%",
                  }),
                }}
              >
                <div className="ff-text-selection-handle__stem" />
                <div
                  data-ff-selection-handle="1"
                  className="ff-text-selection-handle__dot"
                  onPointerDown={(e) => startSelectionHandleDrag("start", e)}
                />
              </div>
            )}
            {selectionHandles.end && (
              <div
                data-handle-kind="end"
                className="ff-text-selection-handle"
                style={{
                  left: selectionHandles.end.left,
                  top: selectionHandles.end.top,
                  height: selectionHandles.end.height,
                  ...(typeof selectionHandles.end.rotateDeg === "number" && {
                    transform: `rotate(${selectionHandles.end.rotateDeg}deg)`,
                    transformOrigin: "50% 100%",
                  }),
                }}
              >
                <div className="ff-text-selection-handle__stem" />
                <div
                  data-ff-selection-handle="1"
                  className="ff-text-selection-handle__dot"
                  onPointerDown={(e) => startSelectionHandleDrag("end", e)}
                />
              </div>
            )}
          </div>,
          pagePortalEl,
        )}
    </>
  );
};

export default PDFTextLayer;
