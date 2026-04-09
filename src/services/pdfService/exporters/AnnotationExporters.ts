import {
  PDFDocument,
  PDFPage,
  rgb,
  degrees,
  PDFName,
  PDFString,
  PDFHexString,
  StandardFonts,
  PDFDict,
  PDFArray,
  PDFContentStream,
  PDFStream,
  type PDFFont,
  type PDFOperator,
  PDFRef,
  drawRectangle,
  drawEllipse,
  drawSvgPath,
  drawImage,
  LineJoinStyle,
  setLineJoin,
} from "@cantoo/pdf-lib";
import { Annotation } from "@/types";
import { PDF_CUSTOM_KEYS } from "@/constants";
import { IAnnotationExporter, ViewportLike } from "../types";
import { applyPdfAnnotationCommentMetadata } from "../lib/annotationCommentMeta";
import { setAppHighlightedText } from "../lib/annotationMetadata";
import { hexToPdfColor } from "../lib/colors";
import { generateInkAppearanceOps } from "../lib/ink";
import { containsNonAscii, isSerifFamily } from "../lib/text";
import { uiPointToPdfPoint, uiRectToPdfBounds } from "../lib/coords";
import {
  buildPdfRotationMatrix,
  getTransformedPdfRect,
  type PdfTransformMatrix,
} from "../lib/appearanceRotation";
import {
  arrowStyleNeedsPdfCustomMetadata,
  arrowStyleToPdfLineEndingName,
  getDefaultArrowSize,
  getCloudGeometry,
  getCloudPathData,
  getPolygonCloudGeometry,
  getShapeAbsolutePoints,
  getShapeArrowStyles,
  getShapeMarkerPdfLineCap,
  getShapeMarkerPdfLineJoin,
  getShapePdfLineCap,
  getShapePdfLineJoin,
  getShapeStrokeDashArrayValues,
  getLineEndingMarker,
  getShapePointsPathData,
  isClosedShapeType,
  normalizeShapeDashDensity,
  normalizeShapeBorderStyle,
  getTrimmedOpenLinePointsForArrows,
} from "@/lib/shapeGeometry";
import {
  fitStampImageToRect,
  getStampPdfName,
  getPresetStampSvgDataUrl,
  resolveStampLabel,
} from "@/lib/stamps";
import { decodeStampImageDataUrl } from "@/lib/stampImage";

const loadStampImageSource = async (
  dataUrl: string,
): Promise<CanvasImageSource> => {
  const { bytes, mimeType } = decodeStampImageDataUrl(dataUrl);
  const blob = new Blob([bytes], { type: mimeType });

  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Fallback to HTMLImageElement below. Some environments expose
      // createImageBitmap but cannot decode SVG or other browser-supported
      // formats from blobs reliably.
    }
  }

  if (typeof Image === "undefined" || typeof URL === "undefined") {
    throw new Error("Image rasterization is unavailable in this environment.");
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Failed to decode stamp image."));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const rasterizeStampImageToPngBytes = async (options: {
  dataUrl: string;
  width?: number;
  height?: number;
}) => {
  const targetWidth = Math.max(
    1,
    Math.round(
      (options.width && Number.isFinite(options.width) ? options.width : 256) *
        2,
    ),
  );
  const targetHeight = Math.max(
    1,
    Math.round(
      (options.height && Number.isFinite(options.height)
        ? options.height
        : 256) * 2,
    ),
  );
  const imageSource = await loadStampImageSource(options.dataUrl);
  try {
    const canvas =
      typeof OffscreenCanvas === "function"
        ? new OffscreenCanvas(targetWidth, targetHeight)
        : (() => {
            if (typeof document === "undefined") {
              throw new Error(
                "Canvas rasterization is unavailable in this environment.",
              );
            }
            const element = document.createElement("canvas");
            element.width = targetWidth;
            element.height = targetHeight;
            return element;
          })();

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Failed to initialize canvas for SVG stamp.");
    }

    context.clearRect(0, 0, targetWidth, targetHeight);
    context.drawImage(imageSource, 0, 0, targetWidth, targetHeight);

    const blob =
      typeof OffscreenCanvas === "function" && canvas instanceof OffscreenCanvas
        ? await canvas.convertToBlob({ type: "image/png" })
        : await new Promise<Blob>((resolve, reject) => {
            (canvas as HTMLCanvasElement).toBlob((value) => {
              if (value) {
                resolve(value);
                return;
              }
              reject(new Error("Failed to encode SVG stamp image."));
            }, "image/png");
          });

    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    if (
      typeof ImageBitmap !== "undefined" &&
      imageSource instanceof ImageBitmap
    ) {
      imageSource.close();
    }
  }
};

const decodeSvgDataUrlToString = (dataUrl: string) => {
  const { bytes, mimeType } = decodeStampImageDataUrl(dataUrl);
  if (mimeType !== "image/svg+xml") return undefined;

  try {
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
};

const textEncoder = new TextEncoder();

const concatUint8Arrays = (chunks: Uint8Array[]) => {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }

  return out;
};

const normalizeRightAngleDeg = (value: number) => {
  const normalized = (((Math.round(value / 90) * 90) % 360) + 360) % 360;
  return normalized === 360 ? 0 : normalized;
};

const getStampAppearanceBoundsForPageRotation = (
  bounds: { x: number; y: number; width: number; height: number },
  rotationDeg: number,
) => {
  const normalized = normalizeRightAngleDeg(rotationDeg);
  if (normalized !== 90 && normalized !== 270) {
    return bounds;
  }

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return {
    x: centerX - bounds.height / 2,
    y: centerY - bounds.width / 2,
    width: bounds.height,
    height: bounds.width,
  };
};

export class HighlightExporter implements IAnnotationExporter {
  shouldExport(annotation: Annotation): boolean {
    return annotation.type === "highlight";
  }

  save(
    pdfDoc: PDFDocument,
    page: PDFPage,
    annotation: Annotation,
    fontMap?: Map<string, PDFFont>,
    viewport?: ViewportLike,
  ): PDFRef | undefined {
    if (!annotation.rect) return undefined;

    const targetRects =
      annotation.rects && annotation.rects.length > 0
        ? annotation.rects
        : [annotation.rect];

    const quadPoints: number[] = [];
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (const r of targetRects) {
      const b = uiRectToPdfBounds(page, r, viewport);
      const llx = b.x;
      const lly = b.y;
      const urx = b.x + b.width;
      const ury = b.y + b.height;

      minX = Math.min(minX, llx);
      minY = Math.min(minY, lly);
      maxX = Math.max(maxX, urx);
      maxY = Math.max(maxY, ury);

      quadPoints.push(llx);
      quadPoints.push(ury);
      quadPoints.push(urx);
      quadPoints.push(ury);
      quadPoints.push(llx);
      quadPoints.push(lly);
      quadPoints.push(urx);
      quadPoints.push(lly);
    }

    const colorObj = annotation.color
      ? hexToPdfColor(annotation.color)
      : undefined;
    const cr = colorObj?.red;
    const cg = colorObj?.green;
    const cb = colorObj?.blue;

    const highlightAnnot = pdfDoc.context.obj({
      Type: "Annot",
      Subtype: "Highlight",
      F: 4, // Print
      Rect: [minX, minY, maxX, maxY],
      QuadPoints: quadPoints,
      C: [cr, cg, cb],
      CA:
        typeof annotation.opacity === "number" ? annotation.opacity : undefined,
      P: page.ref,
    });
    if (highlightAnnot instanceof PDFDict) {
      applyPdfAnnotationCommentMetadata(highlightAnnot, annotation);
      setAppHighlightedText(highlightAnnot, annotation.highlightedText);
    }

    const ref = pdfDoc.context.register(highlightAnnot);
    page.node.addAnnot(ref);
    return ref;
  }
}

export class CommentExporter implements IAnnotationExporter {
  shouldExport(annotation: Annotation): boolean {
    return annotation.type === "comment";
  }

  save(
    pdfDoc: PDFDocument,
    page: PDFPage,
    annotation: Annotation,
    fontMap?: Map<string, PDFFont>,
    viewport?: ViewportLike,
  ): PDFRef | undefined {
    if (!annotation.rect) return undefined;

    const bounds = uiRectToPdfBounds(page, annotation.rect, viewport);
    const x = bounds.x;
    const y = bounds.y;
    const w = bounds.width;
    const h = bounds.height;

    const colorObj = annotation.color
      ? hexToPdfColor(annotation.color)
      : undefined;
    const r = colorObj?.red;
    const g = colorObj?.green;
    const bb = colorObj?.blue;

    const commentAnnot = pdfDoc.context.obj({
      Type: "Annot",
      Subtype: "Text",
      F: 4, // Print
      Rect: [x, y, x + w, y + h],
      C: [r, g, bb],
      CA:
        typeof annotation.opacity === "number" ? annotation.opacity : undefined,
      Name: PDFName.of("Comment"),
      P: page.ref,
    });
    if (commentAnnot instanceof PDFDict) {
      applyPdfAnnotationCommentMetadata(commentAnnot, annotation);
    }

    const ref = pdfDoc.context.register(commentAnnot);
    page.node.addAnnot(ref);
    return ref;
  }
}

export class LinkExporter implements IAnnotationExporter {
  shouldExport(annotation: Annotation): boolean {
    return annotation.type === "link";
  }

  save(
    pdfDoc: PDFDocument,
    page: PDFPage,
    annotation: Annotation,
    fontMap?: Map<string, PDFFont>,
    viewport?: ViewportLike,
  ): PDFRef | undefined {
    if (!annotation.rect) return undefined;

    const bounds = uiRectToPdfBounds(page, annotation.rect, viewport);
    const destPage =
      typeof annotation.linkDestPageIndex === "number" &&
      annotation.linkDestPageIndex >= 0 &&
      annotation.linkDestPageIndex < pdfDoc.getPageCount()
        ? pdfDoc.getPage(annotation.linkDestPageIndex)
        : null;

    const linkAnnot = pdfDoc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      F: 4,
      Rect: [
        bounds.x,
        bounds.y,
        bounds.x + bounds.width,
        bounds.y + bounds.height,
      ],
      Border: [0, 0, 0],
      A: annotation.linkUrl
        ? {
            S: "URI",
            URI: PDFHexString.fromText(annotation.linkUrl),
          }
        : undefined,
      Dest: destPage ? [destPage.ref, PDFName.of("Fit")] : undefined,
      P: page.ref,
    });
    if (linkAnnot instanceof PDFDict) {
      applyPdfAnnotationCommentMetadata(linkAnnot, annotation);
    }

    const ref = pdfDoc.context.register(linkAnnot);
    page.node.addAnnot(ref);
    return ref;
  }
}

export class FreeTextExporter implements IAnnotationExporter {
  shouldExport(annotation: Annotation): boolean {
    return annotation.type === "freetext";
  }

  async save(
    pdfDoc: PDFDocument,
    page: PDFPage,
    annotation: Annotation,
    fontMap?: Map<string, PDFFont>,
    viewport?: ViewportLike,
  ): Promise<PDFRef | undefined> {
    if (!annotation.rect) return undefined;

    const bounds = uiRectToPdfBounds(page, annotation.rect, viewport);
    const x = bounds.x;
    const y = bounds.y;
    const w = bounds.width;
    const h = bounds.height;

    const colorObj = hexToPdfColor(annotation.color) || rgb(0, 0, 0);
    const r = colorObj.red;
    const g = colorObj.green;
    const bb = colorObj.blue;

    const bgColorObj = hexToPdfColor(annotation.backgroundColor);
    const bgR = bgColorObj?.red;
    const bgG = bgColorObj?.green;
    const bgB = bgColorObj?.blue;
    const borderWidth =
      typeof annotation.borderWidth === "number" &&
      Number.isFinite(annotation.borderWidth)
        ? Math.max(0, annotation.borderWidth)
        : 0;
    const hasBorder = borderWidth > 0;
    const borderColorObj = hasBorder
      ? hexToPdfColor(
          annotation.borderColor || annotation.color || "#000000",
        ) || rgb(0, 0, 0)
      : undefined;
    const borderR = borderColorObj?.red;
    const borderG = borderColorObj?.green;
    const borderB = borderColorObj?.blue;

    const opacity =
      typeof annotation.opacity === "number"
        ? Math.min(1, Math.max(0, annotation.opacity))
        : undefined;

    const fontSize = annotation.size || 12;

    const resolveStandardFont = (fontFamily: string | undefined) => {
      const f = (fontFamily || "").toLowerCase();
      if (f.includes("times")) {
        return { font: StandardFonts.TimesRoman, resourceName: "TiRo" };
      }
      if (f.includes("courier")) {
        return { font: StandardFonts.Courier, resourceName: "Cour" };
      }
      return { font: StandardFonts.Helvetica, resourceName: "Helv" };
    };

    const text = annotation.text || "";

    const customFont = isSerifFamily(annotation.fontFamily)
      ? fontMap?.get("CustomSerif") || fontMap?.get("Custom")
      : fontMap?.get("CustomSans") || fontMap?.get("Custom");
    const hasNonAscii = containsNonAscii(text);
    const userSelectedFont =
      annotation.fontFamily && fontMap?.has(annotation.fontFamily)
        ? fontMap.get(annotation.fontFamily)
        : undefined;
    const isUserSelectedNonStandardEmbedded =
      !!annotation.fontFamily &&
      !!userSelectedFont &&
      annotation.fontFamily !== "Helvetica" &&
      annotation.fontFamily !== "Times Roman" &&
      annotation.fontFamily !== "Courier";
    const userExplicitCustom =
      annotation.fontFamily === "Custom" ||
      annotation.fontFamily === "CustomSans" ||
      annotation.fontFamily === "CustomSerif" ||
      annotation.fontFamily === "Noto Sans SC" ||
      annotation.fontFamily === "Source Han Serif SC" ||
      isUserSelectedNonStandardEmbedded ||
      (customFont && userSelectedFont && userSelectedFont === customFont);

    const createCanEncodeChar = (font: PDFFont) => {
      const questionEncoded = (() => {
        try {
          return font.encodeText("?").toString();
        } catch {
          return null;
        }
      })();

      const cache = new Map<string, boolean>();
      return (ch: string) => {
        const cached = cache.get(ch);
        if (typeof cached === "boolean") return cached;
        try {
          const encoded = font.encodeText(ch).toString();
          const ok =
            ch === "?" || !questionEncoded || encoded !== questionEncoded;
          cache.set(ch, ok);
          return ok;
        } catch {
          cache.set(ch, false);
          return false;
        }
      };
    };

    // Base (ASCII) font selection
    let baseFont: PDFFont | undefined;
    let baseResourceName: string;
    if (isUserSelectedNonStandardEmbedded && userSelectedFont) {
      baseFont = userSelectedFont;
      baseResourceName = "Base";
    } else if (userExplicitCustom && customFont) {
      // If user explicitly chose a CJK/custom font, render the entire annotation with it.
      baseFont = customFont;
      baseResourceName = "Cust";
    } else if (userSelectedFont) {
      baseFont = userSelectedFont;
      // It's an embedded font (non-standard) but user didn't explicitly pick custom;
      // keep resourceName distinct from the CJK resource.
      baseResourceName = "Base";
    } else {
      const resolved = resolveStandardFont(annotation.fontFamily);
      baseFont = fontMap?.get(
        resolved.font === StandardFonts.TimesRoman
          ? "Times Roman"
          : resolved.font === StandardFonts.Courier
            ? "Courier"
            : "Helvetica",
      );
      baseResourceName = resolved.resourceName;
      if (!baseFont) {
        baseFont = await pdfDoc.embedFont(resolved.font);
      }
    }

    const canBaseEncodeChar = createCanEncodeChar(baseFont);

    // If the user explicitly chose the custom font, apply it to all text.
    // Otherwise, only apply custom to non-ASCII runs.
    const baseCanEncodeAll = (() => {
      if (!hasNonAscii) return true;
      for (const ch of text) {
        if (ch === "\n" || ch === "\r") continue;
        const code = ch.codePointAt(0) ?? 0;
        if (code <= 0x7f) continue;
        if (!canBaseEncodeChar(ch)) return false;
      }
      return true;
    })();

    const useMixedFonts = !!customFont && hasNonAscii && !baseCanEncodeAll;
    const cjkFont = useMixedFonts ? customFont : undefined;
    const cjkResourceName = cjkFont ? "Cust" : undefined;

    const baseFontRef = baseFont.ref;
    const cjkFontRef = cjkFont?.ref;
    const contentInset = hasBorder ? borderWidth : 0;
    const contentX = x + contentInset;
    const contentY = y + contentInset;
    const contentW = Math.max(0, w - contentInset * 2);
    const contentH = Math.max(0, h - contentInset * 2);

    // 2. Prepare text wrapping
    const paragraphs = text.split(/\r\n|\r|\n/);
    const lines: string[] = [];
    const availableWidth = contentW;

    const measureWidth = (s: string) => {
      if (!useMixedFonts || !cjkFont) {
        try {
          return baseFont.widthOfTextAtSize(s, fontSize);
        } catch {
          return Number.POSITIVE_INFINITY;
        }
      }

      // Mixed fonts: sum widths by ASCII/non-ASCII runs.
      let total = 0;
      let buf = "";
      let bufIsAscii: boolean | null = null;
      const flush = () => {
        if (!buf) return;
        const f = bufIsAscii ? baseFont : cjkFont;
        try {
          total += f.widthOfTextAtSize(buf, fontSize);
        } catch {
          total += Number.POSITIVE_INFINITY;
        }
        buf = "";
        bufIsAscii = null;
      };

      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        const isAscii = ch.charCodeAt(0) <= 0x7f;
        if (bufIsAscii === null) {
          bufIsAscii = isAscii;
          buf = ch;
          continue;
        }
        if (isAscii === bufIsAscii) {
          buf += ch;
        } else {
          flush();
          bufIsAscii = isAscii;
          buf = ch;
        }
      }
      flush();
      return total;
    };

    const wrapParagraph = (paragraph: string) => {
      if (paragraph === "") {
        lines.push("");
        return;
      }

      let current = "";
      let lastBreakPos = -1; // position in `current` where we can break (after char)
      let i = 0;

      const recomputeLastBreakPos = () => {
        lastBreakPos = -1;
        for (let j = current.length - 1; j >= 0; j--) {
          const ch = current[j];
          const code = ch.charCodeAt(0);
          if (ch === " " || ch === "\t" || ch === "-" || code > 0x7f) {
            lastBreakPos = j + 1;
            return;
          }
        }
      };

      while (i < paragraph.length) {
        const ch = paragraph[i];
        const next = current + ch;

        let width = 0;
        try {
          width = measureWidth(next);
        } catch {
          width = Number.POSITIVE_INFINITY;
        }

        if (current === "" || width <= availableWidth) {
          current = next;
          const code = ch.charCodeAt(0);
          if (ch === " " || ch === "\t" || ch === "-" || code > 0x7f) {
            lastBreakPos = current.length;
          }
          i += 1;
          continue;
        }

        // Overflow: break at last known opportunity; otherwise hard break.
        if (lastBreakPos > 0 && lastBreakPos < current.length) {
          lines.push(current.slice(0, lastBreakPos));
          current = current.slice(lastBreakPos);
          recomputeLastBreakPos();
          continue;
        }
        if (lastBreakPos === current.length) {
          lines.push(current);
          current = "";
          lastBreakPos = -1;
          continue;
        }

        // No break opportunities; force break at current length.
        lines.push(current);
        current = "";
        lastBreakPos = -1;
      }

      // Push remainder (including whitespace)
      if (current !== "") lines.push(current);
    };

    for (const paragraph of paragraphs) {
      wrapParagraph(paragraph);
    }

    const rotationDeg =
      typeof annotation.rotationDeg === "number" &&
      Number.isFinite(annotation.rotationDeg)
        ? annotation.rotationDeg
        : 0;
    const theta = (-rotationDeg * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);

    const lineHeightMultiplier =
      typeof annotation.lineHeight === "number" &&
      Number.isFinite(annotation.lineHeight) &&
      annotation.lineHeight > 0
        ? annotation.lineHeight
        : 1;
    const lineHeight = fontSize * lineHeightMultiplier;

    if (annotation.flatten) {
      const bg =
        typeof bgR === "number" &&
        typeof bgG === "number" &&
        typeof bgB === "number"
          ? rgb(bgR, bgG, bgB)
          : undefined;
      const borderColor =
        hasBorder &&
        typeof borderR === "number" &&
        typeof borderG === "number" &&
        typeof borderB === "number"
          ? rgb(borderR, borderG, borderB)
          : undefined;

      const hasRotation = rotationDeg !== 0;
      const cx = x + w / 2;
      const cy = y + h / 2;
      const rotatePoint = (px: number, py: number) => {
        if (!hasRotation) return { x: px, y: py };
        const dx = px - cx;
        const dy = py - cy;
        return {
          x: cx + cos * dx - sin * dy,
          y: cy + sin * dx + cos * dy,
        };
      };

      if (bg) {
        const rp = rotatePoint(x, y);
        page.drawRectangle({
          x: rp.x,
          y: rp.y,
          width: w,
          height: h,
          color: bg,
          opacity,
          rotate: hasRotation ? degrees(-rotationDeg) : undefined,
        });
      }
      if (hasBorder && borderColor) {
        const inset = borderWidth / 2;
        const strokeW = Math.max(0, w - borderWidth);
        const strokeH = Math.max(0, h - borderWidth);
        const rp = rotatePoint(x + inset, y + inset);
        page.drawRectangle({
          x: rp.x,
          y: rp.y,
          width: strokeW,
          height: strokeH,
          borderColor,
          borderWidth,
          opacity,
          rotate: hasRotation ? degrees(-rotationDeg) : undefined,
        });
      }
      const textColor = rgb(r, g, bb);

      const measureLineWidth = (s: string) => {
        if (!useMixedFonts || !cjkFont || !cjkResourceName) {
          const runFont =
            userExplicitCustom &&
            customFont &&
            !isUserSelectedNonStandardEmbedded
              ? customFont
              : baseFont;
          try {
            return runFont.widthOfTextAtSize(s, fontSize);
          } catch {
            return 0;
          }
        }

        let total = 0;
        let buf = "";
        let bufIsAscii: boolean | null = null;
        const flushWidth = () => {
          if (!buf) return;
          const runFont = bufIsAscii ? baseFont : cjkFont;
          try {
            total += runFont.widthOfTextAtSize(buf, fontSize);
          } catch {
            // ignore
          }
          buf = "";
          bufIsAscii = null;
        };

        for (let i = 0; i < s.length; i++) {
          const ch = s[i];
          const isAscii = ch.charCodeAt(0) <= 0x7f;
          if (bufIsAscii === null) {
            bufIsAscii = isAscii;
            buf = ch;
            continue;
          }
          if (isAscii === bufIsAscii) {
            buf += ch;
          } else {
            flushWidth();
            bufIsAscii = isAscii;
            buf = ch;
          }
        }
        flushWidth();
        return total;
      };

      const getAlignedX = (lineText: string) => {
        const lw = measureLineWidth(lineText);
        const q =
          annotation.alignment === "center"
            ? 1
            : annotation.alignment === "right"
              ? 2
              : 0;
        if (q === 1) return contentX + (contentW - lw) / 2;
        if (q === 2) return contentX + (contentW - lw);
        return contentX;
      };

      for (let li = 0; li < lines.length; li++) {
        const lineText = lines[li]!;
        const drawY = contentY + contentH - lineHeight - li * lineHeight;

        if (!useMixedFonts || !cjkFont || !cjkResourceName) {
          const runFont =
            userExplicitCustom &&
            customFont &&
            !isUserSelectedNonStandardEmbedded
              ? customFont
              : baseFont;
          const rp = rotatePoint(getAlignedX(lineText), drawY);
          page.drawText(lineText, {
            x: rp.x,
            y: rp.y,
            size: fontSize,
            font: runFont,
            color: textColor,
            opacity,
            rotate: hasRotation ? degrees(-rotationDeg) : undefined,
          });
          continue;
        }

        let cursorX = getAlignedX(lineText);
        let buf = "";
        let bufIsAscii: boolean | null = null;
        const flush = () => {
          if (!buf) return;
          const runFont = bufIsAscii ? baseFont : cjkFont;
          const rp = rotatePoint(cursorX, drawY);
          page.drawText(buf, {
            x: rp.x,
            y: rp.y,
            size: fontSize,
            font: runFont,
            color: textColor,
            opacity,
            rotate: hasRotation ? degrees(-rotationDeg) : undefined,
          });
          try {
            cursorX += runFont.widthOfTextAtSize(buf, fontSize);
          } catch {
            // ignore
          }
          buf = "";
          bufIsAscii = null;
        };

        for (let i = 0; i < lineText.length; i++) {
          const ch = lineText[i];
          const isAscii = ch.charCodeAt(0) <= 0x7f;
          if (bufIsAscii === null) {
            bufIsAscii = isAscii;
            buf = ch;
            continue;
          }
          if (isAscii === bufIsAscii) {
            buf += ch;
          } else {
            flush();
            bufIsAscii = isAscii;
            buf = ch;
          }
        }
        flush();
      }

      return undefined;
    }

    // 3. Generate Appearance Stream (AP)
    const apFontResources: Record<string, PDFRef> = {
      [baseResourceName]: baseFontRef,
    };
    if (useMixedFonts && cjkFontRef && cjkResourceName) {
      apFontResources[cjkResourceName] = cjkFontRef;
    }

    let apResources = pdfDoc.context.obj({
      Font: apFontResources,
      ProcSet: [PDFName.of("PDF"), PDFName.of("Text")],
    });

    if (typeof opacity === "number" && opacity < 1) {
      const gsDict = pdfDoc.context.obj({ CA: opacity, ca: opacity });
      const gsRef = pdfDoc.context.register(gsDict);
      apResources = pdfDoc.context.obj({
        Font: apFontResources,
        ProcSet: [PDFName.of("PDF"), PDFName.of("Text")],
        ExtGState: { GS0: gsRef },
      });
    }

    const startX = contentInset;
    const startY = contentInset + contentH - lineHeight;

    const pdfNum = (n: number) => {
      if (!Number.isFinite(n)) return "0";
      const v = Math.abs(n) < 1e-8 ? 0 : n;
      const s = v.toFixed(6);
      return s.replace(/\.0+$|(?<=\.[0-9]*?)0+$/g, "").replace(/\.$/, "");
    };

    const absCos = Math.abs(cos);
    const absSin = Math.abs(sin);

    const aabbW = absCos * w + absSin * h;
    const aabbH = absSin * w + absCos * h;
    const pageCx = x + w / 2;
    const pageCy = y + h / 2;
    const rectX = pageCx - aabbW / 2;
    const rectY = pageCy - aabbH / 2;

    let appearanceOps = `q${typeof opacity === "number" && opacity < 1 ? " /GS0 gs" : ""}`;

    if (rotationDeg !== 0) {
      const cx = aabbW / 2;
      const cy = aabbH / 2;
      appearanceOps += ` 1 0 0 1 ${pdfNum(cx)} ${pdfNum(cy)} cm ${pdfNum(cos)} ${pdfNum(sin)} ${pdfNum(-sin)} ${pdfNum(cos)} 0 0 cm 1 0 0 1 ${pdfNum(-w / 2)} ${pdfNum(-h / 2)} cm`;
    }
    if (
      typeof bgR === "number" &&
      typeof bgG === "number" &&
      typeof bgB === "number"
    ) {
      appearanceOps += ` ${bgR} ${bgG} ${bgB} rg 0 0 ${w} ${h} re f`;
    }
    if (
      hasBorder &&
      typeof borderR === "number" &&
      typeof borderG === "number" &&
      typeof borderB === "number"
    ) {
      const inset = borderWidth / 2;
      const strokeW = Math.max(0, w - borderWidth);
      const strokeH = Math.max(0, h - borderWidth);
      appearanceOps += ` ${borderR} ${borderG} ${borderB} RG ${pdfNum(borderWidth)} w ${pdfNum(inset)} ${pdfNum(inset)} ${pdfNum(strokeW)} ${pdfNum(strokeH)} re S`;
    }
    appearanceOps += ` ${r} ${g} ${bb} rg BT /${baseResourceName} ${fontSize} Tf ${pdfNum(lineHeight)} TL`;

    // Initial position
    appearanceOps += ` ${pdfNum(startX)} ${pdfNum(startY)} Td`;

    let currentResource = baseResourceName;

    const encodeRun = (f: PDFFont, run: string) => {
      try {
        return f.encodeText(run);
      } catch {
        const canEncodeChar = createCanEncodeChar(f);
        let sanitized = "";
        for (const ch of run) {
          const code = ch.codePointAt(0) ?? 0;
          sanitized += code <= 0x7f || canEncodeChar(ch) ? ch : "?";
        }
        return f.encodeText(sanitized);
      }
    };

    for (const line of lines) {
      if (!useMixedFonts || !cjkFont || !cjkResourceName) {
        const runFont =
          userExplicitCustom && customFont && !isUserSelectedNonStandardEmbedded
            ? customFont
            : baseFont;
        const encoded = encodeRun(runFont, line);
        appearanceOps += ` ${encoded} Tj T*`;
        continue;
      }

      // Mixed: switch fonts per run
      let buf = "";
      let bufIsAscii: boolean | null = null;
      const flush = () => {
        if (!buf) return;
        const runFont = bufIsAscii ? baseFont : cjkFont;
        const runRes = bufIsAscii ? baseResourceName : cjkResourceName;
        if (runRes !== currentResource) {
          appearanceOps += ` /${runRes} ${fontSize} Tf`;
          currentResource = runRes;
        }
        const encoded = encodeRun(runFont, buf);
        appearanceOps += ` ${encoded} Tj`;
        buf = "";
        bufIsAscii = null;
      };

      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        const isAscii = ch.charCodeAt(0) <= 0x7f;
        if (bufIsAscii === null) {
          bufIsAscii = isAscii;
          buf = ch;
          continue;
        }
        if (isAscii === bufIsAscii) {
          buf += ch;
        } else {
          flush();
          bufIsAscii = isAscii;
          buf = ch;
        }
      }
      flush();
      appearanceOps += " T*";
    }

    appearanceOps += " ET Q";

    const appearanceStream = pdfDoc.context.stream(appearanceOps, {
      Type: "XObject",
      Subtype: "Form",
      FormType: 1,
      BBox: [0, 0, aabbW, aabbH],
      Resources: apResources,
    });
    const appearanceRef = pdfDoc.context.register(appearanceStream);

    // 4. Fallback: Add Font to Page Resources
    const resources = page.node.Resources() || pdfDoc.context.obj({});
    let pageFontDict = resources.lookup(PDFName.of("Font"));
    if (!(pageFontDict instanceof PDFDict)) {
      pageFontDict = pdfDoc.context.obj({});
      resources.set(PDFName.of("Font"), pageFontDict);
    }
    (pageFontDict as PDFDict).set(PDFName.of(baseResourceName), baseFontRef);
    if (useMixedFonts && cjkFontRef && cjkResourceName) {
      (pageFontDict as PDFDict).set(PDFName.of(cjkResourceName), cjkFontRef);
    }

    if (!page.node.Resources()) {
      page.node.set(PDFName.of("Resources"), resources);
    }

    // 5. Create Annotation
    const da = `/${baseResourceName} ${fontSize} Tf ${r} ${g} ${bb} rg ${pdfNum(lineHeight)} TL`;
    const q =
      annotation.alignment === "center"
        ? 1
        : annotation.alignment === "right"
          ? 2
          : 0;

    const pdfRotation = (() => {
      const r = -rotationDeg;
      if (!Number.isFinite(r)) return undefined;
      const d = ((r % 360) + 360) % 360;
      return d === 0 ? undefined : d;
    })();

    const freeTextAnnot = pdfDoc.context.obj({
      Type: "Annot",
      Subtype: "FreeText",
      F: 4, // Print flag
      Rect: [rectX, rectY, rectX + aabbW, rectY + aabbH],
      RD: [contentInset, contentInset, contentInset, contentInset],
      DA: PDFString.of(da),
      AP: { N: appearanceRef },
      Q: q,
      BS: { W: hasBorder ? borderWidth : 0 },
      C:
        hasBorder &&
        typeof borderR === "number" &&
        typeof borderG === "number" &&
        typeof borderB === "number"
          ? [borderR, borderG, borderB]
          : undefined,
      Rotate: pdfRotation,
      MK: pdfRotation !== undefined ? { R: pdfRotation } : undefined,
      IC:
        typeof bgR === "number" &&
        typeof bgG === "number" &&
        typeof bgB === "number"
          ? [bgR, bgG, bgB]
          : undefined,
      CA: typeof opacity === "number" ? opacity : undefined,
      P: page.ref,
    });
    if (freeTextAnnot instanceof PDFDict) {
      applyPdfAnnotationCommentMetadata(freeTextAnnot, annotation);
    }

    const ref = pdfDoc.context.register(freeTextAnnot);
    page.node.addAnnot(ref);
    return ref;
  }
}

const registerAppearanceStream = (
  pdfDoc: PDFDocument,
  operators: PDFOperator[],
  bbox: [number, number, number, number],
  graphicsStates?: Record<string, number>,
  matrix?: PdfTransformMatrix,
  extraResources?: {
    Font?: Record<string, PDFRef>;
    XObject?: Record<string, PDFRef>;
  },
) => {
  if (operators.length === 0) return undefined;

  const createAppearanceResources = (
    inheritedResources?: PDFDict,
    extra?: {
      Font?: Record<string, PDFRef>;
      XObject?: Record<string, PDFRef>;
    },
  ) => {
    const resourcesObj =
      inheritedResources?.clone(pdfDoc.context) ?? pdfDoc.context.obj({});
    const procSet =
      resourcesObj.lookupMaybe(PDFName.of("ProcSet"), PDFArray) ??
      pdfDoc.context.obj([]);

    if (!(procSet instanceof PDFArray) || procSet.size() === 0) {
      resourcesObj.set(
        PDFName.of("ProcSet"),
        pdfDoc.context.obj([
          PDFName.of("PDF"),
          PDFName.of("Text"),
          PDFName.of("ImageB"),
          PDFName.of("ImageC"),
          PDFName.of("ImageI"),
        ]),
      );
    }

    if (extra?.Font) {
      const fontDict =
        resourcesObj.lookupMaybe(PDFName.of("Font"), PDFDict) ??
        pdfDoc.context.obj({});
      for (const [name, ref] of Object.entries(extra.Font)) {
        fontDict.set(PDFName.of(name), ref);
      }
      resourcesObj.set(PDFName.of("Font"), fontDict);
    }

    if (extra?.XObject) {
      const xObjectDict =
        resourcesObj.lookupMaybe(PDFName.of("XObject"), PDFDict) ??
        pdfDoc.context.obj({});
      for (const [name, ref] of Object.entries(extra.XObject)) {
        xObjectDict.set(PDFName.of(name), ref);
      }
      resourcesObj.set(PDFName.of("XObject"), xObjectDict);
    }

    const graphicsStateEntries = Object.entries(graphicsStates ?? {}).filter(
      ([, opacity]) =>
        typeof opacity === "number" && opacity >= 0 && opacity < 1,
    );
    if (graphicsStateEntries.length > 0) {
      const extGState =
        resourcesObj.lookupMaybe(PDFName.of("ExtGState"), PDFDict) ??
        pdfDoc.context.obj({});
      for (const [name, opacity] of graphicsStateEntries) {
        const gsDict = pdfDoc.context.obj({ CA: opacity, ca: opacity });
        const gsRef = pdfDoc.context.register(gsDict);
        extGState.set(PDFName.of(name), gsRef);
      }
      resourcesObj.set(PDFName.of("ExtGState"), extGState);
    }

    return resourcesObj;
  };

  const resourcesObj = createAppearanceResources(undefined, extraResources);
  const appearanceStream = pdfDoc.context.contentStream(operators, {
    Type: PDFName.of("XObject"),
    Subtype: PDFName.of("Form"),
    FormType: 1,
    BBox: bbox,
    Matrix: matrix,
    Resources: resourcesObj,
  });

  return pdfDoc.context.register(appearanceStream);
};

const registerRawAppearanceStream = (
  pdfDoc: PDFDocument,
  contents: Uint8Array,
  bbox: [number, number, number, number],
  graphicsStates?: Record<string, number>,
  matrix?: PdfTransformMatrix,
  inheritedResources?: PDFDict,
) => {
  if (contents.length === 0) return undefined;

  const resourcesObj =
    inheritedResources?.clone(pdfDoc.context) ?? pdfDoc.context.obj({});
  const procSet =
    resourcesObj.lookupMaybe(PDFName.of("ProcSet"), PDFArray) ??
    pdfDoc.context.obj([]);

  if (!(procSet instanceof PDFArray) || procSet.size() === 0) {
    resourcesObj.set(
      PDFName.of("ProcSet"),
      pdfDoc.context.obj([
        PDFName.of("PDF"),
        PDFName.of("Text"),
        PDFName.of("ImageB"),
        PDFName.of("ImageC"),
        PDFName.of("ImageI"),
      ]),
    );
  }

  const graphicsStateEntries = Object.entries(graphicsStates ?? {}).filter(
    ([, opacity]) => typeof opacity === "number" && opacity >= 0 && opacity < 1,
  );
  let wrappedContents = contents;
  if (graphicsStateEntries.length > 0) {
    const extGState =
      resourcesObj.lookupMaybe(PDFName.of("ExtGState"), PDFDict) ??
      pdfDoc.context.obj({});
    for (const [name, opacity] of graphicsStateEntries) {
      const gsDict = pdfDoc.context.obj({ CA: opacity, ca: opacity });
      const gsRef = pdfDoc.context.register(gsDict);
      extGState.set(PDFName.of(name), gsRef);
    }
    resourcesObj.set(PDFName.of("ExtGState"), extGState);

    const defaultStateName = graphicsStateEntries[0]?.[0];
    if (defaultStateName) {
      wrappedContents = concatUint8Arrays([
        textEncoder.encode(`q\n/${defaultStateName} gs\n`),
        contents,
        textEncoder.encode("Q\n"),
      ]);
    }
  }

  const appearanceStream = pdfDoc.context.flateStream(wrappedContents, {
    Type: PDFName.of("XObject"),
    Subtype: PDFName.of("Form"),
    FormType: 1,
    BBox: bbox,
    Matrix: matrix,
    Resources: resourcesObj,
  });

  return pdfDoc.context.register(appearanceStream);
};

const extractScratchPageAppearance = async (options: {
  pdfDoc: PDFDocument;
  page: PDFPage;
  svg: string;
  imageRect: { x: number; y: number; width: number; height: number };
  fonts?: Record<string, PDFFont>;
}) => {
  try {
    const embeddedSvg = await options.pdfDoc.embedSvg(options.svg);
    const scratchPage = PDFPage.create(options.pdfDoc);
    scratchPage.setSize(options.page.getWidth(), options.page.getHeight());
    scratchPage.drawSvg(embeddedSvg, {
      x: options.imageRect.x,
      y: options.imageRect.y + options.imageRect.height,
      width: options.imageRect.width,
      height: options.imageRect.height,
      fonts: options.fonts,
    });

    const contents = scratchPage.node.Contents();
    const contentChunks: Uint8Array[] = [];

    if (contents instanceof PDFArray) {
      for (let index = 0; index < contents.size(); index += 1) {
        const raw = contents.get(index);
        const stream = contents.lookupMaybe(index, PDFStream) as
          | PDFContentStream
          | undefined;
        if (stream) {
          contentChunks.push(stream.getUnencodedContents());
        }
        if (raw instanceof PDFRef) {
          options.pdfDoc.context.delete(raw);
        }
      }
    } else if (contents instanceof PDFStream) {
      const stream = contents as PDFContentStream;
      contentChunks.push(stream.getUnencodedContents());
      const streamRef = options.pdfDoc.context.getObjectRef(stream);
      if (streamRef) {
        options.pdfDoc.context.delete(streamRef);
      }
    }

    const resources = scratchPage.node
      .Resources()
      ?.clone(options.pdfDoc.context);
    options.pdfDoc.context.delete(scratchPage.ref);

    return {
      contents: concatUint8Arrays(contentChunks),
      resources,
    };
  } catch {
    return undefined;
  }
};

const withPdfLineJoin = (operators: PDFOperator[], lineJoin: LineJoinStyle) => {
  if (operators.length === 0) return operators;
  return [operators[0]!, setLineJoin(lineJoin), ...operators.slice(1)];
};

const buildShapeAppearanceOperators = (
  shapeType: NonNullable<Annotation["shapeType"]>,
  pdfRect: { x: number; y: number; width: number; height: number } | null,
  pdfPoints: Array<{ x: number; y: number }>,
  arrowStyles: ReturnType<typeof getShapeArrowStyles>,
  arrowSize: number | undefined,
  cloudIntensity: number | undefined,
  cloudSpacing: number | undefined,
  stroke: ReturnType<typeof rgb> | undefined,
  fill: ReturnType<typeof rgb> | undefined,
  thickness: number,
  borderDashArray: number[] | undefined,
  strokeGraphicsState?: string,
  fillGraphicsState?: string,
): {
  bbox: [number, number, number, number];
  operators: PDFOperator[];
  rectInset?: number;
} | null => {
  const strokeWidth = stroke ? Math.max(0, thickness) : 0;

  if (
    shapeType === "square" ||
    shapeType === "circle" ||
    shapeType === "cloud"
  ) {
    if (!pdfRect) return null;
    const x = pdfRect.x;
    const y = pdfRect.y;
    const width = Math.max(1, pdfRect.width);
    const height = Math.max(1, pdfRect.height);
    const baseBBox: [number, number, number, number] = [
      x,
      y,
      x + width,
      y + height,
    ];

    if (shapeType === "square") {
      const operators: PDFOperator[] = [];
      if (fill) {
        operators.push(
          ...drawRectangle({
            x: x + strokeWidth / 2,
            y: y + strokeWidth / 2,
            width: Math.max(1, width - strokeWidth),
            height: Math.max(1, height - strokeWidth),
            color: fill,
            rotate: degrees(0),
            xSkew: degrees(0),
            ySkew: degrees(0),
            borderColor: undefined,
            borderWidth: 0,
            borderDashArray,
            graphicsState: fillGraphicsState,
          }),
        );
      }
      if (stroke) {
        operators.push(
          ...drawRectangle({
            x: x + strokeWidth / 2,
            y: y + strokeWidth / 2,
            width: Math.max(1, width - strokeWidth),
            height: Math.max(1, height - strokeWidth),
            color: undefined,
            rotate: degrees(0),
            xSkew: degrees(0),
            ySkew: degrees(0),
            borderColor: stroke,
            borderWidth: strokeWidth,
            borderDashArray,
            graphicsState: strokeGraphicsState,
          }),
        );
      }
      return {
        bbox: baseBBox,
        operators,
      };
    }

    if (shapeType === "circle") {
      const operators: PDFOperator[] = [];
      if (fill) {
        operators.push(
          ...drawEllipse({
            x: x + width / 2,
            y: y + height / 2,
            xScale: Math.max(1, width / 2 - strokeWidth / 2),
            yScale: Math.max(1, height / 2 - strokeWidth / 2),
            color: fill,
            borderColor: undefined,
            borderWidth: 0,
            borderDashArray,
            graphicsState: fillGraphicsState,
          }),
        );
      }
      if (stroke) {
        operators.push(
          ...drawEllipse({
            x: x + width / 2,
            y: y + height / 2,
            xScale: Math.max(1, width / 2 - strokeWidth / 2),
            yScale: Math.max(1, height / 2 - strokeWidth / 2),
            color: undefined,
            borderColor: stroke,
            borderWidth: strokeWidth,
            borderDashArray,
            graphicsState: strokeGraphicsState,
          }),
        );
      }
      return {
        bbox: baseBBox,
        operators,
      };
    }

    const geometry = getCloudGeometry(
      {
        x: 0,
        y: 0,
        width,
        height,
      },
      {
        intensity: cloudIntensity,
        strokeWidth,
        spacing: cloudSpacing,
      },
    );
    const bbox: [number, number, number, number] = [
      x - geometry.overflow,
      y - geometry.overflow,
      x + width + geometry.overflow,
      y + height + geometry.overflow,
    ];
    const svgPath = getCloudPathData(
      {
        x: geometry.overflow + geometry.pathRect.x,
        y: geometry.overflow + geometry.pathRect.y,
        width: geometry.pathRect.width,
        height: geometry.pathRect.height,
      },
      geometry.intensity,
      geometry.spacing,
    );

    const operators: PDFOperator[] = [];
    if (fill) {
      operators.push(
        ...drawSvgPath(svgPath, {
          x: bbox[0],
          y: bbox[3],
          scale: 1,
          color: fill,
          borderColor: undefined,
          borderWidth: 0,
          borderDashArray,
          graphicsState: fillGraphicsState,
        }),
      );
    }
    if (stroke) {
      operators.push(
        ...drawSvgPath(svgPath, {
          x: bbox[0],
          y: bbox[3],
          scale: 1,
          color: undefined,
          borderColor: stroke,
          borderWidth: strokeWidth,
          borderDashArray,
          graphicsState: strokeGraphicsState,
        }),
      );
    }

    return {
      bbox,
      operators,
      rectInset: geometry.overflow,
    };
  }

  if (pdfPoints.length < 2) return null;

  const hasAnyArrow =
    strokeWidth > 0 && (!!arrowStyles.start || !!arrowStyles.end);
  const resolvedArrowSize =
    typeof arrowSize === "number" && Number.isFinite(arrowSize)
      ? Math.max(6, arrowSize)
      : getDefaultArrowSize(Math.max(1, strokeWidth || thickness));
  const polygonCloudGeometry =
    shapeType === "cloud_polygon"
      ? getPolygonCloudGeometry(pdfPoints, {
          intensity: cloudIntensity,
          strokeWidth,
          spacing: cloudSpacing,
        })
      : null;
  const arrowPadding = hasAnyArrow
    ? Math.max(strokeWidth, resolvedArrowSize)
    : 0;
  const padding = Math.max(
    strokeWidth,
    arrowPadding,
    polygonCloudGeometry?.overflow ?? 0,
  );
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of pdfPoints) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  const bbox: [number, number, number, number] = [
    minX - padding,
    minY - padding,
    maxX + padding,
    maxY + padding,
  ];

  const localPoints = pdfPoints.map((point) => ({
    x: point.x - bbox[0],
    y: bbox[3] - point.y,
  }));
  const trimmedLocalPoints = hasAnyArrow
    ? getTrimmedOpenLinePointsForArrows(
        localPoints,
        arrowStyles,
        strokeWidth,
        resolvedArrowSize,
      )
    : localPoints;

  const operators: PDFOperator[] = [];
  const pathBorderLineCap = getShapePdfLineCap(shapeType);
  const pathBorderLineJoin =
    getShapePdfLineJoin(shapeType) === 1
      ? LineJoinStyle.Round
      : LineJoinStyle.Miter;

  if (shapeType === "cloud_polygon") {
    const localCloudGeometry = getPolygonCloudGeometry(localPoints, {
      intensity: cloudIntensity,
      strokeWidth,
      spacing: cloudSpacing,
    });
    if (fill) {
      operators.push(
        ...withPdfLineJoin(
          drawSvgPath(localCloudGeometry.pathData, {
            x: bbox[0],
            y: bbox[3],
            scale: 1,
            color: fill,
            borderColor: undefined,
            borderWidth: 0,
            borderDashArray,
            borderLineCap: pathBorderLineCap,
            graphicsState: fillGraphicsState,
          }),
          pathBorderLineJoin,
        ),
      );
    }
    if (stroke) {
      operators.push(
        ...withPdfLineJoin(
          drawSvgPath(localCloudGeometry.pathData, {
            x: bbox[0],
            y: bbox[3],
            scale: 1,
            color: undefined,
            borderColor: stroke,
            borderWidth: strokeWidth,
            borderDashArray,
            borderLineCap: pathBorderLineCap,
            graphicsState: strokeGraphicsState,
          }),
          pathBorderLineJoin,
        ),
      );
    }
  } else {
    const pathData = getShapePointsPathData(trimmedLocalPoints, {
      closed: isClosedShapeType(shapeType),
    });
    if (shapeType === "polygon" && fill) {
      operators.push(
        ...withPdfLineJoin(
          drawSvgPath(pathData, {
            x: bbox[0],
            y: bbox[3],
            scale: 1,
            color: fill,
            borderColor: undefined,
            borderWidth: 0,
            borderDashArray,
            borderLineCap: pathBorderLineCap,
            graphicsState: fillGraphicsState,
          }),
          pathBorderLineJoin,
        ),
      );
    }
    if (stroke) {
      operators.push(
        ...withPdfLineJoin(
          drawSvgPath(pathData, {
            x: bbox[0],
            y: bbox[3],
            scale: 1,
            color: undefined,
            borderColor: stroke,
            borderWidth: strokeWidth,
            borderDashArray,
            borderLineCap: pathBorderLineCap,
            graphicsState: strokeGraphicsState,
          }),
          pathBorderLineJoin,
        ),
      );
    }
  }

  if (hasAnyArrow) {
    const markers = [
      {
        marker: getLineEndingMarker(
          localPoints,
          "start",
          arrowStyles.start,
          strokeWidth,
          resolvedArrowSize,
        ),
        style: arrowStyles.start,
      },
      {
        marker: getLineEndingMarker(
          localPoints,
          "end",
          arrowStyles.end,
          strokeWidth,
          resolvedArrowSize,
        ),
        style: arrowStyles.end,
      },
    ];

    for (const { marker, style } of markers) {
      if (!marker) continue;
      operators.push(
        ...withPdfLineJoin(
          drawSvgPath(marker.pathData, {
            x: bbox[0],
            y: bbox[3],
            scale: 1,
            color: marker.fillMode === "stroke" ? stroke : undefined,
            borderColor: stroke,
            borderWidth: Math.max(1, strokeWidth * 0.9),
            borderDashArray,
            borderLineCap: getShapeMarkerPdfLineCap(style),
            graphicsState: strokeGraphicsState,
          }),
          getShapeMarkerPdfLineJoin(style) === 1
            ? LineJoinStyle.Round
            : LineJoinStyle.Miter,
        ),
      );
    }
  }

  return { bbox, operators };
};

export class StampExporter implements IAnnotationExporter {
  shouldExport(annotation: Annotation): boolean {
    return annotation.type === "stamp";
  }

  async save(
    pdfDoc: PDFDocument,
    page: PDFPage,
    annotation: Annotation,
    fontMap?: Map<string, PDFFont>,
    viewport?: ViewportLike,
  ): Promise<PDFRef | undefined> {
    if (annotation.type !== "stamp" || !annotation.rect) {
      return undefined;
    }

    const bounds = uiRectToPdfBounds(page, annotation.rect, viewport);
    const opacity =
      typeof annotation.opacity === "number"
        ? Math.min(1, Math.max(0.05, annotation.opacity))
        : 1;
    const pageRotationDeg =
      viewport && typeof viewport.rotation === "number" ? viewport.rotation : 0;
    const isImportedStamp = !!annotation.sourcePdfRef;
    const stamp = annotation.stamp;
    const stampKind = stamp?.kind ?? "preset";
    const stampPresetId = stamp?.presetId;
    const stampLabel = stamp?.label;
    const stampImage = stamp?.image;
    const stampAppearance = stamp?.appearance;
    const stampImageData = stampImage?.dataUrl;
    const stampIntrinsicSize = stampImage?.intrinsicSize;
    const isBakedStampImage = stampAppearance?.source === "baked";
    const needsAppearanceBoundsCompensation =
      pageRotationDeg !== 0 &&
      (!isImportedStamp || (stampKind === "image" && isBakedStampImage));
    const needsPageRotationCompensation =
      pageRotationDeg !== 0 &&
      (!isImportedStamp || (stampKind === "image" && isBakedStampImage));
    const rotationDeg =
      typeof annotation.rotationDeg === "number" &&
      Number.isFinite(annotation.rotationDeg)
        ? annotation.rotationDeg
        : 0;
    const effectiveRotationDeg = needsPageRotationCompensation
      ? rotationDeg - pageRotationDeg
      : rotationDeg;
    const appearanceBounds = needsAppearanceBoundsCompensation
      ? getStampAppearanceBoundsForPageRotation(bounds, pageRotationDeg)
      : bounds;
    const bbox: [number, number, number, number] = [
      appearanceBounds.x,
      appearanceBounds.y,
      appearanceBounds.x + appearanceBounds.width,
      appearanceBounds.y + appearanceBounds.height,
    ];
    const rotationCenterPdf = uiPointToPdfPoint(
      page,
      {
        x: annotation.rect.x + annotation.rect.width / 2,
        y: annotation.rect.y + annotation.rect.height / 2,
      },
      viewport,
    );
    const appearanceMatrix =
      effectiveRotationDeg !== 0
        ? buildPdfRotationMatrix(-effectiveRotationDeg, rotationCenterPdf)
        : undefined;
    const graphicsStates = opacity < 1 ? { GS_STAMP: opacity } : undefined;
    const rectValues = appearanceMatrix
      ? getTransformedPdfRect(bbox, appearanceMatrix)
      : bbox;

    let operators: PDFOperator[] = [];
    let extraResources:
      | {
          Font?: Record<string, PDFRef>;
          XObject?: Record<string, PDFRef>;
        }
      | undefined;
    let appearanceRef: PDFRef | undefined;
    let stampSourceSvgData: string | undefined;

    if (stampKind === "image" && stampImageData) {
      const decodedSvg = stampImageData.startsWith("data:image/svg+xml")
        ? decodeSvgDataUrlToString(stampImageData)
        : undefined;
      stampSourceSvgData = decodedSvg ? stampImageData : undefined;
      let image:
        | Awaited<ReturnType<typeof pdfDoc.embedPng>>
        | Awaited<ReturnType<typeof pdfDoc.embedJpg>>
        | undefined;
      const { bytes, mimeType } = decodeStampImageDataUrl(stampImageData);

      if (mimeType === "image/png") {
        image = await pdfDoc.embedPng(bytes);
      } else if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
        image = await pdfDoc.embedJpg(bytes);
      } else if (mimeType !== "image/svg+xml") {
        const rasterizedBytes = await rasterizeStampImageToPngBytes({
          dataUrl: stampImageData,
          width: stampIntrinsicSize?.width,
          height: stampIntrinsicSize?.height,
        });
        image = await pdfDoc.embedPng(rasterizedBytes);
      }

      const imageName = "Im0";
      const isPlainImageStamp = stampAppearance?.frame === "plain";
      const shouldTreatAsPlainImage =
        isPlainImageStamp || mimeType === "image/svg+xml";
      const shouldDrawCardFrame = !shouldTreatAsPlainImage;
      const normalizedImageBox = stampAppearance?.box;
      const imageRect = normalizedImageBox
        ? {
            x:
              appearanceBounds.x +
              normalizedImageBox.x * appearanceBounds.width,
            y:
              appearanceBounds.y +
              normalizedImageBox.y * appearanceBounds.height,
            width: Math.max(
              1,
              normalizedImageBox.width * appearanceBounds.width,
            ),
            height: Math.max(
              1,
              normalizedImageBox.height * appearanceBounds.height,
            ),
          }
        : shouldTreatAsPlainImage
          ? (() => {
              const fitted = fitStampImageToRect(
                {
                  width: Math.max(1, appearanceBounds.width),
                  height: Math.max(1, appearanceBounds.height),
                },
                stampIntrinsicSize?.width && stampIntrinsicSize?.height
                  ? {
                      width: stampIntrinsicSize.width,
                      height: stampIntrinsicSize.height,
                    }
                  : undefined,
              );
              return {
                x: appearanceBounds.x + fitted.x,
                y: appearanceBounds.y + fitted.y,
                width: fitted.width,
                height: fitted.height,
              };
            })()
          : (() => {
              const inset = Math.max(
                2,
                Math.min(appearanceBounds.width, appearanceBounds.height) *
                  0.03,
              );
              return {
                x: appearanceBounds.x + inset,
                y: appearanceBounds.y + inset,
                width: Math.max(1, appearanceBounds.width - inset * 2),
                height: Math.max(1, appearanceBounds.height - inset * 2),
              };
            })();

      const svgAppearance =
        mimeType === "image/svg+xml" && decodedSvg
          ? await extractScratchPageAppearance({
              pdfDoc,
              page,
              svg: decodedSvg,
              imageRect,
            })
          : undefined;

      if (svgAppearance && svgAppearance.contents.length > 0) {
        const backgroundBytes = !shouldDrawCardFrame
          ? undefined
          : pdfDoc.context
              .contentStream(
                drawRectangle({
                  x: appearanceBounds.x,
                  y: appearanceBounds.y,
                  width: appearanceBounds.width,
                  height: appearanceBounds.height,
                  color: rgb(1, 1, 1),
                  borderColor: rgb(0.83, 0.83, 0.85),
                  borderWidth: 1,
                  rotate: degrees(0),
                  xSkew: degrees(0),
                  ySkew: degrees(0),
                  rx: 4,
                  ry: 4,
                }),
              )
              .getUnencodedContents();
        const svgContentChunks = backgroundBytes
          ? [backgroundBytes, svgAppearance.contents]
          : [svgAppearance.contents];

        appearanceRef = registerRawAppearanceStream(
          pdfDoc,
          concatUint8Arrays(svgContentChunks),
          bbox,
          graphicsStates,
          appearanceMatrix,
          svgAppearance.resources,
        );
      }

      if (!appearanceRef && !image && mimeType === "image/svg+xml") {
        const rasterizedBytes = await rasterizeStampImageToPngBytes({
          dataUrl: stampImageData,
          width: stampIntrinsicSize?.width,
          height: stampIntrinsicSize?.height,
        });
        image = await pdfDoc.embedPng(rasterizedBytes);
      }

      if (!appearanceRef && !image) return undefined;

      if (!appearanceRef && image) {
        operators = [
          ...(shouldDrawCardFrame
            ? drawRectangle({
                x: appearanceBounds.x,
                y: appearanceBounds.y,
                width: appearanceBounds.width,
                height: appearanceBounds.height,
                color: rgb(1, 1, 1),
                borderColor: rgb(0.83, 0.83, 0.85),
                borderWidth: 1,
                rotate: degrees(0),
                xSkew: degrees(0),
                ySkew: degrees(0),
                graphicsState: opacity < 1 ? "GS_STAMP" : undefined,
                rx: 4,
                ry: 4,
              })
            : []),
          ...drawImage(imageName, {
            x: imageRect.x,
            y: imageRect.y,
            width: imageRect.width,
            height: imageRect.height,
            rotate: degrees(0),
            xSkew: degrees(0),
            ySkew: degrees(0),
            graphicsState: opacity < 1 ? "GS_STAMP" : undefined,
          }),
        ];

        extraResources = {
          XObject: {
            [imageName]: image.ref,
          },
        };
      }
    } else {
      const label = resolveStampLabel({
        presetId: stampPresetId,
        label: stampLabel,
      });
      const helveticaBold =
        fontMap?.get("Helvetica-Bold") ??
        (await pdfDoc.embedFont(StandardFonts.HelveticaBold));
      const presetSvgDataUrl = getPresetStampSvgDataUrl({
        presetId: stampPresetId,
        label,
      });
      const presetSvg = decodeSvgDataUrlToString(presetSvgDataUrl);
      if (!presetSvg) return undefined;
      const svgAppearance = await extractScratchPageAppearance({
        pdfDoc,
        page,
        svg: presetSvg,
        imageRect: appearanceBounds,
        fonts: {
          Helvetica_bold: helveticaBold,
          Helvetica: helveticaBold,
        },
      });
      if (!svgAppearance || svgAppearance.contents.length === 0) {
        return undefined;
      }
      appearanceRef = registerRawAppearanceStream(
        pdfDoc,
        svgAppearance.contents,
        bbox,
        graphicsStates,
        appearanceMatrix,
        svgAppearance.resources,
      );
    }

    appearanceRef ??= registerAppearanceStream(
      pdfDoc,
      operators,
      bbox,
      graphicsStates,
      appearanceMatrix,
      extraResources,
    );

    if (!appearanceRef) return undefined;

    const stampAnnot = pdfDoc.context.obj({
      Type: "Annot",
      Subtype: "Stamp",
      F: 4,
      Rect: rectValues,
      Name: PDFName.of(
        stampKind === "preset" ? getStampPdfName(stampPresetId) : "Stamp",
      ),
      AP: { N: appearanceRef },
      CA: opacity,
      P: page.ref,
    });

    if (stampAnnot instanceof PDFDict) {
      applyPdfAnnotationCommentMetadata(stampAnnot, annotation);
      if (
        stampKind === "image" &&
        stampSourceSvgData &&
        stampSourceSvgData.length > 0
      ) {
        stampAnnot.set(
          PDFName.of(PDF_CUSTOM_KEYS.stampSourceSvgData),
          PDFString.of(stampSourceSvgData),
        );
      }
    }

    const ref = pdfDoc.context.register(stampAnnot);
    page.node.addAnnot(ref);
    return ref;
  }
}

export class ShapeExporter implements IAnnotationExporter {
  shouldExport(annotation: Annotation): boolean {
    return annotation.type === "shape";
  }

  save(
    pdfDoc: PDFDocument,
    page: PDFPage,
    annotation: Annotation,
    fontMap?: Map<string, PDFFont>,
    viewport?: ViewportLike,
  ): PDFRef | undefined {
    if (
      annotation.type !== "shape" ||
      !annotation.rect ||
      !annotation.shapeType
    ) {
      return undefined;
    }

    const thickness =
      typeof annotation.thickness === "number" &&
      Number.isFinite(annotation.thickness)
        ? Math.max(0, annotation.thickness)
        : 2;
    const strokeOpacity =
      typeof annotation.opacity === "number"
        ? Math.min(1, Math.max(0, annotation.opacity))
        : 1;
    const fillOpacity =
      typeof annotation.backgroundOpacity === "number"
        ? Math.min(1, Math.max(0, annotation.backgroundOpacity))
        : strokeOpacity;
    const stroke =
      strokeOpacity > 0 && thickness > 0
        ? hexToPdfColor(annotation.color || "#000000") || rgb(0, 0, 0)
        : undefined;
    const arrowStyles = getShapeArrowStyles(annotation);
    const startArrowCustomStyle = arrowStyleNeedsPdfCustomMetadata(
      arrowStyles.start,
    )
      ? arrowStyles.start
      : null;
    const endArrowCustomStyle = arrowStyleNeedsPdfCustomMetadata(
      arrowStyles.end,
    )
      ? arrowStyles.end
      : null;
    const fill =
      fillOpacity > 0 && annotation.backgroundColor
        ? hexToPdfColor(annotation.backgroundColor)
        : undefined;
    const hasStroke = !!stroke && thickness > 0;
    const hasFill = !!fill;
    const rotationDeg =
      typeof annotation.rotationDeg === "number" &&
      Number.isFinite(annotation.rotationDeg)
        ? annotation.rotationDeg
        : 0;
    const shapeBorderStyle =
      normalizeShapeBorderStyle(annotation.borderStyle) ?? "solid";
    const dashDensity = normalizeShapeDashDensity(annotation.dashDensity);
    const borderDashArray = getShapeStrokeDashArrayValues(
      shapeBorderStyle,
      thickness,
      dashDensity,
    );
    const rotationCenterPdf = uiPointToPdfPoint(
      page,
      {
        x: annotation.rect.x + annotation.rect.width / 2,
        y: annotation.rect.y + annotation.rect.height / 2,
      },
      viewport,
    );

    if (!hasStroke && !hasFill) {
      return undefined;
    }

    const strokeGraphicsState =
      hasStroke && strokeOpacity < 1 ? "GS_STROKE" : undefined;
    const fillGraphicsState =
      hasFill && fillOpacity < 1 ? "GS_FILL" : undefined;
    const appearanceGraphicsStates = {
      ...(strokeGraphicsState ? { [strokeGraphicsState]: strokeOpacity } : {}),
      ...(fillGraphicsState ? { [fillGraphicsState]: fillOpacity } : {}),
    };
    const appearanceMatrix =
      rotationDeg !== 0
        ? buildPdfRotationMatrix(-rotationDeg, rotationCenterPdf)
        : undefined;
    const nativeStroke = stroke;
    const nativeBorderWidth = hasStroke ? thickness : 0;

    const buildCommon = (rectValues: number[]) => ({
      Type: "Annot",
      F: 4,
      Rect: rectValues,
      C: nativeStroke
        ? [nativeStroke.red, nativeStroke.green, nativeStroke.blue]
        : undefined,
      CA: hasStroke ? strokeOpacity : hasFill ? fillOpacity : undefined,
      BS: {
        W: nativeBorderWidth,
        S: PDFName.of(shapeBorderStyle === "dashed" ? "D" : "S"),
        D: shapeBorderStyle === "dashed" ? borderDashArray : undefined,
      },
      IC:
        fill &&
        annotation.shapeType !== "arrow" &&
        annotation.shapeType !== "line" &&
        annotation.shapeType !== "polyline"
          ? [fill.red, fill.green, fill.blue]
          : undefined,
      P: page.ref,
    });
    const getRectValues = (rect: [number, number, number, number]) =>
      appearanceMatrix ? getTransformedPdfRect(rect, appearanceMatrix) : rect;

    if (
      annotation.shapeType === "square" ||
      annotation.shapeType === "circle" ||
      annotation.shapeType === "cloud"
    ) {
      const bounds = uiRectToPdfBounds(page, annotation.rect, viewport);
      const appearance = buildShapeAppearanceOperators(
        annotation.shapeType,
        bounds,
        [],
        arrowStyles,
        annotation.arrowSize,
        annotation.cloudIntensity,
        annotation.cloudSpacing,
        stroke,
        fill,
        thickness,
        borderDashArray,
        strokeGraphicsState,
        fillGraphicsState,
      );
      const baseRectValues: [number, number, number, number] = appearance
        ? appearance.bbox
        : [
            bounds.x,
            bounds.y,
            bounds.x + bounds.width,
            bounds.y + bounds.height,
          ];
      const rectValues = getRectValues(baseRectValues);
      const appearanceRef = appearance
        ? registerAppearanceStream(
            pdfDoc,
            appearance.operators,
            appearance.bbox,
            appearanceGraphicsStates,
            appearanceMatrix,
          )
        : undefined;
      const shapeAnnot = pdfDoc.context.obj({
        ...buildCommon(rectValues),
        Subtype: annotation.shapeType === "circle" ? "Circle" : "Square",
        BE:
          annotation.shapeType === "cloud"
            ? {
                S: PDFName.of("C"),
                I:
                  typeof annotation.cloudIntensity === "number"
                    ? annotation.cloudIntensity
                    : 2,
              }
            : undefined,
        RD:
          annotation.shapeType === "cloud"
            ? [
                appearance?.rectInset ?? 0,
                appearance?.rectInset ?? 0,
                appearance?.rectInset ?? 0,
                appearance?.rectInset ?? 0,
              ]
            : undefined,
      });
      if (shapeAnnot instanceof PDFDict && appearanceRef) {
        shapeAnnot.set(
          PDFName.of("AP"),
          pdfDoc.context.obj({ N: appearanceRef }),
        );
      }
      if (shapeAnnot instanceof PDFDict) {
        applyPdfAnnotationCommentMetadata(shapeAnnot, annotation);
      }
      if (
        shapeAnnot instanceof PDFDict &&
        hasFill &&
        typeof fillOpacity === "number"
      ) {
        shapeAnnot.set(
          PDFName.of(PDF_CUSTOM_KEYS.shapeFillOpacity),
          pdfDoc.context.obj(fillOpacity),
        );
      }
      if (
        shapeAnnot instanceof PDFDict &&
        annotation.shapeType === "cloud" &&
        typeof annotation.cloudSpacing === "number" &&
        Number.isFinite(annotation.cloudSpacing)
      ) {
        shapeAnnot.set(
          PDFName.of(PDF_CUSTOM_KEYS.cloudSpacing),
          pdfDoc.context.obj(annotation.cloudSpacing),
        );
      }
      const ref = pdfDoc.context.register(shapeAnnot);
      page.node.addAnnot(ref);
      return ref;
    }

    const absolutePoints = getShapeAbsolutePoints(annotation);
    if (absolutePoints.length < 2) return undefined;
    const pdfPoints = absolutePoints.map((point) =>
      uiPointToPdfPoint(page, point, viewport),
    );
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const point of pdfPoints) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }

    const hasAnyArrow = hasStroke && (!!arrowStyles.start || !!arrowStyles.end);
    const resolvedArrowSize =
      typeof annotation.arrowSize === "number" &&
      Number.isFinite(annotation.arrowSize)
        ? Math.max(6, annotation.arrowSize)
        : getDefaultArrowSize(thickness);
    const linePadding = hasAnyArrow
      ? Math.max(thickness, resolvedArrowSize)
      : hasStroke
        ? thickness
        : 0;
    const paddedRect: [number, number, number, number] = [
      minX - linePadding,
      minY - linePadding,
      maxX + linePadding,
      maxY + linePadding,
    ];
    const appearance = buildShapeAppearanceOperators(
      annotation.shapeType,
      null,
      pdfPoints,
      arrowStyles,
      annotation.arrowSize,
      annotation.cloudIntensity,
      annotation.cloudSpacing,
      stroke,
      fill,
      thickness,
      borderDashArray,
      strokeGraphicsState,
      fillGraphicsState,
    );
    const baseRectValues: [number, number, number, number] = appearance
      ? appearance.bbox
      : paddedRect;
    const rectValues = getRectValues(baseRectValues);
    const appearanceRef = appearance
      ? registerAppearanceStream(
          pdfDoc,
          appearance.operators,
          appearance.bbox,
          appearanceGraphicsStates,
          appearanceMatrix,
        )
      : undefined;

    if (annotation.shapeType === "line" || annotation.shapeType === "arrow") {
      if (pdfPoints.length === 2) {
        const shapeAnnot = pdfDoc.context.obj({
          ...buildCommon(rectValues),
          Subtype: "Line",
          L: [
            pdfPoints[0]!.x,
            pdfPoints[0]!.y,
            pdfPoints[1]!.x,
            pdfPoints[1]!.y,
          ],
          LE: hasAnyArrow
            ? [
                PDFName.of(
                  arrowStyleToPdfLineEndingName(arrowStyles.start) || "None",
                ),
                PDFName.of(
                  arrowStyleToPdfLineEndingName(arrowStyles.end) || "None",
                ),
              ]
            : undefined,
        });
        if (shapeAnnot instanceof PDFDict && appearanceRef) {
          shapeAnnot.set(
            PDFName.of("AP"),
            pdfDoc.context.obj({ N: appearanceRef }),
          );
        }
        if (shapeAnnot instanceof PDFDict) {
          applyPdfAnnotationCommentMetadata(shapeAnnot, annotation);
        }
        if (
          shapeAnnot instanceof PDFDict &&
          hasAnyArrow &&
          typeof annotation.arrowSize === "number" &&
          Number.isFinite(annotation.arrowSize)
        ) {
          shapeAnnot.set(
            PDFName.of(PDF_CUSTOM_KEYS.arrowSize),
            pdfDoc.context.obj(annotation.arrowSize),
          );
        }
        if (shapeAnnot instanceof PDFDict && startArrowCustomStyle) {
          shapeAnnot.set(
            PDFName.of(PDF_CUSTOM_KEYS.startArrowStyle),
            PDFName.of(startArrowCustomStyle),
          );
        }
        if (shapeAnnot instanceof PDFDict && endArrowCustomStyle) {
          shapeAnnot.set(
            PDFName.of(PDF_CUSTOM_KEYS.endArrowStyle),
            PDFName.of(endArrowCustomStyle),
          );
        }
        const ref = pdfDoc.context.register(shapeAnnot);
        page.node.addAnnot(ref);
        return ref;
      }
    }

    const vertices = pdfPoints.flatMap((point) => [point.x, point.y]);
    const isPolygon =
      annotation.shapeType === "polygon" ||
      annotation.shapeType === "cloud_polygon";
    const shapeAnnot = pdfDoc.context.obj({
      ...buildCommon(rectValues),
      Subtype: isPolygon ? "Polygon" : "PolyLine",
      Vertices: vertices,
      IT:
        annotation.shapeType === "cloud_polygon"
          ? PDFName.of("PolygonCloud")
          : undefined,
      BE:
        annotation.shapeType === "cloud_polygon"
          ? {
              S: PDFName.of("C"),
              I:
                typeof annotation.cloudIntensity === "number"
                  ? annotation.cloudIntensity
                  : 2,
            }
          : undefined,
      LE: hasAnyArrow
        ? [
            PDFName.of(
              arrowStyleToPdfLineEndingName(arrowStyles.start) || "None",
            ),
            PDFName.of(
              arrowStyleToPdfLineEndingName(arrowStyles.end) || "None",
            ),
          ]
        : undefined,
    });
    if (shapeAnnot instanceof PDFDict && appearanceRef) {
      shapeAnnot.set(
        PDFName.of("AP"),
        pdfDoc.context.obj({ N: appearanceRef }),
      );
    }
    if (
      shapeAnnot instanceof PDFDict &&
      hasAnyArrow &&
      typeof annotation.arrowSize === "number" &&
      Number.isFinite(annotation.arrowSize)
    ) {
      shapeAnnot.set(
        PDFName.of(PDF_CUSTOM_KEYS.arrowSize),
        pdfDoc.context.obj(annotation.arrowSize),
      );
    }
    if (shapeAnnot instanceof PDFDict && startArrowCustomStyle) {
      shapeAnnot.set(
        PDFName.of(PDF_CUSTOM_KEYS.startArrowStyle),
        PDFName.of(startArrowCustomStyle),
      );
    }
    if (shapeAnnot instanceof PDFDict && endArrowCustomStyle) {
      shapeAnnot.set(
        PDFName.of(PDF_CUSTOM_KEYS.endArrowStyle),
        PDFName.of(endArrowCustomStyle),
      );
    }
    if (
      shapeAnnot instanceof PDFDict &&
      hasFill &&
      typeof fillOpacity === "number"
    ) {
      shapeAnnot.set(
        PDFName.of(PDF_CUSTOM_KEYS.shapeFillOpacity),
        pdfDoc.context.obj(fillOpacity),
      );
    }
    if (
      shapeAnnot instanceof PDFDict &&
      annotation.shapeType === "cloud_polygon" &&
      typeof annotation.cloudSpacing === "number" &&
      Number.isFinite(annotation.cloudSpacing)
    ) {
      shapeAnnot.set(
        PDFName.of(PDF_CUSTOM_KEYS.cloudSpacing),
        pdfDoc.context.obj(annotation.cloudSpacing),
      );
    }
    const ref = pdfDoc.context.register(shapeAnnot);
    page.node.addAnnot(ref);
    return ref;
  }
}

export class InkExporter implements IAnnotationExporter {
  shouldExport(annotation: Annotation): boolean {
    if (annotation.type !== "ink") return false;
    const strokes =
      annotation.strokes && annotation.strokes.length > 0
        ? annotation.strokes
        : annotation.points
          ? [annotation.points]
          : [];
    return strokes.some((s) => s.length > 1);
  }

  save(
    pdfDoc: PDFDocument,
    page: PDFPage,
    annotation: Annotation,
    fontMap?: Map<string, PDFFont>,
    viewport?: ViewportLike,
  ): PDFRef | undefined {
    const { height: _pageHeight } = page.getSize();

    const strokes =
      annotation.strokes && annotation.strokes.length > 0
        ? annotation.strokes
        : annotation.points
          ? [annotation.points]
          : [];

    // 1. Convert points to PDF coordinates (Bottom-Left origin)
    const inkList: number[][] = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    if (strokes.length === 0) return undefined;

    for (const stroke of strokes) {
      const pdfPoints: number[] = [];
      for (const p of stroke) {
        const pt = uiPointToPdfPoint(page, { x: p.x, y: p.y }, viewport);
        const pdfX = pt.x;
        const pdfY = pt.y;

        pdfPoints.push(pdfX);
        pdfPoints.push(pdfY);

        if (pdfX < minX) minX = pdfX;
        if (pdfY < minY) minY = pdfY;
        if (pdfX > maxX) maxX = pdfX;
        if (pdfY > maxY) maxY = pdfY;
      }

      if (pdfPoints.length > 0) {
        inkList.push(pdfPoints);
      }
    }

    if (inkList.length === 0) return undefined;

    // 2. Padding
    const thickness = annotation.thickness || 2;
    const padding = thickness;
    const rect = [
      minX - padding,
      minY - padding,
      maxX + padding,
      maxY + padding,
    ];

    // 3. Color
    const colorObj = annotation.color
      ? hexToPdfColor(annotation.color)
      : undefined;
    const r = colorObj?.red ?? 0;
    const g = colorObj?.green ?? 0;
    const b = colorObj?.blue ?? 0;

    let annotObj;

    if (annotation.subtype === "polyline") {
      const polylinePoints = inkList[0] || [];
      annotObj = pdfDoc.context.obj({
        Type: "Annot",
        Subtype: "PolyLine",
        F: 4,
        Rect: rect,
        Vertices: polylinePoints,
        C:
          typeof r === "number" &&
          typeof g === "number" &&
          typeof b === "number"
            ? [r, g, b]
            : undefined,
        BS: { W: thickness, S: "S" },
        CA:
          typeof annotation.opacity === "number"
            ? annotation.opacity
            : undefined,
        P: page.ref,
      });
    } else if (annotation.subtype === "line") {
      const linePoints = inkList[0] || [];
      const x1 = linePoints[0];
      const y1 = linePoints[1];
      const x2 = linePoints[linePoints.length - 2];
      const y2 = linePoints[linePoints.length - 1];

      annotObj = pdfDoc.context.obj({
        Type: "Annot",
        Subtype: "Line",
        F: 4,
        Rect: rect,
        L: [x1, y1, x2, y2],
        C: [r, g, b],
        BS: { W: thickness, S: "S" },
        CA:
          typeof annotation.opacity === "number"
            ? annotation.opacity
            : undefined,
        P: page.ref,
      });
    } else {
      // Ink
      let appearanceStreamContent = annotation.appearanceStreamContent;

      if (!appearanceStreamContent && inkList.length > 0) {
        const apOps = inkList
          .map((strokeNums) => {
            const apPoints: { x: number; y: number }[] = [];
            for (let i = 0; i < strokeNums.length; i += 2) {
              apPoints.push({ x: strokeNums[i], y: strokeNums[i + 1] });
            }
            return generateInkAppearanceOps(
              apPoints,
              { red: r, green: g, blue: b },
              thickness,
              annotation.intent === "InkHighlight" ? { lineCap: 0 } : undefined,
            );
          })
          .filter(Boolean) as string[];
        appearanceStreamContent =
          apOps.length > 0 ? apOps.join("\n") : undefined;
      }

      let appearanceStream;
      if (appearanceStreamContent) {
        const opacity = annotation.opacity ?? 1;
        const baseResources = {
          ProcSet: [
            PDFName.of("PDF"),
            PDFName.of("Text"),
            PDFName.of("ImageB"),
            PDFName.of("ImageC"),
            PDFName.of("ImageI"),
          ],
        };

        let resourcesObj = pdfDoc.context.obj(baseResources);

        if (opacity < 1) {
          const gsDict = pdfDoc.context.obj({ CA: opacity, ca: opacity });
          const gsRef = pdfDoc.context.register(gsDict);
          resourcesObj = pdfDoc.context.obj({
            ...baseResources,
            ExtGState: {
              GS0: gsRef,
            },
          });

          // Apply opacity to the appearance stream drawing operations.
          appearanceStreamContent = `q\n/GS0 gs\n${appearanceStreamContent}\nQ`;
        }

        const stream = pdfDoc.context.stream(appearanceStreamContent, {
          Type: PDFName.of("XObject"),
          Subtype: PDFName.of("Form"),
          FormType: 1,
          BBox: rect,
          Resources: resourcesObj,
        });
        appearanceStream = pdfDoc.context.register(stream);
      }

      annotObj = pdfDoc.context.obj({
        Type: "Annot",
        Subtype: "Ink",
        F: 4,
        Rect: rect,
        InkList: inkList,
        C: [r, g, b],
        Border: [0, 0, thickness],
        AP: appearanceStream ? { N: appearanceStream } : undefined,
        CA:
          typeof annotation.opacity === "number"
            ? annotation.opacity
            : undefined,
        IT: annotation.intent ? PDFName.of(annotation.intent) : undefined,
        P: page.ref,
      });
    }

    if (annotObj instanceof PDFDict) {
      applyPdfAnnotationCommentMetadata(annotObj, annotation);
    }

    const ref = pdfDoc.context.register(annotObj);
    page.node.addAnnot(ref);
    return ref;
  }
}
