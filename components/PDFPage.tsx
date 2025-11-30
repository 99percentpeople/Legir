import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';
import * as pdfjsLib from 'pdfjs-dist';

// Handle potential default export wrapper from CDN
const pdfJs = (pdfjsLib as any).default || pdfjsLib;

interface PDFPageProps {
  pageIndex: number;
  pdfDocument: any;
  scale: number;
  width: number;
  height: number;
  placeholderImage?: string; // Optional low-res image if we have one
}

const PDFPage: React.FC<PDFPageProps> = ({ pageIndex, pdfDocument, scale, width, height, placeholderImage }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Double buffering: Two canvases to prevent flickering during resize/re-render
  const canvasARef = useRef<HTMLCanvasElement>(null);
  const canvasBRef = useRef<HTMLCanvasElement>(null);
  
  const [activeCanvas, setActiveCanvas] = useState<'A' | 'B'>('A');
  const [isRendered, setIsRendered] = useState(false); 
  const [isInView, setIsInView] = useState(false);
  
  const renderTaskRef = useRef<any>(null);
  const renderedScaleRef = useRef<number | null>(null);

  // Intersection Observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setIsInView(entry.isIntersecting);
        });
      },
      { rootMargin: '200px' }
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
        const targetCanvasRef = activeCanvas === 'A' ? canvasBRef : canvasARef;
        const targetCanvas = targetCanvasRef.current;
        const targetId = activeCanvas === 'A' ? 'B' : 'A';

        if (!targetCanvas) return;

        try {
            if (renderTaskRef.current) {
                try { renderTaskRef.current.cancel(); } catch(e) {}
            }

            const page = await pdfDocument.getPage(pageIndex + 1);
            const viewport = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
            
            // Setup the buffer canvas
            targetCanvas.width = viewport.width;
            targetCanvas.height = viewport.height;
            
            const ctx = targetCanvas.getContext('2d');
            if (!ctx) return;

            // Clear context to handle transparent PDFs correctly
            ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);

            const renderContext = {
                canvasContext: ctx,
                viewport: viewport,
                annotationMode: pdfJs.AnnotationMode.DISABLE
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
            if (error?.name !== 'RenderingCancelledException') {
                console.error("Render error:", error);
            }
        }
    };

    // Debounce to handle continuous zooming
    const timer = setTimeout(() => {
        render();
    }, 200);

    return () => {
        isCancelled = true;
        clearTimeout(timer);
        if (renderTaskRef.current) {
            try { renderTaskRef.current.cancel(); } catch(e) {}
        }
    };
    // Re-run if visibility changes or scale/doc changes
  }, [isInView, pdfDocument, pageIndex, scale]); 

  return (
    <div 
      ref={containerRef}
      className="relative bg-white shadow-lg transition-shadow hover:shadow-xl origin-top"
      style={{ 
        width: width * scale, 
        height: height * scale 
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
                activeCanvas === 'A' ? "opacity-100 z-10" : "opacity-0 z-0"
            )}
        />

        {/* Canvas B */}
        <canvas 
            ref={canvasBRef}
            className={cn(
                "absolute inset-0 w-full h-full block",
                activeCanvas === 'B' ? "opacity-100 z-10" : "opacity-0 z-0"
            )}
        />
    </div>
  );
};

export default PDFPage;