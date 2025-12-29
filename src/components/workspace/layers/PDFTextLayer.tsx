import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../../../lib/cn"; // Adjust path as needed
import * as pdfjsLib from "pdfjs-dist";
import { useEditorStore } from "@/store/useEditorStore";
import { appEventBus } from "@/lib/eventBus";

interface PDFTextLayerProps {
  pageIndex: number;
  pageProxy: pdfjsLib.PDFPageProxy | null;
  scale: number;
  isInView: boolean;
  isSelectMode?: boolean;
  cursor?: React.CSSProperties["cursor"];
  isHighlighting?: boolean;
  highlightColor?: string;
  highlightOpacity?: number;
}

const PDFTextLayer: React.FC<PDFTextLayerProps> = ({
  pageIndex,
  pageProxy,
  scale,
  isInView,
  isSelectMode = true,
  cursor,
  isHighlighting = false,
  highlightColor,
  highlightOpacity,
}) => {
  const textLayerRef = useRef<HTMLDivElement>(null);
  const textLayerInstanceRef = useRef<pdfjsLib.TextLayer | null>(null);

  // Store options for debugging (optional)
  const pdfTextLayerDebug = useEditorStore(
    (s) => s.options.debugOptions.pdfTextLayer,
  );

  const [renderedScale, setRenderedScale] = useState<number | null>(null);
  const [pageRotation, setPageRotation] = useState(0);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isRendering, setIsRendering] = useState(false);

  // Used to manage render sequence and cancellation
  const renderSeqRef = useRef(0);
  // Used to pause rendering during text selection
  const pendingScaleRef = useRef<number | null>(null);

  // Helper: Adds an element to mark the end of content for accessibility/layout
  const ensureEndOfContent = useCallback((container: HTMLDivElement) => {
    if (container.querySelector(":scope > .endOfContent")) return;
    const end = document.createElement("div");
    end.className = "endOfContent";
    container.appendChild(end);
  }, []);

  type RenderTextInnerArgs = {
    container: HTMLDivElement;
    targetScale: number;
    isCancelled: () => boolean;
    setRenderTask: (task: pdfjsLib.TextLayer | null) => void;
  };
  type RenderTextInnerFn = (args: RenderTextInnerArgs) => Promise<void>;
  type RenderTextDecoratedArgs = RenderTextInnerArgs & {
    seq: number;
  };

  const decorateRenderText = useCallback((fn: RenderTextInnerFn) => {
    return async (args: RenderTextDecoratedArgs) => {
      let didHide = false;

      const hideDuringRebuild = () => {
        if (!didHide) {
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
          setRenderTask: args.setRenderTask,
        });
      } catch (error) {
        if (error?.name !== "AbortException") {
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
          setRenderTask,
        }: RenderTextInnerArgs) => {
          if (!pageProxy) return;
          setPageRotation(pageProxy.rotate);
          if (isCancelled()) return;

          const viewport = pageProxy.getViewport({
            scale: targetScale,
            rotation: pageProxy.rotate,
          });

          // Apply CSS variables for correct scaling
          const applyLayerStyles = () => {
            container.style.width = `${viewport.width}px`;
            container.style.height = `${viewport.height}px`;
            container.style.setProperty("--scale-factor", `${targetScale}`);
            container.style.setProperty("--user-unit", `${viewport.userUnit}`);
          };

          // If updating an existing layer (optimization)
          const existingLayer = textLayerInstanceRef.current;
          if (existingLayer) {
            applyLayerStyles();
            await new Promise<void>((resolve) => {
              existingLayer.update({
                viewport,
                onBefore: resolve,
              });
            });
            if (isCancelled()) return;
            setRenderedScale(targetScale);
            return;
          }

          applyLayerStyles();

          // Clean up previous task if any
          textLayerInstanceRef.current?.cancel();
          textLayerInstanceRef.current = null;

          container.innerHTML = "";

          const textContentSource = pageProxy.streamTextContent({});
          const textLayer = new pdfjsLib.TextLayer({
            textContentSource,
            container,
            viewport,
          });

          textLayerInstanceRef.current = textLayer;
          setRenderTask(textLayer);

          await textLayer.render();

          if (isCancelled()) return;
          ensureEndOfContent(container);
          setRenderedScale(targetScale);
        },
      ),
    [decorateRenderText, ensureEndOfContent, pageIndex, pageProxy],
  );

  // 1. Reset state when the PDF page object changes
  useEffect(() => {
    setRenderedScale(null);
    setPageRotation(0);
    setIsSelecting(false);
    setIsRendering(false);

    // Cleanup internal PDF.js text layer instance
    textLayerInstanceRef.current?.cancel();
    textLayerInstanceRef.current = null;

    textLayerRef.current.innerHTML = "";
  }, [pageProxy, pageIndex]);

  // 2. Handle Selection Logic (Web Select API)
  // Replaces the old 'pointerdown' logic with native 'selectionchange'
  useEffect(() => {
    if (!isSelectMode) {
      setIsSelecting(false);
      return;
    }

    const handleSelectionChange = () => {
      const el = textLayerRef.current;
      const sel = window.getSelection();

      // Check if selection exists and is actually selecting text (not collapsed)
      if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setIsSelecting(false);
        return;
      }

      // Check if the current selection intersects with this specific text layer
      const range = sel.getRangeAt(0);
      setIsSelecting(range.intersectsNode(el));
    };

    document.addEventListener("selectionchange", handleSelectionChange);

    // Initial check
    handleSelectionChange();

    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [isSelectMode]);

  // 3. Handle Click Outside (Background Click)
  // Manually clear selection when user clicks on the canvas/background OR empty space in text layer
  useEffect(() => {
    if (!isSelectMode) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;

      // Determine if we clicked on text.
      // We look for 'span' or 'br' which are the text containers in PDF.js text layer.
      const textNode = target.closest("span, br");
      const textLayer = target.closest(".textLayer");

      // If we clicked on text inside a text layer, we do nothing (allow default selection start).
      // We verify both presence to ensure we are interacting with the PDF text layer.
      const isTextClick = textLayer && textNode && textLayer.contains(textNode);

      if (!isTextClick) {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) {
          sel.removeAllRanges(); // This triggers 'selectionchange', setting isSelecting to false
        }
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
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
    if (!pageProxy || !isInView || !textLayerRef.current) return;

    // If we already rendered for the current scale + rotation, avoid triggering an extra
    // render after `setRenderedScale` / `setPageRotation` updates state.
    if (
      renderedScale !== null &&
      renderedScale === scale &&
      pageRotation === pageProxy.rotate
    ) {
      return;
    }

    // Pause re-rendering if user is currently selecting text to avoid UI jitter
    if (isSelectMode && isSelecting) {
      pendingScaleRef.current = scale;
      return;
    }
    pendingScaleRef.current = null;

    let isCancelled = false;
    let renderTask: pdfjsLib.TextLayer | null = null;
    const containerAtSchedule = textLayerRef.current;
    const seq = ++renderSeqRef.current;

    // Debounce rendering to improve performance during rapid zoom
    const isFirstRender = renderedScale === null;
    const debounceMs = isFirstRender ? 0 : 200;

    const timer = setTimeout(() => {
      if (containerAtSchedule) {
        void renderText({
          container: containerAtSchedule,
          targetScale: scale,
          isCancelled: () => isCancelled,
          setRenderTask: (task) => {
            renderTask = task;
          },
          seq,
        });
      }
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      isCancelled = true;
      textLayerInstanceRef.current?.cancel();
      renderTask?.cancel();
      if (renderSeqRef.current === seq) setIsRendering(false);
    };
  }, [
    isInView,
    isSelectMode,
    pageProxy,
    pageRotation,
    renderedScale,
    scale,
    renderText,
    isSelecting,
  ]);

  // 7. Handle Zoom-while-Selecting Recovery
  // If a zoom happened while selecting, we skipped render. Retrigger it now that selection ended.
  useEffect(() => {
    if (!isSelectMode || pendingScaleRef.current === null || isSelecting)
      return;

    // Force a re-render by incrementing sequence or just relying on dependency change.
    // Since 'isSelecting' changed to false, Effect #6 will naturally re-run.
  }, [isSelecting, isSelectMode]);

  // Temporary CSS transform for smooth zooming before re-render
  const textLayerTransform = useMemo(() => {
    if (renderedScale && scale !== renderedScale) {
      return `scale(${scale / renderedScale})`;
    }
    return undefined;
  }, [scale, renderedScale]);

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
      data-main-rotation={pageRotation}
      data-selectable={isSelectMode}
      style={{
        transform: textLayerTransform,
        cursor,
        ...(isHighlighting && {
          "--highlight-color": highlightColor,
          "--highlight-opacity": highlightOpacity,
        }),
      }}
    />
  );
};

export default PDFTextLayer;
