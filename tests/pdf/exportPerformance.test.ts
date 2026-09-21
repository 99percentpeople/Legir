import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFForm,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFRawStream,
  PDFStream,
  decodePDFRawStream,
  PDFTextField,
  StandardFonts,
} from "@cantoo/pdf-lib";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { exportPDF } from "@/services/pdfService";
import { FieldType, type FormField } from "@/types";

const toSourceRef = (ref: PDFRef) => ({
  objectNumber: ref.objectNumber,
  generationNumber: ref.generationNumber,
});

const widgetRef = (
  field: { acroField: { Kids: () => PDFArray | undefined } },
  index = 0,
) => {
  const ref = field.acroField.Kids()?.get(index);
  if (!(ref instanceof PDFRef)) throw new Error("Expected widget reference");
  return toSourceRef(ref);
};

const rect = { x: 30, y: 30, width: 180, height: 24 };
const style = { fontFamily: "Helvetica", fontSize: 12 };

afterEach(() => vi.restoreAllMocks());

describe("form export work scales with fields, not repeated tree scans", () => {
  it("does not build an unused index when there are no editor fields", async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 300]);
    const bytes = await source.save();
    const lookups = vi.spyOn(PDFForm.prototype, "getFields");
    await exportPDF(bytes, []);
    expect(lookups).toHaveBeenCalledTimes(1);
  });

  it("tolerates unrelated malformed annotation arrays when field sync is disabled", async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 300]);
    source
      .addPage([300, 300])
      .node.set(PDFName.of("Annots"), PDFName.of("Invalid"));
    const bytes = await source.save({ updateFieldAppearances: false });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const output = await exportPDF(
      bytes,
      [
        {
          id: "name",
          name: "name",
          type: FieldType.TEXT,
          pageIndex: 0,
          rect,
          style,
          value: "Valid value",
        },
      ],
      undefined,
      [],
      undefined,
      { syncFormFields: false },
    );
    const reopened = await PDFDocument.load(output);
    expect(reopened.getForm().getTextField("name").getText()).toBe(
      "Valid value",
    );
  });

  it.each([false, true])(
    "indexes fields once when exporting many controls (imported=%s)",
    async (imported) => {
      const source = await PDFDocument.create();
      const pages = Array.from({ length: 3 }, () => source.addPage([300, 800]));
      const fields: FormField[] = [];
      for (let index = 0; index < 60; index++) {
        const pageIndex = Math.floor(index / 20);
        const name = `field_${index}`;
        const bounds = { ...rect, y: 20 + (index % 20) * 35 };
        let sourcePdfRef: FormField["sourcePdfRef"];
        if (imported) {
          const text = source.getForm().createTextField(name);
          text.addToPage(pages[pageIndex], {
            ...bounds,
            y: 800 - bounds.y - bounds.height,
          });
          sourcePdfRef = widgetRef(text);
        }
        fields.push({
          id: name,
          name,
          type: FieldType.TEXT,
          pageIndex,
          rect: bounds,
          style,
          value: `Value ${index}`,
          sourcePdfRef,
        });
      }
      const bytes = await source.save({ updateFieldAppearances: false });
      const lookups = vi.spyOn(PDFForm.prototype, "getFields");
      const output = await exportPDF(bytes, fields);
      // Orphan cleanup, field cleanup, and the export-local index. No scan per control.
      expect(lookups.mock.calls.length).toBeLessThanOrEqual(3);
      lookups.mockRestore();
      const reopened = await PDFDocument.load(output);
      const exportedFields = reopened.getForm().getFields();
      expect(exportedFields).toHaveLength(60);
      for (const [index, field] of exportedFields.entries()) {
        expect((field as PDFTextField).getText()).toBe(`Value ${index}`);
        expect(field.acroField.getWidgets()).toHaveLength(1);
      }
    },
  );

  it.each([false, true])(
    "generates shared text appearances once after all widgets are updated (flatten=%s)",
    async (flatten) => {
      const source = await PDFDocument.create();
      const pages = [source.addPage([300, 300]), source.addPage([300, 300])];
      const font = await source.embedFont(StandardFonts.Helvetica);
      const text = source.getForm().createTextField("shared");
      const fields: FormField[] = [];
      for (let index = 0; index < 6; index++) {
        const pageIndex = Math.floor(index / 3);
        text.addToPage(pages[pageIndex], {
          x: 20,
          y: 230 - (index % 3) * 50,
          width: 120,
          height: 20,
          font,
        });
        fields.push({
          id: `shared_${index}`,
          name: "shared",
          type: FieldType.TEXT,
          pageIndex,
          rect: { ...rect, x: 50, y: 20 + (index % 3) * 60 },
          style,
          value: `Final ${index}`,
          sourcePdfRef: widgetRef(text, index),
        });
      }
      const bytes = await source.save({ updateFieldAppearances: false });
      const appearances = vi.spyOn(PDFTextField.prototype, "updateAppearances");
      const output = await exportPDF(bytes, fields, undefined, [], undefined, {
        flattenFormFields: flatten,
      });
      expect(appearances).toHaveBeenCalledTimes(1);
      appearances.mockRestore();
      const reopened = await PDFDocument.load(output);
      if (flatten) {
        expect(reopened.getForm().getFields()).toHaveLength(0);
        const task = pdfjsLib.getDocument({ data: new Uint8Array(output) });
        const document = await task.promise;
        try {
          for (let pageNumber = 1; pageNumber <= 2; pageNumber++) {
            const page = await document.getPage(pageNumber);
            const content = await page.getTextContent();
            expect(
              content.items.filter(
                (item) => "str" in item && item.str === "Final 5",
              ),
            ).toHaveLength(3);
          }
        } finally {
          await task.destroy();
        }
      } else {
        const exported = reopened.getForm().getTextField("shared");
        expect(exported.getText()).toBe("Final 5");
        const widgets = exported.acroField.getWidgets();
        expect(widgets).toHaveLength(6);
        for (const [index, widget] of widgets.entries()) {
          const bounds = fields[index].rect;
          expect(widget.getRectangle()).toEqual({
            ...bounds,
            y: 300 - bounds.y - bounds.height,
          });
          const appearance = widget.getAppearances()?.normal;
          expect(appearance).toBeInstanceOf(PDFStream);
          if (!(appearance instanceof PDFRawStream))
            throw new Error("Expected saved appearance stream");
          const content = new TextDecoder().decode(
            decodePDFRawStream(appearance).decode(),
          );
          expect(content).toContain(font.encodeText("Final 5").toString());
        }
        // Six original appearances plus six replacements, not six full regenerations.
        const streamCount = reopened.context
          .enumerateIndirectObjects()
          .filter(([, object]) => object instanceof PDFStream).length;
        expect(streamCount).toBeLessThanOrEqual(12);
      }
    },
  );

  it("batches shared checkbox, radio, dropdown and option-list appearances", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([600, 800]);
    const form = source.getForm();
    const checkbox = form.createCheckBox("checkbox");
    const radio = form.createRadioGroup("radio");
    const dropdown = form.createDropdown("dropdown");
    const list = form.createOptionList("list");
    dropdown.setOptions(["One", "Two"]);
    list.setOptions(["One", "Two"]);
    list.enableMultiselect();
    const fields: FormField[] = [];
    for (let index = 0; index < 3; index++) {
      const bounds = { ...rect, y: 30 + index * 40 };
      const opts = { ...bounds, y: 800 - bounds.y - bounds.height };
      checkbox.addToPage(page, { ...opts, width: 20 });
      radio.addOptionToPage(`Choice_${index}`, page, {
        ...opts,
        x: 70,
        width: 20,
      });
      dropdown.addToPage(page, { ...opts, x: 120 });
      list.addToPage(page, { ...opts, x: 330 });
      fields.push(
        {
          id: `cb_${index}`,
          name: "checkbox",
          type: FieldType.CHECKBOX,
          pageIndex: 0,
          rect: { ...bounds, width: 20 },
          isChecked: true,
          sourcePdfRef: widgetRef(checkbox, index),
        },
        {
          id: `radio_${index}`,
          name: "radio",
          type: FieldType.RADIO,
          pageIndex: 0,
          rect: { ...bounds, x: 70, width: 20 },
          isChecked: index === 2,
          radioValue: `Choice_${index}`,
          sourcePdfRef: widgetRef(radio, index),
        },
        {
          id: `dd_${index}`,
          name: "dropdown",
          type: FieldType.DROPDOWN,
          pageIndex: 0,
          rect: { ...bounds, x: 120 },
          options: ["One", "Two"],
          value: "Two",
          sourcePdfRef: widgetRef(dropdown, index),
        },
        {
          id: `list_${index}`,
          name: "list",
          type: FieldType.DROPDOWN,
          isMultiSelect: true,
          pageIndex: 0,
          rect: { ...bounds, x: 330 },
          options: ["One", "Two"],
          value: "One\nTwo",
          sourcePdfRef: widgetRef(list, index),
        },
      );
    }
    const bytes = await source.save({ updateFieldAppearances: false });
    const spies = [PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList].map(
      (type) => vi.spyOn(type.prototype, "updateAppearances"),
    );
    const output = await exportPDF(bytes, fields);
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
    const reopened = (await PDFDocument.load(output)).getForm();
    expect(reopened.getCheckBox("checkbox").isChecked()).toBe(true);
    expect(reopened.getRadioGroup("radio").getSelected()).toBe("Choice_2");
    expect(reopened.getDropdown("dropdown").getSelected()).toEqual(["Two"]);
    expect(reopened.getOptionList("list").getSelected()).toEqual([
      "One",
      "Two",
    ]);
    for (const field of reopened.getFields()) {
      expect(field.acroField.getWidgets()).toHaveLength(3);
      for (const widget of field.acroField.getWidgets())
        expect(widget.getAppearances()?.normal).toBeDefined();
    }
  });

  it("prefers widget references over duplicate field names", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([300, 300]);
    const fields: FormField[] = [];
    for (let index = 0; index < 2; index++) {
      const text = source.getForm().createTextField(`original_${index}`);
      text.addToPage(page, {
        x: 30,
        y: 200 - index * 50,
        width: 180,
        height: 24,
      });
      text.acroField.setPartialName("duplicate");
      fields.push({
        id: `field_${index}`,
        name: "duplicate",
        type: FieldType.TEXT,
        pageIndex: 0,
        rect: { ...rect, y: 30 + index * 50 },
        value: `Value ${index}`,
        style,
        sourcePdfRef: widgetRef(text),
      });
    }
    const bytes = await source.save({ updateFieldAppearances: false });
    const output = await exportPDF(bytes, fields);
    const reopened = (await PDFDocument.load(output)).getForm().getFields();
    expect(reopened).toHaveLength(2);
    expect(reopened.map((field) => (field as PDFTextField).getText())).toEqual([
      "Value 0",
      "Value 1",
    ]);
  });

  it("keeps moved widgets on their target page without duplicates", async () => {
    const source = await PDFDocument.create();
    const first = source.addPage([300, 300]);
    source.addPage([300, 300]);
    const text = source.getForm().createTextField("moved");
    text.addToPage(first, { x: 30, y: 200, width: 180, height: 24 });
    const field: FormField = {
      id: "moved",
      name: "moved",
      type: FieldType.TEXT,
      pageIndex: 1,
      rect,
      style,
      value: "Moved value",
      sourcePdfRef: widgetRef(text),
    };
    const output = await exportPDF(
      await source.save({ updateFieldAppearances: false }),
      [field],
    );
    const reopened = await PDFDocument.load(output);
    expect(reopened.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
    expect(reopened.getPage(1).node.Annots()?.size()).toBe(1);
    const widget = reopened
      .getForm()
      .getTextField("moved")
      .acroField.getWidgets()[0];
    expect(widget.P()).toEqual(reopened.getPage(1).ref);
    expect(widget.getRectangle()).toEqual({
      ...rect,
      y: 300 - rect.y - rect.height,
    });
  });

  it("does not reuse indexes or pending updates across exports", async () => {
    const source = await PDFDocument.create();
    source.addPage([300, 300]);
    const bytes = await source.save();
    const field: FormField = {
      id: "name",
      name: "name",
      type: FieldType.TEXT,
      pageIndex: 0,
      rect,
      style,
    };
    const outputs = await Promise.all(
      ["First", "Second"].map((value) =>
        exportPDF(bytes, [{ ...field, value }]),
      ),
    );
    for (const [index, output] of outputs.entries()) {
      const form = (await PDFDocument.load(output)).getForm();
      expect(form.getFields()).toHaveLength(1);
      expect(form.getTextField("name").getText()).toBe(
        index === 0 ? "First" : "Second",
      );
    }
  });

  it("preserves a valid appearance when only a later page is selected", async () => {
    const source = await PDFDocument.create();
    const pages = [source.addPage([300, 300]), source.addPage([300, 300])];
    const text = source.getForm().createTextField("shared");
    const fields: FormField[] = pages.map((page, pageIndex) => {
      text.addToPage(page, { x: 30, y: 200, width: 180, height: 24 });
      return {
        id: `shared_${pageIndex}`,
        name: "shared",
        type: FieldType.TEXT,
        pageIndex,
        rect,
        style,
        value: `Page ${pageIndex + 1}`,
        sourcePdfRef: widgetRef(text, pageIndex),
      };
    });
    const output = await exportPDF(
      await source.save({ updateFieldAppearances: false }),
      fields,
      undefined,
      [],
      undefined,
      { pageIndexes: [1] },
    );
    const reopened = await PDFDocument.load(output);
    expect(reopened.getPageCount()).toBe(1);
    expect(reopened.getForm().getTextField("shared").getText()).toBe("Page 2");
    const annots = reopened.getPage(0).node.Annots();
    expect(annots?.size()).toBe(1);
    const widget = annots?.lookup(0, PDFDict);
    expect(
      widget?.lookup(PDFName.of("AP"), PDFDict).lookup(PDFName.of("N")),
    ).toBeInstanceOf(PDFStream);
  });
});
