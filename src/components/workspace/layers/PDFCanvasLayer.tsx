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
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import {
  useEditorView as useDocumentState,
  useEditorViewApi,
} from "@/store/useEditorView";
import { getWorkspaceRenderMetrics } from "../lib/renderPerformance";
import { waitForReaderPreviewIdle } from "../lib/readerPreviewActivity";
import { encodedImageDataUrl } from "@/utils/encodedImageDataUrl";
import {
  reportPDFPageRenderLayerReady,
  reportPDFPageRenderLayerState,
} from "../debug/pdfPageRenderTelemetry";
import { useDeferredRenderScale } from "../hooks/useDeferredRenderScale";
import PDFTileLayer from "./PDFTileLayer";
import { useEditorEventBus } from "@/app/editorTabs/context";

interface PDFCanvasLayerProps {
  workerService: PDFWorkerService | null;
  page: PageData;
  scale: number;
  isInView: boolean;
  sessionRenderKey?: string | null;
}

type CanvasBuffer = {
  id: string;
  transferred: boolean;
  detached: OffscreenCanvas | null;
};

const PDFCanvasLayer: React.FC<PDFCanvasLayerProps> = ({
  workerService,
  page,
  scale,
  isInView,
  sessionRenderKey,
}) => {
  const appEventBus = useEditorEventBus();
  const useEditorView = useEditorViewApi();
  const pageIndex = page.pageIndex;
  // Double buffering: Two canvases to prevent flickering during resize/re-render
  const canvasARef = useRef<HTMLCanvasElement>(null);
  const canvasBRef = useRef<HTMLCanvasElement>(null);
  // Transfer is permanent for a DOM canvas. Geometry edits reuse its worker
  // ownership; a different worker needs fresh elements and transfer state.
  const canvasBuffers = useMemo<Record<"A" | "B", CanvasBuffer>>(() => {
    const id = Math.random().toString(36).slice(2, 11);
    return {
      A: { id: `${id}-A`, transferred: false, detached: null },
      B: { id: `${id}-B`, transferred: false, detached: null },
    };
  }, [workerService]);

  const [activeCanvas, setActiveCanvas] = useState<"A" | "B">("A");
  const [isRendered, setIsRendered] = useState(false);
  const [tileState, setTileState] = useState<{
    tileMode: boolean;
    hasUsableTileBuffer: boolean;
    hasAnyTileRendered: boolean;
    hasVisibleTilesRendered: boolean;
  }>({
    tileMode: false,
    hasUsableTileBuffer: false,
    hasAnyTileRendered: false,
    hasVisibleTilesRendered: false,
  });

  const renderedScaleRef = useRef<number | null>(null);
  const renderEpochRef = useRef(0);
  const previewControllerRef = useRef<AbortController | null>(null);
  const dprRef = useRef<number>(1);
  const setState = useEditorView.setState;
  const placeholderImage = useDocumentState((state) =>
    state.pages[pageIndex]?.rotation === page.rotation
      ? state.pagePreviewImages[pageIndex]
      : undefined,
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
    immediate: !isRendered && !tileState.hasUsableTileBuffer,
  });

  const updateImageData = useCallback(
    async (canvasId: string, renderEpoch: number) => {
      const current = useEditorView.getState();
      if (
        !workerService ||
        renderEpoch !== renderEpochRef.current ||
        !current.pages[pageIndex] ||
        current.pages[pageIndex].rotation !== page.rotation ||
        current.pagePreviewImages[pageIndex]
      ) {
        return;
      }

      previewControllerRef.current?.abort();
      const controller = new AbortController();
      previewControllerRef.current = controller;
      try {
        if (!(await waitForReaderPreviewIdle(useEditorView, controller.signal)))
          return;
        const image = await workerService.renderPageImage({
          pageIndex,
          previewCanvasId: canvasId,
          targetWidth: THUMBNAIL_TARGET_WIDTH,
          mimeType: THUMBNAIL_MIME_TYPE,
          quality: THUMBNAIL_JPEG_QUALITY,
          priority: 1,
          signal: controller.signal,
        });
        const latest = useEditorView.getState();
        if (
          controller.signal.aborted ||
          renderEpoch !== renderEpochRef.current ||
          !image.bytes.length ||
          !latest.pages[pageIndex] ||
          latest.pages[pageIndex].rotation !== page.rotation ||
          latest.pagePreviewImages[pageIndex]
        ) {
          return;
        }
        const imageData = encodedImageDataUrl(image.bytes, image.mimeType);
        setState((s) => ({
          pagePreviewImages: { ...s.pagePreviewImages, [pageIndex]: imageData },
        }));
      } catch {
        // A preview is optional; a cancelled/released canvas must not disturb
        // the completed reader render or fall back to main-thread readback.
      } finally {
        if (previewControllerRef.current === controller)
          previewControllerRef.current = null;
      }
    },
    [pageIndex, page.rotation, workerService, useEditorView, setState],
  );

  useLayoutEffect(() => {
    renderedScaleRef.current = null;
    setIsRendered(false);
  }, [pageIndex, pageInfo, workerService]);

  useLayoutEffect(() => {
    renderEpochRef.current += 1;
    previewControllerRef.current?.abort();
    return () => previewControllerRef.current?.abort();
  }, [pageIndex, pageInfo, renderScale, workerService]);

  useEffect(() => {
    if (!workerService) return;
    return () => {
      void workerService.releaseCanvas({
        canvasIds: [canvasBuffers.A.id, canvasBuffers.B.id],
      });
    };
  }, [workerService, canvasBuffers]);

  // Rendering Logic with Double Buffering and Debounce
  useEffect(() => {
    if (!workerService) {
      setIsRendered(false);
      return;
    }

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

    const renderMetrics = getWorkspaceRenderMetrics(
      pageInfo,
      renderScale,
      Math.min(window.devicePixelRatio || 1, 2),
    );
    const dpr = renderMetrics.dpr;
    dprRef.current = dpr;
    const pixelsCheck = renderMetrics.pixelWidth * renderMetrics.pixelHeight;
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

      const buffer = canvasBuffers[activeCanvas === "A" ? "B" : "A"];

      let offscreenCanvas: OffscreenCanvas | undefined;

      try {
        if (signal.aborted) return false;
        if (renderEpochRef.current !== epoch) return false;

        // Optimization: Limit max DPR to 2
        const dpr = dprRef.current;
        // Note: We don't set width/height here for OffscreenCanvas,
        // but we set it on the placeholder to ensure layout is correct.
        // The worker handles the actual bitmap size.

        if (!buffer.transferred) {
          if (buffer.detached) {
            // Use cached canvas if available
            offscreenCanvas = buffer.detached;
          } else {
            // Transfer control
            targetCanvas.width = renderMetrics.pixelWidth;
            targetCanvas.height = renderMetrics.pixelHeight;
            offscreenCanvas = targetCanvas.transferControlToOffscreen();
            // Cache it immediately
            buffer.detached = offscreenCanvas;
          }

          // Optimistically set transferred to true to prevent concurrent transfers
          // We will rollback if pre-send abort occurs
          buffer.transferred = true;
        }

        // We pass the tile size to the worker
        const success = await workerService.renderPage({
          pageIndex,
          scale: renderScale * dpr,
          rotation: page.rotation,
          canvas: offscreenCanvas,
          canvasId: buffer.id,
          priority: isInView ? -1 : 0,
          signal: signal,
        });

        // If we reached here, the message was sent successfully.
        // Worker now owns the canvas. Clear our cache.
        if (offscreenCanvas) {
          buffer.detached = null;
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
          // Retain the detached canvas for the next attempt.
          if (buffer.detached) {
            buffer.transferred = false;
          }
        } else {
          // For other errors (including post-send aborts), assume transfer happened
          // or failed in a way we can't recover the canvas.
          // If it was a post-send abort, Worker owns it.
          if (offscreenCanvas) {
            buffer.detached = null;
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
          if (sessionRenderKey) {
            appEventBus.emit("pdf:firstPageRendered", {
              sessionRenderKey,
              pageIndex,
            });
          }
          void updateImageData(canvasBuffers[targetId].id, epoch);
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
    canvasBuffers,
    isInView,
    pageIndex,
    pageInfo,
    renderScale,
    workerService,
    tileState.tileMode,
    updateImageData,
  ]);

  useEffect(() => {
    if (!isInView) {
      return;
    }

    if (tileState.tileMode) {
      if (!tileState.hasVisibleTilesRendered) return;
      reportPDFPageRenderLayerReady({
        pageIndex,
        layer: "canvas",
        scale: renderScale,
        completedAt: performance.now(),
      });
      if (sessionRenderKey) {
        appEventBus.emit("pdf:firstPageRendered", {
          sessionRenderKey,
          pageIndex,
        });
      }
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
    tileState.hasVisibleTilesRendered,
    tileState.tileMode,
    sessionRenderKey,
  ]);

  useEffect(() => {
    if (!isInView) {
      return;
    }

    const ready = tileState.tileMode
      ? tileState.hasVisibleTilesRendered
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
    tileState.hasVisibleTilesRendered,
    tileState.tileMode,
  ]);

  const hasUsableTileBuffer = tileState.hasUsableTileBuffer;
  const shouldHidePageCanvasForTiles =
    tileState.tileMode && tileState.hasVisibleTilesRendered;
  const showPlaceholderImage =
    !!placeholderImage &&
    (tileState.tileMode ? !tileState.hasVisibleTilesRendered : !isRendered);
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
        key={canvasBuffers.A.id}
        ref={canvasARef}
        className="absolute inset-0 size-full"
        style={{ display: canvasADisplay }}
      />

      {/* Canvas B */}
      <canvas
        key={canvasBuffers.B.id}
        ref={canvasBRef}
        className="absolute inset-0 size-full"
        style={{ display: canvasBDisplay }}
      />

      <PDFTileLayer
        workerService={workerService}
        page={page}
        scale={renderScale}
        isInView={isInView}
        isRendered={isRendered}
        isPageCanvasReady={
          isRendered && renderedScaleRef.current === renderScale
        }
        onStateChange={setTileState}
      />
    </>
  );
};

export default PDFCanvasLayer;
