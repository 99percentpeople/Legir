import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PDFDocument,
  PDFName,
  PDFString,
  PDFHexString,
  PDFNumber,
  PDFRef,
  rgb,
  degrees,
  StandardFonts,
} from "@cantoo/pdf-lib";
import { loadPDF, exportPDF } from "@/services/pdfService";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import {
  loadEditingDocument,
  saveEditingDocument,
} from "@/services/pdfService/engine/editingDocument";
import { getPDFium } from "@/services/pdfService/engine/runtime";
import {
  getNativePageViewport,
  getNativeTextContent,
  getNativePermissions,
  getNativeOutline,
  resolveNativeDestination,
} from "@/services/pdfService/engine/pageContent";
import {
  rasterizePage,
  disposeNativePage,
} from "@/services/pdfService/engine/raster";
import { verifyPdfOwnerPassword } from "@/services/pdfService/lib/owner-password";
import { createPdfLibViewport } from "@/services/pdfService/lib/coords";

afterEach(() => vi.restoreAllMocks());
const worker = {
  loadDocument: async () => true,
  resolveDest: async () => null,
  getOutline: async () => [],
  getPermissions: async () => null,
  renderPageImage: async () => undefined,
} as unknown as PDFWorkerService;

describe("native PDF pipeline", () => {
  it("loads, edits and saves forms/annotations without the previous PDF parser or writer", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([400, 500]);
    source.setTitle("Native round trip");
    const name = source.getForm().createTextField("name");
    name.setText("Alice");
    name.addToPage(page, { x: 40, y: 200, width: 180, height: 30 });
    const bytes = await source.save();
    const parse = vi
      .spyOn(PDFDocument, "load")
      .mockRejectedValue(new Error("Legacy parser must not run"));
    const save = vi
      .spyOn(PDFDocument.prototype, "save")
      .mockRejectedValue(new Error("Legacy writer must not run"));
    const loaded = await loadPDF(bytes, { workerService: worker });
    try {
      const output = await exportPDF(
        bytes,
        loaded.fields.map((field) => ({ ...field, value: "Bob" })),
        loaded.metadata,
        [
          {
            id: "note",
            type: "comment",
            pageIndex: 0,
            rect: { x: 250, y: 100, width: 24, height: 24 },
            text: "Native annotation",
          },
        ],
      );
      const pdfium = await getPDFium();
      const doc = new pdfium.PDFDocument(output);
      const nativePage = doc.loadPage(0);
      try {
        expect(nativePage.getWidgets()[0].getValue()).toBe("Bob");
        expect(nativePage.getAnnotations()[0].getContents()).toBe(
          "Native annotation",
        );
        expect(doc.getMetaData("info:Title")).toBe("Native round trip");
      } finally {
        disposeNativePage(nativePage);
        doc.destroy();
      }
      expect(parse).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    } finally {
      loaded.dispose();
    }
  });

  it("preserves byte strings, escaped names, shared objects and unknown catalog data", async () => {
    const source = await PDFDocument.create();
    source.addPage();
    const shared = PDFRef.of(source.context.nextRef().objectNumber, 3);
    source.context.assign(
      shared,
      source.context.obj({
        Name: PDFName.of("A/B C#D"),
        Bytes: PDFHexString.of("00FFFE8029285C"),
        LargeInteger: 1099511627776,
        ExactInteger: 16777217,
        UnicodeName: PDFName.of("M#C3#BCPDF/#E4#B8#AD#2341"),
      }),
    );
    const sharedDict = source.context.lookup(
      shared,
    ) as import("@cantoo/pdf-lib").PDFDict;
    sharedDict.set(PDFName.of("Key#FF#80"), PDFName.of("Value#E9#23AA"));
    source.catalog.set(
      PDFName.of("Custom"),
      source.context.obj({
        First: shared,
        Second: shared,
        Text: PDFHexString.fromText("中文😀"),
      }),
    );
    // A source with a 2.0 header must keep its version semantics after writing.
    const bytes = await source.save();
    bytes.set(new TextEncoder().encode("2.0"), 5);
    const pdfium = await getPDFium();
    const nativeSource = new pdfium.PDFDocument(bytes);
    const sourceSpelling = nativeSource
      .getTrailer()
      .get("Root", "Custom", "First")
      .resolve()
      .toString();
    nativeSource.destroy();
    const document = await loadEditingDocument(bytes);
    const doc = new pdfium.PDFDocument(await saveEditingDocument(document));
    const custom = doc.getTrailer().get("Root", "Custom");
    try {
      expect(doc.getVersion()).toBe(20);
      expect(custom.get("First").resolve().toString()).toBe(sourceSpelling);
      expect(custom.get("First").asIndirect()).toBe(
        custom.get("Second").asIndirect(),
      );
      expect(custom.get("First", "Name").asName()).toBe("A/B C#D");
      expect(custom.get("First", "UnicodeName").asName()).toBe("MüPDF/中#41");
      expect([...custom.get("First", "Bytes").asByteString()]).toEqual([
        0, 255, 254, 128, 41, 40, 92,
      ]);
      expect(custom.get("Text").asString()).toBe("中文😀");
    } finally {
      custom.destroy();
      doc.destroy();
    }
  });

  it("encrypts with literal punctuation/unicode passwords and enforces the owner-password distinction", async () => {
    const source = await PDFDocument.create();
    source.addPage();
    const bytes = await saveEditingDocument(source, {
      security: {
        userPassword: "user,=密碼",
        ownerPassword: "owner,=密碼",
        permissions: 4 | 256,
      },
    });
    await expect(
      loadEditingDocument(bytes, { password: "wrong" }),
    ).rejects.toThrow(/password/);
    expect(await verifyPdfOwnerPassword(bytes, "user,=密碼")).toEqual({
      ok: false,
      reason: "incorrect_password",
    });
    expect(await verifyPdfOwnerPassword(bytes, "owner,=密碼")).toEqual({
      ok: true,
    });
    const pdfium = await getPDFium();
    const doc = new pdfium.PDFDocument(bytes);
    try {
      expect(doc.authenticatePassword("user,=密碼")).toBe(2);
      expect(getNativePermissions(doc)).toMatchObject({
        isEncrypted: true,
        canPrint: true,
        canFillForms: true,
        canModifyContents: false,
        canModifyAnnotations: false,
        canCopy: false,
        hasOwnerRestrictions: true,
      });
    } finally {
      doc.destroy();
    }
  });

  it.each([0, 90, 180, 270])(
    "aligns rendering, tiles and text coordinates for a cropped UserUnit page rotated %i degrees",
    async (rotation) => {
      const source = await PDFDocument.create();
      const p = source.addPage([400, 500]);
      p.setCropBox(40, 50, 300, 400);
      p.node.set(PDFName.of("UserUnit"), PDFNumber.of(2));
      p.setRotation(degrees(rotation));
      const font = await source.embedFont(StandardFonts.Helvetica);
      p.drawText("Native KEEP", { x: 70, y: 350, size: 20, font });
      p.drawRectangle({
        x: 80,
        y: 100,
        width: 60,
        height: 30,
        color: rgb(1, 0, 0),
      });
      const pdfium = await getPDFium();
      const doc = new pdfium.PDFDocument(await source.save());
      const page = doc.loadPage(0);
      try {
        const text = getNativeTextContent(pdfium, page, 0);
        const first = text.items.find(
          (item) => "str" in item && item.str.includes("Native"),
        );
        expect(first && "str" in first && first.transform[4]).toBeCloseTo(
          70,
          3,
        );
        expect(first && "str" in first && first.transform[5]).toBeCloseTo(
          350,
          3,
        );
        for (const uiRotation of [rotation, (rotation + 90) % 360]) {
          const viewport = getNativePageViewport(page, 1.5, uiRotation);
          const expected = createPdfLibViewport(p, {
            scale: 1.5,
            rotation: uiRotation,
          });
          expect(viewport.transform).toEqual(expected.transform);
          const full = rasterizePage(pdfium, page, viewport, [
            0,
            0,
            viewport.width,
            viewport.height,
          ]);
          const [x, y] = viewport
            .convertToViewportPoint(110, 115)
            .map(Math.floor);
          expect([
            ...full.pixels.slice(
              (y * full.width + x) * 4,
              (y * full.width + x) * 4 + 4,
            ),
          ]).toEqual([255, 0, 0, 255]);
          const tile = rasterizePage(pdfium, page, viewport, [
            x - 20,
            y - 20,
            x + 20,
            y + 20,
          ]);
          for (let row = 0; row < 40; row++)
            expect(tile.pixels.slice(row * 160, (row + 1) * 160)).toEqual(
              full.pixels.slice(
                ((y - 20 + row) * full.width + x - 20) * 4,
                ((y - 20 + row) * full.width + x + 20) * 4,
              ),
            );
        }
      } finally {
        disposeNativePage(page);
        doc.destroy();
      }
    },
  );

  it("keeps transparent overlays transparent and excludes widget/annotation appearances on base tiles", async () => {
    const source = await PDFDocument.create();
    const p = source.addPage([200, 200]);
    p.drawRectangle({
      x: 40,
      y: 100,
      width: 30,
      height: 30,
      color: rgb(1, 0, 0),
      opacity: 0.5,
    });
    const field = source.getForm().createTextField("name");
    field.setText("Visible");
    field.addToPage(p, { x: 40, y: 30, width: 100, height: 30 });
    const pdfium = await getPDFium();
    const doc = new pdfium.PDFDocument(await source.save());
    const page = doc.loadPage(0);
    try {
      const vp = getNativePageViewport(page);
      const base = rasterizePage(pdfium, page, vp, [0, 0, 200, 200], {
        transparent: true,
      });
      const all = rasterizePage(pdfium, page, vp, [0, 0, 200, 200], {
        transparent: true,
        annotations: true,
      });
      expect([...base.pixels.slice(0, 4)]).toEqual([0, 0, 0, 0]);
      const pixel = (80 * 200 + 50) * 4;
      expect(base.pixels[pixel]).toBe(255);
      expect(base.pixels[pixel + 3]).toBeGreaterThan(120);
      expect(base.pixels[pixel + 3]).toBeLessThan(135);
      const regionAlpha = (pixels: Uint8ClampedArray) => {
        let sum = 0;
        for (let y = 140; y < 171; y++)
          for (let x = 40; x < 141; x++) sum += pixels[(y * 200 + x) * 4 + 3];
        return sum;
      };
      expect(regionAlpha(base.pixels)).toBe(0);
      expect(regionAlpha(all.pixels)).toBeGreaterThan(0);
    } finally {
      disposeNativePage(page);
      doc.destroy();
    }
  });

  it("resolves outlines, named destinations and explicit page references", async () => {
    const source = await PDFDocument.create();
    source.addPage();
    const target = source.addPage();
    const context = source.context;
    const dest = context.obj([target.ref, PDFName.of("Fit")]);
    source.catalog.set(
      PDFName.of("Names"),
      context.obj({ Dests: { Names: [PDFString.of("chapter 2"), dest] } }),
    );
    const outline = context.register(context.obj({ Type: "Outlines" }));
    const item = context.register(
      context.obj({
        Title: PDFString.of("Second"),
        Parent: outline,
        Dest: dest,
      }),
    );
    source.catalog.set(PDFName.of("Outlines"), outline);
    const root = context.lookup(outline) as import("@cantoo/pdf-lib").PDFDict;
    root.set(PDFName.of("First"), item);
    root.set(PDFName.of("Last"), item);
    root.set(PDFName.of("Count"), PDFNumber.of(1));
    const pdfium = await getPDFium();
    const doc = new pdfium.PDFDocument(await source.save());
    try {
      expect(getNativeOutline(doc)).toEqual([
        { title: "Second", pageIndex: 1, items: [] },
      ]);
      expect(resolveNativeDestination(doc, "chapter 2")).toBe(1);
      expect(
        resolveNativeDestination(doc, [
          { num: target.ref.objectNumber, gen: 0 },
          { name: "Fit" },
        ]),
      ).toBe(1);
      expect(resolveNativeDestination(doc, [3])).toBeNull();
    } finally {
      doc.destroy();
    }
  });
});
