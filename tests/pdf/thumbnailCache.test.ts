import { expect, it, vi } from "vitest";
import { ThumbnailRasterCache } from "@/services/pdfService/engine/thumbnailCache";

function surface(width = 100, height = 100) {
  const bitmap = { width, height, close: vi.fn() };
  const context = { drawImage: vi.fn() };
  const canvas = {
    width,
    height,
    transferToImageBitmap: vi.fn(() => bitmap),
    getContext: () => context,
  } as unknown as OffscreenCanvas;
  return {
    bitmap,
    context: context as unknown as OffscreenCanvasRenderingContext2D,
    canvas,
  };
}

it("keeps only bounded materialized bodies, preserves reader-owned resources and closes evicted images", () => {
  const cache = new ThumbnailRasterCache(80_000);
  const a = surface(),
    b = surface(),
    c = surface();
  cache.remember("a", a.canvas);
  cache.remember("b", b.canvas);
  expect(cache.draw("a", c.context)).toBe(true);
  expect(c.context.drawImage).toHaveBeenCalledWith(a.bitmap, 0, 0);
  cache.remember("c", c.canvas);
  expect(b.bitmap.close).toHaveBeenCalledOnce();
  expect(a.bitmap.close).not.toHaveBeenCalled();
  expect(cache.draw("b", c.context)).toBe(false);
  expect(cache.stats()).toEqual({
    bytes: 80_000,
    limit: 80_000,
    entries: 2,
    hits: 1,
  });
  cache.clear();
  cache.clear();
  expect(a.bitmap.close).toHaveBeenCalledOnce();
  expect(c.bitmap.close).toHaveBeenCalledOnce();
  expect(cache.stats().bytes).toBe(0);
  expect(cache.draw("a", c.context)).toBe(false);
});

it("does not capture oversized output or replace an existing body, and restores a captured canvas", () => {
  const cache = new ThumbnailRasterCache(40_000);
  const a = surface(),
    duplicate = surface(),
    oversized = surface(101, 100);
  cache.remember("a", a.canvas);
  expect(a.context.drawImage).toHaveBeenCalledWith(a.bitmap, 0, 0);
  cache.remember("a", duplicate.canvas);
  cache.remember("oversized", oversized.canvas);
  expect(duplicate.canvas.transferToImageBitmap).not.toHaveBeenCalled();
  expect(oversized.canvas.transferToImageBitmap).not.toHaveBeenCalled();
  expect(cache.stats().bytes).toBe(40_000);
  cache.clear();
});

it("releases a detached bitmap when the canvas cannot be restored", () => {
  const cache = new ThumbnailRasterCache();
  const a = surface();
  vi.mocked(a.context.drawImage).mockImplementation(() => {
    throw Error("lost context");
  });
  expect(() => cache.remember("a", a.canvas)).toThrow("lost context");
  expect(a.bitmap.close).toHaveBeenCalledOnce();
  expect(cache.stats().bytes).toBe(0);
});
