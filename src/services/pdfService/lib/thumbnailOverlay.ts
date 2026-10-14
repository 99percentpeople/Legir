import {
  type PDFDocument,
  PDFName,
  StandardFonts,
  type PDFFont,
} from "@legir/pdfium/authoring";
import type { Annotation } from "@/types";
import type { ThumbnailContent } from "../types";
import { annotationExporters, controlExporters } from "../exporters";
import {
  canPreserveSourceAnnotation,
  getOrderedExportControlsByPage,
} from "./annotation-layer-order";
import { createPdfLibViewport } from "./coords";
import { prepareExportFonts } from "./export-fonts";
import { createFormExportContext } from "./form-export-context";
import { drawAnnotationPrintFallbacks } from "./print-export";

const preserveAppearance = (annotation: Annotation) =>
  annotation.type !== "comment" && canPreserveSourceAnnotation(annotation);

/** Reuse save appearances on a tiny, transparent single-page PDF in the render worker.
 * Never parse/copy the source PDF or move its bytes through the UI for an edit. */
export async function drawThumbnailOverlay(
  pdfDoc: PDFDocument,
  content: ThumbnailContent,
) {
  const pageIndex = pdfDoc.getPageCount();
  // This page and form tree exist only within the worker's native transaction.
  pdfDoc.catalog.delete(PDFName.of("AcroForm"));
  const annotations = content.annotations
    .filter((annotation) => !preserveAppearance(annotation))
    .map((annotation) => ({
      ...annotation,
      pageIndex,
      sourcePdfRef: undefined,
    }));
  const fields = content.fields.map((field) => ({
    ...field,
    pageIndex,
    sourcePdfRef: undefined,
  }));
  if (!annotations.length && !fields.length) return null;
  const page = pdfDoc.addPage([content.width, content.height]);
  const viewport = createPdfLibViewport(page, { scale: 1 });
  const fontMap = new Map<string, PDFFont>();
  for (const [name, font] of [
    ["Helvetica", StandardFonts.Helvetica],
    ["Times Roman", StandardFonts.TimesRoman],
    ["Courier", StandardFonts.Courier],
  ] as const)
    fontMap.set(name, await pdfDoc.embedFont(font));
  await prepareExportFonts({ pdfDoc, fontMap, fields, annotations });
  const form = pdfDoc.getForm();
  const context = createFormExportContext(form);
  for (const entry of getOrderedExportControlsByPage(fields, annotations).get(
    pageIndex,
  ) ?? []) {
    if (entry.kind === "annotation") {
      if (entry.control.type === "comment") {
        // Text notes have no PDF appearance stream; use the same visible
        // fallback as printing instead of silently omitting the note icon.
        await drawAnnotationPrintFallbacks({
          pages: pdfDoc.getPages(),
          annotations: [entry.control],
          getViewportForPage: async () => viewport,
          targetPageIndexSet: null,
        });
        continue;
      }
      const exporter = annotationExporters.find((candidate) =>
        candidate.shouldExport(entry.control),
      );
      await exporter?.save(pdfDoc, page, entry.control, fontMap, viewport);
    } else {
      const exporter = controlExporters.find((candidate) =>
        candidate.shouldExport(entry.control),
      );
      await exporter?.save(form, entry.control, fontMap, viewport, { context });
    }
  }
  context.flushAppearanceUpdates();
  return pageIndex;
}
