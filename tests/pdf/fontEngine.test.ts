import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import * as fontkit from "fontkit";
import { createFontkitEngine } from "@legir/pdfium/fontkit";
import {
  PDFDocument,
  PDFDict,
  PDFArray,
  PDFName,
  PDFStream,
  type FontEngine,
  type ShapingFont,
} from "@legir/pdfium/authoring";
import { readPageText, renderPageBody } from "./nativeVerification";

let bytes: Uint8Array;
beforeAll(async () => {
  bytes = new Uint8Array(
    await readFile(
      resolve(import.meta.dirname, "../fixtures/fonts/synthetic-cff.otf"),
    ),
  );
});

describe("injected font engine", () => {
  it("keeps standard fonts independent and explains missing custom font configuration", async () => {
    const doc = await PDFDocument.create();
    doc.addPage().drawText("Standard font");
    await expect(doc.save()).resolves.toBeInstanceOf(Uint8Array);
    await expect(doc.embedFont(bytes)).rejects.toThrow("registerFontEngine");
  });

  it.each([false, true])(
    "propagates subset errors to save (async: %s) and permits retry",
    async (asyncFailure) => {
      const doc = await PDFDocument.create();
      doc.addPage();
      const real = await createFontkitEngine(fontkit).createFont(bytes);
      const error = new Error("font encoding failed");
      let fail = true;
      // This provider is a plain interface implementation, without a fontkit API.
      const engine: FontEngine = {
        createFont: async () => ({
          ...real,
          createSubset: () => {
            const subset = real.createSubset();
            return {
              includeGlyph: (id) => subset.includeGlyph(id),
              encode: () => {
                if (fail) {
                  if (asyncFailure) return Promise.reject(error);
                  throw error;
                }
                return Promise.resolve(subset.encode());
              },
            };
          },
        }),
      };
      doc.registerFontEngine(engine);
      await doc.embedFont(bytes);
      await expect(doc.save()).rejects.toBe(error);
      fail = false;
      await expect(doc.save()).resolves.toBeInstanceOf(Uint8Array);
    },
  );
});

describe("upstream fontkit adapter", () => {
  it("encodes empty and .notdef-only CFF subsets as a valid two-glyph program", async () => {
    const face = await createFontkitEngine(fontkit).createFont(bytes);
    expect(face.outlineFormat).toBe("cff");
    const subset = face.createSubset();
    const expected = fontkit.create(bytes).createSubset();
    expected.includeGlyph(1);
    // Upstream encode mutates its encoder; the reference must be encoded once.
    const expectedBytes = expected.encode();
    expect(await subset.encode()).toEqual(expectedBytes);
    expect(subset.includeGlyph(0)).toBe(0);
    expect(await subset.encode()).toEqual(expectedBytes);
    // The encoding-only filler must not consume a CID in the document.
    expect(subset.includeGlyph(3)).toBe(1);
    expect(subset.includeGlyph(2)).toBe(2);
    const populated = await subset.encode();
    expect(await subset.encode()).toEqual(populated);
  });

  it.each([true, false])(
    "saves an unused CFF font, then adds and renders text across saves (subset: %s)",
    async (subset) => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([200, 200]);
      doc.registerFontEngine(createFontkitEngine(fontkit));
      const font = await doc.embedFont(bytes, { subset });
      expect(font.widthOfTextAtSize("AB", 10)).toBe(12);
      const empty = await doc.save();
      const resource = doc.context.lookup(font.ref, PDFDict);
      const descendant = resource
        .lookup(PDFName.of("DescendantFonts"), PDFArray)
        .lookup(0, PDFDict);
      expect(descendant.lookup(PDFName.of("Subtype"), PDFName).toString()).toBe(
        "/CIDFontType0",
      );
      const descriptor = descendant.lookup(
        PDFName.of("FontDescriptor"),
        PDFDict,
      );
      const program = descriptor.lookup(PDFName.of("FontFile3"), PDFStream);
      expect(
        program.dict.lookup(PDFName.of("Subtype"), PDFName).toString(),
      ).toBe("/CIDFontType0C");
      expect(await readPageText(empty)).toEqual([]);
      expect((await renderPageBody(empty)).coloredPixels).toBe(0);
      page.drawText("B", { font, size: 24, x: 20, y: 150 });
      const first = await doc.save();
      expect((await readPageText(first)).map((line) => line.str).join("")).toBe(
        "B",
      );
      expect((await renderPageBody(first)).coloredPixels).toBeGreaterThan(0);
      page.drawText("A", { font, size: 24, x: 20, y: 100 });
      for (const output of [await doc.save(), await doc.save()]) {
        expect(
          (await readPageText(output)).map((line) => line.str).join(""),
        ).toBe("BA");
        expect((await renderPageBody(output)).coloredPixels).toBeGreaterThan(0);
      }
    },
  );

  it("encodes full CFF programs with original glyph IDs instead of embedding the OTF container", async () => {
    const source = fontkit.create(bytes);
    const expected = source.createSubset();
    for (let id = 0; id < source.numGlyphs; id++) expected.includeGlyph(id);
    const face = await createFontkitEngine(fontkit).createFont(bytes);
    const program = await face.encode();
    expect(program).toEqual(expected.encode());
    expect(program[0]).toBe(1); // CFF v1; the source starts with OTTO.
  });

  it("rejects collections with an actionable single-face error", () => {
    expect(() =>
      createFontkitEngine({ create: () => ({ fonts: [] }) }).createFont(bytes),
    ).toThrow("single font face");
  });

  it("rejects an unencodable one-glyph CFF face instead of writing a negative range", async () => {
    const face = fontkit.create(bytes);
    const engine = createFontkitEngine({
      create: () =>
        new Proxy(face, {
          get: (target, key) =>
            key === "numGlyphs" ? 1 : Reflect.get(target, key),
        }),
    });
    const shaping: ShapingFont = await engine.createFont(bytes);
    expect(() => shaping.createSubset().encode()).toThrow("only .notdef");
  });
});
