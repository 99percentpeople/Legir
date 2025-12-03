import React, { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import * as pdfjsLib from "pdfjs-dist";
import * as pdfjsViewer from "pdfjs-dist/web/pdf_viewer.mjs";
import PdfWorker from "pdfjs-dist/build/pdf.worker.mjs?worker";
import type { RenderParameters } from "pdfjs-dist/types/src/display/api";

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

    let activeRender: (Promise<boolean> & { cancel: () => void }) | null = null;

    const render = (): Promise<boolean> & { cancel: () => void } => {
      let renderTask: any = null;
      let isRenderCancelled = false;

      const promise = (async () => {
        // Determine which canvas is currently in the background (buffer)
        // We render to the background canvas, then swap.
        const targetCanvasRef = activeCanvas === "A" ? canvasBRef : canvasARef;
        const targetCanvas = targetCanvasRef.current;

        if (!targetCanvas) return;

        try {
          const page = await pdfDocument.getPage(pageIndex + 1);

          if (isRenderCancelled) return;

          const viewport = page.getViewport({
            scale: scale * (window.devicePixelRatio || 1),
          });

          // Setup the buffer canvas
          targetCanvas.width = viewport.width;
          targetCanvas.height = viewport.height;

          const ctx = targetCanvas.getContext("2d");
          if (!ctx) return;

          // Clear context to handle transparent PDFs correctly
          ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);

          const renderContext = {
            canvas: targetCanvas,
            viewport: viewport,
            annotationMode: pdfjsLib.AnnotationMode.DISABLE,
          } satisfies RenderParameters;

          const newRenderTask = page.render(renderContext);
          renderTask = newRenderTask;

          await newRenderTask.promise;

          // Return true if completed successfully
          if (!isRenderCancelled) {
            return true;
          }
        } catch (error: any) {
          // Ignore cancellation errors
          if (error?.name !== "RenderingCancelledException") {
            console.error("Render error:", error);
          }
          return false;
        }
      })();

      const cancel = () => {
        isRenderCancelled = true;
        if (renderTask) {
          renderTask.cancel();
        }
      };

      (promise as any).cancel = cancel;
      return promise as Promise<boolean> & { cancel: () => void };
    };

    // Debounce to handle continuous zooming
    const handleRender = requestAnimationFrame(() => {
      const task = render();
      activeRender = task;
      task.then((ok) => {
        if (!ok) return;
        const targetId = activeCanvas === "A" ? "B" : "A";
        setActiveCanvas(targetId);
        setIsRendered(true);
        renderedScaleRef.current = scale;
      });
    });

    return () => {
      cancelAnimationFrame(handleRender);
      if (activeRender) {
        activeRender.cancel();
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
        if (isCancelled) return;

        const viewport = page.getViewport({ scale: initialScale });

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
          activeCanvas === "A" ? "z-10 opacity-100" : "z-0 opacity-0",
        )}
      />

      {/* Canvas B */}
      <canvas
        ref={canvasBRef}
        className={cn(
          "absolute inset-0 block h-full w-full",
          activeCanvas === "B" ? "z-10 opacity-100" : "z-0 opacity-0",
        )}
      />

      {/* Text Layer */}
      <div
        ref={textLayerRef}
        className={cn("textLayer", !isSelectMode && "pointer-events-none")}
        style={{
          transform: textLayerRenderedScale
            ? `scale(${scale / textLayerRenderedScale})`
            : "none",
          transformOrigin: "0 0",
        }}
      />
    </div>
  );
};

export default PDFPage;
