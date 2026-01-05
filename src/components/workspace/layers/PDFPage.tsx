import React, { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import PDFCanvasLayer from "./PDFCanvasLayer";
import PDFTextLayer from "./PDFTextLayer";

interface PDFPageProps {
  pageIndex: number;
  pageProxy: pdfjsLib.PDFPageProxy | null;
  scale: number;
  width: number;
  height: number;
  placeholderImage?: string; // Optional low-res image if we have one
  isSelectMode?: boolean;
  textLayerCursor?: React.CSSProperties["cursor"];
  isHighlighting?: boolean;
  highlightColor?: string;
  highlightOpacity?: number;
}

const PDFPage: React.FC<PDFPageProps> = ({
  pageIndex,
  pageProxy,
  scale,
  width,
  height,
  placeholderImage,
  isSelectMode = true,
  textLayerCursor,
  isHighlighting = false,
  highlightColor,
  highlightOpacity,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);

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
        width: width * scale,
        height: height * scale,
      }}
    >
      <PDFCanvasLayer
        pageIndex={pageIndex}
        pageProxy={pageProxy}
        scale={scale}
        isInView={isInView}
        placeholderImage={placeholderImage}
      />

      {/* Text Layer */}
      <PDFTextLayer
        pageIndex={pageIndex}
        pageProxy={pageProxy}
        scale={scale}
        isInView={isInView}
        isSelectMode={isSelectMode}
        cursor={textLayerCursor}
        isHighlighting={isHighlighting}
        highlightColor={highlightColor}
        highlightOpacity={highlightOpacity}
      />
    </div>
  );
};

export default PDFPage;
