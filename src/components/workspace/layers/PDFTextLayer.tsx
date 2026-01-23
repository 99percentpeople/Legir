import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { PageData } from "@/types";
import { cn } from "@/lib/cn";
import { useEditorStore } from "@/store/useEditorStore";
import { appEventBus } from "@/lib/eventBus";
import { pdfWorkerService } from "@/services/pdfService/pdfWorkerService";
import { createViewportFromPageInfo } from "@/services/pdfService/lib/coords";
import { buildTextLayer } from "../lib/pdfTextLayer";
import { useTextLayerSelection } from "../hooks/useTextLayerSelection";

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

  const userUnit = useMemo(() => page.userUnit ?? 1, [page.userUnit]);
  const pageInfo = useMemo(
    () => ({
      viewBox: page.viewBox,
      userUnit: page.userUnit,
      rotation: page.rotation,
    }),
    [page.viewBox, page.userUnit, page.rotation],
  );

  const {
    pagePortalEl,
    isDraggingSelectionHandle,
    isPointerSelectingText,
    selectionHandles,
    startSelectionHandleDrag,
  } = useTextLayerSelection({
    pageIndex,
    textLayerRef,
    isSelectMode,
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

  // 6. Handle Zoom-while-Selecting Recovery
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
      {pagePortalEl &&
        isSelectMode &&
        (isDraggingSelectionHandle ||
          selectionHandles.start ||
          selectionHandles.end) &&
        createPortal(
          <div
            className="ff-text-selection-handles-layer"
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
