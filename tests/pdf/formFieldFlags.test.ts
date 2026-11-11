import { afterEach, beforeAll, expect, it } from "vitest";
import { createPDFium, type PDFium } from "@legir/pdfium";
import { NativeEditingContext } from "@legir/pdfium/authoring";
import { DocumentSession } from "@legir/pdf-core";
import { FieldType, type FormField } from "@legir/pdf-model";
let engine: PDFium;
const views: NativeEditingContext[] = [];
const sessions: DocumentSession[] = [];
beforeAll(async () => {
  engine = await createPDFium();
});
afterEach(() => {
  sessions.splice(0).forEach((s) => s.dispose());
  views.splice(0).forEach((v) => {
    v.dispose();
    v.native.destroy();
  });
  expect(engine.liveDocuments()).toBe(0);
});
const open = (bytes?: Uint8Array) => {
  const view = new NativeEditingContext(engine, new engine.PDFDocument(bytes));
  views.push(view);
  return view.document;
};
const session = (bytes: Uint8Array) => {
  const s = new DocumentSession(engine, bytes);
  sessions.push(s);
  return s;
};
it("persists required/read-only flags for new and imported ordinary fields and allows clearing them", async () => {
  const source = open();
  source.addPage([600, 800]);
  const kinds = [
    FieldType.TEXT,
    FieldType.CHECKBOX,
    FieldType.RADIO,
    FieldType.DROPDOWN,
    FieldType.DROPDOWN,
  ];
  const fields: FormField[] = kinds.map((type, i) => ({
    id: `f${i}`,
    name: `f${i}`,
    type,
    pageIndex: 0,
    rect: { x: 20, y: 20 + i * 100, width: 140, height: 50 },
    options: ["One", "Two"],
    isListBox: i === 4,
    radioValue: "One",
    required: true,
    readOnly: true,
    style: { fontSize: 12, borderWidth: 1 },
  }));
  const created = await session(await source.save()).export({
    fields,
    annotations: [],
    options: { incremental: false },
  });
  for (const f of open(created).getForm().getFields()) {
    expect(f.isRequired()).toBe(true);
    expect(f.isReadOnly()).toBe(true);
  }
  const imported = session(created);
  const model = await imported.parse({}, async () => undefined);
  expect(model.fields).toHaveLength(5);
  expect(model.fields.every((f) => f.required && f.readOnly)).toBe(true);
  const cleared = await imported.export({
    fields: model.fields.map((f) => ({
      ...f,
      required: false,
      readOnly: false,
      style: {
        ...f.style,
        fontSize: 18,
        fontFamily: "Courier",
        textColor: "#008800",
        backgroundColor: "#ffff00",
        isTransparent: false,
        borderWidth: 4,
      },
    })),
    annotations: [],
    options: { incremental: false },
  });
  const result = await session(cleared).parse({}, async () => undefined);
  expect(
    result.fields.every(
      (f) =>
        f.style?.borderWidth === 4 && f.style?.backgroundColor === "#ffff00",
    ),
  ).toBe(true);
  for (const field of result.fields.filter(
    (f) => f.type === FieldType.TEXT || f.type === FieldType.DROPDOWN,
  )) {
    expect(field.style).toMatchObject({
      fontSize: 18,
      fontFamily: "Courier",
      textColor: "#008800",
    });
  }
  for (const f of open(cleared).getForm().getFields()) {
    expect(f.isRequired()).toBe(false);
    expect(f.isReadOnly()).toBe(false);
  }
});
