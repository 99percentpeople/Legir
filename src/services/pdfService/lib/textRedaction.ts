import { getEditingView } from "../engine/editingDocument";
import type { PDFDocument, PDFPage } from "@legir/pdfium/authoring";
import type { Annotation } from "@/types";
import type { ViewportLike } from "../types";
import type { PdfQuad } from "../engine/types";

const annotationQuad = (
  annotation: Annotation,
  viewport: ViewportLike,
): PdfQuad => {
  const rect = annotation.rect!;
  const angle = ((annotation.rotationDeg ?? 0) * Math.PI) / 180;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x, rect.y + rect.height],
    [rect.x + rect.width, rect.y + rect.height],
  ].flatMap(([x, y]) =>
    viewport.convertToPdfPoint(
      cx + (x - cx) * Math.cos(angle) - (y - cy) * Math.sin(angle),
      cy + (x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle),
    ),
  ) as PdfQuad;
};

/** Update page contents/resources in the caller's native transaction. Other
 * document structures remain intact; the owning export restores the transaction
 * on completion, failure or cancellation. */
export const applyTextRedactionsUnderFlattenedFreetext = async (args: {
  pdfDoc: PDFDocument;
  pages: PDFPage[];
  annotations: Annotation[];
  getViewportForPage: (pageIndex: number) => Promise<ViewportLike | undefined>;
  targetPageIndexSet?: Set<number> | null;
}): Promise<void> => {
  const { pdfDoc, pages, annotations, getViewportForPage, targetPageIndexSet } =
    args;
  const byPage = new Map<number, PdfQuad[]>();
  for (const annotation of annotations) {
    if (
      annotation.type !== "freetext" ||
      !annotation.flatten ||
      !annotation.rect
    )
      continue;
    if (targetPageIndexSet && !targetPageIndexSet.has(annotation.pageIndex))
      continue;
    const page = pages[annotation.pageIndex];
    if (!page?.node.Contents()) continue;
    const viewport = await getViewportForPage(annotation.pageIndex);
    if (!viewport)
      throw new Error("Cannot resolve the PDF text replacement coordinates.");
    const quads = byPage.get(annotation.pageIndex) ?? [];
    quads.push(annotationQuad(annotation, viewport));
    byPage.set(annotation.pageIndex, quads);
  }
  if (!byPage.size) return;

  const live = getEditingView(pdfDoc);
  if (!live)
    throw new Error("Text replacement requires the live PDFium document.");
  await live.flush();
  live.native.setPageTreeCache(false);
  for (const [pageIndex, quads] of byPage) {
    const page = live.native.loadPage(pageIndex);
    try {
      page.redactText(quads);
    } finally {
      page.destroy();
    }
  }
};
