import {
  PDFName,
  PDFArray,
  PDFDict,
  PDFNumber,
  PDFRef,
  PDFStream,
  PDFString,
  PDFHexString,
} from "@cantoo/pdf-lib";
import { Annotation } from "@/types";
import { parsePDFDate } from "@/utils/pdfUtils";
import { IAnnotationParser, ParserContext } from "../types";
import { normalizePdfColorToRgb255, rgbArrayToHex } from "../lib/colors";
import { pdfDebug } from "../lib/debug";
import { extractInkAppearance } from "../lib/ink";
import { pdfJsRectToUiRect } from "../lib/coords";
import { decodePdfString } from "../lib/pdf-objects";
import { ensurePdfEmbeddedFontLoaded } from "../lib/embedded-fonts";
import {
  matchSystemFontFamily,
  matchSystemFontFamilyByAlias,
  normalizePdfFontName,
  pdfFontToAppFontKey,
  pdfFontToCssFontFamily,
} from "../lib/pdf-font-names";

const normalizeRotationDeg = (deg: number) => {
  if (!Number.isFinite(deg)) return 0;
  let d = deg % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
};

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
                  if (c instanceof PDFArray) {
                    const nums: number[] = [];
                    for (let i = 0; i < Math.min(3, c.size()); i++) {
                      const v = c.lookup(i);
                      if (v instanceof PDFNumber) nums.push(v.asNumber());
                    }
                    const normalizedRgb = normalizePdfColorToRgb255(nums);
                    color = normalizedRgb
                      ? rgbArrayToHex(normalizedRgb)
                      : "#000000";
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
    const { pageAnnotations, pageIndex, viewport } = context;
    const annotations: Annotation[] = [];

    pageAnnotations.forEach((annotation, index) => {
      if (annotation.subtype === "Highlight") {
        const normalizedRgb = normalizePdfColorToRgb255(annotation.color);
        const color = normalizedRgb ? rgbArrayToHex(normalizedRgb) : "#FFFF00";
        const { x, y, width, height } = pdfJsRectToUiRect(
          annotation.rect,
          viewport,
        );

        let rects:
          | { x: number; y: number; width: number; height: number }[]
          | undefined = undefined;

        const author = annotation.title || undefined;
        const contents = annotation.contents || undefined;
        const updatedAt = parsePDFDate(annotation.modificationDate);

        let opacity =
          typeof annotation.opacity === "number" ? annotation.opacity : 0.4;

        // Try to get QuadPoints
        const qp = annotation.quadPoints;

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

        opacity = Math.min(1, Math.max(0, opacity));

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
          highlightedText: annotation.highlightedText,
          updatedAt: updatedAt,
        });
      }
    });
    return annotations;
  }
}

export class CommentParser implements IAnnotationParser {
  async parse(context: ParserContext): Promise<Annotation[]> {
    const { pageAnnotations, pageIndex, viewport } = context;
    const annotations: Annotation[] = [];

    const stripRichTextToPlainText = (input: string) => {
      const withoutTags = input.replace(/<[^>]*>/g, " ");
      return withoutTags.replace(/\s+/g, " ").trim();
    };

    for (let index = 0; index < pageAnnotations.length; index++) {
      const annotation = pageAnnotations[index];
      if (annotation.subtype === "Text") {
        const normalizedRgb = normalizePdfColorToRgb255(annotation.color);
        const color = normalizedRgb ? rgbArrayToHex(normalizedRgb) : "#FFFF00";
        const uiRect = pdfJsRectToUiRect(annotation.rect, viewport);
        const x = uiRect.x;
        const y = uiRect.y;
        let width = uiRect.width;
        let height = uiRect.height;

        if (width < 5) width = 30;
        if (height < 5) height = 30;

        let contents = annotation.contents || "";
        if ((!contents || contents.trim() === "") && annotation.richText) {
          contents = stripRichTextToPlainText(annotation.richText);
        }
        const author = annotation.title || undefined;
        const updatedAt = parsePDFDate(annotation.modificationDate);

        let opacity =
          typeof annotation.opacity === "number" ? annotation.opacity : 1;
        opacity = Math.min(1, Math.max(0, opacity));

        if (!contents || contents.trim() === "") {
          console.warn(`Failed to parse comment contents`, {
            pageIndex,
            index,
            sourcePdfRef: annotation.sourcePdfRef,
          });
        }

        annotations.push({
          id: `imported_comment_${pageIndex + 1}_${index}`,
          pageIndex: pageIndex,
          type: "comment",
          rect: { x, y, width, height },
          color: color,
          opacity: opacity,
          text: contents,
          author: author,
          updatedAt: updatedAt,
        });
      }
    }
    return annotations;
  }
}

export class FreeTextParser implements IAnnotationParser {
  async parse(context: ParserContext): Promise<Annotation[]> {
    const { pageAnnotations, pageIndex, viewport, pdfDoc } = context;
    const annotations: Annotation[] = [];

    const resolveFontDictFromDR = (dr: unknown, resourceName: string) => {
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

    const parseFillColorFromContentStream = (content: string) => {
      const tokens = content.trim().split(/\s+/);

      const to01 = (n: number) => {
        if (!Number.isFinite(n)) return 0;
        if (n <= 1.01) return Math.max(0, Math.min(1, n));
        return Math.max(0, Math.min(1, n / 255));
      };

      const rgbHexFrom3 = (r: number, g: number, b: number) =>
        rgbArrayToHex([to01(r) * 255, to01(g) * 255, to01(b) * 255]);

      const cmykHexFrom4 = (c: number, m: number, y: number, k: number) => {
        const c01 = to01(c);
        const m01 = to01(m);
        const y01 = to01(y);
        const k01 = to01(k);
        const rr = 255 * (1 - c01) * (1 - k01);
        const gg = 255 * (1 - m01) * (1 - k01);
        const bb = 255 * (1 - y01) * (1 - k01);
        return rgbArrayToHex([rr, gg, bb]);
      };

      let inText = false;
      let currentFillHex: string | undefined = undefined;
      let lastRect: { x: number; y: number; w: number; h: number } | undefined =
        undefined;

      let best:
        | {
            hex: string;
            area: number;
          }
        | undefined = undefined;

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        if (token === "BT") {
          inText = true;
          continue;
        }
        if (token === "ET") {
          inText = false;
          continue;
        }

        if (token === "rg" && i >= 3) {
          const r = parseFloat(tokens[i - 3]);
          const g = parseFloat(tokens[i - 2]);
          const b = parseFloat(tokens[i - 1]);
          const hex = rgbHexFrom3(r, g, b);
          if (hex) currentFillHex = hex;
          continue;
        }

        if (token === "g" && i >= 1) {
          const gray = parseFloat(tokens[i - 1]);
          const hex = rgbHexFrom3(gray, gray, gray);
          if (hex) currentFillHex = hex;
          continue;
        }

        if (token === "k" && i >= 4) {
          const c = parseFloat(tokens[i - 4]);
          const m = parseFloat(tokens[i - 3]);
          const y = parseFloat(tokens[i - 2]);
          const k = parseFloat(tokens[i - 1]);
          const hex = cmykHexFrom4(c, m, y, k);
          if (hex) currentFillHex = hex;
          continue;
        }

        if (token === "re" && i >= 4) {
          const x = parseFloat(tokens[i - 4]);
          const y = parseFloat(tokens[i - 3]);
          const w = parseFloat(tokens[i - 2]);
          const h = parseFloat(tokens[i - 1]);
          if (!isNaN(x) && !isNaN(y) && !isNaN(w) && !isNaN(h)) {
            lastRect = { x, y, w, h };
          }
          continue;
        }

        if (token === "f" || token === "f*" || token === "F") {
          if (!inText && lastRect && currentFillHex) {
            const area = Math.abs(lastRect.w * lastRect.h);
            if (Number.isFinite(area) && area > 0) {
              if (!best || area > best.area) {
                best = { hex: currentFillHex, area };
              }
            }
          }
          lastRect = undefined;
        }
      }

      return best?.hex;
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
      const tryParse = (input: string, segmentUsed: string) => {
        const tokens = input.trim().split(/\s+/);
        let matchedAnyColor = false;
        let outHex: string | undefined = undefined;
        let outOp: "rg" | "g" | "k" | "sc" | "scn" | undefined = undefined;
        let currentCs: string | undefined = undefined;

        const normalize01to255 = (vals: number[]) => {
          const max = Math.max(...vals.map((v) => Math.abs(v)));
          if (max <= 1.01) return vals.map((v) => v * 255);
          return vals;
        };

        const rgbHexFrom3 = (vals: number[]) => {
          const rgb = normalize01to255(vals);
          return rgbArrayToHex(rgb);
        };

        const grayHexFrom1 = (val: number) => {
          const g255 = normalize01to255([val])[0];
          return rgbArrayToHex([g255, g255, g255]);
        };

        const scnComponents = (opIndex: number) => {
          const nums: number[] = [];
          for (let j = opIndex - 1; j >= 0 && nums.length < 4; j--) {
            const t = tokens[j];
            if (!t) continue;
            if (t.startsWith("/")) continue;
            const v = parseFloat(t);
            if (isNaN(v)) break;
            nums.unshift(v);
          }
          return nums;
        };

        for (let i = 0; i < tokens.length; i++) {
          const token = tokens[i];

          // Prefer nonstroking (lowercase) operators for text fill.
          if ((token === "rg" || token === "RG") && i >= 3) {
            const r = parseFloat(tokens[i - 3]);
            const g = parseFloat(tokens[i - 2]);
            const b = parseFloat(tokens[i - 1]);
            if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
              const hex = rgbHexFrom3([r, g, b]);
              if (hex) {
                outHex = hex;
                outOp = "rg";
                matchedAnyColor = true;
              }
            }
          } else if ((token === "g" || token === "G") && i >= 1) {
            const gray = parseFloat(tokens[i - 1]);
            if (!isNaN(gray)) {
              const hex = grayHexFrom1(gray);
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
              const cmyk = normalize01to255([c, m, y, k]);
              const c01 = cmyk[0] / 255;
              const m01 = cmyk[1] / 255;
              const y01 = cmyk[2] / 255;
              const k01 = cmyk[3] / 255;
              const rr = 255 * (1 - c01) * (1 - k01);
              const gg = 255 * (1 - m01) * (1 - k01);
              const bb = 255 * (1 - y01) * (1 - k01);
              const hex = rgbArrayToHex([rr, gg, bb]);
              if (hex) {
                outHex = hex;
                outOp = "k";
                matchedAnyColor = true;
              }
            }
          } else if ((token === "cs" || token === "CS") && i >= 1) {
            const name = tokens[i - 1];
            currentCs = name ? name.replace(/^\//, "") : undefined;
          } else if ((token === "sc" || token === "SC") && i >= 1) {
            const comps = scnComponents(i);
            if (comps.length === 3) {
              const hex = rgbHexFrom3(comps);
              if (hex) {
                outHex = hex;
                outOp = "sc";
                matchedAnyColor = true;
              }
            } else if (comps.length === 1) {
              const hex = grayHexFrom1(comps[0]);
              if (hex) {
                outHex = hex;
                outOp = "sc";
                matchedAnyColor = true;
              }
            } else if (comps.length === 4) {
              const cmyk = normalize01to255(comps);
              const c01 = cmyk[0] / 255;
              const m01 = cmyk[1] / 255;
              const y01 = cmyk[2] / 255;
              const k01 = cmyk[3] / 255;
              const rr = 255 * (1 - c01) * (1 - k01);
              const gg = 255 * (1 - m01) * (1 - k01);
              const bb = 255 * (1 - y01) * (1 - k01);
              const hex = rgbArrayToHex([rr, gg, bb]);
              if (hex) {
                outHex = hex;
                outOp = "sc";
                matchedAnyColor = true;
              }
            }

            if (matchedAnyColor) {
              pdfDebug("import:freetext", "ap_color_sc", () => ({
                pageIndex,
                currentCs,
                token,
                hex: outHex,
              }));
            }
          } else if ((token === "scn" || token === "SCN") && i >= 1) {
            const comps = scnComponents(i);
            if (comps.length === 4) {
              const cmyk = normalize01to255(comps);
              const c01 = cmyk[0] / 255;
              const m01 = cmyk[1] / 255;
              const y01 = cmyk[2] / 255;
              const k01 = cmyk[3] / 255;
              const rr = 255 * (1 - c01) * (1 - k01);
              const gg = 255 * (1 - m01) * (1 - k01);
              const bb = 255 * (1 - y01) * (1 - k01);
              const hex = rgbArrayToHex([rr, gg, bb]);
              if (hex) {
                outHex = hex;
                outOp = "scn";
                matchedAnyColor = true;
              }
            } else if (comps.length === 3) {
              const hex = rgbHexFrom3(comps);
              if (hex) {
                outHex = hex;
                outOp = "scn";
                matchedAnyColor = true;
              }
            } else if (comps.length === 1) {
              const hex = grayHexFrom1(comps[0]);
              if (hex) {
                outHex = hex;
                outOp = "scn";
                matchedAnyColor = true;
              }
            }

            if (matchedAnyColor) {
              pdfDebug("import:freetext", "ap_color_scn", () => ({
                pageIndex,
                currentCs,
                token,
                hex: outHex,
              }));
            }
          }
        }

        pdfDebug("import:freetext", "ap_color_parsed", () => ({
          pageIndex,
          segmentUsed,
          matchedAnyColor,
          op: outOp,
          hex: outHex,
        }));

        return { outHex, matchedAnyColor };
      };

      const fromSegment = tryParse(
        segment,
        segment !== content ? "BT..ET" : "full",
      );
      if (fromSegment.matchedAnyColor) return fromSegment.outHex;

      if (segment !== content) {
        const fromFull = tryParse(content, "full_fallback");
        if (fromFull.matchedAnyColor) return fromFull.outHex;
      }

      return undefined;
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

      const hypot = (a: number, b: number) => Math.sqrt(a * a + b * b);
      const parseScaleFromMatrix = (
        a: number,
        b: number,
        c: number,
        d: number,
      ) => {
        const sx = hypot(a, b);
        const sy = hypot(c, d);
        const s = Math.max(sx, sy);
        return Number.isFinite(s) && s > 0 ? s : 1;
      };

      const findLastTmScale = (input: string) => {
        let scale = 1;
        try {
          const tms = Array.from(
            input.matchAll(
              /([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+Tm/g,
            ),
          );
          const last = tms.length > 0 ? tms[tms.length - 1] : undefined;
          if (last) {
            const a = parseFloat(last[1]);
            const b = parseFloat(last[2]);
            const c = parseFloat(last[3]);
            const d = parseFloat(last[4]);
            if (!isNaN(a) && !isNaN(b) && !isNaN(c) && !isNaN(d)) {
              scale = parseScaleFromMatrix(a, b, c, d);
            }
          }
        } catch {
          // ignore
        }
        return scale;
      };

      const findLastCmScale = (input: string) => {
        let scale = 1;
        try {
          const cms = Array.from(
            input.matchAll(
              /([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+cm/g,
            ),
          );
          const last = cms.length > 0 ? cms[cms.length - 1] : undefined;
          if (last) {
            const a = parseFloat(last[1]);
            const b = parseFloat(last[2]);
            const c = parseFloat(last[3]);
            const d = parseFloat(last[4]);
            if (!isNaN(a) && !isNaN(b) && !isNaN(c) && !isNaN(d)) {
              scale = parseScaleFromMatrix(a, b, c, d);
            }
          }
        } catch {
          // ignore
        }
        return scale;
      };

      // Mixed-font FreeText (our exporter) typically uses a standard base font (Helv/TiRo/Cour)
      // and switches to a CJK font for non-ASCII runs (e.g. Cust). For round-tripping, we want
      // the base font to drive `annotation.fontFamily` so ASCII stays correct.
      const pickPreferred = () => {
        for (const m of matches) {
          const n = normalizePdfFontName(m?.[1] || "");
          const up = n.toUpperCase();
          if (up === "HELV" || up === "TIRO" || up === "COUR") return m;
        }
        return matches[0];
      };

      const preferred = pickPreferred();
      const name = preferred?.[1];
      const size = preferred?.[2];
      if (!name) return undefined;
      const parsedSize = size ? parseFloat(size) : NaN;

      let effectiveSize = !isNaN(parsedSize) ? parsedSize : undefined;
      // Some PDFs encode FreeText as `1 Tf` and rely on `Tm` / outer `cm` scaling.
      if (
        effectiveSize !== undefined &&
        effectiveSize > 0 &&
        effectiveSize <= 3
      ) {
        const tmScale = findLastTmScale(segment);
        const cmScale = findLastCmScale(content);
        const scaled = effectiveSize * tmScale * cmScale;
        if (Number.isFinite(scaled) && scaled > 0 && scaled < 500) {
          effectiveSize = scaled;
          pdfDebug("import:freetext", "ap_font_scaled", () => ({
            pageIndex,
            resourceName: normalizePdfFontName(name),
            tf: parsedSize,
            tmScale,
            cmScale,
            scaled,
          }));
        }
      }

      return {
        resourceName: normalizePdfFontName(name),
        fontSize: effectiveSize,
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

      pdfDebug("import:freetext", "ap_filters", () => ({
        pageIndex,
        filters,
        byteLength: bytes.length,
      }));

      if (
        filters.includes("ASCII85Decode") ||
        filters.includes("ASCIIHexDecode")
      ) {
        pdfDebug("import:freetext", "ap_filters_unsupported", () => ({
          pageIndex,
          filters,
        }));
      }

      // Common case: FlateDecode
      const g = globalThis as unknown as { DecompressionStream?: unknown };
      if (
        filters.includes("FlateDecode") &&
        typeof g.DecompressionStream !== "undefined"
      ) {
        try {
          const DS = g.DecompressionStream as unknown as new (
            format: string,
          ) => DecompressionStream;
          const ds = new DS("deflate");
          const decompressed = await new Response(
            new Blob([safeBytes]).stream().pipeThrough(ds),
          ).arrayBuffer();
          decodedBytes = new Uint8Array(decompressed);
          pdfDebug("import:freetext", "ap_decompressed", () => ({
            pageIndex,
            inBytes: safeBytes.length,
            outBytes: decodedBytes.length,
          }));
        } catch (e) {
          pdfDebug("import:freetext", "ap_decompression_failed", () => ({
            pageIndex,
            error: e,
          }));
        }
      }

      const text = new TextDecoder().decode(decodedBytes);
      pdfDebug("import:freetext", "ap_decoded_sample", () => ({
        pageIndex,
        length: text.length,
        head: text.slice(0, 300),
        hasBT: /\bBT\b/.test(text),
        hasET: /\bET\b/.test(text),
        hasRg: /\brg\b/.test(text) || /\bRG\b/.test(text),
        hasG: /\bg\b/.test(text) || /\bG\b/.test(text),
        hasK: /\bk\b/.test(text) || /\bK\b/.test(text),
        hasScn: /\bscn\b/.test(text) || /\bSCN\b/.test(text),
        hasGs: /\bgs\b/.test(text),
        hasCs: /\bcs\b/.test(text) || /\bCS\b/.test(text),
      }));
      return text;
    };

    for (let index = 0; index < pageAnnotations.length; index++) {
      const annotation = pageAnnotations[index];
      if (annotation.subtype === "FreeText") {
        const rotationDeg = (() => {
          const r = (annotation as { rotation?: unknown }).rotation;
          if (typeof r !== "number" || !Number.isFinite(r)) return undefined;
          return normalizeRotationDeg(-r);
        })();
        const initialColorArray = annotation.color;
        const normalizedRgb = normalizePdfColorToRgb255(initialColorArray);
        let color = normalizedRgb ? rgbArrayToHex(normalizedRgb) : "#000000";

        let backgroundColor: string | undefined = undefined;
        if (annotation.backgroundColor) {
          const bgRgb = normalizePdfColorToRgb255(annotation.backgroundColor);
          const bgHex = bgRgb ? rgbArrayToHex(bgRgb) : undefined;
          if (bgHex) backgroundColor = bgHex;
        }

        if (!backgroundColor && annotation.fillColor) {
          const fillRgb = normalizePdfColorToRgb255(annotation.fillColor);
          const fillHex = fillRgb ? rgbArrayToHex(fillRgb) : undefined;
          if (fillHex) backgroundColor = fillHex;
        }
        const [rectX1, rectY1, rectX2, rectY2] = annotation.rect;
        const outerPdfWidth = Math.abs(rectX2 - rectX1);
        const outerPdfHeight = Math.abs(rectY2 - rectY1);

        const {
          x: outerX,
          y: outerY,
          width: outerW,
          height: outerH,
        } = pdfJsRectToUiRect(annotation.rect, viewport);

        let apInnerPdfSize: { width: number; height: number } | undefined =
          undefined;

        const computeInnerUiSize = (): { width: number; height: number } => {
          if (
            typeof rotationDeg !== "number" ||
            !Number.isFinite(rotationDeg)
          ) {
            return { width: outerW, height: outerH };
          }
          if (rotationDeg === 0) return { width: outerW, height: outerH };

          if (apInnerPdfSize && outerPdfWidth > 0 && outerPdfHeight > 0) {
            const sfX = outerW / outerPdfWidth;
            const sfY = outerH / outerPdfHeight;
            const sf =
              Number.isFinite(sfX) && Number.isFinite(sfY) && sfX > 0 && sfY > 0
                ? (sfX + sfY) / 2
                : Number.isFinite(sfX) && sfX > 0
                  ? sfX
                  : Number.isFinite(sfY) && sfY > 0
                    ? sfY
                    : 1;

            const w = apInnerPdfSize.width * sf;
            const h = apInnerPdfSize.height * sf;
            if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
              return { width: w, height: h };
            }
          }

          const theta = (rotationDeg * Math.PI) / 180;
          const absCos = Math.abs(Math.cos(theta));
          const absSin = Math.abs(Math.sin(theta));
          const det = absCos * absCos - absSin * absSin;
          if (!Number.isFinite(det) || Math.abs(det) < 1e-6) {
            return { width: outerW, height: outerH };
          }

          const w = (outerW * absCos - outerH * absSin) / det;
          const h = (outerH * absCos - outerW * absSin) / det;
          if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
            return { width: w, height: h };
          }

          return { width: outerW, height: outerH };
        };

        const computeInnerUiRect = () => {
          const { width, height } = computeInnerUiSize();
          const cx = outerX + outerW / 2;
          const cy = outerY + outerH / 2;
          return {
            x: cx - width / 2,
            y: cy - height / 2,
            width,
            height,
          };
        };
        let contents = annotation.contents || "";
        let author = annotation.title || undefined;
        let updatedAt = parsePDFDate(annotation.modificationDate);
        let opacity =
          typeof annotation.opacity === "number" ? annotation.opacity : 1;
        opacity = Math.min(1, Math.max(0, opacity));
        let fontSize = 12;
        let lineHeight: number | undefined = undefined;
        let fontFamily: string | undefined = undefined;
        const sourcePdfRef:
          | { objectNumber: number; generationNumber: number }
          | undefined = annotation.sourcePdfRef;
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

          const tlMatch = daStr.match(/(\d+(?:\.\d+)?)\s+TL\b/);
          if (tlMatch && Number.isFinite(fontSize) && fontSize > 0) {
            const leading = parseFloat(tlMatch[1]);
            const m = leading / fontSize;
            if (Number.isFinite(m) && m > 0) {
              lineHeight = Math.abs(m - 1) < 1e-3 ? undefined : m;
            }
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
                pdfDebug("import:freetext", "da_color_rg", () => ({
                  pageIndex,
                  index,
                  daStr,
                  parsed: { r, g, b },
                  hex,
                }));
              }
            } else if ((token === "g" || token === "G") && i >= 1) {
              const gray = parseFloat(tokens[i - 1]);
              if (!isNaN(gray)) {
                const val = gray * 255;
                const hex = rgbArrayToHex([val, val, val]);
                if (hex) color = hex;
                matchedAnyColor = true;
                pdfDebug("import:freetext", "da_color_g", () => ({
                  pageIndex,
                  index,
                  daStr,
                  parsed: { gray },
                  hex,
                }));
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
                pdfDebug("import:freetext", "da_color_k", () => ({
                  pageIndex,
                  index,
                  daStr,
                  parsed: { c, m, y, k },
                  hex,
                }));
              }
            }
          }

          if (!matchedAnyColor) {
            pdfDebug("import:freetext", "da_color_none", () => ({
              pageIndex,
              index,
              daStr,
            }));
          }
        };

        // Fallback: if pdf-lib isn't available, we still want standard fonts (Helv/TiRo/Cour) to round-trip.
        const daFromPdfJs = annotation.defaultAppearance || annotation.DA;
        if (!pdfDoc && daFromPdfJs) {
          parseDaString(daFromPdfJs);
        }

        if (pdfDoc) {
          const ref = annotation.sourcePdfRef;
          if (!ref) {
            console.warn(
              `Failed to parse FreeText advanced properties (missing sourcePdfRef)`,
              {
                pageIndex,
                index,
              },
            );
          } else {
            try {
              const pdfLibPage = pdfDoc.getPage(pageIndex);
              const lookedUp = pdfDoc.context.lookup(
                PDFRef.of(ref.objectNumber, ref.generationNumber),
              );
              if (!(lookedUp instanceof PDFDict)) {
                console.warn(
                  `Failed to parse FreeText advanced properties (lookup not dict)`,
                  {
                    pageIndex,
                    index,
                    sourcePdfRef: ref,
                  },
                );
              } else {
                const libAnnot = lookedUp;

                const rawContents = libAnnot.lookup(PDFName.of("Contents"));
                const contentsDecoded = decodePdfString(rawContents);
                if (contentsDecoded && (!contents || contents.trim() === "")) {
                  contents = contentsDecoded;
                }

                // DA
                const da = libAnnot.lookup(PDFName.of("DA"));
                if (da instanceof PDFString || da instanceof PDFHexString) {
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
                    const resourceName = normalizePdfFontName(tfMatch[1]);
                    fontSize = parseFloat(tfMatch[2]);

                    let baseFontName: string | undefined = undefined;
                    let fontDictResolved: PDFDict | undefined = undefined;
                    // Resolve the font dict from multiple locations (annotation DR -> page resources -> AcroForm DR)
                    fontDictResolved = resolveFontDictFromDR(
                      libAnnot.lookup(PDFName.of("DR")),
                      resourceName,
                    );

                    if (!fontDictResolved) {
                      const pageRes = pdfLibPage.node.Resources();
                      if (pageRes instanceof PDFDict) {
                        const pageFontRes = pageRes.lookup(PDFName.of("Font"));
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

                    if (!fontDictResolved) {
                      try {
                        const acroForm = pdfDoc.catalog.lookup(
                          PDFName.of("AcroForm"),
                        );
                        if (acroForm instanceof PDFDict) {
                          const acroDR = acroForm.lookup(PDFName.of("DR"));
                          fontDictResolved = resolveFontDictFromDR(
                            acroDR,
                            resourceName,
                          );
                        }
                      } catch {
                        // ignore
                      }
                    }

                    baseFontName = resolveBaseFontName(fontDictResolved);

                    sourcePdfFontName = baseFontName || resourceName;
                    sourcePdfFontIsSubset = !!sourcePdfFontName?.includes("+");

                    pdfDebug("import:freetext", "font_inject_gate", () => ({
                      stage: "DA",
                      pageIndex,
                      index,
                      resourceName,
                      baseFontName,
                      sourcePdfFontName,
                      hasPdfDoc: !!pdfDoc,
                      hasFontDict: !!fontDictResolved,
                      hasEmbeddedFontCache: !!context.embeddedFontCache,
                      willAttempt:
                        !!fontDictResolved &&
                        !!(baseFontName || resourceName) &&
                        !!context.embeddedFontCache,
                    }));

                    const fontKey =
                      pdfFontToAppFontKey(baseFontName) ||
                      pdfFontToAppFontKey(resourceName);

                    const sysNeedle = baseFontName || resourceName;
                    const systemFamily =
                      matchSystemFontFamily(
                        sysNeedle,
                        context.systemFontFamilies,
                      ) ||
                      matchSystemFontFamilyByAlias(
                        sysNeedle,
                        context.systemFontAliasToFamilyCompact,
                      );

                    // Chromium can reject embedded PDF fonts (OTS parsing error). Only attempt
                    // injection if we cannot resolve a standard key or an installed system family.
                    const injectedFamily =
                      !fontKey &&
                      !systemFamily &&
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

                    pdfDebug("import:freetext", "font_inject_result", () => ({
                      stage: "DA",
                      pageIndex,
                      index,
                      resourceName,
                      baseFontName,
                      sourcePdfFontName,
                      injectedFamily,
                    }));

                    sourcePdfFontMissing =
                      !fontKey && !injectedFamily && !systemFamily;

                    if (fontKey) {
                      fontFamily = fontKey;
                    } else if (systemFamily) {
                      fontFamily = systemFamily;
                    } else if (injectedFamily) {
                      const fallback =
                        pdfFontToCssFontFamily(baseFontName) ||
                        pdfFontToCssFontFamily(resourceName);
                      fontFamily = fallback
                        ? `"${injectedFamily}", ${fallback}`
                        : `"${injectedFamily}"`;
                    } else {
                      const fallback =
                        pdfFontToCssFontFamily(baseFontName) ||
                        pdfFontToCssFontFamily(resourceName);
                      fontFamily = fallback;
                    }
                  } else {
                    parseDaString(daStr);
                  }
                } else if (daFromPdfJs) {
                  parseDaString(daFromPdfJs);
                }

                const rawTitle = libAnnot.lookup(PDFName.of("T"));
                const titleDecoded = decodePdfString(rawTitle);
                if (titleDecoded && (!author || author.trim() === "")) {
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
                      const apContent = await decodeAppearanceStreamToText(n);
                      pdfDebug("import:freetext", "ap_found", () => ({
                        pageIndex,
                        index,
                        length: apContent.length,
                        head: apContent.slice(0, 200),
                      }));

                      const count = (re: RegExp) => {
                        try {
                          return Array.from(apContent.matchAll(re)).length;
                        } catch {
                          return 0;
                        }
                      };
                      pdfDebug("import:freetext", "ap_ops", () => ({
                        pageIndex,
                        index,
                        rg: count(/\brg\b/g),
                        RG: count(/\bRG\b/g),
                        g: count(/\bg\b/g),
                        G: count(/\bG\b/g),
                        k: count(/\bk\b/g),
                        K: count(/\bK\b/g),
                        sc: count(/\bsc\b/g),
                        SC: count(/\bSC\b/g),
                        scn: count(/\bscn\b/g),
                        SCN: count(/\bSCN\b/g),
                        cs: count(/\bcs\b/g),
                        CS: count(/\bCS\b/g),
                        gs: count(/\bgs\b/g),
                      }));
                      const apHex = parseTextColorFromContentStream(apContent);
                      if (apHex) color = apHex;

                      const apFillHex =
                        parseFillColorFromContentStream(apContent);
                      if (apFillHex && !backgroundColor)
                        backgroundColor = apFillHex;

                      const apFont = parseFontFromContentStream(apContent);
                      if (apFont?.fontSize) fontSize = apFont.fontSize;

                      if (
                        typeof rotationDeg === "number" &&
                        Number.isFinite(rotationDeg) &&
                        rotationDeg !== 0
                      ) {
                        try {
                          const cms = Array.from(
                            apContent.matchAll(
                              /1\s+0\s+0\s+1\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+cm/g,
                            ),
                          );
                          const last =
                            cms.length > 0 ? cms[cms.length - 1] : undefined;
                          if (last) {
                            const tx = parseFloat(last[1]);
                            const ty = parseFloat(last[2]);
                            if (
                              Number.isFinite(tx) &&
                              Number.isFinite(ty) &&
                              tx < 0 &&
                              ty < 0
                            ) {
                              const w = -2 * tx;
                              const h = -2 * ty;
                              if (
                                Number.isFinite(w) &&
                                Number.isFinite(h) &&
                                w > 0 &&
                                h > 0
                              ) {
                                apInnerPdfSize = { width: w, height: h };
                              }
                            }
                          }
                        } catch {
                          // ignore
                        }
                      }

                      if (apFont?.resourceName) {
                        let apFontDictResolved: PDFDict | undefined = undefined;
                        try {
                          const apRes = n.dict.lookup(PDFName.of("Resources"));
                          if (apRes instanceof PDFDict) {
                            const apFontRes = apRes.lookup(PDFName.of("Font"));
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

                        const fontKey =
                          pdfFontToAppFontKey(resolvedBase) ||
                          pdfFontToAppFontKey(apFont.resourceName);

                        const systemFamily =
                          matchSystemFontFamily(
                            resolvedBase || apFont.resourceName,
                            context.systemFontFamilies,
                          ) ||
                          matchSystemFontFamilyByAlias(
                            resolvedBase || apFont.resourceName,
                            context.systemFontAliasToFamilyCompact,
                          );

                        pdfDebug("import:freetext", "font_inject_gate", () => ({
                          stage: "AP",
                          pageIndex,
                          index,
                          resourceName: apFont.resourceName,
                          baseFontName: resolvedBase,
                          hasPdfDoc: !!pdfDoc,
                          hasFontDict: !!apFontDictResolved,
                          hasEmbeddedFontCache: !!context.embeddedFontCache,
                          willAttempt:
                            !!apFontDictResolved &&
                            !!(resolvedBase || apFont.resourceName) &&
                            !!context.embeddedFontCache &&
                            !fontKey &&
                            !systemFamily,
                        }));

                        const injectedFamily =
                          !fontKey &&
                          !systemFamily &&
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

                        pdfDebug(
                          "import:freetext",
                          "font_inject_result",
                          () => ({
                            stage: "AP",
                            pageIndex,
                            index,
                            resourceName: apFont.resourceName,
                            baseFontName: resolvedBase,
                            injectedFamily,
                          }),
                        );

                        sourcePdfFontName = resolvedBase || apFont.resourceName;
                        sourcePdfFontIsSubset =
                          !!sourcePdfFontName?.includes("+");
                        sourcePdfFontMissing =
                          !fontKey && !injectedFamily && !systemFamily;

                        if (fontKey) {
                          fontFamily = fontKey;
                        } else if (systemFamily) {
                          fontFamily = systemFamily;
                        } else if (injectedFamily) {
                          const fallback =
                            pdfFontToCssFontFamily(resolvedBase) ||
                            pdfFontToCssFontFamily(apFont.resourceName);
                          fontFamily = fallback
                            ? `"${injectedFamily}", ${fallback}`
                            : `"${injectedFamily}"`;
                        } else {
                          const fallback =
                            pdfFontToCssFontFamily(resolvedBase) ||
                            pdfFontToCssFontFamily(apFont.resourceName);
                          fontFamily = fallback;
                        }

                        pdfDebug("import:freetext", "ap_font_parsed", () => ({
                          pageIndex,
                          index,
                          resourceName: apFont.resourceName,
                          baseFontName: resolvedBase,
                          injectedFamily,
                          fontKey,
                          fontFamily,
                        }));
                      }
                    } else {
                      pdfDebug("import:freetext", "ap_n_not_stream", () => ({
                        pageIndex,
                        index,
                        nType:
                          n && typeof n === "object"
                            ? ((
                                n as {
                                  constructor?: { name?: string };
                                }
                              ).constructor?.name ?? null)
                            : null,
                      }));
                    }
                  } else {
                    pdfDebug("import:freetext", "ap_missing", () => ({
                      pageIndex,
                      index,
                    }));
                  }
                } catch (e) {
                  pdfDebug("import:freetext", "ap_parse_failed", () => ({
                    pageIndex,
                    index,
                    error: e,
                  }));
                }
              }
            } catch (e) {
              console.warn(`Failed to parse FreeText advanced properties`, {
                pageIndex,
                index,
                sourcePdfRef: ref,
                error: e,
              });
              if (daFromPdfJs) {
                try {
                  parseDaString(daFromPdfJs);
                } catch {
                  // ignore
                }
              }
            }
          }
        }

        const innerRect = computeInnerUiRect();
        annotations.push({
          id: `imported_freetext_${pageIndex + 1}_${index}`,
          pageIndex: pageIndex,
          type: "freetext",
          rect: innerRect,
          color: color,
          backgroundColor,
          opacity: opacity,
          rotationDeg,
          text: contents,
          size: fontSize,
          lineHeight,
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

export class LinkParser implements IAnnotationParser {
  async parse(context: ParserContext): Promise<Annotation[]> {
    const { pageAnnotations, pageIndex, viewport } = context;
    const annotations: Annotation[] = [];
    let seenLinks = 0;
    let addedLinks = 0;

    pageAnnotations.forEach((annotation, index) => {
      if (annotation.subtype !== "Link") return;
      seenLinks += 1;

      const linkUrl =
        typeof annotation.url === "string" ? annotation.url : undefined;
      const linkDestPageIndex =
        typeof annotation.destPageIndex === "number"
          ? annotation.destPageIndex
          : undefined;

      if (!linkUrl && typeof linkDestPageIndex !== "number") {
        pdfDebug("import:annotations", "link_skipped", () => ({
          pageIndex,
          annotIndex: index,
          url: linkUrl,
          destPageIndex: annotation.destPageIndex,
          sourcePdfRef: annotation.sourcePdfRef,
        }));
        return;
      }

      const { x, y, width, height } = pdfJsRectToUiRect(
        annotation.rect,
        viewport,
      );

      annotations.push({
        id: `imported_link_${pageIndex + 1}_${index}`,
        pageIndex,
        type: "link",
        rect: { x, y, width, height },
        linkUrl,
        linkDestPageIndex,
      });
      addedLinks += 1;
    });

    if (seenLinks > 0) {
      pdfDebug("import:annotations", "link_parsed_page", () => ({
        pageIndex,
        seenLinks,
        addedLinks,
      }));
    }

    return annotations;
  }
}
