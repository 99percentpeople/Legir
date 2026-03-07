import type {
  TextContent,
  TextItem,
  TextMarkedContent,
  TextStyle,
} from "pdfjs-dist/types/src/display/api";
import type {
  PageData,
  PDFSearchDisplaySegment,
  PDFSearchResult,
} from "@/types";

const SEARCH_CONTEXT_CHARS = 36;
const DEFAULT_TEXT_STYLE: TextStyle = {
  ascent: 0.8,
  descent: -0.2,
  vertical: false,
  fontFamily: "sans-serif",
};

const isTextItem = (item: TextItem | TextMarkedContent): item is TextItem =>
  "str" in item;

const normalizePreviewText = (value: string) => value.replace(/\s+/g, " ");

const buildDisplaySegments = (
  source: string,
  startOffset: number,
  endOffset: number,
): PDFSearchDisplaySegment[] => {
  const previewStart = Math.max(0, startOffset - SEARCH_CONTEXT_CHARS);
  const previewEnd = Math.min(source.length, endOffset + SEARCH_CONTEXT_CHARS);

  const before = normalizePreviewText(source.slice(previewStart, startOffset));
  const match = normalizePreviewText(source.slice(startOffset, endOffset));
  const after = normalizePreviewText(source.slice(endOffset, previewEnd));

  const segments: PDFSearchDisplaySegment[] = [];

  if (before) {
    segments.push({
      text: previewStart > 0 ? `…${before}` : before,
      highlighted: false,
    });
  }

  if (match) {
    segments.push({ text: match, highlighted: true });
  }

  if (after) {
    segments.push({
      text: previewEnd < source.length ? `${after}…` : after,
      highlighted: false,
    });
  }

  return segments.length > 0 ? segments : [{ text: "", highlighted: false }];
};

const getPageSearchText = (textContent: TextContent) =>
  textContent.items
    .filter(isTextItem)
    .map((item) => item.str)
    .join("");

type SearchTokenBoundary = {
  start: number;
  end: number;
  sortTop: number;
  sortLeft: number;
  rect: { x: number; y: number; width: number; height: number };
};

const transform = (m1: number[], m2: number[]) => {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
};

const getSearchTokenBoundaries = (
  textContent: TextContent,
  page: PageData,
): SearchTokenBoundary[] => {
  const boundaries: SearchTokenBoundary[] = [];
  const textLayerTransform = [
    1,
    0,
    0,
    -1,
    -page.viewBox[0],
    page.viewBox[1] + (page.viewBox[3] - page.viewBox[1]),
  ];
  let currentOffset = 0;

  for (const item of textContent.items) {
    if (!isTextItem(item)) continue;

    const value = item.str ?? "";
    const start = currentOffset;
    currentOffset += value.length;

    if (!value.length) continue;

    const itemTransform = Array.isArray(item.transform)
      ? (item.transform as number[])
      : [1, 0, 0, 1, 0, 0];
    const tx = transform(textLayerTransform, itemTransform);
    let angle = Math.atan2(tx[1] ?? 0, tx[0] ?? 1);
    const style = textContent.styles[item.fontName] ?? DEFAULT_TEXT_STYLE;
    if (style.vertical) angle += Math.PI / 2;

    const fontHeight = Math.hypot(tx[2] ?? 0, tx[3] ?? 0) || item.height || 1;
    const ascentRatio =
      Number.isFinite(style.ascent) && typeof style.ascent === "number"
        ? style.ascent
        : Number.isFinite(style.descent) && typeof style.descent === "number"
          ? 1 + style.descent
          : 0.8;
    const fontAscent = fontHeight * ascentRatio;
    const textWidth = style.vertical ? (item.height ?? 0) : (item.width ?? 0);

    let left: number;
    let top: number;
    if (angle === 0) {
      left = tx[4] ?? 0;
      top = (tx[5] ?? 0) - fontAscent;
    } else {
      left = (tx[4] ?? 0) + fontAscent * Math.sin(angle);
      top = (tx[5] ?? 0) - fontAscent * Math.cos(angle);
    }

    const absCos = Math.abs(Math.cos(angle));
    const absSin = Math.abs(Math.sin(angle));
    const rectWidth = Math.max(
      1,
      Math.abs(textWidth * absCos) + Math.abs(fontHeight * absSin),
    );
    const rectHeight = Math.max(
      1,
      Math.abs(textWidth * absSin) + Math.abs(fontHeight * absCos),
    );
    const sortLeft = Number.isFinite(left) ? left : 0;
    const sortTop = Number.isFinite(top) ? top : 0;

    boundaries.push({
      start,
      end: currentOffset,
      sortTop,
      sortLeft,
      rect: {
        x: sortLeft,
        y: sortTop,
        width: rectWidth,
        height: rectHeight,
      },
    });
  }

  return boundaries;
};

const getMatchSortPosition = (
  boundaries: SearchTokenBoundary[],
  startOffset: number,
  endOffset: number,
) => {
  const overlapping = boundaries.filter(
    (boundary) => boundary.end > startOffset && boundary.start < endOffset,
  );

  if (overlapping.length === 0) {
    return {
      sortTop: Number.POSITIVE_INFINITY,
      sortLeft: Number.POSITIVE_INFINITY,
    };
  }

  return overlapping.reduce(
    (best, boundary) => {
      if (boundary.sortTop < best.sortTop - 0.5) {
        return {
          sortTop: boundary.sortTop,
          sortLeft: boundary.sortLeft,
        };
      }
      if (Math.abs(boundary.sortTop - best.sortTop) <= 0.5) {
        return {
          sortTop: best.sortTop,
          sortLeft: Math.min(best.sortLeft, boundary.sortLeft),
        };
      }
      return best;
    },
    {
      sortTop: overlapping[0]!.sortTop,
      sortLeft: overlapping[0]!.sortLeft,
    },
  );
};

const getMatchRect = (
  boundaries: SearchTokenBoundary[],
  startOffset: number,
  endOffset: number,
) => {
  const overlapping = boundaries.filter(
    (boundary) => boundary.end > startOffset && boundary.start < endOffset,
  );

  if (overlapping.length === 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const boundary of overlapping) {
    minX = Math.min(minX, boundary.rect.x);
    minY = Math.min(minY, boundary.rect.y);
    maxX = Math.max(maxX, boundary.rect.x + boundary.rect.width);
    maxY = Math.max(maxY, boundary.rect.y + boundary.rect.height);
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
};

export const findPdfSearchResults = (
  textContent: TextContent,
  query: string,
  page: PageData,
  options?: {
    caseSensitive?: boolean;
  },
): PDFSearchResult[] => {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const pageText = getPageSearchText(textContent);
  if (!pageText) return [];

  const tokenBoundaries = getSearchTokenBoundaries(textContent, page);
  const caseSensitive = options?.caseSensitive ?? false;
  const normalizedPageText = caseSensitive
    ? pageText
    : pageText.toLocaleLowerCase();
  const normalizedQuery = caseSensitive
    ? trimmedQuery
    : trimmedQuery.toLocaleLowerCase();
  if (!normalizedQuery.trim()) return [];

  const results: PDFSearchResult[] = [];
  let cursor = 0;
  let matchIndexOnPage = 0;

  while (cursor < normalizedPageText.length) {
    const matchOffset = normalizedPageText.indexOf(normalizedQuery, cursor);
    if (matchOffset === -1) break;

    const endOffset = matchOffset + trimmedQuery.length;
    const { sortTop, sortLeft } = getMatchSortPosition(
      tokenBoundaries,
      matchOffset,
      endOffset,
    );
    const rect = getMatchRect(tokenBoundaries, matchOffset, endOffset);

    results.push({
      id: `${page.pageIndex}:${matchIndexOnPage}:${matchOffset}:${endOffset}`,
      pageIndex: page.pageIndex,
      matchIndexOnPage,
      startOffset: matchOffset,
      endOffset,
      sortTop,
      sortLeft,
      rect,
      matchText: pageText.slice(matchOffset, endOffset),
      contextBefore: pageText.slice(
        Math.max(0, matchOffset - SEARCH_CONTEXT_CHARS),
        matchOffset,
      ),
      contextAfter: pageText.slice(
        endOffset,
        Math.min(pageText.length, endOffset + SEARCH_CONTEXT_CHARS),
      ),
      displaySegments: buildDisplaySegments(pageText, matchOffset, endOffset),
    });

    matchIndexOnPage += 1;
    cursor = matchOffset + Math.max(1, normalizedQuery.length);
  }

  return results.sort((a, b) => {
    if (Math.abs(a.sortTop - b.sortTop) > 2) return a.sortTop - b.sortTop;
    if (Math.abs(a.sortLeft - b.sortLeft) > 1) return a.sortLeft - b.sortLeft;
    return a.startOffset - b.startOffset;
  });
};
