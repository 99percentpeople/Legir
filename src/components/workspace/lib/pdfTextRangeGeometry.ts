import type { TextContent } from "pdfjs-dist/types/src/display/api";
import type { PageData, PDFSearchResult } from "@/types";
import { createViewportFromPageInfo } from "@/services/pdfService/lib/coords";
import {
  getInlineRectBounds,
  mergeInlineRects,
  type InlineRect,
} from "@/utils/inlineRects";
import { getPdfSearchRangeClientRects } from "./pdfSearchHighlights";
import { buildTextLayer } from "./pdfTextLayer";

export type PdfTextRangeGeometry = {
  rect: InlineRect;
  rects: InlineRect[];
};

type TextContentLoader = (
  pageIndex: number,
  signal?: AbortSignal,
) => Promise<TextContent | null | undefined>;

type PdfSearchResultGeometryCache = {
  get: (id: string) => PdfTextRangeGeometry | undefined;
  set: (id: string, geometry: PdfTextRangeGeometry) => unknown;
};

const normalizePdfTextRangeGeometry = (
  geometry: PdfTextRangeGeometry,
): PdfTextRangeGeometry => ({
  rect: { ...geometry.rect },
  rects:
    geometry.rects.length > 0
      ? geometry.rects.map((item) => ({ ...item }))
      : [{ ...geometry.rect }],
});

export const getPdfTextRangeGeometryFromTextLayer = (
  textContent: TextContent,
  page: PageData,
  startOffset: number,
  endOffset: number,
): PdfTextRangeGeometry | null => {
  if (typeof document === "undefined") return null;

  const viewport = createViewportFromPageInfo(page, {
    scale: 1,
    rotation: page.rotation,
  });
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "-100000px";
  host.style.top = "0";
  host.style.width = `${viewport.width}px`;
  host.style.height = `${viewport.height}px`;
  host.style.overflow = "hidden";
  host.style.pointerEvents = "none";
  host.style.opacity = "0";

  const textLayer = document.createElement("div");
  textLayer.className = "textLayer";
  textLayer.style.setProperty("--scale-factor", "1");
  textLayer.style.setProperty("--user-unit", String(page.userUnit ?? 1));
  textLayer.dataset.selectable = "true";
  host.append(textLayer);

  document.body.append(host);

  try {
    buildTextLayer(textLayer, textContent, viewport);
    const clientRects = getPdfSearchRangeClientRects(
      textLayer,
      startOffset,
      endOffset,
    );
    if (clientRects.length === 0) return null;

    const layerRect = textLayer.getBoundingClientRect();
    const scaleX = layerRect.width / Math.max(page.width, 0.0001);
    const scaleY = layerRect.height / Math.max(page.height, 0.0001);
    const rects: InlineRect[] = mergeInlineRects(
      clientRects
        .map((rect) => ({
          x: (rect.left - layerRect.left) / scaleX,
          y: (rect.top - layerRect.top) / scaleY,
          width: rect.width / scaleX,
          height: rect.height / scaleY,
        }))
        .filter((rect) => rect.width > 0.5 && rect.height > 0.5),
    );
    if (rects.length === 0) return null;

    const rect = getInlineRectBounds(rects);
    if (!rect) return null;

    return {
      rect,
      rects,
    };
  } finally {
    host.remove();
  }
};

export const resolvePdfTextRangeGeometry = async ({
  pages,
  pageIndex,
  startOffset,
  endOffset,
  getTextContent,
  signal,
}: {
  pages: PageData[];
  pageIndex: number;
  startOffset: number;
  endOffset: number;
  getTextContent: TextContentLoader;
  signal?: AbortSignal;
}) => {
  const page = pages[pageIndex];
  if (!page) return null;

  const textContent = await getTextContent(pageIndex, signal);
  if (!textContent || signal?.aborted) return null;

  const geometry = getPdfTextRangeGeometryFromTextLayer(
    textContent,
    page,
    startOffset,
    endOffset,
  );
  return geometry ? normalizePdfTextRangeGeometry(geometry) : null;
};

export const resolvePdfSearchResultGeometry = async ({
  result,
  pages,
  getTextContent,
  signal,
  cache,
}: {
  result: PDFSearchResult;
  pages: PageData[];
  getTextContent: TextContentLoader;
  signal?: AbortSignal;
  cache?: PdfSearchResultGeometryCache;
}) => {
  const cached = cache?.get(result.id);
  if (cached) return cached;

  const geometry = await resolvePdfTextRangeGeometry({
    pages,
    pageIndex: result.pageIndex,
    startOffset: result.startOffset,
    endOffset: result.endOffset,
    getTextContent,
    signal,
  });
  if (geometry) {
    cache?.set(result.id, geometry);
    return geometry;
  }

  return null;
};
