import React, { useEffect, useRef, useState, useMemo } from "react";
import { cn } from "../../lib/utils";
import * as pdfjsLib from "pdfjs-dist";
import * as pdfjsViewer from "pdfjs-dist/web/pdf_viewer.mjs";
import PdfWorker from "pdfjs-dist/build/pdf.worker.mjs?worker";
import { pdfWorkerService } from "../../services/pdfWorkerService";

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker({
  name: "pdfjs-worker",
});

interface PDFPageProps {
  pageIndex: number;
  pdfDocument: pdfjsLib.PDFDocumentProxy;
  scale: number;
  width: number;
  height: number;
  placeholderImage?: string; // Optional low-res image if we have one
  isSelectMode?: boolean;
}

const PDFPage: React.FC<PDFPageProps> = ({
  pageIndex,
  pdfDocument,
  scale,
  width,
  height,
  placeholderImage,
  isSelectMode = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Double buffering: Two canvases to prevent flickering during resize/re-render
  const canvasARef = useRef<HTMLCanvasElement>(null);
  const canvasBRef = useRef<HTMLCanvasElement>(null);

  const [activeCanvas, setActiveCanvas] = useState<"A" | "B">("A");
  const [isRendered, setIsRendered] = useState(false);
  const [isInView, setIsInView] = useState(false);

  const renderedScaleRef = useRef<number | null>(null);

  const textLayerRef = useRef<HTMLDivElement>(null);
  const textRenderTaskRef = useRef<any>(null);
  const [textLayerRenderedScale, setTextLayerRenderedScale] = useState<
    number | null
  >(null);
  const [pageRotation, setPageRotation] = useState(0);

  // Stable IDs for canvas elements to allow reuse in Worker
  const componentId = useRef(Math.random().toString(36).substr(2, 9));
  const canvasAId = useRef(`${componentId.current}-A`);
  const canvasBId = useRef(`${componentId.current}-B`);
  const isATransferred = useRef(false);
  const isBTransferred = useRef(false);

  // Intersection Observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setIsInView(entry.isIntersecting);
        });
      },
      { rootMargin: "200px" },
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      if (containerRef.current) {
        observer.unobserve(containerRef.current);
      }
    };
  }, []);

  // Rendering Logic with Double Buffering and Debounce
  useEffect(() => {
    if (!pdfDocument) return;

    // Only render if in viewport
    if (!isInView) {
      return;
    }

    // Optimization: If already rendered at this scale, skip.
    if (renderedScaleRef.current === scale) {
      return;
    }

    let abortController: AbortController | null = null;
    let renderTimeout: ReturnType<typeof setTimeout> | null = null;

    const render = async (signal: AbortSignal): Promise<boolean> => {
      // activeCanvas === "A", target is B.
      const targetCanvasRef = activeCanvas === "A" ? canvasBRef : canvasARef;
      const targetCanvas = targetCanvasRef.current;

      if (!targetCanvas) return false;

      const targetId =
        activeCanvas === "A" ? canvasBId.current : canvasAId.current;
      const isTransferred =
        activeCanvas === "A" ? isBTransferred.current : isATransferred.current;

      try {
        if (signal.aborted) return false;

        // Optimization: Limit max DPR to 2
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        // Note: We don't set width/height here for OffscreenCanvas,
        // but we set it on the placeholder to ensure layout is correct.
        // The worker handles the actual bitmap size.

        const viewport = (await pdfDocument.getPage(pageIndex + 1)).getViewport(
          {
            scale: scale * dpr,
          },
        );

        let offscreenCanvas: OffscreenCanvas | undefined;

        if (!isTransferred) {
          targetCanvas.width = viewport.width;
          targetCanvas.height = viewport.height;
          offscreenCanvas = targetCanvas.transferControlToOffscreen();

          // Update transferred state immediately to prevent race conditions
          if (activeCanvas === "A") isBTransferred.current = true;
          else isATransferred.current = true;
        }

        // We pass the tile size to the worker
        const success = await pdfWorkerService.renderPage({
          pageIndex,
          scale: scale * dpr,
          canvas: offscreenCanvas,
          canvasId: targetId,
          priority: isInView ? 1 : 0,
          tileWidth: viewport.width,
          tileHeight: viewport.height,
          signal: signal,
        });

        // Return true if completed successfully
        if (!signal.aborted) {
          return success;
        }
        return false;
      } catch (error: any) {
        // Ignore cancellation errors
        if (
          error?.name !== "RenderingCancelledException" &&
          error?.name !== "AbortError"
        ) {
          console.error("Render error:", error);
        }
        return false;
      }
    };

    // Debounce to handle continuous zooming - increased delay for large docs
    renderTimeout = setTimeout(() => {
      abortController = new AbortController();
      render(abortController.signal).then((ok) => {
        if (!ok) return;
        const targetId = activeCanvas === "A" ? "B" : "A";
        setActiveCanvas(targetId);
        setIsRendered(true);
        renderedScaleRef.current = scale;
      });
    }, 200); // 200ms delay to settle zoom

    return () => {
      if (renderTimeout) clearTimeout(renderTimeout);
      if (abortController) {
        abortController.abort();
      }
    };
    // Re-run if visibility changes or scale/doc changes
  }, [isInView, pdfDocument, pageIndex, scale]);

  // --- Text Layer Rendering ---
  useEffect(() => {
    if (!pdfDocument || !isInView || !textLayerRef.current) return;

    // Optimization: If already rendered at ANY scale, do NOT re-render.
    // We rely purely on CSS scaling (transform: scale(...)) for zoom updates.
    if (textLayerRenderedScale !== null) {
      return;
    }

    let isCancelled = false;

    const renderText = async () => {
      try {
        if (textRenderTaskRef.current) {
          // If there's a running task (unlikely given the check above, but for safety)
          if (textRenderTaskRef.current.cancel) {
            textRenderTaskRef.current.cancel();
          }
          textRenderTaskRef.current = null;
        }

        // Render at the CURRENT scale (whatever it is when first loaded)
        const initialScale = scale;
        const page = await pdfDocument.getPage(pageIndex + 1);
        setPageRotation(page.rotate);
        if (isCancelled) return;

        const viewport = page.getViewport({
          scale: initialScale,
          rotation: 0, // Force 0 rotation so we can handle it via CSS
        });

        if (textLayerRef.current) {
          textLayerRef.current.style.width = `${Math.floor(viewport.width)}px`;
          textLayerRef.current.style.height = `${Math.floor(
            viewport.height,
          )}px`;
          textLayerRef.current.style.setProperty(
            "--total-scale-factor",
            `${initialScale}`,
          );
        }

        if (pdfjsViewer.TextLayerBuilder) {
          const textLayerBuilder = new pdfjsViewer.TextLayerBuilder({
            pdfPage: page,
          });

          await textLayerBuilder.render({
            viewport: viewport,
          });

          if (isCancelled) return;

          if (textLayerRef.current) {
            textLayerRef.current.innerHTML = "";
            textLayerRef.current.appendChild(textLayerBuilder.div);
          }

          textRenderTaskRef.current = textLayerBuilder;
          setTextLayerRenderedScale(initialScale);
        }
      } catch (error: any) {
        if (error?.name !== "RenderingCancelledException") {
          console.error("Text Layer Render error:", error);
        }
      }
    };

    renderText();

    return () => {
      isCancelled = true;
      if (textRenderTaskRef.current && textRenderTaskRef.current.cancel) {
        textRenderTaskRef.current.cancel();
      }
    };
  }, [pdfDocument, pageIndex, scale, isInView]);

  // Calculate text layer transform
  const textLayerTransform = useMemo(() => {
    let transform = "";

    // 1. Scale
    if (textLayerRenderedScale) {
      transform += `scale(${scale / textLayerRenderedScale})`;
    }

    // 2. Rotate and Translate
    if (pageRotation !== 0) {
      transform += ` rotate(${pageRotation}deg)`;

      switch (pageRotation) {
        case 90:
          transform += ` translate(0, -100%)`;
          break;
        case 180:
          transform += ` translate(-100%, -100%)`;
          break;
        case 270:
          transform += ` translate(-100%, 0)`;
          break;
      }
    }

    return transform || "none";
  }, [scale, textLayerRenderedScale, pageRotation]);

  return (
    <div
      ref={containerRef}
      className="relative z-0 origin-top bg-white shadow-lg transition-shadow hover:shadow-xl"
      style={{
        width: width * scale,
        height: height * scale,
      }}
    >
      {/* Placeholder Image (Low Res / Lazy Load) */}
      {!isRendered && placeholderImage && (
        <img
          src={placeholderImage}
          className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-50 blur-sm"
          alt="Loading..."
        />
      )}

      {/* Loading Spinner */}
      {!isRendered && !placeholderImage && (
        <div className="text-muted-foreground pointer-events-none absolute inset-0 flex items-center justify-center bg-gray-50">
          <div className="border-primary h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"></div>
        </div>
      )}

      {/* Canvas A */}
      <canvas
        ref={canvasARef}
        className={cn(
          "absolute inset-0 block h-full w-full",
          activeCanvas === "B" && "hidden",
        )}
      />

      {/* Canvas B */}
      <canvas
        ref={canvasBRef}
        className={cn(
          "absolute inset-0 block h-full w-full",
          activeCanvas === "A" && "hidden",
        )}
      />

      {/* Text Layer */}
      <div
        ref={textLayerRef}
        className={cn("textLayer", !isSelectMode && "pointer-events-none")}
        style={{
          transform: textLayerTransform,
          transformOrigin: "0 0",
        }}
      />
    </div>
  );
};

export default PDFPage;
