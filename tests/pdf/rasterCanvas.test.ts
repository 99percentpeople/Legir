// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { PDFDocument, degrees, rgb } from "@cantoo/pdf-lib";
import { PDFPixmap } from "@legir/pdfium";
import { getPDFium } from "@/services/pdfService/engine/runtime";
import { getNativePageViewport } from "@/services/pdfService/engine/pageContent";
import {
  disposeNativePage,
  drawPageToCanvas,
  drawPageToCanvasCooperatively,
  rasterizePage,
} from "@/services/pdfService/engine/raster";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("cancels a running native render without painting and can immediately restart", async () => {
  stubImageData();
  const engine = await getPDFium();
  const doc = new engine.PDFDocument();
  doc.insertPage(
    -1,
    doc.addPage(
      [0, 0, 400, 400],
      0,
      {},
      Array.from(
        { length: 18000 },
        (_, i) => `${i % 400} ${Math.floor(i / 400) * 7} 3 6 re f`,
      ).join("\n"),
    ),
  );
  const page = doc.loadPage(0);
  const viewport = getNativePageViewport(page);
  const canvas = { width: 12, height: 15 },
    putImageData = vi.fn();
  let cancelled = false;
  try {
    await expect(
      drawPageToCanvasCooperatively(
        page,
        viewport,
        [0, 0, 400, 400],
        { canvas, putImageData },
        {},
        () => {
          if (cancelled) throw new DOMException("Cancelled", "AbortError");
        },
        async () => {
          cancelled = true;
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(putImageData).not.toHaveBeenCalled();
    expect(canvas).toEqual({ width: 12, height: 15 });
    expect(page.renderTasks.size).toBe(0);
    await drawPageToCanvasCooperatively(
      page,
      viewport,
      [0, 0, 400, 400],
      { canvas, putImageData },
      {},
      () => {},
      async () => {},
    );
    expect(putImageData).toHaveBeenCalledOnce();
    expect(page.renderTasks.size).toBe(0);
    await expect(
      drawPageToCanvasCooperatively(
        page,
        viewport,
        [0, 0, 400, 400],
        {
          canvas,
          putImageData: () => {
            throw Error("Canvas closed");
          },
        },
        {},
        () => {},
        async () => {},
      ),
    ).rejects.toThrow("Canvas closed");
    expect(page.renderTasks.size).toBe(0);
  } finally {
    doc.destroy();
  }
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
  const pdfium = await getPDFium();
  const doc = new pdfium.PDFDocument(await source.save());
  return { pdfium, doc, page: doc.loadPage(0) };
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
  const { pdfium, doc, page } = await fixture();
  const pixels = vi.spyOn(PDFPixmap.prototype, "getPixels");
  const destroy = vi.spyOn(PDFPixmap.prototype, "destroy");
  try {
    const viewport = getNativePageViewport(page, 1.5);
    for (const transparent of [false, true]) {
      const options = { transparent, annotations: true };
      const bounds: [number, number, number, number] = [15, 25, 195, 220];
      const expected = rasterizePage(pdfium, page, viewport, bounds, options);
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
        pdfium,
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
  const { pdfium, doc, page } = await fixture();
  const pixmapDestroy = vi.spyOn(PDFPixmap.prototype, "destroy");
  try {
    const viewport = getNativePageViewport(page);
    const bounds: [number, number, number, number] = [0, 0, 200, 180];
    const canvas = { width: 12, height: 15 };
    vi.spyOn(page, "render").mockImplementationOnce(() => {
      throw new Error("Raster failed");
    });
    expect(() =>
      drawPageToCanvas(pdfium, page, viewport, bounds, {
        canvas,
        putImageData: vi.fn(),
      }),
    ).toThrow("Raster failed");
    expect(canvas).toEqual({ width: 12, height: 15 });
    expect(() =>
      drawPageToCanvas(pdfium, page, viewport, bounds, {
        canvas: { width: 200, height: 180 },
        putImageData: () => {
          throw new Error("Canvas closed");
        },
      }),
    ).toThrow("Canvas closed");
    expect(pixmapDestroy).toHaveBeenCalledTimes(1);
    const putImageData = vi.fn();
    drawPageToCanvas(pdfium, page, viewport, bounds, {
      canvas: { width: 200, height: 180 },
      putImageData,
    });
    expect(putImageData).toHaveBeenCalledOnce();
    expect(pixmapDestroy).toHaveBeenCalledTimes(2);
  } finally {
    disposeNativePage(page);
    doc.destroy();
  }
});
