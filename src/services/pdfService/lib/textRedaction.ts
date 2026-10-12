import {
  loadEditingDocument,
  saveEditingDocument,
  getEditingView,
} from "../engine/editingDocument";
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  type PDFPage,
} from "@cantoo/pdf-lib";
import type { Annotation } from "@/types";
import type { ViewportLike } from "../types";
import { pdfContentEngine } from "../engine";
import type { PdfQuad, PdfTextRegion } from "../engine/types";
import {
  ContentResourceCopier,
  unchangedContentResources,
} from "./contentResourceBridge";

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

/** Stage only page contents/resources, so PDFium cannot change the document's
 * form tree, annotation refs, replies, links, outline, metadata or encryption.
 * Source pages stay untouched until the entire engine operation succeeds. */
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
  if (live) {
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
    return;
  }

  // Newly embedded fonts/images have reserved refs until pdf-lib flushes them.
  await pdfDoc.flush();
  const scratch = await PDFDocument.create();
  const toScratch = new ContentResourceCopier(pdfDoc.context, scratch.context);
  const originals: PDFPage[] = [];
  const regions: PdfTextRegion[] = [];
  for (const [pageIndex, quads] of byPage) {
    const source = pages[pageIndex];
    const page = scratch.addPage();
    const media = source.getMediaBox();
    const crop = source.getCropBox();
    page.setMediaBox(media.x, media.y, media.width, media.height);
    page.setCropBox(crop.x, crop.y, crop.width, crop.height);
    page.setRotation(source.getRotation());
    const userUnit = source.node.lookupMaybe(PDFName.of("UserUnit"), PDFNumber);
    if (userUnit) page.node.set(PDFName.of("UserUnit"), userUnit.clone());
    page.node.set(
      PDFName.of("Contents"),
      toScratch.copy(source.node.get(PDFName.of("Contents"))!),
    );
    const resources = source.node.Resources();
    if (resources)
      page.node.set(PDFName.of("Resources"), toScratch.copy(resources));
    for (const quad of quads)
      regions.push({ pageIndex: originals.length, quad });
    originals.push(source);
  }

  const output = await pdfContentEngine.redactText({
    bytes: await saveEditingDocument(scratch),
    regions,
  });
  const rewritten = await loadEditingDocument(output);
  if (rewritten.getPageCount() !== originals.length)
    throw new Error("PDF content engine returned an unexpected page count.");
  const toOriginal = new ContentResourceCopier(
    rewritten.context,
    pdfDoc.context,
    unchangedContentResources(
      scratch.context,
      rewritten.context,
      toScratch.references,
    ),
  );
  const replacements = originals.map((original, index) => {
    const page = rewritten.getPage(index);
    const contents = page.node.get(PDFName.of("Contents"));
    const resources = page.node.Resources();
    if (!contents || !resources)
      throw new Error("PDF content engine returned incomplete page content.");
    // Retain unused original resources: imported annotation appearances can
    // reference them even though they are absent from the staged page contents.
    const merged =
      original.node.Resources()?.clone(pdfDoc.context) ??
      pdfDoc.context.obj({});
    const copied = toOriginal.copy(resources);
    for (const [key, value] of copied.entries()) {
      const previous = merged.lookup(key);
      const next = copied.lookup(key);
      if (previous instanceof PDFDict && next instanceof PDFDict) {
        const category = previous.clone(pdfDoc.context);
        for (const [name, ref] of next.entries()) category.set(name, ref);
        merged.set(key, category);
      } else {
        merged.set(key, value);
      }
    }
    return { original, contents: toOriginal.copy(contents), resources: merged };
  });
  for (const replacement of replacements) {
    replacement.original.node.set(PDFName.of("Contents"), replacement.contents);
    replacement.original.node.set(
      PDFName.of("Resources"),
      replacement.resources,
    );
  }
};
