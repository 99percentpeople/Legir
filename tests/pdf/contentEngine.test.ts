import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import fontkit from "pdf-fontkit";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  degrees,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
  StandardFonts,
  rgb,
} from "@cantoo/pdf-lib";
import type { Annotation } from "@/types";
import { exportPDF, loadPDF } from "@/services/pdfService";
import type { PDFWorkerService } from "@/services/pdfService/pdfWorkerService";
import { createEditorView } from "@/store/editorView";
import { getPageId } from "@/services/pdfService/lib/pageStructure";
import { pdfContentEngine } from "@/services/pdfService/engine";
import type { PdfQuad } from "@/services/pdfService/engine/types";
import { applyTextRedactionsUnderFlattenedFreetext } from "@/services/pdfService/lib/textRedaction";
import { createPdfLibViewport } from "@/services/pdfService/lib/coords";

afterEach(() => vi.restoreAllMocks());

const quad = (x: number, y: number, width: number, height: number): PdfQuad => [
  x,
  y + height,
  x + width,
  y + height,
  x,
  y,
  x + width,
  y,
];

const readText = async (
  bytes: Uint8Array,
  pageIndex = 0,
  password?: string,
) => {
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    password,
    useSystemFonts: true,
  });
  const doc = await task.promise;
  try {
    const content = await (await doc.getPage(pageIndex + 1)).getTextContent();
    return content.items
      .filter((item) => "str" in item)
      .map((item) => ({ text: item.str, transform: item.transform }));
  } finally {
    await task.destroy();
  }
};

const fixture = async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 500]);
  page.drawText("REMOVE KEEP", { x: 70, y: 350, size: 20, font });
  return { doc, page, font, width: font.widthOfTextAtSize("REMOVE", 20) };
};

const annotationFor = (
  page: ReturnType<PDFDocument["getPage"]>,
  region: PdfQuad,
  pageIndex = 0,
): Annotation => {
  const viewport = createPdfLibViewport(page);
  const points = [0, 2, 4, 6].map((i) =>
    viewport.convertToViewportPoint(region[i], region[i + 1]),
  );
  const xs = points.map(([x]) => x),
    ys = points.map(([, y]) => y);
  return {
    id: "replacement",
    type: "freetext",
    pageIndex,
    flatten: true,
    text: "NEW",
    size: 12,
    fontFamily: "Helvetica",
    rect: {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    },
  };
};

const apply = (doc: PDFDocument, annotations: Annotation[]) =>
  applyTextRedactionsUnderFlattenedFreetext({
    pdfDoc: doc,
    pages: doc.getPages(),
    annotations,
    getViewportForPage: async (index) =>
      createPdfLibViewport(doc.getPage(index)),
  });

describe("MuPDF content engine", () => {
  it("removes only the requested part of a text operator and preserves following glyph positions", async () => {
    const { doc, width } = await fixture();
    const bytes = await doc.save();
    const before = await pdfContentEngine.extractText({ bytes, pageIndex: 0 });
    const output = await pdfContentEngine.redactText({
      bytes,
      regions: [{ pageIndex: 0, quad: quad(70, 344, width, 29) }],
    });
    const text = (await readText(output)).map((item) => item.text).join("");
    expect(text).not.toContain("REMOVE");
    expect(text).toContain("KEEP");
    const after = await pdfContentEngine.extractText({
      bytes: output,
      pageIndex: 0,
    });
    const originBefore = before.lines
      .flatMap((line) => line.glyphs)
      .find((glyph) => glyph.text === "K")!.origin;
    const originAfter = after.lines
      .flatMap((line) => line.glyphs)
      .find((glyph) => glyph.text === "K")!.origin;
    expect(originAfter[0]).toBeCloseTo(originBefore[0], 3);
    expect(originAfter[1]).toBeCloseTo(originBefore[1], 3);
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect((await readText(bytes)).map((item) => item.text).join("")).toContain(
      "REMOVE KEEP",
    );
  });

  it.each([0, 90, 180, 270])(
    "maps crop offsets, UserUnit and %i degree page rotation",
    async (rotation) => {
      const { doc, page, width } = await fixture();
      page.setCropBox(40, 50, 300, 400);
      page.setRotation(degrees(rotation));
      page.node.set(PDFName.of("UserUnit"), PDFNumber.of(2));
      const a = annotationFor(page, quad(70, 344, width, 29));
      await apply(doc, [a]);
      const output = await doc.save();
      expect((await readText(output)).map((item) => item.text).join("")).toBe(
        "KEEP",
      );
      const reopened = await PDFDocument.load(output);
      expect(reopened.getPage(0).getRotation().angle).toBe(rotation);
      expect(reopened.getPage(0).getCropBox()).toEqual({
        x: 40,
        y: 50,
        width: 300,
        height: 400,
      });
      expect(
        reopened
          .getPage(0)
          .node.lookup(PDFName.of("UserUnit"), PDFNumber)
          .asNumber(),
      ).toBe(2);
    },
  );

  it("preserves shared form instances on the same page and other pages", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const form = doc.context.register(
      doc.context.flateStream("BT /F1 20 Tf 10 30 Td (REMOVE KEEP) Tj ET", {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, 300, 60],
        Resources: { Font: { F1: font.ref } },
      }),
    );
    for (let i = 0; i < 2; i++) {
      const page = doc.addPage([400, 500]);
      page.node.set(
        PDFName.of("Resources"),
        doc.context.obj({ XObject: { Shared: form } }),
      );
      page.node.set(
        PDFName.of("Contents"),
        doc.context.register(
          doc.context.flateStream(
            "q 1 0 0 1 20 300 cm /Shared Do Q q 1 0 0 1 20 100 cm /Shared Do Q",
          ),
        ),
      );
    }
    await apply(doc, [
      annotationFor(
        doc.getPage(0),
        quad(30, 324, font.widthOfTextAtSize("REMOVE", 20), 29),
      ),
    ]);
    const bytes = await doc.save();
    expect((await readText(bytes)).map((item) => item.text).join(" ")).toBe(
      "KEEP REMOVE KEEP",
    );
    expect((await readText(bytes, 1)).map((item) => item.text).join(" ")).toBe(
      "REMOVE KEEP REMOVE KEEP",
    );
  });

  it("retains original resource references, form widgets, links and optional-content identity", async () => {
    const { doc, page, font, width } = await fixture();
    const field = doc.getForm().createTextField("name");
    field.setText("Alice");
    field.addToPage(page, { x: 60, y: 300, width: 150, height: 22 });
    const widgetRef = field.acroField.Kids()!.get(0);
    const layerRef = doc.context.register(
      doc.context.obj({ Type: "OCG", Name: PDFString.of("Source layer") }),
    );
    doc.catalog.set(
      PDFName.of("OCProperties"),
      doc.context.obj({
        OCGs: [layerRef],
        D: { Order: [layerRef], ON: [layerRef] },
      }),
    );
    const resources = page.node.Resources()!;
    resources.set(
      PDFName.of("Properties"),
      doc.context.obj({ Layer: layerRef }),
    );
    const originalContents = page.node.Contents()!;
    page.node.set(
      PDFName.of("Contents"),
      doc.context.obj([
        doc.context.register(doc.context.flateStream("/OC /Layer BDC")),
        ...("asArray" in originalContents
          ? originalContents.asArray()
          : [originalContents]),
        doc.context.register(doc.context.flateStream("EMC")),
      ]),
    );
    const linkRef = doc.context.register(
      doc.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [70, 344, 200, 373],
        P: page.ref,
        A: { S: "URI", URI: PDFString.of("https://example.com") },
      }),
    );
    page.node.addAnnot(linkRef);
    const originalAnnots = page.node.Annots()!.asArray().map(String);
    await apply(doc, [annotationFor(page, quad(70, 344, width, 29))]);
    expect(page.node.Annots()!.asArray().map(String)).toEqual(originalAnnots);
    const fontRefs = page.node
      .Resources()!
      .lookup(PDFName.of("Font"), PDFDict)
      .values();
    expect(fontRefs).toContainEqual(font.ref);
    const properties = page.node
      .Resources()!
      .lookup(PDFName.of("Properties"), PDFDict);
    expect(properties.values()).toContainEqual(layerRef);
    const reopened = await PDFDocument.load(
      await doc.save({ updateFieldAppearances: false }),
    );
    expect(reopened.getForm().getTextField("name").getText()).toBe("Alice");
    expect(
      reopened.getForm().getTextField("name").acroField.Kids()!.get(0),
    ).toEqual(widgetRef);
    expect(reopened.getPage(0).node.Annots()!.asArray().map(String)).toEqual(
      originalAnnots,
    );
  });

  it("exports replacement text with the original form and final encryption intact", async () => {
    const { doc, page, width } = await fixture();
    const field = doc.getForm().createTextField("name");
    field.setText("Alice");
    field.addToPage(page, { x: 60, y: 300, width: 150, height: 22 });
    doc.encrypt({ userPassword: "old-pass", ownerPassword: "old-pass" });
    const output = await exportPDF(
      await doc.save(),
      [],
      undefined,
      [annotationFor(page, quad(70, 344, width, 29))],
      undefined,
      { openPassword: "old-pass", exportPassword: "new-pass" },
    );
    const reopened = await PDFDocument.load(output, { password: "new-pass" });
    expect(reopened.getForm().getTextField("name").getText()).toBe("Alice");
    const text = (await readText(output, 0, "new-pass"))
      .map((item) => item.text)
      .join(" ");
    expect(text).toContain("KEEP");
    expect(text).toContain("NEW");
    expect(text).not.toContain("REMOVE");
  });

  it("uses real CJK font metrics instead of byte-length estimates", async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(
      new Uint8Array(await readFile("public/fonts/NotoSansSC-Regular.ttf")),
      { subset: true },
    );
    const page = doc.addPage([400, 300]);
    page.drawText("删除保留", { x: 30, y: 200, size: 20, font });
    await apply(doc, [
      annotationFor(
        page,
        quad(30, 196, font.widthOfTextAtSize("删除", 20), 25),
      ),
    ]);
    expect(
      (await readText(await doc.save())).map((item) => item.text).join(""),
    ).toBe("保留");
  });

  it("renders model input with bounded pixels and a crop/rotation-aware inverse transform", async () => {
    const { doc, page } = await fixture();
    page.setCropBox(40, 50, 300, 400);
    page.setRotation(degrees(90));
    page.node.set(PDFName.of("UserUnit"), PDFNumber.of(2));
    const bytes = await doc.save();
    const result = await pdfContentEngine.renderOcrImage({
      bytes,
      pageIndex: 0,
      dpi: 144,
      maxPixels: 480_000,
    });
    expect(result.width * result.height).toBeLessThanOrEqual(480_000);
    expect([...result.bytes.slice(0, 8)]).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    expect(result.pixelToPdf[4]).toBeCloseTo(40);
    expect(result.pixelToPdf[5]).toBeCloseTo(50);
    const native = await pdfContentEngine.extractText({ bytes, pageIndex: 0 });
    expect(native.lines[0].glyphs[0].origin[0]).toBeCloseTo(70);
    expect(native.lines[0].glyphs[0].origin[1]).toBeCloseTo(350);
    expect(native.lines[0].glyphs[0].fontSize).toBeCloseTo(20);
  });

  it("rejects wrong passwords, invalid pages/resolution, and canceled jobs", async () => {
    const { doc } = await fixture();
    doc.encrypt({ userPassword: "secret", ownerPassword: "secret" });
    const bytes = await doc.save();
    await expect(
      pdfContentEngine.extractText({ bytes, pageIndex: 0 }),
    ).rejects.toThrow(/password/);
    expect(
      (
        await pdfContentEngine.extractText({
          bytes,
          password: "secret",
          pageIndex: 0,
        })
      ).text,
    ).toContain("REMOVE KEEP");
    await expect(
      pdfContentEngine.extractText({ bytes, password: "secret", pageIndex: 8 }),
    ).rejects.toThrow(/page index/);
    await expect(
      pdfContentEngine.renderOcrImage({
        bytes,
        password: "secret",
        pageIndex: 0,
        dpi: Infinity,
      }),
    ).rejects.toThrow(/resolution/);
    await expect(
      pdfContentEngine.extractText(
        { bytes, pageIndex: 0 },
        AbortSignal.abort(),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("fails export if text removal fails instead of silently retaining old text", async () => {
    const { doc, page, width } = await fixture();
    const mupdf = await import("mupdf");
    vi.spyOn(
      mupdf.PDFAnnotation.prototype,
      "applyRedaction",
    ).mockImplementation(() => {
      throw new Error("Engine unavailable");
    });
    await expect(
      exportPDF(await doc.save(), [], undefined, [
        annotationFor(page, quad(70, 344, width, 29)),
      ]),
    ).rejects.toThrow("Engine unavailable");
    expect(
      (await readText(await doc.save())).map((item) => item.text).join(""),
    ).toContain("REMOVE KEEP");
  });

  it("keeps image resources and pixels outside the removed text unchanged", async () => {
    const mupdf = await import("mupdf");
    const bitmap = new mupdf.Pixmap(
      mupdf.ColorSpace.DeviceRGB,
      [0, 0, 2, 2],
      false,
    );
    bitmap.clear(200);
    const png = new Uint8Array(bitmap.asPNG());
    bitmap.destroy();
    const doc = await PDFDocument.create();
    const image = await doc.embedPng(png);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 500]);
    page.drawImage(image, { x: 0, y: 0, width: 400, height: 500 });
    page.drawLine({
      start: { x: 0, y: 360 },
      end: { x: 400, y: 360 },
      thickness: 2,
      color: rgb(0, 0, 1),
    });
    page.drawText("REMOVE KEEP", { x: 70, y: 350, size: 20, font });
    const width = font.widthOfTextAtSize("REMOVE", 20);
    const raster = (bytes: Uint8Array) => {
      const nativeDoc = new mupdf.PDFDocument(bytes);
      const nativePage = nativeDoc.loadPage(0);
      const pixmap = nativePage.toPixmap(
        mupdf.Matrix.identity,
        mupdf.ColorSpace.DeviceRGB,
        false,
        false,
      );
      try {
        return pixmap.getPixels().slice();
      } finally {
        pixmap.destroy();
        nativePage.destroy();
        nativeDoc.destroy();
      }
    };
    const before = raster(await doc.save());
    await apply(doc, [annotationFor(page, quad(70, 344, width, 29))]);
    const after = raster(await doc.save());
    expect(
      page.node.Resources()!.lookup(PDFName.of("XObject"), PDFDict).values(),
    ).toContainEqual(image.ref);
    let changedInside = 0,
      changedOutside = 0;
    for (let y = 0; y < 500; y++)
      for (let x = 0; x < 400; x++) {
        const changed = [0, 1, 2].some(
          (c) => before[(y * 400 + x) * 3 + c] !== after[(y * 400 + x) * 3 + c],
        );
        if (!changed) continue;
        if (x >= 70 && x <= 70 + width && y >= 127 && y <= 156) changedInside++;
        else changedOutside++;
      }
    expect(changedInside).toBeGreaterThan(0);
    expect(changedOutside).toBe(0);
    // Blue line through the replacement region survives text removal.
    expect([
      ...after.slice((140 * 400 + 80) * 3, (140 * 400 + 80) * 3 + 3),
    ]).toEqual([0, 0, 255]);
  });

  it("does not apply an existing pending redaction when replacing other text", async () => {
    const { doc, page, font, width } = await fixture();
    const x = 70 + font.widthOfTextAtSize("REMOVE ", 20);
    const pending = doc.context.register(
      doc.context.obj({
        Type: "Annot",
        Subtype: "Redact",
        Rect: [x, 344, x + 60, 373],
        P: page.ref,
      }),
    );
    page.node.addAnnot(pending);
    const output = await pdfContentEngine.redactText({
      bytes: await doc.save(),
      regions: [{ pageIndex: 0, quad: quad(70, 344, width, 29) }],
    });
    expect((await readText(output)).map((item) => item.text).join("")).toBe(
      "KEEP",
    );
    const reopened = await PDFDocument.load(output);
    expect(reopened.getPage(0).node.Annots()!.asArray()).toContainEqual(
      pending,
    );
  });

  it("redacts a duplicated page independently and supports selected-page export", async () => {
    const { doc, page, width } = await fixture();
    const bytes = await doc.save();
    const workerService = {
      loadDocument: async () => true,
      resolveDest: async () => null,
      getOutline: async () => [],
      getPermissions: async () => null,
    } as unknown as PDFWorkerService;
    const loaded = await loadPDF(bytes, { workerService });
    const store = createEditorView({ state: loaded });
    try {
      store.getState().duplicatePages(store.getState().pages.map(getPageId));
      const state = store.getState();
      const replacement = annotationFor(page, quad(70, 344, width, 29), 1);
      const output = await exportPDF(
        bytes,
        [],
        undefined,
        [replacement],
        undefined,
        {
          pageStructure: { pages: state.pages, sources: state.pageSources },
        },
      );
      expect(
        (await readText(output, 0)).map((item) => item.text).join(""),
      ).toContain("REMOVE KEEP");
      expect(
        (await readText(output, 1)).map((item) => item.text).join(""),
      ).not.toContain("REMOVE");
      const selected = await exportPDF(
        bytes,
        [],
        undefined,
        [replacement],
        undefined,
        {
          pageStructure: { pages: state.pages, sources: state.pageSources },
          pageIndexes: [1],
        },
      );
      expect((await PDFDocument.load(selected)).getPageCount()).toBe(1);
      expect(
        (await readText(selected)).map((item) => item.text).join(" "),
      ).toContain("NEW");
    } finally {
      loaded.dispose();
    }
  });
});
