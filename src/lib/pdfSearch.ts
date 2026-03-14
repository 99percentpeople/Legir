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

export type PDFSearchMode = "plain" | "regex";

export interface PDFSearchOptions {
  caseSensitive?: boolean;
  mode?: PDFSearchMode;
  regexFlags?: string;
}

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

const buildRegexFlags = (caseSensitive: boolean, regexFlags?: string) => {
  return Array.from(
    new Set(
      `${(regexFlags || "").replace(/[^dgimsuvy]/g, "").replace(/[gi]/g, "")}g${caseSensitive ? "" : "i"}`,
    ),
  ).join("");
};

type SearchTokenBoundary = {
  start: number;
  end: number;
  textWidth: number;
  fontHeight: number;
  topLeftX: number;
  topLeftY: number;
  advanceX: number;
  advanceY: number;
  downX: number;
  downY: number;
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

    const advanceX = Math.cos(angle);
    const advanceY = Math.sin(angle);
    const downX = -advanceY;
    const downY = advanceX;

    boundaries.push({
      start,
      end: currentOffset,
      textWidth: Math.max(0, textWidth),
      fontHeight: Math.max(1, fontHeight),
      topLeftX: Number.isFinite(left) ? left : 0,
      topLeftY: Number.isFinite(top) ? top : 0,
      advanceX: Number.isFinite(advanceX) ? advanceX : 1,
      advanceY: Number.isFinite(advanceY) ? advanceY : 0,
      downX: Number.isFinite(downX) ? downX : 0,
      downY: Number.isFinite(downY) ? downY : 1,
    });
  }

  return boundaries;
};

const getMatchRectForBoundary = (
  boundary: SearchTokenBoundary,
  startOffset: number,
  endOffset: number,
) => {
  const overlapStart = Math.max(boundary.start, startOffset);
  const overlapEnd = Math.min(boundary.end, endOffset);
  if (overlapEnd <= overlapStart) return null;

  const textLength = Math.max(1, boundary.end - boundary.start);
  const startRatio = (overlapStart - boundary.start) / textLength;
  const endRatio = (overlapEnd - boundary.start) / textLength;
  const segmentStart = boundary.textWidth * startRatio;
  const segmentWidth = Math.max(
    boundary.textWidth * (endRatio - startRatio),
    boundary.textWidth > 0 ? boundary.textWidth / textLength : 1,
  );

  const topLeftX = boundary.topLeftX + boundary.advanceX * segmentStart;
  const topLeftY = boundary.topLeftY + boundary.advanceY * segmentStart;
  const topRightX = topLeftX + boundary.advanceX * segmentWidth;
  const topRightY = topLeftY + boundary.advanceY * segmentWidth;
  const bottomLeftX = topLeftX + boundary.downX * boundary.fontHeight;
  const bottomLeftY = topLeftY + boundary.downY * boundary.fontHeight;
  const bottomRightX = topRightX + boundary.downX * boundary.fontHeight;
  const bottomRightY = topRightY + boundary.downY * boundary.fontHeight;

  const minX = Math.min(topLeftX, topRightX, bottomLeftX, bottomRightX);
  const minY = Math.min(topLeftY, topRightY, bottomLeftY, bottomRightY);
  const maxX = Math.max(topLeftX, topRightX, bottomLeftX, bottomRightX);
  const maxY = Math.max(topLeftY, topRightY, bottomLeftY, bottomRightY);

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
};

const getMatchRects = (
  boundaries: SearchTokenBoundary[],
  startOffset: number,
  endOffset: number,
) =>
  boundaries
    .map((boundary) =>
      getMatchRectForBoundary(boundary, startOffset, endOffset),
    )
    .filter((rect): rect is NonNullable<typeof rect> => !!rect);

const getMatchSortPosition = (
  boundaries: SearchTokenBoundary[],
  startOffset: number,
  endOffset: number,
) => {
  const overlapping = getMatchRects(boundaries, startOffset, endOffset);

  if (overlapping.length === 0) {
    return {
      sortTop: Number.POSITIVE_INFINITY,
      sortLeft: Number.POSITIVE_INFINITY,
    };
  }

  return overlapping.reduce(
    (best, boundary) => {
      if (boundary.y < best.sortTop - 0.5) {
        return {
          sortTop: boundary.y,
          sortLeft: boundary.x,
        };
      }
      if (Math.abs(boundary.y - best.sortTop) <= 0.5) {
        return {
          sortTop: best.sortTop,
          sortLeft: Math.min(best.sortLeft, boundary.x),
        };
      }
      return best;
    },
    {
      sortTop: overlapping[0]!.y,
      sortLeft: overlapping[0]!.x,
    },
  );
};

const getMatchRect = (
  boundaries: SearchTokenBoundary[],
  startOffset: number,
  endOffset: number,
) => {
  const overlapping = getMatchRects(boundaries, startOffset, endOffset);

  if (overlapping.length === 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const boundary of overlapping) {
    minX = Math.min(minX, boundary.x);
    minY = Math.min(minY, boundary.y);
    maxX = Math.max(maxX, boundary.x + boundary.width);
    maxY = Math.max(maxY, boundary.y + boundary.height);
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
};

export const getPdfSearchRangeGeometry = (
  textContent: TextContent,
  page: PageData,
  startOffset: number,
  endOffset: number,
) => {
  const pageText = getPageSearchText(textContent);
  if (!pageText) return null;

  const clampedStart = Math.max(
    0,
    Math.min(pageText.length, Math.trunc(startOffset)),
  );
  const clampedEnd = Math.max(
    0,
    Math.min(pageText.length, Math.trunc(endOffset)),
  );
  if (clampedEnd <= clampedStart) return null;

  const tokenBoundaries = getSearchTokenBoundaries(textContent, page);
  const rects = getMatchRects(tokenBoundaries, clampedStart, clampedEnd);
  const { sortTop, sortLeft } = getMatchSortPosition(
    tokenBoundaries,
    clampedStart,
    clampedEnd,
  );
  const rect = getMatchRect(tokenBoundaries, clampedStart, clampedEnd);

  return {
    startOffset: clampedStart,
    endOffset: clampedEnd,
    sortTop,
    sortLeft,
    rect,
    rects,
    matchText: pageText.slice(clampedStart, clampedEnd),
    contextBefore: pageText.slice(
      Math.max(0, clampedStart - SEARCH_CONTEXT_CHARS),
      clampedStart,
    ),
    contextAfter: pageText.slice(
      clampedEnd,
      Math.min(pageText.length, clampedEnd + SEARCH_CONTEXT_CHARS),
    ),
    displaySegments: buildDisplaySegments(pageText, clampedStart, clampedEnd),
  };
};

export const findPdfSearchResults = (
  textContent: TextContent,
  query: string,
  page: PageData,
  options?: PDFSearchOptions,
): PDFSearchResult[] => {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const pageText = getPageSearchText(textContent);
  if (!pageText) return [];

  const caseSensitive = options?.caseSensitive ?? false;
  const mode = options?.mode === "regex" ? "regex" : "plain";

  const results: PDFSearchResult[] = [];
  let matchIndexOnPage = 0;
  const pushResult = (matchOffset: number, endOffset: number) => {
    const geometry = getPdfSearchRangeGeometry(
      textContent,
      page,
      matchOffset,
      endOffset,
    );
    if (!geometry) return;

    results.push({
      id: `${page.pageIndex}:${matchIndexOnPage}:${matchOffset}:${endOffset}`,
      pageIndex: page.pageIndex,
      matchIndexOnPage,
      startOffset: geometry.startOffset,
      endOffset: geometry.endOffset,
      sortTop: geometry.sortTop,
      sortLeft: geometry.sortLeft,
      rect: geometry.rect,
      rects: geometry.rects,
      matchText: geometry.matchText,
      contextBefore: geometry.contextBefore,
      contextAfter: geometry.contextAfter,
      displaySegments: geometry.displaySegments,
    });
    matchIndexOnPage += 1;
  };

  if (mode === "regex") {
    let pattern: RegExp;
    try {
      pattern = new RegExp(
        trimmedQuery,
        buildRegexFlags(caseSensitive, options?.regexFlags),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid regular expression.";
      throw new Error(`Invalid regex search pattern: ${message}`);
    }

    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(pageText)) !== null) {
      const matchText = match[0] ?? "";
      if (!matchText.length) {
        pattern.lastIndex += 1;
        continue;
      }

      const matchOffset = match.index ?? 0;
      const endOffset = matchOffset + matchText.length;
      pushResult(matchOffset, endOffset);
    }
  } else {
    const normalizedPageText = caseSensitive
      ? pageText
      : pageText.toLocaleLowerCase();
    const normalizedQuery = caseSensitive
      ? trimmedQuery
      : trimmedQuery.toLocaleLowerCase();
    if (!normalizedQuery.trim()) return [];

    let cursor = 0;
    while (cursor < normalizedPageText.length) {
      const matchOffset = normalizedPageText.indexOf(normalizedQuery, cursor);
      if (matchOffset === -1) break;

      const endOffset = matchOffset + trimmedQuery.length;
      pushResult(matchOffset, endOffset);
      cursor = matchOffset + Math.max(1, normalizedQuery.length);
    }
  }

  return results.sort((a, b) => {
    if (Math.abs(a.sortTop - b.sortTop) > 2) return a.sortTop - b.sortTop;
    if (Math.abs(a.sortLeft - b.sortLeft) > 1) return a.sortLeft - b.sortLeft;
    return a.startOffset - b.startOffset;
  });
};
