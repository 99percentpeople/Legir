import type { PDFPage } from "@legir/pdfium";

/** Background scans must not evict pages used by the reader. Both tiers are
 * bounded; a page is owned by exactly one tier and promoted on foreground use. */
export class NativePageCache {
  private readonly reader = new Map<number, PDFPage>();
  private readonly background = new Map<number, PDFPage>();

  constructor(
    private readonly load: (index: number) => PDFPage,
    private readonly readerLimit = 12,
    private readonly backgroundLimit = 2,
  ) {}

  get(index: number, foreground = false) {
    const previous = this.reader.get(index) ?? this.background.get(index);
    const target =
      foreground || this.reader.has(index) ? this.reader : this.background;
    const page = previous ?? this.load(index);
    this.reader.delete(index);
    this.background.delete(index);
    target.set(index, page);
    const limit =
      target === this.reader ? this.readerLimit : this.backgroundLimit;
    while (target.size > limit) {
      const [key, old] = target.entries().next().value!;
      target.delete(key);
      old.destroy();
    }
    return page;
  }

  clear() {
    for (const cache of [this.reader, this.background]) {
      for (const page of cache.values()) page.destroy();
      cache.clear();
    }
  }
}
