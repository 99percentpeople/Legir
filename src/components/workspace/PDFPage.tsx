import React, { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import * as pdfjsLib from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.mjs?worker";
import { pdfWorkerService } from "../../services/pdfWorkerService";
import PDFTextLayer from "./PDFTextLayer";

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
  textLayerCursor?: React.CSSProperties["cursor"];
}

const PDFPage: React.FC<PDFPageProps> = ({
  pageIndex,
  pdfDocument,
  scale,
  width,
  height,
  placeholderImage,
  isSelectMode = true,
  textLayerCursor,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Double buffering: Two canvases to prevent flickering during resize/re-render
  const canvasARef = useRef<HTMLCanvasElement>(null);
  const canvasBRef = useRef<HTMLCanvasElement>(null);

  const [activeCanvas, setActiveCanvas] = useState<"A" | "B">("A");
  const [isRendered, setIsRendered] = useState(false);
  const [isInView, setIsInView] = useState(false);

  const renderedScaleRef = useRef<number | null>(null);

  // Stable IDs for canvas elements to allow reuse in Worker
  const componentId = useRef(Math.random().toString(36).substr(2, 9));
  const canvasAId = useRef(`${componentId.current}-A`);
  const canvasBId = useRef(`${componentId.current}-B`);
  const isATransferred = useRef(false);
  const isBTransferred = useRef(false);
  // Cache for detached OffscreenCanvas objects to prevent loss during pre-send aborts
  const detachedCanvasARef = useRef<OffscreenCanvas | null>(null);
  const detachedCanvasBRef = useRef<OffscreenCanvas | null>(null);

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
    let rafId: number | null = null;

    const render = async (signal: AbortSignal): Promise<boolean> => {
      // activeCanvas === "A", target is B.
      const targetCanvasRef = activeCanvas === "A" ? canvasBRef : canvasARef;
      const targetCanvas = targetCanvasRef.current;

      if (!targetCanvas) return false;

      const targetId =
        activeCanvas === "A" ? canvasBId.current : canvasAId.current;
      const isTransferredRef =
        activeCanvas === "A" ? isBTransferred : isATransferred;
      const detachedCanvasRef =
        activeCanvas === "A" ? detachedCanvasBRef : detachedCanvasARef;

      let offscreenCanvas: OffscreenCanvas | undefined;

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

        if (!isTransferredRef.current) {
          if (detachedCanvasRef.current) {
            // Use cached canvas if available
            offscreenCanvas = detachedCanvasRef.current;
          } else {
            // Transfer control
            targetCanvas.width = viewport.width;
            targetCanvas.height = viewport.height;
            offscreenCanvas = targetCanvas.transferControlToOffscreen();
            // Cache it immediately
            detachedCanvasRef.current = offscreenCanvas;
          }

          // Optimistically set transferred to true to prevent concurrent transfers
          // We will rollback if pre-send abort occurs
          isTransferredRef.current = true;
        }

        // We pass the tile size to the worker
        const success = await pdfWorkerService.renderPage({
          pageIndex,
          scale: scale * dpr,
          canvas: offscreenCanvas,
          canvasId: targetId,
          priority: isInView ? 1 : 0,
          signal: signal,
        });

        // If we reached here, the message was sent successfully.
        // Worker now owns the canvas. Clear our cache.
        if (offscreenCanvas) {
          detachedCanvasRef.current = null;
        }

        // Return true if completed successfully
        if (!signal.aborted) {
          return success;
        }
        return false;
      } catch (error: any) {
        // Handle pre-send aborts: Restore state so we can retry with the cached canvas
        if (error?.phase === "pre-send") {
          // If we were trying to send a canvas, rollback the transferred state
          // The canvas remains in detachedCanvasRef for the next attempt
          if (detachedCanvasRef.current) {
            isTransferredRef.current = false;
          }
        } else {
          // For other errors (including post-send aborts), assume transfer happened
          // or failed in a way we can't recover the canvas.
          // If it was a post-send abort, Worker owns it.
          if (offscreenCanvas) {
            detachedCanvasRef.current = null;
          }
        }

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

    // Use requestAnimationFrame for immediate but throttled updates
    // This removes the debounce delay for maximum responsiveness
    rafId = requestAnimationFrame(() => {
      abortController = new AbortController();
      render(abortController.signal).then((ok) => {
        if (!ok) return;
        const targetId = activeCanvas === "A" ? "B" : "A";
        setActiveCanvas(targetId);
        setIsRendered(true);
        renderedScaleRef.current = scale;
      });
    });

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (abortController) {
        abortController.abort();
      }
    };
    // Re-run if visibility changes or scale/doc changes
  }, [isInView, pdfDocument, pageIndex, scale]);

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
          "absolute inset-0 size-full",
          (activeCanvas === "B" || !isInView) && "hidden",
        )}
      />

      {/* Canvas B */}
      <canvas
        ref={canvasBRef}
        className={cn(
          "absolute inset-0 size-full",
          (activeCanvas === "A" || !isInView) && "hidden",
        )}
      />

      {/* Text Layer */}
      <PDFTextLayer
        pageIndex={pageIndex}
        pdfDocument={pdfDocument}
        scale={scale}
        isInView={isInView}
        isSelectMode={isSelectMode}
        cursor={textLayerCursor}
      />
    </div>
  );
};

export default PDFPage;
