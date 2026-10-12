import type { DisplayList, DrawDevice, PDFPage, Rect } from "mupdf";
import type { ViewportLike } from "../types";
import type { MuPdfModule } from "./mupdf";

type RasterOptions = {
  list?: DisplayList;
  annotations?: boolean;
  keepAnnotations?: Set<number>;
  transparent?: boolean;
  contents?: boolean;
};

type RasterPixels = {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
};

/** The consumer must finish synchronously: the pixels borrow the live pixmap's
 * WASM memory. No await or further native allocation may occur while reading
 * them, because memory growth can detach the view. Never retain this view. */
function consumeRasterizedPage<T>(
  mupdf: MuPdfModule,
  page: PDFPage,
  viewport: ViewportLike,
  bounds: Rect,
  options: RasterOptions,
  consume: (raster: RasterPixels) => T,
): T {
  // PDF->device includes the inverse native page transform, so crop origins,
  // UserUnit and UI rotation agree for full pages and tiles.
  const matrix = mupdf.Matrix.concat(
    mupdf.Matrix.invert(page.getTransform()),
    viewport.transform,
  );
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, bounds, true);
  let device: DrawDevice | undefined;
  try {
    // clear(0) means opaque black; clear() is the transparent variant.
    if (options.transparent) pixmap.clear();
    else pixmap.clear(255);
    device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap);
    if (options.list) options.list.run(device, matrix);
    else if (options.contents !== false) page.runPageContents(device, matrix);
    if (options.keepAnnotations) {
      for (const annotation of [
        ...page.getAnnotations(),
        ...page.getWidgets(),
      ]) {
        const object = annotation.getObject();
        try {
          if (options.keepAnnotations.has(object.asIndirect()))
            annotation.run(device, matrix);
        } finally {
          object.destroy();
        }
      }
    } else if (options.annotations && !options.list) {
      page.runPageAnnots(device, matrix);
      page.runPageWidgets(device, matrix);
    }
    device.close();
    const width = pixmap.getWidth(),
      height = pixmap.getHeight();
    const pixels = pixmap.getPixels();
    if (options.transparent) {
      // MuPDF stores premultiplied alpha; ImageData expects straight alpha.
      for (let i = 0; i < pixels.length; i += 4) {
        const alpha = pixels[i + 3];
        if (alpha && alpha < 255)
          for (let j = 0; j < 3; j++)
            pixels[i + j] = (pixels[i + j] * 255) / alpha;
      }
    }
    return consume({ pixels, width, height });
  } finally {
    device?.destroy();
    pixmap.destroy();
  }
}

/** Return owned pixels when a caller needs to retain or transfer the result. */
export function rasterizePage(
  mupdf: MuPdfModule,
  page: PDFPage,
  viewport: ViewportLike,
  bounds: Rect,
  options: RasterOptions = {},
) {
  return consumeRasterizedPage(
    mupdf,
    page,
    viewport,
    bounds,
    options,
    ({ pixels, width, height }) => ({
      pixels: new Uint8ClampedArray(pixels),
      width,
      height,
    }),
  );
}

/** Canvas copies synchronously, so it can read the live WASM pixels directly.
 * This avoids an intermediate page-sized JS allocation/copy on every render. */
export function drawPageToCanvas(
  mupdf: MuPdfModule,
  page: PDFPage,
  viewport: ViewportLike,
  bounds: Rect,
  context: Pick<CanvasRenderingContext2D, "putImageData"> & {
    canvas: { width: number; height: number };
  },
  options: RasterOptions = {},
): void {
  consumeRasterizedPage(
    mupdf,
    page,
    viewport,
    bounds,
    options,
    ({ pixels, width, height }) => {
      // Keep the previous canvas intact if rasterization fails.
      if (context.canvas.width !== width || context.canvas.height !== height) {
        context.canvas.width = width;
        context.canvas.height = height;
      }
      // The pinned, single-threaded MuPDF build uses ArrayBuffer. ImageData
      // cannot accept SharedArrayBuffer if a future build enables threads.
      const data =
        pixels.buffer instanceof ArrayBuffer
          ? new Uint8ClampedArray(
              pixels.buffer,
              pixels.byteOffset,
              pixels.byteLength,
            )
          : new Uint8ClampedArray(pixels);
      context.putImageData(new ImageData(data, width, height), 0, 0);
    },
  );
}

export function disposeNativePage(page: PDFPage) {
  // PDFPage memoizes annotation/widget wrappers; their handles need releasing
  // as well as the page handle when evicting an immutable source page.
  for (const annotation of page._annots ?? []) annotation.destroy();
  for (const widget of page._widgets ?? []) widget.destroy();
  page.destroy();
}
