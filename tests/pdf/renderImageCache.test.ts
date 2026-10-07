import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PdfRenderImageCache } from "@/services/pdfService/lib/renderImageCache";

class Frame {
  close = vi.fn();
  constructor(
    public displayWidth = 2000,
    public displayHeight = 2000,
  ) {}
}

const bitmap = () => ({ close: vi.fn() });
const createBitmap = vi.fn<
  (source: Frame) => Promise<ReturnType<typeof bitmap>>
>(async () => bitmap());
const objects = (frame: Frame) => new Map([["image", { bitmap: frame }]]);

beforeEach(() => {
  vi.stubGlobal("VideoFrame", Frame);
  vi.stubGlobal("createImageBitmap", createBitmap);
  createBitmap.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

it("reuses a full-resolution bitmap across tiles and restores PDF.js ownership", async () => {
  const cache = new PdfRenderImageCache();
  const source = new Frame();
  const page = objects(source);
  const restore = await cache.prepare(page);
  const converted = page.get("image")!.bitmap;
  expect(converted).not.toBe(source);
  restore();
  expect(page.get("image")!.bitmap).toBe(source);
  const restoreNext = await cache.prepare(page);
  expect(page.get("image")!.bitmap).toBe(converted);
  expect(createBitmap).toHaveBeenCalledExactlyOnceWith(source);
  restoreNext();
  cache.clear();
  expect(converted.close).toHaveBeenCalledOnce();
  expect(source.close).not.toHaveBeenCalled();
});

it("evicts old page bitmaps within the pixel budget", async () => {
  const cache = new PdfRenderImageCache(4_000_000);
  const first = objects(new Frame());
  const second = objects(new Frame());
  const restore = await cache.prepare(first);
  const firstBitmap = first.get("image")!.bitmap;
  restore();
  (await cache.prepare(second))();
  expect(firstBitmap.close).toHaveBeenCalledOnce();
  (await cache.prepare(first))();
  expect(createBitmap).toHaveBeenCalledTimes(3);
  cache.clear();
});

it("keeps active page images valid when all images cannot fit in the budget", async () => {
  const cache = new PdfRenderImageCache(4_000_000);
  const first = new Frame();
  const second = new Frame();
  const page = new Map([
    ["one", { bitmap: first }],
    ["two", { bitmap: second }],
  ]);
  const restore = await cache.prepare(page);
  expect(page.get("one")!.bitmap).not.toBe(first);
  expect(page.get("one")!.bitmap.close).not.toHaveBeenCalled();
  expect(page.get("two")!.bitmap).toBe(second);
  restore();
  cache.clear();
});

it("restores original frames before document disposal closes cached bitmaps", async () => {
  const cache = new PdfRenderImageCache();
  const source = new Frame();
  const page = objects(source);
  const restore = await cache.prepare(page);
  const converted = page.get("image")!.bitmap;
  cache.clear();
  expect(page.get("image")!.bitmap).toBe(source);
  expect(converted.close).toHaveBeenCalledOnce();
  restore();
  expect(source.close).not.toHaveBeenCalled();
});

it("discards a conversion that finishes after its document was unloaded", async () => {
  const cache = new PdfRenderImageCache();
  const source = new Frame();
  const page = objects(source);
  const converted = bitmap();
  let finish!: (image: ReturnType<typeof bitmap>) => void;
  createBitmap.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = cache.prepare(page);
  cache.clear();
  finish(converted);
  (await pending)();
  expect(converted.close).toHaveBeenCalledOnce();
  expect(page.get("image")!.bitmap).toBe(source);
});

it("falls back for small, over-budget, unsupported, and failed image conversions", async () => {
  const cache = new PdfRenderImageCache(4_000_000);
  (await cache.prepare(objects(new Frame(100, 100))))();
  (await cache.prepare(objects(new Frame(3000, 3000))))();
  expect(createBitmap).not.toHaveBeenCalled();
  const source = new Frame();
  const page = objects(source);
  createBitmap.mockRejectedValueOnce(new Error("Unsupported frame"));
  (await cache.prepare(page))();
  expect(page.get("image")!.bitmap).toBe(source);
  vi.stubGlobal("VideoFrame", undefined);
  (await cache.prepare(page))();
  expect(createBitmap).toHaveBeenCalledOnce();
});
