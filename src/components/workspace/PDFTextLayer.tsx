import React, { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import * as pdfjsLib from "pdfjs-dist";

interface PDFTextLayerProps {
  pageIndex: number;
  pdfDocument: pdfjsLib.PDFDocumentProxy;
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
  pdfDocument,
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
  const pendingScaleRef = useRef<number | null>(null);

  const [renderedScale, setRenderedScale] = useState<number | null>(null);
  const [pageRotation, setPageRotation] = useState(0);
  const [renderRetryToken, setRenderRetryToken] = useState(0);

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

  // Reset state when page changes
  useEffect(() => {
    setRenderedScale(null);
    setPageRotation(0);
    if (textLayerInstanceRef.current?.cancel) {
      textLayerInstanceRef.current.cancel();
    }
    textLayerInstanceRef.current = null;
    if (textLayerRef.current) {
      textLayerRef.current.innerHTML = "";
    }
  }, [pdfDocument, pageIndex]);

  // Toggle .selecting class to assist CSS selection rules
  useEffect(() => {
    const el = textLayerRef.current;
    if (el && isSelectMode) {
      const onDown = (e: MouseEvent) => {
        if (e.button !== 0) return;
        const target = e.target as Node | null;
        if (!target) return;
        if (!el.contains(target)) return;
        el.classList.add("selecting");
      };
      const onUp = () => el.classList.remove("selecting");
      el.addEventListener("mousedown", onDown);
      window.addEventListener("mouseup", onUp);
      return () => {
        el.removeEventListener("mousedown", onDown);
        window.removeEventListener("mouseup", onUp);
        el.classList.remove("selecting");
      };
    }
  }, [isSelectMode]);

  useEffect(() => {
    if (!pdfDocument || !isInView || !textLayerRef.current) return;

    if (isSelectMode && isActiveSelectionInThisLayer()) {
      pendingScaleRef.current = scale;
      return;
    }
    pendingScaleRef.current = null;

    let isCancelled = false;
    let renderTask: pdfjsLib.TextLayer | null = null;

    const renderText = async () => {
      try {
        if (textLayerInstanceRef.current?.cancel) {
          textLayerInstanceRef.current.cancel();
        }
        textLayerInstanceRef.current = null;

        // Always render at the target scale for correct selection geometry
        const targetScale = scale;
        const page = await pdfDocument.getPage(pageIndex + 1);
        setPageRotation(page.rotate);
        if (isCancelled) return;

        // Pass rotation to getViewport so PDF.js handles rotation natively
        const viewport = page.getViewport({
          scale: targetScale,
          rotation: page.rotate,
        });

        const container = textLayerRef.current;
        if (!container) return;

        container.innerHTML = "";
        container.style.width = `${viewport.width}px`;
        container.style.height = `${viewport.height}px`;
        container.style.setProperty("--scale-factor", `${targetScale}`);
        container.style.setProperty("--user-unit", `${viewport.userUnit}`);

        const textContentSource = page.streamTextContent({});

        const textLayer = new pdfjsLib.TextLayer({
          textContentSource,
          container,
          viewport,
        });

        textLayerInstanceRef.current = textLayer;
        renderTask = textLayer;
        await textLayer.render();

        if (isCancelled) return;
        ensureEndOfContent(container);
        setRenderedScale(targetScale);
      } catch (error) {
        if (error?.name !== "RenderingCancelledException") {
          console.error("Text Layer Render error:", error);
        }
      }
    };

    // Debounce re-renders during zoom to improve performance,
    // but use CSS transform (scale) temporarily in the meantime.
    const isFirstRender = renderedScale === null;
    const debounceMs = isFirstRender ? 0 : 200;

    const timer = setTimeout(renderText, debounceMs);

    return () => {
      clearTimeout(timer);
      isCancelled = true;
      if (textLayerInstanceRef.current?.cancel) {
        textLayerInstanceRef.current.cancel();
      }
      if (renderTask?.cancel) {
        renderTask.cancel();
      }
    };
  }, [pdfDocument, pageIndex, scale, isInView, isSelectMode, renderRetryToken]);

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
      className={cn("textLayer", isHighlighting && "highlighting")}
      tabIndex={0}
      data-main-rotation={pageRotation}
      data-selectable={isSelectMode ? "true" : "false"}
      style={{
        transform: textLayerTransform,
        cursor,
        ...(isHighlighting
          ? ({
              "--highlight-color": highlightColor,
              "--highlight-opacity": highlightOpacity,
            } as React.CSSProperties)
          : null),
      }}
    />
  );
};

export default PDFTextLayer;
