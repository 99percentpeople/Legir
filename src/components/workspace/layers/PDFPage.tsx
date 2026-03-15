import React, { useEffect, useRef, useState } from "react";
import type { PageData, PDFSearchResult } from "@/types";
import PDFCanvasLayer from "./PDFCanvasLayer";
import PDFTextLayer from "./PDFTextLayer";

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

  const containerWidth = page.width;
  const containerHeight = page.height;

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

      {/* Text Layer */}
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
    </div>
  );
};

export default PDFPage;
