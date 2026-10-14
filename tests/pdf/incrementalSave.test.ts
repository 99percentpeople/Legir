import { expect, it } from "vitest";
import { PDFDocument, PDFRef, StandardFonts } from "@cantoo/pdf-lib";
import { exportPDFBlob } from "@/services/pdfService";
import { FieldType } from "@/types";
import { DocumentSession } from "@/services/pdfService/engine/documentSession";
import { getPDFium } from "@/services/pdfService/engine/runtime";

const asBytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
const hasOriginalPrefix = (output: Uint8Array, input: Uint8Array) =>
  output.length >= input.length &&
  input.every((value, index) => output[index] === value);
async function fixture(useObjectStreams = true) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc
    .addPage([300, 300])
    .drawText("Original body text", { font, x: 20, y: 200 });
  doc.addPage([300, 300]);
  const text = doc.getForm().createTextField("name");
  text.setText("Original value");
  text.addToPage(doc.getPage(0), { x: 20, y: 40, width: 200, height: 30 });
  const ref = text.acroField.Kids()!.get(0) as PDFRef;
  const field = {
    id: "name",
    name: "name",
    type: FieldType.TEXT,
    pageIndex: 0,
    rect: { x: 20, y: 230, width: 200, height: 30 },
    value: "Edited value",
    style: { fontFamily: "Helvetica", fontSize: 12 },
    sourcePdfRef: {
      objectNumber: ref.objectNumber,
      generationNumber: ref.generationNumber,
    },
  };
  return { bytes: await doc.save({ useObjectStreams }), field };
}

it.each([true, false])(
  "independently reopens appended metadata and edited fields (xref stream: %s)",
  async (useObjectStreams) => {
    const { bytes, field } = await fixture(useObjectStreams);
    const output = await asBytes(
      await exportPDFBlob(bytes, [field], { title: "Saved title" }),
    );
    expect(hasOriginalPrefix(output, bytes)).toBe(true);
    expect(new TextDecoder().decode(output.subarray(bytes.length))).toContain(
      "/Prev",
    );
    const reopened = await PDFDocument.load(output);
    expect(reopened.getPageCount()).toBe(2);
    expect(reopened.getTitle()).toBe("Saved title");
    expect(reopened.getForm().getTextField("name").getText()).toBe(
      "Edited value",
    );
    const next = await asBytes(
      await exportPDFBlob(output, [{ ...field, value: "Second value" }], {
        title: "Second title",
      }),
    );
    expect(hasOriginalPrefix(next, output)).toBe(true);
    const second = await PDFDocument.load(next);
    expect(second.getTitle()).toBe("Second title");
    expect(second.getForm().getTextField("name").getText()).toBe(
      "Second value",
    );
  },
);

it("rewrites compact saves, print flattening and deleted pages instead of keeping source history", async () => {
  const { bytes, field } = await fixture();
  const compact = await asBytes(
    await exportPDFBlob(bytes, [field], undefined, [], undefined, {
      incremental: false,
    }),
  );
  expect(hasOriginalPrefix(compact, bytes)).toBe(false);
  const print = await asBytes(
    await exportPDFBlob(bytes, [field], undefined, [], undefined, {
      flattenFormFields: true,
    }),
  );
  expect(hasOriginalPrefix(print, bytes)).toBe(false);
  expect((await PDFDocument.load(print)).getForm().getFields()).toHaveLength(0);
  const removed = await asBytes(
    await exportPDFBlob(bytes, [], undefined, [], undefined, {
      pageStructure: {
        pages: [
          {
            id: "keep-second",
            pageIndex: 0,
            width: 300,
            height: 300,
            rotation: 0,
            userUnit: 1,
            viewBox: [0, 0, 300, 300],
            source: { documentId: "default", pageIndex: 1 },
          },
        ],
        sources: {},
      },
    }),
  );
  expect(hasOriginalPrefix(removed, bytes)).toBe(false);
  expect((await PDFDocument.load(removed)).getPageCount()).toBe(1);
});

it("can cancel before export and retry without poisoning cached original bytes", async () => {
  const { bytes, field } = await fixture();
  const controller = new AbortController();
  controller.abort();
  await expect(
    exportPDFBlob(bytes, [field], undefined, [], undefined, {
      signal: controller.signal,
    }),
  ).rejects.toThrow();
  const output = await asBytes(await exportPDFBlob(bytes, [field]));
  expect(
    (await PDFDocument.load(output)).getForm().getTextField("name").getText(),
  ).toBe("Edited value");
});

it("reuses one owner for successive deltas and restores it after a cancelled save", async () => {
  const { bytes, field } = await fixture();
  const engine = await getPDFium();
  const owner = new DocumentSession(engine, bytes);
  const documents = engine.liveDocuments();
  const objects = owner.document.countObjects();
  try {
    for (const value of ["First value", "Second value"]) {
      const parts: Blob[] = [];
      let incremental = false;
      await owner.export(
        { fields: [{ ...field, value }], annotations: [] },
        undefined,
        {
          writeBlob: (blob) => {
            parts.push(blob);
          },
          onSaveMode: (mode) => {
            incremental = mode;
          },
        },
      );
      expect(incremental).toBe(true);
      const output = await asBytes(new Blob([bytes as BlobPart, ...parts]));
      const reopened = await PDFDocument.load(output);
      expect(reopened.getForm().getTextField("name").getText()).toBe(value);
      expect(engine.liveDocuments()).toBe(documents);
      expect(owner.document.countObjects()).toBe(objects);
    }
    const controller = new AbortController();
    await expect(
      owner.export({ fields: [field], annotations: [] }, controller.signal, {
        onSaveMode: (mode) => {
          expect(mode).toBe(true);
        },
        writeBlob: () => {
          controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(owner.document.saves.size).toBe(0);
    expect(owner.document.countObjects()).toBe(objects);
    const restored = await PDFDocument.load(
      await owner.export({
        fields: [],
        annotations: [],
        options: { syncFormFields: false },
      }),
    );
    expect(restored.getForm().getTextField("name").getText()).toBe(
      "Original value",
    );
    expect(engine.liveDocuments()).toBe(documents);
  } finally {
    owner.dispose();
  }
});
