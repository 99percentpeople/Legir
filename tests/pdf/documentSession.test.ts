import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFName, StandardFonts } from "@cantoo/pdf-lib";
import type { ExportPdfRequest } from "@/services/pdfService/engine/sessionTypes";
import { DocumentSession } from "@/services/pdfService/engine/documentSession";
import { getPDFium } from "@/services/pdfService/engine/runtime";
import { disposeNativePage } from "@/services/pdfService/engine/raster";
import { getNativePageViewport } from "@/services/pdfService/engine/pageContent";

async function fixture(label: string) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 500]);
  page.drawText(label, {
    x: 40,
    y: 400,
    font: await doc.embedFont(StandardFonts.Helvetica),
  });
  const field = doc.getForm().createTextField("name");
  field.setText(label);
  field.addToPage(page, { x: 40, y: 200, width: 180, height: 30 });
  return doc.save();
}

function pageText(session: DocumentSession, id = "default") {
  const page = session.loadPage(id, 0);
  try {
    return page.extractText().text;
  } finally {
    disposeNativePage(page);
  }
}

describe("one native document session", () => {
  it("grafts only selected pages from an already-open donor and restores both documents on cancellation", async () => {
    const source = await PDFDocument.create();
    const pages = [0, 1, 2].map(() => source.addPage([200, 300]));
    const shared = source.getForm().createTextField("shared");
    shared.setText("kept");
    for (const page of pages)
      shared.addToPage(page, { x: 20, y: 30, width: 100, height: 20 });
    const excluded = source.context.register(
      source.context.flateStream("DO NOT COPY"),
    );
    pages[1].node.set(PDFName.of("ExcludedResource"), excluded);
    pages[0].node.set(PDFName.of("UnknownPageRef"), pages[1].ref);
    for (const [name, target] of [
      ["kept", 2],
      ["removed", 1],
    ] as const) {
      pages[0].node.addAnnot(
        source.context.register(
          source.context.obj({
            Type: "Annot",
            Subtype: "Link",
            Rect: [0, 0, 10, 10],
            NM: source.context.obj(name),
            Dest: [pages[target].ref, "XYZ", 10, 20, 2],
          }),
        ),
      );
    }
    const bytes = await source.save();
    const pdfium = await getPDFium();
    const donor = new pdfium.PDFDocument(bytes);
    const owner = new DocumentSession(pdfium, await fixture("Owner"));
    try {
      const before = pdfium.liveDocuments();
      await owner.addSource("selected", donor, undefined, {
        pageIndexes: [0, 2],
      });
      expect(pdfium.liveDocuments()).toBe(before);
      expect(owner.document.countPages()).toBe(3);
      expect(owner.getSource("selected").refs!.has(excluded.objectNumber)).toBe(
        false,
      );
      expect(donor.countPages()).toBe(3);
      const selectedPage = owner.document.findPage(
        owner.getSource("selected").pages[0],
      );
      const unknown = selectedPage.get("UnknownPageRef");
      const annots = selectedPage.get("Annots");
      try {
        expect(unknown.isNull()).toBe(true);
        const firstLink = annots.get(1),
          secondLink = annots.get(2);
        const kept = firstLink.get("Dest"),
          removed = secondLink.get("Dest");
        const target = kept.get(0),
          zoom = kept.get(4);
        const expectedTarget = owner.document.findPage(
          owner.getSource("selected").pages[1],
        );
        try {
          expect(target.asIndirect()).toBe(expectedTarget.asIndirect());
          expect(zoom.asNumber()).toBe(2);
          expect(removed.isNull()).toBe(true);
        } finally {
          firstLink.destroy();
          secondLink.destroy();
          kept.destroy();
          removed.destroy();
          target.destroy();
          zoom.destroy();
          expectedTarget.destroy();
        }
      } finally {
        annots.destroy();
        unknown.destroy();
        selectedPage.destroy();
      }
      const output = await owner.export({
        fields: [],
        annotations: [],
        options: {
          syncFormFields: false,
          pageStructure: {
            pages: [0, 1].map((pageIndex) => ({
              id: `selected-${pageIndex}`,
              pageIndex,
              width: 200,
              height: 300,
              viewBox: [0, 0, 200, 300],
              rotation: 0,
              userUnit: 1,
              source: { documentId: "selected", pageIndex },
            })),
            sources: {
              selected: {
                bytes,
                filename: "donor.pdf",
                password: null,
                pageIndexes: [0, 2],
              },
            },
          },
        },
      });
      const reopened = await PDFDocument.load(output);
      expect(reopened.getPageCount()).toBe(2);
      expect(reopened.getForm().getTextField("shared").getText()).toBe("kept");
      expect(
        reopened.getForm().getTextField("shared").acroField.getWidgets(),
      ).toHaveLength(2);
      const abort = new AbortController();
      setTimeout(() => abort.abort(), 0);
      await expect(
        owner.addSource("cancelled", donor, undefined, {
          pageIndexes: [0, 2],
          signal: abort.signal,
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(owner.sources.has("cancelled")).toBe(false);
      expect(owner.document.countPages()).toBe(3);
      expect(donor.countPages()).toBe(3);
      expect(pageText(owner)).toContain("Owner");
    } finally {
      donor.destroy();
      owner.dispose();
    }
  });

  it("rolls back an export when the chunk consumer fails or cancels, and can save again", async () => {
    const owner = new DocumentSession(
      await getPDFium(),
      await fixture("Original"),
    );
    const original = pageText(owner);
    try {
      const request = {
        fields: [],
        annotations: [],
        metadata: { title: "Export" },
      };
      await expect(
        owner.export(request, undefined, {
          writeChunk: () => {
            throw new Error("Disk full");
          },
        }),
      ).rejects.toThrow("Disk full");
      expect(pageText(owner)).toBe(original);
      const controller = new AbortController();
      await expect(
        owner.export(request, controller.signal, {
          writeChunk: () => {
            controller.abort();
          },
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(owner.document.saves.size).toBe(0);
      expect(
        (await PDFDocument.load(await owner.export(request))).getTitle(),
      ).toBe("Export");
      expect(pageText(owner)).toBe(original);
    } finally {
      owner.dispose();
    }
  });
  it("exports metadata without creating fonts or a form, preserving the cached native page", async () => {
    const source = await PDFDocument.create();
    source.setTitle("Original title");
    const font = await source.embedFont(StandardFonts.Helvetica);
    source.addPage([200, 200]).drawText("Preserved page", { font, size: 12 });
    const session = new DocumentSession(await getPDFium(), await source.save());
    const page = session.loadPage("default", 0);
    const count = session.document.countObjects();
    try {
      const original = page.extractText().text;
      const output = await session.export({
        fields: [],
        annotations: [],
        metadata: { title: "Updated title" },
        options: { syncFormFields: true },
      });
      expect(session.lastTransactionChanged).toBe(true);
      expect(session.lastTransactionAffectsRendering).toBe(false);
      expect(session.document.countObjects()).toBe(count);
      expect(page.extractText().text).toBe(original);
      const saved = await PDFDocument.load(output);
      expect(saved.getTitle()).toBe("Updated title");
      expect(saved.catalog.has(PDFName.of("AcroForm"))).toBe(false);
      expect(saved.getPageCount()).toBe(1);
    } finally {
      page.destroy();
      session.dispose();
    }
  });
  it("distinguishes read-only hydration from resource edits, including failed transactions", async () => {
    const session = new DocumentSession(
      await getPDFium(),
      await fixture("Retained"),
    );
    const page = session.loadPage("default", 0);
    const pixels = () => {
      const bitmap = page.toPixmap(session.pdfium.Matrix.scale(0.2, 0.2));
      try {
        return bitmap.getPixels().slice();
      } finally {
        bitmap.destroy();
      }
    };
    try {
      const original = pixels();
      const parsed = await session.parse({}, async () => undefined);
      expect(parsed.fields).toHaveLength(1);
      expect(session.lastTransactionChanged).toBe(false);
      expect(session.lastTransactionAffectsRendering).toBe(false);
      expect(pixels()).toEqual(original);
      await expect(
        session.transaction("default", async (view) => {
          view.catalog.delete(PDFName.of("AcroForm"));
          throw Error("Cancelled edit");
        }),
      ).rejects.toThrow("Cancelled edit");
      expect(session.lastTransactionChanged).toBe(true);
      expect(session.lastTransactionAffectsRendering).toBe(true);
      expect(pixels()).toEqual(original);
      await session.transaction("default", async () => {});
      expect(session.lastTransactionChanged).toBe(false);
      await session.transaction("default", async (view) => {
        view.setTitle("Metadata only");
      });
      expect(session.lastTransactionChanged).toBe(true);
      expect(session.lastTransactionAffectsRendering).toBe(false);
      expect(pixels()).toEqual(original);
    } finally {
      page.destroy();
      session.dispose();
    }
  });
  it("inspects inherited crop, rotation and scale without parsing page contents", async () => {
    const pdfium = await getPDFium();
    const doc = new pdfium.PDFDocument();
    let bytes: Uint8Array;
    try {
      const tree = doc.getTrailer().get("Root", "Pages");
      const page = doc.addObject({ Type: "Page" });
      tree.put("Kids", [page]);
      tree.put("Count", 1);
      tree.put("MediaBox", [10, 20, 610, 820]);
      tree.put("CropBox", [30, 50, 580, 780]);
      tree.put("Rotate", 270);
      tree.put("UserUnit", 2);
      page.put("Parent", tree);
      const saved = doc.saveToBuffer();
      try {
        bytes = saved.asUint8Array().slice();
      } finally {
        saved.destroy();
      }
    } finally {
      doc.destroy();
    }
    const session = new DocumentSession(pdfium, bytes!);
    try {
      const load = vi.spyOn(session.document, "loadPage");
      const inspected = await session.inspect();
      expect(load).not.toHaveBeenCalled();
      const page = session.loadPage("default", 0);
      try {
        const viewport = getNativePageViewport(page);
        expect(inspected.pages[0]).toMatchObject({
          width: viewport.width,
          height: viewport.height,
          viewBox: [30, 50, 580, 780],
          rotation: 270,
          userUnit: 2,
        });
      } finally {
        disposeNativePage(page);
      }
    } finally {
      session.dispose();
    }
  });

  it("shares OCR/text extraction and restores encryption state after password probes", async () => {
    const pdfium = await getPDFium();
    const encoder = new pdfium.PDFDocument(await fixture("Encrypted source"));
    let bytes: Uint8Array;
    try {
      const buffer = encoder.saveToBuffer({
        encrypt: "aes-256",
        "user-password": "reader",
        "owner-password": "owner",
      });
      try {
        bytes = buffer.asUint8Array().slice();
      } finally {
        buffer.destroy();
      }
    } finally {
      encoder.destroy();
    }
    const session = new DocumentSession(pdfium, bytes!, "reader");
    try {
      for (const [password, owner] of [
        ["wrong", false],
        ["reader", false],
        ["owner", true],
      ] as const) {
        expect(
          await session.content({
            operation: "verifyOwnerPassword",
            bytes: new Uint8Array(),
            password,
          }),
        ).toEqual({ encrypted: true, owner });
        expect(
          await session.content({
            operation: "extractText",
            bytes: new Uint8Array(),
            pageIndex: 0,
          }),
        ).toMatchObject({ text: expect.stringContaining("Encrypted source") });
      }
      expect(
        await session.content({
          operation: "renderOcrImage",
          bytes: new Uint8Array(),
          pageIndex: 0,
          dpi: 72,
        }),
      ).toMatchObject({ width: 400, height: 500, mimeType: "image/png" });
      expect(session.stats()).toMatchObject({
        nativeDocuments: 1,
        peakNativeDocuments: 1,
      });
    } finally {
      session.dispose();
    }
  });
  it("rolls back failed edits and releases imported/blank sources without disturbing retained pages", async () => {
    const session = new DocumentSession(
      await getPDFium(),
      await fixture("Original"),
    );
    try {
      const original = pageText(session);
      await expect(
        session.transaction("default", async (view) => {
          view.catalog.delete(PDFName.of("AcroForm"));
          view.removePage(0);
          throw new DOMException("Cancelled", "AbortError");
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(pageText(session)).toBe(original);
      expect(
        (await session.parse({}, async () => undefined)).fields,
      ).toHaveLength(1);
      session.addBlankSource("blank", 200, 300);
      await session.addSource("imported", await fixture("Retained"));
      session.removeSource("blank");
      expect(pageText(session, "imported")).toContain("Retained");
      session.removeSource("imported");
      expect(session.stats()).toMatchObject({ nativeDocuments: 1, sources: 1 });
      expect(pageText(session)).toBe(original);
      await session.addSource("imported", await fixture("Replacement"));
      expect(pageText(session, "imported")).toContain("Replacement");
    } finally {
      session.dispose();
    }
  });
  it("shares parsing, rendering and repeated export, restoring source state after every save", async () => {
    const session = new DocumentSession(
      await getPDFium(),
      await fixture("Alice"),
    );
    try {
      const original = pageText(session);
      const parsed = await session.parse({}, async () => undefined);
      for (const value of ["Bob", "Charlie"]) {
        const bytes = await session.export({
          fields: parsed.fields.map((field) => ({ ...field, value })),
          annotations: [],
          metadata: parsed.metadata,
        });
        const saved = await PDFDocument.load(bytes);
        expect(saved.getForm().getTextField("name").getText()).toBe(value);
        expect(pageText(session)).toBe(original);
        expect(
          (await session.parse({}, async () => undefined)).fields[0].value,
        ).toBe("Alice");
        expect(session.stats().nativeDocuments).toBe(1);
        expect(session.stats().peakNativeDocuments).toBe(1);
      }
    } finally {
      session.dispose();
    }
  });

  it.each([false, true])(
    "closes imported donors and retains source rendering after exporting reordered/copied pages (encrypted: %s)",
    async (encrypted) => {
      const pdfium = await getPDFium();
      const session = new DocumentSession(pdfium, await fixture("Original"));
      let bytes = await fixture("Imported");
      const password = encrypted ? "import-reader" : undefined;
      if (encrypted) {
        const encoder = new pdfium.PDFDocument(bytes);
        try {
          const output = encoder.saveToBuffer({
            encrypt: "aes-256",
            "user-password": password,
            "owner-password": "import-owner",
          });
          try {
            bytes = output.asUint8Array().slice();
          } finally {
            output.destroy();
          }
        } finally {
          encoder.destroy();
        }
      }
      try {
        await session.addSource("imported", bytes, password);
        expect(session.stats()).toMatchObject({
          nativeDocuments: 1,
          peakNativeDocuments: 2,
          sources: 2,
        });
        const original = pageText(session),
          imported = pageText(session, "imported");
        const request: ExportPdfRequest = {
          fields: [],
          annotations: [],
          options: {
            syncFormFields: false,
            pageStructure: {
              pages: [
                {
                  id: "b",
                  pageIndex: 0,
                  width: 400,
                  height: 500,
                  viewBox: [0, 0, 400, 500],
                  userUnit: 1,
                  rotation: 0,
                  source: { documentId: "imported", pageIndex: 0 },
                },
                {
                  id: "a",
                  pageIndex: 1,
                  width: 400,
                  height: 500,
                  viewBox: [0, 0, 400, 500],
                  userUnit: 1,
                  rotation: 0,
                  source: { documentId: "default", pageIndex: 0 },
                },
                {
                  id: "c",
                  pageIndex: 2,
                  width: 400,
                  height: 500,
                  viewBox: [0, 0, 400, 500],
                  userUnit: 1,
                  rotation: 0,
                  source: {
                    documentId: "default",
                    pageIndex: 0,
                    copyGroup: "copy",
                  },
                },
              ],
              sources: {
                imported: {
                  bytes,
                  password: password ?? null,
                  filename: "imported.pdf",
                },
              },
            },
          },
        };
        for (let i = 0; i < 2; i++) {
          const output = await session.export(request);
          const saved = await PDFDocument.load(output);
          expect(saved.getPageCount()).toBe(3);
          expect(saved.getForm().getFields()).toHaveLength(3);
          expect(pageText(session)).toBe(original);
          expect(pageText(session, "imported")).toBe(imported);
        }
      } finally {
        session.dispose();
      }
    },
  );
});
