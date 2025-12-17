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
}

const PDFTextLayer: React.FC<PDFTextLayerProps> = ({
  pageIndex,
  pdfDocument,
  scale,
  isInView,
  isSelectMode = true,
  cursor,
}) => {
  const textLayerRef = useRef<HTMLDivElement>(null);
  const textLayerInstanceRef = useRef<pdfjsLib.TextLayer | null>(null);

  const [renderedScale, setRenderedScale] = useState<number | null>(null);
  const [pageRotation, setPageRotation] = useState(0);

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
        if (e.target === el) {
          el.classList.add("selecting");
        }
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
        container.style.setProperty(
          "--total-scale-factor",
          `calc(var(--scale-factor) * var(--user-unit))`,
        );
        container.style.setProperty("--scale-round-x", "2px");
        container.style.setProperty("--scale-round-y", "2px");

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
  }, [pdfDocument, pageIndex, scale, isInView]);

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
      className="textLayer"
      tabIndex={0}
      data-main-rotation={pageRotation}
      data-selectable={isSelectMode ? "true" : "false"}
      style={{
        transform: textLayerTransform,
        transformOrigin: "0 0",
        cursor,
      }}
    />
  );
};

export default PDFTextLayer;
