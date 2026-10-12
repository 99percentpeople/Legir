import { beforeAll, describe, expect, it } from "vitest";
import { createPDFium, type PDFium, type PDFDocument } from "../src/index.js";

let engine: PDFium;
beforeAll(async () => {
  engine = await createPDFium();
});
function fixture(content = "BT /F1 20 Tf 30 140 Td (REMOVE KEEP) Tj ET") {
  const doc = new engine.PDFDocument();
  const font = doc.addObject({
    Type: "Font",
    Subtype: "Type1",
    BaseFont: "Helvetica",
  });
  const page = doc.addPage(
    [0, 0, 300, 200],
    0,
    { Font: { F1: font } },
    content,
  );
  try {
    doc.insertPage(-1, page);
  } finally {
    page.destroy();
    font.destroy();
  }
  return doc;
}
function save(doc: PDFDocument) {
  const buffer = doc.saveToBuffer();
  try {
    return buffer.asUint8Array().slice();
  } finally {
    buffer.destroy();
  }
}
function read(doc: PDFDocument) {
  const page = doc.loadPage(0);
  try {
    return page.extractText();
  } finally {
    page.destroy();
  }
}

describe("standalone PDFium engine", () => {
  it("preserves borrowed stream bytes when a native allocation grows WASM memory", () => {
    const doc = fixture();
    const runtime = doc.runtime;
    const length = engine.memory();
    const input = runtime.call("malloc", length);
    try {
      runtime.native.HEAPU8[input] = 37;
      runtime.native.HEAPU8[input + length - 1] = 93;
      const view = runtime.native.HEAPU8.subarray(input, input + length);
      const before = engine.memory();
      runtime.withBytes(view, (pointer, size) => {
        expect(size).toBe(length);
        expect(runtime.native.HEAPU8[pointer]).toBe(37);
        expect(runtime.native.HEAPU8[pointer + size - 1]).toBe(93);
      });
      expect(engine.memory()).toBeGreaterThan(before);
    } finally {
      runtime.call("free", input);
      doc.destroy();
    }
  });
  it("rejects edits that would leave stale ActualText without changing the page", () => {
    const doc = fixture(
      "/Span << /ActualText (LOGICAL SECRET) >> BDC BT /F1 20 Tf 30 140 Td (VISUAL) Tj ET EMC",
    );
    const page = doc.loadPage(0);
    try {
      const before = read(doc).text;
      expect(before).toContain("LOGICAL SECRET");
      expect(() => page.redactText([[0, 200, 300, 200, 0, 0, 300, 0]])).toThrow(
        /safely rewrite/,
      );
      expect(read(doc).text).toBe(before);
    } finally {
      page.destroy();
      doc.destroy();
    }
  });
  it("rolls back native appearance generation for inline annotations", () => {
    const doc = fixture(),
      pageObject = doc.findPage(0);
    pageObject.put("Annots", [
      {
        Type: "Annot",
        Subtype: "Square",
        Rect: [10, 10, 80, 80],
        C: [1, 0, 0],
      },
    ]);
    const before = pageObject.toString(),
      count = doc.countObjects();
    const annotation = pageObject.get("Annots", 0);
    try {
      doc.beginOperation();
      const page = doc.loadPage(0),
        raster = page.toPixmap(engine.Matrix.identity, undefined, false, true);
      raster.destroy();
      page.destroy();
      doc.abandonOperation();
      expect(pageObject.toString()).toBe(before);
      expect(annotation.get("AP").isNull()).toBe(true);
      expect(doc.countObjects()).toBe(count);
    } finally {
      annotation.destroy();
      pageObject.destroy();
      doc.destroy();
    }
  });

  it("renders, extracts and saves one native document, with explicit resource disposal", () => {
    const baseline = engine.liveDocuments();
    const doc = fixture();
    try {
      expect(engine.liveDocuments()).toBe(baseline + 1);
      expect(read(doc).text).toContain("REMOVE KEEP");
      const page = doc.loadPage(0),
        raster = page.toPixmap(engine.Matrix.identity);
      try {
        expect(raster.getPixels()).toHaveLength(300 * 200 * 4);
        expect([...raster.asPNG().slice(0, 8)]).toEqual([
          137, 80, 78, 71, 13, 10, 26, 10,
        ]);
      } finally {
        raster.destroy();
        page.destroy();
      }
      const reopened = new engine.PDFDocument(save(doc));
      try {
        expect(read(reopened).text).toContain("REMOVE KEEP");
      } finally {
        reopened.destroy();
      }
    } finally {
      doc.destroy();
    }
    expect(engine.liveDocuments()).toBe(baseline);
    expect(() => doc.loadPage(0)).toThrow(/closed/);
  });
  it("rolls back arrays, streams, dictionary mutations and appended pages in place", () => {
    const doc = fixture();
    const page = doc.findPage(0),
      contents = page.get("Contents");
    try {
      doc.beginOperation("temporary edit");
      const values = doc.from([1, 2]);
      page.put("Custom", values);
      values.push(3);
      contents.writeStream(
        new TextEncoder().encode("BT /F1 20 Tf (CHANGED) Tj ET"),
      );
      const blank = doc.addPage([0, 0, 300, 200], 0, {}, "");
      doc.insertPage(-1, blank);
      blank.destroy();
      values.destroy();
      expect(doc.countPages()).toBe(2);
      expect(read(doc).text).toContain("CHANGED");
      doc.abandonOperation();
      expect(doc.countPages()).toBe(1);
      expect(page.get("Custom").isNull()).toBe(true);
      expect(read(doc).text).toContain("REMOVE KEEP");
    } finally {
      contents.destroy();
      page.destroy();
      doc.destroy();
    }
  });
  it("preserves large integers, precise decimals and arbitrary PDF name bytes through save", () => {
    const doc = fixture(),
      trailer = doc.getTrailer(),
      root = trailer.get("Root");
    const key = doc.newNameBytes(new Uint8Array([75, 255, 128]));
    root.put(key, [1099511627776, 16777217, 1e-12, 1.000000000001]);
    const output = save(doc);
    key.destroy();
    root.destroy();
    trailer.destroy();
    doc.destroy();
    const reopened = new engine.PDFDocument(output);
    try {
      const name = reopened.newNameBytes(new Uint8Array([75, 255, 128]));
      const array = reopened.getTrailer().get("Root", name);
      expect(
        Array.from({ length: array.length }, (_, i) => array.get(i).asNumber()),
      ).toEqual([1099511627776, 16777217, 1e-12, 1.000000000001]);
      name.destroy();
      array.destroy();
    } finally {
      reopened.destroy();
    }
  });
  it.each([
    "BT /F1 20 Tf 30 140 Td (REMOVE KEEP) Tj ( NEXT) Tj ET",
    "BT /F1 20 Tf 30 140 Td [(REM) 25 (OVE) -10 ( KEEP)] TJ ( NEXT) Tj ET",
    "BT /F1 20 Tf 30 160 Td 20 TL (REMOVE KEEP) ' ( NEXT) Tj ET",
    'BT /F1 20 Tf 30 160 Td 20 TL 2 1 (REMOVE KEEP) " ( NEXT) Tj ET',
  ])(
    "removes glyphs while retaining subsequent origins and original graphics: %s",
    (content) => {
      const doc = fixture("q 0 0 1 rg 5 5 10 10 re f Q " + content);
      try {
        const before = read(doc).lines.flatMap((line) => line.glyphs);
        const target = before
          .filter((g) => "REMOVE".includes(g.text))
          .slice(0, 6);
        const xs = target.flatMap((g) => [
          g.quad[0],
          g.quad[2],
          g.quad[4],
          g.quad[6],
        ]);
        const ys = target.flatMap((g) => [
          g.quad[1],
          g.quad[3],
          g.quad[5],
          g.quad[7],
        ]);
        const page = doc.loadPage(0);
        page.redactText([
          [
            Math.min(...xs) - 0.01,
            Math.max(...ys) + 0.01,
            Math.max(...xs) + 0.01,
            Math.max(...ys) + 0.01,
            Math.min(...xs) - 0.01,
            Math.min(...ys) - 0.01,
            Math.max(...xs) + 0.01,
            Math.min(...ys) - 0.01,
          ],
        ]);
        page.destroy();
        const after = read(doc).lines.flatMap((line) => line.glyphs);
        expect(after.map((g) => g.text).join("")).not.toContain("REMOVE");
        for (const character of ["K", "N"]) {
          const old = before.find((g) => g.text === character)!,
            next = after.find((g) => g.text === character)!;
          expect(next.origin[0]).toBeCloseTo(old.origin[0], 3);
          expect(next.origin[1]).toBeCloseTo(old.origin[1], 3);
        }
        const buffer = doc.findPage(0).get("Contents").readStream();
        try {
          expect(new TextDecoder().decode(buffer.asUint8Array())).toContain(
            "q 0 0 1 rg 5 5 10 10 re f Q",
          );
        } finally {
          buffer.destroy();
        }
        const reopened = new engine.PDFDocument(save(doc));
        try {
          expect(read(reopened).text).not.toContain("REMOVE");
        } finally {
          reopened.destroy();
        }
      } finally {
        doc.destroy();
      }
    },
  );
  it("exports only objects reachable from the current catalog", () => {
    const doc = fixture();
    try {
      doc.addStream("ORPHAN_SECRET").destroy();
      expect(new TextDecoder().decode(save(doc))).not.toContain(
        "ORPHAN_SECRET",
      );
    } finally {
      doc.destroy();
    }
  });
});
