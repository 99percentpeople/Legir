import type { PDFPage, Rect, RenderOptions } from "@legir/pdfium";
import type { ViewportLike } from "../types";
import type { PDFiumModule } from "./pdfium";

function consumeRaster<T>(
  page: PDFPage,
  viewport: ViewportLike,
  bounds: Rect,
  options: RenderOptions,
  consume: (
    pixels: Uint8ClampedArray<ArrayBuffer>,
    width: number,
    height: number,
  ) => T,
): T {
  const pixmap = page.render(viewport.transform, bounds, options);
  try {
    // Borrow only during this synchronous callback. No WASM allocation or await.
    const bytes = pixmap.getPixels();
    const pixels = new Uint8ClampedArray(
      bytes.buffer as ArrayBuffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
    return consume(pixels, pixmap.width, pixmap.height);
  } finally {
    pixmap.destroy();
  }
}
export function rasterizePage(
  _engine: PDFiumModule,
  page: PDFPage,
  viewport: ViewportLike,
  bounds: Rect,
  options: RenderOptions = {},
) {
  return consumeRaster(
    page,
    viewport,
    bounds,
    options,
    (pixels, width, height) => ({ pixels: pixels.slice(), width, height }),
  );
}
export function drawPageToCanvas(
  _engine: PDFiumModule,
  page: PDFPage,
  viewport: ViewportLike,
  bounds: Rect,
  context: Pick<CanvasRenderingContext2D, "putImageData"> & {
    canvas: { width: number; height: number };
  },
  options: RenderOptions = {},
) {
  consumeRaster(page, viewport, bounds, options, (pixels, width, height) => {
    if (context.canvas.width !== width || context.canvas.height !== height) {
      context.canvas.width = width;
      context.canvas.height = height;
    }
    context.putImageData(new ImageData(pixels, width, height), 0, 0);
  });
}
export const disposeNativePage = (page: PDFPage) => page.destroy();
