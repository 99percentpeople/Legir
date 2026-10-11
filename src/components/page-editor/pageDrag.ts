import { getPageId } from "@/services/pdfService/lib/pageStructure";
import type { PageData } from "@/types";
import type { PageGridLayout } from "./pageGridLayout";

/** Preview a block move without creating history or changing PDF page indices. */
export function previewPageMove(
  pages: PageData[],
  ids: Set<string>,
  beforeIndex: number,
): PageData[] {
  const moving = pages.filter((page) => ids.has(getPageId(page)));
  const rest = pages.filter((page) => !ids.has(getPageId(page)));
  const at = pages
    .slice(0, beforeIndex)
    .filter((page) => !ids.has(getPageId(page))).length;
  rest.splice(at, 0, ...moving);
  return rest;
}

export function fileInsertionIndex(
  x: number,
  y: number,
  total: number,
  { columns, rowHeight, offset, cardWidth, columnGap }: PageGridLayout,
) {
  const cell = cardWidth + columnGap;
  const column = Math.min(
    columns - 1,
    Math.max(0, Math.floor((x - offset) / cell)),
  );
  const row = Math.max(0, Math.floor(y / rowHeight));
  return Math.min(
    total,
    row * columns +
      column +
      (x - offset - column * cell > cardWidth / 2 ? 1 : 0),
  );
}
