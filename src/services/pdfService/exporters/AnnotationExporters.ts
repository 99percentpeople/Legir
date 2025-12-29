import {
  PDFDocument,
  PDFPage,
  rgb,
  PDFName,
  PDFString,
  PDFHexString,
  StandardFonts,
  PDFDict,
  type PDFFont,
  PDFRef,
} from "pdf-lib";
import type * as pdfjsLib from "pdfjs-dist";
import { Annotation } from "@/types";
import { IAnnotationExporter } from "../types";
import { hexToPdfColor } from "../lib/colors";
import { generateInkAppearanceOps } from "../lib/ink";
import { containsNonAscii, isSerifFamily } from "../lib/text";
import { uiPointToPdfPoint, uiRectToPdfBounds } from "../lib/coords";

export class HighlightExporter implements IAnnotationExporter {
  shouldExport(annotation: Annotation): boolean {
    return annotation.type === "highlight";
  }

  save(
    pdfDoc: PDFDocument,
    page: PDFPage,
    annotation: Annotation,
    fontMap?: Map<string, PDFFont>,
    viewport?: pdfjsLib.PageViewport,
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
    viewport?: pdfjsLib.PageViewport,
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

export class FreeTextExporter implements IAnnotationExporter {
  shouldExport(annotation: Annotation): boolean {
    return annotation.type === "freetext";
  }

  async save(
    pdfDoc: PDFDocument,
    page: PDFPage,
    annotation: Annotation,
    fontMap?: Map<string, PDFFont>,
    viewport?: pdfjsLib.PageViewport,
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
    const userExplicitCustom =
      annotation.fontFamily === "Custom" ||
      annotation.fontFamily === "CustomSans" ||
      annotation.fontFamily === "CustomSerif" ||
      annotation.fontFamily === "Noto Sans SC" ||
      annotation.fontFamily === "Source Han Serif SC" ||
      (customFont && userSelectedFont && userSelectedFont === customFont);

    // Base (ASCII) font selection
    let baseFont: PDFFont | undefined;
    let baseResourceName: string;
    if (userExplicitCustom && customFont) {
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

    // If the user explicitly chose the custom font, apply it to all text.
    // Otherwise, only apply custom to non-ASCII runs.
    const useMixedFonts = !!customFont && hasNonAscii && !userExplicitCustom;
    const cjkFont = useMixedFonts ? customFont : undefined;
    const cjkResourceName = cjkFont ? "Cust" : undefined;

    const baseFontRef = baseFont.ref;
    const cjkFontRef = cjkFont?.ref;

    // 2. Prepare text wrapping
    const paragraphs = text.split(/\r\n|\r|\n/);
    const lines: string[] = [];
    const availableWidth = Math.max(0, w - 4);

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

    // 3. Generate Appearance Stream (AP)
    const apFontResources: Record<string, PDFRef> = {
      [baseResourceName]: baseFontRef,
    };
    if (useMixedFonts && cjkFontRef && cjkResourceName) {
      apFontResources[cjkResourceName] = cjkFontRef;
    }

    const apResources = pdfDoc.context.obj({
      Font: apFontResources,
      ProcSet: [PDFName.of("PDF"), PDFName.of("Text")],
    });

    const lineHeight = fontSize * 1.2;
    const startY = h - fontSize; // Start from top

    let appearanceOps = `q ${r} ${g} ${bb} rg BT /${baseResourceName} ${fontSize} Tf ${lineHeight} TL`;

    // Initial position
    appearanceOps += ` 2 ${startY} Td`;

    let currentResource = baseResourceName;

    const encodeRun = (f: PDFFont, run: string) => {
      try {
        return f.encodeText(run);
      } catch {
        const sanitized = run.replace(/[^\x00-\x7F]/g, "?");
        return f.encodeText(sanitized);
      }
    };

    for (const line of lines) {
      if (!useMixedFonts || !cjkFont || !cjkResourceName) {
        const encoded = encodeRun(
          userExplicitCustom && customFont ? customFont : baseFont,
          line,
        );
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
      BBox: [0, 0, w, h],
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
    const da = `/${baseResourceName} ${fontSize} Tf ${r} ${g} ${bb} rg`;
    const q =
      annotation.alignment === "center"
        ? 1
        : annotation.alignment === "right"
          ? 2
          : 0;
    const freeTextAnnot = pdfDoc.context.obj({
      Type: "Annot",
      Subtype: "FreeText",
      F: 4, // Print flag
      Rect: [x, y, x + w, y + h],
      Contents: PDFHexString.fromText(text),
      DA: PDFString.of(da),
      AP: { N: appearanceRef },
      Q: q,
      BS: { W: 0 },
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
    viewport?: pdfjsLib.PageViewport,
  ): void {
    const { height: pageHeight } = page.getSize();

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
