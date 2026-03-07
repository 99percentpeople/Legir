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
): TextNodePosition | null => {
  if (boundaries.length === 0) return null;

  const last = boundaries[boundaries.length - 1];
  const clamped = Math.max(0, Math.min(offset, last.end));

  for (const boundary of boundaries) {
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

const toLocalHighlightRect = (
  rect: DOMRect,
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
    const start = locateTextNodePosition(boundaries, match.startOffset);
    const end = locateTextNodePosition(boundaries, match.endOffset);
    if (!start || !end) continue;

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);

    const localRects = mergeLocalRects(
      Array.from(range.getClientRects())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => toLocalHighlightRect(rect, rootRect)),
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
) => {
  const boundaries = collectTextNodeBoundaries(root);
  if (boundaries.length === 0) return false;

  const start = locateTextNodePosition(boundaries, startOffset);
  const end = locateTextNodePosition(boundaries, endOffset);
  if (!start || !end) return false;

  const selection = window.getSelection?.();
  if (!selection) return false;

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);

  selection.removeAllRanges();
  selection.addRange(range);
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

  const startRange = document.createRange();
  startRange.selectNodeContents(root);
  startRange.setEnd(range.startContainer, range.startOffset);

  const endRange = document.createRange();
  endRange.selectNodeContents(root);
  endRange.setEnd(range.endContainer, range.endOffset);

  const startOffset = startRange.toString().length;
  const endOffset = endRange.toString().length;
  if (endOffset <= startOffset) return null;

  return { startOffset, endOffset };
};
