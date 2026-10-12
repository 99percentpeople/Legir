import type { PDFDocument, PDFPage, PDFObject, Rect } from "@legir/pdfium";
import type { PDFDocumentPermissions, PDFOutlineItem } from "@/types";
import { UNRESTRICTED_PDF_PERMISSIONS } from "@/lib/pdfPermissions";
import { createViewportFromPageInfo } from "../lib/coords";
import { extractPageText, type PDFiumModule } from "./pdfium";
import type { TextContent, TextItem } from "./textTypes";

const readBox = (object: PDFObject): Rect | undefined => {
  if (!object.isArray() || object.length !== 4) return;
  const values: number[] = [];
  object.forEach((item) => {
    try {
      values.push(item.asNumber());
    } finally {
      item.destroy();
    }
  });
  if (values.every(Number.isFinite)) return values as Rect;
};

export function getNativePageViewport(
  page: PDFPage,
  scale = 1,
  rotation?: number,
) {
  const object = page.getObject();
  try {
    return getNativePageObjectViewport(object, scale, rotation);
  } finally {
    object.destroy();
  }
}

/** Geometry only: do not load/parse a page's drawing operators for inspection. */
export function getNativePageObjectViewport(
  object: PDFObject,
  scale = 1,
  rotation?: number,
) {
  const crop = object.getInheritable("CropBox");
  const media = object.getInheritable("MediaBox");
  const unit = object.getInheritable("UserUnit");
  const rotate = object.getInheritable("Rotate");
  try {
    const mediaBox = readBox(media) ?? [0, 0, 612, 792];
    const cropBox = readBox(crop) ?? mediaBox;
    const viewBox: Rect = [
      Math.max(mediaBox[0], cropBox[0]),
      Math.max(mediaBox[1], cropBox[1]),
      Math.min(mediaBox[2], cropBox[2]),
      Math.min(mediaBox[3], cropBox[3]),
    ];
    return createViewportFromPageInfo(
      {
        viewBox:
          viewBox[2] > viewBox[0] && viewBox[3] > viewBox[1]
            ? viewBox
            : mediaBox,
        userUnit: unit.isNumber() && unit.asNumber() > 0 ? unit.asNumber() : 1,
        rotation: rotate.isNumber() ? rotate.asNumber() : 0,
      },
      { scale, rotation },
    );
  } finally {
    crop.destroy();
    media.destroy();
    unit.destroy();
    rotate.destroy();
  }
}

export function getNativeTextContent(
  pdfium: PDFiumModule,
  page: PDFPage,
  pageIndex: number,
): TextContent {
  const text = extractPageText(pdfium, page, pageIndex);
  const content: TextContent = {
    items: [],
    styles: {},
    lang: page.document.getLanguage() ?? null,
  };
  for (const line of text.lines) {
    let run: TextItem | undefined;
    let direction: [number, number] = [1, 0];
    for (const glyph of line.glyphs) {
      const q = glyph.quad;
      const dx = line.writingMode ? q[4] - q[0] : q[2] - q[0];
      const dy = line.writingMode ? q[5] - q[1] : q[3] - q[1];
      const length = Math.hypot(dx, dy);
      const dir: [number, number] =
        length > 0 ? [dx / length, dy / length] : direction;
      const size = glyph.fontSize || 1;
      const ascent =
        ((q[0] - glyph.origin[0]) * -dir[1] +
          (q[1] - glyph.origin[1]) * dir[0]) /
        size;
      const fontName = `${glyph.fontName}:${line.writingMode}:${ascent.toFixed(3)}`;
      const fontFamily = /courier|mono/i.test(glyph.fontName)
        ? "monospace"
        : /times|serif|ming|song/i.test(glyph.fontName)
          ? "serif"
          : "sans-serif";
      content.styles[fontName] ??= {
        fontFamily,
        ascent: Number.isFinite(ascent) ? ascent : 0.8,
        descent: -0.2,
        vertical: !!line.writingMode,
      };
      // Split at words/fonts/direction changes so search highlights remain
      // aligned even with non-uniform spacing or mixed fonts on one line.
      const canAppend =
        run &&
        run.fontName === fontName &&
        Math.abs(run.height - size) < 0.01 &&
        Math.abs(dir[0] - direction[0]) + Math.abs(dir[1] - direction[1]) <
          0.001 &&
        !/\s$/.test(run.str);
      if (!canAppend) {
        direction = dir;
        const xAxis = line.writingMode ? [-dir[1], dir[0]] : dir;
        run = {
          str: "",
          dir: line.writingMode
            ? "ttb"
            : /[\u0590-\u08ff]/.test(glyph.text)
              ? "rtl"
              : "ltr",
          transform: [
            xAxis[0] * size,
            xAxis[1] * size,
            -xAxis[1] * size,
            xAxis[0] * size,
            ...glyph.origin,
          ],
          width: 0,
          height: size,
          fontName,
          hasEOL: false,
        };
        content.items.push(run);
      }
      run!.str += glyph.text;
      const end = line.writingMode ? [q[4], q[5]] : [q[2], q[3]];
      const advance =
        (end[0] - run!.transform[4]) * dir[0] +
        (end[1] - run!.transform[5]) * dir[1];
      if (line.writingMode) run!.height = Math.max(0, advance);
      else run!.width = Math.max(0, advance);
    }
    if (run) run.hasEOL = true;
  }
  return content;
}

export function getNativePermissions(doc: PDFDocument): PDFDocumentPermissions {
  const trailer = doc.getTrailer(),
    encrypt = trailer.get("Encrypt"),
    p = encrypt.isNull() ? undefined : encrypt.get("P");
  try {
    if (encrypt.isNull()) return { ...UNRESTRICTED_PDF_PERMISSIONS };
    const bits = p?.asNumber() ?? 0;
    const has = (bit: number) => !!(bits & bit);
    const permissions: PDFDocumentPermissions = {
      isEncrypted: true,
      canOpen: true,
      canPrint: has(4) || has(2048),
      canModifyContents: has(8),
      canCopy: has(16),
      canModifyAnnotations: has(32),
      canFillForms: has(256),
      canCopyForAccessibility: has(512),
      canAssemble: has(1024),
      canPrintHighQuality: has(2048),
      hasOwnerRestrictions: false,
      rawFlags: [4, 8, 16, 32, 256, 512, 1024, 2048].filter(has),
    };
    permissions.hasOwnerRestrictions = [
      permissions.canPrint,
      permissions.canModifyContents,
      permissions.canCopy,
      permissions.canModifyAnnotations,
      permissions.canFillForms,
      permissions.canCopyForAccessibility,
      permissions.canAssemble,
    ].some((value) => !value);
    return permissions;
  } finally {
    p?.destroy();
    encrypt.destroy();
    trailer.destroy();
  }
}

export function getNativeOutline(doc: PDFDocument): PDFOutlineItem[] {
  const map = (
    items: NonNullable<ReturnType<PDFDocument["loadOutline"]>>,
  ): PDFOutlineItem[] =>
    items.map((item) => ({
      title: item.title ?? "",
      items: map(item.down ?? []),
      pageIndex:
        typeof item.page === "number" && item.page >= 0
          ? item.page
          : item.uri?.startsWith("#")
            ? doc.resolveLink(item.uri)
            : undefined,
    }));
  return map(doc.loadOutline() ?? []);
}

export function resolveNativeDestination(
  doc: PDFDocument,
  dest: unknown,
): number | null {
  if (typeof dest === "string") {
    const page = doc.resolveLink(
      dest.startsWith("#") ? dest : `#nameddest=${encodeURIComponent(dest)}`,
    );
    return page >= 0 && page < doc.countPages() ? page : null;
  }
  if (!Array.isArray(dest)) return null;
  const target = dest[0];
  if (typeof target === "number")
    return target >= 0 && target < doc.countPages() ? target : null;
  if (target && typeof target === "object" && "num" in target) {
    for (let index = 0; index < doc.countPages(); index++) {
      const page = doc.findPage(index);
      try {
        if (page.asIndirect() === target.num) return index;
      } finally {
        page.destroy();
      }
    }
  }
  return null;
}
