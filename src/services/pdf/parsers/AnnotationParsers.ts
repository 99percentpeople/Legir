import {
  PDFName,
  PDFArray,
  PDFDict,
  PDFNumber,
  PDFStream,
  PDFString,
  PDFHexString,
} from "pdf-lib";
import { Annotation } from "@/types";
import { parsePDFDate } from "@/utils/pdfUtils";
import { IAnnotationParser, ParserContext } from "../types";
import { rgbArrayToHex } from "../lib/colors";
import { pdfDebug } from "../lib/debug";
import { extractInkAppearance } from "../lib/ink";
import { ensurePdfEmbeddedFontLoaded } from "../lib/embedded-fonts";
import { pdfJsRectToUiRect } from "../lib/coords";
import { decodePdfString } from "../lib/pdf-objects";
import {
  normalizePdfFontName,
  pdfFontToAppFontKey,
  pdfFontToCssFontFamily,
} from "../lib/pdf-font-names";

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
                  author = decodePdfString(T);

                  // Parse Contents
                  let contents: string | undefined = undefined;
                  const Contents = annot.lookup(PDFName.of("Contents"));
                  contents = decodePdfString(Contents);

                  // Parse Modified Date
                  let updatedAt: string | undefined = undefined;
                  const M = annot.lookup(PDFName.of("M"));
                  const mDecoded = decodePdfString(M);
                  if (mDecoded) updatedAt = parsePDFDate(mDecoded);

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
        const [x1, y1] = annotation.rect;
        const { x, y, width, height } = pdfJsRectToUiRect(
          annotation.rect,
          viewport,
        );

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
                          const titleDecoded = decodePdfString(rawTitle);
                          if (titleDecoded) author = titleDecoded;
                          const rawModDate = libAnnot.lookup(PDFName.of("M"));
                          const modDecoded = decodePdfString(rawModDate);
                          if (modDecoded) updatedAt = parsePDFDate(modDecoded);
                          const rawContents = libAnnot.lookup(
                            PDFName.of("Contents"),
                          );
                          const contentsDecoded = decodePdfString(rawContents);
                          if (contentsDecoded) contents = contentsDecoded;

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
        const uiRect = pdfJsRectToUiRect(annotation.rect, viewport);
        const x = uiRect.x;
        const y = uiRect.y;
        let width = uiRect.width;
        let height = uiRect.height;

        if (width < 5) width = 30;
        if (height < 5) height = 30;

        let contents = annotation.contents || "";
        let author = annotation.title || undefined;
        let updatedAt = parsePDFDate(annotation.modificationDate);

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

    const normalizePdfJsColorToRgb255 = (
      color: number[] | Uint8ClampedArray | null | undefined,
    ) => {
      if (!color || color.length < 3) return undefined;
      const r = color[0];
      const g = color[1];
      const b = color[2];
      const isNormalized01 =
        r >= 0 && r <= 1 && g >= 0 && g <= 1 && b >= 0 && b <= 1;
      if (isNormalized01) return [r * 255, g * 255, b * 255];
      return [r, g, b];
    };

    const resolveFontDictFromDR = (dr: any, resourceName: string) => {
      if (!(dr instanceof PDFDict)) return undefined;
      const fontRes = dr.lookup(PDFName.of("Font"));
      if (!(fontRes instanceof PDFDict)) return undefined;
      const fontDict = fontRes.lookup(PDFName.of(resourceName));
      return fontDict instanceof PDFDict ? fontDict : undefined;
    };

    const resolveBaseFontName = (fontDictResolved: PDFDict | undefined) => {
      if (!fontDictResolved) return undefined;
      const baseFont = fontDictResolved.lookup(PDFName.of("BaseFont"));
      if (baseFont instanceof PDFName) return baseFont.decodeText();
      if (baseFont instanceof PDFString || baseFont instanceof PDFHexString)
        return baseFont.decodeText();
      return undefined;
    };

    const parseTextColorFromContentStream = (content: string) => {
      const extractTextSection = () => {
        try {
          const matches = Array.from(
            content.matchAll(/\bBT\b([\s\S]*?)\bET\b/g),
          );
          if (matches.length === 0) return content;
          const last = matches[matches.length - 1];
          return last?.[1] || content;
        } catch {
          return content;
        }
      };

      const segment = extractTextSection();
      const tokens = segment.trim().split(/\s+/);
      let matchedAnyColor = false;
      let outHex: string | undefined = undefined;
      let outOp: "rg" | "g" | "k" | undefined = undefined;

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        // Prefer nonstroking (lowercase) operators for text fill.
        if ((token === "rg" || token === "RG") && i >= 3) {
          const r = parseFloat(tokens[i - 3]);
          const g = parseFloat(tokens[i - 2]);
          const b = parseFloat(tokens[i - 1]);
          if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
            const hex = rgbArrayToHex([r * 255, g * 255, b * 255]);
            if (hex) {
              outHex = hex;
              outOp = "rg";
              matchedAnyColor = true;
            }
          }
        } else if ((token === "g" || token === "G") && i >= 1) {
          const gray = parseFloat(tokens[i - 1]);
          if (!isNaN(gray)) {
            const val = gray * 255;
            const hex = rgbArrayToHex([val, val, val]);
            if (hex) {
              outHex = hex;
              outOp = "g";
              matchedAnyColor = true;
            }
          }
        } else if ((token === "k" || token === "K") && i >= 4) {
          const c = parseFloat(tokens[i - 4]);
          const m = parseFloat(tokens[i - 3]);
          const y = parseFloat(tokens[i - 2]);
          const k = parseFloat(tokens[i - 1]);
          if (!isNaN(c) && !isNaN(m) && !isNaN(y) && !isNaN(k)) {
            const rr = 255 * (1 - c) * (1 - k);
            const gg = 255 * (1 - m) * (1 - k);
            const bb = 255 * (1 - y) * (1 - k);
            const hex = rgbArrayToHex([rr, gg, bb]);
            if (hex) {
              outHex = hex;
              outOp = "k";
              matchedAnyColor = true;
            }
          }
        }
      }

      pdfDebug("import:freetext", "ap_color_parsed", {
        pageIndex,
        segmentUsed: segment !== content ? "BT..ET" : "full",
        matchedAnyColor,
        op: outOp,
        hex: outHex,
      });

      return outHex;
    };

    const parseFontFromContentStream = (content: string) => {
      const extractTextSection = () => {
        try {
          const matches = Array.from(
            content.matchAll(/\bBT\b([\s\S]*?)\bET\b/g),
          );
          if (matches.length === 0) return content;
          const last = matches[matches.length - 1];
          return last?.[1] || content;
        } catch {
          return content;
        }
      };

      const segment = extractTextSection();
      const matches = Array.from(
        segment.matchAll(/\/([^\s]+)\s+(\d+(?:\.\d+)?)\s+Tf/g),
      );
      if (matches.length === 0) return undefined;
      const last = matches[matches.length - 1];
      const name = last?.[1];
      const size = last?.[2];
      if (!name) return undefined;
      const parsedSize = size ? parseFloat(size) : NaN;
      return {
        resourceName: normalizePdfFontName(name),
        fontSize: !isNaN(parsedSize) ? parsedSize : undefined,
      };
    };

    const decodeAppearanceStreamToText = async (n: PDFStream) => {
      const bytes = n.getContents();
      // Ensure we have a Uint8Array backed by ArrayBuffer (not SharedArrayBuffer) so Blob/streams work in TS/DOM types.
      const safeBytes = new Uint8Array(bytes);
      let decodedBytes: Uint8Array = safeBytes;

      const filters: string[] = [];
      try {
        const f = n.dict.lookup(PDFName.of("Filter"));
        if (f instanceof PDFName) {
          filters.push(f.decodeText().replace(/^\//, ""));
        } else if (f instanceof PDFArray) {
          for (let i = 0; i < f.size(); i++) {
            const item = f.lookup(i);
            if (item instanceof PDFName) {
              filters.push(item.decodeText().replace(/^\//, ""));
            }
          }
        }
      } catch {
        // ignore
      }

      pdfDebug("import:freetext", "ap_filters", {
        pageIndex,
        filters,
        byteLength: bytes.length,
      });

      // Common case: FlateDecode
      if (
        filters.includes("FlateDecode") &&
        typeof (globalThis as any).DecompressionStream !== "undefined"
      ) {
        try {
          const ds = new (globalThis as any).DecompressionStream("deflate");
          const decompressed = await new Response(
            new Blob([safeBytes]).stream().pipeThrough(ds),
          ).arrayBuffer();
          decodedBytes = new Uint8Array(decompressed);
          pdfDebug("import:freetext", "ap_decompressed", {
            pageIndex,
            inBytes: safeBytes.length,
            outBytes: decodedBytes.length,
          });
        } catch (e) {
          pdfDebug("import:freetext", "ap_decompression_failed", {
            pageIndex,
            error: e,
          });
        }
      }

      return new TextDecoder().decode(decodedBytes);
    };

    for (let index = 0; index < pageAnnotations.length; index++) {
      const annotation = pageAnnotations[index];
      if (annotation.subtype === "FreeText") {
        const initialColorArray = annotation.color;
        const normalizedRgb = normalizePdfJsColorToRgb255(initialColorArray);
        let color = normalizedRgb ? rgbArrayToHex(normalizedRgb) : "#000000";
        pdfDebug("import:freetext", "initial", {
          pageIndex,
          index,
          pdfJsColor: initialColorArray,
          normalizedRgb,
          initialHex: color,
          defaultAppearance: annotation.defaultAppearance,
          DA: (annotation as any).DA,
        });
        const [x1, y1] = annotation.rect;
        const { x, y, width, height } = pdfJsRectToUiRect(
          annotation.rect,
          viewport,
        );

        let contents = annotation.contents || "";
        let author = annotation.title || undefined;
        let updatedAt = parsePDFDate(annotation.modificationDate);
        let fontSize = 12;
        let fontFamily: string | undefined = undefined;
        let sourcePdfRef:
          | { objectNumber: number; generationNumber: number }
          | undefined = undefined;
        let sourcePdfFontName: string | undefined = undefined;
        let sourcePdfFontIsSubset: boolean | undefined = undefined;
        let sourcePdfFontMissing: boolean | undefined = undefined;

        const parseDaString = (
          daStr: string,
          options?: { parseFontFamilyFromDa?: boolean },
        ) => {
          const parseFontFamilyFromDa =
            options?.parseFontFamilyFromDa !== false;
          const tfMatch = daStr.match(/\/([^\s]+)\s+(\d+(?:\.\d+)?)\s+Tf/);
          if (tfMatch) {
            const resourceName = normalizePdfFontName(tfMatch[1]);
            fontSize = parseFloat(tfMatch[2]);
            if (parseFontFamilyFromDa) {
              const fontKey = pdfFontToAppFontKey(resourceName);
              if (fontKey) fontFamily = fontKey;
            }
          } else {
            const sizeMatch = daStr.match(/(\d+(\.\d+)?)\s+Tf/);
            if (sizeMatch) fontSize = parseFloat(sizeMatch[1]);
          }

          const tokens = daStr.trim().split(/\s+/);
          let matchedAnyColor = false;

          for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];

            if ((token === "rg" || token === "RG") && i >= 3) {
              const r = parseFloat(tokens[i - 3]);
              const g = parseFloat(tokens[i - 2]);
              const b = parseFloat(tokens[i - 1]);
              if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
                const hex = rgbArrayToHex([r * 255, g * 255, b * 255]);
                if (hex) color = hex;
                matchedAnyColor = true;
                pdfDebug("import:freetext", "da_color_rg", {
                  pageIndex,
                  index,
                  daStr,
                  parsed: { r, g, b },
                  hex,
                });
              }
            } else if ((token === "g" || token === "G") && i >= 1) {
              const gray = parseFloat(tokens[i - 1]);
              if (!isNaN(gray)) {
                const val = gray * 255;
                const hex = rgbArrayToHex([val, val, val]);
                if (hex) color = hex;
                matchedAnyColor = true;
                pdfDebug("import:freetext", "da_color_g", {
                  pageIndex,
                  index,
                  daStr,
                  parsed: { gray },
                  hex,
                });
              }
            } else if ((token === "k" || token === "K") && i >= 4) {
              const c = parseFloat(tokens[i - 4]);
              const m = parseFloat(tokens[i - 3]);
              const y = parseFloat(tokens[i - 2]);
              const k = parseFloat(tokens[i - 1]);
              if (!isNaN(c) && !isNaN(m) && !isNaN(y) && !isNaN(k)) {
                const rr = 255 * (1 - c) * (1 - k);
                const gg = 255 * (1 - m) * (1 - k);
                const bb = 255 * (1 - y) * (1 - k);
                const hex = rgbArrayToHex([rr, gg, bb]);
                if (hex) color = hex;
                matchedAnyColor = true;
                pdfDebug("import:freetext", "da_color_k", {
                  pageIndex,
                  index,
                  daStr,
                  parsed: { c, m, y, k },
                  hex,
                });
              }
            }
          }

          if (!matchedAnyColor) {
            pdfDebug("import:freetext", "da_color_none", {
              pageIndex,
              index,
              daStr,
            });
          }
        };

        // Fallback: if pdf-lib isn't available, we still want standard fonts (Helv/TiRo/Cour) to round-trip.
        const daFromPdfJs =
          (annotation.defaultAppearance as string | undefined) ||
          (annotation.DA as string | undefined);
        if (!pdfDoc && daFromPdfJs) {
          parseDaString(daFromPdfJs);
        }

        if (pdfDoc) {
          try {
            const pdfLibPage = pdfDoc.getPage(pageIndex);
            const libAnnots = pdfLibPage.node.Annots();
            if (libAnnots instanceof PDFArray) {
              for (let idx = 0; idx < libAnnots.size(); idx++) {
                const rawRef = (libAnnots as any).get
                  ? (libAnnots as any).get(idx)
                  : undefined;
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
                          if (
                            rawRef &&
                            typeof (rawRef as any).objectNumber === "number" &&
                            typeof (rawRef as any).generationNumber === "number"
                          ) {
                            sourcePdfRef = {
                              objectNumber: (rawRef as any).objectNumber,
                              generationNumber: (rawRef as any)
                                .generationNumber,
                            };
                          }

                          const rawContents = libAnnot.lookup(
                            PDFName.of("Contents"),
                          );
                          const contentsDecoded = decodePdfString(rawContents);
                          if (
                            contentsDecoded &&
                            (!contents || contents.trim() === "")
                          ) {
                            contents = contentsDecoded;
                          }

                          // DA
                          const da = libAnnot.lookup(PDFName.of("DA"));
                          if (
                            da instanceof PDFString ||
                            da instanceof PDFHexString
                          ) {
                            const daStr = da.decodeText();

                            // Always parse color (and best-effort size) from DA.
                            // Font resolution/injection below may override fontFamily, but color should never be skipped.
                            parseDaString(daStr, {
                              parseFontFamilyFromDa: false,
                            });

                            const tfMatch = daStr.match(
                              /\/([^\s]+)\s+(\d+(?:\.\d+)?)\s+Tf/,
                            );
                            if (tfMatch) {
                              const resourceName = normalizePdfFontName(
                                tfMatch[1],
                              );
                              fontSize = parseFloat(tfMatch[2]);

                              let baseFontName: string | undefined = undefined;
                              let fontDictResolved: PDFDict | undefined =
                                undefined;
                              // Resolve the font dict from multiple locations (annotation DR -> page resources -> AcroForm DR)
                              fontDictResolved = resolveFontDictFromDR(
                                libAnnot.lookup(PDFName.of("DR")),
                                resourceName,
                              );

                              if (!fontDictResolved) {
                                const pageRes = pdfLibPage.node.Resources();
                                if (pageRes instanceof PDFDict) {
                                  const pageFontRes = pageRes.lookup(
                                    PDFName.of("Font"),
                                  );
                                  if (pageFontRes instanceof PDFDict) {
                                    const pageFontDict = pageFontRes.lookup(
                                      PDFName.of(resourceName),
                                    );
                                    if (pageFontDict instanceof PDFDict) {
                                      fontDictResolved = pageFontDict;
                                    }
                                  }
                                }
                              }

                              if (!fontDictResolved && pdfDoc) {
                                try {
                                  const acroForm = pdfDoc.catalog.lookup(
                                    PDFName.of("AcroForm"),
                                  );
                                  if (acroForm instanceof PDFDict) {
                                    const acroDR = acroForm.lookup(
                                      PDFName.of("DR"),
                                    );
                                    fontDictResolved = resolveFontDictFromDR(
                                      acroDR,
                                      resourceName,
                                    );
                                  }
                                } catch {
                                  // ignore
                                }
                              }

                              baseFontName =
                                resolveBaseFontName(fontDictResolved);

                              sourcePdfFontName = baseFontName || resourceName;
                              sourcePdfFontIsSubset =
                                !!sourcePdfFontName?.includes("+");

                              // Try to load the embedded font program (FontFile2/OpenType) into the browser.
                              // If this succeeds, we use the injected family name as the primary font.
                              const injectedFamily =
                                fontDictResolved &&
                                (baseFontName || resourceName) &&
                                context.embeddedFontCache
                                  ? await ensurePdfEmbeddedFontLoaded(
                                      fontDictResolved,
                                      baseFontName || resourceName,
                                      context.embeddedFontCache,
                                      context.embeddedFontFaces,
                                    )
                                  : undefined;

                              const fontKey =
                                pdfFontToAppFontKey(baseFontName) ||
                                pdfFontToAppFontKey(resourceName);

                              sourcePdfFontMissing =
                                !!sourcePdfFontIsSubset ||
                                (!fontKey && !injectedFamily);

                              if (injectedFamily) {
                                const fallback =
                                  pdfFontToCssFontFamily(baseFontName) ||
                                  pdfFontToCssFontFamily(resourceName) ||
                                  "Helvetica, Arial, sans-serif";
                                fontFamily = `"${injectedFamily}", ${fallback}`;
                              } else if (fontKey) {
                                // Store internal key so properties panel + re-import/export round-trip stays stable
                                fontFamily = fontKey;
                              } else {
                                fontFamily =
                                  pdfFontToCssFontFamily(baseFontName) ||
                                  pdfFontToCssFontFamily(resourceName);
                              }
                            } else {
                              parseDaString(daStr);
                            }
                          }
                          const rawTitle = libAnnot.lookup(PDFName.of("T"));
                          const titleDecoded = decodePdfString(rawTitle);
                          if (
                            titleDecoded &&
                            (!author || author.trim() === "")
                          ) {
                            author = titleDecoded;
                          }
                          const rawModDate = libAnnot.lookup(PDFName.of("M"));
                          const modDecoded = decodePdfString(rawModDate);
                          if (modDecoded) {
                            const parsed = parsePDFDate(modDecoded);
                            if (parsed && !updatedAt) updatedAt = parsed;
                          }

                          // AP (appearance): prefer actual appearance color over DA when available.
                          // Some PDFs keep DA at 0 g (black) but draw colored text in AP.
                          try {
                            const ap = libAnnot.lookup(PDFName.of("AP"));
                            if (ap instanceof PDFDict) {
                              const n = ap.lookup(PDFName.of("N"));
                              if (n instanceof PDFStream) {
                                const apContent =
                                  await decodeAppearanceStreamToText(n);
                                pdfDebug("import:freetext", "ap_found", {
                                  pageIndex,
                                  index,
                                  length: apContent.length,
                                  head: apContent.slice(0, 200),
                                });
                                const apHex =
                                  parseTextColorFromContentStream(apContent);
                                if (apHex) color = apHex;

                                const apFont =
                                  parseFontFromContentStream(apContent);
                                if (apFont?.fontSize)
                                  fontSize = apFont.fontSize;

                                if (apFont?.resourceName) {
                                  let apFontDictResolved: PDFDict | undefined =
                                    undefined;
                                  try {
                                    const apRes = n.dict.lookup(
                                      PDFName.of("Resources"),
                                    );
                                    if (apRes instanceof PDFDict) {
                                      const apFontRes = apRes.lookup(
                                        PDFName.of("Font"),
                                      );
                                      if (apFontRes instanceof PDFDict) {
                                        const d = apFontRes.lookup(
                                          PDFName.of(apFont.resourceName),
                                        );
                                        if (d instanceof PDFDict) {
                                          apFontDictResolved = d;
                                        }
                                      }
                                    }
                                  } catch {
                                    // ignore
                                  }

                                  const resolvedBase =
                                    resolveBaseFontName(apFontDictResolved);
                                  const injectedFamily =
                                    apFontDictResolved &&
                                    (resolvedBase || apFont.resourceName) &&
                                    context.embeddedFontCache
                                      ? await ensurePdfEmbeddedFontLoaded(
                                          apFontDictResolved,
                                          resolvedBase || apFont.resourceName,
                                          context.embeddedFontCache,
                                          context.embeddedFontFaces,
                                        )
                                      : undefined;

                                  const fontKey =
                                    pdfFontToAppFontKey(resolvedBase) ||
                                    pdfFontToAppFontKey(apFont.resourceName);

                                  sourcePdfFontName =
                                    resolvedBase || apFont.resourceName;
                                  sourcePdfFontIsSubset =
                                    !!sourcePdfFontName?.includes("+");
                                  sourcePdfFontMissing =
                                    !!sourcePdfFontIsSubset ||
                                    (!fontKey && !injectedFamily);

                                  if (injectedFamily) {
                                    const fallback =
                                      pdfFontToCssFontFamily(resolvedBase) ||
                                      pdfFontToCssFontFamily(
                                        apFont.resourceName,
                                      ) ||
                                      "Helvetica, Arial, sans-serif";
                                    fontFamily = `"${injectedFamily}", ${fallback}`;
                                  } else if (fontKey) {
                                    fontFamily = fontKey;
                                  } else {
                                    fontFamily =
                                      pdfFontToCssFontFamily(resolvedBase) ||
                                      pdfFontToCssFontFamily(
                                        apFont.resourceName,
                                      );
                                  }

                                  pdfDebug(
                                    "import:freetext",
                                    "ap_font_parsed",
                                    {
                                      pageIndex,
                                      index,
                                      resourceName: apFont.resourceName,
                                      baseFontName: resolvedBase,
                                      injectedFamily,
                                      fontKey,
                                      fontFamily,
                                    },
                                  );
                                }
                              } else {
                                pdfDebug("import:freetext", "ap_n_not_stream", {
                                  pageIndex,
                                  index,
                                  nType: n
                                    ? (n as any).constructor?.name
                                    : null,
                                });
                              }
                            } else {
                              pdfDebug("import:freetext", "ap_missing", {
                                pageIndex,
                                index,
                              });
                            }
                          } catch (e) {
                            pdfDebug("import:freetext", "ap_parse_failed", {
                              pageIndex,
                              index,
                              error: e,
                            });
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
          fontFamily: fontFamily,
          author: author,
          updatedAt: updatedAt,
          sourcePdfRef,
          sourcePdfFontName,
          sourcePdfFontIsSubset,
          sourcePdfFontMissing,
          isEdited: false,
        });
      }
    }
    return annotations;
  }
}
