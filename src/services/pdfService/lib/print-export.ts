import { PDFArray, PDFDict, PDFName, type PDFPage, rgb } from "@cantoo/pdf-lib";
import type { Annotation } from "@/types";
import { hexToPdfColor } from "./colors";
import { uiRectToPdfBounds } from "./coords";
import type { ViewportLike } from "../types";

const getAnnotSubtypeName = (annot: PDFDict) => {
  try {
    const subtype = annot.lookup(PDFName.of("Subtype"));
    return subtype instanceof PDFName ? subtype.decodeText() : undefined;
  } catch {
    return undefined;
  }
};

const drawAnnotationPrintFallbacks = async (options: {
  pages: PDFPage[];
  annotations: Annotation[];
  getViewportForPage: (pageIndex: number) => Promise<ViewportLike | undefined>;
  targetPageIndexSet: Set<number> | null;
}) => {
  const { pages, annotations, getViewportForPage, targetPageIndexSet } =
    options;
  const fallbackSubtypesByPage = new Map<number, Set<string>>();
  const markFallbackSubtype = (pageIndex: number, ...subtypes: string[]) => {
    const existing = fallbackSubtypesByPage.get(pageIndex) ?? new Set<string>();
    for (const subtype of subtypes) existing.add(subtype);
    fallbackSubtypesByPage.set(pageIndex, existing);
  };

  for (const annotation of annotations) {
    if (targetPageIndexSet && !targetPageIndexSet.has(annotation.pageIndex)) {
      continue;
    }
    const page = pages[annotation.pageIndex];
    if (!page) continue;
    const viewport = await getViewportForPage(annotation.pageIndex);

    if (annotation.type === "highlight") {
      const rects =
        annotation.rects && annotation.rects.length > 0
          ? annotation.rects
          : annotation.rect
            ? [annotation.rect]
            : [];
      const color = hexToPdfColor(annotation.color) ?? rgb(1, 0.92, 0.2);
      const opacity =
        typeof annotation.opacity === "number" ? annotation.opacity : 0.35;

      for (const rect of rects) {
        const b = uiRectToPdfBounds(page, rect, viewport);
        page.drawRectangle({
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          color,
          opacity,
        });
      }
      if (rects.length > 0) {
        markFallbackSubtype(annotation.pageIndex, "Highlight");
      }
      continue;
    }

    if (annotation.type === "comment" && annotation.rect) {
      const b = uiRectToPdfBounds(page, annotation.rect, viewport);
      const color = hexToPdfColor(annotation.color) ?? rgb(1, 0.78, 0.2);
      const size = Math.max(10, Math.min(b.width || 16, b.height || 16));
      page.drawRectangle({
        x: b.x,
        y: b.y + Math.max(0, b.height - size),
        width: size,
        height: size,
        color,
        opacity:
          typeof annotation.opacity === "number" ? annotation.opacity : 1,
      });
      markFallbackSubtype(annotation.pageIndex, "Text", "Popup");
    }
  }

  return fallbackSubtypesByPage;
};

export const prepareAnnotationsForPrint = async (options: {
  pages: PDFPage[];
  annotations: Annotation[];
  getViewportForPage: (pageIndex: number) => Promise<ViewportLike | undefined>;
  targetPageIndexSet: Set<number> | null;
}) => {
  const { pages, targetPageIndexSet } = options;

  const fallbackSubtypesByPage = await drawAnnotationPrintFallbacks(options);

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    if (targetPageIndexSet && !targetPageIndexSet.has(pageIndex)) continue;
    const page = pages[pageIndex];
    if (!page) continue;

    const annots = page.node.Annots();
    if (!(annots instanceof PDFArray)) continue;

    const toRemove: number[] = [];
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookup(i);
      if (!(annot instanceof PDFDict)) {
        toRemove.push(i);
        continue;
      }

      const subtype = getAnnotSubtypeName(annot);
      if (
        subtype === "Widget" ||
        (subtype &&
          (fallbackSubtypesByPage.get(pageIndex)?.has(subtype) ?? false))
      ) {
        toRemove.push(i);
      }
    }

    toRemove
      .sort((left, right) => right - left)
      .forEach((index) => annots.remove(index));
  }
};
