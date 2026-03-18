import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PageData } from "@/types";
import {
  MAX_PIXELS_PER_PAGE,
  THUMBNAIL_JPEG_QUALITY,
  THUMBNAIL_MIME_TYPE,
  THUMBNAIL_TARGET_WIDTH,
} from "@/constants";
import { pdfWorkerService } from "@/services/pdfService/pdfWorkerService";
import { createViewportFromPageInfo } from "@/services/pdfService/lib/coords";
import { useEditorStore } from "@/store/useEditorStore";
import { getWorkspaceRenderDpr } from "../lib/renderPerformance";
import {
  reportPDFPageRenderLayerReady,
  reportPDFPageRenderLayerState,
} from "../debug/pdfPageRenderTelemetry";
import { useDeferredRenderScale } from "../hooks/useDeferredRenderScale";
import PDFTileLayer from "./PDFTileLayer";

interface PDFCanvasLayerProps {
  page: PageData;
  scale: number;
  isInView: boolean;
}

const PDFCanvasLayer: React.FC<PDFCanvasLayerProps> = ({
  page,
  scale,
  isInView,
}) => {
  const pageIndex = page.pageIndex;
  // Double buffering: Two canvases to prevent flickering during resize/re-render
  const canvasARef = useRef<HTMLCanvasElement>(null);
  const canvasBRef = useRef<HTMLCanvasElement>(null);

  const [activeCanvas, setActiveCanvas] = useState<"A" | "B">("A");
  const [isRendered, setIsRendered] = useState(false);
  const [tileState, setTileState] = useState<{
    tileMode: boolean;
    hasUsableTileBuffer: boolean;
    hasAnyTileRendered: boolean;
    hasAllTilesRendered: boolean;
  }>({
    tileMode: false,
    hasUsableTileBuffer: false,
    hasAnyTileRendered: false,
    hasAllTilesRendered: false,
  });

  const renderedScaleRef = useRef<number | null>(null);
  const renderEpochRef = useRef(0);
  const dprRef = useRef<number>(1);
  const setState = useEditorStore.setState;
  const placeholderImage = useEditorStore(
    (state) => state.thumbnailImages[pageIndex],
  );
  const pageInfo = useMemo(
    () => ({
      viewBox: page.viewBox,
      userUnit: page.userUnit,
      rotation: page.rotation,
    }),
    [page.viewBox, page.userUnit, page.rotation],
  );
  const pageRenderIdentity = useMemo(
    () =>
      `${pageIndex}:${page.rotation}:${page.userUnit}:${page.viewBox.join(",")}`,
    [page.pageIndex, page.rotation, page.userUnit, page.viewBox],
  );
  // Keep stretching the last good bitmap during zoom and only request a new
  // raster once the scale has been stable for a short idle window.
  const renderScale = useDeferredRenderScale({
    identity: pageRenderIdentity,
    scale,
    immediate: !isRendered,
  });

  const updateImageData = useCallback(
    async (canvas: HTMLCanvasElement, renderEpoch?: number) => {
      if (
        typeof renderEpoch === "number" &&
        renderEpoch !== renderEpochRef.current
      ) {
        return;
      }
      if (typeof document === "undefined") return;

      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );

      if (
        typeof renderEpoch === "number" &&
        renderEpoch !== renderEpochRef.current
      ) {
        return;
      }

      const current = useEditorStore.getState();
      if (!current.pages[pageIndex] || current.thumbnailImages[pageIndex]) {
        return;
      }

      const sourceWidth = canvas.width;
      const sourceHeight = canvas.height;
      if (!sourceWidth || !sourceHeight) return;

      const scale = Math.min(1, THUMBNAIL_TARGET_WIDTH / sourceWidth);
      const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
      const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

      const thumbCanvas = document.createElement("canvas");
      thumbCanvas.width = targetWidth;
      thumbCanvas.height = targetHeight;
      const ctx = thumbCanvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(canvas, 0, 0, targetWidth, targetHeight);

      const blob = await new Promise<Blob | null>((resolve) => {
        thumbCanvas.toBlob(
          (result) => resolve(result),
          THUMBNAIL_MIME_TYPE,
          THUMBNAIL_JPEG_QUALITY,
        );
      });

      let imageData: string | null = null;
      if (blob) {
        imageData = URL.createObjectURL(blob);
      } else {
        try {
          imageData = thumbCanvas.toDataURL(
            THUMBNAIL_MIME_TYPE,
            THUMBNAIL_JPEG_QUALITY,
          );
        } catch {
          imageData = null;
        }
      }

      if (!imageData) return;

      const latest = useEditorStore.getState();
      if (!latest.pages[pageIndex] || latest.thumbnailImages[pageIndex]) {
        if (imageData.startsWith("blob:")) {
          try {
            URL.revokeObjectURL(imageData);
          } catch {
            // ignore
          }
        }
        return;
      }

      setState((s) => {
        if (!s.pages[pageIndex] || s.thumbnailImages[pageIndex]) return {};
        return {
          thumbnailImages: {
            ...s.thumbnailImages,
            [pageIndex]: imageData,
          },
        };
      });
    },
    [pageIndex, setState],
  );

  useLayoutEffect(() => {
    renderedScaleRef.current = null;
    setIsRendered(false);
  }, [pageIndex, pageInfo]);

  useLayoutEffect(() => {
    renderEpochRef.current += 1;
  }, [pageIndex, pageInfo, renderScale]);

  // Stable IDs for canvas elements to allow reuse in Worker
  const componentId = useRef(Math.random().toString(36).substr(2, 9));
  const canvasAId = useRef(`${componentId.current}-A`);
  const canvasBId = useRef(`${componentId.current}-B`);
  const isATransferred = useRef(false);
  const isBTransferred = useRef(false);
  // Cache for detached OffscreenCanvas objects to prevent loss during pre-send aborts
  const detachedCanvasARef = useRef<OffscreenCanvas | null>(null);
  const detachedCanvasBRef = useRef<OffscreenCanvas | null>(null);

  useEffect(() => {
    return () => {
      void pdfWorkerService.releaseCanvas({
        canvasIds: [canvasAId.current, canvasBId.current],
      });
    };
  }, []);

  // Rendering Logic with Double Buffering and Debounce
  useEffect(() => {
    if (tileState.tileMode) {
      return;
    }

    // Only render if in viewport
    if (!isInView) {
      return;
    }

    // Optimization: If already rendered at this scale, skip.
    if (renderedScaleRef.current === renderScale) {
      return;
    }

    const dpr = getWorkspaceRenderDpr(
      pageInfo,
      renderScale,
      Math.min(window.devicePixelRatio || 1, 2),
    );
    dprRef.current = dpr;
    const viewportCheck = createViewportFromPageInfo(pageInfo, {
      scale: renderScale * dpr,
      rotation: pageInfo.rotation,
    });
    const pixelsCheck =
      Math.ceil(viewportCheck.width) * Math.ceil(viewportCheck.height);
    if (pixelsCheck > MAX_PIXELS_PER_PAGE) {
      return;
    }

    const epoch = renderEpochRef.current;
    let abortController: AbortController | null = null;
    let rafId: number | null = null;
    let swapRafId: number | null = null;

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
        if (renderEpochRef.current !== epoch) return false;

        // Optimization: Limit max DPR to 2
        const dpr = dprRef.current;
        // Note: We don't set width/height here for OffscreenCanvas,
        // but we set it on the placeholder to ensure layout is correct.
        // The worker handles the actual bitmap size.

        const viewport = createViewportFromPageInfo(pageInfo, {
          scale: renderScale * dpr,
          rotation: pageInfo.rotation,
        });

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
          priority: isInView ? -1 : 0,
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
      } catch (error) {
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
        if (renderEpochRef.current !== epoch) return;
        const targetId = activeCanvas === "A" ? "B" : "A";
        swapRafId = requestAnimationFrame(() => {
          if (renderEpochRef.current !== epoch) return;
          setActiveCanvas(targetId);
          setIsRendered(true);
          renderedScaleRef.current = renderScale;
          reportPDFPageRenderLayerReady({
            pageIndex,
            layer: "canvas",
            scale: renderScale,
            completedAt: performance.now(),
          });
          const targetCanvas =
            targetId === "A" ? canvasARef.current : canvasBRef.current;
          if (targetCanvas) {
            void updateImageData(targetCanvas, epoch);
          }
        });
      });
    });

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (swapRafId) cancelAnimationFrame(swapRafId);
      if (abortController) {
        abortController.abort();
      }
    };
    // Re-run if visibility changes or scale/doc changes
  }, [
    activeCanvas,
    isInView,
    pageIndex,
    pageInfo,
    renderScale,
    tileState.tileMode,
    updateImageData,
  ]);

  useEffect(() => {
    if (!isInView) {
      return;
    }

    if (tileState.tileMode) {
      if (!tileState.hasAllTilesRendered) return;
      reportPDFPageRenderLayerReady({
        pageIndex,
        layer: "canvas",
        scale: renderScale,
        completedAt: performance.now(),
      });
      return;
    }

    if (!isRendered || renderedScaleRef.current !== renderScale) return;
    reportPDFPageRenderLayerReady({
      pageIndex,
      layer: "canvas",
      scale: renderScale,
      completedAt: performance.now(),
    });
  }, [
    isInView,
    isRendered,
    pageIndex,
    renderScale,
    tileState.hasAllTilesRendered,
    tileState.tileMode,
  ]);

  useEffect(() => {
    if (!isInView) {
      return;
    }

    const ready = tileState.tileMode
      ? tileState.hasAllTilesRendered
      : isRendered && renderedScaleRef.current === renderScale;

    reportPDFPageRenderLayerState({
      pageIndex,
      layer: "canvas",
      ready,
      scale: renderScale,
    });
  }, [
    isInView,
    isRendered,
    pageIndex,
    renderScale,
    tileState.hasAllTilesRendered,
    tileState.tileMode,
  ]);

  const hasUsableTileBuffer = tileState.hasUsableTileBuffer;
  const shouldHidePageCanvasForTiles =
    tileState.tileMode && tileState.hasAllTilesRendered;
  const showPlaceholderImage =
    !!placeholderImage &&
    !hasUsableTileBuffer &&
    (tileState.tileMode || (!tileState.tileMode && !isRendered));
  const showSpinner = !hasUsableTileBuffer && !isRendered && !placeholderImage;
  const canvasADisplay =
    activeCanvas === "B" || !isInView || shouldHidePageCanvasForTiles
      ? "none"
      : "block";
  const canvasBDisplay =
    activeCanvas === "A" || !isInView || shouldHidePageCanvasForTiles
      ? "none"
      : "block";

  return (
    <>
      {/* Placeholder Image (Low Res / Lazy Load) */}
      {showPlaceholderImage && (
        <img
          src={placeholderImage}
          className="pointer-events-none absolute inset-0 h-full w-full object-contain blur-sm"
          alt="Loading..."
        />
      )}

      {/* Loading Spinner */}
      {showSpinner && (
        <div className="text-muted-foreground pointer-events-none absolute inset-0 flex items-center justify-center bg-gray-50">
          <div className="border-primary h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"></div>
        </div>
      )}

      {/* Canvas A */}
      <canvas
        ref={canvasARef}
        className="absolute inset-0 size-full"
        style={{ display: canvasADisplay }}
      />

      {/* Canvas B */}
      <canvas
        ref={canvasBRef}
        className="absolute inset-0 size-full"
        style={{ display: canvasBDisplay }}
      />

      <PDFTileLayer
        page={page}
        scale={renderScale}
        isInView={isInView}
        isRendered={isRendered}
        onStateChange={setTileState}
      />
    </>
  );
};

export default PDFCanvasLayer;
