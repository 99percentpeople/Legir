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
  transferToImageBitmap() {
    const bitmap = { width: this.width, height: this.height, close: vi.fn() };
    bitmaps.push(bitmap);
    return bitmap;
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
    imageBytes: before.imageBytes,
    bytes: before.bytes,
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

it("uses native fallback when the browser cannot decode ImageBitmaps", async () => {
  vi.stubGlobal("createImageBitmap", undefined);
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

it("does not evict a full foreground cache to stage a background preview", async () => {
  const cache = new ScanCanvasRenderer({
      byteLimit: 3 * 1024 * 1024 + 100,
      workLimit: 5 * 1024 * 1024,
    }),
    ctx = target();
  await cache.render(page, ctx, matrix, [0, 0, 512, 512], options());
  const before = cache.stats();
  expect(before.bytes).toBe(before.limit);
  expect(
    await cache.render(page, ctx, matrix, [0, 0, 128, 128], {
      ...options(),
      populate: false,
    }),
  ).toBe(true);
  expect(cache.stats()).toMatchObject({
    bytes: before.bytes,
    tileBytes: before.tileBytes,
    imageBytes: before.imageBytes,
    evictions: before.evictions,
  });
  cache.clear();
});

it("keeps a zoom source resident across temporary scale levels for a subsequent larger tile", async () => {
  plan.mockReturnValue({
    commands: new Float64Array([2, 8192, 0, 0, 4096, 0, 0, 0, 8192, 4096, 0]),
    images: [new Uint8Array(100)],
    box: [0, 0, 8192, 4096],
  });
  vi.mocked(createImageBitmap).mockImplementation(
    async () =>
      ({ width: 8192, height: 4096, close: vi.fn() }) as unknown as ImageBitmap,
  );
  const cache = new ScanCanvasRenderer({
      byteLimit: 150 * 1024 * 1024,
      workLimit: 220 * 1024 * 1024,
    }),
    ctx = target();
  expect(
    await cache.render(
      page,
      ctx,
      [3000 / 8192, 0, 0, -3000 / 8192, 0, 1500],
      [0, 0, 3000, 1500],
      options(),
    ),
  ).toBe(true);
  expect(
    await cache.render(
      page,
      ctx,
      [6400 / 8192, 0, 0, -6400 / 8192, 0, 3200],
      [500, 500, 1524, 1524],
      options(),
    ),
  ).toBe(true);
  expect(createImageBitmap).toHaveBeenCalledOnce();
  expect(cache.stats().bytes).toBeLessThanOrEqual(cache.stats().limit);
  cache.clear();
});

it("acknowledges abort before an uncancellable bitmap decode settles, then closes its late result", async () => {
  let finish!: (value: ImageBitmap) => void;
  vi.mocked(createImageBitmap).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const cache = new ScanCanvasRenderer({
      byteLimit: 1024 * 1024,
      workLimit: 3 * 1024 * 1024,
    }),
    ctx = target(),
    controller = new AbortController();
  const pending = cache.render(page, ctx, matrix, [0, 0, 512, 512], {
    ...options(),
    signal: controller.signal,
  });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(cache.stats().reservedBytes).toBe(1024 * 512 * 4);
  expect(ctx.drawImage).not.toHaveBeenCalled();
  expect([ctx.canvas.width, ctx.canvas.height]).toEqual([17, 19]);
  cache.clear();
  // A replacement cannot allocate another full bitmap while the abandoned
  // browser operation still owns its working reservation.
  expect(
    await cache.render(
      page,
      ctx,
      matrix,
      [0, 0, 128, 128],
      options("replacement"),
    ),
  ).toBe(false);
  expect(createImageBitmap).toHaveBeenCalledOnce();
  const bitmap = { width: 1024, height: 512, close: vi.fn() };
  finish(bitmap as unknown as ImageBitmap);
  await Promise.resolve();
  expect(bitmap.close).toHaveBeenCalledOnce();
  expect(cache.stats()).toMatchObject({ bytes: 0, reservedBytes: 0 });
  expect(
    await cache.render(
      page,
      ctx,
      matrix,
      [0, 0, 128, 128],
      options("replacement"),
    ),
  ).toBe(true);
  cache.clear();
});

function largeScan() {
  plan.mockReturnValue({
    commands: new Float64Array([2, 8192, 0, 0, 4096, 0, 0, 0, 8192, 4096, 0]),
    images: [new Uint8Array(100)],
    box: [0, 0, 8192, 4096],
  });
  vi.mocked(createImageBitmap).mockImplementation(
    async () =>
      ({ width: 8192, height: 4096, close: vi.fn() }) as unknown as ImageBitmap,
  );
}

it("retains recent decoded pages after discarding encoded bytes and reuses zoom levels for larger tiles", async () => {
  largeScan();
  const cache = new ScanCanvasRenderer({
      byteLimit: 280 * 1024 * 1024,
      workLimit: 384 * 1024 * 1024,
    }),
    ctx = target();
  for (const key of ["first", "middle", "last"]) {
    expect(
      await cache.render(
        page,
        ctx,
        [0.125, 0, 0, -0.125, 0, 512],
        [0, 0, 1024, 512],
        options(key),
      ),
    ).toBe(true);
    expect(cache.stats().bytes).toBeLessThanOrEqual(cache.stats().limit);
  }
  expect(cache.stats().decodes).toBe(3);
  expect(cache.stats().encodedBytes).toBe(0);
  expect(
    await cache.render(
      page,
      ctx,
      [0.4, 0, 0, -0.4, 0, 1638.4],
      [0, 0, 3000, 1500],
      options("middle"),
    ),
  ).toBe(true);
  const beforeWarm = surfaces.length;
  expect(
    await cache.render(
      page,
      ctx,
      [0.4, 0, 0, -0.4, 0, 1638.4],
      [0, 0, 3000, 1500],
      options("middle"),
    ),
  ).toBe(true);
  // The large destination and cached scale level need no staging surface.
  expect(surfaces.length).toBe(beforeWarm);
  for (const x of [100, 500]) {
    expect(
      await cache.render(
        page,
        ctx,
        [0.8, 0, 0, -0.8, 0, 3276.8],
        [x, 100, x + 1024, 1124],
        { ...options("middle"), cacheOutput: false },
      ),
    ).toBe(true);
  }
  expect(createImageBitmap).toHaveBeenCalledTimes(3);
  expect(cache.stats().bytes).toBeLessThanOrEqual(cache.stats().limit);
  expect(cache.stats().peakBytes).toBeLessThanOrEqual(cache.stats().workLimit);
  cache.clear();
});

it("draws prepared tiles directly without allocating or retaining an output bitmap", async () => {
  const cache = new ScanCanvasRenderer(),
    ctx = target();
  expect(
    await cache.render(page, ctx, matrix, [10, 20, 138, 148], {
      ...options(),
      cacheOutput: false,
    }),
  ).toBe(true);
  expect(surfaces).toHaveLength(1);
  expect(ctx.drawImage).toHaveBeenCalledOnce();
  expect(cache.stats()).toMatchObject({ tileBytes: 0, renders: 1 });
  cache.clear();
});

it("preserves the scheduler's abort reason while releasing a late decode", async () => {
  let finish!: (value: ImageBitmap) => void;
  vi.mocked(createImageBitmap).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const cache = new ScanCanvasRenderer(),
    ctx = target(),
    controller = new AbortController();
  const pending = cache.render(page, ctx, matrix, [0, 0, 512, 512], {
    ...options(),
    signal: controller.signal,
  });
  const preemption = new Error("reader arrived");
  controller.abort(preemption);
  await expect(pending).rejects.toBe(preemption);
  expect(ctx.drawImage).not.toHaveBeenCalled();
  cache.clear();
  const bitmap = { width: 1024, height: 512, close: vi.fn() };
  finish(bitmap as unknown as ImageBitmap);
  await Promise.resolve();
  expect(bitmap.close).toHaveBeenCalledOnce();
  expect(cache.stats()).toMatchObject({ bytes: 0, reservedBytes: 0 });
});
