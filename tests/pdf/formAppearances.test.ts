import { describe, expect, it, vi } from "vitest";
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFStream,
  PDFString,
  PDFTextField,
} from "@legir/pdfium/authoring";
import { exportPDF, exportPDFBlob } from "@/services/pdfService";
import { finalizeFormAppearances } from "@/services/pdfService/lib/form-appearances";
import { FieldType } from "@/types";

const key = PDFName.of;
async function fixture() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const form = doc.getForm();
  const text = form.createTextField("name");
  text.setText("Original value");
  text.addToPage(page, { x: 20, y: 200, width: 240, height: 30 });
  const widget = text.acroField.getWidgets()[0];
  return { doc, page, form, text, widget, acro: form.acroForm.dict };
}
const edited = {
  id: "name",
  name: "name",
  type: FieldType.TEXT,
  pageIndex: 0,
  rect: { x: 20, y: 70, width: 240, height: 30 },
  value: "Saved value",
  style: { fontFamily: "Helvetica", fontSize: 16 },
};
async function reopen(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const acro = doc.catalog.lookup(key("AcroForm"), PDFDict);
  return {
    doc,
    acro,
    required: acro.lookup(key("NeedAppearances")) === PDFBool.True,
  };
}

describe("saved form appearance policy", () => {
  it.each([undefined, false, true])(
    "keeps generated appearances authoritative in full and incremental saves (source request: %s)",
    async (requested) => {
      const { doc, acro } = await fixture();
      if (requested !== undefined)
        acro.set(
          key("NeedAppearances"),
          requested ? PDFBool.True : PDFBool.False,
        );
      const bytes = await doc.save();
      const outputs = [
        await exportPDF(bytes, [edited]),
        new Uint8Array(
          await (await exportPDFBlob(bytes, [edited])).arrayBuffer(),
        ),
      ];
      expect(outputs[1].subarray(0, bytes.length)).toEqual(bytes);
      for (const output of outputs) {
        const saved = await reopen(output);
        const field = saved.doc.getForm().getTextField("name");
        expect(saved.required).toBe(false);
        expect(field.getText()).toBe("Saved value");
        expect(
          field.acroField.getWidgets()[0].getNormalAppearance(),
        ).toBeInstanceOf(PDFStream);
      }
    },
  );

  it("preserves an unchanged appearance without adding a regeneration request", async () => {
    const { doc } = await fixture();
    const bytes = await doc.save();
    const original = (await PDFDocument.load(bytes))
      .getForm()
      .getTextField("name")
      .acroField.getWidgets()[0]
      .getNormalAppearance() as PDFStream;
    const output = await exportPDFBlob(bytes, [], { title: "Metadata edit" });
    const saved = await reopen(new Uint8Array(await output.arrayBuffer()));
    const appearance = saved.doc
      .getForm()
      .getTextField("name")
      .acroField.getWidgets()[0]
      .getNormalAppearance() as PDFStream;
    expect(saved.required).toBe(false);
    expect(appearance.getContents()).toEqual(original.getContents());
  });

  it("preserves an input request for a stale appearance unless that field was regenerated", async () => {
    const { doc, acro, text } = await fixture();
    // Keep the old /AP while changing /V, as in a form saved for viewer repair.
    text.setText("Stale appearance needs repair");
    acro.set(key("NeedAppearances"), PDFBool.True);
    const bytes = await doc.save({ updateFieldAppearances: false });
    const oldAppearance = (await PDFDocument.load(bytes))
      .getForm()
      .getTextField("name")
      .acroField.getWidgets()[0]
      .getNormalAppearance() as PDFStream;
    const saved = await reopen(
      await exportPDF(bytes, [], { title: "Only metadata" }),
    );
    expect(saved.required).toBe(true);
    const field = saved.doc.getForm().getTextField("name");
    expect(field.getText()).toBe("Stale appearance needs repair");
    expect(
      (
        field.acroField.getWidgets()[0].getNormalAppearance() as PDFStream
      ).getContents(),
    ).toEqual(oldAppearance.getContents());
  });

  it("retains the source request when only some visible fields were regenerated", async () => {
    const { doc, acro, form, page } = await fixture();
    const other = form.createTextField("other");
    other.addToPage(page, { x: 20, y: 100, width: 100, height: 20 });
    other.setText("Needs repair");
    acro.set(key("NeedAppearances"), PDFBool.True);
    const bytes = await doc.save({ updateFieldAppearances: false });
    const saved = await reopen(
      await exportPDF(bytes, [edited], undefined, [], undefined, {
        syncFormFields: false,
      }),
    );
    expect(saved.required).toBe(true);
    expect(saved.doc.getForm().getTextField("name").getText()).toBe(
      "Saved value",
    );
    expect(saved.doc.getForm().getTextField("other").getText()).toBe(
      "Needs repair",
    );
  });

  it.each(["absent", "invalid", "missing-state"] as const)(
    "retains the viewer fallback for a preserved %s appearance",
    async (kind) => {
      const { doc, widget } = await fixture();
      if (kind === "absent") widget.dict.delete(key("AP"));
      else
        widget.dict.set(
          key("AP"),
          doc.context.obj({
            N: kind === "invalid" ? PDFString.of("invalid") : {},
          }),
        );
      const bytes = await doc.save({ updateFieldAppearances: false });
      expect((await reopen(await exportPDF(bytes, []))).required).toBe(true);
    },
  );

  it("checks the selected checkbox state, including a missing on-state stream", async () => {
    const { doc, form, page } = await fixture();
    const check = form.createCheckBox("checked");
    check.addToPage(page, { x: 20, y: 100, width: 20, height: 20 });
    check.check();
    const bytes = await doc.save();
    expect((await reopen(await exportPDF(bytes, []))).required).toBe(false);
    const widget = check.acroField.getWidgets()[0];
    const states = widget.getNormalAppearance() as PDFDict;
    states.delete(widget.getAppearanceState()!);
    const missing = await doc.save({ updateFieldAppearances: false });
    expect((await reopen(await exportPDF(missing, []))).required).toBe(true);
  });

  it.each(["orphan", "hidden", "signature"] as const)(
    "handles %s widgets without relying on the catalog field list",
    async (kind) => {
      const { doc, page } = await fixture();
      const parent = doc.context.register(
        doc.context.obj({ FT: kind === "signature" ? "Sig" : "Tx" }),
      );
      const orphan = doc.context.register(
        doc.context.obj({
          Type: "Annot",
          Subtype: "Widget",
          Rect: [20, 80, 150, 100],
          P: page.ref,
          Parent: parent,
          F: kind === "hidden" ? 2 : 4,
        }),
      );
      page.node.addAnnot(orphan);
      const saved = await reopen(await exportPDF(await doc.save(), []));
      expect(saved.required).toBe(kind === "orphan");
    },
  );

  it("checks only retained pages when exporting a selection", async () => {
    const { doc, form, widget } = await fixture();
    widget.dict.delete(key("AP"));
    const page = doc.addPage([300, 300]);
    const retained = form.createTextField("retained");
    retained.addToPage(page, { x: 20, y: 20, width: 100, height: 20 });
    const bytes = await doc.save({ updateFieldAppearances: false });
    const saved = await reopen(
      await exportPDF(bytes, [], undefined, [], undefined, {
        pageIndexes: [1],
      }),
    );
    expect(saved.doc.getPageCount()).toBe(1);
    expect(saved.required).toBe(false);
  });

  it.each([false, true])(
    "retains the fallback after a failed appearance update (value edited: %s)",
    async (editValue) => {
      const { doc } = await fixture();
      const bytes = await doc.save();
      vi.spyOn(PDFTextField.prototype, "updateAppearances").mockImplementation(
        () => {
          throw new Error("Appearance generation failed");
        },
      );
      const saved = await reopen(
        await exportPDF(bytes, [
          editValue
            ? edited
            : { ...edited, value: undefined, style: undefined },
        ]),
      );
      expect(saved.required).toBe(true);
      expect(saved.doc.getForm().getTextField("name").getText()).toBe(
        editValue ? "Saved value" : "Original value",
      );
    },
  );

  it.each([undefined, false, true])(
    "preserves editable XFA policy (%s), while print disables regeneration",
    async (requested) => {
      const { doc, acro } = await fixture();
      acro.set(key("XFA"), PDFString.of("synthetic XFA data"));
      if (requested !== undefined)
        acro.set(
          key("NeedAppearances"),
          requested ? PDFBool.True : PDFBool.False,
        );
      const bytes = await doc.save();
      const saved = await reopen(await exportPDF(bytes, [edited]));
      expect(saved.acro.lookup(key("NeedAppearances"))).toBe(
        requested === undefined
          ? undefined
          : requested
            ? PDFBool.True
            : PDFBool.False,
      );
      expect(saved.acro.lookup(key("XFA"), PDFString).decodeText()).toBe(
        "synthetic XFA data",
      );
      const printed = await reopen(
        await exportPDF(bytes, [edited], undefined, [], undefined, {
          flattenFormFields: true,
        }),
      );
      expect(printed.required).toBe(false);
      expect(printed.acro.lookup(key("Fields"), PDFArray).size()).toBe(0);
      expect(printed.acro.lookup(key("XFA"), PDFString).decodeText()).toBe(
        "synthetic XFA data",
      );
    },
  );

  it("can abort the widget scan before changing the document flag", async () => {
    const { doc, acro } = await fixture();
    const controller = new AbortController();
    let checkpoints = 0;
    await expect(
      finalizeFormAppearances(doc, {
        checkpoint: async () => {
          if (++checkpoints === 2) controller.abort();
          controller.signal.throwIfAborted();
        },
      }),
    ).rejects.toThrow();
    expect(acro.has(key("NeedAppearances"))).toBe(false);
  });
});
