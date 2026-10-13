import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ScanCanvasRenderer } from "../src/scan.js";
import type { PDFPage } from "../src/page.js";

const { plan } = vi.hoisted(() => ({ plan: vi.fn() }));
vi.mock("../src/canvas.js", () => ({ createCanvasPlan: plan }));
const bitmaps: {
  width: number;
  height: number;
  close: ReturnType<typeof vi.fn>;
}[] = [];
const surfaces: Surface[] = [];
class Surface {
  context = {
    canvas: this,
    isContextLost: () => false,
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  };
  constructor(
    public width: number,
    public height: number,
  ) {
    surfaces.push(this);
  }
  getContext() {
    return this.context;
  }
}
const page = {} as PDFPage;
const matrix: [number, number, number, number, number, number] = [
  1, 0, 0, -1, 0, 512,
];
const options = (key = "page") => ({
  key,
  annotations: false,
  checkpoint: () => {},
  yieldTask: async () => {},
});
const target = () => new OffscreenCanvas(17, 19).getContext("2d")!;
beforeEach(() => {
  bitmaps.length = surfaces.length = 0;
  plan.mockReset().mockImplementation(() => ({
    commands: new Float64Array([2, 1024, 0, 0, 512, 0, 0, 0, 1024, 512, 0]),
    images: [new Uint8Array(100)],
    box: [0, 0, 1024, 512],
  }));
  vi.stubGlobal("OffscreenCanvas", Surface);
  vi.stubGlobal(
    "ImageDecoder",
    class {
      async decode() {
        const bitmap = await createImageBitmap(new Blob());
        return {
          image: Object.assign(bitmap, {
            displayWidth: bitmap.width,
            displayHeight: bitmap.height,
            allocationSize: () => bitmap.width * bitmap.height * 4,
          }),
        };
      }
      close() {}
    },
  );
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => {
      const bitmap = { width: 1024, height: 512, close: vi.fn() };
      bitmaps.push(bitmap);
      return bitmap;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

it("reuses decode, pyramid and tile resources, and releases every resource on clear", async () => {
  const memory: number[] = [];
  const cache = new ScanCanvasRenderer({
    byteLimit: 4 * 1024 * 1024,
    workLimit: 8 * 1024 * 1024,
    onMemoryChange: (bytes) => memory.push(bytes),
  });
  const ctx = target();
  expect(
    await cache.render(page, ctx, matrix, [0, 0, 512, 512], options()),
  ).toBe(true);
  expect(
    await cache.render(page, ctx, matrix, [0, 0, 512, 512], options()),
  ).toBe(true);
  expect(cache.stats()).toMatchObject({ decodes: 1, renders: 2, tileHits: 1 });
  expect(plan).toHaveBeenCalledOnce();
  expect(cache.stats().bytes).toBeLessThanOrEqual(cache.stats().limit);
  expect(Math.max(...memory)).toBeLessThanOrEqual(cache.stats().workLimit);
  cache.clear();
  expect(cache.stats()).toMatchObject({ bytes: 0, reservedBytes: 0, pages: 0 });
  expect(bitmaps.every((bitmap) => bitmap.close.mock.calls.length === 1)).toBe(
    true,
  );
  expect(
    surfaces
      .filter((surface) => surface !== ctx.canvas)
      .every((surface) => surface.width === 0),
  ).toBe(true);
});

it("bounds retained cache storage while visiting pages and decodes again after invalidation", async () => {
  const cache = new ScanCanvasRenderer({
    byteLimit: 1024 * 1024,
    workLimit: 5 * 1024 * 1024,
  });
  const ctx = target();
  const small: typeof matrix = [0.125, 0, 0, -0.125, 0, 64];
  for (let i = 0; i < 8; i++) {
    expect(
      await cache.render(
        page,
        ctx,
        small,
        [0, 0, 128, 64],
        options(`page-${i}`),
      ),
    ).toBe(true);
    expect(cache.stats().bytes).toBeLessThanOrEqual(1024 * 1024);
  }
  expect(cache.stats().evictions).toBeGreaterThan(0);
  cache.clear();
  expect(
    await cache.render(page, ctx, small, [0, 0, 128, 64], options("page-7")),
  ).toBe(true);
  expect(cache.stats().decodes).toBe(9);
  cache.clear();
});

it("does not publish a cancelled or invalidated asynchronous decode", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(createImageBitmap).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as Promise<ImageBitmap>,
  );
  const cache = new ScanCanvasRenderer(),
    ctx = target();
  const pending = cache.render(page, ctx, matrix, [0, 0, 512, 512], options());
  cache.clear();
  const bitmap = { width: 1024, height: 512, close: vi.fn() };
  finish(bitmap);
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(bitmap.close).toHaveBeenCalledOnce();
  expect(ctx.drawImage).not.toHaveBeenCalled();
  expect([ctx.canvas.width, ctx.canvas.height]).toEqual([17, 19]);
  expect(cache.stats()).toMatchObject({ bytes: 0, reservedBytes: 0 });
});

it("propagates scheduler preemption and preserves the previously painted destination", async () => {
  const cache = new ScanCanvasRenderer(),
    ctx = target();
  const preemption = new Error("preempted");
  await expect(
    cache.render(page, ctx, matrix, [0, 0, 512, 512], {
      ...options(),
      yieldTask: async () => {
        throw preemption;
      },
    }),
  ).rejects.toBe(preemption);
  expect(ctx.drawImage).not.toHaveBeenCalled();
  expect([ctx.canvas.width, ctx.canvas.height]).toEqual([17, 19]);
  cache.clear();
  expect(cache.stats().bytes).toBe(0);
});

it("falls back without painting for decode failure, unsupported content or requested annotations", async () => {
  const cache = new ScanCanvasRenderer(),
    ctx = target();
  expect(
    await cache.render(page, ctx, matrix, [0, 0, 512, 512], {
      ...options(),
      annotations: true,
    }),
  ).toBe(false);
  expect(plan).not.toHaveBeenCalled();
  expect(
    await cache.render(page, ctx, matrix, [0, 0, 512, 512], {
      ...options(),
      annotations: undefined,
    }),
  ).toBe(false);
  expect(plan).not.toHaveBeenCalled();
  expect(
    await cache.render(page, ctx, matrix, [0, 0, 512, 512], {
      ...options(),
      populate: false,
    }),
  ).toBe(false);
  expect(createImageBitmap).not.toHaveBeenCalled();
  vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error("bad JPEG"));
  expect(
    await cache.render(page, ctx, matrix, [0, 0, 512, 512], options()),
  ).toBe(false);
  expect(cache.stats().bytes).toBe(0);
  plan.mockReturnValue(null);
  expect(
    await cache.render(page, ctx, matrix, [0, 0, 512, 512], options()),
  ).toBe(false);
  expect(ctx.drawImage).not.toHaveBeenCalled();
  expect([ctx.canvas.width, ctx.canvas.height]).toEqual([17, 19]);
});

it("reuses foreground levels for a preview without a new JPEG decode or output tile", async () => {
  const cache = new ScanCanvasRenderer(),
    ctx = target();
  await cache.render(page, ctx, matrix, [0, 0, 512, 512], options());
  const before = cache.stats();
  expect(
    await cache.render(
      page,
      ctx,
      [0.125, 0, 0, -0.125, 0, 64],
      [0, 0, 128, 64],
      {
        ...options(),
        populate: false,
      },
    ),
  ).toBe(true);
  expect(cache.stats()).toMatchObject({
    decodes: 1,
    renders: 2,
    tileBytes: before.tileBytes,
  });
  expect(createImageBitmap).toHaveBeenCalledOnce();
  cache.clear();
});

it("rejects a decode that would exceed the work budget and leaves native fallback a clean destination", async () => {
  const cache = new ScanCanvasRenderer({
      byteLimit: 1024 * 1024,
      workLimit: 1024 * 1024,
    }),
    ctx = target();
  expect(
    await cache.render(page, ctx, matrix, [0, 0, 512, 512], options()),
  ).toBe(false);
  expect(createImageBitmap).not.toHaveBeenCalled();
  expect(ctx.drawImage).not.toHaveBeenCalled();
  expect([ctx.canvas.width, ctx.canvas.height]).toEqual([17, 19]);
  expect(cache.stats()).toMatchObject({ bytes: 0, reservedBytes: 0, pages: 0 });
});

it("uses native fallback when the browser has no ImageDecoder", async () => {
  vi.stubGlobal("ImageDecoder", undefined);
  const cache = new ScanCanvasRenderer(),
    ctx = target();
  expect(
    await cache.render(page, ctx, matrix, [0, 0, 512, 512], options()),
  ).toBe(false);
  expect(plan).not.toHaveBeenCalled();
  expect(ctx.drawImage).not.toHaveBeenCalled();
});

it("keeps rotated nearest-neighbor magnification on the native renderer", async () => {
  const cache = new ScanCanvasRenderer(),
    ctx = target();
  expect(
    await cache.render(
      page,
      ctx,
      [0, 3, 3, 0, 0, 0],
      [100, 100, 612, 612],
      options(),
    ),
  ).toBe(false);
  expect(createImageBitmap).not.toHaveBeenCalled();
  expect(ctx.drawImage).not.toHaveBeenCalled();
  cache.clear();
});
