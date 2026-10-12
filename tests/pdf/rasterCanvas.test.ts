// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { PDFDocument, degrees, rgb } from "@cantoo/pdf-lib";
import { getMuPdf } from "@/services/pdfService/engine/runtime";
import { getNativePageViewport } from "@/services/pdfService/engine/pageContent";
import {
  disposeNativePage,
  drawPageToCanvas,
  rasterizePage,
} from "@/services/pdfService/engine/raster";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function fixture() {
  const source = await PDFDocument.create();
  const page = source.addPage([200, 240]);
  page.setCropBox(10, 20, 180, 200);
  page.setRotation(degrees(90));
  page.drawRectangle({
    x: 30,
    y: 80,
    width: 90,
    height: 65,
    color: rgb(1, 0.2, 0),
    opacity: 0.5,
  });
  source.getForm().createTextField("field").addToPage(page, {
    x: 20,
    y: 30,
    width: 100,
    height: 20,
  });
  const mupdf = await getMuPdf();
  const doc = new mupdf.PDFDocument(await source.save());
  return { mupdf, doc, page: doc.loadPage(0) };
}

// Node has no pixel canvas. Keep ImageData's array identity here; browser
// checks separately compare the pixels written by a real OffscreenCanvas.
function stubImageData() {
  vi.stubGlobal(
    "ImageData",
    class {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    },
  );
}

it("writes live WASM pixels synchronously with identical crop, rotation and transparency", async () => {
  stubImageData();
  const { mupdf, doc, page } = await fixture();
  const pixels = vi.spyOn(mupdf.Pixmap.prototype, "getPixels");
  const destroy = vi.spyOn(mupdf.Pixmap.prototype, "destroy");
  try {
    const viewport = getNativePageViewport(page, 1.5);
    for (const transparent of [false, true]) {
      const options = { transparent, annotations: true };
      const bounds: [number, number, number, number] = [15, 25, 195, 220];
      const expected = rasterizePage(mupdf, page, viewport, bounds, options);
      const destroyedBefore = destroy.mock.calls.length;
      let written: Uint8ClampedArray | undefined;
      const canvas = { width: 1, height: 1 };
      const putImageData = vi.fn((image: ImageData, x: number, y: number) => {
        const borrowed = pixels.mock.results.at(-1)!.value as Uint8ClampedArray;
        expect(image.data.buffer).toBe(borrowed.buffer);
        expect(image.data.byteOffset).toBe(borrowed.byteOffset);
        expect(destroy.mock.calls).toHaveLength(destroyedBefore);
        expect([x, y, image.width, image.height]).toEqual([0, 0, 180, 195]);
        expect(canvas).toEqual({ width: 180, height: 195 });
        written = image.data.slice();
      });
      drawPageToCanvas(
        mupdf,
        page,
        viewport,
        bounds,
        { canvas, putImageData },
        options,
      );
      expect(putImageData).toHaveBeenCalledOnce();
      expect(destroy.mock.calls).toHaveLength(destroyedBefore + 1);
      expect(written).toEqual(expected.pixels);
    }
  } finally {
    disposeNativePage(page);
    doc.destroy();
  }
});

it("preserves the old canvas on raster failure and releases resources after failed writes", async () => {
  stubImageData();
  const { mupdf, doc, page } = await fixture();
  const pixmapDestroy = vi.spyOn(mupdf.Pixmap.prototype, "destroy");
  const deviceDestroy = vi.spyOn(mupdf.DrawDevice.prototype, "destroy");
  try {
    const viewport = getNativePageViewport(page);
    const bounds: [number, number, number, number] = [0, 0, 200, 180];
    const canvas = { width: 12, height: 15 };
    vi.spyOn(page, "runPageContents").mockImplementationOnce(() => {
      throw new Error("Raster failed");
    });
    expect(() =>
      drawPageToCanvas(mupdf, page, viewport, bounds, {
        canvas,
        putImageData: vi.fn(),
      }),
    ).toThrow("Raster failed");
    expect(canvas).toEqual({ width: 12, height: 15 });
    expect(() =>
      drawPageToCanvas(mupdf, page, viewport, bounds, {
        canvas: { width: 200, height: 180 },
        putImageData: () => {
          throw new Error("Canvas closed");
        },
      }),
    ).toThrow("Canvas closed");
    expect(pixmapDestroy).toHaveBeenCalledTimes(2);
    expect(deviceDestroy).toHaveBeenCalledTimes(2);
    const putImageData = vi.fn();
    drawPageToCanvas(mupdf, page, viewport, bounds, {
      canvas: { width: 200, height: 180 },
      putImageData,
    });
    expect(putImageData).toHaveBeenCalledOnce();
    expect(pixmapDestroy).toHaveBeenCalledTimes(3);
    expect(deviceDestroy).toHaveBeenCalledTimes(3);
  } finally {
    disposeNativePage(page);
    doc.destroy();
  }
});
