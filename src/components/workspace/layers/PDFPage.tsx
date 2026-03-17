import React, { Suspense, useEffect, useRef, useState } from "react";
import type { PageData, PDFSearchResult } from "@/types";
import { useEditorStore } from "@/store/useEditorStore";
import PDFCanvasLayer from "./PDFCanvasLayer";
import PDFTextLayer from "./PDFTextLayer";

const PDFPageRenderDebugOverlay = React.lazy(
  () => import("../debug/PDFPageRenderDebugOverlay"),
);

interface PDFPageProps {
  page: PageData;
  scale: number;
  isSelectMode?: boolean;
  textLayerCursor?: React.CSSProperties["cursor"];
  isHighlighting?: boolean;
  highlightColor?: string;
  highlightOpacity?: number;
  searchResults?: PDFSearchResult[];
  activeSearchResultId?: string | null;
}

const PDFPage: React.FC<PDFPageProps> = ({
  page,
  scale,
  isSelectMode = true,
  textLayerCursor,
  isHighlighting = false,
  highlightColor,
  highlightOpacity,
  searchResults = [],
  activeSearchResultId = null,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);
  const [debugOverlayHost, setDebugOverlayHost] = useState<HTMLElement | null>(
    null,
  );
  const pdfZoomRenderTimingDebug = useEditorStore(
    (s) => s.options.debugOptions.pdfZoomRenderTiming,
  );
  const wasDebugEnabledRef = useRef(pdfZoomRenderTimingDebug);

  const containerWidth = page.width;
  const containerHeight = page.height;

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
        width: containerWidth * scale,
        height: containerHeight * scale,
      }}
    >
      <PDFCanvasLayer page={page} scale={scale} isInView={isInView} />

      <PDFTextLayer
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

      {pdfZoomRenderTimingDebug && (
        <Suspense fallback={null}>
          <PDFPageRenderDebugOverlay
            pageIndex={page.pageIndex}
            scale={scale}
            isInView={isInView}
            debugJustEnabled={debugJustEnabled}
            overlayHost={debugOverlayHost}
          />
        </Suspense>
      )}
    </div>
  );
};

export default PDFPage;
