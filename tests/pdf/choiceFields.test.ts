import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createPDFium, type PDFium } from "@legir/pdfium";
import {
  NativeEditingContext,
  PDFDropdown,
  PDFOptionList,
  PDFName,
  PDFArray,
  PDFNumber,
} from "@legir/pdfium/authoring";
import { DocumentSession } from "@legir/pdf-core";
import { FieldType, type FormField } from "@legir/pdf-model";
import { isListBoxField } from "@legir/pdf-model/choiceFields";
import { controlClipboardSchema } from "@/lib/controlClipboard/schema";

let engine: PDFium;
const views: NativeEditingContext[] = [];
const sessions: DocumentSession[] = [];
beforeAll(async () => {
  engine = await createPDFium();
});
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  for (const view of views.splice(0)) {
    view.dispose();
    view.native.destroy();
  }
  expect(engine.liveDocuments()).toBe(0);
});
const open = (bytes?: Uint8Array) => {
  const view = new NativeEditingContext(engine, new engine.PDFDocument(bytes));
  views.push(view);
  return view;
};
const session = (bytes: Uint8Array) => {
  const value = new DocumentSession(engine, bytes);
  sessions.push(value);
  return value;
};
const pixels = (view: NativeEditingContext) => {
  const page = view.native.loadPage(0);
  try {
    const bitmap = page.toPixmap([1, 0, 0, 1, 0, 0]);
    try {
      return createHash("sha256").update(bitmap.getPixels()).digest("hex");
    } finally {
      bitmap.destroy();
    }
  } finally {
    page.destroy();
  }
};
async function fixture() {
  const { document: doc } = open();
  const page = doc.addPage([420, 500]);
  const form = doc.getForm();
  const dropdown = form.createDropdown("dropdown");
  const single = form.createOptionList("single");
  const multiple = form.createOptionList("multiple");
  for (const [index, field] of [dropdown, single, multiple].entries()) {
    field.setOptions(["One", "Two", "Three"]);
    field.addToPage(page, {
      x: 30,
      y: 350 - 140 * index,
      width: 210,
      height: index ? 100 : 30,
    });
    field.select("Two");
  }
  multiple.enableMultiselect();
  multiple.select(["One", "Three"]);
  return await doc.save();
}

describe("independent choice presentation and selection mode", () => {
  it("recognizes legacy multi-select models without turning a single-select list into a combo", () => {
    expect(isListBoxField({ isMultiSelect: true })).toBe(true);
    expect(isListBoxField({ isListBox: true, isMultiSelect: false })).toBe(
      true,
    );
    expect(isListBoxField({ isMultiSelect: false })).toBe(false);
  });
  it("imports the Combo and MultiSelect flags independently", async () => {
    const model = await session(await fixture()).parse(
      {},
      async () => undefined,
    );
    expect(model.fields.find((f) => f.name === "dropdown")).toMatchObject({
      isListBox: false,
      isMultiSelect: false,
    });
    expect(model.fields.find((f) => f.name === "single")).toMatchObject({
      isListBox: true,
      isMultiSelect: false,
      value: "Two",
    });
    expect(model.fields.find((f) => f.name === "multiple")).toMatchObject({
      isListBox: true,
      isMultiSelect: true,
    });
  });
  it("preserves list-box type and selected values while saving reordered options", async () => {
    const source = session(await fixture());
    const model = await source.parse({}, async () => undefined);
    const reordered = ["Three", "Two", "One"];
    const fields = model.fields.map((f) => ({ ...f, options: reordered }));
    const bytes = await source.export({ fields, annotations: [] });
    const saved = open(bytes);
    const form = saved.document.getForm();
    expect(form.getField("single")).toBeInstanceOf(PDFOptionList);
    expect(form.getField("dropdown")).toBeInstanceOf(PDFDropdown);
    expect(form.getOptionList("single").isMultiselect()).toBe(false);
    expect(form.getOptionList("single").getOptions()).toEqual(reordered);
    expect(form.getOptionList("single").getSelected()).toEqual(["Two"]);
    const multiple = form.getOptionList("multiple");
    expect(multiple.getSelected()).toEqual(["One", "Three"]);
    expect(
      multiple.acroField.dict
        .lookup(PDFName.of("I"), PDFArray)
        .asArray()
        .map((n) => (n as PDFNumber).asNumber()),
    ).toEqual([0, 2]);
    const round = await session(bytes).parse({}, async () => undefined);
    expect(round.fields.find((f) => f.name === "single")?.isListBox).toBe(true);
    const flat = open(
      await source.export({
        fields,
        annotations: [],
        options: { flattenFormFields: true },
      }),
    );
    expect(flat.document.getForm().getFields()).toHaveLength(0);
    expect(pixels(flat)).toBe(pixels(saved));
  });
  it("keeps single-list presentation when multiselect is disabled and clears empty selections", async () => {
    const source = session(await fixture());
    const model = await source.parse({}, async () => undefined);
    const bytes = await source.export({
      fields: model.fields.map((f) =>
        f.name === "multiple"
          ? { ...f, isMultiSelect: false, value: "Two" }
          : { ...f, value: "" },
      ),
      annotations: [],
    });
    const form = open(bytes).document.getForm();
    expect(form.getOptionList("multiple").isMultiselect()).toBe(false);
    expect(form.getOptionList("multiple").getSelected()).toEqual(["Two"]);
    expect(form.getOptionList("single").getSelected()).toEqual([]);
  });
  it.each([true, false])(
    "converts choice presentation explicitly (list box = %s)",
    async (listBox) => {
      const source = session(await fixture());
      const model = await source.parse({}, async () => undefined);
      const target = listBox ? "dropdown" : "single";
      const bytes = await source.export({
        fields: model.fields.map((f) =>
          f.name === target ? { ...f, isListBox: listBox } : f,
        ),
        annotations: [],
      });
      expect(open(bytes).document.getForm().getField(target)).toBeInstanceOf(
        listBox ? PDFOptionList : PDFDropdown,
      );
    },
  );
  it("carries single-list mode through portable clipboard validation and new-field export", async () => {
    const input: FormField = {
      id: "list",
      name: "list",
      type: FieldType.DROPDOWN,
      pageIndex: 0,
      rect: { x: 20, y: 20, width: 180, height: 100 },
      isListBox: true,
      isMultiSelect: false,
      options: ["One", "Two"],
      value: "Two",
    };
    const clipboard = controlClipboardSchema.parse({
      version: 1,
      sourceDocumentId: "source",
      type: "field",
      data: input,
    });
    expect(clipboard.type === "field" && clipboard.data.isListBox).toBe(true);
    const blank = open();
    blank.document.addPage([300, 200]);
    const output = await session(await blank.document.save()).export({
      fields: [input],
      annotations: [],
    });
    const list = open(output).document.getForm().getOptionList("list");
    expect(list.isMultiselect()).toBe(false);
    expect(list.getSelected()).toEqual(["Two"]);
  });
});
