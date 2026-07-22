import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { PageData, PDFSearchResult } from "@/types";
import { useEditorStore } from "@/store/useEditorStore";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import { getWorkspaceRenderMetrics } from "../lib/renderPerformance";
import PDFCanvasLayer from "./PDFCanvasLayer";
import PDFTextLayer from "./PDFTextLayer";

const PDFPageRenderDebugOverlay = React.lazy(
  () => import("../debug/PDFPageRenderDebugOverlay"),
);

interface PDFPageProps {
  workerService: PDFWorkerService | null;
  page: PageData;
  scale: number;
  isSelectMode?: boolean;
  textLayerCursor?: React.CSSProperties["cursor"];
  isHighlighting?: boolean;
  highlightColor?: string;
  highlightOpacity?: number;
  searchResults?: PDFSearchResult[];
  activeSearchResultId?: string | null;
  sessionRenderKey?: string | null;
}

const PDFPage: React.FC<PDFPageProps> = ({
  workerService,
  page,
  scale,
  isSelectMode = true,
  textLayerCursor,
  isHighlighting = false,
  highlightColor,
  highlightOpacity,
  searchResults = [],
  activeSearchResultId = null,
  sessionRenderKey,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);
  const [debugOverlayHost, setDebugOverlayHost] = useState<HTMLElement | null>(
    null,
  );
  const pdfZoomRenderTimingDebug = useEditorStore(
    (s) => s.options.debugOptions.pdfZoomRenderTiming,
  );
  const disablePdfTextLayer = useEditorStore(
    (s) => s.options.debugOptions.disablePdfTextLayer,
  );
  const wasDebugEnabledRef = useRef(pdfZoomRenderTimingDebug);

  const renderMetrics = useMemo(
    () =>
      getWorkspaceRenderMetrics(
        {
          viewBox: page.viewBox,
          userUnit: page.userUnit,
          rotation: page.rotation,
        },
        scale,
        typeof window === "undefined"
          ? 1
          : Math.min(window.devicePixelRatio || 1, 2),
      ),
    [page.rotation, page.userUnit, page.viewBox, scale],
  );

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

  useEffect(() => {
    setDebugOverlayHost(containerRef.current?.parentElement ?? null);
  }, []);

  const debugJustEnabled =
    pdfZoomRenderTimingDebug && !wasDebugEnabledRef.current;

  useEffect(() => {
    wasDebugEnabledRef.current = pdfZoomRenderTimingDebug;
  }, [pdfZoomRenderTimingDebug]);

  return (
    <div
      ref={containerRef}
      className="relative isolate origin-top overflow-hidden bg-white shadow-lg transition-shadow hover:shadow-xl"
      style={{
        width: renderMetrics.cssWidth,
        height: renderMetrics.cssHeight,
      }}
    >
      <PDFCanvasLayer
        workerService={workerService}
        page={page}
        scale={scale}
        isInView={isInView}
        sessionRenderKey={sessionRenderKey}
      />

      {!disablePdfTextLayer && (
        <PDFTextLayer
          workerService={workerService}
          page={page}
          scale={scale}
          isInView={isInView}
          isSelectMode={isSelectMode}
          cursor={textLayerCursor}
          isHighlighting={isHighlighting}
          highlightColor={highlightColor}
          highlightOpacity={highlightOpacity}
          searchResults={searchResults}
          activeSearchResultId={activeSearchResultId}
        />
      )}

      {pdfZoomRenderTimingDebug && (
        <Suspense fallback={null}>
          <PDFPageRenderDebugOverlay
            pageIndex={page.pageIndex}
            scale={scale}
            isInView={isInView}
            debugJustEnabled={debugJustEnabled}
            textLayerEnabled={!disablePdfTextLayer}
            overlayHost={debugOverlayHost}
          />
        </Suspense>
      )}
    </div>
  );
};

export default React.memo(PDFPage);
