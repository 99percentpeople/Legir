import React, { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import * as pdfjsLib from "pdfjs-dist";
import * as pdfjsViewer from "pdfjs-dist/web/pdf_viewer.mjs";

interface PDFPageProps {
  pageIndex: number;
  pdfDocument: any;
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

  const renderTaskRef = useRef<any>(null);
  const renderedScaleRef = useRef<number | null>(null);

  const textLayerRef = useRef<HTMLDivElement>(null);
  const textRenderTaskRef = useRef<any>(null);
  const [textLayerRenderedScale, setTextLayerRenderedScale] = useState<number | null>(null);

  // Intersection Observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setIsInView(entry.isIntersecting);
        });
      },
      { rootMargin: "200px" }
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

    let isCancelled = false;

    const render = async () => {
      // Determine which canvas is currently in the background (buffer)
      // We render to the background canvas, then swap.
      const targetCanvasRef = activeCanvas === "A" ? canvasBRef : canvasARef;
      const targetCanvas = targetCanvasRef.current;
      const targetId = activeCanvas === "A" ? "B" : "A";

      if (!targetCanvas) return;

      try {
        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
          } catch (e) {}
        }

        const page = await pdfDocument.getPage(pageIndex + 1);
        const viewport = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });

        // Setup the buffer canvas
        targetCanvas.width = viewport.width;
        targetCanvas.height = viewport.height;

        const ctx = targetCanvas.getContext("2d");
        if (!ctx) return;

        // Clear context to handle transparent PDFs correctly
        ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);

        const renderContext = {
          canvasContext: ctx,
          viewport: viewport,
          annotationMode: pdfjsLib.AnnotationMode.DISABLE,
        };

        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;

        await renderTask.promise;

        if (!isCancelled) {
          // Render complete: Swap to the new canvas
          setActiveCanvas(targetId);
          setIsRendered(true);
          renderedScaleRef.current = scale;
        }
      } catch (error: any) {
        // Ignore cancellation errors
        if (error?.name !== "RenderingCancelledException") {
          console.error("Render error:", error);
        }
      }
    };

    // Debounce to handle continuous zooming
    const handleRender = requestAnimationFrame(() => {
      render();
    });

    return () => {
      isCancelled = true;
      cancelAnimationFrame(handleRender);
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch (e) {}
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
          textLayerRef.current.style.height = `${Math.floor(viewport.height)}px`;
          textLayerRef.current.style.setProperty("--total-scale-factor", `${initialScale}`);
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
      className="relative bg-white shadow-lg transition-shadow hover:shadow-xl origin-top z-0"
      style={{
        width: width * scale,
        height: height * scale,
      }}
    >
      {/* Placeholder Image (Low Res / Lazy Load) */}
      {!isRendered && placeholderImage && (
        <img
          src={placeholderImage}
          className="absolute inset-0 w-full h-full object-contain opacity-50 blur-sm pointer-events-none"
          alt="Loading..."
        />
      )}

      {/* Loading Spinner */}
      {!isRendered && !placeholderImage && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground bg-gray-50 pointer-events-none">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}

      {/* Canvas A */}
      <canvas
        ref={canvasARef}
        className={cn(
          "absolute inset-0 w-full h-full block",
          activeCanvas === "A" ? "opacity-100 z-10" : "opacity-0 z-0"
        )}
      />

      {/* Canvas B */}
      <canvas
        ref={canvasBRef}
        className={cn(
          "absolute inset-0 w-full h-full block",
          activeCanvas === "B" ? "opacity-100 z-10" : "opacity-0 z-0"
        )}
      />

      {/* Text Layer */}
      <div
        ref={textLayerRef}
        className={cn("textLayer", !isSelectMode && "pointer-events-none")}
        style={{
          transform: textLayerRenderedScale ? `scale(${scale / textLayerRenderedScale})` : "none",
          transformOrigin: "0 0",
        }}
      />
    </div>
  );
};

export default PDFPage;
