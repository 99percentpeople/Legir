/** Small, materialized page bodies. Borrow the owner's PDF; retain no pages,
 * decoders, JPEG sources or reader-scale surfaces. Overlays are always live. */
export class ThumbnailRasterCache {
  private readonly entries = new Map<string, ImageBitmap>();
  private bytes = 0;
  private hits = 0;
  constructor(private readonly limit = 16 * 1024 * 1024) {}

  draw(key: string, context: OffscreenCanvasRenderingContext2D) {
    const image = this.entries.get(key);
    if (!image) return false;
    this.entries.delete(key);
    this.entries.set(key, image);
    context.drawImage(image, 0, 0);
    this.hits++;
    return true;
  }

  remember(key: string, canvas: OffscreenCanvas) {
    const bytes = canvas.width * canvas.height * 4;
    if (bytes > this.limit || this.entries.has(key)) return;
    // transferToImageBitmap flushes the canvas recording, preventing a small
    // cached canvas from retaining the full scan that produced it.
    const image = canvas.transferToImageBitmap();
    try {
      canvas.getContext("2d")!.drawImage(image, 0, 0);
    } catch (error) {
      image.close();
      throw error;
    }
    while (this.bytes + bytes > this.limit) {
      const [oldKey, old] = this.entries.entries().next().value!;
      this.entries.delete(oldKey);
      this.bytes -= old.width * old.height * 4;
      old.close();
    }
    this.entries.set(key, image);
    this.bytes += bytes;
  }

  clear() {
    for (const image of this.entries.values()) image.close();
    this.entries.clear();
    this.bytes = 0;
  }

  stats() {
    return {
      bytes: this.bytes,
      limit: this.limit,
      entries: this.entries.size,
      hits: this.hits,
    };
  }
}
