import React, { useEffect, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import { useEditorStore } from "@/store/useEditorStore";
import PDFPage from "./PDFPage";

interface PDFPageWithProxyProps {
  pageIndex: number;
  scale: number;
  width: number;
  height: number;
  placeholderImage?: string;
  isSelectMode?: boolean;
  textLayerCursor?: React.CSSProperties["cursor"];
  isHighlighting?: boolean;
  highlightColor?: string;
  highlightOpacity?: number;
  onTextSelectingChange?: (pageIndex: number, isSelecting: boolean) => void;
}

const PDFPageWithProxy: React.FC<PDFPageWithProxyProps> = ({
  pageIndex,
  scale,
  width,
  height,
  placeholderImage,
  isSelectMode,
  textLayerCursor,
  isHighlighting,
  highlightColor,
  highlightOpacity,
  onTextSelectingChange,
}) => {
  const pdfDocument = useEditorStore((s) => s.pdfDocument);
  const getPageCached = useEditorStore((s) => s.getPageCached);

  const [pageProxy, setPageProxy] = useState<PDFPageProxy | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPageProxy(null);

    if (!pdfDocument) return;
    void getPageCached(pageIndex)
      .then((p) => {
        if (cancelled) return;
        setPageProxy(p);
      })
      .catch(() => {
        if (cancelled) return;
        setPageProxy(null);
      });

    return () => {
      cancelled = true;
    };
  }, [getPageCached, pdfDocument, pageIndex]);

  return (
    <PDFPage
      pageIndex={pageIndex}
      pageProxy={pageProxy}
      scale={scale}
      width={width}
      height={height}
      placeholderImage={placeholderImage}
      isSelectMode={isSelectMode}
      isHighlighting={isHighlighting}
      highlightColor={highlightColor}
      highlightOpacity={highlightOpacity}
      textLayerCursor={textLayerCursor}
      onTextSelectingChange={onTextSelectingChange}
    />
  );
};

export default PDFPageWithProxy;
