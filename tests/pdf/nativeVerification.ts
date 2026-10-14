/** Native round-trip checks. The benchmark additionally uses Poppler and qpdf
 * as independent readers; this helper never creates a second app session. */
import { getPDFium } from "@/services/pdfService/engine/runtime";
import type { PDFPage } from "@legir/pdfium";

async function withPage<T>(
  bytes: Uint8Array,
  pageIndex: number,
  password: string | undefined,
  run: (page: PDFPage) => T,
) {
  const engine = await getPDFium();
  const document = new engine.PDFDocument(bytes);
  try {
    if (
      document.needsPassword() &&
      !document.authenticatePassword(password ?? "")
    )
      throw new Error("Invalid PDF password");
    const page = document.loadPage(pageIndex);
    try {
      return run(page);
    } finally {
      page.destroy();
    }
  } finally {
    document.destroy();
  }
}

export function readPageText(
  bytes: Uint8Array,
  pageIndex = 0,
  password?: string,
) {
  return withPage(bytes, pageIndex, password, (page) =>
    page.extractText().lines.map((line) => {
      const glyph = line.glyphs[0];
      const height = glyph?.fontSize ?? 0;
      return {
        str: line.glyphs.map((g) => g.text).join(""),
        height,
        transform: [height, 0, 0, height, ...(glyph?.origin ?? [0, 0])],
      };
    }),
  );
}

export function renderPageBody(bytes: Uint8Array, pageIndex = 0) {
  return withPage(bytes, pageIndex, undefined, (page) => {
    const pixmap = page.toPixmap([1, 0, 0, 1, 0, 0], undefined, false, false);
    try {
      const pixels = pixmap.getPixels();
      let coloredPixels = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] < 250 || pixels[i + 1] < 250 || pixels[i + 2] < 250)
          coloredPixels++;
      return { width: pixmap.width, height: pixmap.height, coloredPixels };
    } finally {
      pixmap.destroy();
    }
  });
}
