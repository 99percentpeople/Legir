import type { PDFSearchResult } from "@/types";

type SearchHighlightRect = {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
  isActive: boolean;
};

type LocalHighlightRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type TextNodeBoundary = {
  node: Text;
  start: number;
  end: number;
};

type TextNodePosition = {
  node: Text;
  offset: number;
};

type TextNodeBoundaryAffinity = "next" | "previous";

type ScrollRestoreTarget = {
  element: HTMLElement;
};

const LINE_TOLERANCE_PX = 2;
const MIN_GAP_TOLERANCE_PX = 3;
const GAP_TOLERANCE_HEIGHT_RATIO = 0.45;

const collectTextNodeBoundaries = (root: HTMLElement): TextNodeBoundary[] => {
  const boundaries: TextNodeBoundary[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let currentOffset = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!(node instanceof Text)) continue;
    if (!node.data) continue;

    boundaries.push({
      node,
      start: currentOffset,
      end: currentOffset + node.data.length,
    });
    currentOffset += node.data.length;
  }

  return boundaries;
};

const locateTextNodePosition = (
  boundaries: TextNodeBoundary[],
  offset: number,
  affinity: TextNodeBoundaryAffinity = "next",
): TextNodePosition | null => {
  if (boundaries.length === 0) return null;

  const last = boundaries[boundaries.length - 1];
  const clamped = Math.max(0, Math.min(offset, last.end));

  for (const boundary of boundaries) {
    if (
      affinity === "previous" &&
      clamped > boundary.start &&
      clamped === boundary.end
    ) {
      return {
        node: boundary.node,
        offset: boundary.node.data.length,
      };
    }

    if (clamped >= boundary.start && clamped < boundary.end) {
      return {
        node: boundary.node,
        offset: clamped - boundary.start,
      };
    }
  }

  return {
    node: last.node,
    offset: last.node.data.length,
  };
};

const createTextRange = (
  boundaries: TextNodeBoundary[],
  startOffset: number,
  endOffset: number,
  options?: {
    endAffinity?: TextNodeBoundaryAffinity;
  },
) => {
  const start = locateTextNodePosition(boundaries, startOffset);
  // Search/selection offsets are text-only. When an end offset lands exactly on a
  // text-node boundary, prefer the previous text node so DOM-only separators like
  // <br> are not pulled into the reconstructed Range.
  const end = locateTextNodePosition(
    boundaries,
    endOffset,
    options?.endAffinity ?? "previous",
  );
  if (!start || !end) return null;

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
};

const getTextOffsetFromBoundary = (
  boundaries: TextNodeBoundary[],
  node: Node,
  offset: number,
) => {
  // Convert the DOM boundary back into a text-only offset by walking real text
  // nodes. This keeps <br> and other non-text DOM helpers out of serialized
  // offsets, so restoring the selection later does not grow past the last glyph.
  const point = document.createRange();
  point.setStart(node, offset);
  point.collapse(true);

  let textOffset = 0;

  for (const boundary of boundaries) {
    const start = document.createRange();
    start.setStart(boundary.node, 0);
    start.collapse(true);

    const end = document.createRange();
    end.setStart(boundary.node, boundary.node.length);
    end.collapse(true);

    const vsEnd = point.compareBoundaryPoints(Range.START_TO_START, end);
    if (vsEnd >= 0) {
      textOffset = boundary.end;
      continue;
    }

    const vsStart = point.compareBoundaryPoints(Range.START_TO_START, start);
    if (vsStart <= 0) {
      return textOffset;
    }

    if (node === boundary.node && node instanceof Text) {
      return (
        boundary.start + Math.max(0, Math.min(boundary.node.length, offset))
      );
    }

    return textOffset;
  }

  return textOffset;
};

const toLocalHighlightRect = (
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
  rootRect: DOMRect,
): LocalHighlightRect => ({
  left: rect.left - rootRect.left,
  top: rect.top - rootRect.top,
  width: rect.width,
  height: rect.height,
});

const sortLocalRects = (rects: LocalHighlightRect[]) =>
  [...rects].sort((a, b) => {
    if (Math.abs(a.top - b.top) > LINE_TOLERANCE_PX) {
      return a.top - b.top;
    }
    return a.left - b.left;
  });

const canMergeLocalRects = (
  current: LocalHighlightRect,
  next: LocalHighlightRect,
) => {
  const currentCenterY = current.top + current.height / 2;
  const nextCenterY = next.top + next.height / 2;
  const minHeight = Math.max(1, Math.min(current.height, next.height));
  const sameLine =
    Math.abs(currentCenterY - nextCenterY) <=
    Math.max(LINE_TOLERANCE_PX, minHeight * 0.35);
  if (!sameLine) return false;

  const currentRight = current.left + current.width;
  const gap = next.left - currentRight;
  const gapTolerance = Math.max(
    MIN_GAP_TOLERANCE_PX,
    minHeight * GAP_TOLERANCE_HEIGHT_RATIO,
  );

  return gap <= gapTolerance;
};

const mergeLocalRects = (rects: LocalHighlightRect[]) => {
  if (rects.length <= 1) return rects;

  const merged: LocalHighlightRect[] = [];

  for (const rect of sortLocalRects(rects)) {
    const last = merged[merged.length - 1];
    if (!last || !canMergeLocalRects(last, rect)) {
      merged.push({ ...rect });
      continue;
    }

    const right = Math.max(last.left + last.width, rect.left + rect.width);
    const bottom = Math.max(last.top + last.height, rect.top + rect.height);

    last.left = Math.min(last.left, rect.left);
    last.top = Math.min(last.top, rect.top);
    last.width = right - last.left;
    last.height = bottom - last.top;
  }

  return merged;
};

const getMergedRangeClientRects = (range: Range) =>
  mergeLocalRects(
    Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      })),
  );

export const getPdfSearchRangeClientRects = (
  root: HTMLElement,
  startOffset: number,
  endOffset: number,
) => {
  const boundaries = collectTextNodeBoundaries(root);
  if (boundaries.length === 0) return [];

  const range = createTextRange(boundaries, startOffset, endOffset);
  if (!range) return [];

  return getMergedRangeClientRects(range);
};

export const getPdfSearchTextSlice = (
  root: HTMLElement,
  startOffset: number,
  endOffset: number,
) => {
  const boundaries = collectTextNodeBoundaries(root);
  if (boundaries.length === 0) return "";

  const parts: string[] = [];
  for (const boundary of boundaries) {
    const overlapStart = Math.max(boundary.start, startOffset);
    const overlapEnd = Math.min(boundary.end, endOffset);
    if (overlapEnd <= overlapStart) continue;

    parts.push(
      boundary.node.data.slice(
        overlapStart - boundary.start,
        overlapEnd - boundary.start,
      ),
    );
  }

  return parts.join("");
};

export const getPdfSearchHighlightRects = (
  root: HTMLElement,
  matches: PDFSearchResult[],
  activeMatchId: string | null,
): SearchHighlightRect[] => {
  if (matches.length === 0) return [];

  const boundaries = collectTextNodeBoundaries(root);
  if (boundaries.length === 0) return [];

  const rootRect = root.getBoundingClientRect();
  if (rootRect.width <= 0 || rootRect.height <= 0) return [];
  const rects: SearchHighlightRect[] = [];

  for (const match of matches) {
    const range = createTextRange(
      boundaries,
      match.startOffset,
      match.endOffset,
    );
    if (!range) continue;

    const localRects = getMergedRangeClientRects(range).map((rect) =>
      toLocalHighlightRect(rect, rootRect),
    );

    for (let index = 0; index < localRects.length; index += 1) {
      const rect = localRects[index];
      rects.push({
        key: `${match.id}:${index}`,
        left: rect.left / rootRect.width,
        top: rect.top / rootRect.height,
        width: rect.width / rootRect.width,
        height: rect.height / rootRect.height,
        isActive: match.id === activeMatchId,
      });
    }
  }

  return rects;
};

export const selectPdfSearchTextRange = (
  root: HTMLElement,
  startOffset: number,
  endOffset: number,
  options?: {
    restoreScrollTarget?: ScrollRestoreTarget;
    endAffinity?: TextNodeBoundaryAffinity;
  },
) => {
  const boundaries = collectTextNodeBoundaries(root);
  if (boundaries.length === 0) return false;

  const selection = window.getSelection?.();
  if (!selection) return false;

  const range = createTextRange(boundaries, startOffset, endOffset, {
    endAffinity: options?.endAffinity,
  });
  if (!range) return false;

  const restoreTarget = options?.restoreScrollTarget;
  const prevScrollLeft = restoreTarget?.element.scrollLeft ?? 0;
  const prevScrollTop = restoreTarget?.element.scrollTop ?? 0;

  selection.removeAllRanges();
  selection.addRange(range);

  if (restoreTarget) {
    const { element } = restoreTarget;
    if (
      element.scrollLeft !== prevScrollLeft ||
      element.scrollTop !== prevScrollTop
    ) {
      element.scrollTo({
        left: prevScrollLeft,
        top: prevScrollTop,
        behavior: "auto",
      });
    }
  }

  return !selection.isCollapsed;
};

export const getPdfSearchSelectionOffsets = (
  root: HTMLElement,
  selection: Selection | null | undefined = window.getSelection?.(),
) => {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const boundaries = collectTextNodeBoundaries(root);
  if (boundaries.length === 0) return null;

  const isWithinRoot = (node: Node | null) => {
    if (!node) return false;
    const element = node instanceof Element ? node : node.parentElement;
    return !!element && root.contains(element);
  };

  if (
    !isWithinRoot(range.startContainer) ||
    !isWithinRoot(range.endContainer)
  ) {
    return null;
  }

  const startOffset = getTextOffsetFromBoundary(
    boundaries,
    range.startContainer,
    range.startOffset,
  );
  const endOffset = getTextOffsetFromBoundary(
    boundaries,
    range.endContainer,
    range.endOffset,
  );
  if (endOffset <= startOffset) return null;

  return { startOffset, endOffset };
};
