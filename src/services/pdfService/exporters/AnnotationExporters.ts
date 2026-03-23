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
  type PDFFont,
  type PDFOperator,
  PDFRef,
  drawRectangle,
  drawEllipse,
  drawSvgPath,
} from "@cantoo/pdf-lib";
import { Annotation } from "@/types";
import { PDF_CUSTOM_KEYS } from "@/constants";
import { IAnnotationExporter, ViewportLike } from "../types";
import { setFormForgeHighlightedText } from "../lib/annotationMetadata";
import { hexToPdfColor } from "../lib/colors";
import { generateInkAppearanceOps } from "../lib/ink";
import { containsNonAscii, isSerifFamily } from "../lib/text";
import { uiPointToPdfPoint, uiRectToPdfBounds } from "../lib/coords";
import {
  arrowStyleToPdfLineEndingName,
  getDefaultArrowSize,
  getCloudGeometry,
  getCloudPathData,
  getPolygonCloudGeometry,
  getShapeAbsolutePoints,
  getShapeArrowStyles,
  getLineEndingMarker,
  getShapePointsPathData,
  isClosedShapeType,
  getTrimmedOpenLinePointsForArrows,
} from "@/lib/shapeGeometry";

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
  ): void {
    if (!annotation.rect) return;

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
      T: annotation.author
        ? PDFHexString.fromText(annotation.author)
        : undefined,
      Contents: annotation.text
        ? PDFHexString.fromText(annotation.text)
        : undefined,
      M: annotation.updatedAt
        ? PDFString.fromDate(new Date(annotation.updatedAt))
        : PDFString.fromDate(new Date()),
    });
    if (highlightAnnot instanceof PDFDict) {
      setFormForgeHighlightedText(highlightAnnot, annotation.highlightedText);
    }

    const ref = pdfDoc.context.register(highlightAnnot);
    page.node.addAnnot(ref);
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
  ): void {
    if (!annotation.rect) return;

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
      Contents: annotation.text
        ? PDFHexString.fromText(annotation.text)
        : undefined,
      C: [r, g, bb],
      CA:
        typeof annotation.opacity === "number" ? annotation.opacity : undefined,
      Name: PDFName.of("Comment"),
      P: page.ref,
      T: annotation.author
        ? PDFHexString.fromText(annotation.author)
        : undefined,
      M: annotation.updatedAt
        ? PDFString.fromDate(new Date(annotation.updatedAt))
        : PDFString.fromDate(new Date()),
    });

    const ref = pdfDoc.context.register(commentAnnot);
    page.node.addAnnot(ref);
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
  ): void {
    if (!annotation.rect) return;

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
      Contents: annotation.text
        ? PDFHexString.fromText(annotation.text)
        : undefined,
      T: annotation.author
        ? PDFHexString.fromText(annotation.author)
        : undefined,
      M: annotation.updatedAt
        ? PDFString.fromDate(new Date(annotation.updatedAt))
        : PDFString.fromDate(new Date()),
    });

    const ref = pdfDoc.context.register(linkAnnot);
    page.node.addAnnot(ref);
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
  ): Promise<void> {
    if (!annotation.rect) return;

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

      return;
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
      Contents: PDFHexString.fromText(text),
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
      T: annotation.author
        ? PDFHexString.fromText(annotation.author)
        : undefined,
      M: annotation.updatedAt
        ? PDFString.fromDate(new Date(annotation.updatedAt))
        : PDFString.fromDate(new Date()),
    });

    const ref = pdfDoc.context.register(freeTextAnnot);
    page.node.addAnnot(ref);
  }
}

const registerAppearanceStream = (
  pdfDoc: PDFDocument,
  operators: PDFOperator[],
  bbox: [number, number, number, number],
  opacity?: number,
) => {
  if (operators.length === 0) return undefined;

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
  if (typeof opacity === "number" && opacity < 1) {
    const gsDict = pdfDoc.context.obj({ CA: opacity, ca: opacity });
    const gsRef = pdfDoc.context.register(gsDict);
    resourcesObj = pdfDoc.context.obj({
      ...baseResources,
      ExtGState: {
        GS0: gsRef,
      },
    });
  }

  const appearanceStream = pdfDoc.context.contentStream(operators, {
    Type: PDFName.of("XObject"),
    Subtype: PDFName.of("Form"),
    FormType: 1,
    BBox: bbox,
    Resources: resourcesObj,
  });

  return pdfDoc.context.register(appearanceStream);
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
  graphicsState?: string,
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
      return {
        bbox: baseBBox,
        operators: drawRectangle({
          x: x + strokeWidth / 2,
          y: y + strokeWidth / 2,
          width: Math.max(1, width - strokeWidth),
          height: Math.max(1, height - strokeWidth),
          color: fill,
          rotate: degrees(0),
          xSkew: degrees(0),
          ySkew: degrees(0),
          borderColor: stroke,
          borderWidth: strokeWidth,
          graphicsState,
        }),
      };
    }

    if (shapeType === "circle") {
      return {
        bbox: baseBBox,
        operators: drawEllipse({
          x: x + width / 2,
          y: y + height / 2,
          xScale: Math.max(1, width / 2 - strokeWidth / 2),
          yScale: Math.max(1, height / 2 - strokeWidth / 2),
          color: fill,
          borderColor: stroke,
          borderWidth: strokeWidth,
          graphicsState,
        }),
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

    return {
      bbox,
      operators: drawSvgPath(svgPath, {
        x: bbox[0],
        y: bbox[3],
        scale: 1,
        color: undefined,
        borderColor: stroke,
        borderWidth: strokeWidth,
        graphicsState,
      }),
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

  if (shapeType === "cloud_polygon") {
    if (fill) {
      operators.push(
        ...drawSvgPath(getShapePointsPathData(localPoints, { closed: true }), {
          x: bbox[0],
          y: bbox[3],
          scale: 1,
          color: fill,
          borderColor: undefined,
          borderWidth: 0,
          graphicsState,
        }),
      );
    }
  } else {
    operators.push(
      ...drawSvgPath(
        getShapePointsPathData(trimmedLocalPoints, {
          closed: isClosedShapeType(shapeType),
        }),
        {
          x: bbox[0],
          y: bbox[3],
          scale: 1,
          color: shapeType === "polygon" ? fill : undefined,
          borderColor: stroke,
          borderWidth: strokeWidth,
          borderLineCap: 1,
          graphicsState,
        },
      ),
    );
  }

  if (shapeType === "cloud_polygon" && stroke && strokeWidth > 0) {
    const localCloudGeometry = getPolygonCloudGeometry(localPoints, {
      intensity: cloudIntensity,
      strokeWidth,
      spacing: cloudSpacing,
    });
    operators.push(
      ...drawSvgPath(localCloudGeometry.pathData, {
        x: bbox[0],
        y: bbox[3],
        scale: 1,
        color: undefined,
        borderColor: stroke,
        borderWidth: strokeWidth,
        borderLineCap: 1,
        graphicsState,
      }),
    );
  }

  if (hasAnyArrow) {
    const markers = [
      getLineEndingMarker(
        localPoints,
        "start",
        arrowStyles.start,
        strokeWidth,
        resolvedArrowSize,
      ),
      getLineEndingMarker(
        localPoints,
        "end",
        arrowStyles.end,
        strokeWidth,
        resolvedArrowSize,
      ),
    ];

    for (const marker of markers) {
      if (!marker) continue;
      operators.push(
        ...drawSvgPath(marker.pathData, {
          x: bbox[0],
          y: bbox[3],
          scale: 1,
          color: marker.fillMode === "stroke" ? stroke : undefined,
          borderColor: stroke,
          borderWidth: Math.max(1, strokeWidth * 0.9),
          borderLineCap: 1,
          graphicsState,
        }),
      );
    }
  }

  return { bbox, operators };
};

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
  ): void {
    if (
      annotation.type !== "shape" ||
      !annotation.rect ||
      !annotation.shapeType
    ) {
      return;
    }

    const thickness =
      typeof annotation.thickness === "number" &&
      Number.isFinite(annotation.thickness)
        ? Math.max(0, annotation.thickness)
        : 2;
    const stroke =
      thickness > 0
        ? hexToPdfColor(annotation.color || "#000000") || rgb(0, 0, 0)
        : undefined;
    const arrowStyles = getShapeArrowStyles(annotation);
    const fill = annotation.backgroundColor
      ? hexToPdfColor(annotation.backgroundColor)
      : undefined;
    const hasStroke = !!stroke && thickness > 0;
    const hasFill = !!fill;

    if (!hasStroke && !hasFill) {
      return;
    }

    const opacity =
      typeof annotation.opacity === "number"
        ? Math.min(1, Math.max(0, annotation.opacity))
        : undefined;
    const graphicsState =
      typeof opacity === "number" && opacity < 1 ? "GS0" : undefined;
    const suppressNativeCloudPolygonStroke =
      annotation.shapeType === "cloud_polygon";
    const nativeStroke = suppressNativeCloudPolygonStroke ? undefined : stroke;
    const nativeBorderWidth = suppressNativeCloudPolygonStroke
      ? 0
      : hasStroke
        ? thickness
        : 0;

    const buildCommon = (rectValues: number[]) => ({
      Type: "Annot",
      F: 4,
      Rect: rectValues,
      C: nativeStroke
        ? [nativeStroke.red, nativeStroke.green, nativeStroke.blue]
        : undefined,
      CA: opacity,
      BS: { W: nativeBorderWidth, S: PDFName.of("S") },
      IC:
        fill &&
        annotation.shapeType !== "arrow" &&
        annotation.shapeType !== "line" &&
        annotation.shapeType !== "polyline" &&
        annotation.shapeType !== "cloud"
          ? [fill.red, fill.green, fill.blue]
          : undefined,
      P: page.ref,
      T: annotation.author
        ? PDFHexString.fromText(annotation.author)
        : undefined,
      Contents: annotation.text
        ? PDFHexString.fromText(annotation.text)
        : undefined,
      M: annotation.updatedAt
        ? PDFString.fromDate(new Date(annotation.updatedAt))
        : PDFString.fromDate(new Date()),
    });

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
        graphicsState,
      );
      const rectValues =
        annotation.shapeType === "cloud" && appearance
          ? [...appearance.bbox]
          : [
              bounds.x,
              bounds.y,
              bounds.x + bounds.width,
              bounds.y + bounds.height,
            ];
      const appearanceRef = appearance
        ? registerAppearanceStream(
            pdfDoc,
            appearance.operators,
            appearance.bbox,
            opacity,
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
      return;
    }

    const absolutePoints = getShapeAbsolutePoints(annotation);
    if (absolutePoints.length < 2) return;
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

    const hasAnyArrow = !!arrowStyles.start || !!arrowStyles.end;
    const resolvedArrowSize =
      typeof annotation.arrowSize === "number" &&
      Number.isFinite(annotation.arrowSize)
        ? Math.max(6, annotation.arrowSize)
        : getDefaultArrowSize(thickness);
    const linePadding = hasAnyArrow
      ? Math.max(thickness, resolvedArrowSize)
      : thickness;
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
      graphicsState,
    );
    const appearanceRef = appearance
      ? registerAppearanceStream(
          pdfDoc,
          appearance.operators,
          appearance.bbox,
          opacity,
        )
      : undefined;

    if (annotation.shapeType === "line" || annotation.shapeType === "arrow") {
      if (pdfPoints.length === 2) {
        const shapeAnnot = pdfDoc.context.obj({
          ...buildCommon(paddedRect),
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
        if (shapeAnnot instanceof PDFDict && arrowStyles.start) {
          shapeAnnot.set(
            PDFName.of(PDF_CUSTOM_KEYS.startArrowStyle),
            PDFName.of(arrowStyles.start),
          );
        }
        if (shapeAnnot instanceof PDFDict && arrowStyles.end) {
          shapeAnnot.set(
            PDFName.of(PDF_CUSTOM_KEYS.endArrowStyle),
            PDFName.of(arrowStyles.end),
          );
        }
        const ref = pdfDoc.context.register(shapeAnnot);
        page.node.addAnnot(ref);
        return;
      }
    }

    const vertices = pdfPoints.flatMap((point) => [point.x, point.y]);
    const isPolygon =
      annotation.shapeType === "polygon" ||
      annotation.shapeType === "cloud_polygon";
    const rectValues =
      annotation.shapeType === "cloud_polygon" && appearance
        ? [...appearance.bbox]
        : paddedRect;
    const shapeAnnot = pdfDoc.context.obj({
      ...buildCommon(rectValues),
      Subtype: isPolygon ? "Polygon" : "PolyLine",
      Border: annotation.shapeType === "cloud_polygon" ? [0, 0, 0] : undefined,
      Vertices: vertices,
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
    if (shapeAnnot instanceof PDFDict && arrowStyles.start) {
      shapeAnnot.set(
        PDFName.of(PDF_CUSTOM_KEYS.startArrowStyle),
        PDFName.of(arrowStyles.start),
      );
    }
    if (shapeAnnot instanceof PDFDict && arrowStyles.end) {
      shapeAnnot.set(
        PDFName.of(PDF_CUSTOM_KEYS.endArrowStyle),
        PDFName.of(arrowStyles.end),
      );
    }
    if (
      shapeAnnot instanceof PDFDict &&
      annotation.shapeType === "cloud_polygon"
    ) {
      shapeAnnot.set(
        PDFName.of(PDF_CUSTOM_KEYS.shapeSubType),
        PDFName.of("cloud_polygon"),
      );
    }
    if (
      shapeAnnot instanceof PDFDict &&
      annotation.shapeType === "cloud_polygon" &&
      typeof annotation.cloudIntensity === "number" &&
      Number.isFinite(annotation.cloudIntensity)
    ) {
      shapeAnnot.set(
        PDFName.of(PDF_CUSTOM_KEYS.cloudIntensity),
        pdfDoc.context.obj(annotation.cloudIntensity),
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
    if (
      shapeAnnot instanceof PDFDict &&
      annotation.shapeType === "cloud_polygon" &&
      annotation.color
    ) {
      shapeAnnot.set(
        PDFName.of(PDF_CUSTOM_KEYS.shapeStrokeColor),
        PDFHexString.fromText(annotation.color),
      );
    }
    if (
      shapeAnnot instanceof PDFDict &&
      annotation.shapeType === "cloud_polygon" &&
      typeof annotation.thickness === "number" &&
      Number.isFinite(annotation.thickness)
    ) {
      shapeAnnot.set(
        PDFName.of(PDF_CUSTOM_KEYS.shapeStrokeWidth),
        pdfDoc.context.obj(annotation.thickness),
      );
    }
    const ref = pdfDoc.context.register(shapeAnnot);
    page.node.addAnnot(ref);
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
  ): void {
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

    if (strokes.length === 0) return;

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

    if (inkList.length === 0) return;

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
    const r = colorObj?.red;
    const g = colorObj?.green;
    const b = colorObj?.blue;

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
        T: annotation.author
          ? PDFHexString.fromText(annotation.author)
          : undefined,
        Contents: annotation.text
          ? PDFHexString.fromText(annotation.text)
          : undefined,
        M: annotation.updatedAt
          ? PDFString.fromDate(new Date(annotation.updatedAt))
          : PDFString.fromDate(new Date()),
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
        T: annotation.author
          ? PDFHexString.fromText(annotation.author)
          : undefined,
        Contents: annotation.text
          ? PDFHexString.fromText(annotation.text)
          : undefined,
        M: annotation.updatedAt
          ? PDFString.fromDate(new Date(annotation.updatedAt))
          : PDFString.fromDate(new Date()),
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
        T: annotation.author
          ? PDFHexString.fromText(annotation.author)
          : undefined,
        Contents: annotation.text
          ? PDFHexString.fromText(annotation.text)
          : undefined,
        M: annotation.updatedAt
          ? PDFString.fromDate(new Date(annotation.updatedAt))
          : PDFString.fromDate(new Date()),
      });
    }

    const ref = pdfDoc.context.register(annotObj);
    page.node.addAnnot(ref);
  }
}
