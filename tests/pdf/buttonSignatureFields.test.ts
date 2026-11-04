import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createPDFium, type PDFium } from "@legir/pdfium";
import {
  NativeEditingContext,
  PDFButton,
  PDFSignature,
  PDFName,
  PDFHexString,
  PDFDict,
  PDFStream,
  op,
} from "@legir/pdfium/authoring";
import { DocumentSession } from "@legir/pdf-core";
import { renderWidgetAppearance } from "@legir/pdf-core/engine/widgetAppearance";
import { FieldType, type FormField } from "@legir/pdf-model";
import {
  detachFormFieldSource,
  canPreserveFormAppearance,
} from "@legir/pdf-model/formAppearance";

const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAG0lEQVR4nF3BsQEAMAzDINz/f1b2wqTGBJ7PAXIpBAI6gp9uAAAAAElFTkSuQmCC";
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
  const s = new DocumentSession(engine, bytes);
  sessions.push(s);
  return s;
};
const raster = (native: InstanceType<PDFium["PDFDocument"]>) => {
  const page = native.loadPage(0);
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
async function fixture(layout: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 1) {
  const view = open(),
    doc = view.document,
    page = doc.addPage([360, 240]);
  const button = doc.getForm().createButton("photo");
  button.addToPage("Site photo", page, {
    x: 30,
    y: 80,
    width: 240,
    height: 120,
    borderWidth: 0,
  });
  button.setImage(await doc.embedPng(image));
  button.setLayout(layout);
  button.updateAppearances();
  return { view, doc, page, button, bytes: await doc.save() };
}
const field = (type: FieldType, patch: Partial<FormField> = {}): FormField => ({
  id: "field",
  name: "field",
  type,
  pageIndex: 0,
  rect: { x: 30, y: 30, width: 150, height: 65 },
  style: {
    borderWidth: 1,
    borderColor: "#000000",
    backgroundColor: "#ffffff",
    fontSize: 12,
  },
  ...patch,
});

describe("standard pushbuttons and signature fields", () => {
  it("creates distinct widgets for new buttons sharing the same field name", async () => {
    const empty = open();
    empty.document.addPage([360, 240]);
    const s = session(await empty.document.save());
    const out = await s.export({
      fields: [
        field(FieldType.BUTTON, { buttonCaption: "One" }),
        field(FieldType.BUTTON, {
          id: "second",
          rect: { x: 30, y: 130, width: 150, height: 65 },
          buttonCaption: "Two",
        }),
      ],
      annotations: [],
    });
    const button = open(out).document.getForm().getButton("field");
    expect(button.acroField.getWidgets()).toHaveLength(2);
    expect(
      button.acroField.getWidgets().map((widget) => button.getCaption(widget)),
    ).toEqual(["One", "Two"]);
  });
  it("renders imported button previews through the source's virtual-reference mapping", async () => {
    const { bytes } = await fixture();
    const source = session(bytes);
    const parsed = await source.parse({}, async () => undefined);
    const empty = open();
    empty.document.addPage([500, 700]);
    const owner = session(await empty.document.save());
    await owner.addSource("donor", bytes);
    const preview = await owner.transaction("donor", async (doc) => {
      const widget = doc.getForm().getButton("photo").acroField.getWidgets()[0];
      const ref = doc.context.getObjectRef(widget.dict)!;
      return await renderWidgetAppearance(doc, 0, widget, ref);
    });
    expect(preview).toBe(parsed.fields[0].sourceAppearance);
    expect(owner.stats().nativeDocuments).toBe(1);
  });
  it.each([0, 1, 2, 3, 4, 5, 6] as const)(
    "preserves layout %s and original appearance through import, editable save and flatten",
    async (layout) => {
      const { bytes } = await fixture(layout);
      const s = session(bytes);
      const before = raster(s.document);
      const parsed = await s.parse({}, async () => undefined);
      expect(parsed.fields).toHaveLength(1);
      expect(parsed.fields[0]).toMatchObject({
        name: "photo",
        type: FieldType.BUTTON,
        buttonLayout: layout,
      });
      expect(parsed.fields[0].buttonIconPreview).toMatch(
        /^data:image\/png;base64,/,
      );
      expect(parsed.fields[0].sourceAppearance).toMatch(
        /^data:image\/png;base64,/,
      );
      expect(raster(s.document)).toBe(before);
      for (const flattenFormFields of [false, true]) {
        const out = await s.export({
          fields: parsed.fields,
          annotations: parsed.annotations,
          options: { flattenFormFields },
        });
        const result = open(out);
        expect(raster(result.native)).toBe(before);
        expect(result.document.getForm().getFields()).toHaveLength(
          flattenFormFields ? 0 : 1,
        );
        if (!flattenFormFields)
          expect(result.document.getForm().getButton("photo").getLayout()).toBe(
            layout,
          );
        expect(raster(s.document)).toBe(before);
      }
    },
  );
  it("creates a standard image button and a genuinely unsigned signature domain", async () => {
    const empty = open();
    empty.document.addPage([360, 240]);
    const s = session(await empty.document.save());
    const out = await s.export({
      fields: [
        field(FieldType.BUTTON, {
          name: "image",
          buttonImage: image,
          buttonLayout: 1,
        }),
        field(FieldType.SIGNATURE, {
          name: "signature",
          required: true,
          rect: { x: 30, y: 150, width: 180, height: 40 },
        }),
      ],
      annotations: [],
    });
    const doc = open(out).document;
    const button = doc.getForm().getButton("image"),
      sig = doc.getForm().getSignature("signature");
    expect(button).toBeInstanceOf(PDFButton);
    expect(button.getIcon()).toBeInstanceOf(PDFStream);
    expect(button.acroField.getFlags() & (1 << 16)).toBeTruthy();
    expect(sig).toBeInstanceOf(PDFSignature);
    expect(sig.acroField.dict.lookup(PDFName.of("FT"))).toBe(PDFName.of("Sig"));
    expect(sig.acroField.dict.has(PDFName.of("V"))).toBe(false);
    expect(sig.getSignatureInfo()).toBeUndefined();
    expect(sig.isRequired()).toBe(true);
    const parsed = await session(out).parse({}, async () => undefined);
    expect(parsed.fields.map((f) => f.type)).toEqual([
      FieldType.SIGNATURE,
      FieldType.BUTTON,
    ]);
  });
  it("edits captions, layout, geometry, flags and replaces or clears icons without deleting the field", async () => {
    const { bytes } = await fixture();
    const s = session(bytes);
    const parsed = await s.parse({}, async () => undefined);
    const original = parsed.fields[0];
    const updated = {
      ...original,
      name: "inspection_photo",
      buttonCaption: "Inspection",
      buttonLayout: 2 as const,
      buttonImage: image,
      buttonImageFit: {
        scaleMode: "fill" as const,
        alignment: [0, 1] as [number, number],
        when: "always" as const,
        fitBounds: true,
      },
      toolTip: "Replacement photo",
      readOnly: true,
      rect: { ...original.rect, x: 60 },
    };
    const out = await s.export({ fields: [updated], annotations: [] });
    const doc = open(out).document,
      button = doc.getForm().getButton("inspection_photo");
    expect(button.getCaption()).toBe("Inspection");
    expect(button.getLayout()).toBe(2);
    expect(button.isReadOnly()).toBe(true);
    expect(button.getImageFit()).toMatchObject({
      scaleMode: "fill",
      alignment: [0, 1],
      fitBounds: true,
    });
    const round = await session(out).parse({}, async () => undefined);
    expect(round.fields[0].rect.x).toBeCloseTo(60);
    const cleared = { ...round.fields[0], buttonImage: null };
    expect(canPreserveFormAppearance(cleared)).toBe(false);
    const clear = await session(out).export({
      fields: [cleared],
      annotations: [],
    });
    expect(
      open(clear).document.getForm().getButton("inspection_photo").getIcon(),
    ).toBeUndefined();
  });
  it("keeps separate widget captions and icons in a shared pushbutton field", async () => {
    const { doc, page, button } = await fixture();
    button.addToPage("Other", page, { x: 30, y: 10, width: 100, height: 30 });
    const bytes = await doc.save();
    const s = session(bytes);
    const parsed = await s.parse({}, async () => undefined);
    expect(parsed.fields).toHaveLength(2);
    const out = await s.export({
      fields: parsed.fields.map((f, i) =>
        i === 0 ? { ...f, buttonCaption: "Changed" } : f,
      ),
      annotations: [],
    });
    const result = open(out).document.getForm().getButton("photo");
    const widgets = result.acroField.getWidgets();
    expect(widgets).toHaveLength(2);
    expect(result.getCaption(widgets[0])).toBe("Changed");
    expect(result.getCaption(widgets[1])).toBe("Other");
    expect(result.getIcon(widgets[0])).toBeDefined();
    expect(result.getIcon(widgets[1])).toBeUndefined();
  });
  it("preserves foreign button actions without executing them", async () => {
    const { doc, button } = await fixture();
    const widget = button.acroField.getWidgets()[0];
    widget.dict.set(
      PDFName.of("A"),
      doc.context.obj({
        S: "JavaScript",
        JS: PDFHexString.fromText("throw new Error('must never run')"),
      }),
    );
    const s = session(await doc.save());
    const parsed = await s.parse({}, async () => undefined);
    const out = await s.export({ fields: parsed.fields, annotations: [] });
    expect(
      open(out)
        .document.getForm()
        .getButton("photo")
        .acroField.getWidgets()[0]
        .dict.lookup(PDFName.of("A")),
    ).toBeInstanceOf(PDFDict);
  });
  it("fails invalid/new image exports instead of silently publishing a blank button or fetching URLs", async () => {
    const { bytes } = await fixture();
    const s = session(bytes);
    const parsed = await s.parse({}, async () => undefined);
    const before = raster(s.document);
    const fetch = vi.spyOn(globalThis, "fetch");
    for (const source of [
      "https://example.invalid/image.png",
      "data:image/svg+xml;base64,PHN2Zy8+",
      "data:image/png;base64,AAAA",
    ]) {
      await expect(
        s.export({
          fields: [{ ...parsed.fields[0], buttonImage: source }],
          annotations: [],
        }),
      ).rejects.toThrow();
      expect(raster(s.document)).toBe(before);
    }
    await expect(
      s.export({
        fields: [
          field(FieldType.BUTTON, {
            name: "new",
            buttonImage: "http://localhost/private",
          }),
        ],
        annotations: [],
      }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("converts an existing text field to a button or unsigned signature without retaining the old field type", async () => {
    const original = open();
    const page = original.document.addPage([360, 240]);
    original.document
      .getForm()
      .createTextField("field")
      .addToPage(page, { x: 20, y: 30, width: 160, height: 40 });
    const s = session(await original.document.save());
    const parsed = await s.parse({}, async () => undefined);
    for (const type of [FieldType.BUTTON, FieldType.SIGNATURE]) {
      const out = await s.export({
        fields: [
          {
            ...parsed.fields[0],
            type,
            buttonCaption: "Converted",
            buttonLayout: 0,
          },
        ],
        annotations: [],
      });
      const result = open(out).document.getForm().getField("field");
      expect(result).toBeInstanceOf(
        type === FieldType.BUTTON ? PDFButton : PDFSignature,
      );
    }
  });
  it("preserves custom unsigned signature appearances on no-op saves and flattening", async () => {
    const view = open();
    const doc = view.document;
    const page = doc.addPage([360, 240]);
    const signature = doc.getForm().createSignature("approval");
    signature.addToPage(page, { x: 20, y: 50, width: 180, height: 60 });
    signature.acroField
      .getWidgets()[0]
      .setNormalAppearance(
        doc.context.register(
          doc.context.formXObject(
            [op("rg", 0.1, 0.4, 0.8), op("re", 0, 0, 180, 60), op("f")],
            { BBox: [0, 0, 180, 60], Resources: {} },
          ),
        ),
      );
    const s = session(await doc.save({ updateFieldAppearances: false }));
    const before = raster(s.document);
    const parsed = await s.parse({}, async () => undefined);
    expect(parsed.fields[0].signature).toBeUndefined();
    expect(canPreserveFormAppearance(parsed.fields[0])).toBe(true);
    for (const flattenFormFields of [false, true]) {
      const result = open(
        await s.export({
          fields: parsed.fields,
          annotations: [],
          options: { flattenFormFields },
        }),
      );
      expect(raster(result.native)).toBe(before);
      expect(result.document.getForm().getFields()).toHaveLength(
        flattenFormFields ? 0 : 1,
      );
    }
    expect(raster(s.document)).toBe(before);
  });
  it("edits one unsigned signature widget without regenerating sibling appearances", async () => {
    const view = open();
    const doc = view.document;
    const page = doc.addPage([360, 240]);
    const signature = doc.getForm().createSignature("approval");
    for (const y of [30, 130])
      signature.addToPage(page, { x: 20, y, width: 180, height: 60 });
    for (const [i, widget] of signature.acroField.getWidgets().entries())
      widget.setNormalAppearance(
        doc.context.register(
          doc.context.formXObject(
            [op("rg", i, 0, 1 - i), op("re", 0, 0, 180, 60), op("f")],
            { BBox: [0, 0, 180, 60], Resources: {} },
          ),
        ),
      );
    const original = signature.acroField
      .getWidgets()
      .map((widget) =>
        Array.from(
          (widget.getAppearances().normal as PDFStream).getUnencodedContents(),
        ),
      );
    const s = session(await doc.save({ updateFieldAppearances: false }));
    const parsed = await s.parse({}, async () => undefined);
    expect(parsed.fields).toHaveLength(2);
    const output = open(
      await s.export({
        fields: parsed.fields.map((field, i) =>
          i === 0
            ? { ...field, style: { ...field.style, borderColor: "#00ff00" } }
            : field,
        ),
        annotations: [],
      }),
    );
    const widgets = output.document
      .getForm()
      .getSignature("approval")
      .acroField.getWidgets();
    expect(
      Array.from(
        (
          widgets[0].getAppearances().normal as PDFStream
        ).getUnencodedContents(),
      ),
    ).not.toEqual(original[0]);
    expect(
      Array.from(
        (
          widgets[1].getAppearances().normal as PDFStream
        ).getUnencodedContents(),
      ),
    ).toEqual(original[1]);
  });
  it("exposes populated signature metadata as unverified and preserves the original signer appearance", async () => {
    const v = open(),
      doc = v.document,
      page = doc.addPage([360, 240]);
    const sig = doc.getForm().createSignature("approval");
    sig.addToPage(page, { x: 20, y: 60, width: 200, height: 80 });
    // Deliberately synthetic, NOT a valid CMS signature. Presence must never imply verification.
    sig.acroField.dict.set(
      PDFName.of("V"),
      doc.context.obj({
        Type: "Sig",
        Name: PDFHexString.fromText("Declared signer"),
        Reason: PDFHexString.fromText("Fixture only"),
        Contents: PDFHexString.of("0001"),
        ByteRange: [0, 1, 2, 3],
      }),
    );
    const widget = sig.acroField.getWidgets()[0];
    widget.setNormalAppearance(
      doc.context.register(
        doc.context.formXObject(
          [op("rg", 0, 0, 1), op("re", 0, 0, 200, 80), op("f")],
          { BBox: [0, 0, 200, 80], Resources: {} },
        ),
      ),
    );
    const s = session(await doc.save());
    const before = raster(s.document);
    const parsed = await s.parse({}, async () => undefined);
    expect(parsed.fields[0]).toMatchObject({
      type: FieldType.SIGNATURE,
      signature: { present: true, name: "Declared signer" },
    });
    expect(parsed.fields[0].sourceAppearance).toMatch(/^data:image\/png/);
    const out = await s.export({
      fields: [
        {
          ...parsed.fields[0],
          rect: { x: 150, y: 150, width: 30, height: 20 },
        },
      ],
      annotations: [],
    });
    const result = open(out);
    expect(raster(result.native)).toBe(before);
    expect(
      result.document.getForm().getSignature("approval").getSignatureInfo()
        ?.name,
    ).toBe("Declared signer");
    await expect(
      s.export({
        fields: [{ ...parsed.fields[0], type: FieldType.BUTTON }],
        annotations: [],
      }),
    ).rejects.toThrow(/populated signature/);
    const flat = open(
      await s.export({
        fields: parsed.fields,
        annotations: [],
        options: { flattenFormFields: true },
      }),
    );
    expect(flat.document.getForm().getFields()).toHaveLength(0);
    expect(raster(flat.native)).toBe(before);
    const copied = detachFormFieldSource(parsed.fields[0]);
    expect(copied.signature).toBeUndefined();
    expect(copied.sourcePdfRef).toBeUndefined();
    expect(copied.sourceAppearance).toBeUndefined();
  });
  it("copies an imported icon as portable image data rather than borrowing source references", async () => {
    const { bytes } = await fixture();
    const parsed = await session(bytes).parse({}, async () => undefined);
    const copied = detachFormFieldSource(parsed.fields[0]);
    expect(copied.buttonImage).toBe(parsed.fields[0].buttonIconPreview);
    expect(copied.sourcePdfRef).toBeUndefined();
    const empty = open();
    empty.document.addPage([360, 240]);
    const out = await session(await empty.document.save()).export({
      fields: [copied],
      annotations: [],
    });
    expect(
      open(out).document.getForm().getButton("photo").getIcon(),
    ).toBeInstanceOf(PDFStream);
  });
});
