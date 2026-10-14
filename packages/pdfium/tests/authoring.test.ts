import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { createPDFium, type PDFium } from "../src/index.js";
import {
  NativeEditingContext,
  PDFName,
  PDFString,
  StandardFonts,
  degrees,
  rgb,
} from "../src/authoring/index.js";

let engine: PDFium;
const views: NativeEditingContext[] = [];
beforeAll(async () => {
  engine = await createPDFium();
});
afterEach(() => {
  for (const view of views.splice(0)) {
    view.dispose();
    view.native.destroy();
  }
  expect(engine.liveDocuments()).toBe(0);
});
function document(bytes?: Uint8Array) {
  const view = new NativeEditingContext(engine, new engine.PDFDocument(bytes));
  views.push(view);
  return view.document;
}
const pixel = (rgba: Uint8Array, width: number, x: number, y: number) =>
  Array.from(rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 3));

describe("native authoring view", () => {
  it("authors and rolls back without opening or serializing another document", async () => {
    const doc = document();
    const native = doc.nativeView!.native;
    const page = doc.addPage([100, 100]);
    await doc.save();
    native.beginOperation("edit");
    page.drawText("A", {
      size: 20,
      x: 10,
      y: 20,
      font: doc.embedStandardFont(StandardFonts.Helvetica),
    });
    await doc.flush();
    expect(engine.liveDocuments()).toBe(1);
    expect(native.operationHasChanges()).toBe(true);
    native.abandonOperation();
    const restored = native.loadPage(0);
    try {
      expect(restored.extractText().lines).toHaveLength(0);
    } finally {
      restored.destroy();
    }
    expect(engine.liveDocuments()).toBe(1);
  });
  it("isolates added drawing from the original page transform and clip", async () => {
    const source = document();
    const native = source.nativeView!.native;
    const page = native.addPage(
      [0, 0, 100, 100],
      0,
      {},
      "2 0 0 2 0 0 cm 0 0 10 10 re W n",
    );
    try {
      native.insertPage(-1, page);
    } finally {
      page.destroy();
    }
    const doc = document(await source.save());
    doc.getPage(0).drawRectangle({
      x: 40,
      y: 40,
      width: 20,
      height: 20,
      color: rgb(1, 0, 0),
    });
    await doc.flush();
    const loaded = doc.nativeView!.native.loadPage(0),
      bitmap = loaded.toPixmap([1, 0, 0, 1, 0, 0]);
    try {
      expect(pixel(bitmap.getPixels(), 100, 50, 50)).toEqual([255, 0, 0]);
      expect(pixel(bitmap.getPixels(), 100, 85, 15)).toEqual([255, 255, 255]);
    } finally {
      bitmap.destroy();
      loaded.destroy();
    }
  });
  it.each([false, true])(
    "decodes a valid empty compressed stream (filter chain: %s)",
    (chain) => {
      const doc = document(),
        encoded = deflateSync(new Uint8Array());
      const stream = chain
        ? doc.context.stream(`${encoded.toString("hex")}>`, {
            Filter: ["ASCIIHexDecode", "FlateDecode"],
          })
        : doc.context.flateStream(new Uint8Array());
      expect(stream.getUnencodedContents()).toHaveLength(0);
      expect(() =>
        doc.context
          .stream("broken", { Filter: "FlateDecode" })
          .getUnencodedContents(),
      ).toThrow();
      expect(engine.liveDocuments()).toBe(1);
    },
  );
  it("retains raw dictionary name bytes and timezone metadata", async () => {
    const doc = document();
    doc.addPage();
    doc.catalog.set(PDFName.of("key#20#FF"), PDFName.of("value#23#00"));
    const loaded = document(await doc.save());
    expect(
      loaded.catalog.lookup(PDFName.of("key#20#ff"), PDFName).toString(),
    ).toBe("/value#23#00");
    expect(
      PDFString.of("D:20261014213000+08'00'").decodeDate().toISOString(),
    ).toBe("2026-10-14T13:30:00.000Z");
  });
  const pngs = [
    [
      "packed gray",
      "iVBORw0KGgoAAAANSUhEUgAAAAUAAAACAQAAAAC4ESvwAAAADElEQVR4nGMIYFgBAAGcAPm5ptd6AAAAAElFTkSuQmCC",
      [0, 0, 0],
    ],
    [
      "16-bit gray",
      "iVBORw0KGgoAAAANSUhEUgAAAAUAAAACEAAAAADlkZXCAAAAEklEQVR4nGNgYPj/H4LhjP//AWKzCfeaIlfuAAAAAElFTkSuQmCC",
      [0, 0, 0],
    ],
    [
      "palette alpha",
      "iVBORw0KGgoAAAANSUhEUgAAAAUAAAACAQMAAACqpIQeAAAABlBMVEX/AAAAAP9sof2OAAAAAnRSTlP/AOW3MEoAAAAMSURBVHicYwhgWAEAAZwA+bmm13oAAAAASUVORK5CYII=",
      [255, 0, 0],
    ],
    [
      "RGBA",
      "iVBORw0KGgoAAAANSUhEUgAAAAUAAAACCAYAAACQahZdAAAAF0lEQVR4nGP4z8Dwn4HhPwMqjSHwnwEAQfYO8jhL1bQAAAAASUVORK5CYII=",
      [255, 0, 0],
    ],
  ] as const;
  it.each(pngs)(
    "preserves %s PNG samples and transparency",
    async (_name, base64, first) => {
      const doc = document(),
        page = doc.addPage([5, 2]);
      page.drawImage(await doc.embedPng(base64), {
        x: 0,
        y: 0,
        width: 5,
        height: 2,
      });
      await doc.flush();
      const loaded = doc.nativeView!.native.loadPage(0),
        bitmap = loaded.toPixmap([1, 0, 0, 1, 0, 0]);
      try {
        expect(pixel(bitmap.getPixels(), 5, 0, 0)).toEqual(first);
        expect(pixel(bitmap.getPixels(), 5, 1, 0)).toEqual([255, 255, 255]);
      } finally {
        bitmap.destroy();
        loaded.destroy();
      }
    },
  );
  it("preserves colored and rotated field appearances and selected list entries", async () => {
    const doc = document(),
      page = doc.addPage([300, 300]),
      form = doc.getForm();
    const field = form.createTextField("color");
    field.setText("Visible");
    field.setFontSize(12);
    field.addToPage(page, {
      x: 20,
      y: 200,
      width: 160,
      height: 30,
      textColor: rgb(1, 0, 0),
      rotate: degrees(180),
    });
    const list = form.createOptionList("choice");
    list.setOptions(["one", "two", "three"]);
    list.select("two");
    list.addToPage(page, { x: 20, y: 20, width: 160, height: 100 });
    const bytes = await doc.save(),
      reopened = document(bytes);
    expect(reopened.getForm().getOptionList("choice").getSelected()).toEqual([
      "two",
    ]);
    const ap = reopened
      .getForm()
      .getTextField("color")
      .acroField.getWidgets()[0]
      .getAppearances().normal!;
    expect(
      "getUnencodedContents" in ap &&
        new TextDecoder().decode(ap.getUnencodedContents()),
    ).toContain("1 0 0 rg");
    const loaded = reopened.nativeView!.native.loadPage(0),
      bitmap = loaded.toPixmap([1, 0, 0, 1, 0, 0]);
    try {
      let red = 0,
        blue = 0;
      const pixels = bitmap.getPixels();
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 200 && pixels[i + 1] < 80 && pixels[i + 2] < 80) red++;
        if (
          pixels[i] > 140 &&
          pixels[i] < 170 &&
          pixels[i + 1] > 180 &&
          pixels[i + 2] > 210
        )
          blue++;
      }
      expect(red).toBeGreaterThan(20);
      expect(blue).toBeGreaterThan(500);
    } finally {
      bitmap.destroy();
      loaded.destroy();
    }
  });
});
