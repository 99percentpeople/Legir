import {
  PDFDocument,
  PDFPage,
  PDFName,
  PDFString,
  PDFHexString,
  PDFDict,
  rgb,
  StandardFonts,
} from "pdf-lib";
import { Annotation } from "@/types";
import { IAnnotationExporter } from "../types";
import { hexToPdfColor, generateInkAppearanceOps } from "@/lib/pdf-helpers";

export class HighlightExporter implements IAnnotationExporter {
  shouldExport(annotation: Annotation): boolean {
    return annotation.type === "highlight";
  }

  save(
    pdfDoc: PDFDocument,
    page: PDFPage,
    annotation: Annotation,
    fontMap?: Map<string, any>,
  ): void {
    if (!annotation.rect) return;

    const { height: pageHeight } = page.getSize();
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
      const llx = r.x;
      const lly = pageHeight - (r.y + r.height);
      const urx = r.x + r.width;
      const ury = pageHeight - r.y;

      // Update global bounding box
      minX = Math.min(minX, llx);
      minY = Math.min(minY, lly);
      maxX = Math.max(maxX, urx);
      maxY = Math.max(maxY, ury);

      // QuadPoints Order: Top-Left, Top-Right, Bottom-Left, Bottom-Right
      // TL
      quadPoints.push(llx);
      quadPoints.push(ury);
      // TR
      quadPoints.push(urx);
      quadPoints.push(ury);
      // BL
      quadPoints.push(llx);
      quadPoints.push(lly);
      // BR
      quadPoints.push(urx);
      quadPoints.push(lly);
    }

    const colorObj = hexToPdfColor(annotation.color) || rgb(1, 1, 0);
    const cr = (colorObj as any).red !== undefined ? (colorObj as any).red : 1;
    const cg =
      (colorObj as any).green !== undefined ? (colorObj as any).green : 1;
    const cb =
      (colorObj as any).blue !== undefined ? (colorObj as any).blue : 0;

    const highlightAnnot = pdfDoc.context.obj({
      Type: "Annot",
      Subtype: "Highlight",
      F: 4, // Print
      Rect: [minX, minY, maxX, maxY],
      QuadPoints: quadPoints,
      C: [cr, cg, cb],
      CA: annotation.opacity ?? 0.4,
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
    fontMap?: Map<string, any>,
  ): void {
    if (!annotation.rect) return;

    const { height: pageHeight } = page.getSize();
    const x = annotation.rect.x;
    const y = pageHeight - annotation.rect.y - annotation.rect.height;
    const w = annotation.rect.width;
    const h = annotation.rect.height;

    const colorObj = hexToPdfColor(annotation.color) || rgb(1, 1, 0);
    const r = (colorObj as any).red !== undefined ? (colorObj as any).red : 1;
    const g =
      (colorObj as any).green !== undefined ? (colorObj as any).green : 1;
    const b = (colorObj as any).blue !== undefined ? (colorObj as any).blue : 0;

    const commentAnnot = pdfDoc.context.obj({
      Type: "Annot",
      Subtype: "Text",
      F: 4, // Print
      Rect: [x, y, x + w, y + h],
      Contents: PDFHexString.fromText(annotation.text || ""),
      C: [r, g, b],
      CA: annotation.opacity,
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
    fontMap?: Map<string, any>,
  ): Promise<void> {
    if (!annotation.rect) return;

    const { height: pageHeight } = page.getSize();
    const x = annotation.rect.x;
    const y = pageHeight - annotation.rect.y - annotation.rect.height;
    const w = annotation.rect.width;
    const h = annotation.rect.height;

    const colorObj = hexToPdfColor(annotation.color) || rgb(0, 0, 0);
    const r = (colorObj as any).red !== undefined ? (colorObj as any).red : 0;
    const g =
      (colorObj as any).green !== undefined ? (colorObj as any).green : 0;
    const b = (colorObj as any).blue !== undefined ? (colorObj as any).blue : 0;

    const fontSize = annotation.size || 12;

    // 1. Embed the font properly
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontRef = font.ref;

    // 2. Prepare text wrapping
    const text = annotation.text || "";
    const paragraphs = text.split(/\r\n|\r|\n/);
    const lines: string[] = [];

    for (const paragraph of paragraphs) {
      const words = paragraph.split(" ");
      let currentLine = "";

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const width = font.widthOfTextAtSize(testLine, fontSize);
        if (width <= w) {
          currentLine = testLine;
        } else {
          if (currentLine) lines.push(currentLine);
          currentLine = word;
        }
      }
      if (currentLine) lines.push(currentLine);
    }

    // 3. Generate Appearance Stream (AP)
    const apResources = pdfDoc.context.obj({
      Font: { Helv: fontRef },
      ProcSet: [PDFName.of("PDF"), PDFName.of("Text")],
    });

    const lineHeight = fontSize * 1.2;
    const startY = h - fontSize; // Start from top

    let appearanceOps = `q ${r} ${g} ${b} rg BT /Helv ${fontSize} Tf ${lineHeight} TL`;

    // Initial position
    appearanceOps += ` 2 ${startY} Td`;

    for (const line of lines) {
      const encodedText = font.encodeText(line);
      appearanceOps += ` ${encodedText} Tj T*`;
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
    (pageFontDict as PDFDict).set(PDFName.of("Helv"), fontRef);

    if (!page.node.Resources()) {
      page.node.set(PDFName.of("Resources"), resources);
    }

    // 5. Create Annotation
    const da = `/Helv ${fontSize} Tf ${r} ${g} ${b} rg`;
    const freeTextAnnot = pdfDoc.context.obj({
      Type: "Annot",
      Subtype: "FreeText",
      F: 4, // Print flag
      Rect: [x, y, x + w, y + h],
      Contents: PDFHexString.fromText(text),
      DA: PDFString.of(da),
      AP: { N: appearanceRef },
      Q: 0, // Left alignment
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
    return (
      annotation.type === "ink" &&
      !!annotation.points &&
      annotation.points.length > 1
    );
  }

  save(
    pdfDoc: PDFDocument,
    page: PDFPage,
    annotation: Annotation,
    fontMap?: Map<string, any>,
  ): void {
    const { height: pageHeight } = page.getSize();

    // 1. Convert points to PDF coordinates (Bottom-Left origin)
    const pdfPoints: number[] = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    if (!annotation.points) return;

    for (const p of annotation.points) {
      const pdfX = p.x;
      const pdfY = pageHeight - p.y;

      pdfPoints.push(pdfX);
      pdfPoints.push(pdfY);

      if (pdfX < minX) minX = pdfX;
      if (pdfY < minY) minY = pdfY;
      if (pdfX > maxX) maxX = pdfX;
      if (pdfY > maxY) maxY = pdfY;
    }

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
    const colorObj = hexToPdfColor(annotation.color) || rgb(1, 0, 0);
    const r = (colorObj as any).red;
    const g = (colorObj as any).green;
    const b = (colorObj as any).blue;

    let annotObj;

    if (annotation.subtype === "polyline") {
      annotObj = pdfDoc.context.obj({
        Type: "Annot",
        Subtype: "PolyLine",
        F: 4,
        Rect: rect,
        Vertices: pdfPoints,
        C: [r, g, b],
        BS: { W: thickness, S: "S" },
        CA: annotation.opacity,
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
      const x1 = pdfPoints[0];
      const y1 = pdfPoints[1];
      const x2 = pdfPoints[pdfPoints.length - 2];
      const y2 = pdfPoints[pdfPoints.length - 1];

      annotObj = pdfDoc.context.obj({
        Type: "Annot",
        Subtype: "Line",
        F: 4,
        Rect: rect,
        L: [x1, y1, x2, y2],
        C: [r, g, b],
        BS: { W: thickness, S: "S" },
        CA: annotation.opacity,
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

      if (
        !appearanceStreamContent &&
        annotation.points &&
        annotation.points.length > 1
      ) {
        const apPoints = annotation.points.map((p) => ({
          x: p.x,
          y: pageHeight - p.y,
        }));
        appearanceStreamContent = generateInkAppearanceOps(
          apPoints,
          { red: r, green: g, blue: b },
          thickness,
        );
      }

      let appearanceStream;
      if (appearanceStreamContent) {
        const stream = pdfDoc.context.stream(appearanceStreamContent, {
          Type: PDFName.of("XObject"),
          Subtype: PDFName.of("Form"),
          FormType: 1,
          BBox: rect,
          Resources: {
            ProcSet: [
              PDFName.of("PDF"),
              PDFName.of("Text"),
              PDFName.of("ImageB"),
              PDFName.of("ImageC"),
              PDFName.of("ImageI"),
            ],
          },
        });
        appearanceStream = pdfDoc.context.register(stream);
      }

      annotObj = pdfDoc.context.obj({
        Type: "Annot",
        Subtype: "Ink",
        F: 4,
        Rect: rect,
        InkList: [pdfPoints],
        C: [r, g, b],
        Border: [0, 0, thickness],
        AP: appearanceStream ? { N: appearanceStream } : undefined,
        CA: annotation.opacity,
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
