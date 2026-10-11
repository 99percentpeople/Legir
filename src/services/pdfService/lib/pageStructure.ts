import type { PageData, PDFOutlineItem } from "@/types";

export const getPageId = (page: PageData) =>
  page.id ?? `original:${page.pageIndex}`;

export const identifyPage = (page: PageData): PageData => {
  if (
    page.id !== undefined &&
    (page.blank ? page.source === undefined : page.source !== undefined)
  )
    return page;
  return {
    ...page,
    id: getPageId(page),
    source: page.blank
      ? undefined
      : (page.source ?? { documentId: "default", pageIndex: page.pageIndex }),
  };
};

export const identifyPages = (pages: PageData[]) => pages.map(identifyPage);

export const mapPageIndexes = (before: PageData[], after: PageData[]) => {
  const positions = new Map(
    after.map((page, index) => [getPageId(page), index]),
  );
  return new Map(
    before.map((page, index) => [index, positions.get(getPageId(page))]),
  );
};

export const remapOutline = (
  outline: PDFOutlineItem[],
  indexes: Map<number, number | undefined>,
): PDFOutlineItem[] =>
  outline.map((item) => ({
    ...item,
    pageIndex:
      item.pageIndex === undefined ? undefined : indexes.get(item.pageIndex),
    items: remapOutline(item.items, indexes),
  }));
