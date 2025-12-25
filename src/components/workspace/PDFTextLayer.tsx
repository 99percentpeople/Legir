import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../../lib/utils";
import * as pdfjsLib from "pdfjs-dist";
import { useEditorStore } from "@/store/useEditorStore";

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
  onSelectingChange?: (isSelecting: boolean) => void;
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
  onSelectingChange,
}) => {
  const textLayerRef = useRef<HTMLDivElement>(null);
  const textLayerInstanceRef = useRef<pdfjsLib.TextLayer | null>(null);
  const pendingScaleRef = useRef<number | null>(null);

  const pdfTextLayerDebug = useEditorStore(
    (s) => s.options.debugOptions.pdfTextLayer,
  );

  const [renderedScale, setRenderedScale] = useState<number | null>(null);
  const [pageRotation, setPageRotation] = useState(0);
  const [renderRetryToken, setRenderRetryToken] = useState(0);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const renderSeqRef = useRef(0);

  const isActiveSelectionInThisLayer = () => {
    const el = textLayerRef.current;
    if (!el) return false;

    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;

    const range = sel.getRangeAt(0);
    const commonNode = range.commonAncestorContainer;
    const commonEl =
      commonNode instanceof Element
        ? commonNode
        : commonNode.parentElement || null;
    const layer = commonEl?.closest?.(".textLayer");
    return layer === el;
  };

  const ensureEndOfContent = (container: HTMLDivElement) => {
    const existing = container.querySelector(":scope > .endOfContent");
    if (existing) return;
    const end = document.createElement("div");
    end.className = "endOfContent";
    container.appendChild(end);
  };

  const renderText = useCallback(
    async ({
      container,
      targetScale,
      isCancelled,
      hideDuringRebuild,
      showAfterStabilize,
      setRenderTask,
    }: {
      container: HTMLDivElement;
      targetScale: number;
      isCancelled: () => boolean;
      hideDuringRebuild: () => void;
      showAfterStabilize: () => void;
      setRenderTask: (task: pdfjsLib.TextLayer | null) => void;
    }) => {
      try {
        if (!pageProxy) return;
        setPageRotation(pageProxy.rotate);
        if (isCancelled()) return;

        const viewport = pageProxy.getViewport({
          scale: targetScale,
          rotation: pageProxy.rotate,
        });

        const applyLayerStyles = () => {
          container.style.width = `${viewport.width}px`;
          container.style.height = `${viewport.height}px`;
          container.style.setProperty("--scale-factor", `${targetScale}`);
          container.style.setProperty("--user-unit", `${viewport.userUnit}`);
        };

        applyLayerStyles();

        const existingLayer = textLayerInstanceRef.current;
        if (existingLayer) {
          existingLayer.update({
            viewport,
            onBefore: applyLayerStyles,
          });
          if (isCancelled()) return;
          setRenderedScale(targetScale);
          return;
        }

        if (textLayerInstanceRef.current?.cancel) {
          textLayerInstanceRef.current.cancel();
        }
        textLayerInstanceRef.current = null;

        hideDuringRebuild();
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
      } catch (error) {
        // if (error?.name !== "RenderingCancelledException") {
        console.error("Text Layer Render error:", error);
        // }
      } finally {
        showAfterStabilize();
      }
    },
    [pageProxy],
  );

  // Reset state when page changes
  useEffect(() => {
    setRenderedScale(null);
    setPageRotation(0);
    setIsSelecting(false);
    setIsRendering(false);
    if (textLayerInstanceRef.current?.cancel) {
      textLayerInstanceRef.current.cancel();
    }
    textLayerInstanceRef.current = null;
    if (textLayerRef.current) {
      textLayerRef.current.innerHTML = "";
    }
  }, [pageProxy, pageIndex]);

  // Toggle .selecting class to assist CSS selection rules
  useEffect(() => {
    const el = textLayerRef.current;
    if (el && isSelectMode) {
      const onDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        const target = e.target as Node | null;
        if (!target) return;
        if (!el.contains(target)) return;
        setIsSelecting(true);
      };
      const onUp = () => setIsSelecting(false);
      const onCancel = () => setIsSelecting(false);
      el.addEventListener("pointerdown", onDown);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      return () => {
        el.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        setIsSelecting(false);
      };
    }
    setIsSelecting(false);
  }, [isSelectMode]);

  useEffect(() => {
    onSelectingChange?.(isSelecting);
  }, [isSelecting, onSelectingChange]);

  useEffect(() => {
    return () => {
      onSelectingChange?.(false);
    };
  }, [onSelectingChange]);

  useEffect(() => {
    if (!pageProxy || !isInView || !textLayerRef.current) return;

    if (isSelectMode && isActiveSelectionInThisLayer()) {
      pendingScaleRef.current = scale;
      return;
    }
    pendingScaleRef.current = null;

    let isCancelled = false;
    let renderTask: pdfjsLib.TextLayer | null = null;
    const containerAtSchedule = textLayerRef.current;
    const seq = ++renderSeqRef.current;
    let didHide = false;

    const hideDuringRebuild = () => {
      if (didHide) return;
      setIsRendering(true);
      didHide = true;
    };

    const showAfterStabilize = () => {
      if (!didHide) return;
      requestAnimationFrame(() => {
        if (renderSeqRef.current !== seq) return;
        setIsRendering(false);
      });
    };

    // Debounce re-renders during zoom to improve performance,
    // but use CSS transform (scale) temporarily in the meantime.
    const isFirstRender = renderedScale === null;
    const debounceMs = isFirstRender ? 0 : 200;

    const timer = setTimeout(() => {
      const container = containerAtSchedule;
      if (!container) return;

      void renderText({
        container,
        targetScale: scale,
        isCancelled: () => isCancelled,
        hideDuringRebuild,
        showAfterStabilize,
        setRenderTask: (task) => {
          renderTask = task;
        },
      });
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      isCancelled = true;
      if (textLayerInstanceRef.current?.cancel) {
        textLayerInstanceRef.current.cancel();
      }
      if (renderTask?.cancel) {
        renderTask.cancel();
      }

      if (renderSeqRef.current === seq) {
        setIsRendering(false);
      }
    };
  }, [isInView, isSelectMode, pageProxy, renderedScale, scale, renderText]);

  useEffect(() => {
    if (!isSelectMode) return;

    const handleSelectionChange = () => {
      if (pendingScaleRef.current === null) return;

      const sel = window.getSelection?.();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) return;

      pendingScaleRef.current = null;
      setRenderRetryToken((t) => t + 1);
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [isSelectMode]);

  // Calculate temporary transform if rendered scale doesn't match current scale (zooming)
  // Note: No rotation here because we use native viewport rotation
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
        isSelecting && "selecting",
        isRendering && "textLayer--rendering",
      )}
      tabIndex={0}
      data-main-rotation={pageRotation}
      data-selectable={isSelectMode}
      data-debug={pdfTextLayerDebug ? "1" : undefined}
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
