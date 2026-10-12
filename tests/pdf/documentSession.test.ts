import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, StandardFonts } from "@cantoo/pdf-lib";
import type { ExportPdfRequest } from "@/services/pdfService/engine/sessionTypes";
import { DocumentSession } from "@/services/pdfService/engine/documentSession";
import { getPDFium } from "@/services/pdfService/engine/runtime";
import { disposeNativePage } from "@/services/pdfService/engine/raster";

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

  it("closes imported donors and retains source rendering after exporting reordered/copied pages", async () => {
    const session = new DocumentSession(
      await getPDFium(),
      await fixture("Original"),
    );
    const bytes = await fixture("Imported");
    try {
      await session.addSource("imported", bytes);
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
              imported: { bytes, password: null, filename: "imported.pdf" },
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
  });
});
