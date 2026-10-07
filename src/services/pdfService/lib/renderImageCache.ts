// PDF.js can decode a large JPEG into a YUV VideoFrame. Drawing that frame
// into every tile repeats conversion/upload work on the browser's GPU thread.
// Keep an RGB bitmap for repeated renders without changing image resolution.
const MIN_CACHED_IMAGE_PIXELS = 4_000_000;
const DEFAULT_PIXEL_BUDGET = 64 * 1024 * 1024;

type CachedImage = { bitmap: ImageBitmap; pixels: number };
type ImageObject = { bitmap: VideoFrame | ImageBitmap };

export class PdfRenderImageCache {
  private readonly images = new Map<VideoFrame, CachedImage>();
  private readonly restorations = new Set<() => void>();
  private pixels = 0;
  private generation = 0;

  constructor(private readonly pixelBudget = DEFAULT_PIXEL_BUDGET) {}

  clear() {
    this.generation += 1;
    for (const restore of this.restorations) restore();
    for (const { bitmap } of this.images.values()) bitmap.close();
    this.images.clear();
    this.pixels = 0;
  }

  private async getBitmap(
    source: VideoFrame,
    protectedSources: Set<VideoFrame>,
  ) {
    const cached = this.images.get(source);
    if (cached) {
      this.images.delete(source);
      this.images.set(source, cached);
      return cached.bitmap;
    }

    const pixels = source.displayWidth * source.displayHeight;
    if (pixels > this.pixelBudget) return null;
    for (const [key, entry] of this.images) {
      if (this.pixels + pixels <= this.pixelBudget) break;
      if (protectedSources.has(key)) continue;
      entry.bitmap.close();
      this.images.delete(key);
      this.pixels -= entry.pixels;
    }
    if (this.pixels + pixels > this.pixelBudget) return null;

    const generation = this.generation;
    try {
      const bitmap = await createImageBitmap(source);
      if (generation !== this.generation) {
        bitmap.close();
        return null;
      }
      this.images.set(source, { bitmap, pixels });
      this.pixels += pixels;
      return bitmap;
    } catch {
      // Unsupported/closed frames retain the original PDF.js drawing path.
      return null;
    }
  }

  async prepare(objects: Iterable<readonly unknown[]>) {
    if (
      typeof VideoFrame === "undefined" ||
      typeof createImageBitmap !== "function"
    ) {
      return () => {};
    }

    const sources = new Map<ImageObject, VideoFrame>();
    for (const [, value] of objects) {
      if (!value || typeof value !== "object" || !("bitmap" in value)) continue;
      const source = value.bitmap;
      if (
        source instanceof VideoFrame &&
        source.displayWidth * source.displayHeight >= MIN_CACHED_IMAGE_PIXELS
      ) {
        sources.set(value as ImageObject, source);
      }
    }

    const generation = this.generation;
    const protectedSources = new Set(sources.values());
    const replacements: Array<{
      object: ImageObject;
      source: VideoFrame;
      bitmap: ImageBitmap;
    }> = [];
    const restore = () => {
      for (const { object, source, bitmap } of replacements) {
        if (object.bitmap === bitmap) object.bitmap = source;
      }
      this.restorations.delete(restore);
    };
    this.restorations.add(restore);

    for (const [object, source] of sources) {
      const bitmap = await this.getBitmap(source, protectedSources);
      if (generation !== this.generation) {
        restore();
        return () => {};
      }
      if (!bitmap || object.bitmap !== source) continue;
      object.bitmap = bitmap;
      replacements.push({ object, source, bitmap });
    }

    // Rendering is serialized by the worker. Restore PDF.js-owned frames before
    // releasing the job, so PDF.js cleanup never closes a bitmap in our cache.
    return restore;
  }
}
