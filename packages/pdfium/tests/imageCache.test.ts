import { deflateSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import { createPDFium, type PDFium, type PDFPage } from "../src/index.js";

let engine: PDFium;
beforeAll(async () => {
  engine = await createPDFium();
});
const imageBytes = 8000 * 8000; // Exceeds PDFium's 60 MB lazy-image threshold.
const compressed = (gray: number) =>
  deflateSync(new Uint8Array(imageBytes).fill(gray));
function fixture(gray: number) {
  const doc = new engine.PDFDocument();
  const image = doc.addObject({
    Type: "XObject",
    Subtype: "Image",
    Width: 8000,
    Height: 8000,
    ColorSpace: "DeviceGray",
    BitsPerComponent: 8,
    Filter: "FlateDecode",
  });
  image.writeRawStream(compressed(gray));
  const object = doc.addPage(
    [0, 0, 80, 80],
    0,
    { XObject: { Im: image } },
    "q 80 0 0 80 0 0 cm /Im Do Q",
  );
  doc.insertPage(-1, object);
  object.destroy();
  return { doc, image };
}
function render(page: PDFPage, imageCache?: "populate" | "reuse") {
  const bitmap = page.render([1, 0, 0, -1, 0, 80], [0, 0, 80, 80], {
    imageCache,
  });
  try {
    return bitmap.getPixels().slice();
  } finally {
    bitmap.destroy();
  }
}

describe("bounded native large-image cache", () => {
  it("lets previews reuse foreground pixels without filling or evicting the cache", () => {
    engine.setLargeImageCacheLimit(64 * 1024 * 1024);
    const first = fixture(73),
      second = fixture(211);
    const a = first.doc.loadPage(0),
      b = second.doc.loadPage(0);
    try {
      const before = engine.largeImageCache();
      const preview = render(b, "reuse");
      expect(engine.largeImageCache()).toEqual(before);
      const foreground = render(a);
      const warm = engine.largeImageCache();
      expect(render(a, "reuse")).toEqual(foreground);
      expect(render(b, "reuse")).toEqual(preview);
      expect(engine.largeImageCache()).toEqual(warm);
      expect(render(a)).toEqual(foreground);
      expect(engine.largeImageCache()).toEqual(warm);
      expect(render(b)).toEqual(preview);
      expect(engine.largeImageCache().evictions).toBe(warm.evictions + 1);
    } finally {
      first.doc.destroy();
      second.doc.destroy();
      engine.setLargeImageCacheLimit(256 * 1024 * 1024);
    }
  });
  it("reuses exact pixels, evicts across documents, and falls back above the budget", () => {
    engine.setLargeImageCacheLimit(64 * 1024 * 1024);
    const first = fixture(73),
      second = fixture(211);
    const a = first.doc.loadPage(0),
      b = second.doc.loadPage(0);
    try {
      const before = engine.largeImageCache();
      const pixels = render(a);
      expect([...pixels.slice(0, 4)]).toEqual([73, 73, 73, 255]);
      expect(engine.largeImageCache()).toMatchObject({
        bytes: imageBytes,
        entries: 1,
        decodes: before.decodes + 1,
      });
      expect(render(a)).toEqual(pixels);
      expect(engine.largeImageCache().decodes).toBe(before.decodes + 1);
      expect([...render(b).slice(0, 4)]).toEqual([211, 211, 211, 255]);
      expect(engine.largeImageCache()).toMatchObject({
        bytes: imageBytes,
        entries: 1,
        evictions: before.evictions + 1,
      });
      expect(render(a)).toEqual(pixels);
      expect(engine.largeImageCache().decodes).toBe(before.decodes + 3);
      engine.setLargeImageCacheLimit(0);
      expect(engine.largeImageCache()).toMatchObject({ bytes: 0, entries: 0 });
      expect(render(a)).toEqual(pixels);
      expect(engine.largeImageCache().decodes).toBe(before.decodes + 3);
      engine.setLargeImageCacheLimit(64 * 1024 * 1024);
      expect(render(a)).toEqual(pixels);
      a.destroy();
      expect(engine.largeImageCache()).toMatchObject({ bytes: 0, entries: 0 });
      render(b);
      second.doc.destroy(); // Document destruction also closes its live page.
      expect(engine.largeImageCache()).toMatchObject({ bytes: 0, entries: 0 });
    } finally {
      first.doc.destroy();
      second.doc.destroy();
      engine.setLargeImageCacheLimit(256 * 1024 * 1024);
    }
  });

  it("releases edited page pixels and rebuilds them after rollback", () => {
    const { doc, image } = fixture(73);
    const read = () => {
      const page = doc.loadPage(0);
      try {
        return render(page);
      } finally {
        page.destroy();
      }
    };
    try {
      const original = read();
      expect(engine.largeImageCache().bytes).toBe(0);
      doc.beginOperation();
      image.writeRawStream(compressed(211));
      expect([...read().slice(0, 4)]).toEqual([211, 211, 211, 255]);
      doc.abandonOperation();
      expect(read()).toEqual(original);
      expect(engine.largeImageCache().bytes).toBe(0);
    } finally {
      doc.destroy();
    }
  });

  it("rejects invalid limits without changing the active budget", () => {
    const before = engine.largeImageCache().limit;
    for (const value of [-1, 0.5, NaN, Infinity, 513 * 1024 * 1024])
      expect(() => engine.setLargeImageCacheLimit(value)).toThrow(
        /cache limit/,
      );
    expect(engine.largeImageCache().limit).toBe(before);
  });

  it("pins borrowed scanlines until rendering ends when images exceed the budget", () => {
    engine.setLargeImageCacheLimit(64 * 1024 * 1024);
    const { doc, image } = fixture(73);
    const other = doc.addObject({
      Type: "XObject",
      Subtype: "Image",
      Width: 8000,
      Height: 8000,
      ColorSpace: "DeviceGray",
      BitsPerComponent: 8,
      Filter: "FlateDecode",
    });
    other.writeRawStream(compressed(211));
    const object = doc.findPage(0);
    object.put("MediaBox", [0, 0, 240, 80]);
    object.put("Resources", { XObject: { A: image, B: other } });
    object
      .get("Contents")
      .writeStream(
        new TextEncoder().encode(
          "q 80 0 0 80 0 0 cm /A Do Q q 80 0 0 80 80 0 cm /B Do Q q 80 0 0 80 160 0 cm /A Do Q",
        ),
      );
    try {
      const before = engine.largeImageCache().decodes;
      const page = doc.loadPage(0);
      const bitmap = page.render([1, 0, 0, -1, 0, 80], [0, 0, 240, 80]);
      try {
        const pixels = bitmap.getPixels();
        expect([pixels[40 * 4], pixels[120 * 4], pixels[200 * 4]]).toEqual([
          73, 211, 73,
        ]);
        expect(engine.largeImageCache().decodes).toBe(before + 1);
        expect(engine.largeImageCache().bytes).toBe(imageBytes);
      } finally {
        bitmap.destroy();
      }
    } finally {
      doc.destroy();
      engine.setLargeImageCacheLimit(256 * 1024 * 1024);
    }
    expect(engine.largeImageCache().bytes).toBe(0);
  });
});
