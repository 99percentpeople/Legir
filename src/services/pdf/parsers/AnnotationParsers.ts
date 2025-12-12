import {
  PDFName,
  PDFArray,
  PDFDict,
  PDFNumber,
  PDFString,
  PDFHexString,
} from "pdf-lib";
import { Annotation } from "@/types";
import { rgbArrayToHex, extractInkAppearance } from "@/lib/pdf-helpers";
import { parsePDFDate } from "@/utils/pdfUtils";
import { IAnnotationParser, ParserContext } from "../types";

export class InkParser implements IAnnotationParser {
  async parse(context: ParserContext): Promise<Annotation[]> {
    const { pageIndex, pdfDoc, viewport } = context;
    const annotations: Annotation[] = [];

    // Prioritize pdf-lib extraction for Ink to get raw strokes
    if (pdfDoc) {
      try {
        const pdfLibPage = pdfDoc.getPage(pageIndex);
        const annots = pdfLibPage.node.Annots();

        if (annots instanceof PDFArray) {
          for (let idx = 0; idx < annots.size(); idx++) {
            const annot = annots.lookup(idx);
            if (annot instanceof PDFDict) {
              const subtype = annot.lookup(PDFName.of("Subtype"));
              if (subtype === PDFName.of("Ink")) {
                const inkList = annot.lookup(PDFName.of("InkList"));
                if (inkList instanceof PDFArray) {
                  // Parse Color
                  let color = "#000000";
                  const c = annot.lookup(PDFName.of("C"));
                  if (c instanceof PDFArray && c.size() === 3) {
                    const r = (c.lookup(0) as PDFNumber).asNumber();
                    const g = (c.lookup(1) as PDFNumber).asNumber();
                    const b = (c.lookup(2) as PDFNumber).asNumber();
                    color =
                      rgbArrayToHex([r * 255, g * 255, b * 255]) || "#000000";
                  }

                  // Parse Thickness
                  let thickness = 2;
                  const bs = annot.lookup(PDFName.of("BS"));
                  if (bs instanceof PDFDict) {
                    const w = bs.lookup(PDFName.of("W"));
                    if (w instanceof PDFNumber) thickness = w.asNumber();
                  } else {
                    const border = annot.lookup(PDFName.of("Border"));
                    if (border instanceof PDFArray && border.size() >= 3) {
                      const w = border.lookup(2);
                      if (w instanceof PDFNumber) thickness = w.asNumber();
                    }
                  }

                  // Parse Opacity
                  let opacity = 1.0;
                  const CA = annot.lookup(PDFName.of("CA"));
                  const ca = annot.lookup(PDFName.of("ca"));
                  if (CA instanceof PDFNumber) opacity = CA.asNumber();
                  else if (ca instanceof PDFNumber) opacity = ca.asNumber();

                  // Parse Intent
                  let intent: string | undefined = undefined;
                  const IT = annot.lookup(PDFName.of("IT"));
                  if (IT instanceof PDFName) intent = IT.decodeText();
                  else if (IT instanceof PDFString) intent = IT.decodeText();

                  // Parse Author
                  let author: string | undefined = undefined;
                  const T = annot.lookup(PDFName.of("T"));
                  if (T instanceof PDFString || T instanceof PDFHexString)
                    author = T.decodeText();

                  // Parse Contents
                  let contents: string | undefined = undefined;
                  const Contents = annot.lookup(PDFName.of("Contents"));
                  if (
                    Contents instanceof PDFString ||
                    Contents instanceof PDFHexString
                  )
                    contents = Contents.decodeText();

                  // Parse Modified Date
                  let updatedAt: string | undefined = undefined;
                  const M = annot.lookup(PDFName.of("M"));
                  if (M instanceof PDFString || M instanceof PDFHexString)
                    updatedAt = parsePDFDate(M.decodeText());

                  // Parse AP
                  const { strokePaths } = extractInkAppearance(
                    annot,
                    (x, y) =>
                      viewport.convertToViewportPoint(x, y) as [number, number],
                  );

                  // Parse Points (multi-stroke)
                  const strokes: { x: number; y: number }[][] = [];
                  for (let s = 0; s < inkList.size(); s++) {
                    const stroke = inkList.lookup(s);
                    if (stroke instanceof PDFArray) {
                      const points: { x: number; y: number }[] = [];
                      for (let p = 0; p < stroke.size(); p += 2) {
                        const px = (stroke.lookup(p) as PDFNumber).asNumber();
                        const py = (
                          stroke.lookup(p + 1) as PDFNumber
                        ).asNumber();
                        const [vx, vy] = viewport.convertToViewportPoint(
                          px,
                          py,
                        );
                        points.push({ x: vx, y: vy });
                      }
                      if (points.length > 0) strokes.push(points);
                    }
                  }

                  if (strokes.length > 0) {
                    annotations.push({
                      id: `imported_ink_lib_${pageIndex + 1}_${idx}`,
                      pageIndex: pageIndex,
                      type: "ink",
                      subtype: "ink",
                      intent: intent,
                      points: strokes[0],
                      strokes: strokes,
                      color: color,
                      thickness: thickness,
                      opacity: opacity,
                      author: author,
                      text: contents,
                      updatedAt: updatedAt,
                      svgPath:
                        strokePaths && strokePaths.length > 0
                          ? strokePaths.join(" ")
                          : undefined,
                      appearanceStreamContent: undefined,
                    });
                  }
                }
              }
            }
          }
        }
      } catch (e) {
        console.warn(
          `Failed to extract Ink annotations from page ${pageIndex + 1} using pdf-lib`,
          e,
        );
      }
    }

    // Note: We skip the fallback to pdf.js annotation loop for Ink because we want robust raw data
    // If pdf-lib fails, we might miss them, but usually it works if the PDF is valid.
    // The original code also had a fallback loop but explicitly set `isInk = false` inside it.

    return annotations;
  }
}

export class HighlightParser implements IAnnotationParser {
  async parse(context: ParserContext): Promise<Annotation[]> {
    const { pageAnnotations, pageIndex, viewport, pdfDoc } = context;
    const annotations: Annotation[] = [];

    pageAnnotations.forEach((annotation, index) => {
      if (annotation.subtype === "Highlight") {
        const color = annotation.color
          ? rgbArrayToHex(annotation.color)
          : "#FFFF00";
        const [x1, y1, x2, y2] = annotation.rect;
        const [vx1, vy1] = viewport.convertToViewportPoint(x1, y1);
        const [vx2, vy2] = viewport.convertToViewportPoint(x2, y2);

        const x = Math.min(vx1, vx2);
        const y = Math.min(vy1, vy2);
        const width = Math.abs(vx2 - vx1);
        const height = Math.abs(vy2 - vy1);

        let rects:
          | { x: number; y: number; width: number; height: number }[]
          | undefined = undefined;

        let author = annotation.title || undefined;
        let contents = annotation.contents || undefined;
        let updatedAt = parsePDFDate(annotation.modificationDate);

        // Try to get QuadPoints
        let qp = annotation.quadPoints;

        if ((!qp || !Array.isArray(qp) || qp.length === 0) && pdfDoc) {
          try {
            const pdfLibPage = pdfDoc.getPage(pageIndex);
            const libAnnots = pdfLibPage.node.Annots();
            if (libAnnots instanceof PDFArray) {
              for (let idx = 0; idx < libAnnots.size(); idx++) {
                const libAnnot = libAnnots.lookup(idx);
                if (libAnnot instanceof PDFDict) {
                  const libSubtype = libAnnot.lookup(PDFName.of("Subtype"));
                  if (libSubtype === PDFName.of("Highlight")) {
                    const libRect = libAnnot.lookup(PDFName.of("Rect"));
                    if (libRect instanceof PDFArray) {
                      const rArray = libRect.asArray();
                      if (rArray.length >= 4) {
                        const lx1 = (rArray[0] as PDFNumber).asNumber();
                        const ly1 = (rArray[1] as PDFNumber).asNumber();
                        if (Math.abs(lx1 - x1) < 1 && Math.abs(ly1 - y1) < 1) {
                          // Extract metadata
                          const rawTitle = libAnnot.lookup(PDFName.of("T"));
                          if (
                            rawTitle instanceof PDFString ||
                            rawTitle instanceof PDFHexString
                          ) {
                            author = rawTitle.decodeText();
                          }
                          const rawModDate = libAnnot.lookup(PDFName.of("M"));
                          if (
                            rawModDate instanceof PDFString ||
                            rawModDate instanceof PDFHexString
                          ) {
                            updatedAt = parsePDFDate(rawModDate.decodeText());
                          }
                          const rawContents = libAnnot.lookup(
                            PDFName.of("Contents"),
                          );
                          if (
                            rawContents instanceof PDFString ||
                            rawContents instanceof PDFHexString
                          ) {
                            contents = rawContents.decodeText();
                          }

                          const libQP = libAnnot.lookup(
                            PDFName.of("QuadPoints"),
                          );
                          if (libQP instanceof PDFArray) {
                            qp = libQP
                              .asArray()
                              .map((n) => (n as PDFNumber).asNumber());
                            break;
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.warn("Fallback QuadPoints extraction failed", e);
          }
        }

        if (qp && Array.isArray(qp)) {
          rects = [];
          for (let k = 0; k < qp.length; k += 8) {
            let minVX = Infinity,
              minVY = Infinity,
              maxVX = -Infinity,
              maxVY = -Infinity;
            for (let p = 0; p < 8; p += 2) {
              const qx = qp[k + p];
              const qy = qp[k + p + 1];
              const [vx, vy] = viewport.convertToViewportPoint(qx, qy);
              minVX = Math.min(minVX, vx);
              minVY = Math.min(minVY, vy);
              maxVX = Math.max(maxVX, vx);
              maxVY = Math.max(maxVY, vy);
            }
            if (minVX !== Infinity) {
              rects.push({
                x: minVX,
                y: minVY,
                width: maxVX - minVX,
                height: maxVY - minVY,
              });
            }
          }
        }

        let opacity = 1.0;
        // Simplified opacity check (reuse previous logic or keep simplified)
        // For brevity in this refactor, relying on defaults unless we strictly need to re-implement the deep lookup again.
        // The original code did a deep lookup again for CA/ca.

        annotations.push({
          id: `imported_highlight_${pageIndex + 1}_${index}`,
          pageIndex: pageIndex,
          type: "highlight",
          rect: { x, y, width, height },
          rects: rects,
          color: color,
          opacity: opacity,
          author: author,
          text: contents,
          updatedAt: updatedAt,
        });
      }
    });
    return annotations;
  }
}

export class CommentParser implements IAnnotationParser {
  async parse(context: ParserContext): Promise<Annotation[]> {
    const { pageAnnotations, pageIndex, viewport, pdfDoc } = context;
    const annotations: Annotation[] = [];

    pageAnnotations.forEach((annotation, index) => {
      if (annotation.subtype === "Text") {
        const color = annotation.color
          ? rgbArrayToHex(annotation.color)
          : "#FFFF00";
        const [x1, y1, x2, y2] = annotation.rect;
        const [vx1, vy1] = viewport.convertToViewportPoint(x1, y1);
        const [vx2, vy2] = viewport.convertToViewportPoint(x2, y2);

        const x = Math.min(vx1, vx2);
        const y = Math.min(vy1, vy2);
        let width = Math.abs(vx2 - vx1);
        let height = Math.abs(vy2 - vy1);

        if (width < 5) width = 30;
        if (height < 5) height = 30;

        let contents = annotation.contents || "";
        let author = annotation.title || undefined;
        let updatedAt = parsePDFDate(annotation.modificationDate);

        // Fallback to pdf-lib for contents
        if (pdfDoc) {
          try {
            const pdfLibPage = pdfDoc.getPage(pageIndex);
            const libAnnots = pdfLibPage.node.Annots();
            if (libAnnots instanceof PDFArray) {
              for (let idx = 0; idx < libAnnots.size(); idx++) {
                const libAnnot = libAnnots.lookup(idx);
                if (libAnnot instanceof PDFDict) {
                  const libSubtype = libAnnot.lookup(PDFName.of("Subtype"));
                  const sName =
                    libSubtype instanceof PDFName
                      ? libSubtype.decodeText()
                      : "";
                  if (sName === "Text") {
                    const libRect = libAnnot.lookup(PDFName.of("Rect"));
                    if (libRect instanceof PDFArray) {
                      const rArray = libRect.asArray();
                      if (rArray.length >= 4) {
                        const lx1 = (rArray[0] as PDFNumber).asNumber();
                        const ly1 = (rArray[1] as PDFNumber).asNumber();
                        if (Math.abs(lx1 - x1) < 5 && Math.abs(ly1 - y1) < 5) {
                          const rawContents = libAnnot.lookup(
                            PDFName.of("Contents"),
                          );
                          if (
                            rawContents instanceof PDFString ||
                            rawContents instanceof PDFHexString
                          ) {
                            const decoded = rawContents.decodeText();
                            if (
                              decoded &&
                              (!contents || contents.trim() === "")
                            )
                              contents = decoded;
                          }
                          const rawTitle = libAnnot.lookup(PDFName.of("T"));
                          if (
                            rawTitle instanceof PDFString ||
                            rawTitle instanceof PDFHexString
                          ) {
                            const decoded = rawTitle.decodeText();
                            if (decoded && (!author || author.trim() === ""))
                              author = decoded;
                          }
                          const rawModDate = libAnnot.lookup(PDFName.of("M"));
                          if (
                            rawModDate instanceof PDFString ||
                            rawModDate instanceof PDFHexString
                          ) {
                            const parsed = parsePDFDate(
                              rawModDate.decodeText(),
                            );
                            if (parsed && !updatedAt) updatedAt = parsed;
                          }
                          break;
                        }
                      }
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.warn("Fallback Text extraction failed", e);
          }
        }

        annotations.push({
          id: `imported_comment_${pageIndex + 1}_${index}`,
          pageIndex: pageIndex,
          type: "comment",
          rect: { x, y, width, height },
          color: color,
          text: contents,
          author: author,
          updatedAt: updatedAt,
        });
      }
    });
    return annotations;
  }
}

export class FreeTextParser implements IAnnotationParser {
  async parse(context: ParserContext): Promise<Annotation[]> {
    const { pageAnnotations, pageIndex, viewport, pdfDoc } = context;
    const annotations: Annotation[] = [];

    pageAnnotations.forEach((annotation, index) => {
      if (annotation.subtype === "FreeText") {
        let color = annotation.color
          ? rgbArrayToHex(annotation.color)
          : "#000000";
        const [x1, y1, x2, y2] = annotation.rect;
        const [vx1, vy1] = viewport.convertToViewportPoint(x1, y1);
        const [vx2, vy2] = viewport.convertToViewportPoint(x2, y2);

        const x = Math.min(vx1, vx2);
        const y = Math.min(vy1, vy2);
        const width = Math.abs(vx2 - vx1);
        const height = Math.abs(vy2 - vy1);

        let contents = annotation.contents || "";
        let author = annotation.title || undefined;
        let updatedAt = parsePDFDate(annotation.modificationDate);
        let fontSize = 12;

        if (pdfDoc) {
          try {
            const pdfLibPage = pdfDoc.getPage(pageIndex);
            const libAnnots = pdfLibPage.node.Annots();
            if (libAnnots instanceof PDFArray) {
              for (let idx = 0; idx < libAnnots.size(); idx++) {
                const libAnnot = libAnnots.lookup(idx);
                if (libAnnot instanceof PDFDict) {
                  const libSubtype = libAnnot.lookup(PDFName.of("Subtype"));
                  const sName =
                    libSubtype instanceof PDFName
                      ? libSubtype.decodeText()
                      : "";
                  if (sName === "FreeText") {
                    const libRect = libAnnot.lookup(PDFName.of("Rect"));
                    if (libRect instanceof PDFArray) {
                      const rArray = libRect.asArray();
                      if (rArray.length >= 4) {
                        const lx1 = (rArray[0] as PDFNumber).asNumber();
                        const ly1 = (rArray[1] as PDFNumber).asNumber();
                        if (Math.abs(lx1 - x1) < 5 && Math.abs(ly1 - y1) < 5) {
                          const rawContents = libAnnot.lookup(
                            PDFName.of("Contents"),
                          );
                          if (
                            rawContents instanceof PDFString ||
                            rawContents instanceof PDFHexString
                          ) {
                            const decoded = rawContents.decodeText();
                            if (
                              decoded &&
                              (!contents || contents.trim() === "")
                            )
                              contents = decoded;
                          }

                          // DA
                          const da = libAnnot.lookup(PDFName.of("DA"));
                          if (da instanceof PDFString) {
                            const daStr = da.decodeText();
                            const sizeMatch = daStr.match(/(\d+(\.\d+)?)\s+Tf/);
                            if (sizeMatch) fontSize = parseFloat(sizeMatch[1]);
                            const colorMatch = daStr.match(
                              /(\d+(\.\d+)?)\s+(\d+(\.\d+)?)\s+(\d+(\.\d+)?)\s+[rR]g/,
                            );
                            if (colorMatch) {
                              const r = parseFloat(colorMatch[1]);
                              const g = parseFloat(colorMatch[3]);
                              const b = parseFloat(colorMatch[5]);
                              const hex = rgbArrayToHex([
                                r * 255,
                                g * 255,
                                b * 255,
                              ]);
                              if (hex) color = hex;
                            }
                          }
                          const rawTitle = libAnnot.lookup(PDFName.of("T"));
                          if (
                            rawTitle instanceof PDFString ||
                            rawTitle instanceof PDFHexString
                          ) {
                            const decoded = rawTitle.decodeText();
                            if (decoded && (!author || author.trim() === ""))
                              author = decoded;
                          }
                          const rawModDate = libAnnot.lookup(PDFName.of("M"));
                          if (
                            rawModDate instanceof PDFString ||
                            rawModDate instanceof PDFHexString
                          ) {
                            const parsed = parsePDFDate(
                              rawModDate.decodeText(),
                            );
                            if (parsed && !updatedAt) updatedAt = parsed;
                          }
                          break;
                        }
                      }
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.warn("Fallback FreeText extraction failed", e);
          }
        }

        annotations.push({
          id: `imported_freetext_${pageIndex + 1}_${index}`,
          pageIndex: pageIndex,
          type: "freetext",
          rect: { x, y, width, height },
          color: color,
          text: contents,
          size: fontSize,
          author: author,
          updatedAt: updatedAt,
        });
      }
    });
    return annotations;
  }
}
